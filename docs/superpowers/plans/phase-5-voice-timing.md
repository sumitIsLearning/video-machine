# Phase 5 — Voice and Timing Implementation Plan

**Goal:** Given a run at M9 (script, look and plan exist), the plugin voices the script line by line with Kokoro
(`hyperframes tts`), or imports a supplied recording, into `audio/vo.wav` (48 kHz mono, 0.25 s between lines) (M9). It
then aligns the script to that audio into `data/timing.json` with line ids and per-word confidence. Lines that do not
match the audio fail loudly by id (M10). `lib/core/timing.ts` looks words up by line id (`wordOf(line, word, nth)`) and
turns timing into scene times. Changing one script word re-voices only that line and re-times every later scene.

**Architecture:**
- **Core:** `lib/core/timing.ts` (`lineOf`, `wordOf`, `timedLines`) and `lib/core/cost.ts` (`costGate`).
- **Adapters:** `lib/adapters/voice/hf-tts/` (per-line synth with a cache, join, resample) and
  `lib/adapters/voice/supplied/` (import a recording). The existing `lib/adapters/align/ctc-onnx/` gains line ids,
  word confidence and the low-confidence refusal.
- **Part folder:** `lib/voice/` (`spoken.ts`: the per-word spoken map for the aligner; `cli.ts`: `synth` and `align`).
- **Skill:** `skills/voice/SKILL.md` (M9, M10). `make-video` routes M9 and M10 to it and stops at the part after M10.

**Tech stack (probed 2026-10-14 on the reference Mac):**
- bun 1.4.2, zod 4, Python 3.14 venv under `VM_HOME` (onnxruntime, numpy, kokoro-onnx), ffmpeg 9.0.2.
- HyperFrames 0.8.143 `tts` through `HF_CMD`, env `deps.config.toolEnv` (it sets `HYPERFRAMES_PYTHON`):
  - `tts --text-file <file.txt> -o <out.wav> -v <voice> --json` prints one JSON line
    `{"ok":true,"voice":"af_heart","speed":1,"lang":"en-us","langApplied":true,"durationSeconds":2.667,"outputPath":"…"}`
    and writes 24 kHz mono `pcm_s16le`. About 5 s per line, warm.
  - An unknown voice exits 1 with `{"ok":false,"error":"Speech synthesis failed\n…ValueError: Voice zz_nope not found in available voices"}` on **stdout**.
  - The positional `INPUT` is "text to speak, or path to a .txt file". A line that looks like a file path would be
    read as a file, so always pass `--text-file`.
- ffmpeg join probed: `ffmpeg -v error -y -i a.wav -i b.wav -filter_complex "[0:a]apad=pad_dur=0.25[a0];[a0][1:a]concat=n=2:v=0:a=1,aresample=48000[o]" -map "[o]" -c:a pcm_s16le vo.wav`
  gives 48000 Hz, duration = a + 0.25 + b.
- CTC confidence probed (`align_vo.py`, mean over a word's letter tokens of the mean frame probability
  `exp(E[t, token])`): a line that matches its audio scores 0.80–1.00 per word (line mean ≈ 0.9); a line of wrong text
  scores 0.00–0.50 (line mean ≈ 0.23). Threshold: line mean below **0.6** fails.

**Spec:** `docs/BLUEPRINT.md`: Part 5 Phase 5; 1.3 Non-negotiable 2 (timing found by content, `wordOf(line, word,
nth)`); 1.6 (Voice, Alignment rows); 2.3 (HyperFrames `tts`, ctc-onnx rows); 2.5 (`VoiceAdapter`, `AlignAdapter`);
2.6 (Spending money); 2.7 (voice sample rate, `brief.voice`, `brief.budget_usd`).

## Global Constraints

- Call bun as `node_modules/.bin/bun`. Every HyperFrames call starts with `HF_CMD` and passes
  `env: deps.config.toolEnv`. Only `lib/core/sh.ts` spawns processes; tests pass a fake `deps.sh`.
- Import direction: `lib/voice` → `lib/adapters` → `lib/core` → `lib/contracts`. `lib/voice` may import
  `lib/script/script.ts` only for types; no other part-to-part import.
- Run-folder JSON goes only through `writeJson` / `readJson`. A run path from JSON is opened only through `runFileOf`.
- Nothing half-made may look done: an output is written to a temp name and renamed, and a failed step removes its
  outputs (the aligner already does this).
