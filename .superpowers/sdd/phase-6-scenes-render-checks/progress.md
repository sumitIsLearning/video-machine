# Phase 6 — Scenes, render, checks (ledger)

Plan: docs/superpowers/plans/phase-6-scenes-render-checks.md (10 tasks, user rulings U1–U2, rulings R1–R13). Branch phase-6-scenes-render-checks from master 0cda00a.
Spec: docs/BLUEPRINT.md (pre-step: 2.4 layout, 2.5 contactSheet, 2.7 rows, 2.8 seek_safe, Phase 6 text-fit bullet).
Probes (2026-10-14, hf 0.8.143): nested comps via data-composition-src work; lint scans sub-comps only under compositions/; check does not flag text in IG zones; draft render muxes root <audio>; ffmpeg tblend YMAX: still = 0, threshold 8; Playwright + runtime iife (npm pack) + window.__player.seek gives exact boxes.

## Tasks
Status: user OK 2026-10-16. Pre-step done `0c809ac`.
- T1 scene times `9d5efc1` — PASS spec, APPROVE review; orchestrator added the start-order test (brief's test hit the anchor error).
- T2 text fit + VM `fed5d3f` — 1 fix round (Sonnet: 226 KB bundle via frameOf → `fitPx` moved to dep-free `lib/core/fit-px.ts`; empty `at` phrase; `</script>`-safe JSON; nth test; type import). PASS.
- Next: Task 3 (assemble the project for one format).
