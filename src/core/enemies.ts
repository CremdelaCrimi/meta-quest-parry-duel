import type { AttackDef, Combo, ComboStep, EnemyDef } from './types';

const atk = (
  id: string,
  dir: AttackDef['dir'],
  windupMs: number,
  extra: Partial<AttackDef> = {},
): AttackDef => ({
  id,
  dir,
  perilous: 'none',
  windupMs,
  recoverMs: 700,
  damage: 14,
  postureDamage: 18,
  ...extra,
});

export const ATTACKS = {
  slashHigh: atk('slashHigh', 'high', 650),
  slashLeft: atk('slashLeft', 'left', 600),
  slashRight: atk('slashRight', 'right', 600),
  slashLow: atk('slashLow', 'low', 620),
  quickLeft: atk('quickLeft', 'left', 380, { damage: 9, postureDamage: 12, recoverMs: 450 }),
  quickRight: atk('quickRight', 'right', 380, { damage: 9, postureDamage: 12, recoverMs: 450 }),
  heavyHigh: atk('heavyHigh', 'high', 950, { damage: 24, postureDamage: 34, recoverMs: 900 }),
  thrust: atk('thrust', 'high', 900, { perilous: 'thrust', damage: 26, postureDamage: 0, recoverMs: 900 }),
  sweep: atk('sweep', 'high', 900, { perilous: 'sweep', damage: 26, postureDamage: 0, recoverMs: 900 }),
} satisfies Record<string, AttackDef>;

const A = ATTACKS;

/**
 * Attack patterns are strings of 1, 2 or 3 hits with a fixed rhythm per enemy (`beatMs` between
 * a strike and the next windup), so each enemy's strings are learnable. Which string comes next
 * is random for now: `weights` sets how often 1-, 2- and 3-hit strings are picked, split evenly
 * among the patterns of that length.
 */
function patterns(
  beatMs: number,
  weights: [number, number, number],
  strings: { 1: AttackDef[][]; 2: AttackDef[][]; 3: AttackDef[][] },
): Combo[] {
  const out: Combo[] = [];
  for (const len of [1, 2, 3] as const) {
    const list = strings[len];
    for (const attacks of list) {
      const steps: ComboStep[] = attacks.map((attack) => ({ attack, chainDelayMs: beatMs }));
      out.push({ weight: weights[len - 1] / list.length, steps });
    }
  }
  return out;
}

export const ENEMIES: EnemyDef[] = [
  {
    name: 'Ronin',
    hp: 60,
    postureMax: 100,
    speed: 1,
    idleMinMs: 900,
    idleMaxMs: 1600,
    // Mostly singles while you learn the sides; slow, even beat.
    combos: patterns(320, [5, 3, 1], {
      1: [[A.slashLeft], [A.slashRight], [A.slashHigh]],
      2: [[A.slashLeft, A.slashRight], [A.slashHigh, A.slashLow]],
      3: [[A.slashLeft, A.slashRight, A.heavyHigh]],
    }),
  },
  {
    name: 'Duelist',
    hp: 80,
    postureMax: 110,
    speed: 1.1,
    idleMinMs: 700,
    idleMaxMs: 1300,
    combos: patterns(230, [2, 3, 3], {
      1: [[A.thrust], [A.heavyHigh]],
      2: [[A.slashRight, A.slashLow], [A.quickLeft, A.quickRight]],
      3: [
        [A.quickLeft, A.quickRight, A.slashHigh],
        [A.slashLeft, A.slashLeft, A.slashRight],
      ],
    }),
  },
  {
    name: 'Sentinel',
    hp: 120,
    postureMax: 140,
    speed: 1.15,
    idleMinMs: 600,
    idleMaxMs: 1100,
    // Fast beat, mostly 3-hit strings that end in something you must dodge or a heavy.
    combos: patterns(180, [2, 3, 4], {
      1: [[A.sweep], [A.thrust]],
      2: [[A.slashLow, A.sweep], [A.quickRight, A.thrust]],
      3: [
        [A.quickRight, A.quickLeft, A.thrust],
        [A.slashHigh, A.quickLeft, A.heavyHigh],
        [A.slashLow, A.slashLeft, A.sweep],
      ],
    }),
  },
];
