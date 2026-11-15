import * as THREE from 'three';
import { CanvasPanel, roundRect } from './panels';

/** One ability chip on the wrist / status strip. */
export interface AbilityChip {
  key: string;
  name: string;
  /** 0..1 how ready (1 = ready). */
  ready: number;
  /** Right-hand text: "ready", "2.4 s", "×3"... */
  text: string;
  color: string;
}

/**
 * The left hand: a gauntleted hand with a bracer, fingers that curl as you squeeze the grip, a
 * healing gourd that appears when you hold the grip away from the sword, and a watch-style ability
 * panel on the wrist. Lives in the left controller's grip space (-Z forward out of the fist, +Y up).
 */
export class LeftHandView {
  readonly root = new THREE.Group();
  readonly wrist = new CanvasPanel(512, 384, 0.12);
  private readonly fingers: THREE.Object3D[] = [];
  private readonly thumb: THREE.Object3D;
  private readonly gourd = new THREE.Group();
  private readonly gourdMat = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.6, emissive: 0x000000 });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0, depthWrite: false });
  private readonly glow: THREE.Mesh;
  private curl = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.7, metalness: 0.3 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a6d2f, roughness: 0.4, metalness: 0.7 });
    // Bracer along the forearm (behind the fist, +Z).
    const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.16, 12), metal);
    bracer.rotation.x = Math.PI / 2;
    bracer.position.set(0, 0, 0.11);
    // Palm/back of the hand around the controller handle.
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.085), skin);
    palm.position.set(0, 0.0, 0.005);
    this.root.add(bracer, palm);
    // Four fingers: hinge at the knuckles, curl toward the palm (-Y) as you squeeze.
    for (let i = 0; i < 4; i++) {
      const hinge = new THREE.Group();
      hinge.position.set(-0.027 + i * 0.018, 0.0, -0.04);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.06), skin);
      f.position.z = -0.03;
      hinge.add(f);
      this.root.add(hinge);
      this.fingers.push(hinge);
    }
    const thumbHinge = new THREE.Group();
    thumbHinge.position.set(0.04, 0.0, -0.005);
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.05), skin);
    th.position.z = -0.025;
    thumbHinge.rotation.y = -0.6;
    thumbHinge.add(th);
    this.root.add(thumbHinge);
    this.thumb = thumbHinge;

    // Healing gourd held in the fist, mouth pointing forward (-Z).
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), this.gourdMat);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), this.gourdMat);
    top.position.z = -0.06;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.013, 0.04, 8), this.gourdMat);
    neck.rotation.x = Math.PI / 2;
    neck.position.z = -0.1;
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), this.glowMat);
    this.gourd.add(body, top, neck, this.glow);
    this.gourd.position.set(0, -0.035, -0.01);
    this.gourd.visible = false;
    this.root.add(this.gourd);

    // Watch-style panel on top of the wrist, tilted back toward your eyes.
    const m = this.wrist.mesh;
    m.rotation.set(-Math.PI / 2 + 0.5, 0, 0);
    m.position.set(0, 0.045, 0.1);
    m.renderOrder = 12;
    this.root.add(m);
  }

  /** squeeze 0..1 (grip), flask = holding the gourd, drink 0..1 progress of the current drink. */
  update(squeeze: number, flask: boolean, drink: number, dtMs: number): void {
    this.curl += (squeeze - this.curl) * (1 - Math.exp(-dtMs / 50));
    for (const f of this.fingers) f.rotation.x = -this.curl * 1.4;
    this.thumb.rotation.x = -this.curl * 0.6;
    this.gourd.visible = flask;
    this.glowMat.opacity = flask ? 0.15 + 0.5 * drink : 0;
    this.gourdMat.emissive.setRGB(drink * 0.5, drink * 0.1, drink * 0.1);
  }

  /** Redraw the wrist panel (call at a few Hz: texture uploads aren't free). */
  drawWrist(chips: AbilityChip[], drink: number): void {
    this.wrist.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.88)';
      roundRect(ctx, 0, 0, w, h, 28);
      ctx.fill();
      drawChips(ctx, chips, 16, 16, w - 32, (h - 32 - (drink > 0 ? 44 : 0)) / chips.length);
      if (drink > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(16, h - 44, w - 32, 26);
        ctx.fillStyle = '#ff6a6a';
        ctx.fillRect(16, h - 44, (w - 32) * drink, 26);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 22px system-ui, sans-serif';
        ctx.fillText('DRINKING', 26, h - 24);
      }
    });
  }
}

/** Ability rows: key badge, name, readiness bar, status text. Shared by the wrist and the status strip. */
export function drawChips(ctx: CanvasRenderingContext2D, chips: AbilityChip[], x: number, y: number, w: number, rowH: number): void {
  chips.forEach((c, i) => {
    const ry = y + i * rowH;
    const ready = c.ready >= 1;
    ctx.fillStyle = ready ? c.color : 'rgba(255,255,255,0.25)';
    roundRect(ctx, x, ry + 4, rowH * 1.3, rowH - 8, 10);
    ctx.fill();
    ctx.fillStyle = ready ? '#0a0c12' : '#cfd4dc';
    ctx.font = `800 ${Math.round(rowH * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(c.key, x + rowH * 0.65, ry + rowH * 0.66);
    ctx.textAlign = 'left';
    const bx = x + rowH * 1.45;
    ctx.fillStyle = ready ? '#ffffff' : '#9aa3b0';
    ctx.font = `700 ${Math.round(rowH * 0.4)}px system-ui, sans-serif`;
    ctx.fillText(c.name, bx, ry + rowH * 0.48);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, ry + rowH * 0.62, w - (bx - x) - rowH * 1.6, rowH * 0.16);
    ctx.fillStyle = c.color;
    ctx.fillRect(bx, ry + rowH * 0.62, (w - (bx - x) - rowH * 1.6) * Math.max(0, Math.min(1, c.ready)), rowH * 0.16);
    ctx.textAlign = 'right';
    ctx.fillStyle = ready ? c.color : '#cfd4dc';
    ctx.font = `700 ${Math.round(rowH * 0.36)}px system-ui, sans-serif`;
    ctx.fillText(c.text, x + w, ry + rowH * 0.62);
    ctx.textAlign = 'left';
  });
}

/** Abilities as one row of tiles (status strip): name on top, key + status below, readiness as the fill. */
export function drawChipRow(ctx: CanvasRenderingContext2D, chips: AbilityChip[], x: number, y: number, w: number, h: number): void {
  const gap = 10;
  const cw = (w - gap * (chips.length - 1)) / chips.length;
  chips.forEach((c, i) => {
    const cx = x + i * (cw + gap);
    const ready = c.ready >= 1;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, cx, y, cw, h, 14);
    ctx.fill();
    // Readiness fills the tile from the left.
    ctx.save();
    roundRect(ctx, cx, y, cw, h, 14);
    ctx.clip();
    ctx.fillStyle = ready ? c.color : 'rgba(255,255,255,0.18)';
    ctx.globalAlpha = ready ? 0.35 : 1;
    ctx.fillRect(cx, y, cw * Math.max(0, Math.min(1, c.ready)), h);
    ctx.restore();
    ctx.fillStyle = ready ? '#ffffff' : '#9aa3b0';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText(c.name.replace('Fatal: FINISH HIM', 'FINISH'), cx + 12, y + 32);
    ctx.fillStyle = ready ? c.color : '#cfd4dc';
    ctx.font = '800 32px system-ui, sans-serif';
    ctx.fillText(`${c.key} ${c.text}`, cx + 12, y + h - 16);
  });
}
