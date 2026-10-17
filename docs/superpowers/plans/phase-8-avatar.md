# Phase 8 — Avatar Implementation Plan

**Goal:** A brief can ask for a talking avatar on the lines whose `delivery` is `"avatar"`. M11 cuts the voiceover
into avatar segments (runs of consecutive avatar lines), makes one talking clip per segment (cut from a supplied
clip that runs along `vo.wav`, or made by an adapter from a portrait and the segment's audio: HeyGen behind the cost
gate now, one local audio-driven model after a GPU test), removes the background with `hyperframes
remove-background` into `avatar/<seg>.webm`, and the `avatar-director` picks a placement preset per segment. The
build lays each `.webm` over the scenes; the scene writer keeps text out of the avatar's box and `layout.safe_area`
fails text that sits under it.

**Architecture:**
- **Contracts:** `brief.avatar` becomes `{source:"supplied", clip} | {source:"adapter", adapter, portrait}`;
  `AvatarSegmentsSchema` (`avatar/segments.json`), `AvatarPlacementSchema` (`avatar/placement.json`),
  `AvatarAdapter` (`make(job, out)`, `costEstimate(audio_s)`).
- **Core:** `lib/core/avatar.ts` (`avatarSegments`, `presetBox`, `avatarBoxes`, `avatarBoxesOf`); `approvedOf`
  moves to `lib/core/cost.ts`.
- **Adapters:** `render/hyperframes/matte.ts` (`removeBackground`), `avatar/supplied`, `avatar/heygen` (v3 API);
  `render/hyperframes/project.ts` adds the avatar layer.
- **Part folder:** `lib/avatar/` (M11: `makeAvatar`, CLI `make`, `boxes`).
- **Checks:** `layout.safe_area` treats an active avatar box as occupied; `contracts.valid` reads the two avatar
  files; `scenes todo` lists each scene's avatar boxes.
- **Shipped:** `agents/avatar-director.md`, `skills/avatar/SKILL.md`, `make-video` routes M11, `scene-writer` reads
  the boxes.
- **Deferred:** Task 11 (local adapter) is written after the creator's GPU test on the reference laptop (U1).

**Tech stack (probed 2026-10-17 on the M1 Mac, HyperFrames 0.8.143):**
- `hyperframes remove-background <in> -o <out.webm> --device auto|cpu|coreml|cuda --quality fast|balanced|best
  --json` → last stdout line `{"ok":true,"outputPath":…,"framesProcessed":60,"durationSeconds":8.78,
  "avgMsPerFrame":146.4,"provider":"CoreML","format":"webm"}`. Output: VP9, tag `ALPHA_MODE=1`, same size and fps,
  **no audio stream**. First run installs `onnxruntime-node` and the `u2net_human_seg` model (prints to
  stdout/stderr before the JSON). `--info --json` → `{availableProviders:["cpu","coreml"],autoProvider:"CoreML",…}`;
  CUDA is listed on NVIDIA machines. CoreML 146 ms/frame; blueprint 2.3 records ≈ 0.6 s/frame CPU on the laptop.
- A root-level `<video class="clip" src="x.webm" muted playsinline data-start="0.5" data-duration="1.5"
  data-track-index="2" style="position:absolute;…">` renders with alpha over the layers below in `snapshot` and
  `render --no-browser-gpu` (red disc on blue: centre `fc0001`, transparent corner `0100ff`). Media time is
  `t − data-start` (a red→green clip at data-start 0.5: red at 1.3 s, green at 1.7 s). Batch and single snapshots
  of a real `remove-background` output hash identically (seek-safe).
- **HeyGen API v3** (developers.heygen.com, read 2026-10-17; v1/v2 are removed 2026-10-31). Base
  `https://api.heygen.com`, header `x-api-key`. `POST /v3/assets` multipart field `file` (png/jpeg/wav/mp3/mp4,
  ≤ 32 MB) → `{data:{asset_id,url,mime_type,size_bytes}}`. `POST /v3/videos` JSON
  `{type:"image", image:{type:"asset_id",asset_id}, audio_asset_id, aspect_ratio:"auto", resolution:"1080p",
  background:{type:"color",value:"#RRGGBB"}}` (optional `Idempotency-Key` header) → `{data:{video_id,status}}`.
  `GET /v3/videos/{id}` → `{data:{status:"pending"|"processing"|"completed"|"failed", video_url, duration,
  failure_code, failure_message}}` (create returns `waiting`: treat any other status as running). Errors
  `{error:{code,message,request_id}}`; 401 `unauthorized`, 402 `insufficient_credit`, 429 with `Retry-After`. Output
  25 fps; audio ≤ 10 min. Price per minute is not in the docs; the blueprint's ~$1/min stays the estimate.

**Spec:** `docs/BLUEPRINT.md`: Part 5 Phase 8; 1.6 (Avatar row); 2.1 (M11); 2.3 (HeyGen, HyperFrames rows); 2.4
(`Brief.avatar`, run folder `avatar/`); 2.5 (`AvatarAdapter`); 2.6 (spending money); 2.8 (`layout.safe_area`).

## Global Constraints

- Call bun as `node_modules/.bin/bun`. Only `lib/core/sh.ts` spawns processes; tests pass a fake `deps.sh`. HeyGen
  HTTP goes through an injected `fetch`; tests never touch the network.
- Import direction: part folders (`lib/avatar`, `lib/scenes`, `lib/review`) → `lib/checks`, `lib/adapters` →
  `lib/core` → `lib/contracts`. Adapters never import each other; part folders never import each other.
- Run-folder JSON only through `writeJson` / `readJson`; run paths from JSON only through `runFileOf`.
- Nothing half-made may look done: M11 builds `avatar.tmp/` and renames it to `avatar/`; a failed make leaves no
  `avatar/` that looks current (a previous `avatar/` is removed only after the new one is complete).
- No money moves before the cost gate: `costEstimate` for every segment is summed and checked before the first
  upload.

## Review Focus

- The cost gate runs before any HeyGen request; an over-budget run makes no request and writes nothing.
- `avatar/` appears only complete; `avatar/placement.json` (the M11 done marker) is only written by the director.
- The avatar layer sits above every scene host, starts at its segment's start and lasts its segment.
- `layout.safe_area` fails text under an avatar box only while that segment is on screen.
- The HeyGen API key never reaches a log, an error message or a run file.

## Rulings made in this plan (2026-10-17; listed in the phase summary)

User rulings (asked 2026-10-17): **U1** Phase 8 is planned without the local adapter; Task 11 is written after a GPU
test the creator runs on the reference laptop (this session runs on an M1 without NVIDIA). **U2** A supplied avatar
is one clip that runs along the whole `vo.wav` timeline (`avatar.clip`); M11 cuts each segment out of it. **U3** The
`avatar-director` picks a named preset per segment in `avatar/placement.json`; the build adds the `.webm` as a top
layer; the scene writer keeps that box clear and `layout.safe_area` treats it as occupied. **U4** HeyGen unit tests
mock HTTP; `tests/phase8.ts` makes one live call only when `HEYGEN_API_KEY` and `VM_HEYGEN_APPROVE_USD` are set,
and SKIPs otherwise.

- **R1** Segments: maximal runs of consecutive script lines with `delivery: "avatar"`, in script order, named `a01`,
  `a02`, … Start = first line's `start`, end = last line's `end` in `data/timing.json` (matched by id with
  `lineOf`), rounded to ms. Cost if wrong: one function.
- **R2** `avatar/` = `<seg>.webm` (alpha, silent) + `segments.json` `{run_id, adapter, segments:[{seg, line_ids,
  start, end, file}]}` written by `make`; `placement.json` `{segments:{<seg>: preset}}` written by the director.
  M11's done marker becomes `avatar/placement.json`. `make` replaces the whole folder, placement included.
- **R3** Every adapter returns an opaque video; M11 always runs `remove-background` (`--device auto --quality
  balanced`). One path for every source; HeyGen's own WebM matting is not used (unconfirmed for `type: "image"`).
