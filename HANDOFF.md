# Handoff

## Phase 1 done (2026-10-10): branch `phase-1-foundation`, awaiting the user's merge OK

- 17 commits on `phase-1-foundation` (master at `a4d1e8b`). `bun tests/phase1.ts` 7/7, `bun test` 79 pass, lint clean
  (`biome --error-on-warnings`), phase0 2/2. Opus whole-branch review: APPROVE after Task 10 fix wave.
- **pdoom retired** (user ruling): `engine/`, `render/pdoom`, `tests/baseline/`, pdoom fixture scenes deleted. The aligner's
  Python + model now live in `lib/adapters/align/ctc-onnx/analysis/` (model git-ignored, copy by hand on a new machine).
- **Phase 2 plan must include** (from the Opus review):
  - uv venv at `<vmHome>/venv` (`UV_PROJECT_ENVIRONMENT` in toolEnv) and `uv run --frozen`; nothing written under the
    plugin root at run time (BLUEPRINT 2.6).
  - Aligner model under `vmHome` (doctor fetches it with sha256), passed to `align.py` (override `align_vo.MODEL`/`VOCAB`),
    existence checked before `uv` starts.
  - `runPath` schema (relative, no `..`, no drive letter or backslash) on every run-folder path field
    (`sources[].path_or_url` for nav_video/file, voice/music path, avatar.portrait, brand logo/fonts, `AssetRef.path`).
  - `InputError` subclass for bad creator inputs (CLI JSON needs a meaningful error name).
- **Phase 3 plan:** resolve `file`/`nav_video` paths inside the run folder when opened.
- **Before Phase 4/5:** the aligner takes `text` + a `spokenWords` map; M10 callers build it from `spoken` (types.ts comment).
- **Before Phase 8:** a paid adapter that needs an API key adds an allowlist to `sh` (it strips `*_KEY` etc.).
- Deferred minors (accepted): POSIX tree-kill untested; taskkill fallback untested; uncapped stdout (text only); an
  exited child whose grandchild holds the pipes waits `timeoutMs` + 2 s; no adapter-imports-adapter scan; check 4
  passes on a report with no `manifest`; `audio/` folder check is case-sensitive; phase0 ignores extra syllables.
- Visual blueprint artifact still shows the v1 pipeline: refresh it.

## Now (2026-10-10): blueprint v1.1, Phase 1 running on branch `phase-1-foundation`

- **User rulings 2026-10-10 (BLUEPRINT v1.1, `e293e48`):** concept is the only required input; everything else is
  `brief.sources[]`; nav video is source material (renders only as a replay fallback); research (WebSearch/WebFetch)
  always runs right after intake; Claude draws / captures / finds its own licensed assets (paid AI media: Future);
  reel built first, contracts format/length-agnostic, long-form 16:9 with chapters is new Phase 9 (Polish → 10);
  shipped skill renamed `make-video`.
- Phase 1 plan updated to match (`a4d1e8b`), approved, executing subagent-driven. Pre-step done (`cfb68a1`).
  Ledger (git-ignored via `.git/info/exclude`): `.superpowers/sdd/phase-1-foundation/progress.md`, trust it + `git log`.
- Visual blueprint artifact (claude.ai) still shows the v1 pipeline: refresh it.
- Spike now starts from a concept only (no nav video needed).

## Session end (2026-10-09): Phase 1 plan awaits the user's review

- **Next session:** the user reviews `docs/superpowers/plans/phase-1-foundation.md`. On approval: orchestrator `git mv` pre-step,
  then Tasks 1-9 subagent-driven (builder -> spec-reviewer -> code-reviewer -> bun test + lint -> commit), then
  `bun tests/phase1.ts`, Opus whole-branch review, ask before merging.
- **Combined test reel (throwaway, git-ignored):** `runs/spike-probe/notes/combined-reel.mp4` (9.3 s, 1080x1920, H.264 + AAC
  48 kHz, rendered in 21 s with `--quality delivery --no-browser-gpu`). Built by hand from: `hyperframes capture https://bun.sh`
  (brand colours, Archivo / Martian Mono fonts, screenshots) -> 3 lines through `hyperframes tts` (Kokoro af_heart, 24 kHz,
  joined with 0.25 s gaps, resampled to 48 kHz) -> `hyperframes transcribe --engine parakeet` (20/20 words right) -> one
  composition in `runs/spike-probe/reel/p/index.html` that looks words up by text (`at('Bun.sh')`), vendored GSAP 3.14.2,
  `<audio>` inside the root -> lint, check (clean), snapshot, render. Learned: chips need `white-space: nowrap`; Parakeet
  word starts run ~0.1-0.15 s early vs the 0.4 s lead-in (the ctc-onnx aligner stays the timing source when a script exists);
  `hyperframes check` flags an image zoomed inside a clipped card only as info.
- **Transcription is swappable:** `hyperframes transcribe --engine auto|parakeet|whisper`; Whisper needs a prebuilt
  `whisper-cli` + `HYPERFRAMES_WHISPER_PATH` (no compile). Recorded in BLUEPRINT 1.6 (Language row).
