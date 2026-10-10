# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Phase 0 code into `lib/`, add tooling, the core helpers (`config`, `errors`, `json`, `sh`), the 2.4 contract changes, the pdoom renderer retired (aligner kept), and a loadable plugin shell, so Phase 2 starts on a clean, linted, tested base.

**Architecture:** Plain functions under `lib/`: `contracts/` (Zod schemas + adapter interfaces, imports nothing from `lib/`), `core/` (the only env reader, the only process spawner, validated JSON IO, error classes), `adapters/` (factories that take `Deps = { sh, config }` so tests pass fakes). The plugin shell is `.claude-plugin/` + one placeholder skill.

**Tech Stack:** bun 1.4.2 (pinned, `node_modules/.bin/bun`), TypeScript 7.0.2 (`tsc --noEmit`), Biome 2.5.15, zod ^4.1, ruff 0.16.10 via uv 0.11.6, Python 3.13, Claude Code 2.1.295 (`claude plugin validate`), ffmpeg 9.0, HyperFrames 0.8.143 (version pin only in this phase).

**Spec:** `docs/BLUEPRINT.md` (Part 5 Phase 1; 2.4 data models; 2.5 adapter functions; 2.6 safeguards; 2.7 settings) and `docs/AGENT_PROMPT.md` (coding standard).

## Global Constraints

