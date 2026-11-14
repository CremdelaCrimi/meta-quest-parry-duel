import * as THREE from 'three';
import type { Duel } from '../core/sim';
import type { AttackDef, SwordPose, V3 } from '../core/types';
import { ATTACK_LUNGE, DuelSpace, ENEMY_DIST } from './duelSpace';
import { RiggedEnemy } from './riggedEnemy';

const D = ENEMY_DIST;
const UP = new THREE.Vector3(0, 1, 0);
const FWD_NEG = new THREE.Vector3(0, 0, -1);

// ---------------------------------------------------------------------------
// Player sword

export const BLADE_START = 0.12;
export const BLADE_END = 1.0;
/** Tilt of the blade relative to the controller grip (degrees). Tune if the sword feels angled wrong. */
export const SWORD_TILT_DEG = -20;

export class SwordView {
  /** Positioned at the grip (XR) or at the hilt (desktop). Blade runs along local -z. */
  readonly root = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly bladeMat: THREE.MeshStandardMaterial;
  private flashT = 0;

  constructor() {
    this.inner.rotation.x = THREE.MathUtils.degToRad(SWORD_TILT_DEG);
    this.root.add(this.inner);

    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.9, roughness: 0.25, emissive: 0x000000 });
    const len = BLADE_END - BLADE_START;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, len), this.bladeMat);
    blade.position.z = -(BLADE_START + len / 2);
    this.inner.add(blade);

    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0x8a6d2f, metalness: 0.7, roughness: 0.4 }));
    guard.rotation.x = Math.PI / 2;
    guard.position.z = -BLADE_START + 0.006;
    this.inner.add(guard);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 10), dark);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -BLADE_START + 0.11;
    this.inner.add(handle);
  }

  /** World positions of the blade's base and tip. */
  bladeWorld(hilt: THREE.Vector3, tip: THREE.Vector3): void {
    this.root.updateMatrixWorld(true);
    hilt.set(0, 0, -BLADE_START);
    tip.set(0, 0, -BLADE_END);
    this.inner.localToWorld(hilt);
    this.inner.localToWorld(tip);
  }

  /** XR mode: sword sits in the grip with its tilt. */
  attachToGrip(): void {
    this.inner.rotation.x = THREE.MathUtils.degToRad(SWORD_TILT_DEG);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
  }

  /** Desktop mode: place the whole sword from a hilt->tip direction (world). */
  placeFrom(hilt: THREE.Vector3, tip: THREE.Vector3): void {
    const dir = tip.clone().sub(hilt).normalize();
    this.inner.rotation.x = 0;
    this.root.position.copy(hilt).addScaledVector(dir, -BLADE_START);
    this.root.quaternion.setFromUnitVectors(FWD_NEG, dir);
  }

  flash(color: number): void {
    this.bladeMat.emissive.setHex(color);
    this.flashT = 1;
  }

  update(dtMs: number): void {
    if (this.flashT <= 0) return;
    this.flashT = Math.max(0, this.flashT - dtMs / 180);
    this.bladeMat.emissiveIntensity = this.flashT * 2;
  }
}

// ---------------------------------------------------------------------------
// Enemy

type Key = [number, number, number, number, number, number]; // hilt xyz, tip xyz (core duel frame)
const key = (k: Key): SwordPose => ({ hilt: { x: k[0], y: k[1], z: k[2] }, tip: { x: k[3], y: k[4], z: k[5] } });

// Enemy sword key poses, in the player's duel frame (head = origin, +z toward enemy, +x = player's right).
// A swing is a curve: windup (raised, held as the telegraph) -> mid (control point that bends the
// path into an arc) -> strike (blade crossing exactly where the player's matching guard sits).
type SwingKeys = { windup: SwordPose; mid: SwordPose; strike: SwordPose };
const REST = key([0.0, -0.55, D - 0.45, 0.05, -0.35, D - 1.2]);
// Idle guard: sword upright on one side of his body (player's view). The other side is open.
const IDLE_GUARD: Record<'left' | 'right', SwordPose> = {
  left: key([-0.2, -0.5, D - 0.4, -0.3, 0.25, D - 0.55]),
  right: key([0.2, -0.5, D - 0.4, 0.3, 0.25, D - 0.55]),
};
const STAGGER = key([0.15, -0.95, D - 0.3, 0.35, -1.4, D - 0.6]);
const mirror = (k: Key): Key => [-k[0], k[1], k[2], -k[3], k[4], k[5]];
const keys = (w: Key, m: Key, s: Key): SwingKeys => ({ windup: key(w), mid: key(m), strike: key(s) });
const both = (name: string, w: Key, m: Key, s: Key) => ({
  [`${name}-left`]: keys(w, m, s),
  [`${name}-right`]: keys(mirror(w), mirror(m), mirror(s)),
});
const straight = (w: Key, s: Key): SwingKeys => keys(w, w.map((v, i) => (v + s[i]) / 2) as Key, s);

