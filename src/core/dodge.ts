import type { DodgeKind, V3 } from './types';

export interface DodgeConfig {
  /** Lateral head offset (m) from calibrated centre that counts as a lean. */
  leanDist: number;
  /** Head must drop this far (m) below calibrated height to count as a duck. */
  duckDist: number;
  /** Minimum head speed (m/s) at the crossing, so slow drifting doesn't trigger. */
  minSpeed: number;
  /** Head must return within this fraction of the threshold before another dodge of that kind. */
  rearmFrac: number;
}

export const DEFAULT_DODGE: DodgeConfig = {
  leanDist: 0.2,
  duckDist: 0.25,
  minSpeed: 0.6,
  rearmFrac: 0.5,
};

export interface DodgeHit {
  kind: DodgeKind;
  t: number;
}

/**
 * Detects lean/duck dodges from head motion and returns the interpolated
 * sub-frame time the threshold was crossed.
 */
export class DodgeDetector {
  private armedLeft = true;
  private armedRight = true;
  private armedDuck = true;
  constructor(private cfg: DodgeConfig = DEFAULT_DODGE) {}

  update(t0: number, t1: number, a: V3, b: V3): DodgeHit | null {
    const c = this.cfg;
    const dt = Math.max(1e-3, (t1 - t0) / 1000);
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;

    if (!this.armedLeft && b.x > -c.leanDist * c.rearmFrac) this.armedLeft = true;
    if (!this.armedRight && b.x < c.leanDist * c.rearmFrac) this.armedRight = true;
    if (!this.armedDuck && b.y > -c.duckDist * c.rearmFrac) this.armedDuck = true;

    if (this.armedDuck && a.y > -c.duckDist && b.y <= -c.duckDist && -vy >= c.minSpeed) {
      this.armedDuck = false;
      return { kind: 'duck', t: cross(t0, t1, a.y, b.y, -c.duckDist) };
    }
    if (this.armedLeft && a.x > -c.leanDist && b.x <= -c.leanDist && -vx >= c.minSpeed) {
      this.armedLeft = false;
      return { kind: 'leanLeft', t: cross(t0, t1, a.x, b.x, -c.leanDist) };
    }
    if (this.armedRight && a.x < c.leanDist && b.x >= c.leanDist && vx >= c.minSpeed) {
      this.armedRight = false;
      return { kind: 'leanRight', t: cross(t0, t1, a.x, b.x, c.leanDist) };
    }
    return null;
  }
}

function cross(t0: number, t1: number, a: number, b: number, thr: number): number {
  const f = b === a ? 1 : (thr - a) / (b - a);
  return t0 + (t1 - t0) * Math.min(1, Math.max(0, f));
}
