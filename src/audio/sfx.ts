// Procedurally synthesised sound effects, pre-rendered into AudioBuffers once
// so playback is a single buffer-source start (lowest latency WebAudio offers).

export type SfxName = 'perfect' | 'block' | 'hit' | 'peril' | 'dodge' | 'strike' | 'finisher' | 'ui';

export class Sfx {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<SfxName, AudioBuffer>();

  /** Must be called from a user gesture (e.g. the Enter VR click). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    const make = (name: SfxName, secs: number, fn: (t: number, i: number) => number) => {
      const n = Math.floor(sr * secs);
      const buf = ctx.createBuffer(1, n, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
      normalize(d, 0.9);
      this.buffers.set(name, buf);
    };
    const noise = () => Math.random() * 2 - 1;
    const sin = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);

    // Bright metallic ring: inharmonic partials with a sharp attack.
    make('perfect', 0.9, (t) => {
      const e = Math.exp(-t * 6);
      return e * (sin(1480, t) + 0.7 * sin(2310, t) + 0.5 * sin(3720, t) + 0.3 * sin(5120, t)) + noise() * Math.exp(-t * 60) * 0.8;
    });
    make('block', 0.35, (t) => Math.exp(-t * 14) * (sin(420, t) + 0.5 * sin(910, t)) + noise() * Math.exp(-t * 40) * 0.6);
    let lp = 0;
    make('hit', 0.3, (t) => {
      lp += (noise() - lp) * 0.15;
      return lp * Math.exp(-t * 12) * 3 + sin(90, t) * Math.exp(-t * 18);
    });
    make('peril', 0.6, (t) => Math.min(1, t * 30) * Math.exp(-t * 4) * (sin(196, t) + 0.6 * sin(1568, t) * (0.5 + 0.5 * sin(18, t))));
    let lp2 = 0;
    make('dodge', 0.25, (t) => {
      lp2 += (noise() - lp2) * (0.05 + t * 0.6);
      return lp2 * Math.sin(Math.PI * Math.min(1, t / 0.25)) * 2;
    });
    make('strike', 0.2, (t) => (noise() * 0.5 + sin(160, t)) * Math.exp(-t * 25));
    make('finisher', 1.2, (t) => Math.exp(-t * 3) * (sin(110, t) + 0.6 * sin(220 * (1 - t * 0.2), t)) + noise() * Math.exp(-t * 20) * 0.6);
    make('ui', 0.12, (t) => sin(880, t) * Math.exp(-t * 30));
  }

  play(name: SfxName, gain = 1): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (gain === 1) {
      src.connect(ctx.destination);
    } else {
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(ctx.destination);
    }
    src.start();
  }

  /** Reported output latency, for the debug panel (ms). */
  latencyMs(): number {
    const c = this.ctx;
    if (!c) return 0;
    return ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000;
  }
}

function normalize(d: Float32Array, peak: number): void {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}
