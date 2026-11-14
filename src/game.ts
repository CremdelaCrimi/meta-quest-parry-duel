import * as THREE from 'three';
import type { Sfx } from './audio/sfx';
import { DEFAULT_GUARD, PRESETS } from './core/config';
import { makePose } from './core/guard';
import { Run } from './core/roguelite';
import type { Pickup } from './core/roguelite';
import { Duel } from './core/sim';
import type { AbilityId, AttackDef, DuelEvent, Fault, SwordPose, TimingConfig, V3 } from './core/types';
import { DuelSpace } from './render/duelSpace';
import { CanvasPanel, bar, roundRect } from './render/panels';
import { EnemyView, Sparks, SwordView } from './render/views';
import type { InputDevice } from './xr/input';

type Phase = 'calibrate' | 'fight' | 'won' | 'reward' | 'dead';

interface Attempt {
  offset: number;
  type: 'perfect' | 'block' | 'hit';
  faults: Fault[];
}

const COLORS = { perfect: '#ffd34d', block: '#6fb6ff', angle: '#b48cff', shaky: '#ff9a3c', hit: '#ff5050', info: '#e8e8e8' };

/** Legend order and labels for the timing chart. */
const LEGEND: Array<[keyof typeof COLORS, string]> = [
  ['perfect', 'Perfect'],
  ['block', 'Block: timing'],
  ['angle', 'Block: angle'],
  ['shaky', 'Block: not held'],
  ['hit', 'Hit'],
];

/** Colour for an outcome: a block is coloured by its main fault (steadiness, then angle, then timing). */
function outcomeColor(type: Attempt['type'], faults: Fault[] = []): keyof typeof COLORS {
  if (type !== 'block') return type;
  if (faults.includes('shaky') || faults.includes('locked')) return 'shaky';
  if (faults.includes('angle')) return 'angle';
  return 'block';
}

const FAULT_TEXT: Record<Fault, string> = {
  early: 'early',
  late: 'late',
  angle: 'angle',
  shaky: 'not held',
  locked: 'flailing',
  side: 'wrong side',
};
const hexOf = (k: keyof typeof COLORS) => parseInt(COLORS[k].slice(1), 16);

/** Minimum blade-tip speed (m/s) for contact with the enemy to count as a strike. */
const STRIKE_MIN_SPEED = 1.8;
const STRIKE_COOLDOWN_MS = 350;

export class Game {
  phase: Phase = 'calibrate';
  run = new Run(1);
  duel!: Duel;
  readonly timing: TimingConfig = { ...PRESETS[0] };
  presetIdx = 0;

