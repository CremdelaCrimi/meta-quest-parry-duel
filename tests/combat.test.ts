import { describe, expect, it } from 'vitest';
import { DEFAULT_GUARD, PRESET_EASY, PRESET_LIESOFP_LIKE, PRESET_SEKIRO_LIKE } from '../src/core/config';
import { DodgeDetector } from '../src/core/dodge';
import { ATTACKS, ENEMIES } from '../src/core/enemies';
import { classifyGuard } from '../src/core/guard';
import type { GuardReading } from '../src/core/guard';
import { PICKUPS, Run } from '../src/core/roguelite';
import { POSES, TEST_ENEMY, drive, guardAt, makeDuel, outcome, schedule, script } from './helpers';

const L = ATTACKS.slashLeft; // windup 600 ms
const START = 1000;
const S = START + L.windupMs; // strike instant = 1600

describe('guard classification', () => {
  const r: GuardReading = { dir: null, angleErr: 0 };
  it.each([
    ['left', POSES.left],
    ['right', POSES.right],
    ['high', POSES.high],
    ['low', POSES.low],
  ] as const)('%s', (dir, pose) => {
    expect(classifyGuard(pose, DEFAULT_GUARD, r).dir).toBe(dir);
    expect(r.angleErr).toBeLessThan(1);
  });
  it('neutral is no guard', () => {
    expect(classifyGuard(POSES.neutral, DEFAULT_GUARD, r).dir).toBeNull();
  });
});

describe('parry timing', () => {
  it('guard just before the strike is a perfect parry', () => {
    const d = makeDuel();
    script(d, L, START);
    const o = outcome(drive(d, guardAt(POSES.left, S - 60), 2200));
    expect(o?.type).toBe('perfect');
    expect(o!.offsetMs!).toBeLessThan(0);
    expect(o!.offsetMs!).toBeGreaterThan(-PRESET_SEKIRO_LIKE.perfectEarlyMs);
  });

  it('guard held long before the strike is only a block', () => {
    const d = makeDuel();
    script(d, L, START);
    expect(outcome(drive(d, guardAt(POSES.left, S - 400), 2200))?.type).toBe('block');
  });

  it('slightly late guard still parries, resolved at the entry time', () => {
    const d = makeDuel();
    script(d, L, START);
    const o = outcome(drive(d, guardAt(POSES.left, S, 10), 2200))!;
    expect(o.type).toBe('perfect');
    expect(o.offsetMs!).toBeGreaterThan(0);
    expect(o.offsetMs!).toBeLessThanOrEqual(PRESET_SEKIRO_LIKE.perfectLateMs);
    expect(o.t).toBeCloseTo(S + o.offsetMs!, 3);
  });

  it('guard well after the strike is a hit', () => {
    const d = makeDuel();
    script(d, L, START);
    const o = outcome(drive(d, guardAt(POSES.left, S + 100), 2200))!;
    expect(o.type).toBe('hit');
    expect(d.player.hp).toBe(PRESET_SEKIRO_LIKE.playerHp - L.damage);
  });

  it('wrong direction is a hit', () => {
    const d = makeDuel();
    script(d, L, START);
    expect(outcome(drive(d, guardAt(POSES.right, S - 60), 2200))?.type).toBe('hit');
  });

  it('bad blade angle downgrades a timely guard', () => {
    const d = makeDuel();
    script(d, L, START);
    // Blade tilted ~40 degrees from vertical: past perfect (30) but within block (45).
    const a = (40 * Math.PI) / 180;
    const tilted = {
      hilt: { x: -0.6, y: -0.3, z: 0.35 },
      tip: { x: -0.6 + Math.sin(a) * 0.8, y: -0.3 + Math.cos(a) * 0.8, z: 0.35 },
    };
    expect(outcome(drive(d, guardAt(tilted, S - 60), 2200))?.type).toBe('block');
  });

  it('result and offset do not depend on frame rate', () => {
    const at = (hz: number) => {
      const d = makeDuel();
      script(d, L, START);
      return outcome(drive(d, guardAt(POSES.left, S - 75, 35), 2200, hz))!;
    };
    const ref = at(2000);
    // Quest refresh rates: sub-frame resolution makes these essentially identical.
    for (const hz of [72, 90, 120]) {
      const r = at(hz);
      expect(r.type).toBe(ref.type);
      expect(Math.abs(r.offsetMs! - ref.offsetMs!)).toBeLessThan(0.5);
    }
    // Even at 30 Hz the only error is from coarse pose sampling, well under a frame.
    const slow = at(30);
    expect(slow.type).toBe(ref.type);
    expect(Math.abs(slow.offsetMs! - ref.offsetMs!)).toBeLessThan(5);
  });

  it('guard entry and strike inside the same frame are ordered correctly', () => {
    // 20 Hz: one 50 ms frame contains both the guard entry (~1580) and the strike (1600).
    const d = makeDuel();
    script(d, L, 1000);
    const o = outcome(drive(d, guardAt(POSES.left, 1570, 15), 2200, 20))!;
    expect(o.type).toBe('perfect');
    expect(o.offsetMs!).toBeLessThan(0);
  });

  it('the Lies of P preset matches the 155 ms reference window, with less late grace', () => {
    const lop = PRESET_LIESOFP_LIKE;
    expect(lop.perfectEarlyMs + lop.perfectLateMs).toBe(155);

    // 1000 Hz so the guard entry lands within ~1 ms of `at`.
    const run = (timing: typeof PRESET_SEKIRO_LIKE, at: number) => {
      const d = makeDuel({ timing });
      script(d, L, START);
      return outcome(drive(d, guardAt(POSES.left, at, 2), 2200, 1000))!;
    };
    // ~34 ms late: inside Sekiro-like's 40 ms late grace, outside Lies of P-like's 30 ms.
    const sek = run(PRESET_SEKIRO_LIKE, S + 33);
    const lp = run(PRESET_LIESOFP_LIKE, S + 33);
    expect(sek.offsetMs!).toBeGreaterThan(31);
    expect(sek.offsetMs!).toBeLessThan(38);
    expect(sek.type).toBe('perfect');
    expect(lp.type).toBe('block');
  });
});

