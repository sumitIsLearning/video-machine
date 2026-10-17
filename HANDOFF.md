# Handoff

## Now (2026-10-17): Phase 7 plan written, waiting for the user's OK

- Plan: `docs/superpowers/plans/phase-7-revise-sound-deliver.md` (pre-step + 12 tasks; rulings U1, U2, R1–R12).
  User rulings 2026-10-17: U1 AE package = per-scene ProRes 4444 clips (layer passes → Phase 10); U2 Phase 7 adds
  contracts.valid only of the deferred checks (brief.applied + judges → Phase 10).
- Probed 2026-10-17: ffmpeg 9.0.2 has sidechaincompress/loudnorm/ebur128 but no libass (no ffmpeg-burned captions);
  two-pass loudnorm → −13.9 LUFS after AAC mux; ProRes 4444 `-ss … -frames:v n -c copy` cuts are frame-exact.
- Next after OK: orchestrator pre-step (blueprint edits), branch `phase-7`, then Task 1.
- Phase 6 merged `be5e27c` (724 tests).
- Open for user (deferred 2026-10-16): strict plugin validate fails on root CLAUDE.md warning (phase1 check 4); follow-up filter `reference_only` from `times`.
- Note: BLUEPRINT 2.1 diagram line still says `index.html, scenes/*.html` (pre-step did not list it).
- Test run for later: `runs/2026-10-14-firecrawl-in-20-seconds-paste/` is at M6.
- Still open: live `claude --plugin-dir . -p "continue my video"` check (by hand, Phase 3); push (not yet asked);
  delete merged branch `phase0-test-fix` (not yet asked).

Older sections: `docs/handoff-archive.md`.