- **R4** `AvatarAdapter` = `{name, make(job: {seg, start, end, audio}, out): Promise<string>, costEstimate(audio_s)}`.
  `supplied` cuts `[start, end]` from the clip (and ignores `audio`); `heygen` uploads the portrait once and each
  segment's audio. Blueprint 2.5 changes from `make(portrait, audioPath)`.
- **R5** Presets (U3), from the format's safe area with edges rounded first (`sx0 = round(w·left)`, `sx1 = round(w·(1
  − right))`, `sy0 = round(h·top)`, `sy1 = round(h·(1 − bottom))`, `SW = sx1 − sx0`, `SH = sy1 − sy0`), corner
  height `bh = round(0.45·SH)`, corner width `bw = round(0.75·bh)`:
  `corner-br` `{x: sx1 − bw, y: sy1 − bh, w: bw, h: bh, fit: "right bottom"}`, `corner-bl` `{x: sx0, …, fit: "left
  bottom"}`, `bottom` `{x: sx0, y: sy1 − bh, w: SW, h: bh, fit: "center bottom"}`, `full` `{x: sx0, y: sy0, w: SW,
  h: SH, fit: "center bottom"}`. The video is `object-fit: contain` in its box. Reel: corner-br
  `{587, 966, 428, 570}`. Cost if wrong: one table.
- **R6** Avatar layer: one `<video>` per segment after the scene hosts in the root page, track index after the last
  scene, `z-index: 10`, files copied to `build/<format>/avatar/<seg>.webm`.
- **R7** `layout.safe_area`: a text sample at `t` with `start ≤ t < end` whose box overlaps an avatar box by more
  than 2 px on both axes fails with `"<text>" sits under the avatar (<seg>)`. Captions count. No new check id.
- **R8** HeyGen: `costEstimate(s) = ceil(s / 60 × HEYGEN_USD_PER_MIN × 100) / 100`, `HEYGEN_USD_PER_MIN = 1`
  (`lib/core/config.ts`; the docs don't publish a rate). Background colour `#00b140`. Poll every 5 s, give up after
  20 min. 429 → wait `Retry-After` s (default 10), at most 3 retries per request. `Idempotency-Key` =
  `vm-` + first 32 hex of sha256(portrait bytes + segment audio bytes), so a re-run after a crash is not billed
  twice. 401/402 → `InputError`; other non-2xx, `failed` or timeout → `VideoMachineError`. The key is sent only in
  the header and never appears in an error.
- **R9** Review (Phase 7 R9 table): the `words` route also deletes `avatar/`; `history/<n>/` also copies
  `avatar/segments.json` and `avatar/placement.json`. A `plan` route keeps `avatar/`. A placement change after M12
  goes through a `scenes` review of the affected scenes.
- **R10** M11 runs only for voiceover runs; `text_only` / `music` → `UnsupportedError`.

### Orchestrator pre-step (before Task 1, not a builder task)

Update `docs/BLUEPRINT.md`: 2.3 HeyGen row → v3 endpoints (`/v3/assets`, `/v3/videos`, `/v3/videos/{id}`, header
`x-api-key`, v1/v2 gone 2026-10-31); HyperFrames probe row: `remove-background` JSON + VP9 alpha, no audio; root
`<video>` media time = `t − data-start`, alpha over scenes, seek-safe (Tech stack above). 2.4: `Brief.avatar` union
(U2); run folder `avatar/<seg>.webm, segments.json, placement.json` (R2). 2.5: `AvatarAdapter.make(job, out)` (R4).
2.7: rows "avatar presets | box | R5 table" and "HeyGen rate | USD/min | `1` (estimate)". 2.8 `layout.safe_area`:
"… and out of an active avatar box" (R7). Part 4: `skills/avatar/SKILL.md # M11`. Phase 8 bullets: U1–U3. Commit
`docs(blueprint): Phase 8 rulings`.

---

### Task 1: Avatar contracts, run markers and review tables

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:44-60` (`RunPathSchema`), `:87-140` (`BriefSchema`, the `avatar` field at
`:110-117`), `:146-173` (`ScriptSchema`), `:286-291` (scene notes/hashes, a pattern), `:493-535` (adapter
interfaces); `lib/run/where.ts:36-55` (`MARKER`); `lib/run/intake.ts:100-112` (`briefPaths`);
`lib/checks/contracts.ts:15-32`; `lib/review/review.ts:10-30` and `:118-130`.

**Files:** Modify `lib/contracts/types.ts`, `lib/contracts/types.test.ts`, `lib/run/where.ts`,
`lib/run/where.test.ts`, `lib/run/intake.ts`, `lib/checks/contracts.ts`, `lib/review/review.ts` and their tests
where an existing test names the old avatar shape (`types.test.ts:200-204`, `:323`, `:336`; `where.test.ts:151`,
`:222`): use `{ source: 'supplied', clip: 'input/me.mp4' }`.

**Tests first:** `lib/contracts/types.test.ts` (replace the test at `:200-204`; add the rest):

```ts
test('brief avatar is a supplied clip or an adapter with a portrait', () => {
  expect(BriefSchema.parse({ ...brief, avatar: { source: 'supplied', clip: 'input/me.mp4' } }).avatar).toEqual({
    source: 'supplied',
    clip: 'input/me.mp4',
  });
  const adapter = { source: 'adapter', adapter: 'heygen', portrait: 'input/me.png' };
  expect(BriefSchema.parse({ ...brief, avatar: adapter }).avatar).toEqual(adapter);
  expect(BriefSchema.safeParse({ ...brief, avatar: { source: 'supplied', portrait: 'input/me.png' } }).success).toBe(false);
  expect(BriefSchema.safeParse({ ...brief, avatar: { source: 'adapter', adapter: 'heygen' } }).success).toBe(false);
  expect(BriefSchema.safeParse({ ...brief, avatar: { source: 'magic' } }).success).toBe(false);
});

const seg = { seg: 'a01', line_ids: ['l2', 'l3'], start: 1.2, end: 4.5, file: 'avatar/a01.webm' };

test('avatar segments name each segment once, with an end after its start', () => {
  const ok = AvatarSegmentsSchema.parse({ run_id: 'r', adapter: 'supplied', segments: [seg] });
  expect(ok.segments[0]?.file).toBe('avatar/a01.webm');
  const twice = { run_id: 'r', adapter: 'supplied', segments: [seg, { ...seg, start: 5, end: 6 }] };
  expect(AvatarSegmentsSchema.safeParse(twice).success).toBe(false);
  const backwards = { run_id: 'r', adapter: 'supplied', segments: [{ ...seg, end: 1 }] };
  expect(AvatarSegmentsSchema.safeParse(backwards).success).toBe(false);
  expect(AvatarSegmentsSchema.safeParse({ run_id: 'r', adapter: 'supplied', segments: [{ ...seg, seg: 'x' }] }).success).toBe(false);
});

