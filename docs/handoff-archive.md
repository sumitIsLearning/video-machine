# Handoff archive

Older HANDOFF.md sections, newest first. Moved here so each session loads less.

## Earlier (2026-10-14, later): moved to a new Mac, set up and verified; resume Task 6 fix round 2

**Machine:** the repo is now at `/Users/sumitchakraborty/work-data/video-machine` (macOS, arm64). It was a fresh clone of
`origin/master` (`8f8e5d0`). Earlier work happened on Windows (`/c/Work-data/video-machine`).
- Installed: `brew install uv ffmpeg` (uv 0.13.1, ffmpeg 9.0.2); `npm install`, then
  `node_modules/.bin/bun install --frozen-lockfile` (bun 1.4.2); `bun lib/setup/cli.ts install` (venv, aligner model
  fetched with sha256, Chrome Headless Shell, Parakeet). No manual model copy was needed.
- `bun lib/setup/cli.ts doctor`: all green. `smoke`: render 28.6 s, tts 41.7 s, align 1 s.
- `bun test`: 446 pass, 8 skip (the Windows-only tests), 0 fail. `npm run lint` (with `node_modules/.bin` on PATH): clean.
  The WIP commit `7b5763c` passes on this machine.
- **New, uncommitted: `.python-version` = `3.14`.** Homebrew's uv picked CPython 3.15, and onnxruntime 1.30.0 has no
  cp315 wheel, so `uv sync` failed. `UV_PYTHON` is stripped from toolEnv on purpose, so the pin must live in the repo.
  Waiting on the user's OK to commit it (it affects every new machine).

**Ledger:** the user copied it to `.superpowers/sdd/` (Phase 1 and Phase 3 only; the Phase 2 ledger was not copied, and
that phase is merged). The `plan-path` files were rewritten from `/c/Work-data/...` to this Mac's path. The Phase 3 ledger
matches this file and `git log`.

**Matt Pocock skills:** the plugin `mattpocock-skills@claude-plugins-official` v1.2.3 was installed and enabled at user
scope during this session. It loads only in a new session. Open question for the user: use any of its skills (e.g.
`tdd`, `code-review`) inside the repo's builder/reviewer flow, or keep the repo's own agents. Until decided, use the
repo's flow.

**Next:** Task 6 fix round 2, unchanged from the section below (moveFile must not lose `log.json`; URL guard before
the before-shot), then the scoped re-review and the `feat(capture): Playwright replay (P3 Task 6, M3)` commit.

## Earlier (2026-10-14): Phase 3 paused mid-execution, at Task 6 fix round 2 (user asked to stop and hand off)

**Where things are**
- `master` is fast-forwarded to `phase-3-research-sources` (user request 2026-10-14). The phase is **not finished**, and
  `master` carries Phase 3 Tasks 1–5 plus Task 6 work in progress.
- **Pushed** to the private GitHub repo https://github.com/sumitIsLearning/video-machine (`origin`, `master` tracks
  `origin/master`; created 2026-10-14 with `gh repo create`, user request). Only `master` is pushed; the local phase
  branches are not.
- Plan: `docs/superpowers/plans/phase-3-research-sources.md` (Tasks 1–10, rulings R1–R11, user-approved; BLUEPRINT
  edits in `87c3a8a`).
- Ledger with every ruling and every deferred minor: `.superpowers/sdd/phase-3-research-sources/progress.md`. It is
  git-ignored and local only. Read it first; trust it plus `git log` over memory.

**Task status**

| Task | State |
|---|---|
| 1 contracts | done, reviewed (`fe900b8`) |
| 2 page capture + research.md | done, reviewed (`c602f1d`) |
| 3 Openverse adapter | done, reviewed (`cef4dce`) |
| 4 research CLI | done, reviewed (`84e0a2d`) |
| 5 nav-video reader + steps | done, reviewed (`f4aefb1`). Nav folder is `capture/nav/<slug>-<hash>`, not `capture/nav/nav`. |
| 6 Playwright replay | **in progress**: fix round 1 done and live-verified; Opus re-review found 2 new 🟠; **fix round 2 was dispatched but the builder was cut off**. Its partial edits are committed as a WIP commit (tests 454 pass, lint clean) and are **unreviewed**. |
| 7 capture CLI + setup capture_browser | not started (also adds `'capture_browser'` to `DOCTOR_TOOLS`) |
| 8 asset pool + panel + assets CLI | not started (must skip `capture/shots/*-before.png`) |
| 9 skills research/capture/make-video | not started |
| 10 acceptance `tests/phase3.ts` | not started (includes a replay clip-alignment check) |

**Resume Task 6 here.** Fix round 2 must close the two 🟠 from the Opus re-review, and a fresh builder should check both
against the WIP commit:
1. The `moveFile` copy fallback still throws when the locked source can't be removed, so `log.json` is lost. A move
   failure must not lose the log.
2. There is no URL guard before the before-shot. The private-host and link-local check must also run before
   `shots/<i>-before.png` is taken.

Then do a scoped re-review, and commit as `feat(capture): Playwright replay (P3 Task 6, M3)`.

