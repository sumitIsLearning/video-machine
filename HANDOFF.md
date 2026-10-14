# Handoff

## Now (2026-10-14, late): Phase 5 (voice and timing) built; phase-end review done on branch `phase-5-voice-timing`

- Phase 4 merged into master locally (fast-forward to 7256ecb, no push; user OK 2026-10-14).
- Plan: `docs/superpowers/plans/phase-5-voice-timing.md` (6 tasks, rulings R1–R9). Blueprint 2.5/2.7 updated for R1, R2,
  R5. Ledger: `.superpowers/sdd/phase-5-voice-timing/progress.md`.
- Done: all 6 tasks. 1 `cbb585d` timing/cost, 2 `7e1494e` aligner, 3 `c354ab8` voice adapters, 4 `1e656ae`
  `lib/voice` CLI, 5 `faaa965` shipped skill `voice` + make-video routes M9/M10, 6 `703f43d` `tests/phase5.ts`
  (5/5 PASS, ~25 s; rulings R10 stand-in M7/M8 markers for `where`, R11 dropped the video-testing check).
- Phase-end opus review: CHANGES REQUESTED (🟠 spoken map applied globally vs plain uses); fixed in `ce2f764`,
  spec PASS, check 644 pass, phase5 5/5. Next: user OK to merge into master (fast-forward, no push).
- To raise with the user: `tests/phase0.ts` fails on this Mac on the base too — check 1 80 ms at "shapes," (limit
  10 ms), check 2 looks for `C:/Work-data/video-testing` (Windows path).
- Test run for later: `runs/2026-10-14-firecrawl-in-20-seconds-paste/` is at M6 (research, logged-in replay, captures,
  assets panel).
- Still open from Phase 3: live `claude --plugin-dir . -p "continue my video"` check (by hand); push (not yet asked).

Older sections: `docs/handoff-archive.md`.
