import * as THREE from 'three';
import type { InputFrame } from '../xr/input';
import { CanvasPanel, roundRect } from './panels';

/** One row in the menu: an action (act) or a setting you step through left/right (change). */
export interface MenuItem {
  label: string;
  value?: () => string;
  /** Small grey line under the label. */
  hint?: () => string;
  change?: (dir: number) => void;
  act?: () => void;
  /** Left out of the list (e.g. a row that doesn't apply in training). */
  hidden?: boolean;
}

const BG = 'rgba(10,12,18,0.92)';
const GOLD = '#ffd34d';
const TEXT = '#e0e4ea';
const DIM = '#7c8594';
const FONT = 'system-ui, sans-serif';

/**
 * Pause menu: opens in front of wherever you're looking (Y or left stick press), freezes the
 * fight, and has a page that draws both controllers with what every button does.
 * Navigate with either thumbstick (or arrow keys); trigger / A selects; Y / B closes.
 */
export class PauseMenu {
  readonly panel = new CanvasPanel(1024, 1200, 0.7);
  isOpen = false;
  private page: 'main' | 'controls' = 'main';
  private cursor = 0;
  private title = 'PAUSED';
  /** Sub-pages (e.g. Tuning): B goes back up one level. */
  private readonly stack: Array<{ items: MenuItem[]; cursor: number; title: string }> = [];
  private readonly fwd = new THREE.Vector3();

  constructor(
    private items: MenuItem[],
    private readonly status: () => string,
    private readonly isXR: () => boolean,
  ) {
    this.panel.mesh.visible = false;
    this.panel.mesh.rotation.set(0, 0, 0); // lives in the scene, faced at the head with lookAt
    this.panel.mesh.renderOrder = 20;
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    this.cursor = Math.min(this.cursor, items.length - 1);
  }

  open(head: THREE.Vector3, q: THREE.Quaternion, page: 'main' | 'controls' = 'main'): void {
    // Level with the floor so the panel doesn't tilt with your head, a bit below eye height.
    this.fwd.set(0, 0, -1).applyQuaternion(q).setY(0);
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const m = this.panel.mesh;
    m.position.copy(head).addScaledVector(this.fwd, 0.85);
    m.position.y -= 0.1;
    m.lookAt(head.x, m.position.y, head.z);
    this.page = page;
    this.stack.length = 0;
    this.title = 'PAUSED';
    this.isOpen = true;
    m.visible = true;
    this.draw();
  }

  close(): void {
    this.isOpen = false;
    this.panel.mesh.visible = false;
  }

  /** Returns true when something changed (the caller plays a click and buzzes). */
  update(f: InputFrame): boolean {
    if (!this.isOpen) return false;
    if (this.page === 'controls') {
      if (f.select || f.btnB || f.navX) {
        this.page = 'main';
        this.draw();
        return true;
      }
      return false;
    }
    if (f.btnB) {
      if (!this.back()) this.close();
      return true;
    }
    const n = this.items.length;
    let changed = false;
    if (f.navY) {
      this.cursor = (this.cursor + f.navY + n) % n;
      changed = true;
    }
    const it = this.items[this.cursor];
    if (f.navX && it.change) {
      it.change(f.navX);
      changed = true;
    } else if (f.select) {
      if (it.act) it.act();
      else it.change?.(1);
      changed = true;
    }
    if (changed && this.isOpen) this.draw();
    return changed;
  }

  /** Open a sub-page (a list of rows with its own title). */
  openSub(title: string, items: MenuItem[]): void {
    this.stack.push({ items: this.items, cursor: this.cursor, title: this.title });
    this.items = items;
    this.cursor = 0;
    this.title = title;
    this.draw();
  }

  /** Up one level; false when already at the top. */
  back(): boolean {
    const top = this.stack.pop();
    if (!top) return false;
    this.items = top.items;
    this.cursor = top.cursor;
    this.title = top.title;
    this.draw();
    return true;
  }