- Call bun as `node_modules/.bin/bun` from the repo root, never the global bun (1.3.5 cannot launch Chrome on Windows).
- `HYPERFRAMES_VERSION = '0.8.143'`, exact.
- Dev tools pinned exactly: `typescript@7.0.2`, `@biomejs/biome@2.5.15`, `ruff==0.16.10`. Runtime dependency `zod@^4.1.0` (already installed).
- Only `lib/core/config.ts` reads `process.env` / `Bun.env`. Only `lib/core/sh.ts` spawns processes (`Bun.spawn`, `Bun.spawnSync`, `node:child_process`). Tests never read the real environment: they pass an env object to `loadConfig(env)`. (Code strings run inside a child process, as in `sh.test.ts`, are the child's business.)
- `lib/contracts/` imports nothing from `lib/`. Adapters never import each other.
- Every child process gets `HYPERFRAMES_NO_TELEMETRY=1`, `HYPERFRAMES_SKIP_SKILLS=1`, `PYTHONUTF8=1`, and never gets `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY` or `GEMINI_API_KEY`.
- JSON files: 1-space indent, LF, trailing newline, written only through `writeJson`.
- Windows 11 is the primary platform. Paths are built with `node:path`.
- Nothing ever writes to `C:\Work-data\video-testing` or `C:\Work-data\kinomat`.
- `tests/fixture/` is read-only for builders.
- English only in v1 (BLUEPRINT 1.6).

## Review Focus

1. **API keys in the environment** (bun auto-loads `.env`) must not reach HyperFrames, Python or any other child process, whatever the key's letter case on Windows. Pinned by the `toolEnv` tests in Task 4.
2. **A hung tool on Windows** (Chrome, a `cmd`-wrapped node) must be killed with its whole process tree when the timeout fires, not orphaned. Pinned by the tree-kill test in Task 5.
3. **A hand-edited or truncated run-folder JSON file** must fail with a `ContractError` naming the file, never a bare `SyntaxError`. Pinned in Task 4.
4. **A URL source (`product_url`, `link`) or `cite` that is not http(s)** (`file:///…`, `javascript:…`) must be rejected at the brief / script, because Playwright and WebFetch will open them in Phase 3. Pinned in Task 6.
5. **A missing audio file or empty script** handed to the aligner must fail fast with the path or reason named, before `uv` starts. Pinned in Task 7.

## Rulings made in this plan (orchestrator, 2026-10-09; listed in the phase summary)

- R1. The move from `.claude/skills/video-machine/` to `lib/` is a pure `git mv` done by the orchestrator (the source folder is outside every builder's fence). Builders fix what breaks.
- R2. Adapters are exported as factories taking `Deps = { sh, config }` with a default (`ctcOnnx(deps = defaultDeps())`), so tests pass fakes. This replaces the AGENT_PROMPT example `export const hfTts: VoiceAdapter`.
- R3. `readJson` / `writeJson` move from `contracts/types.ts` to `lib/core/json.ts`, because they throw `ContractError` and `contracts/` may not import from `lib/`.
- R4. `RenderAdapter` and `AlignAdapter` follow BLUEPRINT 2.5 and become async: `scaffold`/`plateApi` (pdoom-only plate API) are dropped, `check` is added. No renderer implements `RenderAdapter` until `render/hyperframes` (Phase 6).
- R5. `toolEnv` strips API keys (case-insensitive) before any child process sees the env.
- R6. *(Withdrawn 2026-10-10: the user retired pdoom, so there is no Canvas2D mode or GPU-era baseline to compare.)*
- R7. `bun run format` runs `biome check --write` (format + import order + safe fixes) and `ruff format`. Running `bun run format` is allowed through Bash, like package managers.
- R8. `Brief.formats` defaults to `['reel']` (BLUEPRINT 1.6 "Formats v1" and 2.7).

User rulings 2026-10-10 (BLUEPRINT v1.1, commit `e293e48`) folded in: skill `make-video` (Task 3); `Brief.sources`,
`AssetRef.origin`, `Script` `section` / `cite`, `Plan.sections` (Task 6); the spike starts from a concept only.
User ruling 2026-10-10: **pdoom retired** (BLUEPRINT 1.6). Orchestrator pre-step 2 + Task 1b remove it; Task 7 covers the aligner
only; Task 8 is withdrawn.

---

### Orchestrator pre-step (before Task 1, not a builder task)

```bash
git mv .claude/skills/video-machine/contracts lib/contracts
git mv .claude/skills/video-machine/adapters lib/adapters
git commit -m "chore: move contracts and adapters to lib/ (no edits)"
```

Then confirm `.claude/skills/` is empty and remove it. Imports are now broken; Task 1 fixes them.

---

### Task 1: Fix paths after the move (Phase 0 passes again)

**Agent:** lib-builder

**Read first:**
- `lib/adapters/render/pdoom/index.ts`
- `lib/adapters/align/ctc-onnx/index.ts`
- `lib/adapters/align/ctc-onnx/align.py`
- `tests/phase0.ts`
- BLUEPRINT Part 4 (folder structure)

**Files:**
- Modify: `lib/adapters/render/pdoom/index.ts` (the `WORKSPACE` constant)
- Modify: `lib/adapters/align/ctc-onnx/index.ts` (the `WORKSPACE` constant)
- Modify: `lib/adapters/align/ctc-onnx/align.py` (the `ANALYSIS` constant)
- Modify: `tests/phase0.ts` (three import paths)

**Interfaces:**
- Consumes: nothing new.
- Produces: the same exports as before, now at `lib/contracts/types.ts`, `lib/adapters/render/pdoom/index.ts`, `lib/adapters/align/ctc-onnx/index.ts`.

**Tests first:** the existing acceptance script is the test.

- [ ] **Step 1: Run Phase 0 to see it fail**

Run: `node_modules/.bin/bun tests/phase0.ts`
Expected: crash with `Cannot find module '../.claude/skills/video-machine/adapters/render/pdoom'`.

- [ ] **Step 2: Fix the paths**

The adapters used to sit 6 folders below the repo root and now sit 4 below it:

```ts
// lib/adapters/render/pdoom/index.ts and lib/adapters/align/ctc-onnx/index.ts
const WORKSPACE = path.resolve(import.meta.dir, '../../../..');
```

```python
# lib/adapters/align/ctc-onnx/align.py   (parents[0]=ctc-onnx, [1]=align, [2]=adapters, [3]=lib, [4]=repo root)
ANALYSIS = Path(__file__).resolve().parents[4] / "engine" / "analysis"
```

```ts
// tests/phase0.ts: same names as today, only the paths change
import { pdoom } from '../lib/adapters/render/pdoom';
import { align } from '../lib/adapters/align/ctc-onnx';
import { readJson, TimingSchema } from '../lib/contracts/types';
```

The `contracts` import inside each adapter (`'../../../contracts/types'`) is still correct after the move; leave it.

- [ ] **Step 3: Run Phase 0 to see it pass**

Run: `node_modules/.bin/bun tests/phase0.ts` (takes a few minutes; it renders with Chrome and runs the aligner)
Expected: `4/4 passed`.

**Done when:** `node_modules/.bin/bun tests/phase0.ts` prints `4/4 passed`, and `git grep -n "skills/video-machine" -- lib tests` prints nothing.

---

### Orchestrator pre-step 2 (after Task 1, not a builder task): retire pdoom

User ruling 2026-10-10. Pure moves and deletes; `engine/` and the fixture are outside every builder's fence for these.

```bash
mkdir -p lib/adapters/align/ctc-onnx/analysis/models
git mv engine/analysis/align_vo.py engine/analysis/audio_vo.py engine/LICENSE.pdoom-engine lib/adapters/align/ctc-onnx/analysis/
git mv engine/analysis/models/vocab.json engine/analysis/models/preprocessor_config.json lib/adapters/align/ctc-onnx/analysis/models/
mv engine/analysis/models/w2v2_base_960h_q.onnx lib/adapters/align/ctc-onnx/analysis/models/   # git-ignored (*.onnx)
git rm -r -q engine lib/adapters/render/pdoom tests/baseline tests/fixture/scenes tests/fixture/timeline.ts tests/fixture/audio/sfx
rm -rf engine                      # untracked leftovers (node_modules, __pycache__, out/)
git commit -m "chore: retire pdoom; keep aligner scripts and model under ctc-onnx/analysis"
```

`align_vo.py` / `audio_vo.py` compute `ROOT = Path(__file__).resolve().parent.parent` and the model as
`ROOT / "analysis" / "models" / ...`, so after the move they resolve to `lib/adapters/align/ctc-onnx/analysis/models/`
without edits. `align.py` and `tests/phase0.ts` break; Task 1b fixes them.

---

### Task 1b: Phase 0 test without pdoom

**Agent:** lib-builder

**Read first:**
- BLUEPRINT 1.6 (pdoom engine row: retired)
- `tests/phase0.ts`, `lib/adapters/align/ctc-onnx/align.py`

**Files:**
- Modify: `lib/adapters/align/ctc-onnx/align.py` (the `ANALYSIS` constant and the docstring's first line)
- Modify: `tests/phase0.ts`

**Interfaces:**
- Consumes: nothing new. Produces: `tests/phase0.ts` with two checks.

- [ ] **Step 1: See it fail**

Run: `node_modules/.bin/bun tests/phase0.ts`
Expected: crash with `Cannot find module '../lib/adapters/render/pdoom'`.

- [ ] **Step 2: Fix**

- `align.py`: `ANALYSIS = Path(__file__).resolve().parent / "analysis"`; docstring line 1 says it drives the vendored
  `analysis/align_vo.py` and `audio_vo.py` unchanged. Update the `noqa` comment on `import align_vo` to say MODEL/VOCAB
  point at `analysis/models`.
- `tests/phase0.ts`: delete checks 1 (landscape stills vs baseline) and 3 (reel still), the `pdoom` import, `TIMES`,
  `ATTEMPTS` and their comment, and the now-unused imports. Renumber: `1. fixture alignment within 10 ms`,
  `2. video-testing unchanged since before Phase 0`. Header comment lists exactly these two. Everything inside the two
  kept checks stays as it is.

- [ ] **Step 3: Verify**

Run: `node_modules/.bin/bun tests/phase0.ts` → both checks PASS, last line `2/2 passed`.

**Done when:** that passes, and `git grep -n "pdoom\|render/" -- lib tests/phase0.ts ':!lib/adapters/align/ctc-onnx/analysis'` prints only the
`LICENSE.pdoom-engine` attribution lines (if any). `tests/fixture/` and `tests/phase0/video-testing.before.txt` are data.

---

### Task 2: Tooling (tsconfig, Biome, ruff, lint/format scripts, first unit test)

**Agent:** lib-builder

**Read first:**
- `package.json`, `pyproject.toml`, `.gitignore`
- `lib/contracts/types.ts` (only `FORMATS` and `frameOf`)
- AGENT_PROMPT §1 (tooling)

**Files:**
- Create: `tsconfig.json`, `biome.json`, `lib/contracts/types.test.ts`
- Modify: `package.json` (dev dependencies, scripts), `pyproject.toml` (ruff dev dependency, `[tool.ruff]`)
- Modify (lint fixes only, no behaviour change): `lib/**/*.ts`, `lib/adapters/align/ctc-onnx/align.py`, `tests/phase0.ts`

**Interfaces:**
- Produces: `node_modules/.bin/bun test` and `node_modules/.bin/bun run lint` / `bun run format` for every later task.

- [ ] **Step 1: Write the failing test** — `lib/contracts/types.test.ts`

```ts
import { expect, test } from 'bun:test';
import { frameOf } from './types';

test('frameOf gives the reel frame as vertical 1080x1920 with its safe area', () => {
  expect(frameOf('reel')).toEqual({
    w: 1080,
    h: 1920,
    aspect: 'vertical',
    safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 },
  });
});
```

- [ ] **Step 2: Run it**

Run: `node_modules/.bin/bun test`
Expected: PASS (1 test). This test pins existing behaviour; the failing part of this task is lint (Step 4).

- [ ] **Step 3: Add the tools**

```bash
node_modules/.bin/bun add -d --exact typescript@7.0.2 @biomejs/biome@2.5.15
uv add --dev ruff==0.16.10
```

`package.json` scripts (add the block; keep everything else bun wrote):

```json
"scripts": {
  "lint": "tsc --noEmit && biome check . && uv run ruff check",
  "format": "biome check --write . && uv run ruff format"
}
```

`tsconfig.json` (probed: TypeScript 7.0.2 compiles today's contracts with these options and no errors):

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "types": ["bun"]
  },
  "include": ["lib", "tests"],
  "exclude": ["tests/fixture", "tests/out", "runs", "node_modules"]
}
```

`biome.json` (matches the existing code style: 2 spaces, single quotes, 120 columns):

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!tests/fixture", "!runs", "!.claude"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 120 },
  "linter": { "enabled": true, "rules": { "preset": "recommended" } },
  "javascript": { "formatter": { "quoteStyle": "single" } },
  "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
```

`pyproject.toml` (append):

```toml
[tool.ruff]
line-length = 120
extend-exclude = ["lib/adapters/align/ctc-onnx/analysis", "tests/fixture", "runs"]  # vendored aligner scripts stay as lifted
```

- [ ] **Step 4: Run lint to see it fail**

Run: `node_modules/.bin/bun run lint`
Expected: FAIL. Probed findings on today's code: Biome formatting and import order in `lib/contracts/types.ts`, `lint/style/useTemplate` (`JSON.stringify(...) + '\n'`); ruff `E401` (`import json, sys, tempfile`) and `E741` (variable `l`) in `align.py`; possibly `noUncheckedIndexedAccess` errors in `tests/phase0.ts`.

- [ ] **Step 5: Fix**

Run `node_modules/.bin/bun run format`, then fix what remains by hand without changing behaviour (template literal; one import per line; rename `l` to `line`; add `!` or a guard where an index may be undefined). Do not add `biome-ignore` or `# noqa` comments except the existing `# noqa: E402` in `align.py`.

- [ ] **Step 6: Verify**

Run: `node_modules/.bin/bun test` → `1 pass`, `0 fail`.
Run: `node_modules/.bin/bun run lint` → exit 0, no findings.

**Done when:** both commands above pass, and `node_modules/.bin/bun tests/phase0.ts` still prints `4/4 passed` (the format pass touched `phase0.ts` and the adapters).

---

### Task 3: Plugin shell (manifest, marketplace, placeholder `make-video` skill)

**Agent:** plugin-builder

**Read first:**
- BLUEPRINT Part 4 (folder structure) and 2.2 (plugin runtime row)

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/make-video/SKILL.md`

**Interfaces:**
- Produces: plugin name `video-machine`, skill `make-video` (Phase 2 replaces the body).

- [ ] **Step 1: Run the checks to see them fail**

Run: `claude plugin validate .claude-plugin/plugin.json --strict --json`
Expected: failure (file not found).

- [ ] **Step 2: Create the files** (2-space JSON, because Biome checks these files)

`.claude-plugin/plugin.json`:

```json
{
  "name": "video-machine",
  "version": "0.1.0",
  "description": "Turns a concept and any source material into a motion-graphics video (reels first).",
  "author": { "name": "Sumit Chakraborty" }
}
```

`.claude-plugin/marketplace.json` (the top-level `description` silences the only strict-mode warning, probed):

```json
{
  "name": "video-machine",
  "description": "Marketplace for the Video Machine Claude Code plugin.",
  "owner": { "name": "Sumit Chakraborty" },
  "plugins": [
    {
      "name": "video-machine",
      "source": "./",
      "description": "Concept + any source material to a motion-graphics video (reels first)."
    }
  ]
}
```

`skills/make-video/SKILL.md`:

```markdown
---
name: make-video
description: Use when the creator wants a motion-graphics video (reel first; long-form later) made from a concept, with optional navigation videos, product URL, files or links.
---

# Make a video

Phase 1 placeholder. The procedure arrives in Phase 2. Tell the creator that the Video Machine is still being built and
that no video can be made yet. Do not try to make one by other means.
```

No `license` field: the plugin's licence is decided in Phase 10 (Polish).

- [ ] **Step 3: Verify**

Run: `claude plugin validate .claude-plugin/plugin.json --strict --json` → `"success": true`, no errors, no warnings.
Run: `claude plugin validate .claude-plugin/marketplace.json --strict --json` → `"success": true`, no errors, no warnings.
Run: `claude --plugin-dir . plugin details video-machine` → output contains `Skills (1)  make-video`.

**Done when:** the three commands above give those results. (`bun run lint` is checked by the orchestrator; Biome reads these JSON files.)

---

### Task 4: Core — `errors.ts`, `config.ts`, `json.ts`

**Agent:** lib-builder

**Read first:**
- AGENT_PROMPT §6 (config), §7 (errors), §9 (JSON format)
- BLUEPRINT 2.6 (Privacy, Secrets rows) and 2.7 (settings table)
- `lib/contracts/types.ts` (the `readJson` / `writeJson` functions at the bottom)
- `lib/adapters/align/ctc-onnx/index.ts` and `tests/phase0.ts` (they import `readJson`)

**Files:**
- Create: `lib/core/errors.ts`, `lib/core/errors.test.ts`, `lib/core/config.ts`, `lib/core/config.test.ts`, `lib/core/json.ts`, `lib/core/json.test.ts`
- Modify: `lib/contracts/types.ts` (delete `readJson`, `writeJson` and the now-unused `node:fs` / `node:path` imports)
- Modify: `lib/adapters/align/ctc-onnx/index.ts`, `tests/phase0.ts` (import `readJson` from `lib/core/json`)

**Interfaces:**
- Produces:
  - `class VideoMachineError extends Error` (`name` = the subclass name); `ContractError`, `UnsupportedError` extend it.
  - `class ToolError extends VideoMachineError` with `constructor(o: { cmd: string[]; code: number | null; stderr: string; timedOut?: boolean }, options?: ErrorOptions)` and readonly `cmd`, `code`, `stderrTail` (last 2048 chars), `timedOut`.
  - `type Env = Record<string, string | undefined>`
  - `type Config = { pluginRoot: string; vmHome: string; bun: string; toolEnv: Env }`
  - `const HYPERFRAMES_VERSION = '0.8.143'`, `const PLUGIN_ROOT: string`, `const SECRET_ENV: readonly string[]`
  - `function loadConfig(env: Env = process.env): Config`
  - `function readJson<T extends z.ZodType>(file: string, schema: T): z.infer<T>`
  - `function writeJson<T extends z.ZodType>(file: string, schema: T, data: z.input<T>): z.infer<T>`

- [ ] **Step 1: Write the failing tests**

`lib/core/errors.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { ContractError, ToolError, UnsupportedError, VideoMachineError } from './errors';

test('subclasses are VideoMachineErrors and carry their own name', () => {
  for (const e of [new ContractError('x'), new UnsupportedError('y')]) {
    expect(e).toBeInstanceOf(VideoMachineError);
    expect(e).toBeInstanceOf(Error);
  }
  expect(new ContractError('x').name).toBe('ContractError');
  expect(new UnsupportedError('y').name).toBe('UnsupportedError');
});

test('errors keep their cause', () => {
  const cause = new SyntaxError('bad');
  expect(new ContractError('wrap', { cause }).cause).toBe(cause);
});

test('ToolError keeps the command, exit code and only the last 2 KB of stderr', () => {
  const e = new ToolError({ cmd: ['ffmpeg', '-i', 'x.mp4'], code: 3, stderr: `${'a'.repeat(5000)}END` });
  expect(e.name).toBe('ToolError');
  expect(e.cmd).toEqual(['ffmpeg', '-i', 'x.mp4']);
  expect(e.code).toBe(3);
  expect(e.timedOut).toBe(false);
  expect(e.stderrTail.length).toBe(2048);
  expect(e.stderrTail.endsWith('END')).toBe(true);
  expect(e.message).toContain('ffmpeg -i x.mp4');
  expect(e.message).toContain('exit 3');
});

test('ToolError says when the command timed out', () => {
  const e = new ToolError({ cmd: ['hyperframes', 'render'], code: null, stderr: '', timedOut: true });
  expect(e.timedOut).toBe(true);
  expect(e.message).toContain('timed out');
});
```

`lib/core/config.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { HYPERFRAMES_VERSION, loadConfig, PLUGIN_ROOT, SECRET_ENV } from './config';

test('HyperFrames is pinned to 0.8.143', () => {
  expect(HYPERFRAMES_VERSION).toBe('0.8.143');
});

test('PLUGIN_ROOT is the repo root', () => {
  expect(existsSync(path.join(PLUGIN_ROOT, 'package.json'))).toBe(true);
  expect(existsSync(path.join(PLUGIN_ROOT, 'lib', 'core', 'config.ts'))).toBe(true);
});

test('vmHome defaults to ~/.video-machine', () => {
  expect(loadConfig({}).vmHome).toBe(path.join(homedir(), '.video-machine'));
});

test('VM_HOME overrides vmHome', () => {
  expect(loadConfig({ VM_HOME: 'some/vm-home' }).vmHome).toBe(path.resolve('some/vm-home'));
});

test('bun is the pinned bun inside the plugin', () => {
  expect(loadConfig({}).bun.startsWith(path.join(PLUGIN_ROOT, 'node_modules', '.bin', 'bun'))).toBe(true);
});

test('toolEnv keeps the parent env and switches off telemetry, skills installs and cp1252 pipes', () => {
  expect(loadConfig({ PATH: '/bin', FOO: 'bar' }).toolEnv).toMatchObject({
    PATH: '/bin',
    FOO: 'bar',
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    PYTHONUTF8: '1',
  });
});

test('a parent setting cannot switch telemetry back on', () => {
  expect(loadConfig({ HYPERFRAMES_NO_TELEMETRY: '0' }).toolEnv.HYPERFRAMES_NO_TELEMETRY).toBe('1');
});

test('toolEnv never hands API keys to child processes', () => {
  expect(SECRET_ENV).toEqual(expect.arrayContaining(['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY']));
  const env = Object.fromEntries(SECRET_ENV.map((k) => [k, 'secret']));
  const { toolEnv } = loadConfig({ ...env, PATH: '/bin' });
  for (const k of SECRET_ENV) expect(toolEnv[k]).toBeUndefined();
  expect(toolEnv.PATH).toBe('/bin');
});

test('API keys are removed whatever their letter case (Windows env names ignore case)', () => {
  const { toolEnv } = loadConfig({ heygen_api_key: 'secret', Gemini_Api_Key: 'secret' });
  expect(Object.keys(toolEnv).some((k) => k.toUpperCase().endsWith('_API_KEY'))).toBe(false);
});
```

`lib/core/json.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ContractError } from './errors';
import { readJson, writeJson } from './json';

const Schema = z.object({ n: z.number(), tag: z.string().default('x') });
const tmp = () => mkdtempSync(path.join(tmpdir(), 'vm-'));

test('writeJson creates folders and writes 1-space JSON with LF and a trailing newline', () => {
  const f = path.join(tmp(), 'a', 'b.json');
  writeJson(f, Schema, { n: 1 });
  expect(readFileSync(f, 'utf8')).toBe('{\n "n": 1,\n "tag": "x"\n}\n');
});

test('writeJson refuses invalid data and writes nothing', () => {
  const f = path.join(tmp(), 'bad.json');
  expect(() => writeJson(f, Schema, { n: 'one' } as never)).toThrow(ContractError);
  expect(existsSync(f)).toBe(false);
});

test('readJson returns the parsed data with defaults applied', () => {
  const f = path.join(tmp(), 'ok.json');
  writeFileSync(f, '{"n": 2}');
  expect(readJson(f, Schema)).toEqual({ n: 2, tag: 'x' });
});

test('readJson names the file when it does not match the schema', () => {
  const f = path.join(tmp(), 'wrong.json');
  writeFileSync(f, '{"n": "two"}');
  expect(() => readJson(f, Schema)).toThrow(ContractError);
  expect(() => readJson(f, Schema)).toThrow(f);
});

test('readJson turns malformed JSON into a ContractError that names the file and keeps the cause', () => {
  const f = path.join(tmp(), 'broken.json');
  writeFileSync(f, '{"n": ');
  let caught: unknown;
  try {
    readJson(f, Schema);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ContractError);
  expect((caught as Error).message).toContain(f);
  expect((caught as Error).cause).toBeInstanceOf(SyntaxError);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/bun test lib/core`
Expected: FAIL, `Cannot find module './errors'` (and `./config`, `./json`).

- [ ] **Step 3: Implement**

`lib/core/errors.ts`:

```ts
/** Base class of every error the Video Machine throws on purpose. */
export class VideoMachineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A run-folder file does not match its schema, or is not JSON at all. */
export class ContractError extends VideoMachineError {}

/** The caller asked for something this adapter does not do (never faked). */
export class UnsupportedError extends VideoMachineError {}

/** A child process failed, could not start, or timed out. */
export class ToolError extends VideoMachineError {
  readonly cmd: string[];
  readonly code: number | null;
  readonly stderrTail: string;
  readonly timedOut: boolean;

  constructor(o: { cmd: string[]; code: number | null; stderr: string; timedOut?: boolean }, options?: ErrorOptions) {
    const stderrTail = o.stderr.slice(-2048);
    const how = o.timedOut ? 'timed out' : `exit ${o.code ?? 'none'}`;
    super(`${how}: ${o.cmd.join(' ')}\n${stderrTail}`.trimEnd(), options);
    this.cmd = o.cmd;
    this.code = o.code;
    this.stderrTail = stderrTail;
    this.timedOut = o.timedOut ?? false;
  }
}
```

`lib/core/config.ts` notes:
- `PLUGIN_ROOT = path.resolve(import.meta.dir, '../..')`.
- `bun = path.join(PLUGIN_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.exe' : 'bun')` (the pinned bun; Phase 0 found the global 1.3.5 cannot launch Chrome).
- `vmHome = path.resolve(env.VM_HOME ?? path.join(homedir(), '.video-machine'))`.
- `SECRET_ENV = ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'] as const`.
- `toolEnv`: copy `env`, drop every key whose `toUpperCase()` is in `SECRET_ENV`, then set `HYPERFRAMES_NO_TELEMETRY: '1'`, `HYPERFRAMES_SKIP_SKILLS: '1'`, `PYTHONUTF8: '1'` last so the parent cannot override them.
- `loadConfig` takes `env` as a parameter (default `process.env`) so tests never touch the real environment. JSDoc on every export.

`lib/core/json.ts`: move the two functions from `contracts/types.ts` and change only the error handling:
- `readJson`: wrap `JSON.parse` so a `SyntaxError` becomes `new ContractError(\`${file} is not valid JSON\`, { cause })`; a schema mismatch becomes `new ContractError(\`${file} does not match its schema:\n${z.prettifyError(r.error)}\`)`. A missing file is not caught (the fs error already names the path).
- `writeJson`: invalid data → `new ContractError(\`refusing to write ${file}:\n...\`)`; otherwise `mkdirSync(dirname, { recursive: true })` and write `` `${JSON.stringify(r.data, null, 1)}\n` ``.

Update the two importers (`lib/adapters/align/ctc-onnx/index.ts`, `tests/phase0.ts`) to import `readJson` from `lib/core/json` and keep `TimingSchema` from `lib/contracts/types`.

- [ ] **Step 4: Verify**

Run: `node_modules/.bin/bun test` → all pass (1 + 4 + 9 + 5 = 19 tests).
Run: `node_modules/.bin/bun run lint` → clean.

**Done when:** both pass, and `git grep -n "process.env\|Bun.env" -- lib ':!lib/core/config.ts'` prints only lines in the two adapters (removed in Task 7).

---

### Task 5: Core — `sh.ts` (the only process runner)

**Agent:** lib-builder

**Read first:**
- AGENT_PROMPT §4 (module layout) and §7 (errors)
- BLUEPRINT 2.6 (Orphaned processes row)
- `lib/core/errors.ts`, `lib/core/config.ts` (from Task 4)

**Files:**
- Create: `lib/core/sh.ts`, `lib/core/sh.test.ts`

**Interfaces:**
- Consumes: `ToolError`, `loadConfig`, `Env` (Task 4).
- Produces:
  - `type ShResult = { code: number; stdout: string; stderr: string }`
  - `type ShOptions = { cwd?: string; env?: Env; timeoutMs?: number; allowFail?: boolean }`
  - `type Sh = (cmd: string[], opts?: ShOptions) => Promise<ShResult>`
  - `const DEFAULT_TIMEOUT_MS = 600_000`
  - `const sh: Sh`

Probed on this machine (bun 1.4.2, Windows 11): `proc.kill()` on a `cmd /c node …` child leaves the node grandchild running; `taskkill /T /F /PID <pid>` kills both. `claude`, `npx`, `uv`, `ffmpeg` all spawn by bare name.

- [ ] **Step 1: Write the failing tests** — `lib/core/sh.test.ts`

```ts
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';
import { ToolError } from './errors';
import { sh } from './sh';

const js = (code: string) => [process.execPath, '-e', code]; // the bun running the tests

test('returns code, stdout and stderr of a successful command', async () => {
  const r = await sh(js("process.stdout.write('out'); process.stderr.write('err')"));
  expect(r).toEqual({ code: 0, stdout: 'out', stderr: 'err' });
});

test('throws a ToolError with the exit code and stderr when the command fails', async () => {
  const e = await sh(js("process.stderr.write('boom'); process.exit(3)")).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ToolError);
  expect((e as ToolError).code).toBe(3);
  expect((e as ToolError).stderrTail).toBe('boom');
});

test('allowFail returns a failed result instead of throwing', async () => {
  const r = await sh(js("process.stdout.write('{}'); process.exit(1)"), { allowFail: true });
  expect(r).toEqual({ code: 1, stdout: '{}', stderr: '' });
});

test('a missing executable is a ToolError', async () => {
  await expect(sh(['vm-no-such-tool-xyz'])).rejects.toBeInstanceOf(ToolError);
});

test('an empty command is rejected before anything is spawned', async () => {
  await expect(sh([])).rejects.toBeInstanceOf(ToolError);
});

test('passes cwd and env to the child', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  const env = { ...loadConfig().toolEnv, VM_T: 'yes' };
  const r = await sh(js("process.stdout.write(process.cwd() + '|' + process.env.VM_T)"), { cwd: dir, env });
  expect(r.stdout.endsWith(`${path.basename(dir)}|yes`)).toBe(true);
});

test('without an env the child gets the tool env (telemetry off)', async () => {
  const r = await sh(js('process.stdout.write(String(process.env.HYPERFRAMES_NO_TELEMETRY))'));
  expect(r.stdout).toBe('1');
});

test('a command that outlives its timeout is killed and reported as timed out', async () => {
  const e = await sh(js('setInterval(() => {}, 1e6)'), { timeoutMs: 500 }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ToolError);
  expect((e as ToolError).timedOut).toBe(true);
});

test.skipIf(process.platform !== 'win32')(
  'on Windows the timeout kills the whole process tree, not just the child',
  async () => {
    const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'vm-')), 'gc.pid').replaceAll('\\', '/');
    const script = `require('fs').writeFileSync('${pidFile}', String(process.pid)); setInterval(() => {}, 1e6)`;
    const e = await sh(['cmd', '/c', 'node', '-e', script], { timeoutMs: 2000 }).catch((x: unknown) => x);
    expect((e as ToolError).timedOut).toBe(true);
    await Bun.sleep(300);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(grandchild, 0)).toThrow(); // gone
  },
  15_000,
);
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/bun test lib/core/sh.test.ts`
Expected: FAIL, `Cannot find module './sh'`.

- [ ] **Step 3: Implement** — `lib/core/sh.ts`

```ts
import { type Env, loadConfig } from './config';
import { ToolError } from './errors';

export type ShResult = { code: number; stdout: string; stderr: string };
export type ShOptions = { cwd?: string; env?: Env; timeoutMs?: number; allowFail?: boolean };
export type Sh = (cmd: string[], opts?: ShOptions) => Promise<ShResult>;

export const DEFAULT_TIMEOUT_MS = 600_000;

/** Kill a process and everything it started. */
const killTree = (proc: Bun.Subprocess): void => {
  if (process.platform === 'win32') {
    // proc.kill() orphans grandchildren on Windows (cmd → node, bunx → vite; probed in Phase 0 and Phase 1)
    Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(proc.pid)]);
    return;
  }
  // ponytail: kills only the direct child on macOS/Linux; spawn detached and kill the process group if grandchildren leak
  proc.kill('SIGKILL');
};

/**
 * Run a command with a timeout. Returns code, stdout and stderr.
 * Throws ToolError when the command cannot start, times out (after killing its whole tree), or exits non-zero
 * (unless `allowFail`). Without `env`, the child gets `loadConfig().toolEnv` (telemetry off, API keys removed).
 */
export const sh: Sh = async (cmd, opts = {}) => {
  const { cwd, env = loadConfig().toolEnv, timeoutMs = DEFAULT_TIMEOUT_MS, allowFail = false } = opts;
  if (cmd.length === 0) throw new ToolError({ cmd, code: null, stderr: 'empty command' });
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn(cmd, { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (cause) {
    throw new ToolError({ cmd, code: null, stderr: (cause as Error).message }, { cause });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(proc);
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));
  if (timedOut) throw new ToolError({ cmd, code: null, stderr, timedOut: true });
  if (code !== 0 && !allowFail) throw new ToolError({ cmd, code, stderr });
  return { code, stdout, stderr };
};
```

If `Bun.spawn` does not throw synchronously for a missing executable on this bun, but the process exits with an error instead, the test still requires a `ToolError`; adjust the catch, not the test.

- [ ] **Step 4: Verify**

Run: `node_modules/.bin/bun test` → all pass (19 + 9 = 28; on non-Windows one skip).
Run: `node_modules/.bin/bun run lint` → clean.

**Done when:** both pass, and no process is left running after the test run (`tasklist | findstr node` shows no `node.exe` started by the tests).

---

### Task 6: Contract changes from BLUEPRINT 2.4

**Agent:** lib-builder

**Read first:**
- BLUEPRINT 2.4 (data models), 2.7 (`brief.formats` default), 1.6 (Inputs, Navigation video, Resources, Formats v1, Avatar, Language rows)
- `lib/contracts/types.ts`, `lib/contracts/types.test.ts`

**Files:**
- Modify: `lib/contracts/types.ts`, `lib/contracts/types.test.ts`

**Interfaces:**
- Produces (exact names; later phases use them):
  - `ScriptSchema` lines gain `delivery: 'voiceover' | 'avatar'` (default `'voiceover'`), `section?: string`, `cite?: string[]` (http(s) URLs, at least one when present).
  - `ScenePlanSchema` / `type ScenePlan` replace `PlatePlanSchema` / `PlatePlan`; field `scene_id` replaces `plate_id`; gains `section?: string`.
  - `PlanSchema.visuals_plan` is `{ scenes: ScenePlan[] }` (min 1). `PlanSchema` gains `sections?: { id: string; title: string }[]` (min 1 when present); every `ScenePlan.section` must name one of them.
  - `TestResultsSchema` check annotations use `scene_id` instead of `plate_id`; `type Issue` uses `scene_id` instead of `plate_id`.
  - `BriefSchema` gains `sources: Source[]` (default `[]`) and `avatar?: { source: 'adapter' | 'supplied'; adapter?: string; portrait?: string }`; loses `source_material`, `assets`, `references`; `formats` default becomes `['reel']`. `SourceSchema` / `type Source` = `{ kind: 'nav_video' | 'product_url' | 'file' | 'link'; path_or_url: string; note?: string }`, where `product_url` and `link` must be http(s) URLs.
  - `AssetRefSchema` gains `origin: 'supplied' | 'nav_video' | 'captured' | 'web' | 'found' | 'drawn'`.
  - New: `StepsSchema` / `type Steps`, `CaptureLogSchema` / `type CaptureLog`, `DoctorSchema` / `type Doctor`.

- [ ] **Step 1: Write the failing tests** — append to `lib/contracts/types.test.ts` (merge the import with the existing one)

```ts
import {
  AssetRefSchema,
  BriefSchema,
  CaptureLogSchema,
  DoctorSchema,
  PlanSchema,
  ScenePlanSchema,
  ScriptSchema,
  StepsSchema,
  TestResultsSchema,
} from './types';

const line = { id: 'l1', text: 'Ship faster.' };
const script = (lines: object[]) => ({ run_id: 'r', version: 1, lines });

test('script lines default to voiceover delivery', () => {
  expect(ScriptSchema.parse(script([line])).lines[0]?.delivery).toBe('voiceover');
});

test('script lines accept avatar delivery and reject anything else', () => {
  expect(ScriptSchema.parse(script([{ ...line, delivery: 'avatar' }])).lines[0]?.delivery).toBe('avatar');
  expect(ScriptSchema.safeParse(script([{ ...line, delivery: 'narrator' }])).success).toBe(false);
});

const scene = {
  scene_id: 'hook',
  lines: ['l1'],
  cut_in: { anchor: 'Ship', rule: 'on_word' },
  intent: 'open strong',
  beats: [],
  layout: {},
  transition_out: 'cut',
  asset_ids: [],
  input_hash: 'abc',
};

test('a scene plan is keyed by scene_id, not plate_id', () => {
  expect(ScenePlanSchema.parse(scene).scene_id).toBe('hook');
  const { scene_id, ...rest } = scene;
  expect(ScenePlanSchema.safeParse({ ...rest, plate_id: scene_id }).success).toBe(false);
});

test('plan.visuals_plan holds scenes, not plates', () => {
  const plan = { run_id: 'r', version: 1, look_id: 'a', asset_ids: [], formats: ['reel'] };
  expect(PlanSchema.safeParse({ ...plan, visuals_plan: { scenes: [scene] } }).success).toBe(true);
  expect(PlanSchema.safeParse({ ...plan, visuals_plan: { plates: [scene] } }).success).toBe(false);
});

test('check annotations point at a scene_id', () => {
  const results = TestResultsSchema.parse({
    run_id: 'r',
    plan_version: 1,
    output_paths: { stills: {}, contact_sheets: {}, drafts: {}, deliverables: [], report: 'report.md' },
    checks: [
      {
        id: 'layout.safe_area',
        blocking: true,
        status: 'fail',
        detail: '1 box outside',
        annotations: [{ scene_id: 'hook', t: 1.2, problem: 'title under the caption bar', suggested_fix: 'move up' }],
      },
    ],
    summary: { blocking_failed: 1, warnings: 0 },
  });
  expect(results.checks[0]?.annotations[0]?.scene_id).toBe('hook');
});

const brief = { run_id: 'r', concept: 'c', goals: [], duration_target_s: [15, 30], timing_source: 'voiceover' };

test('brief formats default to reel only', () => {
  expect(BriefSchema.parse(brief).formats).toEqual(['reel']);
});

test('a concept alone is a valid brief: sources default to empty', () => {
  expect(BriefSchema.parse(brief).sources).toEqual([]);
});

test('brief takes any mix of sources', () => {
  const sources = [
    { kind: 'nav_video', path_or_url: 'input/nav.mp4' },
    { kind: 'product_url', path_or_url: 'https://app.example.com/login' },
    { kind: 'file', path_or_url: 'input/logo.svg', note: 'logo' },
    { kind: 'link', path_or_url: 'http://blog.example.com/launch', note: 'competitor' },
  ];
  expect(BriefSchema.parse({ ...brief, sources }).sources).toHaveLength(4);
});

test('brief rejects a product_url or link source that is not an http(s) URL', () => {
  for (const kind of ['product_url', 'link']) {
    for (const bad of ['app dot example', 'file:///C:/Users/me/secrets.txt', 'javascript:alert(1)']) {
      expect(BriefSchema.safeParse({ ...brief, sources: [{ kind, path_or_url: bad }] }).success).toBe(false);
    }
  }
});

test('brief rejects an unknown source kind and an empty path', () => {
  expect(BriefSchema.safeParse({ ...brief, sources: [{ kind: 'dream', path_or_url: 'x' }] }).success).toBe(false);
  expect(BriefSchema.safeParse({ ...brief, sources: [{ kind: 'file', path_or_url: '' }] }).success).toBe(false);
});

test('brief no longer has source_material, assets or references', () => {
  const parsed = BriefSchema.parse({ ...brief, source_material: ['a'], assets: ['b'], references: [] });
  expect(Object.keys(parsed)).not.toContain('source_material');
  expect(Object.keys(parsed)).not.toContain('assets');
  expect(Object.keys(parsed)).not.toContain('references');
});

test('script lines take a section and http(s) cite URLs', () => {
  const parsed = ScriptSchema.parse(script([{ ...line, section: 'intro', cite: ['https://example.com/stats'] }]));
  expect(parsed.lines[0]?.cite).toEqual(['https://example.com/stats']);
  expect(ScriptSchema.safeParse(script([{ ...line, cite: ['not a url'] }])).success).toBe(false);
  expect(ScriptSchema.safeParse(script([{ ...line, cite: [] }])).success).toBe(false);
});

test('plan sections are optional, and a scene may only name a declared section', () => {
  const plan = { run_id: 'r', version: 1, look_id: 'a', asset_ids: [], formats: ['reel'] };
  const sections = [{ id: 'intro', title: 'Why it matters' }];
  const inIntro = { ...scene, section: 'intro' };
  expect(PlanSchema.safeParse({ ...plan, sections, visuals_plan: { scenes: [inIntro] } }).success).toBe(true);
  expect(PlanSchema.safeParse({ ...plan, visuals_plan: { scenes: [inIntro] } }).success).toBe(false);
  expect(PlanSchema.safeParse({ ...plan, sections: [], visuals_plan: { scenes: [scene] } }).success).toBe(false);
});

const asset = { asset_id: 'a1', kind: 'image', path: 'capture/shots/1.png', source: 'replay', license: 'own', usage: 'render' };

test('every asset records where it came from', () => {
  for (const origin of ['supplied', 'nav_video', 'captured', 'web', 'found', 'drawn']) {
    expect(AssetRefSchema.parse({ ...asset, origin }).origin).toBe(origin);
  }
  expect(AssetRefSchema.safeParse(asset).success).toBe(false);
  expect(AssetRefSchema.safeParse({ ...asset, origin: 'ai' }).success).toBe(false);
});

test('brief takes an optional avatar with a known source', () => {
  expect(BriefSchema.parse({ ...brief, avatar: { source: 'supplied', portrait: 'input/me.png' } }).avatar?.source).toBe(
    'supplied',
  );
  expect(BriefSchema.safeParse({ ...brief, avatar: { source: 'magic' } }).success).toBe(false);
});

const step = (i: number, extra: object = {}) => ({
  i,
  url: 'https://app.example.com',
  action: 'click',
  target: 'Export',
  expect: 'dialog opens',
  ...extra,
});

test('steps parse a click and a type with a value', () => {
  expect(StepsSchema.parse([step(0), step(1, { action: 'type', target: 'Name', value: 'Q3 report' })])).toHaveLength(2);
});

test('a type step without a value is rejected', () => {
  expect(StepsSchema.safeParse([step(0, { action: 'type' })]).success).toBe(false);
});

test('step numbers must go up', () => {
  expect(StepsSchema.safeParse([step(0), step(0)]).success).toBe(false);
  expect(StepsSchema.safeParse([step(1), step(0)]).success).toBe(false);
});

test('an unknown step action is rejected', () => {
  expect(StepsSchema.safeParse([step(0, { action: 'hover' })]).success).toBe(false);
});

const entry = { i: 0, t0: 1.2, t1: 3.4, url: 'https://app.example.com' };

test('capture log entries take an optional box, failure reason and fallback', () => {
  const log = CaptureLogSchema.parse([
    entry,
    { ...entry, i: 1, t0: 3.4, t1: 3.4, failed: 'target "Export" not found', fallback: 'capture/nav-frames/0012.png' },
    { ...entry, i: 2, box: { x: 10, y: 20, w: 300, h: 40 } },
  ]);
  expect(log[1]?.failed).toContain('Export');
});

test('a capture log entry cannot end before it starts', () => {
  expect(CaptureLogSchema.safeParse([{ ...entry, t0: 5, t1: 4 }]).success).toBe(false);
});

test('doctor.json records tool versions, paths and smoke timings', () => {
  const d = DoctorSchema.parse({
    checked_at: '2026-10-09T17:00:00Z',
    tools: {
      hyperframes: { ok: true, version: '0.8.143' },
      ffmpeg: { ok: true, version: '9.0', path: 'C:/ffmpeg/bin/ffmpeg.exe' },
      whisper: { ok: false, detail: 'not installed' },
    },
    smoke_s: { draft_render: 15.2 },
  });
  expect(d.tools.hyperframes?.version).toBe('0.8.143');
  expect(DoctorSchema.safeParse({ checked_at: 'yesterday', tools: {}, smoke_s: {} }).success).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/bun test lib/contracts`
Expected: FAIL (`ScenePlanSchema`, `StepsSchema`, `CaptureLogSchema`, `DoctorSchema` not exported; `delivery` undefined; formats default is `['landscape_1080p','reel']`; `sources` undefined; `source_material` still kept; `origin` not required).

- [ ] **Step 3: Implement** in `lib/contracts/types.ts`

- Script line: `delivery: z.enum(['voiceover', 'avatar']).default('voiceover')`, `section: z.string().min(1).optional()`, `cite: z.array(httpUrl).min(1).optional()` (`const httpUrl = z.url({ protocol: /^https?$/ })`, defined once and reused below).
- Rename `PlatePlanSchema` → `ScenePlanSchema`, `PlatePlan` → `ScenePlan`, `plate_id` → `scene_id` (same regex), add `section: z.string().optional()`; `visuals_plan: z.object({ scenes: z.array(ScenePlanSchema).min(1) })`.
- Plan: `sections: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]*$/), title: z.string().min(1) })).min(1).optional()`, plus a `.refine` on `PlanSchema`: every scene's `section` (when set) is one of `sections[].id` (message names the scene: `scene "hook" names unknown section "intro"`). Long-form (Phase 9) fills these; reels leave them out.
- `TestResultsSchema` annotations and `type Issue`: `plate_id` → `scene_id`.
- Brief: delete `references`, `assets`, `source_material`. Add
  ```ts
  // brief.sources: whatever the creator handed over besides concept.md (BLUEPRINT 1.6 Inputs). Empty = concept only.
  export const SourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['nav_video', 'file']), path_or_url: z.string().min(1), note: z.string().optional() }),
    z.object({ kind: z.enum(['product_url', 'link']), path_or_url: httpUrl, note: z.string().optional() }),
  ]);
  export type Source = z.infer<typeof SourceSchema>;
  ```
  (probed on the installed zod 4.6.5: an enum discriminator works, `javascript:` / `file:` URLs are rejected), `sources: z.array(SourceSchema).default([])`; `avatar: z.object({ source: z.enum(['adapter', 'supplied']), adapter: z.string().optional(), portrait: z.string().optional() }).optional()` with a `// ponytail:` comment that Phase 8 decides where a supplied clip's path lives; `formats: z.array(FormatIdSchema).min(1).default(['reel'])`.
- AssetRef: `origin: z.enum(['supplied', 'nav_video', 'captured', 'web', 'found', 'drawn'])` (required). `license` stays `z.string()`; `'unknown'` is allowed here and blocked at render by `assets.licensed` (Phase 6).
- New schemas (one `// capture/steps.json` style comment above each):

```ts
const StepSchema = z
  .object({
    i: z.number().int().min(0),
    url: z.string(),
    action: z.enum(['click', 'type', 'scroll', 'wait']),
    target: z.string(),
    value: z.string().optional(),
    expect: z.string(),
  })
  .refine((s) => s.action !== 'type' || s.value !== undefined, { message: 'a type step needs a value', path: ['value'] });
export const StepsSchema = z
  .array(StepSchema)
  .refine((steps) => steps.every((s, k) => k === 0 || s.i > (steps[k - 1]?.i ?? -1)), 'step numbers must go up');
export type Steps = z.infer<typeof StepsSchema>;

export const CaptureLogSchema = z.array(
  z
    .object({
      i: z.number().int().min(0),
      t0: z.number().min(0),
      t1: z.number().min(0),
      box: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
      url: z.string(),
      failed: z.string().optional(), // why the step failed, in words
      fallback: z.string().optional(), // run-relative path of the nav-video frame used instead
    })
    .refine((e) => e.t1 >= e.t0, { message: 't1 is before t0', path: ['t1'] }),
);
export type CaptureLog = z.infer<typeof CaptureLogSchema>;

export const DoctorSchema = z.object({
  checked_at: z.iso.datetime(),
  tools: z.record(
    z.string(),
    z.object({ ok: z.boolean(), version: z.string().optional(), path: z.string().optional(), detail: z.string().optional() }),
  ),
  smoke_s: z.record(z.string(), z.number().min(0)),
});
export type Doctor = z.infer<typeof DoctorSchema>;
```

Do not touch the adapter interfaces in this task (Task 7 does).

- [ ] **Step 4: Verify**

Run: `node_modules/.bin/bun test` → all pass.
Run: `node_modules/.bin/bun run lint` → clean.

**Done when:** both pass, and `git grep -n "plate_id\|PlatePlan\|plates" -- lib` prints nothing.

---

### Task 7: Adapters on core (`Deps`, `sh`, async interfaces)

**Agent:** lib-builder

**Read first:**
- BLUEPRINT 2.5 (adapter functions)
- AGENT_PROMPT §4 (module layout), §7 (errors)
- `lib/contracts/types.ts` (the adapter interfaces at the end)
- `lib/core/config.ts`, `lib/core/sh.ts`, `lib/core/errors.ts`, `lib/core/json.ts`
- `lib/adapters/align/ctc-onnx/index.ts`
- `tests/phase0.ts`

**Files:**
- Create: `lib/core/deps.ts`, `lib/adapters/align/ctc-onnx/index.test.ts`
- Modify: `lib/contracts/types.ts` (`RenderAdapter`, `AlignAdapter` only), `lib/adapters/align/ctc-onnx/index.ts`, `tests/phase0.ts`

**Interfaces:**
- Consumes: `Sh`, `ShOptions`, `sh` (Task 5); `Config`, `Env`, `loadConfig` (Task 4); `UnsupportedError`, `VideoMachineError` (Task 4); `readJson` (Task 4).
- Produces:
  - `lib/core/deps.ts`: `type Deps = { sh: Sh; config: Config }`, `function defaultDeps(): Deps` (returns `{ sh, config: loadConfig() }`).
  - In `lib/contracts/types.ts`:

```ts
export interface RenderAdapter {
  name: string;
  supports(format: FormatId): { ok: boolean; reason?: string };
  lint(runDir: string): Promise<Issue[]>;
  check(runDir: string): Promise<Issue[]>;
  still(runDir: string, format: FormatId, t: number[], only?: string[]): Promise<string[]>;
  contactSheet(runDir: string, format: FormatId, perScene: number): Promise<string>;
  render(runDir: string, format: FormatId, quality: 'draft' | 'final', passes?: LayerPass[]): Promise<string>;
}
export interface AlignAdapter {
  align(audioPath: string, lines: Script['lines'], spokenWords?: Record<string, string[]>): Promise<string>;
}
```

  - `lib/adapters/align/ctc-onnx/index.ts`: `export const ctcOnnx = (deps: Deps = defaultDeps()): AlignAdapter`, `export default ctcOnnx`. The standalone `align` export is removed.

- [ ] **Step 1: Write the failing tests**

`lib/adapters/align/ctc-onnx/index.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ContractError, UnsupportedError, VideoMachineError } from '../../../core/errors';
import { ctcOnnx } from './index';

const lines = [{ id: 'l1', text: 'Ship faster.', delivery: 'voiceover' as const }];

/** A run folder with audio/vo.wav, and a fake sh that writes `timing` as data/timing.json. */
const setup = (timing: string) => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  mkdirSync(path.join(run, 'audio'));
  const audio = path.join(run, 'audio', 'vo.wav');
  writeFileSync(audio, '');
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin' }),
    sh: async (cmd) => {
      calls.push(cmd);
      mkdirSync(path.join(run, 'data'), { recursive: true });
      writeFileSync(path.join(run, 'data', 'timing.json'), timing);
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { run, audio, calls, deps };
};
const GOOD = JSON.stringify({ lines: [{ text: 'Ship faster.', start: 0, end: 1, words: [] }] });

test('align runs align.py through uv in the plugin project and returns the validated timing.json', async () => {
  const { run, audio, calls, deps } = setup(GOOD);
  const out = await ctcOnnx(deps).align(audio, lines, { 'MCP.': ['EM', 'SEE', 'PEE'] });
  expect(out).toBe(path.join(run, 'data', 'timing.json'));
  const cmd = calls[0]!;
  expect(cmd.slice(0, 5)).toEqual(['uv', 'run', '--project', deps.config.pluginRoot, 'python']);
  expect(cmd[5]).toBe(path.join(deps.config.pluginRoot, 'lib', 'adapters', 'align', 'ctc-onnx', 'align.py'));
  expect(cmd[6]).toBe(audio);
  expect(JSON.parse(readFileSync(cmd[7]!, 'utf8'))).toEqual({
    lines: [{ text: 'Ship faster.' }],
    spoken_words: { 'MCP.': ['EM', 'SEE', 'PEE'] },
  });
  expect(cmd[8]).toBe(run);
});

test('align refuses to run without script lines', async () => {
  const { audio, calls, deps } = setup(GOOD);
  await expect(ctcOnnx(deps).align(audio, [])).rejects.toBeInstanceOf(UnsupportedError);
  expect(calls).toHaveLength(0);
});

test('align names the audio file when it does not exist, before running anything', async () => {
  const { run, calls, deps } = setup(GOOD);
  const missing = path.join(run, 'audio', 'nope.wav');
  const e = await ctcOnnx(deps).align(missing, lines).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(VideoMachineError);
  expect((e as Error).message).toContain(missing);
  expect(calls).toHaveLength(0);
});

test('align fails with a ContractError when align.py writes an invalid timing.json', async () => {
  const { audio, deps } = setup('{"lines": 3}');
  await expect(ctcOnnx(deps).align(audio, lines)).rejects.toBeInstanceOf(ContractError);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/bun test lib/adapters`
Expected: FAIL (`ctcOnnx` not exported; `../../../core/deps` missing).

- [ ] **Step 3: Implement**

- `lib/core/deps.ts` as in Interfaces, with JSDoc.
- Interfaces in `contracts/types.ts` exactly as in Interfaces (drop `scaffold` and `plateApi`; `perPlate` → `perScene`). Nothing implements `RenderAdapter` yet (Phase 6).
- `ctcOnnx(deps)`:
  - Guards, in order, before any process runs: `lines.length === 0` → `UnsupportedError('ctc-onnx.align needs the script lines: it aligns text to audio, it does not transcribe')`; `!existsSync(audioPath)` → `VideoMachineError(\`ctc-onnx.align: audio not found: ${audioPath}\`)`.
  - Spec file in `mkdtempSync(path.join(tmpdir(), 'vm-align-'))` as today.
  - `deps.sh(['uv', 'run', '--project', deps.config.pluginRoot, 'python', ALIGN_PY, path.resolve(audioPath), spec, runDir], { env: deps.config.toolEnv })` where `ALIGN_PY = path.join(deps.config.pluginRoot, 'lib', 'adapters', 'align', 'ctc-onnx', 'align.py')` and `runDir = path.resolve(path.dirname(audioPath), '..')`. `PYTHONUTF8` now comes from `toolEnv`.
  - Validate with `readJson(out, TimingSchema)` and return `out`.
- `tests/phase0.ts`: make the `check` helper async (`await fn()`) and replace `align(...)` with `await ctcOnnx().align(...)`. Keep every assertion as it is.

- [ ] **Step 4: Verify**

Run: `node_modules/.bin/bun test` → all pass.
Run: `node_modules/.bin/bun run lint` → clean.
Run: `node_modules/.bin/bun tests/phase0.ts` → `2/2 passed`.

**Done when:** all three pass, and `git grep -n "process.env\|Bun.env\|Bun.spawn" -- lib ':!lib/core/config.ts' ':!lib/core/sh.ts' ':!*.test.ts'` prints nothing.

---

### Task 8: *(withdrawn 2026-10-10)*

The user retired pdoom (BLUEPRINT 1.6), so there is no pdoom Canvas2D mode to set. Numbering kept so ledger and
commit references stay valid.

---

### Task 9: Acceptance test `tests/phase1.ts`

**Agent:** lib-builder

**Read first:**
- BLUEPRINT Part 5, Phase 1
- `tests/phase0.ts` (output format to copy)
- `lib/core/config.ts`, `lib/core/sh.ts`

**Files:**
- Create: `tests/phase1.ts`

**Interfaces:**
- Consumes: `HYPERFRAMES_VERSION`, `PLUGIN_ROOT`, `loadConfig` (Task 4); `sh` (Task 5).

Probed: `claude plugin validate <file> --strict --json` prints `{ success, manifest: { errors, warnings } }` and exits 0 on success; `claude --plugin-dir . plugin details video-machine` prints a line `Skills (1)  make-video`; `npx --yes hyperframes@0.8.143 --version` prints `0.8.143`.

- [ ] **Step 1: Write the script** — `tests/phase1.ts`

```ts
// Phase 1 acceptance test (real tools; takes several minutes because it runs Phase 0).
//   node_modules/.bin/bun tests/phase1.ts
// 1. unit tests pass                        2. lint is clean (tsc, Biome, ruff)
// 3. Phase 0 acceptance still passes        4. plugin and marketplace manifests pass strict validation
// 5. claude --plugin-dir . loads make-video  6. lib/ keeps its boundaries (env, processes, retired folders gone)
// 7. the pinned HyperFrames version resolves
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HYPERFRAMES_VERSION, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const { bun } = loadConfig();
const MIN = 60_000;
const lastLine = (s: string) => s.trim().split(/\r?\n/).at(-1) ?? '';

const results: { test: string; ok: boolean; detail: string }[] = [];
const check = async (test: string, fn: () => Promise<string>) => {
  const t0 = performance.now();
  try {
    results.push({ test, ok: true, detail: await fn() });
  } catch (e) {
    results.push({ test, ok: false, detail: String((e as Error).message ?? e) });
  }
  const r = results.at(-1)!;
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${test}  (${secs}s)\n      ${r.detail.replace(/\n/g, '\n      ')}`);
};

await check('1. unit tests pass', async () => {
  const r = await sh([bun, 'test'], { cwd: WS, timeoutMs: 5 * MIN });
  return lastLine(r.stderr || r.stdout); // bun test writes its summary to stderr
});

await check('2. lint is clean', async () => {
  await sh([bun, 'run', 'lint'], { cwd: WS, timeoutMs: 5 * MIN });
  return 'tsc, Biome and ruff report nothing';
});

await check('3. Phase 0 acceptance still passes', async () =>
  lastLine((await sh([bun, 'tests/phase0.ts'], { cwd: WS, timeoutMs: 30 * MIN })).stdout),
);

await check('4. plugin and marketplace manifests pass strict validation', async () => {
  const out: string[] = [];
  for (const f of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const r = await sh(['claude', 'plugin', 'validate', f, '--strict', '--json'], { cwd: WS, allowFail: true });
    const report = JSON.parse(r.stdout) as { success: boolean; manifest: { errors: unknown[]; warnings: unknown[] } };
    if (r.code !== 0 || !report.success) throw new Error(`${f}: ${JSON.stringify(report.manifest)}`);
    out.push(`${f}: no errors, no warnings`);
  }
  return out.join('\n');
});

await check('5. claude --plugin-dir . loads the make-video skill', async () => {
  const r = await sh(['claude', '--plugin-dir', '.', 'plugin', 'details', 'video-machine'], { cwd: WS });
  const skills = /Skills \(\d+\)\s+(.*)/.exec(r.stdout)?.[1]?.split(/,\s*/) ?? [];
  if (!skills.includes('make-video')) throw new Error(r.stdout);
  return `skills: ${skills.join(', ')}`;
});

await check('6. lib/ keeps its boundaries', async () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(path.join(WS, 'lib'));
  const rel = (f: string) => path.relative(WS, f).replaceAll('\\', '/');
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (/process\.env|Bun\.env/.test(src) && rel(f) !== 'lib/core/config.ts') bad.push(`${rel(f)} reads the environment`);
    if (/Bun\.spawn|node:child_process/.test(src) && rel(f) !== 'lib/core/sh.ts') bad.push(`${rel(f)} spawns a process`);
  }
  for (const gone of ['.claude/skills/video-machine', 'engine', 'lib/adapters/render/pdoom', 'tests/baseline'])
    if (existsSync(path.join(WS, gone))) bad.push(`${gone} still exists`);
  if (bad.length) throw new Error(bad.join('\n'));
  return `${files.length} files checked`;
});

