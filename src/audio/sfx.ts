// Procedurally synthesised sound effects, pre-rendered into AudioBuffers once
// so playback is a single buffer-source start (lowest latency WebAudio offers).

export type SfxName = 'perfect' | 'block' | 'hit' | 'peril' | 'dodge' | 'strike' | 'finisher' | 'ui' | 'whoosh' | 'chime' | 'clash' | 'grapple' | 'clank' | 'spring' | 'tick' | 'ignite';

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
    // A miss: airy, rising noise, so a swing that falls short is never silent.
    let lp3 = 0;
    make('whoosh', 0.3, (t) => {
      lp3 += (noise() - lp3) * (0.2 + t * 2);
      return lp3 * Math.sin(Math.PI * Math.min(1, t / 0.3)) * 1.6;
    });
    // Red attack about to land (400 ms out): two quick high pings, distinct from everything else.
    make('chime', 0.35, (t) => {
      const ping = (t0: number) => (t >= t0 ? Math.exp(-(t - t0) * 22) * sin(2637, t - t0) : 0);
      return ping(0) + ping(0.11);
    });
    // Perfect dodge: a heavy metallic clash with a low thump.
    make('clash', 0.9, (t) => Math.exp(-t * 5) * (sin(990, t) + 0.8 * sin(1870, t) + 0.5 * sin(3110, t)) + Math.exp(-t * 14) * sin(70, t) * 1.5 + noise() * Math.exp(-t * 50));
    // Mainspring ratchet: a heavy, dry metallic clank (the beat you parry on).
    make('clank', 0.22, (t) => Math.exp(-t * 28) * (sin(310, t) + 0.8 * sin(745, t) + 0.4 * sin(1630, t)) + noise() * Math.exp(-t * 90) * 0.9);
    // Phase 2: a spring snapping loose, a falling twang with a rattle.
    make('spring', 1.0, (t) => Math.exp(-t * 3.5) * sin(520 * (1 - 0.45 * t), t) * (0.6 + 0.4 * sin(31, t)) + noise() * Math.exp(-t * 25) * 0.7);
    // Feint stall: a tiny, sharp clockwork tick (3.5-6 kHz, 50 ms) from his shoulder.
    make('tick', 0.06, (t) => Math.exp(-t * 120) * (sin(4200, t) + 0.6 * sin(5900, t)) + noise() * Math.exp(-t * 300) * 0.5);
    // Fury ignition: a rising sizzle from his core (200 Hz → 1 kHz over 400 ms) with crackle.
    let ph = 0;
    make('ignite', 0.45, (t) => {
      ph += (2 * Math.PI * (200 + 1800 * t)) / sr;
      const env = Math.min(1, t * 12) * Math.exp(-t * 3);
      return env * (0.7 * Math.sin(ph) + 0.35 * Math.sin(2 * ph)) + noise() * env * (Math.random() < 0.08 ? 1.2 : 0.15);
    });
    // Grapple wire: a fast descending zip.
    make('grapple', 0.25, (t) => Math.exp(-t * 10) * sin(1800 * (1 - t * 2.5), t) * 0.8 + noise() * Math.exp(-t * 30) * 0.4);
  }

  /**
   * Play a sound. `rate` shifts pitch (1.09 ≈ +1.5 semitones); `at` places it in the world (an HRTF
   * panner) so his tells come from his body while your own hits stay in your head (Gemini audio spec).
   */
  play(name: SfxName, gain = 1, opts: { rate?: number; at?: { x: number; y: number; z: number } } = {}): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    let node: AudioNode = src;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      node = node.connect(g);
    }
    if (opts.at) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.5;
      p.rolloffFactor = 0.6;
      p.positionX.value = opts.at.x;
      p.positionY.value = opts.at.y;
      p.positionZ.value = opts.at.z;
      node = node.connect(p);
    }
    node.connect(ctx.destination);
    src.start();
  }

  /** Where your ears are (call every frame with the head pose). */
  setListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): void {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    l.positionX.value = pos.x;
    l.positionY.value = pos.y;
    l.positionZ.value = pos.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
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
