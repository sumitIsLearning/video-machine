# Video Machine — Coding Standard for Implementing Agents

You are implementing **one task** from a plan in `docs/superpowers/plans/`. Read only:
1. This file.
2. Your task section in the plan.
3. The files the task lists under **Read first**.

Do **not** scan the whole repo, read the other plans, or re-open design decisions. If the task looks wrong or unclear,
stop and report the problem. Do not guess.

Project facts you need: `docs/BLUEPRINT.md` (read only the section your task points to).

## 1. Tooling
- TypeScript, run by **Bun 1.4.2, pinned in the workspace**. Always call it as `node_modules/.bin/bun` from the
  workspace root (`../node_modules/.bin/bun` from `engine/`). The global `bun` is 1.3.5 and breaks Chrome launch and the
  engine lockfile.
- Python (aligner only), run by `uv` directly: `uv run --project . python ...`. Never `python -m uv`.
- Commands, from the workspace root:
  - Unit tests: `node_modules/.bin/bun test`
  - Lint and types: `node_modules/.bin/bun run lint` (`tsc --noEmit`, `biome check`, `uv run ruff check`)
  - Format: `node_modules/.bin/bun run format` (`biome format --write`, `uv run ruff format`)
- Add dependencies only with `node_modules/.bin/bun add [-d] <pkg>` (root) or `uv add [--dev] <pkg>`. In `engine/`,
  install only with `../node_modules/.bin/bun install --frozen-lockfile`; never add or upgrade engine dependencies
  unless the task says so. Never edit a lockfile by hand.
- Keep the formatter's output. If the plan's code and the formatter disagree on layout, the formatter wins.
- A task is done only when unit tests pass and lint is clean.
- Acceptance scripts (`tests/accept/phase-N.ts`) drive real Chrome, ffmpeg and the aligner and take minutes. Run one
  only if your task says so. The orchestrator runs them at the end of each phase.

## 2. TDD (mandatory)
1. **Red:** write the test first and run it. It must fail for the right reason.
2. **Green:** write the minimum code that makes it pass.
3. **Refactor:** clean up, then run the tests again.

- Unit tests are `*.test.ts` files **next to the code they test** (so each builder can write its own tests inside its
  folders), using `bun:test` (`import { test, expect, mock } from 'bun:test'`).
- Mock every external process and service: Chrome/Playwright, ffmpeg, `uv`/Python, TTS, music, the network. Unit tests
  never spawn a renderer, never touch the network, never read `.env`.
- Use small inline JSON or `tests/fixture/` data as read-only input. Write scratch files only under the OS temp dir
  (`mkdtempSync(path.join(tmpdir(), 'vm-'))`), never inside the repo.
- One behavior per test, named after the behavior: `test('plan.coverage fails when a line is in two plates', ...)`.

## 3. Naming
| Thing | Rule | Example |
|---|---|---|
| Folders, files | lowercase, dashes | `core/text-fit.ts`, `checks/plan-coverage.ts` |
| Check files | check id with `.` → `-` | `checks/render-deterministic.ts` for `render.deterministic` |
| Types | PascalCase, blueprint names exactly | `Brief`, `PlatePlan`, `FormatId` |
| Zod schemas | `<Type>Schema` | `PlatePlanSchema` |
| Functions, variables | camelCase, verbs for functions, auxiliary verbs for booleans | `frameOf`, `isInsideSafeArea` |
| Constants | UPPER_SNAKE | `FORMATS`, `MAX_FIX_ROUNDS` |
| Adapters | folder `adapters/<kind>/<name>/index.ts`, named export = camelCase name, also default export | `export const ctcOnnx: AlignAdapter` |
| Python | snake_case functions, UPPER_SNAKE constants | `align.py: main()` |
| Tests | `<file>.test.ts` beside `<file>.ts` | `core/text-fit.test.ts` |

Use the domain words from the blueprint exactly: plate, beat, look, pack, motif, direction, run, format, frame, gate,
treatment, deliverable.