const KEYS: Record<string, SwingKeys> = {
  // Vertical: sword straight up and back, then chops down onto your head.
  'vertical-high': keys([0, 0.35, D - 0.25, 0, 1.05, D + 0.1], [0, 0.55, D - 0.6, 0, 0.75, D - 1.35], [0, 0.18, 1.0, 0, 0.05, 0.2]),
  // Horizontal: sword pulled back wide at chest height, sweeps level in from that side.
  ...both('horizontal', [-0.5, -0.15, D - 0.15, -1.15, -0.1, D + 0.25], [-0.7, -0.2, D - 0.4, -1.45, -0.22, D - 0.95], [-0.7, -0.25, 1.0, -0.15, -0.25, 0.3]),
  // Diagonal: sword raised over that shoulder, cuts down and across.
  ...both('diagonal', [-0.45, 0.35, D - 0.2, -0.95, 0.95, D + 0.15], [-0.65, 0.35, D - 0.5, -1.2, 0.55, D - 1.1], [-0.65, 0.05, 1.0, -0.12, -0.4, 0.3]),
  // Not used by the current enemies.
  low: straight([0.4, -0.65, D - 0.2, 0.85, -0.9, D + 0.25], [0.45, -0.8, 1.0, -0.15, -0.95, 0.3]),
  thrust: straight([0.2, -0.3, D + 0.15, 0.2, -0.22, D - 0.6], [0.05, -0.2, 0.85, 0.0, -0.1, 0.0]),
  sweep: straight([0.6, 0.05, D - 0.25, 1.15, 0.15, D + 0.1], [-0.35, 0.02, 0.95, -0.7, 0.02, 0.1]),
};

/** Which keyframe set an attack uses. */
export function kindOf(a: AttackDef): string {
  if (a.perilous !== 'none') return a.perilous;
  if (a.dir === 'low') return 'low';
  const swing = a.swing ?? (a.dir === 'high' ? 'vertical' : 'horizontal');
  return a.dir === 'high' ? 'vertical-high' : `${swing === 'vertical' ? 'horizontal' : swing}-${a.dir}`;
}

/**
 * Where the player should hold the sword (right hand) to block each direction, relative to the
 * head. These are textbook poses for classifyGuard: flat overhead, or upright on that side.
 */
const GUARD_GHOST: Record<string, SwordPose> = {
  high: key([0.3, 0.15, 0.38, -0.45, 0.2, 0.38]), // above the forehead, not across the eyes
  left: key([-0.3, -0.55, 0.35, -0.3, 0.2, 0.4]),
  right: key([0.32, -0.55, 0.35, 0.32, 0.2, 0.4]),
  low: key([0.2, -0.85, 0.3, 0.1, -1.05, 0.7]),
};
/**
 * Impact ring, centred where your blade should cross the attack (middle of the ghost sword):
 * radius when it appears and when it locks (m), and how long it takes to close (ms, enemy clock),
 * ending exactly as the perfect window opens. 400 ms ~ comfortable reaction runway.
 */
// Gemini suggested 0.3 m; at arm's length (~0.4 m away) that fills half the view, so it's halved.
const RING_START_M = 0.16;
const RING_END_M = 0.05;
const RING_LEAD_MS = 400;

/** Enemy blade length (m); interpolated poses are renormalised so the sword never stretches. */
const ENEMY_BLADE_M = 0.85;
/** Duration of the committed swing (enemy-clock ms). Long enough to follow by eye, capped at half the windup. */
const SWING_MS = 320;

/**
 * Swing progress 0..1 (linear in time) -> how far along the arc the blade is (0..1).
 * Shapes how the swing reads: linear looks robotic, a strong ease-in looks like a snap.
 */
function swingEase(f: number): number {
  // TODO(human): shape the swing. f = 0 is the end of the telegraph, f = 1 is impact.
  return f * f;
}

