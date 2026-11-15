# Parry Duel VR: design consult briefing (2026-11-15)

A WebXR sword-duel prototype for Meta Quest (Quest 3 primary; Quest 1/2 supported). Sekiro- and
Lies of P-inspired parry combat, played standing with tracked controllers. Original code, names and
art; the attached Lies of P reference is design notes only. All timings are in milliseconds.

## Current mechanics (as built)

### Player inputs
- Right controller = the sword (always in hand). Strikes are physical: the blade must touch the
  enemy's body capsule while the tip moves faster than 1.8 m/s.
- **Block button (new): hold the right grip.** A guard only counts while held. Pressing it with the
  sword already in place counts as the guard's entry time, so a timed press = perfect parry. The blade
  glows blue while held. Can be turned off (sword position alone blocks).
- Left grip with the left hand on the handle (17 cm behind the right) = two-handed grip.
- Left stick flick = dash (left/right 0.55 m, toward 0.5 m, away 0.6 m, 400 ms cooldown, 140 ms slide).
- Physical lean (head moves 0.2 m sideways at >0.6 m/s) and duck (head drops 0.25 m) = dodges.
- X = Ward (absorbs the next hit, 12 s cooldown). Left trigger = Time Sigil (slow enemy 3 s) if owned.
- Y = pause menu (settings, controller map, training options). Right stick flick = switch training dummy.

### Guards and parry judging
- Four guards by blade pose: high (blade flat overhead), left/right (blade upright on that side), low.
- Attack shapes: vertical (guard high), horizontal and diagonal from a side (guard that side).
- Perfect parry needs all three: **timing** (guard entry 120 ms before to 40 ms after the strike),
  **angle** (blade within 30° of ideal; block allows 45°), **steadiness** (tip under 1.2 m/s for the
  last 50 ms). Otherwise a block (no HP loss, 0.6× attack posture to the player) if not later than
  60 ms and within 45°; else a hit.
- Anti-spam: more than 3 guard entries in 700 ms locks perfects for 450 ms.
- Perfect: enemy posture damage (×1.0/1.15/1.3/1.5 for chained perfects), 70 ms enemy hit-stop,
  then a 700 ms counter window (strikes do 1.5×).
- Assist: after 3 hits in a row the perfect window opens 40 ms earlier (cap +80 ms with boons).
- Presets: Sekiro-like (above), Lies of P-like (125/30 ms), Easy (220 ms early).

### Enemy
- Attacks in 1/2/3-hit strings with a fixed beat per enemy. Windups 380-950 ms (scaled by enemy
  speed 0.62-1.15). Recovery 450-900 ms. Frenzy below 50%/25% HP shortens windups and idles.
- Red must-dodge attacks: thrust (beaten by lean or side dash) and sweep (beaten by duck or back
  dash). Dodges give 320 ms of i-frames from the moment they start. Dodging a red attack opens the
  same counter window as a perfect; dodging a normal swing is safe but gives nothing.
- While idle he holds his sword on one side and deflects strikes there or down the middle (posture
  only). The other side is his opening (green ring); a hit there makes him cover it. He shifts guard
  every 1.4-2.6 s. Pokes into his guard deal 2× posture. While he's swinging, in a counter window or
  broken, every strike lands.
- Posture full = stagger 1.6 s; next strike is a finisher (kills).
- Body language: coils before release, torso twist, blade reacts (knocked up on a perfect, leans on a
  block, follows through on a hit/dodge). Shockwave rings on perfects/breaks.

### Spacing (the weak point)
- The enemy is placed at a fixed **1.85 m** from the player's head along the duel axis.
- When the player moves (steps, leans, dashes), the whole duel frame re-centres on the player's head
  with a 0.8 s time constant. **So the enemy always drifts back to 1.85 m: step in and he floats away.**
- He only comes closer while attacking: a 0.5 m lunge late in the windup, held through the strike.
- The enemy body for hit detection is a vertical capsule of radius 0.27 m at his position.
- Player reach: arm (~0.55 m forward) + blade (katana 0.88 m, odachi 1.10 m, wakizashi 0.60 m). With
  the capsule front at ~1.58 m, **a katana at full extension standing still barely reaches him, and
  the wakizashi can't** unless he lunges in or the player steps in faster than he drifts back.
- No miss feedback: a swing that falls short shows nothing, so the player can't tell "too far" from
  "didn't count" (too slow) from "deflected".

### Training mode
- Dummy that never dies: Idle (no guard), Attacking (no guard), Deflecting (never swings), Attack + deflect.
- Swing timeline panel (guard lane: early block / perfect / late block / too late; dodge lane for red
  attacks; strike lane: trade / punish / counter windows) and a coach panel describing what to do.

### Weapons (loadout before a run)
- Katana (baseline), Odachi (long, ×1.35 damage, ×1.5 strike cooldown), Wakizashi (short, quick,
  ×0.75 damage, +20 ms perfect window, ×1.4 counter damage).

## Playtest feedback (from the designer, first sessions in headset)
1. Blocking now makes sense with the hold-to-block button.
2. **Can't read distance.** Different sword lengths make it hard to judge reach; even up close, strikes
   didn't seem to register (no hit markers).
3. **Every time I got close, the enemy floated back.** Spacing and how the enemy reacts to it hasn't
   been designed yet.
4. **Can't tell what's happening with dodges.** Not clear why red attacks aren't being dodged, or when
   a "perfect dodge" happens.
5. Wants a clearer, more distinct **perfect parry** (and possibly a perfect dodge).
6. Considering a **hold-to-attack button** (attack stance vs parry stance on different buttons).
7. Left hand ideas: **dual blades**, or a Sekiro / Lies of P-style **left-hand tool** (e.g. a grapple
   to the enemy) that is usable all the time, not just situationally.

## Questions for the consult
1. Spacing: how should the enemy manage distance in VR melee (hold ground, step back, close in, react
   to the player stepping in or retreating)? What distances and speeds are comfortable and readable?
   Should the duel frame stop re-centring?
2. Reach: how do we make distance readable (range indicators, hit/miss feedback, weapon reach
   differences)? Should weapon length change hit detection, or should the enemy adapt to the weapon?
3. Dodge clarity: how should dodge timing be communicated? Should there be a perfect dodge (late
   dodge into a red attack, Sekiro mikiri-style), and what window?
4. Perfect parry: how to make it feel distinct (audio, haptics, hit-stop, visual), and should the
   timing or rewards change now that it's a button press?
5. Hold-to-attack: is a separate attack-stance button a good idea in VR with physical swings? Pros,
   cons, alternatives (e.g. strikes always live but guard stance when the block button is held).
6. Left hand: dual blades vs a left-hand tool (grapple, firecracker-style stun, shield-bash, etc.).
   Which fits a parry-first VR duel and is useful every fight, not just situationally?
7. Anything in the current numbers that looks wrong for VR (windups, windows, i-frames, cooldowns).
