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
  /** Blade tip speed (m/s) a swing needs to count as a strike (default 1.8). */
  strikeSpeed?: number;
  apply(m: Modifiers): void;
}

// ---------------------------------------------------------------- weapon assembly

/**
 * Weapon assembly (after Lies of P's blade + handle split; numbers from the Gemini consult,
 * 2026-11-16). The BLADE sets reach, damage and posture; the HANDLE sets how the swing feels in VR:
 * the tip speed a strike needs, the cooldown between strikes and the perfect-parry bonus. A heavy
 * handle registers broad, slow swings but recovers slowly; an agile one needs a wrist snap.
 */
export type Weight = 0 | 1 | 2; // light, medium, heavy

export interface BladePart {
  id: string;
  name: string;
  bladeM: number;
  damageMult: number;
  postureMult: number;
  counterMult: number;
  weight: Weight;
}

export interface HandlePart {
  id: string;
  name: string;
  strikeSpeed: number;
  cooldownMult: number;
  perfectBonusMs: number;
  weight: Weight;
}

export const BLADES: BladePart[] = [
  { id: 'edge', name: 'Edge', bladeM: 0.88, damageMult: 1, postureMult: 1, counterMult: 1, weight: 1 },
  { id: 'stiletto', name: 'Stiletto', bladeM: 0.55, damageMult: 0.65, postureMult: 0.7, counterMult: 1.5, weight: 0 },
  { id: 'cleaver', name: 'Cleaver', bladeM: 1.2, damageMult: 1.6, postureMult: 1.5, counterMult: 1, weight: 2 },
];

export const HANDLES: HandlePart[] = [
  { id: 'wrapped', name: 'Wrapped grip', strikeSpeed: 1.8, cooldownMult: 1, perfectBonusMs: 0, weight: 1 },
  { id: 'fencer', name: "Fencer's grip", strikeSpeed: 2.5, cooldownMult: 0.6, perfectBonusMs: 20, weight: 0 },
  { id: 'pole', name: 'Pole shaft', strikeSpeed: 1.2, cooldownMult: 1.8, perfectBonusMs: -20, weight: 2 },
];

/** Extra strike cooldown (ms) for a top-heavy or whippy mismatch, and whether it loses the parry bonus. */
export interface Mismatch {
  extraCooldownMs: number;
  noParryBonus: boolean;
}

/**
 * Stops the degenerate pairs (Gemini's example: the heaviest blade on the quickest handle, which
 * VR's weightless controllers would let you wiggle for huge damage). Light ↔ heavy is the only
 * mismatch: a medium part pairs with anything.
 */
export function mismatch(b: BladePart, h: HandlePart): Mismatch {
  const off = Math.abs(b.weight - h.weight) >= 2;
  return { extraCooldownMs: off ? 300 : 0, noParryBonus: off };
}

/** Base strike cooldown the cooldown multiplier applies to (one-handed, ms); keep in sync with game.ts. */
const BASE_STRIKE_COOLDOWN_MS = 250;

export function assembleWeapon(bladeId: string, handleId: string): Weapon {
  const b = BLADES.find((x) => x.id === bladeId) ?? BLADES[0];
  const h = HANDLES.find((x) => x.id === handleId) ?? HANDLES[0];
  const mm = mismatch(b, h);
  const bonus = mm.noParryBonus ? Math.min(0, h.perfectBonusMs) : h.perfectBonusMs;
  return {
    id: `asm:${b.id}:${h.id}`,
    name: `${b.name} + ${h.name}`,
    desc: `${b.bladeM.toFixed(2)} m · ×${b.damageMult} damage · strike at ${h.strikeSpeed} m/s${mm.extraCooldownMs ? ' · MISMATCHED: slow, no parry bonus' : ''}`,
    bladeM: b.bladeM,
    strikeCooldownMult: h.cooldownMult + mm.extraCooldownMs / BASE_STRIKE_COOLDOWN_MS,
    strikeSpeed: h.strikeSpeed,
    apply: (m) => {
      m.playerDamageMult *= b.damageMult;
      m.deflectPostureMult *= b.postureMult;
      m.counterDamageMult *= b.counterMult;
      m.perfectWindowBonusMs += bonus;
    },
  };
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

export const weaponById = (id: string): Weapon => {
  if (id.startsWith('asm:')) {
    const [, b, h] = id.split(':');
    return assembleWeapon(b, h);
  }
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
};
