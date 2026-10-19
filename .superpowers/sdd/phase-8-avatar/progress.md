# Phase 8 — Avatar (ledger)

Plan: docs/superpowers/plans/phase-8-avatar.md (10 builder tasks + deferred T11, user rulings U1–U4, rulings R1–R10). Branch phase-8 from master 7dcfa29.
Spec: docs/BLUEPRINT.md (pre-step `7bf6f7d`: 2.3 HeyGen v3 + HF probe rows, 2.4 Brief.avatar + avatar/ layout, 2.5 AvatarAdapter, 2.7 presets + HeyGen rate, 2.8 safe_area, Part 4 skills/avatar, Phase 8 bullets).
Probes (2026-10-17, M1, HF 0.8.143): remove-background --json → VP9 ALPHA_MODE=1, no audio, CoreML 146 ms/frame; root <video> alpha over scenes in snapshot + render, media time t − data-start, seek-safe. HeyGen: v1/v2 removed 2026-10-31 → v3 (/v3/assets, /v3/videos, /v3/videos/{id}); price per minute not published.
User rulings 2026-10-17: U1 split (local adapter after GPU test on the laptop), U2 supplied clip synced to vo.wav, U3 director preset per segment, U4 HeyGen mocked + optional live.

## Tasks
Status: plan `75a1df9` OK'd by user ("continue" 2026-10-18).
- T1 done `291529e` (Haiku build, spec PASS, review APPROVE, no fix round).
- T2 done `99d5f8a` (Haiku build, spec PASS, review APPROVE; 2 🔵 skipped).
- T3 done `a9b42fc` (Haiku build, spec PASS, review 🟠 sh throws on timeout → no cleanup + 🔵 stale output; 1 fix round, PASS).
- T4 done `644c883` (Haiku build, spec PASS, review 🟠 unreadable clip said "runs 0s" + 🟡 no cleanup test; 2 fix rounds (2nd: test asserts message), PASS).
- T5 done `b87b1b8` (Haiku build, spec PASS, review 🟠 NaN Retry-After + 🟠 empty-key scrub + 🟡 non-JSON + 🔵 completed w/o url; 2 fix rounds (2nd: missing-header + cleanup tests), PASS; header-comment 🔵 skipped).
- T6 done `1975185` (Haiku build, spec PASS, review APPROVE; 1 🔵 rm-before-rename skipped). Ruling R11: make.ts reads HEYGEN_API_KEY from io.env ?? process.env as the plan briefed, though AGENT_PROMPT §6 says only config.ts reads env; follow-up: expose via loadConfig.
- T7 done `5273d05` (Haiku build, spec PASS, review APPROVE, no fix round; test placement typed Record<string, AvatarPreset> for TS2322).
- T8 done `96b6f79` (Haiku build, spec PASS, review APPROVE, no fix round; 🔵 timing read when segments exist, kept).
- T9 done `9423697` (Haiku build, spec FAIL on 1 mismatch: bottom allowed for text scenes; review 🟠 director paths bare → would write at workspace root; 1 fix round, verified by grep, no spec-reviewer dispatch; extras kept: .env wording per BLUEPRINT secrets row, Rules section like voice). Pre-existing: phase1 check 6 fails on make.ts env read (R11, from T6).
- T10 done (Haiku build: first run 5 PASS, 1 SKIP, 2 FAIL. Ruling R12: check 3/8 spawn the avatar CLI with Bun.spawn + explicit env (sh's toToolEnv strips *_KEY by design; test-only). Ruling R13: HyperFrames `layout text_occluded` (error) already refuses a build with text under the avatar; check 5 asserts that refusal instead of layout.safe_area (safe_area avatar boxes stay covered by T8 unit tests). 1 fix round → 7 PASS + 8 SKIP; spec PASS, review APPROVE (🔵 SIGTERM cleanup, 🔵 check 4 blocking count — deferred to phase review).
- Phase end: phase8.ts 7 PASS + 1 SKIP. Opus branch review CHANGES REQUESTED (🔴 R11 env; 🟠 cross-step spend; 🟠 check 4 ignores blocking; 🟡 SIGTERM; 🟠 avatar run builds without avatar/; 🔵 HeyGen idempotency body — deferred, unverified). Ruling R14 (creator's choice 2026-10-19): run-level spend.json ledger; gates check spent+estimate ≤ budget or estimate ≤ approved; never cleared by review. Fix brief `briefs/fix-phase.md`, Haiku builder dispatched on base 3d02229.
