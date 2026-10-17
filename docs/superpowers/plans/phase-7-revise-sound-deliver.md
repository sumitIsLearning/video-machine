# Phase 7 — Revise, Sound, Deliver Implementation Plan

**Goal:** After G3 the creator can give feedback, and only what the feedback touches is made again: `review` snapshots
the run's text files into `history/<n>/` and clears the outputs downstream of the change (M15). Scenes whose plan
`input_hash` changed or that got feedback are the only ones the `scene-writer` rewrites. M16 mixes the voice with an
optional music bed (ducked under the voice) to −14 LUFS / −1 dBTP in `audio/mix.wav`. M17 renders the final video,
muxes the mix, writes the SRT and, when asked, an After Effects package, checks every file with ffprobe and ebur128,
and only then publishes `out/deliver/`.

**Architecture:**
- **Core:** `lib/core/media.ts` (`loudnessOf`, `probeMedia`), `sceneFrames` in `lib/core/scene-times.ts`,
  `deliverStageOf` in `lib/core/paths.ts`.
- **Checks** `lib/checks/`: `report.ts` (`writeReport`, `mergeChecks`, moved out of `lib/scenes/check.ts`),
  `audio.ts` (`audio.loudness`), `deliver.ts` (`deliver.files`), `contracts.ts` (`contracts.valid`).
- **Adapters:** `export/srt` (`srtOf`, `srtExport`), `export/ae` (`buildCompJsx`, `aeExport`); the `hyperframes`
  render adapter learns `container: 'mov'`.
- **Part folders:** `lib/review/` (M15: `review`, CLI `snapshot`), `lib/deliver/` (M16 `mixSound`, M17 `deliver`,
  CLI `mix`, `export`), `lib/scenes/todo.ts` (`scenesTodo`, `markDone`; CLI `todo`, `done`; `build` refuses while
  scenes are still to write).
- **Shipped:** `skills/review/SKILL.md` (M15 routing), `skills/deliver/SKILL.md` (M16–M17 + G4), `skills/scenes`
  step 1 uses `todo`/`done`, `agents/scene-writer.md` reads the feedback note, `make-video` routes M16/M17.

**Tech stack (probed 2026-10-17 on the reference Mac):**
- **ffmpeg 9.0.2.** Filters present: `sidechaincompress`, `loudnorm`, `ebur128`, `amix`, `afade`, `apad`, `atrim`,
  `aresample`. **No `subtitles`/`ass` filter (no libass)**, so captions can't be burned by ffmpeg; burned captions
  are what the scenes draw (Phase 6 R12). Encoders: `libx264`, `aac`, `prores_ks`.
- Ducked mix (probe, 10 s voice + 14 s pink-noise music):
  `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:T,afade=t=in:d=0.5,afade=t=out:st=T-1:d=1,volume=-12dB[m];[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=T,asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[d];[v][d]amix=inputs=2:normalize=0[mix]`
  with `-stream_loop -1` on the music input.
- Two-pass loudnorm: pass 1 `-af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -` prints a JSON block on
  **stderr** (`input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset`, strings). Pass 2
  `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true`
  → −13.9 LUFS. After `-c:v copy -c:a aac -b:a 192k` mux into an MP4: still **−13.9 LUFS, −9.7 dBTP**.
- `ffmpeg -hide_banner -nostats -i f -af ebur128=peak=true -f null -` ends stderr with a `Summary:` block:
  `I:         -13.9 LUFS` (under "Integrated loudness") and `Peak:       -9.7 dBFS` (under "True peak").
- `ffprobe -v error -show_entries stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,sample_rate,channels:format=duration -of json f`
  → `{streams:[{codec_type:"video",codec_name:"h264",width:1080,height:1920,r_frame_rate:"30/1",…},{codec_type:"audio",codec_name:"aac",sample_rate:"48000",channels:2,…}],format:{duration:"11.000000"}}`.
- ProRes 4444 MOV cut per scene: `ffmpeg -v error -y -ss 2.000000 -i full.mov -frames:v 45 -c copy -an cut.mov` is
  frame-exact (45 frames, `prores`, profile `4444`).
- **HyperFrames 0.8.143** `render … --format mov` writes ProRes 4444 with alpha (`--quality` is ignored for MOV);
  blueprint 2.3 already records alpha working. `--crf`/`--video-bitrate` don't apply to MOV.

**Spec:** `docs/BLUEPRINT.md`: Part 5 Phase 7; 2.1 (M15 routing); 2.4 (run folder); 2.5 (`RenderAdapter`,
`ExportAdapter`); 2.6; 2.7 (loudness); 2.8 (`audio.loudness`, `deliver.files`, `contracts.valid`).

## Global Constraints

- Call bun as `node_modules/.bin/bun`. Only `lib/core/sh.ts` spawns processes; tests pass a fake `deps.sh`.
- Import direction: part folders (`lib/review`, `lib/deliver`, `lib/scenes`) → `lib/checks`, `lib/adapters` →
  `lib/core` → `lib/contracts`. Adapters never import each other; part folders never import each other.
- Run-folder JSON only through `writeJson` / `readJson`; run paths from JSON only through `runFileOf`.
- Nothing half-made may look done: `audio/mix.wav`, `out/deliver/`, `history/<n>/`, `captions.srt` are written to a
  temp name and renamed. A failed step leaves no output that looks current.
- Media (`audio/`, `out/`, renders) is never copied into `history/`.

## Review Focus

- `review` clears exactly the outputs downstream of its route, never a scene fragment or the voice for a scene route.
- `scenes build` cannot run while a scene is still to write; `done` is the only thing that records a scene's hash.
- `out/deliver/` exists only when every blocking deliver check passed; a failed export leaves `test_results.json`
  byte-identical (M14 stays done).
- Loudness is measured on the delivered MP4, not only on `mix.wav`.

## Rulings made in this plan (orchestrator, 2026-10-17; listed in the phase summary)

User rulings (asked 2026-10-17): **U1** the AE package holds one ProRes 4444 clip per scene (cut from one MOV
render) + mix + SRT + `build_comp.jsx`; layer passes move to Phase 10. **U2** Phase 7 adds `contracts.valid`,
`audio.loudness`, `deliver.files`; `brief.applied`, `intent.judge`, `look.judge` move to Phase 10.

- **R1** `lib/deliver/` holds M16 (`mix.ts`) and M17 (`deliver.ts`); one CLI with `mix` and `export`.
- **R2** Music: `brief.music` `supplied` → that file; else the one `pinned` `audio` asset in `assets.json`; else no
  music (voice only). Two pinned audio assets, or a pinned one with licence `unknown`, → `InputError`. M16 never
  searches the web (`brief.music.source: "adapter"` means the research skill fetched it into the pool and the creator
  pinned it). Cost if wrong: one function.
- **R3** Mix: 48 kHz stereo, length = the reel's total (last scene end, from `sceneTimes`); music looped, −12 dB, fade
  in 0.5 s and out 1 s, ducked by `sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300`; two-pass
  `loudnorm` I −14, TP −1.5 (0.5 dB margin for AAC), LRA 11, linear. Cost if wrong: constants.
- **R4** The final MP4 = HyperFrames `delivery` render (video only kept) + `audio/mix.wav` muxed as AAC 192 kbps with
  `-c:v copy -shortest -movflags +faststart`.
- **R5** Captions: an MP4's `captions` must be `burned` (= what the scenes draw); `separate` / `none` on an MP4 →
  `UnsupportedError` (Phase 10). The SRT comes from each script line's `text` and the word timing, ≤ 42 characters
  per cue. Cost if wrong: a build variant later.
- **R6** `brief.deliverables` empty → per plan format `{mp4_h264, burned}` + `{srt, separate}`. Kinds other than
  `mp4_h264`, `srt`, `ae_package` → `UnsupportedError`. A deliverable whose format is not in the plan → `InputError`.
- **R7** Exports write to `out/deliver.tmp/<format>/`. When every blocking deliver check passes, `out/deliver/` is
  replaced by it, the deliver checks are merged into `test_results.json` (same `id` + `format` replaced), its
  `output_paths.deliverables` filled, and `report.md` rewritten. Otherwise `out/deliver.tmp/` stays for inspection
  and `test_results.json` is untouched.
- **R8** AE package (U1): `out/deliver/<format>/ae/` = `scenes/NN-<scene_id>.mov` (NN from 01), `audio/mix.wav`,
  `captions.srt` (when the SRT was exported first), `build_comp.jsx` (one comp; each clip at its start; the mix; one
  comp marker per spoken word). Scene frames: `f0 = round(start × fps)`, `n = round((start + duration) × fps) − f0`.
- **R9** `review` routes: `scenes` (one scene, its look or its layout: the listed scenes get the feedback note),
  `plan` (what/when: the skill re-writes the plan, its `changed` scenes become to-do through the hash; a new look
  goes this way too), `words` (script: the skill re-writes script and plan, then M9 onward). Each route first copies
  the run's text files to `history/<n>/` with `feedback.json`, then deletes:
  all routes `build/`, `out/drafts/`, `out/sheets/`, `out/final/`, `out/deliver/`, `out/deliver.tmp/`,
  `test_results.json`, `report.md`; `plan` and `words` also `audio/mix.wav`; `words` also `audio/vo.wav`,
  `data/timing.json`. Cost if wrong: one table.
- **R10** Partial regeneration: `scenes/hashes.json` (`{scene_id: input_hash}`) records the plan hash each fragment
  was written for; only `scenes done` writes it. `scenes/redo.json` (`{scene_id: note}`) holds feedback; `done`
  removes a scene's note. To-do = missing fragment (`new`) ∪ a note (`feedback`) ∪ a recorded hash that differs from
  the plan (`changed`). A fragment with no recorded hash counts as current (Phase 6 runs). `build` throws
  `InputError` while to-do is not empty.
- **R11** `contracts.valid` joins the M14 checks (first in the list). Files checked when present: `brief.json`,
  `script.json`, `plan.json`, `assets.json`, `data/timing.json`, `capture/steps.json`, `capture/log.json`,
  `look/look.json`, `directions/A/look.json`, `directions/B/look.json`.
- **R12** Music beats stay unsupported (`on_beat`, `beat:N` keep throwing): `timing_source: "music"` is not in this
  phase.

### Orchestrator pre-step (before Task 1, not a builder task)

