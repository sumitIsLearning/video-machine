---
name: deliver
description: "Use when a run needs its audio mixed and its deliverables exported (M16–M17), then the creator's final check (G4)"
---

# Deliver (M16–M17)

Run every command with the Bash tool (Git Bash on Windows), from the creator's workspace (never `cd` into the plugin).
Every command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The run folder is the relative path `runs/<run_id>`. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`.

## 1. Mix (M16)

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/deliver/cli.ts" mix runs/<run_id>
```

The result has `music` (the music bed's run path, or `null`), `i` (integrated loudness, LUFS) and `tp` (true peak). Tell
the creator in one line whether a music bed is used and what the loudness is.

## 2. Export (M17)

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/deliver/cli.ts" export runs/<run_id>
```

On `ok: true`, go to step 3. On `ok: false`, show each `failed` entry: its `id`, its `format` when it has one, and each
of its `problems`. Then:

- A loudness problem: show the measured numbers and ask the creator. The mix is deterministic, so re-mixing gives the same result.
- Any other problem: stop and ask the creator how to proceed.

## 3. Gate G4: the creator checks the delivery

List the `deliverables` paths and the `report` path from the `export` result, in a few lines. Then ask whether to
finish. Wait for a yes.

If the creator gives feedback instead, run the `review` skill (`vm:review`) with it. Do not edit `out/` or
`build/` here.
