# Parry Duel VR

A WebXR sword-duel prototype for Meta Quest 3: Sekiro / Lies of P–style parry timing,
directional blocking, lean/duck dodges, and roguelite boons between fights.

## Play
- **Quest:** open the GitHub Pages URL in Quest Browser → *Enter VR*. Stand in your spot, face forward, pull the right trigger.
- **Desktop test mode:** `npm install && npm run dev`, open the URL. Mouse = guard side, click = start/strike,
  Shift / right mouse hold to block, A/D lean, S duck, arrows dash, F grapple, hold V drink, X Fatal Art, Q time sigil, E ward, G two-handed grip, 1–6 pick a card, T next dummy,
  M / Esc menu, R recalibrate.
- **Older headsets (Quest 1 / Quest 2):** same link, same controls. The game spots the headset and
  switches to a lighter graphics mode by itself (see *Menu and settings*).

## Training
After the start screen, pick **Training** (or **Run** for the real thing). Training gives you a dummy
that never dies (HP refills), your current weapon, and two extra panels:

- **Swing timeline** (left): every swing laid out on a time axis around the strike instant. The
  GUARD lane shows when a guard counts as *held early = block*, *perfect* (gold), *late block* and
  *too late = hit*; for red attacks it becomes a DODGE lane with the i-frame window. The STRIKE lane
  shows when your strikes land: during his windup (you trade hits), during his recovery (safe punish),
  and the gold COUNTER ×1.5 window after a perfect or a dodge. Ticks mark what you actually did; a
  cursor runs along it during the swing, and the last swing stays up for review.
- **Coach** (right): what he's doing right now and what to do about it, in words ("HE GUARDS HIS
  LEFT · hit his right side · moves his guard in 1.4 s"), your grip, and a running tally.

Flick the **right stick** left/right (desktop: T) to switch the dummy:

| Dummy | Attacks | Guards | Use it to |
|---|---|---|---|
| Idle | no | no | feel your swings: every strike lands |
| Attacking | yes | no | practise blocks and dodges; punish anywhere |
| Deflecting | no | yes | learn openings: strikes on his sword side are deflected |
| Attack + deflect | yes | yes | the real fight |

The menu (Y) also picks **Swings** (mixed, vertical only, horizontal only, diagonal only, thrusts,
sweeps, 2–3 hit strings), **Enemy speed** (slow = the Trainer, normal, fast = the last enemy) and
**Weapon**. Dummy data lives in `src/core/training.ts`.

## Spacing and reach
He no longer floats back when you step in: his position is fixed in the arena and he moves with
deliberate footwork (`src/core/footwork.ts`, from the design consult in `docs/design/`):

| He... | When | How |
|---|---|---|
| holds his ground, 1.85 m away | by default | mirrors your sidesteps at 1.0 m/s |
| backsteps to 1.85 m | you stay inside 1.3 m for 0.4 s while he's idle | 2.5 m/s, then a 1.5 s cooldown |
| walks back in | you retreat past 2.3 m | 1.5 m/s |
| steps in, then lunges | during his windup, if you're further than 1.85 m | 2.0 m/s, lunge up to 0.5 m |
| stands and takes it | you're inside during his recovery | then a fast 0.8 m backstep (4 m/s) |
| stumbles toward you | his posture breaks | 0.4 m, so short blades reach the finisher |

Only contact makes a sound: a swing that falls short shows TOO FAR silently.

**Your reach** is arm (0.55 m) + blade + his body (0.27 m): katana 1.70 m, odachi 1.92 m, wakizashi
1.42 m. At his home distance you have to step or dash in. A **floor arc** in front of you marks your
reach and turns green when he's inside it (menu → Reach marker). A fast swing that falls short
flashes your trail white and says **TOO FAR · N cm short**. **His reach** is 1.75 m after
his lunge: be further than that when his blade lands and he misses ("OUT OF HIS REACH"). In training
the coach shows the live distance and both reaches.

