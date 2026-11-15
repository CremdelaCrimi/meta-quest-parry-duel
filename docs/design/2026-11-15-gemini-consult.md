# Gemini consult: spacing, reach, dodge, parry, left hand (2026-11-15)

Briefing sent: `docs/design/2026-11-15-gemini-briefing.md` plus the Lies of P reference
(`combat-references/`). There is no Sekiro reference file in the project; Gemini used its own
knowledge of Sekiro. Chat: Gemini Pro, "VR Sword-Parry UI and Mechanics".

## Why the enemy floats back, and why strikes don't land (from the code)

- `src/render/duelSpace.ts`: the duel frame re-centres on your head with `FOLLOW_TAU = 0.8 s`, and
  the enemy sits at a fixed `ENEMY_DIST = 1.85 m` in that frame. Step in and he slides back to
  1.85 m within about a second. That's the float.
- His hit capsule (radius 0.27 m) starts about 1.58 m from your head. Arm about 0.55 m plus katana
  0.88 m barely reaches it at full stretch; the wakizashi (0.60 m) can't. He only comes into range
  during his 0.5 m attack lunge.
- A swing that falls short does nothing visible, so "too far", "too slow" (under 1.8 m/s) and
  "deflected" all look the same unless he deflects it.
- Dodges: i-frames last 320 ms from the moment a dodge starts, so a dodge more than 320 ms before
  the strike runs out. A lean only counts if your head crosses 0.2 m sideways faster than 0.6 m/s
  relative to the slowly re-centring frame. The only feedback is a soft sound, then DODGED or a hit.

## Gemini's answers (round 1, summarized)

1. **Spacing: remove the smooth re-centring.** Lock the duel centre; give the enemy discrete footwork
   instead of a rubber band. Idle/pacing distance 1.8 m; he steps or lunges to 1.3 m to attack
   (inside arm + katana reach). If you step in while he's idle, he holds ground and blocks, then
   dashes back 1.0 m to reset after the exchange.
2. **Reach: add a "whiff".** A swing over 1.8 m/s that hits nothing plays a sharp whoosh and a white
   wind-trail arc ("fast enough, but too far"). Don't stretch hitboxes (breaks proprioception).
   On a posture break he stumbles 0.4 m forward so even the wakizashi can land the finisher.
3. **Dodge: a VR mikiri / perfect dodge.** i-frames 320 → 250 ms. A distinct peril chime 400 ms
   before a red attack lands. Perfect dodge window: the last 150 ms before impact; reward with a
   150 ms time-slow, a loud clash and 30 posture damage to him.
4. **Perfect parry with a button:** the press is faster than moving the sword, so tighten it:
   120 → 90 ms early. Hit-stop 70 → 120 ms; haptics 100 ms at full; a red/gold spark burst that
   lasts 300 ms.
5. **Hold-to-attack: don't.** A stance button breaks the 1:1 physical swing and adds load. Keep
   strikes velocity + collision based.
6. **Left hand: a grapple, not dual blades.** Dual blades without resistance turn into wrist
   "drum-rolls". Left trigger fires a wire; on an idle or staggered enemy it yanks him 0.5 m toward
   you, off balance. 8 s cooldown.
7. **Numbers:** spam lockout 450 → 350 ms (hands micro-jitter in VR); stagger 1.6 → 2.5 s (time to
   step in for the finisher); wakizashi damage ×0.75 → ×0.85.

Gemini's top 5: (1) lock the frame + discrete footwork with a 1.3 m attack lunge; (2) VR mikiri:
150 ms perfect dodge with time-slow and posture punish; (3) whiff feedback; (4) perfect window 90 ms
and hit-stop 120 ms; (5) left-hand grapple to pull him into range.

## Round 2 (follow-ups)

1. **Left hand: a short-cooldown grapple that pulls you in** (picked over the idle-only grapple and an
   off-hand parry dagger, which "creates input confusion and encourages flailing"). Left trigger
   fires a wire (3.0 m range). On a hit it pulls *you* 0.5 m toward him at 3.0 m/s. During his attack
   it's an emergency gap-closer; on an idle or deflecting enemy it rips his guard open (15 posture).
   Cost: 3.0 s cooldown and 20 of your own posture. A miss, or firing into a red attack, gives you a
   600 ms lockout (no swings, no perfects).
2. **Perfect window: keep 120 early / 40 late as the default.** (This reverses round 1.) Because a
   perfect also needs the sword in place, square and steady, 90 ms on top would be too punishing;
   put 90 ms on a hard preset for veterans.
3. **Enemy footwork state machine** (with the frame no longer re-centring):

   | State | Trigger | Action |
   |---|---|---|
   | Pacing | default | holds 1.85 m; mirrors your sidesteps at 1.0 m/s |
   | Reactive backstep | you step inside 1.3 m while he's idle | after 0.4 s, leaps back 0.6 m at 2.5 m/s; 1.5 s cooldown |
   | Reactive advance | you retreat past 2.3 m while he's idle | walks in at 1.5 m/s back to 1.85 m |
   | Attack lunge | end of windup, you're over 1.4 m away | lunges 0.5 m at 3.5 m/s as the strike goes live |
   | Dash in during his windup | gap under 1.0 m at the end of the windup | lunge 0 (swings in place, no clipping) |
   | Dash in during his recovery | you're inside during 450-900 ms recovery | he stays put and takes hits, then backsteps 0.8 m at 4.0 m/s when recovery ends |

## My read (Claude)

- **Agree, build first:** stop the re-centring and add the footwork table above; it fixes both the float
  and the reach complaint, and the 0.4 s before his backstep becomes the "step in and strike" window.
  Add the whiff (whoosh + white arc) so a miss is never silent. Stumble 0.4 m forward on posture break.
- **Agree:** perfect dodge as the last 150 ms before a red attack lands, with a distinct cue and a
  posture reward, plus a dodge tick on the swing timeline (already there in training) that says
  "too early" when the i-frames ran out.
- **Agree:** no hold-to-attack button. The block button already gives a clear "guard stance"; strikes
  stay physical. If stances still feel muddy, a cheaper fix is to make strikes not count while the
  block button is held.
- **Parry feel:** hit-stop 70 → 100-120 ms and a stronger burst are cheap to try; leave the window
  at 120/40 by default (round 2) and test 90 ms only on the Sekiro-like preset.
- **Left hand:** the grapple that pulls *you* in is the best "every exchange" option, and it works
  with the footwork (closes the 1.85 m gap on demand). Try it before dual blades. It needs the
  footwork change first, since today the frame would just slide him back again.
- **Numbers to change now:** lockout 450 → 350 ms, stagger 1.6 → 2.5 s, wakizashi ×0.85. Hold the
  i-frame cut (320 → 250 ms) until the perfect dodge exists, so dodging doesn't just get harder.