Update `docs/BLUEPRINT.md`: 2.1 diagram `M12 … ► index.html, scenes/*.html` → `scenes/<id>.html, build/<format>/`;
2.4 run folder: add `scenes/hashes.json, scenes/redo.json`, `out/final/`, `out/deliver/<format>/`, `history/<n>/`
(text files + `feedback.json`, no media) (R9, R10); 2.5 `RenderAdapter.render` gains `container?: "mp4" | "mov"`;
2.7 add rows "music bed | dB, duck | `−12`, sidechain 0.05 / 8:1 / 20 ms / 300 ms" and "loudnorm target | TP |
`−1.5` dBTP (check stays ≤ −1)" and "SRT cue | chars | `42`" (R3, R5); Phase 7 bullets: AE package = per-scene
ProRes 4444 clips (U1), burned captions = drawn by scenes (R5); Phase 10: layer passes, `brief.applied`, the two
judges, MP4 without burned captions (U1, U2, R5). Commit `docs(blueprint): Phase 7 rulings`.

---

### Task 1: Report and results merge move to `lib/checks/report.ts`

**Agent:** lib-builder

**Read first:** `lib/scenes/check.ts:282-306` (`lineOf`, `writeReport`), `lib/scenes/check.ts:1-35` (imports),
`lib/contracts/types.ts:443-458` (`CheckResultSchema`).

**Files:** Create `lib/checks/report.ts`, `lib/checks/report.test.ts`. Modify `lib/scenes/check.ts` (delete
`lineOf` and `writeReport`, import `writeReport` from `../checks/report`; drop imports that become unused).

**Tests first:** `lib/checks/report.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CheckResult } from '../contracts/types';
import { mergeChecks, writeReport } from './report';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-report-'));
  dirs.push(d);
  return d;
};
const result = (id: string, status: CheckResult['status'], format?: CheckResult['format']): CheckResult => ({
  id,
  ...(format ? { format } : {}),
  blocking: true,
  status,
  detail: `${id} ${status}`,
  annotations: [],
});

test('writeReport lists blocking failures first, then warnings, then the passed checks', () => {
  const run = tmp();
  writeReport(
    run,
    [
      result('a.pass', 'pass'),
      { ...result('b.warn', 'fail'), blocking: false },
      {
        ...result('c.fail', 'fail', 'reel'),
        annotations: [{ scene_id: 's1', t: 1.5, problem: 'p', suggested_fix: 'f' }],
      },
    ],
    1,
  );
  const text = readFileSync(path.join(run, 'report.md'), 'utf8');
  expect(text.startsWith('# Checks: 1 blocking failed\n')).toBe(true);
  expect(text.indexOf('## c.fail (reel)')).toBeLessThan(text.indexOf('## b.warn'));
  expect(text).toContain('- scene s1 at 1.5 s: p → f');
  expect(text).toContain('- b.warn fail');
  expect(text).toContain('## Passed\n- a.pass');
  expect(readdirSync(run)).toEqual(['report.md']);
});

test('mergeChecks replaces a check with the same id and format in place and appends new ones', () => {
  const merged = mergeChecks(
    [result('x', 'fail', 'reel'), result('x', 'pass', 'square'), result('y', 'pass')],
    [result('x', 'pass', 'reel'), result('z', 'pass')],
  );
  expect(merged.map((c) => `${c.id}/${c.format ?? '-'}/${c.status}`)).toEqual([
    'x/reel/pass',
    'x/square/pass',
    'y/-/pass',
    'z/-/pass',
  ]);
});
```

**Implementation notes:**
- Move `lineOf` and `writeReport` verbatim (same output); export `writeReport(runDir, checks, blocking): void`.
- `mergeChecks(prev: CheckResult[], next: CheckResult[]): CheckResult[]`: key = `id` + `format ?? ''`; a `next`
  check with a key in `prev` replaces it at its position; the rest of `next` are appended in order. Pure, new array.
- `lib/scenes/check.ts` behaviour is unchanged; its existing tests must pass untouched.

**Done when:** `sh .claude/tools/check.sh lib/checks lib/scenes` passes.

---

### Task 2: Media probes `lib/core/media.ts`

**Agent:** lib-builder

**Read first:** `lib/core/deps.ts` (whole, 11 lines), `lib/core/sh.ts:4-14` (`Sh`, `ShOptions`),
`lib/core/errors.ts:20-35` (`ToolError`), `lib/adapters/render/hyperframes/index.test.ts:31-45` (`fakeDeps` pattern).

**Files:** Create `lib/core/media.ts`, `lib/core/media.test.ts`.

**Tests first:** `lib/core/media.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { loadConfig } from './config';
import type { Deps } from './deps';
import { ToolError } from './errors';
import { loudnessOf, probeMedia } from './media';

const fakeDeps = (r: { code?: number; stdout?: string; stderr?: string }) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      const code = r.code ?? 0;
      if (code !== 0 && !opts?.allowFail) throw new ToolError({ cmd, code, stderr: r.stderr ?? '' });
      return { code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
  return { deps, calls };
};

const EBUR = `[Parsed_ebur128_0 @ 0x1] t: 10.9 TARGET:-23 LUFS M: -14.0 S: -13.9 I: -20.0 LUFS LRA: 2.6 LU TPK: -9.8 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -13.9 LUFS
    Threshold: -25.4 LUFS

  Loudness range:
    LRA:         2.6 LU
    Threshold: -35.2 LUFS

  True peak:
    Peak:       -9.7 dBFS
`;

test('loudnessOf reads integrated loudness and true peak from the ebur128 summary', async () => {
  const { deps, calls } = fakeDeps({ stderr: EBUR });
  expect(await loudnessOf(deps, '/r/a.mp4')).toEqual({ i: -13.9, tp: -9.7 });
  expect(calls[0]).toEqual([
    'ffmpeg', '-hide_banner', '-nostats', '-i', '/r/a.mp4', '-af', 'ebur128=peak=true', '-f', 'null', '-',
  ]);
});

test('loudnessOf gives -Infinity for the true peak of silence', async () => {
  const { deps } = fakeDeps({ stderr: EBUR.replace('-13.9 LUFS', '-70.0 LUFS').replace('-9.7 dBFS', '-inf dBFS') });
  expect(await loudnessOf(deps, '/r/a.wav')).toEqual({ i: -70, tp: -Infinity });
});

test('loudnessOf throws ToolError when there is no summary', async () => {
  const { deps } = fakeDeps({ stderr: 'nothing' });
  await expect(loudnessOf(deps, '/r/a.wav')).rejects.toThrow(ToolError);
});

test('probeMedia maps the video, audio and subtitle streams and the duration', async () => {
  const stdout = JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, r_frame_rate: '0/0' },
      { codec_type: 'subtitle', codec_name: 'subrip' },
    ],
    format: { duration: '11.000000' },
  });
  const { deps, calls } = fakeDeps({ stdout });
  const p = await probeMedia(deps, '/r/a.mp4');
  expect(p?.duration).toBe(11);
  expect(p?.video).toEqual({ codec: 'h264', profile: 'High', w: 1080, h: 1920, fps: 30000 / 1001, pix_fmt: 'yuv420p' });
  expect(p?.audio).toEqual({ codec: 'aac', sample_rate: 48000, channels: 2 });
  expect(p?.subtitle).toEqual({ codec: 'subrip' });
  expect(calls[0]?.slice(0, 3)).toEqual(['ffprobe', '-v', 'error']);
  expect(calls[0]?.at(-1)).toBe('/r/a.mp4');
});

test('probeMedia gives duration 0 when ffprobe reports none, and undefined when it cannot read the file', async () => {
  const none = fakeDeps({ stdout: JSON.stringify({ streams: [{ codec_type: 'subtitle', codec_name: 'subrip' }], format: {} }) });
  expect((await probeMedia(none.deps, '/r/c.srt'))?.duration).toBe(0);
  const bad = fakeDeps({ code: 1, stderr: 'No such file' });
  expect(await probeMedia(bad.deps, '/r/missing.mp4')).toBeUndefined();
});
```

**Implementation notes:**
- `export type Loudness = { i: number; tp: number }`. `loudnessOf(deps, file): Promise<Loudness>`: the command in
  the test, `timeoutMs` 10 min. Parse only the text after the last `Summary:`: `/I:\s+(-?[\d.]+) LUFS/` and
  `/Peak:\s+(-?[\d.]+|-inf) dBFS/` (`-inf` → `-Infinity`). Missing either → `throw new ToolError({ cmd, code: 0,
  stderr })`.
- `export type MediaProbe = { duration: number; video?: { codec: string; profile?: string; w: number; h: number;
  fps: number; pix_fmt?: string }; audio?: { codec: string; sample_rate: number; channels: number }; subtitle?:
  { codec: string } }`. `probeMedia(deps, file): Promise<MediaProbe | undefined>`: `['ffprobe', '-v', 'error',
  '-show_entries', 'stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,sample_rate,channels:format=duration',
  '-of', 'json', file]` with `allowFail: true`, `timeoutMs` 60 s; non-zero exit → `undefined`. Parse stdout with a
  non-strict zod object (unknown keys ignored). First stream of each type wins. `fps` = numerator / denominator of
  `r_frame_rate`. `duration` = `Number(format.duration)`, `0` when missing or not finite. Omit `profile` /
  `pix_fmt` keys when ffprobe gives none.

**Done when:** `sh .claude/tools/check.sh lib/core` passes.

---

### Task 3: Checks `audio.loudness`, `deliver.files`, `contracts.valid`

**Agent:** lib-builder

**Read first:** `lib/checks/duration.ts` (whole: the CheckResult shape and tone), `lib/core/media.ts` (Task 2:
`Loudness`, `MediaProbe`), `lib/core/json.ts:1-15` (`readJson` errors), `lib/contracts/types.ts:443-458`,
`lib/scenes/check.ts:236-260` (the checks list), `lib/scenes/check.test.ts:26-43` (`CHECK_ORDER`), `:44-60`
(`makeRun`), `:135-147`.

**Files:** Create `lib/checks/audio.ts`, `audio.test.ts`, `deliver.ts`, `deliver.test.ts`, `contracts.ts`,
`contracts.test.ts`. Modify `lib/scenes/check.ts` (add `checkContractsValid(runDir)` as the first check),
`lib/scenes/check.test.ts` (`CHECK_ORDER` starts with `'contracts.valid'`; one new test below).

**Tests first:**

`lib/checks/audio.test.ts`:
```ts
import { expect, test } from 'bun:test';
import { checkLoudness } from './audio';

test('checkLoudness passes inside -14 ±1 LUFS with true peak at or below -1 dBTP', () => {
  const r = checkLoudness('reel', { i: -13.1, tp: -1 });
  expect(r).toMatchObject({ id: 'audio.loudness', format: 'reel', blocking: true, status: 'pass', annotations: [] });
});

test('checkLoudness fails too quiet, too loud and a hot peak, naming the numbers', () => {
  for (const m of [{ i: -15.2, tp: -3 }, { i: -12.8, tp: -3 }, { i: -14, tp: -0.4 }]) {
    const r = checkLoudness('reel', m);
    expect(r.status).toBe('fail');
    expect(r.annotations[0]?.problem).toContain(`${m.i} LUFS`);
    expect(r.annotations[0]?.problem).toContain(`${m.tp} dBTP`);
  }
});
```

