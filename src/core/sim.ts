import { DodgeDetector } from './dodge';
import type { DodgeHit } from './dodge';
import { CHAIN_MULT, FRENZY } from './config';
import { classifyGuard, lerpPose, lerpV3, makePose } from './guard';
import type { GuardReading } from './guard';
import { Rng } from './rng';
import type {
  AbilityId,
  AttackDef,
  Combo,
  DodgeKind,
  DuelEvent,
  EnemyDef,
  Fault,
  FrameInput,
  GuardConfig,
  GuardSide,
  Modifiers,
  StrikeZone,
  SwordPose,
  TimingConfig,
} from './types';

/** Sub-steps per frame. Guard transitions are then refined further by bisection. */
const SUBSTEPS = 4;
const BISECT_ITERS = 6;

const SLOW_SCALE = 0.5;
const SLOW_DURATION_MS = 3000;
const ABILITY_COOLDOWN: Record<AbilityId, number> = { slowTime: 18000, ward: 12000 };

export type EnemyState = 'idle' | 'attack' | 'stagger' | 'dead';

export interface DuelOptions {
  timing: TimingConfig;
  guard: GuardConfig;
  enemy: EnemyDef;
  mods: Modifiers;
  seed: number;
  startT?: number;
  /** Disable the enemy's own decision-making (tests script attacks instead). */
  ai?: boolean;
  /** Carry HP between fights in a run. */
  playerHp?: number;
}

/**
 * The duel simulation. Time is in milliseconds. All judgements happen at
 * interpolated sub-frame times, so frame rate does not change what counts
 * as a parry.
 */
export class Duel {
  readonly events: DuelEvent[] = [];
  readonly cfg: TimingConfig;
  readonly guardCfg: GuardConfig;
  readonly mods: Modifiers;

  readonly player = {
    hp: 0,
    hpMax: 0,
    posture: 0,
    postureHitAt: -Infinity,
    iframesUntil: -Infinity,
    dodgeAt: -Infinity,
    dodgeKind: null as DodgeKind | null,
    lockoutUntil: -Infinity,
    counterUntil: -Infinity,
    wardCharges: 0,
    slowUntil: -Infinity,
    /** Real-time interval during which the enemy clock is frozen (perfect-parry hit-stop). */
    hitStopFrom: -Infinity,
    hitStopUntil: -Infinity,
    abilityReadyAt: { slowTime: 0, ward: 0 } as Record<AbilityId, number>,
    dead: false,
    /** Perfect parries in a row (reset by a block or a hit). */
    chain: 0,
    /** Hits taken in a row (reset by a perfect). Drives the assist. */
    hitStreak: 0,
  };

  readonly enemy = {
    def: null as unknown as EnemyDef,
    hp: 0,
    posture: 0,
    postureHitAt: -Infinity,
    state: 'idle' as EnemyState,
    /** Enemy-local clock (runs slower under slow-time). */
    clock: 0,
    nextActionAt: 0,
    combo: null as Combo | null,
    stepIndex: 0,
    attackStart: 0,
    struck: false,
    staggerUntil: 0,
    /** Frenzy windup multiplier, fixed when the current attack started so its strike never moves. */
    windupScale: 1,
    /** Side he holds his sword on while idle; strikes to the other side get through. */
    guardSide: 'right' as GuardSide,
    /** Enemy-clock time he next moves his idle guard. */
    guardShiftAt: 0,
  };

  readonly guard: GuardReading = { dir: null, angleErr: 90 };
  guardEntryT = -Infinity;
  time: number;

  private pending: { att: AttackDef; strikeT: number } | null = null;
  private entries: number[] = [];
  private readonly rng: Rng;
  /** Separate stream for guard shifts, so they never change which combos the enemy picks. */
  private readonly guardRng: Rng;
  /** Grip this frame. Guards are judged with the grip held at that instant. */
  twoHanded = false;
  private readonly ai: boolean;
  private readonly dodge = new DodgeDetector();

  // Scratch objects so step() doesn't allocate.
  private readonly poseA: SwordPose = makePose();
  private readonly poseB: SwordPose = makePose();
  /** Last sim time the blade tip moved faster than steadyMaxSpeed (end of that sub-step). */
  private lastFastT = -Infinity;
  private readonly poseM: SwordPose = makePose();
  private readonly readB: GuardReading = { dir: null, angleErr: 90 };
  private readonly readM: GuardReading = { dir: null, angleErr: 90 };
  private readonly headA = { x: 0, y: 0, z: 0 };
  private readonly headB = { x: 0, y: 0, z: 0 };

