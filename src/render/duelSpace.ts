import * as THREE from 'three';
import type { V3 } from '../core/types';

/** Distance from the player's head to the enemy's centre line (m). */
export const ENEMY_DIST = 1.85;
/** How far the enemy steps in during an attack so the blade reaches the player (m). */
export const ATTACK_LUNGE = 0.5;
/** How quickly the duel centre (and the enemy) re-centre on the player after they move (s). */
const FOLLOW_TAU = 0.8;

const tmp = new THREE.Vector3();

/**
 * The "duel frame" the core sim works in. A THREE.Group sits at the smoothed
 * player centre (at calibrated head height) with its +z pointing at the enemy.
 * three.js is right-handed, so the core's +x (player's right) is local -x.
 */
export class DuelSpace {
  readonly group = new THREE.Group();
  calibrated = false;
  height = 1.6;
  readonly center = new THREE.Vector3();
  /** Where the centre was at calibration: footwork positions are fixed relative to this. */
  readonly calibCenter = new THREE.Vector3();

  calibrate(headPos: THREE.Vector3, headQuat: THREE.Quaternion): void {
    tmp.set(0, 0, -1).applyQuaternion(headQuat);
    const yaw = Math.atan2(tmp.x, tmp.z);
    this.height = headPos.y;
    this.center.set(headPos.x, headPos.y, headPos.z);
    this.calibCenter.copy(this.center);
    this.group.position.copy(this.center);
    this.group.rotation.set(0, yaw, 0);
    this.group.updateMatrixWorld(true);
    this.calibrated = true;
  }

  /** Ease the centre toward the player's head so the enemy stays in front after a step or lean. */
  follow(headPos: THREE.Vector3, dtMs: number): void {
    const k = 1 - Math.exp(-dtMs / 1000 / FOLLOW_TAU);
    this.center.x += (headPos.x - this.center.x) * k;
    this.center.z += (headPos.z - this.center.z) * k;
    this.group.position.set(this.center.x, this.height, this.center.z);
    this.group.updateMatrixWorld(true);
  }

  /**
   * Where the (smoothed) centre is relative to the calibration spot, in duel coordinates. The
   * centre trails the player's head (so leans read as leans); the enemy's footwork lives in the
   * fixed calibration frame, so he no longer slides back when you step in.
   */
  centerOffset(out: V3): V3 {
    tmp.copy(this.calibCenter);
    this.group.worldToLocal(tmp);
    out.x = tmp.x;
    out.y = 0;
    out.z = -tmp.z;
    return out;
  }

  /** Fixed calibration-frame duel coordinates -> world (desktop mode places the head with this). */
  fromCalib(v: V3, out: THREE.Vector3): THREE.Vector3 {
    out.set(-v.x, v.y, v.z).applyQuaternion(this.group.quaternion);
    return out.add(tmp.set(this.calibCenter.x, this.height, this.calibCenter.z));
  }

  /** World point -> core duel coordinates (relative to the smoothed centre). */
  toDuel(world: THREE.Vector3, out: V3): V3 {
    tmp.copy(world);
    this.group.worldToLocal(tmp);
    out.x = -tmp.x;
    out.y = tmp.y;
    out.z = tmp.z;
    return out;
  }

  /** Core duel coordinates -> local position for children of `group`. */
  static toLocal(v: V3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(-v.x, v.y, v.z);
  }

  /** Core duel coordinates -> world. */
  toWorld(v: V3, out: THREE.Vector3): THREE.Vector3 {
    DuelSpace.toLocal(v, out);
    return this.group.localToWorld(out);
  }
}