- English only (wav2vec2-base-960h is English-only).

## Review Focus

- Every removed-or-renamed output: does a failure leave `audio/vo.wav` or `data/timing.json` that looks current?
- The line cache key covers everything that changes the audio (voice id and the spoken text).
- `wordOf` scoping: a lookup never leaves its line.
- The vendored `align_vo.py` edit is the conf lines only (R3).

## Rulings made in this plan (orchestrator, 2026-10-14; listed in the phase summary)

- **R1** `VoiceAdapter.synth` takes `runDir` first (`synth(runDir, lines, voice_id)`), like `RenderAdapter`. Nothing
  implements it yet. Cost if wrong: one signature.
- **R2** `voice/supplied` is a function `importSupplied(deps, runDir, runPath)`, not a `VoiceAdapter`: a recording has
  no voice id and costs nothing. Cost if wrong: a wrapper later.
- **R3** The vendored `align_vo.py` gets one edit: a `conf` per word (mean token probability). It is the only place
  that has the emissions. Cost if wrong: re-vendoring loses 6 lines.
- **R4** `timing.json` lines carry the script line `id` (optional in the schema so old files still parse; `timedLines`
  requires it). Cost if wrong: none.
- **R5** Low-confidence threshold: a line whose mean word `conf` is below `0.6` fails the whole align, naming every
  such line. Cost if wrong: a constant.
- **R6** Per-line audio is cached in `audio/lines/<key>.wav`, `key` = first 16 hex of sha256(`voice_id + "\n" +
  spoken text`). Unused keys are pruned after a successful join. Cost if wrong: re-synth time only.
- **R7** A new voice (`synth` or `importSupplied`) deletes `data/timing.json` and `data/audio.json` before it starts,
  so `where` sends the run back to M10. Cost if wrong: none.
- **R8** The `spoken` → per-word map is built by a word diff of `text` vs `spoken` (`lib/voice/spoken.ts`). The
  aligner's map is global by display word, so a word spoken two different ways in two lines is refused by name.
  Cost if wrong: the creator rewrites one word.
- **R9** Cost gate: `costGate(items, budget_usd, approved_usd)`; over budget the CLI refuses with the amount and the
  `--approve-spend <usd>` flag to re-run with after the creator agrees. hf-tts costs 0. Cost if wrong: none.

### Orchestrator pre-step (before Task 1, not a builder task)

Update `docs/BLUEPRINT.md`: 2.5 `VoiceAdapter.synth` row → inputs `runDir, lines, voiceId` (R1); 2.7 add row
"align low-confidence line | mean word conf | `0.6`" (R5); 2.4 or 2.5 note that `voice/supplied` is
`importSupplied(deps, runDir, runPath)` (R2). Commit `docs(blueprint): Phase 5 rulings`.

---

### Task 1: Contracts, timing lookup and cost gate

**Agent:** lib-builder

**Read first:** `lib/contracts/types.ts` (`TimingSchema`, `VoiceAdapter`), `lib/core/estimate.ts` (`LineEstimate`),
`lib/core/errors.ts`.

**Files:**
- Modify: `lib/contracts/types.ts` (timing line `id`, `VoiceAdapter.synth` signature), `lib/contracts/types.test.ts`
- Create: `lib/core/timing.ts`, `lib/core/timing.test.ts`, `lib/core/cost.ts`, `lib/core/cost.test.ts`

