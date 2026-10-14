// Phase 5 acceptance test (real HyperFrames tts, ffmpeg and the uv aligner; about 1 minute).
//   node_modules/.bin/bun tests/phase5.ts        (KEEP=1 keeps the temp runs and prints their paths)
// Two temp runs under one temp folder, removed at the end. 1. synth  2. align  3. re-time
// 4. low confidence by name  5. where
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lineKey } from '../lib/adapters/voice/hf-tts/index';
import { AssetsSchema, DEFAULT_VOICE, TimingSchema } from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson, writeJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';
import { lineOf, timedLines, wordOf } from '../lib/core/timing';
import { sceneTimes } from '../lib/storyboard/plan';

const WS = PLUGIN_ROOT;
const MIN = 60_000;
const TOL_S = 0.05;
const FC_HOME = 'https://www.firecrawl.dev/';
const FC_SCRAPE = 'https://docs.firecrawl.dev/features/scrape';
let ENV: Env = {};
let bun = '';
let RUNS = '';
const temps: string[] = [];
const makeTemp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
const removeTemps = () => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      console.error(`[phase5] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
    }
  }
};
process.on('SIGINT', () => {
  removeTemps();
  process.exit(130);
});
const lastLine = (s: string) => s.trim().split(/\r?\n/).at(-1) ?? '';

const results: { test: string; ok: boolean; detail: string }[] = [];
const check = async (test: string, fn: () => Promise<string>) => {
  const t0 = performance.now();
  let result: { test: string; ok: boolean; detail: string };
  try {
    result = { test, ok: true, detail: await fn() };
  } catch (e) {
    result = { test, ok: false, detail: String((e as Error).message ?? e) };
  }
  results.push(result);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${test}  (${secs}s)\n      ${result.detail.replace(/\n/g, '\n      ')}`);
};

type Json = Record<string, unknown>;
type Called = { code: number; out: Json };
type Cli = 'run' | 'research' | 'script' | 'voice';
type Line = { id: string; text: string };
type Run = { dir: string; id: string };

const RESEARCH_MD = `# Firecrawl

## Facts
- Firecrawl turns a web page into LLM-ready markdown — "Turn any website into LLM-ready data." — ${FC_HOME}
- A single scrape request returns the page as markdown — "Scrape a single URL and get markdown back." — ${FC_SCRAPE}
`;

/** Run `lib/<cli>/cli.ts` and parse its JSON line. A non-zero exit is returned, not thrown. */
const call = async (cli: Cli, args: string[], o: { stdin?: string } = {}): Promise<Called> => {
  const r = await sh([bun, path.join(WS, 'lib', cli, 'cli.ts'), ...args], {
    cwd: WS,
    env: ENV,
    stdin: o.stdin,
    allowFail: true,
    timeoutMs: 5 * MIN,
  });
  try {
    return { code: r.code, out: JSON.parse(lastLine(r.stdout)) as Json };
  } catch (cause) {
    throw new Error(`${cli} ${args[0]}: output is not JSON\nstdout: ${r.stdout}\nstderr: ${r.stderr}`, { cause });
  }
};

/** Like `call`, but the CLI must exit 0 with `"ok":true`. */
const callOk = async (...a: Parameters<typeof call>): Promise<Json> => {
  const { code, out } = await call(...a);
  if (code !== 0 || out.ok !== true)
    throw new Error(`${a[0]} ${a[1][0]} failed (exit ${code}): ${JSON.stringify(out)}`);
  return out;
};

/** The CLI must exit non-zero with `"ok":false`; returns its message. */
const callRefused = async (...a: Parameters<typeof call>): Promise<string> => {
  const { code, out } = await call(...a);
  if (code === 0 || out.ok !== false)
    throw new Error(`${a[0]} ${a[1][0]}: expected a refusal, got exit ${code}: ${JSON.stringify(out)}`);
  return String(out.message);
};

/** The ffprobe fields of a file as one CSV line. */
const probe = async (file: string, entries: string): Promise<string> =>
  (
    await sh(['ffprobe', '-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file], {
      env: loadConfig(ENV).toolEnv,
    })
  ).stdout.trim();

/** The duration of a media file in seconds. */
const durationOf = async (file: string): Promise<number> => Number(await probe(file, 'format=duration'));