test('avatar placement maps each segment to a known preset', () => {
  expect(AvatarPlacementSchema.parse({ segments: { a01: 'corner-br', a02: 'full' } }).segments.a02).toBe('full');
  expect(AvatarPlacementSchema.safeParse({ segments: { a01: 'middle' } }).success).toBe(false);
  expect(AVATAR_PRESETS).toEqual(['corner-br', 'corner-bl', 'bottom', 'full']);
});
```

`lib/run/where.test.ts` (add one test, built from the fixture at `:150-163` that reaches `M11`): with
`avatar/segments.json` added, `next` is still `M11`; with `avatar/placement.json` added as well, `next` is `M12`.
Its brief uses `avatar: { source: 'supplied', clip: 'input/me.mp4' }`.

`lib/run/intake.test.ts` (add, next to the `briefPaths` tests):

```ts
test('briefPaths lists the supplied avatar clip or the portrait', () => {
  const b = (avatar: unknown) => BriefSchema.parse({ ...BRIEF, avatar });
  expect(briefPaths(b({ source: 'supplied', clip: 'input/me.mp4' }))).toContain('input/me.mp4');
  expect(briefPaths(b({ source: 'adapter', adapter: 'heygen', portrait: 'input/me.png' }))).toContain('input/me.png');
});
```
(Use the brief fixture name `intake.test.ts` already has.)

`lib/checks/contracts.test.ts` (add, with the file's existing run helper): a run whose `avatar/placement.json`
is `{"segments":{"a01":"middle"}}` → `contracts.valid` `status: 'fail'` with an annotation naming
`avatar/placement.json`.

`lib/review/review.test.ts` (add): a `words` review on a run with `avatar/a01.webm`, `avatar/segments.json` and
`avatar/placement.json` removes `avatar/` and copies both JSON files into `history/1/avatar/`; a `plan` review keeps
`avatar/` (use the file's existing run helper and the existing `words`/`plan` tests as the pattern).

**Implementation notes:**
- `brief.avatar`: `z.discriminatedUnion('source', [z.strictObject({ source: z.literal('supplied'), clip:
  RunPathSchema }), z.strictObject({ source: z.literal('adapter'), adapter: z.string().min(1), portrait:
  RunPathSchema })]).optional()`. Delete the `ponytail:` comment above it.
- After the plan section add:
  `export const AVATAR_PRESETS = ['corner-br', 'corner-bl', 'bottom', 'full'] as const;`
  `export const AvatarPresetSchema = z.enum(AVATAR_PRESETS);` `export type AvatarPreset`.
  `AvatarSegmentsSchema = z.strictObject({ run_id: z.string(), adapter: z.string(), segments: z.array(z.strictObject({
  seg: z.string().regex(/^a\d{2}$/), line_ids: z.array(z.string()).min(1), start: z.number().min(0), end:
  z.number(), file: RunPathSchema })).min(1) })` + `superRefine`: duplicate `seg` via `addDuplicateIssues`; `end <=
  start` → issue at `['segments', k, 'end']`. `AvatarPlacementSchema = z.strictObject({ segments: z.record(z.string(),
  AvatarPresetSchema) })`. Export both types.
- Interfaces: `export type AvatarJob = { seg: string; start: number; end: number; audio: string };`
  `export interface AvatarAdapter { name: string; /** Writes an opaque talking clip for the job to \`out\`; resolves
  to \`out\`. */ make(job: AvatarJob, out: string): Promise<string>; costEstimate(audio_s: number): number; }`
- `where.ts` `MARKER.M11 = 'avatar/placement.json'`.
- `briefPaths`: replace `b.avatar?.portrait` with
  `b.avatar?.source === 'supplied' ? b.avatar.clip : b.avatar?.portrait`.
- `contracts.ts`: add `['avatar/segments.json', AvatarSegmentsSchema]`, `['avatar/placement.json',
  AvatarPlacementSchema]` after `data/timing.json`.
- `review.ts`: `SNAPSHOT_FILES` add `'avatar/segments.json'`, `'avatar/placement.json'` after `data/timing.json`;
  `clear`: the `words` route also pushes `'avatar'`.

**Done when:** `sh .claude/tools/check.sh lib/contracts lib/run lib/checks lib/review` passes.

---

### Task 2: Avatar segments and boxes `lib/core/avatar.ts`

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:15-25` (`FORMATS`), the avatar schemas Task 1 added (grep
`AvatarSegmentsSchema`), `:146-173` (`ScriptSchema`), `:320-343` (`TimingSchema`); `lib/core/timing.ts:18-22`
(`lineOf`); `lib/core/json.ts:1-15`; this plan's R1, R5.

**Files:** Create `lib/core/avatar.ts`, `lib/core/avatar.test.ts`.

**Tests first:** `lib/core/avatar.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AvatarPlacementSchema, AvatarSegmentsSchema, ScriptSchema, TimingSchema } from '../contracts/types';
import { avatarBoxes, avatarBoxesOf, avatarSegments, presetBox } from './avatar';
import { InputError } from './errors';
import { writeJson } from './json';

const line = (id: string, delivery: 'voiceover' | 'avatar') => ({ id, text: `Line ${id}.`, delivery });
const script = ScriptSchema.parse({
  run_id: 'r',
  version: 1,
  lines: [line('l1', 'voiceover'), line('l2', 'avatar'), line('l3', 'avatar'), line('l4', 'voiceover'), line('l5', 'avatar')],
});
const timed = (id: string, start: number, end: number) => ({ id, text: `Line ${id}.`, start, end, words: [] });
const timing = TimingSchema.parse({
  lines: [timed('l1', 0.2, 1.1), timed('l2', 1.35, 2.5), timed('l3', 2.75, 4.0004), timed('l4', 4.25, 5), timed('l5', 5.25, 6.5)],
});

test('avatarSegments groups consecutive avatar lines and times them from timing.json', () => {
  expect(avatarSegments(script, timing)).toEqual([
    { seg: 'a01', line_ids: ['l2', 'l3'], start: 1.35, end: 4 },
    { seg: 'a02', line_ids: ['l5'], start: 5.25, end: 6.5 },
  ]);
  const none = ScriptSchema.parse({ run_id: 'r', version: 1, lines: [line('l1', 'voiceover')] });
  expect(avatarSegments(none, timing)).toEqual([]);
  const missing = TimingSchema.parse({ lines: [timed('l1', 0, 1)] });
  expect(() => avatarSegments(script, missing)).toThrow(InputError);
});

test('presetBox places each preset inside the safe area', () => {
  expect(presetBox('corner-br', 'reel')).toEqual({ x: 587, y: 966, w: 428, h: 570, fit: 'right bottom' });
  expect(presetBox('corner-bl', 'reel')).toEqual({ x: 65, y: 966, w: 428, h: 570, fit: 'left bottom' });
  expect(presetBox('bottom', 'reel')).toEqual({ x: 65, y: 966, w: 950, h: 570, fit: 'center bottom' });
  expect(presetBox('full', 'reel')).toEqual({ x: 65, y: 269, w: 950, h: 1267, fit: 'center bottom' });
  expect(presetBox('corner-br', 'landscape_1080p')).toEqual({ x: 1496, y: 589, w: 328, h: 437, fit: 'right bottom' });
});

const segments = AvatarSegmentsSchema.parse({
  run_id: 'r',
  adapter: 'supplied',
  segments: [
    { seg: 'a01', line_ids: ['l2', 'l3'], start: 1.35, end: 4, file: 'avatar/a01.webm' },
    { seg: 'a02', line_ids: ['l5'], start: 5.25, end: 6.5, file: 'avatar/a02.webm' },
  ],
});

test('avatarBoxes joins each segment with its preset box and refuses a gap or an unknown segment', () => {
  const placement = AvatarPlacementSchema.parse({ segments: { a01: 'corner-br', a02: 'full' } });
  expect(avatarBoxes(segments, placement, 'reel')).toEqual([
    { seg: 'a01', start: 1.35, end: 4, x: 587, y: 966, w: 428, h: 570, fit: 'right bottom' },
    { seg: 'a02', start: 5.25, end: 6.5, x: 65, y: 269, w: 950, h: 1267, fit: 'center bottom' },
  ]);
  expect(() => avatarBoxes(segments, { segments: { a01: 'full' } }, 'reel')).toThrow(/a02/);
  expect(() => avatarBoxes(segments, { segments: { a01: 'full', a02: 'full', a09: 'full' } }, 'reel')).toThrow(/a09/);
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('avatarBoxesOf reads the run: none without segments, InputError without a placement', () => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-avatar-'));
  dirs.push(run);
  expect(avatarBoxesOf(run, 'reel')).toEqual([]);
  mkdirSync(path.join(run, 'avatar'));
  writeJson(path.join(run, 'avatar', 'segments.json'), AvatarSegmentsSchema, segments);
  expect(() => avatarBoxesOf(run, 'reel')).toThrow(InputError);
  writeJson(path.join(run, 'avatar', 'placement.json'), AvatarPlacementSchema, { segments: { a01: 'bottom', a02: 'bottom' } });
  expect(avatarBoxesOf(run, 'reel').map((b) => b.seg)).toEqual(['a01', 'a02']);
});
```

