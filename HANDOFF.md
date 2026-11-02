# Handoff

## Now (2026-11-02): SHIP DAY — reel-only v0.1.0 (user ruling); branch `phase-9` (T1–T7 done)

- Scope (user, 2026-11-02): finish Phase 9 T5–T7, lean Phase 11 (README, LICENSE MIT, manifest), merge to master,
  push, tag v0.1.0. Phase 10 (long-form) and T8 proof reel are post-ship. Repo stays PRIVATE; no icon yet (needs a
  square 512–2048 px PNG before any directory submission). No /clear stops today.
- T5 ca8ca45, T6 27ef037, T7 8d8329e done; `tests/phase9.ts` 9/9 on real tools. T7 caught a lib bug (seam label chip
  sampled as text → `layout.safe_area` blocking on stack+label); fixed with `data-vm-chrome`.
- Ship files committed: LICENSE (MIT), README.md, .claude-plugin/plugin.json (license/repo/keywords). `claude plugin
  validate .` passes (icon warning only). Remote master is an ancestor of local master (fast-forward push).
- Then: whole-branch Opus review (running) → one fix round → ask before merge → push master → tag v0.1.0.
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
