import type { Perilous } from '../core/types';
import type { CanvasPanel } from './panels';
import { brassFrame } from './panels';

const FONT = 'system-ui, sans-serif';
const GOLD = '#ffd34d';
const BLUE = '#6fb6ff';
const GREEN = '#60ff9a';
const RED = '#ff5050';
const DIM = '#7c8594';
const TEXT = '#e0e4ea';

export interface TimelineMark {
  /** ms relative to the strike instant (negative = before it). */
  ms: number;
  lane: 'guard' | 'strike';
  color: string;
  label: string;
}

/** One enemy swing laid out on a time axis: what to do when, and what you actually did. */
export interface TimelineData {
  title: string;
  how: string;
  color: string;
  windup: number;
  /** Time after the strike that the bar shows (his recovery, or the gap to the next swing). */
  after: number;
  /** Is `after` his recovery (strikes punish) or just the gap before the next swing in a string? */
  afterIsRecovery: boolean;
  perilous: Perilous;
  perfectEarly: number;
  perfectLate: number;
  blockLate: number;
  iframes: number;
  /** Perfect-dodge window before the strike (ms). */
  perfectDodge: number;
  /** Counter window opened by a perfect or a dodge: [from, from + ms] relative to the strike. */
  counter: [number, number] | null;
  /** Where the swing is now (ms relative to the strike), or null once it's over. */
  now: number | null;
  marks: TimelineMark[];
}

/**
 * The swing timeline. Top lane = your guard (when a guard counts as perfect, block or too late;
 * for red attacks, when to dodge). Bottom lane = your strikes (when they land and why).
 * Ticks show what you did; a white cursor runs along it during the swing.
 */
