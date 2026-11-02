---
name: feedback
description: "Use when the creator gives feedback after G3 (scenes) or G4 (delivery): routes the feedback to the words, plan or scenes part and snapshots the run first"
---

# Review feedback (after G3 or G4)

Run every command with the Bash tool (Git Bash on Windows), from the creator's workspace (never `cd` into the plugin).
Every command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The run folder is the relative path `runs/<run_id>`. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`.

## 1. Classify the feedback

Match the feedback to one row:

| Feedback is about | Route | Then |
|---|---|---|
| the words said (wording, facts, order of lines) | `words` | edit `script.json` through `lib/script/cli.ts write`, then `lib/storyboard/cli.ts write` (storyboard skill, section 5), then run the new skill; `where` resumes from M9 |
| what is shown or when (scene order, which scenes, a new look) | `plan` | for a new look, first rewrite the picked look with `lib/look/cli.ts write` (storyboard skill, section 2) so `look/look.json` changes; `lib/storyboard/cli.ts write` (storyboard skill, section 5); `changed` scenes are re-done; then the scenes skill |
| one or more scenes (motion, speed, size, layout, a format's layout) | `scenes` with `--scenes` | the scenes skill |

Quote the matched row back to the creator in one line. Ask only when the feedback fits no row.

## 2. Snapshot before editing

Before editing anything, save the run's current state with the feedback text on stdin:

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/review/cli.ts" snapshot runs/<run_id> --route <route> [--scenes a,b] <<'VM_FEEDBACK_EOF'
<the creator's feedback, as given>
VM_FEEDBACK_EOF
```

Pass `--scenes` with the scene ids only for the `scenes` route. Read `ok`; on `ok:false`, stop.

## 3. Do the "Then" step

Follow the row's "Then" column.

Never edit `build/`, `out/` or a scene file directly. Scene files change only through the `scene-writer` agent.

## 4. Tell the creator

Say in one line that the `history/<n>` folder under the run holds the previous version, and what runs next.
