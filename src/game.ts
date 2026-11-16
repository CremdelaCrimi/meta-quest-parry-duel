import * as THREE from 'three';
import type { Sfx } from './audio/sfx';
import { DEFAULT_GUARD, MECH_DEFAULTS, PRESETS } from './core/config';
import { makePose } from './core/guard';
import { BLADES, DEFAULT_LOADOUT, HANDLES, RELICS, WEAPONS, weaponById } from './core/loadout';
import type { Loadout, Weapon } from './core/loadout';
import { Run } from './core/roguelite';
import type { Pickup } from './core/roguelite';
import { Duel, dodgeBeats } from './core/sim';
import { Footwork } from './core/footwork';
import { PlaytestLog } from './core/playtest';
import { ATTACKS, MAINSPRING_CLANKS_MS } from './core/enemies';
import type { AbilityId, AttackDef, DashDir, DuelEvent, Fault, Mechanics, StrikeZone, SwordPose, TimingConfig, V3 } from './core/types';
import { DuelSpace } from './render/duelSpace';
import { CanvasPanel, bar, brassFrame, roundRect } from './render/panels';
import { EnemyView, Shockwaves, Sparks, SwingTrail, SwordView, contactPoint } from './render/views';
import { ATTACK_LUNGE, ENEMY_DIST } from './render/duelSpace';
import type { InputDevice } from './xr/input';
import { PauseMenu } from './render/pauseMenu';
import { DRILLS, DUMMY_MODES, DUMMY_SPEEDS, dummyDef } from './core/training';
import type { DummyMode } from './core/training';
import { TRAIN_COLORS, drawCoach, drawTimeline } from './render/trainingPanels';
import type { TimelineData } from './render/trainingPanels';
import { HealAura, drawChipRow } from './render/leftHand';
import { FloatText } from './render/floatText';
import type { AbilityChip, LeftHandView } from './render/leftHand';
import type { MenuItem } from './render/pauseMenu';
import { headsetName, loadSettings, resolveQuality, saveSettings } from './settings';
import type { Quality } from './settings';

type Phase = 'calibrate' | 'loadout' | 'fight' | 'won' | 'reward' | 'dead';
/** What the cards are offering: a boon after a win, or the weapon / relic before a run. */
type Menu = 'boon' | 'weapon' | 'relic' | 'mode';
interface Offer {
  id: string;
  name: string;
  desc: string;
}
const LOADOUT_KEY = 'parryDuel.loadout';

/** First choice after the start screen. */
const MODE_OFFERS: Offer[] = [
  { id: 'training', name: 'Training', desc: 'A dummy that never dies. Switch what it does: idle, attacking, deflecting, both.' },
  { id: 'run', name: 'Run', desc: 'Four duels in a row, a boon after each win. Death ends the run.' },
];

/**
 * Game-side tuning defaults (menu → Tuning overrides them; timing values live in TimingConfig).
 * The dash moves for exactly its i-frames (dashIframesMs), so distance / i-frames = dash speed.
 */
