// Phase 8 acceptance test (real HyperFrames, Chrome, ffmpeg, Kokoro and the aligner; several minutes).
//   node_modules/.bin/bun tests/phase8.ts        (KEEP=1 keeps the temp runs and prints their path)
// One temp run folder per check, all under one temp folder, removed at the end. 1. segments  2. matte  3. gate
// 4. layer  5. under  6. seek  7. review  8. heygen live (SKIP unless its env is set)
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Brief, Look, TestResults } from '../lib/contracts/types';
import {
  AssetsSchema,
  AvatarPlacementSchema,
  AvatarSegmentsSchema,
  BriefSchema,
  LookSchema,
  TestResultsSchema,
  TimingSchema,
} from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson, writeJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const MIN = 60_000;
const SKIP = 'SKIP: ';
const SCENE_IDS = ['hook', 'demo', 'proof', 'close'];
const SAFE_POS = 'left: var(--vm-safe-left); top: var(--vm-safe-top);';
const IN_BOX_POS = 'left: 50%; top: 62%;';
const BOX_CENTRE = { x: 801, y: 1251 };
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
      console.error(`[phase8] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
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
  const label = !result.ok ? 'FAIL' : result.detail.startsWith(SKIP) ? 'SKIP' : 'PASS';
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${label}  ${test}  (${secs}s)\n      ${result.detail.replace(/\n/g, '\n      ')}`);
};

type Json = Record<string, unknown>;
type Called = { code: number; out: Json };
type Cli = 'run' | 'research' | 'script' | 'voice' | 'scenes' | 'storyboard' | 'review' | 'avatar';
type Line = { id: string; text: string; delivery?: 'voiceover' | 'avatar' };
type Run = { dir: string; id: string };
type Beat = { on: string; does: string };
type Cut = { anchor: string; rule: 'pause_before' | 'on_word' };
type Check = TestResults['checks'][number];

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

const RESEARCH_MD = `# Firecrawl

## Facts
- Firecrawl turns a web page into LLM-ready markdown — "Turn any website into LLM-ready data." — https://www.firecrawl.dev/
`;

// l2 and l3 are delivered by the avatar: a01 spans l2.start to l3.end.
const SCRIPT: Line[] = [
  { id: 'l1', text: 'Clean data from any website.' },
  { id: 'l2', text: 'It reads the page the way you would.', delivery: 'avatar' },
  { id: 'l3', text: 'Try it on your own site today.', delivery: 'avatar' },
  { id: 'l4', text: 'Start free.' },
];

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

/**
 * Like `call`, but the CLI runs with `extraEnv` added to this process's env. `sh` strips *_KEY on purpose, so a
 * key reaches the CLI only through here. A non-zero exit is returned, not thrown.
 */
const callWithEnv = async (cli: Cli, args: string[], extraEnv: Record<string, string>): Promise<Called> => {
  const proc = Bun.spawn([bun, path.join(WS, 'lib', cli, 'cli.ts'), ...args], {
    cwd: WS,
    env: { ...process.env, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  try {
    return { code, out: JSON.parse(lastLine(stdout)) as Json };
  } catch (cause) {
    throw new Error(`${cli} ${args[0]}: output is not JSON\nstdout: ${stdout}\nstderr: ${stderr}`, { cause });
  }
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
      { env: loadConfig(ENV).toolEnv },
    )
  ).stdout.trim();

/** The duration of a media file in seconds. */
const durationOf = async (file: string): Promise<number> => Number(await probe(file, 'format=duration'));

/** The SHA-256 of a file, hex. */
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Two times are equal within 10 ms. */
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

/** The RGB bytes of one pixel of a video frame at time t. The raw bytes go to a file: sh decodes stdout as text. */
const pixelAt = async (video: string, t: number, x: number, y: number): Promise<number[]> => {
  const out = path.join(RUNS, 'px.rgb');
  await sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-ss',
      String(t),
      '-i',
      video,
      '-frames:v',
      '1',
      '-vf',
      `crop=1:1:${x}:${y},format=rgb24`,
      '-f',
      'rawvideo',
      out,
    ],
    { env: loadConfig(ENV).toolEnv, timeoutMs: MIN },
  );
  const bytes = readFileSync(out);
  if (bytes.length !== 3) throw new Error(`pixel (${x},${y}) at ${t} s of ${video}: ${bytes.length} bytes, want 3`);
  return [...bytes];
};

