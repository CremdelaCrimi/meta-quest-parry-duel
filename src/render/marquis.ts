import * as THREE from 'three';

/**
 * "The Brass Marquis": the duelist's procedural body, an original clockwork-puppet design in a
 * Belle Epoque spirit (design consult with Gemini, 2026-11-16). Built from ~30 primitives so it
 * stays cheap on Quest 2. Floor-relative (y = 0 at his feet), facing -Z (toward the player).
 *
 * Gameplay tells live on named parts:
 * - shoulder gear rings spin through a windup and STALL during a feint's hold;
 * - the core behind his ribs glows ember-orange for a Fury (parry-only) swing;
 * - the optic in the mask slit follows the same colour;
 * - the cup hilt makes the blade's base (and so its angle) easy to read.
 */
export const MARQUIS = {
  /** Shoulder joint centres (body space): arms start here. */
  shoulderX: 0.24,
  shoulderY: 1.5,
  porcelain: 0xf2ede0,
  brass: 0xb5913a,
  teal: 0x123038,
  crimson: 0x8b1a1a,
  lacquer: 0x0e0f12,
} as const;

export interface MarquisParts {
  /** Gear rings around each shoulder (index 0 = his left, duel -x... body-space -X). */
  shoulderRings: THREE.Mesh[];
  shoulders: THREE.Mesh[];
  /** Waist cogs (spin slowly, faster while attacking). */
  cogs: THREE.Mesh[];
  coreMat: THREE.MeshBasicMaterial;
  opticMat: THREE.MeshBasicMaterial;
  /** Brass cup guard, placed at the blade's hilt every frame. */
  cup: THREE.Mesh;
  /** Coat tails and linings: dropped in Phase 2, showing the clockwork. */
  tails: THREE.Mesh[];
  /** Wind-up key on his back: spins faster as he winds up a swing. */
  key: THREE.Group;
  /** A puff that marks the start of a feint's hold at the sword shoulder. */
  puff: THREE.Mesh;
  puffMat: THREE.MeshBasicMaterial;
}

/**
 * Cheap rim light (Fresnel) baked into a lit material: a faint ivory edge so his dark teal coat and
 * limbs stay readable against the dim hall without real lights or shadows (Gemini critique, 2026-11-16).
 */
