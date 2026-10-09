# Video Machine — Coding Standard for Implementing Agents

You are implementing **one task** from a plan in `docs/superpowers/plans/`. Read only:
1. This file.
2. Your task section in the plan.
3. The files the task lists under **Read first**.

Do **not** scan the whole repo, read the other plans, or re-open design decisions. If the task looks wrong or unclear, stop and report the problem. Do not guess.

Project facts you need: `docs/BLUEPRINT.md` (read only the section your task points to). Part ids (`M0`–`M18`) mean the same thing everywhere.

## 1. Tooling
- **TypeScript on bun 1.4.2**, pinned in `package.json`. Always call `node_modules/.bin/bun`, never a global `bun` (global 1.3.5 can't launch Chrome on Windows).
  - Unit tests: `node_modules/.bin/bun test tests/unit`
  - Acceptance test for a phase: `node_modules/.bin/bun tests/phase<N>.ts` (slow; real tools; run it only when your task says so)
  - Lint and format: `node_modules/.bin/bun x tsc --noEmit && node_modules/.bin/bun x biome check --write .`
- **Python 3.13 via uv** (aligner and other model wrappers only): `uv run --project . python <file>`. Never `python -m uv` (broken on this machine). Set `PYTHONUTF8=1` for every Python subprocess.
- **HyperFrames** is pinned: use the `HYPERFRAMES_VERSION` constant from `lib/core/config.ts`, never a bare `npx hyperframes`.
- Add dependencies only with `node_modules/.bin/bun add <pkg>` / `bun add -d <pkg>` or `uv add <pkg>`. Pin exact versions for HyperFrames and Playwright. Never edit a lockfile by hand.
- A task is done only when the tests pass and lint is clean.

## 2. TDD (mandatory)
1. **Red:** write the test first and run it. It must fail for the right reason.
2. **Green:** write the minimum code that makes it pass.
3. **Refactor:** clean up, then run the tests again.

Unit tests never run real external tools (HyperFrames, ffmpeg, Playwright, Python, the network). Inject the subprocess runner (`sh` from `lib/core/sh.ts`) and pass a fake in tests. One behavior per test, named after the behavior. Real tools run only in `tests/phase<N>.ts`.

## 3. Naming
| Thing | Rule | Example |
|---|---|---|
| Files and folders | kebab-case | `lib/adapters/voice/hf-tts/index.ts` |
| Adapter CLI entry | `cli.ts` beside `index.ts` | `lib/adapters/capture/playwright/cli.ts` |
| Types | PascalCase | `ScenePlan`, `CaptureLog` |
| Zod schemas | `<Type>Schema` | `StepsSchema` |
| Functions | camelCase verbs | `readNavVideo`, `splitByLog` |
| Constants | UPPER_SNAKE | `HYPERFRAMES_VERSION`, `FORMATS` |
| Private helpers | not exported; no underscore prefix | `toSeconds` |
| Unit tests | `tests/unit/<mirror of lib path>.test.ts` | `tests/unit/core/sh.test.ts` |
| Fixtures | `tests/fixture/<part>/...` | `tests/fixture/capture/steps.json` |
| Run-folder JSON keys | snake_case (matches the contracts) | `scene_id`, `input_hash` |

Use the blueprint's domain words exactly: run, brief, scene, beat, board, look, direction, asset, capture, gate.

## 4. Module layout
- Import direction: `lib/checks` and `lib/adapters/*` → `lib/core` → `lib/contracts`. Never the other way. **Adapters never import each other.**
- Each adapter folder: `index.ts` exports the functions of its interface in `contracts/types.ts`; `cli.ts` parses argv, calls `index.ts`, and prints **one JSON line** to stdout. Skills call adapters only through `cli.ts`.
- External tools are reached only through `lib/core/sh.ts` (timeout, kills the whole process tree on Windows, returns `{code, stdout, stderr}`). No direct `Bun.spawn` elsewhere.
- Dependencies (runner, paths, settings) are passed in as arguments. No module-level clients or hidden globals.
- **Who writes what:** only adapters write run-folder files, always through `writeJson` (validated) or as media files; checks only write `test_results.json` and `report.md`. Nothing writes under the plugin root at runtime, and nothing ever writes to `C:\Work-data\video-testing`.

## 5. Functions
- Full type annotations; `strict` TypeScript. Prefer `type` + Zod-inferred types over interfaces, except the adapter interfaces.
- JSDoc on exported functions: summary, then params, returns and throws.
- Options object past three parameters. Early returns over nesting. Functions over classes.

## 6. Config
All settings come from `lib/core/config.ts`. **No other file reads `process.env` or `Bun.env`.** Read settings once in each `cli.ts` and pass them down. API keys (HeyGen, ElevenLabs) are read there only and never printed: wrap them in a `Secret` type whose `toString()` returns `"***"`.

## 7. Errors
- Custom errors live in `lib/core/errors.ts` under `VideoMachineError` (`ContractError`, `ToolError`, `CostGateError`, `CaptureError`, ...).
- Never `catch (e) {}` everything. Catch specific failures and wrap them at the module edge with `{ cause }`.
- A failed subprocess becomes a `ToolError` holding the command, exit code and the last 2 KB of stderr.
- A `cli.ts` turns an error into `{"ok":false,"error":"<class>","message":"..."}` on stdout and exit code 1. Never swallow an error silently.

## 8. Logging
Diagnostics go to **stderr**, one line each, prefixed with the part id (`[M3] step 4: target "Export" not found, using nav frame`). stdout is reserved for the CLI's JSON result. Never log secrets, cookies, page text or full user scripts.

## 9. Time and data
- Times are seconds as floats on the video timeline; frame = `Math.round(t * fps)`. Never read the wall clock inside scene code.
- Any randomness takes an explicit seed.
- Paths inside JSON are run-relative and POSIX (`capture/clips/3.mp4`).
- Media written by adapters: video H.264 at 30 fps CFR, audio 48 kHz WAV unless the task says otherwise.

## 10. Comments
Explain *why*, not *what*. Mark deliberate simplifications with `ponytail:` plus the limit and the upgrade path.

## 11. Definition of done (report this back)
1. The files you created or changed.
2. The test summary line.
3. Lint status.
4. Anything you did differently from the plan, and why.