`lib/checks/deliver.test.ts`:
```ts
import { expect, test } from 'bun:test';
import type { MediaProbe } from '../core/media';
import { checkDeliverFiles, type DeliverItem } from './deliver';

const expect30 = { w: 1080, h: 1920, fps: 30, duration: 9.5 };
const mp4: MediaProbe = {
  duration: 9.52,
  video: { codec: 'h264', w: 1080, h: 1920, fps: 30, pix_fmt: 'yuv420p' },
  audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
};
const clip: MediaProbe = { duration: 1.3, video: { codec: 'prores', profile: '4444', w: 1080, h: 1920, fps: 30 } };
const good: DeliverItem[] = [
  { path: 'out/deliver.tmp/reel/r-reel.mp4', kind: 'mp4', size: 10, probe: mp4, expect: expect30 },
  { path: 'out/deliver.tmp/reel/captions.srt', kind: 'srt', size: 10, probe: { duration: 0, subtitle: { codec: 'subrip' } } },
  { path: 'out/deliver.tmp/reel/ae/scenes/01-hook.mov', kind: 'clip', size: 10, probe: clip, expect: { ...expect30, duration: 1.3 } },
  { path: 'out/deliver.tmp/reel/ae/build_comp.jsx', kind: 'file', size: 10 },
];

test('checkDeliverFiles passes when every file exists and matches', () => {
  const r = checkDeliverFiles(good);
  expect(r).toMatchObject({ id: 'deliver.files', blocking: true, status: 'pass', detail: '4 file(s) checked' });
});

test('checkDeliverFiles names each problem with its file', () => {
  const bad: DeliverItem[] = [
    { ...good[0], probe: { ...mp4, duration: 9.8, video: { ...mp4.video, w: 720 } } } as DeliverItem,
    { ...good[1], probe: undefined } as DeliverItem,
    { ...good[2], probe: { ...clip, video: { ...clip.video, profile: 'HQ' } } } as DeliverItem,
    { ...good[3], size: 0 } as DeliverItem,
  ];
  const r = checkDeliverFiles(bad);
  expect(r.status).toBe('fail');
  const problems = r.annotations.map((a) => a.problem);
  expect(problems).toContain('out/deliver.tmp/reel/r-reel.mp4: 720x1920, expected 1080x1920');
  expect(problems).toContain('out/deliver.tmp/reel/r-reel.mp4: duration 9.8 s, expected 9.5 s');
  expect(problems).toContain('out/deliver.tmp/reel/captions.srt: ffprobe cannot read it');
  expect(problems).toContain('out/deliver.tmp/reel/ae/scenes/01-hook.mov: prores profile HQ, expected 4444');
  expect(problems).toContain('out/deliver.tmp/reel/ae/build_comp.jsx: missing or empty');
  expect(r.annotations.every((a) => a.scene_id === undefined && a.suggested_fix.length > 0)).toBe(true);
});

test('checkDeliverFiles fails an MP4 with no AAC audio at 48 kHz', () => {
  const r = checkDeliverFiles([{ ...good[0], probe: { ...mp4, audio: undefined } } as DeliverItem]);
  expect(r.annotations.map((a) => a.problem)).toEqual(['out/deliver.tmp/reel/r-reel.mp4: no audio, expected aac 48000 Hz']);
});
```

`lib/checks/contracts.test.ts`:
```ts
import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkContractsValid } from './contracts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-contracts-'));
  dirs.push(d);
  return d;
};

test('checkContractsValid passes when the files present all parse, and skips absent ones', () => {
  const d = run();
  writeFileSync(path.join(d, 'assets.json'), JSON.stringify({ run_id: 'r', assets: [] }));
  expect(checkContractsValid(d)).toMatchObject({ id: 'contracts.valid', blocking: true, status: 'pass', detail: '1 file(s) valid' });
});

test('checkContractsValid names every file that is not valid JSON or breaks its schema', () => {
  const d = run();
  mkdirSync(path.join(d, 'capture'));
  writeFileSync(path.join(d, 'capture', 'steps.json'), '[{}]');
  writeFileSync(path.join(d, 'plan.json'), '{not json');
  const r = checkContractsValid(d);
  expect(r.status).toBe('fail');
  expect(r.annotations.map((a) => a.problem.split(':')[0])).toEqual(['plan.json', 'capture/steps.json']);
});
```

New test in `lib/scenes/check.test.ts`:
```ts
test('checkScenes fails contracts.valid when a run file breaks its schema', async () => {
  const run = makeRun();
  mkdirSync(path.join(run, 'capture'), { recursive: true });
  writeFileSync(path.join(run, 'capture', 'steps.json'), '[{}]');
  await checkScenes(run, { render: renderStub(), measure });
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(results.checks[0]).toMatchObject({ id: 'contracts.valid', status: 'fail' });
});
```
(add `mkdirSync` to its `node:fs` import if missing).

**Implementation notes:**
- `checkLoudness(format: FormatId, m: Loudness): CheckResult`: pass when `Math.abs(m.i + 14) <= 1 && m.tp <= -1`.
  Fail annotation: `problem: \`integrated ${m.i} LUFS, true peak ${m.tp} dBTP; target -14 ±1 LUFS, ≤ -1 dBTP\``,
  `suggested_fix: 'mix the sound again (deliver mix), then export again'`. `detail`: `${m.i} LUFS, ${m.tp} dBTP`.
- `export type DeliverItem = { path: string; kind: 'mp4' | 'srt' | 'clip' | 'file'; size: number; probe?: MediaProbe;
  expect?: { w: number; h: number; fps: number; duration: number } }`. `checkDeliverFiles(items): CheckResult`, one
  annotation per problem, `suggested_fix: 'export again (deliver export)'`. Problems, in this order, each prefixed
  `${path}: `:
  - `size === 0` → `missing or empty` (and nothing else for that item).
  - `kind === 'file'`: nothing more.
  - `probe` undefined → `ffprobe cannot read it`.
  - `srt`: `probe.subtitle?.codec !== 'subrip'` → `not a subrip file`.
  - `mp4` / `clip`: no video → `no video stream`; codec must be `h264` (mp4) / `prores` (clip) →
    `codec X, expected Y`; clip `profile` must be `4444` → `prores profile X, expected 4444`; `w×h` →
    `${w}x${h}, expected ${ew}x${eh}`; `Math.abs(fps − efps) > 0.01` → `fps X, expected Y`; duration tolerance
    0.1 s for mp4, `1 / fps + 0.001` for clip → `duration ${d} s, expected ${e} s`; mp4 only: audio must be `aac` at
    48000 → `no audio, expected aac 48000 Hz` or `audio X Y Hz, expected aac 48000 Hz`.
  - `detail`: pass `${items.length} file(s) checked`, fail `${n} problem(s) in ${items.length} file(s)`.
- `checkContractsValid(runDir: string): CheckResult`: the R11 list in that order (`brief.json`, `script.json`,
  `plan.json`, `assets.json`, `data/timing.json`, `capture/steps.json`, `capture/log.json`, `look/look.json`,
  `directions/A/look.json`, `directions/B/look.json`) with `BriefSchema`, `ScriptSchema`, `PlanSchema`,
  `AssetsSchema`, `TimingSchema`, `StepsSchema`, `CaptureLogSchema`, `LookSchema` ×3. Skip absent files. A
  `ContractError` from `readJson` → annotation `problem: \`${rel}: ${first line of the message after the path}\``
  (start the problem with the run-relative path, a colon, then the reason), `suggested_fix: 'write the file again
  through its CLI'`. `detail`: pass `${n} file(s) valid`. Never throws for a bad file.

**Done when:** `sh .claude/tools/check.sh lib/checks lib/scenes` passes.

---