**Implementation notes:**
- Header comment line, as the other core files have.
- `export type AvatarSpan = { seg: string; line_ids: string[]; start: number; end: number };`
  `export type PresetBox = { x: number; y: number; w: number; h: number; fit: string };`
  `export type AvatarBox = { seg: string; start: number; end: number } & PresetBox;`
- `avatarSegments(script, timing): AvatarSpan[]` (R1): walk `script.lines`; a run of `delivery === 'avatar'` lines is
  one span; `lineOf(timing, id)` for the first and last line (it throws `InputError`); round start/end to 3 places;
  name `a` + two-digit index from 01.
- `presetBox(preset: AvatarPreset, format: FormatId): PresetBox`: the R5 table, from `FORMATS[format]`.
- `avatarBoxes(segments: AvatarSegments, placement: AvatarPlacement, format): AvatarBox[]`: in segment order; a
  segment without a preset → `InputError(\`avatar/placement.json has no preset for ${seg}\`)`; a placement key that
  is not a segment → `InputError(\`avatar/placement.json names unknown segment ${key}\`)`.
- `avatarBoxesOf(runDir, format): AvatarBox[]`: `avatar/segments.json` missing → `[]`; present but
  `avatar/placement.json` missing → `InputError('avatar/placement.json is missing: place the avatar first')`; else
  read both with their schemas and return `avatarBoxes`.

**Done when:** `sh .claude/tools/check.sh lib/core` passes.

---

### Task 3: Background removal `lib/adapters/render/hyperframes/matte.ts`

**Agent:** lib-builder

**Read first:** `lib/core/sh.ts:4-15`; `lib/core/errors.ts:20-38` (`ToolError`); `lib/core/config.ts:49-52`
(`HF_CMD`); `lib/adapters/voice/hf-tts/index.ts:50-66` (how an HF call with `--json` is run and its reply checked);
the `remove-background` lines of this plan's Tech stack.

**Files:** Create `lib/adapters/render/hyperframes/matte.ts`, `lib/adapters/render/hyperframes/matte.test.ts`.

**Tests first:** `lib/adapters/render/hyperframes/matte.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ToolError } from '../../../core/errors';
import type { Sh } from '../../../core/sh';
import { removeBackground } from './matte';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-matte-'));
  dirs.push(d);
  return d;
};
const depsWith = (sh: Sh): Deps => ({ sh, config: loadConfig({}) });

test('removeBackground runs remove-background to the output and returns it', async () => {
  const d = tmp();
  const calls: string[][] = [];
  const sh: Sh = async (cmd) => {
    calls.push(cmd);
    const out = cmd[cmd.indexOf('-o') + 1] ?? '';
    writeFileSync(out, 'webm');
    return { code: 0, stdout: `installing onnxruntime-node for background removal, once\n{"ok":true,"outputPath":"${out}","framesProcessed":60}\n`, stderr: '' };
  };
  const out = path.join(d, 'a01.webm');
  expect(await removeBackground(depsWith(sh), path.join(d, 'a01.mp4'), out)).toBe(out);
  expect(calls[0]?.slice(-9)).toEqual(['remove-background', path.join(d, 'a01.mp4'), '-o', out, '--device', 'auto', '--quality', 'balanced', '--json']);
  expect(existsSync(out)).toBe(true);
});

test('removeBackground throws ToolError on a failed reply and leaves no output', async () => {
  const d = tmp();
  const out = path.join(d, 'a01.webm');
  const sh: Sh = async (cmd) => {
    writeFileSync(cmd[cmd.indexOf('-o') + 1] ?? '', 'half');
    return { code: 1, stdout: '{"ok":false,"error":"no frames"}\n', stderr: 'boom' };
  };
  await expect(removeBackground(depsWith(sh), path.join(d, 'a01.mp4'), out)).rejects.toThrow(ToolError);
  expect(existsSync(out)).toBe(false);
});
```
**Implementation notes:**
- `export async function removeBackground(deps: Deps, input: string, output: string): Promise<string>`.
- Command: `[...HF_CMD, 'remove-background', input, '-o', output, '--device', 'auto', '--quality', 'balanced',
  '--json']`, `{ env: deps.config.toolEnv, allowFail: true, timeoutMs: 1_800_000 }` (≈ 0.6 s/frame on CPU).
- Reply = `JSON.parse` of the last stdout line that starts with `{` (install lines come first); unparsable → none.
  `code !== 0` or `reply.ok !== true` or no file at `output` → remove `output` if present, then `throw new
  ToolError({ cmd, code, stderr: \`remove-background failed for ${path.basename(input)}: ${reply?.error ??
  stderr}\` })`.

**Done when:** `sh .claude/tools/check.sh lib/adapters/render` passes.

---

### Task 4: Supplied avatar adapter `lib/adapters/avatar/supplied`

**Agent:** lib-builder

**Read first:** the `AvatarAdapter` / `AvatarJob` types Task 1 added (grep `AvatarAdapter`); `lib/core/media.ts:5-12`
and `:55-91` (`probeMedia`); `lib/adapters/voice/supplied/index.ts` (whole, 44 lines: the ffmpeg + temp-name
pattern); this plan's U2, R4.

**Files:** Create `lib/adapters/avatar/supplied/index.ts`, `lib/adapters/avatar/supplied/index.test.ts`.

**Tests first:** `lib/adapters/avatar/supplied/index.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError } from '../../../core/errors';
import type { Sh } from '../../../core/sh';
import { suppliedAvatar } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-sup-'));
  dirs.push(d);
  return d;
};
const probeOf = (duration: number) =>
  JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, r_frame_rate: '30/1' }], format: { duration: String(duration) } });

/** A fake sh: ffprobe reports `duration`; ffmpeg writes its last argument. */
const fake = (duration: number, calls: string[][]): Deps => {
  const sh: Sh = async (cmd) => {
    calls.push(cmd);
    if (cmd[0] === 'ffprobe') return { code: 0, stdout: probeOf(duration), stderr: '' };
    writeFileSync(cmd.at(-1) ?? '', 'mp4');
    return { code: 0, stdout: '', stderr: '' };
  };
  return { sh, config: loadConfig({}) };
};

test('supplied cuts the segment window out of the clip, without audio, and costs nothing', async () => {
  const d = tmp();
  const calls: string[][] = [];
  const adapter = suppliedAvatar(fake(10, calls), path.join(d, 'me.mp4'));
  const out = path.join(d, 'a01.mp4');
  expect(adapter.name).toBe('supplied');
  expect(adapter.costEstimate(30)).toBe(0);
  expect(await adapter.make({ seg: 'a01', start: 1.35, end: 4, audio: path.join(d, 'a01.wav') }, out)).toBe(out);
  const cut = calls.find((c) => c[0] === 'ffmpeg') ?? [];
  expect(cut.slice(cut.indexOf('-ss'), cut.indexOf('-ss') + 6)).toEqual(['-ss', '1.350', '-to', '4.000', '-i', path.join(d, 'me.mp4')]);
  expect(cut).toContain('-an');
  expect(existsSync(out)).toBe(true);
});

test('supplied refuses a clip that ends before the segment', async () => {
  const d = tmp();
  const adapter = suppliedAvatar(fake(3, []), path.join(d, 'me.mp4'));
  await expect(adapter.make({ seg: 'a01', start: 1.35, end: 4, audio: '' }, path.join(d, 'a01.mp4'))).rejects.toThrow(InputError);
});
```

**Implementation notes:**
- `export const suppliedAvatar = (deps: Deps, clip: string): AvatarAdapter`; `name: 'supplied'`,
  `costEstimate: () => 0`.
- `make(job, out)`: `probeMedia(deps, clip)` (memoise per adapter); `undefined` or `duration + 0.05 < job.end` →
  `InputError(\`the avatar clip runs ${d}s but ${job.seg} ends at ${job.end}s: supply a clip that runs along the whole
  voiceover\`)`. Then `ffmpeg -v error -y -ss <start.toFixed(3)> -to <end.toFixed(3)> -i <clip> -an -c:v libx264
  -pix_fmt yuv420p <out>.part.mp4` and rename to `out`; on error remove the part file and rethrow. `job.audio` is
  not used (U2).

