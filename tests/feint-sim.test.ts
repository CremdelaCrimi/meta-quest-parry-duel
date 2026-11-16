import { describe, expect, it } from 'vitest';
import { PRESET_SEKIRO_LIKE } from '../src/core/config';
import { ATTACKS } from '../src/core/enemies';
import { Rng } from '../src/core/rng';
import { POSES, drive, guardAt, makeDuel, outcome, script } from './helpers';

/**
 * Simulated playtest (no headset needed): does the Feints toggle punish rhythm-guessing but not
 * reading the release? Two simulated players guard the same slash many times:
 * - the rhythm reader guards when the swing "usually" lands (start + base windup), with jitter;
 * - the release reader reacts to the swing actually starting (the last 320 ms), ~250 ms later.
 * Jitter is a human-ish 45 ms standard deviation. Prints a table; asserts the design intent.
 */
const L = ATTACKS.slashLeft;
const START = 1000;
const SWING_MS = 320; // views.ts: the committed swing, the visible release

function gauss(rng: Rng): number {
  // Box-Muller from the seeded RNG, so the run is reproducible.
  const u = Math.max(1e-9, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

function rate(reader: 'rhythm' | 'release', feints: boolean, trials = 200): number {
  const rng = new Rng(feints ? 77 : 78);
  let perfect = 0;
  for (let i = 0; i < trials; i++) {
    const timing = { ...PRESET_SEKIRO_LIKE, feintChance: 1, feintMinMs: 150, feintMaxMs: 400 };
    const d = makeDuel({ timing, seed: 1000 + i, mech: { feints } });
    script(d, L, START);
    const strike = START + d.windup(L); // includes this attack's feint hold
    const jitter = 45 * gauss(rng);
    const guardT = reader === 'rhythm' ? START + L.windupMs - 60 + jitter : strike - SWING_MS + 250 + jitter;
    if (outcome(drive(d, guardAt(POSES.left, guardT), strike + 400))?.type === 'perfect') perfect++;
  }
  return perfect / trials;
}

describe('simulated playtest: feints', () => {
  it('punish rhythm-guessing far more than reading the release', () => {
    const rows = {
      'rhythm, feints off': rate('rhythm', false),
      'rhythm, feints on': rate('rhythm', true),
      'release, feints off': rate('release', false),
      'release, feints on': rate('release', true),
    };
    console.table(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, `${Math.round(v * 100)} % perfect`])));
    expect(rows['rhythm, feints on']).toBeLessThan(rows['rhythm, feints off'] - 0.3);
    expect(Math.abs(rows['release, feints on'] - rows['release, feints off'])).toBeLessThan(0.15);
  });
});
