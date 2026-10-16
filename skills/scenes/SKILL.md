---
name: scenes
description: "Use when a run needs its scenes written, rendered and checked (M12–M14)"
---

# Scenes (M12–M14)

Run every command with the Bash tool (Git Bash on Windows), from the creator's workspace (never `cd` into the plugin).
Every command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The run folder is the relative path `runs/<run_id>`. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`.

The commands are `times`, `build` and `check`:

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/scenes/cli.ts" times runs/<run_id>
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/scenes/cli.ts" build runs/<run_id>
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/scenes/cli.ts" check runs/<run_id>
```

Only the `scene-writer` agent writes scene files. This skill never edits `scenes/` or `build/` itself.

## 1. Write the scenes

Run `times` once. Then dispatch one `scene-writer` per scene in parallel, using the Agent tool with
`subagent_type: "video-machine:scene-writer"`. Give each one the run folder and its `scene_id`. Wait for all of them.

## 2. Build

Run `build`. If `ok: false` with `failing_scenes`, re-dispatch only `failing_scenes` to `scene-writer`, giving each one its
`issues` from the result. If `ok: false` has only a `message` (a fragment broke a rule), take the scene ids from its
lines, one per problem, in the form `scene <id>: <rule>`, and re-dispatch those scenes to `scene-writer` with their
lines as the issues. Either way this counts toward the 3 fix rounds. Then run `build` again.

## 3. Check

Run `check`. If `blocking_failed` is greater than 0, re-dispatch only `failing_scenes` to `scene-writer`, giving each one
its annotations from `runs/<run_id>/test_results.json` (`scene_id`, `t`, `problem`, `suggested_fix`). Then run `build` and `check`
again.

If `build` returns `ok: false` with no `failing_scenes` and no `scene <id>:` lines, or `check` reports
`blocking_failed` greater than 0 with `failing_scenes` empty, do not re-dispatch and do not run them again: the
problem is not in one scene (for example the duration or a missing citation). Stop, show the creator the `issues`
(build) or the failed sections of `runs/<run_id>/report.md` (check), and ask how to proceed.

Allow at most 3 fix rounds across steps 2 and 3 together (blueprint 2.7). After the third round, stop and tell the
creator which scenes still fail and why.

## 4. Gate G3: the creator checks the scenes

Tell the creator, in a few lines:

- the contact sheet path for each format (`sheet` in the `build` result),
- the draft path for each format (`draft` in the `build` result),
- the summary from `report.md` (the `report` path that `check` returns).

Then ask whether the scenes look right. Wait for a yes. Do not render anything else or move on without it.