### Task 4: SRT export adapter

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:146-176` (`ScriptSchema`), `:306-326` (`TimingSchema`), `:508-511`
(`ExportAdapter`), `lib/core/paths.ts` (whole, short), `lib/core/json.ts:1-15`.

**Files:** Create `lib/adapters/export/srt/index.ts`, `lib/adapters/export/srt/index.test.ts`. Modify
`lib/core/paths.ts` (add `deliverStageOf`), `lib/core/paths.test.ts` (one test).

**Tests first:** `lib/adapters/export/srt/index.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScriptSchema, TimingSchema } from '../../../contracts/types';
import { InputError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { srtExport, srtOf } from './index';

const w = (word: string, start: number, end: number) => ({ w: word, start, end });
const L2 = 'Firecrawl turns the whole web into clean markdown for your agents in seconds.';
const script = ScriptSchema.parse({
  run_id: 'r',
  version: 1,
  lines: [
    { id: 'l1', text: 'Scrape any site.' },
    { id: 'l2', text: L2 },
    { id: 'l3', text: 'Costs $5.', spoken: 'Costs five dollars.' },
  ],
});
const timing = TimingSchema.parse({
  lines: [
    { id: 'l1', text: 'Scrape any site.', start: 0.2, end: 1.1, words: [w('scrape', 0.2, 0.5), w('any', 0.55, 0.7), w('site', 0.75, 1.1)] },
    {
      id: 'l2',
      text: L2,
      start: 1.5,
      end: 6.0,
      words: L2.split(' ').map((x, i) => w(x, 1.5 + i * 0.33, 1.5 + i * 0.33 + 0.3)),
    },
    { id: 'l3', text: 'Costs $5.', start: 6.5, end: 7.5, words: [w('costs', 6.5, 6.8), w('five', 6.85, 7.1), w('dollars', 7.15, 7.5)] },
  ],
});

test('srtOf makes cues of at most 42 characters, timed by their words', () => {
  expect(srtOf(script, timing)).toBe(
    [
      '1\n00:00:00,200 --> 00:00:01,100\nScrape any site.',
      '2\n00:00:01,500 --> 00:00:03,780\nFirecrawl turns the whole web into clean',
      '3\n00:00:03,810 --> 00:00:05,760\nmarkdown for your agents in seconds.',
      '4\n00:00:06,500 --> 00:00:07,500\nCosts $5.',
    ].join('\n\n') + '\n',
  );
});

test('srtOf splits a line whose word count differs from its timing in proportion to characters', () => {
  const text = `${'x'.repeat(40)} ${'y'.repeat(39)}`;
  const s = ScriptSchema.parse({ run_id: 'r', version: 1, lines: [{ id: 'a', text }] });
  const t = TimingSchema.parse({ lines: [{ id: 'a', text, start: 0, end: 8, words: [w('xy', 0, 8)] }] });
  expect(srtOf(s, t)).toBe(
    `1\n00:00:00,000 --> 00:00:04,000\n${'x'.repeat(40)}\n\n2\n00:00:04,100 --> 00:00:08,000\n${'y'.repeat(39)}\n`,
  );
});

test('srtOf matches timing lines without an id by position and refuses a line the script lacks', () => {
  const t = TimingSchema.parse({ lines: timing.lines.map(({ id: _id, ...l }) => l) });
  expect(srtOf(script, t)).toBe(srtOf(script, timing));
  const extra = TimingSchema.parse({ lines: [...timing.lines, { id: 'l9', text: 'x', start: 8, end: 9, words: [w('x', 8, 9)] }] });
  expect(() => srtOf(script, extra)).toThrow(InputError);
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('srtExport writes out/deliver.tmp/<format>/captions.srt and returns its path', async () => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-srt-'));
  dirs.push(run);
  mkdirSync(path.join(run, 'data'));
  writeJson(path.join(run, 'script.json'), ScriptSchema, script);
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, timing);
  const file = await srtExport().export(run, { format: 'reel', kind: 'srt', captions: 'separate' });
  expect(file).toBe(path.join(run, 'out', 'deliver.tmp', 'reel', 'captions.srt'));
  expect(readFileSync(file, 'utf8')).toBe(srtOf(script, timing));
  expect(readdirSync(path.dirname(file))).toEqual(['captions.srt']);
  await expect(srtExport().export(run, { format: 'reel', kind: 'mp4_h264', captions: 'burned' })).rejects.toThrow(InputError);
});
```

`lib/core/paths.test.ts` addition:
```ts
test('deliverStageOf is out/deliver.tmp/<format> inside the run', () => {
  expect(deliverStageOf('/r', 'reel')).toBe(path.join('/r', 'out', 'deliver.tmp', 'reel'));
});
```

**Implementation notes:**
- `deliverStageOf(runDir: string, format: FormatId): string` in `lib/core/paths.ts`.
- `export const MAX_CUE_CHARS = 42`. `srtOf(script, timing): string`. Each timing line `k` is matched to the script
  line with the same `id`, or the script line at index `k` when the timing line has no `id`; none →
  `InputError(\`timing line ${id ?? k} is not in script.json: align again\`)`. Split the script line's `text` on
  whitespace; group greedily: a word joins the current chunk while `chunk.join(' ').length` stays ≤ 42 (a single
  longer word is its own chunk). Times: when the script word count equals `timing.words.length`, a chunk runs from
  its first word's `start` to its last word's `end`; otherwise chunk `i` (character offset `off` in the joined
  text, length `len`, text length `L`) runs from `start + (end − start) × off / L` to
  `start + (end − start) × (off + len) / L` (line `start`/`end`). Timestamps `HH:MM:SS,mmm` from
  `Math.round(t × 1000)` ms. Cues numbered from 1, joined by a blank line, file ends with one `\n`.
- `srtExport(): ExportAdapter` with `kind: 'srt'`. `export(runDir, d)`: `d.kind !== 'srt'` → `InputError`; read
  `script.json` and `data/timing.json` with their schemas; write to `captions.srt.tmp` in `deliverStageOf(runDir,
  d.format)` (create it), rename to `captions.srt`; return the absolute path.

**Done when:** `sh .claude/tools/check.sh lib/adapters/export lib/core` passes.

---

### Task 5: The render adapter renders MOV

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:476-487` (`LayerPass`, `RenderAdapter`), `lib/adapters/render/hyperframes/index.ts:14-21`
(`QUALITY`) and `:183-208` (`render`), `lib/adapters/render/hyperframes/index.test.ts:31-48` (fakes) and `:138-170`
(render tests).

**Files:** Modify `lib/contracts/types.ts` (`RenderAdapter.render` signature), `lib/adapters/render/hyperframes/index.ts`,
`lib/adapters/render/hyperframes/index.test.ts` (one test).

**Tests first:** add to `index.test.ts`:

```ts
test('render with container mov passes --format mov and writes out/final/<format>.mov', async () => {
  const d = run();
  const { deps, calls } = fakeDeps((cmd) => {
    if (sub(cmd) === 'render') writeFileSync(outOf(cmd), 'mov');
    return { code: 0, stdout: '' };
  });
  const dest = await hyperframesRender(deps).render(d, 'reel', 'final', [], 'mov');
  expect(dest).toBe(path.join(d, 'out', 'final', 'reel.mov'));
  const cmd = calls.find((c) => sub(c) === 'render') ?? [];
  expect(cmd.slice(cmd.indexOf('--format'), cmd.indexOf('--format') + 2)).toEqual(['--format', 'mov']);
  expect(outOf(cmd)).toBe(path.join(d, 'out', 'final', 'reel.tmp.mov'));
  expect(existsSync(path.join(d, 'out', 'final', 'reel.mp4'))).toBe(false);
});
```
(use the file's existing `run`, `fakeDeps`, `sub`, `outOf` helpers; add `existsSync` to its imports if missing).

**Implementation notes:**
- Interface: `render(runDir, format, quality: 'draft' | 'final', passes?: LayerPass[], container?: 'mp4' | 'mov'):
  Promise<string>`.
- Adapter: `container = 'mp4'` default; file names `${format}.${container}` and `${format}.tmp.${container}`; for
  `mov` add `'--format', 'mov'` right after the `--quality` pair. Everything else (temp + rename, rm on failure)
  unchanged. Existing tests must pass untouched.

**Done when:** `sh .claude/tools/check.sh lib/adapters/render lib/contracts` passes.

---

### Task 6: After Effects package adapter

**Agent:** lib-builder

**Read first:** `lib/core/scene-times.ts:1-25` (`SceneTime`) and `:83-110` (`sceneTimes`), `lib/core/paths.ts`
(`deliverStageOf`, Task 4), `lib/contracts/types.ts:14-23` (`FORMATS`), `:508-511` (`ExportAdapter`),
`lib/scenes/cli.test.ts:21-70` (a minimal plan in a temp run), `lib/core/media.test.ts` (Task 2, the `fakeDeps`).

**Files:** Create `lib/adapters/export/ae/index.ts`, `lib/adapters/export/ae/index.test.ts`. Modify
`lib/core/scene-times.ts` (add `sceneFrames`), `lib/core/scene-times.test.ts` (one test).

**Tests first:**

`lib/core/scene-times.test.ts` addition:
```ts
test('sceneFrames rounds each scene start and end to whole frames with no gap', () => {
  const frames = sceneFrames(
    [
      { scene_id: 'a', start: 0, duration: 1.31, lines: [], beats: [], words: [] },
      { scene_id: 'b', start: 1.31, duration: 5.46, lines: [], beats: [], words: [] },
    ],
    30,
  );
  expect(frames).toEqual([
    { scene_id: 'a', f0: 0, n: 39 },
    { scene_id: 'b', f0: 39, n: 164 },
  ]);
});
```

`lib/adapters/export/ae/index.test.ts`:
```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema, PlanSchema, TimingSchema } from '../../../contracts/types';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { sceneFrames, sceneTimes } from '../../../core/scene-times';
import { aeExport, buildCompJsx } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const w = (word: string, start: number, end: number) => ({ w: word, start, end });
const scene = (scene_id: string, line: string) => ({
  scene_id,
  lines: [line],
  cut_in: { anchor: line, rule: 'pause_before' as const },
  intent: 'i',
  beats: [],
  layout: { reel: 'centre' },
  transition_out: 'cut',
  asset_ids: [],
  input_hash: 'h',
});
const plan = PlanSchema.parse({
  run_id: 'r', version: 1, look_id: 'look', asset_ids: [], formats: ['reel'],
  visuals_plan: { scenes: [scene('hook', 'l1'), scene('cta', 'l2')] },
});
const timing = TimingSchema.parse({
  lines: [
    { id: 'l1', text: 'Scrape any site.', start: 0.2, end: 1.1, words: [w('Scrape', 0.2, 0.5), w('any', 0.55, 0.7), w('site', 0.75, 1.1)] },
    { id: 'l2', text: 'Try it.', start: 1.5, end: 2.2, words: [w('Try', 1.5, 1.8), w('it', 1.85, 2.2)] },
  ],
});

/** A run with the plan, timing, a final MOV, the mix and the staged SRT. */
const makeRun = (withMov = true): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-ae-'));
  dirs.push(run);
  for (const d of ['data', 'audio', 'out/final', 'out/deliver.tmp/reel']) mkdirSync(path.join(run, d), { recursive: true });
  writeJson(path.join(run, 'brief.json'), BriefSchema, {
    run_id: 'r', concept: 'c', goals: [], duration_target_s: [1, 30], timing_source: 'voiceover',
  });
  writeJson(path.join(run, 'plan.json'), PlanSchema, plan);
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, timing);
  if (withMov) writeFileSync(path.join(run, 'out', 'final', 'reel.mov'), 'mov');
  writeFileSync(path.join(run, 'audio', 'mix.wav'), 'wav');
  writeFileSync(path.join(run, 'out', 'deliver.tmp', 'reel', 'captions.srt'), '1\n');
  return run;
};

const fakeDeps = () => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd) => {
      calls.push(cmd);
      if (cmd[0] === 'ffmpeg') writeFileSync(cmd.at(-1) as string, 'clip');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { deps, calls };
};

test('aeExport cuts one clip per scene on whole frames and writes the package', async () => {
  const run = makeRun();
  const { deps, calls } = fakeDeps();
  const dir = await aeExport(deps).export(run, { format: 'reel', kind: 'ae_package', captions: 'separate' });
  expect(dir).toBe(path.join(run, 'out', 'deliver.tmp', 'reel', 'ae'));
  const frames = sceneFrames(sceneTimes(plan, timing), 30);
  expect(calls).toEqual(
    frames.map((f, k) => [
      'ffmpeg', '-v', 'error', '-y', '-ss', (f.f0 / 30).toFixed(6), '-i', path.join(run, 'out', 'final', 'reel.mov'),
      '-frames:v', String(f.n), '-c', 'copy', '-an', path.join(dir, 'scenes', `0${k + 1}-${f.scene_id}.mov`),
    ]),
  );
  expect(readFileSync(path.join(dir, 'audio', 'mix.wav'), 'utf8')).toBe('wav');
  expect(readFileSync(path.join(dir, 'captions.srt'), 'utf8')).toBe('1\n');
  const jsx = readFileSync(path.join(dir, 'build_comp.jsx'), 'utf8');
  expect(() => new Function(jsx)).not.toThrow();
  expect(jsx).toContain('"scenes/01-hook.mov"');
  expect(jsx).toContain('"Scrape"');
});

