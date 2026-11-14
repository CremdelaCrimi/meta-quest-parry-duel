import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { Sfx } from './audio/sfx';
import { Game } from './game';
import { DuelSpace } from './render/duelSpace';
import { SwordView } from './render/views';
import { DesktopInput, XRInput } from './xr/input';

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.0);
renderer.xr.setFoveation(0.5); // fixed foveated rendering: cheap GPU savings at the edges
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1118);
scene.fog = new THREE.Fog(0x0e1118, 6, 16);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.set(0, 1.6, 0);

// ---------------------------------------------------------------- arena (cheap: no shadows, no post-processing)

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2420, 1.4));
const sun = new THREE.DirectionalLight(0xfff0dd, 1.6);
sun.position.set(2, 5, 1);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 48), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.7, 64), new THREE.MeshBasicMaterial({ color: 0x5a1c1c }));
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);
const pillarGeo = new THREE.BoxGeometry(0.5, 4, 0.5);
const pillarMat = new THREE.MeshLambertMaterial({ color: 0x3b3f48 });
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  const p = new THREE.Mesh(pillarGeo, pillarMat);
  p.position.set(Math.cos(a) * 6, 2, Math.sin(a) * 6);
  scene.add(p);
}

// ---------------------------------------------------------------- game

const sfx = new Sfx();
const sword = new SwordView();
scene.add(sword.root);

const targetHz = () => renderer.xr.getSession()?.frameRate ?? 60;
const space = new DuelSpace();
const xrInput = new XRInput(renderer, scene, sword);
const desktopInput = new DesktopInput(renderer.domElement, camera, space, sword);
const game = new Game(scene, desktopInput, sfx, sword, targetHz, space);

renderer.domElement.addEventListener('pointerdown', () => sfx.init());

renderer.xr.addEventListener('sessionstart', () => {
  sfx.init();
  const session = renderer.xr.getSession()!;
  // Ask for 90 Hz (Quest 3 supports 72/80/90/120). Higher rate = lower motion-to-photon latency.
  const rates = session.supportedFrameRates;
  if (rates && session.updateTargetFrameRate) {
    const want = rates.includes(90) ? 90 : Math.max(...rates);
    void session.updateTargetFrameRate(want).catch(() => undefined);
  }
  game.input = xrInput;
  game.isXR = true;
});
renderer.xr.addEventListener('sessionend', () => {
  scene.add(sword.root);
  game.input = desktopInput;
  game.isXR = false;
});

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
  (window as unknown as { __step: (t: number) => void }).__step = (t: number) => {
    renderer.setAnimationLoop(null); // manual stepping owns the clock from here on
    game.frame(t);
    renderer.render(scene, camera);
  };
}
