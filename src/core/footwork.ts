/**
 * Enemy footwork: where he stands, in the fixed duel frame set at calibration (metres; +z toward
 * him, +x the player's right). Replaces the old behaviour where the whole duel frame re-centred on
 * the player, which made him float back whenever the player stepped in. Discrete, readable moves
 * (design consult 2026-11-15, docs/design/):
 *
 *   pace       holds his ground at about HOME, mirrors your sidesteps
 *   backstep   you stayed inside INSIDE for INSIDE_DELAY: he leaps back to HOME (then a cooldown)
 *   advance    you retreated past FAR: he walks back in to HOME
 *   attack     during a windup he steps in to HOME if you're further (the lunge does the rest)
 *   hold       during his recovery he stays put and takes your hits...
 *   emergency  ...then, if you're inside, a fast backstep the moment recovery ends
 *   stumble    on a posture break he stumbles toward you, so even short blades reach the finisher
 */
export const FOOTWORK = {
  home: 1.85,
  inside: 1.3,
  insideDelayMs: 400,
  backstepSpeed: 2.5,
  backstepCooldownMs: 1500,
  far: 2.3,
  advanceSpeed: 1.5,
  mirrorSpeed: 1.0,
  attackStepSpeed: 2.0,
  emergencySpeed: 4.0,
  stumbleM: 0.4,
  stumbleSpeed: 2.0,
  /** He never stands closer than this to your head (m), so he can't clip into you. */
  minGap: 0.7,
};

export type FootMode = 'pace' | 'backstep' | 'advance' | 'attack' | 'hold' | 'emergency' | 'stumble';

export interface FootInput {
  t: number;
  dtMs: number;
  /** Player head in the fixed duel frame. */
  px: number;
  pz: number;
  enemy: 'idle' | 'attack' | 'stagger' | 'dead';
  /** In an attack: has the strike already happened (recovery)? */
  struck: boolean;
}

export class Footwork {
  x = 0;
  z = FOOTWORK.home;
  mode: FootMode = 'pace';
  private insideSince = -1;
  private cooldownUntil = -Infinity;
  private emergencyPending = false;
  private stumbleTo = NaN;

  reset(px: number, pz: number): void {
    this.x = px;
    this.z = pz + FOOTWORK.home;
    this.mode = 'pace';
    this.insideSince = -1;
    this.cooldownUntil = -Infinity;
    this.emergencyPending = false;
    this.stumbleTo = NaN;
  }

  /** Distance from the player's head to him along the duel axis. */
  gap(pz: number): number {
    return this.z - pz;
  }

  /** Posture broken: stumble toward the player. */
  stumble(pz: number): void {
    this.stumbleTo = Math.max(this.z - FOOTWORK.stumbleM, pz + FOOTWORK.minGap);
  }

  update(i: FootInput): void {
    const c = FOOTWORK;
    const dt = i.dtMs / 1000;
    const gap = this.z - i.pz;
    const home = i.pz + c.home;
    let targetZ = this.z;
    let speed = 0;

    if (i.enemy === 'dead') return;
    if (i.enemy !== 'stagger') {
      const mx = c.mirrorSpeed * dt;
      this.x += clamp(i.px - this.x, -mx, mx);
      this.stumbleTo = NaN;
    }

    if (i.enemy === 'stagger') {
      this.mode = 'stumble';
      if (!Number.isNaN(this.stumbleTo)) {
        targetZ = this.stumbleTo;
        speed = c.stumbleSpeed;
      }
    } else if (i.enemy === 'attack' && !i.struck) {
      this.mode = 'attack';
      this.emergencyPending = false;
      if (gap > c.home) {
        targetZ = home;
        speed = c.attackStepSpeed;
      }
    } else if (i.enemy === 'attack') {
      this.mode = 'hold';
      if (gap < c.inside) this.emergencyPending = true;
    } else {
      // Idle.
      if (this.emergencyPending || this.mode === 'emergency') {
        this.mode = 'emergency';
        this.emergencyPending = false;
        targetZ = home;
        speed = c.emergencySpeed;
        if (gap >= c.home - 0.02) this.endRetreat(i.t);
      } else if (this.mode === 'backstep') {
        targetZ = home;
        speed = c.backstepSpeed;
        if (gap >= c.home - 0.02) this.endRetreat(i.t);
      } else if (gap < c.inside) {
        if (this.insideSince < 0) this.insideSince = i.t;
        if (i.t - this.insideSince >= c.insideDelayMs && i.t >= this.cooldownUntil) this.mode = 'backstep';
        else this.mode = 'pace';
      } else {
        this.insideSince = -1;
        if (gap > c.far) this.mode = 'advance';
        if (this.mode === 'advance') {
          targetZ = home;
          speed = c.advanceSpeed;
          if (gap <= c.home + 0.02) this.mode = 'pace';
        } else this.mode = 'pace';
      }
    }

    const step = speed * dt;
    this.z += clamp(targetZ - this.z, -step, step);
    if (this.z - i.pz < c.minGap) this.z = i.pz + c.minGap;
  }

  private endRetreat(t: number): void {
    this.mode = 'pace';
    this.insideSince = -1;
    this.cooldownUntil = t + FOOTWORK.backstepCooldownMs;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
