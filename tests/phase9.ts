// Phase 9 acceptance test (real HyperFrames, Chrome, ffmpeg, Kokoro and the aligner; several minutes).
//   node_modules/.bin/bun tests/phase9.ts        (KEEP=1 keeps the temp runs and prints their path)
// One temp folder, removed at the end. 1. contracts  2. spans  3. matte  4. band  5. seam  6. under  7. safe
// 8. boards  9. seek
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Look, TestResults } from '../lib/contracts/types';
import {
  AssetsSchema,
  AvatarPlacementSchema,
  AvatarSegmentsSchema,
  LookSchema,
  PlanSchema,
  TestResultsSchema,
  TimingSchema,
} from '../lib/contracts/types';
import { presetBox } from '../lib/core/avatar';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson, writeJson } from '../lib/core/json';
import { sceneTimes } from '../lib/core/scene-times';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const MIN = 60_000;
const SCENE_IDS = ['hook', 'demo', 'proof', 'close'];
const BEAT_WORDS: Record<string, string> = { hook: 'data', demo: 'reads', proof: 'today', close: 'free' };
const SAFE_POS = 'left: var(--vm-safe-left); top: var(--vm-safe-top);';
const IN_BAND_POS = 'left: 30%; top: 62%;';
const LOW_POS = 'left: 30%; top: 70%;';
const BAND = presetBox('stack', 'reel', 0.55);
const SEAM = '#FF00FF';
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
      console.error(`[phase9] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
    }
  }
};
const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
  removeTemps();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => onSignal(signal));
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
type Cli = 'run' | 'research' | 'script' | 'voice' | 'scenes' | 'storyboard' | 'avatar';
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
  seam: { color: SEAM, label: 'presenter' },
};

const RESEARCH_MD = `# Firecrawl

## Facts
- Firecrawl turns a web page into LLM-ready markdown — "Turn any website into LLM-ready data." — https://www.firecrawl.dev/
`;

// l1, l2 and l4 are delivered by the avatar; l3 is a voiceover.
const SCRIPT: Line[] = [
  { id: 'l1', text: 'Clean data from any website.', delivery: 'avatar' },
  { id: 'l2', text: 'It reads the page the way you would.', delivery: 'avatar' },
  { id: 'l3', text: 'Try it on your own site today.', delivery: 'voiceover' },
  { id: 'l4', text: 'Start free.', delivery: 'avatar' },
];
const SCRIPT_VO: Line[] = SCRIPT.map((l) => ({ ...l, delivery: 'voiceover' }));

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
      { env: loadConfig(ENV).toolEnv },
    )
  ).stdout.trim();

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

/** True when every channel of the pixel is within `tol` of the wanted colour. */
const isColour = (rgb: number[], want: number[], tol = 40): boolean =>
  want.every((w, i) => Math.abs((rgb[i] ?? 0) - w) <= tol);
const RED = [255, 0, 0];
const INK = [17, 17, 17];

/** A 16:9 test clip of the given length: left half red, right half blue. No audio. */
const makeClip = (file: string, secs: number): Promise<unknown> =>
  sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-filter_complex',
      `color=c=red:s=1280x720:r=30:d=${secs}[a];color=c=blue:s=640x720:r=30:d=${secs}[b];[a][b]overlay=x=640`,
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

/** The music file the brief names. */
const makeMusic = async (r: Run) => {
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
};

/** The brief JSON (voiceover, one reel deliverable, `extra` merged in). */
const briefOf = (extra: Json): string =>
  JSON.stringify({
    sources: [],
    timing_source: 'voiceover',
    duration_target_s: [5, 15],
    music: { source: 'supplied', path: 'input/music.wav' },
    deliverables: [{ format: 'reel', kind: 'mp4_h264', captions: 'burned' }],
    ...extra,
  });

/** Music, brief (`extra` merged in), research, an empty asset list and the script. */
const prepare = async (r: Run, lines: Line[], extra: Json = {}) => {
  await makeMusic(r);
  await callOk('run', ['brief', r.dir], { stdin: briefOf(extra) });
  await callOk('research', ['write', r.dir], { stdin: RESEARCH_MD });
  writeJson(path.join(r.dir, 'assets.json'), AssetsSchema, { run_id: r.id, assets: [] });
  await writeScript(r, 1, lines);
};

/** One plan scene: the lines it covers, its cut, its beats and its assets. */
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
  tl.fromTo(".f-text", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" }, s.at("${BEAT_WORDS[id]}"));
</script>
`;

/** Writes the four stand-in fragments; the scene named `moved` puts its text at `movedPos`. */
const writeFragments = (r: Run, moved?: string, movedPos = IN_BAND_POS) => {
  SCRIPT.forEach((line, k) => {
    const id = SCENE_IDS[k] ?? '';
    writeFileSync(
      path.join(r.dir, 'scenes', `${id}.html`),
      fragment(id, line.text, id === moved ? movedPos : SAFE_POS),
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

/** Voice, storyboard and look of a run, in the order stack needs (avatar make wants plan.json). */
const voiceAndPlan = async (r: Run) => {
  await callOk('voice', ['synth', r.dir]);
  await callOk('voice', ['align', r.dir]);
  await stageRun(r);
};

let A: Run = { dir: '', id: '' };
let draftA = '';
let checksAt4: Check[] = [];
let blockingAt4 = 0;
let midA01 = 0;
let midProof = 0;

try {
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;
  RUNS = makeTemp('vm-runs-');

  await check('1. contracts: a stack brief without avatar is refused by intake', async () => {
    const C = await newRun('Clean data from any website');
    await makeMusic(C);
    const { code, out } = await call('run', ['brief', C.dir], {
      stdin: briefOf({ layout: { kind: 'stack', split: 0.55 } }),
    });
    if (code === 0 || out.ok !== false)
      throw new Error(`run brief did not refuse: exit ${code} ${JSON.stringify(out)}`);
    if (!JSON.stringify(out).includes('needs brief.avatar'))
      throw new Error(`refusal does not mention needs brief.avatar: ${JSON.stringify(out)}`);
    return 'refused: needs brief.avatar';
  });

  await check('2. spans: scenes [avatar, avatar, voiceover, avatar] -> a01, a02 on scene boundaries', async () => {
    A = await newRun('Clean data from any website');
    mkdirSync(path.join(A.dir, 'input'), { recursive: true });
    await makeClip(path.join(A.dir, 'input', 'me.mp4'), 40);
    await prepare(A, SCRIPT, {
      layout: { kind: 'stack', split: 0.55 },
      avatar: { source: 'supplied', clip: 'input/me.mp4' },
    });
    await voiceAndPlan(A);
    await callOk('avatar', ['make', A.dir]);
    const plan = readJson(path.join(A.dir, 'plan.json'), PlanSchema);
    const timing = readJson(path.join(A.dir, 'data', 'timing.json'), TimingSchema);
    const times = sceneTimes(plan, timing);
    const scene = (id: string) => {
      const s = times.find((t) => t.scene_id === id);
      if (!s) throw new Error(`no scene window for ${id}`);
      return s;
    };
    const segs = segmentsOf(A);
    const [a01, a02] = segs;
    const hook = scene('hook');
    const demo = scene('demo');
    const close = scene('close');
    const edges = `segments: ${JSON.stringify(segs)}, sceneTimes: ${JSON.stringify(times.map((t) => [t.scene_id, t.start, t.start + t.duration]))}`;
    if (segs.length !== 2 || a01?.seg !== 'a01' || a02?.seg !== 'a02') throw new Error(`${edges}; want a01 and a02`);
    const demoEnd = demo.start + demo.duration;
    const closeEnd = close.start + close.duration;
    if (!near(a01.start, hook.start)) throw new Error(`a01 starts ${a01.start}, hook starts ${hook.start}. ${edges}`);
    if (!near(a01.end, demoEnd)) throw new Error(`a01 ends ${a01.end}, demo ends ${demoEnd}. ${edges}`);
    if (!near(a02.start, close.start))
      throw new Error(`a02 starts ${a02.start}, close starts ${close.start}. ${edges}`);
    if (!near(a02.end, closeEnd)) throw new Error(`a02 ends ${a02.end}, close ends ${closeEnd}. ${edges}`);
    midA01 = (a01.start + a01.end) / 2;
    const proof = scene('proof');
    midProof = (proof.start + proof.start + proof.duration) / 2;
    return `a01 ${a01.start.toFixed(2)}-${a01.end.toFixed(2)} s, a02 ${a02.start.toFixed(2)}-${a02.end.toFixed(2)} s`;
  });

  await check('3. matte: a01.webm is VP9, no alpha, no audio; placement all stack', async () => {
    const webm = path.join(A.dir, 'avatar', 'a01.webm');
    const [codec = '', alpha = ''] = (await probe(webm, 'stream=codec_name:stream_tags=alpha_mode', 'v:0')).split(',');
    if (codec !== 'vp9' || (alpha !== '' && alpha !== '0')) throw new Error(`codec ${codec}, alpha_mode ${alpha}`);
    const audio = await probe(webm, 'stream=codec_type', 'a');
    if (audio !== '') throw new Error(`audio stream present: ${audio}`);
    const placement = readJson(path.join(A.dir, 'avatar', 'placement.json'), AvatarPlacementSchema).segments;
    const bad = Object.entries(placement).filter(([, v]) => v !== 'stack');
    if (Object.keys(placement).length === 0 || bad.length > 0)
      throw new Error(`placement not all stack: ${JSON.stringify(placement)}`);
    return `vp9, no alpha, no audio; placement ${JSON.stringify(placement)}`;
  });

  await check('4. band: the clip fills the band during a01, the scene shows during the voiceover', async () => {
    writeFragments(A);
    await callOk('scenes', ['done', A.dir, ...SCENE_IDS]);
    const { draft, checks, blocking } = await buildAndCheck(A);
    draftA = draft;
    checksAt4 = checks;
    blockingAt4 = blocking;
    const bx = 270;
    const by = BAND.y + Math.round(BAND.h / 2);
    const inA01 = await pixelAt(draft, midA01, bx, by);
    const inProof = await pixelAt(draft, midProof, bx, by);
    const above = await pixelAt(draft, midA01, 540, 400);
    if (!isColour(inA01, RED)) throw new Error(`band pixel at ${midA01.toFixed(2)} s is ${inA01}, want red`);
    if (!isColour(inProof, INK)) throw new Error(`band pixel at ${midProof.toFixed(2)} s is ${inProof}, want #111111`);
    if (!isColour(above, INK))
      throw new Error(`pixel above the band at ${midA01.toFixed(2)} s is ${above}, want #111111`);
    return `band red in a01, #111111 in proof, scene above the band`;
  });

  await check('5. seam: a pixel on the seam line has the seam colour during a01', async () => {
    const html = readFileSync(path.join(A.dir, 'build', 'reel', 'index.html'), 'utf8');
    const m = html.match(/id="seam-a01"[^>]*top:(\d+)px/);
    const top = m ? Number(m[1]) : BAND.y - 3;
    const px = await pixelAt(draftA, midA01, 100, top + 3);
    if (!isColour(px, [255, 0, 255])) throw new Error(`seam pixel (100,${top + 3}) at ${midA01.toFixed(2)} s is ${px}`);
    return `seam colour at y ${top + 3}`;
  });

  await check('6. under: text placed in the band during a01 -> build refuses that scene', async () => {
    writeFragments(A, 'demo', IN_BAND_POS);
    await callOk('scenes', ['done', A.dir, 'demo']);
    const { out } = await call('scenes', ['build', A.dir]);
    if (out.ok !== false) throw new Error(`scenes build did not refuse: ${JSON.stringify(out)}`);
    const failing = (out.failing_scenes as string[] | undefined) ?? [];
    if (!failing.includes('demo')) throw new Error(`failing_scenes ${JSON.stringify(failing)} does not include demo`);
    const issues = (out.issues as { message: string }[] | undefined) ?? [];
    if (!issues.some((i) => i.message.includes('text_occluded') || i.message.includes('layout.safe_area')))
      throw new Error(`no issue mentions text_occluded or layout.safe_area: ${JSON.stringify(issues)}`);
    writeFragments(A);
    await callOk('scenes', ['done', A.dir, 'demo']);
    return `refused; failing_scenes ${JSON.stringify(failing)}`;
  });

  await check('7. safe: text below the reel safe bottom with no band -> layout.safe_area fails', async () => {
    const B = await newRun('Clean data from any website');
    await prepare(B, SCRIPT_VO, { layout: { kind: 'graphics' } });
    await voiceAndPlan(B);
    writeFragments(B, 'hook', LOW_POS);
    await callOk('scenes', ['done', B.dir, ...SCENE_IDS]);
    const built = await call('scenes', ['build', B.dir]);
    if (built.out.ok === false) {
      if (!JSON.stringify(built.out).includes('layout.safe_area'))
        throw new Error(`build refused without layout.safe_area: ${JSON.stringify(built.out)}`);
      return 'scenes build refused with layout.safe_area';
    }
    await call('scenes', ['check', B.dir]);
    const tr = readJson(path.join(B.dir, 'test_results.json'), TestResultsSchema);
    const bad = tr.checks.filter((c) => c.id === 'layout.safe_area' && c.status === 'fail');
    if (bad.length === 0) throw new Error('layout.safe_area did not fail');
    return 'layout.safe_area fails in scenes check';
  });

  await check('8. boards: an avatar scene board has the grey band, the voiceover scene board has none', async () => {
    const root = `<!DOCTYPE html><html><head><script src="vendor/gsap.min.js"></script></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="1080" data-height="1920"></div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    await callOk('storyboard', ['board', A.dir, 'hook'], { stdin: root });
    await callOk('storyboard', ['board', A.dir, 'proof'], { stdin: root });
    const hook = readFileSync(path.join(A.dir, 'boards', 'hook', 'index.html'), 'utf8');
    const proof = readFileSync(path.join(A.dir, 'boards', 'proof', 'index.html'), 'utf8');
    if (!hook.includes('data-vm-band')) throw new Error('hook board has no data-vm-band');
    if (!hook.includes('#9aa1b0')) throw new Error('hook board band is not #9aa1b0');
    if (proof.includes('data-vm-band')) throw new Error('proof board has a band');
    return 'hook board has the band; proof board has none';
  });

  await check('9. seek: render.seek_safe and render.deterministic pass; blocking checks = 0', async () => {
    if (blockingAt4 !== 0) {
      const bad = checksAt4
        .filter((c) => c.blocking && c.status === 'fail')
        .map((c) => `${c.id}: ${c.detail} ${JSON.stringify(c.annotations)}`);
      throw new Error(`blocking checks failed:\n${bad.join('\n')}`);
    }
    for (const id of ['render.seek_safe', 'render.deterministic']) {
      const statuses = checksAt4.filter((c) => c.id === id).map((c) => c.status);
      if (statuses.length === 0 || statuses.some((s) => s !== 'pass'))
        throw new Error(`${id}: ${JSON.stringify(statuses)}, want pass`);
    }
    return 'render.seek_safe and render.deterministic pass; blocking 0';
  });
} finally {
  if (process.env.KEEP === '1') console.log(`KEEP=1: temp dirs kept: ${temps.join(', ')}`);
  else removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