/** Pose along a swing's arc: quadratic Bezier through windup -> (mid) -> strike, fixed blade length. */
function swingPose(out: SwordPose, k: SwingKeys, f: number): SwordPose {
  bez3(out.hilt, k.windup.hilt, k.mid.hilt, k.strike.hilt, f);
  bez3(out.tip, k.windup.tip, k.mid.tip, k.strike.tip, f);
  return fixLength(out, ENEMY_BLADE_M);
}
function bez3(o: V3, a: V3, m: V3, b: V3, t: number): void {
  const u = 1 - t;
  o.x = u * u * a.x + 2 * u * t * m.x + t * t * b.x;
  o.y = u * u * a.y + 2 * u * t * m.y + t * t * b.y;
  o.z = u * u * a.z + 2 * u * t * m.z + t * t * b.z;
}
function fixLength(p: SwordPose, len: number): SwordPose {
  const dx = p.tip.x - p.hilt.x;
  const dy = p.tip.y - p.hilt.y;
  const dz = p.tip.z - p.hilt.z;
  const s = len / Math.max(1e-6, Math.hypot(dx, dy, dz));
  p.tip.x = p.hilt.x + dx * s;
  p.tip.y = p.hilt.y + dy * s;
  p.tip.z = p.hilt.z + dz * s;
  return p;
}

function lerpPoseInto(out: SwordPose, a: SwordPose, b: SwordPose, t: number): void {
  lerp3(out.hilt, a.hilt, b.hilt, t);
  lerp3(out.tip, a.tip, b.tip, t);
}
function lerp3(o: V3, a: V3, b: V3, t: number): void {
  o.x = a.x + (b.x - a.x) * t;
  o.y = a.y + (b.y - a.y) * t;
  o.z = a.z + (b.z - a.z) * t;
}
function copyPose(o: SwordPose, a: SwordPose): void {
  lerpPoseInto(o, a, a, 0);
}