await check('7. pinned HyperFrames resolves', async () => {
  const r = await sh(['npx', '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, '--version'], { timeoutMs: 5 * MIN });
  if (lastLine(r.stdout) !== HYPERFRAMES_VERSION) throw new Error(`got "${lastLine(r.stdout)}"`);
  return `hyperframes ${HYPERFRAMES_VERSION}`;
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
```

Check 6 skips `*.test.ts` because `sh.test.ts` runs child scripts that read their own env. If the regex matches a comment in library code that only mentions `process.env`, reword the comment; do not loosen the check.

- [ ] **Step 2: Run it**

Run: `node_modules/.bin/bun tests/phase1.ts`
Expected: `7/7 passed`. If a check fails because of earlier tasks' code, stop and report it; do not fix other tasks' files in this task.

- [ ] **Step 3: Verify**

Run: `node_modules/.bin/bun run lint` → clean.

**Done when:** `node_modules/.bin/bun tests/phase1.ts` prints `7/7 passed` and lint is clean. Paste the full output in the report.

---

### Task 10: Whole-branch review fixes (Opus review, 2026-10-10)

**Agent:** lib-builder

**Read first:**
- BLUEPRINT 2.4, 2.5, 2.6 (Secrets, Plugin updates rows)
- `docs/AGENT_PROMPT.md` §7 (errors)
- The files named below, nothing else

**Files:**
- Modify: `lib/contracts/types.ts`, `lib/contracts/types.test.ts`, `lib/core/config.ts`, `lib/core/config.test.ts`,
  `lib/core/json.ts`, `lib/core/json.test.ts`, `lib/core/sh.test.ts`, `lib/adapters/align/ctc-onnx/index.ts`,
  `lib/adapters/align/ctc-onnx/index.test.ts`, `lib/adapters/align/ctc-onnx/align.py` (comment only), `tests/phase1.ts`,
  `.gitignore`

Tests first wherever behaviour changes. One commit-sized change; the orchestrator commits.

1. **Strict run-folder schemas** (`types.ts`). Every object schema for a file Claude writes rejects unknown keys:
   use `z.strictObject` (or `.strict()`) for `Brief` (and its nested objects: sources, voice, music, avatar, brand,
   cta, deliverables), `Script` and its lines, `Look`, `ScenePlan` and its nested objects, `Plan` (and sections),
   `AssetRef`, `Steps` entries, `CaptureLog` entries, `TestResults` (and checks, annotations, output_paths), `Doctor`.
   `Timing` stays a plain `z.object` with a comment: it is aligner output (`align_vo.py`), not written by Claude.
   Flip the test "brief no longer has source_material, assets or references" to expect `safeParse(...).success` false,
   and add one test that a misspelt key (`format` for `formats`) is rejected.
2. **Unique ids** (`types.ts`). `Script.lines[].id`, `Plan.visuals_plan.scenes[].scene_id` and `Plan.sections[].id`
   must be unique; the refine message names the duplicate (`duplicate scene_id "hook"`). Tests for each.
3. **Async adapter interfaces** (`types.ts`). `VoiceAdapter`, `MusicAdapter`, `AssetAdapter` and `ExportAdapter`
   methods that run tools return `Promise<...>` (as `RenderAdapter` / `AlignAdapter` already do); `costEstimate`
   stays sync. Nothing implements them yet.
4. **`spoken` comment** (`types.ts`, Script line). Say: `spoken` is how TTS reads the line (M9); the aligner (M10)
   aligns `text` and takes a per-word `spokenWords` map built by its caller. Drop "/aligner".
5. **Comment sweep** (`types.ts`): the comment above `Frame` and every "plate" → "scene"; JSDoc on `frameOf`;
   "the engine's" lyrics/word-timed format → "the aligner's word-timed format" (`types.ts`, `align.py` docstring).
   Do not edit `lib/adapters/align/ctc-onnx/analysis/` (vendored).
6. **Secret pattern** (`config.ts`). Pattern becomes `/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i`. Delete
   `SECRET_ENV` and `SECRETS` (the pattern covers them); `stripSecrets` is no longer exported. Config test feeds
   `AWS_SECRET_ACCESS_KEY`, `OPENAI_KEY`, `DB_PASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS` (all gone) and keeps `Path`.
   Update any test that imported `SECRET_ENV`.
7. **`writeJson` tmp file** (`json.ts`). Tmp name `${file}.${process.pid}.tmp`; if `renameSync` throws, remove the
   tmp (`rmSync(tmp, { force: true })`) and rethrow. Write the BOM regex as `/^﻿/` (escape, not the literal
   character), and the BOM test input as `'﻿' + ...` too.
8. **Delete the 1.5 MB large-output test** in `sh.test.ts` (it cannot catch a regression: bun buffers pipes).
9. **Aligner outputs** (`ctc-onnx/index.ts`). Remove both `data/timing.json` and `data/audio.json` before calling
   `sh`, and remove both again if the call or the validation fails, so a half-finished run never looks done.
   JSDoc lists all four audio refusals (missing, not a file, empty, outside `audio/`). Tests: after a failed align
   neither file exists.
10. **Aligner tests** (`index.test.ts`): drop "and removes it afterwards" from the title at ~line 59; the stale-timing
    test (~150) also asserts `data/timing.json` no longer exists.
11. **Check 6** (`tests/phase1.ts`): add `|import\.meta\.env\b` to the env regex.
12. **`.gitignore`**: remove the pdoom leftovers `engine/out/` and `.vite/`.

**Done when:** `node_modules/.bin/bun test` all pass, `node_modules/.bin/bun run lint` clean,
`node_modules/.bin/bun tests/phase0.ts` → `2/2 passed`, `node_modules/.bin/bun tests/phase1.ts` → `7/7 passed`.

---

### After Task 9 (orchestrator)

1. Run `node_modules/.bin/bun tests/phase1.ts` and show the user the output.
2. Dispatch `code-reviewer` with `model: opus` over the whole branch; turn its findings into one fix task, then one scoped re-review.
3. Update `HANDOFF.md`; ask the user before merging.
4. **Spike (orchestrator + user, `runs/spike-*`, throwaway):** one 15 s reel by hand with HyperFrames 0.8.143 directly, from a concept only (WebSearch/WebFetch research, `hyperframes capture` of public pages, graphics drawn in code); the user's navigation video and product URL are used if they supply them. Findings go into the blueprint (with the user's approval) and the Phase 2 plan. Spike code is never copied into `lib/`.