- Spike for real (the user's own product) still needs the user's concept script, navigation video and product URL.

## Earlier (2026-10-09): spec v1 + agent team, Phase 1 next

- The product changed shape: a **Claude Code plugin** that turns a concept script + product navigation video into a reel,
  rendered with **HyperFrames** (not pdoom). Spec: `docs/BLUEPRINT.md` (supersedes video-testing's VIDEO-MACHINE-PROMPT.md).
  Visual version with flowchart and pseudocode: https://claude.ai/artifact/CWKbFBDQDDUtzTjLy7j8nS
- Coding standard for builders: `docs/AGENT_PROMPT.md`.
- Dev team in `.claude/agents/`: `orchestrator` (run with `claude --agent orchestrator`), `lib-builder`, `plugin-builder`,
  `spec-reviewer`, `code-reviewer`. Builders are fenced by `.claude/hooks/path_guard.py` (tested by piping sample tool
  calls into it; a live builder test needs a fresh session, since agents load at session start).
- Next: write `docs/superpowers/plans/phase-1-foundation.md` (move to `lib/`, plugin manifest, tooling, core helpers,
  contract changes, HyperFrames 0.8.143 probe), and run the spike once the user supplies a concept, navigation video and URL.
- User rulings 2026-10-09 (BLUEPRINT 1.6): two directions with three boards each (hook, product scene, ending); telemetry off
  inside Video Machine (machine-wide HyperFrames setting untouched, revisit later). HyperFrames 0.8.143 installed in `runs/spike-probe/`.
- HyperFrames probe done 2026-10-09: every 2.3 command run on 0.8.143. Findings: `runs/spike-probe/notes/FINDINGS.md`
  (git-ignored). Blueprint 2.3/2.6/2.7 updated with the user's yes (English only, Parakeet, software rendering, vendored GSAP).
- Phase 1 plan written: `docs/superpowers/plans/phase-1-foundation.md` (9 tasks + orchestrator `git mv` pre-step, rulings R1-R8
  listed in the plan). Waiting for the user's review; then run it subagent-driven. Spike needs the user's concept, nav video, URL.
  Probe spikes (git-ignored): `runs/spike-probe` (HyperFrames), `runs/spike-tooling` (TS 7.0.2, Biome 2.5.15, tree kill),
  `runs/spike-plugin` (manifest validation).
- State checked 2026-10-09: `master` clean at 48fd032; HyperFrames not installed yet (0.8.143 is also npm latest);
  stale worktree `.claude/worktrees/who-you-are-536e8c` has no commits of its own (remove with the user's OK).

## Phase 0 notes (below)

## Where things are (end of Phase 0, 2026-10-05)

- `engine/`: copy of video-testing/app (engine, render script, fonts) + `analysis/*.py` + ONNX model (gitignored, copied by hand).
  - The only engine edit: `src/engine/gl.ts` W/H come from `?w=&h=` (default 1920x1080).
  - Harness edits: `vite.config.ts` (serves a run folder from `VM_RUN`, maps plates' `../engine/*` imports, dedupes three),
    `src/main.ts` (`@run/timeline`, canvas CSS size from W/H), `scripts/render.ts` (`--w/--h`, `--strict`,
    `sheet --per-plate N`, private server unless `--url`, kills vite's process tree on Windows, `EXTRA_CHROME_ARGS`).
- `.claude/skills/video-machine/`
  - `contracts/types.ts`: Zod schemas for every §3 file + `Timing`, adapter interfaces, `readJson`/`writeJson` (validate both ways).
  - `adapters/render/pdoom/`: `still`, `contactSheet`, `render` (draft/final), `supports`. `scaffold`/`plateApi`/`lint` throw "Phase 1/2".
  - `adapters/align/ctc-onnx/`: `align(audio, lines, spokenWords)` → `<run>/data/timing.json` + `audio.json`. Drives align_vo.py and audio_vo.py without editing them.
- `tests/baseline/`: the 5 stills rendered from video-testing. `tests/fixture/`: the 9 plates, timeline, audio, data, `spoken.json`.
- `tests/phase0.ts`: the Phase 0 acceptance test. `tests/phase0/video-testing.before.txt`: listing taken before anything ran.

## How to run

- Always use the pinned bun: `node_modules/.bin/bun` (root `package.json`, bun 1.4.2). Install: `node_modules/.bin/bun install` in root, then
  `../node_modules/.bin/bun install --frozen-lockfile` in `engine/` (this reproduces video-testing's exact three/vite versions).
- Python: `uv run --project <workspace> python ...` (root `pyproject.toml`, onnxruntime + numpy). `python -m uv` is broken on this machine; plain `uv` works.
- Test: `node_modules/.bin/bun tests/phase0.ts`.

## What broke, and what was learned

- Global bun 1.3.5 cannot launch Chrome through Playwright on Windows (pipe timeout), and ignores the engine's lockfile v2. Bun 1.4.2 fixes both.
- `render.ts` in video-testing orphans vite on Windows (`proc.kill()` on `bunx` leaves node running). Fixed in the copy with `taskkill /T`.
- Python prints `→` through a cp1252 pipe and crashes: the align adapter sets `PYTHONUTF8=1`.
- **Chrome's GPU-accelerated Canvas2D is not deterministic.** Hairline text (the ghost word "After" at t=5) rasterizes one of two ways
  depending on GPU-process cache state, which depends on what else was drawn first (other plates initialise in parallel; other pages
  in the same browser). Measured over 4 fresh renders: t=5 gave the baseline image 2/4 times; the other 4 baseline times 4/4.
  With `--disable-accelerated-2d-canvas` every frame is identical across runs, but differs from the baseline (PSNR 45-65 dB; glyph
  antialiasing only, not visible at 1:1). This matters for non-negotiable #1 and for `render.deterministic` in Phase 3.

## Next (superseded)

- Canvas mode was decided (BLUEPRINT 1.6: software Canvas2D default in `render/pdoom`); making `tests/phase0.ts` match is a
  Phase 1 task. The old Phase 1 list (plates, `looks/plotter`, `plateApi()`) is replaced by BLUEPRINT Part 5. See "Now" at the top.