/** True for a pixel of the red disc: R above 200, G below 60. */
const isRed = (rgb: number[]): boolean => (rgb[0] ?? 0) > 200 && (rgb[1] ?? 0) < 60;

/** A red-disc alpha webm of the given length (the probe in the plan's tech stack). */
const makeDisc = (file: string, secs: number): Promise<unknown> =>
  sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=black@0:s=428x570:d=${secs},format=yuva420p`,
      '-vf',
      "geq=r='255':g='0':b='0':a='if(lt(hypot(X-214,Y-285),200),255,0)'",
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-an',
      file,
    ],
    { env: loadConfig(ENV).toolEnv, timeoutMs: 5 * MIN },
  );

/** A 720x1280 test clip of the given length, standing in for the creator's supplied video. */
const makeClip = (file: string, secs: number): Promise<unknown> =>
  sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=720x1280:rate=30:duration=${secs}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      file,
    ],
    { env: loadConfig(ENV).toolEnv, timeoutMs: 5 * MIN },
  );

/** A fresh run in the shared temp folder. */
const newRun = async (concept: string): Promise<Run> => {
  const a = await callOk('run', ['new', '--concept', '-', '--runs', RUNS], { stdin: `${concept}\n` });
  return { dir: String(a.run_dir), id: String(a.run_id) };
};

/** Script v`version` of the run; the refusal, if any, is thrown. */
const writeScript = (r: Run, version: number, lines: Line[]) =>
  callOk('script', ['write', r.dir], { stdin: JSON.stringify({ run_id: r.id, version, lines }) });

/** Music, brief (voiceover, three deliverables, `extra` merged in), research, an empty asset list and the script. */
const prepare = async (r: Run, lines: Line[], extra: Json = {}) => {
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
  await callOk('run', ['brief', r.dir], {
    stdin: JSON.stringify({
      sources: [],
      timing_source: 'voiceover',
      duration_target_s: [5, 15],
      music: { source: 'supplied', path: 'input/music.wav' },
      deliverables: [{ format: 'reel', kind: 'mp4_h264', captions: 'burned' }],
      ...extra,
    }),
  });
  await callOk('research', ['write', r.dir], { stdin: RESEARCH_MD });
  writeJson(path.join(r.dir, 'assets.json'), AssetsSchema, { run_id: r.id, assets: [] });
  await writeScript(r, 1, lines);
};

/** Sets the brief's avatar, once the files it names exist (`run brief` checks them). */
const setAvatar = (r: Run, avatar: NonNullable<Brief['avatar']>) => {
  const file = path.join(r.dir, 'brief.json');
  writeJson(file, BriefSchema, { ...readJson(file, BriefSchema), avatar });
};

/** One plan scene: the lines it covers, its cut, its beats and its assets. No input_hash: storyboard write computes it. */
const sceneOf = (scene_id: string, lines: string[], cut_in: Cut, beats: Beat[]) => ({
  scene_id,
  lines,
  cut_in,
  intent: `${scene_id} stand-in`,
  beats,
  layout: { reel: 'centre' },
  transition_out: 'cut',
  asset_ids: [],
});

/** Four stand-in scenes, one per line, so the plan covers the whole script. */
const planScenes = () => [
  sceneOf('hook', ['l1'], { anchor: 'Clean', rule: 'pause_before' }, [{ on: 'data', does: 'text fades in' }]),
  sceneOf('demo', ['l2'], { anchor: 'It', rule: 'pause_before' }, [{ on: 'reads', does: 'text fades in' }]),
  sceneOf('proof', ['l3'], { anchor: 'Try', rule: 'pause_before' }, [{ on: 'today', does: 'text fades in' }]),
  sceneOf('close', ['l4'], { anchor: 'Start', rule: 'pause_before' }, [{ on: 'free', does: 'text fades in' }]),
];

/** A scene fragment: a dark frame with the line's text at `pos` (CSS), faded in on its first word. */
const fragment = (id: string, text: string, pos: string): string => `<style>
  .f-frame { position: absolute; inset: 0; overflow: hidden; background: #111111; }
  .f-text { position: absolute; ${pos} width: calc(var(--vm-w) * 0.4); color: #FDFBF9; font-family: Inter, sans-serif; font-weight: 700; font-size: calc(var(--vm-w) * 0.06); line-height: 1.05; }
</style>
<div class="f-frame"><div class="f-text">${text}</div></div>
<script>
  const tl = gsap.timeline({ paused: true });
  window.__timelines["${id}"] = tl;
  const s = VM.scene("${id}");
  s.fit(document.querySelector(".f-text"));
  tl.fromTo(".f-text", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" }, s.at("${text.split(' ')[0]}"));
</script>
`;

/** Writes the four stand-in fragments; the scene named `moved` puts its text inside the avatar box. */
const writeFragments = (r: Run, moved?: string) => {
  SCRIPT.forEach((line, k) => {
    const id = SCENE_IDS[k] ?? '';
    writeFileSync(
      path.join(r.dir, 'scenes', `${id}.html`),
      fragment(id, line.text, id === moved ? IN_BOX_POS : SAFE_POS),
    );
  });
};

/** Look and storyboard: what `scenes todo` needs beside the voice and the avatar. No fragments yet. */
const stageRun = async (r: Run) => {
  mkdirSync(path.join(r.dir, 'look'), { recursive: true });
  mkdirSync(path.join(r.dir, 'scenes'), { recursive: true });
  writeJson(path.join(r.dir, 'look', 'look.json'), LookSchema, LOOK);
  await callOk('storyboard', ['write', r.dir], { stdin: JSON.stringify({ scenes: planScenes() }) });
};

/** The segments of the run's avatar/segments.json. */
const segmentsOf = (r: Run) => readJson(path.join(r.dir, 'avatar', 'segments.json'), AvatarSegmentsSchema).segments;

/** Builds the reel, then runs the checks. Returns the draft's path on this OS and the checks as written. */
const buildAndCheck = async (r: Run): Promise<{ draft: string; checks: Check[]; blocking: number }> => {
  const built = await callOk('scenes', ['build', r.dir]);
  const reel = (built.formats as Record<string, { draft: string }>).reel;
  if (reel === undefined) throw new Error('scenes build reported no reel format');
  const checked = await callOk('scenes', ['check', r.dir]);
  const tr = readJson(path.join(r.dir, 'test_results.json'), TestResultsSchema);
  return {
    draft: path.join(r.dir, ...reel.draft.split('/')),
    checks: tr.checks,
    blocking: Number(checked.blocking_failed),
  };
};

let A: Run = { dir: '', id: '' };
// The checks of the build from check 4; check 6 reads them after check 5 has refused its build.
let checksAt4: Check[] = [];

try {
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;
  RUNS = makeTemp('vm-runs-');

  await check('1. segments: l2+l3 become one segment a01 spanning l2.start to l3.end', async () => {
    A = await newRun('Clean data from any website');
    await prepare(A, SCRIPT);
    await callOk('voice', ['synth', A.dir]);
    await callOk('voice', ['align', A.dir]);
    await makeClip(path.join(A.dir, 'input', 'me.mp4'), (await durationOf(path.join(A.dir, 'audio', 'vo.wav'))) + 1);
    setAvatar(A, { source: 'supplied', clip: 'input/me.mp4' });
    await callOk('avatar', ['make', A.dir]);
    await stageRun(A);
    const timing = readJson(path.join(A.dir, 'data', 'timing.json'), TimingSchema).lines;
    const l2 = timing.find((l) => l.text === SCRIPT[1]?.text);
    const l3 = timing.find((l) => l.text === SCRIPT[2]?.text);
    const segs = segmentsOf(A);
    if (segs.length !== 1 || segs[0]?.seg !== 'a01') throw new Error(`segments: ${JSON.stringify(segs)}, want one a01`);
    if (!l2 || !l3 || !near(segs[0].start, l2.start) || !near(segs[0].end, l3.end))
      throw new Error(`a01 ${segs[0].start}-${segs[0].end} is not l2.start ${l2?.start} to l3.end ${l3?.end}`);
    return `a01 ${segs[0].start.toFixed(2)}-${segs[0].end.toFixed(2)} s`;
  });

  await check('2. matte: avatar/a01.webm is VP9 with alpha, no audio, as long as the segment', async () => {
    const webm = path.join(A.dir, 'avatar', 'a01.webm');
    const [codec = '', alpha = ''] = (await probe(webm, 'stream=codec_name:stream_tags=alpha_mode', 'v:0')).split(',');
    if (codec !== 'vp9' || alpha !== '1') throw new Error(`codec ${codec}, alpha_mode ${alpha}; want vp9, 1`);
    const audio = await probe(webm, 'stream=codec_type', 'a');
    if (audio !== '') throw new Error(`audio stream present: ${audio}`);
    const seg = segmentsOf(A)[0];
    if (!seg) throw new Error('no segment');
    const dur = await durationOf(webm);
    if (Math.abs(dur - (seg.end - seg.start)) > 0.1)
      throw new Error(`duration ${dur.toFixed(2)} s, want ${(seg.end - seg.start).toFixed(2)} s`);
    return `vp9 alpha, ${dur.toFixed(2)} s`;
  });

  await check(
    '3. gate: a paid adapter with budget 0 stops at --approve-spend and leaves avatar/ unchanged',
    async () => {
      const G: Run = { dir: path.join(RUNS, 'gate'), id: A.id };
      cpSync(A.dir, G.dir, { recursive: true });
      mkdirSync(path.join(G.dir, 'input'), { recursive: true });
      await sh(
        [
          'ffmpeg',
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=gray:s=512x512',
          '-frames:v',
          '1',
          path.join(G.dir, 'input', 'me.png'),
        ],
        { env: loadConfig(ENV).toolEnv, timeoutMs: MIN },
      );
      setAvatar(G, { source: 'adapter', adapter: 'heygen', portrait: 'input/me.png' });
      const before = sha(path.join(G.dir, 'avatar', 'segments.json'));
      const { code, out } = await callWithEnv('avatar', ['make', G.dir], { HEYGEN_API_KEY: 'dummy' });
      if (code === 0 || out.ok !== false) throw new Error(`make did not refuse: exit ${code} ${JSON.stringify(out)}`);
      if (!String(out.message).includes('--approve-spend'))
        throw new Error(`refusal does not name --approve-spend: ${String(out.message)}`);
      if (sha(path.join(G.dir, 'avatar', 'segments.json')) !== before) throw new Error('avatar/segments.json changed');
      return 'refused before any upload; avatar/segments.json unchanged';
    },
  );

  await check('4. layer: the red disc is in the corner-br box in the draft from a01 start to end', async () => {
    const seg = segmentsOf(A)[0];
    if (!seg) throw new Error('no segment');
    writeJson(path.join(A.dir, 'avatar', 'placement.json'), AvatarPlacementSchema, { segments: { a01: 'corner-br' } });
    await makeDisc(path.join(A.dir, 'avatar', 'a01.webm'), seg.end - seg.start);
    writeFragments(A);
    await callOk('scenes', ['done', A.dir, ...SCENE_IDS]);
    const { draft, checks } = await buildAndCheck(A);
    checksAt4 = checks;
    const mid = (seg.start + seg.end) / 2;
    const during = await pixelAt(draft, mid, BOX_CENTRE.x, BOX_CENTRE.y);
    const before = await pixelAt(draft, seg.start - 0.3, BOX_CENTRE.x, BOX_CENTRE.y);
    if (!isRed(during)) throw new Error(`pixel at ${mid.toFixed(2)} s is ${during}, want red`);
    if (isRed(before)) throw new Error(`pixel at ${(seg.start - 0.3).toFixed(2)} s is red, want not red`);
    return `red at ${mid.toFixed(2)} s, not red at ${(seg.start - 0.3).toFixed(2)} s`;
  });

  await check('5. under: text in the avatar box during the segment -> build refuses that scene', async () => {
    writeFragments(A, 'demo');
    await callOk('scenes', ['done', A.dir, 'demo']);
    const { out } = await call('scenes', ['build', A.dir]);
    if (out.ok !== false) throw new Error(`scenes build did not refuse: ${JSON.stringify(out)}`);
    const failing = (out.failing_scenes as string[] | undefined) ?? [];
    if (!failing.includes('demo')) throw new Error(`failing_scenes ${JSON.stringify(failing)} does not include demo`);
    const issues = (out.issues as { message: string }[] | undefined) ?? [];
    if (!issues.some((i) => i.message.includes('text_occluded')))
      throw new Error(`no issue mentions text_occluded: ${JSON.stringify(issues)}`);
    return `scenes build refused; failing_scenes ${JSON.stringify(failing)}`;
  });

  await check('6. seek: render.seek_safe and render.deterministic pass on the build from check 4', async () => {
    for (const id of ['render.seek_safe', 'render.deterministic']) {
      const statuses = checksAt4.filter((c) => c.id === id).map((c) => c.status);
      if (statuses.length === 0 || statuses.some((s) => s !== 'pass'))
        throw new Error(`${id} at check 4: ${JSON.stringify(statuses)}, want pass`);
    }
    return 'render.seek_safe and render.deterministic pass';
  });

  await check('7. review: a words review removes avatar/ and keeps its segments in history/1', async () => {
    await callOk('review', ['snapshot', A.dir, '--route', 'words'], { stdin: 'Tighten the second line.' });
    if (existsSync(path.join(A.dir, 'avatar'))) throw new Error('avatar/ still exists after a words review');
    if (!existsSync(path.join(A.dir, 'history', '1', 'avatar', 'segments.json')))
      throw new Error('history/1/avatar/segments.json is missing');
    return 'avatar/ removed; history/1/avatar/segments.json kept';
  });

  await check('8. heygen live: a one-line avatar run makes a01.webm with alpha', async () => {
    const key = ENV.HEYGEN_API_KEY;
    const approve = ENV.VM_HEYGEN_APPROVE_USD;
    const portrait = ENV.VM_HEYGEN_PORTRAIT;
    if (!key || !approve) return `${SKIP}HEYGEN_API_KEY or VM_HEYGEN_APPROVE_USD is not set`;
    if (!portrait) throw new Error('VM_HEYGEN_PORTRAIT is not set');
    const H = await newRun('One line from the creator');
    mkdirSync(path.join(H.dir, 'input'), { recursive: true });
    copyFileSync(portrait, path.join(H.dir, 'input', 'me.png'));
    await prepare(H, [{ id: 'l1', text: 'Hello from the creator.', delivery: 'avatar' }], {
      avatar: { source: 'adapter', adapter: 'heygen', portrait: 'input/me.png' },
      budget_usd: Number(approve),
    });
    await callOk('voice', ['synth', H.dir]);
    await callOk('voice', ['align', H.dir]);
    const made = await callWithEnv('avatar', ['make', H.dir, '--approve-spend', approve], { HEYGEN_API_KEY: key });
    if (made.code !== 0 || made.out.ok !== true)
      throw new Error(`avatar make failed (exit ${made.code}): ${JSON.stringify(made.out)}`);
    const webm = path.join(H.dir, 'avatar', 'a01.webm');
    const [codec = '', alpha = ''] = (await probe(webm, 'stream=codec_name:stream_tags=alpha_mode', 'v:0')).split(',');
    if (codec !== 'vp9' || alpha !== '1') throw new Error(`codec ${codec}, alpha_mode ${alpha}; want vp9, 1`);
    return 'a01.webm is vp9 with alpha';
  });
} finally {
  if (process.env.KEEP === '1') console.log(`KEEP=1: temp dirs kept: ${temps.join(', ')}`);
  else removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
const skipped = results.filter((r) => r.detail.startsWith(SKIP)).length;
console.log(`\n${results.length - failed - skipped}/${results.length} passed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
