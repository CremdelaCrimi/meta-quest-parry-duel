# Gemini consult, 2026-11-16: research, mechanics brainstorm, UI/UX, enemy design

Same Gemini Pro chat as the 2026-11-15 consult ("VR Sword-Parry UI and Mechanics"). Gemini was asked
to search online and cite sources. Claims below are marked **sourced** (a citation was given), or
**estimate** (Gemini or we couldn't source it). Where our own search disagreed, that's noted.

## 1. Research

### Lies of P
| Topic | Finding | Status |
|---|---|---|
| Perfect Guard | 0.155 s window (~9.3 frames at 60 fps); no HP damage, chips enemy weapon durability, builds hidden stagger. Matches `combat-references/`. | sourced (community; Fextralife Combat page) |
| Guard Regain | Normal block takes chip damage held as "Guard Regain"; hit the enemy to win it back before it drains. | sourced |
| Groggy / Fatal | Hits and Perfect Guards fill a hidden meter; when full the HP bar flashes white; a **charged heavy** then staggers (Groggy) and opens a Fatal Attack. | sourced |
| Fable Arts / Legion Arms | Weapon skills on Fable slots (recharged by attacking); Legion Arms are left-arm prosthetics (wire, shield, elemental). | sourced |
| Weapon assembly | Blade = damage, type, reach, one Fable Art. Handle = moveset, scaling, the other Fable Art. | sourced (Fextralife Handles) |
| Dodge i-frames | Not datamined. Players report a short window (~7-9 frames at 60 fps, i.e. ~120-150 ms). | **estimate** |
| Scaling / weight classes | Motivity / Technique / Advance; light / medium / heavy blades change startup and stamina. | **estimate** |

Our own search found no published Lies of P dodge frame data either ([Prima Games](https://primagames.com/tips/does-lies-of-p-have-i-frames-answered),
[Steam discussions](https://steamcommunity.com/app/1627720/discussions/0/3883848458629293395)). Note the
estimate (~120-150 ms) is much shorter than our dash i-frames (300 ms); our dash is a VR movement, not a
roll, so the comfort trade-off stands, but `dashIframesMs` can be tuned down in the menu to try it.

### Sekiro
| Topic | Finding | Status |
|---|---|---|
| Deflect window | 12 frames at 60 fps (200 ms) base; spamming shrinks it (to 7, even 0). | sourced, but conflicting: Fextralife's Deflection page also lists 30 frames shrinking to 7 ([Fextralife](https://sekiroshadowsdietwice.wiki.fextralife.com/Deflection)). Treat 200 ms as the common figure. |
| Perilous | Red kanji. Thrust: Mikiri Counter (step into it). Sweep: jump (and jump-kick). Grab: evade. | sourced |
| Posture / Deathblow | Deflects and hits fill posture; full = Deathblow. A wounded enemy regains posture more slowly (we do this). | sourced |
| Prosthetics | Firecracker (stun/interrupt), Flame Vent (burn), Loaded Umbrella (blocks big hits). | sourced |

### Lies of P art direction
- Setting: Krat, Belle Epoque (late 19th century): opulent French-style architecture against ruined streets (sourced).
- Puppets: porcelain faces, exposed brass/copper clockwork, jerky mechanical motion (sourced).
- Palette and UI: deep blues, greys and crimson with gold/brass accents; serif type, filigree frames,
  instrument-like gauges (**estimate**).

Sources Gemini cited: liesofp.wiki.fextralife.com/Combat and /Handles, samurai-gamers.com Lies of P
combat guide, r/LiesOfP and r/Sekiro threads, a Steam Sekiro thread, Red Bull's Sekiro boss guide,
Dualshockers' 2023 art-direction list, a YouTube boss-fight video.

## 2. Mechanics brainstorm (Gemini's table, condensed)

| Mechanic | Numbers proposed | Borrowed from | Cost | Risk to parry-first |
|---|---|---|---|---|
| Guard Regain | block chip, regain window 2500 ms | Lies of P | M | med (encourages trading) |
| Spam lockout | >3 taps / 700 ms → 500 ms lock | Lies of P | S | low |
| Charged strike | blade still 1.5 s, ×2 posture | Lies of P groggy confirm | M | low |
| Riposte | strike within 400 ms of a perfect, ×1.5+ | Sekiro counter | S | low |
| VR duck vs sweep | 150 ms perfect window, 30 posture | Sekiro | M | med |
| Blade dulling + whetstone gesture | 15 blocks → -50% damage | Lies of P grinder | L | high (kills pacing) |
| Feints (delayed swings) | 150-400 ms hold before release | Lies of P | S | low |
| Fury (parry-only) | 400 ms glow, ignores i-frames | Lies of P | M | med |
| Player stamina | 5 swings | Souls | M | high (double fatigue in VR) |
| Phase 2 at 50% HP | 3-hit strings, ×1.2 speed | Souls | L | low |

**Top 5 picked** (with Gemini's measurable playtest signal), all now built as toggles (menu → Mechanics):
1. Feints, ON. Signal: early-guard rate on held windups falls over a session (players learn the release).
2. Fury, OFF. Signal: perfect rate on Fury swings; under 30% means the window is too punishing in VR.
3. Riposte, ON. Signal: share of strikes inside the 400 ms window after a perfect.
4. Spam lockout, ON. Signal: >3 grip taps per 700 ms drop through a session.
5. Charged strike, OFF. Signal: how often natural hand jitter breaks the stillness threshold.
Plus Guard Regain, OFF (designer's pick).

Our deviations: riposte ×2.2 (counter is already ×1.5, so a riposte needs to beat it clearly);
charge 1.2 s at 0.35 m/s (1.5 s at 0.1 m/s fails on tracking jitter, as Gemini itself flagged);
charge only builds with the block button released, so a held guard isn't a free charge.

## 3. UI/UX proposals (Gemini) and what we did

| Proposal | Status |
|---|---|
| Enemy gauges as curved brass tubes above his head | **built** (crimson HP `#c62a2a`, amber posture: `#8B0000` and teal are too dark to read in a headset) |
| Belle Epoque hall with gaslight (from the mock-up `img/vr-hud-mockup-gemini.png`) | **built**: warm palette, brass pillar caps, 10 additive gas-flame sconces, no real lights (Quest 2) |
| Posture break: slump, steam venting from the neck | **built** (steam bursts from the neck while broken) |
| Measurable playtest signal per mechanic | **built**: menu → Playtest stats (`src/core/playtest.ts`) |
| Guard Regain as an ivory `#FFFFF0` extension of the HP bar | **built** (on your HP bar) |
| Move the status strip to the wrist only (-30° below eye line) | not taken: the strip keeps cooldowns readable without looking down; the wrist watch shows the same |
| Feint tell: shoulder joint stalls, steam puff, metallic click | **built** (gears + key stall, puff) |
| Fury glow: torso core glows through the ribs from 400 ms out | **built** (ember-orange, dim earlier, blazing the last 400 ms; blade, optic, reticle and guide too) |
| Riposte: gold glint on your blade for the window | **built** |
| Charge: brass gear ring on his chest shrinking 0.5 → 0.1 m over the charge | **built** (on the lock-on reticle) |
| Callouts as spatial text at the clash point, rising and fading in 300 ms | later |
| "Tinkerer's Dial" on the inner left wrist with 5 toggles | not taken: a Mechanics page in the pause menu instead (one place, also on desktop) |

## 4. Enemy: "The Brass Marquis"

Gemini's design: 1.85 m clockwork duelist; featureless ivory porcelain oval mask with a vertical brass
slit and a recessed glowing optic; rigid dark teal tailcoat lined in crimson velvet; narrow exposed
waist of rotating brass cogs; oversized brass spherical shoulder joints (the windup tell); a
rapier-estoc with a brass cup hilt; posture break = slumps forward, arms dangling, venting steam;
open side = ivory light through the plating.

The concept turnaround (`img/brass-marquis-turnaround-gemini.png`) added a brass tricorn with plume,
a crimson sash with a gear belt, brass knee joints and boots, and a wind-up key on his back. All of
these are in `src/render/marquis.ts`. In-game: `img/marquis-ingame-v2.jpg`,
`img/marquis-fury-ingame-v1.jpg` (Fury windup).

## 5. Critique of the build (Gemini saw two in-game captures)

| Point | Our call |
|---|---|
| Red (must-dodge) and orange (Fury) are too close for split-second reads; use one danger colour and let text say the answer | **Open: your call.** One colour loses the dodge-vs-parry read before the text is read. Playtest stats now count "tried to dodge" on Fury swings, which is the signal for this exact confusion. |
| On a Fury swing the guides must take the warning colour, not cyan | **built** (ghost, ring and swing path all ember-orange until the perfect window turns them gold) |
| No shadows = he floats, distance is hard to judge | **built**: blob shadow under his feet |
| Dark teal coat melts into the hall; add a cheap Fresnel rim | **built**: ivory rim baked into his materials (`addRim` in `marquis.ts`) |
| Training panels: training only | already the case |
| Green open-side ring clashes with the palette; use pulsing ivory | not taken yet: green is the "go" colour across the whole HUD; revisit with the colour pass above |
| Feint puff too subtle at 1.85 m | **built**: brighter, opaque, faster burst |
| Wrist watch at least 0.08 m radius | wrist panel enlarged 0.11 → 0.13 m |

## 6. VR playtest protocol (Gemini, adapted to our menus)

Reset **menu → Playtest stats** before each session; set toggles in **menu → Mechanics**.

| Session (10 min) | Mechanics ON | Watch | Fail if |
|---|---|---|---|
| 1. Baseline rhythm | Spam lockout only (feints, Fury, riposte, charge, regain off) | Perfect rate (all guards) 40-60 %; spam lockouts spike then drop under 2/min | perfect rate < 20 % → the 30° angle check is too strict |
| 2. Cognitive load | Spam lockout, Feints, Fury | Feints: guarded too early (should fall); Fury perfect rate and "tried to dodge" | > 75 % of Fury swings hit you → the 400 ms glow is too short for VR |
| 3. Aggressive flow | Everything (plus Charge if you want) | Guard Regain won back; riposte use per perfect | regain < 30 % → spacing or his recovery is too short to punish |