**Tests first:** `lib/core/timing.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { Timing } from '../contracts/types';
import { InputError } from './errors';
import { lineOf, timedLines, wordOf } from './timing';

const timing: Timing = {
  lines: [
    {
      id: 'l1',
      text: 'Pip install, then pip?',
      start: 0,
      end: 2,
      words: [
        { w: 'Pip', start: 0, end: 0.3 },
        { w: 'install,', start: 0.3, end: 0.9 },
        { w: 'then', start: 1, end: 1.2 },
        { w: 'pip?', start: 1.3, end: 2 },
      ],
    },
    {
      id: 'l2',
      text: 'Clean — data.',
      start: 2.25,
      end: 3.5,
      words: [
        { w: 'Clean', start: 2.25, end: 2.8 },
        { w: '—', start: 2.8, end: 2.9 },
        { w: 'data.', start: 2.9, end: 3.5 },
      ],
    },
  ],
};

describe('lineOf', () => {
  test('finds a line by id', () => expect(lineOf(timing, 'l2').start).toBe(2.25));
  test('an unknown id is an InputError naming it', () => {
    expect(() => lineOf(timing, 'l9')).toThrow(InputError);
    expect(() => lineOf(timing, 'l9')).toThrow('"l9"');
  });
});

describe('wordOf', () => {
  const l1 = lineOf(timing, 'l1');
  test('matches ignoring case and punctuation', () => expect(wordOf(l1, 'install')).toEqual({ start: 0.3, end: 0.9 }));
  test('nth picks the occurrence, 0 is the first', () => {
    expect(wordOf(l1, 'pip')).toEqual({ start: 0, end: 0.3 });
    expect(wordOf(l1, 'pip', 1)).toEqual({ start: 1.3, end: 2 });
  });
  test('a phrase spans its words; unspoken tokens are skipped', () =>
    expect(wordOf(lineOf(timing, 'l2'), 'clean data')).toEqual({ start: 2.25, end: 3.5 }));
  test('never leaves its line', () => expect(() => wordOf(l1, 'data')).toThrow('line "l1" has no "data"'));
  test('a missing occurrence names nth', () => expect(() => wordOf(l1, 'pip', 2)).toThrow('occurrence 2'));
  test('an empty word is an InputError', () => expect(() => wordOf(l1, ' ? ')).toThrow(InputError));
});

describe('timedLines', () => {
  test('gives LineEstimate-shaped lines from timing', () =>
    expect(timedLines(timing)).toEqual([
      { id: 'l1', words: 4, start_s: 0, end_s: 2 },
      { id: 'l2', words: 3, start_s: 2.25, end_s: 3.5 },
    ]));
  test('a line without an id is an InputError (re-run align)', () => {
    const old: Timing = { lines: [{ text: 'x', start: 0, end: 1, words: [] }] };
    expect(() => timedLines(old)).toThrow('re-run align');
  });
});
```

`lib/core/cost.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { costGate } from './cost';

test('free work passes a zero budget', () =>
  expect(costGate([{ what: 'voice (hf-tts)', usd: 0 }], 0)).toEqual({ total_usd: 0, ok: true }));
test('over budget fails', () =>
  expect(costGate([{ what: 'a', usd: 0.5 }, { what: 'b', usd: 0.75 }], 1)).toEqual({ total_usd: 1.25, ok: false }));
test('an approval at or above the total passes', () => expect(costGate([{ what: 'a', usd: 1.25 }], 0, 1.25).ok).toBe(true));
test('total is rounded to cents', () => expect(costGate([{ what: 'a', usd: 0.1 }, { what: 'b', usd: 0.2 }], 1).total_usd).toBe(0.3));
test('a negative cost is a bug', () => expect(() => costGate([{ what: 'a', usd: -1 }], 0)).toThrow('a'));
```

Add to `lib/contracts/types.test.ts`: `TimingSchema` parses a line with `id: 'l1'` and one without `id`.

**Implementation notes:**
- `TimingSchema` line object gains `id: z.string().optional()`. `VoiceAdapter.synth(runDir: string, lines:
  Script['lines'], voice_id: string): Promise<string>` (R1); keep `costEstimate`.