## Dash and perfect dodge
Flick the **left stick** (desktop: arrow keys) to dash 0.8 m, at most one every 450 ms.
- **Sideways dashes orbit him:** you circle around him by that arc and he stays dead centre in your
  view; the arena turns around him while you watch the world swing past (no head turning needed).
- **Forward / back** slide you toward or away from him (an offset reference space in VR).
- **Frame data:** a dash moves for exactly as long as its i-frames, so movement and invincibility stay
  in sync: **300 ms** by default (`dashIframesMs`). Lies of P has no published dodge frame data (only
  community reports, e.g. that it feels short), so 300 ms is our estimate of a Lies of P-style step.
  Change it, the distance and the cooldown in menu → **Tuning**; the dash speed is shown there.

Lean / duck dodges have 320 ms of i-frames (`iframesMs`). Which dodge beats what:

| | Normal swing | Red thrust | Red sweep |
|---|---|---|---|
| Side dash / lean | dodged | dodged | hit |
| Back dash / duck | dodged | hit | dodged |
| Forward dash | dodged | hit | hit |

A dodge that starts in the **last 150 ms** before his blade lands is a **perfect dodge**: a heavy clash,
gold flash, a brief slow, 30 posture to him (15 against a normal swing) and the gold counter window.
An earlier dodge inside the i-frames is only safe ("DODGED · early, no counter"). Red attacks ring a
**chime 400 ms before they land**: dodge after it. A hit says why: "dodged 480 ms early (i-frames last
320)", "wrong dodge (thrust: dodge SIDEWAYS)", or what you should have done. The training timeline's
dodge lane shows too early / safe / PERFECT / too late.

## Flask (left grip, away from the sword)
Squeeze the **left grip with your hand away from the sword handle** and a gourd appears in your left
hand. **Raise it above your head** and hold it there for 0.5 s: it bursts into light, golden rings sweep
up around you, +35 HP. 3 per fight (unlimited in training). You **can't attack while holding it**, a hit
interrupts the heal, and you lower it before healing again. Heal time is on the Tuning page (0 = heal
the instant you raise it). Desktop: hold V.

## Fatal Art (X)
Perfect parries (+25), perfect dodges (+25) and strikes he deflects (+5) fill the Fatal Art meter.
At 100% a red prompt beside him says **X · FATAL ART**. Press X (desktop: X): your blade burns red, the
prompt changes to **SWING THROUGH HIM** and a red cut glows across his chest showing the swing to make.
Your next strike within 2.5 s is a heavy hit, ×4 damage and 40 posture, straight through his guard,
with a short freeze. When he's broken the prompt reads **X · FINISH HIM**. When his posture is broken,
**X is the finisher at once**, no swing needed. While broken he's bent over and swaying, blade hanging.

## HUD
- **Status strip** (low in your view, follows lazily): your HP and posture, plus one tile per ability
  (grapple, flask, Fatal Art, ward) that fills as it recovers and shows the seconds left.
- **Wrist** (look at your left wrist, like a watch): the same abilities, bigger, with the drink progress.
- **Lock-on reticle** on his chest: white normally, red and pulsing during a red attack, gold when he's
  open (counter, broken, Fatal Art armed). Menu → Lock-on marker turns it off.
- Above him: his HP, posture, chain and frenzy. Floor arc: your reach (green = in range).

## Mechanics (menu → Mechanics, A/B test)
Experimental mechanics you can switch on and off mid-fight (saved), each with its key number:

| Mechanic | Default | What it does |
|---|---|---|
| Feints | ON | 35% of windups hold an extra 150-400 ms before the swing (same pose, later release). Gears stall, a puff at his shoulder. |
| Fury swings | off | 25% of normal swings glow ember-orange: block and dodge fail, only a **perfect parry** (or being out of reach) works. A perfect on one does ×1.5 posture. Blast can't interrupt it. |
| Riposte | ON | Strike within 400 ms of a perfect parry's freeze (your blade glints gold): ×2.2 damage, +25 posture. |
| Charged strike | off | Hold the sword still (tip under 0.35 m/s) with block released for 1.2 s: a brass ring closes on his chest, your blade turns white-hot. The next swing within 0.9 s does ×1.6 damage and +30 posture even if he deflects it. |
| Guard Regain | off | Blocks cost 50% of the swing as HP, shown ivory on your HP bar; hit him within 2.5 s to win it back. A clean hit on you forfeits it. |
| Spam lockout | ON | More than 3 guard entries in 700 ms locks perfect parries for 350 ms. |

