---
name: status
description: "Use when the creator asks how their videos stand, what is next, or types /vm:status: shows setup health and each run's next part."
---

# Video Machine status

Read-only: this never starts a part and writes nothing. Run it with the Bash tool (Git Bash on Windows), not PowerShell,
from the creator's workspace, so `./runs/` is found.

First check bun: `[ -f "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" ] || [ -f "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun.exe" ]`.
If it is missing, say so and point to `vm:setup`. Otherwise:

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/run/cli.ts" status
```

The command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The error class (`InputError`, `ContractError`, `ToolError`, others) is only a hint at whose fix it is.

## Show

1. **The doctor line first.** `doctor.ok` true: "setup ok", with `checked_at`. False: the names in `failing`, then
   "run vm:setup". `doctor` null: "setup never ran, run vm:setup".
2. **One row per run:** run id, next part in words, skipped parts in words. `next: "done"` reads "finished".
3. **A run that comes back as `{ run_id, error }`** has an invalid file. Show its row with the error and "fix this file,
   then run status again". Keep listing the other runs.

## Part names

M1 intake, M2 video reader, M3 replay and capture, M4 assets panel, M5 research, M6 script, M7 looks, M8 storyboard,
M9 voice, M10 timing, M11 avatar, M12 scenes, M13 render, M14 checks, M16 sound, M17 export.
