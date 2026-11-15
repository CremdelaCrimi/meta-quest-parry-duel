import { describe, expect, it } from 'vitest';
import { FOOTWORK, Footwork } from '../src/core/footwork';
import type { FootInput } from '../src/core/footwork';

/** Run the footwork for `ms` at 90 Hz with a fixed player position and enemy state. */
function run(f: Footwork, from: number, ms: number, i: Partial<FootInput>): number {
  let t = from;
  const dt = 1000 / 90;
  while (t < from + ms) {
    t += dt;
    f.update({ t, dtMs: dt, px: 0, pz: 0, enemy: 'idle', struck: false, ...i });
  }
  return t;
}

describe('enemy footwork', () => {
  it('holds his ground when you step in a little (no more floating back)', () => {
    const f = new Footwork();
    run(f, 0, 2000, { pz: 0.4 }); // gap 1.45: inside reach, outside his backstep trigger
    expect(f.z).toBeCloseTo(FOOTWORK.home, 5);
  });

  it('backsteps only after you stay inside for a moment', () => {
    const f = new Footwork();
    let t = run(f, 0, 300, { pz: 0.7 }); // gap 1.15
    expect(f.z).toBeCloseTo(FOOTWORK.home, 5); // the 0.4 s window to strike
    t = run(f, t, 1000, { pz: 0.7 });
    expect(f.gap(0.7)).toBeGreaterThan(FOOTWORK.home - 0.05);
  });

  it('walks back in when you retreat far', () => {
    const f = new Footwork();
    run(f, 0, 3000, { pz: -0.8 }); // gap 2.65
    expect(f.gap(-0.8)).toBeLessThan(FOOTWORK.home + 0.05);
  });

  it('steps in during a windup when you are far, and takes hits in recovery', () => {
    const f = new Footwork();
    let t = run(f, 0, 300, { pz: -0.3, enemy: 'attack' }); // gap 2.15
    expect(f.gap(-0.3)).toBeLessThan(2.15);
    const z = f.z;
    t = run(f, t, 400, { pz: f.z - 1.0, enemy: 'attack', struck: true });
    expect(f.z).toBeCloseTo(z, 5); // holds still while you punish
    run(f, t, 600, { pz: z - 1.0, enemy: 'idle' });
    expect(f.gap(z - 1.0)).toBeGreaterThan(FOOTWORK.home - 0.05); // then the emergency backstep
  });

  it('mirrors sidesteps and never clips into you', () => {
    const f = new Footwork();
    run(f, 0, 2000, { px: 0.8, pz: 1.5 });
    expect(f.x).toBeCloseTo(0.8, 2);
    expect(f.gap(1.5)).toBeGreaterThanOrEqual(FOOTWORK.minGap);
  });

  it('stumbles toward you on a posture break', () => {
    const f = new Footwork();
    f.stumble(0);
    run(f, 0, 500, { enemy: 'stagger' });
    expect(f.z).toBeCloseTo(FOOTWORK.home - FOOTWORK.stumbleM, 2);
  });
});
