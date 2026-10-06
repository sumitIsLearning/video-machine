# Video Machine — Project Blueprint

> **Status:** Spec v1. **Last updated:** 2026-10-06
> **Companion docs:** [AGENT_PROMPT.md](AGENT_PROMPT.md) (coding standard), [../HANDOFF.md](../HANDOFF.md) (session state)
> **Origin:** the build prompt `C:\Work-data\video-testing\VIDEO-MACHINE-PROMPT.md` (§0–§12), restructured here. Its
> wording is kept; section refs like "(spec §5)" point back to it. This file is now the source of truth.

# Part 1 — Product Requirements (PRD)

## 1.1 Summary
The **Video Machine** is a Claude Code **skill**. It is not an app. A person gives Claude a **concept**: an idea for a
video, a few sentences long, not a finished script. Claude then:

1. researches the concept,
2. writes a **treatment**: the script, the plate-by-plate plan, and two **art directions** shown as rendered style
   frames. The person approves one or asks for changes,
3. makes the video as code and renders a draft in every requested aspect ratio,
4. tests the draft against the treatment and quality rules,
5. iterates on feedback until the person approves,
6. delivers in the formats the person asks for: MP4, ProRes with alpha, image sequence, an After Effects package,
   and so on.

There is no server, no database, no UI of its own. The "interface" is the conversation with Claude. All state lives in
plain files in a run folder, so any session can pick a run up again. Everything lives in one workspace folder,
**`C:\Work-data\video-machine`**: the skill, a copy of the engine, and every video made with it (Part 4). The person
opens Claude in that folder to make videos.

## 1.2 Problem
Two earlier projects exist on this machine.

- `C:\Work-data\video-testing` — **Motion Graphics 1**. A 92.6 s, 1920×1080, 60 fps explainer. Every scene ("plate")
  is a TypeScript file that draws each frame as a pure function of time. Word-level timings from forced alignment
  drive every cut and every animation. Its weaknesses: all nine plates were written by hand for one script, it has
  exactly one look, and it renders one aspect ratio only. **The Video Machine exists to remove all three.**
- `C:\Work-data\kinomat` — a full app (Next.js + Postgres + workers + HyperFrames) that makes a 10-minute video from a
  concept. Its architecture is not copied. Its lessons are:
  - The plan is the source of truth. Generated code is a build artifact.
  - No template library. Templates make every video look the same.
  - Concept → clarifying questions → script is a real step with its own approval gate.
  - Validation is blocking, not advisory. Renderers can fail silently (a frame with no motion and no error).
  - A per-unit input hash lets you re-render only what changed.
  - Reference material teaches the agent. It never ends up in the output.

## 1.3 Solution

### Every video must look like its concept, not like the last video
This is the main design goal. A machine that turns every concept into the same look is a template engine with extra
steps. The rules that prevent it:

- **The look is decided per concept**, in the art-direction step (§2.1.2 step 3), from the research. It is written
  down as a `look.json` + `LOOK.md` for that run.
- **Style packs are a library, not a default.** A look may reuse a pack, blend two, or start from nothing. Approved
  new looks can be saved back as new packs, so the library grows.
- **The person always sees two different directions** as rendered stills before any video is made, and picks.
- **No template library and no layout menu.** Each plate is composed for its own content and look.
- **Shared code is limited to mechanics**: camera, easing, text layout, timing, caption rendering, post effects.
  Motifs, palettes, and type choices belong to a look, not to the machine.

### Non-negotiables
1. **Every frame is a deterministic function of time.** Same plan + same `t` gives the same pixels. No
   `Math.random()` without a seed, no wall clock, no state that survives a seek. (Enforced at the browser level too:
   see §2.6, "Determinism".)
2. **Timing comes from a timing source, found by content.** With a voiceover, plates refer to words by text
   (`wordOf(line, "create")`), never by hard-coded seconds. With music, to beats. With on-screen text only, to reading
   time. A new voiceover read or a new music edit re-times the whole video for free.
3. **`plan.json` is the source of truth.** Feedback edits the plan first, then regenerates the affected plates. Hand
   edits to plate code are allowed only through the plan's `overrides` field, so they survive regeneration.
4. **One plate, every aspect ratio.** A plate is written once and lays itself out for the frame it is given. It is
   never cropped from another aspect ratio (§2.8).
5. **No vendor lock-in.** Renderer, voice, music, aligner, asset sources, and exporters sit behind the adapter
   contracts in §2.5. The skill's procedure (`SKILL.md`) never names a specific engine.
6. **Gates.** Claude stops for the person's approval at three points: the treatment, the draft, and the delivery.
   Claude also asks before any step that spends money (paid TTS, music, stock, image generation). Stills and draft
   renders need no approval.
7. **Smallest thing that works.** Files over services. One schema file over a class hierarchy. Add an adapter only
   when a second implementation actually exists.

## 1.4 Users
- **The person making a video**: opens Claude in the workspace, gives a concept (free text or
  `CONCEPT-TEMPLATE.md`), answers at most three intake questions, and approves at three gates.
- **The build team** (who builds the machine): an orchestrator session plus builder and reviewer subagents (§1.6,
  Part 3). The person also approves every phase plan and every merge.

## 1.5 User stories
- As a person, I give a few sentences and get back a script, a plate plan, and two rendered looks to choose from,
  before any video is made.
- As a person, I get a draft in 16:9 and 9:16 from the same plates, with a report that says what was checked.
- As a person, I say "slower", "bluer", "the reel feels cramped", or change a word, and only the affected parts change.
- As a person, I pick deliverables (MP4, ProRes with alpha, PNG sequence, SRT, an After Effects handoff) and get them
  checked.
- As a person, nothing costs money without my OK, and nothing I gave "for reference" appears in the output.
- As a person, any later session can pick a run up again from its folder.