Picked with Gemini (2026-11-16, `docs/design/2026-11-16-gemini-research.md`) from Lies of P's
delayed attacks, Fury attacks, charged attacks and Guard Regain and Sekiro's deflect rhythm.

## Tuning (menu → Tuning)
Every row steps a number and saves it at once (`parryDuel.settings`): dash i-frames (= dash time),
distance, cooldown, perfect dodge window, lean/duck i-frames, perfect parry early/late, parry freeze,
grapple cooldown, drink time, heal per drink, Fatal Art armed time, and Reset all to defaults.

## Left arm (left trigger): grapple or blast
Pick the arm in the menu (**Left arm**). By default it fires at the enemy you're locked on to, no aiming
needed; menu → **Left arm aim → Point** fires where your left hand points instead and draws an **aim
line** that turns gold when it's on him.
- **Blast shot:** a bolt that flies at him (14 m/s, 6 m range): 6 damage and 25 posture, and if he's
  winding up a normal swing it **interrupts it** (he flinches back to idle). Red attacks power through.
  4 s cooldown (Tuning).
- **Grapple:** below.

## Grapple (left trigger)
Pull the **left trigger** (desktop: F) with the grapple selected. A wire (3.5 m range) pulls you
0.5 m toward him (never closer than 1.2 m). Against an idle enemy it also **tears his guard open** for
0.7 s (every strike lands) and deals 15 posture. It costs 20 of your posture and has a 3 s cooldown. A
miss, or grappling into a red attack, locks your strikes and perfects for 0.6 s. (Time Sigil moved to
the left stick press.)

## Menu and settings
Press **Y** (or click the left thumbstick) at any time to pause. The fight freezes until you close it.
Flick either thumbstick up/down to choose a row and left/right to change it; trigger or A selects;
Y or B closes. Desktop: M or Esc, arrow keys, Enter.

| Row | What it does |
|---|---|
| Controller buttons | A drawing of both controllers with what every button does |
| Difficulty | Sekiro-like (standard) / Lies of P-like / Easy (250 ms perfect window) |
| Swing guides | Ghost sword and swing path on or off |
| Swing names | Name every swing above the enemy, or only in the Trainer fight |
| Result text | PERFECT / BLOCK line above the enemy on or off |
| Rumble | Off / Low / Full |
| Graphics | Auto / High / Low (below) |
| Re-center arena | Same as B |
| New run | Back to the weapon and relic choice |

Settings are remembered between visits (`parryDuel.settings` in localStorage); URL parameters still
win at startup. **Graphics:** High renders at full resolution at 90 Hz; Low (for Quest 1 and 2) renders
at 80% resolution with stronger foveation at 72 Hz. Auto picks Low on Quest 1 / 2 and High on Quest 3,
3S and Pro, from the browser's user agent (`src/settings.ts`, `?quality=low|high`). Foveation and refresh
rate change at once; sharpness changes next time you enter VR.

## Controls (Quest)
There is no block or attack button: the sword does both. A how-to-play panel sits on your right
before the run and through the first fight (the Trainer: slow, one swing at a time).

