# Base enemy: Tripo prompts

Tripo canvas: https://studio.tripo3d.ai/canvas/projects/01a1d7d8-8913-7a3a-bdae-146db455e5ef

One plain, rigged humanoid (Mixamo bone names) reused for every enemy: reskins swap the
texture/mesh, behaviour comes from `src/core/enemies.ts`, timing from the clip marks in
`public/enemy/enemy.json`. The sword is added in-engine on `mixamorigRightHand`, so the
model has empty hands.

## Character

> Make a reusable base enemy for a VR sword-duel game. Steps: generate a front-view reference
> image, turn it into a 3D model, then auto-rig it as a humanoid biped with Mixamo bone naming.
> Do not make any animations yet. Character: an original, generic humanoid swordsman about 1.8 m
> tall, athletic neutral proportions. Simple fitted dark grey cloth outfit with a wide dark red
> waist sash, plain wrist wraps, soft boots. Smooth featureless mask over the face, short hair.
> No hat, no cape, no loose or flowing cloth, nothing that sticks out, so it animates cleanly and
> can be reskinned later. Empty open hands (the sword is added in the game engine). A-pose, single
> mesh, game-ready low poly, simple clean texture.

## Animations

Shared rules for every clip (sent with each request):

> In place (no root movement). The character holds an imaginary two-handed sword, right hand on
> top. Starts and ends in the same guard stance: feet shoulder-width, knees soft, sword held in
> front at chest height pointing forward. Attacks: a clear wind-up pose that is held briefly, then
> a fast committed swing, a short follow-through, and a return to the guard stance. About 1.5 s.

Direction note: `dir` in the sim is the side of the **player** the blow lands on. The fighters
face each other, so a cut that lands on the player's left starts from the enemy's own right.

| Clip | Sim attack(s) | Prompt |
|---|---|---|
| `idle` | between attacks | Guard stance, breathing, small weight shifts, sword tip steady. Seamless loop, 2 s. |
| `slash_r2l` | slashLeft, quickLeft | Raise the sword back over the right shoulder, pause, then a fast diagonal cut from the character's right shoulder down across to its left hip. |
| `slash_l2r` | slashRight, quickRight | Pull the sword back past the left hip, pause, then a fast backhand diagonal cut from the character's left side up and across to its right. |
| `overhead` | slashHigh | Lift the sword straight overhead, pause, then a fast vertical downward cut to waist height. |
| `heavy_overhead` | heavyHigh | Slow big wind-up: sword raised high behind the head, body leaning back, long held pause, then a very powerful vertical downward cut with a forward step-lunge that stays in place, heavy follow-through. |
| `low_cut` | slashLow | Drop the sword low to the right, pause, then a fast rising cut at knee height sweeping from right to left. |
| `thrust` | thrust (perilous: lean to dodge) | Draw the sword back at the right hip with the tip aimed forward, crouch slightly, pause, then a fast straight lunge-stab forward at chest height, arms fully extended. |
| `head_sweep` | sweep (perilous: duck to dodge) | Wind the sword far back to the right at head height, torso twisted, pause, then a wide fast flat horizontal swing at head height all the way across to the left. |
| `stagger` | posture broken | Off balance after the guard is broken: stumble back a little in place, sword arm dropped low, head down, swaying, struggling to recover. Seamless loop. |
| `death` | killed | Collapse forward onto the knees, then fall to the side and lie still. Holds the last frame. |

After export, mark each attack clip's `releaseMs` (wind-up ends, fast motion starts) and
`impactMs` (blade at full extension) in `public/enemy/enemy.json`.
