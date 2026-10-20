# Handoff

## Now (2026-10-20): Phase 8 merged to master `82a849d`; `phase-7` deleted; `.env` git-ignored `e5d4ecf`

- Plan: `docs/superpowers/plans/phase-8-avatar.md` (T1–T10 + deferred T11 local adapter; U1–U4, R1–R10).
  Ledger: `.superpowers/sdd/phase-8-avatar/progress.md`. Plan `75a1df9`, blueprint pre-step `7bf6f7d`.
- T1 `291529e` … T10 `2466487`; phase-review fixes `6fffd6e` (Opus review → fix brief `briefs/fix-phase.md` →
  spec PASS → Opus re-review APPROVE). phase8.ts 7 PASS + 1 SKIP (HeyGen live, needs key + paid OK).
- Open (user direction 2026-10-20): paid services use the end user's own keys. Plugin `userConfig` (sensitive →
  secure store) reaches only MCP servers/hooks, not Bash-run CLIs (skills run `bun lib/*/cli.ts` via Bash). Using it
  means a plugin MCP server for paid steps; user to decide. Until then: workspace `.env`. Branch `phase-8` kept.
- R14 (creator 2026-10-19): run-level `spend.json`; gates pass when spent+estimate ≤ budget or estimate ≤ approved.
- Deferred: HeyGen Idempotency-Key reused with a new `audio_asset_id` body on re-run — check HeyGen rules (fails
  safe: 4xx, not double billing). 🔵 tests/phase8.ts:150 `procs.delete` not in finally (harmless).
- phase1 check 6 now passes; check 4 still fails (root CLAUDE.md strict-validate, deferred).
- R12/R13 (T10): test-only `callWithEnv` for the key; check 5 expects HyperFrames `text_occluded` build refusal.
- T11 waits on the creator's GPU test on the reference laptop (procedure in the plan's Task 11).
- HeyGen v1/v2 API is removed 2026-10-31; the plan targets v3.
- Phase 7 merged `4db4a03`. Branch `phase-7` kept (delete not yet asked); not pushed.
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
