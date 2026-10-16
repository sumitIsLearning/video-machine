// Phase 6 acceptance test (real HyperFrames, Chrome, ffmpeg and the uv aligner; several minutes).
//   node_modules/.bin/bun tests/phase6.ts        (KEEP=1 keeps the temp run and prints its path)
// One temp run under one temp folder, removed at the end. 1. build  2. clean checks  3. re-time
// 4. broken scene  5. lint gate
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Look } from '../lib/contracts/types';
import { AssetsSchema, LookSchema, PlanSchema, TestResultsSchema, TimingSchema } from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson, writeJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const MIN = 60_000;
const TOL_S = 0.05;
const FC_HOME = 'https://www.firecrawl.dev/';
const FAILS = ['layout.min_text_size', 'layout.safe_area', 'timing.beats_on_cues'];
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
      console.error(`[phase6] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
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
type Cli = 'run' | 'research' | 'script' | 'voice' | 'scenes';
type Line = { id: string; text: string };
type Run = { dir: string; id: string };
type Beat = { on: string; does: string };
type Cut = { anchor: string; rule: 'pause_before' | 'on_word' };

const RESEARCH_MD = `# Firecrawl

## Facts
- Firecrawl turns a web page into LLM-ready markdown — "Turn any website into LLM-ready data." — ${FC_HOME}
`;

const SCRIPT: Line[] = [
  { id: 'l1', text: 'Firecrawl turns any website into clean data.' },
  { id: 'l2', text: 'It reads the page the way you would.' },
  { id: 'l3', text: 'Try it on your own site today.' },
];

const LOOK: Look = {
  id: 'ember',
  based_on: [],
  idea: 'orange heat on black',
  palette: [
    { name: 'ink', hex: '#111111', role: 'bg' },
    { name: 'fire', hex: '#FF4D00', role: 'accent' },
  ],
  type: [{ role: 'display', family: 'Inter', weights: [700], license: 'OFL' }],
  motion: { character: 'snappy', easings: ['power3.out'], typical_beat_s: [0.4, 0.8], camera: 'static' },
  motifs: [{ id: 'cursor', meaning: 'action' }],
  post: {},
  layout_rules: { landscape: '', vertical: 'stack', square: '' },
};

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

/** The ffprobe fields of a file as CSV lines, one per stream or section. */
const probe = async (file: string, entries: string): Promise<string> =>
  (
    await sh(['ffprobe', '-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file], {
      env: loadConfig(ENV).toolEnv,
    })
  ).stdout.trim();

/** The duration of a media file in seconds. */
const durationOf = async (file: string): Promise<number> => Number(await probe(file, 'format=duration'));

/** The SHA-256 of a file, hex. */
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The SHA-256 of every file in a folder, by name. */
const hashDir = (dir: string): Record<string, string> =>
  Object.fromEntries(readdirSync(dir).map((f) => [f, sha(path.join(dir, f))]));

/** The data-start of a scene's host element in the built reel composition. */
const hostStart = (r: Run, sceneId: string): number => {
  const html = readFileSync(path.join(r.dir, 'build', 'reel', 'index.html'), 'utf8');
  const m = new RegExp(`id="host-${sceneId}"[^>]*data-start="([^"]+)"`).exec(html);
  if (!m) throw new Error(`build/reel/index.html has no host-${sceneId} with a data-start`);
  return Number(m[1]);
};

/** A fresh run in the shared temp folder. */
const newRun = async (concept: string): Promise<Run> => {
  const a = await callOk('run', ['new', '--concept', '-', '--runs', RUNS], { stdin: `${concept}\n` });
  return { dir: String(a.run_dir), id: String(a.run_id) };
};

/** Script v`version` of the run; the refusal, if any, is thrown. */
const writeScript = (r: Run, version: number, lines: Line[]) =>
  callOk('script', ['write', r.dir], { stdin: JSON.stringify({ run_id: r.id, version, lines }) });

/** Brief (voiceover), research, an empty asset list and script v1: what a run needs before it is voiced. */
const prepare = async (r: Run, lines: Line[]) => {
  // A three-line reel runs about 8 s; the format default (15-30 s) would fail timing.duration.
  await callOk('run', ['brief', r.dir], {
    stdin: JSON.stringify({ sources: [], timing_source: 'voiceover', duration_target_s: [5, 12] }),
  });
  await callOk('research', ['write', r.dir], { stdin: RESEARCH_MD });
  writeJson(path.join(r.dir, 'assets.json'), AssetsSchema, { run_id: r.id, assets: [] });
  await writeScript(r, 1, lines);
};

