# Handoff

## Now (2026-10-14, night): token-lean dev flow set up (uncommitted, awaiting the user's look)

- Measured with `~/.claude/skills/lean-agents/scripts/token_report.py`: 22.6M input tokens over the Phase 3 sessions;
  the main Opus session was 46% (87 turns × ~120k); builders 1.2–2.1M each (22–32 exploring turns).
- New flow (`.claude/agents/orchestrator.md` Execution, summary in `CLAUDE.md`): `python3 .claude/tools/brief.py <plan>
  <id>` → fill Do not touch + Context pack → Haiku builder → Haiku spec-reviewer → Sonnet code-reviewer → fresh Haiku
  fix round → `sh .claude/tools/check.sh` → commit. `/clear` after 2 tasks.
- Fixed: the builders' path guard called `python` (missing on macOS), so it never ran since the move; now `python3`.
  Removed `skills:` preloads that did not resolve (superpowers is not installed here).
- History moved to `docs/handoff-archive.md`. User-level skill `lean-agents` holds the reusable version.

## Now (2026-10-14, evening): Phase 3 code-complete on `master`; two manual checks left

- Tasks 6–10 done and reviewed, then an Opus whole-branch review and its fix wave (re-review APPROVE). Commits
  `491c187` (T6), `ff3fb38` (T7), `4140811` (`.python-version` 3.14, user OK), `57314e1` (T8), `bb0a4b5` (T9),
  `4a36905` (T10), `cb4c37b` (branch fix wave). Not pushed yet.
- `bun test` 532 tests, 0 fail; lint clean; `bun tests/phase3.ts` 9/9 live (R9 clip offset +0.05 to +0.11 s, not 0.45 s).
- Playwright Chromium installed on this Mac (user OK); `doctor` all green.
- User rulings: keep the repo's own agents for every builder/reviewer role (no mattpocock skills).
- Behaviour changes from the branch review: `assets.json` lives at the run root (Task 8 had `assets/`); replay's
  product host and profile come from the brief's `product_url`, and `capture login <run_dir>` reads it (no URL arg).
- **Left, with the user:**
  1. R11 manual logged-in check: a product the user can log in to → run with `product_url` → `capture login` by hand →
     replay.
  2. Live `claude --plugin-dir . -p "continue my video"` before/after (Task 9); the auto-mode classifier blocks nested
     claude from agents, so it is run by hand.
  3. Then: push, and plan Phase 4.
- Open idea (no answer yet): builders twice wrote files through Bash/python despite the rule; `path_guard.py` could
  block that.
- Ledger: `.superpowers/sdd/phase-3-research-sources/progress.md` (rulings, deferred minors).

Older sections: `docs/handoff-archive.md`.