describe('easy preset', () => {
  it('has a 250 ms perfect window that parries what Sekiro-like only blocks', () => {
    expect(PRESET_EASY.perfectEarlyMs + PRESET_EASY.perfectLateMs).toBe(250);
    const run = (timing: typeof PRESET_SEKIRO_LIKE) => {
      const d = makeDuel({ timing });
      script(d, L, START);
      return outcome(drive(d, guardAt(POSES.left, S - 180, 2), 2200, 1000))!.type;
    };
    expect(run(PRESET_SEKIRO_LIKE)).toBe('block');
    expect(run(PRESET_EASY)).toBe('perfect');
  });
});

describe('hit-stop', () => {
  const HS = PRESET_SEKIRO_LIKE.hitStopMs;
  /** How far the enemy clock has fallen behind real time. */
  const lag = (d: ReturnType<typeof makeDuel>) => d.time - d.enemy.clock;

  it('a perfect parry freezes the enemy clock for exactly hitStopMs, at any frame rate', () => {
    for (const hz of [30, 72, 90, 120]) {
      const d = makeDuel();
      script(d, L, START);
      expect(outcome(drive(d, guardAt(POSES.left, S - 60), 2200, hz))?.type).toBe('perfect');
      expect(lag(d)).toBeCloseTo(HS, 6);
    }
  });

  it('a regular block does not freeze the enemy', () => {
    const d = makeDuel();
    script(d, L, START);
    expect(outcome(drive(d, guardAt(POSES.left, S - 400), 2200))?.type).toBe('block');
    expect(lag(d)).toBeCloseTo(0, 6);
  });

  it('a posture-breaking parry freezes twice as long', () => {
    const d = makeDuel({ enemy: { ...TEST_ENEMY, postureMax: 1 } });
    script(d, L, START);
    const evs = drive(d, guardAt(POSES.left, S - 60), 2200);
    expect(evs.some((e) => e.type === 'enemyPostureBreak')).toBe(true);
    expect(lag(d)).toBeCloseTo(HS * 2, 6);
  });

  it('the next combo strike lands hitStopMs later, so it stays in sync with the frozen pose', () => {
    const d = makeDuel();
    d.scriptCombo({ weight: 1, steps: [{ attack: L, chainDelayMs: 300 }, { attack: L, chainDelayMs: 0 }] }, START);
    const evs = drive(d, guardAt(POSES.left, S - 60), 3000).filter((e) => ['perfect', 'block', 'hit'].includes(e.type));
    expect(evs[0].type).toBe('perfect');
    // Second strike: S + chain 300 + windup 600 on the enemy clock, plus the freeze in real time.
    expect(evs[1].t).toBeCloseTo(S + 300 + L.windupMs + HS, 6);
  });

  it('the counter window opens after the freeze', () => {
    const d = makeDuel();
    script(d, L, START);
    // Past S + counterWindowMs, but inside it once the freeze is added.
    const at = S + PRESET_SEKIRO_LIKE.counterWindowMs + HS / 2;
    const evs = drive(d, guardAt(POSES.left, S - 60), 2600, 90, { strikeAt: [at] });
    const hit = evs.find((e) => e.type === 'enemyHit');
    expect(hit?.damage).toBeCloseTo(PRESET_SEKIRO_LIKE.playerDamage * 1.5, 6);
  });
});

