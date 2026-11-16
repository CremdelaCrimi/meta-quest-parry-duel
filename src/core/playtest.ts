import type { DuelEvent } from './types';

/** One readout line: what it measures, the number, and how to read it. */
export interface PlaytestRow {
  label: string;
  value: string;
  hint: string;
}

/**
 * Playtest metrics for the A/B mechanics (menu → Mechanics), one signal per mechanic as proposed in
 * the Gemini consult (2026-11-16, docs/design/2026-11-16-gemini-research.md). Fed the duel's events;
 * pure bookkeeping, so it can be unit tested and dumped from the console (game.playtest.summary()).
 */
export class PlaytestLog {
  private startT = NaN;
  private lastT = 0;
  /** The swing the next guard outcome belongs to. */
  private cur = { feint: false, fury: false, sig: false };
  readonly n = {
    swings: 0,
    feinted: 0,
    feintPerfect: 0,
    feintEarly: 0,
    feintHit: 0,
    fury: 0,
    furyPerfect: 0,
    perfects: 0,
    blocks: 0,
    hits: 0,
    furyDodged: 0,
    sig: 0,
    sigPerfect: 0,
    ripostes: 0,
    counters: 0,
    lockouts: 0,
    charges: 0,
    chargedStrikes: 0,
    regainChip: 0,
    regainBack: 0,
  };

  reset(): void {
    for (const k of Object.keys(this.n) as Array<keyof PlaytestLog['n']>) this.n[k] = 0;
    this.startT = NaN;
  }

  onEvent(ev: DuelEvent): void {
    const n = this.n;
    if (Number.isNaN(this.startT)) this.startT = ev.t;
    this.lastT = ev.t;
    switch (ev.type) {
      case 'attackStart':
        n.swings++;
        this.cur = { feint: (ev.feintMs ?? 0) > 0, fury: !!ev.fury, sig: ev.attackId === 'mainspring' };
        if (this.cur.sig) n.sig++;
        if (this.cur.feint) n.feinted++;
        if (this.cur.fury) n.fury++;
        break;
      case 'perfect':
        n.perfects++;
        if (this.cur.feint) n.feintPerfect++;
        if (this.cur.fury) n.furyPerfect++;
        if (this.cur.sig) n.sigPerfect++;
        break;
      case 'block':
        n.blocks++;
        if (this.cur.feint && ev.faults?.includes('early')) n.feintEarly++;
        if (ev.regain) n.regainChip += ev.damage ?? 0;
        break;
      case 'hit':
        if (ev.perilous === undefined || ev.perilous === 'none') n.hits++;
        if (this.cur.fury && ev.dodge) n.furyDodged++;
        if (this.cur.feint) n.feintHit++;
        if (this.cur.feint && ev.faults?.includes('early')) n.feintEarly++;
        break;
      case 'enemyHit':
        if (ev.riposte) n.ripostes++;
        else if (!ev.heavy && !ev.opening) n.counters++;
        if (ev.charged) n.chargedStrikes++;
        break;
      case 'enemyBlock':
        if (ev.charged) n.chargedStrikes++;
        break;
      case 'lockout':
        n.lockouts++;
        break;
      case 'charged':
        n.charges++;
        break;
      case 'regain':
        n.regainBack += ev.damage ?? 0;
        break;
    }
  }

  /** Minutes of play logged. */
  get minutes(): number {
    return Number.isNaN(this.startT) ? 0 : Math.max(0, this.lastT - this.startT) / 60000;
  }

  summary(): PlaytestRow[] {
    const n = this.n;
    const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)} %` : '—');
    const min = Math.max(this.minutes, 1 / 60);
    return [
      { label: 'Time logged', value: `${this.minutes.toFixed(1)} min · ${n.swings} swings`, hint: 'Since the last reset' },
      { label: 'Perfect rate (all guards)', value: `${pct(n.perfects, n.perfects + n.blocks + n.hits)}`, hint: 'Session 1 target 40-60 %; under 20 % = angle check too strict' },
      { label: 'Feints: perfect rate', value: `${pct(n.feintPerfect, n.feinted)} of ${n.feinted}`, hint: 'Rising over a session = you are reading the release' },
      { label: 'Feints: guarded too early', value: pct(n.feintEarly, n.feinted), hint: 'Falling = less rhythm-guessing' },
      { label: 'Fury: perfect rate', value: `${pct(n.furyPerfect, n.fury)} of ${n.fury} · ${n.furyDodged} tried to dodge`, hint: 'Under 30 % = too tight; many dodges = the colour reads as must-dodge' },
      { label: 'Phase 2: Mainspring parried', value: `${pct(n.sigPerfect, n.sig)} of ${n.sig}`, hint: 'Low = the clank rhythm is not readable enough' },
      { label: 'Riposte use', value: `${pct(n.ripostes, n.perfects)} of ${n.perfects} perfects`, hint: 'High = it pulls you into offence' },
      { label: 'Spam lockouts', value: `${n.lockouts} · ${(n.lockouts / min).toFixed(1)}/min`, hint: 'Should drop as you stop flailing' },
      { label: 'Charges built / used', value: `${n.charges} / ${n.chargedStrikes}`, hint: 'Built but unused = hand jitter breaks it, or no time' },
      { label: 'Guard Regain won back', value: `${Math.round(n.regainBack)} of ${Math.round(n.regainChip)} HP`, hint: 'Low = blocks feel like pure loss' },
    ];
  }
}
