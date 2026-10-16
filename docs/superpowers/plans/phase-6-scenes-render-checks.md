# Phase 6 — Scenes, Render, Checks Implementation Plan

**Goal:** Given a run at M12 (plan, look, assets, `audio/vo.wav` and `data/timing.json` exist), the `scene-writer`
subagent writes one HTML fragment per scene (`scenes/<scene_id>.html`). The lib turns them into one HyperFrames project
per format (`build/<format>/`) that takes every time from `data/timing.json` by content (M12). The render adapter then
lints and checks each project, snapshots a contact sheet and renders a draft MP4 (M13). The checks HyperFrames lacks run
over the build and the draft, then write `test_results.json` and `report.md`. Failures are named per scene, so the skill
re-dispatches only those scenes, at most 3 rounds (M14).

**Architecture:**
- **Core:** `lib/core/scene-times.ts` (`sceneTimes`: scene start/duration, beat and word times relative to each
  scene) and `lib/core/text-fit.ts` (`minTextPx`, `fitPx`).
- **Render adapter** `lib/adapters/render/hyperframes/`: `runtime/vm.ts` (the browser helper scenes call:
  `VM.scene(id).at(word)`, `.beat(i)`, `.fit(el)`), `runtime/bundle.ts` (bundles it with `Bun.build`), `project.ts`
  (`assembleProject`), `index.ts` (`hyperframesRender`: the `RenderAdapter`), `measure.ts` (text boxes from a seeked
  page, frame differences, snapshot hashes). `compose.ts` (Phase 4) is reused, not rewritten.
- **Checks** `lib/checks/`: `layout.ts`, `captions.ts`, `duration.ts`, `motion.ts`, `assets.ts`, `stability.ts`
  (pure functions over measurements).
- **Part folder** `lib/scenes/`: `build.ts` (assemble → lint/check → sheet → draft), `check.ts` (all checks →
  `test_results.json`, `report.md`), `cli.ts` (`times`, `build`, `check`).
- **Shipped:** `agents/scene-writer.md` (composition rules), `skills/scenes/SKILL.md` (M12–M14 with the 3-round
  auto-fix), `make-video` routes M12–M14.

**Tech stack (probed 2026-10-14 on the reference Mac, HyperFrames 0.8.143 through `HF_CMD`):**
- Nested compositions: root host `<div id="host-x" data-composition-id="x" data-composition-src="compositions/x.html"
  data-start="2" data-duration="2">`; the file is `<template><div data-composition-id="x" data-width data-height
  data-duration>…<script>…window.__timelines.x = tl</script></div></template>`. Scene scripts see the root's globals
  (`gsap`, `VM`). Outside its window a scene's elements are `visibility: hidden`.
- **`lint` only scans sub-compositions under `compositions/`** (`filesScanned` 3 there, 1 when they sat in `scenes/`),
  and ignores other subfolders (`boards/`). It flags `Math.random()` as `non_deterministic_code` (error). A host without
  `id` gives the warning `studio_missing_editable_id`.
- `check --json --no-browser-gpu <dir>` (≈ 5 s for 4 s): `{ok, lint:{findings}, runtime:{findings}, layout:{findings},
  motion, contrast:{findings}, …}`; findings `{code, severity, message, selector, time?, file?}`. It does **not** flag
  text inside the Instagram zones (`--caption-zone` and `--frame-check` did not either), so safe area and text size
  are measured by us.
- `render <dir> --quality draft --no-browser-gpu --quiet -o <f>.mp4`: 4 s reel in 8 s; root `<audio id="vo"
  data-start="0" data-duration="T" src="vo.wav">` muxes as AAC 48 kHz. H.264 1080×1920 30 fps.
- `snapshot` as in `compose.ts` (`frame-NN-at-Xs.png` + `contact-sheet.jpg`), ≈ 3.5 s for 3 frames.
- Frame difference: `ffmpeg -v error -i draft.mp4 -vf "format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-" -f null -`
  prints one `lavfi.signalstats.YMAX=<n>` per frame pair. A still frame gives `0` (one encoder blip of `5` seen); a
  0.5 s fade of a 30 px line gives 11–44; a scene cut 220. Threshold **8**.
- Seek-and-measure (Playwright 1.63.0 + bun): serve the build folder with `Bun.serve`, `page.goto`, then
  `page.addScriptTag({ path: <hyperframe.runtime.iife.js> })`, wait for `window.__playerReady && window.__renderReady`,
  then per time `await window.__player.seek(t); await window.__hfWaitForSeekCompletion?.()`. Boxes and computed
  styles are then exact (probe: `#t1` at 1 s `{x:100,y:800,w:880,h:138,fontSize:"120px",visibility:"visible"}`).
- The runtime file: `npm pack hyperframes@0.8.143 --pack-destination <dir>` (10 MB tgz), then
  `tar -xzf <tgz> -C <dir> package/dist/hyperframe.runtime.iife.js` (509 KB).

**Spec:** `docs/BLUEPRINT.md`: Part 5 Phase 6; 1.3 Non-negotiable 2 (timing by content); 2.3 (HyperFrames rows);
2.5 (`RenderAdapter`); 2.6 (determinism, safe area, reference footage, licences); 2.7 (min text size, dead span,
beat tolerance, auto-fix rounds); 2.8 (check table).

## Global Constraints

- Call bun as `node_modules/.bin/bun`. Every HyperFrames call starts with `HF_CMD`, passes `env: deps.config.toolEnv`
  and `--no-browser-gpu` where the command takes it. Only `lib/core/sh.ts` spawns processes (Playwright's browser
  launch is the one existing exception, as in `adapters/capture/playwright`). Tests pass a fake `deps.sh`.
- Import direction: `lib/scenes` → `lib/checks`, `lib/adapters` → `lib/core` → `lib/contracts`. Adapters never import
  each other. `lib/checks` imports only `lib/core` and `lib/contracts`.
- Run-folder JSON goes only through `writeJson` / `readJson`; a run path from JSON is opened only through `runFileOf`.
- Nothing half-made may look done: `build/<format>/`, drafts, sheets, `test_results.json` and `report.md` are written
  to a temp name and renamed; a failed step leaves no output that looks current.
- `build/` is generated: nothing in it is edited by hand or by an agent. Scenes are edited only in `scenes/`.
- Voiceover runs only (`brief.timing_source === "voiceover"`); others throw `UnsupportedError` (R5).

## Review Focus

- Every time a scene uses comes from `data/timing.json` through `sceneTimes` / `VM` — no number of seconds is typed
  into a scene, the root or a test fixture's scene.
- A failed build, render or check never leaves a previous `build/<format>/`, draft or `test_results.json` that looks
  current.
- The static server in `measure.ts` serves only files inside the build folder.
- Every check names the scene (and `t`) in each annotation, so the auto-fix can re-dispatch only those scenes.

## Rulings made in this plan (orchestrator, 2026-10-14; listed in the phase summary)

User rulings (asked 2026-10-14): **U1** the HyperFrames project is generated per format in `build/<format>/` from
`scenes/<id>.html` fragments; **U2** the acceptance test uses stand-in scenes; the user runs one concept end to end by
hand afterwards.