describe('anti-spam', () => {
  it('flailing in and out of guard locks out the perfect parry', () => {
    const d = makeDuel();
    script(d, L, START);
    const N = POSES.neutral;
    const keys: Array<[number, typeof N]> = [
      [S - 560, POSES.left],
      [S - 480, N],
      [S - 400, POSES.left],
      [S - 320, N],
      [S - 240, POSES.left],
      [S - 160, N],
      [S - 60, POSES.left],
    ];
    const evs = drive(d, schedule(keys), 2200);
    expect(evs.some((e) => e.type === 'lockout')).toBe(true);
    expect(outcome(evs)?.type).toBe('block');
  });
});

describe('perilous attacks and dodges', () => {
  const lean = (at: number) => (t: number) => ({ x: Math.min(0.3, Math.max(0, (t - at) / 150) * 0.3), y: 0, z: 0 });
  const duck = (at: number) => (t: number) => ({ x: 0, y: -Math.min(0.35, Math.max(0, (t - at) / 150) * 0.35), z: 0 });
  const T = ATTACKS.thrust;
  const TS = START + T.windupMs;

  it('a thrust cannot be blocked', () => {
    const d = makeDuel();
    script(d, T, START);
    expect(outcome(drive(d, guardAt(POSES.high, TS - 60), 2500))?.type).toBe('hit');
  });

  it('leaning dodges a thrust', () => {
    const d = makeDuel();
    script(d, T, START);
    const evs = drive(d, () => POSES.neutral, 2500, 90, { headAt: lean(TS - 200) });
    expect(evs.some((e) => e.type === 'dodge' && e.dodge === 'leanRight')).toBe(true);
    expect(outcome(evs)?.type).toBe('dodged');
  });

  it('ducking does not dodge a thrust but does dodge a sweep', () => {
    const d1 = makeDuel();
    script(d1, T, START);
    expect(outcome(drive(d1, () => POSES.neutral, 2500, 90, { headAt: duck(TS - 200) }))?.type).toBe('hit');

    const d2 = makeDuel();
    script(d2, ATTACKS.sweep, START);
    expect(outcome(drive(d2, () => POSES.neutral, 2500, 90, { headAt: duck(TS - 200) }))?.type).toBe('dodged');
  });

  it('dodging too early runs out of i-frames', () => {
    const d = makeDuel();
    script(d, T, START);
    expect(outcome(drive(d, () => POSES.neutral, 2500, 90, { headAt: lean(TS - 700) }))?.type).toBe('hit');
  });

  it('dodge detector interpolates the crossing time', () => {
    const det = new DodgeDetector();
    const hit = det.update(0, 100, { x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0 });
    expect(hit?.kind).toBe('leanRight');
    expect(hit!.t).toBeCloseTo(50, 5);
    // Must return toward centre before another lean counts.
    expect(det.update(100, 200, { x: 0.15, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0 })).toBeNull();
  });
});

