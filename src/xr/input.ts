import * as THREE from 'three';
import type { DashDir, V3 } from '../core/types';
import type { DuelSpace } from '../render/duelSpace';
import { LEFT_GRIP_SPOT_M } from '../render/views';
import type { SwordView } from '../render/views';

// Two-handed grip: squeeze the left grip with that hand on the handle, LEFT_GRIP_SPOT_M behind the right.
/** Left hand within this distance (m) of the grip spot, grip held, for ENGAGE_HOLD_MS, takes the grip. */
const ENGAGE_M = 0.15;
const ENGAGE_HOLD_MS = 150;
/** Hands drift this much (m) closer or further apart than when the grip was taken: let go. */
const SLIP_M = 0.1;
/** Show the target ring when the left hand is this close (m). */
const HINT_M = 0.35;
/** How far the blade aims along the two-hand line (0 = right controller only, 1 = the line only).
 *  Below 1 so the right wrist still steers the blade. */
const AIM_BLEND = 0.7;
const AIM_RAMP_MS = 150;

/** Everything the game needs from input for one frame. Edge flags are true only on the press frame. */
export interface InputFrame {
  headPos: THREE.Vector3;
  headQuat: THREE.Quaternion;
  hilt: THREE.Vector3;
  tip: THREE.Vector3;
  hasSword: boolean;
  rightTrigger: boolean;
  leftTrigger: boolean;
  leftGrip: boolean;
  /** Left hand is on the handle (two-handed grip). */
  twoHanded: boolean;
  /** Left X button (Ward). */
  btnX: boolean;
  btnA: boolean;
  btnB: boolean;
  btnY: boolean;
  /** Open/close the menu: Y or left thumbstick press (desktop: M or Esc). */
  menu: boolean;
  /** Thumbstick flicks (either stick) as menu steps: -1 / 0 / +1. Up is -1. Desktop: arrow keys. */
  navX: number;
  navY: number;
  /** Menu confirm: right trigger or A (desktop: click, Enter or Space). */
  select: boolean;
  /** Dash: flick the left stick (desktop: arrow keys). Up = toward the enemy. */
  dash: DashDir | null;
  /** Right stick flick left/right (desktop: T): switch training dummy. */
  cycle: number;
  /** Desktop: a pickup card chosen by number key / click (0-2), else -1. */
  choose: number;
}

export interface InputDevice {
  readonly frame: InputFrame;
  poll(xrFrame: XRFrame | undefined): void;
  pulse(hand: 'left' | 'right', intensity: number, ms: number): void;
  /** Rumble strength multiplier from the menu (0 = off). */
  hapticScale: number;
  /** Move the player: `world` is the step in world space, `duel` the same step in duel coordinates. */
  move(world: THREE.Vector3, duel: V3): void;
}

/** How long a dash takes (ms). Short enough to read as a step, long enough not to feel like a teleport. */
const DASH_MS = 140;
/** A dash never takes you further than this from where you started (m), so you stay in the arena. */
const MAX_TRAVEL_M = 2.5;

/** Stick position -> -1 / 0 / +1 with hysteresis, so holding a stick is one step, not many. */
const stepOf = (v: number, last: number) => (Math.abs(v) > 0.6 ? Math.sign(v) : Math.abs(v) < 0.3 ? 0 : last);

function emptyFrame(): InputFrame {
  return {
    headPos: new THREE.Vector3(0, 1.6, 0),
    headQuat: new THREE.Quaternion(),
    hilt: new THREE.Vector3(),
    tip: new THREE.Vector3(),
    hasSword: false,
    rightTrigger: false,
    leftTrigger: false,
    leftGrip: false,
    twoHanded: false,
    btnX: false,
    btnA: false,
    btnB: false,
    btnY: false,
    menu: false,
    navX: 0,
    navY: 0,
    select: false,
    dash: null,
    cycle: 0,
    choose: -1,
  };
}

