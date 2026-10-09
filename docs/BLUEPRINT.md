# Video Machine — Project Blueprint

> **Status:** Spec v1. **Last updated:** 2026-10-09
> **Companion docs:** [AGENT_PROMPT.md](AGENT_PROMPT.md) (coding standard)
> **Visual version:** https://claude.ai/artifact/CWKbFBDQDDUtzTjLy7j8nS (flowchart, per-part pseudocode, TTS and renderer comparisons)
> **History:** supersedes the pdoom-era blueprint of 2026-10-06 (commit `2f13bff`, which restructured
> `C:\Work-data\video-testing\VIDEO-MACHINE-PROMPT.md`). Its non-negotiables, still-valid rulings, check table and
> thresholds are carried over below; its detailed §2.4 data models and pdoom engine notes remain in that commit.
> Phase 0 is done; see `HANDOFF.md`.

Part ids `M0`–`M18` are used everywhere: in plans, tests, commit messages and the visual blueprint.

# Part 1 — Product Requirements (PRD)

## 1.1 Summary
A Claude Code **plugin** that turns a **concept script** plus a **screen recording of someone using a product** into a short
motion-graphics video for Instagram Reels / YouTube Shorts (1080×1920, 15–30 s), with an optional talking avatar.
Claude researches, captures the product in a real browser, writes the script, makes storyboards from real frames, renders
with HyperFrames, checks the result, and delivers MP4 + SRT (+ an After Effects handoff). The creator reviews at four gates.

## 1.2 Problem
Making a product reel means scripting, screen-recording clean footage, designing motion graphics, voicing, timing,
captioning and exporting. That's days of work across several tools. Generic AI video tools produce template-looking output,
and you can't edit what they make.

## 1.3 Solution
One conversation with Claude. Everything is plain files in a run folder, the video is code (HTML scenes), timing comes from
word-level alignment, and every step can be re-run on its own. No server, database or web UI: the plugin *is* the product.

### Every video must look like its concept, not like the last video
The main design goal. A machine that turns every concept into the same look is a template engine with extra steps.
- **The look is decided per concept**, in the art-direction step (M7), from the research, and written down as
  `look.json` + `LOOK.md` for that run.
- **Style packs are a library, not a default.** A look may reuse a pack, blend two, or start from nothing. Approved new
  looks can be saved back as packs. HyperFrames catalog blocks and presets count as packs: a starting point only.
- **The creator always sees two different directions** as real rendered frames before the video is made, and picks.
- **No template library and no layout menu.** Each scene is composed for its own content and look.
- **Shared code is limited to mechanics**: timing lookup, text fit, safe area, captions, easing. Motifs, palettes and
  type belong to a look, not to the machine.

### Non-negotiables
1. **Every frame is a deterministic function of time.** Same plan + same `t` gives the same pixels. No unseeded
   randomness, no wall clock, no state that survives a seek. (HyperFrames enforces part of this: one paused timeline per
   scene; breaking it freezes frames silently, so the checks catch it.)
2. **Timing comes from a timing source, found by content.** With a voiceover, scenes refer to words by text
   (`wordOf(line, "create")`), never by hard-coded seconds. A new read re-times the whole video for free.
3. **`plan.json` is the source of truth.** Feedback edits the plan first, then regenerates the affected scenes. Hand
   edits to scene code survive only through the plan's `overrides` field.
4. **One scene, every aspect ratio.** A scene is written once and lays itself out for the frame it is given (per-format
   CSS variables). It is never cropped from another aspect ratio.
5. **No vendor lock-in.** Renderer, voice, aligner, avatar, capture and exporters sit behind the adapter contracts
   (§2.5). The procedure skills never name a specific engine.
6. **Gates.** Claude stops for the creator at four points (script, storyboard, draft, delivery) and before anything that
   spends money. Stills and draft renders need no approval.
7. **Smallest thing that works.** Files over services. One schema file over a class hierarchy. Add an adapter only when
   a second implementation actually exists.

## 1.4 Users
Creators who use Claude Code (or are willing to install it). They don't need to be developers: they say "set it up for me"
and Claude installs everything. The first user is the project owner, making reels about software products.