export class EnemyView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a, emissive: 0x000000 });
  private readonly bladeMat = new THREE.MeshStandardMaterial({ color: 0xe8edf5, metalness: 0.4, roughness: 0.35, emissive: 0xffffff });
  private readonly blade: THREE.Mesh;
  private readonly arms: THREE.Mesh[] = [];
  private readonly perilMark: THREE.Mesh;
  private readonly deathMark: THREE.Mesh;
  private readonly postureBar: THREE.Mesh;
  private readonly hpBar: THREE.Mesh;
  private readonly postureMat = new THREE.MeshBasicMaterial({ color: 0xffb020 });

  private readonly pose: SwordPose = key([0, 0, 0, 0, 0, 0]);
  private readonly target: SwordPose = key([0, 0, 0, 0, 0, 0]);
  private hitFlash = 0;
  private deadT = 0;

  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();

  constructor() {
    this.root.add(this.body);
    const m = this.bodyMat;
    const sash = new THREE.MeshLambertMaterial({ color: 0x8a1c1c });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      this.body.add(mesh);
      return mesh;
    };
    // Body is built floor-relative (y=0 at the floor) at the enemy's position.
    add(new THREE.CylinderGeometry(0.17, 0.2, 0.9, 12), m, 0, 0.45);
    add(new THREE.CylinderGeometry(0.21, 0.17, 0.65, 12), m, 0, 1.22);
    add(new THREE.CylinderGeometry(0.205, 0.205, 0.08, 12), sash, 0, 0.93);
    add(new THREE.SphereGeometry(0.12, 16, 12), m, 0, 1.66);
    add(new THREE.CylinderGeometry(0.0, 0.32, 0.12, 16), new THREE.MeshLambertMaterial({ color: 0x6b5a3a }), 0, 1.79); // hat

    const armGeo = new THREE.CylinderGeometry(0.045, 0.04, 1, 8);
    armGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(armGeo, m);
      this.root.add(arm);
      this.arms.push(arm);
    }
    const bladeGeo = new THREE.BoxGeometry(0.022, 1, 0.055);
    bladeGeo.translate(0, 0.5, 0);
    this.blade = new THREE.Mesh(bladeGeo, this.bladeMat);
    this.root.add(this.blade);

    this.perilMark = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 8, 24), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.root.add(this.perilMark);
    this.deathMark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff1010 }));
    this.root.add(this.deathMark);

    const barGeo = new THREE.PlaneGeometry(1, 1);
    barGeo.translate(0.5, 0, 0);
    this.postureBar = new THREE.Mesh(barGeo, this.postureMat);
    this.hpBar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xc02828 }));
    for (const b of [this.postureBar, this.hpBar]) {
      b.rotation.y = Math.PI; // face the player
      this.root.add(b);
    }

    // "Block here": a thin glowing ghost sword at the guard the attack needs, and an impact ring
    // that closes on its middle so the timing reads at a glance.
    const ghostGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 10); // a blade core, not a wall
    ghostGeo.translate(0, 0.5, 0);
    this.ghost = new THREE.Mesh(ghostGeo, this.ghostMat);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 48), this.ringMat);
    this.pathMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.pathMat);
    this.pathMesh.frustumCulled = false;
    for (const o of [this.ghost, this.ring, this.pathMesh]) {
      o.renderOrder = 15; // after the HUD panels (10), which don't write depth, so guides are never hidden
      o.visible = false;
      this.root.add(o);
    }
    copyPose(this.pose, REST);
  }

  private readonly ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly pathMat = new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  private readonly ghost: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly pathMesh: THREE.Mesh;
  private readonly pathGeos = new Map<string, THREE.BufferGeometry>();
  private readonly ghostPose: SwordPose = key([0, 0, 0, 0, 0, 0]);

  /** The swept surface of a swing (hilt-to-tip ribbon along its arc), built once per kind. */
  private pathGeo(kind: string): THREE.BufferGeometry {
    let g = this.pathGeos.get(kind);
    if (g) return g;
    const N = 24;
    const pos = new Float32Array((N + 1) * 2 * 3);
    const p = key([0, 0, 0, 0, 0, 0]);
    for (let i = 0; i <= N; i++) {
      swingPose(p, KEYS[kind], i / N);
      // Inner edge at 35% of the blade (where it leaves the hand), outer at the tip.
      lerp3(this.tmpV3, p.hilt, p.tip, 0.35);
      DuelSpace.toLocal(this.tmpV3, this.v1).toArray(pos, i * 6);
      DuelSpace.toLocal(p.tip, this.v1).toArray(pos, i * 6 + 3);
    }
    const idx: number[] = [];
    for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.pathGeos.set(kind, g);
    return g;
  }
  private readonly tmpV3: V3 = { x: 0, y: 0, z: 0 };

  /**
   * Telegraph aids for the current attack: the swing's path (faint, brightening), and where to
   * block it (ghost sword plus a closing impact ring). Both turn gold when the perfect-parry window
   * opens, i.e. when your guard should arrive. Hidden for must-dodge attacks.
   */
  private updateGuide(duel: Duel, head: V3): void {
    const att = duel.currentAttack;
    const e = duel.enemy;
    const on = !!att && e.state === 'attack' && !e.struck && this.guides;
    const block = on && att!.perilous === 'none';
    this.pathMesh.visible = on;
    this.ghost.visible = this.ring.visible = block;
    if (!on) return;
    const a = att!;
    const p = Math.min(1, Math.max(0, duel.attackProgress()));
    this.pathMesh.geometry = this.pathGeo(kindOf(a));
    this.pathMat.color.setHex(a.perilous !== 'none' ? 0xff3030 : 0xbfe0ff);
    this.pathMat.opacity = 0.05 + 0.2 * p * p;
    if (!block) return;

    // Ghost follows the head (guards are judged relative to it).
    const g = GUARD_GHOST[a.dir];
    const gp = this.ghostPose;
    copyPose(gp, g);
    for (const v of [gp.hilt, gp.tip]) {
      v.x += head.x;
      v.z += head.z;
    }
    placeSegment(this.ghost, DuelSpace.toLocal(gp.hilt, this.v1), DuelSpace.toLocal(gp.tip, this.v2), this.v3);
    this.ghost.scale.x = this.ghost.scale.z = 1;
    // Impact ring: closes from RING_START_M to just around the ghost over RING_LEAD_MS, landing
    // exactly when the perfect window opens; then it holds there in gold until the strike.
    lerp3(this.tmpV3, gp.hilt, gp.tip, 0.5);
    DuelSpace.toLocal(this.tmpV3, this.ring.position);
    const toStrike = (1 - p) * duel.windup(a);
    const toWindow = toStrike - duel.perfectEarlyMs();
    const inWindow = toWindow <= 0;
    const k = Math.min(1, Math.max(0, toWindow / RING_LEAD_MS));
    this.ring.scale.setScalar(RING_END_M + (RING_START_M - RING_END_M) * k);
    this.ring.visible = toWindow < RING_LEAD_MS;
    const col = inWindow ? 0xffd34d : 0x7fe0ff;
    this.ghostMat.color.setHex(col);
    this.ringMat.color.setHex(col);
    this.ghostMat.opacity = inWindow ? 0.95 : 0.3 + 0.4 * p;
    this.ringMat.opacity = inWindow ? 1 : 0.25 + 0.6 * (1 - k);
  }

  /** Show the swing path and "block here" ghost (on by default; ?guides=0 hides them). */
  guides = true;

  reset(): void {
    copyPose(this.pose, REST);
    this.deadT = 0;
    this.body.rotation.set(0, 0, 0);
    this.root.visible = true;
  }

  hit(): void {
    this.hitFlash = 1;
  }

  private rigged: RiggedEnemy | null = null;

  /** Swap the procedural body for a rigged model. Keeps the procedural one if anything fails. */
  async useRigged(manifestUrl: string): Promise<void> {
    try {
      this.rigged = await RiggedEnemy.load(manifestUrl, this.bladeMat);
      this.root.add(this.rigged.root);
      this.body.visible = this.blade.visible = false;
      for (const a of this.arms) a.visible = false;
    } catch (err) {
      console.info('[enemy] using procedural enemy:', (err as Error).message);
    }
  }

  /** Current step-in toward the player (m), eased so combos never snap. */
  private lunge = 0;
  private readonly trail = new SwingTrail();
  private trailClock = 0;
  /** One pip per hit in the current pattern (1, 2 or 3), lit as each hit lands. */
  private readonly pips = [0, 1, 2].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial()));

  private updatePips(e: Duel['enemy'], space: DuelSpace, Dz: number): void {
    const n = e.state === 'attack' && e.combo ? e.combo.steps.length : 0;
    this.pips.forEach((pip, i) => {
      if (!pip.parent) this.root.add(pip);
      pip.visible = i < n;
      if (!pip.visible) return;
      DuelSpace.toLocal({ x: (i - (n - 1) / 2) * 0.09, y: -space.height + 2.13, z: Dz }, pip.position);
      const done = i < e.stepIndex || (i === e.stepIndex && e.struck);
      const mat = pip.material as THREE.MeshBasicMaterial;
      mat.color.setHex(done ? 0xffd34d : i === e.stepIndex ? 0xffffff : 0x555a66);
    });
  }

  /** Record the blade's sweep from late windup to just after the strike; it lingers and fades. */
  private updateTrail(duel: Duel, dtMs: number): void {
    this.trailClock += dtMs;
    if (!this.trail.mesh.parent) this.root.add(this.trail.mesh);
    const e = duel.enemy;
    const att = duel.currentAttack;
    const blade = this.rigged?.blade ?? this.blade;
    if (att && e.state === 'attack') {
      const since = e.clock - e.attackStart;
      const w = duel.windup(att);
      if (since > w * 0.55 && since < w + 220) {
        blade.updateWorldMatrix(true, false);
        const inner = this.root.worldToLocal(blade.localToWorld(this.v1.set(0, 0.35, 0)));
        const outer = this.root.worldToLocal(blade.localToWorld(this.v2.set(0, 1, 0)));
        this.trail.push(inner, outer, this.trailClock, att.perilous !== 'none' ? 0xff3030 : 0xbfe0ff);
      }
    }
    this.trail.update(this.trailClock);
  }

  /** World positions of the enemy blade's base and tip. */
  bladeWorld(base: THREE.Vector3, tip: THREE.Vector3): void {
    const blade = this.rigged?.blade ?? this.blade;
    blade.updateWorldMatrix(true, false);
    blade.localToWorld(base.set(0, 0, 0));
    blade.localToWorld(tip.set(0, 1, 0));
  }

  /** Swept test: does the segment a->b (world) pass within `r` of the enemy body axis? */
  bodyHit(a: THREE.Vector3, b: THREE.Vector3, space: DuelSpace, r = 0.27): boolean {
    const z = D - this.lunge;
    const feet = space.toWorld({ x: 0, y: -space.height + 0.2, z }, this.v1);
    const head = space.toWorld({ x: 0, y: -space.height + 1.7, z }, this.v2);
    if (segSegDist(a, b, feet, head) >= r) return false;
    this.hitPoint.copy(a).lerp(b, segS); // where the blade first met him, for the strike zone
    return true;
  }
  /** World point on the player's blade closest to his body at the last bodyHit. */
  readonly hitPoint = new THREE.Vector3();

  // Opening marker: a soft green glow on the side of his body a strike gets through on,
  // gold over the chest while a counter is open. Hidden while he's swinging (all hits land then)
  // and while broken (the red finisher mark shows instead).
  private readonly openMat = new THREE.MeshBasicMaterial({ color: 0x60ff9a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly openMark = (() => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 32), this.openMat);
    m.renderOrder = 15;
    return m;
  })();
  private openPulse = 0;
  private openX = 0;

  private updateOpening(duel: Duel, space: DuelSpace, Dz: number, dtMs: number): void {
    if (!this.openMark.parent) this.root.add(this.openMark);
    const o = duel.opening;
    const counter = duel.time <= duel.player.counterUntil && duel.enemy.state !== 'stagger';
    const show = o === 'left' || o === 'right' || counter;
    this.openPulse += dtMs / 1000;
    const x = counter ? 0 : o === 'left' ? -0.17 : 0.17;
    this.openX += (x - this.openX) * (1 - Math.exp(-dtMs / 90)); // glide across when he shifts guard
    const target = show ? 0.55 + 0.25 * Math.sin(this.openPulse * 6) : 0;
    this.openMat.opacity += (target - this.openMat.opacity) * (1 - Math.exp(-dtMs / 60));
    this.openMat.color.setHex(counter ? 0xffd040 : 0x60ff9a);
    this.openMark.scale.setScalar(counter ? 1.6 : 1);
    this.openMark.visible = this.openMat.opacity > 0.02;
    DuelSpace.toLocal({ x: this.openX, y: -space.height + 1.2, z: Dz - 0.23 }, this.openMark.position);
  }

  /** Step in through the late windup and hold through the strike, then ease back during recovery. */
  private updateLunge(duel: Duel, animMs: number): void {
    const e = duel.enemy;
    const att = duel.currentAttack;
    let target = 0;
    if (att && e.state === 'attack') {
      const since = e.clock - e.attackStart;
      const w = duel.windup(att);
      target = since > w * 0.4 && since < w + 300 ? ATTACK_LUNGE : 0;
    }
    this.lunge += (target - this.lunge) * (1 - Math.exp((-7 * animMs) / 1000));
  }

  /** `head` is the player's head offset from the duel centre (duel frame), so guides track a lean. */
  update(duel: Duel, space: DuelSpace, dtMs: number, head: V3 = { x: 0, y: 0, z: 0 }): void {
    const e = duel.enemy;
    const att = duel.currentAttack;
    const p = duel.attackProgress();
    let swing = false;
    // Hit-stop: the enemy holds its pose; the player's view and hands keep tracking.
    const frozen = duel.time >= duel.player.hitStopFrom && duel.time < duel.player.hitStopUntil;
    const animMs = frozen ? 0 : dtMs;

    // Body stands on the floor at the enemy position, stepped in while attacking.
    this.updateLunge(duel, animMs);
    const Dz = D - this.lunge;
    DuelSpace.toLocal({ x: 0, y: -space.height, z: Dz }, this.body.position);

    if (e.state === 'dead') {
      this.deadT += dtMs;
      this.body.rotation.x = -Math.min(1, this.deadT / 600) * 1.3;
      if (this.deadT > 2500) this.root.visible = false;
    } else if (e.state === 'stagger') {
      copyPose(this.target, STAGGER);
      this.body.rotation.x = 0.25;
    } else {
      this.body.rotation.x = 0;
      if (att) {
        const k = KEYS[kindOf(att)];
        const swingFrac = Math.min(0.5, SWING_MS / duel.windup(att));
        if (!e.struck && p >= 1 - swingFrac) {
          // Committed swing along the arc, timed so the blade arrives on the strike instant.
          const f = Math.min(1, (p - (1 - swingFrac)) / swingFrac);
          swingPose(this.pose, k, swingEase(f));
          swing = true;
        } else if (!e.struck) {
          copyPose(this.target, k.windup);
        } else {
          copyPose(this.target, REST);
        }
      } else {
        copyPose(this.target, e.state === 'idle' ? IDLE_GUARD[e.guardSide] : REST);
      }
    }
    if (!swing) {
      fixLength(this.target, ENEMY_BLADE_M); // same length as the swing, so it never pops
      const rate = e.state === 'attack' && !e.struck ? 9 : 6;
      lerpPoseInto(this.pose, this.pose, this.target, 1 - Math.exp((-rate * animMs) / 1000));
    }

    // Blade and arms.
    const hilt = DuelSpace.toLocal(this.pose.hilt, this.v1);
    const tip = DuelSpace.toLocal(this.pose.tip, this.v2);
    placeSegment(this.blade, hilt, tip, this.v3);
    const shoulderY = -space.height + 1.45;
    for (let i = 0; i < 2; i++) {
      const sh = DuelSpace.toLocal({ x: i === 0 ? -0.2 : 0.2, y: shoulderY, z: Dz - 0.02 }, this.v2);
      placeSegment(this.arms[i], sh, hilt, this.v3);
    }

    // Telegraph glow: ramps up through the windup, red for perilous attacks.
    const peril = !!att && att.perilous !== 'none' && !e.struck;
    this.perilMark.visible = peril;
    if (peril) {
      DuelSpace.toLocal({ x: 0, y: -space.height + 2.05, z: Dz }, this.perilMark.position);
      this.perilMark.rotation.y += dtMs * 0.004;
    }
    const glow = att && !e.struck ? Math.min(1, Math.max(0, p)) : 0;
    this.bladeMat.emissive.setHex(peril ? 0xff2020 : 0xffffff);
    // Always faintly lit so the blade reads against the dark arena; brightens toward the strike.
    this.bladeMat.emissiveIntensity = peril ? 0.5 + glow : 0.25 + glow * glow * 0.9;
    if (frozen) {
      // Parried blade flares gold for the length of the freeze.
      this.bladeMat.emissive.setHex(0xffc040);
      this.bladeMat.emissiveIntensity = 1.3;
    }

    this.updateOpening(duel, space, Dz, dtMs);

    this.deathMark.visible = e.state === 'stagger';
    if (this.deathMark.visible) DuelSpace.toLocal({ x: 0, y: -space.height + 1.25, z: Dz - 0.24 }, this.deathMark.position);

    // Bars above the head.
    const top = -space.height + 2.0;
    const pf = Math.min(1, e.posture / e.def.postureMax);
    DuelSpace.toLocal({ x: -0.3, y: top, z: Dz }, this.postureBar.position);
    this.postureBar.scale.set(Math.max(0.001, 0.6 * pf), 0.035, 1);
    this.postureMat.color.setHex(pf > 0.75 ? 0xff5a1a : 0xffb020);
    DuelSpace.toLocal({ x: -0.3, y: top - 0.05, z: Dz }, this.hpBar.position);
    this.updatePips(e, space, Dz);
    this.hpBar.scale.set(Math.max(0.001, (0.6 * e.hp) / e.def.hp), 0.02, 1);
    // The labelled panel the game places above the head replaces these bars.
    this.postureBar.visible = this.hpBar.visible = false;

    this.hitFlash = Math.max(0, this.hitFlash - dtMs / 150);
    this.bodyMat.emissive.setRGB(this.hitFlash * 0.8, this.hitFlash * 0.15, this.hitFlash * 0.1);

    if (this.rigged) {
      this.rigged.root.position.copy(this.body.position);
      this.rigged.update(duel, animMs, this.hitFlash);
    }
    this.updateTrail(duel, dtMs);
    this.updateGuide(duel, head);
  }
}

