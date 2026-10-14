# Handoff

## Now (2026-10-14, late): Phase 4 (write and design) in progress on branch `phase-4-write-design`

- User asked to build the rest of the pipeline (Phases 4–7) and then test it on the Firecrawl run. User rulings
  2026-10-14: gsap 3.14.2 as an npm dependency; work on a branch, no push; keep `/clear` every 2 tasks.
- Plan: `docs/superpowers/plans/phase-4-write-design.md` (8 tasks, rulings R1–R11). Blueprint updated for R1 (gsap)
  and R2 (`lib/script`, `lib/look`, `lib/storyboard`). Dev agent `.claude/agents/visual-reviewer.md` added (R10).
- Done: Task 1 `8b054db` (CheckResult, direction/board ids, `lib/core/estimate.ts`, gsap), Task 2 `d15f2ea`
  (`lib/checks/` facts-cited, directions-differ, coverage), Task 3 `c55c17b` (HyperFrames composition folders), Task 4
  `1f481ef` (`lib/script/`), Task 5 `e718008` (`lib/look/`), Task 6 f59216b (`lib/storyboard/`, shared `renderBoard`). Next: Task 7. Ledger:
  `.superpowers/sdd/phase-4-write-design/progress.md`.
- Test run for later: `runs/2026-10-14-firecrawl-in-20-seconds-paste/` is at M6. It has research.md (14 facts), a
  logged-in replay of the Firecrawl playground scraping superteamai.com (10 clips; steps hand-written, no nav video),
  page captures of firecrawl.dev and superteamai.com, and the assets panel. This also covered the R11 manual logged-in
  check from Phase 3 (login → replay worked; lessons: sidebar click cleared the format, animated placeholder needs a
  partial target, an NPS popup needed one Skip).
- Probes 2026-10-14 (HF 0.8.143): `snapshot --no-browser-gpu` works (~9 s / 3 frames); assets above the composition
  folder fail lint; lint does not flag CDN scripts.
- Still open from Phase 3: live `claude --plugin-dir . -p "continue my video"` check (by hand); push (not yet asked).

Older sections: `docs/handoff-archive.md`.