**Done when:** `sh .claude/tools/check.sh lib/adapters/avatar` passes.

---

### Task 5: HeyGen avatar adapter `lib/adapters/avatar/heygen`

**Agent:** lib-builder

**Read first:** the `AvatarAdapter` / `AvatarJob` types (grep `AvatarAdapter` in `lib/contracts/types.ts`);
`lib/core/errors.ts:1-20`; `lib/core/config.ts:1-20`; this plan's Tech stack (HeyGen API v3) and R8.

**Files:** Create `lib/adapters/avatar/heygen/index.ts`, `lib/adapters/avatar/heygen/index.test.ts`. Modify
`lib/core/config.ts` (add `HEYGEN_USD_PER_MIN = 1`).

**Tests first:** `lib/adapters/avatar/heygen/index.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InputError, VideoMachineError } from '../../../core/errors';
import { heygen } from './index';

const KEY = 'sk-test-secret';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const setup = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-heygen-'));
  dirs.push(d);
  writeFileSync(path.join(d, 'me.png'), 'png');
  writeFileSync(path.join(d, 'a01.wav'), 'wav1');
  writeFileSync(path.join(d, 'a02.wav'), 'wav2');
  return d;
};
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A scripted fetch: each request takes the next reply for its route. */
const scripted = (routes: Record<string, Response[]>, calls: Call[]): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
    const key = `${method} ${url.replace('https://api.heygen.com', '')}`;
    const reply = routes[key]?.shift();
    if (!reply) throw new Error(`unscripted ${key}`);
    return reply;
  }) as typeof fetch;

test('heygen uploads the portrait once, makes each segment and downloads the video', async () => {
  const d = setup();
  const calls: Call[] = [];
  const fetch = scripted(
    {
      'POST /v3/assets': [json(200, { data: { asset_id: 'img1' } }), json(200, { data: { asset_id: 'aud1' } }), json(200, { data: { asset_id: 'aud2' } })],
      'POST /v3/videos': [json(200, { data: { video_id: 'v1', status: 'waiting' } }), json(200, { data: { video_id: 'v2', status: 'waiting' } })],
      'GET /v3/videos/v1': [json(200, { data: { status: 'processing' } }), json(200, { data: { status: 'completed', video_url: 'https://cdn.example/v1.mp4' } })],
      'GET /v3/videos/v2': [json(200, { data: { status: 'completed', video_url: 'https://cdn.example/v2.mp4' } })],
      'GET https://cdn.example/v1.mp4': [new Response('mp4-1')],
      'GET https://cdn.example/v2.mp4': [new Response('mp4-2')],
    },
    calls,
  );
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  expect(adapter.name).toBe('heygen');
  const out1 = path.join(d, 'a01.mp4');
  expect(await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, out1)).toBe(out1);
  await adapter.make({ seg: 'a02', start: 3, end: 4, audio: path.join(d, 'a02.wav') }, path.join(d, 'a02.mp4'));
  expect(readFileSync(out1, 'utf8')).toBe('mp4-1');
  expect(calls.filter((c) => c.url.endsWith('/v3/assets'))).toHaveLength(3);
  const create = calls.find((c) => c.url.endsWith('/v3/videos'));
  expect(JSON.parse(String(create?.body))).toEqual({
    type: 'image',
    image: { type: 'asset_id', asset_id: 'img1' },
    audio_asset_id: 'aud1',
    aspect_ratio: 'auto',
    resolution: '1080p',
    background: { type: 'color', value: '#00b140' },
  });
  expect(create?.headers['x-api-key']).toBe(KEY);
  expect(create?.headers['idempotency-key']).toMatch(/^vm-[0-9a-f]{32}$/);
  expect(calls.filter((c) => c.url.startsWith('https://cdn.example')).every((c) => c.headers['x-api-key'] === undefined)).toBe(true);
});

test('heygen estimates the cost per minute, rounded up to cents', () => {
  const adapter = heygen({ apiKey: KEY, portrait: 'x', fetch: scripted({}, []), sleep: async () => {} });
  expect(adapter.costEstimate(60)).toBe(1);
  expect(adapter.costEstimate(10)).toBe(0.17);
});

test('heygen waits out a 429 and refuses a 401 without the key in the message', async () => {
  const d = setup();
  const waits: number[] = [];
  const busy = scripted(
    {
      'POST /v3/assets': [json(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } }, { 'retry-after': '2' }), json(401, { error: { code: 'unauthorized', message: `bad key ${KEY}`, request_id: 'q1' } })],
    },
    [],
  );
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch: busy, sleep: async (ms) => void waits.push(ms) });
  const err = await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, path.join(d, 'a01.mp4')).catch((e) => e);
  expect(err).toBeInstanceOf(InputError);
  expect(String(err.message)).not.toContain(KEY);
  expect(waits).toEqual([2000]);
});

test('heygen reports a failed render and leaves no output', async () => {
  const d = setup();
  const fetch = scripted(
    {
      'POST /v3/assets': [json(200, { data: { asset_id: 'img1' } }), json(200, { data: { asset_id: 'aud1' } })],
      'POST /v3/videos': [json(200, { data: { video_id: 'v1', status: 'waiting' } })],
      'GET /v3/videos/v1': [json(200, { data: { status: 'failed', failure_code: 'avatar_not_usable', failure_message: 'no face' } })],
    },
    [],
  );
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  const out = path.join(d, 'a01.mp4');
  const err = await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, out).catch((e) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect(String(err.message)).toContain('avatar_not_usable: no face');
  expect(existsSync(out)).toBe(false);
});
```

**Implementation notes:**
- `export type HeygenOptions = { apiKey: string; portrait: string; fetch?: typeof fetch; sleep?: (ms: number) =>
  Promise<void>; pollMs?: number; timeoutMs?: number };` defaults: `globalThis.fetch`, `Bun.sleep`, 5 000, 1 200 000.
  `export const heygen = (o: HeygenOptions): AvatarAdapter`, `name: 'heygen'`.
- `costEstimate(s) = Math.ceil((s / 60) * HEYGEN_USD_PER_MIN * 100) / 100` (R8).
- `request(method, url, body?)`: sends `x-api-key` (and `Idempotency-Key` when given) only to `https://api.heygen.com`;
  429 → `sleep(Number(retry-after ?? 10) × 1000)` then retry, at most 3 retries; 401/402 → `InputError(\`HeyGen
  refused the request (${code}): ${message}\`)`; other non-2xx → `VideoMachineError(\`HeyGen ${status} ${code}:
  ${message} (request ${request_id})\`)`. Every message passes through `scrub` that replaces the key with `***`.
- Upload: `FormData` with `file` = `new Blob([readFileSync(file)])` and a filename; read `data.asset_id`. The portrait
  is uploaded on the first `make` only.
- Create body exactly as the test; `Idempotency-Key` = `vm-` + first 32 hex of sha256(portrait bytes ‖ audio bytes).
- Poll `GET /v3/videos/{id}` every `pollMs`: `completed` → download `video_url` (plain `fetch`, no key) to
  `out.part`, rename to `out`; `failed` → `VideoMachineError(\`HeyGen could not make ${seg}: ${failure_code}:
  ${failure_message}\`)`; anything else → wait; past `timeoutMs` → `VideoMachineError`. Remove `out.part` on any
  error.

**Done when:** `sh .claude/tools/check.sh lib/adapters/avatar lib/core` passes.

---

### Task 6: M11 `lib/avatar/` (make + CLI)

**Agent:** lib-builder

**Read first:** `lib/voice/cli.ts` (whole, 110 lines: the CLI shape, `approvedOf`, the cost gate message);
`lib/core/cost.ts`; `lib/core/avatar.ts` (Task 2, grep `export`); `lib/core/paths.ts:23-34` (`runFileOf`);
`lib/core/cli.ts` (`runCli`); the adapters from Tasks 3–5 (grep `export`); this plan's R1–R4, R8, R10.

