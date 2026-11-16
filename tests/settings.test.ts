import { describe, expect, it } from 'vitest';
import { defaultModifiers } from '../src/core/config';
import { BLADES, HANDLES, assembleWeapon, mismatch, weaponById } from '../src/core/loadout';
import { headsetName, resolveQuality } from '../src/settings';

const UA = (model: string) => `Mozilla/5.0 (X11; Linux x86_64; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0 Chrome/126.0 VR Safari/537.36`;

describe('graphics auto-detect', () => {
  it('names each Quest from its browser user agent', () => {
    expect(headsetName(UA('Quest'))).toBe('Quest 1');
    expect(headsetName(UA('Quest 2'))).toBe('Quest 2');
    expect(headsetName(UA('Quest Pro'))).toBe('Quest Pro');
    expect(headsetName(UA('Quest 3'))).toBe('Quest 3');
    expect(headsetName(UA('Quest 3S'))).toBe('Quest 3S');
    expect(headsetName('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0')).toBe('desktop');
  });

  it('auto picks the light mode on Quest 1 and 2 only', () => {
    expect(resolveQuality('auto', UA('Quest'))).toBe('low');
    expect(resolveQuality('auto', UA('Quest 2'))).toBe('low');
    expect(resolveQuality('auto', UA('Quest 3'))).toBe('high');
    expect(resolveQuality('auto', UA('Quest Pro'))).toBe('high');
    expect(resolveQuality('auto', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0')).toBe('high');
    expect(resolveQuality('high', UA('Quest 2'))).toBe('high'); // a manual choice always wins
  });
});


describe('weapon assembly', () => {
  it('blade sets reach and damage, handle sets strike speed and cooldown', () => {
    const w = assembleWeapon('cleaver', 'pole');
    expect(w.bladeM).toBe(1.2);
    expect(w.strikeSpeed).toBe(1.2);
    const m = defaultModifiers();
    w.apply(m);
    expect(m.playerDamageMult).toBeCloseTo(1.6);
    expect(weaponById(w.id).name).toBe(w.name);
  });

  it('light-heavy pairs are mismatched: slower and no parry bonus', () => {
    const cleaver = BLADES.find((b) => b.id === 'cleaver')!;
    const fencer = HANDLES.find((h) => h.id === 'fencer')!;
    expect(mismatch(cleaver, fencer)).toEqual({ extraCooldownMs: 300, noParryBonus: true });
    const m = defaultModifiers();
    const w = assembleWeapon('cleaver', 'fencer');
    w.apply(m);
    expect(m.perfectWindowBonusMs).toBe(0);
    expect(w.strikeCooldownMult).toBeGreaterThan(fencer.cooldownMult);
    // A medium part pairs with anything.
    expect(mismatch(BLADES[0], fencer).noParryBonus).toBe(false);
  });
});
