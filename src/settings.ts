/**
 * Player settings, changed from the in-game menu (Y) and remembered between visits (localStorage).
 * URL parameters still win at startup (?preset=, ?guides=0, ?callouts=1, ?results=0, ?quality=low).
 */
export type Quality = 'auto' | 'high' | 'low';

export interface Settings {
  presetIdx: number;
  guides: boolean;
  /** Name every swing above the enemy, not just in the Trainer fight. */
  callouts: boolean;
  results: boolean;
  quality: Quality;
  /** Controller rumble strength, 0..1. */
  haptics: number;
  /** Guards only count while the block button (right grip) is held. Off = sword position alone. */
  blockButton: boolean;
  /** Floor arc showing how far your blade reaches; green when he's in range. */
  reachMarker: boolean;
}

const KEY = 'parryDuel.settings';

export const DEFAULT_SETTINGS: Settings = { presetIdx: 0, guides: true, callouts: false, results: true, quality: 'auto', haptics: 1, blockButton: true, reachMarker: true };

export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  try {
    Object.assign(s, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    /* private window or bad JSON: defaults */
  }
  const q = new URLSearchParams(location.search);
  if (q.has('guides')) s.guides = q.get('guides') !== '0';
  if (q.has('callouts')) s.callouts = q.get('callouts') === '1';
  if (q.has('results')) s.results = q.get('results') !== '0';
  if (q.has('blockButton')) s.blockButton = q.get('blockButton') !== '0';
  const ql = q.get('quality');
  if (ql === 'auto' || ql === 'high' || ql === 'low') s.quality = ql;
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for this visit only */
  }
}

/** Which headset this is, from Quest Browser's user agent ("... Quest 2) ... OculusBrowser/..."). */
export function headsetName(ua = navigator.userAgent): string {
  const m = /Quest(?: (\d\w*|Pro))?/.exec(ua);
  if (m) return m[1] ? `Quest ${m[1]}` : 'Quest 1';
  return /OculusBrowser/.test(ua) ? 'Quest' : 'desktop';
}

/**
 * What "auto" means on this device. Quest 3 / 3S / Pro have the GPU headroom for full resolution at
 * 90 Hz; Quest 1 and 2 get the lighter mode (lower render scale, stronger foveation, 72 Hz).
 */
export function resolveQuality(q: Quality, ua = navigator.userAgent): 'high' | 'low' {
  if (q !== 'auto') return q;
  const name = headsetName(ua);
  return name === 'Quest 1' || name === 'Quest 2' || name === 'Quest' ? 'low' : 'high';
}

/** Render settings per quality level. Render scale only takes effect when you next enter VR. */
export const GRAPHICS = {
  high: { scale: 1.0, foveation: 0.5, hz: 90 },
  low: { scale: 0.8, foveation: 1.0, hz: 72 },
} as const;