// ---------------------------------------------------------------------------
// WebXR (Quest controllers)

export class XRInput implements InputDevice {
  readonly frame = emptyFrame();
  private readonly prev = { rt: false, lt: false, lg: false, x: false, a: false, b: false, y: false, ls: false };
  /** Stick directions last frame (left x/y, right x/y), so one flick = one step. */
  private readonly sticks = [0, 0, 0, 0];
  hapticScale = 1;

  // Dash locomotion: an offset reference space slides the player through the world.
  private xrSession: XRSession | null = null;
  private baseRef: XRReferenceSpace | null = null;
  private readonly offset = new THREE.Vector3();
  private readonly moveFrom = new THREE.Vector3();
  private readonly moveTo = new THREE.Vector3();
  private moveT0 = -1;
  private readonly grips: THREE.Group[] = [];
  private rightGrip: THREE.Group | null = null;
  private leftGripObj: THREE.Group | null = null;

  // Two-handed grip state.
  private nearSince = -1;
  private gripDist = 0;
  /** Left hand's offset from the right hand at grip time, in the right controller's frame. */
  private readonly gripOffset = new THREE.Vector3();
  private aimW = 0;
  private lastT = 0;
  private readonly lp = new THREE.Vector3();
  private readonly rp = new THREE.Vector3();
  private readonly spot = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly rq = new THREE.Quaternion();
  private readonly rqInv = new THREE.Quaternion();
  private readonly aimQ = new THREE.Quaternion();
  private readonly blendQ = new THREE.Quaternion();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly sword: SwordView,
  ) {
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      scene.add(grip);
      this.grips.push(grip);
      grip.addEventListener('connected', (e: { data?: XRInputSource }) => {
        if (e.data?.handedness === 'right') {
          this.rightGrip = grip;
          grip.add(this.sword.root);
          this.sword.attachToGrip();
        } else if (e.data?.handedness === 'left') {
          this.leftGripObj = grip;
        }
      });
      grip.addEventListener('disconnected', () => {
        if (this.leftGripObj === grip) this.leftGripObj = null;
        if (this.rightGrip === grip) {
          this.rightGrip = null;
          grip.remove(this.sword.root);
        }
      });
    }
  }

  poll(xrFrame: XRFrame | undefined): void {
    const f = this.frame;
    const session = this.renderer.xr.getSession();
    const ref = this.renderer.xr.getReferenceSpace();
    if (!session || !ref || !xrFrame) return;

    // Head: read the viewer pose directly from this frame (same time base as the controllers).
    const vp = xrFrame.getViewerPose(ref);
    if (vp) {
      const p = vp.transform.position;
      const o = vp.transform.orientation;
      f.headPos.set(p.x, p.y, p.z);
      f.headQuat.set(o.x, o.y, o.z, o.w);
    }

    if (session !== this.xrSession) {
      // New session: three.js made a fresh reference space; dashes offset from that.
      this.xrSession = session;
      this.baseRef = ref;
      this.offset.set(0, 0, 0);
      this.moveT0 = -1;
    }
    let rt = false, lt = false, lg = false, x = false, a = false, b = false, y = false, ls = false;
    const axes = [0, 0, 0, 0];
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const pressed = (i: number) => !!gp.buttons[i]?.pressed;
      // xr-standard: axes[2], axes[3] are the thumbstick (Quest 1/2/3 Touch controllers all match).
      const o = src.handedness === 'left' ? 0 : src.handedness === 'right' ? 2 : -1;
      if (o >= 0) {
        axes[o] = gp.axes[2] ?? 0;
        axes[o + 1] = gp.axes[3] ?? 0;
      }
      if (src.handedness === 'right') {
        rt = pressed(0);
        a = pressed(4);
        b = pressed(5);
      } else if (src.handedness === 'left') {
        lt = pressed(0);
        lg = pressed(1);
        x = pressed(4);
        y = pressed(5);
        ls = pressed(3);
      }
    }
    // Sword: three.js already updated the grip poses for this frame before our callback.
    f.hasSword = !!this.rightGrip && this.rightGrip.visible;
    const now = performance.now();
    const dt = Math.min(100, now - (this.lastT || now));
    this.lastT = now;
    if (f.hasSword) {
      this.updateTwoHand(lg, now, dt);
      this.sword.bladeWorld(f.hilt, f.tip);
    }

    const pv = this.prev;
    f.rightTrigger = rt && !pv.rt;
    f.leftTrigger = lt && !pv.lt;
    f.leftGrip = lg && !pv.lg;
    f.btnX = x && !pv.x;
    f.btnA = a && !pv.a;
    f.btnB = b && !pv.b;
    f.btnY = y && !pv.y;
    f.menu = (y && !pv.y) || (ls && !pv.ls);
    f.select = (rt && !pv.rt) || (a && !pv.a);
    Object.assign(pv, { rt, lt, lg, x, a, b, y, ls });
    // Flicks: a stick leaving the centre. Either stick moves through menus; in a fight the left
    // stick dashes and the right stick switches the training dummy.
    const flick = axes.map((v, i) => {
      const s = stepOf(v, this.sticks[i]);
      const edge = s !== this.sticks[i] ? s : 0;
      this.sticks[i] = s;
      return edge;
    });
    f.navX = flick[0] || flick[2];
    f.navY = flick[1] || flick[3];
    f.cycle = flick[2];
    f.dash = null;
    if (flick[0] || flick[1]) {
      const ax = axes[0], ay = axes[1];
      f.dash = Math.abs(ax) > Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : ay < 0 ? 'forward' : 'back';
    }
    this.applyMove(now);
    f.choose = -1;
  }

  /**
   * Two-handed grip: take it by squeezing the left grip near the handle; drop it by letting go or
   * pulling the hands apart. While held, the blade turns about the right hand toward the line
   * between the hands, so the left hand steadies it like a real two-handed hilt.
   */
  private updateTwoHand(gripHeld: boolean, now: number, dt: number): void {
    const f = this.frame;
    const left = this.leftGripObj;
    this.sword.setAim(null); // measure from the raw right controller
    if (!left || !left.visible || !this.rightGrip) {
      this.setTwoHanded(false);
      this.nearSince = -1;
      this.aimW = 0;
      this.sword.setGrip(false, 0);
      return;
    }
    left.getWorldPosition(this.lp);
    this.rightGrip.getWorldPosition(this.rp);
    this.rightGrip.getWorldQuaternion(this.rq);
    const d = this.lp.distanceTo(this.sword.axisPoint(LEFT_GRIP_SPOT_M, this.spot));
    const handGap = this.lp.distanceTo(this.rp);

    if (!f.twoHanded) {
      if (gripHeld && d < ENGAGE_M) {
        if (this.nearSince < 0) this.nearSince = now;
        if (now - this.nearSince >= ENGAGE_HOLD_MS) {
          this.gripDist = handGap;
          this.gripOffset.copy(this.lp).sub(this.rp).applyQuaternion(this.rqInv.copy(this.rq).invert());
          this.setTwoHanded(true);
        }
      } else {
        this.nearSince = -1;
      }
    } else if (!gripHeld || Math.abs(handGap - this.gripDist) > SLIP_M) {
      this.setTwoHanded(false);
      this.nearSince = -1;
    }

    // Aim: rotate from where the left hand would be if both hands moved as one, to where it is.
    // At the moment of gripping the two match, so taking the grip never jerks the blade.
    this.aimW += ((f.twoHanded ? AIM_BLEND : 0) - this.aimW) * Math.min(1, dt / AIM_RAMP_MS);
    if (this.aimW > 0.001) {
      const expected = this.v.copy(this.gripOffset).applyQuaternion(this.rq).normalize();
      const actual = this.lp.sub(this.rp).normalize();
      // Nearly opposite means tracking glitched or the hands swapped ends: leave the aim alone.
      if (expected.dot(actual) > -0.5) {
        this.aimQ.setFromUnitVectors(expected, actual);
        this.sword.setAim(this.blendQ.identity().slerp(this.aimQ, this.aimW));
      }
    }
    this.sword.setGrip(f.twoHanded, Math.max(0, Math.min(1, (HINT_M - d) / (HINT_M - ENGAGE_M))));
  }

  private setTwoHanded(on: boolean): void {
    const f = this.frame;
    if (f.twoHanded === on) return;
    f.twoHanded = on;
    if (on) {
      this.pulse('left', 0.5, 40);
      this.pulse('right', 0.5, 40);
    } else {
      this.pulse('left', 0.25, 25);
    }
  }

  /** Dash: slide the player by `world` over DASH_MS (the duel space then re-centres the enemy on you). */
  move(world: THREE.Vector3): void {
    if (!this.baseRef) return;
    this.moveFrom.copy(this.offset);
    this.moveTo.copy(this.offset).add(world);
    this.moveTo.y = 0;
    if (this.moveTo.length() > MAX_TRAVEL_M) this.moveTo.setLength(MAX_TRAVEL_M);
    this.moveT0 = performance.now();
  }

  /**
   * Applied at the end of poll, so this whole frame used one reference space and next frame's
   * head, controllers and camera all see the new position together.
   */
  private applyMove(now: number): void {
    if (this.moveT0 < 0 || !this.baseRef) return;
    const k = Math.min(1, (now - this.moveT0) / DASH_MS);
    this.offset.lerpVectors(this.moveFrom, this.moveTo, 1 - (1 - k) ** 3); // ease out: fast start
    // Poses in the new space = poses in the base space minus the origin, so moving +d means origin -d.
    const o = this.offset;
    this.renderer.xr.setReferenceSpace(this.baseRef.getOffsetReferenceSpace(new XRRigidTransform({ x: -o.x, y: 0, z: -o.z })));
    if (k >= 1) this.moveT0 = -1;
  }

  pulse(hand: 'left' | 'right', intensity: number, ms: number): void {
    const session = this.renderer.xr.getSession();
    if (!session || this.hapticScale <= 0) return;
    for (const src of session.inputSources) {
      if (src.handedness !== hand) continue;
      const act = src.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (v: number, ms: number) => Promise<boolean> } | undefined;
      void act?.pulse?.(Math.min(1, intensity * this.hapticScale), ms);
    }
  }
}

