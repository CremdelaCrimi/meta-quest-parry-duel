import { describe, expect, it } from 'vitest';
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
