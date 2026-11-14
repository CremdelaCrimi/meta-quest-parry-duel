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

const step = (attack: AttackDef, chainDelayMs = 250): ComboStep => ({ attack, chainDelayMs });
const combo = (weight: number, ...steps: ComboStep[]): Combo => ({ weight, steps });

const A = ATTACKS;

export const ENEMIES: EnemyDef[] = [
  {
    name: 'Ronin',
    hp: 60,
    postureMax: 100,
    speed: 1,
    idleMinMs: 900,
    idleMaxMs: 1600,
    combos: [
      combo(3, step(A.slashLeft)),
      combo(3, step(A.slashRight)),
      combo(2, step(A.slashHigh)),
      combo(2, step(A.slashLeft, 300), step(A.slashRight)),
      combo(1, step(A.heavyHigh)),
    ],
  },
  {
    name: 'Duelist',
    hp: 80,
    postureMax: 110,
    speed: 1.1,
    idleMinMs: 700,
    idleMaxMs: 1300,
    combos: [
      combo(2, step(A.quickLeft, 180), step(A.quickRight, 180), step(A.slashHigh)),
      combo(2, step(A.slashRight, 250), step(A.slashLow)),
      combo(2, step(A.slashLeft, 220), step(A.slashLeft, 220), step(A.slashRight)),
      combo(1, step(A.thrust)),
      combo(1, step(A.heavyHigh)),
    ],
  },
  {
    name: 'Sentinel',
    hp: 120,
    postureMax: 140,
    speed: 1.15,
    idleMinMs: 600,
    idleMaxMs: 1100,
    combos: [
      combo(2, step(A.slashHigh, 220), step(A.quickLeft, 180), step(A.quickRight, 180), step(A.heavyHigh)),
      combo(2, step(A.slashLow, 250), step(A.sweep)),
      combo(2, step(A.quickRight, 160), step(A.quickLeft, 160), step(A.thrust)),
      combo(1, step(A.sweep)),
      combo(1, step(A.thrust)),
    ],
  },
];
