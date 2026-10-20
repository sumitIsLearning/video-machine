# Phase 9 — Reel Layouts Implementation Plan

**Goal:** The creator chooses a reel layout. The new `stack` layout puts the graphics on top and the presenter in a
full-width band below (split 0.55 by default), with the presenter's real background kept and cropped to fill. A
scene whose lines are `voiceover` hides the band and uses the full frame while the voice keeps playing. Text stays
out of the band and out of Instagram's bottom 35 %. The look may add a seam line and label. The layout shows on the
G2 boards before anything is voiced. Mock: project map artifact, section "Reel layouts" (user OK 2026-10-20).

**Architecture:**
- **Contracts:** `brief.layout = {kind: 'graphics'|'overlay'|'stack', split}`; preset `stack`; `look.seam`;
  `FORMATS.reel.safe.bottom` 0.35.
- **Core:** `lib/core/avatar.ts`: `presetBox` gains `stack` (needs `split`), `stackSpans` (segments = runs of
  all-avatar scenes, timed to the scene windows), `bandOf`.
- **M11:** `lib/avatar/make.ts`: a `stack` run cuts by `stackSpans`, skips background removal (VP9 transcode
  instead) and writes `avatar/placement.json` itself.
- **Build:** `project.ts`: `object-fit: cover` for `stack`, seam layer from `look.seam`.
- **Boards:** `renderBoard` draws a grey "presenter" band on look and scene boards of a `stack` run.
- **Shipped:** concept template LAYOUT line, intake, storyboard G2 layout pick, script hook rules, scene-writer band
  rule, avatar-director skips `stack`.

**Spec:** `docs/BLUEPRINT.md` Part 5 Phase 9; 2.6 (text under Instagram UI); 2.7 (avatar presets). Research:
`docs/research/reel-layouts-hooks-genres.md` (Safe zones, Hooks and scripts, Reference example 1).

**Tech stack:** HyperFrames 0.8.143 (root `<video class="clip">` probed in Phase 8); ffmpeg with `libvpx-vp9`
(present on the M1 Mac 2026-10-20; the gyan.dev Windows full build ships it).

## Global Constraints
- Call bun as `node_modules/.bin/bun`. Only `lib/core/sh.ts` spawns processes; tests pass a fake `deps.sh`.
- Import direction: part folders → `lib/checks`, `lib/adapters` → `lib/core` → `lib/contracts`.
- Run-folder JSON only through `writeJson` / `readJson`; run paths from JSON only through `runFileOf`.
- `overlay` runs (Phase 8) and runs with no `brief.layout` behave exactly as today, except the reel safe bottom.
- No new paid call; the cost gate and `spend.json` (R14) are unchanged.
- Verify with `sh .claude/tools/check.sh`.

## Rulings made in this plan (2026-10-20)
- **R1** Creator choice: `brief.layout` from the concept's LAYOUT line or the intake default (`stack` 0.55 when
  `brief.avatar` is set, `graphics` otherwise); changed at G2 through the intake CLI (`brief.json` is never
  hand-written).
- **R2** Show/hide uses the existing `delivery` field: a scene shows the band when all its lines are `avatar`, hides
  it when all are `voiceover`. A `stack` run with a mixed scene is refused by name (`InputError`).
- **R3** In `stack`, a segment spans whole scene windows (from `sceneTimes`), so the band appears and leaves on scene
  cuts, never mid-scene. Its audio is cut over that window (silence included); a hard cut, no fade (mock showed a
  fade; ponytail).
- **R4** `stack` keeps the background: the raw clip is transcoded to `avatar/<seg>.webm` (VP9, no audio) instead of
  `remove-background`; file names stay, so the layer code is shared.
- **R5** The seam and label belong to the look (`look.seam`, optional); the root page draws them over each `stack`
  segment. The label text is the look's choice for this video, not a fixed format.
- **R6** `FORMATS.reel.safe.bottom` 0.20 → 0.35 (blueprint 2.6, user OK). Every reel preset box moves with it.
- **R7** Split range 0.5–0.75 (55/45 to 75/25); the mock's 70/30 fits.
- **R8** Script rules are skill text, not checks: hook in the first 3 s, short on-screen text, CTA in the last beat.

---