test('aeExport throws InputError when the final MOV is missing, and leaves no package', async () => {
  const run = makeRun(false);
  const { deps } = fakeDeps();
  await expect(aeExport(deps).export(run, { format: 'reel', kind: 'ae_package', captions: 'separate' })).rejects.toThrow(InputError);
  expect(existsSync(path.join(run, 'out', 'deliver.tmp', 'reel', 'ae'))).toBe(false);
});

test('buildCompJsx places each clip at its start, adds the mix and one marker per word', () => {
  const jsx = buildCompJsx({
    name: 'r-reel', w: 1080, h: 1920, fps: 30, duration: 3.2,
    clips: [{ file: 'scenes/01-hook.mov', start: 0 }, { file: 'scenes/02-cta.mov', start: 1.3 }],
    words: [{ t: 0.2, w: 'Scrape' }, { t: 1.5, w: 'it\'s "ok"' }],
  });
  expect(() => new Function(jsx)).not.toThrow();
  expect(jsx).toContain('app.project.items.addComp("r-reel", 1080, 1920, 1, 3.2, 30)');
  expect(jsx).toContain('["scenes/02-cta.mov", 1.3]');
  expect(jsx).toContain('[1.5, "it\'s \\"ok\\""]');
  expect(jsx).toContain('"audio/mix.wav"');
  expect(jsx).toContain('new MarkerValue(');
});
```

**Implementation notes:**
- `sceneFrames(times: SceneTime[], fps: number): { scene_id: string; f0: number; n: number }[]`:
  `f0 = Math.round(start × fps)`, `n = Math.round((start + duration) × fps) − f0`.
- `buildCompJsx(o: { name; w; h; fps; duration; clips: { file; start }[]; words: { t; w }[] }): string` — ES3
  ExtendScript, strings through `JSON.stringify`, arrays printed as `[a, b]` with `", "` separators. Body (keep this
  shape):
  ```
  // build_comp.jsx: in After Effects choose File > Scripts > Run Script File and pick this file.
  (function () {
    var root = File($.fileName).parent.fsName;
    var load = function (rel) { return app.project.importFile(new ImportOptions(new File(root + "/" + rel))); };
    app.beginUndoGroup("Video Machine");
    var comp = app.project.items.addComp(NAME, W, H, 1, DURATION, FPS);
    var clips = [CLIPS];
    for (var i = 0; i < clips.length; i++) { comp.layers.add(load(clips[i][0])).startTime = clips[i][1]; }
    comp.layers.add(load("audio/mix.wav"));
    var words = [WORDS];
    for (var j = 0; j < words.length; j++) { comp.markerProperty.setValueAtTime(words[j][0], new MarkerValue(words[j][1])); }
    comp.openInViewer();
    app.endUndoGroup();
  })();
  ```
- `aeExport(deps: Deps): ExportAdapter`, `kind: 'ae_package'`. `export(runDir, d)`: `d.kind !== 'ae_package'` →
  `InputError`; `out/final/<format>.mov` or `audio/mix.wav` missing → `InputError` naming the file (before
  anything is written). Build in `<stage>/.ae.tmp` (`stage = deliverStageOf(runDir, d.format)`): one ffmpeg per
  scene (the command in the test, through `deps.sh`, `timeoutMs` 10 min) into `scenes/NN-<id>.mov` (NN two digits
  from 01); copy `audio/mix.wav` → `audio/mix.wav`; copy `<stage>/captions.srt` when it exists; write
  `build_comp.jsx` (name `${brief.run_id}-${format}`, `FORMATS[format]` w/h/fps, `duration` = last scene start +
  duration, clips at their `start`, words = every timing word `{ t: start, w }`). Then `rm` `<stage>/ae` and rename
  `.ae.tmp` → `ae`. On any error remove `.ae.tmp` and rethrow. Return the `ae` folder.

**Done when:** `sh .claude/tools/check.sh lib/adapters/export lib/core` passes.

---

### Task 7: Sound mix (M16) `lib/deliver/mix.ts`

**Agent:** lib-builder

**Read first:** `lib/core/media.ts` (Task 2), `lib/core/scene-times.ts:83-110`, `lib/core/paths.ts:23-40`
(`runFileOf`), `lib/contracts/types.ts:87-110` (`BriefSchema.music`), `:276-300` (`AssetRefSchema`, `AssetsSchema`),
`lib/adapters/export/ae/index.test.ts` (Task 6: the plan/timing fixture and `fakeDeps` style to copy).

**Files:** Create `lib/deliver/mix.ts`, `lib/deliver/mix.test.ts`.

**Tests first:** `lib/deliver/mix.test.ts` (copy `w`, `scene`, `plan`, `timing` from the Task 6 test):

```ts
// imports: bun:test, node:fs (existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync), node:os,
// node:path, { AssetsSchema, BriefSchema, PlanSchema, TimingSchema } from '../contracts/types', loadConfig,
// Deps, { InputError, ToolError } from '../core/errors', writeJson, { sceneTimes } from '../core/scene-times',
// { mixSound } from './mix'

const PASS1 = `[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-23.04",
	"input_tp" : "-18.72",
	"input_lra" : "2.70",
	"input_thresh" : "-34.72",
	"output_i" : "-14.01",
	"output_tp" : "-9.84",
	"output_lra" : "2.10",
	"output_thresh" : "-25.49",
	"normalization_type" : "dynamic",
	"target_offset" : "0.01"
}`;
const EBUR = 'Summary:\n  Integrated loudness:\n    I:         -13.9 LUFS\n  True peak:\n    Peak:       -9.7 dBFS\n';

type Music = 'none' | 'supplied' | 'pinned' | 'two-pinned' | 'unknown-licence';
const makeRun = (music: Music, withVo = true): string => {
  // temp run (push to dirs); folders data, audio, input; plan.json, data/timing.json;
  // brief.json: run_id 'r', voiceover, plus music { source: 'supplied', path: 'input/song.mp3' } when 'supplied';
  // input/song.mp3 written; assets.json: run_id 'r', assets: for 'pinned' one audio asset
  //   { asset_id: 'm1', kind: 'audio', path: 'assets/m1.mp3', source: 'openverse', license: 'CC0', usage: 'render',
  //     origin: 'found', status: 'pinned' } (file written), 'two-pinned' two of them (m1, m2),
  //   'unknown-licence' one with license 'unknown'; else [];
  // audio/vo.wav written unless withVo is false.
};

const fakeDeps = (failPass2 = false) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd) => {
      calls.push(cmd);
      const af = cmd[cmd.indexOf('-af') + 1] ?? '';
      if (af.includes('print_format=json')) return { code: 0, stdout: '', stderr: PASS1 };
      if (af.includes('ebur128')) return { code: 0, stdout: '', stderr: EBUR };
      if (failPass2 && af.includes('measured_I')) throw new ToolError({ cmd, code: 1, stderr: 'boom' });
      writeFileSync(cmd.at(-1) as string, 'wav');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { deps, calls };
};

test('mixSound with no music pads the voice to the reel length and normalises it in two passes', async () => {
  const run = makeRun('none');
  const { deps, calls } = fakeDeps();
  const total = Math.max(...sceneTimes(plan, timing).map((t) => t.start + t.duration));
  const r = await mixSound(deps, run);
  expect(r).toEqual({ mix: 'audio/mix.wav', music: null, i: -13.9, tp: -9.7, duration: total });
  const pre = calls[0]?.join(' ') ?? '';
  expect(pre).toContain(`apad=whole_dur=${total}`);
  expect(pre).not.toContain('sidechaincompress');
  expect(calls[2]?.join(' ')).toContain('measured_I=-23.04:measured_TP=-18.72:measured_LRA=2.70:measured_thresh=-34.72:offset=0.01:linear=true');
  expect(readdirSync(path.join(run, 'audio')).sort()).toEqual(['mix.wav', 'vo.wav']);
});

test('mixSound loops a supplied music bed under the voice, ducked and at -12 dB', async () => {
  const run = makeRun('supplied');
  const { deps, calls } = fakeDeps();
  const r = await mixSound(deps, run);
  expect(r.music).toBe('input/song.mp3');
  const pre = calls[0] ?? [];
  expect(pre.slice(pre.indexOf('-stream_loop'), pre.indexOf('-stream_loop') + 4)).toEqual([
    '-stream_loop', '-1', '-i', path.join(run, 'input', 'song.mp3'),
  ]);
  const graph = pre[pre.indexOf('-filter_complex') + 1] ?? '';
  expect(graph).toContain('volume=-12dB');
  expect(graph).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300');
  expect(graph).toContain('amix=inputs=2:normalize=0');
});

test('mixSound takes the one pinned audio asset as music', async () => {
  const run = makeRun('pinned');
  const { deps } = fakeDeps();
  expect((await mixSound(deps, run)).music).toBe('assets/m1.mp3');
});

test('mixSound refuses two pinned music assets, an unknown licence and a missing voice', async () => {
  for (const [m, vo] of [['two-pinned', true], ['unknown-licence', true], ['none', false]] as const) {
    const run = makeRun(m, vo);
    await expect(mixSound(fakeDeps().deps, run)).rejects.toThrow(InputError);
  }
});

test('mixSound leaves no mix.wav and no temp file when a pass fails', async () => {
  const run = makeRun('none');
  writeFileSync(path.join(run, 'audio', 'mix.wav'), 'old');
  await expect(mixSound(fakeDeps(true).deps, run)).rejects.toThrow(ToolError);
  expect(readdirSync(path.join(run, 'audio'))).toEqual(['vo.wav']);
});
```

**Implementation notes:**
- `export type MixResult = { mix: 'audio/mix.wav'; music: string | null; i: number; tp: number; duration: number }`.
  `mixSound(deps: Deps, runDir: string): Promise<MixResult>`.
- Order: check `audio/vo.wav` exists (`InputError` "voice the script first"); pick music (R2; `runFileOf` for the
  run path; asset file missing → `InputError`); `T` = `Math.max(start + duration)` over `sceneTimes(plan, timing)`;
  `rm audio/mix.wav`; then
  1. pre-mix → `audio/.mix.pre.wav`: `['ffmpeg', '-v', 'error', '-y', '-i', vo, (music: '-stream_loop', '-1', '-i',
     musicFile), '-filter_complex', GRAPH, '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s16le', pre]`. GRAPH with
     music = the probe graph in the header with `T` and `T-1` filled in (numbers printed with `String()`); without
     music `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${T},atrim=0:${T}[mix]`.
  2. pass 1: `['ffmpeg', '-hide_banner', '-nostats', '-i', pre, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
     '-f', 'null', '-']`; parse the last `{…}` block of stderr with a zod object of strings (`input_i`, `input_tp`,
     `input_lra`, `input_thresh`, `target_offset`); no block → `ToolError`.
  3. pass 2 → `audio/.mix.tmp.wav`: `['ffmpeg', '-v', 'error', '-y', '-i', pre, '-af',
     'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true',
     '-ar', '48000', '-c:a', 'pcm_s16le', tmp]` (values copied as strings).
  4. rename tmp → `audio/mix.wav`; `loudnessOf(deps, mix)` for `i`/`tp`.
  `finally`: remove `.mix.pre.wav` and `.mix.tmp.wav`. All ffmpeg calls `timeoutMs` 10 min.
- Export constants `MUSIC_GAIN_DB = -12`, `LOUDNESS = { I: -14, TP: -1.5, LRA: 11 }`.

**Done when:** `sh .claude/tools/check.sh lib/deliver` passes.

---

### Task 8: Review (M15) `lib/review/`

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts:236-275` (`PlanSchema`), `lib/core/json.ts`, `lib/core/cli.ts` (whole,
short), `lib/script/cli.ts` (whole: a CLI that reads stdin), `lib/scenes/cli.test.ts:1-25` (temp-run test style).

