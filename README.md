# Parry Duel VR

A WebXR sword-duel prototype for Meta Quest 3: Sekiro / Lies of P–style parry timing,
directional blocking, lean/duck dodges, and roguelite boons between fights.

## Play
- **Quest:** open the GitHub Pages URL in Quest Browser → *Enter VR*. Stand in your spot, face forward, pull the right trigger.
- **Desktop test mode:** `npm install && npm run dev`, open the URL. Mouse = guard side, click = start/strike,
  A/D lean, S duck, Q/E abilities, 1–3 pick boon, P preset, R recalibrate.

## Controls (Quest)
| Input | Action |
|---|---|
| Right hand | Sword. Guard on the side the attack lands (left / right / overhead / low) |
| Swing into enemy | Strike (counter after a perfect parry; finisher when posture breaks) |
| Lean left/right | Dodge — required for **thrusts** (red ring) |
| Duck | Dodge — required for **sweeps** (red ring) |
| Left trigger / grip | Time Sigil / Ward (once picked up) |
| A / B / Y | Hide panel / recalibrate / switch timing preset |

## Tuning
All feel values live in `src/core/config.ts`. Any of them can be overridden from the URL without a rebuild,
e.g. `?perfectEarlyMs=150&perfectLateMs=50&iframesMs=400` (add `&preset=1` for the Lies of P–like preset).
The in-headset panel shows each guard's timing relative to the strike (negative = early) so tuning is data-driven.

## Layout
- `src/core/` — engine-agnostic combat sim (no three.js). Sub-frame, millisecond timing. Portable to Unity/Godot.
- `src/render/`, `src/xr/`, `src/audio/` — three.js views, WebXR + desktop input, synthesised SFX.
- `tests/` — `npm test`: timing windows, frame-rate independence, anti-spam, dodges, posture, determinism.
