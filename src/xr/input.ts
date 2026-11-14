import * as THREE from 'three';
import type { DuelSpace } from '../render/duelSpace';
import type { SwordView } from '../render/views';

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
  btnA: boolean;
  btnB: boolean;
  btnY: boolean;
  /** Desktop: a pickup card chosen by number key / click (0-2), else -1. */
  choose: number;
}

export interface InputDevice {
  readonly frame: InputFrame;
  poll(xrFrame: XRFrame | undefined): void;
  pulse(hand: 'left' | 'right', intensity: number, ms: number): void;
}

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
    btnA: false,
    btnB: false,
    btnY: false,
    choose: -1,
  };
}

// ---------------------------------------------------------------------------
// WebXR (Quest controllers)

export class XRInput implements InputDevice {
  readonly frame = emptyFrame();
  private readonly prev = { rt: false, lt: false, lg: false, a: false, b: false, y: false };
  private readonly grips: THREE.Group[] = [];
  private rightGrip: THREE.Group | null = null;

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
        }
      });
      grip.addEventListener('disconnected', () => {
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

    // Sword: three.js already updated the grip poses for this frame before our callback.
    f.hasSword = !!this.rightGrip && this.rightGrip.visible;
    if (f.hasSword) this.sword.bladeWorld(f.hilt, f.tip);

    let rt = false, lt = false, lg = false, a = false, b = false, y = false;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const pressed = (i: number) => !!gp.buttons[i]?.pressed;
      if (src.handedness === 'right') {
        rt = pressed(0);
        a = pressed(4);
        b = pressed(5);
      } else if (src.handedness === 'left') {
        lt = pressed(0);
        lg = pressed(1);
        y = pressed(5);
      }
    }
    const pv = this.prev;
    f.rightTrigger = rt && !pv.rt;
    f.leftTrigger = lt && !pv.lt;
    f.leftGrip = lg && !pv.lg;
    f.btnA = a && !pv.a;
    f.btnB = b && !pv.b;
    f.btnY = y && !pv.y;
    Object.assign(pv, { rt, lt, lg, a, b, y });
    f.choose = -1;
  }

  pulse(hand: 'left' | 'right', intensity: number, ms: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    for (const src of session.inputSources) {
      if (src.handedness !== hand) continue;
      const act = src.gamepad?.hapticActuators?.[0] as unknown as { pulse?: (v: number, ms: number) => Promise<boolean> } | undefined;
      void act?.pulse?.(intensity, ms);
    }
  }
}

// ---------------------------------------------------------------------------
// Desktop fallback: mouse = sword, keys = dodge/abilities. For quick checks without a headset.
//   Mouse left/right/up/down of centre -> left/right/high/low guard. Click = strike.
//   A / D = lean, S = duck, Q = slow time, E = ward, 1-3 = pick reward, R = recalibrate, P = preset.

export class DesktopInput implements InputDevice {
  readonly frame = emptyFrame();
  private mx = 0;
  private my = -0.2;
  private click = false;
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private lean = new THREE.Vector3();
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
    this.v.x = this.lean.x;
    this.v.y = this.lean.y;
    this.v.z = 0;
    if (this.space.calibrated) this.space.toWorld(this.v, f.headPos);
    else f.headPos.copy(this.base);
    this.camera.position.copy(f.headPos);
    f.headQuat.copy(this.camera.quaternion);

    // Sword from mouse, in duel coordinates, oriented per region so all four guards are reachable.
    // Guards are measured from the current head, so the sword moves with a lean.
    const x = this.mx * 0.55 + this.lean.x;
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
    if (this.space.calibrated) {
      this.space.toWorld(h, f.hilt);
      this.space.toWorld(t, f.tip);
      this.sword.placeFrom(f.hilt, f.tip);
    }
    f.hasSword = this.space.calibrated;

    const pk = this.pressedKeys;
    f.rightTrigger = this.click;
    f.leftTrigger = pk.has('q');
    f.leftGrip = pk.has('e');
    f.btnA = pk.has('h');
    f.btnB = pk.has('r');
    f.btnY = pk.has('p');
    f.choose = pk.has('1') ? 0 : pk.has('2') ? 1 : pk.has('3') ? 2 : -1;
    pk.clear();
    this.click = false;
  }

  pulse(): void {}
}
