# Parry Duel VR

A WebXR sword-duel prototype for Meta Quest 3: Sekiro / Lies of P–style parry timing,
directional blocking, lean/duck dodges, and roguelite boons between fights.

## Play
- **Quest:** open the GitHub Pages URL in Quest Browser → *Enter VR*. Stand in your spot, face forward, pull the right trigger.
- **Desktop test mode:** `npm install && npm run dev`, open the URL. Mouse = guard side, click = start/strike,
  A/D lean, S duck, Q/E abilities, 1–3 pick boon, P preset, R recalibrate.

## Controls (Quest)
There is no block or attack button: the sword does both. A how-to-play panel sits on your right
before the run and through the first fight (the Trainer: slow, one swing at a time).

| Input | Action |
|---|---|
| Right hand | Sword. **Block** by holding it in the glowing box (ghost sword shows how) before the swing lands |
| Swing into enemy | **Strike** (counter after a perfect parry; finisher when posture breaks) |
| Lean / duck | Dodge. Not needed yet: the current enemies only use blockable swings |
| Left trigger / grip | Time Sigil / Ward (once picked up) |
| Right trigger | Start / confirm |
| A / B / Y | Hide panels / re-center / switch timing preset |

Three swing shapes, each named above the enemy as it winds up:
**vertical** (chop down: sword flat above your head), **horizontal** (level sweep from one side:
sword upright on that side), **diagonal** (down from a raised shoulder: sword upright on that side).
Your HP and posture are on the strip under the enemy; a hit flashes the view red.
`?guides=0` hides the swing path and block box once you know the moves.

## Tuning
All feel values live in `src/core/config.ts`. Any of them can be overridden from the URL without a rebuild,
e.g. `?perfectEarlyMs=150&perfectLateMs=50&iframesMs=400` (add `&preset=1` for the Lies of P–like preset, `&preset=2` for the Easy 250 ms accessibility preset;
P / Y in game cycles presets). `?hitStopMs=` tunes the enemy freeze on a perfect parry.
The in-headset panel shows each guard's timing relative to the strike (negative = early) so tuning is data-driven.

## Reading a parry
A guard is judged on **timing** (entry vs the strike), **angle** (blade square to the attack) and
**steadiness** (blade held still for `steadyMs` before the hit: set your guard, don't swing into it).
All three = perfect (gold). Otherwise the block is coloured by what went wrong: blue = timing,
violet = angle, orange = not held; red = hit. The HUD chart has a legend and a "not perfect because"
tally. Tune with `?steadyMs=50&steadyMaxSpeed=1.2` (m/s at the blade tip; `steadyMs=0` turns it off).

Enemies attack in 1-, 2- and 3-hit strings with a fixed rhythm per enemy (`src/core/enemies.ts`);
pips above the head show the string length. Each swing leaves a fading trail so you can learn its path.

## Enemy model
The default enemy is the simple built-in swordsman (`src/render/views.ts`): each swing is a
windup pose, a middle control point and a strike pose, swept along a curve so impact lands on the
sim's strike instant. `?enemy=rigged` loads the experimental model instead:
`public/enemy/` holds a Tripo-generated, Mixamo-rigged swordsman (`swordsman.glb`, ~2 MB, 10 clips)
and `enemy.json`, which maps each sim attack to a clip plus its release/impact marks. The game scrubs
each clip from the enemy clock so impact always lands on the sim's strike instant (`src/render/clipTiming.ts`).
Clips: Mixamo mocap (idle, overhead, heavy overhead, low cut, thrust) plus Tripo text-to-motion
(the two diagonal slashes, head sweep, stagger, death). Rebuild with
`node tools/build-enemy.mjs <clips-dir> public/enemy`, where the folder holds `idle.glb` (the Tripo mesh)
and one `<clip>.glb` (Tripo export) or `<clip>.fbx` (Mixamo, "Without Skin") per clip.
Notes: `art/enemy-base/tripo-prompts.md`.

## Layout
- `src/core/` — engine-agnostic combat sim (no three.js). Sub-frame, millisecond timing. Portable to Unity/Godot.
- `src/render/`, `src/xr/`, `src/audio/` — three.js views, WebXR + desktop input, synthesised SFX.
- `tests/` — `npm test`: timing windows, frame-rate independence, anti-spam, dodges, posture, determinism.