- **R1** M12's `where` marker becomes `build/` (non-empty folder) instead of `index.html`. Cost if wrong: one marker.
- **R2** The lib owns each scene's wrapper (`<template>`, `data-composition-id`, size, duration) and the root. A
  fragment that contains `<template` or `data-composition-id` is refused. Cost if wrong: none.
- **R3** Scene start (`cut_in.rule`): first scene 0; `pause_before` = midpoint between the previous line's end and this
  scene's first line start; `on_word` = start of `cut_in.anchor` in the scene's first line. `on_beat` and beats
  `on: "beat:N"` throw `UnsupportedError` (no music beats before Phase 7). The last scene ends **1.0 s** after the
  last word. Cost if wrong: one function.
- **R4** A beat's `on` is looked up in the scene's lines in order; `nth` counts across those lines. Cost if wrong: none.
- **R5** Phase 6 supports `timing_source: "voiceover"` only. Cost if wrong: a task later.
- **R6** Text fit: `lib/core/text-fit.ts` holds the pure part (`minTextPx`, the `fitPx` search); the browser helper
  `VM.fit(el)` runs it against real layout. Min text for `square` is 2.5 % (blueprint names vertical and landscape
  only). Text size = computed `font-size` × the element's on-screen scale. Cost if wrong: a constant.
- **R7** `contactSheet` returns HyperFrames' `contact-sheet.jpg` copied to `out/sheets/<format>.jpg` (the interface
  says PNG). Cost if wrong: a re-encode.
- **R8** Motion threshold: per-frame YMAX of the grey frame difference > **8** counts as change. A dead span is more
  than 1.5 s of frames at or below it, unless the last beat before it (in its scene) has `hold`. A beat is on cue when a frame within
  ±2 frames of its word start is above it. Cost if wrong: a constant.
- **R9** `render.deterministic`: snapshot 5 times (seeded from the run id) twice, in two processes; sha256 per frame
  must match. `render.seek_safe`: each of those times snapshotted alone must match the same time from the batch run
  (which seeks forward through earlier times). Not true playback; cost if wrong: a stronger check later.
- **R10** The HyperFrames runtime used for measuring is fetched once with `npm pack` into
  `VM_HOME/hf/0.8.143/hyperframe.runtime.iife.js`. Cost if wrong: a 10 MB download.
- **R11** Layout sample times: every 0.5 s from 0.25 s, plus each word's midpoint (for captions). Cost if wrong:
  slower checks.
- **R12** Captions are elements inside `[data-vm-caption]`. `captions.match` is `skip` when a build has none.
- **R13** `test_results.json` checks this phase writes: `plan.coverage`, `script.facts_cited` (existing functions),
  `render.lint`, `render.deterministic`, `render.seek_safe`, `motion.no_dead_spans`, `timing.beats_on_cues`,
  `timing.duration`, `layout.safe_area`, `layout.min_text_size`, `layout.no_overflow`, `assets.no_reference_only`,
  `assets.licensed`, `captions.match`. `contracts.valid`, `brief.applied`, `audio.loudness`, `deliver.files` and the
  judges wait for Phase 7. Cost if wrong: none.

### Orchestrator pre-step (before Task 1, not a builder task)

Update `docs/BLUEPRINT.md`: 2.4 run folder layout `index.html, scenes/` → `scenes/ (fragments), build/<format>/
(generated HyperFrames project)` (U1); 2.5 `contactSheet` returns `out/sheets/<format>.jpg` (R7); 2.7 add rows "motion
change threshold | grey frame-diff YMAX | `8`" (R8) and "min text size" square `2.5` (R6); 2.8 `render.seek_safe` how
→ R9 wording; Phase 6 bullet: "text-fit: pure search in `lib/core`, run in the browser by `VM.fit`" (R6). Commit
`docs(blueprint): Phase 6 rulings`.

---

### Task 1: Scene times

**Agent:** lib-builder

**Read first:** `lib/core/timing.ts` (whole, ~70 lines), `lib/contracts/types.ts:213-246` (`ScenePlanSchema`,
`PlanSchema`), `lib/contracts/types.ts:306-326` (`TimingSchema`), `lib/core/timing.test.ts:1-30` (fixture style).

**Files:** Create `lib/core/scene-times.ts`, `lib/core/scene-times.test.ts`.

**Tests first:** `lib/core/scene-times.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { Plan, Timing } from '../contracts/types';
import { InputError, UnsupportedError } from './errors';
import { TAIL_S, sceneTimes } from './scene-times';

const w = (w: string, start: number, end: number) => ({ w, start, end });
const timing: Timing = {
  lines: [
    { id: 'l1', text: 'Meet Firecrawl today', start: 0.2, end: 1.4, words: [w('Meet', 0.2, 0.5), w('Firecrawl', 0.55, 1.1), w('today', 1.15, 1.4)] },
    { id: 'l2', text: 'Crawl any site', start: 1.8, end: 2.9, words: [w('Crawl', 1.8, 2.2), w('any', 2.25, 2.5), w('site', 2.55, 2.9)] },
    { id: 'l3', text: 'any site at all', start: 3.3, end: 4.5, words: [w('any', 3.3, 3.5), w('site', 3.55, 3.9), w('at', 3.95, 4.1), w('all', 4.15, 4.5)] },
  ],
};
const scene = (id: string, lines: string[], cut: Plan['visuals_plan']['scenes'][number]['cut_in'], beats: Plan['visuals_plan']['scenes'][number]['beats'] = []) => ({
  scene_id: id, lines, cut_in: cut, intent: 'x', beats, layout: { reel: 'x' }, transition_out: 'cut', asset_ids: [], input_hash: 'h',
});
const plan = (scenes: ReturnType<typeof scene>[]): Plan => ({
  run_id: 'r', version: 1, look_id: 'a', visuals_plan: { scenes }, asset_ids: [], formats: ['reel'],
});

describe('sceneTimes', () => {
  test('first scene starts at 0; pause_before cuts mid-gap; last ends TAIL_S after the last word', () => {
    const t = sceneTimes(plan([
      scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
      scene('demo', ['l2', 'l3'], { anchor: 'Crawl', rule: 'pause_before' }),
    ]), timing);
    expect(t.map((s) => [s.scene_id, s.start, s.duration])).toEqual([['hook', 0, 1.6], ['demo', 1.6, 3.9]]);
    expect(TAIL_S).toBe(1);
  });
  test('on_word cuts at the anchor word in the first line', () => {
    const t = sceneTimes(plan([
      scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
      scene('demo', ['l2', 'l3'], { anchor: 'Crawl', rule: 'on_word' }),
    ]), timing);
    expect(t[1]?.start).toBe(1.8);
  });
  test('beats are relative to the scene; nth counts across the scene lines', () => {
    const t = sceneTimes(plan([
      scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
      scene('demo', ['l2', 'l3'], { anchor: 'Crawl', rule: 'pause_before' }, [
        { on: 'site', does: 'a' }, { on: 'site', nth: 1, does: 'b', hold: true }, { on: 'any site', does: 'c' },
      ]),
    ]), timing);
    expect(t[1]?.beats).toEqual([
      { on: 'site', nth: 0, t: 0.95, hold: false },
      { on: 'site', nth: 1, t: 1.95, hold: true },
      { on: 'any site', nth: 0, t: 0.65, hold: false },
    ]);
    expect(t[1]?.words[0]).toEqual({ line: 'l2', w: 'Crawl', start: 0.2, end: 0.6 });
  });
  test('a beat word missing from the scene lines fails naming the scene', () => {
    expect(() => sceneTimes(plan([scene('hook', ['l1', 'l2', 'l3'], { anchor: 'Meet', rule: 'pause_before' }, [{ on: 'zebra', does: 'x' }])]), timing))
      .toThrow(/hook.*zebra/);
  });
  test('on_beat and beat:N are not supported yet', () => {
    expect(() => sceneTimes(plan([scene('hook', ['l1', 'l2', 'l3'], { anchor: 'x', rule: 'on_beat' })]), timing)).toThrow(UnsupportedError);
    expect(() => sceneTimes(plan([scene('hook', ['l1', 'l2', 'l3'], { anchor: 'Meet', rule: 'pause_before' }, [{ on: 'beat:3', does: 'x' }])]), timing)).toThrow(UnsupportedError);
  });
  test('a scene that would not start after the previous one fails', () => {
    expect(() => sceneTimes(plan([
      scene('hook', ['l1'], { anchor: 'Meet', rule: 'pause_before' }),
      scene('demo', ['l2', 'l3'], { anchor: 'all', rule: 'on_word' }),
    ]), timing)).toThrow(InputError);
  });
});
```

