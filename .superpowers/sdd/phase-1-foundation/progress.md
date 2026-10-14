# SDD ledger — plan: docs/superpowers/plans/phase-1-foundation.md

Spec: docs/BLUEPRINT.md v1.1 (e293e48). Branch phase-1-foundation from master a4d1e8b.
Project rule: builder prompt is only "Read docs/AGENT_PROMPT.md, then implement Task N from <plan>"; spec-reviewer then code-reviewer; orchestrator runs bun test + lint and commits (builders never commit).

Pre-step: complete (cfb68a1, git mv contracts/adapters -> lib/, .claude/skills removed)

## Pre-flight scan
| Pair / task | Shared | Finding |
|---|---|---|
| T1 vs T4, T7, T8 | tests/phase0.ts | sequential edits (T1 paths, T4 readJson import, T7 adapters, T8 canvas check); no conflict |
| T2 vs T6 | lib/contracts/types.test.ts | T2 creates, T6 appends + merges import; consistent |
| T4 vs T6 vs T7 | lib/contracts/types.ts | T4 removes readJson/writeJson, T6 schemas, T7 adapter interfaces only; disjoint regions |
| T4 -> T5 -> T7 -> T9 | core interfaces | T5 consumes ToolError/loadConfig/Env (T4); T7 consumes Sh (T5); T9 consumes HYPERFRAMES_VERSION/PLUGIN_ROOT (T4) + sh; matches Produces lines |
| T6 AssetRef.origin required | AssetRef users | no other task constructs AssetRef or Brief; no fixture JSON affected |
| T7 vs T8 | pdoom index.ts + index.test.ts | T8 consumes fakeDeps from T7 test file; consistent |
| T3 vs T9 | skill name | both say make-video after v1.1 edit |
| each task self-consistency | | T6 tests match its implementation notes (sources discriminated union probed on zod 4.6.5) |
Scan clean; no rulings needed.

