import { ATTACKS } from './enemies';
import type { AttackDef, Combo, EnemyDef } from './types';

/**
 * Training dummy: what it does is split into two switches, so each half of the duel can be
 * practised alone. attacks = it swings at you (practise blocking); guards = it holds its sword on
 * one side and deflects strikes there (practise reading openings).
 */
export type DummyMode = 'idle' | 'attack' | 'deflect' | 'full';

export const DUMMY_MODES: Array<{ id: DummyMode; name: string; desc: string; attacks: boolean; guards: boolean }> = [
  { id: 'idle', name: 'Idle', desc: 'Stands still, no guard. Every strike lands: feel your swings.', attacks: false, guards: false },
  { id: 'attack', name: 'Attacking', desc: 'Swings at you, never guards. Practise blocks and dodges.', attacks: true, guards: false },
  { id: 'deflect', name: 'Deflecting', desc: 'Never swings. Guards one side: hit the open side (green).', attacks: false, guards: true },
  { id: 'full', name: 'Attack + deflect', desc: 'The real thing: block his swings, strike his openings.', attacks: true, guards: true },
];

const A = ATTACKS;

/** Which swings the attacking dummy throws. One shape at a time is the fastest way to learn it. */
export const DRILLS: Array<{ id: string; name: string; strings: AttackDef[][] }> = [
  { id: 'mixed', name: 'Mixed singles', strings: [[A.slashHigh], [A.slashLeft], [A.slashRight], [A.diagLeft], [A.diagRight]] },
  { id: 'vertical', name: 'Vertical only', strings: [[A.slashHigh], [A.heavyHigh]] },
  { id: 'horizontal', name: 'Horizontal only', strings: [[A.slashLeft], [A.slashRight]] },
  { id: 'diagonal', name: 'Diagonal only', strings: [[A.diagLeft], [A.diagRight]] },
  { id: 'thrust', name: 'Thrusts (dodge)', strings: [[A.thrust]] },
  { id: 'sweep', name: 'Sweeps (dodge)', strings: [[A.sweep]] },
  {
    id: 'strings',
    name: '2- and 3-hit strings',
    strings: [
      [A.slashLeft, A.slashRight],
      [A.diagRight, A.diagLeft],
      [A.quickLeft, A.quickRight, A.slashHigh],
      [A.slashRight, A.thrust],
      [A.slashHigh, A.sweep],
    ],
  },
];

/** Enemy speed in training (the Trainer runs at 0.62, the last enemy at 1.15). */
export const DUMMY_SPEEDS: Array<{ name: string; speed: number }> = [
  { name: 'Slow', speed: 0.62 },
  { name: 'Normal', speed: 1 },
  { name: 'Fast', speed: 1.15 },
];

/** The dummy as an enemy definition: a fixed beat between strings and a long pause between attacks. */
export function dummyDef(mode: DummyMode, drillIdx: number, speedIdx: number): EnemyDef {
  const m = DUMMY_MODES.find((d) => d.id === mode) ?? DUMMY_MODES[3];
  const drill = DRILLS[drillIdx] ?? DRILLS[0];
  const combos: Combo[] = drill.strings.map((attacks) => ({
    weight: 1,
    steps: attacks.map((attack) => ({ attack, chainDelayMs: 320 })),
  }));
  return {
    name: `Dummy · ${m.name}`,
    hp: 200,
    postureMax: 100,
    speed: (DUMMY_SPEEDS[speedIdx] ?? DUMMY_SPEEDS[0]).speed,
    idleMinMs: 1300,
    idleMaxMs: 1900,
    combos,
  };
}