**Files:** Create `lib/review/review.ts`, `review.test.ts`, `cli.ts`, `cli.test.ts`. Modify `lib/contracts/types.ts`
(add `FeedbackSchema`, `SceneNotesSchema`).

**Tests first:** `lib/review/review.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FeedbackSchema, PlanSchema, SceneNotesSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { review } from './review';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OUTPUTS = ['build/reel/index.html', 'out/drafts/reel.mp4', 'out/sheets/reel.jpg', 'out/final/reel.mp4',
  'out/deliver/reel/r-reel.mp4', 'out/deliver.tmp/reel/captions.srt', 'test_results.json', 'report.md'];
const KEPT = ['audio/vo.wav', 'audio/mix.wav', 'data/timing.json', 'scenes/s1.html', 'scenes/s2.html', 'script.json', 'plan.json'];

/** A delivered run with scenes s1 and s2: every output and every input exists. */
const makeRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-review-'));
  dirs.push(run);
  for (const rel of [...OUTPUTS, ...KEPT, 'brief.json']) {
    mkdirSync(path.dirname(path.join(run, rel)), { recursive: true });
    writeFileSync(path.join(run, rel), rel);
  }
  const scene = (scene_id: string) => ({ scene_id, lines: ['l1'], cut_in: { anchor: 'l1', rule: 'pause_before' },
    intent: 'i', beats: [], layout: { reel: 'c' }, transition_out: 'cut', asset_ids: [], input_hash: scene_id });
  writeJson(path.join(run, 'plan.json'), PlanSchema, { run_id: 'r', version: 1, look_id: 'l', asset_ids: [],
    formats: ['reel'], visuals_plan: { scenes: [scene('s1'), scene('s2')] } });
  return run;
};
const exists = (run: string, rel: string) => existsSync(path.join(run, rel));

test('a scenes review snapshots the text files, notes the scene and clears only the outputs', () => {
  const run = makeRun();
  const r = review(run, { text: 'make scene 2 slower', route: 'scenes', scenes: ['s2'] });
  expect(r).toEqual({ n: 1, route: 'scenes', redo: ['s2'], removed: expect.any(Array) });
  for (const rel of OUTPUTS) expect(exists(run, rel)).toBe(false);
  for (const rel of KEPT) expect(exists(run, rel)).toBe(true);
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({ s2: 'make scene 2 slower' });
  const fb = readJson(path.join(run, 'history', '1', 'feedback.json'), FeedbackSchema);
  expect(fb).toMatchObject({ n: 1, text: 'make scene 2 slower', route: 'scenes', scenes: ['s2'] });
  expect(readFileSync(path.join(run, 'history', '1', 'scenes', 's2.html'), 'utf8')).toBe('scenes/s2.html');
  expect(readFileSync(path.join(run, 'history', '1', 'report.md'), 'utf8')).toBe('report.md');
  expect(exists(run, 'history/1/audio')).toBe(false);
  expect(readdirSync(path.join(run, 'history'))).toEqual(['1']);
});

test('a second note for the same scene is added on a new line, and the next snapshot is history/2', () => {
  const run = makeRun();
  review(run, { text: 'slower', route: 'scenes', scenes: ['s2'] });
  const r = review(run, { text: 'bigger logo', route: 'scenes', scenes: ['s1', 's2'] });
  expect(r.n).toBe(2);
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({ s1: 'bigger logo', s2: 'slower\nbigger logo' });
});

test('a plan review also clears the mix; a words review also clears the voice and the timing', () => {
  const plan = makeRun();
  review(plan, { text: 'swap scenes 1 and 2', route: 'plan' });
  expect(exists(plan, 'audio/mix.wav')).toBe(false);
  expect(exists(plan, 'audio/vo.wav')).toBe(true);
  expect(exists(plan, 'scenes/redo.json')).toBe(false);
  const words = makeRun();
  review(words, { text: 'say "fast" not "quick"', route: 'words' });
  for (const rel of ['audio/mix.wav', 'audio/vo.wav', 'data/timing.json']) expect(exists(words, rel)).toBe(false);
  expect(exists(words, 'history/1/data/timing.json')).toBe(true);
});

test('review refuses bad input before it snapshots or deletes anything', () => {
  const bad = [
    { text: 'x', route: 'scenes' as const },
    { text: 'x', route: 'scenes' as const, scenes: ['s9'] },
    { text: 'x', route: 'plan' as const, scenes: ['s1'] },
    { text: '  ', route: 'words' as const },
  ];
  for (const input of bad) {
    const run = makeRun();
    expect(() => review(run, input)).toThrow(InputError);
    expect(exists(run, 'history')).toBe(false);
    expect(exists(run, 'test_results.json')).toBe(true);
  }
});
```

`lib/review/cli.test.ts`:
```ts
// same makeRun as review.test.ts (copy it)
test('snapshot reads the feedback from stdin and prints the review result', async () => {
  const run = makeRun();
  const r = await main(['snapshot', run, '--route', 'scenes', '--scenes', 's1,s2'], 'tighter cuts\n');
  expect(r).toMatchObject({ n: 1, route: 'scenes', redo: ['s1', 's2'] });
});

test('snapshot refuses a missing or unknown route and extra arguments', async () => {
  const run = makeRun();
  for (const argv of [['snapshot', run], ['snapshot', run, '--route', 'look'], ['snapshot', run, '--route', 'plan', 'x'], ['other', run]]) {
    await expect(main(argv, 'x')).rejects.toThrow(InputError);
  }
});
```

**Implementation notes:**
- Contracts: `FeedbackSchema = z.strictObject({ n: z.number().int().min(1), at: z.string(), text: z.string().min(1),
  route: z.enum(['words', 'plan', 'scenes']), scenes: z.array(z.string()) })` (+ type `Feedback`);
  `SceneNotesSchema = z.record(z.string(), z.string())` (`scenes/redo.json`). `scenes/hashes.json` uses
  `SceneHashesSchema = z.record(z.string(), z.string())` (add it now, Task 9 uses it).
- `review(runDir, input: { text: string; route: Feedback['route']; scenes?: string[] }):
  { n: number; route; redo: string[]; removed: string[] }`. Validate first (trimmed text non-empty; `scenes`
  route needs ≥ 1 id, every id in `plan.json`; other routes refuse `scenes`) → `InputError`.
- Snapshot: `n` = 1 + the largest integer folder name in `history/` (0 if none). Copy into `history/.n.tmp/`, keeping
  run-relative paths, each that exists of: `brief.json`, `script.json`, `plan.json`, `data/timing.json`,
  `test_results.json`, `report.md`, `look/look.json`, `look/LOOK.md`, `directions/A/look.json`, `directions/A/LOOK.md`,
  `directions/B/look.json`, `directions/B/LOOK.md`, and every regular file directly in `scenes/`. Write
  `feedback.json` (`at` = `new Date().toISOString()`, `scenes` = input scenes or `[]`, `text` trimmed). Rename to
  `history/<n>`.
- Then delete (R9 table, `rmSync` recursive force) and return the run-relative paths that existed. For `scenes`:
  merge the trimmed text into `scenes/redo.json` (existing note + `\n` + text) through `writeJson`.
- `cli.ts`: `main(argv, stdin: string)`; usage `snapshot <run_dir> --route words|plan|scenes [--scenes id,id]
  (feedback on stdin)`; `import.meta.main` reads stdin (cap 64 KB as `lib/script/cli.ts` does) and runs through
  `runCli`.

**Done when:** `sh .claude/tools/check.sh lib/review lib/contracts` passes.

---

### Task 9: Scenes to write: `todo`, `done`, and the build gate

**Agent:** lib-builder

**Read first:** `lib/scenes/build.ts:1-40`, `lib/scenes/cli.ts` (whole, 80 lines), `lib/scenes/cli.test.ts:1-80`,
`lib/scenes/build.test.ts` (find its `makeRun` with `grep -n "const makeRun" lib/scenes/build.test.ts`),
`lib/contracts/types.ts` (`SceneNotesSchema`, `SceneHashesSchema` from Task 8).

**Files:** Create `lib/scenes/todo.ts`, `lib/scenes/todo.test.ts`. Modify `lib/scenes/build.ts` (gate),
`lib/scenes/build.test.ts` (one test), `lib/scenes/cli.ts` (`todo`, `done`), `lib/scenes/cli.test.ts` (two tests).

