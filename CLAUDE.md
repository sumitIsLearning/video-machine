# Video Machine (dev)

A Claude Code plugin that turns a concept into a motion-graphics reel. Spec: `docs/BLUEPRINT.md` (read sections, not
the whole file). State: `HANDOFF.md` and the ledger `.superpowers/sdd/<phase>/progress.md`.

## Running a plan (token budget)
The main session is the orchestrator: follow `.claude/agents/orchestrator.md` (Execution and "Your own context").
In short:
- One task = brief (`python3 .claude/tools/brief.py <plan> <id>`, then fill "Do not touch" and "Context pack") →
  Haiku builder → Haiku spec-reviewer → Sonnet code-reviewer → fresh Haiku fix round → `sh .claude/tools/check.sh`
  → commit.
- Subagent prompts carry only the brief path, the base sha and, for fixes, the finding lines.
- Never read a whole plan, source file or diff in the main session. Use `grep -n`, `--stat` and line ranges.
- After 2 committed tasks, update the ledger and HANDOFF, then ask the user to `/clear` and say "continue".
- Measure: `python3 ~/.claude/skills/lean-agents/scripts/token_report.py` shows tokens per agent and the biggest reads.

## Commands
- `node_modules/.bin/bun` (pinned 1.4.2; never the global bun). Quiet tests + lint: `sh .claude/tools/check.sh [paths]`.
