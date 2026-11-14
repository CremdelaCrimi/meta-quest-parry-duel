import * as THREE from 'three';
import type { Sfx } from './audio/sfx';
import { DEFAULT_GUARD, PRESETS } from './core/config';
import { makePose } from './core/guard';
import { DEFAULT_LOADOUT, RELICS, WEAPONS, weaponById } from './core/loadout';
import type { Loadout, Weapon } from './core/loadout';
import { Run } from './core/roguelite';
import type { Pickup } from './core/roguelite';
import { Duel } from './core/sim';
import type { AbilityId, AttackDef, DuelEvent, Fault, StrikeZone, SwordPose, TimingConfig, V3 } from './core/types';
import { DuelSpace } from './render/duelSpace';
import { CanvasPanel, bar, roundRect } from './render/panels';
import { EnemyView, Shockwaves, Sparks, SwingTrail, SwordView, contactPoint } from './render/views';
import { ENEMY_DIST } from './render/duelSpace';
import type { InputDevice } from './xr/input';

type Phase = 'calibrate' | 'loadout' | 'fight' | 'won' | 'reward' | 'dead';
/** What the cards are offering: a boon after a win, or the weapon / relic before a run. */
type Menu = 'boon' | 'weapon' | 'relic';
interface Offer {
  id: string;
  name: string;
  desc: string;
}
const LOADOUT_KEY = 'parryDuel.loadout';

function loadLoadout(): Loadout {
  try {
    const v = JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? 'null') as Partial<Loadout> | null;
    return { ...DEFAULT_LOADOUT, ...(v ?? {}) };
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}
function saveLoadout(l: Loadout): void {
  try {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(l));
  } catch {
    /* private mode: the menu still works, it just won't remember */
  }
}

interface Attempt {
  offset: number;
  type: 'perfect' | 'block' | 'hit';
  faults: Fault[];
}

const COLORS = { perfect: '#ffd34d', block: '#6fb6ff', angle: '#b48cff', shaky: '#ff9a3c', hit: '#ff5050', info: '#e8e8e8', open: '#60ff9a' };

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
  early: 'too early',
  late: 'too late',
  angle: 'angle',
  shaky: 'not held',
  locked: 'flailing',
  side: 'wrong side',
};
const hexOf = (k: keyof typeof COLORS) => parseInt(COLORS[k].slice(1), 16);

/** Minimum blade-tip speed (m/s) for contact with the enemy to count as a strike. */
const STRIKE_MIN_SPEED = 1.8;
/** Wait before the next strike counts: one hand is quick, two hands hit harder but recover slower. */
const STRIKE_COOLDOWN_MS = { one: 250, two: 450 };
/** Strikes within this distance (m) of his centre line hit his sword, not a side. */
const ZONE_CENTER_M = 0.06;
/** cos of the max angle between tip motion and blade line for a strike to count as a poke. */
const POKE_ALIGN = 0.7;
const zoneOf = (x: number): StrikeZone => (x < -ZONE_CENTER_M ? 'left' : x > ZONE_CENTER_M ? 'right' : 'center');

export class Game {
  phase: Phase = 'calibrate';
  run = new Run(1);
  duel!: Duel;
  readonly timing: TimingConfig = { ...PRESETS[0] };
  presetIdx = 0;