/**
 * A fading ribbon behind the enemy's blade, so the player can read the path a swing took and
 * learn the move. Samples are in the enemy root's space; each lives TRAIL_MS then fades out.
 */
const TRAIL_MS = 700;
const TRAIL_MAX = 48;

class SwingTrail {
  readonly mesh: THREE.Mesh;
  private readonly samples: Array<{ a: THREE.Vector3; b: THREE.Vector3; t: number }> = [];
  private readonly pos = new Float32Array(TRAIL_MAX * 2 * 3);
  private readonly col = new Float32Array(TRAIL_MAX * 2 * 4);
  private readonly geo = new THREE.BufferGeometry();
  private readonly color = new THREE.Color();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.mesh.frustumCulled = false;
  }

  push(a: THREE.Vector3, b: THREE.Vector3, t: number, hex: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.b.distanceTo(b) < 0.01) return; // only record actual motion
    this.samples.push({ a: a.clone(), b: b.clone(), t });
    if (this.samples.length > TRAIL_MAX) this.samples.shift();
    this.color.setHex(hex);
  }

  update(now: number): void {
    while (this.samples.length && now - this.samples[0].t > TRAIL_MS) this.samples.shift();
    const n = this.samples.length;
    this.samples.forEach((s, i) => {
      const fade = Math.pow(1 - (now - s.t) / TRAIL_MS, 1.5);
      s.a.toArray(this.pos, i * 6);
      s.b.toArray(this.pos, i * 6 + 3);
      // Inner edge faint, outer (tip) edge bright.
      for (const [k, alpha] of [[0, 0.1 * fade], [1, 0.75 * fade]] as const) {
        const o = (i * 2 + k) * 4;
        this.col[o] = this.color.r;
        this.col[o + 1] = this.color.g;
        this.col[o + 2] = this.color.b;
        this.col[o + 3] = alpha;
      }
    });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.mesh.visible = n > 1;
  }
}