## 4. Module layout
- Skill code is plain functions and objects. No classes, except where the engine requires them (plates and motifs
  extend or use the engine's `Scene`, `Layer2D`, `LineBatch`).
- Import direction: `checks/` and `adapters/` → `core/` → `contracts/`. `looks/*/motifs/` → `core/` → `contracts/`.
  `contracts/` imports nothing from the skill. Adapters never import looks. Skill code never imports from `engine/src`;
  only plates (at run time) and motifs do.
- Shared mechanics (camera, easing, text fit, timing lookup, frame/safe area, captions) go in `core/`. Anything that
  gives a video a look (palette, type, motif drawing) goes in `looks/`. If a look task needs a new mechanic, report it;
  do not write it inside `looks/`.
- Dependencies (paths, adapters, spawn functions) are passed in as arguments, so tests can replace them.
- Who writes what at run time: only adapters write render outputs (`out/`); only checks append to
  `test_results.json`; JSON run files are written only through `writeJson`.

## 5. Functions
- Full type annotations on exported functions. Modern syntax (`const`, arrow functions for small helpers, `??`, `?.`).
- A JSDoc comment on every exported function: one-line summary, then what it returns and what it throws.
- An options object past three parameters. Early returns over nesting.

## 6. Config
- Skill code reads **no environment variables**. Per-run settings come from `brief.json`; fixed tables (formats, check
  thresholds) live in `contracts/types.ts` as constants.
- Adapters set the environment of the processes they spawn explicitly (`VM_RUN`, `PYTHONUTF8`, `EXTRA_CHROME_ARGS`),
  starting from `process.env`.
- API keys live only in the workspace `.env`, read by the adapter that needs them, at call time. Never log or print
  them, never put them in a run folder.

## 7. Errors
- Throw `Error` with a message that names what failed and where (file path, plate id, format, `t`), and pass the
  original error as `{ cause }` when wrapping one.
- A failed parse of any JSON file is an error, never a warning (`readJson` / `writeJson` already do this).
- A failed **check** is not an exception: it is a `fail` entry in `test_results.json` with annotations
  (`plate_id`, `t`, `problem`, `suggested_fix`). Throw only when the check itself cannot run.
- Never catch everything. Catch a specific failure, add context, rethrow or record it. Never swallow an error silently.
- Never fake an unsupported feature: throw (for example `render(..., passes)` on an adapter without layer passes).

## 8. Logging
- Library functions return data and do not print. Only CLI entry points (acceptance scripts, `align.py`, check
  runners) print, one line per step, with the run/plate/format it concerns.
- Never print secrets, full `.env` contents, or whole JSON files.

## 9. Time and data
- Time in plates and timing files is **song seconds** (float). Frame `n` at `fps` is `n / fps`. Compare times with a
  tolerance, never `===`.
- Plates, motifs and anything they call are deterministic functions of time: seeded hashes/noise only (`hash`,
  `noise1` from the engine's util), no `Math.random()`, no `Date`/`performance.now()`, no state that survives a seek.
- Find words and lines by content (`lineOf`, `wordOf`), never by hard-coded seconds.
- No pixel constants for layout in plates or motifs: compute from the `frame` object.
- JSON files: written by `writeJson` (1-space indent, LF, trailing newline). Hashes (`input_hash`): SHA-256 of
  canonical JSON (keys sorted), hex.
- Paths: build with `node:path`; never hard-code `\` or `/` separators in joined paths.

## 10. Comments
Explain *why*, not *what*. Mark deliberate simplifications with `ponytail:` plus the limit and the upgrade path. Keep the
MIT attribution (`LICENSE.pdoom-engine`) in any file that contains code lifted from the pdoom engine or Motion
Graphics 1.

## 11. Writing files
Write files only with Edit/Write. **Never create or modify files through Bash** (no `>`, `>>`, `sed -i`, `tee`, `cp`,
`mv` into the repo). A hook blocks Edit/Write outside your folders; Bash would bypass it. Do not commit; the orchestrator
commits.

## 12. Definition of done (report this back)
1. The files you created or changed.
2. The `bun test` summary line.
3. Lint status (`bun run lint`).
4. Anything you did differently from the plan, and why.
