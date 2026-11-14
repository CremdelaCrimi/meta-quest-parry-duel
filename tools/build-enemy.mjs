// Build a game enemy from per-clip Tripo exports (each a skinned GLB with one animation).
//
//   node tools/build-enemy.mjs <clips-dir> <out-dir>
//
// <clips-dir> holds <clip>.glb files (idle.glb, slash_r2l.glb, ...). idle.glb is the base: its
// mesh, skin and textures are kept; every other file contributes only its animation, rebound to
// the base skeleton by bone name. Attack clips get release/impact marks measured from the right
// hand's speed, written to <out-dir>/enemy.json alongside <out-dir>/swordsman.glb.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';

const [clipsDir, outDir] = process.argv.slice(2);
if (!clipsDir || !outDir) throw new Error('usage: node tools/build-enemy.mjs <clips-dir> <out-dir>');

/** Sim attack id -> clip. Quick variants reuse the normal slashes, played faster by the windup remap. */
const ATTACK_CLIPS = {
  slashLeft: 'slash_r2l',
  quickLeft: 'slash_r2l',
  slashRight: 'slash_l2r',
  quickRight: 'slash_l2r',
  slashHigh: 'overhead',
  heavyHigh: 'heavy_overhead',
  slashLow: 'low_cut',
  thrust: 'thrust',
  sweep: 'head_sweep',
};

/**
 * Direction the strike travels, in model space (+Y up, +Z toward the player). The swing is the
 * peak of hand speed along this direction, so a fast wind-up lift can't be mistaken for the cut.
 * Clips not listed (sideways slashes) use raw speed.
 */
const STRIKE_DIR = {
  overhead: [0, -1, 0],
  heavy_overhead: [0, -1, 0],
  thrust: [0, 0, 1],
  low_cut: [1, 0, 0], // the model faces +Z, so its right-to-left is +X
};

// ------------------------------------------------------------------ GLB io

function readGlb(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = binStart <= b.length ? b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen)) : Buffer.alloc(0);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const pad = (buf, byte) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, byte)]);
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const chunk = (len, type) => {
    const c = Buffer.alloc(8);
    c.writeUInt32LE(len, 0);
    c.write(type, 4, 'ascii');
    return c;
  };
  writeFileSync(file, Buffer.concat([header, chunk(j.length, 'JSON'), j, chunk(b.length, 'BIN\0'), b]));
}

// ------------------------------------------------------------------ accessor reading

const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };
function readAccessor(g, bin, i) {
  const a = g.accessors[i];
  if (a.componentType !== 5126) throw new Error(`accessor ${i}: only float animation data is supported`);
  const v = g.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? n * 4;
  const out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++)
    for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE(start + k * stride + c * 4);
  return out;
}

// ------------------------------------------------------------------ merge

const files = readdirSync(clipsDir).filter((f) => f.endsWith('.glb'));
if (!files.includes('idle.glb')) throw new Error('idle.glb (the base) is missing');
const base = readGlb(join(clipsDir, 'idle.glb'));
const g = base.json;
const chunks = [base.bin];
let binLen = base.bin.length;
const nodeByName = new Map(g.nodes.map((n, i) => [n.name, i]));

g.animations = [{ ...g.animations[0], name: 'idle' }];

for (const f of files.filter((x) => x !== 'idle.glb').sort()) {
  const clip = basename(f, '.glb');
  const src = readGlb(join(clipsDir, f));
  const anim = src.json.animations?.[0];
  if (!anim) throw new Error(`${f}: no animation`);
  const accMap = new Map();
  const copyAccessor = (i) => {
    if (accMap.has(i)) return accMap.get(i);
    const a = src.json.accessors[i];
    const data = Buffer.from(readAccessor(src.json, src.bin, i).buffer);
    const align = (4 - (binLen % 4)) % 4;
    if (align) {
      chunks.push(Buffer.alloc(align));
      binLen += align;
    }
    g.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: data.length });
    chunks.push(data);
    binLen += data.length;
    const { bufferView, byteOffset, ...rest } = a;
    g.accessors.push({ ...rest, bufferView: g.bufferViews.length - 1 });
    accMap.set(i, g.accessors.length - 1);
    return g.accessors.length - 1;
  };
  const samplers = anim.samplers.map((s) => ({ ...s, input: copyAccessor(s.input), output: copyAccessor(s.output) }));
  const channels = [];
  for (const ch of anim.channels) {
    const name = src.json.nodes[ch.target.node].name;
    const node = nodeByName.get(name);
    if (node === undefined) continue; // e.g. the per-export mesh node; bones always match
    channels.push({ sampler: ch.sampler, target: { node, path: ch.target.path } });
  }
  g.animations.push({ name: clip, samplers, channels });
}
g.buffers = [{ byteLength: binLen }];

// ------------------------------------------------------------------ measure attack marks

const parent = new Map();
g.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const hand = nodeByName.get('mixamorig:RightHand');
const allBin = Buffer.concat(chunks);

function sampleTrack(times, values, n, t, out) {
  let k = 0;
  while (k < times.length - 2 && times[k + 1] < t) k++;
  const span = times[k + 1] - times[k] || 1;
  const f = Math.min(1, Math.max(0, (t - times[k]) / span));
  if (n === 4) {
    const qa = new Quaternion().fromArray(values, k * 4);
    const qb = new Quaternion().fromArray(values, (k + 1) * 4);
    return out.copy(qa.slerp(qb, f));
  }
  for (let c = 0; c < n; c++) out.setComponent(c, values[k * n + c] + (values[(k + 1) * n + c] - values[k * n + c]) * f);
  return out;
}