  constructor(o: DuelOptions) {
    this.cfg = o.timing;
    this.guardCfg = o.guard;
    this.mods = o.mods;
    this.rng = new Rng(o.seed);
    this.guardRng = new Rng(o.seed ^ 0x5bd1e995);
    this.ai = o.ai ?? true;
    this.time = o.startT ?? 0;

    const p = this.player;
    p.hpMax = this.cfg.playerHp + this.mods.maxHpBonus;
    p.hp = Math.min(p.hpMax, o.playerHp ?? p.hpMax);

    const e = this.enemy;
    e.def = o.enemy;
    e.hp = o.enemy.hp;
    e.clock = this.time;
    e.nextActionAt = this.time + 1500;
    e.guardShiftAt = this.time + this.guardShiftDelay();
  }

  /** The side a strike gets through on right now: his idle opening, 'all' when he's attacking,
   *  countered or broken. */
  get opening(): GuardSide | 'all' | null {
    const e = this.enemy;
    if (e.state === 'dead') return null;
    if (e.state !== 'idle' || this.time <= this.player.counterUntil) return 'all';
    return e.guardSide === 'left' ? 'right' : 'left';
  }

  /** Tip speed (m/s) above which the blade counts as moving, for the steadiness check. */
  get steadyLimit(): number {
    return this.twoHanded ? this.cfg.twoHandSteadyMaxSpeed : this.cfg.steadyMaxSpeed;
  }

  private guardShiftDelay(): number {
    return this.guardRng.range(this.cfg.guardShiftMinMs, this.cfg.guardShiftMaxMs);
  }

  private shiftGuard(to: GuardSide): void {
    const e = this.enemy;
    e.guardSide = to;
    e.guardShiftAt = e.clock + this.guardShiftDelay();
  }

  get grace(): number {
    return Math.max(this.cfg.perfectLateMs, this.cfg.blockLateMs);
  }

  get currentAttack(): AttackDef | null {
    const e = this.enemy;
    return e.state === 'attack' && e.combo ? e.combo.steps[e.stepIndex].attack : null;
  }

  /** Scaled windup of an attack in enemy-clock ms (enemy speed and frenzy). */
  windup(att: AttackDef): number {
    return (att.windupMs / this.enemy.def.speed) * this.enemy.windupScale;
  }

  /** Current frenzy level for the enemy's HP, or null when healthy. */
  frenzy(): (typeof FRENZY)[number] | null {
    const f = this.enemy.hp / this.enemy.def.hp;
    return FRENZY.find((l) => f < l.belowHp) ?? null;
  }

  /** Is the miss-streak assist widening the perfect window right now? */
  get assistOn(): boolean {
    const c = this.cfg;
    return c.assistBonusMs > 0 && this.player.hitStreak >= c.assistAfterHits;
  }

  /** How early before the strike a guard may arrive and still be perfect (ms). */
  perfectEarlyMs(): number {
    const c = this.cfg;
    const boons = this.mods.perfectWindowBonusMs;
    const assist = this.assistOn ? Math.max(0, Math.min(c.assistBonusMs, c.windowBonusCapMs - boons)) : 0;
    return c.perfectEarlyMs + boons + assist;
  }

  /** 0..1 progress through the current attack's windup, >1 after the strike. */
  attackProgress(): number {
    const att = this.currentAttack;
    if (!att) return 0;
    return (this.enemy.clock - this.enemy.attackStart) / this.windup(att);
  }

  /** Test hook: start a scripted combo at enemy-clock time `start`. */
  scriptCombo(c: Combo, start: number): void {
    this.startCombo(c, start, start);
  }