## 1.6 Scope decisions (locked)
| Decision | Resolution |
|---|---|
| Product shape | A project-level Claude Code skill. No web UI, server, database, queues, or user accounts. |
| Layouts | No template catalog or "pick a layout" step. |
| After Effects | `ae_package` is a handoff (layer passes + `build_comp.jsx` + markers). Native keyframe-editable AE projects are a research item, out of scope. |
| Resolution | 1080p formats. 4K only as opt-in (`--scale 2`), never default. |
| Publishing | No auto-posting to Instagram or any platform. |
| Engine edits | In `engine/src/engine/`: only the frame-size change (Phase 0, done) and layer passes (Phase 5). Harness files (`engine/vite.config.ts`, `engine/src/main.ts`, `engine/index.html`, `engine/scripts/render.ts`) may change for run-folder plumbing, determinism and process hygiene. (Ruling 2026-10-05.) |
| Canvas2D rendering | **Software Canvas2D by default** (`--disable-accelerated-2d-canvas`), because GPU Canvas2D is not bit-stable (§2.6). GPU mode exists only to compare against the Phase 0 baseline. (Ruling 2026-10-06, option A.) |
| Phase numbering | Spec phases 0–5 are kept. Phase 0 is built except the canvas default and tooling ("Phase 0 finish"). |
| Build team | Orchestrator + `skill-builder`, `look-builder`, `engine-builder` + `spec-reviewer` + `code-reviewer`. No UI reviewer: there is no app UI; visual quality is judged by `intent.judge` / `look.judge` and by the person at the gates. (Ruling 2026-10-06.) |
| Tooling | `bun test`, `tsc --noEmit`, Biome (lint + format), ruff via uv. `engine/` and `tests/fixture/` are excluded from lint and format. (Ruling 2026-10-06.) |
| Source projects | `video-testing` and `kinomat` are read-only. The only command ever run in `video-testing` was the Phase 0 baseline render. |

Out of scope (say no if asked mid-task, point here): everything in the rows above marked as excluded.

## 1.7 Success metrics
- Every phase's acceptance test (Part 5) passes, as a runnable script, before the next phase starts.
- For three different concepts, no two end up with the same palette and type (Phase 3).
- A one-plate change regenerates only that plate; other plate files are byte-identical (Phase 4).
- The same `plan.json` renders through two render adapters with no change to `SKILL.md` (Phase 5).

# Part 2 — Technical Requirements (TRD)

## 2.1 Architecture

### 2.1.1 Data flow
```
concept.md
   │  intake: ask only blocking questions (step 1)
   ▼
brief.json
   │  research
   ▼
research.md
   │  write script + plan + two art directions, render 3 style frames each, in every format
   ▼
script.json, plan.json, directions/A|B  ── GATE 1 (treatment) ── person picks a direction, edits script ──┐
   │                                                                                                      │
   │  voice / music → align                                                                               │
   ▼                                                                                                      │
timing.json                                                                                               │
   │  generate plates (only those whose input_hash changed)                                               │
   ▼                                                                                                      │
plates/*.ts → lint → contact sheets per format → draft render per format                                 │
   │                                                                                                      │
   ▼                                                                                                      │ feedback
checks → test_results.json → report.md  ── GATE 2 (draft) ── person reviews ─────────────────────────────┘
   │  all blocking checks pass + person approves
   ▼
GATE 3 (delivery): confirm formats + deliverables → final render → exporters → out/deliver/ → final report
```

Process view: Claude (following `SKILL.md`) writes the run's JSON and plate files, then calls adapters. The pdoom
render adapter runs `engine/scripts/render.ts` under the pinned Bun with `VM_RUN=<run folder>`; that starts a private
Vite server for the run and drives headless Chrome (WebGL) to produce PNGs or raw frames piped to ffmpeg. The align
adapter runs `align.py` through `uv`, which drives `engine/analysis/align_vo.py` and `audio_vo.py`.

### 2.1.2 The skill procedure (`SKILL.md`)
`SKILL.md` is what Claude reads when the person says something like "make a video about X". Keep it under ~150 lines.
It must describe these steps, in this order, with the gates.

1. **Intake.** Save the concept verbatim. The person may write free text or fill in `CONCEPT-TEMPLATE.md` (workspace
   root); map whatever they gave onto `Brief`. Ask only blocking questions, at most three, each with a default the
   person can accept: length (30–60 s), timing source (voiceover), and formats (1920×1080 + Instagram reel). Check that
   every path they gave exists. Register brand logo, brand fonts, and `assets` as `AssetRef`s. Write `concept.md`,
   `brief.json`.
2. **Research.** Write `research.md`:
   - the subject: the facts, claims, and examples the video needs. Read `source_material` first; it wins over anything
     found on the web. Use web search when the concept names real things; cite sources at the bottom,
   - the audience and what they already know,
   - what a viewer must *see* to understand each point; concrete nouns and verbs that can become visuals,
   - how good videos on this topic or platform are paced and framed (hook timing, shot length, text density),
   - if `references` exist: study them per §2.9, note what to borrow (rhythm, framing, motifs), never what to copy,
   - two possible looks that fit the concept, and why each fits.
3. **Treatment.**
   - Write `script.json` from the concept: hook in the first 2 s, one idea per line, length inside the target.
   - Write `plan.json` against the script. Every line covered by exactly one plate; at least one beat per 2 s of
     speech; plates composed for their content, not picked from a menu.
   - Write two art directions, `directions/A` and `directions/B`. **They must differ in at least two of: palette, type,
     motion character, motifs.** At most one may be based on an existing pack. If `brand` fixes colours or fonts, both
     directions use them exactly, and the directions must instead differ in both motion character and motifs.
   - If `cta` is set, the last plate ends on it. `must_include` items appear in the script or plan; `must_avoid` items
     appear in neither.
   - Render 3 style frames per direction (the hook, a middle plate, the end), in every requested format. These are real
     stills from real plate code, not mock-ups.
   - **GATE 1:** show the script, the plan as a table (plate, lines, intent, beats), and the style frames side by side.
     Wait for: a direction choice (or "A but with B's type"), script edits, plan edits. Copy the chosen direction to
     `look/`.
4. **Timing.** Get the audio (supplied, or TTS / music adapter with the cost gate). Run the aligner. For `text_only`,
   write timing from reading speed (about 3 words/s, minimum 1.2 s per line). Fail loudly if any line's alignment
   confidence is below the adapter's threshold, and name the line.
5. **Generate plates.** For each plate whose `input_hash` changed: write `plates/<id>.ts` from the PlatePlan, `look/`,
   the renderer's `plateApi()`, `core/`, and the plate's timing. Use subagents in parallel when there are more than
   three plates. Each plate is self-contained.
