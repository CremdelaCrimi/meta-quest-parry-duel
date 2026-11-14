# combat-references

Design reference notes for building action combat in my own games. Reference only.

## Files

- `lies-of-p-combat-reference.md`: Perfect Guard window, attack types and tells, animation order (wind-up, release, hit, recovery), stagger and weapon rules, and starting values in seconds.

## How to use these (for Claude Code)

- Treat these as design references. Implement the rules in original code with my own names, art and animations. Do not copy assets, names or text from the source games.
- Store all timings in seconds, not frames, so behavior is frame-rate independent.
- Anything marked "my suggestion" or "my starting guess" is unmeasured and should be tuned by feel.
- Hitbox sizes, per-attack frame data and hit-stop durations are not documented. The open questions are listed at the end of each reference.

## Suggested line for a project CLAUDE.md

Combat design references live in ./combat-references/. Read README.md there first, and follow its rules.
