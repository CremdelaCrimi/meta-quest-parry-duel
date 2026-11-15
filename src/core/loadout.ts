import { PICKUPS } from './roguelite';
import type { Pickup } from './roguelite';
import type { Modifiers } from './types';

/**
 * A weapon is a set of trade-offs applied once at the start of a run. Sim-side numbers go
 * through Modifiers (so boons stack on top); the rest is read by the game and the sword view.
 */
export interface Weapon {
  id: string;
  name: string;
  desc: string;
  /** Blade length (m) from guard to tip. Longer reaches further but makes guards less precise to see. */
  bladeM: number;
  /** Multiplies the wait before the next strike counts (one- and two-handed). */
  strikeCooldownMult: number;
  apply(m: Modifiers): void;
}

export const WEAPONS: Weapon[] = [
  {
    id: 'katana',
    name: 'Katana',
    desc: 'Balanced. The baseline every number is tuned around.',
    bladeM: 0.88,
    strikeCooldownMult: 1,
    apply: () => {},
  },
  {
    id: 'odachi',
    name: 'Odachi',
    desc: 'Long and heavy: +35% damage, +20% parry posture, slower strikes.',
    bladeM: 1.1,
    strikeCooldownMult: 1.5,
    apply: (m) => {
      m.playerDamageMult *= 1.35;
      m.deflectPostureMult *= 1.2;
    },
  },
  {
    id: 'wakizashi',
    name: 'Wakizashi',
    desc: 'Short and quick: −15% damage, +20 ms perfect window, +40% counter damage.',
    bladeM: 0.6,
    strikeCooldownMult: 0.6,
    apply: (m) => {
      m.playerDamageMult *= 0.85;
      m.perfectWindowBonusMs += 20;
      m.counterDamageMult *= 1.4;
    },
  },
];

/** Boons offered for the starting relic slot: one is taken free before the first fight. */
export const RELIC_IDS = ['slowTime', 'keenEye', 'fleetStep', 'vigor', 'bloodDeflect', 'ironWrist'] as const;
export const RELICS: Pickup[] = RELIC_IDS.map((id) => PICKUPS.find((p) => p.id === id)!);

export interface Loadout {
  weapon: string;
  relic: string | null;
}

export const DEFAULT_LOADOUT: Loadout = { weapon: 'katana', relic: null };

export const weaponById = (id: string): Weapon => WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
