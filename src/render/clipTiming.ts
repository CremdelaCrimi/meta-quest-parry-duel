// Maps the sim's attack timeline onto an authored animation clip. No three.js here, so it is unit-tested.

/** Marks on an authored attack clip, in ms from the clip start. */
export interface ClipMarks {
  /** End of the anticipation pose: the weapon starts moving fast toward the target. */
  releaseMs: number;
  /** The blade connects. Must land exactly on the sim's strike instant. */
  impactMs: number;
  durationMs: number;
}

/** The swing never takes more than this share of the windup, so short windups still read as a pose then a strike. */
const MAX_SWING_SHARE = 0.45;

/**
 * Clip time (ms) for an attack `sinceStartMs` into its timeline (enemy clock, so slow-time and
 * hit-stop already apply). The windup section stretches to fill any windup, so one clip serves
 * fast, normal and delayed versions of a move; the swing keeps its authored speed when it fits;
 * impact always lands on `windupMs`; recovery plays at authored speed.
 */
export function clipTimeAt(c: ClipMarks, windupMs: number, sinceStartMs: number): number {
  const authoredSwing = Math.max(1, c.impactMs - c.releaseMs);
  const swing = Math.min(authoredSwing, windupMs * MAX_SWING_SHARE);
  const hold = windupMs - swing;
  const t = Math.max(0, sinceStartMs);
  if (t < hold) return c.releaseMs * (t / hold);
  if (t < windupMs) return c.releaseMs + ((t - hold) / swing) * authoredSwing;
  return Math.min(c.durationMs, c.impactMs + (t - windupMs));
}