  step(inp: FrameInput): void {
    this.events.length = 0;
    this.twoHanded = !!inp.twoHanded; // per frame: a grip change is slower than a frame anyway
    if (this.player.dead || this.enemy.state === 'dead') {
      this.time = inp.t1;
      return;
    }

    if (inp.ability) this.useAbility(inp.ability, inp.t0);

    const span = inp.t1 - inp.t0;
    for (let k = 1; k <= SUBSTEPS; k++) {
      const fa = (k - 1) / SUBSTEPS;
      const fb = k / SUBSTEPS;
      const a = inp.t0 + span * fa;
      const b = inp.t0 + span * fb;

      // 1. Dodge (head motion).
      lerpV3(this.headA, inp.headPrev, inp.headCurr, fa);
      lerpV3(this.headB, inp.headPrev, inp.headCurr, fb);
      const dh = this.dodge.update(a, b, this.headA, this.headB);
      if (dh) this.onDodge(dh);

      // 2. Guard transition, refined to a sub-frame time.
      lerpPose(this.poseA, inp.swordPrev, inp.swordCurr, fa);
      lerpPose(this.poseB, inp.swordPrev, inp.swordCurr, fb);
      const tipSpeed = dist(this.poseA.tip, this.poseB.tip) / Math.max(1e-6, (b - a) / 1000);
      if (tipSpeed > this.steadyLimit) this.lastFastT = b;
      classifyGuard(this.poseB, this.guardCfg, this.readB);
      let transT = NaN;
      if (this.readB.dir !== this.guard.dir) {
        transT = this.bisect(inp, fa, fb, this.guard.dir);
      } else {
        this.guard.angleErr = this.readB.angleErr;
      }

      // 3. Enemy strike instant inside this sub-step?
      const e = this.enemy;
      const eA = e.clock;
      const att = this.currentAttack;
      const sE = att && !e.struck ? e.attackStart + this.windup(att) : Infinity;
      this.advanceClock(a, b, eA, sE);
      let strikeT = this.advStrikeT;

      // 4. Process in time order.
      if (!Number.isNaN(transT) && !Number.isNaN(strikeT) && transT <= strikeT) {
        this.applyGuard(this.readB, transT);
        transT = NaN;
      }
      if (att && !Number.isNaN(strikeT)) {
        e.struck = true;
        this.onStrike(att, strikeT);
      }
      if (!Number.isNaN(transT)) this.applyGuard(this.readB, transT);

      // 5. Late-guard grace expired?
      if (this.pending && b >= this.pending.strikeT + this.grace) {
        const pd = this.pending;
        this.pending = null;
        this.takeHit(pd.att, pd.strikeT + this.grace, undefined, ['side']);
      }

      // Recomputed: a perfect parry in this sub-step may have started a hit-stop.
      this.advanceClock(a, b, eA, Infinity);
      e.clock = this.advE;
      this.advanceEnemy(b);
      if (this.player.dead || e.state === 'dead') break;
    }

    if (inp.strikeSpeed > 0 && !this.player.dead) this.onPlayerStrike(inp.t1, inp.strikeZone ?? 'center', !!inp.strikePoke);
    this.regen(span, inp.t1);
    this.time = inp.t1;
  }

  // ---------------------------------------------------------------- guard

  private bisect(inp: FrameInput, fa: number, fb: number, prevDir: GuardReading['dir']): number {
    let lo = fa;
    let hi = fb;
    for (let i = 0; i < BISECT_ITERS; i++) {
      const mid = (lo + hi) * 0.5;
      lerpPose(this.poseM, inp.swordPrev, inp.swordCurr, mid);
      classifyGuard(this.poseM, this.guardCfg, this.readM);
      if (this.readM.dir !== prevDir) hi = mid;
      else lo = mid;
    }
    return inp.t0 + (inp.t1 - inp.t0) * hi;
  }

  private applyGuard(r: GuardReading, t: number): void {
    this.guard.dir = r.dir;
    this.guard.angleErr = r.angleErr;
    if (r.dir === null) return;

    this.guardEntryT = t;
    const ent = this.entries;
    ent.push(t);
    while (ent.length && ent[0] < t - this.cfg.spamWindowMs) ent.shift();
    if (ent.length > this.cfg.spamMaxEntries && t >= this.player.lockoutUntil) {
      this.player.lockoutUntil = t + this.cfg.spamLockoutMs;
      this.emit({ type: 'lockout', t });
    }

    const pd = this.pending;
    if (pd && pd.att.dir === r.dir) {
      this.pending = null;
      this.judge(pd.att, pd.strikeT, t, r.angleErr, t);
    }
  }

  // ---------------------------------------------------------------- strikes on the player

