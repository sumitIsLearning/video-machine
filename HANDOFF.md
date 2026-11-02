# Handoff

## Now (2026-11-02): v0.1.0 released (reel-only), Phase 9 merged to master

- Phase 9b short commands (user ask 2026-11-02): user OK, building on branch `phase-9b`. T1–T2 done; next T3.
  Ledger: `.superpowers/sdd/phase-9b-short-commands/progress.md` (R7: one Sonnet review over T1–T4).
  Plan: `docs/superpowers/plans/phase-9b-short-commands.md` (T1–T4 plugin-builder, T5 lib-builder, T6–T7 orchestrator).
  Blueprint pre-step done (Part 5 Phase 9b, 2.1 tree), not committed yet. Plugin becomes `vm`: four menu commands
  `/vm:setup`, `/vm:new`, `/vm:status`, `/vm:feedback`; other skills hidden with `user-invocable: false`.

- Scope (user, 2026-11-02): reel-only v0.1.0. Phase 9 T1–T7 done; T8 proof reel and Phase 10 (long-form) are next.
  Repo is PRIVATE (user flips it public later). No listing icon yet: needs a square 512–2048 px PNG before any
  directory submission (the icon is set only once).
- Acceptance: tests/phase9.ts 9/9, tests/phase8.ts 7/8 (check 8 live HeyGen needs `VM_HEYGEN_PORTRAIT`; the
  workspace has the key + approve vars set, so it runs and fails instead of skipping). check.sh 863 pass, lint OK.
- Whole-branch Opus review fixed (214d33e): last stack span clamped to the voiceover + webm padded; assemble refuses
  a stack avatar made for an older plan; `stack` is reel only; mixed scenes refused at storyboard write.
- Deferred 🔵: seam chip contrast unchecked (white on `look.seam.color`); `esc` doesn't escape `'` in font family.
- Next: T8 proof reel with the creator (concept + presenter clip, or HeyGen: paid, ask), then plan Phase 10.
- Plan: `docs/superpowers/plans/phase-9-reel-layouts.md` (T1–T7 builders, T8 proof reel with the creator; R1–R8).
  Ledger: `.superpowers/sdd/phase-9-reel-layouts/progress.md`. Blueprint pre-step committed with the plan.
- New process (orchestrator.md "Visual first"): mock each phase in the project map artifact
  https://claude.ai/artifact/AP255iyusDtvB7fgY2iggp (source: session scratchpad `video-machine-map.html`; re-read
  the artifact before editing), get comments, then plan; show real frames at phase end.
- Open for T8: proof-reel concept, and presenter from the creator's own clip or HeyGen (paid, ask).
- Phase 8 merged `82a849d`; `phase-8` branch kept (delete not asked). Docs commit `7345321` went to master directly.
- Paid services use the end user's own keys; plugin `userConfig` only reaches MCP servers/hooks (see Phase 11).
- R14 (creator 2026-10-19): run-level `spend.json`; gates pass when spent+estimate ≤ budget or estimate ≤ approved.
- Deferred: HeyGen Idempotency-Key reused with a new `audio_asset_id` body on re-run — check HeyGen rules (fails
  safe: 4xx, not double billing). 🔵 tests/phase8.ts:150 `procs.delete` not in finally (harmless).
- phase1 check 6 now passes; check 4 still fails (root CLAUDE.md strict-validate, deferred).
- R12/R13 (T10): test-only `callWithEnv` for the key; check 5 expects HyperFrames `text_occluded` build refusal.
- T11 waits on the creator's GPU test on the reference laptop (procedure in the plan's Task 11).
- HeyGen v1/v2 API is removed 2026-10-31; the plan targets v3.
- Phase 7 merged `4db4a03`; branch deleted 2026-10-20. Nothing pushed yet.
- Check 7 (video-testing listing) skips on macOS: default path is `C:/Work-data/video-testing`; set `VM_VIDEO_TESTING`.
- Tooling note for user: check.sh shows the first 60 lint lines, and biome infos (6 pre-existing) can hide the real
  error; builders misread it in T6 and T10. Possible fix: `--diagnostic-level=warn` in package.json lint (asked, not done).
- Phase 6 merged `be5e27c`.
- Open for user (deferred 2026-10-16): strict plugin validate fails on root CLAUDE.md warning (phase1 check 4); follow-up filter `reference_only` from `times`.
- Note: BLUEPRINT 2.1 diagram line still says `index.html, scenes/*.html` (pre-step did not list it).
- Test run for later: `runs/2026-10-14-firecrawl-in-20-seconds-paste/` is at M6.
- Still open: live `claude --plugin-dir . -p "continue my video"` check (by hand, Phase 3); push (not yet asked);
  delete merged branch `phase0-test-fix` (not yet asked).

Older sections: `docs/handoff-archive.md`.
