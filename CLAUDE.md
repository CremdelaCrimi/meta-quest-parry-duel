Combat design references live in ./combat-references/. Read README.md there first, and follow its rules.

Exception to the references' "store all timings in seconds" rule: this project keeps timings in milliseconds (decided 2026-11-13). The sim is already frame-rate independent because it judges guards and strikes at sub-frame timestamps, and `*Ms` names are part of the URL tuning interface (`?perfectEarlyMs=150`). Convert reference values to ms (0.155 s → 155).
