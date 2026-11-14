# Parry Duel VR

A WebXR sword-duel prototype for Meta Quest 3: Sekiro / Lies of P–style parry timing,
directional blocking, lean/duck dodges, and roguelite boons between fights.

## Play
- **Quest:** open the GitHub Pages URL in Quest Browser → *Enter VR*. Stand in your spot, face forward, pull the right trigger.
- **Desktop test mode:** `npm install && npm run dev`, open the URL. Mouse = guard side, click = start/strike,
  A/D lean, S duck, Q time sigil, E ward, G two-handed grip, 1–6 pick a card, P preset, R recalibrate.

## Controls (Quest)
There is no block or attack button: the sword does both. A how-to-play panel sits on your right
before the run and through the first fight (the Trainer: slow, one swing at a time).

| Input | Action |
|---|---|
| Right hand | Sword. **Block** by holding it in the glowing box (ghost sword shows how) before the swing lands |
| Swing into enemy | **Strike**. While he waits he guards one side: hit the side his sword isn't on (green ring). Lands anywhere while he swings; counter after a perfect parry; finisher when posture breaks |
| Lean / duck | **Dodge** the red must-dodge attacks: lean out of a thrust, duck under a sweep (Duelist and Sentinel) |
| Left grip, hand on the handle | **Two-handed grip** (see below) |
| X | Ward: absorb the next hit (every run starts with it) |
| Left trigger | Time Sigil (once picked up) |
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

**Two-handed grip:** put your left hand on the handle, about 17 cm behind your right
(a ring appears as you get close), and squeeze the left grip. After 150 ms both controllers click
and a 2H badge shows on your strip. Let go of the grip, or pull your hands more than 10 cm
apart, to drop back to one hand. While held, the blade turns about your right hand 70% of
the way toward the line between your hands, so the left hand steadies it (`src/xr/input.ts`).

| | One hand | Two hands |
|---|---|---|
| Steadiness limit for a perfect | 1.2 m/s | 1.6 m/s (`twoHandSteadyMaxSpeed`) |
| Blade angle tolerance | 30° | 35° (`twoHandAngleBonusDeg`) |
| Posture cost of a block | ×1 | ×0.75 (`twoHandBlockPostureMult`) |
| Strike damage | ×1 | ×1.25 (`twoHandDamageMult`) |
| Next strike counts after | 250 ms | 450 ms (`STRIKE_COOLDOWN_MS`) |
| Poke posture into his guard | ×2 | ×1.25 (`twoHandPokeMult`) |

**Reading the fight:** a thin ghost sword shows the guard; an impact ring closes on it and turns gold
as the perfect window opens. The enemy's HP, posture, chain and frenzy badges float above his head;
your HP and posture strip follows the bottom of your view; the edge of vision glows red when hit or
below 25% HP, orange when your posture is over 75%. Swing names show in the Trainer fight only
(`?callouts=1` keeps them); otherwise the line above the enemy shows how your last guard went.
Stats appear on the victory/death screens (A / H shows them mid-fight).

**Loadout:** after you start, pick a weapon, then a free starting relic (touch a card with the blade
and pull the trigger, or 1–6 on desktop). Your last picks are remembered and tagged "last time";
`?loadout=0` skips the screens and reuses them. Weapons are in `src/core/loadout.ts`:

| | Blade | Damage | Strike cooldown | Other |
|---|---|---|---|---|
| Katana | 0.88 m | ×1 | ×1 | the baseline |
| Odachi | 1.10 m | ×1.35 | ×1.5 | +20% parry posture damage |
| Wakizashi | 0.60 m | ×0.75 | ×0.6 | +20 ms perfect window, +40% counter damage |

Relics are the boons Time Sigil, Keen Eye, Fleet Step, Vigor, Blood Deflect and Iron Wrist (`RELIC_IDS`).

**Dodges:** the Duelist adds a thrust and the Sentinel a sweep, both glowing red, always named above
him, and unblockable. Lean (thrust) or duck (sweep) just before it lands; a clean dodge opens the same
counter window as a perfect parry (gold ring, "DODGED · COUNTER NOW!") and flashes the edge of view blue.

**Enemy body language:** he coils a little further back just before a swing commits, his torso
twists into the windup and unwinds through the cut, and his blade reacts to how it went: a perfect
parry knocks it back up and rocks him back, a block leans on your guard for a moment, and a hit or
a dodge lets it follow through past you. Tune in `src/render/views.ts` (`COIL_M`, `TWIST_*`, `REACT_MS`).
Perfects, posture breaks, finishers, wards and opening hits also throw a shockwave ring; in VR your own
blade leaves a ribbon on fast swings (gold while a counter is open). See `docs/clips/10_enemy_reactions_dodge.gif`.

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
