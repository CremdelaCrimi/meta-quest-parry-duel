# Lies of P: Combat Reference (Attacks, Animation, Parry)

Nov 13, 2026

## Summary

Lies of P's defense centers on the Perfect Guard: a window of 0.155 seconds (about 9.3 frames at 60 fps) that takes no damage, builds the enemy's stagger bar and chips their weapon durability. Red-glow Fury attacks cannot be blocked or dodged, so they need a Perfect Guard or enough distance.

Every number below comes from community testing and mod documentation, not official Neowiz data. Hitbox dimensions are not publicly documented anywhere I could find, so section 4 gives qualitative behavior plus clearly labeled design guidance. Sources are listed at the end with a confidence level for each claim.

## Perfect Guard and guard timing

The Perfect Guard window is 0.155 seconds, and it is defined in time rather than frames, so it stays the same at any frame rate (9.3 frames at 60 fps). A [mod page documenting the game data](https://nexusmods.com/liesofp/mods/161) gives this value and notes that frame counts for FromSoftware-style games are often quoted at 30 fps, which makes cross-game comparisons confusing.

| Rule | Value | Confidence |
| --- | --- | --- |
| Perfect Guard window | 0.155 s (9.3 frames at 60 fps) | Good: stated from game data |
| Lock after a missed attempt | 30 frames in vanilla; the page does not say at what frame rate (about 0.5 s if 60 fps) | Medium: one source |
| Pressing guard too early | Becomes a normal Guard instead of leaving you open, except against Fury attacks | Medium: [Steam discussion](https://steamcommunity.com/app/1627720/discussions/0/596272651478037391) |
| Holding vs tapping | The window is static and not extended by holding; players disagree on whether holding helps | Contested |
| Normal Guard | Reduced damage, stamina cost, and the blocked damage becomes recoverable Guard Regain HP | Good |
| Perfect Guard result | No health damage, red sparks, large stagger and weapon-durability damage to the enemy | Good; stamina cost is disputed |

Holding guard is a safety net, not extra window. A player on the Steam thread reports a missed tap is a certain hit, while a missed hold is a hit about 30% of the time, which fits the early-press-becomes-block behavior ([Steam thread](https://steamcommunity.com/app/1627720/discussions/0/3887227031493570429)). Tapping repeatedly during a wind-up can make the window effectively disappear, except against multi-hit moves; this is player-reported, not measured.

Guard Regain: [the share of damage your weapon does not absorb](https://godisageek.com/2023/09/lies-of-p-regain-mechanic-explained/) becomes HP you can win back by hitting the enemy before it fades. Perfect Guards create no Guard Regain because you take no health damage.

Sources disagree on whether a Perfect Guard costs stamina: [Fextralife](https://liesofp.wiki.fextralife.com/New+Player+Help) and God is a Geek say it costs stamina but no health, while one guide says it costs none. Treat it as a small cost until tested.

## Attack types and tells

Most enemy attacks can be guarded or dodged, and the one exception is the red-glow Fury attack, which only a Perfect Guard or distance answers.

| Attack type | How you recognize it | Correct answer |
| --- | --- | --- |
| Normal strike | No glow; wind-up pose, then swing | Perfect Guard for stagger, plain Guard for safety, or dodge |
| Delayed strike | Wind-up that holds, then releases later than the pose suggests | Wait for the release; pressing at the start of the wind-up fails |
| Multi-hit combo | Chains of 3 to 5 hits on bosses | Perfect Guard each hit, or hold and re-press between hits |
| Fury attack | Enemy glows red before the strike | Perfect Guard, or be out of range |

Fury attacks come from [bosses, mini-bosses and elite enemies only](https://segmentnext.com/lies-of-p-red-attack). They cannot be blocked, and [dodge invincibility frames do not protect against them](https://Techraptor.net/gaming/guides/lies-of-p-starter-hub); one guide mentions an amulet that adds i-frames against them. The gap between the glow and the strike is short, but no source gives an exact time.

The tell to read is the attacker's body, not the weapon. Guides recommend watching the [shoulder and limb motion](https://www.ginx.tv/en/guard-system) because the [timing between wind-up and strike varies a lot](https://jmargaris.substack.com/p/dodging-in-the-lies-of-p-demo-kinda), and early enemies share similar overhead wind-up poses for light and heavy swings. The designer-side takeaway is that the same pose can lead to a fast or delayed hit, which is what forces players to react to the release instead of memorizing a rhythm.

When dodging, guides advise going to the side or into the attack, because backing straight away tends to get you hit (guide advice, not measured). Without lock-on you get a roll, and with lock-on a shorter hop, according to [the same dodge comparison](https://jmargaris.substack.com/p/dodging-in-the-lies-of-p-demo-kinda).

## Animation structure, parry timing and hitboxes

You parry in the 0.155 seconds just before a swing connects, not when the wind-up starts. No per-attack frame data or hitbox dimensions for Lies of P are published, so the structure below is what players and guides describe, and the last list is design guidance rather than game data.

What an attack looks like, in order:

1. **Wind-up (the tell).** The shoulder and limb move first, and a Fury attack glows red here. No damage is possible yet.
2. **Optional hold.** Delayed attacks pause the pose. Pressing guard now wastes the window and risks the lock after a missed attempt.
3. **Release.** The weapon moves fast toward you. Players say to press guard right before the hit lands, and the [red sparks confirm a Perfect Guard](https://primagames.com/tips/lies-of-p-how-to-do-a-perfect-guard).
4. **Active hitbox.** Damage happens when the weapon connects. Fury attacks ignore dodge invulnerability here.
5. **Recovery.** The enemy is open. Each Perfect Guard builds their stagger bar and wears down their weapon.

What is documented about hitboxes:

- Hit detection follows the weapon. A [broken enemy weapon has a much smaller attack range](https://www.gameinformer.com/tips/2023/09/19/lies-of-p-20-soulslike-tips-tricks-secrets-and-more-to-help-pinocchio-survive-krat), and a [broken player weapon loses power and range](https://blog.hyperx.com/article/13428/lies-of-p-tips-and-tricks-for-beginners).
- Dodging forward through a swing or to the side avoids it better than backing up, according to community guides.
- Hitbox sizes, active frames per attack and exact hit timing: not documented. Measuring them needs your own 60 fps footage.

Design guidance for your game (my suggestions, not measured values):

- Sweep a hit shape along the weapon's arc during the release only, so the hit happens at the end of a readable motion.
- Give every attack a distinct release cue such as a sound, a glint or a limb snap, because the pose alone can be ambiguous.
- Let fast and delayed versions share one wind-up pose so players must react to the release.
- Make Fury attacks bypass dodge invulnerability and carry a clear glow, so the rule is learnable.
- Shrink the hit shape when a weapon breaks, since Lies of P ties reach to weapon state.

## Feedback, stagger and weapon rules

A Perfect Guard is rewarded three ways at once: no damage, stagger on the enemy and wear on their weapon. Hit-stop and freeze-frame durations are not documented in any source I found, so tune those by feel.

| Mechanic | How it works | Source |
| --- | --- | --- |
| Perfect Guard feedback | Red sparks from your weapon, plus [a brief red glow on the enemy's weapon](https://www.ludo.guide/guide/lies-of-p/general-suggestions) | Guides |
| Stagger | A hidden bar on the enemy fills faster from Perfect Guards than from normal damage; [charged attacks also add to it](https://www.ginx.tv/en/?p=53712) | Guides |
| Fatal attack | [Fill the stagger bar until the enemy's health bar flashes white, then land a charged attack](https://twinfinite.net/guides/how-to-stagger-enemies-for-fatal-strikes-in-lies-of-p/); the follow-up is the highest single hit in the game | Guides |
| Enemy weapon wear | [Perfect Guards chip enemy weapon durability and can break the weapon](https://www.gameinformer.com/tips/2023/09/19/lies-of-p-20-soulslike-tips-tricks-secrets-and-more-to-help-pinocchio-survive-krat); [bosses are immune to the break](https://segmentnext.com/lies-of-p-red-attack) | Guides |
| Your weapon wear | [Durability drops as you attack and guard; at zero the weapon breaks and loses power and range](https://blog.hyperx.com/article/13428/lies-of-p-tips-and-tricks-for-beginners) | Guide |
| Stamina | Guarding costs stamina and fills the Guard Regain pool; Perfect Guard avoids the health loss | Guides, disputed on stamina |

The loop this creates is: read the tell, Perfect Guard to build stagger, hit while they are open, then convert a staggered enemy into a fatal attack. Missing is expensive on Fury attacks, which gives the system its risk and reward.

## Implementation notes (values in seconds)

Store every timing in seconds and compare timestamps, so the parry feels the same at 30, 60 or 144 fps. A parry succeeds when the guard press lands in the window just before the attack's impact moment.

| Setting | Value | Basis |
| --- | --- | --- |
| Parry window before impact | 0.155 s | Sourced: Lies of P vanilla |
| Easier parry window | 0.2 s or 0.25 s | Sourced: values used by the two mod variants, a useful accessibility range |
| Lock after a missed parry | About 0.35 to 0.5 s | Sourced as 21 to 30 frames; frame rate not stated, so this assumes 60 fps |
| Early press | Falls back to a normal guard with reduced damage | Observed behavior reported by players |
| Hit-stop on a parry | Start around 0.05 to 0.10 s | My starting guess, no source; tune by feel |
| Fury attacks | Ignore dodge i-frames, show a red glow | Sourced behavior, your thresholds |

Suggested rules to implement:

1. Each attack animation has one impact event; the parry window is measured backward from that event.
2. A press before the window is open becomes a normal guard if the button stays held.
3. A missed press starts the lock, during which a new parry press is ignored.
4. A parry gives no health damage, builds the enemy's stagger bar and reduces their weapon durability.
5. A full stagger bar enables one high-damage finisher.

To get real per-attack timings later, record fights at 60 fps and count frames between the wind-up start, release and impact for each move.

## Sources and confidence

Three pages were opened in full and the rest were read as search results only, so treat those as lower confidence. None of this is official Neowiz or Round8 data.

| Source | Used for | Opened in full |
| --- | --- | --- |
| [Nexus Mods: Lies of P Perfect Guard mod](https://nexusmods.com/liesofp/mods/161) | 0.155 s window, lock frames, hold vs tap | Yes |
| [Steam discussion: holding block and parrying](https://steamcommunity.com/app/1627720/discussions/0/3887227031493570429) | Hold vs tap, early-press behavior (player reports) | Yes |
| [SegmentNext: red attacks](https://segmentnext.com/lies-of-p-red-attack) | Fury attack rules | Yes |
| [Game Informer tips](https://www.gameinformer.com/tips/2023/09/19/lies-of-p-20-soulslike-tips-tricks-secrets-and-more-to-help-pinocchio-survive-krat) | Stagger, weapon break | Search result only |
| [Fextralife wiki](https://liesofp.wiki.fextralife.com/New+Player+Help) and [God is a Geek](https://godisageek.com/2023/09/lies-of-p-regain-mechanic-explained/) | Guard Regain, stamina cost | Search result only |
| [GINX guard guide](https://www.ginx.tv/en/guard-system), [Techraptor](https://Techraptor.net/gaming/guides/lies-of-p-starter-hub), [Twinfinite](https://twinfinite.net/guides/how-to-stagger-enemies-for-fatal-strikes-in-lies-of-p/) | Tells, Fury rule, fatal attacks | Search result only |
| [Substack dodge analysis](https://jmargaris.substack.com/p/dodging-in-the-lies-of-p-demo-kinda) | Variable wind-up timing, roll vs hop | Search result only |

Open questions: the stamina cost of a Perfect Guard, the exact frame rate behind the lock figure, enemy hitbox sizes and hit-stop duration.
