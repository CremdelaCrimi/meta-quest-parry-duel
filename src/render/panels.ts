import * as THREE from 'three';

/** A plane showing a 2D canvas. Redraw sparingly: every redraw re-uploads the texture. */
export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;

  constructor(pxW: number, pxH: number, worldW: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, (worldW * pxH) / pxW), mat);
    this.mesh.rotation.y = Math.PI; // children of the duel group face the player
    this.mesh.renderOrder = 10;
  }

  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fn(ctx, canvas.width, canvas.height);
    this.texture.needsUpdate = true;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, color: string): void {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, f)), h);
}

/**
 * The one panel style (Belle Epoque, legible in VR; Gemini UI spec 2026-11-16): smoked-charcoal
 * glass, a polished brass border, and an inset hairline that stops short of each corner and ends
 * in small brass dots. Sizes scale with the canvas (spec is for a 1024 px wide canvas).
 */
export const UI = {
  bg: (a = 0.86) => `rgba(18,24,28,${a})`,
  brass: '#c5a059',
  /** Serif for thematic headers only (names, page titles); everything you read fast stays sans. */
  serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
} as const;

export function brassFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.86): void {
  const s = Math.max(0.5, ctx.canvas.width / 1024);
  const r = 16 * s;
  ctx.fillStyle = UI.bg(alpha);
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = UI.brass;
  ctx.lineWidth = 4 * s;
  roundRect(ctx, x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, r - 2 * s);
  ctx.stroke();
  // Inset hairline, broken at the corners, each end finished with a brass dot.
  const i = 10 * s;
  const gap = 24 * s;
  const x0 = x + i, y0 = y + i, x1 = x + w - i, y1 = y + h - i;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(x0 + gap, y0); ctx.lineTo(x1 - gap, y0);
  ctx.moveTo(x0 + gap, y1); ctx.lineTo(x1 - gap, y1);
  ctx.moveTo(x0, y0 + gap); ctx.lineTo(x0, y1 - gap);
  ctx.moveTo(x1, y0 + gap); ctx.lineTo(x1, y1 - gap);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = UI.brass;
  const dot = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.arc(dx, dy, 3 * s, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const [dx, dy] of [[x0 + gap, y0], [x1 - gap, y0], [x0 + gap, y1], [x1 - gap, y1], [x0, y0 + gap], [x0, y1 - gap], [x1, y0 + gap], [x1, y1 - gap]]) dot(dx, dy);
}
