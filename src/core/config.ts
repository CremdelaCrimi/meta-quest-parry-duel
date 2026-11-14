import type { GuardConfig, Modifiers, TimingConfig } from './types';

// Starting values are guesses meant to be tuned in the headset using the parry-offset readout.
// Everything that affects feel lives here so tuning never touches logic.

export const DEFAULT_GUARD: GuardConfig = {
  minForward: 0.05,
  lowY: -0.75,
  highY: -0.3,
  sideDeadzone: 0.08,
};

const BASE: Omit<TimingConfig, 'name'> = {
  perfectEarlyMs: 120,
  perfectLateMs: 40,
  blockLateMs: 60,
  perfectAngleDeg: 30,
  blockAngleDeg: 45,
  spamWindowMs: 700,
  spamMaxEntries: 3,
  spamLockoutMs: 450,

  blockHpMult: 0,
  blockPlayerPostureMult: 0.6,
  blockEnemyPostureMult: 0.15,
  deflectEnemyPostureMult: 1,
  deflectPlayerPosture: 4,

  playerHp: 100,
  playerPostureMax: 100,
  postureRegenPerSec: 18,
  enemyPostureRegenPerSec: 6,
  postureRegenDelayMs: 1200,

  enemyStaggerMs: 1600,
  iframesMs: 320,
  dodgeCooldownMs: 250,
  counterWindowMs: 700,

  playerDamage: 8,
  playerPostureDamageOnBlocked: 6,
  finisherDamage: 1000,
};

/** Tight, rewards rhythm, blocking costs only posture. Spam is punished. */
export const PRESET_SEKIRO_LIKE: TimingConfig = { ...BASE, name: 'Sekiro-like' };

/** Shorter perfect window, but regular blocks still chip HP. */
export const PRESET_LIESOFP_LIKE: TimingConfig = {
  ...BASE,
  name: 'Lies of P-like',
  perfectEarlyMs: 90,
  perfectLateMs: 30,
  blockHpMult: 0.4,
  blockPlayerPostureMult: 0.4,
  deflectEnemyPostureMult: 0.8,
  spamMaxEntries: 4,
};

export const PRESETS = [PRESET_SEKIRO_LIKE, PRESET_LIESOFP_LIKE];

export function defaultModifiers(): Modifiers {
  return {
    perfectWindowBonusMs: 0,
    deflectPostureMult: 1,
    counterDamageMult: 1,
    playerDamageMult: 1,
    iframesBonusMs: 0,
    healOnPerfect: 0,
    maxHpBonus: 0,
    abilities: [],
  };
}
