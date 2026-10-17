// Phase 7 acceptance test (real HyperFrames, Chrome, ffmpeg and the uv aligner; several minutes).
//   node_modules/.bin/bun tests/phase7.ts        (KEEP=1 keeps the temp run and prints its path)
// One temp run under one temp folder, removed at the end. 1. scenes  2. mix  3. export
// 4. feedback on scene 3  5. only scene 3 changes  6. plan change  7. source projects untouched
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Look } from '../lib/contracts/types';
import { AssetsSchema, LookSchema, TestResultsSchema, TimingSchema } from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson, writeJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const MIN = 60_000;
const FC_HOME = 'https://www.firecrawl.dev/';
const FEEDBACK = 'make scene 3 slower';
const THIRD = 'cta';
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
      console.error(`[phase7] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
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
type Cli = 'run' | 'research' | 'script' | 'voice' | 'scenes' | 'storyboard' | 'review' | 'deliver';
type Line = { id: string; text: string };
type Run = { dir: string; id: string };
type Beat = { on: string; does: string };
type Cut = { anchor: string; rule: 'pause_before' | 'on_word' };
type Todo = { scene_id: string; reason: string; feedback?: string };

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

/** The ffprobe fields of a file as CSV lines, one per stream or section; `stream` selects e.g. `v:0`. */
const probe = async (file: string, entries: string, stream?: string): Promise<string> =>
  (
    await sh(
      [
        'ffprobe',
        '-v',
        'error',
        ...(stream ? ['-select_streams', stream] : []),
        '-show_entries',
        entries,
        '-of',
        'csv=p=0',
        file,
      ],
      {
        env: loadConfig(ENV).toolEnv,
      },
    )
  ).stdout.trim();

/** The duration of a media file in seconds. */
const durationOf = async (file: string): Promise<number> => Number(await probe(file, 'format=duration'));

/** Integrated loudness (LUFS) and true peak (dBFS) of a file, from the ebur128 summary on stderr. */
const loudness = async (file: string): Promise<{ i: number; tp: number }> => {
  const r = await sh(['ffmpeg', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], {
    env: loadConfig(ENV).toolEnv,
    timeoutMs: 5 * MIN,
  });
  const i = /Integrated loudness:\s*\n\s*I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(r.stderr);
  const tp = /Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/.exec(r.stderr);
  if (!i || !tp) throw new Error(`ebur128 printed no summary for ${file}: ${r.stderr.slice(-300)}`);
  return { i: Number(i[1]), tp: Number(tp[1]) };
};

/** Codec, profile and decoded frame count of a file's first video stream. */
const frameCount = async (file: string): Promise<{ codec: string; profile: string; n: number }> => {
  const line = (
    await sh(
      [
        'ffprobe',
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,profile,nb_read_frames',
        '-of',
        'csv=p=0',
        file,
      ],
      { env: loadConfig(ENV).toolEnv },
    )
  ).stdout.trim();
  const [codec = '', profile = '', n = ''] = line.split(',');
  return { codec, profile, n: Number(n) };
};

/** The SHA-256 of a file, hex. */
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The SHA-256 of every html file in a folder, by name. */
const hashHtml = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => [f, sha(path.join(dir, f))]),
  );

/** The reel total in seconds: the last word's end plus the 1.0 s tail (as check 1 of phase 6). */
const reelTotal = (r: Run): number => {
  const timing = readJson(path.join(r.dir, 'data', 'timing.json'), TimingSchema);
  return (timing.lines.at(-1)?.words.at(-1)?.end ?? 0) + 1.0;
};

/** A run-relative POSIX path from a CLI result, as a path on this OS. */
const inRun = (r: Run, rel: string): string => path.join(r.dir, ...rel.split('/'));

/** The scenes todo list, as the CLI reports it. */
const todoOf = async (r: Run): Promise<Todo[]> => (await callOk('scenes', ['todo', r.dir])).todo as Todo[];

/** A fresh run in the shared temp folder. */
const newRun = async (concept: string): Promise<Run> => {
  const a = await callOk('run', ['new', '--concept', '-', '--runs', RUNS], { stdin: `${concept}\n` });
  return { dir: String(a.run_dir), id: String(a.run_id) };
};

/** Script v`version` of the run; the refusal, if any, is thrown. */
const writeScript = (r: Run, version: number, lines: Line[]) =>
  callOk('script', ['write', r.dir], { stdin: JSON.stringify({ run_id: r.id, version, lines }) });

/** Music, brief (voiceover, supplied music, three deliverables), research, an empty asset list and script v1. */
const prepare = async (r: Run, lines: Line[]) => {
  mkdirSync(path.join(r.dir, 'input'), { recursive: true });
  await sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=c=pink:r=44100:d=30:a=0.3',
      '-ac',
      '2',
      path.join(r.dir, 'input', 'music.wav'),
    ],
    { env: loadConfig(ENV).toolEnv, timeoutMs: MIN },
  );
  // A three-line reel runs about 8 s; the format default (15-30 s) would fail timing.duration.
  await callOk('run', ['brief', r.dir], {
    stdin: JSON.stringify({
      sources: [],
      timing_source: 'voiceover',
      duration_target_s: [5, 12],
      music: { source: 'supplied', path: 'input/music.wav' },
      deliverables: [
        { format: 'reel', kind: 'mp4_h264', captions: 'burned' },
        { format: 'reel', kind: 'srt', captions: 'separate' },
        { format: 'reel', kind: 'ae_package', captions: 'separate' },
      ],
    }),
  });
  await callOk('research', ['write', r.dir], { stdin: RESEARCH_MD });
  writeJson(path.join(r.dir, 'assets.json'), AssetsSchema, { run_id: r.id, assets: [] });
  await writeScript(r, 1, lines);
};

/** One plan scene: the lines it covers, its cut, its beats and its assets. No input_hash: storyboard write computes it. */
const sceneOf = (scene_id: string, lines: string[], cut_in: Cut, beats: Beat[], asset_ids: string[]) => ({
  scene_id,
  lines,
  cut_in,
  intent: `${scene_id} stand-in`,
  beats,
  layout: { reel: 'centre' },
  transition_out: 'cut',
  asset_ids,
});

/** The three stand-in scenes. The cta scene starts on "own", so a word inserted before it moves its start. */
const planScenes = () => [
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
    THIRD,
    ['l3'],
    { anchor: 'own', rule: 'on_word' },
    [
      { on: 'site', does: 'bar grows' },
      { on: 'today', does: 'bar turns white' },
    ],
    [],
  ),
];

/** The plan scenes with one scene's intent replaced. */
const withIntent = (scenes: ReturnType<typeof planScenes>, id: string, intent: string) =>
  scenes.map((s) => (s.scene_id === id ? { ...s, intent } : s));

/** Copies the stand-in fragments of the given scenes into the run's scenes folder, as a scene writer would. */
const copyFragments = (r: Run, ids: string[]) => {
  for (const id of ids)
    copyFileSync(path.join(WS, 'tests', 'phase6', 'scenes', `${id}.html`), path.join(r.dir, 'scenes', `${id}.html`));
};

/** Look, one licensed photo and the plan: what `scenes todo` needs beside the voice. No fragments yet. */
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
  await callOk('storyboard', ['write', r.dir], { stdin: JSON.stringify({ scenes: planScenes() }) });
};

let A: Run = { dir: '', id: '' };
// Hashes taken before the feedback snapshot (check 4), compared again after the rewrite (check 5).
let fragmentsAt4: Record<string, string> = {};
let compositionsAt4: Record<string, string> = {};

try {
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;
  RUNS = makeTemp('vm-runs-');

  await check('1. scenes: todo lists three new, done + build + check pass, where -> M16', async () => {
    A = await newRun('Clean data from any website');
    await prepare(A, SCRIPT);
    await callOk('voice', ['synth', A.dir]);
    await callOk('voice', ['align', A.dir]);
    await stageRun(A);
    const before = await todoOf(A);
    if (before.length !== 3 || before.some((t) => t.reason !== 'new'))
      throw new Error(`todo before writing: ${JSON.stringify(before)}`);
    copyFragments(A, ['hook', 'demo', THIRD]);
    await callOk('scenes', ['done', A.dir, 'hook', 'demo', THIRD]);
    await callOk('scenes', ['build', A.dir]);
    const checked = await callOk('scenes', ['check', A.dir]);
    if (checked.blocking_failed !== 0) throw new Error(`blocking_failed ${String(checked.blocking_failed)}`);
    const next = (await callOk('run', ['where', A.dir])).next;
    if (next !== 'M16') throw new Error(`where -> ${String(next)}, want M16`);
    return `3 scenes new, then built and checked; where -> M16`;
  });

  await check('2. mix: music supplied, loudness on target, duration = reel total, where -> M17', async () => {
    const out = await callOk('deliver', ['mix', A.dir]);
    if (out.music !== 'input/music.wav') throw new Error(`music is ${String(out.music)}`);
    const mix = path.join(A.dir, 'audio', 'mix.wav');
    const { i, tp } = await loudness(mix);
    if (Math.abs(i - -14) > 1) throw new Error(`mix I is ${i} LUFS, want -14 ±1`);
    if (tp > -1) throw new Error(`mix true peak is ${tp} dBFS, want ≤ -1`);
    const total = reelTotal(A);
    const got = await durationOf(mix);
    if (Math.abs(got - total) > 0.05) throw new Error(`mix is ${got.toFixed(2)} s, want ${total.toFixed(2)} s`);
    const next = (await callOk('run', ['where', A.dir])).next;
    if (next !== 'M17') throw new Error(`where -> ${String(next)}, want M17`);
    return `I ${i} LUFS, true peak ${tp} dBFS, ${got.toFixed(2)} s; where -> M17`;
  });

  await check('3. export: MP4, SRT and AE package match the brief; test_results pass; where -> done', async () => {
    const out = await callOk('deliver', ['export', A.dir]);
    const outs = out.deliverables as string[];
    const mp4 = outs.find((p) => p.endsWith('.mp4'));
    const srt = outs.find((p) => p.endsWith('.srt'));
    const ae = outs.find((p) => !p.endsWith('.mp4') && !p.endsWith('.srt'));
    if (!mp4 || !srt || !ae) throw new Error(`deliverables ${JSON.stringify(outs)}`);
    const total = reelTotal(A);

    const file = inRun(A, mp4);
    const video = (await probe(file, 'stream=codec_name,width,height,r_frame_rate', 'v:0')).split(',');
    const audio = (await probe(file, 'stream=codec_name,sample_rate', 'a:0')).split(',');
    if (video[0] !== 'h264' || video[1] !== '1080' || video[2] !== '1920' || video[3] !== '30/1')
      throw new Error(`mp4 video is ${video.join(',')}`);
    if (audio[0] !== 'aac' || audio[1] !== '48000') throw new Error(`mp4 audio is ${audio.join(',')}`);
    const got = await durationOf(file);
    if (Math.abs(got - total) > 0.1) throw new Error(`mp4 is ${got.toFixed(2)} s, want ${total.toFixed(2)} s`);
    const { i } = await loudness(file);
    if (Math.abs(i - -14) > 1) throw new Error(`mp4 I is ${i} LUFS, want -14 ±1`);

    const cues = readFileSync(inRun(A, srt), 'utf8')
      .split(/\r?\n\r?\n/)
      .map((b) => b.trim())
      .filter((b) => b.includes('-->'));
    if (cues.length < 3) throw new Error(`srt has ${cues.length} cues, want ≥ 3`);
    const cueLines = (cues[0] ?? '').split(/\r?\n/);
    const text = cueLines.slice(cueLines.findIndex((l) => l.includes('-->')) + 1).join(' ');
    const firstWord = SCRIPT[0]?.text.split(' ')[0] ?? '';
    if (!text.startsWith(firstWord)) throw new Error(`first srt cue is "${text}", want it to start with ${firstWord}`);

    const aeDir = inRun(A, ae);
    const movs = readdirSync(path.join(aeDir, 'scenes'))
      .filter((f) => f.endsWith('.mov'))
      .map((f) => path.join(aeDir, 'scenes', f));
    if (movs.length !== 3) throw new Error(`ae package has ${movs.length} scene clips, want 3`);
    let frames = 0;
    for (const mov of movs) {
      const f = await frameCount(mov);
      if (f.codec !== 'prores' || !f.profile.startsWith('4444'))
        throw new Error(`${path.basename(mov)} is ${f.codec} ${f.profile}, want ProRes 4444`);
      frames += f.n;
    }
    const want = Math.round(total * 30);
    if (frames !== want) throw new Error(`ae clips hold ${frames} frames, want ${want}`);
    new Function(readFileSync(path.join(aeDir, 'build_comp.jsx'), 'utf8'));

    const tr = readJson(path.join(A.dir, 'test_results.json'), TestResultsSchema);
    for (const id of ['deliver.files', 'audio.loudness']) {
      const c = tr.checks.find((x) => x.id === id);
      if (c?.status !== 'pass') throw new Error(`test_results ${id} is ${c?.status ?? 'missing'}, want pass`);
    }
    const next = (await callOk('run', ['where', A.dir])).next;
    if (next !== 'done') throw new Error(`where -> ${String(next)}, want done`);
    return `mp4 ${got.toFixed(2)} s, I ${i} LUFS; srt ${cues.length} cues; ae ${frames} frames; where -> done`;
  });

  await check(
    '4. feedback "make scene 3 slower": snapshot keeps fragments, drops build, deliver and results',
    async () => {
      const scenesDir = path.join(A.dir, 'scenes');
      const compDir = path.join(A.dir, 'build', 'reel', 'compositions');
      fragmentsAt4 = hashHtml(scenesDir);
      compositionsAt4 = hashHtml(compDir);
      const vo = sha(path.join(A.dir, 'audio', 'vo.wav'));
      const mix = sha(path.join(A.dir, 'audio', 'mix.wav'));

      await callOk('review', ['snapshot', A.dir, '--route', 'scenes', '--scenes', THIRD], { stdin: FEEDBACK });

      const hist = path.join(A.dir, 'history', '1');
      if (!readFileSync(path.join(hist, 'feedback.json'), 'utf8').includes(FEEDBACK))
        throw new Error('history/1/feedback.json does not hold the feedback text');
      for (const id of ['hook', 'demo', THIRD])
        if (!existsSync(path.join(hist, 'scenes', `${id}.html`)))
          throw new Error(`history/1/scenes/${id}.html missing`);
      for (const gone of ['build', path.join('out', 'deliver'), 'test_results.json'])
        if (existsSync(path.join(A.dir, gone))) throw new Error(`${gone} still exists after the snapshot`);
      if (sha(path.join(A.dir, 'audio', 'vo.wav')) !== vo) throw new Error('audio/vo.wav changed');
      if (sha(path.join(A.dir, 'audio', 'mix.wav')) !== mix) throw new Error('audio/mix.wav changed');

      const next = (await callOk('run', ['where', A.dir])).next;
      if (next !== 'M12') throw new Error(`where -> ${String(next)}, want M12`);

      const todo = await todoOf(A);
      const cta = todo.find((t) => t.scene_id === THIRD);
      if (todo.length !== 1 || cta?.reason !== 'feedback' || cta.feedback !== FEEDBACK)
        throw new Error(`todo is ${JSON.stringify(todo)}, want only ${THIRD} with reason feedback`);

      const built = await call('scenes', ['build', A.dir]);
      if (built.code === 0) throw new Error('build succeeded with a feedback note pending');
      if (!String(built.out.message ?? '').includes(THIRD))
        throw new Error(`build message does not name ${THIRD}: ${JSON.stringify(built.out)}`);
      return `history/1 holds feedback and 3 fragments; where -> M12; todo = ${THIRD} (feedback); build refused`;
    },
  );

  await check('5. only scene 3 changes: other fragments and compositions byte-identical, redo.json gone', async () => {
    const html = readFileSync(path.join(WS, 'tests', 'phase6', 'scenes', `${THIRD}.html`), 'utf8');
    const slower = html.replace('duration: 0.4', 'duration: s.duration * 0.5');
    if (slower === html) throw new Error(`${THIRD}.html has no "duration: 0.4" tween to stretch`);
    writeFileSync(path.join(A.dir, 'scenes', `${THIRD}.html`), slower);
    await callOk('scenes', ['done', A.dir, THIRD]);
    await callOk('scenes', ['build', A.dir]);
    const checked = await callOk('scenes', ['check', A.dir]);
    if (checked.blocking_failed !== 0) throw new Error(`blocking_failed ${String(checked.blocking_failed)}`);

    const fragmentsNow = hashHtml(path.join(A.dir, 'scenes'));
    const compositionsNow = hashHtml(path.join(A.dir, 'build', 'reel', 'compositions'));
    for (const [label, before, now] of [
      ['scenes', fragmentsAt4, fragmentsNow],
      ['compositions', compositionsAt4, compositionsNow],
    ] as const) {
      for (const file of Object.keys(before)) {
        const same = before[file] === now[file];
        if (file === `${THIRD}.html` && same) throw new Error(`${label}/${file} did not change`);
        if (file !== `${THIRD}.html` && !same) throw new Error(`${label}/${file} changed`);
      }
    }
    if (existsSync(path.join(A.dir, 'scenes', 'redo.json'))) throw new Error('scenes/redo.json still exists');
    return `${THIRD} fragment and composition changed; the other two unchanged; redo.json gone`;
  });

  await check('6. plan change: only the first scene changed, todo = first scene (changed)', async () => {
    const first = 'hook';
    const out = await callOk('storyboard', ['write', A.dir], {
      stdin: JSON.stringify({ scenes: withIntent(planScenes(), first, `${first} stand-in, revised`) }),
    });
    if (JSON.stringify(out.changed) !== JSON.stringify([first]))
      throw new Error(`changed is ${JSON.stringify(out.changed)}, want ["${first}"]`);
    const todo = await todoOf(A);
    const [only] = todo;
    if (todo.length !== 1 || only?.scene_id !== first || only?.reason !== 'changed')
      throw new Error(`todo is ${JSON.stringify(todo)}, want only ${first} (changed)`);
    return `changed = [${first}]; todo = ${first} (changed)`;
  });

  await check('7. source projects: video-testing listing matches tests/phase0/video-testing.before.txt', async () => {
    const SOURCE = process.env.VM_VIDEO_TESTING ?? 'C:/Work-data/video-testing';
    if (!existsSync(SOURCE)) return `skipped: ${SOURCE} not found; set VM_VIDEO_TESTING to the video-testing folder`;
    const now: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name),
          rel = `./${path.relative(SOURCE, p).replaceAll('\\', '/')}`;
        if (rel === './app/node_modules') continue;
        if (e.isDirectory()) walk(p);
        else now.push(`${statSync(p).size} ${rel}`);
      }
    };
    walk(SOURCE);
    const before = readFileSync(path.join(WS, 'tests/phase0/video-testing.before.txt'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean);
    const a = new Set(before),
      b = new Set(now);
    const gone = before.filter((l) => !b.has(l)),
      added = now.filter((l) => !a.has(l));
    if (gone.length || added.length)
      throw new Error([...gone.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n'));
    return `${now.length} files, same names and sizes`;
  });
} finally {
  if (process.env.KEEP === '1') console.log(`KEEP=1: temp dirs kept: ${temps.join(', ')}`);
  else removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