function placeSegment(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, tmp: THREE.Vector3): void {
  tmp.subVectors(b, a);
  const len = tmp.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, tmp.multiplyScalar(1 / Math.max(1e-6, len)));
  mesh.scale.set(1, len, 1);
}

const d1 = new THREE.Vector3();
const d2 = new THREE.Vector3();
const rr = new THREE.Vector3();
let segS = 0;
let segT = 0;
/** Midpoint of the closest approach between segments p1-q1 and p2-q2 (where two blades meet). */
export function contactPoint(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  segSegDist(p1, q1, p2, q2);
  const a = out.copy(p1).lerp(q1, segS);
  const bx = p2.x + (q2.x - p2.x) * segT;
  const by = p2.y + (q2.y - p2.y) * segT;
  const bz = p2.z + (q2.z - p2.z) * segT;
  return a.set((a.x + bx) / 2, (a.y + by) / 2, (a.z + bz) / 2);
}

/** Closest distance between segments p1-q1 and p2-q2. */
export function segSegDist(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  rr.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(rr);
  let s = 0;
  let t = 0;
  const c = d1.dot(rr);
  const b = d1.dot(d2);
  const denom = a * e - b * b;
  if (denom > 1e-9) s = THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1);
  t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = THREE.MathUtils.clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
  }
  segS = s;
  segT = t;
  const cx = p1.x + d1.x * s - (p2.x + d2.x * t);
  const cy = p1.y + d1.y * s - (p2.y + d2.y * t);
  const cz = p1.z + d1.z * s - (p2.z + d2.z * t);
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