  readonly enemyView = new EnemyView();
  readonly sparks = new Sparks();
  private readonly waves = new Shockwaves();
  /** Ribbon behind your own blade on fast swings (gold while a counter is open). */
  private readonly playerTrail = new SwingTrail();
  private trailClock = 0;
  private readonly hud = new CanvasPanel(1024, 720, 0.75);
  private readonly banner = new CanvasPanel(1024, 256, 1.1);
  /** How to play: shown before the run and through the Trainer fight. */
  private readonly help = new CanvasPanel(1024, 880, 0.8);
  private helpXR = false;
  /** Your HP and posture: a small strip that lazily follows the bottom of your view. */
  private readonly status = new CanvasPanel(768, 150, 0.3);
  /** Enemy name, HP, posture, chain and frenzy, floating above his head. */
  private readonly enemyPanel = new CanvasPanel(1024, 200, 0.85);
  /** Names the incoming swing and how to block it (Trainer fight only; ?callouts=1 keeps it on). */
  private readonly callout = new CanvasPanel(1024, 170, 0.75);
  private readonly calloutsAlways = new URLSearchParams(location.search).get('callouts') === '1';
  /** Result line above the enemy (PERFECT, BLOCK · too early...). ?results=0 leaves it to colour, sound and haptics. */
  private readonly showResults = new URLSearchParams(location.search).get('results') !== '0';
  private calloutKey = '';
  private statusAt = 0;
  /** Stats panel during fights (A toggles); it always shows on the victory and death screens. */
  private statsInFight = false;
  /** Edge-of-view vignette: hit flash, low HP pulse, high posture warning. */
  private readonly vignette = new Vignette();
  private hurtT = 0;
  private dodgeT = 0;
  private readonly bladeA = new THREE.Vector3();
  private readonly bladeB = new THREE.Vector3();
  private readonly cards = [0, 1, 2, 3, 4, 5].map(() => new CanvasPanel(512, 640, 0.3));
  private offers: Offer[] = [];
  private menu: Menu = 'boon';
  /** Weapon and starting relic, remembered between visits (localStorage). */
  readonly loadout: Loadout = loadLoadout();
  weapon: Weapon = weaponById(this.loadout.weapon);
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
  private readonly tmp2 = new THREE.Vector3();
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

    scene.add(this.space.group, this.sparks.points, this.waves.group, this.playerTrail.mesh, this.vignette.mesh, this.status.mesh);
    this.space.group.add(this.enemyView.root, this.hud.mesh, this.banner.mesh, this.help.mesh, this.enemyPanel.mesh, this.callout.mesh);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this; // console tuning
    // The simple built-in swordsman is the default; ?enemy=rigged loads the Tripo/Mixamo model from public/enemy/.
    const q = new URLSearchParams(location.search);
    if (q.get('enemy') === 'rigged') void this.enemyView.useRigged('./enemy/enemy.json');
    this.enemyView.guides = q.get('guides') !== '0';
    for (const c of this.cards) this.space.group.add(c.mesh);