### Task 1: Contracts
**Agent:** lib-builder
**Read first:** `lib/contracts/types.ts:18-24` (FORMATS), `:87-138` (BriefSchema), `:175-205` (LookSchema),
`:273-275` (AVATAR_PRESETS); `lib/contracts/types.test.ts` (grep `BriefSchema`, `LookSchema`).
**Files:** modify `lib/contracts/types.ts`, `lib/contracts/types.test.ts`.
**Tests first** (in `types.test.ts`):
- `BriefSchema` accepts `layout: {kind:'stack'}` with an `avatar` and fills `split: 0.55`.
- Refuses `split: 0.45` and `0.8`; refuses `kind:'stack'` or `'overlay'` without `avatar` (message contains
  `layout "stack" needs brief.avatar`).
- Accepts a brief with no `layout` (unchanged).
- `LookSchema` accepts `seam: {color:'#2e8b57', label:'SALES TIPS'}` and `seam: {color:'#2e8b57'}`; refuses
  `color:'green'`.
- `AVATAR_PRESETS` contains `stack`; `FORMATS.reel.safe.bottom === 0.35`.
**Implementation notes:**
- `layout: z.strictObject({kind: z.enum(['graphics','overlay','stack']), split: z.number().min(0.5).max(0.75).default(0.55)}).optional()`.
  Add `.superRefine` on `BriefSchema` for the avatar rule (path `['layout','kind']`).
- `seam: z.strictObject({color: hex regex as in palette, label: z.string().min(1).max(24).optional()}).optional()`.
- Fix the stale comments at `:34` and `:239` ("Phase 9" → "Phase 10").
**Done when:** `sh .claude/tools/check.sh` passes. Preset-box tests elsewhere that hard-code reel pixels may fail:
update their expected numbers only (R6), nothing else.

### Task 2: Stack geometry and spans `lib/core/avatar.ts`
**Agent:** lib-builder
**Read first:** `lib/core/avatar.ts:20-110`; `lib/core/scene-times.ts:10-20,85` (`SceneTime`, `sceneTimes`);
`lib/core/avatar.test.ts` (fixtures).
**Files:** modify `lib/core/avatar.ts`, `lib/core/avatar.test.ts`.
**Tests first:**
- `presetBox('stack', 'reel', 0.55)` → `{x:0, y:1056, w:1080, h:864, fit:'center 30%', cover:true}`;
  `presetBox('stack','reel',0.7)` → `y:1344, h:576`. Other presets return `cover:false`.
- `stackSpans(plan, script, timing)` on 4 scenes `[avatar, avatar, voiceover, avatar]` → two spans `a01` (scenes 1–2,
  start = scene 1 start, end = scene 2 start+duration, `line_ids` = all their lines) and `a02` (scene 4).
- A scene with one `avatar` and one `voiceover` line → `InputError` naming the scene id and
  `mixes avatar and voiceover lines`.
- `avatarBoxesOf` on a `stack` run reads `brief.layout.split` and returns full-width boxes.
**Implementation notes:** `presetBox(preset, format, split = 0.55)`; `PresetBox` gains `cover: boolean`.
`stackSpans` uses `sceneTimes(plan, timing)` for windows; spans returned in the existing `AvatarSpan` shape.
`avatarBoxesOf` passes `brief.layout?.split`.

### Task 3: M11 for `stack`
**Agent:** lib-builder
**Read first:** `lib/avatar/make.ts:40-133`; `lib/avatar/make.test.ts:45-100` (fake deps, fake adapter).
**Files:** modify `lib/avatar/make.ts`, `lib/avatar/make.test.ts`.
**Tests first:**
- A `stack` brief: spans come from `stackSpans` (cut commands use the scene window times); no
  `remove-background` call; one ffmpeg call per segment with `-c:v libvpx-vp9 -an` writing `avatar.tmp/<seg>.webm`;
  `avatar/placement.json` has `stack` for every segment.
- An `overlay` or no-layout brief: unchanged (matte called, no placement written).
- Gate before any cut still holds for `stack` (budget 0, paid fake adapter → refused, no ffmpeg call).
**Implementation notes:** transcode: `ffmpeg -v error -y -i raw -an -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 webm`.
Placement written into `avatar.tmp/` before the rename. Needs `plan.json` for `stack`: missing → `InputError('storyboard first (M8)')`.