**Tests first:** `lib/scenes/todo.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanSchema, SceneHashesSchema, SceneNotesSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { markDone, scenesTodo } from './todo';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scene = (scene_id: string, input_hash: string) => ({ scene_id, lines: ['l1'], cut_in: { anchor: 'l1', rule: 'pause_before' },
  intent: 'i', beats: [], layout: { reel: 'c' }, transition_out: 'cut', asset_ids: [], input_hash });
/** Plan scenes a (hash ha), b (hb), c (hc); fragments for the ids in `written`. */
const makeRun = (written: string[]): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-todo-'));
  dirs.push(run);
  mkdirSync(path.join(run, 'scenes'));
  writeJson(path.join(run, 'plan.json'), PlanSchema, { run_id: 'r', version: 2, look_id: 'l', asset_ids: [],
    formats: ['reel'], visuals_plan: { scenes: [scene('a', 'ha'), scene('b', 'hb'), scene('c', 'hc')] } });
  for (const id of written) writeFileSync(path.join(run, 'scenes', `${id}.html`), `<div>${id}</div>`);
  return run;
};

test('a fresh run has every scene to write', () => {
  expect(scenesTodo(makeRun([]))).toEqual([
    { scene_id: 'a', reason: 'new' }, { scene_id: 'b', reason: 'new' }, { scene_id: 'c', reason: 'new' },
  ]);
});

test('fragments with no recorded hash count as current', () => {
  expect(scenesTodo(makeRun(['a', 'b', 'c']))).toEqual([]);
});

test('a changed plan hash and a feedback note make a scene to write, in plan order', () => {
  const run = makeRun(['a', 'b', 'c']);
  writeJson(path.join(run, 'scenes', 'hashes.json'), SceneHashesSchema, { a: 'ha', b: 'old', c: 'hc' });
  writeJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema, { c: 'slower' });
  expect(scenesTodo(run)).toEqual([
    { scene_id: 'b', reason: 'changed' },
    { scene_id: 'c', reason: 'feedback', feedback: 'slower' },
  ]);
});

test('markDone records the plan hash and drops the note of each scene', () => {
  const run = makeRun(['a', 'b', 'c']);
  writeJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema, { b: 'x', c: 'slower' });
  markDone(run, ['c']);
  expect(readJson(path.join(run, 'scenes', 'hashes.json'), SceneHashesSchema)).toEqual({ c: 'hc' });
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({ b: 'x' });
  markDone(run, ['b']);
  expect(existsSync(path.join(run, 'scenes', 'redo.json'))).toBe(false);
  expect(scenesTodo(run)).toEqual([]);
});

test('markDone refuses an unknown scene, a scene with no fragment and an empty list, changing nothing', () => {
  const run = makeRun(['a']);
  for (const ids of [['z'], ['b'], []]) expect(() => markDone(run, ids)).toThrow(InputError);
  expect(existsSync(path.join(run, 'scenes', 'hashes.json'))).toBe(false);
});
```

`lib/scenes/build.test.ts` addition (use the file's own run helper; delete one scene's fragment):
```ts
test('buildScenes throws InputError naming the scenes still to write, before assembling', async () => {
  // run helper, then rmSync(path.join(run, 'scenes', '<a scene id of that helper>.html'))
  // assemble stub that records calls
  // await expect(buildScenes(run, { render, assemble })).rejects.toThrow('write these scenes first: <id>');
  // expect(assembleCalls).toBe(0);
});
```

`lib/scenes/cli.test.ts` additions:
```ts
test('todo lists the scenes to write', async () => {
  const run = makeRun(); // the existing helper: one scene `demo` with its fragment written by the test? If the helper
  // writes no fragment, `todo` returns [{ scene_id: 'demo', reason: 'new' }].
  expect(await main(['todo', run])).toEqual({ todo: [{ scene_id: 'demo', reason: 'new' }] });
});

test('done takes scene ids and refuses none', async () => {
  const run = makeRun();
  writeFileSync(path.join(run, 'scenes', 'demo.html'), '<div></div>');
  expect(await main(['done', run, 'demo'])).toEqual({ done: ['demo'] });
  await expect(main(['done', run])).rejects.toThrow(InputError);
});
```
(Read the existing `makeRun` first and make these two tests match it: create `scenes/` if it does not, and use
the reason it really gives.)

**Implementation notes:**
- `export type Todo = { scene_id: string; reason: 'new' | 'feedback' | 'changed'; feedback?: string }`.
  `scenesTodo(runDir): Todo[]` in plan order: no `scenes/<id>.html` → `new` (with `feedback` when noted); else a
  note → `feedback`; else a recorded hash ≠ plan `input_hash` → `changed`. Missing `hashes.json` / `redo.json` =
  `{}`.
- `markDone(runDir, ids: string[]): void`: refuse empty `ids`, unknown ids, ids without a fragment (`InputError`,
  before writing). Set `hashes[id] = input_hash`; delete `notes[id]`; write `hashes.json`; write `redo.json`, or
  remove it when no note is left.
- `buildScenes`: first line after reading the plan: `const todo = scenesTodo(runDir); if (todo.length > 0) throw new
  InputError(\`write these scenes first: ${todo.map((t) => t.scene_id).join(', ')}\`)`.
- CLI usage: `cli.ts times <run_dir> | build <run_dir> | check <run_dir> | todo <run_dir> | done <run_dir> <scene_id>...`.
  `todo` → `{ todo }`; `done` → `{ done: ids }`. Other commands still refuse extra arguments.

**Done when:** `sh .claude/tools/check.sh lib/scenes` passes.

---

### Task 10: Deliver (M17) `lib/deliver/deliver.ts` and the CLI

**Agent:** lib-builder

**Read first:** `lib/deliver/mix.ts` (Task 7, signature only: `grep -n "^export" lib/deliver/mix.ts`),
`lib/checks/report.ts`, `lib/checks/audio.ts`, `lib/checks/deliver.ts` (Tasks 1, 3), `lib/core/media.ts`,
`lib/core/scene-times.ts` (`sceneTimes`, `sceneFrames`), `lib/core/paths.ts` (`deliverStageOf`),
`lib/contracts/types.ts:73-78` (`DeliverableSchema`), `:443-473` (`TestResultsSchema`), `:476-511` (adapters),
`lib/scenes/check.ts:37-66` (`ScenesIo`, `resolveIo` pattern), `lib/scenes/cli.ts` (CLI pattern).

**Files:** Create `lib/deliver/deliver.ts`, `deliver.test.ts`, `cli.ts`, `cli.test.ts`.

**Tests first:** `lib/deliver/deliver.test.ts`. Fixture: copy `w`, `scene`, `plan`, `timing` from
`lib/adapters/export/ae/index.test.ts`; a run with `brief.json` (voiceover, `deliverables` from the test),
`plan.json`, `data/timing.json`, `audio/mix.wav`, and `test_results.json` written with `TestResultsSchema`
(`run_id 'r'`, `plan_version 1`, `output_paths` `{ stills: {}, contact_sheets: {}, drafts: {}, deliverables: [],
report: 'report.md' }`, `checks: [{ id: 'plan.coverage', blocking: true, status: 'pass', detail: 'ok', annotations: [] }]`,
`summary: { blocking_failed: N, warnings: 0 }`).

```ts
const TOTAL = Math.max(...sceneTimes(plan, timing).map((t) => t.start + t.duration));
const FRAMES = sceneFrames(sceneTimes(plan, timing), 30);

/** Stubs: render writes the file it returns; srt/ae write their outputs; probe answers by extension. */
const stubs = (o: { loud?: Loudness } = {}) => {
  const renders: unknown[][] = [];
  const sh: string[][] = [];
  const io: DeliverIo = {
    deps: { config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }), sh: async (cmd) => {
      sh.push(cmd);
      writeFileSync(cmd.at(-1) as string, 'mp4');
      return { code: 0, stdout: '', stderr: '' };
    } },
    render: { /* RenderAdapter stub: render(runDir, format, quality, passes, container) records its args in
               `renders`, writes out/final/<format>.<container ?? 'mp4'> and returns it; other methods throw */ } as RenderAdapter,
    srt: { kind: 'srt', export: async (runDir, d) => { /* write <stage>/captions.srt 'srt'; return it */ } },
    ae: { kind: 'ae_package', export: async (runDir, d) => { /* write <stage>/ae/scenes/0k-<id>.mov per FRAMES,
           <stage>/ae/build_comp.jsx, <stage>/ae/audio/mix.wav; return <stage>/ae */ } },
    loudness: async () => o.loud ?? { i: -14.1, tp: -2 },
    probe: async (_deps, file) =>
      file.endsWith('.mp4') ? { duration: TOTAL, video: { codec: 'h264', w: 1080, h: 1920, fps: 30 }, audio: { codec: 'aac', sample_rate: 48000, channels: 2 } }
      : file.endsWith('.srt') ? { duration: 0, subtitle: { codec: 'subrip' } }
      : { duration: (FRAMES.find((f) => file.includes(f.scene_id))?.n ?? 0) / 30, video: { codec: 'prores', profile: '4444', w: 1080, h: 1920, fps: 30 } },
  };
  return { io, renders, sh };
};

test('deliver with no deliverables listed makes the MP4 and the SRT per format and publishes out/deliver', async () => {
  const run = makeRun({ deliverables: [] });
  const { io, renders, sh } = stubs();
  const r = await deliver(run, io);
  expect(r).toEqual({ ok: true, deliverables: ['out/deliver/reel/captions.srt', 'out/deliver/reel/r-reel.mp4'], report: 'report.md' });
  expect(renders).toEqual([[run, 'reel', 'final', [], 'mp4']]);
  expect(sh[0]).toEqual(['ffmpeg', '-v', 'error', '-y', '-i', path.join(run, 'out', 'final', 'reel.mp4'), '-i',
    path.join(run, 'audio', 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', path.join(run, 'out', 'deliver.tmp', 'reel', 'r-reel.mp4')]);
  expect(existsSync(path.join(run, 'out', 'deliver.tmp'))).toBe(false);
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(results.checks.map((c) => `${c.id}/${c.format ?? '-'}/${c.status}`)).toEqual([
    'plan.coverage/-/pass', 'audio.loudness/reel/pass', 'deliver.files/-/pass',
  ]);
  expect(results.output_paths.deliverables.map((d) => d.path)).toEqual(['out/deliver/reel/captions.srt', 'out/deliver/reel/r-reel.mp4']);
  expect(readFileSync(path.join(run, 'report.md'), 'utf8')).toContain('- deliver.files');
});

test('an ae_package renders the MOV and checks every clip', async () => {
  const run = makeRun({ deliverables: [{ format: 'reel', kind: 'ae_package', captions: 'separate' }] });
  const { io, renders } = stubs();
  const r = await deliver(run, io);
  expect(r).toMatchObject({ ok: true, deliverables: ['out/deliver/reel/ae'] });
  expect(renders).toEqual([[run, 'reel', 'final', [], 'mov']]);
});

test('a failing deliver check keeps out/deliver.tmp, publishes nothing and leaves test_results.json alone', async () => {
  const run = makeRun({ deliverables: [] });
  const before = readFileSync(path.join(run, 'test_results.json'), 'utf8');
  mkdirSync(path.join(run, 'out', 'deliver'), { recursive: true });
  writeFileSync(path.join(run, 'out', 'deliver', 'old.mp4'), 'old');
  const r = await deliver(run, stubs({ loud: { i: -9, tp: 0 } }).io);
  expect(r.ok).toBe(false);
  expect(r).toMatchObject({ failed: [{ id: 'audio.loudness', format: 'reel' }] });
  expect(existsSync(path.join(run, 'out', 'deliver.tmp', 'reel', 'r-reel.mp4'))).toBe(true);
  expect(readFileSync(path.join(run, 'out', 'deliver', 'old.mp4'), 'utf8')).toBe('old');
  expect(readFileSync(path.join(run, 'test_results.json'), 'utf8')).toBe(before);
});

test('deliver refuses failing scene checks, a missing mix and unsupported deliverables before rendering', async () => {
  const cases: [Parameters<typeof makeRun>[0], typeof InputError | typeof UnsupportedError][] = [
    [{ deliverables: [], blockingFailed: 1 }, InputError],
    [{ deliverables: [], noMix: true }, InputError],
    [{ deliverables: [{ format: 'square', kind: 'srt', captions: 'separate' }] }, InputError],
    [{ deliverables: [{ format: 'reel', kind: 'mp4_h264', captions: 'none' }] }, UnsupportedError],
    [{ deliverables: [{ format: 'reel', kind: 'gif', captions: 'burned' }] }, UnsupportedError],
  ];
  for (const [opts, err] of cases) {
    const { io, renders } = stubs();
    await expect(deliver(makeRun(opts), io)).rejects.toThrow(err);
    expect(renders).toEqual([]);
  }
});
```
(`makeRun(o: { deliverables: Deliverable[]; blockingFailed?: number; noMix?: boolean })`.)