  showControls(): void {
    this.page = 'controls';
    this.draw();
  }

  draw(): void {
    if (this.page === 'controls') this.drawControls();
    else this.drawMain();
  }

  private drawMain(): void {
    const xr = this.isXR();
    this.panel.draw((ctx, w, h) => {
      ctx.fillStyle = BG;
      roundRect(ctx, 0, 0, w, h, 32);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 60px ${FONT}`;
      ctx.fillText(this.title, 48, 88);
      ctx.fillStyle = DIM;
      ctx.font = `500 28px ${FONT}`;
      ctx.fillText(this.status(), 48, 132);

      const rowH = Math.min(78, Math.floor((h - 250) / this.items.length));
      let y = 170;
      this.items.forEach((it, i) => {
        const sel = i === this.cursor;
        if (sel) {
          ctx.fillStyle = 'rgba(255,211,77,0.16)';
          roundRect(ctx, 28, y, w - 56, rowH - 8, 18);
          ctx.fill();
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
        const hint = it.hint?.();
        ctx.fillStyle = sel ? '#ffffff' : TEXT;
        ctx.font = `${sel ? 700 : 500} 36px ${FONT}`;
        ctx.fillText(it.label, 56, y + (hint ? 36 : 48));
        if (hint) {
          ctx.fillStyle = DIM;
          ctx.font = `500 22px ${FONT}`;
          ctx.fillText(hint, 56, y + 62);
        }
        if (it.value) {
          const v = it.value();
          ctx.textAlign = 'right';
          ctx.font = `700 34px ${FONT}`;
          ctx.fillStyle = sel ? GOLD : '#cfd4dc';
          ctx.fillText(it.change && sel ? `‹  ${v}  ›` : v, w - 56, y + 48);
          ctx.textAlign = 'left';
        } else if (it.act) {
          ctx.textAlign = 'right';
          ctx.fillStyle = sel ? GOLD : DIM;
          ctx.font = `700 34px ${FONT}`;
          ctx.fillText('›', w - 56, y + 48);
          ctx.textAlign = 'left';
        }
        y += rowH;
      });

      ctx.fillStyle = DIM;
      ctx.font = `500 26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        xr ? 'Stick ↕ choose · Stick ↔ change · Trigger or A select · B back · Y close' : '↑↓ choose · ←→ change · Enter select · M / Esc close',
        w / 2,
        h - 36,
      );
      ctx.textAlign = 'left';
    });
  }

  /** Both controllers drawn as seen from above, every button labelled with what it does. */
  private drawControls(): void {
    const xr = this.isXR();
    this.panel.draw((ctx, w, h) => {
      ctx.fillStyle = BG;
      roundRect(ctx, 0, 0, w, h, 32);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 56px ${FONT}`;
      ctx.fillText(xr ? 'CONTROLLERS' : 'KEYS', 48, 84);
      ctx.fillStyle = DIM;
      ctx.font = `500 27px ${FONT}`;
      ctx.fillText('Your sword blocks and attacks by itself. Buttons are for extras.', 48, 128);

      if (xr) {
        controller(ctx, 260, 330, 'L', [
          ['Y', 'MENU (this screen)', GOLD],
          ['X', 'FATAL ART (meter full / he is broken)', '#ff5050'],
          ['Stick', 'Flick: DASH that way · press: Time Sigil', '#60c0ff'],
          ['Trigger', 'GRAPPLE: point at him, pulls you in', '#d8c08a'],
          ['Grip', 'On handle: two hands · away: FLASK', '#ffd060'],
        ]);
        controller(ctx, 260, 700, 'R', [
          ['B', 'Ward: absorb next hit · menu: back', '#6fb6ff'],
          ['A', 'Stats panel · select in menus', TEXT],
          ['Stick', 'Flick ←→: switch training dummy', TEXT],
          ['Trigger', 'Start · confirm · pick a card', GOLD],
          ['Grip', 'HOLD = BLOCK (guard counts while held)', '#6fb6ff'],
        ]);
      } else {
        const keys: Array<[string, string]> = [
          ['Mouse', 'Sword: left / right / high / low guard'],
          ['Shift / RMB', 'Hold to block'],
          ['Click', 'Start · strike · pick'],
          ['A / D · S', 'Lean (dodge thrust) · duck (dodge sweep)'],
          ['Arrows', 'Dash left / right / toward / away'],
          ['T', 'Switch training dummy'],
          ['E', 'Ward: absorb next hit'],
          ['X / hold V', 'Fatal Art · drink from the flask'],
          ['Q', 'Time Sigil (once picked up)'],
          ['F', 'Grapple: pull yourself in'],
          ['G', 'Two-handed grip'],
          ['1–6', 'Pick a card'],
          ['H', 'Stats panel'],
          ['R', 'Re-center'],
          ['M / Esc', 'This menu'],
        ];
        let y = 220;
        for (const [k, d] of keys) {
          ctx.fillStyle = GOLD;
          ctx.font = `800 36px ${FONT}`;
          ctx.fillText(k, 64, y);
          ctx.fillStyle = TEXT;
          ctx.font = `500 32px ${FONT}`;
          ctx.fillText(d, 290, y);
          y += 64;
        }
      }

      ctx.fillStyle = '#ff8a5a';
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText('Red thrust: lean or dash sideways. Red sweep: duck or dash back.', 48, h - 110);
      ctx.fillStyle = DIM;
      ctx.font = `500 26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(xr ? 'Trigger, A, B or a stick flick: back' : 'Enter, click or an arrow: back', w / 2, h - 36);
      ctx.textAlign = 'left';
    });
  }
}