  readonly enemyView = new EnemyView();
  readonly sparks = new Sparks();
  private readonly hud = new CanvasPanel(1024, 720, 0.75);
  private readonly banner = new CanvasPanel(1024, 256, 1.1);
  /** How to play: shown before the run and through the Trainer fight. */
  private readonly help = new CanvasPanel(1024, 880, 0.8);
  private helpXR = false;
  /** Your HP/posture and the enemy's, low and centred so it's always in view. */
  private readonly status = new CanvasPanel(1024, 200, 0.7);
  /** Names the incoming swing and how to block it, above the enemy. */
  private readonly callout = new CanvasPanel(1024, 170, 0.75);
  private calloutKey = '';
  private statusAt = 0;
  /** Red flash around the head when you take a hit. */
  private readonly hurt = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }),
  );
  private hurtT = 0;
  private readonly cards = [0, 1, 2].map(() => new CanvasPanel(512, 640, 0.3));
  private offers: Pickup[] = [];
  private hover = -1;
  private hudOn = true;

  private phaseT = 0;
  private lastT = NaN;
  private hudAt = 0;
  private resetPrev = true;
  private strikeReadyAt = 0;
  private lastResult = { text: '', color: COLORS.info, t: -1e9 };
  private readonly attempts: Attempt[] = [];
  private readonly frameMs: number[] = [];
  private dropped = 0;

  private readonly swordPrev: SwordPose = makePose();
  private readonly swordCurr: SwordPose = makePose();
  private readonly headPrev: V3 = { x: 0, y: 0, z: 0 };
  private readonly headCurr: V3 = { x: 0, y: 0, z: 0 };
  private readonly prevTip = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpV3: V3 = { x: 0, y: 0, z: 0 };

  constructor(
    scene: THREE.Scene,
    public input: InputDevice,
    private readonly sfx: Sfx,
    readonly sword: SwordView,
    private readonly targetHz: () => number,
    readonly space: DuelSpace,
    public isXR = false,
  ) {
    // Until calibrated, face the default forward (-z) at standing height.
    this.space.group.position.set(0, 1.6, 0);
    this.space.group.rotation.y = Math.PI;
    this.space.group.updateMatrixWorld(true);

    scene.add(this.space.group, this.sparks.points, this.hurt);
    this.hurt.renderOrder = 20;
    this.space.group.add(this.enemyView.root, this.hud.mesh, this.banner.mesh, this.help.mesh, this.status.mesh, this.callout.mesh);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this; // console tuning
    // The simple built-in swordsman is the default; ?enemy=rigged loads the Tripo/Mixamo model from public/enemy/.
    const q = new URLSearchParams(location.search);
    if (q.get('enemy') === 'rigged') void this.enemyView.useRigged('./enemy/enemy.json');
    this.enemyView.guides = q.get('guides') !== '0';
    for (const c of this.cards) this.space.group.add(c.mesh);

    place(this.hud.mesh, { x: -1.0, y: -0.25, z: 1.25 });
    place(this.banner.mesh, { x: 0, y: 0.5, z: 1.4 });
    place(this.help.mesh, { x: 1.1, y: 0.0, z: 1.1 });
    place(this.status.mesh, { x: 0, y: -0.68, z: 1.2 });
    place(this.callout.mesh, { x: 0, y: 0.68, z: 1.6 });
    this.callout.mesh.visible = false;
    this.drawHelp();
    this.cards.forEach((c, i) => place(c.mesh, { x: (i - 1) * 0.36, y: -0.35, z: 0.75 }));

    // ?preset=1 (Lies of P-like), ?preset=2 (Easy). Startup only, so P still cycles through all.
    const preset = Number(new URLSearchParams(location.search).get('preset'));
    if (Number.isInteger(preset) && preset > 0 && preset < PRESETS.length) {
      this.presetIdx = preset;
      Object.assign(this.timing, PRESETS[preset]);
    }
    this.applyUrlOverrides();
    this.newDuel(0);
    this.setPhase('calibrate', 0);
  }

  // ---------------------------------------------------------------- frame

  frame(tIn: number, xrFrame?: XRFrame): void {
    const t = Number.isNaN(this.lastT) ? tIn : Math.max(tIn, this.lastT + 0.1);
    const dt = Number.isNaN(this.lastT) ? 1000 / this.targetHz() : Math.min(100, t - this.lastT);
    this.lastT = t;
    this.trackFrame(dt);

    this.input.poll(xrFrame);
    const f = this.input.frame;

    if (f.btnB && this.phase !== 'calibrate') {
      this.space.calibrate(f.headPos, f.headQuat);
      this.flashResult('Recalibrated', COLORS.info, t);
    }
    if (f.btnY) this.cyclePreset(t);
    if (f.btnA) {
      this.hudOn = !this.hudOn;
      this.hud.mesh.visible = this.hudOn;
    }
    if (this.helpXR !== this.isXR) {
      // Entered or left the headset: controller wording vs mouse/keyboard wording.
      this.helpXR = this.isXR;
      this.drawHelp();
      if (this.phase === 'calibrate') this.setPhase('calibrate', t);
    }
    // How-to-play stays up before the run and through the Trainer; A hides it with the stats.
    this.help.mesh.visible = this.hudOn && (this.phase === 'calibrate' || this.run.fight === 0);

    switch (this.phase) {
      case 'calibrate':
        if (f.rightTrigger) {
          this.sfx.play('ui');
          this.space.calibrate(f.headPos, f.headQuat);
          this.startRun(t);
        }
        break;
      case 'fight':
      case 'won':
        this.stepDuel(t, dt);
        if (this.phase === 'won' && t - this.phaseT > 1800) this.showReward(t);
        break;
      case 'reward':
        this.updateReward(t);
        break;
      case 'dead':
        this.stepDuel(t, dt);
        if (t - this.phaseT > 1200 && f.rightTrigger) this.startRun(t);
        break;
    }

    this.enemyView.update(this.duel, this.space, dt, this.headCurr);
    this.sword.update(dt);
    this.sparks.update(dt);
    this.updateCallout();
    this.hurtT = Math.max(0, this.hurtT - dt / 450);
    this.hurt.position.copy(f.headPos);
    (this.hurt.material as THREE.MeshBasicMaterial).opacity = 0.3 * this.hurtT;
    this.hurt.visible = this.hurtT > 0;
    this.status.mesh.visible = this.phase !== 'calibrate';
    if (this.status.mesh.visible && t >= this.statusAt) {
      this.drawStatus();
      this.statusAt = t + 100;
    }
    if (this.hudOn && t >= this.hudAt) {
      this.drawHud(t);
      this.hudAt = t + 100; // 10 Hz: texture uploads are not free on Quest
    }
    this.prevTip.copy(f.tip);
  }

  private stepDuel(t: number, dt: number): void {
    const f = this.input.frame;
    this.space.follow(f.headPos, dt);
    this.space.toDuel(f.headPos, this.headCurr);

    if (f.hasSword) {
      // Guards are measured relative to the current head position (x/z) and the calibrated height (y).
      const s = this.swordCurr;
      this.space.toDuel(f.hilt, s.hilt);
      this.space.toDuel(f.tip, s.tip);
      s.hilt.x -= this.headCurr.x;
      s.tip.x -= this.headCurr.x;
      s.hilt.z -= this.headCurr.z;
      s.tip.z -= this.headCurr.z;
    }
    if (this.resetPrev) {
      copyPose(this.swordPrev, this.swordCurr);
      Object.assign(this.headPrev, this.headCurr);
      this.prevTip.copy(f.tip);
      this.resetPrev = false;
    }

    let strikeSpeed = 0;
    if (f.hasSword && t >= this.strikeReadyAt && this.duel.enemy.state !== 'dead') {
      const speed = this.prevTip.distanceTo(f.tip) / Math.max(1e-3, dt / 1000);
      const contact = this.enemyView.bodyHit(f.hilt, f.tip, this.space) || this.enemyView.bodyHit(this.prevTip, f.tip, this.space);
      if (contact && (speed > STRIKE_MIN_SPEED || (!this.isXR && f.rightTrigger))) strikeSpeed = Math.max(speed, 2);
    }
    if (!this.isXR && f.rightTrigger && this.phase === 'fight') strikeSpeed = 3; // desktop: click = strike
    if (strikeSpeed > 0) this.strikeReadyAt = t + STRIKE_COOLDOWN_MS;

    let ability: AbilityId | null = null;
    if (f.leftTrigger) ability = 'slowTime';
    else if (f.leftGrip) ability = 'ward';

    this.duel.step({
      t0: this.duel.time,
      t1: t,
      swordPrev: this.swordPrev,
      swordCurr: this.swordCurr,
      headPrev: this.headPrev,
      headCurr: this.headCurr,
      strikeSpeed,
      ability,
    });
    for (const ev of this.duel.events) this.onEvent(ev, t);

    copyPose(this.swordPrev, this.swordCurr);
    Object.assign(this.headPrev, this.headCurr);
  }

  // ---------------------------------------------------------------- events → feedback

  private onEvent(ev: DuelEvent, t: number): void {
    const f = this.input.frame;
    const contact = this.tmp.copy(f.hilt).lerp(f.tip, 0.6);
    switch (ev.type) {
      case 'perfect':
        this.sfx.play('perfect');
        this.input.pulse('right', 1, 50);
        this.sparks.burst(contact, 0xffd060, 28, 2.5);
        this.sword.flash(0xffc040);
        this.record(ev.offsetMs!, 'perfect', []);
        this.flashResult(`PERFECT  ${fmt(ev.offsetMs!)}`, COLORS.perfect, t);
        break;
      case 'block': {
        const col = outcomeColor('block', ev.faults);
        this.sfx.play('block');
        this.input.pulse('right', 0.5, 35);
        this.sparks.burst(contact, hexOf(col), 10, 1.4);
        this.sword.flash(hexOf(col));
        this.record(ev.offsetMs!, 'block', ev.faults ?? []);
        this.flashResult(`BLOCK: ${faultText(ev.faults)}  ${fmt(ev.offsetMs!)}`, COLORS[col], t);
        break;
      }
      case 'hit': {
        this.sfx.play('hit');
        this.hurtT = 1;
        this.statusAt = 0;
        this.input.pulse('right', 1, 120);
        this.input.pulse('left', 1, 120);
        this.record(ev.offsetMs ?? 0, 'hit', ev.faults ?? []);
        const why =
          ev.perilous === 'thrust'
            ? ' (thrust: lean!)'
            : ev.perilous === 'sweep'
              ? ' (sweep: duck!)'
              : ev.faults?.includes('side')
                ? ` (guard ${ev.dir})`
                : `: ${faultText(ev.faults)}  ${ev.offsetMs !== undefined ? fmt(ev.offsetMs) : ''}`;
        this.flashResult(`HIT${why}`, COLORS.hit, t);
        break;
      }
      case 'dodged':
        this.sfx.play('dodge');
        this.flashResult('DODGED', COLORS.perfect, t);
        break;
      case 'dodge':
        this.sfx.play('dodge', 0.35);
        break;
      case 'attackStart':
        if (ev.perilous && ev.perilous !== 'none') this.sfx.play('peril');
        break;
      case 'lockout':
        this.flashResult('Flailing: perfect parry locked', COLORS.hit, t);
        break;
      case 'playerPostureBreak':
        this.flashResult('GUARD BROKEN', COLORS.hit, t);
        this.input.pulse('right', 1, 200);
        break;
      case 'enemyHit':
        this.sfx.play('strike');
        this.enemyView.hit();
        this.input.pulse('right', 0.6, 30);
        this.sparks.burst(contact, 0xff6040, 8, 1.2);
        break;
      case 'enemyBlock':
        this.sfx.play('block', 0.5);
        this.input.pulse('right', 0.35, 25);
        this.sparks.burst(contact, 0xffffff, 6, 1);
        break;
      case 'enemyPostureBreak':
        this.sfx.play('peril');
        this.flashResult('POSTURE BROKEN: STRIKE!', COLORS.perfect, t);
        break;
      case 'finisher':
        this.sfx.play('finisher');
        this.input.pulse('right', 1, 220);
        this.sparks.burst(contact, 0xff2020, 40, 3);
        break;
      case 'enemyDead':
        this.setPhase('won', t);
        this.showBanner('VICTORY', COLORS.perfect, `${this.duel.enemy.def.name} defeated`);
        break;
      case 'playerDead':
        this.setPhase('dead', t);
        this.showBanner('DEATH', COLORS.hit, `Reached fight ${this.run.fight + 1}. Trigger for a new run`);
        break;
      case 'abilityUsed':
        this.sfx.play('ui');
        this.flashResult(ev.ability === 'slowTime' ? 'TIME SIGIL' : 'WARD UP', COLORS.block, t);
        break;
      case 'wardAbsorb':
        this.sfx.play('block');
        this.flashResult('WARD ABSORBED', COLORS.block, t);
        break;
    }
  }

  // ---------------------------------------------------------------- run flow

  private startRun(t: number): void {
    this.run = new Run((Date.now() ^ Math.floor(t)) >>> 0);
    this.newDuel(t);
    this.setPhase('fight', t);
  }

  private newDuel(t: number): void {
    this.duel = new Duel({
      timing: this.timing,
      guard: DEFAULT_GUARD,
      enemy: this.run.enemyForFight(),
      mods: this.run.mods,
      seed: (this.run.seed + this.run.fight * 7919) >>> 0,
      startT: t,
      playerHp: this.run.playerHp,
    });
    this.enemyView.reset();
    this.resetPrev = true;
  }

  private showReward(t: number): void {
    this.offers = this.run.offer(3);
    this.hover = -1;
    this.setPhase('reward', t);
    this.showBanner('CHOOSE A BOON', COLORS.perfect, this.isXR ? 'Touch a card with your blade, pull trigger' : 'Press 1, 2 or 3');
    this.drawCards();
  }

  private updateReward(t: number): void {
    const f = this.input.frame;
    // Hover: nearest card to the blade tip.
    this.space.toDuel(f.tip, this.tmpV3);
    let best = -1;
    let bestD = 0.22;
    this.cards.forEach((c, i) => {
      const p = c.mesh.position;
      const d = Math.hypot(-p.x - this.tmpV3.x, p.y - this.tmpV3.y, p.z - this.tmpV3.z);
      if (d < bestD && i < this.offers.length) {
        bestD = d;
        best = i;
      }
    });
    if (best !== this.hover) {
      this.hover = best;
      if (best >= 0) this.input.pulse('right', 0.2, 15);
      this.drawCards();
    }
    const pick = f.choose >= 0 ? f.choose : f.rightTrigger ? this.hover : -1;
    if (pick >= 0 && pick < this.offers.length) {
      this.sfx.play('ui');
      this.run.choose(this.offers[pick]);
      this.run.advance(this.duel.player.hp);
      for (const c of this.cards) c.mesh.visible = false;
      this.newDuel(t);
      this.setPhase('fight', t);
    }
  }

  private setPhase(p: Phase, t: number): void {
    this.phase = p;
    this.phaseT = t;
    if (p === 'fight') this.banner.mesh.visible = false;
    if (p !== 'reward') for (const c of this.cards) c.mesh.visible = false;
    if (p === 'calibrate') {
      this.showBanner(
        'PARRY DUEL',
        COLORS.info,
        this.isXR ? 'Read the panel on the right, face forward, pull RIGHT TRIGGER' : 'Read the panel on the right, then click to begin',
      );
    }
  }

  private cyclePreset(t: number): void {
    this.presetIdx = (this.presetIdx + 1) % PRESETS.length;
    Object.assign(this.timing, PRESETS[this.presetIdx]);
    this.applyUrlOverrides();
    this.flashResult(`Preset: ${this.timing.name}`, COLORS.info, t);
  }

  /** Any TimingConfig number can be overridden from the URL, e.g. ?perfectEarlyMs=150&iframesMs=400 */
  private applyUrlOverrides(): void {
    const q = new URLSearchParams(location.search);
    const tm = this.timing as unknown as Record<string, unknown>;
    for (const [k, v] of q) {
      if (typeof tm[k] === 'number' && Number.isFinite(Number(v))) tm[k] = Number(v);
    }  }

  // ---------------------------------------------------------------- HUD

  private record(offset: number, type: Attempt['type'], faults: Fault[]): void {
    this.attempts.push({ offset, type, faults });
    if (this.attempts.length > 30) this.attempts.shift();
  }

  private flashResult(text: string, color: string, t: number): void {
    this.lastResult = { text, color, t };
    this.hudAt = 0; // redraw now
  }

  private trackFrame(dt: number): void {
    this.frameMs.push(dt);
    if (this.frameMs.length > 90) this.frameMs.shift();
    if (dt > 1.5 * (1000 / this.targetHz())) this.dropped++;
  }

  private drawHud(t: number): void {
    const d = this.duel;
    const c = this.timing;
    this.hud.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.72)';
      roundRect(ctx, 0, 0, w, h, 28);
      ctx.fill();
      ctx.font = '600 34px system-ui, sans-serif';
      ctx.fillStyle = '#cfd4dc';
      ctx.fillText(`Fight ${this.run.fight + 1} · ${d.enemy.def.name} · ${c.name}`, 32, 56);

      ctx.font = '500 26px system-ui, sans-serif';
      ctx.fillText('HP', 32, 108);
      bar(ctx, 110, 88, 380, 24, d.player.hp / d.player.hpMax, '#d04040');
      ctx.fillText('Posture', 520, 108);
      bar(ctx, 640, 88, 340, 24, d.player.posture / c.playerPostureMax, '#ffb020');

      // Last result, fading over 1.5 s.
      const age = t - this.lastResult.t;
      if (age < 1500) {
        ctx.globalAlpha = 1 - Math.max(0, age - 900) / 600;
        ctx.font = '800 64px system-ui, sans-serif';
        ctx.fillStyle = this.lastResult.color;
        ctx.fillText(this.lastResult.text, 32, 200);
        ctx.globalAlpha = 1;
      }

      // Parry timing strip: where your guard landed relative to the strike (0).
      const x0 = 40;
      const x1 = w - 40;
      const lo = -300;
      const hi = 120;
      const X = (ms: number) => x0 + ((ms - lo) / (hi - lo)) * (x1 - x0);
      const y = 300;
      const early = c.perfectEarlyMs + d.mods.perfectWindowBonusMs;
      ctx.fillStyle = 'rgba(111,182,255,0.18)';
      ctx.fillRect(X(lo), y - 34, X(c.blockLateMs) - X(lo), 68);
      ctx.fillStyle = 'rgba(255,211,77,0.35)';
      ctx.fillRect(X(-early), y - 34, X(c.perfectLateMs) - X(-early), 68);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(X(0) - 1.5, y - 44, 3, 88);
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillStyle = '#9aa3b0';
      ctx.fillText('← early', x0, y + 64);
      ctx.fillText('strike', X(0) - 30, y + 64);
      ctx.fillText('late →', x1 - 64, y + 64);
      // Wrong-side hits have no timing: they sit in a column at the far right.
      this.attempts.forEach((a, i) => {
        const age2 = this.attempts.length - 1 - i;
        ctx.globalAlpha = Math.max(0.2, 1 - age2 / 30);
        ctx.fillStyle = COLORS[outcomeColor(a.type, a.faults)];
        const px = a.faults.includes('side') ? x1 - 8 : X(Math.max(lo, Math.min(hi, a.offset)));
        ctx.beginPath();
        ctx.arc(px, y + ((i % 5) - 2) * 11, age2 === 0 ? 11 : 7, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Legend: what each colour means. Bands: gold = perfect window, blue = block window.
      ctx.font = '21px system-ui, sans-serif';
      let lx = 32;
      for (const [key, label] of LEGEND) {
        ctx.fillStyle = COLORS[key];
        ctx.beginPath();
        ctx.arc(lx + 9, 398, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#cfd4dc';
        ctx.fillText(label, lx + 24, 405);
        lx += 24 + ctx.measureText(label).width + 28;
      }

      // Breakdown: why guards weren't perfect, over the recent attempts.
      ctx.font = '500 25px system-ui, sans-serif';
      ctx.fillStyle = '#cfd4dc';
      const timed = this.attempts.filter((a) => !a.faults.includes('side'));
      const perfect = this.attempts.filter((a) => a.type === 'perfect').length;
      const mean = timed.length ? timed.reduce((s, a) => s + a.offset, 0) / timed.length : 0;
      ctx.fillText(`Perfect ${perfect}/${this.attempts.length}${timed.length ? ` · avg timing ${fmt(mean)}` : ''}`, 32, 450);
      const count = (...f: Fault[]) => this.attempts.filter((a) => a.type !== 'perfect' && a.faults.some((x) => f.includes(x))).length;
      const parts: Array<[string, number]> = [
        ['timing', count('early', 'late')],
        ['angle', count('angle')],
        ['not held', count('shaky', 'locked')],
        ['wrong side', count('side')],
      ];
      ctx.fillStyle = '#9aa3b0';
      ctx.fillText(`Not perfect because: ${parts.map(([k, n]) => `${k} ${n}`).join(' · ')}`, 32, 488);

      // Performance.
      const fm = this.frameMs;
      const avg = fm.reduce((s, v) => s + v, 0) / Math.max(1, fm.length);
      const max = Math.max(...fm);
      ctx.font = '21px system-ui, sans-serif';
      ctx.fillStyle = max > 1.5 * (1000 / this.targetHz()) ? '#ff8080' : '#8fd48f';
      ctx.fillText(
        `${(1000 / avg).toFixed(0)} fps (target ${this.targetHz()}) · ${avg.toFixed(1)} ms avg · ${max.toFixed(1)} max · dropped ${this.dropped} · audio ${this.sfx.latencyMs().toFixed(0)} ms`,
        32,
        535,
      );

      // Build and abilities.
      ctx.font = '500 25px system-ui, sans-serif';
      ctx.fillStyle = '#cfd4dc';
      const owned = Object.entries(this.run.stacks).map(([id, n]) => (n > 1 ? `${id}×${n}` : id));
      ctx.fillText(`Boons: ${owned.length ? owned.join(', ') : 'none yet'}`, 32, 585);
      const ab = d.mods.abilities.map((a) => {
        const left = Math.max(0, d.player.abilityReadyAt[a] - t) / 1000;
        return `${a === 'slowTime' ? 'L-trigger Time' : 'L-grip Ward'}: ${left > 0 ? left.toFixed(0) + 's' : 'ready'}`;
      });
      if (ab.length) ctx.fillText(ab.join('   '), 32, 625);
      ctx.fillStyle = '#7c8594';
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillText(this.isXR ? 'A: hide panel · B: recalibrate · Y: switch timing preset' : 'H: hide panel · R: recalibrate · P: switch timing preset', 32, 680);
    });
  }

  /** Big, plain-language controls card. The sword does everything; buttons are only for menus. */
  private drawHelp(): void {
    const xr = this.isXR;
    this.help.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.85)';
      roundRect(ctx, 0, 0, w, h, 28);
      ctx.fill();
      let y = 70;
      const line = (text: string, font: string, color: string, gap: number) => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.fillText(text, 40, y);
        y += gap;
      };
      line('HOW TO PLAY', '800 54px system-ui, sans-serif', '#ffffff', 52);
      line(xr ? 'No button to block or attack. Your sword does it.' : 'Your mouse is the sword. Nothing to press to block.', '500 30px system-ui, sans-serif', '#9aa3b0', 70);

      line('BLOCK: put your sword in the glowing box', '700 36px system-ui, sans-serif', COLORS.block, 46);
      line('A ghost sword shows where. Get there when the box turns', '500 29px system-ui, sans-serif', '#d8dce4', 38);
      line('GOLD, then hold still until the swing lands.', '500 29px system-ui, sans-serif', COLORS.perfect, 50);
      line('↓  Vertical chop: sword flat above your head', '500 29px system-ui, sans-serif', '#d8dce4', 40);
      line('→ ←  Horizontal: sword upright on that side', '500 29px system-ui, sans-serif', '#d8dce4', 40);
      line('↘ ↙  Diagonal: sword upright on that side', '500 29px system-ui, sans-serif', '#d8dce4', 66);

      line(xr ? 'ATTACK: swing your sword into his body' : 'ATTACK: click while he is open', '700 36px system-ui, sans-serif', '#ff8a5a', 44);
      line('Hits hardest right after a perfect (gold) block.', '500 29px system-ui, sans-serif', '#d8dce4', 66);

      line('HEALTH: the bars under the enemy', '700 36px system-ui, sans-serif', COLORS.hit, 44);
      line('Red = your HP. Orange = posture (fills when you block;', '500 29px system-ui, sans-serif', '#d8dce4', 38);
      line('full = guard broken). The screen flashes red when hit.', '500 29px system-ui, sans-serif', '#d8dce4', 66);

      line('DODGE: not needed yet (lean or duck, later)', '600 30px system-ui, sans-serif', '#9aa3b0', 60);
      line(
        xr ? 'Buttons: R trigger start · A hide panels · B re-center · Y difficulty' : 'Keys: H hide panels · R re-center · P difficulty · A/D lean · S duck',
        '500 27px system-ui, sans-serif',
        '#7c8594',
        0,
      );
    });
  }

  /** Low, centred status strip: your HP and posture on the left, the enemy's on the right. */
  private drawStatus(): void {
    const d = this.duel;
    const c = this.timing;
    const e = d.enemy;
    this.status.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.78)';
      roundRect(ctx, 0, 0, w, h, 24);
      ctx.fill();
      const half = w / 2;
      const side = (x: number, label: string, hp: number, hpMax: number, posture: number, postureMax: number) => {
        ctx.font = '700 32px system-ui, sans-serif';
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText(label, x, 48);
        ctx.font = '600 28px system-ui, sans-serif';
        ctx.fillStyle = COLORS.hit;
        const hpText = `HP ${Math.max(0, Math.ceil(hp))}/${hpMax}`;
        ctx.fillText(hpText, x + half - 60 - ctx.measureText(hpText).width, 48);
        bar(ctx, x, 66, half - 60, 44, hp / hpMax, '#d04040');
        ctx.fillStyle = '#9aa3b0';
        ctx.font = '500 22px system-ui, sans-serif';
        ctx.fillText('posture', x, 150);
        bar(ctx, x + 90, 132, half - 150, 22, posture / postureMax, posture / postureMax > 0.75 ? '#ff5a1a' : '#ffb020');
      };
      side(30, 'YOU', d.player.hp, d.player.hpMax, d.player.posture, c.playerPostureMax);
      side(half + 30, e.def.name.toUpperCase(), e.hp, e.def.hp, e.posture, e.def.postureMax);
    });
  }

  /** Name the incoming swing and how to block it, once per attack. */
  private updateCallout(): void {
    const d = this.duel;
    const att = d.currentAttack;
    const e = d.enemy;
    const show = this.phase === 'fight' && !!att && e.state === 'attack' && !e.struck;
    const k = show ? `${att!.id}@${e.attackStart}` : '';
    this.callout.mesh.visible = show;
    if (!show || k === this.calloutKey) return;
    this.calloutKey = k;
    const [title, how, color] = calloutFor(att!);
    this.callout.draw((ctx, w) => {
      ctx.fillStyle = 'rgba(10,12,18,0.75)';
      roundRect(ctx, 0, 0, w, 170, 24);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = '800 60px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(title, w / 2, 72);
      ctx.font = '600 40px system-ui, sans-serif';
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(how, w / 2, 134);
      ctx.textAlign = 'left';
    });
  }

  private showBanner(title: string, color: string, sub: string): void {
    this.banner.mesh.visible = true;
    this.banner.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.7)';
      roundRect(ctx, 0, 0, w, h, 30);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = '800 92px system-ui, sans-serif';
      ctx.fillText(title, w / 2, 118);
      ctx.fillStyle = '#d8dce4';
      ctx.font = '500 36px system-ui, sans-serif';
      ctx.fillText(sub, w / 2, 196);
      ctx.textAlign = 'left';
    });
  }

  private drawCards(): void {
    this.cards.forEach((c, i) => {
      const p = this.offers[i];
      c.mesh.visible = !!p;
      if (!p) return;
      const hov = i === this.hover;
      c.draw((ctx, w, h) => {
        ctx.fillStyle = hov ? 'rgba(60,48,16,0.92)' : 'rgba(16,18,26,0.88)';
        roundRect(ctx, 6, 6, w - 12, h - 12, 30);
        ctx.fill();
        ctx.lineWidth = hov ? 10 : 4;
        ctx.strokeStyle = hov ? '#ffd34d' : '#5a6070';
        ctx.stroke();
        ctx.fillStyle = '#7c8594';
        ctx.font = '600 40px system-ui, sans-serif';
        ctx.fillText(`${i + 1}`, 36, 72);
        ctx.fillStyle = '#ffd34d';
        ctx.font = '800 50px system-ui, sans-serif';
        wrap(ctx, p.name, 36, 170, w - 72, 58);
        ctx.fillStyle = '#e0e4ea';
        ctx.font = '500 36px system-ui, sans-serif';
        wrap(ctx, p.desc, 36, 300, w - 72, 46);
      });
    });
  }
}

