import { describe, expect, it } from 'vitest';
import { clipTimeAt } from '../src/render/clipTiming';

const CLIP = { releaseMs: 500, impactMs: 650, durationMs: 1400 }; // 150 ms authored swing

describe('clip timing', () => {
  it('impact lands exactly on the strike instant for any windup', () => {
    for (const w of [380, 600, 950, 2000]) expect(clipTimeAt(CLIP, w, w)).toBeCloseTo(CLIP.impactMs, 9);
  });

  it('keeps the authored swing speed when it fits, stretching only the windup pose', () => {
    // 950 ms windup: swing occupies the last 150 ms at 1:1 speed.
    expect(clipTimeAt(CLIP, 950, 800)).toBeCloseTo(CLIP.releaseMs, 9);
    expect(clipTimeAt(CLIP, 950, 875)).toBeCloseTo(575, 9);
    // The windup pose is stretched: halfway through the hold is halfway to release.
    expect(clipTimeAt(CLIP, 950, 400)).toBeCloseTo(250, 9);
  });

  it('compresses the swing on very short windups so the pose still reads', () => {
    // 200 ms windup: swing capped at 45% = 90 ms, release reached at 110 ms.
    expect(clipTimeAt(CLIP, 200, 110)).toBeCloseTo(CLIP.releaseMs, 9);
    expect(clipTimeAt(CLIP, 200, 155)).toBeCloseTo(575, 9);
  });

  it('plays recovery at authored speed and clamps at the clip end', () => {
    expect(clipTimeAt(CLIP, 600, 700)).toBeCloseTo(750, 9);
    expect(clipTimeAt(CLIP, 600, 5000)).toBe(CLIP.durationMs);
  });

  it('is monotonic, so the pose never snaps backwards', () => {
    let prev = -1;
    for (let t = 0; t <= 1600; t += 5) {
      const c = clipTimeAt(CLIP, 600, t);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});