function handPath(anim, fps = 120) {
  const tracks = anim.channels.map((ch) => ({
    node: ch.target.node,
    path: ch.target.path,
    times: readAccessor(g, allBin, anim.samplers[ch.sampler].input),
    values: readAccessor(g, allBin, anim.samplers[ch.sampler].output),
  }));
  const dur = Math.max(...tracks.map((t) => t.times[t.times.length - 1]));
  const chain = [];
  for (let n = hand; n !== undefined; n = parent.get(n)) chain.unshift(n);
  // Blade tip in hand space: same grip as the game (pinky knuckle -> index knuckle), half the
  // model's height long. Wrist rotation swings the tip far more than it moves the hand.
  const knuckle = (suffix) => new Vector3().fromArray(g.nodes[nodeByName.get('mixamorig:RightHand' + suffix)].translation);
  const tipLocal = knuckle('Index1').sub(knuckle('Pinky1')).normalize().multiplyScalar(0.5);
  const pts = [];
  for (let i = 0; i <= dur * fps; i++) {
    const t = i / fps;
    const m = new Matrix4();
    for (const n of chain) {
      const node = g.nodes[n];
      const p = new Vector3().fromArray(node.translation ?? [0, 0, 0]);
      const q = new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]);
      const s = new Vector3().fromArray(node.scale ?? [1, 1, 1]);
      for (const tr of tracks.filter((x) => x.node === n)) {
        if (tr.path === 'translation') sampleTrack(tr.times, tr.values, 3, t, p);
        else if (tr.path === 'rotation') sampleTrack(tr.times, tr.values, 4, t, q);
        else if (tr.path === 'scale') sampleTrack(tr.times, tr.values, 3, t, s);
      }
      m.multiply(new Matrix4().compose(p, q, s));
    }
    pts.push(tipLocal.clone().applyMatrix4(m));
  }
  return { pts, fps, dur };
}

/**
 * The swing is the fastest stretch of hand motion. Release = where the hand last moved slowly
 * before peak speed; impact = peak speed (the blade is mid-arc, crossing the target), so the
 * follow-through plays after the sim's strike instant.
 */
function marks(anim) {
  const { pts, fps, dur } = handPath(anim);
  const dir = STRIKE_DIR[anim.name] && new Vector3(...STRIKE_DIR[anim.name]);
  const raw = pts.map((p, i) => {
    if (!i) return 0;
    const v = p.clone().sub(pts[i - 1]).multiplyScalar(fps);
    return dir ? Math.max(0, v.dot(dir)) : v.length();
  });
  const w = Math.round(fps * 0.04);
  const speed = raw.map((_, i) => {
    const s = raw.slice(Math.max(0, i - w), i + w + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  let lo = Math.round(fps * 0.2);
  const hi = Math.round(fps * (dur - 0.3));
  if (dir) {
    // Directional strikes: the swing starts from the wind-up extreme, the point where the hand
    // is furthest against the strike direction (highest for a chop, furthest back for a thrust).
    let top = lo;
    for (let i = lo; i < hi; i++) if (pts[i].dot(dir) < pts[top].dot(dir)) top = i;
    lo = top;
  }
  let peak = lo;
  for (let i = lo; i < hi; i++) if (speed[i] > speed[peak]) peak = i;
  let rel = peak;
  while (rel > lo && speed[rel] > speed[peak] * 0.2) rel--;
  return {
    releaseMs: Math.round((rel / fps) * 1000),
    impactMs: Math.round((peak / fps) * 1000),
    peakSpeed: +speed[peak].toFixed(2),
  };
}

const animByName = new Map(g.animations.map((a) => [a.name, a]));
const measured = {};
for (const clip of new Set(Object.values(ATTACK_CLIPS))) {
  const a = animByName.get(clip);
  if (!a) throw new Error(`missing clip ${clip}`);
  measured[clip] = marks(a);
}

// ------------------------------------------------------------------ write

mkdirSync(outDir, { recursive: true });
writeGlb(join(outDir, 'swordsman.glb'), g, allBin);

const manifest = {
  model: 'swordsman.glb',
  heightM: 1.8,
  handBone: 'mixamorigRightHand',
  swordLengthM: 0.95, // grip is derived from the finger bones at load

  idle: 'idle',
  stagger: 'stagger',
  death: 'death',
  attacks: Object.fromEntries(
    Object.entries(ATTACK_CLIPS).map(([id, clip]) => [
      id,
      { clip, releaseMs: measured[clip].releaseMs, impactMs: measured[clip].impactMs },
    ]),
  ),
};
writeFileSync(join(outDir, 'enemy.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`wrote ${join(outDir, 'swordsman.glb')} (${(allBin.length / 1e6).toFixed(2)} MB bin, ${g.animations.length} clips)`);
for (const [clip, m] of Object.entries(measured))
  console.log(`  ${clip.padEnd(15)} release ${String(m.releaseMs).padStart(4)} ms  impact ${String(m.impactMs).padStart(4)} ms  peak blade-tip speed ${m.peakSpeed}`);