describe('posture and finisher', () => {
  it('repeated deflects break posture, then a strike is a finisher', () => {
    const d = makeDuel();
    const H = ATTACKS.heavyHigh; // 34 posture each
    const keys: Array<[number, typeof POSES.high]> = [];
    let start = 1000;
    for (let i = 0; i < 3; i++) {
      script(d, H, start);
      // `start` is enemy-clock time; earlier parries' hit-stops put real time ahead of it.
      const s = start + H.windupMs + (d.time - d.enemy.clock);
      keys.length = 0;
      keys.push([s - 60, POSES.high], [s + 200, POSES.neutral]);
      drive(d, schedule(keys), s + 300);
      start = d.enemy.clock + 100;
    }
    expect(d.enemy.state).toBe('stagger');
    const evs = drive(d, () => POSES.neutral, d.time + 200, 90, { strikeAt: [d.time + 50] });
    expect(evs.some((e) => e.type === 'finisher')).toBe(true);
    expect(evs.some((e) => e.type === 'enemyDead')).toBe(true);
  });
});

describe('abilities', () => {
  it('slow-time pushes the strike later in real time', () => {
    const d = makeDuel();
    d.mods.abilities.push('slowTime');
    script(d, L, START);
    const evs = drive(d, () => POSES.neutral, 3000, 90, { abilityAt: [[1100, 'slowTime']] });
    const hit = outcome(evs)!;
    expect(hit.type).toBe('hit');
    expect(hit.t).toBeGreaterThan(S + 300);
  });

  it('ward absorbs one hit', () => {
    const d = makeDuel();
    d.mods.abilities.push('ward');
    script(d, L, START);
    const evs = drive(d, () => POSES.neutral, 2400, 90, { abilityAt: [[1100, 'ward']] });
    expect(outcome(evs)?.type).toBe('wardAbsorb');
    expect(d.player.hp).toBe(d.player.hpMax);
  });
});

describe('determinism', () => {
  it('same seed and inputs give identical event streams', () => {
    const run = () => {
      const d = makeDuel({ enemy: ENEMIES[1], ai: true, seed: 42 });
      const pose = (t: number) => (Math.floor(t / 700) % 2 ? POSES.left : POSES.right);
      return JSON.stringify(drive(d, pose, 20000));
    };
    const a = run();
    expect(a.length).toBeGreaterThan(100);
    expect(run()).toBe(a);
  });
});

describe('roguelite run', () => {
  it('offers unique pickups and respects stack limits', () => {
    const run = new Run(7);
    const offer = run.offer();
    expect(offer).toHaveLength(3);
    expect(new Set(offer.map((p) => p.id)).size).toBe(3);
    const ward = PICKUPS.find((p) => p.id === 'ward')!;
    run.choose(ward);
    expect(run.mods.abilities).toContain('ward');
    for (let i = 0; i < 20; i++) expect(run.offer().some((p) => p.id === 'ward')).toBe(false);
  });

  it('later loops make enemies faster', () => {
    const run = new Run(1);
    run.fight = ENEMIES.length;
    expect(run.enemyForFight().speed).toBeGreaterThan(ENEMIES[0].speed);
  });
});