## 1.5 User stories
1. As a creator, I say "set it up for me" on a fresh machine and Claude installs and verifies every dependency.
2. I hand over a concept script, a navigation video and a product URL; Claude asks at most three questions.
3. I see an assets panel of clean captures from my product and can drop or pin assets.
4. I review the script as a table before any visuals are made.
5. I review real storyboard frames, scene by scene, and my notes stick when scenes are regenerated.
6. I watch a draft reel and give plain-language notes; only the affected scenes change.
7. I get an MP4 ready to post, an SRT, and optionally an After Effects package.
8. I can add an avatar that delivers some lines, layered over the motion graphics.

## 1.6 Scope decisions (locked)
| Decision | Resolution |
|---|---|
| App or plugin | **Claude Code plugin.** Build an app only if payments or hosted rendering are ever needed. |
| Renderer | **HyperFrames** (Apache 2.0, HTML + CSS + GSAP), pinned. Remotion rejected (licence friction for creators). pdoom adapter stays, not extended. |
| Review gates | **Four:** script (G1), storyboard per scene (G2), draft (G3), delivery formats (G4). Spend always asks too. |
| Art directions | Two directions, **one board each** (the hook) at G1→G2. *(Default; user to confirm.)* |
| Product capture | **Playwright** with a persistent profile per product; the creator logs in once by hand. Claude never types passwords. |
| Navigation video | `reference_only`: it teaches the flow and never appears in a render. |
| Voice | **Kokoro via `hyperframes tts`** by default. Chatterbox (voice clone) later. ElevenLabs only behind the cost gate. |
| Alignment | Existing **ctc-onnx** forced aligner (M10). `hyperframes transcribe` (Whisper) only when there's no script. |
| Avatar | Optional, built last (Phase 8). Local audio-driven (SadTalker / Wav2Lip / MuseTalk), HeyGen (paid), or a supplied clip. Background removed with `hyperframes remove-background`. |
| Formats v1 | `reel` only. 16:9 later from the same scenes (layout via per-format CSS variables). |
| After Effects | Handoff only (layers or flattened scenes + `build_comp.jsx` with word markers). No editable keyframes. |
| Telemetry | `HYPERFRAMES_NO_TELEMETRY=1`; never run `hyperframes feedback` unless the creator asks. *(Default; user to confirm.)* |
| Resolution | 1080p formats. 4K only as an opt-in, never the default. |
| Source projects | `video-testing` and `kinomat` are read-only. The only command ever run in `video-testing` was the Phase 0 baseline render. |
| pdoom engine (kept from 2026-10-05/06 rulings) | Applies only to `render/pdoom`: engine edits limited to the frame-size change and harness plumbing; software Canvas2D by default (`--disable-accelerated-2d-canvas`) because GPU Canvas2D isn't bit-stable. |
| Tooling (ruling 2026-10-06, kept) | `bun test`, `tsc --noEmit`, Biome (lint + format), ruff via uv. `engine/` and `tests/fixture/` are excluded from lint and format. |
| Build team (ruling 2026-10-09, replaces 2026-10-06) | Orchestrator + `lib-builder`, `plugin-builder` + `spec-reviewer` + `code-reviewer`. A `visual-reviewer` joins in Phase 4. The old `skill-builder` / `look-builder` / `engine-builder` split assumed pdoom plates. |
| Phase numbering (2026-10-09) | Phases 1–9 in Part 5 replace the old spec phases 1–5. The old "Phase 0 finish" items (canvas default, tooling) move into Phase 1. |
| Out of scope | Web UI, server, database, accounts, template catalog, auto-posting, 4K by default, vlog/raw-footage editing (future). |

## 1.7 Success metrics
- Fresh Windows machine → passing smoke test from one "set it up for me", with no manual steps except approving installs and installing Claude Code.
- Concept + navigation video → approved reel with every blocking check passing at delivery.
- A 30 s draft renders in under 2 minutes on the reference laptop (RTX 3050 4 GB, Ryzen 7 7435HS).
- A single-scene note ("make scene 3 slower") changes only that scene's file.