  private onStrike(att: AttackDef, S: number): void {
    const p = this.player;
    if (S >= p.dodgeAt && S <= p.iframesUntil && dodgeBeats(p.dodgeKind, att)) {
      // A clean dodge of a must-dodge attack leaves him overextended: same counter window as a perfect.
      if (att.perilous !== 'none') p.counterUntil = S + this.cfg.counterWindowMs;
      this.emit({ type: 'dodged', t: S, attackId: att.id, dir: att.dir, perilous: att.perilous, dodge: p.dodgeKind ?? undefined });
      return;
    }
    if (att.perilous !== 'none') {
      this.takeHit(att, S);
      return;
    }
    if (this.guard.dir === att.dir) {
      this.judge(att, S, this.guardEntryT, this.guard.angleErr, S);
    } else {
      this.pending = { att, strikeT: S };
    }
  }

  /** Has the blade been held still for steadyMs up to time t? */
  steadyAt(t: number): boolean {
    return this.cfg.steadyMs <= 0 || t - this.lastFastT >= this.cfg.steadyMs;
  }

  /**
   * A parry is judged on three things: timing (guard entry vs the strike), angle (blade square
   * to the attack) and steadiness (guard held still, not swung into). All three -> perfect.
   * Otherwise a block if it's not too late and roughly square, else a hit. Faults say why.
   */
  private judge(att: AttackDef, S: number, entryT: number, angleErr: number, t: number): void {
    const c = this.cfg;
    const offset = entryT - S;
    const early = this.perfectEarlyMs();
    const faults: Fault[] = [];
    if (offset < -early) faults.push('early');
    if (offset > c.perfectLateMs) faults.push('late');
    if (angleErr > c.perfectAngleDeg + (this.twoHanded ? c.twoHandAngleBonusDeg : 0)) faults.push('angle');
    if (!this.steadyAt(t)) faults.push('shaky');
    if (entryT < this.player.lockoutUntil) faults.push('locked');

    if (faults.length === 0) {
      this.onPerfect(att, t, offset);
    } else if (offset <= c.blockLateMs && angleErr <= c.blockAngleDeg + (this.twoHanded ? c.twoHandAngleBonusDeg : 0)) {
      this.onBlock(att, t, offset, faults);
    } else {
      this.takeHit(att, t, offset, faults);
    }
  }

  private onPerfect(att: AttackDef, t: number, offset: number): void {
    const p = this.player;
    const e = this.enemy;
    const c = this.cfg;
    p.chain++;
    p.hitStreak = 0;
    const chainMult = CHAIN_MULT[Math.min(p.chain, CHAIN_MULT.length) - 1];
    e.posture += att.postureDamage * c.deflectEnemyPostureMult * this.mods.deflectPostureMult * chainMult;
    e.postureHitAt = t;
    p.posture = Math.min(c.playerPostureMax - 1, p.posture + c.deflectPlayerPosture);
    p.postureHitAt = t;
    p.hp = Math.min(p.hpMax, p.hp + this.mods.healOnPerfect);
    const breaks = e.posture >= e.def.postureMax;
    // A posture-breaking parry gets a heavier freeze. The counter window opens after it,
    // so the freeze never eats into the player's time to counter.
    const stop = breaks ? c.hitStopMs * 2 : c.hitStopMs;
    p.hitStopFrom = t;
    p.hitStopUntil = t + stop;
    p.counterUntil = t + stop + c.counterWindowMs;
    this.emit({ type: 'perfect', t, offsetMs: offset, attackId: att.id, dir: att.dir, chain: p.chain });
    if (breaks) this.breakEnemy(t);
  }

  private onBlock(att: AttackDef, t: number, offset: number, faults: Fault[]): void {
    const p = this.player;
    const e = this.enemy;
    const c = this.cfg;
    const dmg = att.damage * c.blockHpMult;
    p.chain = 0;
    p.hp -= dmg;
    p.posture += att.postureDamage * c.blockPlayerPostureMult * (this.twoHanded ? c.twoHandBlockPostureMult : 1);
    p.postureHitAt = t;
    e.posture += att.postureDamage * c.blockEnemyPostureMult;
    e.postureHitAt = t;
    this.emit({ type: 'block', t, offsetMs: offset, attackId: att.id, dir: att.dir, damage: dmg, faults });
    if (p.posture >= c.playerPostureMax) {
      const extra = att.damage * 0.5;
      p.hp -= extra;
      p.posture = c.playerPostureMax * 0.4;
      this.emit({ type: 'playerPostureBreak', t, damage: extra });
    }
    this.checkPlayerDead(t);
  }

