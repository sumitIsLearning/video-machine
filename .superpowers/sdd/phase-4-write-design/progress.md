# SDD ledger — plan: docs/superpowers/plans/phase-4-write-design.md
Spec: docs/BLUEPRINT.md (R1 gsap + R2 folders applied). Branch phase-4-write-design from master 3babf5e.
User rulings 2026-10-14: gsap as npm dependency; branch, no push; /clear every 2 tasks.
Probes (2026-10-14, HF 0.8.143): snapshot --no-browser-gpu ok (~9 s / 3 frames); assets above project root fail lint; lint ignores CDN scripts.

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 -> T2..T6 | CheckResultSchema, DirectionId/BoardId, estimate() | consistent |
| T3 -> T5, T6 | writeComposition/lint/snapshot; T6 adds renderableAssets + renderBoard and refactors T5 | stated in T6 |
| T4 research urls | parseResearch(md).urls also picks URLs inside quotes | harmless (more URLs allowed) |
| T8 | real HyperFrames, ~2 min | stated |

## Tasks
Task 1: done 8b054db (haiku build, spec PASS, code APPROVE; 1 test type annotation added)
Task 2: done d15f2ea (haiku build, spec PASS after accepting 2 strict-tsc test edits, code APPROVE)
Ruling: plan test code that indexes arrays (x[0].y) may get `?.`/map rewrites for noUncheckedIndexedAccess — reviewers accept them — cost if wrong: none
Task 3: done c55c17b (haiku build, spec PASS, code CHANGES: WEB_LOAD too narrow 🟠 + 4 small; haiku fix; re-spec FAIL overruled — it read 'undefined' as compRel, but it was relInside's return)
Ruling: WEB_LOAD also refuses web <a href> in boards — reels have no links — cost if wrong: a board with a web link is refused
Task 4: done 1f481ef (haiku build, spec PASS, code APPROVE; orchestrator added fatal UTF-8 decode + test directly, 3 lines, cheaper than a builder)
Task 5: done e718008 (haiku build, spec PASS, code CHANGES: pickLook half-write if LOOK.md missing 🟠 — orchestrator added the existsSync guard, 1 line; 🔵 --assets eats next flag, skipped)
Task 6: done f59216b (haiku build, spec PASS, code APPROVE w/ 🟠 unchecked stdin plan shape — orchestrator added scenes shape guard + test; 🔵 runFileOf double call, skipped)
Task 7: done 21a0653 (haiku build, spec PASS w/ 2 minor misses, code CHANGES: 2 🟠 wording (storyboard board has no --assets; look field shapes) + 3 small; haiku fix; orchestrator grep-verified the 7 items instead of a re-spec — docs only)
Ruling: make-video loops until M9 (not M6) so it continues through storyboard — cost if wrong: none
Ruling: skill says beat `nth` 0 = first occurrence (schema min 0; no resolver yet) — cost if wrong: one-word skill edit when the resolver lands
Next: Task 8 (acceptance tests/phase4.ts, real HyperFrames ~2 min). Brief: python3 .claude/tools/brief.py docs/superpowers/plans/phase-4-write-design.md 8, then fill Do-not-touch + Context pack.
Unstaged noise: .claude/tools/brief.py reformatted by check.sh's formatter (not committed).
