import * as THREE from 'three';
import { CanvasPanel } from './panels';

const LIFE_MS = 700;
const RISE_M = 0.18;

/**
 * Short words that pop at the clash point (PERFECT, RIPOSTE, CHARGED...) and drift up as they fade,
 * so the result reads where your eyes already are: on the blades (Gemini UX pass, 2026-11-16).
 * A small pool of canvas quads in world space, each billboarded to your head; no allocation per pop.
 */
export class FloatText {
  readonly group = new THREE.Group();
  private readonly pool: Array<{ panel: CanvasPanel; t: number; from: THREE.Vector3 }> = [];
  private next = 0;

  constructor(size = 4) {
    for (let i = 0; i < size; i++) {
      const panel = new CanvasPanel(512, 128, 0.36);
      panel.mesh.rotation.set(0, 0, 0);
      panel.mesh.renderOrder = 19;
      const mat = panel.mesh.material as THREE.MeshBasicMaterial;
      mat.depthTest = false; // never hidden inside his body or your blade
      panel.mesh.visible = false;
      this.group.add(panel.mesh);
      this.pool.push({ panel, t: -1, from: new THREE.Vector3() });
    }
  }

  /** Pop `text` at a world point. */
  pop(at: THREE.Vector3, text: string, color: string): void {
    const slot = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    slot.t = 0;
    slot.from.copy(at);
    slot.panel.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.font = '800 76px system-ui, sans-serif';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(10,8,6,0.85)';
      ctx.strokeText(text, w / 2, h * 0.72);
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, h * 0.72);
    });
    slot.panel.mesh.visible = true;
  }

  update(dtMs: number, head: THREE.Vector3): void {
    for (const s of this.pool) {
      if (s.t < 0) continue;
      s.t += dtMs;
      const k = s.t / LIFE_MS;
      const m = s.panel.mesh;
      if (k >= 1) {
        s.t = -1;
        m.visible = false;
        continue;
      }
      // Ease up and out; pop in slightly larger, settle, then fade over the last half.
      m.position.copy(s.from).y += RISE_M * (1 - (1 - k) ** 2);
      m.lookAt(head);
      m.scale.setScalar(1 + 0.25 * Math.max(0, 1 - k * 6));
      (m.material as THREE.MeshBasicMaterial).opacity = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
    }
  }
}