/** The cached TTS clip of one spoken line in the run (audio/lines/<key>.wav). */
const lineFile = (r: Run, text: string): string =>
  path.join(r.dir, 'audio', 'lines', `${lineKey(DEFAULT_VOICE.voice_id, text)}.wav`);

/** A fresh run in the shared temp folder. */
const newRun = async (concept: string): Promise<Run> => {
  const a = await callOk('run', ['new', '--concept', '-', '--runs', RUNS], { stdin: `${concept}\n` });
  return { dir: String(a.run_dir), id: String(a.run_id) };
};

/** Script v`version` of the run; the refusal, if any, is thrown. */
const writeScript = (r: Run, version: number, lines: Line[]) =>
  callOk('script', ['write', r.dir], { stdin: JSON.stringify({ run_id: r.id, version, lines }) });

/** Brief (voice optional), research, an empty asset list and script v1: what a run needs before it is voiced. */
const prepare = async (r: Run, lines: Line[], voice?: Json) => {
  await callOk('run', ['brief', r.dir], {
    stdin: JSON.stringify({ sources: [], timing_source: 'voiceover', voice }),
  });
  await callOk('research', ['write', r.dir], { stdin: RESEARCH_MD });
  writeJson(path.join(r.dir, 'assets.json'), AssetsSchema, { run_id: r.id, assets: [] });
  await writeScript(r, 1, lines);
};

const SCRIPT_A: Line[] = [
  { id: 'l1', text: 'Firecrawl turns any website into clean data.' },
  { id: 'l2', text: 'It reads the page the way you would.' },
  { id: 'l3', text: 'Try it on your own site today.' },
];
const SCENES = [
  { scene_id: 's1', lines: ['l1'] },
  { scene_id: 's2', lines: ['l2'] },
  { scene_id: 's3', lines: ['l3'] },
];

let A: Run = { dir: '', id: '' };
let B: Run = { dir: '', id: '' };

