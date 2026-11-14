import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Duel } from '../core/sim';
import { clipTimeAt } from './clipTiming';
import type { ClipMarks } from './clipTiming';

/**
 * Data that turns any rigged humanoid GLB into a duel enemy. A reskin or a new enemy type is
 * a new manifest: the sim never changes. Paths are relative to the manifest file.
 */
export interface EnemyManifest {
  model: string;
  /** The model is scaled to stand this tall (m). */
  heightM: number;
  /** Bone the sword is parented to, e.g. "mixamorigRightHand". */
  handBone: string;
  /** Sword placement in the hand bone's space: offset (m) and rotation (deg). */
  swordOffset: [number, number, number];
  swordEulerDeg: [number, number, number];
  swordLengthM: number;
  /**
   * Optional: clip name → GLB holding that one animation on the same rig (Tripo exports a file
   * per clip). Its first animation is loaded and renamed to the key. Bones bind by name.
   */
  clipFiles?: Record<string, string>;
  idle: string;
  stagger: string;
  death: string;
  /** Attack id (see core/enemies.ts) → clip and its marks in ms. Quick variants can reuse a slash clip. */
  attacks: Record<string, { clip: string } & Omit<ClipMarks, 'durationMs'>>;
}

const FADE_MS = 120;

/**
 * A skinned enemy whose pose is computed from the sim every frame (never free-running):
 * attack clips are scrubbed so impact lands on the strike instant, everything else advances
 * by the enemy's animation time, which is already 0 during hit-stop.
 */
export class RiggedEnemy {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly timeMs = new Map<string, number>();
  private readonly flashMats: THREE.MeshStandardMaterial[] = [];
  private cur = '';
  private prev = '';
  private curKey = '';
  private blend = 1;

  private constructor(
    private readonly m: EnemyManifest,
    scene: THREE.Object3D,
    clips: THREE.AnimationClip[],
    bladeMat: THREE.Material,
  ) {
    // Fit height, stand on the floor, face the player (glTF forward is +Z; the player is at -Z).
    const box = new THREE.Box3().setFromObject(scene);
    const s = m.heightM / Math.max(1e-3, box.max.y - box.min.y);
    scene.scale.setScalar(s);
    scene.position.y = -box.min.y * s;
    scene.rotation.y = Math.PI;
    this.root.add(scene);

    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat?.isMeshStandardMaterial) {
        mesh.material = mat.clone();
        this.flashMats.push(mesh.material as THREE.MeshStandardMaterial);
      }
    });

    const hand = scene.getObjectByName(m.handBone);
    if (hand) {
      const geo = new THREE.BoxGeometry(0.022, 1, 0.055);
      geo.translate(0, 0.5, 0);
      const blade = new THREE.Mesh(geo, bladeMat);
      blade.scale.set(1 / s, m.swordLengthM / s, 1 / s); // undo the model scale so the blade keeps real size
      blade.position.set(...m.swordOffset).multiplyScalar(1 / s);
      blade.rotation.set(...(m.swordEulerDeg.map(THREE.MathUtils.degToRad) as [number, number, number]));
      hand.add(blade);
    } else {
      console.warn(`[enemy] hand bone "${m.handBone}" not found; no sword attached`);
    }

    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.weight = 0;
      this.actions.set(clip.name, a);
      this.timeMs.set(clip.name, 0);
    }
    const needed = [m.idle, m.stagger, m.death, ...Object.values(m.attacks).map((x) => x.clip)];
    const missing = needed.filter((n) => !this.actions.has(n));
    if (missing.length) console.warn(`[enemy] clips missing from GLB: ${missing.join(', ')}`);
  }

  static async load(manifestUrl: string, bladeMat: THREE.Material): Promise<RiggedEnemy> {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`${manifestUrl}: ${res.status}`);
    const m = (await res.json()) as EnemyManifest;
    const base = new URL(manifestUrl, location.href);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(new URL(m.model, base).href);
    const clips = [...gltf.animations];
    const extra = await Promise.all(
      Object.entries(m.clipFiles ?? {}).map(async ([name, file]) => {
        const g = await loader.loadAsync(new URL(file, base).href);
        const clip = g.animations[0];
        if (!clip) throw new Error(`${file} has no animation`);
        clip.name = name;
        return clip;
      }),
    );
    return new RiggedEnemy(m, gltf.scene, [...clips, ...extra], bladeMat);
  }

  private durMs(name: string): number {
    return (this.actions.get(name)?.getClip().duration ?? 0) * 1000;
  }

  /** `animMs` is real frame time, or 0 while the enemy is hit-stopped. */
  update(duel: Duel, animMs: number, flash: number): void {
    const e = duel.enemy;
    const att = duel.currentAttack;
    const m = this.m;

    let name = m.idle;
    let scrub: number | null = null;
    let key = name;
    if (e.state === 'dead') name = key = m.death;
    else if (e.state === 'stagger') name = key = m.stagger;
    else if (att && m.attacks[att.id] && this.actions.has(m.attacks[att.id].clip)) {
      const a = m.attacks[att.id];
      name = a.clip;
      scrub = clipTimeAt({ ...a, durationMs: this.durMs(name) }, duel.windup(att), e.clock - e.attackStart);
      key = `${name}@${e.attackStart}`; // each attack instance restarts its clip
    }

    if (key !== this.curKey) {
      if (name !== this.cur) {
        this.prev = this.cur;
        this.blend = 0;
      }
      this.cur = name;
      this.curKey = key;
      if (scrub === null) this.timeMs.set(name, 0);
    }
    this.blend = Math.min(1, this.blend + animMs / FADE_MS);

    for (const [n, action] of this.actions) {
      action.weight = n === this.cur ? this.blend : n === this.prev ? 1 - this.blend : 0;
      if (action.weight === 0) continue;
      let t = n === this.cur && scrub !== null ? scrub : (this.timeMs.get(n) ?? 0) + (n === this.cur ? animMs : 0);
      const d = this.durMs(n);
      if (n === m.death || scrub !== null) t = Math.min(t, d); // one-shots hold their last pose
      else if (d > 0) t %= d; // idle and stagger loop
      this.timeMs.set(n, t);
      action.time = t / 1000;
    }
    this.mixer.update(0);

    for (const mat of this.flashMats) mat.emissive.setRGB(flash * 0.8, flash * 0.15, flash * 0.1);
  }
}
