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

/** Where the player's strike met the enemy's body, from the player's view. */
export type StrikeZone = 'left' | 'right' | 'center';
/** Side the idle enemy holds his sword on (player's view). The other side is his opening. */
export type GuardSide = 'left' | 'right';

/**
 * The shape of a swing, for readability only (the sim judges by `dir`):
 * vertical = overhead chop (lands high), horizontal = level sweep from one side,
 * diagonal = from a raised shoulder down across (both land on that side).
 */
export type Swing = 'vertical' | 'horizontal' | 'diagonal';

export interface AttackDef {
  id: string;
  dir: Dir;
  perilous: Perilous;
  swing?: Swing;
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
  /**
   * Steadiness: for a perfect parry the blade tip must have moved slower than steadyMaxSpeed
   * (m/s) for the last steadyMs before the guard is judged. You set your guard and hold it;
   * swinging into the block isn't a parry. 0 disables the check.
   */
  steadyMs: number;
  steadyMaxSpeed: number;
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
  /**
   * Assist that only ever helps: after this many hits in a row (no perfect between), the perfect
   * window opens assistBonusMs earlier until the next perfect. 0 bonus disables it.
   */
  assistAfterHits: number;
  assistBonusMs: number;
  /** The assist never pushes the total bonus on the perfect window (boons + assist) past this. */
  windowBonusCapMs: number;

  playerDamage: number;
  playerPostureDamageOnBlocked: number;
  /** A poke (thrust along the blade) into a guard deals this much more posture than a slash. */
  pokePostureMult: number;
  /** While idle the enemy guards one side and moves his guard every guardShiftMin..MaxMs. */
  guardShiftMinMs: number;
  guardShiftMaxMs: number;
  /**
   * Two-handed grip (left hand on the handle): steadier guards and heavier hits, slower to
   * strike again (the strike cooldown lives in the input layer). One-handed keeps the 2x pokes.
   */
  twoHandSteadyMaxSpeed: number;
  twoHandAngleBonusDeg: number;
  /** Multiplies blockPlayerPostureMult while two-handed (braced guard). */
  twoHandBlockPostureMult: number;
  twoHandDamageMult: number;
  /** Poke posture multiplier while two-handed (replaces pokePostureMult). */
  twoHandPokeMult: number;
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
  /** Where the strike met his body (default 'center'), and whether it was a poke. */
  strikeZone?: StrikeZone;
  strikePoke?: boolean;
  /** Left hand is on the handle this frame. */
  twoHanded?: boolean;
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

/**
 * Why a guard wasn't a perfect parry (or wasn't a block at all). Several can apply at once.
 * early/late: outside the timing window · angle: blade not square to the attack ·
 * shaky: blade still moving (swung into the guard) · locked: anti-spam lockout · side: wrong guard.
 */
export type Fault = 'early' | 'late' | 'angle' | 'shaky' | 'locked' | 'side';

export interface DuelEvent {
  type: DuelEventType;
  /** On block/hit: everything that kept it from being a perfect parry. */
  faults?: Fault[];
  /** Sub-frame time the event happened (ms). */
  t: number;
  /** Guard entry minus strike time (ms). Negative = early, positive = late. */
  offsetMs?: number;
  /** On perfect: how many perfects in a row this is (1 = first). */
  chain?: number;
  dir?: Dir;
  attackId?: string;
  perilous?: Perilous;
  damage?: number;
  dodge?: DodgeKind;
  ability?: AbilityId;
  /** On enemyHit / enemyBlock: where the strike landed and whether it was a poke. */
  zone?: StrikeZone;
  poke?: boolean;
  /** On enemyHit: it went through his opening while he was idle. */
  opening?: boolean;
}