try {
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;
  RUNS = makeTemp('vm-runs-');

  await check('1. synth: vo.wav is 48 kHz mono and as long as the three lines plus 0.5 s', async () => {
    A = await newRun('Clean data from any website');
    await prepare(A, SCRIPT_A);
    await callOk('voice', ['synth', A.dir]);
    const vo = path.join(A.dir, 'audio', 'vo.wav');
    const layout = (await probe(vo, 'stream=sample_rate,channels')).split(',').sort().join(',');
    if (layout !== '1,48000') throw new Error(`vo.wav sample_rate,channels is ${layout}, want 48000,1`);
    const lines = await Promise.all(SCRIPT_A.map((l) => durationOf(lineFile(A, l.text))));
    const want = lines.reduce((sum, d) => sum + d, 0) + 0.5;
    const got = await durationOf(vo);
    if (Math.abs(got - want) > TOL_S) throw new Error(`vo.wav is ${got.toFixed(2)} s, want ${want.toFixed(2)} s`);
    return `run ${A.dir}; vo.wav 48000 Hz mono, ${got.toFixed(2)} s`;
  });

  await check('2. align: every line has conf >= 0.6, "clean data" sits in l1, "data" is refused in l3', async () => {
    const out = (await callOk('voice', ['align', A.dir])) as { lines: { id?: string; conf: number }[] };
    for (const l of SCRIPT_A) {
      const timed = out.lines.find((x) => x.id === l.id);
      if (!timed || timed.conf < 0.6) throw new Error(`line ${l.id} missing or conf ${timed?.conf} < 0.6`);
    }
    const timing = readJson(path.join(A.dir, 'data', 'timing.json'), TimingSchema);
    const l1 = lineOf(timing, 'l1');
    const span = wordOf(l1, 'clean data');
    if (!(span.start < span.end)) throw new Error(`"clean data" span ${span.start}-${span.end} is empty`);
    if (span.start < l1.start - TOL_S || span.end > l1.end + TOL_S)
      throw new Error(`"clean data" ${span.start}-${span.end} is outside l1 ${l1.start}-${l1.end}`);
    try {
      wordOf(lineOf(timing, 'l3'), 'data');
    } catch (e) {
      if (!/has no "data"/.test(String((e as Error).message))) throw e;
      return `l1 "clean data" ${span.start.toFixed(2)}-${span.end.toFixed(2)} s; l3 has no "data"`;
    }
    throw new Error('wordOf found "data" in l3, which must be scoped to its own line');
  });

  await check('3. re-time: a longer l1 moves s2 and s3 at least 0.5 s later; only l1 is re-voiced', async () => {
    const before = sceneTimes(SCENES, timedLines(readJson(path.join(A.dir, 'data', 'timing.json'), TimingSchema)));
    const l2 = lineFile(A, SCRIPT_A[1]?.text ?? '');
    const l3 = lineFile(A, SCRIPT_A[2]?.text ?? '');
    const mtimes = [statSync(l2).mtimeMs, statSync(l3).mtimeMs];
    const filesBefore = new Set(readdirSync(path.join(A.dir, 'audio', 'lines')));
    const v2 = [
      { id: 'l1', text: 'Firecrawl turns any website, any page at all, into clean data.' },
      SCRIPT_A[1] as Line,
      SCRIPT_A[2] as Line,
    ];
    await writeScript(A, 2, v2);
    await callOk('voice', ['synth', A.dir]);
    if (statSync(l2).mtimeMs !== mtimes[0] || statSync(l3).mtimeMs !== mtimes[1])
      throw new Error('l2 or l3 was re-voiced; the per-line cache must keep unchanged lines');
    const added = readdirSync(path.join(A.dir, 'audio', 'lines')).filter((f) => !filesBefore.has(f));
    if (added.length !== 1 || added[0] !== path.basename(lineFile(A, v2[0]?.text ?? '')))
      throw new Error(`expected one new clip for l1, got ${added.join(', ') || 'none'}`);
    await callOk('voice', ['align', A.dir]);
    const after = sceneTimes(SCENES, timedLines(readJson(path.join(A.dir, 'data', 'timing.json'), TimingSchema)));
    for (const i of [1, 2]) {
      const shift = (after[i]?.start_s ?? 0) - (before[i]?.start_s ?? 0);
      if (shift < 0.5) throw new Error(`${after[i]?.scene_id} moved ${shift.toFixed(2)} s, want at least 0.5 s`);
    }
    return `s2 ${before[1]?.start_s.toFixed(2)} -> ${after[1]?.start_s.toFixed(2)} s; s3 ${before[2]?.start_s.toFixed(2)} -> ${after[2]?.start_s.toFixed(2)} s`;
  });

  await check(
    '4. low confidence by name: a supplied voice that does not say l2 is refused, naming l2 only',
    async () => {
      if (!A.dir) throw new Error('run A was not created (check 1 failed)');
      B = await newRun('Bananas and elephants');
      mkdirSync(path.join(B.dir, 'sources'), { recursive: true });
      copyFileSync(path.join(A.dir, 'audio', 'vo.wav'), path.join(B.dir, 'sources', 'voice.wav'));
      const lines: Line[] = [
        SCRIPT_A[0] as Line,
        { id: 'l2', text: 'Bananas eat purple elephants on a Tuesday morning.' },
        SCRIPT_A[2] as Line,
      ];
      await prepare(B, lines, { source: 'supplied', path: 'sources/voice.wav' });
      await callOk('voice', ['synth', B.dir]);
      const message = await callRefused('voice', ['align', B.dir]);
      if (!/\bl2\b/.test(message) || /\bl1\b|\bl3\b/.test(message))
        throw new Error(`refusal must name l2 only: ${message}`);
      if (existsSync(path.join(B.dir, 'data', 'timing.json')))
        throw new Error('refused run still wrote data/timing.json');
      return `refused: ${message}`;
    },
  );

  await check('5. where: run A stops at M11 or M12 once the voiceover is timed', async () => {
    if (!A.dir) throw new Error('run A was not created (check 1 failed)');
    // stand-ins; where checks existence only
    mkdirSync(path.join(A.dir, 'look'), { recursive: true });
    writeFileSync(path.join(A.dir, 'look', 'look.json'), '{}');
    writeFileSync(path.join(A.dir, 'plan.json'), '{}');
    const w = await callOk('run', ['where', A.dir]);
    if (w.next !== 'M11' && w.next !== 'M12') throw new Error(`where: ${JSON.stringify(w)}`);
    return `next ${w.next}`;
  });
} finally {
  if (process.env.KEEP === '1') console.log(`KEEP=1: temp dirs kept: ${temps.join(', ')}`);
  else removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