6. **Render drafts.** For every format: `lint` (blocking) → `contactSheet` → draft render.
7. **Test.** Run all checks (§2.11). Write `test_results.json` and `report.md`. If blocking checks fail, fix and repeat
   from step 5 for the affected plates only, at most 3 automatic rounds, then stop and show the person.
8. **GATE 2: draft review loop.** Show the contact sheets and draft paths for every format and the report summary. Map
   the feedback:
   - about *what* is shown or *when* → edit `plan.json`, regenerate changed plates,
   - about the *words* → edit `script.json`, re-run from step 4 (timing re-flows everything),
   - about one plate ("slower", "bluer") → write it to that plate's `overrides`, regenerate that plate,
   - about the *look* everywhere → edit `look/look.json`, regenerate all plates,
   - about one *format* only ("the reel feels cramped") → edit that plate's `layout[format]` or `look.layout_rules`.
   Every accepted change bumps `version` and snapshots to `history/`.
9. **GATE 3: delivery.** Ask which deliverables the person wants (§2.10), with defaults: MP4 H.264 per format, burned
   captions on the reel, a separate `.srt`. Render at final quality, run the exporters, re-run checks on the final
   files, write the final `report.md`. Offer to save the look to `looks/` if it was new.

`report.md` contains: the concept, the research summary with sources, the script, the plan table, the chosen look and
why, per-plate decisions (why this visual for this line), every asset with source and license, the check table per
format, open warnings, and a changelog of iterations (what feedback, what changed).

## 2.2 Stack
| Layer | Tech | Notes |
|---|---|---|
| Runtime (skill code, tests, render script) | Bun **1.4.2**, pinned in root `package.json`, run as `node_modules/.bin/bun` | Global Bun 1.3.5 on this machine cannot launch Chrome via Playwright's pipe and ignores the engine's lockfile v2. |
| Language | TypeScript (`tsc --noEmit` for types) | No build step; Bun runs `.ts` directly. |
| Contracts | Zod **4.6.5** | `z.partialRecord`, `z.prettifyError` are used. |
| Lint / format (TS) | Biome | Excludes `engine/`, `tests/fixture/`, `tests/baseline/`, `runs/`. |
| Renderer (pdoom engine) | three **0.186.0**, Vite **8.3.0**, playwright-core **1.63.0**, opentype.js **2.0.0** | Exactly the versions video-testing ran; installed with `--frozen-lockfile` from `engine/bun.lock`. |
| Browser | Google Chrome 154 (`channel: 'chrome'`), headless, ANGLE D3D11 | Software Canvas2D by default (§2.6). `BROWSER_CHANNEL` overrides. |
| Video / audio tools | ffmpeg 9.0 (full build, libx264, ebur128) | On PATH. |
| Python | CPython 3.14 via `uv` (root `pyproject.toml`, `requires-python >=3.13`); numpy **2.5.3**, onnxruntime **1.30.0** | Call `uv` directly; `python -m uv` is broken on this machine. Lint/format with ruff. |
| Aligner model | wav2vec2-base-960h, quantized ONNX (`engine/analysis/models/`) | 95 MB, gitignored, copied by hand from video-testing. |
| Hooks | `python` 3.13 on PATH | The path guard runs as `python .claude/hooks/path_guard.py`. |

## 2.3 External integrations
Checked against the installed copies (Phase 0).

