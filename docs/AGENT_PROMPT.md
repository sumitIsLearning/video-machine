# Video Machine — Coding Standard for Implementing Agents

You are implementing **one task** from a plan in `docs/superpowers/plans/`. Read only:
1. This file.
2. Your task section in the plan.
3. The files the task lists under **Read first**.

Do **not** scan the whole repo, read the other plans, or re-open design decisions. If the task looks wrong or unclear,
stop and report the problem. Do not guess.

Project facts you need: `docs/BLUEPRINT.md` (read only the section your task points to). Part ids (`M0`–`M18`) mean the
same thing everywhere.

## 1. Tooling
- TypeScript, run by **bun 1.4.2, pinned in the workspace**. Always call it as `node_modules/.bin/bun` from the
  workspace root. The global `bun` is 1.3.5 and breaks Chrome launch.
- Python (model wrappers only, e.g. the aligner), run by `uv` directly: `uv run --project . python ...`. Never
  `python -m uv`. Every Python subprocess gets `PYTHONUTF8=1`.
- HyperFrames is pinned: use the `HYPERFRAMES_VERSION` constant from `lib/core/config.ts`, never a bare `npx hyperframes`.
- Commands, from the workspace root (the scripts are added in Phase 1):
  - Unit tests: `node_modules/.bin/bun test`
  - Lint and types: `node_modules/.bin/bun run lint` (`tsc --noEmit`, `biome check`, `uv run ruff check`)
  - Format: `node_modules/.bin/bun run format` (`biome check --write`, `uv run ruff format`)
- Add dependencies only with `node_modules/.bin/bun add [-d] <pkg>` (root) or `uv add [--dev] <pkg>`. Pin exact
  versions for HyperFrames and Playwright. Never edit a lockfile by hand.
- Keep the formatter's output. If the plan's code and the formatter disagree on layout, the formatter wins.
- A task is done only when unit tests pass and lint is clean.
- Acceptance scripts (`tests/phase<N>.ts`) drive real HyperFrames, Chrome, ffmpeg, Playwright and the aligner and take
  minutes. Run one only if your task says so. The orchestrator runs them at the end of each phase.

## 2. TDD (mandatory)
1. **Red:** write the test first and run it. It must fail for the right reason.
2. **Green:** write the minimum code that makes it pass.
3. **Refactor:** clean up, then run the tests again.

- Unit tests are `*.test.ts` files **next to the code they test**, using `bun:test`
  (`import { test, expect, mock } from 'bun:test'`).
- Fake every external process and service: HyperFrames, Chrome/Playwright, ffmpeg, `uv`/Python, TTS, avatar services,
  the network. Inject the `sh` runner from `lib/core/sh.ts` and pass a fake. Unit tests never spawn a renderer, never
  touch the network, never read `.env`.
- Use small inline JSON or `tests/fixture/` data as read-only input. Write scratch files only under the OS temp dir
  (`mkdtempSync(path.join(tmpdir(), 'vm-'))`), never inside the repo.
- One behavior per test, named after the behavior: `test('plan.coverage fails when a line is in two scenes', ...)`.

## 3. Naming
| Thing | Rule | Example |
|---|---|---|
| Folders, files | lowercase, dashes | `lib/core/text-fit.ts`, `lib/adapters/voice/hf-tts/index.ts` |
| Adapters | `lib/adapters/<kind>/<name>/index.ts`: a camelCase factory taking `Deps` (`lib/core/deps.ts`) + default export, and `cli.ts` beside it | `export const hfTts = (deps: Deps = defaultDeps()): VoiceAdapter => ({...})` |
| Check files | check id with `.` → `-` | `lib/checks/render-deterministic.ts` for `render.deterministic` |
| Types | PascalCase, blueprint names exactly | `Brief`, `ScenePlan`, `CaptureLog` |
| Zod schemas | `<Type>Schema` | `StepsSchema` |
| Functions, variables | camelCase; verbs for functions, auxiliary verbs for booleans | `readNavVideo`, `isInsideSafeArea` |
| Constants | UPPER_SNAKE | `FORMATS`, `HYPERFRAMES_VERSION` |
| Python | snake_case functions, UPPER_SNAKE constants | `align.py: main()` |
| Tests | `<file>.test.ts` beside `<file>.ts` | `lib/core/sh.test.ts` |
| Run-folder JSON keys | snake_case, as in the contracts | `scene_id`, `input_hash` |

Use the blueprint's domain words exactly: run, brief, scene, beat, board, look, pack, motif, direction, asset, capture,
format, frame, gate, deliverable.

## 4. Module layout
- Library code is plain functions and objects. No classes.
- Import direction: `lib/checks/` and `lib/adapters/` → `lib/core/` → `lib/contracts/`. `contracts/` imports nothing
  from `lib/`. **Adapters never import each other** or `looks/`.
- Each adapter's `cli.ts` parses argv, calls `index.ts`, and prints **one JSON line** to stdout. Shipped skills call
  adapters only through `cli.ts`.
