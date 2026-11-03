---
name: feedback
description: "Use when the creator gives feedback on a video waiting at any gate (G1 script, G2 storyboard, G3 scenes, G4 delivery) or types /vm:feedback: at G1 or G2 hands the notes to storyboard; at G3 or G4 routes the feedback to the words, plan or scenes part and snapshots the run first"
argument-hint: "<what to change>"
---

# Feedback (at any gate)

Run every command with the Bash tool (Git Bash on Windows), from the creator's workspace (never `cd` into the plugin).
Every command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The run folder is the relative path `runs/<run_id>`. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`.

## 0. Find the run and its gate

1. The notes are the command arguments. If they are empty, use the creator's last message. If there is none, ask what to change.
2. Pick the run this conversation is working on, if it waits at a gate. Else run the status command and keep the runs by `next`:
   - `M7` waits at G1 (script written)
   - `M9` waits at G2 (plan written)
   - `M16` waits at G3 (checks passed)
   - `done` waits at G4

   Any other `next` waits at no gate.

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/run/cli.ts" status
   ```

   One kept run: use it. Two or more: ask which. None: say "No video is waiting for your OK. Start one with /vm:new <idea>." and stop.
3. G1 or G2: follow `vm:storyboard` at that gate (G1: its section 1 gate; G2: its section 6) with the notes as the creator's feedback. Then stop here: no snapshot, nothing routed.
4. G3 or G4: go on to section 1 below.

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