### Task 4: Build layer: cover and seam
**Orchestrator pre-step:** probe a non-alpha VP9 webm in a root `<video class="clip">` with `object-fit:cover` in
`hyperframes snapshot` (centre pixel of a 1080×864 band from a 16:9 red/blue clip). Record the result here.
**Probe result (2026-10-20, HF 0.8.143, `runs/spike-p9-cover/`):** cover works. Band top=1056, 1080×864, 16:9
red|blue VP9 (no alpha): y=1076 and y=1900 filled (no letterbox), x=10 red, x=1070 blue, y=1000 (above band) black.
**Agent:** lib-builder
**Read first:** `lib/adapters/render/hyperframes/project.ts:52-80` (`rootHtml`), `:98-125`;
`project.test.ts:172-200`.
**Files:** modify `project.ts`, `project.test.ts`.
**Tests first:**
- `stack` box → video style has `object-fit:cover;object-position:center 30%`; overlay boxes keep `contain`.
- With `look/look.json` `seam:{color:'#2e8b57',label:'SALES TIPS'}`: one seam div per `stack` segment with the same
  `data-start`/`data-duration` as its video, `top` = box `y` − 3 px, height 6 px, background the colour, and a label
  chip centred on it with the text; z-index above the video. No seam without `look.seam`, and none for overlay.
**Implementation notes:** seam and chip are root clips like the video (`class="clip"`, own `data-track-index`).
Label font: `font-family` of the look's `display` type, then `system-ui, sans-serif`.

### Task 5: Presenter band on boards
**Agent:** lib-builder
**Read first:** `lib/adapters/render/hyperframes/compose.ts:137-175` (`renderBoard`, `writeComposition`);
`lib/look/look.ts:46-67`; `lib/storyboard/plan.ts:149-170`.
**Files:** modify those three and their tests.
**Tests first:** `renderBoard(..., band)` writes a composition whose root has a last child
`<div data-vm-band …>presenter</div>` at the band rect; no band arg → no div. Look boards of a `stack` brief get the
band; scene boards get it only when all the scene's lines are `avatar`.
**Implementation notes:** band rect = `presetBox('stack', 'reel', split)`; grey `#9aa1b0`, label centred, 40 px
text.

### Task 6: Shipped surface
**Agent:** plugin-builder
**Read first:** `CONCEPT-TEMPLATE.md`; `skills/make-video/SKILL.md:60-100`; `skills/storyboard/SKILL.md:1-60,135-150`;
`agents/scene-writer.md:50-65`; `agents/avatar-director.md:1-30`; `skills/avatar/SKILL.md`; research doc sections
"Hooks and scripts" and "Reference example 1".
**Files:** modify those.
**Changes:**
- Concept template: `LAYOUT` block — `[ ] Graphics on top, presenter below (split: 55/45)`, `[ ] Presenter in a
  corner / over the graphics`, `[ ] Graphics only`.
- Intake (R1): map the LAYOUT line to `brief.layout`, default as R1; show it in the brief table.
- Storyboard G2: tell the creator the layout, show boards with the band; to change it, re-run intake with the new
  layout and re-render boards.
- Script (M6): hook line in the first 3 s (question or promise, also as on-screen text); on-screen text short; CTA in
  the last beat; in `stack`, mark lines of a full-graphic scene `voiceover` and keep each scene one delivery (R2).
- Scene writer: in a `stack` scene put all graphics above the band (`box.y`); the band is opaque; without a band the
  scene uses the full frame.
- Avatar director: `stack` runs are placed by M11; skip.

### Task 7: Acceptance `tests/phase9.ts`
**Agent:** lib-builder
**Read first:** `tests/phase8.ts:1-200` (helpers, `newRun`, `callWithEnv`, the red-disc probe, `buildAndCheck`).
**Checks (real tools, fixture run, supplied 16:9 red/blue clip):**
1. contracts: a `stack` brief without avatar is refused by intake.
2. spans: scenes `[avatar, avatar, voiceover, avatar]` → `a01`, `a02` on scene boundaries.
3. matte: `avatar/a01.webm` is VP9, no alpha, no audio; placement all `stack`.
4. band: in the draft, the band region (centre of `y 1056–1920`) shows the clip during `a01` and the scene
   background during the voiceover scene; the area above shows the scene.
5. seam: a pixel on the seam line has the seam colour during `a01`.
6. under: text placed in the band during `a01` → build refuses that scene (`text_occluded` or `layout.safe_area`).
7. safe: text in `y > 1248` with no band → `layout.safe_area` fails.
8. boards: a scene board of an avatar scene has the grey band; the voiceover scene's board has none.
9. seek: `render.seek_safe` and `render.deterministic` pass; blocking checks = 0.

### Task 8 (orchestrator + creator): proof reel
Not a builder task. A real concept, end to end, `stack`, one full-graphic scene; presenter from the creator's clip
or HeyGen (paid: ask first). Its contact sheet goes on the project map next to the mock for the creator's OK.
