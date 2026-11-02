---
name: setup
description: "Use when the creator says set it up, install the Video Machine, or when new (/vm:new) finds setup missing or broken: installs and verifies every tool the Video Machine needs."
---

# Set up the Video Machine

Run every command with the Bash tool (Git Bash on Windows), not PowerShell. Every command prints one JSON line. Read its
`ok` field (for `install`, also `steps[].ok` and `steps[].detail`), never the exit code. Any `ok:false` means: show the
creator the `message` or `detail` (`doctor` reports `failing` and `details` instead, see step 4). The error class (`InputError`, `ContractError`, `ToolError`, others) is only a hint at
whose fix it is. Report each step in plain words.

## 0. Ask once, before anything is installed

Tell the creator everything setup will download, and ask once. Do this even when no system tool is missing.

| Download | Size |
|---|---|
| JS runtime (bun + zod) | 90 MB |
| Python venv | about 115 MB |
| Aligner model (sha256-checked) | 95 MB |
| Chrome for rendering | up to about 500 MB |
| Browser for the capture replay (`capture_browser`) | none if Chrome is installed, else about 150 MB |
| Parakeet transcription model | 640 MB |
| Kokoro voice model (fetched on the first smoke test) | about 340 MB |

System tools from the table in step 2 come on top of that. On Linux, tell the creator that the uv line runs a script from
astral.sh. Run nothing until the creator says yes.

## 1. JS dependencies

Check bun: `[ -f "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" ] || [ -f "${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun.exe" ]`.
If it exists, go to step 2. If not, check Node directly with `node --version`. If Node is missing or older than 22, show
the Node row of the table in step 2 and ask before installing it (the doctor can't run yet: it needs bun). Then run:

```bash
npx --yes bun@1.4.2 install --frozen-lockfile --production --cwd "${CLAUDE_PLUGIN_ROOT}"
```

If `node` or `npx` is still not found after installing Node, the shell has the old PATH. Ask the creator to restart
Claude Code, then run setup again. Tell the creator why this install exists: a plugin update removes these files, so setup
runs again after every update.

## 2. Doctor

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/setup/cli.ts" doctor
```

For a failing `node`, `ffmpeg`/`ffprobe` or `uv`, show **one list** of the install commands for the creator's OS and ask
once before running them (the step 0 yes covers downloads, not these).

| Tool | Windows | macOS | Linux |
|---|---|---|---|
| Node.js 22 or newer | `winget install --id OpenJS.NodeJS.LTS -e` | `brew install node` | the distro's Node 22+ package |
| ffmpeg + ffprobe | `winget install --id Gyan.FFmpeg -e` | `brew install ffmpeg` | `sudo apt install ffmpeg` |
| uv | `winget install --id astral-sh.uv -e` | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

After installing, if the doctor still can't find a tool, the shell has the old PATH. Ask the creator to restart Claude
Code and run setup again.

## 3. Install

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/setup/cli.ts" install
```

It sets up the Python venv, the aligner model, Chrome for rendering, the Parakeet model and the capture replay browser
(the system Chrome is reused; only without it is Playwright's Chromium downloaded). Re-run only failed steps with
`install <step>`.

## 4. Doctor again

Run `doctor` until `ok` is true. Fix each failing tool:

| Failing | Fix |
|---|---|
| `kokoro`, `venv` | `install venv` |
| `aligner_model` | `install model` |
| `chrome` | `install browser` |
| `parakeet` | `install parakeet` |
| `capture_browser` | `install capture_browser` |
| `hyperframes` | never run hyperframes directly; re-run `install` or check Node, npm and the network |

`doctor` prints `{ok, failing, details, doctor: <path>}`. `details` maps each failing tool to its `detail`: read it from
that JSON line and do not open the file named by `doctor`. After two attempts at fixing the same tool, show its `detail`
to the creator and stop.

## 5. Smoke test

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/setup/cli.ts" smoke
```

It takes about a minute and needs the network. Show the three timings (render, tts, align). Setup is done.

## Never

- Run bare `hyperframes skills`, `hyperframes feedback`, `pip install`, or `sudo` without the creator's yes.
- Write under `${CLAUDE_PLUGIN_ROOT}`, except the install in step 1.
- Edit the creator's shell profile.