/**
 * A Touch controller face (ring, stick, two buttons) at (cx, cy) with labels to the right.
 * Rows are, in order: top button, bottom button, stick, trigger, grip.
 */
function controller(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: 'L' | 'R', rows: Array<[string, string, string]>): void {
  // Tracking ring and handle.
  ctx.strokeStyle = '#4a505e';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cy - 40, 120, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#2a2e38';
  roundRect(ctx, cx - 95, cy - 120, 190, 220, 60);
  ctx.fill();
  ctx.fillStyle = '#9aa3b0';
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(side === 'L' ? 'LEFT' : 'RIGHT', cx, cy + 150);

  // Stick on the outer side, buttons on the inner side (as on the real controllers).
  const sx = cx + (side === 'L' ? -38 : 38);
  const bx = cx + (side === 'L' ? 42 : -42);
  const dots: Array<[number, number, number]> = [
    [bx, cy - 70, 26], // top button (Y / B)
    [bx - (side === 'L' ? 10 : -10), cy - 5, 26], // bottom button (X / A)
    [sx, cy - 40, 34], // stick
  ];
  dots.forEach(([x, y, r], i) => {
    ctx.fillStyle = i === 2 ? '#14161c' : '#3c4250';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rows[i][2];
    ctx.lineWidth = 4;
    ctx.stroke();
    if (i < 2) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText(rows[i][0], x, y + 9);
    }
  });
  ctx.textAlign = 'left';

  // Labels: one line per row, with a short leader from the part it belongs to.
  const lx = 470;
  const anchors: Array<[number, number]> = [
    [dots[0][0], dots[0][1]],
    [dots[1][0], dots[1][1]],
    [dots[2][0], dots[2][1]],
    [cx, cy + 60], // trigger (under your index finger: drawn at the front of the handle)
    [cx, cy + 95], // grip
  ];
  rows.forEach(([name, what, color], i) => {
    const ly = cy - 120 + i * 58;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(anchors[i][0], anchors[i][1]);
    ctx.lineTo(lx - 12, ly - 10);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(name, lx, ly);
    ctx.fillStyle = TEXT;
    ctx.font = `500 27px ${FONT}`;
    ctx.fillText(what, lx + 120, ly);
  });
}