// ---------------------------------------------------------------------------
// Desktop fallback: mouse = sword, keys = dodge/abilities. For quick checks without a headset.
//   Mouse left/right/up/down of centre -> left/right/high/low guard. Click = strike.
//   A / D = lean, S = duck, Q = slow time, E = ward, G = two-handed grip, 1-6 = pick a card,
//   R = recalibrate, M / Esc = menu (arrows + Enter inside it), arrows = dash, T = next dummy.

export class DesktopInput implements InputDevice {
  readonly frame = emptyFrame();
  private mx = 0;
  private my = -0.2;
  private click = false;
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private lean = new THREE.Vector3();
  /** Dash offset in duel coordinates: jumps out, then drifts back as the enemy re-centres on you. */
  private readonly dashTarget = { x: 0, z: 0 };
  private readonly dashCur = { x: 0, z: 0 };
  private readonly base = new THREE.Vector3(0, 1.6, 0);
  private readonly v = { x: 0, y: 0, z: 0 };

  constructor(
    dom: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly space: DuelSpace,
    private readonly sword: SwordView,
  ) {
    dom.addEventListener('pointermove', (e) => {
      const r = dom.getBoundingClientRect();
      this.mx = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.my = -(((e.clientY - r.top) / r.height) * 2 - 1);
    });
    dom.addEventListener('pointerdown', () => (this.click = true));
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressedKeys.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  /** Test/automation hook: set the virtual mouse in -1..1 coordinates. */
  setMouse(x: number, y: number): void {
    this.mx = x;
    this.my = y;
  }

  poll(): void {
    const f = this.frame;
    // Head: lean/duck with keys, eased so the dodge detector sees real velocity.
    const tx = this.keys.has('a') ? -0.3 : this.keys.has('d') ? 0.3 : 0;
    const ty = this.keys.has('s') ? -0.35 : 0;
    this.lean.x += (tx - this.lean.x) * 0.35;
    this.lean.y += (ty - this.lean.y) * 0.35;
    const dc = this.dashCur, dtg = this.dashTarget;
    dtg.x *= 0.975; // ~0.7 s back to centre at 60 fps, like DuelSpace.follow in VR
    dtg.z *= 0.975;
    dc.x += (dtg.x - dc.x) * 0.45;
    dc.z += (dtg.z - dc.z) * 0.45;
    this.v.x = this.lean.x + dc.x;
    this.v.y = this.lean.y;
    this.v.z = dc.z;
    if (this.space.calibrated) this.space.toWorld(this.v, f.headPos);
    else f.headPos.copy(this.base);
    this.camera.position.copy(f.headPos);
    f.headQuat.copy(this.camera.quaternion);

    // Sword from mouse, in duel coordinates, oriented per region so all four guards are reachable.
    // Guards are measured from the current head, so the sword moves with a lean.
    const x = this.mx * 0.55 + this.lean.x + dc.x;
    const y = -0.55 + this.my * 0.55;
    let h: { x: number; y: number; z: number };
    let t: { x: number; y: number; z: number };
    if (y > -0.28) {
      h = { x: x - 0.4, y, z: 0.4 }; // high: horizontal blade overhead
      t = { x: x + 0.4, y, z: 0.4 };
    } else if (y < -0.8) {
      h = { x, y: y + 0.05, z: 0.3 }; // low: tip down and forward
      t = { x, y: y - 0.15, z: 0.65 };
    } else {
      h = { x, y: y - 0.4, z: 0.35 }; // side: vertical blade
      t = { x, y: y + 0.4, z: 0.35 };
    }
    h.z += dc.z;
    t.z += dc.z;
    if (this.space.calibrated) {
      this.space.toWorld(h, f.hilt);
      this.space.toWorld(t, f.tip);
      this.sword.placeFrom(f.hilt, f.tip);
    }
    f.hasSword = this.space.calibrated;

    const pk = this.pressedKeys;
    f.rightTrigger = this.click;
    f.leftTrigger = pk.has('q');
    f.leftGrip = false;
    f.btnX = pk.has('e');
    if (pk.has('g')) f.twoHanded = !f.twoHanded; // desktop stand-in for the left hand on the handle
    this.sword.setGrip(f.twoHanded, 0);
    f.btnA = pk.has('h');
    f.btnB = pk.has('r');
    f.btnY = false; // Y opens the menu in VR; on desktop that's M (see f.menu)
    f.choose = ['1', '2', '3', '4', '5', '6'].findIndex((k) => pk.has(k));
    f.menu = pk.has('m') || pk.has('escape');
    f.navX = pk.has('arrowleft') ? -1 : pk.has('arrowright') ? 1 : 0;
    f.navY = pk.has('arrowup') ? -1 : pk.has('arrowdown') ? 1 : 0;
    f.dash = f.navX < 0 ? 'left' : f.navX > 0 ? 'right' : f.navY < 0 ? 'forward' : f.navY > 0 ? 'back' : null;
    f.cycle = pk.has('t') ? 1 : 0;
    f.select = this.click || pk.has('enter') || pk.has(' ');
    pk.clear();
    this.click = false;
  }

  pulse(): void {}
  hapticScale = 1;

  move(_world: THREE.Vector3, duel: V3): void {
    this.dashTarget.x += duel.x;
    this.dashTarget.z += duel.z;
  }
}