**Files:** Create `lib/avatar/make.ts`, `lib/avatar/make.test.ts`, `lib/avatar/cli.ts`, `lib/avatar/cli.test.ts`.
Modify `lib/core/cost.ts` (+ test) and `lib/voice/cli.ts` (import `approvedOf` from core instead of its own).

**Tests first:** `lib/avatar/make.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AvatarAdapter, AvatarSegmentsSchema, BriefSchema, ScriptSchema, TimingSchema } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import type { Sh } from '../core/sh';
import { makeAvatar } from './make';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const BRIEF = { run_id: 'r', concept: 'c', goals: [], duration_target_s: [5, 12], timing_source: 'voiceover' };
const line = (id: string, delivery: 'voiceover' | 'avatar') => ({ id, text: `Line ${id}.`, delivery });
const timed = (id: string, start: number, end: number) => ({ id, text: `Line ${id}.`, start, end, words: [] });

const run = (brief: Record<string, unknown> = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-m11-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'audio'));
  mkdirSync(path.join(dir, 'data'));
  writeFileSync(path.join(dir, 'audio', 'vo.wav'), 'wav');
  writeJson(path.join(dir, 'brief.json'), BriefSchema, { ...BRIEF, avatar: { source: 'adapter', adapter: 'fake', portrait: 'input/me.png' }, ...brief });
  writeJson(path.join(dir, 'script.json'), ScriptSchema, { run_id: 'r', version: 1, lines: [line('l1', 'voiceover'), line('l2', 'avatar'), line('l3', 'avatar')] });
  writeJson(path.join(dir, 'data', 'timing.json'), TimingSchema, { lines: [timed('l1', 0.2, 1.1), timed('l2', 1.35, 2.5), timed('l3', 2.75, 4)] });
  return dir;
};

/** ffmpeg and remove-background write their output; every command is recorded. */
const fakeDeps = (calls: string[][]): Deps => {
  const sh: Sh = async (cmd) => {
    calls.push(cmd);
    const o = cmd.indexOf('-o');
    writeFileSync(o === -1 ? (cmd.at(-1) ?? '') : (cmd[o + 1] ?? ''), 'x');
    return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
  };
  return { sh, config: loadConfig({}) };
};
const fakeAdapter = (usdPerS: number, made: string[]): AvatarAdapter => ({
  name: 'fake',
  costEstimate: (s) => Math.round(s * usdPerS * 100) / 100,
  make: async (job, out) => {
    made.push(job.seg);
    expect(existsSync(job.audio)).toBe(true);
    writeFileSync(out, 'raw');
    return out;
  },
});

test('makeAvatar cuts each segment, makes it, mattes it and writes avatar/ in one step', async () => {
  const dir = run();
  const calls: string[][] = [];
  const made: string[] = [];
  const res = await makeAvatar(dir, { deps: fakeDeps(calls), adapter: fakeAdapter(0, made) });
  expect(res).toEqual({ adapter: 'fake', usd: 0, segments: [{ seg: 'a01', line_ids: ['l2', 'l3'], start: 1.35, end: 4, file: 'avatar/a01.webm' }] });
  expect(made).toEqual(['a01']);
  expect(readdirSync(path.join(dir, 'avatar')).sort()).toEqual(['a01.webm', 'segments.json']);
  expect(readJson(path.join(dir, 'avatar', 'segments.json'), AvatarSegmentsSchema).segments).toEqual(res.segments);
  expect(existsSync(path.join(dir, 'avatar.tmp'))).toBe(false);
  const cut = calls.find((c) => c[0] === 'ffmpeg') ?? [];
  expect(cut.slice(cut.indexOf('-ss'), cut.indexOf('-ss') + 4)).toEqual(['-ss', '1.350', '-to', '4.000']);
  expect(calls.some((c) => c.includes('remove-background'))).toBe(true);
});

test('makeAvatar refuses an over-budget adapter before making anything', async () => {
  const dir = run();
  const made: string[] = [];
  await expect(makeAvatar(dir, { deps: fakeDeps([]), adapter: fakeAdapter(1, made) })).rejects.toThrow(/--approve-spend 2.65/);
  expect(made).toEqual([]);
  expect(existsSync(path.join(dir, 'avatar'))).toBe(false);
  const ok = await makeAvatar(dir, { deps: fakeDeps([]), adapter: fakeAdapter(1, made), approved_usd: 2.65 });
  expect(ok.usd).toBe(2.65);
});

test('a failed make keeps the previous avatar/ and leaves no avatar.tmp', async () => {
  const dir = run();
  mkdirSync(path.join(dir, 'avatar'));
  writeFileSync(path.join(dir, 'avatar', 'placement.json'), '{"segments":{"a01":"full"}}');
  const broken: AvatarAdapter = { name: 'fake', costEstimate: () => 0, make: async () => { throw new Error('gpu fell over'); } };
  await expect(makeAvatar(dir, { deps: fakeDeps([]), adapter: broken })).rejects.toThrow('gpu fell over');
  expect(readdirSync(path.join(dir, 'avatar'))).toEqual(['placement.json']);
  expect(existsSync(path.join(dir, 'avatar.tmp'))).toBe(false);
});

test('makeAvatar refuses runs it cannot serve', async () => {
  await expect(makeAvatar(run({ avatar: undefined }), { deps: fakeDeps([]) })).rejects.toThrow(InputError);
  await expect(makeAvatar(run({ timing_source: 'text_only' }), { deps: fakeDeps([]) })).rejects.toThrow(UnsupportedError);
  await expect(makeAvatar(run({ avatar: { source: 'adapter', adapter: 'sadtalker', portrait: 'input/me.png' } }), { deps: fakeDeps([]) })).rejects.toThrow(UnsupportedError);
  await expect(makeAvatar(run({ avatar: { source: 'adapter', adapter: 'heygen', portrait: 'input/me.png' } }), { deps: fakeDeps([]), env: {} })).rejects.toThrow(/HEYGEN_API_KEY/);
});
```

`lib/avatar/cli.test.ts`: `main(['make', dir, '--approve-spend', 'x'])` → `InputError`; `main(['boxes', dir])` on a
run with `avatar/segments.json`, `avatar/placement.json` and a reel `plan.json` → `{ boxes: { reel: [ …AvatarBox ] } }`;
`main(['nope', dir])` → `InputError` (usage). `lib/core/cost.test.ts`: `approvedOf([], U)` → 0;
`approvedOf(['--approve-spend', '2.5'], U)` → 2.5; `['--approve-spend', 'x']` and `['--x']` → `InputError`.

**Implementation notes:**
- `lib/core/cost.ts`: `export const approvedOf = (rest: string[], usage: string): number` (moved from
  `lib/voice/cli.ts`, same rules; `voice/cli.ts` calls `approvedOf(rest, USAGE)`).
- `export type MakeIo = { deps?: Deps; adapter?: AvatarAdapter; matte?: typeof removeBackground; approved_usd?:
  number; env?: Env }` (`env` defaults to `process.env`).