- External tools are reached only through `lib/core/sh.ts` (timeout, kills the whole process tree on Windows, returns
  `{code, stdout, stderr}`). No direct `Bun.spawn` elsewhere.
- Shared mechanics (timing lookup, text fit, frame/safe area, captions) go in `lib/core/`. Anything that gives a video a
  look (palette, type, motifs) goes in `looks/`.
- Dependencies (paths, runner, settings) are passed in as arguments, so tests can replace them.
- **Who writes what at run time:** only adapters write run-folder media and JSON (JSON only through `writeJson`); only
  checks write `test_results.json` and `report.md`. Nothing writes under the plugin root at runtime, and nothing ever
  writes to `C:\Work-data\video-testing` or `C:\Work-data\kinomat`.

## 5. Functions
- Full type annotations; `strict` TypeScript. Modern syntax (`const`, arrow functions for small helpers, `??`, `?.`).
- A JSDoc comment on every exported function: one-line summary, then what it returns and what it throws.
- An options object past three parameters. Early returns over nesting.

## 6. Config
- All settings come from `lib/core/config.ts`. **No other file reads `process.env` or `Bun.env`.** Each `cli.ts` reads
  settings once and passes them down. Per-run settings come from `brief.json`; fixed tables (formats, thresholds) live
  in `contracts/types.ts` as constants.
- Adapters set the environment of the processes they spawn explicitly (`PYTHONUTF8`, `HYPERFRAMES_NO_TELEMETRY`),
  starting from the env that `config.ts` hands them.
- API keys (HeyGen, ElevenLabs) live only in the workspace `.env` and are read only in `config.ts`, wrapped in a `Secret`
  type whose `toString()` returns `"***"`. Never log or print them, never put them in a run folder.

## 7. Errors
- Custom errors live in `lib/core/errors.ts` under `VideoMachineError` (`ContractError`, `ToolError`, `CostGateError`,
  `CaptureError`, ...). Messages name what failed and where (file path, scene id, format, `t`); wrap with `{ cause }`.
- A failed subprocess becomes a `ToolError` holding the command, exit code and the last 2 KB of stderr.
- A failed parse of any JSON file is an error, never a warning (`readJson` / `writeJson` already do this).
- A failed **check** is not an exception: it is a `fail` entry in `test_results.json` with annotations (`scene_id`, `t`,
  `problem`, `suggested_fix`). Throw only when the check itself cannot run.
- Never catch everything. Catch a specific failure, add context, rethrow or record it. Never swallow an error silently.
- Never fake an unsupported feature: throw (for example `render(..., passes)` when transparent layers aren't supported).
- A `cli.ts` turns an error into `{"ok":false,"error":"<class>","message":"..."}` on stdout and exit code 1.

## 8. Logging
- Library functions return data and do not print. Only `cli.ts` files and acceptance scripts print.
- stdout carries only the CLI's JSON result. Diagnostics go to stderr, one line each, prefixed with the part id
  (`[M3] step 4: target "Export" not found, using nav frame`).
- Never print secrets, cookies, page text, full user scripts, or whole JSON files.

## 9. Time and data
- Times are seconds as floats on the video timeline. Frame `n` at `fps` is `n / fps`. Compare times with a tolerance,
  never `===`.
- Scenes and anything they call are deterministic functions of time: seeded randomness only, no `Date` /
  `performance.now()` inside scene code, no state that survives a seek.
- Find words and lines by content (`lineOf`, `wordOf`), never by hard-coded seconds.
- No pixel constants for layout in scenes: compute from the frame (per-format CSS variables).
- JSON files: written by `writeJson` (1-space indent, LF, trailing newline). Paths inside JSON are run-relative and
  POSIX (`capture/clips/3.mp4`). `input_hash`: SHA-256 of canonical JSON (keys sorted), hex.
- Build paths with `node:path`; never hard-code `\` or `/` separators in joined paths.
- Media written by adapters: video H.264 at 30 fps CFR, audio 48 kHz WAV, unless the task says otherwise.

## 10. Comments
Explain *why*, not *what*. Mark deliberate simplifications with `ponytail:` plus the limit and the upgrade path. Keep the
MIT attribution (`LICENSE.pdoom-engine`) in any file that contains code lifted from the pdoom engine or Motion
Graphics 1 (today: the vendored aligner scripts in `lib/adapters/align/ctc-onnx/analysis/`).

## 11. Writing files
Write files only with Edit/Write. **Never create or modify files through Bash** (no `>`, `>>`, `sed -i`, `tee`, `cp`,
`mv` into the repo); package-manager commands and `bun run format` are the only exceptions. A hook blocks Edit/Write outside your folders;
Bash would bypass it. Do not commit; the orchestrator commits.

## 12. Definition of done (report this back)
1. The files you created or changed.
2. The `bun test` summary line.
3. Lint status (`bun run lint`).
4. Anything you did differently from the plan, and why.
