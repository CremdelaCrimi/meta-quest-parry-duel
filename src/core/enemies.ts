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

const quick = { damage: 9, postureDamage: 12, recoverMs: 450 } as const;

export const ATTACKS = {
  // Vertical: overhead chop. Guard high (sword flat above your head).
  slashHigh: atk('slashHigh', 'high', 650, { swing: 'vertical' }),
  heavyHigh: atk('heavyHigh', 'high', 950, { swing: 'vertical', damage: 24, postureDamage: 34, recoverMs: 900 }),
  // Horizontal: level sweep. Guard on that side (sword upright).
  slashLeft: atk('slashLeft', 'left', 600, { swing: 'horizontal' }),
  slashRight: atk('slashRight', 'right', 600, { swing: 'horizontal' }),
  quickLeft: atk('quickLeft', 'left', 380, { swing: 'horizontal', ...quick }),
  quickRight: atk('quickRight', 'right', 380, { swing: 'horizontal', ...quick }),
  // Diagonal: from a raised shoulder down across. Guard on that side (sword upright).
  diagLeft: atk('diagLeft', 'left', 620, { swing: 'diagonal' }),
  diagRight: atk('diagRight', 'right', 620, { swing: 'diagonal' }),
  quickDiagLeft: atk('quickDiagLeft', 'left', 400, { swing: 'diagonal', ...quick }),
  quickDiagRight: atk('quickDiagRight', 'right', 400, { swing: 'diagonal', ...quick }),
  // Must-dodge (red glow, can't be blocked): lean out of a thrust, duck under a sweep.
  // A clean dodge opens him up like a perfect parry. The low cut is still unused.
  slashLow: atk('slashLow', 'low', 620),
  thrust: atk('thrust', 'high', 900, { perilous: 'thrust', damage: 26, postureDamage: 0, recoverMs: 900 }),
  sweep: atk('sweep', 'high', 900, { perilous: 'sweep', damage: 26, postureDamage: 0, recoverMs: 900 }),
  // Phase 2 signature: his key ratchets back three times (a clank every 300 ms), then a Fury
  // overhead lands on the fourth beat. Only a perfect parry (high guard) on that beat stops it.
  mainspring: atk('mainspring', 'high', 1300, { swing: 'vertical', damage: 28, postureDamage: 40, recoverMs: 1000, fury: true }),
} satisfies Record<string, AttackDef>;

const A = ATTACKS;

/** The Mainspring's three clanks, as ms before the strike: the rhythm is the counter. */
export const MAINSPRING_CLANKS_MS = [900, 600, 300];

/** Phase 2 strings (Gemini consult 2026-11-16). */
export const PHASE2 = {
  /** "Winding Stair": right, left, then straight into an overhead with a near-zero gap. */
  stair: { weight: 1, steps: [
    { attack: A.slashRight, chainDelayMs: 220 },
    { attack: A.slashLeft, chainDelayMs: 120 },
    { attack: A.slashHigh, chainDelayMs: 0 },
  ] },
  signature: { weight: 1, steps: [{ attack: A.mainspring, chainDelayMs: 0 }] },
};

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
      if (weights[len - 1] > 0) out.push({ weight: weights[len - 1] / list.length, steps });
    }
  }
  return out;
}

// Trainer and Ronin use only the three swing shapes. The Duelist adds the thrust (lean) and the
// Sentinel adds the sweep (duck) as well, each as a string finisher, so you learn one at a time.
export const ENEMIES: EnemyDef[] = [
  {
    name: 'Trainer',
    hp: 40,
    postureMax: 80,
    // Everything ~1.6x slower, one swing at a time, long pauses: learn each shape and its block.
    speed: 0.62,
    idleMinMs: 1500,
    idleMaxMs: 2300,
    combos: patterns(400, [1, 0, 0], {
      1: [[A.slashHigh], [A.slashLeft], [A.slashRight], [A.diagLeft], [A.diagRight]],
      2: [],
      3: [],
    }),
  },
  {
    name: 'Ronin',
    hp: 60,
    postureMax: 100,
    speed: 1,
    idleMinMs: 900,
    idleMaxMs: 1600,
    // Mostly singles; slow, even beat.
    combos: patterns(320, [5, 3, 1], {
      1: [[A.slashHigh], [A.slashLeft], [A.slashRight], [A.diagLeft], [A.diagRight]],
      2: [[A.slashLeft, A.slashRight], [A.diagRight, A.diagLeft], [A.slashHigh, A.slashLeft]],
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
    combos: patterns(260, [2, 3, 3], {
      1: [[A.heavyHigh], [A.diagLeft], [A.thrust]],
      2: [[A.quickLeft, A.quickRight], [A.diagLeft, A.slashHigh], [A.slashRight, A.thrust]],
      3: [
        [A.quickLeft, A.quickRight, A.slashHigh],
        [A.diagRight, A.diagLeft, A.slashRight],
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
    // Fast beat, mostly 3-hit strings ending in a heavy.
    combos: patterns(200, [2, 3, 4], {
      1: [[A.heavyHigh], [A.diagRight], [A.sweep]],
      2: [[A.quickDiagLeft, A.quickDiagRight], [A.quickRight, A.heavyHigh], [A.quickLeft, A.thrust], [A.slashHigh, A.sweep]],
      3: [
        [A.quickRight, A.quickLeft, A.heavyHigh],
        [A.quickDiagLeft, A.quickDiagRight, A.slashHigh],
        [A.slashHigh, A.quickLeft, A.diagRight],
      ],
    }),
  },
];