Task 1: complete (commits cfb68a1..b038307, review clean)
Pre-step 2: complete (c3548fa, pdoom retired per user ruling 2026-10-10; plan/docs commit 2c59f06)
Task 1b: complete (commits c3548fa..91a0bd0, review clean)
Task 1b: minor (deferred): align.py:7 docstring and lib/contracts/types.ts:141 still say 'engine' (folder gone); comment sweep
Task 2: Ruling: Done-when says phase0 4/4; after pdoom retirement the correct count is 2/2 — plan text missed in the retirement edit — cost if wrong: none (Task 1b already set 2 checks)
Task 2: Ruling: per-file-ignores S102 for align.py (config, not inline noqa) and removal of the now-unused '# noqa: E402' accepted — ruff 0.16.10 defaults differ from the plan's probe; exec is deliberate — cost if wrong: one config line to move inline
Task 2: minor (deferred): ctc-onnx/index.ts UTF-8 comment moved after ');' by formatter — moot, Task 7 rewrites the spawn call
Task 2: fix round 1/5 (1 addressed, 0 open — phase0 NaN max-tracker)
Task 2: minor (deferred): phase0 alignment check compares only fixture syllables; extra syllables in aligned output are not compared (pre-existing)
Task 2: complete (commits 91a0bd0..3e15291, review clean after 1 fix round)
Task 3: Ruling: SKILL.md description quoted (plugin-builder rule) vs plan's unquoted — equivalent YAML — cost if wrong: none
Task 3: complete (commits 3e15291..38ce9d6, review clean)
Task 4: Ruling: toolEnv also drops any key matching /(_API_KEY|_TOKEN|_SECRET)$/i on top of SECRET_ENV — Review Focus 1 + BLUEPRINT 2.6 intent beats the plan's fixed list — cost if wrong: a tool that needs a token (e.g. NPM_TOKEN for a private registry) fails loudly; add an allowlist then
Task 4: Ruling: writeJson writes <file>.tmp then renameSync (atomic) beyond the plan's 'move only' — prevents the truncated file Review Focus 3 guards on read — cost if wrong: a stray .tmp after a crash
Task 4: fix round 1/5 (7 addressed, 0 open — secret pattern, test, BOM, message, atomic write, JSDoc, hoist)
Task 4: minor (deferred): json.ts writeJson leaves <file>.tmp if renameSync throws (EPERM on Windows); concurrent writers share one tmp name
Task 4: minor (deferred): json.ts:15 BOM regex uses a literal invisible U+FEFF; write it as \uFEFF
Task 4: complete (commits 38ce9d6..2b13fa2, review clean after 1 fix round)
Task 5: Ruling: sh strips secrets from any explicit opts.env too (config exports the strip used by toolEnv) — Review Focus 1 must hold for every caller — cost if wrong: one extra export in config.ts
Task 5: Ruling: tree-kill guarantee is Windows-only in v1 (POSIX kills the direct child, then cancels pipes after a 2 s grace); untested on POSIX — Windows is the primary platform and no POSIX machine is available — cost if wrong: an orphaned grandchild on macOS/Linux, revisit at the Phase 10 second-machine run
Task 5: minor (deferred): ToolError message carries full argv; add 'no secrets in argv' to AGENT_PROMPT or truncate
Task 5: minor (deferred): stdout/stderr buffered without cap; cap if chatty ffmpeg output ever matters
Task 5: fix round 1/5 (7 addressed, 1 new open — early-return skips grace timer, sh.ts:60)
Task 5: minor (deferred): taskkill SIGKILL fallback untested (needs fake process); large-output test cannot catch a regression (bun buffers pipes)
Task 5: fix round 2/5 (1 addressed, 0 open — grace timer armed for exited child)
Task 5: minor (deferred): exited child + grandchild holding pipes waits timeoutMs + 2 s grace (10 min default); accepted v1
Task 5: complete (commits 2b13fa2..0f83feb, review clean after 2 fix rounds)
Task 6: Ruling: done-when grep for plate names may match lib/contracts/types.test.ts lines that assert the old names are rejected — they are the point of the test — cost if wrong: none
Task 6: Ruling: tests/phase0.ts one-line edit (delivery: 'voiceover' in align lines) accepted outside the file list — forced by tsc after the delivery default; Task 7 rewrites that call — cost if wrong: none
Task 6: Ruling: StepSchema.url uses httpUrl (plan said z.string) — Review Focus 4: Playwright will goto it — cost if wrong: a steps.json with a non-http URL is refused (about:blank etc.); CaptureLog.url stays z.string (records, never opened)
Task 6: Ruling: httpUrl rejects URLs carrying username/password — BLUEPRINT 2.6 no secrets in files/logs — cost if wrong: a creator must log in by hand instead of pasting a credentialed URL (which 2.6 wants anyway)
Task 6: deferred to Phase 3 plan: file/nav_video path_or_url must resolve inside the run folder and reject '..' and absolute paths when opened
Task 6: fix round 1/5 (5 addressed, 0 open — Steps.url, cite test, credentials, 2 comments)
Task 6: complete (commits 0f83feb..8c4dd75, review clean after 1 fix round)
Task 7: fix round 1 dispatched (9 findings: temp leak, audio/ guard, zero-byte/dir, blank lines, stale timing, comment, env pin, ToolError test, test cleanup)
Task 7: fix round 1/5 (9 addressed, 0 open)
Task 7: minor (deferred): index.test.ts:59 title claims spec removal it doesn't assert; index.ts:15 JSDoc lists only 'missing' audio (now also not-a-file/empty/outside audio/); 'audio' dir check is case-sensitive
Task 7: complete (commits 8c4dd75..f6ee729, review clean after 1 fix round)
Task 9: Ruling: check 6 boundary scan is TS-only — vendored aligner Python calls subprocess by design — cost if wrong: a Python spawn added under lib/ outside analysis/ goes unflagged
Task 9: minor (deferred): no adapter-imports-adapter scan; uv run ruff may rewrite uv.lock on first run; check 3 failure detail is only the last 2 KB; claude checks run with tokens stripped (fine while validate/details need no auth)
Task 9: fix round 1/5 (8 addressed, 0 open)
Task 9: minor (deferred): check 4 passes if report has success:true but no manifest object; JSON null gives a poor message
Task 9: complete (commits f6ee729..9c8794d, review clean after 1 fix round)
Final review (Opus): no red; CHANGES REQUESTED. Triage:
Ruling: run-folder schemas become strict (unknown keys rejected); Timing stays loose (aligner output) — Review Focus 3 spirit, no data exists yet — cost if wrong: a tool-written file with an extra key fails to load (fix by loosening that one schema)
Ruling: secret pattern widened to /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i and SECRET_ENV dropped — Opus showed AWS_SECRET_ACCESS_KEY etc. leaked — cost if wrong: a tool needing a *_KEY var fails loudly (add allowlist)
Ruling: Voice/Music/Asset/Export interfaces made async now — sh is async-only — cost if wrong: none (unimplemented)
Ruling: deleted the 1.5 MB sh test (can't catch a regression, bun buffers pipes) — cost if wrong: none
Carried to Phase 2 plan: venv at <vmHome>/venv via UV_PROJECT_ENVIRONMENT + uv --frozen; aligner model under vmHome passed to align.py (MODEL/VOCAB override) and checked before uv starts; runPath schema (relative, no '..', no drive letter/backslash) on every path field; InputError subclass for bad inputs; path containment when files are opened (Phase 3)
Orchestrator docs fixed: tests/baseline mentions in agent defs; BLUEPRINT pdoom row table cells; AGENT_PROMPT §7 no secrets in argv + sh is text-only
Fix task: Task 10 in plan (12 items) dispatched to lib-builder
Final review: fix wave Task 10 complete (437b360..cfb9f97); re-review APPROVE, 0 open; AGENT_PROMPT §7 env wording fixed (448bc51)