export function addRim(mat: THREE.Material, color = 0xfff2dc, strength = 0.32, power = 2.6): void {
  const c = new THREE.Color(color);
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        gl_FragColor.rgb += vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}) * pow(rimF, ${power.toFixed(2)}) * ${strength.toFixed(2)};
      }`,
    );
  };
}

/** Soft round shadow texture for the blob under his feet (no real-time shadows on Quest 2). */
export function blobShadow(): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.65)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.7),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Build the body into `body`; `coat` is the material that flashes when he's hit. */
export function buildMarquis(body: THREE.Group, coat: THREE.MeshLambertMaterial): MarquisParts {
  const M = MARQUIS;
  coat.color.setHex(M.teal);
  const porcelain = new THREE.MeshStandardMaterial({ color: M.porcelain, roughness: 0.25, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: M.brass, roughness: 0.35, metalness: 0.8 });
  const crimson = new THREE.MeshLambertMaterial({ color: M.crimson });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6, metalness: 0.6 });
  const trousers = new THREE.MeshLambertMaterial({ color: 0x1b1e26 });
  const ivory = new THREE.MeshLambertMaterial({ color: 0xe9e2d0 });
  for (const mat of [coat, crimson, trousers, iron]) addRim(mat);
  addRim(brass, 0xffe0a0, 0.25);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    body.add(mesh);
    return mesh;
  };

  // Legs: dark trousers, brass knee joints, tall brass-leather boots.
  const boot = new THREE.MeshStandardMaterial({ color: 0x8a5e2a, roughness: 0.45, metalness: 0.5 });
  addRim(boot, 0xffe0a0, 0.25);
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.075, 0.065, 0.42, 10), trousers, sx * 0.1, 0.69);
    add(new THREE.SphereGeometry(0.062, 10, 8), brass, sx * 0.1, 0.47);
    add(new THREE.CylinderGeometry(0.072, 0.064, 0.4, 10), boot, sx * 0.1, 0.24);
    add(new THREE.BoxGeometry(0.1, 0.07, 0.24), boot, sx * 0.1, 0.035, -0.04);
  }
  // Pelvis, exposed clockwork waist, then a broad chest tapering down (Belle Epoque tailoring).
  add(new THREE.CylinderGeometry(0.15, 0.16, 0.16, 12), coat, 0, 0.92);
  add(new THREE.CylinderGeometry(0.155, 0.15, 0.07, 12), crimson, 0, 0.99); // sash
  add(new THREE.CylinderGeometry(0.075, 0.075, 0.24, 10), iron, 0, 1.08);
  const cogs: THREE.Mesh[] = [];
  for (const [y, r] of [[1.02, 0.125], [1.13, 0.105]] as const) {
    const cog = add(new THREE.TorusGeometry(r, 0.024, 4, 14), brass, 0, y);
    cog.rotation.x = Math.PI / 2;
    cogs.push(cog);
  }
  const chest = add(new THREE.CylinderGeometry(0.25, 0.15, 0.44, 14), coat, 0, 1.4);
  chest.scale.z = 0.72;
  // Shirt front and crimson cravat.
  add(new THREE.BoxGeometry(0.11, 0.28, 0.02), ivory, 0, 1.43, -0.155);
  add(new THREE.BoxGeometry(0.05, 0.08, 0.025), crimson, 0, 1.53, -0.165);
  // The core: glows behind a brass ring under the chest (dim amber; ember-orange for a Fury swing).
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x5a3a10 });
  add(new THREE.SphereGeometry(0.06, 12, 8), coreMat, 0, 1.2, -0.08);
  add(new THREE.TorusGeometry(0.07, 0.014, 6, 16), brass, 0, 1.2, -0.11);
  // Coat tails, crimson-lined, flaring behind.
  const tails: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const tail = add(new THREE.BoxGeometry(0.15, 0.6, 0.02), coat, sx * 0.085, 0.86, 0.14);
    tail.rotation.x = -0.18;
    const lining = add(new THREE.BoxGeometry(0.13, 0.56, 0.01), crimson, sx * 0.085, 0.87, 0.125);
    lining.rotation.x = -0.18;
    tails.push(tail, lining);
  }
  // Collar, neck, porcelain mask with a vertical brass slit and a glowing optic.
  add(new THREE.CylinderGeometry(0.1, 0.12, 0.07, 12), crimson, 0, 1.63);
  add(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 8), iron, 0, 1.68);
  const head = add(new THREE.SphereGeometry(0.115, 16, 12), porcelain, 0, 1.79);
  head.scale.set(0.86, 1.18, 0.92);
  add(new THREE.BoxGeometry(0.014, 0.15, 0.02), brass, 0, 1.8, -0.1);
  const opticMat = new THREE.MeshBasicMaterial({ color: 0xffc860 });
  add(new THREE.SphereGeometry(0.014, 8, 6), opticMat, 0, 1.82, -0.108);
  // Brass tricorn (one point forward) with a crimson and teal plume: readable across the arena.
  const hat = add(new THREE.CylinderGeometry(0.19, 0.17, 0.05, 3), brass, 0, 1.93);
  hat.rotation.y = Math.PI; // a corner points at the player
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.08, 12), brass, 0, 1.97);
  for (const [mat, x, rz] of [[crimson, 0.07, -0.5], [coat, 0.1, -0.85]] as const) {
    const plume = add(new THREE.BoxGeometry(0.035, 0.2, 0.012), mat, x, 2.03, 0.04);
    plume.rotation.set(0.5, 0, rz);
  }

  // Brass shoulder joints with gear rings (the windup tell).
  const shoulders: THREE.Mesh[] = [];
  const shoulderRings: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const s = add(new THREE.SphereGeometry(0.075, 14, 10), brass, sx * M.shoulderX, M.shoulderY);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 4, 12), iron);
    ring.rotation.y = Math.PI / 2; // ring around the shoulder's side axis
    s.add(ring);
    shoulders.push(s);
    shoulderRings.push(ring);
  }

  // Wind-up key on his back: shaft plus two loops (the clockwork-puppet read from any angle).
  const key = new THREE.Group();
  key.position.set(0, 1.35, 0.17);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), brass);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.03;
  key.add(shaft);
  for (const sx of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 14), brass);
    loop.position.set(sx * 0.045, 0, 0.08);
    key.add(loop);
  }
  body.add(key);

  // Cup hilt: a brass dome whose top faces up the blade.
  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  cup.material = brass;
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), puffMat);
  puff.visible = false;
  body.add(puff);
  return { shoulderRings, shoulders, cogs, coreMat, opticMat, cup, tails, key, puff, puffMat };
}
