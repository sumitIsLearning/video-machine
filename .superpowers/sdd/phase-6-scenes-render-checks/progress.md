# Phase 6 — Scenes, render, checks (ledger)

Plan: docs/superpowers/plans/phase-6-scenes-render-checks.md (10 tasks, user rulings U1–U2, rulings R1–R13). Branch phase-6-scenes-render-checks from master 0cda00a.
Spec: docs/BLUEPRINT.md (pre-step: 2.4 layout, 2.5 contactSheet, 2.7 rows, 2.8 seek_safe, Phase 6 text-fit bullet).
Probes (2026-10-14, hf 0.8.143): nested comps via data-composition-src work; lint scans sub-comps only under compositions/; check does not flag text in IG zones; draft render muxes root <audio>; ffmpeg tblend YMAX: still = 0, threshold 8; Playwright + runtime iife (npm pack) + window.__player.seek gives exact boxes.

## Tasks
Status: user OK 2026-10-16. Pre-step done `0c809ac`.
- T1 scene times `9d5efc1` — PASS spec, APPROVE review; orchestrator added the start-order test (brief's test hit the anchor error).
- T2 text fit + VM `fed5d3f` — 1 fix round (Sonnet: 226 KB bundle via frameOf → `fitPx` moved to dep-free `lib/core/fit-px.ts`; empty `at` phrase; `</script>`-safe JSON; nth test; type import). PASS.
- T3 assemble project `d94a95e` — PASS spec, APPROVE review, no fix round. Accepted builder deviations: hosts carry `data-composition-src`; temp dir also cleared before write; `VM.scene` regex allows either quote/whitespace; `data-track-index` on audio + hosts. Skipped 🔵: `<template`/`data-composition-id` checks are case-sensitive (HF lint covers it).
- T4 hyperframes render adapter `729bc58` — PASS spec; review 🟠 check() used the 120 s lint timeout → 1 Haiku fix round (CHECK_TIMEOUT_MS 10 min + test; ToolError detail uses stderr || stdout); fix verified by orchestrator grep, no second spec agent. Accepted deviations: `still(only)` and any non-empty `passes` → UnsupportedError; ToolError on frame-count mismatch / missing contact-sheet.jpg; absolute return paths; selector without time dropped.
- T5 checks layout/captions/duration `99ca019` — PASS spec, APPROVE review, no fix round. Accepted: private `report` helper in layout.ts; captions details "<n> words checked" / "<k> word(s) missing from the caption". Skipped 🔵: a word normalising to "" can match an empty token in `shown`.
- T6 checks motion/assets/stability `118b174` — PASS spec, APPROVE review, no fix round. Accepted: beats check with empty diffs fails (not skip); round3/verdict/skip one-liners duplicated in motion.ts + stability.ts. Skipped 🔵: file-name substring match can false-positive (nav.mp4 in subnav.mp4); path split assumes `/`.
- Next: Task 7.