**Implementation notes:**
- `export const TAIL_S = 1;` `export type SceneTime = { scene_id: string; start: number; duration: number; lines:
  string[]; beats: { on: string; nth: number; t: number; hold: boolean }[]; words: { line: string; w: string; start:
  number; end: number }[] }`.
- `export function sceneTimes(plan: Plan, timing: Timing): SceneTime[]`. Lines through `lineOf`; words and phrases
  through `wordOf` (R3, R4). `on_word` looks the anchor up only in the scene's first line (an anchor in a later line
  of the scene fails with InputError naming the scene). `nth` across lines: walk the scene's lines in order, try
  `wordOf(line, on, k)` for k = 0, 1, … until it throws, and take the overall nth.
- Every number rounded to 3 decimals (`Math.round(x * 1000) / 1000`), computed from unrounded values.
- Errors: InputError `scene <id>: …` for a missing beat word, an anchor not in the first line, a start not after the
  previous scene's start, or a beat before its scene starts; UnsupportedError for `on_beat` and `beat:N`.
- JSDoc on the export: what it returns and what it throws.

**Done when:** `sh .claude/tools/check.sh lib/core` passes.

---

### Task 2: Text fit and the browser helper `VM`

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:14-31` (`FORMATS`, `frameOf`), `lib/core/scene-times.ts` (Task 1, the
`SceneTime` type only).

**Files:** Create `lib/core/text-fit.ts`, `lib/core/text-fit.test.ts`,
`lib/adapters/render/hyperframes/runtime/vm.ts`, `lib/adapters/render/hyperframes/runtime/bundle.ts`,
`lib/adapters/render/hyperframes/runtime/bundle.test.ts`.

**Tests first:**

`lib/core/text-fit.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { fitPx, minTextPx } from './text-fit';

test('minTextPx is 3.5 % of height on vertical, 2.5 % elsewhere, rounded up', () => {
  expect(minTextPx('reel')).toBe(68); // 1920 * 0.035 = 67.2
  expect(minTextPx('portrait_feed')).toBe(48); // 1350 * 0.035 = 47.25
  expect(minTextPx('landscape_1080p')).toBe(27); // 1080 * 0.025
  expect(minTextPx('square')).toBe(27);
});
test('fitPx finds the largest size that fits', () => {
  expect(fitPx((px) => px <= 93, 40, 200)).toBe(93);
  expect(fitPx(() => true, 40, 200)).toBe(200);
});
test('fitPx returns the minimum when nothing fits', () => {
  expect(fitPx(() => false, 40, 200)).toBe(40);
});
```

`lib/adapters/render/hyperframes/runtime/bundle.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { vmScript } from './bundle';

const data = {
  format: { w: 1080, h: 1920, min_text_px: 68, max_text_px: 230 },
  scenes: {
    demo: { scene_id: 'demo', start: 1.6, duration: 3.9, lines: ['l2'], beats: [{ on: 'site', nth: 0, t: 0.95, hold: false }],
      words: [{ line: 'l2', w: 'Crawl', start: 0.2, end: 0.6 }, { line: 'l2', w: 'any', start: 0.65, end: 0.9 }, { line: 'l2', w: 'site', start: 0.95, end: 1.3 }] },
  },
};
const load = async () => {
  const win: Record<string, unknown> = {};
  new Function('window', await vmScript(data))(win);
  return win.VM as { scene: (id: string) => { duration: number; at: (w: string, nth?: number) => number; beat: (i: number) => number; fit: (el: unknown) => number } };
};