// ---------------------------------------------------------------- helpers

/** Place a panel in duel coordinates, turned to face the player. */
function place(mesh: THREE.Object3D, v: V3): void {
  DuelSpace.toLocal(v, mesh.position);
  mesh.rotation.set(0, Math.atan2(-mesh.position.x, -mesh.position.z), 0);
}

function copyPose(o: SwordPose, a: SwordPose): void {
  Object.assign(o.hilt, a.hilt);
  Object.assign(o.tip, a.tip);
}

/** [title, how to block, colour] for an attack's callout. Left/right = the side of YOU it lands on. */
function calloutFor(a: AttackDef): [string, string, string] {
  if (a.perilous === 'thrust') return ['THRUST', 'Lean left or right!', COLORS.hit];
  if (a.perilous === 'sweep') return ['SWEEP', 'Duck!', COLORS.hit];
  if (a.dir === 'high') return ['↓  VERTICAL', 'Block: sword flat above your head', COLORS.info];
  if (a.dir === 'low') return ['LOW CUT', 'Block: sword low, tip down', COLORS.info];
  const side = a.dir === 'left' ? 'LEFT' : 'RIGHT';
  const arrow = a.swing === 'diagonal' ? (a.dir === 'left' ? '↘' : '↙') : a.dir === 'left' ? '→' : '←';
  const name = a.swing === 'diagonal' ? 'DIAGONAL' : 'HORIZONTAL';
  return [`${arrow}  ${name} from your ${side}`, `Block: sword upright on your ${side.toLowerCase()}`, COLORS.info];
}

/** Faults as words, e.g. "angle + not held". Timing is left to fmt(), which says early/late. */
function faultText(faults: Fault[] = []): string {
  const rest = faults.filter((f) => f !== 'early' && f !== 'late').map((f) => FAULT_TEXT[f]);
  return rest.length ? rest.join(' + ') : 'timing';
}

function fmt(ms: number): string {
  const r = Math.round(ms);
  return r === 0 ? '±0 ms' : `${r > 0 ? '+' : '−'}${Math.abs(r)} ms ${r > 0 ? 'late' : 'early'}`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