`lib/deliver/cli.test.ts`:
```ts
test('the CLI refuses unknown commands and extra arguments', async () => {
  for (const argv of [['other', '/r'], ['mix'], ['export', '/r', 'x']]) await expect(main(argv)).rejects.toThrow(InputError);
});
```

**Implementation notes:**
- `export type DeliverIo = { deps?: Deps; render?: RenderAdapter; srt?: ExportAdapter; ae?: ExportAdapter;
  loudness?: typeof loudnessOf; probe?: typeof probeMedia }`; real ones by default (`hyperframesRender(deps)`,
  `srtExport()`, `aeExport(deps)`, `loudnessOf`, `probeMedia`).
- `deliver(runDir, io = {}): Promise<{ ok: true; deliverables: string[]; report: 'report.md' } | { ok: false;
  failed: { id: string; format?: FormatId; detail: string; problems: string[] }[]; stage: 'out/deliver.tmp' }>`.
- Before any render: `test_results.json` must exist with `summary.blocking_failed === 0` (else `InputError` "the
  scene checks have not passed: run the scenes check first"); `audio/mix.wav` must exist (`InputError` "mix the
  sound first"). Deliverables per R6 (default list when empty; validate every one first: format in `plan.formats`,
  kind supported, MP4 captions `burned`).
- Then `rm out/deliver.tmp`; per format in plan order, per its deliverables in the order `srt`, `mp4_h264`,
  `ae_package`: `srt` → `srt.export`; `mp4_h264` → `render.render(runDir, f, 'final', [], 'mp4')` then the mux
  command in the test (through `deps.sh`, `timeoutMs` 10 min) into `<stage>/<run_id>-<f>.mp4`; `ae_package` →
  `render.render(runDir, f, 'final', [], 'mov')` then `ae.export`.
- Checks: per MP4 `checkLoudness(f, await loudness(deps, mp4))`; one `checkDeliverFiles` over items: each MP4
  (`expect` = `FORMATS[f]` w/h/fps, `duration` = total), each SRT, each AE clip (`scenes/NN-<id>.mov`, `kind
  'clip'`, `duration` = `n / fps` from `sceneFrames`), and `kind 'file'` for `ae/build_comp.jsx` and
  `ae/audio/mix.wav`. `size` from `statSync` (0 when missing); `probe` only for non-`file` kinds.
- All blocking pass → `rm out/deliver`, rename `out/deliver.tmp` → `out/deliver`; read `test_results.json`, set
  `checks = mergeChecks(old, new)`, `summary.blocking_failed` recounted, `output_paths.deliverables` = `{ deliverable,
  path }` with `out/deliver/...` run-relative POSIX paths (sorted by path); `writeJson`; `writeReport`. Return the
  sorted paths. Otherwise return `failed` (each failing blocking check, `problems` = its annotation problems).
- `cli.ts`: usage `cli.ts mix <run_dir> | export <run_dir>`; `mix` → `mixSound(defaultDeps(), runDir)`; `export` →
  `deliver(runDir)`. `main(argv, io?)` returns the result; `import.meta.main` runs it through `runCli`.

**Done when:** `sh .claude/tools/check.sh lib/deliver` passes.

---

### Task 11: Shipped skills and agent for M15–M17

**Agent:** plugin-builder

**Read first:** `skills/scenes/SKILL.md` (whole, ~60 lines), `skills/make-video/SKILL.md:98-130`,
`agents/scene-writer.md` (whole), `skills/voice/SKILL.md:1-20` (frontmatter and CLI block style),
`lib/review/cli.ts`, `lib/deliver/cli.ts`, `lib/scenes/cli.ts` (usage lines only: `grep -n USAGE`).

**Files:** Create `skills/review/SKILL.md`, `skills/deliver/SKILL.md`. Modify `skills/scenes/SKILL.md` (step 1),
`skills/make-video/SKILL.md` (Step 2 table and the stop text), `agents/scene-writer.md` (one rule).

**Tests first:** none (procedure text). The acceptance test (Task 12) exercises the CLIs these skills call.

**Implementation notes:**
- `skills/review/SKILL.md` (M15, < 60 lines; frontmatter `name: review`, a `description` that says it routes the
  creator's feedback after G3 or G4). Steps: (1) classify the feedback with this table, quoting it back in one line
  and asking only when it fits no row:
  | Feedback is about | Route | Then |
  |---|---|---|
  | the words said (wording, facts, order of lines) | `words` | edit `script.json` through `lib/script/cli.ts write`, `plan write` again (storyboard skill, step 5), then `make-video` from M9 |
  | what is shown or when (scene order, which scenes, a new look) | `plan` | `plan write` again; `changed` scenes are re-done; then the scenes skill |
  | one or more scenes (motion, speed, size, layout, a format's layout) | `scenes` with `--scenes` | the scenes skill |
  (2) run `bun lib/review/cli.ts snapshot runs/<run_id> --route <route> [--scenes a,b]` with the feedback text on
  stdin, **before** editing anything; (3) do the "Then" column; (4) tell the creator the `history/<n>` folder holds
  the previous version. Never edit `build/`, `out/` or a scene file directly.
- `skills/deliver/SKILL.md` (M16–M17 + G4, < 60 lines): (1) `mix` — say whether a music bed is used (`music` in
  the result) and the loudness; (2) `export` — on `ok: false` show each `failed` entry's problems and stop (a
  loudness failure: run `mix` again once, then `export` again; anything else: ask); (3) G4: list the `deliverables`
  paths, ask whether to finish; feedback goes to the `review` skill. Name the CLI as
  `"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/deliver/cli.ts" mix|export runs/<run_id>`.
- `skills/scenes/SKILL.md` step 1: run `todo`; dispatch one `scene-writer` per entry only (on a fresh run that is
  every scene), passing its `feedback` when present; then run `done <ids>` for the scenes whose writer finished.
  `build` refuses while any scene is still to write. G3 (step 4): feedback → the `review` skill.
- `skills/make-video/SKILL.md`: table rows `M16`, `M17` → `video-machine:deliver`; the loop now ends at `done` or
  `M11`; remove the "render-and-deliver part arrives in a later version" text for M16; keep the M11 stop.
- `agents/scene-writer.md`: one rule — when the dispatch includes a feedback note, apply it to this scene only and
  keep everything else the scene already does.

**Done when:** `sh .claude/tools/check.sh` passes; `grep -n "review\|deliver" skills/make-video/SKILL.md` shows the
new rows; each new SKILL.md is under 60 lines.

---

### Task 12: Acceptance `tests/phase7.ts`

**Agent:** lib-builder

**Read first:** `tests/phase6.ts` (helpers `:1-265`: temp folder, `check`, `call`/`callOk`, `probe`, `sha`,
`hashDir`, `newRun`, `prepare`, `stageRun`; copy what you need, do not import it), every CLI usage line
(`grep -n "USAGE =" lib/*/cli.ts`).

**Files:** Create `tests/phase7.ts`.

**Tests first:** the script is the test. One temp run, staged as Phase 6 does (three stand-in scenes, real TTS and
aligner), plus a 30 s pink-noise music file (`ffmpeg -f lavfi -i anoisesrc=c=pink:r=44100:d=30:a=0.3 -ac 2
input/music.wav`) named in `brief.music` (`supplied`) and `brief.deliverables` = `[{reel, mp4_h264, burned},
{reel, srt, separate}, {reel, ae_package, separate}]`. Checks, each printing PASS/FAIL with seconds:
1. **scenes**: `scenes todo` lists all three as `new`; after `done` for all three, `build` and `check` pass and
   `where` → `M16`.
2. **mix**: `deliver mix` → `music: "input/music.wav"`; `ebur128` on `audio/mix.wav`: I within −14 ±1, true peak
   ≤ −1; duration = reel total ±0.05 s; `where` → `M17`.
3. **export**: `deliver export` → `ok: true`; MP4: h264 1080×1920 30 fps, AAC 48 kHz, duration ±0.1 s of the total,
   ebur128 within target; SRT: ≥ 3 cues, the first cue's text starts with the first script line's first word; AE:
   three `scenes/*.mov` ProRes 4444 whose frame counts (`ffprobe -count_frames`) sum to `round(total × 30)`,
   `build_comp.jsx` parses with `new Function`; `test_results.json` has `deliver.files` and `audio.loudness`
   passing; `where` → `done`.
4. **feedback "make scene 3 slower"**: record `sha` of `scenes/*.html` and `build/reel/compositions/*.html`; `review
   snapshot --route scenes --scenes <third scene id>` with that text → `history/1/feedback.json` has it and
   `history/1/scenes/` holds the three fragments; `build/`, `out/deliver/` and `test_results.json` are gone;
   `audio/vo.wav`, `audio/mix.wav` unchanged (sha); `where` → `M12`; `scenes todo` = exactly the third scene with
   reason `feedback` and the text; `build` exits non-zero naming it.
5. **only scene 3 changes**: rewrite the third fragment as the stand-in writer would (stretch its tween with
   `VM`-relative timing, no literal seconds), `done` it, `build`, `check` pass; the other two fragments **and** their
   `build/reel/compositions/*.html` are byte-identical to step 4; the third's composition differs; `scenes/redo.json`
   is gone.
6. **plan change**: `plan write` again with only the first scene's `intent` changed → `changed` = `[first]`;
   `scenes todo` = exactly the first scene with reason `changed`.
7. **source projects**: the `video-testing` listing matches `tests/phase0/video-testing.before.txt` (as phase6.ts).

**Implementation notes:** call every CLI through `call`/`callOk` (subprocess, JSON line). Remove the temp folder at
the end unless `KEEP=1`. Exit code 1 when any check fails.

**Done when:** `node_modules/.bin/bun tests/phase7.ts` prints 7 PASS lines (run by the orchestrator, not the builder;
the builder runs `sh .claude/tools/check.sh` and `node_modules/.bin/bun x tsc --noEmit -p .`).