// ---------------------------------------------------------------------------
// Sparks (fixed pool, no per-frame allocation)

const SPARKS = 96;

export class Sparks {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel = new Float32Array(SPARKS * 3);
  private readonly life = new Float32Array(SPARKS);
  private readonly base = new Float32Array(SPARKS * 3);
  private next = 0;
  private readonly c = new THREE.Color();

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(SPARKS * 3);
    this.col = new Float32Array(SPARKS * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.018, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  burst(at: THREE.Vector3, color: number, n: number, speed: number): void {
    this.c.setHex(color);
    for (let i = 0; i < n; i++) {
      const k = this.next;
      this.next = (this.next + 1) % SPARKS;
      this.pos[k * 3] = at.x;
      this.pos[k * 3 + 1] = at.y;
      this.pos[k * 3 + 2] = at.z;
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u) * speed * (0.4 + Math.random() * 0.6);
      this.vel[k * 3] = Math.cos(th) * s;
      this.vel[k * 3 + 1] = u * speed + speed * 0.3;
      this.vel[k * 3 + 2] = Math.sin(th) * s;
      this.life[k] = 1;
      this.base[k * 3] = this.c.r;
      this.base[k * 3 + 1] = this.c.g;
      this.base[k * 3 + 2] = this.c.b;
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let k = 0; k < SPARKS; k++) {
      const l = this.life[k];
      if (l <= 0) {
        this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0;
        continue;
      }
      this.life[k] = l - dt * 2.5;
      this.vel[k * 3 + 1] -= 9.8 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const f = Math.max(0, this.life[k]);
      this.col[k * 3] = this.base[k * 3] * f;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * f;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