  private takeHit(att: AttackDef, t: number, offset?: number, faults?: Fault[]): void {
    const p = this.player;
    if (p.wardCharges > 0) {
      p.wardCharges--;
      this.emit({ type: 'wardAbsorb', t, attackId: att.id });
      return;
    }
    p.hp -= att.damage;
    p.chain = 0;
    p.hitStreak++;
    this.emit({ type: 'hit', t, offsetMs: offset, attackId: att.id, dir: att.dir, perilous: att.perilous, damage: att.damage, faults });
    this.checkPlayerDead(t);
  }

  private checkPlayerDead(t: number): void {
    if (this.player.hp <= 0 && !this.player.dead) {
      this.player.hp = 0;
      this.player.dead = true;
      this.emit({ type: 'playerDead', t });
    }
  }

  // ---------------------------------------------------------------- dodge & abilities

  private onDodge(d: DodgeHit): void {
    const p = this.player;
    if (d.t < p.dodgeAt + this.cfg.dodgeCooldownMs) return;
    p.dodgeAt = d.t;
    p.dodgeKind = d.kind;
    p.iframesUntil = d.t + this.cfg.iframesMs + this.mods.iframesBonusMs;
    this.emit({ type: 'dodge', t: d.t, dodge: d.kind });
  }

  private useAbility(id: AbilityId, t: number): void {
    const p = this.player;
    if (!this.mods.abilities.includes(id) || t < p.abilityReadyAt[id]) return;
    p.abilityReadyAt[id] = t + ABILITY_COOLDOWN[id];
    if (id === 'slowTime') p.slowUntil = t + SLOW_DURATION_MS;
    if (id === 'ward') p.wardCharges = 1;
    this.emit({ type: 'abilityUsed', t, ability: id });
  }

  timeScale(t: number): number {
    if (t >= this.player.hitStopFrom && t < this.player.hitStopUntil) return 0;
    return t < this.player.slowUntil ? SLOW_SCALE : 1;
  }

  private advE = 0;
  private advStrikeT = NaN;

  /**
   * Advance the enemy clock across real time [a, b], skipping the hit-stop interval exactly
   * (so frame rate doesn't change when the next strike lands). Writes advE, and advStrikeT =
   * the real time the enemy clock reaches `sE`, or NaN. Slow-time is sampled at `a`.
   */
  private advanceClock(a: number, b: number, eA: number, sE: number): void {
    const s = a < this.player.slowUntil ? SLOW_SCALE : 1;
    const { hitStopFrom: f, hitStopUntil: u } = this.player;
    let e = eA;
    let strikeT = NaN;
    for (let i = 0; i < 2; i++) {
      // Live parts of [a, b]: before the freeze starts, then after it ends.
      const x = i === 0 ? a : Math.max(a, u);
      const y = i === 0 ? Math.min(b, f) : b;
      if (y <= x) continue;
      const e2 = e + (y - x) * s;
      if (Number.isNaN(strikeT) && sE <= e2) strikeT = x + Math.max(0, sE - e) / s;
      e = e2;
    }
    this.advE = e;
    this.advStrikeT = strikeT;
  }

  // ---------------------------------------------------------------- player offence

  private onPlayerStrike(t: number, zone: StrikeZone, poke: boolean): void {
    const e = this.enemy;
    const c = this.cfg;
    const p = this.player;
    const dmg = c.playerDamage * this.mods.playerDamageMult * (this.twoHanded ? c.twoHandDamageMult : 1);

    if (e.state === 'stagger') {
      e.hp -= c.finisherDamage;
      this.emit({ type: 'finisher', t, damage: c.finisherDamage });
      e.posture = 0;
      if (!this.checkEnemyDead(t)) this.toIdle(e.clock, 600);
      return;
    }
    if (t <= p.counterUntil) {
      const d = dmg * 1.5 * this.mods.counterDamageMult;
      e.hp -= d;
      e.posture += 10;
      e.postureHitAt = t;
      p.counterUntil = -Infinity;
      this.emit({ type: 'enemyHit', t, damage: d, zone, poke });
    } else if (e.state === 'attack') {
      e.hp -= dmg;
      this.emit({ type: 'enemyHit', t, damage: dmg, zone, poke });
    } else if (zone !== 'center' && zone !== e.guardSide) {
      // Through his opening. He covers that side at once, so the next one has to go elsewhere.
      e.hp -= dmg;
      this.shiftGuard(zone);
      this.emit({ type: 'enemyHit', t, damage: dmg, zone, poke, opening: true });
    } else {
      // Deflected. A poke into the guard still leans on his posture.
      e.posture += c.playerPostureDamageOnBlocked * (poke ? (this.twoHanded ? c.twoHandPokeMult : c.pokePostureMult) : 1);
      e.postureHitAt = t;
      this.emit({ type: 'enemyBlock', t, zone, poke });
    }
    if (!this.checkEnemyDead(t) && e.posture >= e.def.postureMax) this.breakEnemy(t);
  }

