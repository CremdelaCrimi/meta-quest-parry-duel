import type { Dir, GuardConfig, SwordPose, V3 } from './types';

const RAD2DEG = 180 / Math.PI;

export interface GuardReading {
  dir: Dir | null;
  /** Degrees away from the ideal blade angle for this guard (0 = textbook). */
  angleErr: number;
}

/**
 * Classify a sword pose (duel frame) into a guard direction.
 *   high:  blade roughly horizontal, at or above face height
 *   left/right: blade roughly vertical, off to that side
 *   low:   blade held low, tip not pointing up
 */
export function classifyGuard(p: SwordPose, g: GuardConfig, out: GuardReading): GuardReading {
  const dx = p.tip.x - p.hilt.x;
  const dy = p.tip.y - p.hilt.y;
  const dz = p.tip.z - p.hilt.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.dir = null;
  out.angleErr = 90;
  if (len < 1e-6) return out;

  const elev = Math.asin(Math.min(1, Math.abs(dy) / len)) * RAD2DEG; // 0 = horizontal, 90 = vertical
  const mx = (p.tip.x + p.hilt.x) * 0.5;
  const my = (p.tip.y + p.hilt.y) * 0.5;
  const mz = (p.tip.z + p.hilt.z) * 0.5;

  if (mz < g.minForward) return out;

  if (my < g.lowY) {
    out.dir = 'low';
    out.angleErr = dy > 0 ? elev : 0;
    return out;
  }
  if (elev < 45) {
    if (my > g.highY) {
      out.dir = 'high';
      out.angleErr = elev;
    }
    return out;
  }
  if (mx < -g.sideDeadzone) out.dir = 'left';
  else if (mx > g.sideDeadzone) out.dir = 'right';
  else return out;
  out.angleErr = 90 - elev;
  return out;
}

export function lerpV3(out: V3, a: V3, b: V3, t: number): V3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function lerpPose(out: SwordPose, a: SwordPose, b: SwordPose, t: number): SwordPose {
  lerpV3(out.hilt, a.hilt, b.hilt, t);
  lerpV3(out.tip, a.tip, b.tip, t);
  return out;
}

export function makePose(): SwordPose {
  return { hilt: { x: 0, y: 0, z: 0 }, tip: { x: 0, y: 0, z: 0 } };
}
