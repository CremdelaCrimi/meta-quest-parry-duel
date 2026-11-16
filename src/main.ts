import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Sfx } from './audio/sfx';
import { Game } from './game';
import { GRAPHICS, loadSettings, resolveQuality } from './settings';
import { DuelSpace } from './render/duelSpace';
import { SwordView } from './render/views';
import { LeftHandView } from './render/leftHand';
import { DesktopInput, XRInput } from './xr/input';

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Graphics level: Quest 3 / Pro run full resolution at 90 Hz; Quest 1 / 2 get the lighter mode
// (menu → Graphics, or ?quality=low|high). Render scale can only change outside a VR session.
let gfx = GRAPHICS[resolveQuality(loadSettings().quality)];
renderer.xr.setFramebufferScaleFactor(gfx.scale);
renderer.xr.setFoveation(gfx.foveation); // fixed foveated rendering: cheap GPU savings at the edges
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// A dim Belle Epoque hall lit by gas sconces: warm darks, brass and crimson (Gemini mock-up 2026-11-16).
scene.background = new THREE.Color(0x14100d);
scene.fog = new THREE.Fog(0x14100d, 6, 16);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.set(0, 1.6, 0);

// ---------------------------------------------------------------- arena (cheap: no shadows, no post-processing)

scene.add(new THREE.HemisphereLight(0xffe2bd, 0x2a1d16, 1.35));
const sun = new THREE.DirectionalLight(0xffe8cc, 1.5);
sun.position.set(2, 5, 1);
scene.add(sun);

// The arena lives in its own group: a sideways dash orbits you around the enemy by turning the
// arena around him, so he stays dead centre in your view while the world swings past.
const arena = new THREE.Group();
scene.add(arena);
const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 48), new THREE.MeshLambertMaterial({ color: 0x2e241d }));
floor.rotation.x = -Math.PI / 2;
arena.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.7, 64), new THREE.MeshBasicMaterial({ color: 0x5a1c1c }));
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
arena.add(ring);
const pillarGeo = new THREE.BoxGeometry(0.5, 4, 0.5);
const pillarMat = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
const capGeo = new THREE.BoxGeometry(0.62, 0.12, 0.62);
const brassMat = new THREE.MeshLambertMaterial({ color: 0x8a6d2f });
// Gas sconces: a brass bracket and an additive flame + halo per pillar. No real lights (Quest 2 cost).
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const haloTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,190,110,0.9)');
  grd.addColorStop(0.35, 'rgba(255,150,60,0.35)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const flameGeo = new THREE.ConeGeometry(0.035, 0.12, 8);
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  const p = new THREE.Mesh(pillarGeo, pillarMat);
  p.position.set(Math.cos(a) * 6, 2, Math.sin(a) * 6);
  arena.add(p);
  for (const y of [0.06, 3.94]) {
    const cap = new THREE.Mesh(capGeo, brassMat);
    cap.position.set(p.position.x, y, p.position.z);
    arena.add(cap);
  }
  // Sconce on the inner face of the pillar, at head height.
  const inX = Math.cos(a) * 5.68;
  const inZ = Math.sin(a) * 5.68;
  const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.1, 8), brassMat);
  bracket.position.set(inX, 2.0, inZ);
  arena.add(bracket);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(inX, 2.11, inZ);
  arena.add(flame);
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(0.7);
  halo.position.set(inX, 2.1, inZ);
  arena.add(halo);
}

// ---------------------------------------------------------------- game

const sfx = new Sfx();
const sword = new SwordView();
scene.add(sword.root);

const targetHz = () => renderer.xr.getSession()?.frameRate ?? 60;
const space = new DuelSpace();
const leftHand = new LeftHandView();
const xrInput = new XRInput(renderer, scene, sword, leftHand);
const desktopInput = new DesktopInput(renderer.domElement, camera, space, sword);
const game = new Game(scene, desktopInput, sfx, sword, targetHz, space);
game.arena = arena;
game.leftHand = leftHand;

renderer.domElement.addEventListener('pointerdown', () => sfx.init());

renderer.xr.addEventListener('sessionstart', () => {
  sfx.init();
  setRate(gfx.hz);
  game.input = xrInput;
  game.isXR = true;
});
renderer.xr.addEventListener('sessionend', () => {
  scene.add(sword.root);
  game.input = desktopInput;
  game.isXR = false;
});

/** Ask for a refresh rate (Quest 2/3 support 72/80/90/120; Quest 1 only 72). Higher = lower latency. */
function setRate(hz: number): void {
  const session = renderer.xr.getSession();
  const rates = session?.supportedFrameRates;
  if (!session || !rates || !session.updateTargetFrameRate) return;
  const want = rates.includes(hz) ? hz : Math.max(...Array.from(rates).filter((r) => r <= hz), Math.min(...rates));
  void session.updateTargetFrameRate(want).catch(() => undefined);
}

// The menu changes graphics live: foveation and refresh rate now, render scale on the next entry.
game.onGraphics = (level) => {
  gfx = GRAPHICS[level];
  renderer.xr.setFoveation(gfx.foveation);
  if (!renderer.xr.isPresenting) renderer.xr.setFramebufferScaleFactor(gfx.scale);
  setRate(gfx.hz);
};
renderer.xr.addEventListener('sessionend', () => renderer.xr.setFramebufferScaleFactor(gfx.scale));

document.body.appendChild(
  VRButton.createButton(renderer, { requiredFeatures: ['local-floor'], optionalFeatures: [] }),
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
  // Prefer the predicted display time so the sim and the poses share one time base.
  const pdt = (frame as (XRFrame & { predictedDisplayTime?: number }) | undefined)?.predictedDisplayTime;
  game.frame(pdt ?? time, frame);
  renderer.render(scene, camera);
});

// Handy for tuning from the console (desktop, or Quest via remote debugging).
(window as unknown as { game: Game }).game = game;
// Dev only: step and draw one frame by hand (screenshots while the page isn't animating).
if (import.meta.env.DEV) {
  (window as unknown as { __camera: THREE.PerspectiveCamera }).__camera = camera;
  // Re-render from a moved camera (design screenshots of the enemy from any angle).
  (window as unknown as { __render: () => void }).__render = () => renderer.render(scene, camera);
  (window as unknown as { __step: (t: number) => void }).__step = (t: number) => {
    renderer.setAnimationLoop(null); // manual stepping owns the clock from here on
    game.frame(t);
    renderer.render(scene, camera);
  };
}