test('at and beat return scene-relative times', async () => {
  const s = (await load()).scene('demo');
  expect(s.duration).toBe(3.9);
  expect(s.at('any')).toBe(0.65);
  expect(s.at('any site')).toBe(0.65);
  expect(s.beat(0)).toBe(0.95);
});
test('unknown scene, word or beat throws naming it', async () => {
  const vm = await load();
  expect(() => vm.scene('nope')).toThrow(/nope/);
  expect(() => vm.scene('demo').at('zebra')).toThrow(/demo.*zebra/);
  expect(() => vm.scene('demo').beat(4)).toThrow(/demo.*beat 4/);
});
test('fit sets the largest font size whose text stays inside the box', async () => {
  const el = { style: { fontSize: '' }, clientWidth: 500, clientHeight: 200, get scrollWidth() { return Number.parseInt(this.style.fontSize) * 5; }, get scrollHeight() { return 100; } };
  expect((await load()).scene('demo').fit(el)).toBe(100);
  expect(el.style.fontSize).toBe('100px');
});
```

**Implementation notes:**
- `text-fit.ts`: `minTextPx(f: FormatId): number` = `Math.ceil(h * (aspect === 'vertical' ? 0.035 : 0.025))` via
  `frameOf` (R6); `MAX_TEXT_FRAC = 0.12`; `maxTextPx(f)` = `Math.round(h * MAX_TEXT_FRAC)`; `fitPx(fits, minPx, maxPx)`:
  binary search over integers, assumes `fits` is monotone (true up to a size, false above), returns `minPx` when even
  that does not fit. Pure; no DOM.
- `runtime/vm.ts` is browser code bundled for the page; it imports only `fitPx` from `lib/core/text-fit.ts` and the
  `SceneTime` type. It reads `window.VM_DATA` (`{ format: { w, h, min_text_px, max_text_px }, scenes: Record<string,
  SceneTime> }`) and sets `window.VM = { data, scene(id) }`. `scene(id)` returns `{ duration, beats, words, at(word,
  nth = 0), beat(i), fit(el, maxPx?) }`. `at` matches a phrase as consecutive words, case-insensitive, ignoring
  punctuation, across the scene's words in order; returns the first word's `start`. `fit` searches `fitPx` with
  `fits = px => { el.style.fontSize = px + 'px'; return el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <=
  el.clientHeight + 1 }` between `min_text_px` and `maxPx ?? max_text_px`, leaves the found size set and returns it.
  Every throw is `new Error('VM: scene <id>: …')` (it surfaces in HyperFrames' runtime findings).
- `runtime/bundle.ts`: `export async function vmScript(data: VmData): Promise<string>` → `window.VM_DATA = <json>;\n` +
  the `Bun.build({ entrypoints: [vm.ts], target: 'browser', format: 'iife' })` output text. Cache the bundle text in a
  module variable. Export `type VmData`. Throws ToolError when the build fails (`logs` joined as stderr).
- `window` access in `vm.ts` goes through `globalThis` so the test's `new Function('window', …)` works: write the IIFE
  so it uses a `window` identifier (the test passes one); do not touch `document`.

**Done when:** `sh .claude/tools/check.sh lib/core lib/adapters/render` passes.

---

### Task 3: Assemble the project for one format

**Agent:** lib-builder

**Read first:** `lib/adapters/render/hyperframes/compose.ts:1-83` (`WEB_LOAD`, `writeComposition`,
`renderableAssets`), `lib/adapters/render/hyperframes/compose.test.ts:1-40` (temp run fixture),
`lib/core/scene-times.ts`, `lib/adapters/render/hyperframes/runtime/bundle.ts` (exports only),
`lib/contracts/types.ts:14-31`.

**Files:** Create `lib/adapters/render/hyperframes/project.ts`, `lib/adapters/render/hyperframes/project.test.ts`.
Modify `compose.ts` only to `export` `WEB_LOAD`.

**Tests first:** `project.test.ts` builds a temp run (copy the `compose.test.ts` fixture style) with `brief.json`
(`timing_source: "voiceover"`), `plan.json` (scenes `hook` [l1], `demo` [l2, l3] as in Task 1, `hook` asset_ids
`["img-1"]`), `data/timing.json` (Task 1's timing with ids), `audio/vo.wav` (a few bytes), `assets.json` with
`img-1` (render, licensed, file present), and `scenes/hook.html` / `scenes/demo.html` fragments:

```ts
const hook = `<style>#h{position:absolute;left:var(--vm-safe-left);top:40%;width:600px;height:200px}</style>
<h1 id="h">Meet Firecrawl</h1><img src="assets/img-1.png">
<script>const s = VM.scene("hook"); const tl = gsap.timeline({ paused: true });
tl.from("#h", { opacity: 0, duration: 0.4 }, s.at("Firecrawl")); window.__timelines["hook"] = tl;</script>`;
```

Tests (one `test` each):
1. `assembleProject(runDir, 'reel')` returns `build/reel`; it contains `index.html`, `compositions/hook.html`,
   `compositions/demo.html`, `vendor/gsap.min.js`, `vendor/vm.js`, `assets/img-1.png`, `vo.wav`, `scenes.json`.
2. `index.html` has root `data-width="1080" data-height="1920" data-duration="5.5"`, the audio element
   `src="vo.wav"`, and hosts `id="host-hook" … data-start="0" data-duration="1.6"` and `id="host-demo" …
   data-start="1.6" data-duration="3.9"`, `--vm-safe-top: 269px` (1920 × 0.14, rounded) and `--vm-min-text: 68px`.
3. `compositions/hook.html` starts with `<template><div id="scene-hook" data-composition-id="hook" data-width="1080"
   data-height="1920" data-duration="1.6"` and contains the fragment unchanged.
4. `vendor/vm.js` contains `"demo"` and `"Crawl"` (timing data inlined); `scenes.json` = `[{scene_id, start,
   duration}]`.
5. A missing `scenes/demo.html` → InputError naming `demo`; with two missing, both named in one error.
6. A fragment containing `<template`, `data-composition-id`, a web URL, or no `VM.scene("demo")` → InputError naming
   the scene and the rule; nothing under `build/reel` changes (pre-create `build/reel/old.txt` and assert it stays).
7. `timing_source: "text_only"` → UnsupportedError.
8. A rebuild replaces the folder: a file left in an old `build/reel/` is gone after a successful assemble.

**Implementation notes:**
- `export async function assembleProject(runDir: string, format: FormatId): Promise<string>` (returns the absolute
  build dir). Read `brief.json`, `plan.json`, `data/timing.json` with their schemas; require `audio/vo.wav`
  (InputError "voice the script first"). `sceneTimes(plan, timing)` gives starts and durations; total = last start +
  last duration.
- Validate every fragment before writing anything; collect all problems into one InputError (`scene <id>: <rule>`).
- Write through `writeComposition(runDir, 'build/.<format>.tmp', rootHtml, assetIds)` (union of scene `asset_ids`, so
  its licence and reference-only guards apply), then add `compositions/<id>.html`, `vendor/vm.js` (`vmScript({format,
  scenes})`), `vo.wav` (copy) and `scenes.json` (plain `JSON.stringify`; it is not a run contract). Then remove
  `build/<format>` and rename the temp folder into place. On any throw, remove the temp folder.
- Root HTML exactly as in the probe: `<script src="vendor/gsap.min.js">` and `<script src="vendor/vm.js">` in `head`;
  `:root` CSS variables `--vm-w`, `--vm-h`, `--vm-safe-top|right|bottom|left` (px, rounded), `--vm-min-text`;
  `html,body{margin:0;background:#000}`; root `<div id="root" data-composition-id="root" data-start="0" …>`; one empty
  root timeline registered at `window.__timelines.root`.
- Scene wrapper: `<template><div id="scene-<id>" data-composition-id="<id>" data-width data-height data-duration
  style="position:absolute;inset:0;overflow:hidden">\n<fragment>\n</div></template>`.

**Done when:** `sh .claude/tools/check.sh lib/adapters/render` passes.

---

### Task 4: The `hyperframes` render adapter

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:474-487` (`Issue`, `RenderAdapter`), `lib/adapters/render/hyperframes/compose.ts:84-135`
(`lintComposition`, `snapshotComposition`), `compose.test.ts` (its fake `sh`), `lib/core/errors.ts`.

**Files:** Create `lib/adapters/render/hyperframes/index.ts`, `index.test.ts`.

**Tests first:** `index.test.ts` with a fake `sh` that records `cmd`s and answers by subcommand: `check` prints a
canned JSON (below), `snapshot` writes `frame-00-at-0.8s.png`, `frame-01-at-2.4s.png` and `contact-sheet.jpg` into the
`-o` folder, `render` writes the `-o` file. The run fixture has `build/reel/` with `index.html` and `scenes.json`
`[{"scene_id":"hook","start":0,"duration":1.6},{"scene_id":"demo","start":1.6,"duration":3.9}]`.

```ts
const checkJson = { ok: false, lint: { findings: [
    { code: 'non_deterministic_code', severity: 'error', message: 'Math.random', file: '/x/build/reel/compositions/demo.html' },
    { code: 'studio_missing_editable_id', severity: 'warning', message: 'no id', file: '/x/build/reel/index.html' } ] },
  runtime: { findings: [] },
  layout: { findings: [{ code: 'text_overflow', severity: 'error', message: 'overflows', selector: '#h', time: 0.8 }] },
  contrast: { findings: [{ code: 'contrast', severity: 'warning', message: 'low', time: 2.4 }] } };
```

1. `check(runDir)` → `[{severity:'error', scene_id:'demo', message:'non_deterministic_code: Math.random'},
   {severity:'warning', message:'studio_missing_editable_id: no id'}, {severity:'error', scene_id:'hook',
   message:'layout text_overflow: overflows (#h at 0.8 s)'}, {severity:'warning', scene_id:'demo', message:'contrast
   contrast: low (at 2.4 s)'}]`; the command is `[...HF_CMD,'check','--json','--no-browser-gpu',<build/reel>]`.
2. `lint(runDir)` returns only the `lint` section's issues (same mapping) from the same `check` call shape but with
   the `lint` subcommand (`lint --json <dir>`; output `{findings}`).
3. `contactSheet(runDir,'reel',2)` snapshots at each scene's inner points (`hook`: 0.533, 1.067; `demo`: 2.9, 4.2 —
   `start + duration × k/(n+1)`, 3 decimals) and returns `out/sheets/reel.jpg`, which exists.
4. `still(runDir,'reel',[0.8,2.4])` returns `out/stills/reel/t-0.8.png`, `t-2.4.png`.
5. `render(runDir,'reel','draft')` runs `render <build/reel> --quality draft --no-browser-gpu --quiet -o
   <out/drafts/reel.tmp.mp4>` and returns `out/drafts/reel.mp4` (renamed); `'final'` uses `--quality delivery` and
   `out/final/reel.mp4`; a failing render (fake throws ToolError) leaves no `out/drafts/reel.mp4` even if one existed.
6. `render(…, ['bg'])` throws UnsupportedError; `supports('square')` → `{ok:true}`.
7. A format with no `build/<format>/index.html` → InputError "build the scenes first".

**Implementation notes:**
- `export const hyperframesRender = (deps: Deps = defaultDeps()): RenderAdapter` with `name: 'hyperframes'`. `lint`
  and `check` run over every `build/*/` that has an `index.html`.
- Finding → Issue: `severity` `error` → `'error'`, anything else → `'warning'`; `scene_id` from `file`
  (`compositions/<id>.html`), else from `time` via `scenes.json` (`start <= time < start + duration`), else none.
  Message: lint findings `code: message`; other sections `<section> code: message` plus ` (<selector> at <t> s)` /
  ` (at <t> s)` when present. Unparseable output → ToolError with the first 500 chars.
- `still`, `contactSheet` reuse `snapshotComposition`; copy frames and `contact-sheet.jpg` into `out/` (temp name then
  rename). Snapshot/check timeouts as in `compose.ts`; render timeout 20 min.

**Done when:** `sh .claude/tools/check.sh lib/adapters/render` passes.

---

### Task 5: Checks — layout, captions, duration

**Agent:** lib-builder

**Read first:** `lib/checks/coverage.ts` (the CheckResult shape and tone), `lib/contracts/types.ts:14-31`,
`lib/contracts/types.ts:440-458` (`CheckResultSchema`), `lib/core/text-fit.ts` (`minTextPx`).

**Files:** Create `lib/checks/layout.ts`, `layout.test.ts`, `captions.ts`, `captions.test.ts`, `duration.ts`,
`duration.test.ts`.

**Tests first:** the shared sample type lives in `layout.ts`:
`export type TextSample = { t: number; scene_id?: string; text: string; box: { x: number; y: number; w: number; h: number }; font_px: number; caption: boolean }`.

`layout.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { type TextSample, checkMinTextSize, checkSafeArea } from './layout';

const s = (over: Partial<TextSample>): TextSample => ({ t: 1, scene_id: 'hook', text: 'Hi', box: { x: 100, y: 800, w: 600, h: 120 }, font_px: 100, caption: false, ...over });

test('safe area passes inside and fails a box in the reel bottom zone, once per scene and text', () => {
  expect(checkSafeArea([s({})], 'reel').status).toBe('pass');
  const r = checkSafeArea([s({ t: 3, scene_id: 'demo', text: 'Tiny', box: { x: 20, y: 1800, w: 900, h: 35 } }), s({ t: 3.5, scene_id: 'demo', text: 'Tiny', box: { x: 20, y: 1800, w: 900, h: 35 } })], 'reel');
  expect(r).toMatchObject({ id: 'layout.safe_area', format: 'reel', blocking: true, status: 'fail' });
  expect(r.annotations).toHaveLength(1);
  expect(r.annotations[0]).toMatchObject({ scene_id: 'demo', t: 3 });
  expect(r.annotations[0]?.problem).toMatch(/Tiny.*bottom/);
});
test('safe area allows 2 px', () => {
  expect(checkSafeArea([s({ box: { x: 63, y: 800, w: 600, h: 100 } })], 'reel').status).toBe('pass'); // left edge 64.8
});
test('min text size fails under 3.5 % on reel (blocking) and 2.5 % on landscape (not blocking)', () => {
  const r = checkMinTextSize([s({ font_px: 30, text: 'Tiny' })], 'reel');
  expect(r).toMatchObject({ id: 'layout.min_text_size', blocking: true, status: 'fail' });
  expect(r.annotations[0]?.problem).toMatch(/Tiny.*30 px.*68 px/);
  expect(checkMinTextSize([s({ font_px: 26 })], 'landscape_1080p')).toMatchObject({ blocking: false, status: 'fail' });
  expect(checkMinTextSize([s({ font_px: 68 })], 'reel').status).toBe('pass');
});
test('no samples is a skip, not a pass', () => {
  expect(checkSafeArea([], 'reel').status).toBe('skip');
});
```

`captions.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { checkCaptions } from './captions';

test('skip when no caption was ever on screen', () => {
  expect(checkCaptions([{ t: 0.4, scene_id: 'hook', word: 'Meet', shown: '' }], false).status).toBe('skip');
});
test('each spoken word must be in the caption on screen at its midpoint', () => {
  const r = checkCaptions([
    { t: 0.35, scene_id: 'hook', word: 'Meet', shown: 'Meet Firecrawl' },
    { t: 0.8, scene_id: 'hook', word: 'Firecrawl,', shown: 'meet firecrawl' },
    { t: 1.3, scene_id: 'hook', word: 'today', shown: 'Meet Firecrawl' },
  ], true);
  expect(r).toMatchObject({ id: 'captions.match', blocking: true, status: 'fail' });
  expect(r.annotations).toEqual([{ scene_id: 'hook', t: 1.3, problem: 'caption shows "Meet Firecrawl" while "today" is spoken', suggested_fix: 'show each word in the caption while it is spoken' }]);
});
```

`duration.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { checkDuration } from './duration';

test('inside the target passes; outside fails with the numbers', () => {
  expect(checkDuration(22.4, [15, 30]).status).toBe('pass');
  const r = checkDuration(31.2, [15, 30]);
  expect(r).toMatchObject({ id: 'timing.duration', blocking: true, status: 'fail' });
  expect(r.detail).toBe('31.2 s is outside 15–30 s');
});
```

**Implementation notes:**
- Safe rect in px: `x0 = w × left`, `x1 = w × (1 − right)`, `y0 = h × top`, `y1 = h × (1 − bottom)` from `FORMATS`;
  tolerance 2 px. A failing box names the edges it crosses (`top`, `bottom`, `left`, `right`) in `problem`. One
  annotation per (scene_id, text), keeping the earliest `t`. `suggested_fix`: "move the text inside
  var(--vm-safe-*)".
- Min text: `blocking` is true only when the format is `reel` (2.8: "yes on reel"). One annotation per (scene_id,
  text). `suggested_fix`: "size it with VM.fit or at least var(--vm-min-text)".
- Captions: compare lower-cased words with punctuation stripped; `shown` is the caption text on screen at `t`.
- `format` is set on layout results; every result follows `CheckResultSchema`. All functions pure, never throw.

**Done when:** `sh .claude/tools/check.sh lib/checks` passes.

---

### Task 6: Checks — motion, assets, render stability

**Agent:** lib-builder

**Read first:** `lib/checks/coverage.ts`, `lib/core/scene-times.ts` (`SceneTime` type), `lib/contracts/types.ts:276-300`
(`AssetRefSchema`), `lib/contracts/types.ts:189-199` (`Look.type`), `lib/assets/pool.ts:45` (`isUnknownLicence`).

**Files:** Create `lib/checks/motion.ts`, `motion.test.ts`, `assets.ts`, `assets.test.ts`, `stability.ts`,
`stability.test.ts`.

**Tests first:**

`motion.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { SceneTime } from '../core/scene-times';
import { MOTION_THRESHOLD, checkBeatsOnCues, checkDeadSpans } from './motion';

const fps = 30;
const scene = (scene_id: string, start: number, duration: number, beats: SceneTime['beats']): SceneTime => ({ scene_id, start, duration, lines: [], beats, words: [] });
// 140 frames: change on 0-14 and 60-75. Still 15-59 = 45 frames = 1.5 s (not over: passes);
// still 76-139 = 64 frames (fails; starts at 76/30 = 2.533 s, inside demo). Frame 20 is an encoder blip of 5.
const diffs = Array.from({ length: 140 }, (_, i) => (i < 15 || (i >= 60 && i <= 75) ? 40 : i === 20 ? 5 : 0));
const scenes = (holdDemo: boolean) => [scene('hook', 0, 2, []), scene('demo', 2, 2.667, holdDemo ? [{ on: 'y', nth: 0, t: 0.4, hold: true }] : [])];

test('threshold is 8', () => expect(MOTION_THRESHOLD).toBe(8));
test('a still span over 1.5 s fails naming its scene and start', () => {
  const r = checkDeadSpans(diffs, fps, scenes(false));
  expect(r).toMatchObject({ id: 'motion.no_dead_spans', blocking: true, status: 'fail' });
  expect(r.annotations).toEqual([expect.objectContaining({ scene_id: 'demo', t: 2.533 })]);
});
test('a span that follows a hold beat is excused', () => {
  expect(checkDeadSpans(diffs, fps, scenes(true)).status).toBe('pass');
});
test('a beat is on cue when a frame within ±2 changes', () => {
  const ok = checkBeatsOnCues(diffs, fps, [scene('demo', 2, 2.667, [{ on: 'site', nth: 0, t: 0.03, hold: false }])]); // frame 61
  expect(ok.status).toBe('pass');
  const bad = checkBeatsOnCues(diffs, fps, [scene('hook', 0, 2, [{ on: 'today', nth: 0, t: 1.2, hold: false }])]); // frame 36
  expect(bad).toMatchObject({ id: 'timing.beats_on_cues', status: 'fail' });
  expect(bad.annotations[0]).toMatchObject({ scene_id: 'hook', t: 1.2 });
  expect(bad.annotations[0]?.problem).toMatch(/today/);
});
```

`assets.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { AssetRef } from '../contracts/types';
import { checkLicensed, checkNoReferenceOnly } from './assets';

const a = (asset_id: string, over: Partial<AssetRef> = {}) => ({ asset_id, kind: 'image', path: `assets/${asset_id}.png`, usage: 'render', license: 'CC0', origin: 'web', status: 'pool', ...over }) as AssetRef;

test('licensed: every built asset and every look font needs a known licence', () => {
  expect(checkLicensed([a('img-1')], ['img-1'], [{ family: 'Inter', license: 'OFL' }]).status).toBe('pass');
  const r = checkLicensed([a('img-1', { license: 'unknown' })], ['img-1', 'img-9'], [{ family: 'Brand Sans', license: 'unknown' }]);
  expect(r).toMatchObject({ id: 'assets.licensed', blocking: true, status: 'fail' });
  expect(r.annotations.map((x) => x.problem)).toEqual(['asset img-1 has licence "unknown"', 'asset img-9 is not in assets.json', 'font Brand Sans has licence "unknown"']);
});
test('no reference-only: a scene that names a reference-only file fails', () => {
  const pool = [a('nav-1', { usage: 'reference_only', path: 'input/nav.mp4' })];
  expect(checkNoReferenceOnly(pool, { hook: '<video src="assets/x.mp4">' }).status).toBe('pass');
  const r = checkNoReferenceOnly(pool, { demo: '<video src="../../input/nav.mp4">' });
  expect(r).toMatchObject({ id: 'assets.no_reference_only', status: 'fail' });
  expect(r.annotations[0]).toMatchObject({ scene_id: 'demo' });
});
```

`stability.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { checkDeterministic, checkSeekSafe, sampleTimes } from './stability';

test('sampleTimes is seeded: same run id, same times; inside (0, total)', () => {
  const a = sampleTimes('run-a', 20, 5);
  expect(a).toEqual(sampleTimes('run-a', 20, 5));
  expect(a).not.toEqual(sampleTimes('run-b', 20, 5));
  expect(a.every((t) => t > 0 && t < 20)).toBe(true);
  expect(a).toEqual([...a].sort((x, y) => x - y));
});
test('deterministic and seek-safe compare hashes per time', () => {
  expect(checkDeterministic([1, 2], ['a', 'b'], ['a', 'b']).status).toBe('pass');
  const r = checkDeterministic([1, 2], ['a', 'b'], ['a', 'c']);
  expect(r).toMatchObject({ id: 'render.deterministic', blocking: true, status: 'fail' });
  expect(r.annotations[0]).toMatchObject({ t: 2 });
  expect(checkSeekSafe([1, 2], ['a', 'b'], ['x', 'b'])).toMatchObject({ id: 'render.seek_safe', status: 'fail' });
});
```

**Implementation notes:**
- `motion.ts`: `MOTION_THRESHOLD = 8`, `DEAD_SPAN_S = 1.5`, `BEAT_TOLERANCE_FRAMES = 2`. `diffs[i]` is the change
  into frame i (`diffs[0]` = 0). A dead span is a run of frames with `diffs[i] <= 8` lasting more than 1.5 s
  (`> 45` frames at 30 fps); it is excused when the last beat at or before the span start, in the scene that contains
  the span start, has `hold`. Annotate with the scene
  that contains the span start and `t` = span start (3 decimals). Beat frame = `Math.round((scene.start + beat.t) ×
  fps)`; on cue when `max(diffs[f−2 … f+2]) > 8`. `suggested_fix`: "start a visible change on the beat word" /
  "add motion or mark the beat hold".
- `assets.ts`: `checkLicensed(pool, builtIds, fonts)` (fonts = `look.type` entries) and `checkNoReferenceOnly(pool,
  fragments: Record<sceneId, html>)`: a fragment fails when it contains a reference-only asset's `path` or its file
  name. Use `isUnknownLicence`… it lives in `lib/assets/pool.ts`, which `lib/checks` may not import: copy the one-line
  rule as a local `unknown(license)` with a `ponytail:` comment naming the original.
- `stability.ts`: `sampleTimes(seed, total, n)`: a seeded PRNG (FNV-1a hash of the seed into mulberry32), n distinct
  times in `[0.1 × total, 0.9 × total]`, 3 decimals, sorted. `checkDeterministic(at, first, second)`,
  `checkSeekSafe(at, batch, single)`.

**Done when:** `sh .claude/tools/check.sh lib/checks` passes.

---

### Task 7: Measuring: text boxes, frame differences, snapshot hashes

**Agent:** lib-builder

**Read first:** `lib/adapters/capture/playwright/browser.ts:1-60` (how Playwright is launched), `lib/core/config.ts`
(`Config.vmHome`, `HF_CMD`, `HYPERFRAMES_VERSION`), `lib/adapters/render/hyperframes/compose.ts:100-135`
(`snapshotComposition`), `lib/checks/layout.ts` (`TextSample` only), this plan's "Tech stack" seek-and-measure bullet.

**Files:** Create `lib/adapters/render/hyperframes/measure.ts`, `measure.test.ts`.

**Tests first:** `measure.test.ts` (fake `sh` for 1–3; test 4 is a real browser run on a tiny static build):
1. `hfRuntimeFile(deps)` when the file is missing: runs `['npm','pack','hyperframes@0.8.143','--pack-destination',<tmp>]`
   then `['tar','-xzf',<tmp>/hyperframes-0.8.143.tgz,'-C',<tmp>,'package/dist/hyperframe.runtime.iife.js']` (the fake
   creates the file), returns `<vmHome>/hf/0.8.143/hyperframe.runtime.iife.js`, and removes the temp folder. When the
   file exists, runs nothing.
2. `frameDiffs(deps, mp4)` runs ffmpeg with the exact filter from "Tech stack" and parses fake stdout
   `"frame:0 pts:1\nlavfi.signalstats.YMAX=39\nframe:1 pts:2\nlavfi.signalstats.YMAX=0\n"` into `[0, 39, 0]`.
3. `snapshotHashes(deps, dir, [1, 2])` returns the sha256 hex of each frame the fake snapshot wrote, in time order.
4. `measureText(buildDir, runtimeFile, [0.5])` on a fixture build that defines its own tiny `window.__player`
   (`seek` sets a class) instead of the HyperFrames runtime (pass a stub runtime file): returns a `TextSample` for a
   visible `<h1>` with its box and `font_px`, none for a `visibility:hidden` `<p>`, `caption: true` for text inside
   `[data-vm-caption]`, and `scene_id` from the nearest `[data-composition-id]` that is not `root`. Skip the test when
   no Playwright browser is installed (`browserChannel()` returns null).

**Implementation notes:**
- `hfRuntimeFile(deps): Promise<string>` (R10): temp folder under `<vmHome>/hf/`, rename the extracted file into
  place, then remove the temp folder (also on failure).
- `measureText(buildDir, runtimeFile, times): Promise<TextSample[]>`: `Bun.serve({ port: 0 })` serving only paths
  that resolve inside `buildDir` (else 404); `chromium.launch({ args: ['--disable-gpu'] })` (use
  `browserChannel()`); viewport from the root's `data-width`/`data-height`; `page.goto`, `addScriptTag({ path:
  runtimeFile })`, wait for `__playerReady && __renderReady` (30 s, else ToolError naming the build). Per time: seek,
  then collect every element with a direct non-blank text node where `el.checkVisibility({ opacityProperty: true,
  visibilityProperty: true })` and the rect is non-empty: `text` (trimmed, ≤ 60 chars), `box`, `font_px` =
  `parseFloat(fontSize) × (rect.height / el.offsetHeight || 1)` rounded to 0.1, `caption`, `scene_id`. Always close
  the browser and stop the server (`finally`). Captions need no extra function: Task 8 reads the `caption` samples
  nearest each word's midpoint.
- `frameDiffs(deps, mp4): Promise<number[]>`: prepend 0 so `diffs[i]` is the change into frame i.
- `snapshotHashes(deps, dir, at)`: `snapshotComposition`, then `createHash('sha256')` of each file.

**Done when:** `sh .claude/tools/check.sh lib/adapters/render` passes.

---

### Task 8: `lib/scenes/`: build, check, CLI; `where` marker

**Agent:** lib-builder

**Read first:** `lib/voice/cli.ts:1-60` (the CLI pattern with injectable `Io`), `lib/voice/cli.test.ts:1-40`,
`lib/run/where.ts:40-70`, `lib/checks/coverage.ts` and `lib/checks/facts-cited.ts` (signatures only), exports of
`lib/adapters/render/hyperframes/{project,index,measure}.ts`, `lib/checks/{layout,captions,duration,motion,assets,stability}.ts`,
`lib/contracts/types.ts:460-473` (`TestResultsSchema`).

**Files:** Create `lib/scenes/build.ts`, `build.test.ts`, `check.ts`, `check.test.ts`, `cli.ts`, `cli.test.ts`.
Modify `lib/run/where.ts` (M12 marker `build/`) and its test.

**Tests first:** inject the adapter and measuring functions (`type ScenesIo = { deps?: Deps; render?: RenderAdapter;
assemble?: typeof assembleProject; measure?: { runtime, text, diffs, hashes } }`); no real tools in unit tests.
- `build.test.ts`: `buildScenes(runDir, io)` for `plan.formats = ['reel']`: calls assemble, then `check`; with no error
  issues it makes the contact sheet (2 per scene) and the draft and returns `{ ok: true, formats: { reel: { build,
  sheet, draft, warnings } } }`. With an error issue it returns `{ ok: false, failing_scenes: ['demo'], issues }`
  and makes no sheet or draft. An assemble InputError propagates.
- `check.test.ts`: `checkScenes(runDir, io)` with fakes returning one bad text sample (bottom zone, scene `demo`) and
  clean diffs: writes `test_results.json` (valid `TestResultsSchema`, `plan_version` from plan, `output_paths.drafts.reel`,
  `contact_sheets.reel`) with every check id in R13 in that order, `layout.safe_area` failing, and `summary.blocking_failed`
  = 1; writes `report.md` whose first line is `# Checks: 1 blocking failed` and that lists the failing check with its
  scene annotations; returns `{ blocking_failed: 1, failing_scenes: ['demo'], report: 'report.md' }`. A run with no
  draft throws InputError "render the draft first". Writes use a temp name and rename.
