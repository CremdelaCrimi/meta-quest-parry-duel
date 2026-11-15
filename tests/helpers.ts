import { DEFAULT_GUARD, PRESET_SEKIRO_LIKE, defaultModifiers } from '../src/core/config';
import { lerpPose, makePose } from '../src/core/guard';
import { Duel } from '../src/core/sim';
import type { AttackDef, DashDir, DuelEvent, EnemyDef, StrikeZone, SwordPose, TimingConfig, V3 } from '../src/core/types';

const P = (hx: number, hy: number, hz: number, tx: number, ty: number, tz: number): SwordPose => ({
  hilt: { x: hx, y: hy, z: hz },
  tip: { x: tx, y: ty, z: tz },
});

export const POSES = {
  neutral: P(0.25, -0.6, 0.15, 0.35, -0.6, 0.9),
  left: P(-0.3, -0.5, 0.35, -0.3, 0.3, 0.35),
  right: P(0.3, -0.5, 0.35, 0.3, 0.3, 0.35),
  high: P(-0.4, 0, 0.4, 0.4, 0, 0.4),
  low: P(0.1, -0.8, 0.3, 0.1, -1.0, 0.6),
};

export const TEST_ENEMY: EnemyDef = {
  name: 'Dummy',
  hp: 50,
  postureMax: 100,
  speed: 1,
  idleMinMs: 1000,
  idleMaxMs: 1000,
  combos: [],
};

/**
 * Test duel. Steadiness is off unless `steady: true`, so timing tests (whose scripted guards
 * snap into place just before the strike) measure timing alone; steadiness has its own tests.
 */
export function makeDuel(
  opts: { timing?: TimingConfig; enemy?: EnemyDef; ai?: boolean; seed?: number; steady?: boolean; guards?: boolean; practice?: boolean } = {},
): Duel {
  const timing = opts.timing ?? PRESET_SEKIRO_LIKE;
  return new Duel({
    timing: opts.steady ? timing : { ...timing, steadyMs: 0 },
    guard: DEFAULT_GUARD,
    enemy: opts.enemy ?? TEST_ENEMY,
    mods: defaultModifiers(),
    seed: opts.seed ?? 1,
    ai: opts.ai ?? false,
    guards: opts.guards,
    practice: opts.practice,
  });
}

/** Scripted single attack starting at enemy time `start`. */
export function script(duel: Duel, attack: AttackDef, start: number): void {
  duel.scriptCombo({ weight: 1, steps: [{ attack, chainDelayMs: 0 }] }, start);
}

/** A sword that moves from neutral to `guard` over `moveMs` starting at `at`. */
export function guardAt(guard: SwordPose, at: number, moveMs = 20): (t: number) => SwordPose {
  const out = makePose();
  return (t) => lerpPose(out, POSES.neutral, guard, Math.min(1, Math.max(0, (t - at) / moveMs)));
}

/** Piecewise schedule: list of [time, pose], linear 20 ms moves between them. */
export function schedule(keys: Array<[number, SwordPose]>, moveMs = 20): (t: number) => SwordPose {
  const out = makePose();
  return (t) => {
    let from = POSES.neutral;
    for (const [kt, pose] of keys) {
      if (t < kt) break;
      const f = Math.min(1, (t - kt) / moveMs);
      lerpPose(out, from, pose, f);
      if (f < 1) return out;
      from = pose;
    }
    lerpPose(out, from, from, 0);
    return out;
  };
}

const still: V3 = { x: 0, y: 0, z: 0 };

export function drive(
  duel: Duel,
  poseAt: (t: number) => SwordPose,
  tEnd: number,
  hz = 90,
  extra: {
    headAt?: (t: number) => V3;
    strikeAt?: number[];
    /** Zone and poke applied to every strike in strikeAt (default centre slash). */
    zone?: StrikeZone;
    poke?: boolean;
    twoHanded?: boolean;
    abilityAt?: Array<[number, 'slowTime' | 'ward']>;
    dashAt?: Array<[number, DashDir]>;
    /** Block button state over time (omit = no button, always held). */
    heldAt?: (t: number) => boolean;
    /** Out of his reach over time. */
    farAt?: (t: number) => boolean;
    grappleAt?: Array<[number, 'hit' | 'miss']>;
  } = {},
): DuelEvent[] {
  const dt = 1000 / hz;
  const events: DuelEvent[] = [];
  const headAt = extra.headAt ?? (() => still);
  let t = duel.time;
  const clone = (p: SwordPose): SwordPose => ({ hilt: { ...p.hilt }, tip: { ...p.tip } });
  let prev = clone(poseAt(t));
  let prevHead = { ...headAt(t) };
  const strikes = [...(extra.strikeAt ?? [])];
  const abilities = [...(extra.abilityAt ?? [])];
  const dashes = [...(extra.dashAt ?? [])];
  const grapples = [...(extra.grappleAt ?? [])];
  while (t < tEnd - 1e-9) {
    const t1 = t + dt;
    const cur = clone(poseAt(t1));
    const head = { ...headAt(t1) };
    let strikeSpeed = 0;
    if (strikes.length && strikes[0] <= t1) {
      strikes.shift();
      strikeSpeed = 3;
    }
    let ability: 'slowTime' | 'ward' | null = null;
    if (abilities.length && abilities[0][0] <= t1) ability = abilities.shift()![1];
    let dash: DashDir | null = null;
    if (dashes.length && dashes[0][0] <= t1) dash = dashes.shift()![1];
    let grapple: 'hit' | 'miss' | null = null;
    if (grapples.length && grapples[0][0] <= t1) grapple = grapples.shift()![1];
    duel.step({
      t0: t,
      t1,
      swordPrev: prev,
      swordCurr: cur,
      headPrev: prevHead,
      headCurr: head,
      strikeSpeed,
      strikeZone: extra.zone,
      strikePoke: extra.poke,
      twoHanded: extra.twoHanded,
      ability,
      dash,
      blockHeld: extra.heldAt?.(t1),
      outOfReach: extra.farAt?.(t1),
      grapple,
    });
    for (const e of duel.events) events.push({ ...e });
    prev = cur;
    prevHead = head;
    t = t1;
  }
  return events;
}

export const outcome = (evs: DuelEvent[]) => evs.find((e) => ['perfect', 'block', 'hit', 'dodged', 'wardAbsorb'].includes(e.type));