    place(this.hud.mesh, { x: -1.0, y: -0.25, z: 1.25 });
    place(this.banner.mesh, { x: 0, y: 0.5, z: 1.4 });
    place(this.help.mesh, { x: 1.1, y: 0.0, z: 1.1 });
    place(this.enemyPanel.mesh, { x: 0, y: 0.66, z: ENEMY_DIST });
    place(this.callout.mesh, { x: 0, y: 0.95, z: ENEMY_DIST - 0.1 });
    this.status.mesh.renderOrder = 12;
    this.callout.mesh.visible = false;
    this.drawHelp();

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
      if (this.phase === 'fight') this.statsInFight = !this.statsInFight;
      else this.hudOn = !this.hudOn;
    }
    // Stats belong to the between-fights screens; during a fight only if asked for (A).
    const between = this.phase === 'won' || this.phase === 'dead';
    this.hud.mesh.visible = this.hudOn && (between || (this.phase === 'fight' && this.statsInFight));
    place(this.hud.mesh, between ? { x: 0, y: -0.2, z: 1.3 } : { x: -1.0, y: -0.25, z: 1.25 });
    if (this.helpXR !== this.isXR) {
      // Entered or left the headset: controller wording vs mouse/keyboard wording.
      this.helpXR = this.isXR;
      this.drawHelp();
      if (this.phase === 'calibrate') this.setPhase('calibrate', t);
    }
    // How-to-play only on the start screen; the Trainer's swing callouts teach during the fight.
    this.help.mesh.visible = this.phase === 'calibrate';

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
      case 'loadout':
        this.updateCards(t);
        break;
      case 'dead':
        this.stepDuel(t, dt);
        if (t - this.phaseT > 1200 && f.rightTrigger) this.startRun(t);
        break;
    }

    this.enemyView.update(this.duel, this.space, dt, this.headCurr);
    this.sword.update(dt);
    this.sparks.update(dt);
    this.waves.update(dt, f.headPos);
    this.updatePlayerTrail(f, dt);
    this.updateCallout();
    this.updateVignette(t, dt);
    this.followView(this.status.mesh, f.headPos, f.headQuat, dt);
    this.status.mesh.visible = this.phase === 'fight' || this.phase === 'won';
    this.enemyPanel.mesh.visible = this.phase === 'fight' && this.duel.enemy.state !== 'dead';
    if (t >= this.statusAt) {
      this.drawStatus();
      this.drawEnemyPanel(t);
      this.statusAt = t + 100;
    }
    if (this.hud.mesh.visible && t >= this.hudAt) {
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
    let strikeZone: StrikeZone = 'center';
    let strikePoke = false;
    if (f.hasSword && t >= this.strikeReadyAt && this.duel.enemy.state !== 'dead') {
      const speed = this.prevTip.distanceTo(f.tip) / Math.max(1e-3, dt / 1000);
      const contact = this.enemyView.bodyHit(f.hilt, f.tip, this.space) || this.enemyView.bodyHit(this.prevTip, f.tip, this.space);
      if (contact && (speed > STRIKE_MIN_SPEED || (!this.isXR && f.rightTrigger))) {
        strikeSpeed = Math.max(speed, 2);
        strikeZone = zoneOf(this.space.toDuel(this.enemyView.hitPoint, this.tmpV3).x);
        // A poke drives the tip along the blade's own line instead of sweeping it sideways.
        const move = this.tmp.copy(f.tip).sub(this.prevTip);
        const along = this.tmp2.copy(f.tip).sub(f.hilt).normalize();
        strikePoke = move.length() > 1e-4 && move.normalize().dot(along) > POKE_ALIGN;
      }
    }
    if (!this.isXR && f.rightTrigger && this.phase === 'fight' && t >= this.strikeReadyAt) {
      strikeSpeed = 3; // desktop: click = strike, on the side the mouse holds the sword
      strikeZone = zoneOf(this.swordCurr.tip.x);
    }
    if (strikeSpeed > 0) this.strikeReadyAt = t + STRIKE_COOLDOWN_MS[f.twoHanded ? 'two' : 'one'] * this.weapon.strikeCooldownMult;

    let ability: AbilityId | null = null;
    if (f.leftTrigger) ability = 'slowTime';
    else if (f.btnX) ability = 'ward'; // left grip is for holding the sword with both hands

    this.duel.step({
      t0: this.duel.time,
      t1: t,
      swordPrev: this.swordPrev,
      swordCurr: this.swordCurr,
      headPrev: this.headPrev,
      headCurr: this.headCurr,
      strikeSpeed,
      strikeZone,
      strikePoke,
      twoHanded: f.twoHanded,
      ability,
    });
    for (const ev of this.duel.events) this.onEvent(ev, t);

    copyPose(this.swordPrev, this.swordCurr);
    Object.assign(this.headPrev, this.headCurr);
  }

  // ---------------------------------------------------------------- events → feedback

  private onEvent(ev: DuelEvent, t: number): void {
    const f = this.input.frame;
    // Sparks fly from where the two blades actually meet.
    this.enemyView.bladeWorld(this.bladeA, this.bladeB);
    const contact = contactPoint(f.hilt, f.tip, this.bladeA, this.bladeB, this.tmp);
    switch (ev.type) {
      case 'perfect': {
        const n = ev.chain ?? 1;
        this.sfx.play('perfect');
        this.input.pulse('right', 1, 80); // matches the hit-stop so freeze and rumble end together
        this.sparks.burst(contact, 0xffd060, 40, 2.5);
        this.waves.emit(contact, 0xffd060, 0.35 + 0.08 * Math.min(4, n));
        this.sword.flash(0xffc040);
        this.enemyView.react('parried', this.duel);
        this.record(ev.offsetMs!, 'perfect', []);
        this.flashResult(n > 1 ? `PERFECT ×${n} CHAIN` : 'PERFECT', COLORS.perfect, t);
        break;
      }
      case 'block': {
        const col = outcomeColor('block', ev.faults);
        this.sfx.play('block');
        this.input.pulse('right', 0.5, 120);
        this.sparks.burst(contact, hexOf(col), 12, 1.4);
        this.sword.flash(hexOf(col));
        this.enemyView.react('blocked', this.duel);
        this.record(ev.offsetMs!, 'block', ev.faults ?? []);
        this.flashResult(`BLOCK · ${faultText(ev.faults)}`, COLORS[col], t);
        break;
      }
      case 'hit': {
        this.sfx.play('hit');
        this.enemyView.react('hit', this.duel);
        this.hurtT = 1;
        this.statusAt = 0;
        this.input.pulse('right', 1, 250);
        this.input.pulse('left', 1, 250);
        this.record(ev.offsetMs ?? 0, 'hit', ev.faults ?? []);
        const why =
          ev.perilous === 'thrust'
            ? ' (thrust: lean!)'
            : ev.perilous === 'sweep'
              ? ' (sweep: duck!)'
              : ev.faults?.includes('side')
                ? ` · block ${ev.dir === 'high' ? 'HIGH' : ev.dir?.toUpperCase()}`
                : ` · ${faultText(ev.faults)}`;
        this.flashResult(`HIT${why}`, COLORS.hit, t);
        break;
      }
      case 'dodged':
        this.sfx.play('dodge');
        this.enemyView.react('dodged', this.duel);
        this.dodgeT = 1;
        this.flashResult(ev.perilous && ev.perilous !== 'none' ? 'DODGED · COUNTER NOW!' : 'DODGED', COLORS.perfect, t);
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
        if (ev.opening) this.flashResult('OPENING · he covers that side now', COLORS.open, t);
        this.sfx.play('strike');
        this.enemyView.hit();
        this.input.pulse('right', 0.6, 30);
        this.sparks.burst(this.enemyView.hitPoint, 0xff6040, 14, 1.5);
        this.waves.emit(this.enemyView.hitPoint, ev.opening ? 0x60ff9a : 0xff6040, 0.25, 220);
        break;
      case 'enemyBlock':
        // Show why the swing did nothing, and where to go instead.
        this.flashResult(
          ev.poke ? 'DEFLECTED · poke wears his posture' : ev.zone === 'center' ? 'DEFLECTED · hit his open side (green)' : 'DEFLECTED · that side is guarded',
          COLORS.info,
          t,
        );
        this.sfx.play('block', 0.5);
        this.input.pulse('right', 0.35, 25);
        this.sparks.burst(contact, 0xffffff, 6, 1);
        break;
      case 'enemyPostureBreak':
        this.sfx.play('peril');
        this.waves.emit(contact, 0xffffff, 0.9, 520);
        this.waves.emit(contact, 0xffd060, 0.6, 380);
        this.flashResult('POSTURE BROKEN: STRIKE!', COLORS.perfect, t);
        break;
      case 'finisher':
        this.sfx.play('finisher');
        this.input.pulse('right', 1, 220);
        this.sparks.burst(this.enemyView.hitPoint, 0xff2020, 48, 3);
        this.waves.emit(this.enemyView.hitPoint, 0xff3030, 1.1, 600);
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
        this.waves.emit(f.headPos.clone().add(this.tmp2.set(0, -0.15, 0)), 0x6fb6ff, 0.7, 450);
        this.flashResult('WARD ABSORBED', COLORS.block, t);
        break;
    }
  }

  // ---------------------------------------------------------------- run flow

  /** Before each run: pick a weapon, then a free starting relic (?loadout=0 skips straight in with the last pick). */
  private startRun(t: number): void {
    if (new URLSearchParams(location.search).get('loadout') === '0') {
      this.beginRun(t);
      return;
    }
    this.openMenu('weapon', t);
  }

  private beginRun(t: number): void {
    this.weapon = weaponById(this.loadout.weapon);
    this.sword.setBladeLength(this.weapon.bladeM);
    this.run = new Run((Date.now() ^ Math.floor(t)) >>> 0);
    this.run.equip(this.weapon, RELICS.find((r) => r.id === this.loadout.relic) ?? null);
    this.newDuel(t);
    this.setPhase('fight', t);
  }

  private openMenu(menu: Menu, t: number): void {
    this.menu = menu;
    const pick = this.isXR ? 'Touch a card with your blade, pull trigger' : `Press 1–${menu === 'boon' ? 3 : menu === 'weapon' ? WEAPONS.length : RELICS.length}`;
    if (menu === 'weapon') {
      this.offers = WEAPONS;
      this.showBanner('CHOOSE YOUR WEAPON', COLORS.info, pick);
    } else if (menu === 'relic') {
      this.offers = RELICS;
      this.showBanner('CHOOSE A RELIC', COLORS.block, `Free for this run · ${pick}`);
    } else {
      this.offers = this.run.offer(3);
      this.showBanner('CHOOSE A BOON', COLORS.perfect, pick);
    }
    this.hover = -1;
    this.setPhase(menu === 'boon' ? 'reward' : 'loadout', t);
    this.drawCards();
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
    this.openMenu('boon', t);
  }

  private updateCards(t: number): void {
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
    if (pick < 0 || pick >= this.offers.length) return;
    this.sfx.play('ui');
    const id = this.offers[pick].id;
    for (const c of this.cards) c.mesh.visible = false;
    if (this.menu === 'weapon') {
      this.loadout.weapon = id;
      this.openMenu('relic', t);
    } else if (this.menu === 'relic') {
      this.loadout.relic = id;
      saveLoadout(this.loadout);
      this.beginRun(t);
    } else {
      this.run.choose(this.offers[pick] as Pickup);
      this.run.advance(this.duel.player.hp);
      this.newDuel(t);
      this.setPhase('fight', t);
    }
  }

  private setPhase(p: Phase, t: number): void {
    this.phase = p;
    this.phaseT = t;
    if (p === 'fight') this.banner.mesh.visible = false;
    if (p !== 'reward' && p !== 'loadout') for (const c of this.cards) c.mesh.visible = false;
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
      const early = d.perfectEarlyMs();
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
      ctx.fillText(`${this.weapon.name} · Boons: ${owned.length ? owned.join(', ') : 'none yet'}`, 32, 585);
      const ab = d.mods.abilities.map((a) => {
        const left = Math.max(0, d.player.abilityReadyAt[a] - t) / 1000;
        return `${a === 'slowTime' ? 'L-trigger Time' : 'X Ward'}: ${left > 0 ? left.toFixed(0) + 's' : 'ready'}`;
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

      line('BLOCK: match the glowing ghost sword', '700 36px system-ui, sans-serif', COLORS.block, 46);
      line('A ring closes on it. Be there when it turns GOLD,', '500 29px system-ui, sans-serif', '#d8dce4', 38);
      line('then hold still until the swing lands.', '500 29px system-ui, sans-serif', COLORS.perfect, 50);
      line('↓  Vertical chop: sword flat above your head', '500 29px system-ui, sans-serif', '#d8dce4', 40);
      line('→ ←  Horizontal: sword upright on that side', '500 29px system-ui, sans-serif', '#d8dce4', 40);
      line('↘ ↙  Diagonal: sword upright on that side', '500 29px system-ui, sans-serif', '#d8dce4', 66);

      line(xr ? 'ATTACK: swing your sword into his body' : 'ATTACK: click while he is open', '700 36px system-ui, sans-serif', '#ff8a5a', 44);
      line('While he waits, hit the side his sword is NOT on (green', '500 29px system-ui, sans-serif', COLORS.open, 38);
      line('glow). Pokes into his guard wear down his posture.', '500 29px system-ui, sans-serif', '#d8dce4', 38);
      line('Hits hardest right after a perfect (gold) block.', '500 29px system-ui, sans-serif', COLORS.perfect, 66);

      line('HEALTH: your strip sits low in your view', '700 36px system-ui, sans-serif', COLORS.hit, 44);
      line('Red = HP. Orange = posture (fills as you block; full =', '500 29px system-ui, sans-serif', '#d8dce4', 38);
      line('guard broken). Perfects in a row CHAIN for more damage.', '500 29px system-ui, sans-serif', '#d8dce4', 66);

      line(xr ? 'LEFT HAND: squeeze grip on the handle = two hands' : 'G: two-handed grip', '700 32px system-ui, sans-serif', '#ffd060', 38);
      line('Steadier blocks, harder hits, slower. One hand: quick + pokes.', '500 27px system-ui, sans-serif', '#d8dce4', 50);
      line(
        xr ? 'Buttons: R trigger start · X ward · A stats · B re-center · Y difficulty' : 'Keys: G two hands · E ward · H stats · R re-center · P difficulty',
        '500 27px system-ui, sans-serif',
        '#7c8594',
        0,
      );
    });
  }

  /** Your strip: HP (with number) and posture, plus the assist badge when it's helping. */
  private drawStatus(): void {
    const d = this.duel;
    const p = d.player;
    const pf = p.posture / this.timing.playerPostureMax;
    this.status.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.7)';
      roundRect(ctx, 0, 0, w, h, 30);
      ctx.fill();
      ctx.font = '800 34px system-ui, sans-serif';
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText('YOU', 26, 50);
      ctx.fillStyle = COLORS.hit;
      ctx.font = '700 32px system-ui, sans-serif';
      const hpText = `${Math.max(0, Math.ceil(p.hp))}`;
      ctx.fillText(hpText, w - 26 - ctx.measureText(hpText).width, 50);
      if (this.input.frame.twoHanded) {
        // Grip badge, right of YOU, so you always know which mode you're in.
        ctx.font = '800 26px system-ui, sans-serif';
        ctx.fillStyle = '#ffd060';
        ctx.fillText('2H', w - 26 - 110, 48);
      }
      if (d.assistOn) {
        ctx.font = '700 24px system-ui, sans-serif';
        ctx.fillStyle = COLORS.block;
        ctx.fillText(`ASSIST +${d.perfectEarlyMs() - this.timing.perfectEarlyMs - d.mods.perfectWindowBonusMs} ms`, 110, 48);
      }
      pill(ctx, 26, 66, w - 52, 30, p.hp / p.hpMax, '#e04848');
      pill(ctx, 26, 108, w - 52, 18, pf, pf > 0.75 ? '#ff5a1a' : '#ffb020');
    });
  }

  /** Above the enemy's head: name, HP, posture (what perfects fill), chain and frenzy badges. */
  private drawEnemyPanel(t: number): void {
    const d = this.duel;
    const e = d.enemy;
    const pf = Math.min(1, e.posture / e.def.postureMax);
    const frenzy = d.frenzy();
    this.enemyPanel.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.6)';
      roundRect(ctx, 0, 0, w, h, 30);
      ctx.fill();
      ctx.font = '800 40px system-ui, sans-serif';
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(e.def.name.toUpperCase(), 30, 54);
      let x = 30 + ctx.measureText(e.def.name.toUpperCase()).width + 24;
      const badge = (text: string, color: string) => {
        ctx.font = '800 30px system-ui, sans-serif';
        const bw = ctx.measureText(text).width + 28;
        ctx.fillStyle = color;
        roundRect(ctx, x, 20, bw, 44, 22);
        ctx.fill();
        ctx.fillStyle = '#10131a';
        ctx.fillText(text, x + 14, 53);
        x += bw + 12;
      };
      if (d.player.chain > 1) badge(`×${d.player.chain} CHAIN`, COLORS.perfect);
      if (frenzy) badge(frenzy.belowHp < 0.3 ? 'FRENZY!' : 'FRENZY', `rgba(255,80,80,${0.75 + 0.25 * Math.sin(t / 120)})`);
      pill(ctx, 30, 82, w - 60, 40, e.hp / e.def.hp, '#e04848');
      pill(ctx, 30, 138, w - 60, 34, pf, e.state === 'stagger' ? '#ffffff' : pf > 0.75 ? '#ff5a1a' : '#ffb020');
      ctx.font = '700 24px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(16,19,26,0.85)';
      ctx.fillText(e.state === 'stagger' ? 'BROKEN · STRIKE NOW' : 'POSTURE', 46, 164);
    });
  }

  /**
   * One line above the enemy. In the Trainer (or with ?callouts=1) it names each incoming swing
   * and how to block it; otherwise it shows how your last guard went (PERFECT, BLOCK · too early...).
   */
  private updateCallout(): void {
    const d = this.duel;
    const att = d.currentAttack;
    const e = d.enemy;
    const t = this.lastT;
    const teach = this.calloutsAlways || this.run.fight === 0;
    // Must-dodge attacks are always named: they arrive after the Trainer and can't be blocked.
    const swing = this.phase === 'fight' && !!att && (teach || att.perilous !== 'none') && e.state === 'attack' && !e.struck;
    const result = !swing && this.showResults && t - this.lastResult.t < 1100;
    const k = swing ? `${att!.id}@${e.attackStart}` : result ? `r${this.lastResult.t}` : '';
    this.callout.mesh.visible = swing || result;
    if (!this.callout.mesh.visible || k === this.calloutKey) return;
    this.calloutKey = k;
    const [title, how, color] = swing ? calloutFor(att!) : [this.lastResult.text, '', this.lastResult.color];
    this.callout.draw((ctx, w) => {
      ctx.fillStyle = 'rgba(10,12,18,0.7)';
      roundRect(ctx, how ? 0 : 120, how ? 0 : 20, how ? w : w - 240, how ? 170 : 110, 28);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = '800 60px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(title, w / 2, how ? 72 : 96);
      if (how) {
        ctx.font = '600 40px system-ui, sans-serif';
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText(how, w / 2, 134);
      }
      ctx.textAlign = 'left';
    });
  }

  /**
   * Edge vignette, by priority: hit flash (red), HP under 25% (slow red pulse), posture over 75%
   * (steady orange: one more block may break your guard).
   */
  private updateVignette(t: number, dt: number): void {
    const f = this.input.frame;
    this.hurtT = Math.max(0, this.hurtT - dt / 400);
    const p = this.duel.player;
    const fighting = this.phase === 'fight';
    let color = 0xff2020;
    let a = 0.7 * this.hurtT; // peaks at 0.7, fades out linearly over 400 ms
    this.dodgeT = Math.max(0, this.dodgeT - dt / 350);
    if (this.dodgeT > 0 && this.hurtT === 0) {
      color = 0x60c0ff; // a clean dodge: brief cool flash at the edges
      a = 0.45 * this.dodgeT;
    }
    if (fighting && p.hp / p.hpMax < 0.25) a = Math.max(a, 0.25 + 0.2 * Math.sin(t / 220));
    else if (fighting && p.posture / this.timing.playerPostureMax > 0.75 && a < 0.3) {
      color = 0xff8a1a;
      a = 0.35;
    }
    this.vignette.set(f.headPos, f.headQuat, color, a);
  }

  /** In VR your blade leaves a ribbon on fast swings, so strikes read as strikes. Gold while a counter is open. */
  private updatePlayerTrail(f: InputDevice['frame'], dt: number): void {
    this.trailClock += dt;
    const speed = this.prevTip.distanceTo(f.tip) / Math.max(1e-3, dt / 1000);
    // VR only: a desktop mouse teleports between guards, which would draw ribbons that aren't swings.
    if (this.isXR && f.hasSword && speed > STRIKE_MIN_SPEED && (this.phase === 'fight' || this.phase === 'won')) {
      const counter = this.duel.time <= this.duel.player.counterUntil || this.duel.enemy.state === 'stagger';
      this.tmp2.copy(f.hilt).lerp(f.tip, 0.45);
      this.playerTrail.push(this.tmp2, f.tip, this.trailClock, counter ? 0xffd060 : 0xcfe6ff);
    }
    this.playerTrail.update(this.trailClock);
  }

  /** Keep a panel low in the view, catching up with head turns lazily so it never jitters. */
  private followView(o: THREE.Object3D, head: THREE.Vector3, q: THREE.Quaternion, dt: number): void {
    const target = this.tmpFollow.set(0, -0.42, -0.7).applyQuaternion(q).add(head); // peripheral, below the duel
    if (o.userData.placed) o.position.lerp(target, 1 - Math.exp(-dt / 220));
    else o.position.copy(target);
    o.userData.placed = true;
    o.lookAt(head);
  }
  private readonly tmpFollow = new THREE.Vector3();

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
    const n = this.offers.length;
    const last = this.menu === 'weapon' ? this.loadout.weapon : this.menu === 'relic' ? this.loadout.relic : null;
    this.cards.forEach((c, i) => {
      const p = this.offers[i];
      c.mesh.visible = !!p;
      if (!p) return;
      // One row of three; six go in two rows, the lower one at about waist height.
      const row = n > 3 ? Math.floor(i / 3) : 0;
      const col = n > 3 ? i % 3 : i;
      const cols = n > 3 ? 3 : n;
      place(c.mesh, { x: (col - (cols - 1) / 2) * 0.36, y: n > 3 ? -0.15 - row * 0.42 : -0.35, z: 0.75 });
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
        if (p.id === last) {
          ctx.fillStyle = '#7c8594';
          ctx.font = '600 30px system-ui, sans-serif';
          ctx.fillText('last time', w - 180, 72);
        }
      });
    });
  }
}