# Part 2 — Technical Requirements (TRD)

## 2.1 Architecture
Claude (driven by the plugin's skills) runs small CLIs and writes validated files into `runs/<run_id>/`. Each part reads
files and writes one checked file. Agents never pass state in memory.

```
concept.md + input/nav.mp4 + url
   │ M1 intake ─────────────► brief.json
   │ M2 video reader ───────► capture/steps.json          (ffmpeg scenes + hyperframes transcribe + Claude vision)
   │ M3 replay + capture ───► capture/shots|clips|text|log.json   (Playwright, persistent profile)
   │ M4 assets panel ───────► assets.json                  (creator drops / pins)
   │ M5 research ───────────► research.md, capture/brand/  (hyperframes capture for public pages)
   │ M6 script ─────────────► script.json ── G1 ──┐
   │ M7 looks ──────────────► directions/A|B       │
   │ M8 storyboard ─────────► plan.json, boards/ ── G2 ──┐
   │ M9 voice ──────────────► audio/vo.wav               │  (hyperframes tts = Kokoro)
   │ M10 align ─────────────► data/timing.json           │  (ctc-onnx, exists)
   │ M11 avatar (optional) ─► avatar/<seg>.webm          │
   │ M12 scene writer ──────► index.html, scenes/*.html  │  (one subagent per scene)
   │ M13 render ────────────► out/stills, sheet, drafts  │  (hyperframes lint/check/snapshot/render)
   │ M14 checks ────────────► test_results.json, report.md ── G3 ── M15 feedback router ──┘
   │ M16 sound ─────────────► audio/mix.wav, out/captions.srt
   └ M17 export ── G4 ──────► out/deliver/*
M0 setup/doctor runs once per machine → ~/.video-machine/doctor.json.  M18 = run folder + Zod contracts under all of it.
```

Feedback routing (M15): words → M9 onward; what/when → plan → M12; one scene / look / one format → M12 for the affected scenes only.

## 2.2 Stack
| Layer | Tech | Notes |
|---|---|---|
| Plugin runtime | Claude Code plugin (skills, agents, hooks) | Local dev: `claude --plugin-dir .` |
| TS runtime | bun **1.4.2** (pinned, `node_modules/.bin/bun`) | Global bun 1.3.5 can't launch Chrome on Windows (Phase 0) |
| Contracts | zod ^4.1 | `lib/contracts/types.ts` |
| Renderer | **hyperframes 0.8.143** (pinned), Node ≥ 22 | Needs Chrome + ffmpeg. Phase 1 probes the CLI flags on this exact version |
| Browser capture | Playwright (version pinned in Phase 3 after probing) | Persistent context + `recordVideo` |
| Aligner | Python 3.13 via `uv`, onnxruntime ≥ 1.30, numpy | wav2vec2-base-960h quantized ONNX, 95 MB, in the per-user cache |
| Media | ffmpeg ≥ 6 with libx264 | Scene detection, splitting, loudness, muxing |
| Lint / format | `tsc --noEmit` + Biome (added in Phase 1) | |
| Tests | `bun test` (unit) + `bun tests/<phase>.ts` (acceptance) | |

## 2.3 External integrations
Verify each call against the **installed** version before a phase plan uses it. The command list below comes from the
HyperFrames skill docs for 0.7.107 (Kinomat); re-check on 0.8.143.

| Integration | Calls used | Where |
|---|---|---|
| HyperFrames CLI | `doctor`, `skills`, `capture <url>`, `transcribe`, `tts`, `remove-background`, `lint --json`, `check`, `snapshot --at t1,t2`, `render --quality draft\|high --output <f>` | M0, M2, M5, M9, M11, M13, M17 |
| HyperFrames composition contract | root `data-composition-id` + `data-start="0"` + `data-width/height`, `data-duration`; one `gsap.timeline({paused:true})` registered at `window.__timelines[id]`, built synchronously; `<video>`/`<audio>` playback owned by the framework | M12 |
| Playwright | `chromium.launchPersistentContext(profileDir, {viewport, recordVideo})`, `getByRole` / `getByText`, `boundingBox()`, `innerText('body')` | M3 |
| ctc-onnx aligner | `align(audioPath, lines, spokenWords)` → `data/timing.json` + `data/audio.json` (exists) | M10 |
| ffmpeg / ffprobe | `select='gt(scene,0.3)'`, segment by time, `-r 30 -g 1` re-encode, `loudnorm` two-pass, `ebur128`, `tile` | M2, M3, M13, M16, M17 |
| HeyGen (optional, paid) | avatar generation, ~$1/min | M11, behind the cost gate |

## 2.4 Data models
All in `lib/contracts/types.ts` as Zod schemas, validated on write **and** read (`writeJson` / `readJson`). Existing
(Phase 0): `Brief`, `Deliverable`, `Script`, `Look`, `PlatePlan`, `Plan`, `AssetRef`, `Timing`, `TestResults`, `FORMATS`, `Frame`.
Changes and additions:

| Model | Change |
|---|---|
| `Script.lines[]` | add `delivery: "voiceover" \| "avatar"` (default `"voiceover"`) |
| `PlatePlan` → `ScenePlan` | rename (`plate_id` → `scene_id`); `Plan.visuals_plan.plates` → `scenes` |
| `Brief` | add `product_url?: string`, `avatar?: {source, adapter?, portrait?}` |
| `Steps` (new) | `capture/steps.json`: `{ i, url, action: click\|type\|scroll\|wait, target, value?, expect }[]` |
| `CaptureLog` (new) | `capture/log.json`: per step `{ i, t0, t1, box?, url, failed?, fallback? }` |
| `Doctor` (new) | `~/.video-machine/doctor.json`: tool versions, paths, smoke timings |

Run folder layout: `concept.md, brief.json, input/, capture/, assets.json, research.md, script.json, directions/A|B/,
look/, plan.json, boards/, audio/, data/timing.json, avatar/, index.html, scenes/, out/, test_results.json, report.md,
history/<n>/`. Renders, audio and capture media are gitignored.

## 2.5 Public functions / API
Skills call adapters only through their CLIs (`bun ${CLAUDE_PLUGIN_ROOT}/lib/adapters/<kind>/<name>/cli.ts ...`), which print
one JSON result line to stdout. Interfaces live in `contracts/types.ts`.

| Function | Args | Returns |
|---|---|---|
| `RenderAdapter.supports` | `format` | `{ok, reason?}` |
| `RenderAdapter.lint` / `check` | `runDir` | `Issue[]` (blocking) |
| `RenderAdapter.still` | `runDir, format, t[]` | PNG paths |
| `RenderAdapter.contactSheet` | `runDir, format, perScene` | PNG path |
| `RenderAdapter.render` | `runDir, format, "draft"\|"final", passes?` | MP4 path (passes unsupported → throw) |
| `VoiceAdapter.synth` / `costEstimate` | `lines, voiceId` | WAV path / USD |
| `AlignAdapter.align` | `audioPath, lines, spokenWords?` | `timing.json` path |
| `CaptureAdapter.replay` | `runDir, steps, profile` | `log.json` path |
| `AvatarAdapter.make` / `costEstimate` | `portrait, audioPath` | video path / USD |
| `ExportAdapter.export` | `runDir, deliverable` | path |
| `whereAmI` | `runDir` | next part id |

## 2.6 Operational safeguards
| Concern | Solution |
|---|---|
| HyperFrames freezes silently when a scene uses the clock or randomness | `motion.no_dead_spans` is blocking; `hyperframes check` runs before every render |
| Non-determinism | `render.deterministic`: render sampled frames twice, compare hashes |
| Text under Instagram UI | `layout.safe_area` against `FORMATS.reel.safe` (top 14 %, bottom 20 %, sides 6 %) |
| Reference footage leaking into output | `assets.no_reference_only` blocking |
| Spending money | Paid adapters return `costEstimate` first; sum vs `brief.budget_usd` (default 0) → ask |
| Passwords | Never typed by Claude; persistent profile, creator logs in by hand |
| Plugin updates wipe data | Runs live in the creator's cwd (`./runs/`); models in `~/.video-machine/`; nothing written under `${CLAUDE_PLUGIN_ROOT}` at runtime |
| Orphaned processes on Windows | One subprocess helper with timeout that kills the whole tree (`taskkill /T`) |
| cp1252 pipes on Windows | `PYTHONUTF8=1` for every Python call |
| Young dependency drifting | HyperFrames pinned to an exact version; plans cite versions |
| Privacy | Telemetry off; no `hyperframes feedback`; no secrets in logs |
| Licence | Confirm `@hyperframes/producer` and the SDK licences before publishing |
| Source projects | Each acceptance script re-checks the `video-testing` listing against `tests/phase0/video-testing.before.txt` |
| Toolchain drift (pdoom) | Engine dependencies installed with `--frozen-lockfile` only (a non-frozen install re-resolved three to 0.186.1) |
| Fixtures | `tests/baseline/` and `tests/fixture/` are owned by no builder; the orchestrator changes them only with the user's OK |
| Secrets | API keys only in the workspace `.env`; `.claude/settings.json` denies agents Read/Edit on it. Never paste keys into chat |

## 2.7 Settings
| Name | Type | Default |
|---|---|---|
| `VM_HOME` (env) | path | `~/.video-machine` (models, profiles, doctor.json) |
| `HYPERFRAMES_NO_TELEMETRY` (env) | `"1"` | `"1"`, set by the plugin |
| `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY` (env) | secret | unset (paid adapters disabled) |
| `brief.budget_usd` | number | `0` |
| `brief.formats` | FormatId[] | `["reel"]` |
| `brief.voice` | adapter + voice id | `hf-tts`, `af_heart` |
| `brief.duration_target_s` | [min, max] | `[15, 30]` |
| HyperFrames version | pinned constant | `0.8.143` |
| text-only reading speed | words/s, min s per line | `3`, `1.2` |
| script pacing estimate | words/s | `2.5` |
| auto-fix rounds | number | `3` |
| motion dead span | seconds | `1.5` |
| beat tolerance | frames | `±2` |
| min text size | % of frame height | vertical `3.5`, landscape `2.5` |
| loudness | LUFS / dBTP | `−14 ±1` / `≤ −1` |

## 2.8 Checks
Each check is one file in `lib/checks/`, reads the run folder, and appends to `test_results.json`. "HF" marks checks that
`hyperframes lint` / `check` already cover; the adapter maps their output instead of us reimplementing it.

| id | blocking | how |
|---|---|---|
| `contracts.valid` | yes | every JSON file parses against its schema |
| `plan.coverage` | yes | every script line in exactly one scene; scenes contiguous, in script order |
| `look.directions_differ` | yes (G1→G2) | directions A and B differ in at least two of palette, type, motion, motifs (motion and motifs when `brand` fixes palette or type) |
| `brief.applied` | yes | brand colours/fonts unchanged in `look.json`; logo and pinned assets used; `cta` on the last scene; `must_avoid` absent |
| `render.lint` | yes | HF: `hyperframes lint` + `check` return no errors |
| `render.deterministic` | yes | render 5 random `t` twice, fresh page each time; pixel hashes match |
| `render.seek_safe` | yes | still at `t` after playing from 0 == still at `t` after seeking straight to it |
| `motion.no_dead_spans` | yes | frame difference over the draft; no span > 1.5 s below threshold unless the beat has `hold` |
| `timing.beats_on_cues` | yes | each beat's visual change within ±2 frames of its word |
| `timing.duration` | yes | final duration inside `duration_target_s` |
| `layout.safe_area` | yes | every text box inside the format's safe area (Instagram UI zones on the reel) |
| `layout.min_text_size` | yes on reel | text height ≥ 3.5 % of frame height on vertical, 2.5 % on landscape |
| `layout.no_overflow` | yes | HF: no text box leaves the frame or overlaps another |
| `assets.no_reference_only` | yes | no `reference_only` path (e.g. the navigation video) in any scene or render input |
| `assets.licensed` | yes | every used asset and font has a non-empty `license` |
| `audio.loudness` | yes on final | integrated −14 LUFS ±1, true peak ≤ −1 dBTP (ffmpeg `ebur128`) |
| `captions.match` | yes if burned | caption text equals the script; each word visible during its spoken time |
| `deliver.files` | yes on final | every deliverable exists, plays (ffprobe), right size, fps and duration |
| `intent.judge` | no | a vision model scores the contact sheet against each scene's `intent` and `beats`; ≤ 3 becomes an annotation |
| `look.judge` | no | same, against `LOOK.md` |

Model-judged checks are never blocking. They feed annotations; the creator decides.

# Part 3 — Coding standard (summary; full rules in AGENT_PROMPT.md)
TypeScript on the pinned bun; Python only where a model wrapper needs it, run by `uv`. TDD with unit tests beside the code
(`*.test.ts`, external tools faked); acceptance scripts `tests/phase<N>.ts` use the real tools and are run by the
orchestrator. Functions over classes; Zod for every file boundary; env read only in `lib/core/config.ts`; one error base
class; every subprocess through `lib/core/sh.ts`; adapters never import each other; skills call adapters only through
CLIs; scenes deterministic in time; ponytail (`ponytail:` comments on deliberate limits).

# Part 4 — Folder structure
Target layout. Phase 1 moves today's `.claude/skills/video-machine/{contracts,adapters}` into `lib/`.

```
video-machine/                      # repo = the plugin and its own marketplace
  .claude-plugin/
    plugin.json                     # plugin manifest
    marketplace.json                # makes the repo installable with /plugin marketplace add
  skills/                           # SHIPPED skills (the product's procedure)
    make-reel/SKILL.md              # M1–M17 procedure, < 150 lines, points to the others
    setup/SKILL.md                  # M0
    capture/SKILL.md                # M2–M4
    storyboard/SKILL.md             # M7–M8
    review/SKILL.md                 # M15 routing rules
  agents/                           # SHIPPED subagents
    scene-writer.md                 # M12
    avatar-director.md              # M11
  hooks/hooks.json                  # SHIPPED hook: validate runs/**/*.json on write
  lib/
    contracts/types.ts              # M18 schemas + adapter interfaces
    core/                           # config.ts, errors.ts, sh.ts, timing lookup, run-folder helpers
    adapters/
      render/hyperframes/           # primary renderer (Phase 6)
      render/pdoom/                 # Phase 0, kept
      align/ctc-onnx/               # Phase 0
      voice/hf-tts/  voice/supplied/
      capture/playwright/
      avatar/<name>/
      export/srt/  export/ae/
    checks/                         # one file per check HyperFrames doesn't already do
  looks/                            # style library, a starting point only
  engine/                           # pdoom copy (used only by render/pdoom)
  tests/                            # unit tests live beside the code as *.test.ts
    fixture/  baseline/             # Phase 0 fixtures (orchestrator-owned)
    phase0.ts  phase<N>.ts          # acceptance tests, one per phase
  docs/
    BLUEPRINT.md  AGENT_PROMPT.md
    superpowers/plans/phase-N-<name>.md
  .claude/                          # DEV-ONLY team (not shipped)
    agents/  hooks/path_guard.py  settings.json
  CONCEPT-TEMPLATE.md  HANDOFF.md  package.json  pyproject.toml
```

# Part 5 — Feature list
Each phase gets one plan in `docs/superpowers/plans/`. Each task is self-contained for a subagent. A phase is done when its
acceptance test (`tests/phase<N>.ts`) passes and the user has seen the visible output.

### Phase 1 — Foundation and spike (Step 0)
- Move contracts and adapters to `lib/`; fix imports and the align adapter's workspace path; Phase 0 test still passes.
- Plugin manifest + marketplace; `claude --plugin-dir .` loads a placeholder `make-reel` skill.
- Tooling (old "Phase 0 finish"): `tsconfig.json`, Biome, ruff, `bun run lint` / `bun run format` scripts, `bun test` with one unit test.
- pdoom canvas default (old "Phase 0 finish"): software Canvas2D by default in `render/pdoom`; make `tests/phase0.ts` match.
- `lib/core`: `config.ts` (only env reader), `errors.ts` (`VideoMachineError` + subclasses), `sh.ts` (timeout + Windows tree kill).
- Contract changes from 2.4 (`delivery`, `ScenePlan` rename, `product_url`, `Steps`, `CaptureLog`, `Doctor`).
- Probe HyperFrames 0.8.143: confirm every command in 2.3, plus transparent-background rendering. Results go into 2.3.
- **Spike (orchestrator + user, throwaway, `runs/spike-*`):** one 15 s reel by hand from real inputs with HyperFrames directly. Findings update this blueprint.

### Phase 2 — Setup and intake (M0, M1)
- `setup` skill + `doctor` CLI (install via winget/brew/apt with approval, pinned HyperFrames, `doctor`, `skills`, aligner model fetch with sha256, smoke test).
- `make-reel` intake: run folder, verbatim inputs, ≤ 3 blocking questions with defaults, `brief.json`.
- `whereAmI` + `/video-machine:status`.

### Phase 3 — Capture (M2, M3, M4)
- Video reader: ffmpeg scene frames + 2 s fallback frames, numbered contact sheet, `hyperframes transcribe`, vision → `steps.json`.
- Playwright replay with persistent profile, per-step shots / focus crops / page text / log, clip split at 30 fps all-intra, fallback to nav-video frames.
- Assets panel page + `assets.json`; drop/pin marks applied.
- Acceptance: a public product's navigation video → steps, clips and panel, with failed steps named. Then one logged-in product.

### Phase 4 — Write and design (M5, M6, M7, M8)
- Research (page text first, `hyperframes capture` brand tokens, web check), script with `spoken` / `on_screen` / `delivery`.
- Two look directions (differ in ≥ 2 of palette, type, motion, motifs) + `look.directions_differ`.
- Storyboard: `plan.json` with coverage check, scenes drafted with estimated timing, snapshots → board page; G2 notes → `overrides`.
- Add a `visual-reviewer` agent (from the ui-reviewer template) for boards and contact sheets.

### Phase 5 — Voice and timing (M9, M10)
- `voice/hf-tts` adapter (per-line synth, 0.25 s gaps, 48 kHz), `voice/supplied`; cost gate plumbing.
- Wire the existing ctc-onnx aligner to the run folder; low-confidence lines fail loudly by name.
- Acceptance: changing one script word re-times every scene.

### Phase 6 — Scenes, render, checks (M12, M13, M14)
- `scene-writer` agent + HyperFrames composition rules; root `index.html`; per-format CSS variables; labels from timing.
- `render/hyperframes` adapter: lint, check, snapshot sheet, draft render.
- Checks HyperFrames lacks: safe area, min text size, beats on cues, no dead spans, determinism, reference-only, captions match; 3-round auto-fix.
- Acceptance: concept → draft reel MP4 with no scene edited by hand; a deliberately broken scene fails exactly the right checks.

### Phase 7 — Revise, sound, deliver (M15, M16, M17)
- Feedback router + `history/` snapshots + `input_hash` partial regeneration.
- Music bed with ducking, burned captions, −14 LUFS / −1 dBTP mix, SRT.
- Export: MP4, SRT, AE package (layers if transparent rendering works, else flattened scenes) + `build_comp.jsx`.
- Acceptance: "make scene 3 slower" touches only scene 3; every deliverable passes ffprobe checks.

### Phase 8 — Avatar (M11)
- `avatar-director` agent; one local audio-driven adapter (pick after a GPU test on the reference laptop), `supplied`, HeyGen behind the cost gate.
- `hyperframes remove-background` → transparent `.webm`; placement per scene.

### Phase 9 — Polish
- README, install guide, marketplace publish, licence check, end-to-end run on a second machine.

### Future (not v1)
16:9 YouTube format, Chatterbox voice-clone adapter, vlog / raw-footage editing, square and portrait-feed formats,
second art-direction pack library growth, HeyGen Cloud rendering.
