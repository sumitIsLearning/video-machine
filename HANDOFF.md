# Handoff

## Now (2026-10-18): Phase 8 on branch `phase-8`, T1–T6 committed

- Plan: `docs/superpowers/plans/phase-8-avatar.md` (T1–T10 + deferred T11 local adapter; U1–U4, R1–R10).
  Ledger: `.superpowers/sdd/phase-8-avatar/progress.md`. Plan `75a1df9`, blueprint pre-step `7bf6f7d`.
- Plan OK'd ("continue" 2026-10-18). T1 `291529e`, T2 `99d5f8a`, T3 `a9b42fc`, T4 `644c883`, T5 `b87b1b8`, T6 `1975185`, T7 `5273d05`, T8 `96b6f79`. Next: T9.
- Follow-up (R11): `lib/avatar/make.ts` reads `HEYGEN_API_KEY` from `process.env`; move it into `loadConfig`.
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
