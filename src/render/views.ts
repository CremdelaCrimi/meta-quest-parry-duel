import * as THREE from 'three';
import type { Duel } from '../core/sim';
import type { AttackDef, SwordPose, V3 } from '../core/types';
import { DuelSpace, ENEMY_DIST } from './duelSpace';

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

// Enemy sword key poses, in the player's duel frame (head = origin, +z toward enemy).
// "strike" poses put the blade exactly where the player's matching guard sits.
const REST = key([0.0, -0.55, D - 0.45, 0.05, -0.35, D - 1.2]);
const STAGGER = key([0.15, -0.95, D - 0.3, 0.35, -1.4, D - 0.6]);
const KEYS: Record<string, { windup: SwordPose; strike: SwordPose }> = {
  left: { windup: key([-0.45, 0.05, D - 0.2, -0.9, 0.45, D + 0.15]), strike: key([-0.6, -0.15, 1.0, -0.25, -0.1, 0.2]) },
  right: { windup: key([0.45, 0.05, D - 0.2, 0.9, 0.45, D + 0.15]), strike: key([0.6, -0.15, 1.0, 0.25, -0.1, 0.2]) },
  high: { windup: key([0.05, 0.35, D - 0.15, 0.05, 0.95, D + 0.3]), strike: key([0.0, 0.12, 1.0, 0.0, 0.05, 0.2]) },
  low: { windup: key([0.4, -0.65, D - 0.2, 0.85, -0.9, D + 0.25]), strike: key([0.45, -0.8, 1.0, -0.15, -0.95, 0.3]) },
  thrust: { windup: key([0.2, -0.3, D + 0.15, 0.2, -0.22, D - 0.6]), strike: key([0.05, -0.2, 0.85, 0.0, -0.1, 0.0]) },
  sweep: { windup: key([0.6, 0.05, D - 0.25, 1.15, 0.15, D + 0.1]), strike: key([-0.35, 0.02, 0.95, -0.7, 0.02, 0.1]) },
};
const kindOf = (a: AttackDef) => (a.perilous !== 'none' ? a.perilous : a.dir);

/** Real-time duration of the final committed swing (enemy-clock ms). */
const SWING_MS = 140;

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
    copyPose(this.pose, REST);
  }

  reset(): void {
    copyPose(this.pose, REST);
    this.deadT = 0;
    this.body.rotation.set(0, 0, 0);
    this.root.visible = true;
  }

  hit(): void {
    this.hitFlash = 1;
  }

  /** Swept test: does the segment a->b (world) pass within `r` of the enemy body axis? */
  bodyHit(a: THREE.Vector3, b: THREE.Vector3, space: DuelSpace, r = 0.27): boolean {
    const feet = space.toWorld({ x: 0, y: -space.height + 0.2, z: D }, this.v1);
    const head = space.toWorld({ x: 0, y: -space.height + 1.7, z: D }, this.v2);
    return segSegDist(a, b, feet, head) < r;
  }

  update(duel: Duel, space: DuelSpace, dtMs: number): void {
    const e = duel.enemy;
    const att = duel.currentAttack;
    const p = duel.attackProgress();
    let swing = false;

    // Body stands on the floor at the enemy position.
    DuelSpace.toLocal({ x: 0, y: -space.height, z: D }, this.body.position);

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
        const swingFrac = Math.min(0.45, SWING_MS / duel.windup(att));
        if (!e.struck && p >= 1 - swingFrac) {
          // Committed swing: keyed exactly so the blade arrives on the strike instant.
          const f = Math.min(1, (p - (1 - swingFrac)) / swingFrac);
          lerpPoseInto(this.pose, k.windup, k.strike, f * f);
          swing = true;
        } else if (!e.struck) {
          copyPose(this.target, k.windup);
        } else {
          copyPose(this.target, REST);
        }
      } else {
        copyPose(this.target, REST);
      }
    }
    if (!swing) {
      const rate = e.state === 'attack' && !e.struck ? 9 : 6;
      lerpPoseInto(this.pose, this.pose, this.target, 1 - Math.exp((-rate * dtMs) / 1000));
    }

    // Blade and arms.
    const hilt = DuelSpace.toLocal(this.pose.hilt, this.v1);
    const tip = DuelSpace.toLocal(this.pose.tip, this.v2);
    placeSegment(this.blade, hilt, tip, this.v3);
    const shoulderY = -space.height + 1.45;
    for (let i = 0; i < 2; i++) {
      const sh = DuelSpace.toLocal({ x: i === 0 ? -0.2 : 0.2, y: shoulderY, z: D - 0.02 }, this.v2);
      placeSegment(this.arms[i], sh, hilt, this.v3);
    }

    // Telegraph glow: ramps up through the windup, red for perilous attacks.
    const peril = !!att && att.perilous !== 'none' && !e.struck;
    this.perilMark.visible = peril;
    if (peril) {
      DuelSpace.toLocal({ x: 0, y: -space.height + 2.05, z: D }, this.perilMark.position);
      this.perilMark.rotation.y += dtMs * 0.004;
    }
    const glow = att && !e.struck ? Math.min(1, Math.max(0, p)) : 0;
    this.bladeMat.emissive.setHex(peril ? 0xff2020 : 0xffffff);
    // Always faintly lit so the blade reads against the dark arena; brightens toward the strike.
    this.bladeMat.emissiveIntensity = peril ? 0.5 + glow : 0.25 + glow * glow * 0.9;

    this.deathMark.visible = e.state === 'stagger';
    if (this.deathMark.visible) DuelSpace.toLocal({ x: 0, y: -space.height + 1.25, z: D - 0.24 }, this.deathMark.position);

    // Bars above the head.
    const top = -space.height + 2.0;
    const pf = Math.min(1, e.posture / e.def.postureMax);
    DuelSpace.toLocal({ x: -0.3, y: top, z: D }, this.postureBar.position);
    this.postureBar.scale.set(Math.max(0.001, 0.6 * pf), 0.035, 1);
    this.postureMat.color.setHex(pf > 0.75 ? 0xff5a1a : 0xffb020);
    DuelSpace.toLocal({ x: -0.3, y: top - 0.05, z: D }, this.hpBar.position);
    this.hpBar.scale.set(Math.max(0.001, (0.6 * e.hp) / e.def.hp), 0.02, 1);
    this.postureBar.visible = this.hpBar.visible = e.state !== 'dead';

    this.hitFlash = Math.max(0, this.hitFlash - dtMs / 150);
    this.bodyMat.emissive.setRGB(this.hitFlash * 0.8, this.hitFlash * 0.15, this.hitFlash * 0.1);
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
