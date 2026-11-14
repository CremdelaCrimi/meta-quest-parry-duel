import * as THREE from 'three';
import type { Sfx } from './audio/sfx';
import { DEFAULT_GUARD, PRESETS } from './core/config';
import { makePose } from './core/guard';
import { Run } from './core/roguelite';
import type { Pickup } from './core/roguelite';
import { Duel } from './core/sim';
import type { AbilityId, DuelEvent, Fault, SwordPose, TimingConfig, V3 } from './core/types';
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

    scene.add(this.space.group, this.sparks.points);
    this.space.group.add(this.enemyView.root, this.hud.mesh, this.banner.mesh);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this; // console tuning
    // The rigged swordsman from public/enemy/ is the default; ?enemy=procedural keeps the built-in one.
    if (new URLSearchParams(location.search).get('enemy') !== 'procedural') void this.enemyView.useRigged('./enemy/enemy.json');
    for (const c of this.cards) this.space.group.add(c.mesh);

    place(this.hud.mesh, { x: -1.0, y: -0.25, z: 1.25 });
    place(this.banner.mesh, { x: 0, y: 0.5, z: 1.4 });
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

    this.enemyView.update(this.duel, this.space, dt);
    this.sword.update(dt);
    this.sparks.update(dt);
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
        this.isXR ? 'Stand in your spot, face forward, pull RIGHT TRIGGER' : 'Click to begin. Mouse = guard, A/D lean, S duck',
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

