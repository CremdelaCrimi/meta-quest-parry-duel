import { defaultModifiers } from './config';
import { ENEMIES } from './enemies';
import { Rng } from './rng';
import type { EnemyDef, Modifiers } from './types';

export interface Pickup {
  id: string;
  name: string;
  desc: string;
  maxStacks: number;
  apply(m: Modifiers): void;
}

export const PICKUPS: Pickup[] = [
  { id: 'keenEye', name: 'Keen Eye', desc: '+25 ms perfect-parry window', maxStacks: 3, apply: (m) => void (m.perfectWindowBonusMs += 25) },
  { id: 'ironWrist', name: 'Iron Wrist', desc: '+35% posture damage on perfect parry', maxStacks: 3, apply: (m) => void (m.deflectPostureMult *= 1.35) },
  { id: 'riposte', name: 'Riposte', desc: '+60% counter-attack damage', maxStacks: 3, apply: (m) => void (m.counterDamageMult *= 1.6) },
  { id: 'whetstone', name: 'Whetstone', desc: '+25% sword damage', maxStacks: 3, apply: (m) => void (m.playerDamageMult *= 1.25) },
  { id: 'fleetStep', name: 'Fleet Step', desc: '+100 ms dodge invulnerability', maxStacks: 2, apply: (m) => void (m.iframesBonusMs += 100) },
  { id: 'bloodDeflect', name: 'Blood Deflect', desc: 'Perfect parries heal 3 HP', maxStacks: 3, apply: (m) => void (m.healOnPerfect += 3) },
  { id: 'vigor', name: 'Vigor', desc: '+25 max HP', maxStacks: 3, apply: (m) => void (m.maxHpBonus += 25) },
  {
    id: 'slowTime',
    name: 'Time Sigil',
    desc: 'Left trigger: enemy at half speed for 3 s (18 s cooldown)',
    maxStacks: 1,
    apply: (m) => void m.abilities.push('slowTime'),
  },
  {
    id: 'ward',
    name: 'Ward Sigil',
    desc: 'Left grip: absorb the next hit (12 s cooldown)',
    maxStacks: 1,
    apply: (m) => void m.abilities.push('ward'),
  },
];

/** State for one roguelite run: fight counter, collected pickups, carried HP. */
export class Run {
  fight = 0;
  readonly mods: Modifiers = defaultModifiers();
  readonly stacks: Record<string, number> = {};
  playerHp: number | undefined = undefined;
  private readonly rng: Rng;

  constructor(readonly seed: number) {
    this.rng = new Rng(seed);
  }

  /** First pass goes through every enemy (Trainer first); later loops skip the Trainer and get faster and tougher. */
  enemyForFight(): EnemyDef {
    if (this.fight < ENEMIES.length) return ENEMIES[this.fight];
    const pool = ENEMIES.slice(1);
    const n = this.fight - ENEMIES.length;
    const base = pool[n % pool.length];
    const loop = 1 + Math.floor(n / pool.length);
    return { ...base, name: `${base.name} +${loop}`, speed: base.speed + 0.1 * loop, hp: Math.round(base.hp * (1 + 0.25 * loop)) };
  }

  offer(n = 3): Pickup[] {
    const pool = PICKUPS.filter((p) => (this.stacks[p.id] ?? 0) < p.maxStacks);
    const out: Pickup[] = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(this.rng.next() * pool.length), 1)[0]);
    }
    return out;
  }

  choose(p: Pickup): void {
    p.apply(this.mods);
    this.stacks[p.id] = (this.stacks[p.id] ?? 0) + 1;
  }

  /** Call after winning a fight. HP carries over, with a small heal between fights. */
  advance(hpLeft: number): void {
    this.fight++;
    this.playerHp = hpLeft + 20;
  }
}