export function drawTimeline(panel: CanvasPanel, d: TimelineData | null, idleText: string[]): void {
  panel.draw((ctx, w, h) => {
    brassFrame(ctx, 0, 0, w, h, 0.88);
    ctx.fillStyle = DIM;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText('SWING TIMELINE', 28, 40);
    if (!d) {
      ctx.fillStyle = TEXT;
      ctx.font = `600 34px ${FONT}`;
      idleText.forEach((l, i) => ctx.fillText(l, 28, 110 + i * 50));
      return;
    }
    ctx.fillStyle = d.color;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(d.title, 28, 88);
    ctx.fillStyle = TEXT;
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(d.how, 28, 126);
    if (d.now === null) {
      ctx.fillStyle = DIM;
      ctx.textAlign = 'right';
      ctx.fillText('last swing', w - 28, 40);
      ctx.textAlign = 'left';
    }

    const x0 = 150;
    const x1 = w - 36;
    const from = -d.windup - 80;
    const to = d.after;
    const X = (ms: number) => x0 + ((Math.max(from, Math.min(to, ms)) - from) / (to - from)) * (x1 - x0);
    const zone = (a: number, b: number, y: number, hh: number, color: string, label = '', labelColor = '#0a0c12') => {
      const xa = X(a), xb = X(b);
      if (xb - xa < 1) return;
      ctx.fillStyle = color;
      ctx.fillRect(xa, y, xb - xa, hh);
      if (label && xb - xa > ctx.measureText(label).width + 8) {
        ctx.fillStyle = labelColor;
        ctx.fillText(label, xa + 6, y + hh / 2 + 9);
      }
    };

    // Lane labels.
    const gy = 170, sy = 270, lh = 64;
    ctx.fillStyle = DIM;
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(d.perilous === 'none' ? 'GUARD' : 'DODGE', 28, gy + 40);
    ctx.fillText('STRIKE', 28, sy + 40);

    // Guard lane.
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x0, gy, x1 - x0, lh);
    ctx.font = `700 24px ${FONT}`;
    if (d.perilous === 'none') {
      zone(-d.windup, -d.perfectEarly, gy, lh, 'rgba(111,182,255,0.45)', 'held early = block', '#dce9ff');
      zone(-d.perfectEarly, d.perfectLate, gy, lh, GOLD);
      zone(d.perfectLate, d.blockLate, gy, lh, 'rgba(111,182,255,0.75)');
      zone(d.blockLate, d.after, gy, lh, 'rgba(255,80,80,0.35)', 'too late = hit', '#ffd0d0');
    } else {
      zone(-d.windup, -d.iframes, gy, lh, 'rgba(255,80,80,0.25)', 'too early', '#ffd0d0');
      zone(-d.iframes, -d.perfectDodge, gy, lh, 'rgba(111,182,255,0.55)', 'safe', '#dce9ff');
      zone(-d.perfectDodge, 0, gy, lh, GOLD, 'PERFECT');
      zone(0, d.after, gy, lh, 'rgba(255,80,80,0.35)', d.perilous === 'thrust' ? 'too late · dodge SIDEWAYS' : 'too late · DUCK / BACK', '#ffd0d0');
    }

    // Strike lane: during his swing strikes land but you eat the hit unless you also block;
    // his recovery is the safe punish; a counter (after a perfect or dodge) hits for 1.5x.
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x0, sy, x1 - x0, lh);
    zone(-d.windup, 0, sy, lh, 'rgba(255,176,32,0.35)', 'lands, but you trade hits', '#ffe2b0');
    if (d.afterIsRecovery) zone(0, d.after, sy, lh, 'rgba(96,255,154,0.55)', 'HIS RECOVERY: punish', '#06240f');
    else zone(0, d.after, sy, lh, 'rgba(255,176,32,0.35)', 'next swing coming', '#ffe2b0');
    if (d.counter) zone(d.counter[0], d.counter[1], sy, lh, GOLD, 'COUNTER ×1.5');

    // Strike instant and scale.
    ctx.strokeStyle = RED;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(X(0), gy - 14);
    ctx.lineTo(X(0), sy + lh + 10);
    ctx.stroke();
    ctx.fillStyle = RED;
    ctx.font = `800 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('STRIKE', X(0), gy + lh + 26); // in the gap between the lanes
    ctx.fillStyle = DIM;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(`−${Math.round(d.windup)} ms`, X(-d.windup), sy + lh + 34);
    ctx.fillText(`+${Math.round(d.after)} ms`, X(d.after) - 20, sy + lh + 34);
    ctx.fillStyle = GOLD;
    if (d.perilous === 'none') ctx.fillText(`perfect −${d.perfectEarly}…+${d.perfectLate}`, X(-d.perfectEarly / 2), sy + lh + 34);

    // What you did.
    for (const m of d.marks) {
      const y = m.lane === 'guard' ? gy : sy;
      const x = X(m.ms);
      ctx.fillStyle = m.color;
      ctx.fillRect(x - 4, y - 6, 8, lh + 12);
      ctx.font = `800 22px ${FONT}`;
      ctx.fillText(m.label, x, m.lane === 'strike' ? y + lh + 74 : y - 12);
    }
    // Where the swing is now.
    if (d.now !== null) {
      ctx.fillStyle = '#ffffff';
      const x = X(d.now);
      ctx.beginPath();
      ctx.moveTo(x - 12, gy - 32);
      ctx.lineTo(x + 12, gy - 32);
      ctx.lineTo(x, gy - 14);
      ctx.fill();
      ctx.fillRect(x - 2, gy, 4, sy + lh - gy);
    }
    ctx.textAlign = 'left';
  });
}

/** Big plain-language coaching: what he's doing right now and what you should do about it. */
export function drawCoach(panel: CanvasPanel, header: string, lines: Array<[string, string, number]>, footer: string): void {
  panel.draw((ctx, w, h) => {
    brassFrame(ctx, 0, 0, w, h, 0.88);
    ctx.fillStyle = GOLD;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(header, 28, 50);
    let y = 110;
    for (const [text, color, size] of lines) {
      ctx.fillStyle = color;
      ctx.font = `${size >= 36 ? 800 : 500} ${size}px ${FONT}`;
      y = wrapText(ctx, text, 28, y, w - 56, size * 1.25) + size * 0.55;
    }
    ctx.fillStyle = DIM;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(footer, 28, h - 26);
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): number {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

export const TRAIN_COLORS = { GOLD, BLUE, GREEN, RED, DIM, TEXT };