- `cli.test.ts`: `times <run>` prints `{ format, frame: { w, h, safe_px: {top,right,bottom,left}, min_text_px },
  scenes: [{ scene_id, start, duration, beats, words, assets: [{ asset_id, src: 'assets/<id><ext>' }] }] }` for the
  first format; unknown command → usage error; `build` and `check` call through to the injected functions.
- `where.test.ts`: a run with every M1–M11 marker and a non-empty `build/` → next `M13`; with an empty `build/` → `M12`.

**Implementation notes:**
- Check order and sources (R13): `plan.coverage` (`checkCoverage`), `script.facts_cited` (`checkFactsCited`; research
  URLs as that check's existing caller reads them — grep `checkFactsCited(` for it), `render.lint` (adapter `check`
  error issues; fail lists them with `scene_id`), `render.deterministic` / `render.seek_safe` (`sampleTimes(run_id,
  total, 5)`, `snapshotHashes` twice for deterministic; once per time alone for seek-safe), `motion.no_dead_spans`,
  `timing.beats_on_cues` (`frameDiffs` of the draft + `sceneTimes`), `timing.duration` (`brief.duration_target_s`),
  `layout.safe_area`, `layout.min_text_size` (samples per R11), `layout.no_overflow` (adapter `check` issues whose
  message starts with `layout `), `assets.no_reference_only` (fragments from `scenes/`), `assets.licensed` (ids of
  `build/<f>/assets/*` by file stem + `look.type`), `captions.match` (per word midpoint: caption samples at the nearest
  sampled time → `shown`).