// ---------------------------------------------------------------- helpers

/** Rounded bar with a soft track and a highlight along the top of the fill. */
function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, color: string): void {
  const r = h / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  const fw = Math.max(0, Math.min(1, f)) * w;
  if (fw < 1) return;
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(fw, h), h, r);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, x + 4, y + 3, Math.max(fw, h) - 8, h * 0.32, h * 0.16);
  ctx.fill();
}

/**
 * Coloured glow at the edge of vision, clear in the middle. A small sphere around the head drawn
 * last; the shader fades it in by angle away from where you're looking, so it works in both eyes.
 */
class Vignette {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly fwd = new THREE.Vector3();

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uFwd: { value: new THREE.Vector3(0, 0, -1) }, uHead: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader:
        'uniform vec3 uColor; uniform float uAlpha; uniform vec3 uFwd; uniform vec3 uHead; varying vec3 vW;' +
        'void main(){ float d = dot(normalize(vW - uHead), uFwd); float edge = smoothstep(0.9, 0.45, d); gl_FragColor = vec4(uColor, uAlpha * edge); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), this.mat);
    this.mesh.renderOrder = 30;
    this.mesh.frustumCulled = false;
  }

  set(head: THREE.Vector3, q: THREE.Quaternion, color: number, alpha: number): void {
    this.mesh.visible = alpha > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(head);
    this.mat.uniforms.uHead.value.copy(head);
    this.mat.uniforms.uFwd.value.copy(this.fwd.set(0, 0, -1).applyQuaternion(q));
    this.mat.uniforms.uColor.value.setHex(color);
    this.mat.uniforms.uAlpha.value = Math.min(1, alpha);
  }
}

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
  return faults.length ? faults.map((f) => FAULT_TEXT[f]).join(' + ') : 'timing';
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