- `makeAvatar(runDir, io): Promise<{ adapter: string; usd: number; segments: AvatarSegments['segments'] }>`:
  1. `brief.avatar` missing → `InputError('the brief asks for no avatar')`; `timing_source !== 'voiceover'` →
     `UnsupportedError` (R10); no `audio/vo.wav` or `data/timing.json` → `InputError('voice and align first')`.
  2. `spans = avatarSegments(script, timing)`; empty → `InputError('no script line has delivery "avatar"')`.
  3. Adapter: `io.adapter`, else `supplied` → `suppliedAvatar(deps, runFileOf(runDir, clip))`; `adapter: 'heygen'`
     → `heygen({ apiKey: env.HEYGEN_API_KEY, portrait: runFileOf(runDir, portrait) })`, a missing key →
     `UnsupportedError('set HEYGEN_API_KEY to use HeyGen')`; any other name → `UnsupportedError(\`avatar adapter
     "${name}" is not available; use heygen or a supplied clip\`)`.
  4. Cost gate: `costGate(spans.map((s) => ({ what: \`avatar ${s.seg} (${adapter.name})\`, usd:
     adapter.costEstimate(s.end - s.start) })), brief.budget_usd, io.approved_usd ?? 0)`; not ok → `InputError` with
     the voice CLI's wording (`… re-run with --approve-spend ${total_usd}`). Nothing is cut or sent before this.
  5. `tmp = avatar.tmp` (removed first). Per span: `ffmpeg -v error -y -ss <start.toFixed(3)> -to <end.toFixed(3)>
     -i audio/vo.wav -c:a pcm_s16le tmp/<seg>.wav`; `adapter.make({seg, start, end, audio}, tmp/<seg>.raw.mp4)`;
     `matte(deps, raw, tmp/<seg>.webm)`; delete the `.wav` and `.raw.mp4`. Then `writeJson(tmp/segments.json)`.
  6. Remove `avatar/`, rename `avatar.tmp` → `avatar`. Any error: remove `avatar.tmp`, rethrow (old `avatar/` stays).
- `lib/avatar/cli.ts`: `USAGE = 'usage: cli.ts make <run_dir> [--approve-spend usd] | boxes <run_dir>'`. `make` →
  `makeAvatar(runDir, { approved_usd: approvedOf(rest, USAGE) })`. `boxes` → `{ boxes: { [format]:
  avatarBoxesOf(runDir, format) } }` for each `plan.formats`. `if (import.meta.main)` via `runCli`, as the voice CLI.

**Done when:** `sh .claude/tools/check.sh lib/avatar lib/core lib/voice` passes.

---

### Task 7: The avatar layer in the build

**Agent:** lib-builder

**Read first:** `lib/adapters/render/hyperframes/project.ts:48-142` (`rootHtml`, `assembleProject`);
`lib/adapters/render/hyperframes/project.test.ts:1-112` (fixture `run`) and `:131-142`; `lib/core/avatar.ts` (grep
`export`); this plan's Tech stack (`<video>` probe) and R6.

**Files:** Modify `lib/adapters/render/hyperframes/project.ts`, `lib/adapters/render/hyperframes/project.test.ts`.

**Tests first:** add to `project.test.ts`:

```ts
const withAvatar = (dir: string, placement: Record<string, string> = { a01: 'corner-br' }) => {
  mkdirSync(path.join(dir, 'avatar'), { recursive: true });
  writeFileSync(path.join(dir, 'avatar', 'a01.webm'), 'webm');
  writeJson(path.join(dir, 'avatar', 'segments.json'), AvatarSegmentsSchema, {
    run_id: 'r',
    adapter: 'supplied',
    segments: [{ seg: 'a01', line_ids: ['l2'], start: 2, end: 4.25, file: 'avatar/a01.webm' }],
  });
  writeJson(path.join(dir, 'avatar', 'placement.json'), AvatarPlacementSchema, { segments: placement });
  return dir;
};

test('the root page lays each avatar segment over the scenes and the build carries its webm', async () => {
  const out = await assembleProject(withAvatar(run()), 'reel');
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  expect(html).toContain(
    '<video id="avatar-a01" class="clip" src="avatar/a01.webm" muted playsinline data-start="2" data-duration="2.25" data-track-index="3" style="position:absolute;left:587px;top:966px;width:428px;height:570px;object-fit:contain;object-position:right bottom;z-index:10"></video>',
  );
  expect(html.indexOf('id="avatar-a01"')).toBeGreaterThan(html.indexOf('id="host-demo"'));
  expect(readFileSync(path.join(out, 'avatar', 'a01.webm'), 'utf8')).toBe('webm');
});

test('a run without avatar/ has no video layer; a missing webm or placement throws InputError', async () => {
  const plain = await assembleProject(run(), 'reel');
  expect(readFileSync(path.join(plain, 'index.html'), 'utf8')).not.toContain('<video');
  const noWebm = withAvatar(run());
  rmSync(path.join(noWebm, 'avatar', 'a01.webm'));
  await expect(assembleProject(noWebm, 'reel')).rejects.toThrow(InputError);
  const noPlacement = withAvatar(run());
  rmSync(path.join(noPlacement, 'avatar', 'placement.json'));
  await expect(assembleProject(noPlacement, 'reel')).rejects.toThrow(InputError);
});
```
(Import `AvatarPlacementSchema`, `AvatarSegmentsSchema`; the fixture has two scenes, so the avatar's track is 3.)

**Implementation notes:**
- In `assembleProject`, before the `try`: `const avatars = avatarBoxesOf(runDir, format)`; each `avatar/<seg>.webm`
  missing → `InputError(\`avatar/${seg}.webm is missing: make the avatar again\`)` (nothing written).
- `rootHtml(format, times, total, avatars)`: after `${hosts}`, one line per box (format exactly as the test):
  `data-start` = `start`, `data-duration` = `round3(end - start)`, `data-track-index` = `times.length + 1 + k`.
- Inside the `try`, after `vo.wav`: `mkdir tmp/avatar` and copy each `.webm` when `avatars.length > 0`.
- Update the `rootHtml` comment: "… one host per scene, the avatar layer and the voiceover audio."

**Done when:** `sh .claude/tools/check.sh lib/adapters/render` passes.

---

### Task 8: Keep text out of the avatar: `layout.safe_area` and `scenes todo`

**Agent:** lib-builder

**Read first:** `lib/checks/layout.ts` (whole, 89 lines); `lib/scenes/check.ts:236-262` (the `checkSafeArea` call);
`lib/scenes/todo.ts` (whole, ~70 lines); `lib/core/avatar.ts` (grep `export`); `lib/core/scene-times.ts:10-20` and
`:85` (`SceneTime`, `sceneTimes`); this plan's R7.

**Files:** Modify `lib/checks/layout.ts`, `lib/checks/layout.test.ts`, `lib/scenes/check.ts`, `lib/scenes/todo.ts`,
`lib/scenes/todo.test.ts`.

**Tests first:** `lib/checks/layout.test.ts` (add):

```ts
const box = { seg: 'a01', start: 2, end: 4, x: 587, y: 966, w: 428, h: 570, fit: 'right bottom' };
const sample = (t: number, x: number, y: number, text = 'Ship it') => ({ t, scene_id: 's1', text, box: { x, y, w: 300, h: 80 }, font_px: 80, caption: false });

test('layout.safe_area fails text under an avatar box only while the segment is on', () => {
  const under = sample(3, 600, 1000);
  const r = checkSafeArea([under, sample(1, 600, 1000, 'Before'), sample(4, 600, 1000, 'After')], 'reel', [box]);
  expect(r.status).toBe('fail');
  expect(r.annotations).toEqual([{ scene_id: 's1', t: 3, problem: '"Ship it" sits under the avatar (a01)', suggested_fix: 'move the text inside var(--vm-safe-*)' }]);
});

test('layout.safe_area allows text that only touches the avatar box within 2 px', () => {
  const beside = sample(3, 587 - 300 + 2, 1000); // right edge 2 px into the box
  expect(checkSafeArea([beside], 'reel', [box]).status).toBe('pass');
  expect(checkSafeArea([sample(3, 600, 1000)], 'reel').status).toBe('pass');
});
```
(Keep the existing `suggested_fix`; the annotation wording for a text that is both outside the safe area and under
the avatar is the edges message followed by `; ` and the avatar message.)

`lib/scenes/todo.test.ts` (add): a run with `plan.json` (scenes `hook` 0–1.6 s and `demo` 1.6–5.5 s, via the file's
fixture plus a `data/timing.json`), `avatar/segments.json` (`a01` 2–4.25 s) and `placement.json` (`a01: corner-br`):
`scenesTodo(run)` gives `demo` `avatar: [{ format: 'reel', seg: 'a01', start: 0.4, end: 2.65, box: { x: 587, y: 966,
w: 428, h: 570 } }]` (times relative to the scene) and `hook` no `avatar` key. Without `avatar/` no entry has an
`avatar` key.

**Implementation notes:**
- `checkSafeArea(samples, format, avatars: AvatarBox[] = [])` (type from `../core/avatar`). An overlap is
  `min(ax1, bx1) − max(ax0, bx0) > SAFE_TOLERANCE_PX` on both axes, for a box with `start ≤ s.t < end`. Problem text
  per R7; combined with the edges message as noted above.
- `lib/scenes/check.ts`: `checkSafeArea(m.text, m.format, avatarBoxesOf(runDir, m.format))`.
- `Todo` gains `avatar?: { format: FormatId; seg: string; start: number; end: number; box: { x: number; y: number;
  w: number; h: number } }[]`. In `scenesTodo`, when `avatar/segments.json` exists, read `data/timing.json`, take
  `sceneTimes(plan, timing)`, and for each todo scene and each plan format list the boxes that overlap the scene's
  window, clipped to it and made relative to the scene start (rounded to ms). Omit the key when the list is empty.

**Done when:** `sh .claude/tools/check.sh lib/checks lib/scenes` passes.

---

### Task 9: Shipped: `avatar-director`, `skills/avatar`, routing and the scene writer

**Agent:** plugin-builder

**Read first:** `skills/voice/SKILL.md` (whole, 65 lines: the shape of a part skill with a cost gate);
`skills/make-video/SKILL.md:60-75` and `:105-125`; `agents/scene-writer.md` (whole, 66 lines); `docs/BLUEPRINT.md`
1.6 Avatar row; this plan's U2, U3, R2, R5, R8.

**Files:** Create `agents/avatar-director.md`, `skills/avatar/SKILL.md`. Modify `skills/make-video/SKILL.md`,
`agents/scene-writer.md`, `skills/scenes/SKILL.md` (one line, if step 1 lists what `todo` returns).

**Tests first:** none (prose); the spec reviewer checks the list below.

**Implementation notes:**
- `skills/avatar/SKILL.md` (M11, < 60 lines, frontmatter like `skills/voice`): 1. `bun lib/avatar/cli.ts make
  runs/<id>`; on the cost refusal, tell the creator the price and the segments (HeyGen ≈ $1/min, an estimate), and
  re-run with `--approve-spend <usd>` only after a yes. 2. Dispatch `video-machine:avatar-director` with the run
  path. 3. `bun lib/avatar/cli.ts boxes runs/<id>` must succeed; on an error give the director the message once.
  4. Tell the creator in one line which segments got which preset. A supplied clip must run along the whole
  voiceover (filmed while reading the script); HeyGen needs `HEYGEN_API_KEY`.
- `agents/avatar-director.md` (frontmatter: name, description, tools Read/Write/Bash, model sonnet): reads
  `avatar/segments.json`, `plan.json` (scene `intent`, `layout`, which scenes each segment spans), `look/LOOK.md`;
  writes `avatar/placement.json` `{"segments": {"a01": "<preset>"}}`, one of `corner-br`, `corner-bl`, `bottom`,
  `full`; `full` only when the scene is the avatar talking (little or no text); corners for scenes with text; keep a
  preset steady across one segment's scenes; then runs the `boxes` command. Never edits any other file.
- `make-video`: routing table `M11` → `video-machine:avatar` (replace "stop"); remove the "stop at M11" wording so the
  loop runs to `done`; the supplied-files example becomes `"avatar": {"source": "supplied", "clip": "input/me.mp4"}`
  and add `"avatar": {"source": "adapter", "adapter": "heygen", "portrait": "input/me.png"}`.
- `scene-writer.md`: when the todo entry has `avatar`, no text (captions included) may sit inside those boxes during
  those scene-relative times; `layout.safe_area` fails it.

**Done when:** `node_modules/.bin/bun tests/phase1.ts` still passes its plugin-validate checks (or the same skips as
before) and `grep -n "M11" skills/make-video/SKILL.md` shows the avatar route.

---

### Task 10: Acceptance `tests/phase8.ts`

**Agent:** lib-builder

**Read first:** `tests/phase7.ts:1-260` (helpers: `check`, `call`/`callOk`, `newRun`, `prepare`, `probe`); the CLIs
from Task 6 (`lib/avatar/cli.ts`) and `lib/scenes/cli.ts:14`; this plan's Tech stack (the red-disc probe).

**Files:** Create `tests/phase8.ts`.

**Tests first:** the file is the test. Real tools (ffmpeg, HyperFrames 0.8.143, bun CLIs); prints PASS/FAIL/SKIP
per check and exits 1 on any FAIL:

1. **segments** — a run with script `l1` voiceover, `l2`+`l3` avatar, `l4` voiceover; voiced by `voice synth`
   (Kokoro) and aligned; `avatar make` with a supplied clip (`input/me.mp4`: ffmpeg `testsrc2` 720×1280, 30 fps, as
   long as `vo.wav` + 1 s) → one segment `a01` whose start/end equal `l2.start` / `l3.end` from `timing.json`.
2. **matte** — `avatar/a01.webm`: ffprobe `codec_name=vp9`, tag `alpha_mode=1`, no audio stream, duration within
   0.1 s of `end − start`.
3. **gate** — the same run with `{source:"adapter", adapter:"heygen", portrait}`, `HEYGEN_API_KEY=dummy` and
   budget 0: `avatar make` exits non-zero naming `--approve-spend`, and `avatar/` is unchanged (sha of
   `segments.json`).
4. **layer** — write `placement.json` `{a01: "corner-br"}`, replace `avatar/a01.webm` with a red-disc alpha webm
   (`geq` as in the probe, 428×570), write the scene fragments (plain dark background, text away from the box),
   `scenes done`, `scenes build`: in the draft, the pixel at the box centre (801, 1251) is red (R > 200, G < 60) at
   the segment's middle and not red 0.3 s before its start.
5. **under** — move one scene's text into the box during the segment, rebuild, `scenes check`: `layout.safe_area`
   fails with an annotation containing `sits under the avatar (a01)`; every other blocking check keeps its status
   from check 4.
6. **seek** — `render.seek_safe` and `render.deterministic` pass on the build from check 4.
7. **review** — `review` with route `words` removes `avatar/` and `history/1/avatar/segments.json` exists.
8. **heygen live** — SKIP unless `HEYGEN_API_KEY` and `VM_HEYGEN_APPROVE_USD` are set; then `avatar make
   --approve-spend $VM_HEYGEN_APPROVE_USD` on a 1-line avatar run with `input/me.png` (the creator's portrait from
   `VM_HEYGEN_PORTRAIT`) → `a01.webm` with alpha.

**Implementation notes:** follow `tests/phase7.ts` structure (temp runs under a temp `runs/`, `removeTemps` in
`finally`). Pixel reads: `ffmpeg -v error -ss <t> -i <draft> -frames:v 1 -vf "crop=1:1:<x>:<y>,format=rgb24" -f
rawvideo -` → 3 bytes.

**Done when:** `node_modules/.bin/bun tests/phase8.ts` prints PASS for 1–7 and PASS or SKIP for 8.

---

### Task 11 (deferred, U1): Local audio-driven avatar adapter

Not a builder task yet. The orchestrator writes it after the creator runs this test **on the reference laptop**
(RTX 3050 4 GB, Ryzen 7 7435HS, Windows) and reports the numbers:

For each of Wav2Lip, SadTalker, MuseTalk: install into `~/.video-machine/avatar/<name>/` (own venv), run one 10 s
WAV + one portrait PNG, and record: does it run in 4 GB VRAM (peak from `nvidia-smi --query-gpu=memory.used
--format=csv -l 1`), wall time per output second, install size, licence, and how it looks (lips, head motion,
artefacts at the face edge after `remove-background`). Pick the one that runs, then looks best; ties go to the
smaller install.

The task will then add `lib/adapters/avatar/<name>/` (`make` = the model on `job.audio` + the brief portrait,
`costEstimate` 0), its M0 install step and doctor entry, `makeAvatar`'s adapter switch, and a `tests/phase8.ts`
check that SKIPs without CUDA.
