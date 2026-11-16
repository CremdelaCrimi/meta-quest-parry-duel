import { describe, expect, it } from 'vitest';
import { PlaytestLog } from '../src/core/playtest';
import type { DuelEvent } from '../src/core/types';

const ev = (e: Partial<DuelEvent> & Pick<DuelEvent, 'type' | 't'>): DuelEvent => e as DuelEvent;

describe('playtest log', () => {
  it('ties guard outcomes to the swing that caused them', () => {
    const log = new PlaytestLog();
    log.onEvent(ev({ type: 'attackStart', t: 0, feintMs: 300 }));
    log.onEvent(ev({ type: 'block', t: 900, faults: ['early'] }));
    log.onEvent(ev({ type: 'attackStart', t: 2000, feintMs: 250 }));
    log.onEvent(ev({ type: 'perfect', t: 2900 }));
    log.onEvent(ev({ type: 'enemyHit', t: 3100, riposte: true }));
    log.onEvent(ev({ type: 'attackStart', t: 4000, fury: true }));
    log.onEvent(ev({ type: 'hit', t: 4700, faults: ['late', 'fury'] }));
    log.onEvent(ev({ type: 'attackStart', t: 6000 }));
    log.onEvent(ev({ type: 'perfect', t: 6600 }));
    expect(log.n).toMatchObject({ swings: 4, feinted: 2, feintEarly: 1, feintPerfect: 1, fury: 1, furyPerfect: 0, perfects: 2, ripostes: 1 });
    const rows = log.summary();
    expect(rows.find((r) => r.label.startsWith('Riposte'))?.value).toBe('50 % of 2 perfects');
    expect(rows.find((r) => r.label === 'Fury: perfect rate')?.value).toBe('0 % of 1');
    expect(log.minutes).toBeCloseTo(0.11, 2);
  });

  it('counts charges, regain and lockouts, and resets', () => {
    const log = new PlaytestLog();
    log.onEvent(ev({ type: 'charged', t: 0 }));
    log.onEvent(ev({ type: 'enemyBlock', t: 500, charged: true }));
    log.onEvent(ev({ type: 'block', t: 1000, damage: 7, regain: 7 }));
    log.onEvent(ev({ type: 'regain', t: 1500, damage: 5 }));
    log.onEvent(ev({ type: 'lockout', t: 2000 }));
    expect(log.summary().find((r) => r.label.startsWith('Guard Regain'))?.value).toBe('5 of 7 HP');
    expect(log.n.chargedStrikes).toBe(1);
    log.reset();
    expect(log.n.lockouts).toBe(0);
    expect(log.minutes).toBe(0);
  });
});