- `timing.ts`: `export type TimedLine = Timing['lines'][number]`.
  - `norm(s)` = lowercase, `’` → `'`, drop every char not in `[a-z0-9']`, trim `'` at both ends.
  - `lineOf(timing, id)` throws `InputError(\`timing.json has no line "${id}"; re-run align\`)`.
  - `wordOf(line, word, nth = 0): { start: number; end: number }`: split `word` on whitespace, `norm` each, drop empty;
    none left → `InputError('wordOf needs a word')`. Compare against the line's words with empty-`norm` words removed
    (keep their timings); a match is consecutive equal words; return the first matched word's `start` and the last
    one's `end` for the `nth` match (0-based). No match → `InputError(\`line "${line.id ?? '?'}" has no "${word}"\` +
    (nth > 0 ? \` (occurrence ${nth})\` : ''))`.
  - `timedLines(timing): LineEstimate[]`: `{ id, words: line.words.length, start_s: line.start, end_s: line.end }`;
    a line without `id` → `InputError('timing.json lines have no ids; re-run align')`.
- `cost.ts`: `export type Spend = { what: string; usd: number }`; `costGate(items, budget_usd, approved_usd = 0)`;
  a negative `usd` throws `VideoMachineError` naming `what`; `total_usd = Math.round(sum * 100) / 100`;
  `ok = total_usd <= Math.max(budget_usd, approved_usd)`. Doc comment: paid adapters report `costEstimate` first.

**Done when:** `sh .claude/tools/check.sh lib/core lib/contracts` passes.

---

### Task 2: Aligner: line ids, word confidence, low-confidence refusal

**Agent:** lib-builder

**Read first:** `lib/adapters/align/ctc-onnx/index.ts` (whole, 78 lines), `lib/adapters/align/ctc-onnx/index.test.ts`
(the fake-sh run helper near the top), `lib/adapters/align/ctc-onnx/align.py:21-40`,
`lib/adapters/align/ctc-onnx/analysis/align_vo.py:136-225`.

**Files:**
- Modify: `lib/adapters/align/ctc-onnx/index.ts`, `lib/adapters/align/ctc-onnx/index.test.ts`,
  `lib/adapters/align/ctc-onnx/align.py`, `lib/adapters/align/ctc-onnx/analysis/align_vo.py` (conf only, R3)

**Tests first:** add to `index.test.ts`, using its existing fake-sh helper (the fake writes the given timing as
`data/timing.json`):

```ts
test('the spec passes each line id to align.py', async () => {
  // capture the lines.json the fake sh receives (argv[-3] is the spec path) and read it inside the fake
  // expect(spec.lines).toEqual([{ id: 'l1', text: 'Hello there.' }, { id: 'l2', text: 'Bye now.' }])
});

test('a line whose mean word conf is below 0.6 fails by id and removes the outputs', async () => {
  // timing: l1 words conf [0.95, 0.9]; l2 words conf [0.2, 0.3]; l3 words conf [0.5, 0.6]
  // expect align to reject with VideoMachineError whose message contains 'l2 (0.25)' and 'l3 (0.55)' and not 'l1'
  // expect data/timing.json and data/audio.json not to exist afterwards
});

test('words without conf (unspoken tokens) do not count; a line with none passes', async () => {
  // l1 words: [{conf 0.9}, {no conf}] → mean 0.9 passes; l2 words: [{no conf}] → passes
});

test('exactly 0.6 passes', async () => { /* one line, words conf [0.6] → resolves to the timing path */ });
```

Write these as real tests (the comments say what each asserts; the line conf in the message is rounded to 2 places).

**Implementation notes:**
- `index.ts`: export `MIN_LINE_CONF = 0.6` (R5). The spec becomes `lines.map((l) => ({ id: l.id, text: l.text }))`.
  After `readJson(out, TimingSchema)`: for each line, `confs` = its words' defined `conf`; skip lines with none;
  `mean < MIN_LINE_CONF` → collect `` `${line.id ?? i + 1} (${mean.toFixed(2)})` ``. Any collected → throw
  `VideoMachineError(\`ctc-onnx.align: the audio does not match line(s) ${list.join(', ')}; check their spoken text or re-voice them\`)`
  inside the existing `try`, so the `catch` removes the outputs. Update the doc comment.
- `align.py`: after copying `lyrics.json` to `timing.json`, load it, set `lines[i]["id"] = spec["lines"][i]["id"]`
  when the spec line has an `id`, write it back (`ensure_ascii=False`, `indent=1`). Keep the module doc string current.
- `align_vo.py` (R3, nothing else): in the `units` loop, next to `spans[...]`, store
  `confs[(li, wi, pi)] = float(np.mean([np.exp(E[t, tgt[p]]) for p in pos for t in tok_frames.get(p, [])]))`
  (only when `fr` is non-empty); when building `wd` with `parts`, add
  `wd["conf"] = round(float(np.mean([confs[(li, wi, pi)] for pi in range(len(spoken(w))) if (li, wi, pi) in confs])), 3)`.
- Run `node_modules/.bin/bun tests/phase0.ts`: check 1 (fixture alignment within 10 ms) must still PASS.

**Done when:** `sh .claude/tools/check.sh lib/adapters/align` passes and `node_modules/.bin/bun tests/phase0.ts`
prints PASS for check 1.

---

### Task 3: Voice adapters `hf-tts` and `supplied`

**Agent:** lib-builder

**Read first:** `lib/research/page.ts:54-80` (an `HF_CMD` call through `deps.sh`), `lib/core/sh.ts:1-15`
(`allowFail`), `lib/core/errors.ts:20-40` (`ToolError`), `lib/core/paths.ts` (`runFileOf`, `assertRunDir`),
`lib/adapters/align/ctc-onnx/index.test.ts:15-60` (fake deps pattern), `lib/core/estimate.ts:6-7` (`LINE_GAP_S`).

**Files:**
- Create: `lib/adapters/voice/hf-tts/index.ts`, `lib/adapters/voice/hf-tts/index.test.ts`,
  `lib/adapters/voice/supplied/index.ts`, `lib/adapters/voice/supplied/index.test.ts`

**Tests first:** `lib/adapters/voice/hf-tts/index.test.ts`. The fake `sh` records every `cmd`; for `tts` it reads
the `--text-file`, writes `TTS:<text>` to the `-o` path and prints
`{"ok":true,"durationSeconds":1}`; for `ffmpeg` it writes `WAV` to the last argument.

```ts
// helper: makeRun() → temp run dir with brief.json-free audio/ absent; lines = [{id:'l1',text:'One.'},{id:'l2',text:'5.5 points.',spoken:'Five point five points.'}]
test('synth voices each line once, joins them and returns audio/vo.wav', async () => {
  // expect 2 tts calls then 1 ffmpeg call; return value ends with path.join('audio','vo.wav'); file exists
  // tts argv contains '--text-file', '-v', 'af_heart', '--json', and NOT the line text as an argument
  // the text file for l2 held 'Five point five points.' (spoken wins over text)
});
test('the ffmpeg join pads 0.25 s between lines and resamples to 48 kHz mono', async () => {
  // filter_complex arg equals
  // '[0:a]apad=pad_dur=0.25[a0];[1:a]anull[a1];[a0][a1]concat=n=2:v=0:a=1,aresample=48000[o]'
  // argv contains '-ac','1','-c:a','pcm_s16le'
});
test('a second synth reuses cached lines; a changed line alone is re-voiced', async () => {
  // synth(lines) then synth with l2.spoken changed → second run makes exactly 1 tts call
});
test('a different voice id is a different cache key', async () => { /* 2 more tts calls */ });
test('unused cached lines are pruned after the join', async () => {
  // after the change, audio/lines/ holds exactly 2 .wav files
});
test('a new voice deletes data/timing.json and data/audio.json first', async () => { /* pre-create both */ });
test('tts failure names the line and the tool error, leaves no vo.wav', async () => {
  // fake returns {code:1, stdout:'{"ok":false,"error":"Speech synthesis failed\\nValueError: Voice zz not found"}'}
  // for l2 → rejects ToolError with message containing 'line "l2"' and 'Voice zz not found'; audio/vo.wav absent
});
test('no lines is an InputError', async () => {});
test('costEstimate is 0', () => {});
```

`lib/adapters/voice/supplied/index.test.ts` (fake `ffmpeg` writes `WAV` to its last argument):

```ts
test('imports sources/voice.m4a as 48 kHz mono audio/vo.wav', async () => {
  // argv: ffmpeg -v error -y -i <abs source> -ac 1 -ar 48000 -c:a pcm_s16le <tmp> ; result ends with audio/vo.wav
});
test('removes stale timing first', async () => {});
test('a path outside the run is refused (runFileOf)', async () => {});
test('audio/vo.wav itself as the source is an InputError', async () => {});
test('an ffmpeg failure names the supplied file and leaves no vo.wav', async () => {});
```

Write these as real tests.

**Implementation notes:**
- `hf-tts/index.ts`: `export const SAMPLE_RATE = 48_000`; `export const lineKey = (voiceId: string, text: string)
  => sha256(\`${voiceId}\n${text}\`)` first 16 hex chars (R6); `export const hfTts = (deps: Deps = defaultDeps()):
  VoiceAdapter`; default export.
  - `synth(runDir, lines, voiceId)`: no lines → `InputError('hf-tts: no lines to voice')`. Remove `audio/vo.wav`,
    `data/timing.json`, `data/audio.json` (R7). For each line in order, text = `spoken ?? text`; reuse
    `audio/lines/<key>.wav` when it exists and is non-empty; else in a `mkdtemp` dir write `line.txt`, run
    `[...HF_CMD, 'tts', '--text-file', txt, '-o', tmpWav, '-v', voiceId, '--json']` with `{ env, allowFail: true }`,
    parse the last stdout line as JSON (a parse failure counts as failed); `code !== 0` or `ok !== true` → throw
    `new ToolError({ cmd, code, stderr: \`tts failed for line "${id}": ${error ?? stderr}\` })`; else `renameSync` the
    wav into `audio/lines/<key>.wav`; always remove the temp dir.
  - Join: `ffmpeg -v error -y` + `-i <file>` per line + `-filter_complex <f>` + `-map [o] -ac 1 -c:a pcm_s16le
    <audio/vo.part.wav>`, `f` = each input but the last `[i:a]apad=pad_dur=${LINE_GAP_S}[ai]`, the last
    `[i:a]anull[ai]`, then all labels + `concat=n=N:v=0:a=1,aresample=${SAMPLE_RATE}[o]`, joined by `;`. Rename the
    part file to `audio/vo.wav` (remove the part file on failure). Then delete every `.wav` in `audio/lines/` whose name
    is not a used key. Return the absolute `vo.wav` path.
  - `costEstimate: () => 0`.
- `supplied/index.ts`: `export async function importSupplied(deps: Deps, runDir: string, runPath: string):
  Promise<string>` (R2). `src = runFileOf(runDir, runPath)`; `src` equal to the resolved `audio/vo.wav` →
  `InputError('the supplied voice must not be audio/vo.wav; keep it under sources/')`. Remove `audio/vo.wav` and the
  timing files (R7), run `ffmpeg -v error -y -i <src> -ac 1 -ar 48000 -c:a pcm_s16le <audio/vo.part.wav>`, rename to
  `vo.wav`. A `ToolError` is rethrown as `ToolError` whose stderr starts `could not read the supplied voice
  ${runPath}: ` (keep `cause`).

**Done when:** `sh .claude/tools/check.sh lib/adapters/voice` passes.

---

### Task 4: `lib/voice/`: spoken map and the `synth` / `align` CLI

**Agent:** lib-builder

**Read first:** `lib/storyboard/cli.ts` (the CLI pattern), `lib/storyboard/cli.test.ts:1-40`, `lib/script/script.ts:13-30`
(where `brief.json` and `script.json` live), `lib/contracts/types.ts` (`BriefSchema` `voice`, `budget_usd`,
`duration_target_s`, `timing_source`; `DEFAULT_VOICE`; `ScriptSchema`), Task 1–3 exports (`costGate`, `hfTts`,
`importSupplied`, `ctcOnnx`).

**Files:**
- Create: `lib/voice/spoken.ts`, `lib/voice/spoken.test.ts`, `lib/voice/cli.ts`, `lib/voice/cli.test.ts`

**Tests first:** `lib/voice/spoken.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { spokenWordsOf } from './spoken';

const line = (id: string, text: string, spoken?: string) => ({ id, text, spoken, delivery: 'voiceover' as const });

test('lines without spoken give an empty map', () => expect(spokenWordsOf([line('l1', 'Hi there.')])).toEqual({}));
test('a replaced word maps to its spoken words', () =>
  expect(spokenWordsOf([line('l1', 'Up 5.5% today.', 'Up five point five percent today.')])).toEqual({
    '5.5%': ['FIVE', 'POINT', 'FIVE', 'PERCENT'],
  }));
test('a replaced run maps to the first word; the rest are unspoken', () =>
  expect(spokenWordsOf([line('l1', 'Use MCP SDK now.', 'Use the em see pee kit now.')])).toEqual({
    MCP: ['THE', 'EM', 'SEE', 'PEE', 'KIT'],
    SDK: [],
  }));
test('extra spoken words attach to the word before', () =>
  expect(spokenWordsOf([line('l1', 'Go fast.', 'Go really fast.')])).toEqual({ Go: ['GO', 'REALLY'] }));
test('the same word spoken two ways is refused by name', () =>
  expect(() =>
    spokenWordsOf([line('l1', 'v2 ships.', 'vee two ships.'), line('l2', 'v2 rocks.', 'version two rocks.')]),
  ).toThrow('"v2"'));
```

`lib/voice/cli.test.ts` (fake deps through an injected `deps`; a run with `brief.json` and `script.json` written by
`writeJson`):

```ts
test('synth with the default voice calls hf-tts and returns the vo path and line count', async () => {});
test('synth with a supplied voice imports it', async () => {});
test('synth refuses a run without a voiceover', async () => { /* timing_source text_only → InputError 'no voiceover' */ });
test('synth refuses an unknown voice adapter', async () => { /* adapter 'elevenlabs' → UnsupportedError naming it */ });
test('synth over budget refuses with the amount and --approve-spend; the flag lets it through', async () => {
  // inject a voice adapter whose costEstimate is 1.5, budget 0 → message contains '$1.50' and '--approve-spend 1.5';
  // with ['--approve-spend', '1.5'] it synthesizes
});
test('--approve-spend must be a number', async () => {});
test('align passes the spoken map and returns per-line times, total and fit', async () => {
  // fake aligner writes timing with ids l1,l2 (end 9.0); brief duration_target_s [15,30] →
  // { timing: 'data/timing.json', lines: [{id, start, end, conf}], total_s: 9, target_s: [15, 30], fits: false }
});
test('align without audio/vo.wav says to run synth first', async () => {});
test('usage errors', async () => {});
```

Write these as real tests.

**Implementation notes:**
- `spoken.ts`: `export function spokenWordsOf(lines: Script['lines']): Record<string, string[]>` (R8). Only lines
  with `spoken`. Tokens: `text.split(' ').filter(Boolean)` (the aligner splits on a single space) and
  `spoken.split(/\s+/).filter(Boolean)`. `up(x)` = `’` → `'`, uppercase, drop chars not `[A-Z' ]`, trim `'` (same as
  `align_vo.py` `spoken()`). LCS on `up` values (empty never matches). Walk the gaps between matches: a text gap
  `T` with spoken gap `S` → `T[0]` → `S.map(up).filter(Boolean)`, `T[1..]` → `[]`; an empty text gap with a non-empty
  `S` → the text word before (or, at the start, the one after) → `[up(it), ...S]` (or `[...S, up(it)]`). Adding a key
  that exists with a different value → `InputError(\`"${word}" is spoken two ways in the script; write it the same way in both lines\`)`.
- `cli.ts`: `USAGE = 'usage: cli.ts synth <run_dir> [--approve-spend usd] | align <run_dir>'`. `main(argv, io: {
  deps?: Deps; voice?: VoiceAdapter; align?: AlignAdapter } = {})`.
  - `synth`: read `brief.json` (`BriefSchema`) and `script.json` (`ScriptSchema`). `timing_source !== 'voiceover'`
    → `InputError(\`this run has no voiceover (timing_source: ${x})\`)`. `voice = brief.voice ?? DEFAULT_VOICE`.
    `supplied` → `importSupplied(deps, runDir, voice.path)`, return `{ vo: 'audio/vo.wav', source: 'supplied' }`.
    `tts`: adapter = `io.voice` or, for `'hf-tts'`, `hfTts(deps)`; anything else →
    `UnsupportedError(\`voice adapter "${a}" is not available; use hf-tts\`)`. `costGate([{ what: \`voice (${a})\`,
    usd: adapter.costEstimate(lines) }], brief.budget_usd, approved)`; not ok → `InputError(\`the voice costs
    $${total.toFixed(2)} and the budget is $${budget.toFixed(2)}; ask the creator, then re-run with --approve-spend
    ${total}\`)`. Then `synth(runDir, script.lines, voice.voice_id)`; return `{ vo: 'audio/vo.wav', source: 'tts',
    voice: voice_id, lines: n, usd: total }`.
  - `align`: `audio/vo.wav` missing → `InputError('no audio/vo.wav yet; run synth first')`. `(io.align ??
    ctcOnnx(deps)).align(vo, script.lines, spokenWordsOf(script.lines))`, read the timing, return
    `{ timing: 'data/timing.json', lines: [{ id, start, end, conf }], total_s, target_s, fits }`: `conf` = mean
    defined word conf rounded to 2 (or `null`), `total_s` = last line `end`, `target_s` = `brief.duration_target_s`,
    `fits` = within it inclusive (`true` when there is no target).

**Done when:** `sh .claude/tools/check.sh lib/voice` passes.

---

### Task 5: Shipped skill `voice`; `make-video` continues to M10

**Agent:** plugin-builder

**Read first:** `skills/storyboard/SKILL.md` (tone and the bun command pattern), `skills/make-video/SKILL.md:100-125`
(Step 2 table and the stop text), `lib/voice/cli.ts` (`USAGE`, the result fields).

**Files:**
- Create: `skills/voice/SKILL.md`
- Modify: `skills/make-video/SKILL.md`

**Content of `skills/voice/SKILL.md`** (frontmatter `name: voice`, description: "Use when a run needs its voiceover
(M9) or its word timing (M10): voices the script, aligns it, and reports the length."):
- **M9:** run `"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/voice/cli.ts" synth runs/<run_id>`.
  If it refuses on cost, tell the creator the amount and ask; only after a yes re-run with `--approve-spend <usd>`.
  A tool failure that names a line: show the creator the line.
- **M10:** run `… align runs/<run_id>`. Tell the creator the total length against the target in one line. `fits:
  false` → offer to shorten or lengthen the script (back to the script part; the voice re-runs only changed lines).
- **Low-confidence error** (names line ids): for a TTS voice, look at those lines for numbers, symbols, acronyms or
  brand names the voice says differently; add a `spoken` text for them through the script part (`lib/script/cli.ts
  write`, a new version), then `synth` and `align` again. For a supplied recording, ask the creator whether the
  recording or the script is right; never edit their recording.
- **Rules:** never hand-edit `audio/` or `data/timing.json`; after any script change, run `synth` then `align`.
- Under 80 lines.

**`make-video` changes:** Step 2 table gains `M9`, `M10` → `video-machine:voice`; the stop row becomes the part after
M10 (`M11` or `M12`); the intro and stop text say voice and timing now exist and that scenes arrive in the next
version. The loop runs until `where` says `M11` or `M12`.

**Done when:** `grep -c "lib/voice/cli.ts" skills/voice/SKILL.md` ≥ 2, `wc -l skills/voice/SKILL.md` < 80,
`grep -n "M10" skills/make-video/SKILL.md` shows the route, and `sh .claude/tools/check.sh` passes.

---

### Task 6: Acceptance test `tests/phase5.ts`

**Agent:** lib-builder

**Read first:** `tests/phase4.ts:1-110` (helpers `makeTemp`, `check`, `call`, `callOk`, `callRefused`, the
`video-testing` listing check) and `tests/phase4.ts:172-240` (run setup: new run, brief, research.md, script).

**Files:** Create `tests/phase5.ts`.

Real tools (HyperFrames tts, ffmpeg, uv aligner). Prints PASS/FAIL per check and exits 1 on any FAIL. Script for
run A (3 lines, no numbers, so no cites): `l1` "Firecrawl turns any website into clean data.", `l2` "It reads
the page the way you would.", `l3` "Try it on your own site today." Brief: reel, `timing_source: 'voiceover'`, default
voice.

Checks:
1. **synth:** `lib/voice/cli.ts synth` on run A → `audio/vo.wav` is 48000 Hz mono (`ffprobe`), and its duration
   equals the sum of the three `audio/lines/*.wav` durations + 0.5 s (± 0.05).
2. **align:** `align` → every line has its id and `conf ≥ 0.6`; `wordOf(lineOf(t, 'l1'), 'clean data')` lies inside
   l1's span and `start < end`; `wordOf(lineOf(t, 'l3'), 'data')` throws (scoped to its line).
3. **re-time:** record `sceneTimes` (from `lib/storyboard/plan.ts`) of scenes `s1:[l1] s2:[l2] s3:[l3]` over
   `timedLines(timing)`. Write script v2 with l1 "Firecrawl turns any website, any page at all, into clean data.",
   `synth` (record the mtimes of l2's and l3's cached files before: unchanged after; one new file for l1), `align`.
   s2 and s3 both start ≥ 0.5 s later than before.
4. **low confidence by name:** run B with a supplied voice (copy run A's `audio/vo.wav` to run B's
   `sources/voice.wav`, brief `voice: { source: 'supplied', path: 'sources/voice.wav' }`) and a script whose l2 is
   "Bananas eat purple elephants on a Tuesday morning." `synth` imports it; `align` is refused and the message names
   `l2` and not `l1` or `l3`; run B has no `data/timing.json`.
5. **where:** run A's next part is `M11` or `M12` (`lib/run/cli.ts where`).
6. The `video-testing` listing is unchanged (same as Phase 4's check).

**Done when:** `node_modules/.bin/bun tests/phase5.ts` prints 6 PASS (expect about 1 minute) and
`sh .claude/tools/check.sh` passes.