**Then:** Tasks 7–10, one builder each (`Read docs/AGENT_PROMPT.md, then implement Task N from <plan>`), spec-reviewer,
code-reviewer, fix rounds. Then `bun tests/phase3.ts`, the Opus whole-branch review, and the manual logged-in check with
the user (R11).

## Earlier (2026-10-10): Phase 2 merged; concept-only spike done; Phase 3 plan next

- `master` was fast-forwarded to `phase-2-setup-intake` (`5bb3d8f`), with the user's "keep going". Nothing has been pushed.
- Spike (R10): `runs/spike-concept/` (git-ignored).
  - `uv-reel.mp4` is a 10.9 s reel from a concept only, rendered in 23 s.
  - The findings are in `runs/spike-concept/FINDINGS.md` (12 items).
  - The ones for the blueprint:
    - word lookup must be scoped by line;
    - a text-fit helper is needed;
    - `check` also needs `--no-browser-gpu`;
    - captured fonts are unicode-range subsets, so they get `license: unknown` until resolved;
    - Openverse is the v1 free-media source (no key; Pexels only with a creator key).
- Waiting on the user: approval of those blueprint additions. Then write `docs/superpowers/plans/phase-3-*.md`.

## Phase 2 done (2026-10-10): branch `phase-2-setup-intake`, awaiting the user's merge OK

- 18 commits on `phase-2-setup-intake` (base `363c229`, head after this HANDOFF commit).
  - `bun tests/phase2.ts` 11/11 on a fresh `VM_HOME`.
  - `bun test` 218 pass, lint clean.
  - Opus whole-branch review: APPROVE after the Task 10/10b fix wave.
- **What exists now:**
  - `lib/setup/` (M0): `doctor` (10 tools, read-only), idempotent `install venv|model|browser|parakeet`, `smoke`
    (render 21 s, tts 6 s, align 1 s), all behind `lib/setup/cli.ts`.
  - `lib/run/` (M1): `new` / `import` / `brief` / `where` / `status` in `lib/run/cli.ts`.
  - Skills: `setup`, `make-video` (intake, stops after M1), `status`. `/video-machine:status` was checked in a real
    `claude --plugin-dir .` session.
- **On this machine:** `~/.video-machine/` holds `models/` (copied from the dev model), `venv/` and `doctor.json`.
  `analysis/models/*.onnx` in the repo is a dev leftover; align reads the vmHome model.
- **Rulings:** the phase-summary list is in the session; the full ledger is
  `.superpowers/sdd/phase-2-setup-intake/progress.md` (git-ignored). The ones that change behaviour:
  - JS deps go in the plugin root (user ruling R1).
  - `listRuns` returns `{run_id, error}` for a broken run.
  - M3 is needed when the brief has `nav_video` + `product_url`.
  - Audio markers must be non-empty.
  - Realpath containment is checked at intake.
  - `sh` takes `stdin`.
  - Setup asks once with all download sizes.
  - Skills use `runs/<run_id>`.
- **Carry to the Phase 3 plan:**
  - Run the concept-only spike first (R10).
  - Probe WebSearch/WebFetch in a skill, and Openverse vs Pexels.
  - File openers re-check containment.
  - M3 must handle a missing `steps.json`.
- **Carry to the Phase 4 plan:** gate approvals (G1–G4) are not recorded; a resumed session could pass a gate (R8).
- **Deferred minors** (accepted by the Opus triage, details in the ledger): the `doctor.json` "rewritten" line is printed
  before the write, plus small untested branches. Download sizes for the venv (115 MB), Chrome (up to 500 MB) and Kokoro
  (340 MB) were measured in `~/.cache` on the reference laptop.

## Before Phase 2 ran (2026-10-10)

- Phase 1 is merged: `master` == `phase-1-foundation` at `363c229`.
- Plan: `docs/superpowers/plans/phase-2-setup-intake.md` (9 tasks + pre-step; rulings R1–R12).
  - R1 approved: JS deps (bun + zod, 90 MB, --production) go into the plugin root at setup time.
  - BLUEPRINT edits (2.3, 2.6, Part 4, Part 5) approved and applied.
- Probes are in `runs/spike-setup/` (git-ignored):
  - The aligner model is byte-identical to `Xenova/wav2vec2-base-960h@a19f851` `onnx/model_quantized.onnx`.
  - uv venv via `UV_PROJECT_ENVIRONMENT` writes nothing in the repo; `uv sync --frozen --no-dev --check` exits 1
    when the venv is missing or outdated.
  - kokoro-onnx 0.6.1 + soundfile run on Python 3.14.4; `hyperframes tts` through the venv python takes 7 s.
  - Blank init + 10 s draft render takes 25 s; `browser ensure` / `models install parakeet --json` are idempotent.
  - `npx bun@1.4.2 install --frozen-lockfile` takes 5 s / 204 MB; bun honours `NODE_PATH` only with `--no-install`.
- The Phase 1 concept-only spike was never run; it moves to before the Phase 3 plan (R10).

## Phase 1 done (2026-10-10): branch `phase-1-foundation`, merged to master

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
