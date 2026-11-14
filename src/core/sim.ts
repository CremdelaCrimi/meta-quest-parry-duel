import { DodgeDetector } from './dodge';
import type { DodgeHit } from './dodge';
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
  FrameInput,
  GuardConfig,
  Modifiers,
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
    abilityReadyAt: { slowTime: 0, ward: 0 } as Record<AbilityId, number>,
    dead: false,
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
  };

  readonly guard: GuardReading = { dir: null, angleErr: 90 };
  guardEntryT = -Infinity;
  time: number;

  private pending: { att: AttackDef; strikeT: number } | null = null;
  private entries: number[] = [];
  private readonly rng: Rng;
  private readonly ai: boolean;
  private readonly dodge = new DodgeDetector();

  // Scratch objects so step() doesn't allocate.
  private readonly poseB: SwordPose = makePose();
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
  }

  get grace(): number {
    return Math.max(this.cfg.perfectLateMs, this.cfg.blockLateMs);
  }

  get currentAttack(): AttackDef | null {
    const e = this.enemy;
    return e.state === 'attack' && e.combo ? e.combo.steps[e.stepIndex].attack : null;
  }

  /** Scaled windup of an attack in enemy-clock ms. */
  windup(att: AttackDef): number {
    return att.windupMs / this.enemy.def.speed;
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
      lerpPose(this.poseB, inp.swordPrev, inp.swordCurr, fb);
      classifyGuard(this.poseB, this.guardCfg, this.readB);
      let transT = NaN;
      if (this.readB.dir !== this.guard.dir) {
        transT = this.bisect(inp, fa, fb, this.guard.dir);
      } else {
        this.guard.angleErr = this.readB.angleErr;
      }

      // 3. Enemy strike instant inside this sub-step?
      const scale = this.timeScale(a);
      const e = this.enemy;
      const eA = e.clock;
      const eB = eA + (b - a) * scale;
      let strikeT = NaN;
      const att = this.currentAttack;
      if (att && !e.struck) {
        const sE = e.attackStart + this.windup(att);
        if (sE <= eB) strikeT = a + Math.max(0, sE - eA) / scale;
      }

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
        this.takeHit(pd.att, pd.strikeT + this.grace);
      }

      e.clock = eB;
      this.advanceEnemy(b);
      if (this.player.dead || e.state === 'dead') break;
    }

    if (inp.strikeSpeed > 0 && !this.player.dead) this.onPlayerStrike(inp.t1);
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

  private judge(att: AttackDef, S: number, entryT: number, angleErr: number, t: number): void {
    const c = this.cfg;
    const offset = entryT - S;
    const early = c.perfectEarlyMs + this.mods.perfectWindowBonusMs;
    const locked = entryT < this.player.lockoutUntil;
    if (!locked && offset >= -early && offset <= c.perfectLateMs && angleErr <= c.perfectAngleDeg) {
      this.onPerfect(att, t, offset);
    } else if (offset <= c.blockLateMs && angleErr <= c.blockAngleDeg) {
      this.onBlock(att, t, offset);
    } else {
      this.takeHit(att, t, offset);
    }
  }

  private onPerfect(att: AttackDef, t: number, offset: number): void {
    const p = this.player;
    const e = this.enemy;
    const c = this.cfg;
    e.posture += att.postureDamage * c.deflectEnemyPostureMult * this.mods.deflectPostureMult;
    e.postureHitAt = t;
    p.posture = Math.min(c.playerPostureMax - 1, p.posture + c.deflectPlayerPosture);
    p.postureHitAt = t;
    p.hp = Math.min(p.hpMax, p.hp + this.mods.healOnPerfect);
    p.counterUntil = t + c.counterWindowMs;
    this.emit({ type: 'perfect', t, offsetMs: offset, attackId: att.id, dir: att.dir });
    if (e.posture >= e.def.postureMax) this.breakEnemy(t);
  }

  private onBlock(att: AttackDef, t: number, offset: number): void {
    const p = this.player;
    const e = this.enemy;
    const c = this.cfg;
    const dmg = att.damage * c.blockHpMult;
    p.hp -= dmg;
    p.posture += att.postureDamage * c.blockPlayerPostureMult;
    p.postureHitAt = t;
    e.posture += att.postureDamage * c.blockEnemyPostureMult;
    e.postureHitAt = t;
    this.emit({ type: 'block', t, offsetMs: offset, attackId: att.id, dir: att.dir, damage: dmg });
    if (p.posture >= c.playerPostureMax) {
      const extra = att.damage * 0.5;
      p.hp -= extra;
      p.posture = c.playerPostureMax * 0.4;
      this.emit({ type: 'playerPostureBreak', t, damage: extra });
    }
    this.checkPlayerDead(t);
  }

  private takeHit(att: AttackDef, t: number, offset?: number): void {
    const p = this.player;
    if (p.wardCharges > 0) {
      p.wardCharges--;
      this.emit({ type: 'wardAbsorb', t, attackId: att.id });
      return;
    }
    p.hp -= att.damage;
    this.emit({ type: 'hit', t, offsetMs: offset, attackId: att.id, dir: att.dir, perilous: att.perilous, damage: att.damage });
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
    return t < this.player.slowUntil ? SLOW_SCALE : 1;
  }

  // ---------------------------------------------------------------- player offence

  private onPlayerStrike(t: number): void {
    const e = this.enemy;
    const c = this.cfg;
    const p = this.player;
    const dmg = c.playerDamage * this.mods.playerDamageMult;

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
      this.emit({ type: 'enemyHit', t, damage: d });
    } else if (e.state === 'attack') {
      e.hp -= dmg;
      this.emit({ type: 'enemyHit', t, damage: dmg });
    } else {
      e.posture += c.playerPostureDamageOnBlocked;
      e.postureHitAt = t;
      this.emit({ type: 'enemyBlock', t });
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
        if (this.ai && e.clock >= e.nextActionAt) {
          this.startCombo(this.rng.pickWeighted(e.def.combos), e.nextActionAt, t);
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
            this.toIdle(end, this.rng.range(e.def.idleMinMs, e.def.idleMaxMs) / spd);
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

function dodgeBeats(kind: DodgeKind | null, att: AttackDef): boolean {
  if (!kind) return false;
  if (att.perilous === 'thrust') return kind === 'leanLeft' || kind === 'leanRight';
  if (att.perilous === 'sweep') return kind === 'duck';
  return true;
}