/** One plan scene: the lines it covers, its cut, its beats and its assets. */
const sceneOf = (scene_id: string, lines: string[], cut_in: Cut, beats: Beat[], asset_ids: string[]) => ({
  scene_id,
  lines,
  cut_in,
  intent: `${scene_id} stand-in`,
  beats,
  layout: { reel: 'centre' },
  transition_out: 'cut',
  asset_ids,
  input_hash: 'h',
});

/**
 * Look, one licensed photo, the plan and the three stand-in scenes: what `build` needs beside the voice.
 * The cta scene starts on "own", so a word inserted before it moves its start (check 3).
 */
const stageRun = async (r: Run) => {
  mkdirSync(path.join(r.dir, 'look'), { recursive: true });
  mkdirSync(path.join(r.dir, 'assets'), { recursive: true });
  mkdirSync(path.join(r.dir, 'scenes'), { recursive: true });
  writeJson(path.join(r.dir, 'look', 'look.json'), LookSchema, LOOK);
  await sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=400x400',
      '-frames:v',
      '1',
      path.join(r.dir, 'assets', 'photo.png'),
    ],
    { env: loadConfig(ENV).toolEnv, timeoutMs: MIN },
  );
  writeJson(path.join(r.dir, 'assets.json'), AssetsSchema, {
    run_id: r.id,
    assets: [
      {
        asset_id: 'photo',
        kind: 'image',
        path: 'assets/photo.png',
        source: FC_HOME,
        license: 'CC0 1.0 (generated test image)',
        usage: 'render',
        origin: 'supplied',
      },
    ],
  });
  writeJson(path.join(r.dir, 'plan.json'), PlanSchema, {
    run_id: r.id,
    version: 1,
    look_id: LOOK.id,
    visuals_plan: {
      scenes: [
        sceneOf(
          'hook',
          ['l1'],
          { anchor: 'Firecrawl', rule: 'pause_before' },
          [
            { on: 'Firecrawl', does: 'orange panel opens' },
            { on: 'clean', does: 'panel settles' },
          ],
          ['photo'],
        ),
        sceneOf('demo', ['l2'], { anchor: 'It', rule: 'pause_before' }, [{ on: 'reads', does: 'card slides in' }], []),
        sceneOf(
          'cta',
          ['l3'],
          { anchor: 'own', rule: 'on_word' },
          [
            { on: 'site', does: 'bar grows' },
            { on: 'today', does: 'bar turns white' },
          ],
          [],
        ),
      ],
    },
    asset_ids: ['photo'],
    formats: ['reel'],
  });
  for (const id of ['hook', 'demo', 'cta'])
    copyFileSync(path.join(WS, 'tests', 'phase6', 'scenes', `${id}.html`), path.join(r.dir, 'scenes', `${id}.html`));
};

let A: Run = { dir: '', id: '' };