  private checkEnemyDead(t: number): boolean {
    const e = this.enemy;
    if (e.hp <= 0) {
      e.hp = 0;
      e.state = 'dead';
      this.pending = null;
      this.emit({ type: 'enemyDead', t });
      return true;
    }
    return false;
  }

  private breakEnemy(t: number): void {
    const e = this.enemy;
    e.state = 'stagger';
    e.combo = null;
    e.staggerUntil = e.clock + this.cfg.enemyStaggerMs;
    this.pending = null;
    this.emit({ type: 'enemyPostureBreak', t });
  }

  // ---------------------------------------------------------------- enemy timeline

  private startCombo(c: Combo, eStart: number, t: number): void {
    const e = this.enemy;
    e.combo = c;
    e.stepIndex = 0;
    this.startAttack(eStart, t);
  }

  private startAttack(eStart: number, t: number): void {
    const e = this.enemy;
    e.state = 'attack';
    e.attackStart = eStart;
    e.struck = false;
    e.windupScale = this.frenzy()?.windup ?? 1;
    const att = this.currentAttack!;
    this.emit({ type: 'attackStart', t, attackId: att.id, dir: att.dir, perilous: att.perilous });
  }

  private toIdle(eFrom: number, delay: number): void {
    const e = this.enemy;
    e.state = 'idle';
    e.combo = null;
    e.nextActionAt = eFrom + delay;
  }

  private advanceEnemy(t: number): void {
    const e = this.enemy;
    const spd = e.def.speed;
    switch (e.state) {
      case 'idle':
        if (e.clock >= e.guardShiftAt) this.shiftGuard(e.guardSide === 'left' ? 'right' : 'left');
        if (this.ai && e.clock >= e.nextActionAt) {
          const tw = this.frenzy()?.tripleWeight ?? 1;
          const pool = tw === 1 ? e.def.combos : e.def.combos.map((c) => ({ ...c, weight: c.steps.length === 3 ? c.weight * tw : c.weight }));
          this.startCombo(this.rng.pickWeighted(pool), e.nextActionAt, t);
        }
        break;
      case 'attack': {
        if (!e.struck || !e.combo) break;
        const st = e.combo.steps[e.stepIndex];
        const strikeE = e.attackStart + this.windup(st.attack);
        if (e.stepIndex < e.combo.steps.length - 1) {
          const next = strikeE + st.chainDelayMs / spd;
          if (e.clock >= next) {
            e.stepIndex++;
            this.startAttack(next, t);
          }
        } else {
          const end = strikeE + st.attack.recoverMs / spd;
          if (e.clock >= end) {
            this.toIdle(end, (this.rng.range(e.def.idleMinMs, e.def.idleMaxMs) / spd) * (this.frenzy()?.idle ?? 1));
          }
        }
        break;
      }
      case 'stagger':
        if (e.clock >= e.staggerUntil) {
          e.posture = e.def.postureMax * 0.5;
          this.toIdle(e.clock, 300);
        }
        break;
      case 'dead':
        break;
    }
  }

  private regen(spanMs: number, t: number): void {
    const c = this.cfg;
    const dt = spanMs / 1000;
    const p = this.player;
    if (t - p.postureHitAt > c.postureRegenDelayMs) {
      p.posture = Math.max(0, p.posture - c.postureRegenPerSec * dt);
    }
    const e = this.enemy;
    if (e.state !== 'stagger' && t - e.postureHitAt > c.postureRegenDelayMs) {
      // Like Sekiro: a wounded enemy recovers posture more slowly.
      const hpFrac = e.hp / e.def.hp;
      e.posture = Math.max(0, e.posture - c.enemyPostureRegenPerSec * (0.3 + 0.7 * hpFrac) * dt);
    }
  }

  private emit(ev: DuelEvent): void {
    this.events.push(ev);
  }
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dodgeBeats(kind: DodgeKind | null, att: AttackDef): boolean {
  if (!kind) return false;
  if (att.perilous === 'thrust') return kind === 'leanLeft' || kind === 'leanRight';
  if (att.perilous === 'sweep') return kind === 'duck';
  return true;
}
