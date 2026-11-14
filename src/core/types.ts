// Pure data types for the combat core. No three.js imports anywhere in src/core.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Coordinates are in the "duel frame":
 *   origin = the player's calibrated head position
 *   +x = player's right, +y = up, +z = toward the enemy
 */
export interface SwordPose {
  hilt: V3;
  tip: V3;
}

/** Side of the PLAYER the attack lands on (and so where the player must guard). */
export type Dir = 'high' | 'left' | 'right' | 'low';

/** Perilous attacks cannot be blocked: thrusts need a lean-dodge, sweeps need a duck. */
export type Perilous = 'none' | 'thrust' | 'sweep';

export type DodgeKind = 'leanLeft' | 'leanRight' | 'duck';

export interface AttackDef {
  id: string;
  dir: Dir;
  perilous: Perilous;
  /** Time from attack start to the strike instant. This is the telegraph. */
  windupMs: number;
  /** Time after the strike before the enemy can act again (if no combo follow-up). */
  recoverMs: number;
  damage: number;
  postureDamage: number;
}

export interface ComboStep {
  attack: AttackDef;
  /** Delay after this step's strike before the next step starts. Ignored on the last step. */
  chainDelayMs: number;
}

export interface Combo {
  weight: number;
  steps: ComboStep[];
}

export interface EnemyDef {
  name: string;
  hp: number;
  postureMax: number;
  /** Timeline speed multiplier: 1.2 means every duration is 1.2x shorter. */
  speed: number;
  idleMinMs: number;
  idleMaxMs: number;
  combos: Combo[];
}

export interface GuardConfig {
  /** Blade midpoint must be at least this far toward the enemy (m). */
  minForward: number;
  /** Blade midpoint below this height (relative to head) counts as a low guard. */
  lowY: number;
  /** A horizontal blade above this height counts as a high guard. */
  highY: number;
  /** Vertical blade must be this far left/right of the head's centre line. */
  sideDeadzone: number;
}

export interface TimingConfig {
  name: string;
  /** Perfect parry: guard entry may be this early before the strike... */
  perfectEarlyMs: number;
  /** ...or this late after it. */
  perfectLateMs: number;
  /** Late grace for a regular block (guard entering just after the strike). */
  blockLateMs: number;
  /** Max blade angle error (degrees from ideal) for perfect / block. */
  perfectAngleDeg: number;
  blockAngleDeg: number;
  /** Anti-spam: more than spamMaxEntries guard entries within spamWindowMs locks out perfect parries. */
  spamWindowMs: number;
  spamMaxEntries: number;
  spamLockoutMs: number;

  blockHpMult: number;
  blockPlayerPostureMult: number;
  blockEnemyPostureMult: number;
  deflectEnemyPostureMult: number;
  deflectPlayerPosture: number;

  playerHp: number;
  playerPostureMax: number;
  postureRegenPerSec: number;
  enemyPostureRegenPerSec: number;
  postureRegenDelayMs: number;

  enemyStaggerMs: number;
  iframesMs: number;
  dodgeCooldownMs: number;
  counterWindowMs: number;
  /** Enemy freeze on a perfect parry (doubled when it breaks posture). Player and camera never freeze. */
  hitStopMs: number;

  playerDamage: number;
  playerPostureDamageOnBlocked: number;
  finisherDamage: number;
}

export type AbilityId = 'slowTime' | 'ward';

export interface Modifiers {
  perfectWindowBonusMs: number;
  deflectPostureMult: number;
  counterDamageMult: number;
  playerDamageMult: number;
  iframesBonusMs: number;
  healOnPerfect: number;
  maxHpBonus: number;
  abilities: AbilityId[];
}

export interface FrameInput {
  /** Previous and current frame times (ms). The sim resolves events at sub-frame times in between. */
  t0: number;
  t1: number;
  swordPrev: SwordPose;
  swordCurr: SwordPose;
  /** Head offset from the calibrated centre, in duel frame, at t0 and t1. */
  headPrev: V3;
  headCurr: V3;
  /** >0 if the blade struck the enemy this frame (detected by the render/XR layer). */
  strikeSpeed: number;
  /** Ability activated this frame (edge-triggered), or null. */
  ability: AbilityId | null;
}

export type DuelEventType =
  | 'attackStart'
  | 'perfect'
  | 'block'
  | 'hit'
  | 'dodged'
  | 'dodge'
  | 'lockout'
  | 'playerPostureBreak'
  | 'enemyHit'
  | 'enemyBlock'
  | 'enemyPostureBreak'
  | 'finisher'
  | 'enemyDead'
  | 'playerDead'
  | 'abilityUsed'
  | 'wardAbsorb';

export interface DuelEvent {
  type: DuelEventType;
  /** Sub-frame time the event happened (ms). */
  t: number;
  /** Guard entry minus strike time (ms). Negative = early, positive = late. */
  offsetMs?: number;
  dir?: Dir;
  attackId?: string;
  perilous?: Perilous;
  damage?: number;
  dodge?: DodgeKind;
  ability?: AbilityId;
}