try {
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;
  RUNS = makeTemp('vm-runs-');

  await check('1. build: 1080x1920, 30 fps, audio, duration = last word + 1.0 s, sheet and draft exist', async () => {
    A = await newRun('Clean data from any website');
    await prepare(A, SCRIPT);
    await callOk('voice', ['synth', A.dir]);
    await callOk('voice', ['align', A.dir]);
    await stageRun(A);
    await callOk('scenes', ['build', A.dir]);
    for (const f of ['build/reel/index.html', 'out/sheets/reel.jpg', 'out/drafts/reel.mp4']) {
      if (!existsSync(path.join(A.dir, f))) throw new Error(`${f} is missing`);
    }
    const draft = path.join(A.dir, 'out', 'drafts', 'reel.mp4');
    const streams = (await probe(draft, 'stream=codec_type,width,height,r_frame_rate')).split(/\r?\n/);
    if (!streams.includes('video,1080,1920,30/1')) throw new Error(`video stream is ${streams.join(' | ')}`);
    if (!streams.some((l) => l.startsWith('audio,'))) throw new Error(`no audio stream: ${streams.join(' | ')}`);
    const timing = readJson(path.join(A.dir, 'data', 'timing.json'), TimingSchema);
    const want = (timing.lines.at(-1)?.words.at(-1)?.end ?? 0) + 1.0;
    const got = await durationOf(draft);
    if (Math.abs(got - want) > 0.1) throw new Error(`draft is ${got.toFixed(2)} s, want ${want.toFixed(2)} s`);
    return `run ${A.dir}; draft ${got.toFixed(2)} s, want ${want.toFixed(2)} s`;
  });

  await check('2. clean checks: blocking_failed 0, test_results.json parses, where -> M16', async () => {
    if (!A.dir) throw new Error('run A was not built (check 1 failed)');
    const out = await callOk('scenes', ['check', A.dir]);
    if (out.blocking_failed !== 0) throw new Error(`blocking_failed ${String(out.blocking_failed)}`);
    readJson(path.join(A.dir, 'test_results.json'), TestResultsSchema);
    const w = await callOk('run', ['where', A.dir]);
    if (w.next !== 'M16') throw new Error(`where: ${JSON.stringify(w)}`);
    return 'blocking_failed 0; where M16';
  });

  await check('3. re-time: a word before the cta cut moves its data-start; no file in scenes/ changes', async () => {
    if (!A.dir) throw new Error('run A was not built (check 1 failed)');
    const before = hostStart(A, 'cta');
    const hashesBefore = hashDir(path.join(A.dir, 'scenes'));
    const v2 = [SCRIPT[0] as Line, SCRIPT[1] as Line, { id: 'l3', text: 'Try it on your very own site today.' }];
    await writeScript(A, 2, v2);
    await callOk('voice', ['synth', A.dir]);
    await callOk('voice', ['align', A.dir]);
    await callOk('scenes', ['build', A.dir]);
    const after = hostStart(A, 'cta');
    if (Math.abs(after - before) < TOL_S) throw new Error(`cta data-start stayed at ${before.toFixed(2)} s`);
    if (JSON.stringify(hashDir(path.join(A.dir, 'scenes'))) !== JSON.stringify(hashesBefore))
      throw new Error('a file in scenes/ changed during the re-time');
    return `cta data-start ${before.toFixed(2)} -> ${after.toFixed(2)} s; scenes/ unchanged`;
  });

  await check(
    '4. broken scene: build ok; check fails layout.safe_area, layout.min_text_size, timing.beats_on_cues on demo',
    async () => {
      if (!A.dir) throw new Error('run A was not built (check 1 failed)');
      copyFileSync(
        path.join(WS, 'tests', 'phase6', 'scenes', 'demo-broken.html'),
        path.join(A.dir, 'scenes', 'demo.html'),
      );
      await callOk('scenes', ['build', A.dir]);
      const { out } = await call('scenes', ['check', A.dir]);
      const res = readJson(path.join(A.dir, 'test_results.json'), TestResultsSchema);
      const failed = res.checks.filter((c) => c.status === 'fail');
      const ids = failed.map((c) => c.id).sort();
      if (JSON.stringify(ids) !== JSON.stringify(FAILS))
        throw new Error(`failed checks ${ids.join(', ')}, want ${FAILS.join(', ')}`);
      for (const c of failed) {
        if (c.annotations.length === 0 || c.annotations.some((a) => a.scene_id !== 'demo'))
          throw new Error(`${c.id} annotations are not all scene_id demo: ${JSON.stringify(c.annotations)}`);
      }
      if (JSON.stringify(out.failing_scenes) !== '["demo"]')
        throw new Error(`failing_scenes ${JSON.stringify(out.failing_scenes)}`);
      return `failed ${ids.join(', ')}; failing_scenes ["demo"]`;
    },
  );

  await check(
    '5. lint gate: Math.random in demo makes build ok:false naming scene demo, and writes no new draft',
    async () => {
      if (!A.dir) throw new Error('run A was not built (check 1 failed)');
      const draft = path.join(A.dir, 'out', 'drafts', 'reel.mp4');
      const draftBefore = sha(draft);
      const good = readFileSync(path.join(WS, 'tests', 'phase6', 'scenes', 'demo.html'), 'utf8');
      writeFileSync(
        path.join(A.dir, 'scenes', 'demo.html'),
        good.replace('const s = VM.scene("demo");', 'const s = VM.scene("demo");\n  const jitter = Math.random();'),
      );
      const { out } = await call('scenes', ['build', A.dir]);
      if (out.ok !== false) throw new Error(`build returned ${JSON.stringify(out)}`);
      const lines = String(out.message ?? '').split('\n');
      if (!lines.some((l) => l.startsWith('scene demo: uses Math.random')))
        throw new Error(`message ${JSON.stringify(out.message)}`);
      if (sha(draft) !== draftBefore) throw new Error('the draft changed after a refused build');
      return 'build ok:false, message names scene demo: uses Math.random, draft unchanged';
    },
  );
} finally {
  if (process.env.KEEP === '1') console.log(`KEEP=1: temp dirs kept: ${temps.join(', ')}`);
  else removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
