# Handoff

## Now (2026-10-17): Phase 7 tasks all done on branch `phase-7`; next whole-branch review

- Plan: `docs/superpowers/plans/phase-7-revise-sound-deliver.md` (12 tasks; U1, U2, R1–R12). User OK 2026-10-17.
  Ledger: `.superpowers/sdd/phase-7-revise-sound-deliver/progress.md`.
- Done: pre-step `6ecd5b8`; T1 report move `9455b3b`; T2 media probes `e30a67a`; T4 SRT `26ceabc`; T3 checks `25c2fc8`; T5 render MOV `21549f0`; T6 AE package `ab9a8f7`; T7 sound mix `beadc04`; T8 review `fc0006a`; T9 scenes todo/gate `f71dfe1`; T10 deliver `b972680`; T11 skills `f3f048c`; T12 acceptance `5d7b61a` (`bun tests/phase7.ts` 7/7 PASS).
- Next: whole-branch `code-reviewer` (model opus) with the 12 brief paths + ledger rulings → one fix brief → scoped
  re-review → ask user to merge. Phase 7 summary must list rulings R1–R14.
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
