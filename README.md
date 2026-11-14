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
| Swing into enemy | **Strike**. While he waits he guards one side: hit the side his sword isn't on (green ring). Lands anywhere while he swings; counter after a perfect parry; finisher when posture breaks |
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

**Chain:** perfects in a row multiply the posture damage they deal (1.0 / 1.15 / 1.3 / 1.5× cap,
`CHAIN_MULT`); a block or hit resets it. **Frenzy:** below 50% HP the enemy's windups are 10% shorter
and pauses 20% shorter; below 25%, 15% / 40% and 3-hit strings twice as likely (`FRENZY`, locked in
per attack so a strike never moves). **Assist:** after 3 hits in a row the perfect window opens 40 ms
earlier until your next perfect, never past +80 ms total with boons (`?assistBonusMs=0` turns it off).
Numbers were worked out with Gemini 3.1 Pro from the clips in `docs/clips/`.

**Deflects and openings:** between attacks the enemy holds his sword on one side and deflects
anything there or down his centre line (posture damage only, "DEFLECTED" above him). The other side
is his opening, marked by a pulsing green ring: a strike there lands, and he moves his guard to cover
it, so the next one has to go to the other side. He also shifts guard by himself every 1.4–2.6 s
(`?guardShiftMinMs=&guardShiftMaxMs=`). A poke (tip driven along the blade's line) into his guard deals
2× posture (`?pokePostureMult=`). While he's swinging, after a perfect parry (gold ring on his chest)
and when he's broken, every strike lands.

**Reading the fight:** a thin ghost sword shows the guard; an impact ring closes on it and turns gold
as the perfect window opens. The enemy's HP, posture, chain and frenzy badges float above his head;
your HP and posture strip follows the bottom of your view; the edge of vision glows red when hit or
below 25% HP, orange when your posture is over 75%. Swing names show in the Trainer fight only
(`?callouts=1` keeps them); otherwise the line above the enemy shows how your last guard went.
Stats appear on the victory/death screens (A / H shows them mid-fight).

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
