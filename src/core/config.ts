import type { GuardConfig, Mechanics, Modifiers, TimingConfig } from './types';

/** Default mechanic toggles (Gemini consult 2026-11-16: feints, riposte and spam lock on; the rest off). */
export const MECH_DEFAULTS: Mechanics = { feints: true, fury: false, riposte: true, spamLock: true, charge: false, guardRegain: false, phase2: false };

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
  steadyMs: 50,
  steadyMaxSpeed: 1.2,
  spamWindowMs: 700,
  spamMaxEntries: 3,
  spamLockoutMs: 350, // VR hands micro-jitter: shorter than the 450 we started with

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

  enemyStaggerMs: 2500, // time to step in for the finisher in VR
  iframesMs: 320,
  perfectDodgeMs: 150,
  // No published Lies of P dodge frame data (community reports only); 300 ms is our estimate of a
  // Lies of P-style step. Tune in the menu (Tuning) or with ?dashIframesMs=.
  dashIframesMs: 300,
  healAmount: 35,
  flasksPerFight: 3,
  fatalPerPerfect: 25,
  fatalPerPerfectDodge: 25,
  fatalPerDeflect: 5,
  fatalArmMs: 2500,
  fatalDamageMult: 4,
  fatalPosture: 40,
  feintChance: 0.35,
  feintMinMs: 150,
  feintMaxMs: 400,
  furyChance: 0.25,
  furyPostureMult: 1.5,
  riposteMs: 400,
  riposteDamageMult: 2.2,
  ripostePosture: 25,
  chargeMs: 1200,
  chargeStillSpeed: 0.35,
  chargeKeepMs: 900,
  chargeDamageMult: 1.6,
  chargePosture: 30,
  regainChip: 0.5,
  regainMs: 2500,
  regainPerHit: 1,
  phase2At: 0.5,
  phase2Windup: 0.85,
  phase2Idle: 0.6,
  phase2FeintBonus: 0.15,
  phase2SigChance: 0.2,
  phase2StairChance: 0.25,
  perfectDodgePosture: 30,
  grappleCooldownMs: 3000,
  grapplePlayerPosture: 20,
  grapplePostureDamage: 15,
  grappleGuardBreakMs: 700,
  grappleLockMs: 600,
  blastCooldownMs: 4000,
  blastDamage: 6,
  blastPosture: 25,
  dodgeCooldownMs: 250,
  counterWindowMs: 700,
  hitStopMs: 110, // heavier than the reference's 50-100 ms guess: the perfect needs to land like a hit
  assistAfterHits: 3,
  assistBonusMs: 40,
  windowBonusCapMs: 80,

  playerDamage: 8,
  playerPostureDamageOnBlocked: 6,
  pokePostureMult: 2,
  guardShiftMinMs: 1400,
  guardShiftMaxMs: 2600,
  twoHandSteadyMaxSpeed: 1.6,
  twoHandAngleBonusDeg: 5,
  twoHandBlockPostureMult: 0.75, // 0.6 -> 0.45 on the Sekiro-like preset
  twoHandDamageMult: 1.25,
  twoHandPokeMult: 1.25,
  finisherDamage: 1000,
};

/** Tight, rewards rhythm, blocking costs only posture. Spam is punished. */
export const PRESET_SEKIRO_LIKE: TimingConfig = { ...BASE, name: 'Sekiro-like' };

/**
 * Perfect window totals the reference 155 ms (combat-references/), mostly before impact,
 * with less late grace than Sekiro-like. Regular blocks still chip HP.
 */
export const PRESET_LIESOFP_LIKE: TimingConfig = {
  ...BASE,
  name: 'Lies of P-like',
  perfectEarlyMs: 125,
  perfectLateMs: 30,
  blockHpMult: 0.4,
  blockPlayerPostureMult: 0.4,
  deflectEnemyPostureMult: 0.8,
  spamMaxEntries: 4,
};

/**
 * Accessibility: 250 ms perfect window, the upper of the two values players use as
 * modded windows in the combat reference. Otherwise the Sekiro-like rules (blocks cost no HP).
 */
export const PRESET_EASY: TimingConfig = {
  ...BASE,
  name: 'Easy',
  perfectEarlyMs: 220,
  perfectLateMs: 30,
};

/**
 * Parry chain: the Nth perfect in a row (no block or hit between) multiplies the posture damage
 * it deals. The last value repeats for longer chains.
 */
export const CHAIN_MULT = [1, 1.15, 1.3, 1.5]; // capped low so skill speeds fights up without trivialising them

/**
 * Frenzy: a wounded enemy attacks faster. Levels apply below an HP fraction; windups and idle
 * pauses are scaled, and 3-hit strings get more likely. Locked in when each attack starts.
 */
export const FRENZY = [
  // Windups shrink only a little (VR swings must stay reactable); pressure comes from shorter pauses.
  { belowHp: 0.25, windup: 0.85, idle: 0.6, tripleWeight: 2 },
  { belowHp: 0.5, windup: 0.9, idle: 0.8, tripleWeight: 1 },
];

export const PRESETS = [PRESET_SEKIRO_LIKE, PRESET_LIESOFP_LIKE, PRESET_EASY];

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