- Per-format checks repeat per format with `format` set. `failing_scenes`: unique `scene_id`s over blocking failed
  annotations, in plan order.
- `report.md`: one `##` section per failing check (blocking first) listing `- scene <id> at <t> s: <problem> → <fix>`,
  then a short "Passed" list. Plain text; no HTML.
- CLI usage: `cli.ts times <run_dir> | build <run_dir> | check <run_dir>`. Each prints one JSON line via `runCli`.

**Done when:** `sh .claude/tools/check.sh lib/scenes lib/run` passes.

---

### Task 9: Shipped `scene-writer` agent and `scenes` skill; `make-video` routes M12–M14

**Agent:** plugin-builder

**Read first:** `skills/voice/SKILL.md` (tone, frontmatter, the bun command pattern), `skills/make-video/SKILL.md:98-125`,
`lib/scenes/cli.ts` (usage line), `lib/adapters/render/hyperframes/runtime/vm.ts` (the `VM` API, exported names only),
this plan's R2, R3, R6, R12 and Task 3's wrapper and root notes.

**Files:** Create `agents/scene-writer.md`, `skills/scenes/SKILL.md`. Modify `skills/make-video/SKILL.md`.

**`agents/scene-writer.md`** (frontmatter `name: scene-writer`, description "Writes one scene of a Video Machine run
as a HyperFrames fragment in scenes/<scene_id>.html. Use once per scene at M12, or to fix a scene a check named.",
tools `Read, Write, Edit, Bash, Glob`), < 120 lines. Content:
- Inputs it is given: run folder, `scene_id`, and for a fix round the failing annotations. It reads `plan.json` (its
  scene), `look/look.json` + `look/LOOK.md`, `boards/<scene_id>.png`, and `bun …/lib/scenes/cli.ts times <run>`.
