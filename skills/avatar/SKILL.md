---
name: avatar
description: "Use when a run needs its avatar (M11): makes the talking-head segments, places them in each format's safe area, and reports which preset each segment got."
---

# Avatar (M11)

Run every command with the Bash tool (Git Bash on Windows), from the creator's workspace (never `cd` into the plugin).
Every command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The run folder is the relative path `runs/<run_id>`. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`.

## 1. Make the segments

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/avatar/cli.ts" make runs/<run_id>
```

- **Cost refusal.** When the avatar costs more than the budget, the command refuses with a message that names the
  amount. Tell the creator the price and the segments it names: HeyGen is about $1 per minute, an estimate. Ask. Only
  after a yes, re-run with `--approve-spend <usd>` using that amount.
- **Supplied clip.** A supplied clip must run along the whole voiceover (the creator films it while reading the script).
  If the command says the clip does not cover the voiceover, tell the creator and ask for a clip that does.
- **HeyGen key.** HeyGen needs `HEYGEN_API_KEY` in the workspace `.env`. If the message says it is missing, tell the
  creator to add it there and stop the avatar part. Never ask the creator to paste the key into the chat.
- **Stack runs.** In a `stack` run (`brief.layout.kind` is `"stack"`), the supplied clip keeps its background (no
  background removal). `make` needs `plan.json`, so the storyboard (M8) comes first.

## 2. Place the segments

In a `stack` run (`brief.layout.kind == "stack"`), `make` already wrote `avatar/placement.json`. Skip the avatar
director and go to step 3.

Dispatch `vm:avatar-director` with the Agent tool (`subagent_type: "vm:avatar-director"`), giving
it the run folder `runs/<run_id>`. Wait for it to finish.

## 3. Check the boxes

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/avatar/cli.ts" boxes runs/<run_id>
```

It must return `ok`. On an `ok:false`, give the director the message once (dispatch it again with the message), then run
`boxes` again. If it still fails, show the creator the message and stop.

## 4. Report

Read `runs/<run_id>/avatar/placement.json` and tell the creator in one line which segments got which preset, for example
"a01 bottom-right corner, a02 full frame."

## Rules

- Only `make` spends money. Ask before any paid call, and never run `make` with `--approve-spend` without a yes.
- Never hand-edit anything under `avatar/`. `make` writes it, and the director writes `placement.json`.