const TUNE_DEFAULTS: Record<string, number> = {
  dashDistM: 0.8,
  dashCooldownMs: 450,
  healMs: 500,
};
/** Which tuning keys are TimingConfig fields (the rest are TUNE_DEFAULTS). */
const TIMING_TUNE_KEYS = ['feintChance', 'feintMaxMs', 'furyChance', 'riposteMs', 'chargeMs', 'regainMs', 'blastCooldownMs', 'dashIframesMs', 'iframesMs', 'perfectDodgeMs', 'perfectEarlyMs', 'perfectLateMs', 'hitStopMs', 'grappleCooldownMs', 'healAmount', 'fatalArmMs'];
/** His blade reaches you while you're within this distance of his body (m, after his lunge). */
const ENEMY_REACH = 1.75;
const UP = new THREE.Vector3(0, 1, 0);
/** Fury (parry-only) swings: ember orange, distinct from red must-dodge attacks. */
const FURY_COLOR = '#ff7a1a';
const FURY_HEX = parseInt(FURY_COLOR.slice(1), 16);
/** Your reach to his body axis: arm forward + blade + his body radius (m). */
const ARM_M = 0.55;
const BODY_R = 0.27;
/** Grapple: wire range (m), how close it must pass his body (m), pull distance (m), and how close it stops. */
const GRAPPLE_RANGE_M = 3.5;
const GRAPPLE_AIM_M = 0.45;
const GRAPPLE_PULL_M = 0.5;
const GRAPPLE_STOP_GAP_M = 1.2;
/** Blast shot: speed (m/s), range (m), and how close it must pass his body to hit (m). */
const BLAST_SPEED = 14;
const BLAST_RANGE_M = 6;
const BLAST_HIT_M = 0.3;

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
  fury: 'FURY: parry only',
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
  private readonly status = new CanvasPanel(768, 270, 0.3);
  /** Enemy name, HP, posture, chain and frenzy, floating above his head. */
  private readonly enemyPanel = new CanvasPanel(1024, 200, 0.85);
  /** Names the incoming swing and how to block it (Trainer fight only; ?callouts=1 keeps it on). */
  private readonly callout = new CanvasPanel(1024, 170, 0.75);
  /** Menu settings (difficulty, guides, callouts, result text, rumble, graphics), remembered between visits. */
  readonly settings = loadSettings();
  /** Pause menu with settings and a controller map (Y or left stick press). */
  private readonly pause: PauseMenu;
  private pauseOffset = 0;
  private lastRaw = NaN;
  // Training mode: a dummy that never dies, with a swing timeline and a coach panel.
  training = false;
  dummyMode: DummyMode = 'full';
  drillIdx = 0;
  speedIdx = 0;
  private readonly timeline = new CanvasPanel(1024, 470, 0.8);
  private readonly coach = new CanvasPanel(1024, 540, 0.7);
  private trainAt = 0;
  private tl: (TimelineData & { realStart: number }) | null = null;
  private readonly trainStats = { perfect: 0, block: 0, hit: 0, dodged: 0, landed: 0, deflected: 0, whiffs: 0 };
  private dashReadyAt = 0;
  private blockWas = false;
  /** Enemy footwork (fixed duel frame) and the player's position in that frame this frame. */
  private readonly footwork = new Footwork();
  /** A/B playtest metrics for the toggled mechanics (menu → Playtest stats; console: game.playtest.summary()). */
  readonly playtest = new PlaytestLog();
  private readonly tmpC: V3 = { x: 0, y: 0, z: 0 };
  private playerX = 0;
  private playerZ = 0;
  /** Distance from your head to his body right now, after his lunge (m). */
  private gapNow = ENEMY_DIST;
  private whiffAt = 0;
  private chimeKey = -1;
  private dodgeGold = false;
  /** Floor arc: how far your blade reaches. */
  private readonly reachMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  private readonly reachArc = new THREE.Mesh(new THREE.BufferGeometry(), this.reachMat);
  private reachR = 0;
  /** Arena decor group (main.ts): a sideways dash orbits you by turning it around him. */
  arena: THREE.Group | null = null;
  leftHand: LeftHandView | null = null;
  private orbit = { angle: 0, applied: 0, t0: -1, ms: 300, pivot: new THREE.Vector3() };
  /** Flask: progress of the current drink (ms), and a latch so one raise = one drink. */
  private drinkMs = 0;
  private drinkLatch = false;
  private fatalReadyShown = false;
  private wristAt = 0;
  /** Lock-on reticle on his chest. */
  private readonly lockMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
  private readonly chargeMat = new THREE.MeshBasicMaterial({ color: 0xb5913a, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false });
  private readonly chargeRing = (() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.09, 12, 1), this.chargeMat);
    r.renderOrder = 18;
    r.visible = false;
    return r;
  })();
  private readonly lockOn = (() => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.07, 32), this.lockMat);
    g.add(ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.035), this.lockMat);
      const a = (i * Math.PI) / 2;
      tick.position.set(Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0);
      tick.rotation.z = a + Math.PI / 2;
      g.add(tick);
    }
    g.traverse((o) => (o.renderOrder = 18)); // children: Group.renderOrder doesn't reach them (menu draws at 20)
    return g;
  })();
  /** Heal: golden rings sweeping up around you. */
  private readonly healAura = new HealAura();
  private clankKey = NaN;
  private clanks = 0;
  /** Words that pop at the clash point and rise (PERFECT, RIPOSTE...). */
  private readonly floats = new FloatText();
  /** Point-aim mode: a line from your left hand showing where the arm will go (gold = on target). */
  private readonly aimLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
  );
  /** Blast projectile in flight. */
  private readonly blast = {
    alive: false,
    homing: true,
    traveled: 0,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    mesh: new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })),
  };
  private blastHitPending = false;
  /** Fatal Art: what to do (above his shoulder) and the cut to make (a red slash across his chest). */
  private readonly fatalPrompt = new CanvasPanel(768, 200, 0.5);
  private fatalPromptKey = '';
  private readonly slashMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private readonly slash = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.07), this.slashMat);
  /** Grapple wire, shown for a moment from the left hand. */
  private readonly wire = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xd8c08a, transparent: true }),
  );
  private wireT = 0;
  /** main.ts applies a graphics level (foveation, refresh rate, render scale). */
  onGraphics: (level: 'high' | 'low') => void = () => {};
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
    for (const c of this.cards) this.space.group.add(c.mesh);
    this.space.group.add(this.timeline.mesh, this.coach.mesh, this.reachArc);
    this.lockOn.add(this.chargeRing);
    scene.add(this.floats.group);
    scene.add(this.wire, this.lockOn, this.healAura.group, this.aimLine, this.blast.mesh);
    this.space.group.add(this.fatalPrompt.mesh, this.slash);
    this.aimLine.visible = false;
    this.aimLine.frustumCulled = false;
    this.blast.mesh.visible = false;
    this.fatalPrompt.mesh.visible = false;
    this.slash.renderOrder = 16;
    this.wire.visible = false;
    this.wire.frustumCulled = false;
    this.reachArc.renderOrder = 5;
    place(this.timeline.mesh, { x: -0.95, y: 0.05, z: ENEMY_DIST - 0.45 });
    place(this.coach.mesh, { x: 0.9, y: 0.05, z: ENEMY_DIST - 0.45 });
    this.timeline.mesh.visible = false;
    this.coach.mesh.visible = false;

    place(this.hud.mesh, { x: -1.0, y: -0.25, z: 1.25 });
    place(this.banner.mesh, { x: 0, y: 0.5, z: 1.4 });
    place(this.help.mesh, { x: 1.1, y: 0.0, z: 1.1 });
    place(this.enemyPanel.mesh, { x: 0, y: 0.66, z: ENEMY_DIST });
    place(this.callout.mesh, { x: 0, y: 0.95, z: ENEMY_DIST - 0.1 });
    this.status.mesh.renderOrder = 12;
    this.callout.mesh.visible = false;
    this.drawHelp();

    // Difficulty: the saved menu choice, or ?preset=1 (Lies of P-like) / ?preset=2 (Easy).
    const preset = Number(new URLSearchParams(location.search).get('preset') ?? this.settings.presetIdx);
    this.setPreset(Number.isInteger(preset) && preset >= 0 && preset < PRESETS.length ? preset : 0);
    this.enemyView.guides = this.settings.guides;
    this.pause = new PauseMenu(this.menuItems(), () => this.menuStatus(), () => this.isXR);
    const pm = this.pause.panel.mesh.material as THREE.MeshBasicMaterial;
    pm.depthTest = false; // always drawn over the frozen fight
    scene.add(this.pause.panel.mesh);
    this.newDuel(0);
    this.setPhase('calibrate', 0);
  }

  // ---------------------------------------------------------------- frame

  frame(tRaw: number, xrFrame?: XRFrame): void {
    // While the menu is open the game clock stands still, so the fight resumes exactly where it was.
    if (this.pause.isOpen && !Number.isNaN(this.lastRaw)) this.pauseOffset += tRaw - this.lastRaw;
    this.lastRaw = tRaw;
    const tIn = tRaw - this.pauseOffset;
    const t = Number.isNaN(this.lastT) ? tIn : Math.max(tIn, this.lastT + 0.1);
    const dt = Number.isNaN(this.lastT) ? 1000 / this.targetHz() : Math.min(100, t - this.lastT);
    this.lastT = t;
    this.trackFrame(dt);

    this.input.hapticScale = this.settings.haptics;
    this.input.poll(xrFrame);
    const f = this.input.frame;

    if (f.menu) {
      this.sfx.play('ui');
      if (this.pause.isOpen) this.closeMenu();
      else {
        this.pause.setItems(this.menuItems());
        this.pause.open(f.headPos, f.headQuat);
        this.lockOn.visible = false;
        this.vignette.set(f.headPos, f.headQuat, 0, 0);
      }
      return;
    }
    if (this.pause.isOpen) {
      if (this.pause.update(f)) {
        this.sfx.play('ui');
        this.input.pulse('right', 0.2, 15);
      }
      if (!this.pause.isOpen) this.resetPrev = true; // closed from inside (Resume / B)
      return;
    }

    if (f.btnB && !this.isXR && this.phase !== 'calibrate') {
      this.space.calibrate(f.headPos, f.headQuat);
      this.resetFootwork();
      this.flashResult('Recalibrated', COLORS.info, t);
    }
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
          this.openMenu('mode', t);
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

    this.updateOrbit(t);
    this.enemyView.update(this.duel, this.space, dt, this.headCurr);
    this.updateLockOn(f.headPos);
    this.healAura.update(dt);
    this.floats.update(dt, f.headPos);
    this.updateAimLine(f);
    this.updateFatalPrompt(t);
    if (this.leftHand) {
      this.leftHand.update(f.leftSqueeze, f.flaskHeld, this.drinkMs / this.tune('healMs'), dt);
      if (t >= this.wristAt) {
        this.leftHand.drawWrist(this.abilityChips(), this.drinkMs / this.tune('healMs'));
        this.wristAt = t + 150;
      }
    }
    place(this.enemyPanel.mesh, { x: this.enemyView.footX, y: 0.66, z: ENEMY_DIST + this.enemyView.footZ });
    place(this.callout.mesh, { x: this.enemyView.footX, y: 0.95, z: ENEMY_DIST + this.enemyView.footZ - 0.1 });
    if (this.wireT > 0) {
      this.wireT = Math.max(0, this.wireT - dt / 300);
      (this.wire.material as THREE.LineBasicMaterial).opacity = this.wireT;
      this.wire.visible = this.wireT > 0;
    }
    this.sword.guarding = this.settings.blockButton && f.blockHeld && f.hasSword;
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
    const trainView = this.training && this.phase === 'fight';
    this.timeline.mesh.visible = trainView;
    this.coach.mesh.visible = trainView;
    if (trainView && t >= this.trainAt) {
      this.drawTraining();
      this.trainAt = t + 66; // ~15 Hz: smooth enough for the cursor, cheap on texture uploads
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
    this.updateFootwork(t, dt);

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
    // Holding the flask: no attacking (that's the price of healing).
    if (f.hasSword && t >= this.strikeReadyAt && this.duel.enemy.state !== 'dead' && !f.flaskHeld) {
      const speed = this.prevTip.distanceTo(f.tip) / Math.max(1e-3, dt / 1000);
      const contact = this.enemyView.bodyHit(f.hilt, f.tip, this.space) || this.enemyView.bodyHit(this.prevTip, f.tip, this.space);
      if (contact && (speed > this.strikeSpeed || (!this.isXR && f.rightTrigger))) {
        strikeSpeed = Math.max(speed, 2);
        strikeZone = zoneOf(this.space.toDuel(this.enemyView.hitPoint, this.tmpV3).x);
        // A poke drives the tip along the blade's own line instead of sweeping it sideways.
        const move = this.tmp.copy(f.tip).sub(this.prevTip);
        const along = this.tmp2.copy(f.tip).sub(f.hilt).normalize();
        strikePoke = move.length() > 1e-4 && move.normalize().dot(along) > POKE_ALIGN;
      } else if (this.isXR && !contact && speed > this.strikeSpeed && t >= this.whiffAt && this.phase === 'fight') {
        // A fast swing at him that falls short: say so, and by how much.
        const short = this.enemyView.bodyDist(f.hilt, f.tip, this.space) - BODY_R;
        if (short < 0.6 && this.swordCurr.tip.z > 0.3) this.whiff(short, t);
      }
    }
    if (!this.isXR && f.rightTrigger && this.phase === 'fight' && t >= this.strikeReadyAt && !f.flaskHeld) {
      // Desktop: click = strike on the side the mouse holds the sword, if he's within your reach.
      const short = this.gapNow - this.reachR;
      if (short > 0) this.whiff(short, t);
      else {
        strikeSpeed = 3;
        strikeZone = zoneOf(this.swordCurr.tip.x);
      }
    }
    if (strikeSpeed > 0) this.strikeReadyAt = t + STRIKE_COOLDOWN_MS[f.twoHanded ? 'two' : 'one'] * this.weapon.strikeCooldownMult;

    // Dash: step left/right/toward/away from him. The view slides you; the sim gets i-frames.
    let dash: DashDir | null = null;
    if (f.dash && this.phase === 'fight' && t >= this.dashReadyAt) {
      dash = f.dash;
      this.dashReadyAt = t + this.tune('dashCooldownMs');
      const ms = this.timing.dashIframesMs; // movement lasts exactly as long as the i-frames
      const dist = this.tune('dashDistM');
      if (dash === 'left' || dash === 'right') {
        // Orbit: circle around him by that arc. The arena turns around him instead of you moving,
        // so he stays dead centre while the world swings past.
        const gap = Math.max(0.7, this.footwork.gap(this.playerZ));
        this.startOrbit(-(dash === 'right' ? 1 : -1) * (dist / gap), ms);
      } else {
        const step = { x: 0, y: 0, z: dash === 'forward' ? Math.min(dist, Math.max(0, this.footwork.gap(this.playerZ) - 0.9)) : -dist };
        DuelSpace.toLocal(step, this.tmp).applyQuaternion(this.space.group.quaternion);
        this.input.move(this.tmp, step, ms);
      }
      this.input.pulse('left', 0.3, 30);
    }
    if (this.training && f.cycle && this.phase === 'fight') {
      const i = DUMMY_MODES.findIndex((m) => m.id === this.dummyMode);
      this.setDummy(DUMMY_MODES[(i + f.cycle + DUMMY_MODES.length) % DUMMY_MODES.length].id, t);
    }

    // Block button: guards only count while it's held (menu → Block button turns it off).
    const useBtn = this.settings.blockButton;
    const held = useBtn ? f.blockHeld : undefined;
    if (useBtn && f.blockHeld && !this.blockWas) this.input.pulse('right', 0.15, 12);
    this.blockWas = useBtn && f.blockHeld;

    // Left arm (left trigger): grapple or blast, aimed at the locked-on enemy (or where the hand points).
    let grapple: 'hit' | 'miss' | null = null;
    let blastFire = false;
    const pl = this.duel.player;
    const lockAim = this.settings.armAim === 'lockon' || !this.isXR;
    const handPos = this.isXR ? f.leftPos : this.tmp3.copy(f.headPos).add(this.tmp4.set(-0.2, -0.35, 0));
    if (f.grapple && this.phase === 'fight' && this.duel.enemy.state !== 'dead') {
      const chest = this.enemyView.chestWorld(this.space, this.tmp);
      if (this.settings.leftArm === 'blast') {
        if (t >= pl.blastReadyAt && !this.blast.alive) {
          blastFire = true;
          this.fireBlast(handPos, lockAim ? this.tmp2.copy(chest).sub(handPos).normalize() : f.leftDir, lockAim);
        }
      } else if (t >= pl.grappleReadyAt) {
        const hit = lockAim ? this.gapNow < GRAPPLE_RANGE_M : this.pointsAt(f.leftPos, f.leftDir, GRAPPLE_RANGE_M, GRAPPLE_AIM_M);
        grapple = hit ? 'hit' : 'miss';
        const to = hit ? chest : this.tmp2.copy(f.leftDir).multiplyScalar(GRAPPLE_RANGE_M).add(handPos);
        this.showWire(handPos, to);
        this.sfx.play('grapple');
        this.input.pulse('left', 0.7, 60);
      }
    }
    this.updateBlast(dt);

    let ability: AbilityId | null = null;
    if (f.sigil) ability = 'slowTime';
    else if (f.ward) ability = 'ward';

    // Flask: hold the gourd at your mouth, tipped toward you, for healMs. Lower it to drink again.
    let heal = false;
    const p = this.duel.player;
    const canDrink = p.flasks > 0 || this.training;
    if (f.flaskRaised && canDrink && !this.drinkLatch && this.phase === 'fight') {
      this.drinkMs += dt;
      if (this.drinkMs >= this.tune('healMs')) {
        heal = true;
        this.drinkMs = 0;
        this.drinkLatch = true;
      }
    } else {
      this.drinkMs = Math.max(0, this.drinkMs - dt * 2);
      if (!f.flaskRaised) this.drinkLatch = false;
    }

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
      dash,
      blockHeld: held,
      outOfReach: this.gapNow > ENEMY_REACH,
      grapple,
      heal,
      fatal: f.fatal && this.phase === 'fight',
      blastFire,
      blastHit: this.consumeBlastHit(),
    });
    if (f.fatal && this.phase === 'fight' && p.fatalMeter < 100 && this.duel.enemy.state !== 'stagger') {
      this.flashResult(`Fatal Art at ${Math.floor(p.fatalMeter)}%: perfect parries and dodges fill it`, COLORS.info, t);
    }
    if (p.fatalMeter >= 100 && !this.fatalReadyShown) {
      this.fatalReadyShown = true;
      this.sfx.play('chime', 0.6);
      this.flashResult(this.isXR ? 'FATAL ART READY · press X' : 'FATAL ART READY · press X', COLORS.hit, t);
    }
    if (p.fatalMeter < 100) this.fatalReadyShown = false;
    this.sword.fatal = this.duel.time <= p.fatalArmedUntil;
    this.sword.riposte = this.duel.mech.riposte && this.duel.time <= p.riposteUntil;
    this.sword.charged = p.charged;
    // Red attack about to land: a distinct chime 400 ms out (the dodge cue).
    const ra = this.duel.currentAttack;
    const re = this.duel.enemy;
    // Mainspring: a clank on each ratchet (900/600/300 ms out); parry on the fourth beat.
    if (ra?.id === 'mainspring' && !re.struck) {
      if (this.clankKey !== re.attackStart) {
        this.clankKey = re.attackStart;
        this.clanks = 0;
      }
      const toHit = this.duel.windup(ra) - (re.clock - re.attackStart);
      const due = MAINSPRING_CLANKS_MS.filter((ms) => toHit <= ms).length;
      while (this.clanks < due) {
        this.clanks++;
        this.sfx.play('clank');
        this.input.pulse('left', 0.35, 30);
      }
    }
    if (ra && ra.perilous !== 'none' && !re.struck && this.chimeKey !== re.attackStart && this.duel.windup(ra) - (re.clock - re.attackStart) <= 400) {
      this.chimeKey = re.attackStart;
      this.sfx.play('chime');
    }
    for (const ev of this.duel.events) {
      this.playtest.onEvent(ev);
      this.onEvent(ev, t);
      if (this.training) this.trainEvent(ev);
    }

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
        this.input.pulse('right', 1, this.timing.hitStopMs); // rumble and freeze end together
        this.input.pulse('left', 0.6, this.timing.hitStopMs);
        this.sparks.burst(contact, 0xffd060, 70, 3.2);
        this.sparks.burst(contact, 0xff5030, 25, 2.2); // a red edge to the burst
        this.waves.emit(contact, 0xffd060, 0.45 + 0.1 * Math.min(4, n), 420);
        this.waves.emit(contact, 0xffffff, 0.25, 260);
        this.sword.flash(0xffc040);
        this.enemyView.react('parried', this.duel);
        this.record(ev.offsetMs!, 'perfect', []);
        this.flashResult(n > 1 ? `PERFECT ×${n} CHAIN` : 'PERFECT', COLORS.perfect, t);
        this.floats.pop(contact, n > 1 ? `PERFECT ×${n}` : 'PERFECT', COLORS.perfect);
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
        this.flashResult(ev.regain ? `BLOCK · hit back to regain ${Math.round(ev.regain)} HP` : `BLOCK · ${faultText(ev.faults)}`, COLORS[col], t);
        break;
      }
      case 'hit': {
        if (this.drinkMs > 0) this.flashResult('Drink interrupted', COLORS.hit, t);
        this.drinkMs = 0;
        this.sfx.play('hit');
        this.enemyView.react('hit', this.duel);
        this.hurtT = 1;
        this.statusAt = 0;
        this.input.pulse('right', 1, 250);
        this.input.pulse('left', 1, 250);
        this.record(ev.offsetMs ?? 0, 'hit', ev.faults ?? []);
        const need = ev.perilous === 'thrust' ? 'thrust: dodge SIDEWAYS' : 'sweep: DUCK or dash BACK';
        const wrongKind = !!ev.dodge && !!ev.attackId && !dodgeBeats(ev.dodge, (ATTACKS as Record<string, AttackDef>)[ev.attackId] ?? ATTACKS.thrust);
        const why =
          ev.perilous && ev.perilous !== 'none'
            ? ev.dodge && !wrongKind
              ? ` · dodged ${Math.round(ev.dodgeEarlyMs ?? 0)} ms early (i-frames last ${this.timing.iframesMs})`
              : ev.dodge
                ? ` · wrong dodge (${need})`
                : ` (${need})`
            : ev.faults?.includes('side')
                ? ` · block ${ev.dir === 'high' ? 'HIGH' : ev.dir?.toUpperCase()}`
                : ` · ${faultText(ev.faults)}`;
        this.flashResult(`HIT${why}`, COLORS.hit, t);
        break;
      }
      case 'dodged':
        this.enemyView.react('dodged', this.duel);
        this.dodgeT = 1;
        this.dodgeGold = !!ev.perfect;
        if (ev.perfect) {
          this.sfx.play('clash');
          this.input.pulse('right', 1, 110);
          this.input.pulse('left', 1, 110);
          this.waves.emit(this.tmp3.copy(f.headPos).add(this.tmp4.set(0, -0.2, 0)), 0xffd060, 0.9, 450);
          this.flashResult('PERFECT DODGE · COUNTER NOW!', COLORS.perfect, t);
          this.floats.pop(this.enemyView.chestWorld(this.space, this.tmp3), 'PERFECT DODGE', COLORS.perfect);
        } else {
          this.sfx.play('dodge');
          this.flashResult(ev.perilous && ev.perilous !== 'none' ? 'DODGED · early, no counter' : 'DODGED', COLORS.block, t);
        }
        break;
      case 'whiff':
        this.sfx.play('whoosh', 0.6);
        this.enemyView.react('dodged', this.duel);
        this.flashResult('OUT OF HIS REACH · he missed', COLORS.open, t);
        break;
      case 'grapple': {
        const g = ev.grapple;
        if (g === 'guardBreak' || g === 'pull' || g === 'backfire') this.pullIn();
        if (g === 'miss' || g === 'backfire') this.strikeReadyAt = Math.max(this.strikeReadyAt, t + this.timing.grappleLockMs);
        if (g === 'guardBreak') this.sparks.burst(this.enemyView.chestWorld(this.space, this.tmp3), 0xd8c08a, 20, 1.6);
        this.flashResult(
          g === 'guardBreak' ? 'GUARD TORN OPEN · STRIKE!' : g === 'pull' ? 'PULLED IN' : g === 'backfire' ? 'GRAPPLED INTO A RED ATTACK · locked' : 'GRAPPLE MISSED · locked',
          g === 'guardBreak' ? COLORS.open : g === 'pull' ? COLORS.info : COLORS.hit,
          t,
        );
        break;
      }
      case 'dodge':
        this.sfx.play('dodge', 0.35);
        break;
      case 'attackStart':
        if (ev.perilous && ev.perilous !== 'none') this.sfx.play('peril');
        if (ev.fury) {
          this.sfx.play('peril', 0.7);
          this.flashResult('FURY · perfect parry only', FURY_COLOR, t);
        }
        break;
      case 'charged':
        this.sfx.play('chime', 0.35);
        this.input.pulse('right', 0.35, 60);
        this.flashResult('CHARGED · swing to crush his posture', '#fff2d0', t);
        break;
      case 'phase2':
        this.sfx.play('spring');
        this.input.pulse('right', 0.8, 200);
        this.input.pulse('left', 0.8, 200);
        this.waves.emit(this.enemyView.chestWorld(this.space, this.tmp3), FURY_HEX, 1.2, 700);
        this.sparks.burst(this.tmp3, 0xd8b060, 50, 2.4);
        this.flashResult('HE UNWINDS · faster, and listen for three clanks', FURY_COLOR, t);
        break;
      case 'regain':
        this.sfx.play('chime', 0.3);
        this.flashResult(`+${Math.round(ev.damage ?? 0)} HP regained`, COLORS.open, t);
        this.floats.pop(this.enemyView.hitPoint, `+${Math.round(ev.damage ?? 0)} HP`, '#fff2d8');
        break;
      case 'lockout':
        this.flashResult('Flailing: perfect parry locked', COLORS.hit, t);
        break;
      case 'playerPostureBreak':
        this.flashResult('GUARD BROKEN', COLORS.hit, t);
        this.input.pulse('right', 1, 200);
        break;
      case 'enemyHit':
        if (ev.heavy) {
          this.sfx.play('finisher');
          this.input.pulse('right', 1, 160);
          this.input.pulse('left', 0.7, 160);
          this.sparks.burst(this.enemyView.hitPoint, 0xff3010, 60, 3.2);
          this.waves.emit(this.enemyView.hitPoint, 0xff3030, 0.9, 500);
          this.flashResult(`FATAL ART · ${Math.round(ev.damage ?? 0)} damage`, COLORS.hit, t);
          this.floats.pop(this.enemyView.hitPoint, `${Math.round(ev.damage ?? 0)}`, '#ff5040');
        }
        if (ev.opening) this.flashResult('OPENING · he covers that side now', COLORS.open, t);
        if (ev.riposte) {
          this.sfx.play('clash');
          this.input.pulse('right', 1, 90);
          this.sparks.burst(this.enemyView.hitPoint, 0xffd700, 50, 2.8);
          this.waves.emit(this.enemyView.hitPoint, 0xffd700, 0.7, 380);
          this.flashResult(`RIPOSTE · ${Math.round(ev.damage ?? 0)} damage`, COLORS.perfect, t);
          this.floats.pop(this.enemyView.hitPoint, 'RIPOSTE', COLORS.perfect);
        } else if (ev.charged) {
          this.input.pulse('right', 1, 120);
          this.waves.emit(this.enemyView.hitPoint, 0xfff2d0, 0.7, 380);
          this.flashResult(`CHARGED STRIKE · +${this.timing.chargePosture} posture`, '#fff2d0', t);
          this.floats.pop(this.enemyView.hitPoint, 'CRUSH', '#fff2d0');
        }
        this.sfx.play('strike');
        this.enemyView.hit();
        this.input.pulse('right', 0.6, 30);
        this.sparks.burst(this.enemyView.hitPoint, 0xff6040, 14, 1.5);
        this.waves.emit(this.enemyView.hitPoint, ev.opening ? 0x60ff9a : 0xff6040, 0.25, 220);
        break;
      case 'enemyBlock':
        // Show why the swing did nothing, and where to go instead.
        this.flashResult(
          ev.charged
            ? `CHARGED · deflected, but +${this.timing.chargePosture} posture`
            : ev.poke ? 'DEFLECTED · poke wears his posture' : ev.zone === 'center' ? 'DEFLECTED · hit his open side (green)' : 'DEFLECTED · that side is guarded',
          COLORS.info,
          t,
        );
        this.sfx.play('block', 0.5);
        this.input.pulse('right', 0.35, 25);
        this.sparks.burst(contact, 0xffffff, 6, 1);
        break;
      case 'enemyPostureBreak':
        this.footwork.stumble(this.playerZ);
        this.sfx.play('peril');
        this.waves.emit(contact, 0xffffff, 0.9, 520);
        this.waves.emit(contact, 0xffd060, 0.6, 380);
        this.flashResult('POSTURE BROKEN: STRIKE!', COLORS.perfect, t);
        break;
      case 'finisher':
        this.sfx.play('finisher');
        if (ev.heavy) {
          this.waves.emit(this.enemyView.hitPoint, 0xffd040, 1.4, 700);
          this.input.pulse('left', 1, 220);
          this.flashResult('FATAL ART · FINISHER', COLORS.hit, t);
        }
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
      case 'heal':
        this.sfx.play('perfect', 0.5);
        this.healAura.emit(f.headPos, 0);
        this.sparks.burst(this.isXR ? f.leftPos : f.headPos, 0xffd060, 30, 1.6); // the gourd bursts into light
        this.input.pulse('left', 0.6, 150);
        this.flashResult(`HEALED +${Math.round(ev.damage ?? 0)}`, COLORS.open, t);
        this.statusAt = 0;
        break;
      case 'blast':
        this.sfx.play('block', 0.9);
        this.sfx.play('strike');
        this.enemyView.hit();
        this.flashResult(ev.interrupted ? 'BLAST · swing interrupted!' : 'BLAST', ev.interrupted ? COLORS.open : COLORS.block, t);
        break;
      case 'fatalArmed':
        this.sfx.play('peril');
        this.input.pulse('right', 0.8, 80);
        this.flashResult('FATAL ART · land your next strike!', COLORS.hit, t);
        break;
      case 'practiceReset':
        this.flashResult(ev.who === 'enemy' ? 'Dummy HP refilled' : 'Your HP refilled', COLORS.info, t);
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
    this.training = false;
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
    if (menu === 'mode') {
      this.offers = MODE_OFFERS;
      this.showBanner('TRAINING OR RUN?', COLORS.info, this.isXR ? 'Touch a card with your blade, pull trigger' : 'Press 1 or 2');
    } else if (menu === 'weapon') {
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
      enemy: this.training ? dummyDef(this.dummyMode, this.drillIdx, this.speedIdx) : this.run.enemyForFight(),
      ai: this.training ? DUMMY_MODES.find((m) => m.id === this.dummyMode)!.attacks : true,
      guards: this.training ? DUMMY_MODES.find((m) => m.id === this.dummyMode)!.guards : true,
      practice: this.training,
      mods: this.run.mods,
      seed: (this.run.seed + this.run.fight * 7919) >>> 0,
      startT: t,
      playerHp: this.run.playerHp,
      mech: this.mech(),
    });
    this.enemyView.reset();
    this.resetPrev = true;
    this.tl = null;
    (this.input as { resetPosition?: () => void }).resetPosition?.();
    this.resetFootwork();
    this.setReach();
  }

  /**
   * Put him back at his home distance straight in front of you (new duel, re-centre). Done on the
   * next fight frame, once your head position has been read from this frame's input.
   */
  private resetFootwork(): void {
    this.footResetPending = true;
  }
  private footResetPending = true;

  // ---------------------------------------------------------------- spacing

  /**
   * Footwork runs in the fixed calibration frame; the view frame trails your head. So: your
   * position there, his move, then where to draw him in the view frame, how far his lunge may go,
   * and the gap that decides reach (his and yours).
   */
  private updateFootwork(t: number, dt: number): void {
    const c = this.space.centerOffset(this.tmpC);
    this.playerX = c.x + this.headCurr.x;
    this.playerZ = c.z + this.headCurr.z;
    if (this.footResetPending) {
      this.footResetPending = false;
      this.footwork.reset(this.playerX, this.playerZ);
    }
    const e = this.duel.enemy;
    this.footwork.update({ t, dtMs: dt, px: this.playerX, pz: this.playerZ, enemy: e.state, struck: e.struck });
    const gap = this.footwork.gap(this.playerZ);
    const ev = this.enemyView;
    ev.footX = this.footwork.x - c.x;
    ev.footZ = this.footwork.z - c.z - ENEMY_DIST;
    ev.lungeMax = Math.max(0, Math.min(ATTACK_LUNGE, gap - (ENEMY_DIST - ATTACK_LUNGE)));
    this.gapNow = gap - ev.lunge;
    this.updateReachArc();
  }

  /** Tip speed a swing needs to count as a strike: the handle decides (weapon assembly). */
  private get strikeSpeed(): number {
    return this.weapon.strikeSpeed ?? STRIKE_MIN_SPEED;
  }

  /** Your reach depends on the weapon: arm + blade + his body radius. */
  private setReach(): void {
    const r = ARM_M + this.weapon.bladeM + BODY_R;
    if (Math.abs(r - this.reachR) < 1e-6) return;
    this.reachR = r;
    this.reachArc.geometry.dispose();
    // An arc in front of you on the floor (RingGeometry is in XY; rotated flat, -90° points at him).
    this.reachArc.geometry = new THREE.RingGeometry(r - 0.015, r + 0.015, 48, 1, -Math.PI / 2 - 0.6, 1.2);
    this.reachArc.rotation.x = -Math.PI / 2;
  }

  private updateReachArc(): void {
    const show = this.settings.reachMarker && this.phase === 'fight' && this.duel.enemy.state !== 'dead';
    this.reachArc.visible = show;
    if (!show) return;
    DuelSpace.toLocal({ x: this.headCurr.x, y: -this.space.height + 0.012, z: this.headCurr.z }, this.reachArc.position);
    const inReach = this.gapNow <= this.reachR;
    this.reachMat.color.setHex(inReach ? 0x60ff9a : 0xffffff);
    this.reachMat.opacity = inReach ? 0.6 : 0.22;
  }

  /** A swing that fell short: whoosh, a white trail flash, and how far short. */
  private whiff(shortM: number, t: number): void {
    this.whiffAt = t + 600; // no sound: only contact makes noise
    this.trailWhiffT = 1;
    this.flashResult(`TOO FAR · ${Math.max(1, Math.round(shortM * 100))} cm short`, COLORS.info, t);
    if (this.training) this.trainStats.whiffs++;
  }

  /** Grapple hit: pull yourself toward him (never closer than GRAPPLE_STOP_GAP_M). */
  private pullIn(): void {
    const pull = Math.max(0, Math.min(GRAPPLE_PULL_M, this.footwork.gap(this.playerZ) - GRAPPLE_STOP_GAP_M));
    if (pull <= 0) return;
    const step = { x: 0, y: 0, z: pull };
    DuelSpace.toLocal(step, this.tmp3).applyQuaternion(this.space.group.quaternion);
    this.input.move(this.tmp3, step, 200);
  }

  /** Does a ray from `from` along `dir` pass within `r` of his body, inside `range`? */
  private pointsAt(from: THREE.Vector3, dir: THREE.Vector3, range: number, r: number): boolean {
    const end = this.tmp4.copy(dir).multiplyScalar(range).add(from);
    return this.enemyView.bodyDist(from, end, this.space) < r;
  }

  private fireBlast(from: THREE.Vector3, dir: THREE.Vector3, homing: boolean): void {
    const b = this.blast;
    b.alive = true;
    b.homing = homing;
    b.traveled = 0;
    b.pos.copy(from);
    b.dir.copy(dir).normalize();
    b.mesh.visible = true;
    b.mesh.position.copy(from);
    this.sfx.play('grapple', 0.7);
    this.input.pulse('left', 0.8, 50);
  }

  /** Fly the blast; lock-on shots home in on his chest. A hit is handed to the sim next step. */
  private updateBlast(dt: number): void {
    const b = this.blast;
    if (!b.alive) return;
    const step = (BLAST_SPEED * dt) / 1000;
    if (b.homing) b.dir.copy(this.enemyView.chestWorld(this.space, this.tmp4)).sub(b.pos).normalize();
    const prev = this.tmp2.copy(b.pos);
    b.pos.addScaledVector(b.dir, step);
    b.traveled += step;
    b.mesh.position.copy(b.pos);
    b.mesh.scale.setScalar(1 + 0.2 * Math.sin(b.traveled * 40));
    if (this.enemyView.bodyDist(prev, b.pos, this.space) < BLAST_HIT_M) {
      this.blastHitPending = true;
      this.sparks.burst(b.pos, 0x8fd8ff, 30, 2);
      this.waves.emit(b.pos, 0x8fd8ff, 0.45, 300);
      b.alive = false;
    } else if (b.traveled > BLAST_RANGE_M) {
      b.alive = false;
    }
    b.mesh.visible = b.alive;
  }

  private consumeBlastHit(): boolean {
    const h = this.blastHitPending;
    this.blastHitPending = false;
    return h;
  }

  /** Point-aim mode: show where the left arm will go; gold when it's on him. */
  private updateAimLine(f: InputDevice['frame']): void {
    const show = this.isXR && this.settings.armAim === 'point' && this.phase === 'fight' && !f.flaskHeld && this.duel.enemy.state !== 'dead';
    this.aimLine.visible = show;
    if (!show) return;
    const range = this.settings.leftArm === 'blast' ? BLAST_RANGE_M : GRAPPLE_RANGE_M;
    const on = this.pointsAt(f.leftPos, f.leftDir, range, this.settings.leftArm === 'blast' ? BLAST_HIT_M + 0.1 : GRAPPLE_AIM_M);
    const end = this.tmp2.copy(f.leftDir).multiplyScalar(range).add(f.leftPos);
    const pos = this.aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, f.leftPos.x, f.leftPos.y, f.leftPos.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    const m = this.aimLine.material as THREE.LineBasicMaterial;
    m.color.setHex(on ? 0xffd040 : 0xffffff);
    m.opacity = on ? 0.9 : 0.3;
  }

  /**
   * Fatal Art prompt: tells you the button when it's ready, and once armed shows the cut to make, a
   * red slash across his chest, so you know to swing through him.
   */
  private updateFatalPrompt(t: number): void {
    const d = this.duel;
    const p = d.player;
    const e = d.enemy;
    const fighting = this.phase === 'fight' && e.state !== 'dead';
    const armed = d.time <= p.fatalArmedUntil;
    const broken = e.state === 'stagger';
    const ready = p.fatalMeter >= 100;
    const key = !fighting ? '' : broken ? 'broken' : armed ? 'armed' : ready ? 'ready' : '';
    this.fatalPrompt.mesh.visible = key !== '';
    const ev = this.enemyView;
    const chestZ = ENEMY_DIST + ev.footZ - ev.lunge - 0.3;
    place(this.fatalPrompt.mesh, { x: ev.footX + 0.55, y: -0.05, z: chestZ });
    // The slash: upper right to lower left across his chest, pulsing.
    const showSlash = fighting && (armed || broken);
    this.slash.visible = showSlash;
    if (showSlash) {
      DuelSpace.toLocal({ x: ev.footX, y: -this.space.height + 1.2, z: chestZ }, this.slash.position);
      this.slash.rotation.set(0, Math.PI, 0.75);
      this.slashMat.opacity = 0.75 + 0.25 * Math.sin(t / 90);
    }
    if (key === this.fatalPromptKey) return;
    this.fatalPromptKey = key;
    if (!key) return;
    const btn = 'X';
    const [title, sub] =
      key === 'broken' ? [`${btn} · FINISH HIM`, 'or strike him: he can\'t defend'] : key === 'armed' ? ['SWING THROUGH HIM', 'follow the red cut · heavy hit'] : [`${btn} · FATAL ART`, 'ready: arms a heavy strike'];
    this.fatalPrompt.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(30,6,6,0.85)';
      roundRect(ctx, 0, 0, w, h, 26);
      ctx.fill();
      ctx.strokeStyle = '#ff5050';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = '#ff6a5a';
      ctx.font = '800 64px system-ui, sans-serif';
      ctx.fillText(title, 32, 88);
      ctx.fillStyle = '#ffd8d0';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.fillText(sub, 32, 152);
    });
  }

  /** Tuning value: an override from the menu's Tuning page, else the default. */
  private tune(key: string): number {
    return this.settings.tuning[key] ?? TUNE_DEFAULTS[key];
  }

  /** Re-apply Tuning overrides of timing fields (after a preset change). */
  private applyTuning(): void {
    const tm = this.timing as unknown as Record<string, number>;
    for (const k of TIMING_TUNE_KEYS) if (this.settings.tuning[k] !== undefined) tm[k] = this.settings.tuning[k];
  }

  private startOrbit(angle: number, ms: number): void {
    if (!this.arena) return;
    this.finishOrbit();
    this.enemyView.chestWorld(this.space, this.orbit.pivot);
    Object.assign(this.orbit, { angle, applied: 0, t0: this.lastT, ms: Math.max(60, ms) });
  }

  private finishOrbit(): void {
    if (this.orbit.t0 >= 0) this.turnArena(this.orbit.angle - this.orbit.applied);
    this.orbit.t0 = -1;
  }

  /** Ease the arena around him (ease-out, like the forward/back slide). */
  private updateOrbit(t: number): void {
    const o = this.orbit;
    if (o.t0 < 0) return;
    const k = Math.min(1, Math.max(0, t - o.t0) / o.ms);
    const target = o.angle * (1 - (1 - k) ** 3);
    this.turnArena(target - o.applied);
    o.applied = target;
    if (k >= 1) o.t0 = -1;
  }

  private turnArena(d: number): void {
    const a = this.arena;
    if (!a || d === 0) return;
    const pv = this.orbit.pivot;
    a.position.sub(this.tmp4.set(pv.x, 0, pv.z)).applyAxisAngle(UP, d).add(this.tmp4);
    a.rotation.y += d;
  }

  /** Lock-on reticle: on his chest, facing you; red during a red windup, gold when he's open. */
  private updateLockOn(head: THREE.Vector3): void {
    const d = this.duel;
    const show = this.settings.lockOn && this.phase === 'fight' && d.enemy.state !== 'dead';
    this.lockOn.visible = show;
    if (!show) return;
    const c = this.enemyView.chestWorld(this.space, this.tmp3);
    this.lockOn.position.copy(c).add(this.tmp4.copy(head).sub(c).normalize().multiplyScalar(0.12));
    this.lockOn.lookAt(head);
    const att = d.currentAttack;
    const red = !!att && att.perilous !== 'none' && !d.enemy.struck;
    const gold = d.enemy.state === 'stagger' || d.time <= d.player.counterUntil || d.time <= d.player.fatalArmedUntil;
    const fury = !!att && d.enemy.fury && !d.enemy.struck;
    this.lockMat.color.setHex(red ? 0xff3030 : fury ? 0xff7a1a : gold ? 0xffd040 : 0xffffff);
    const cp = d.chargeProgress;
    this.chargeRing.visible = cp > 0.05;
    if (this.chargeRing.visible) {
      // A brass gear ring that closes from 0.5 m to the reticle as the charge builds, then locks.
      this.chargeRing.scale.setScalar(cp >= 1 ? 1 : 3.6 - 2.6 * cp);
      this.chargeRing.rotation.z = cp >= 1 ? 0 : cp * 4;
      this.chargeMat.color.setHex(cp >= 1 ? 0xfff2d0 : 0xb5913a);
      this.chargeMat.opacity = cp >= 1 ? 0.95 : 0.35 + 0.4 * cp;
    }
    this.lockOn.scale.setScalar(red ? 1 + 0.15 * Math.sin(performance.now() / 60) : 1);
  }

  /** Your abilities: key, readiness 0..1 and a status word, for the wrist and the status strip. */
  private abilityChips(): AbilityChip[] {
    const d = this.duel;
    const p = d.player;
    const xr = this.isXR;
    const now = d.time;
    const cd = (readyAt: number, total: number): [number, string] => {
      const left = readyAt - now;
      return left <= 0 ? [1, 'ready'] : [1 - left / total, `${(left / 1000).toFixed(1)} s`];
    };
    const g = cd(p.grappleReadyAt, this.timing.grappleCooldownMs);
    const fatalArmed = now <= p.fatalArmedUntil;
    const chips: AbilityChip[] = [
      this.settings.leftArm === 'blast'
        ? (() => {
            const b = cd(p.blastReadyAt, this.timing.blastCooldownMs);
            return { key: xr ? 'LT' : 'F', name: 'Blast', ready: b[0], text: b[1], color: '#8fd8ff' };
          })()
        : { key: xr ? 'LT' : 'F', name: 'Grapple', ready: g[0], text: g[1], color: '#d8c08a' },
      {
        key: xr ? 'GRIP' : 'V',
        name: 'Flask',
        ready: p.flasks > 0 || this.training ? 1 : 0,
        text: this.training ? '∞' : `×${p.flasks}`,
        color: '#ff6a6a',
      },
      {
        key: 'X',
        name: d.enemy.state === 'stagger' ? 'Fatal: FINISH HIM' : 'Fatal Art',
        ready: fatalArmed || d.enemy.state === 'stagger' ? 1 : p.fatalMeter / 100,
        text: fatalArmed ? 'ARMED' : p.fatalMeter >= 100 ? 'READY' : `${Math.floor(p.fatalMeter)}%`,
        color: '#ff5050',
      },
    ];
    if (d.mods.abilities.includes('ward')) {
      const w = cd(p.abilityReadyAt.ward, 12000);
      chips.push({ key: xr ? 'B' : 'E', name: p.wardCharges > 0 ? 'Ward: UP' : 'Ward', ready: w[0], text: p.wardCharges > 0 ? 'up' : w[1], color: '#6fb6ff' });
    }
    if (d.mods.abilities.includes('slowTime')) {
      const s = cd(p.abilityReadyAt.slowTime, 18000);
      chips.push({ key: xr ? 'L3' : 'Q', name: 'Time Sigil', ready: s[0], text: s[1], color: '#b48cff' });
    }
    return chips;
  }

  private showWire(from: THREE.Vector3, to: THREE.Vector3): void {
    const pos = this.wire.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    this.wire.visible = true;
    this.wireT = 1;
  }
  private readonly tmp3 = new THREE.Vector3();
  private readonly tmp4 = new THREE.Vector3();
  private trailWhiffT = 0;

  // ---------------------------------------------------------------- training

  /** Training: your current weapon, a dummy that never dies, and no run to lose. */
  private startTraining(t: number): void {
    this.training = true;
    this.weapon = weaponById(this.loadout.weapon);
    this.sword.setBladeLength(this.weapon.bladeM);
    this.run = new Run((Date.now() ^ Math.floor(t)) >>> 0);
    this.run.equip(this.weapon, null);
    Object.assign(this.trainStats, { perfect: 0, block: 0, hit: 0, dodged: 0, landed: 0, deflected: 0, whiffs: 0 });
    this.newDuel(t);
    this.setPhase('fight', t);
    this.flashResult(`Training · ${this.dummyName()}`, COLORS.info, t);
  }

  private leaveTraining(t: number): void {
    this.training = false;
    this.run = new Run(1);
    this.newDuel(t);
    this.setPhase('calibrate', t);
  }

  private dummyName(): string {
    return DUMMY_MODES.find((m) => m.id === this.dummyMode)!.name;
  }

  /** Swap what the dummy does. A fresh duel, so a swing in flight never carries over. */
  private setDummy(mode: DummyMode, t: number): void {
    this.dummyMode = mode;
    Object.assign(this.trainStats, { perfect: 0, block: 0, hit: 0, dodged: 0, landed: 0, deflected: 0, whiffs: 0 });
    this.newDuel(t);
    this.flashResult(`Dummy: ${this.dummyName()}`, COLORS.info, t);
    this.sfx.play('ui');
  }

  /** Swing timeline bookkeeping and the training tally. */
  private trainEvent(ev: DuelEvent): void {
    const d = this.duel;
    const st = this.trainStats;
    const rel = (t: number) => (this.tl ? t - (this.tl.realStart + this.tl.windup) : 0);
    switch (ev.type) {
      case 'attackStart': {
        const att = d.currentAttack!;
        const e = d.enemy;
        const last = e.combo ? e.stepIndex === e.combo.steps.length - 1 : true;
        const spd = e.def.speed;
        const [title, how, color] = calloutFor(att);
        this.tl = {
          title,
          how,
          color,
          realStart: ev.t,
          windup: d.windup(att),
          after: last ? att.recoverMs / spd : (e.combo!.steps[e.stepIndex].chainDelayMs / spd),
          afterIsRecovery: last,
          perilous: att.perilous,
          perfectEarly: d.perfectEarlyMs(),
          perfectLate: this.timing.perfectLateMs,
          blockLate: this.timing.blockLateMs,
          iframes: this.timing.iframesMs + d.mods.iframesBonusMs,
          perfectDodge: this.timing.perfectDodgeMs,
          counter: null,
          now: 0,
          marks: [],
        };
        break;
      }
      case 'perfect':
        st.perfect++;
        this.tl?.marks.push({ ms: ev.offsetMs!, lane: 'guard', color: COLORS.perfect, label: 'PERFECT' });
        if (this.tl) this.tl.counter = [rel(ev.t) + this.timing.hitStopMs, rel(d.player.counterUntil)];
        break;
      case 'block':
        st.block++;
        this.tl?.marks.push({ ms: ev.offsetMs!, lane: 'guard', color: COLORS[outcomeColor('block', ev.faults)], label: faultText(ev.faults) });
        break;
      case 'hit':
        st.hit++;
        this.tl?.marks.push({ ms: ev.offsetMs ?? 0, lane: 'guard', color: COLORS.hit, label: ev.faults?.includes('side') ? 'no guard' : 'HIT' });
        break;
      case 'dodge':
        this.tl?.marks.push({ ms: rel(ev.t), lane: 'guard', color: '#60c0ff', label: ev.dodge?.startsWith('dash') ? 'dash' : 'dodge' });
        break;
      case 'dodged':
        st.dodged++;
        if (this.tl && ev.perfect) this.tl.counter = [0, rel(d.player.counterUntil)];
        break;
      case 'whiff':
        this.tl?.marks.push({ ms: 0, lane: 'guard', color: COLORS.open, label: 'out of reach' });
        break;
      case 'enemyHit':
        st.landed++;
        this.tl?.marks.push({ ms: rel(ev.t), lane: 'strike', color: COLORS.open, label: 'hit' });
        break;
      case 'enemyBlock':
        st.deflected++;
        this.tl?.marks.push({ ms: rel(ev.t), lane: 'strike', color: '#ffffff', label: 'deflected' });
        break;
    }
  }

  /** Coach: what the dummy is doing right now and what to do about it, in words. */
  private coachLines(): Array<[string, string, number]> {
    const d = this.duel;
    const e = d.enemy;
    const att = d.currentAttack;
    const C = TRAIN_COLORS;
    const out: Array<[string, string, number]> = [];
    const counterLeft = d.player.counterUntil - d.time;
    if (e.state === 'stagger') {
      out.push(['POSTURE BROKEN', C.GOLD, 44], ['Strike him now: a finisher.', C.TEXT, 30]);
    } else if (counterLeft > 0) {
      out.push(['COUNTER WINDOW', C.GOLD, 44], [`Hit him anywhere for 1.5× damage (${Math.ceil(counterLeft)} ms left).`, C.TEXT, 30]);
    } else if (att && !e.struck) {
      const left = Math.max(0, d.windup(att) - (e.clock - e.attackStart));
      if (att.perilous === 'thrust') out.push(['RED THRUST: DODGE SIDEWAYS', C.RED, 40], ['Lean or flick the left stick sideways after the chime. Last 150 ms = PERFECT (counter); earlier = safe only.', C.TEXT, 30]);
      else if (att.perilous === 'sweep') out.push(['RED SWEEP: DUCK OR DASH BACK', C.RED, 40], ['Duck or flick the left stick back after the chime. Last 150 ms = PERFECT (counter); earlier = safe only.', C.TEXT, 30]);
      else if (e.fury) out.push([att.id === 'mainspring' ? 'MAINSPRING: PERFECT PARRY HIGH' : 'FURY: PERFECT PARRY ONLY', FURY_COLOR, 40], [att.id === 'mainspring' ? 'Count the three clanks; guard high ON the fourth beat. Blocks and dodges fail.' : 'A block or dodge fails. Guard exactly as the ring turns gold, or step out of his reach.', C.TEXT, 30]);
      else {
        const [title, how] = calloutFor(att);
        const btn = this.settings.blockButton ? (this.isXR ? ' and HOLD RIGHT GRIP' : ' and HOLD SHIFT') : '';
        out.push([`BLOCK: ${title.replace(/^\S+\s+/, '')}`, C.BLUE, 40], [`${how}${btn}. Be in place and still when the ring turns gold.`, C.TEXT, 30]);
      }
      out.push([`Lands in ${Math.round(left)} ms`, C.DIM, 28]);
    } else if (att && e.struck) {
      out.push(['HE IS RECOVERING', C.GREEN, 44], ['Strike now: anything lands while he recovers.', C.TEXT, 30]);
    } else if (!d.guards) {
      out.push(['NO GUARD', C.GREEN, 44], ['Every strike lands. Try fast swings, pokes, one hand vs two hands.', C.TEXT, 30]);
    } else {
      const open = e.guardSide === 'left' ? 'RIGHT' : 'LEFT';
      const shiftIn = Math.max(0, e.guardShiftAt - e.clock);
      out.push(
        [`HE GUARDS HIS ${e.guardSide === 'left' ? 'LEFT' : 'RIGHT'}`, C.TEXT, 40],
        [`Hit his ${open} side (green ring). Hitting his sword or the middle is deflected; a poke still wears his posture.`, C.TEXT, 30],
        [`Moves his guard in ${(shiftIn / 1000).toFixed(1)} s, or right after you land a hit.`, C.DIM, 28],
      );
    }
    const inReach = this.gapNow <= this.reachR;
    out.push([
      `Distance ${this.gapNow.toFixed(2)} m · your reach ${this.reachR.toFixed(2)} m · ${inReach ? 'IN REACH' : 'step in'}${this.gapNow > ENEMY_REACH ? ' · out of his reach' : ''}`,
      inReach ? C.GREEN : C.DIM,
      26,
    ]);
    const two = this.input.frame.twoHanded;
    out.push([two ? 'TWO HANDS: steadier guard, ×1.25 damage, slower strikes' : 'ONE HAND: quick strikes, pokes ×2. Left grip on the handle = two hands', '#ffd060', 26]);
    const s = this.trainStats;
    out.push([`Perfect ${s.perfect} · Block ${s.block} · Hit ${s.hit} · Dodged ${s.dodged} · Landed ${s.landed} · Deflected ${s.deflected} · Too far ${s.whiffs}`, C.DIM, 26]);
    return out;
  }

  private drawTraining(): void {
    const d = this.duel;
    const tl = this.tl;
    if (tl) {
      const now = d.time - (tl.realStart + tl.windup);
      tl.now = now > tl.after ? null : now;
      if (tl.now === null && tl.counter === null && d.currentAttack === null) tl.now = null;
    }
    const idle = !DUMMY_MODES.find((m) => m.id === this.dummyMode)!.attacks
      ? ['This dummy doesn\'t swing.', 'Flick the right stick to pick', 'Attacking or Attack + deflect', 'to see each swing\'s timing here.']
      : ['Waiting for his first swing…'];
    drawTimeline(this.timeline, tl, idle);
    drawCoach(
      this.coach,
      `TRAINING · ${this.dummyName().toUpperCase()} · ${DUMMY_SPEEDS[this.speedIdx].name}`,
      this.coachLines(),
      this.isXR ? 'R-stick ←→ dummy · L-stick flick dash · L-trigger left arm · Y menu' : 'T dummy · arrows dash · F left arm · M menu',
    );
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
    if (this.menu === 'mode') {
      if (id === 'training') this.startTraining(t);
      else this.startRun(t);
    } else if (this.menu === 'weapon') {
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
        this.isXR ? 'Face forward, pull RIGHT TRIGGER · Y = menu & buttons' : 'Click to begin · M = menu & keys',
      );
    }
  }

  /** Difficulty preset. The live duel shares this.timing, so a change applies mid-fight. */
  private setPreset(i: number): void {
    this.presetIdx = i;
    this.settings.presetIdx = i;
    Object.assign(this.timing, PRESETS[i]);
    this.applyTuning();
    this.applyUrlOverrides();
  }

  // ---------------------------------------------------------------- pause menu

  private closeMenu(): void {
    this.pause.close();
    this.resetPrev = true; // the sword moved while paused: don't read that as a swing
  }

  private menuStatus(): string {
    const lvl = resolveQuality(this.settings.quality);
    const where =
      this.phase === 'calibrate'
        ? 'Start screen'
        : this.training
          ? `Training · ${this.dummyName()}`
          : this.phase === 'loadout'
            ? 'Loadout'
            : `Fight ${this.run.fight + 1} · ${this.duel.enemy.def.name}`;
    return `${where} · ${headsetName()} · graphics ${lvl}`;
  }

  /** Rows of the pause menu. Each setting saves as soon as it changes. */
  private menuItems(): MenuItem[] {
    const s = this.settings;
    const onOff = (v: boolean) => (v ? 'On' : 'Off');
    const save = () => saveSettings(s);
    const qualities: Quality[] = ['auto', 'high', 'low'];
    const step = <T,>(list: readonly T[], cur: T, dir: number): T => list[(Math.max(0, list.indexOf(cur)) + dir + list.length) % list.length];
    const rows: MenuItem[] = [
      { label: 'Resume', act: () => this.closeMenu() },
      { label: 'Controller buttons', hint: () => 'What every button does', act: () => this.pause.showControls() },
      ...this.trainingRows(),
      {
        label: 'Difficulty',
        value: () => this.timing.name,
        hint: () => (this.presetIdx === 2 ? 'Wide 250 ms perfect window' : this.presetIdx === 1 ? 'Tighter, faster enemies' : 'Standard timing'),
        change: (d) => {
          this.setPreset((this.presetIdx + d + PRESETS.length) % PRESETS.length);
          save();
        },
      },
      {
        label: 'Block button',
        value: () => (s.blockButton ? (this.isXR ? 'Hold right grip' : 'Hold Shift / right mouse') : 'Off'),
        hint: () => (s.blockButton ? 'Guard only counts while held; press it in time = perfect' : 'Sword position alone blocks'),
        change: () => {
          s.blockButton = !s.blockButton;
          save();
          this.drawHelp();
        },
      },
      {
        label: 'Mechanics (A/B test)',
        hint: () => {
          const m = this.mech();
          const on = (Object.keys(m) as Array<keyof Mechanics>).filter((k) => m[k]);
          return `On: ${on.join(', ') || 'none'}`;
        },
        act: () => this.pause.openSub('MECHANICS', this.mechanicsRows()),
      },
      {
        label: 'Playtest stats',
        hint: () => 'How each mechanic is going this session (A/B signals)',
        act: () => this.pause.openSub('PLAYTEST STATS', this.playtestRows()),
      },
      { label: 'Tuning', hint: () => 'Dash, dodge, parry, flask numbers (saved)', act: () => this.pause.openSub('TUNING', this.tuningRows()) },
      {
        label: 'Left arm',
        value: () => `${s.leftArm === 'blast' ? 'Blast shot' : 'Grapple'} · ${s.armAim === 'point' ? 'point' : 'lock-on'}`,
        hint: () => 'Which tool the left trigger fires, and how it aims',
        act: () =>
          this.pause.openSub('LEFT ARM', [
            { label: 'Back', act: () => this.pause.back() },
            {
              label: 'Left arm',
              value: () => (s.leftArm === 'blast' ? 'Blast shot' : 'Grapple'),
              hint: () => (s.leftArm === 'blast' ? 'Left trigger: a shot that interrupts his normal swings' : 'Left trigger: pull yourself in, tear his guard open'),
              change: () => {
                s.leftArm = s.leftArm === 'blast' ? 'grapple' : 'blast';
                save();
              },
            },
            {
              label: 'Left arm aim',
              value: () => (s.armAim === 'point' ? 'Point (aim line)' : 'Lock-on'),
              hint: () => (s.armAim === 'point' ? 'Goes where your left hand points; line turns gold on target' : 'Always goes to the enemy you are locked on to'),
              change: () => {
                s.armAim = s.armAim === 'point' ? 'lockon' : 'point';
                save();
              },
            },
          ]),
      },
      {
        label: 'Display & comfort',
        hint: () => 'Lock-on, reach arc, guides, text, rumble, graphics',
        act: () =>
          this.pause.openSub('DISPLAY & COMFORT', [
            { label: 'Back', act: () => this.pause.back() },
            {
              label: 'Lock-on marker',
              value: () => onOff(s.lockOn),
              change: () => {
                s.lockOn = !s.lockOn;
                save();
              },
            },
            {
              label: 'Reach marker',
              value: () => onOff(s.reachMarker),
              hint: () => 'Floor arc: how far your blade reaches (green = in range)',
              change: () => {
                s.reachMarker = !s.reachMarker;
                save();
              },
            },
            {
              label: 'Swing guides',
              value: () => onOff(s.guides),
              hint: () => 'Ghost sword and swing path',
              change: () => {
                s.guides = !s.guides;
                this.enemyView.guides = s.guides;
                save();
              },
            },
            {
              hidden: this.training,
              label: 'Swing names',
              value: () => (s.callouts ? 'Always' : 'Trainer only'),
              change: () => {
                s.callouts = !s.callouts;
                save();
              },
            },
            {
              label: 'Result text',
              value: () => onOff(s.results),
              hint: () => 'PERFECT / BLOCK above the enemy',
              change: () => {
                s.results = !s.results;
                save();
              },
            },
            {
              label: 'Rumble',
              value: () => (s.haptics <= 0 ? 'Off' : s.haptics < 1 ? 'Low' : 'Full'),
              change: (d) => {
                s.haptics = step([0, 0.5, 1], s.haptics, d);
                save();
                this.input.hapticScale = s.haptics;
                this.input.pulse('right', 0.6, 60);
              },
            },
            {
              label: 'Graphics',
              value: () => (s.quality === 'auto' ? `Auto (${resolveQuality('auto')})` : s.quality === 'high' ? 'High' : 'Low'),
              hint: () => (this.isXR ? 'Low suits Quest 1 / 2 · sharpness changes next time you enter VR' : 'Low suits Quest 1 / 2'),
              change: (d) => {
                s.quality = step(qualities, s.quality, d);
                save();
                this.onGraphics(resolveQuality(s.quality));
              },
            },
          ]),
      },
      {
        label: 'Re-center arena',
        hint: () => 'Face forward first',
        act: () => {
          const f = this.input.frame;
          this.space.calibrate(f.headPos, f.headQuat);
          this.resetFootwork();
          this.closeMenu();
        },
      },
      this.training
        ? { label: 'Leave training', hint: () => 'Back to the start screen', act: () => (this.closeMenu(), this.leaveTraining(this.lastT)) }
        : {
            label: 'New run',
            hint: () => 'Back to weapon and relic choice',
            act: () => {
              this.closeMenu();
              if (this.phase !== 'calibrate') this.startRun(this.lastT);
            },
          },
    ];
    return rows.filter((r) => !r.hidden);
  }

  /** Playtest readout: one signal per toggled mechanic, live while the menu is open. */
  private playtestRows(): MenuItem[] {
    const rows = this.playtest.summary();
    return [
      { label: 'Back', act: () => this.pause.back() },
      ...rows.map((r, i) => ({ label: r.label, value: () => this.playtest.summary()[i].value, hint: () => r.hint })),
      {
        label: 'Reset stats',
        hint: () => 'Start a new A/B run (e.g. after switching a mechanic)',
        act: () => this.playtest.reset(),
      },
    ];
  }

  /** Mechanic toggles in force: defaults overlaid with the player's choices. */
  private mech(): Mechanics {
    return { ...MECH_DEFAULTS, ...this.settings.mech };
  }

  /**
   * The Mechanics page: switch each experimental mechanic on/off (applies at once, saved), with its
   * key number beside it, so two versions can be compared in one session.
   */
  private mechanicsRows(): MenuItem[] {
    const s = this.settings;
    const tm = this.timing as unknown as Record<string, number>;
    const toggle = (k: keyof Mechanics, label: string, hint: string): MenuItem => ({
      label,
      hint: () => hint,
      value: () => (this.mech()[k] ? 'ON' : 'off'),
      change: () => {
        s.mech = { ...s.mech, [k]: !this.mech()[k] };
        this.duel.mech[k] = this.mech()[k]; // applies to the current fight too
        saveSettings(s);
      },
    });
    const num = (k: string, label: string, step: number, min: number, max: number, unit: string): MenuItem => ({
      label: `   ${label}`,
      value: () => (unit === '%' ? `${Math.round(tm[k] * 100)} %` : `${Math.round(tm[k] * 100) / 100} ${unit}`),
      change: (d) => {
        const v = Math.round(Math.min(max, Math.max(min, tm[k] + d * step)) * 1000) / 1000;
        s.tuning[k] = tm[k] = v;
        saveSettings(s);
      },
    });
    return [
      { label: 'Back', act: () => this.pause.back() },
      toggle('feints', 'Feints (delayed swings)', 'Some windups hold an extra beat: watch the release, not the rhythm'),
      num('feintChance', 'how often', 0.05, 0, 1, '%'),
      num('feintMaxMs', 'longest hold', 25, 100, 800, 'ms'),
      toggle('fury', 'Fury swings (parry only)', 'Ember-orange glow: block and dodge fail, only a PERFECT parry (or distance) works'),
      num('furyChance', 'how often', 0.05, 0, 1, '%'),
      toggle('riposte', 'Riposte', 'Strike within the gold glint after a perfect: critical hit'),
      num('riposteMs', 'window', 25, 100, 1000, 'ms'),
      toggle('charge', 'Charged strike', 'Hold the sword still (block released) to charge a posture-crushing strike'),
      num('chargeMs', 'charge time', 100, 300, 3000, 'ms'),
      toggle('guardRegain', 'Guard Regain', 'Blocks cost HP (ivory on your bar); hit him soon to win it back'),
      num('regainMs', 'regain time', 250, 500, 6000, 'ms'),
      toggle('spamLock', 'Spam lockout', 'Flailing the guard locks perfect parries for a moment'),
      toggle('phase2', 'Phase 2 (half HP)', 'He sheds his coat: faster, more feints and Fury, Winding Stair string, Mainspring signature'),
      {
        label: 'All mechanics to defaults',
        act: () => {
          s.mech = {};
          Object.assign(this.duel.mech, MECH_DEFAULTS);
          saveSettings(s);
        },
      },
    ];
  }

  /** The Tuning page: every row steps a number left/right and saves it at once. */
  private tuningRows(): MenuItem[] {
    const s = this.settings;
    const tm = this.timing as unknown as Record<string, number>;
    const get = (k: string) => (TIMING_TUNE_KEYS.includes(k) ? tm[k] : this.tune(k));
    const num = (k: string, label: string, step: number, min: number, max: number, unit: string, hint: () => string): MenuItem => ({
      label,
      hint,
      value: () => `${unit === 'm' ? get(k).toFixed(2) : Math.round(get(k))} ${unit}`,
      change: (d) => {
        const v = Math.round(Math.min(max, Math.max(min, get(k) + d * step)) * 1000) / 1000;
        s.tuning[k] = v;
        if (TIMING_TUNE_KEYS.includes(k)) tm[k] = v;
        saveSettings(s);
      },
    });
    const speed = () => `dash speed ${(this.tune('dashDistM') / (this.timing.dashIframesMs / 1000)).toFixed(1)} m/s`;
    return [
      { label: 'Back', act: () => this.pause.back() },
      num('dashIframesMs', 'Dash i-frames = dash time', 10, 100, 600, 'ms', () => `The dash moves for exactly this long · ${speed()}`),
      num('dashDistM', 'Dash distance', 0.05, 0.2, 2.0, 'm', speed),
      num('dashCooldownMs', 'Dash cooldown', 25, 150, 1500, 'ms', () => 'Minimum time between dashes'),
      num('perfectDodgeMs', 'Perfect dodge window', 10, 30, 300, 'ms', () => 'Dodge this close to the hit = perfect'),
      num('iframesMs', 'Lean / duck i-frames', 10, 100, 600, 'ms', () => 'Physical dodges'),
      num('perfectEarlyMs', 'Perfect parry: early', 5, 40, 300, 'ms', () => 'How early before the hit a guard can be'),
      num('perfectLateMs', 'Perfect parry: late', 5, 0, 120, 'ms', () => 'How late after the hit'),
      num('hitStopMs', 'Parry freeze (hit-stop)', 10, 0, 250, 'ms', () => 'Enemy freeze on a perfect; rumble matches'),
      num('grappleCooldownMs', 'Grapple cooldown', 250, 500, 10000, 'ms', () => 'Left trigger'),
      num('healMs', 'Heal time', 50, 0, 3000, 'ms', () => 'Gourd held above your head this long'),
      num('blastCooldownMs', 'Blast cooldown', 250, 500, 10000, 'ms', () => 'Left arm: blast shot'),
      num('healAmount', 'Heal per drink', 5, 5, 100, 'HP', () => 'Flasks per fight: 3'),
      num('fatalArmMs', 'Fatal Art armed time', 250, 500, 6000, 'ms', () => 'How long X keeps your strike heavy'),
      {
        label: 'Reset all to defaults',
        act: () => {
          s.tuning = {};
          saveSettings(s);
          this.setPreset(this.presetIdx);
        },
      },
    ];
  }

  /** Weapon page (training): a preset, or "Assembled" with Blade and Handle rows. */
  private weaponRows(): MenuItem[] {
    const cyc = (i: number, d: number, n: number) => (i + d + n) % n;
    const rows: MenuItem[] = [
      { label: 'Back', act: () => this.pause.back() },
      {
        label: 'Weapon',
        value: () => (this.weapon.id.startsWith('asm:') ? 'Assembled' : this.weapon.name),
        hint: () => (this.weapon.id.startsWith('asm:') ? 'Pick a blade and a handle below' : 'Blade length, damage and strike speed; or Assembled'),
        change: (d) => {
          // Presets, then "Assembled" (blade + handle).
          const ids = [...WEAPONS.map((w) => w.id), this.lastAssembly];
          const cur = this.weapon.id.startsWith('asm:') ? ids.length - 1 : ids.indexOf(this.weapon.id);
          this.equipTraining(ids[cyc(cur, d, ids.length)]);
        },
      },
      ...(['blade', 'handle'] as const).map((part): MenuItem => {
        const list = part === 'blade' ? BLADES : HANDLES;
        const idx = () => {
          const [, b, h] = this.weapon.id.split(':');
          return Math.max(0, list.findIndex((x) => x.id === (part === 'blade' ? b : h)));
        };
        return {
          label: part === 'blade' ? '   Blade' : '   Handle',
          hidden: !this.weapon.id.startsWith('asm:'),
          value: () => list[idx()].name,
          hint: () => this.weapon.desc,
          change: (d) => {
            const [, b, h] = this.weapon.id.split(':');
            const next = list[cyc(idx(), d, list.length)].id;
            this.equipTraining(part === 'blade' ? `asm:${next}:${h}` : `asm:${b}:${next}`);
          },
        };
      }),
    ];
    return rows.filter((r) => !r.hidden);
  }

  /** Last assembled weapon, so cycling through the presets comes back to it. */
  private lastAssembly = 'asm:edge:wrapped';

  /** Swap the training weapon and restart the dummy fight with it (same dummy mode). */
  private equipTraining(id: string): void {
    if (id.startsWith('asm:')) this.lastAssembly = id;
    this.loadout.weapon = id;
    saveLoadout(this.loadout);
    const mode = this.dummyMode;
    this.startTraining(this.lastT);
    this.dummyMode = mode;
    this.pause.setItems(this.weaponRows()); // Blade/Handle rows appear or hide
    this.pause.redraw();
  }

  /** Training rows: what the dummy does, which swings, how fast, and your weapon. */
  private trainingRows(): MenuItem[] {
    const t = () => this.lastT;
    const cyc = (i: number, d: number, n: number) => (i + d + n) % n;
    if (!this.training) {
      return [{ label: 'Training mode', hint: () => 'Practise on a dummy that never dies', act: () => (this.closeMenu(), this.startTraining(t())) }];
    }
    return [
      {
        label: 'Dummy',
        value: () => this.dummyName(),
        hint: () => DUMMY_MODES.find((m) => m.id === this.dummyMode)!.desc,
        change: (d) => this.setDummy(DUMMY_MODES[cyc(DUMMY_MODES.findIndex((m) => m.id === this.dummyMode), d, DUMMY_MODES.length)].id, t()),
      },
      {
        label: 'Swings',
        value: () => DRILLS[this.drillIdx].name,
        hint: () => 'Which attacks he throws (when attacking)',
        change: (d) => {
          this.drillIdx = cyc(this.drillIdx, d, DRILLS.length);
          this.newDuel(t());
        },
      },
      {
        label: 'Enemy speed',
        value: () => DUMMY_SPEEDS[this.speedIdx].name,
        hint: () => 'Slow = the Trainer, Fast = the last enemy',
        change: (d) => {
          this.speedIdx = cyc(this.speedIdx, d, DUMMY_SPEEDS.length);
          this.newDuel(t());
        },
      },
      {
        label: 'Weapon',
        value: () => this.weapon.name,
        hint: () => 'Presets, or assemble a blade + handle',
        act: () => this.pause.openSub('WEAPON', this.weaponRows()),
      },
    ];
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
      brassFrame(ctx, 0, 0, w, h, 0.8);
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
        return `${a === 'slowTime' ? 'L-stick press Time' : 'X Ward'}: ${left > 0 ? left.toFixed(0) + 's' : 'ready'}`;
      });
      if (ab.length) ctx.fillText(ab.join('   '), 32, 625);
      ctx.fillStyle = '#7c8594';
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillText(this.isXR ? 'A: hide panel · B: re-center · Y: menu & settings' : 'H: hide panel · R: re-center · M: menu & settings', 32, 680);
    });
  }

  /** Big, plain-language controls card. The sword does everything; buttons are only for menus. */
  private drawHelp(): void {
    const xr = this.isXR;
    this.help.draw((ctx, w, h) => {
      brassFrame(ctx, 0, 0, w, h, 0.88);
      let y = 70;
      const line = (text: string, font: string, color: string, gap: number) => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.fillText(text, 40, y);
        y += gap;
      };
      line('HOW TO PLAY', '800 54px system-ui, sans-serif', '#ffffff', 52);
      line(xr ? 'No button to block or attack. Your sword does it.' : 'Your mouse is the sword. Nothing to press to block.', '500 30px system-ui, sans-serif', '#9aa3b0', 70);

      const btn = this.settings.blockButton;
      line(btn ? (xr ? 'BLOCK: ghost sword + HOLD RIGHT GRIP' : 'BLOCK: ghost sword + HOLD SHIFT') : 'BLOCK: match the glowing ghost sword', '700 36px system-ui, sans-serif', COLORS.block, 46);
      line(btn ? 'Blade glows blue while held. Press it when the ring' : 'A ring closes on it. Be there when it turns GOLD,', '500 29px system-ui, sans-serif', '#d8dce4', 38);
      line(btn ? 'turns GOLD, sword in place and still = PERFECT.' : 'then hold still until the swing lands.', '500 29px system-ui, sans-serif', COLORS.perfect, 50);
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
        xr ? 'Y = MENU (every button) · L-stick flick = DASH · L-trigger = LEFT ARM' : 'M = MENU (every key) · arrows = DASH · F = LEFT ARM',
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
      brassFrame(ctx, 0, 0, w, h, 0.8);
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
      if (p.regain > 0) {
        // Guard Regain: the recoverable chunk, ivory, right after your HP; it drains as time runs out.
        const left = Math.max(0, Math.min(1, (p.regainUntil - d.time) / this.timing.regainMs));
        const x0 = 26 + (w - 52) * (p.hp / p.hpMax);
        ctx.fillStyle = `rgba(255,248,230,${0.35 + 0.5 * left})`;
        ctx.fillRect(x0, 70, (w - 52) * (p.regain / p.hpMax), 22);
      }
      pill(ctx, 26, 108, w - 52, 18, pf, pf > 0.75 ? '#ff5a1a' : '#ffb020');
      // Abilities under the bars, so cooldowns are visible without looking at your wrist.
      drawChipRow(ctx, this.abilityChips().slice(0, 4), 18, 150, w - 36, 100);
    });
  }

  /** Above the enemy's head: name, HP, posture (what perfects fill), chain and frenzy badges. */
  private drawEnemyPanel(t: number): void {
    const d = this.duel;
    const e = d.enemy;
    const pf = Math.min(1, e.posture / e.def.postureMax);
    const frenzy = d.frenzy();
    this.enemyPanel.draw((ctx, w) => {
      // Brass-and-glass gauges, gently curved (Belle Epoque instrument look; Gemini mock-up 2026-11-16).
      const cx = w / 2;
      const R = 2200;
      const half = Math.asin(440 / R);
      const arc = (cy: number, r: number, from: number, to: number) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, from, to);
        ctx.stroke();
      };
      const tube = (top: number, thick: number, f: number, color: string) => {
        const cy = top + R;
        const a0 = -Math.PI / 2 - half;
        const a1 = -Math.PI / 2 + half;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#b5913a'; // brass casing
        ctx.lineWidth = thick + 10;
        arc(cy, R, a0, a1);
        ctx.strokeStyle = '#17120e'; // dark glass
        ctx.lineWidth = thick;
        arc(cy, R, a0, a1);
        const ff = Math.max(0, Math.min(1, f));
        if (ff > 0.005) {
          ctx.strokeStyle = color;
          ctx.lineWidth = thick - 8;
          arc(cy, R, a0, a0 + 2 * half * ff);
          ctx.strokeStyle = 'rgba(255,255,255,0.28)'; // glass highlight along the top
          ctx.lineWidth = thick * 0.18;
          arc(cy, R - thick * 0.22, a0, a0 + 2 * half * ff);
        }
      };
      ctx.textAlign = 'center';
      ctx.font = '600 36px Georgia, "Times New Roman", serif';
      ctx.fillStyle = 'rgba(10,8,6,0.55)';
      const name = e.def.name.toUpperCase();
      const nw = ctx.measureText(name).width;
      roundRect(ctx, cx - nw / 2 - 22, 4, nw + 44, 46, 23);
      ctx.fill();
      ctx.fillStyle = '#f2ede0';
      ctx.fillText(name, cx, 40);
      ctx.textAlign = 'left';
      // Badges either side of the name.
      let x = cx + nw / 2 + 34;
      const badge = (text: string, color: string) => {
        ctx.font = '800 28px system-ui, sans-serif';
        const bw = ctx.measureText(text).width + 26;
        ctx.fillStyle = color;
        roundRect(ctx, x, 6, bw, 42, 21);
        ctx.fill();
        ctx.fillStyle = '#10131a';
        ctx.fillText(text, x + 13, 37);
        x += bw + 10;
      };
      if (d.player.chain > 1) badge(`×${d.player.chain} CHAIN`, COLORS.perfect);
      if (frenzy) badge(frenzy.belowHp < 0.3 ? 'FRENZY!' : 'FRENZY', `rgba(255,80,80,${0.75 + 0.25 * Math.sin(t / 120)})`);
      tube(78, 34, e.hp / e.def.hp, '#c62a2a');
      const broken = e.state === 'stagger';
      tube(128, 24, broken ? 1 : pf, broken ? `rgba(255,255,255,${0.75 + 0.25 * Math.sin(t / 90)})` : pf > 0.75 ? '#ff5a1a' : '#e0a020');
      if (broken) {
        ctx.textAlign = 'center';
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.fillStyle = '#17120e';
        ctx.fillText('BROKEN · STRIKE NOW', cx, 137);
        ctx.textAlign = 'left';
      }
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
    const teach = this.settings.callouts || this.run.fight === 0 || this.training;
    // Must-dodge attacks are always named: they arrive after the Trainer and can't be blocked.
    const swing = this.phase === 'fight' && !!att && (teach || att.perilous !== 'none' || !!att.fury) && e.state === 'attack' && !e.struck;
    const result = !swing && this.settings.results && t - this.lastResult.t < 1100;
    const k = swing ? `${att!.id}@${e.attackStart}` : result ? `r${this.lastResult.t}` : '';
    this.callout.mesh.visible = swing || result;
    if (!this.callout.mesh.visible || k === this.calloutKey) return;
    this.calloutKey = k;
    const [title, how, color] = swing ? calloutFor(att!) : [this.lastResult.text, '', this.lastResult.color];
    this.callout.draw((ctx, w) => {
      brassFrame(ctx, how ? 0 : 120, how ? 0 : 20, how ? w : w - 240, how ? 170 : 110, 0.8);
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
      color = this.dodgeGold ? 0xffc040 : 0x60c0ff; // perfect dodge gold, plain dodge cool blue
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
    if (this.isXR && f.hasSword && speed > this.strikeSpeed && (this.phase === 'fight' || this.phase === 'won')) {
      const counter = this.duel.time <= this.duel.player.counterUntil || this.duel.enemy.state === 'stagger';
      this.tmp2.copy(f.hilt).lerp(f.tip, 0.45);
      this.trailWhiffT = Math.max(0, this.trailWhiffT - dt / 400);
      this.playerTrail.push(this.tmp2, f.tip, this.trailClock, counter ? 0xffd060 : this.trailWhiffT > 0 ? 0xffffff : 0xcfe6ff);
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
      brassFrame(ctx, 0, 0, w, h, 0.8);
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
  if (a.id === 'mainspring') return ['MAINSPRING', 'Three clanks · PERFECT parry HIGH on the 4th beat', FURY_COLOR];
  if (a.perilous === 'thrust') return ['THRUST', 'Lean or dash sideways!', COLORS.hit];
  if (a.perilous === 'sweep') return ['SWEEP', 'Duck or dash back!', COLORS.hit];
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