- **Engine harness** (`engine/scripts/render.ts`), always run with env `VM_RUN=<run folder>` (required) from `engine/`:
  - `stills --t a,b,c [--only ids] --out dir` → `dir/f_<t, 2 decimals, padded to 7>.png`
  - `sheet --per-plate N --cols N --out file.png` (or `--from/--to/--n`, `--times`, `--cuts`)
  - `video --fps F --samples 1|auto [--min-samples --max-samples --shutter] --crf C [--preset p] --out file.mp4 [--noaudio]`
  - common: `--w W --h H` (logical frame size, default 1920×1080), `--scale N`, `--strict` (plate or page errors throw),
    `--url` (reuse a running server; otherwise a private one is started and its process tree killed afterwards).
  - The run folder must contain `timeline.ts`; the page loads it as `@run/timeline`, serves `audio/` and `data/` from
    it, and maps plates' `../engine/*` imports to `engine/src/engine/`. Plates import `three` from the engine's copy.
  - The engine reads `data/lyrics.json` and `data/audio.json` (Phase 2 maps the run's `data/timing.json` onto it).
- **Aligner**: `uv run --project <workspace> python .claude/skills/video-machine/adapters/align/ctc-onnx/align.py
  <audio> <lines.json> <run_dir>` with `PYTHONUTF8=1`. `lines.json` = `{ lines: [{text}], spoken_words?: {word: [SPOKEN, ...]} }`.
  It overrides `align_vo`'s module globals (`ROOT`, `AUDIO`, `SCRIPT`, `SPOKEN`) and runs `audio_vo.py`'s source with
  its three paths swapped (asserted). Writes `<run>/data/timing.json` and `<run>/data/audio.json`.
- **TTS and music providers**: not chosen yet. The Phase 4 plan picks one of each, probes the installed SDK, and
  records exact calls here. API keys live in the workspace `.env` (agents are denied access to it).

## 2.4 Data models
All contracts are Zod schemas in `.claude/skills/video-machine/contracts/types.ts`; TS types are derived from them.
Every file the skill writes is validated on write **and** on read (`writeJson` / `readJson`). A failed parse is an
error, never a warning. The shapes (spec §3):

```ts
type Brief = {
  run_id: string;               // slug + short hash of the concept, e.g. "async-standups-3f9a"
  concept: string;              // verbatim
  goals: string[];              // e.g. ["hook in first 2 s", "explain X to non-devs", "end on CTA"]
  audience?: string;
  tone?: string;                // "playful", "premium", "technical", ... if the person said so
  duration_target_s: [number, number];
  timing_source: "voiceover" | "music" | "text_only";
  voice?: { source: "supplied"; path: string } | { source: "tts"; adapter: string; voice_id: string };
  music?: { source: "supplied"; path: string } | { source: "adapter"; adapter: string; query: string };
  formats: FormatId[];          // which aspect ratios to make. Default ["landscape_1080p", "reel"]
  deliverables: Deliverable[];  // which files to hand over. Decided at gate 3, can be empty before.
  references?: { path_or_url: string; use: "study_only" }[];   // never composited into output
  look_hint?: string;           // a pack name or a description, if the person gave one. Optional.
  brand?: {                     // must be used as-is; overrides any look's palette and type
    logo?: string;              // path
    colors?: { hex: string; role?: "bg" | "fg" | "accent" | "muted" }[];
    fonts?: { family: string; path?: string; license: string }[];
  };
  assets?: string[];            // paths the person wants shown; registered as AssetRef, usage "render", license "own (supplied)"
  source_material?: string[];   // paths to docs/notes the facts must come from; read before any web research
  cta?: { text: string; url_or_handle?: string };   // end card
  must_include?: string[];
  must_avoid?: string[];
  budget_usd?: number;          // hard ceiling for paid adapters; default 0 (free adapters only)
};

type FormatId = "landscape_1080p" | "reel" | "square" | "portrait_feed";

const FORMATS = {               // fixed table in contracts; adding a format = one line here
  landscape_1080p: { w: 1920, h: 1080, fps: 30, safe: { top: .05, bottom: .05, left: .05, right: .05 } },
  reel:            { w: 1080, h: 1920, fps: 30, safe: { top: .14, bottom: .20, left: .06, right: .06 } },
  square:          { w: 1080, h: 1080, fps: 30, safe: { top: .06, bottom: .06, left: .06, right: .06 } },
  portrait_feed:   { w: 1080, h: 1350, fps: 30, safe: { top: .06, bottom: .08, left: .06, right: .06 } },
} as const;

type Frame = { w: number; h: number; aspect: "landscape" | "vertical" | "square"; safe: Safe };   // frameOf(format)

type Deliverable = {
  format: FormatId;
  kind: "mp4_h264" | "mov_prores4444" | "png_sequence" | "webm" | "gif" | "srt" | "ae_package";
  captions: "burned" | "separate" | "none";   // reels default "burned" (most views are sound-off)
};

type Script = {
  run_id: string;
  version: number;
  lines: { id: string; text: string; spoken?: string; on_screen?: string }[];
  // text = what is said (or shown, if text_only). spoken = how TTS/aligner should read it ("5.5" → "five point five").
  // on_screen = a shorter on-screen version, if different from what is said.
};

type Look = {                   // one art direction. Written per run; may start from a pack in looks/.
  id: string;                   // "A", "B", or a pack name once saved
  based_on: string[];           // pack names it borrows from, or [] for a new look
  idea: string;                 // one sentence: why this look fits this concept
  palette: { name: string; hex: string; role: "bg" | "fg" | "accent" | "muted" }[];
  type: { role: "display" | "body" | "mono" | "label"; family: string; weights: number[]; license: string }[];
  motion: { character: string; easings: string[]; typical_beat_s: [number, number]; camera: string };
  motifs: { id: string; meaning: string; code?: string }[];   // code = path in motifs/ if reused
  post: Record<string, number>; // bloom, grain, etc., renderer-specific keys allowed
  layout_rules: { landscape: string; vertical: string; square: string };   // how compositions adapt (§2.8)
};

type Plan = {
  run_id: string;
  version: number;              // +1 on every accepted change
  look_id: string;
  visuals_plan: { plates: PlatePlan[] };
  asset_ids: string[];          // every asset any plate uses
  formats: FormatId[];
};

type PlatePlan = {
  plate_id: string;
  lines: string[];              // Script line ids this plate covers; every line is covered exactly once
  cut_in: { anchor: string; rule: "pause_before" | "on_word" | "on_beat" };
  intent: string;               // one sentence: what the viewer should understand
  beats: {                      // each beat = one visual change, tied to a word or a music beat
    on: string;                 // word/phrase found by content, or "beat:12"
    nth?: number;
    does: string;               // "pen strikes through the timeline", "MOTION lands as kinetic type"
    motif?: string;             // id from look.motifs
    hold?: boolean;             // intentional stillness; exempt from the dead-span check
  }[];
  layout: Partial<Record<FormatId, string>>;   // only where a format needs a different composition than look.layout_rules says
  transition_out: string;
  asset_ids: string[];
  overrides?: string;           // free text added after review; fed to generation verbatim
  input_hash: string;           // hash of (this PlatePlan minus input_hash, look.json, timing for its lines)
};

type AssetRef = {
  asset_id: string;
  kind: "image" | "video" | "audio" | "font" | "svg" | "data";
  path: string;
  source: string;               // adapter name + original URL or "generated"
  license: string;              // "MIT", "OFL", "own", "CC-BY-4.0 <attribution>", ...
  usage: "render" | "reference_only";   // reference_only must never reach a render (checked, §2.11)
};

type Timing = {                 // data/timing.json: the engine's word-timed format (align_vo.py's lyrics.json)
  source?: string;
  lines: { text: string; start: number; end: number;
           words: { w: string; start: number; end: number; syl?: [number, number][]; conf?: number }[] }[];
  beats?: number[];             // music beat times, when the timing source is music
};

type TestResults = {
  run_id: string;
  plan_version: number;
  output_paths: {
    stills: Partial<Record<FormatId, string[]>>;
    contact_sheets: Partial<Record<FormatId, string>>;
    drafts: Partial<Record<FormatId, string>>;
    deliverables: { deliverable: Deliverable; path: string }[];
    report: string;
  };
  checks: {
    id: string;                 // e.g. "timing.beats_on_words"
    format?: FormatId;          // set when a check runs per format
    blocking: boolean;
    status: "pass" | "fail" | "skip";
    detail: string;
    annotations: { plate_id?: string; t?: number; problem: string; suggested_fix: string }[];
  }[];
  summary: { blocking_failed: number; warnings: number };
};
```

`output_paths` lives on `TestResults` because a render only counts once it has been checked.

**Run folder** (one per video, created by the skill; skip anything a phase does not need yet):
```
runs\<run_id>\
  concept.md                  # input, verbatim
  brief.json                  # goals, audience, formats, deliverables, budget
  research.md                 # what Claude learned (step 2)
  script.json                 # written by Claude from the concept, approved at gate 1
  directions/A/  directions/B/   # look.json + LOOK.md + style frames for each art direction
  look/                       # the chosen direction, copied here after gate 1
  plan.json                   # the source of truth
  timeline.ts                 # engine glue written by the render adapter's scaffold()
  audio/  data/timing.json    # voiceover / music, aligned words or beats
  plates/<plate_id>.ts        # generated
  out/stills/<format>/  out/sheets/<format>.png  out/drafts/<format>/  out/final/<format>/  out/deliver/
  test_results.json
  report.md                   # human-readable, regenerated on every iteration
  history/<n>/                # plan.json + script.json + look.json per iteration, for diff and rollback
```
Renders and audio are gitignored; everything else in a run folder is small text and is committed.

## 2.5 Public functions / API
Each adapter is a folder with a TS module exporting these functions. The skill calls only these. Adding a renderer =
adding a folder that implements this list. Nothing else changes.

```ts
interface RenderAdapter {
  name: string;
  supports(format: FormatId): { ok: boolean; reason?: string };
  scaffold(runDir: string, plan: Plan, look: Look): void;     // engine glue, not plates
  plateApi(): string;            // markdown: how a plate file must look for this renderer (fed to generation)
  lint(runDir: string): Issue[]; // static + "does it load" checks; blocking
  still(runDir: string, format: FormatId, t: number[], only?: string[]): string[];   // PNG paths
  contactSheet(runDir: string, format: FormatId, perPlate: number): string;
  render(runDir: string, format: FormatId, quality: "draft" | "final", passes?: LayerPass[]): string;
  // passes: optional, for exporters that need separate layers with alpha (§2.10). Unsupported → throw, don't fake.
}
type LayerPass = "bg" | "graphics" | "type" | "captions" | "fx";
type Issue = { severity: "error" | "warning"; plate_id?: string; message: string };

interface VoiceAdapter  { synth(lines: Script["lines"], voice_id: string): string; costEstimate(lines): number; }
interface MusicAdapter  { get(query: string, duration_s: number): AssetRef; costEstimate?(query: string): number; }
interface AlignAdapter  { align(audioPath: string, lines?: Script["lines"]): string /* timing.json path */; }
interface AssetAdapter  { find(query: string, kind: AssetRef["kind"]): AssetRef[]; make?(spec: string): AssetRef; costEstimate?(spec: string): number; }
interface ExportAdapter { kind: Deliverable["kind"]; export(runDir: string, d: Deliverable): string /* path */; }
```

Paid adapters must return a cost estimate first. The skill sums estimates against `brief.budget_usd` and asks before
spending.

Implemented so far:
| Function | Args | Returns |
|---|---|---|
| `pdoom.supports` | `format` | `{ ok: true }` for every `FormatId` |
| `pdoom.still` | `runDir, format, t[], only?` | PNG paths in `<run>/out/stills/<format>/` (runs with `--strict`) |
| `pdoom.contactSheet` | `runDir, format, perPlate` | `<run>/out/sheets/<format>.png` |
| `pdoom.render` | `runDir, format, quality, passes?` | `<run>/out/{drafts,final}/<format>/video.mp4`; throws on `passes` until Phase 5 |
| `pdoom.scaffold` / `plateApi` / `lint` | — | throw "not built yet" until Phases 1–2 |
| `ctcOnnx.align` | `audioPath` (inside `<run>/audio/`), `lines`, `spokenWords = {}` | `<run>/data/timing.json` (validated); also writes `audio.json` |
| `readJson` / `writeJson` | `file, schema[, data]` | parsed data; throw with every Zod issue |
| `frameOf` | `format` | `Frame` |

## 2.6 Operational safeguards
| Concern | Solution |
|---|---|
| Determinism | GPU Canvas2D shares raster caches in Chrome's GPU process, so hairline text antialiases one of two ways depending on what was drawn before (measured: t=5 matched the baseline 2 of 4 fresh renders). Chrome runs with `--disable-accelerated-2d-canvas` by default; then every frame is byte-identical across runs. WebGL stays on the GPU. `--gpu-canvas` restores the old mode, only for the baseline comparison. |
| Toolchain drift | Pinned Bun 1.4.2. Engine dependencies installed with `--frozen-lockfile` (a non-frozen install re-resolved three to 0.186.1). |
| Process leaks | `render.ts` starts a private Vite per call unless `--url` is given, and kills its whole process tree (`taskkill /T /F` on Windows). |
| Silent render failures | `--strict` turns plate errors and page errors into a failed render; adapters always pass it. `render.lint` and `motion.no_dead_spans` are blocking. |
| Windows text encoding | Python subprocesses get `PYTHONUTF8=1`. `.gitattributes` keeps every text file LF. |
| Source projects | `video-testing` and `kinomat` are read-only. Each acceptance script re-checks the `video-testing` listing against `tests/phase0/video-testing.before.txt`. |
| Engine scope | Only engine-builder may write `engine/`, and only within the "Engine edits" ruling (§1.6). |
| Contracts | Every JSON file goes through `readJson`/`writeJson`; a failed parse is an error. |
| Money | Paid adapters return a cost estimate first; the skill sums estimates against `budget_usd` and asks before spending. With `budget_usd: 0` a paid call stops and asks. |
| Reference material | `reference_only` assets never reach a plate or render input (`assets.no_reference_only`, blocking). |
| Secrets | API keys only in the workspace `.env`; `.claude/settings.json` denies agents Read/Edit/Write on it. Never paste keys into chat. |
| Fixtures | `tests/baseline/` and `tests/fixture/` are owned by no builder; the orchestrator changes them only with the person's OK. |

## 2.7 Settings
| Name | Type | Default | Where |
|---|---|---|---|
| `VM_RUN` | path (env) | required | engine harness: the run folder |
| `EXTRA_CHROME_ARGS` | space-separated (env) | empty | `render.ts`, appended to Chrome args (diagnostics) |
| `BROWSER_CHANNEL` | string (env) | `chrome` | `render.ts` |
| `PDOOM_NO_HMR` | flag (env) | set by `render.ts` | `vite.config.ts`: no live reload during renders |
| `PYTHONUTF8` | flag (env) | `1` for Python subprocesses | align adapter |
| `--gpu-canvas` | flag | off | `render.ts`: GPU Canvas2D (baseline comparison only) |
| `--samples` | `N` or `auto` | draft `1`, final `auto` (4–12, shutter 0.5) | pdoom render |
| `--crf` / `--preset` | number / string | draft `23` / `veryfast`; final `17` / `slow` | pdoom render |
| `brief.formats` | `FormatId[]` | `["landscape_1080p", "reel"]` | Brief |
| `brief.budget_usd` | number | `0` | Brief |
| `brief.duration_target_s` | `[min, max]` | asked at intake (default 30–60) | Brief |
| text-only reading speed | words/s, min s per line | `3`, `1.2` | timing step |
| auto-fix rounds | number | `3` | test step |
| motion dead span | seconds | `1.5` | `motion.no_dead_spans` |
| beat tolerance | frames | `±2` | `timing.beats_on_cues` |
| min text size | % of frame height | vertical `3.5`, landscape `2.5` | `layout.min_text_size` |
| loudness | LUFS / dBTP | `−14 ±1` / `≤ −1` | `audio.loudness` |

## 2.8 Multiple formats from one plate
Motion graphics do not crop well. A 16:9 composition cut to 9:16 loses its sides, and the text ends up under
Instagram's buttons. So plates **lay out per format**, they are never cropped.

- A plate gets a `frame` object: `{ w, h, aspect: "landscape" | "vertical" | "square", safe }`. All positions and sizes
  are computed from it. No pixel constants for layout.
- Timing, beats, and motifs are the same in every format. Only layout changes. One plate file, one timeline.
- `look.layout_rules` says how the look adapts in words, for example: landscape puts the diagram left and the type
  right; vertical stacks them, type on top, bigger, fewer words per line; camera moves become vertical pans. A plate may
  override per format in `PlatePlan.layout`.
- Reels: text at least 3.5 % of frame height, everything important inside the safe area (top 14 %, bottom 20 %, sides
  6 % are covered by Instagram UI), burned captions by default.
- Contact sheets are made per format and shown side by side at both gates, so layout problems show up before a full
  render.

The first two formats are `landscape_1080p` (1920×1080) and `reel` (1080×1920). `square` and `portrait_feed` exist in
the table from the start, but are built and tested in Phase 5.

## 2.9 Research: studying a source
This is how the machine learns a look from something that exists, starting with Motion Graphics 1. The output is a
pack in `looks/`, not a copy.

For a **code project** (like `video-testing`): read the engine and plates, then write:
- `look.json`: palette, fonts and weights, type sizes, easing curves, typical beat durations, post-processing settings,
  all read from the code (`palette.ts`, `type.ts`, `post.ts`, `util.ts`).
- `LOOK.md`: the rules the plates follow, in words. For Motion Graphics 1 that includes: the spark is the pen, unsaid
  words are hairline outlines, the spoken word wipes in signal orange and said words cool to bone, cuts sit 0.04–0.18 s
  before a line's first word, the camera moves between shots instead of cutting inside a plate, and the video loops to
  frame 0.
- `motifs/`: the look-specific functions, lifted from `_vo.ts` and `_motifs.ts` (plotter, karaoke, graph paper, spark).
  Generic mechanics from the same files (camera, polyline math, text fitting) go to `core/` instead. Keep the MIT
  attribution from `LICENSE.pdoom-engine` with both.
- `examples/`: two finished plates with a header comment that says what each one demonstrates.

For a **rendered video** (an MP4 the person likes): sample frames on shot changes (ffmpeg scene detection), build a
contact sheet, transcribe the audio if any, then describe in `research.md`: shot lengths, cut rhythm against speech or
music, palette (sampled), type treatment, camera behaviour, transitions. Turn that into a pack the same way. The source
video is `reference_only` and is never placed in a render.

## 2.10 Deliverables and export
Each deliverable kind is one export adapter. The person picks at gate 3.

| kind | what the person gets | notes |
|---|---|---|
| `mp4_h264` | MP4, H.264, AAC, −14 LUFS | default for every format |
| `mov_prores4444` | MOV with alpha | for editors who composite over other footage |
| `png_sequence` | numbered PNGs + audio WAV | lossless, any tool can import it |
| `webm` / `gif` | web embeds | gif: short loops only, warn if > 10 s |
| `srt` | caption file from the timing data | always available, free |
| `ae_package` | After Effects handoff (below) | |

**After Effects: say exactly what it is.** The video is drawn by code, so there are no After Effects keyframes to
export. The `ae_package` is a handoff, not a native AE project:
- each plate rendered as separate layer passes (`bg`, `graphics`, `type`, `captions`) as ProRes 4444 with alpha,
- the voiceover / music as WAV,
- `build_comp.jsx`: an ExtendScript the person runs in AE. It creates a comp at the right size and fps, imports the
  passes in order, places each plate at its start time, and adds a marker for every word and beat.

The person can then re-time, recolour, and add effects in AE, but cannot edit the animation curves. Tell the person
this at gate 3 before they choose it.

Layer passes need the renderer to draw one layer group at a time with a transparent background. Post effects that work
on the whole picture (bloom, grain) go in the `fx` pass or are turned off for the package; record which in the report.
If a render adapter cannot make passes, `render(..., passes)` must throw, and the AE export falls back to one flattened
ProRes per plate plus the same `.jsx` and markers. It must say so in the report.

## 2.11 Checks
Each check is one script in `checks/`, reads the run folder, and appends to `test_results.json`. Checks marked "per
format" run once for every format in `brief.formats`.

| id | blocking | per format | how |
|---|---|---|---|
| `contracts.valid` | yes | | every JSON file parses against its schema |
| `plan.coverage` | yes | | every script line in exactly one plate; plates contiguous, in script order |
| `look.directions_differ` | yes (gate 1) | | directions A and B differ in at least two of palette, type, motion, motifs (in both motion and motifs when `brand` fixes palette or type) |
| `brief.applied` | yes | | brand colours and fonts are in `look.json` unchanged; brand logo and every `assets` path is used by some plate; `cta` text is on the last plate; `must_avoid` terms are absent from script and plan |
| `render.lint` | yes | yes | the adapter's `lint` returns no errors |
| `render.deterministic` | yes | yes | render 5 random `t` twice, fresh page each time; pixel hashes match |
| `render.seek_safe` | yes | | still at `t` after playing from 0 == still at `t` after seeking straight to it |
| `motion.no_dead_spans` | yes | yes | frame difference over the draft; no span > 1.5 s below the motion threshold unless the beat has `hold` |
| `timing.beats_on_cues` | yes | | each beat's visual change lands within ±2 frames of its word or music beat; plates report beat times through a debug export to make this exact |
| `timing.duration` | yes | | final duration inside `duration_target_s` |
| `layout.safe_area` | yes | yes | every text box (from the plate's debug export) is inside the format's safe area |
| `layout.min_text_size` | yes on reel | yes | text height ≥ 3.5 % of frame height on vertical, 2.5 % on landscape |
| `layout.no_overflow` | yes | yes | no text box leaves the frame or overlaps another text box |
| `assets.no_reference_only` | yes | | no `reference_only` asset path appears in any plate or render input |
| `assets.licensed` | yes | | every used asset and font has a non-empty `license` |
| `audio.loudness` | yes on final | | integrated −14 LUFS ±1, true peak ≤ −1 dBTP (ffmpeg `ebur128`) |
| `captions.match` | yes if burned | yes | caption text equals the script; each word visible during its spoken time |
| `deliver.files` | yes on final | | every deliverable exists, plays (ffprobe), and has the right size, fps, and duration |
| `intent.judge` | no | | a vision model gets the contact sheet + each plate's `intent` and `beats` and scores 1–5; ≤ 3 becomes an annotation with a fix |
| `look.judge` | no | yes | same, against `LOOK.md`: which plates break the look, and which formats feel cramped or empty |

Model-judged checks are never blocking. They feed annotations. The person decides.

# Part 3 — Coding standard (summary; full rules in AGENT_PROMPT.md)
- TypeScript run by the pinned Bun; Python only where the aligner needs it, run by `uv`.
- TDD: unit tests (`*.test.ts`, `bun test`) first, external tools mocked. Acceptance scripts (`tests/accept/phase-N.ts`)
  use the real Chrome, ffmpeg and aligner and are run by the orchestrator at the end of each phase.
- Functional style, plain functions and objects, no classes in skill code (engine and plates keep the engine's
  `Scene` classes). Zod for every file boundary. Errors thrown with the path and the cause.
- Plates and motifs are deterministic functions of time: seeded randomness only, no clock, no state across seeks.
- Ponytail: the shortest thing that meets the task; `ponytail:` comments mark deliberate limits.

**Team and ownership.** Each builder's write paths are enforced by a hook in its frontmatter.

| Agent | Model | Preloads | May write |
|---|---|---|---|
| orchestrator | inherit | writing-plans, subagent-driven-development, verification-before-completion, ponytail | `docs/`, `.claude/agents/`, `HANDOFF.md`, git commits |
| skill-builder | sonnet | test-driven-development, verification-before-completion, ponytail | under `.claude/skills/video-machine/`: `SKILL.md`, `contracts/`, `core/`, `adapters/`, `checks/`; plus `tests/` (not `tests/fixture/`, `tests/baseline/`), root `package.json`, `bun.lock`, `pyproject.toml`, `uv.lock`, `biome.json`, `tsconfig.json`, `.gitignore` |
| look-builder | sonnet | the same three | `.claude/skills/video-machine/looks/` |
| engine-builder | sonnet | the same three | `engine/` (within the "Engine edits" ruling) |
| spec-reviewer | sonnet | none | nothing |
| code-reviewer | sonnet per task; opus for the whole-branch review | none | nothing |

When a look needs a new mechanic, look-builder reports it and the orchestrator gives that piece to skill-builder:
motifs belong to looks, mechanics to `core/`.

# Part 4 — Folder structure
```
C:\Work-data\video-machine\
  .gitignore  .gitattributes        # renders/audio/node_modules/.venv/*.onnx ignored; LF everywhere
  package.json  bun.lock            # zod, pinned bun 1.4.2, typescript, biome, scripts: test/lint/format
  pyproject.toml  uv.lock           # numpy, onnxruntime (aligner), ruff
  tsconfig.json  biome.json         # type check + lint/format config (excludes engine/, tests/fixture/, tests/baseline/, runs/)
  HANDOFF.md                        # session-to-session state
  CONCEPT-TEMPLATE.md               # what the person fills in to start a video
  docs/
    BLUEPRINT.md                    # this file
    AGENT_PROMPT.md                 # coding standard for builders
    superpowers/plans/phase-N-*.md  # one plan per phase
  engine/                           # copy of video-testing/app + analysis (pdoom engine; MIT, LICENSE.pdoom-engine)
    src/engine/                     # the engine (edit only per §1.6)
    src/main.ts  index.html  vite.config.ts  scripts/render.ts   # harness
    public/fonts/                   # Archivo, IBM Plex Mono, Cormorant Garamond, stroke fonts
    analysis/                       # align_vo.py, audio_vo.py, sfx_mix.py, models/ (ONNX, gitignored)
  .claude/
    settings.json                   # deny .env
    hooks/path_guard.py             # blocks builder writes outside their folders
    agents/*.md                     # orchestrator, skill-builder, look-builder, engine-builder, spec-reviewer, code-reviewer
    skills/video-machine/
      SKILL.md                      # the procedure (§2.1.2). Short. Points to the rest.
      contracts/types.ts            # all data contracts as Zod + adapter interfaces + validated IO
      core/                         # mechanics only: camera, easing, text fit, timing lookup, frame/safe-area, captions
      adapters/
        render/pdoom/               # drives engine/
        align/ctc-onnx/             # drives engine/analysis (word times + beat grid)
        voice/  music/  assets/  export/   # Phase 4–5 (§2.10)
      looks/                        # the style library; each a starting point, never a default
        plotter/                    # extracted from Motion Graphics 1 (§2.9): LOOK.md look.json motifs/ examples/
      checks/                       # one script per automated check (§2.11)
  tests/
    baseline/                       # 5 stills rendered from video-testing (Phase 0); never regenerated
    fixture/                        # Motion Graphics 1's plates, timeline, audio, data, spoken.json
    phase0/video-testing.before.txt # listing of video-testing taken before Phase 0
    concepts/                       # the three test concepts (Phase 1+)
    accept/phase-N.ts               # acceptance scripts, one per phase
    out/                            # test run folders and scratch output (gitignored)
  runs/<run_id>/                    # every video, one folder each (§2.4)
```

# Part 5 — Feature list
Each phase gets one plan in `docs/superpowers/plans/`, written after the previous phase is merged and reviewed by the
person before building. Each task is self-contained for one builder. Do not start a phase until the previous one passes
its acceptance script. Every acceptance script is runnable (`node_modules/.bin/bun tests/accept/phase-N.ts`) and ends
by re-checking the `video-testing` listing.

**Running the skill in acceptance tests (Phases 1–3).** These tests need Claude to follow `SKILL.md`; code cannot write
a script or a look. The orchestrator stores the three concepts in `tests/concepts/` (a 30 s product reel, a 60 s
explainer, a 20 s music-driven piece with no voiceover), runs the skill on each in a fresh subagent with the
instruction "accept the defaults at every gate; pick direction A", writing the run folder under `tests/out/runs/`, and
then the acceptance script judges the folders with the `checks/` scripts. Paid adapters are never approved in tests.

### Phase 0 — Workspace, engine copy, any frame size (built; finish pending)
Built (see HANDOFF.md): workspace, baseline, engine + fixture copy, frame size from the format, run-folder harness,
`contracts/types.ts`, `adapters/render/pdoom`, `adapters/align/ctc-onnx`, `tests/phase0.ts`.

Finish:
- Software Canvas2D by default in `render.ts`; `--gpu-canvas` restores GPU mode. → engine-builder
- Tooling: TypeScript, Biome, ruff; `package.json` scripts `test`, `lint`, `format`; `tsconfig.json`, `biome.json`. Make
  the existing skill code pass lint. → skill-builder
- Move `tests/phase0.ts` to `tests/accept/phase-0.ts`; the baseline check runs in GPU mode with up to 6 renders per
  frame (the source config is not bit-stable at t=5); add a determinism check. → skill-builder
- **Accept when:** 1920×1080 stills at the five baseline times, rendered from the copy through the adapter in GPU mode,
  are byte-identical to `tests/baseline/` (within 6 renders per frame); in the default mode, three fresh renders of the
  five times are byte-identical to each other; aligning the fixture voiceover through the adapter reproduces the
  fixture `lyrics.json` word times within 10 ms; a 1080×1920 still renders without errors (it will look wrong, because
  the old plates use pixel constants; that is expected); the file list and sizes of `video-testing` (excluding
  `app/node_modules`) match the listing taken before Phase 0; `bun test` and `bun run lint` are clean.

### Phase 1 — Concept to treatment, one look
- `core/`: camera, easing, polyline math, text fit, timing lookup (`lineOf`/`wordOf` by content), frame/safe-area,
  lifted from `_vo.ts`/`util.ts` with the MIT attribution. → skill-builder
- `looks/plotter`: `look.json`, `LOOK.md`, `motifs/` (plotter, karaoke, graph paper, spark), `examples/` (§2.9).
  → look-builder
- `plateApi()` with the `frame` object (§2.8); `SKILL.md` steps 1–3 up to the plan (intake, research, script, plan).
  → skill-builder
- `checks/contracts.valid`, `checks/plan.coverage`. → skill-builder
- **Accept when:** for three concepts (a 30 s product reel, a 60 s explainer, a 20 s music-driven piece with no
  voiceover), `script.json` and `plan.json` pass `contracts.valid` and `plan.coverage`; every beat anchor exists in the
  script; durations estimated from word count fall inside the target.

### Phase 2 — Generate and render drafts in both formats
- `pdoom.scaffold` (writes the run's `timeline.ts`; maps `data/timing.json` to what the engine reads) and `pdoom.lint`.
  → skill-builder (harness side → engine-builder)
- `SKILL.md` steps 4–6: timing, plate generation from the plan using the `frame` object, lint, contact sheets, drafts
  for `landscape_1080p` and `reel`. → skill-builder
- The blocking checks other than `audio.loudness`, including the plate debug export of text boxes and beat times.
  → skill-builder
- **Accept when:** one concept goes from `concept.md` to two draft MP4s (16:9 and 9:16) from the same plate files,
  every blocking check except `audio.loudness` passes in both formats, and no plate file was edited by hand.

### Phase 3 — Two art directions, testing, report
- Art direction step with two directions and style frames (step 3); one direction may use `plotter`, the other must
  not. → skill-builder (`SKILL.md`), look-builder (look-writing guidance in `looks/`)
- All checks in §2.11, `test_results.json`, `report.md`, the 3-round auto-fix limit. → skill-builder
- **Accept when:** for the three Phase 1 concepts, the six directions pass `look.directions_differ` pairwise and no two
  concepts end up with the same palette and type; a deliberately broken plate (uses `Math.random()`, has a 3 s static
  hold, puts text in the bottom 15 % of the reel) fails exactly `render.deterministic`, `motion.no_dead_spans`, and
  `layout.safe_area` (reel), and the annotations name the plate, the format, and the time.

### Phase 4 — Iteration, sound, delivery
- Draft review loop (step 8), `history/` snapshots, partial regeneration by `input_hash`. → skill-builder
- SFX cue sheet generated from the timing, like `analysis/sfx_mix.py`; loudness check on final. → skill-builder
- Export adapters: `mp4_h264`, `mov_prores4444`, `png_sequence`, `srt`. → skill-builder
- One TTS voice adapter and one music adapter, both with cost gates (provider chosen in the plan, §2.3). → skill-builder
- **Accept when:** "make plate 3 slower" regenerates only plate 3 (other plate files byte-identical); changing one
  script word re-aligns and the final still passes `timing.beats_on_cues`; "the reel feels cramped on plate 2" changes
  only plate 2's reel layout; every Phase 4 deliverable passes `deliver.files`; a paid call with `budget_usd: 0` stops
  and asks instead of spending.

### Phase 5 — More formats, After Effects, second renderer
- `square` and `portrait_feed` formats. → skill-builder
- Layer passes in the engine and the pdoom adapter → engine-builder, skill-builder; the `ae_package` exporter (§2.10).
  → skill-builder
- A second render adapter for a different engine (for example HyperFrames, Remotion, or plain Canvas + ffmpeg).
  → skill-builder
- A look extracted from a rendered reference video (§2.9). → look-builder
- **Accept when:** one plan renders in all four formats with all per-format checks passing; `build_comp.jsx` builds a
  comp in After Effects whose markers match `timing.json` (check by exporting the marker list from AE, or have the
  person confirm once); the same `plan.json` renders through both render adapters with no change to `SKILL.md`.

### Future (not v1)
- Native, keyframe-editable After Effects output from an AE-expressible renderer (JSX-emitting or Lottie-based).
- 4K by default, auto-posting, any web UI or service (excluded by §1.6).