- It writes only `scenes/<scene_id>.html`: a fragment (`<style>`, markup, one `<script>`), never `<template>` or
  `data-composition-id`, never anything under `build/`.
- Composition rules: one `gsap.timeline({ paused: true })` built synchronously and registered at
  `window.__timelines["<scene_id>"]`; every time from `const s = VM.scene("<scene_id>")` (`s.at(word, nth)`,
  `s.beat(i)`, `s.duration`) — never a typed number of seconds for when something happens (durations of a tween are
  fine); no `Math.random`, `Date`, `performance.now`, `requestAnimationFrame`, timers or web URLs; assets only as
  `assets/<asset_id><ext>` from `times`; text inside `var(--vm-safe-*)`; every text box has a fixed width and height
  and is sized with `s.fit(el)`; nothing smaller than `var(--vm-min-text)`; something visibly changes on every beat
  word; a `hold` beat may stay still; captions (when the plan asks) go inside `[data-vm-caption]`.
- Ends by printing the path it wrote. It does not render or run checks.

**`skills/scenes/SKILL.md`** (frontmatter `name: scenes`, description "Use when a run needs its scenes written,
rendered and checked (M12–M14)"), < 100 lines:
1. `times` once; dispatch one `scene-writer` per scene in parallel (Agent tool, `subagent_type:
   "video-machine:scene-writer"`), each given the run folder and its `scene_id`.
2. `build`. If `ok: false`, re-dispatch only `failing_scenes` with their issues; repeat `build`.
3. `check`. If `blocking_failed > 0`, re-dispatch only `failing_scenes` with their annotations from
   `test_results.json`, then `build` and `check` again. At most 3 fix rounds over steps 2–3 together (blueprint 2.7);
   then stop.
4. Show the creator the contact sheet path, the draft path and `report.md`'s summary; this is gate G3.

**`make-video` changes:** Step 2 table row `M11`, `M12` → `M11` stop; add `M12`, `M13`, `M14` →
`video-machine:scenes`; the stop text becomes "until it says `M11` or `M15`". Keep `make-video` under 150 lines.

**Done when:** `grep -c "lib/scenes/cli.ts" skills/scenes/SKILL.md` ≥ 3; `grep -c "VM.scene" agents/scene-writer.md`
≥ 1; `wc -l` limits hold; `grep -n "video-machine:scenes" skills/make-video/SKILL.md` finds the row;
`claude plugin validate .` (or the manifest check `tests/phase1.ts` uses) passes.

---

### Task 10: Acceptance test `tests/phase6.ts`

**Agent:** lib-builder

**Read first:** `tests/phase5.ts:1-80` (helpers `makeTemp`, `check`, `call`, `callOk`), `lib/scenes/cli.ts` (usage),
`tests/phase5.ts` (how it builds a voiced run; reuse its fixture voice approach).

**Files:** Create `tests/phase6.ts`, `tests/phase6/scenes/*.html` (stand-in scenes, U2).

**Checks (real HyperFrames, ffmpeg, Playwright; print PASS/FAIL each):**
1. **Build:** a temp run (brief voiceover, 3-line script, plan with 3 scenes `hook`, `demo`, `cta`, look, assets with
   one licensed image, `audio/vo.wav` + `data/timing.json` from the real `voice` CLI as `phase5.ts` does) plus the
   three stand-in scenes copied into `scenes/`. `cli.ts build` → `ok: true`; `build/reel/index.html`,
   `out/sheets/reel.jpg` and `out/drafts/reel.mp4` exist; ffprobe: 1080×1920, 30 fps, an audio stream, duration =
   last word end + 1.0 s ± 0.1.
2. **Clean checks:** `cli.ts check` → `blocking_failed: 0`; `test_results.json` parses; `where` → `M15`.
3. **Re-time:** change one word in the script's last line, re-run `voice synth` + `align` + `build`; the `cta` host's
   `data-start` moved and no file in `scenes/` changed (hash compare).
4. **Broken scene:** replace `scenes/demo.html` with `tests/phase6/scenes/demo-broken.html` (a 30 px line at
   `top: 1800px`, and no tween on its beat word). `build` + `check`: exactly `layout.safe_area`,
   `layout.min_text_size` and `timing.beats_on_cues` fail, each annotated `scene_id: "demo"`, and `failing_scenes` =
   `["demo"]`.
5. **Lint gate:** a `demo` fragment with `Math.random()` → `build` returns `ok: false`, `failing_scenes: ["demo"]`,
   and no new draft is written.

Stand-in scenes follow the `scene-writer` rules exactly (all times via `VM.scene`, `s.fit`, safe-area variables).

**Done when:** `node_modules/.bin/bun tests/phase6.ts` prints 5 PASS (expect a few minutes) and
`sh .claude/tools/check.sh tests` passes.
