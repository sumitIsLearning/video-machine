# Handoff

## Now (2026-10-14, late): Phase 5 (voice and timing) in progress on branch `phase-5-voice-timing`

- Phase 4 merged into master locally (fast-forward to 7256ecb, no push; user OK 2026-10-14).
- Plan: `docs/superpowers/plans/phase-5-voice-timing.md` (6 tasks, rulings R1–R9). Blueprint 2.5/2.7 updated for R1, R2,
  R5. Ledger: `.superpowers/sdd/phase-5-voice-timing/progress.md`.
- Done: Task 1 `cbb585d` (`lib/core/timing.ts` lineOf/wordOf/timedLines, `lib/core/cost.ts` costGate, VoiceAdapter
  takes runDir), Task 2 `7e1494e` (aligner: line ids, word `conf`, lines below 0.6 fail by id), Task 3 `c354ab8` (voice adapters
  `hf-tts` with per-line cache + `supplied`), Task 4 `1e656ae` (`lib/voice` spoken map + synth/align CLI). Next:
  Task 5 (plugin-builder: skill `voice`), then 6 (`tests/phase5.ts`).
- To raise with the user: `tests/phase0.ts` fails on this Mac on the base too — check 1 80 ms at "shapes," (limit
  10 ms), check 2 looks for `C:/Work-data/video-testing` (Windows path).
- Test run for later: `runs/2026-10-14-firecrawl-in-20-seconds-paste/` is at M6 (research, logged-in replay, captures,
  assets panel).
- Still open from Phase 3: live `claude --plugin-dir . -p "continue my video"` check (by hand); push (not yet asked).

Older sections: `docs/handoff-archive.md`.