| Input | Action |
|---|---|
| Right hand | Sword. **Block**: put it where the ghost sword shows **and hold the right grip** (the blade glows blue while held) |
| Swing into enemy | **Strike**. While he waits he guards one side: hit the side his sword isn't on (green ring). Lands anywhere while he swings; counter after a perfect parry; finisher when posture breaks |
| Lean / duck | **Dodge** the red must-dodge attacks: lean out of a thrust, duck under a sweep (Duelist and Sentinel) |
| Left stick flick | **Dash** left / right / toward / away (see *Dash*) |
| Right stick flick ←→ | Switch the training dummy |
| Left grip, hand on the handle | **Two-handed grip** (see below) |
| Left grip, hand away from the sword | **Flask**: raise the gourd to your mouth to drink |
| X | **Fatal Art** (meter full) / finisher (he's broken) |
| B | Ward: absorb the next hit (every run starts with it); Back in menus |
| Left trigger | **Grapple**: pulls you in, tears an idle guard open |
| Left stick press | Time Sigil (once picked up) |
| Right trigger | Start / confirm / pick a card |
| **Y** or left stick press | **Menu**: pause, settings, button map |
| A | Stats panel (re-center is in the menu) |

Three swing shapes, each named above the enemy as it winds up:
**vertical** (chop down: sword flat above your head), **horizontal** (level sweep from one side:
sword upright on that side), **diagonal** (down from a raised shoulder: sword upright on that side).
Your HP and posture are on the strip under the enemy; a hit flashes the view red.
`?guides=0` hides the swing path and block box once you know the moves.

## Tuning
All feel values live in `src/core/config.ts`. Any of them can be overridden from the URL without a rebuild,
e.g. `?perfectEarlyMs=150&perfectLateMs=50&iframesMs=400` (add `&preset=1` for the Lies of P–like preset, `&preset=2` for the Easy 250 ms accessibility preset;
or pick Difficulty in the menu). `?hitStopMs=` tunes the enemy freeze on a perfect parry (110 ms; rumble lasts as long).
After the design consult: spam lockout 350 ms, posture-break stagger 2.5 s.
The in-headset panel shows each guard's timing relative to the strike (negative = early) so tuning is data-driven.

## Reading a parry
**Block button:** a guard only counts while the right grip is held (desktop: Shift or the right mouse
button). Holding it with the sword in place is a block; pressing it, with the sword already in place
and still, just as the ring turns gold is a perfect parry: the press is the guard's entry time. Letting
go drops the guard. Menu → Block button → Off goes back to sword position alone (`?blockButton=0`).

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
| Wakizashi | 0.60 m | ×0.85 | ×0.6 | +20 ms perfect window, +40% counter damage |

Relics are the boons Time Sigil, Keen Eye, Fleet Step, Vigor, Blood Deflect and Iron Wrist (`RELIC_IDS`).

**Dodges:** the Duelist adds a thrust and the Sentinel a sweep, both glowing red, always named above
him, and unblockable. Lean or side-dash (thrust), duck or back-dash (sweep) after the chime; a perfect dodge
(last 150 ms) opens the counter window (see *Dash and perfect dodge*).

**Enemy body language:** he coils a little further back just before a swing commits, his torso
twists into the windup and unwinds through the cut, and his blade reacts to how it went: a perfect
parry knocks it back up and rocks him back, a block leans on your guard for a moment, and a hit or
a dodge lets it follow through past you. Tune in `src/render/views.ts` (`COIL_M`, `TWIST_*`, `REACT_MS`).
Perfects, posture breaks, finishers, wards and opening hits also throw a shockwave ring; in VR your own
blade leaves a ribbon on fast swings (gold while a counter is open). See `docs/clips/10_enemy_reactions_dodge.gif`.

Enemies attack in 1-, 2- and 3-hit strings with a fixed rhythm per enemy (`src/core/enemies.ts`);
pips above the head show the string length. Each swing leaves a fading trail so you can learn its path.

## Enemy model
The default enemy is **the Brass Marquis** (`src/render/marquis.ts`), an original clockwork duelist
built from ~40 primitives: porcelain mask with a brass slit and glowing optic, teal tailcoat lined in
crimson, exposed waist cogs, brass shoulder joints, tricorn with a plume, brass boots, a wind-up key
on his back and a cup-hilted blade. Concept: `docs/design/img/brass-marquis-turnaround-gemini.png`.
His parts carry the tells: shoulder gears and the key spin through a windup and **stall during a
feint**, with a puff at the sword shoulder; his **core, optic and blade glow ember-orange** for a Fury
swing (blazing for its last 400 ms). Each swing is a
windup pose, a middle control point and a strike pose, swept along a curve so impact lands on the
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
