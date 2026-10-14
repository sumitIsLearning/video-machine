// Phase 3 acceptance test (real tools and the NETWORK: docs.astral.sh and Openverse must be reachable; takes minutes).
//   node_modules/.bin/bun tests/phase3.ts
// Setup must already have run (real VM_HOME). The replay uses a temp VM_HOME, so its browser profile never lands in the
// real <VM_HOME>/profiles. Everything else is written in a fresh creator workspace, removed at the end.
// 1. unit tests + lint      2. the plugin loads its skills   3. snapshot of the plugin root
// 4. concept alone (research, page capture, found media, pool, panel)
// 5. nav video (recorded now, read into frames)   6. steps and replay (clips, clip alignment)
// 7. pool after capture     8. untrusted inputs    9. nothing was written under the plugin root
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchPlaywright } from '../lib/adapters/capture/playwright/browser';
import { AssetsSchema, CaptureLogSchema } from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const UV = 'https://docs.astral.sh/uv/';
const MIN = 60_000;
let CREATOR_WS = '';
let ENV: Env = {};
let bun = '';
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
      console.error(`[M0] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
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
type Cli = 'run' | 'research' | 'capture' | 'assets';

/** Run `lib/<cli>/cli.ts` and parse its JSON line. A non-zero exit is returned, not thrown. */
const call = async (
  cli: Cli,
  args: string[],
  o: { cwd?: string; stdin?: string; timeoutMs?: number; env?: Env } = {},
): Promise<Called> => {
  const r = await sh([bun, path.join(WS, 'lib', cli, 'cli.ts'), ...args], {
    cwd: o.cwd ?? CREATOR_WS,
    env: o.env ?? ENV,
    stdin: o.stdin,
    allowFail: true,
    timeoutMs: o.timeoutMs ?? 5 * MIN,
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

/** Throw unless the CLI exited 1 with `"ok":false`, the given error class and a message containing `mention`. */
const expectError = async (error: string, mention: string, ...a: Parameters<typeof call>) => {
  const { code, out } = await call(...a);
  if (code !== 1 || out.ok !== false || out.error !== error || !String(out.message).includes(mention))
    throw new Error(
      `${a[0]} ${a[1][0]}: expected exit 1 with ${error} mentioning "${mention}", got exit ${code}: ${JSON.stringify(out)}`,
    );
};

const SKIPPED = ['.git', '.claude', 'tests/out', 'runs'];
type Files = Map<string, string>;
const snapshotRoot = (): Files => {
  const files: Files = new Map();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(WS, full).replaceAll('\\', '/');
      if (SKIPPED.includes(rel)) continue;
      if (e.isDirectory()) walk(full);
      else {
        const s = lstatSync(full);
        files.set(rel, `${s.size} bytes, mtime ${s.mtimeMs}`);
      }
    }
  };
  walk(WS);
  return files;
};

/** Scene-change scores of a video as `{t, score}` per frame, the same scan `capture read` uses. */
const sceneScores = async (file: string): Promise<{ t: number; score: number }[]> => {
  const r = await sh(
    [
      'ffmpeg',
      '-hide_banner',
      '-i',
      file,
      '-vf',
      "select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
      '-f',
      'null',
      '-',
    ],
    { env: loadConfig(ENV).toolEnv, timeoutMs: MIN },
  );
  const out: { t: number; score: number }[] = [];
  let t = Number.NaN;
  for (const line of r.stderr.split(/\r?\n/)) {
    const pts = /pts_time:(-?[\d.]+)/.exec(line)?.[1];
    if (pts !== undefined) t = Math.max(0, Number(pts));
    const score = Number(/lavfi\.scene_score=([\d.]+)/.exec(line)?.[1]);
    if (Number.isFinite(t) && Number.isFinite(score)) out.push({ t, score });
  }
  return out;
};

const probe = async (file: string, args: string[]): Promise<string> =>
  (
    await sh(['ffprobe', '-v', 'error', ...args, '-of', 'csv=p=0', file], { env: loadConfig(ENV).toolEnv })
  ).stdout.trim();

/** Record a real navigation video of the uv docs (open, click Installation, scroll) and copy it to `dest`. */
const recordNavVideo = async (dest: string) => {
  const dir = makeTemp('vm-navrec-');
  const page = await launchPlaywright({
    profileDir: path.join(dir, 'profile'),
    recordDir: path.join(dir, 'rec'),
    headless: true,
  });
  let recording: string | undefined;
  try {
    await page.goto(UV);
    await page.wait(1500);
    await page.click('Installation');
    await page.wait(2000);
    await page.scroll();
    await page.wait(1500);
  } finally {
    recording = await page.close();
  }
  copyFileSync(recording, dest);
};

/** Run a step that needs the internet; on failure the message says so. No retry. */
const needsNetwork = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (cause) {
    throw new Error(`${(cause as Error).message}\nnetwork required: is docs.astral.sh / Openverse reachable?`, {
      cause,
    });
  }
};
/** Checks 6-8 work on the run that check 5 makes. */
const needsCheck5 = () => {
  if (!navRun || !frameOne) throw new Error('needs check 5 (no nav run or fallback frame)');
};

const RESEARCH_MD = `# uv

## Facts
- uv is a fast Python package and project manager — "An extremely fast Python package and project manager, written in Rust." — ${UV}
- uv is installed with a standalone installer or pip — "uv is available via standalone installers or pip" — ${UV}getting-started/installation/
`;

let snapshot: Files | undefined;
let conceptRun = '';
let navRun = '';
let frameOne = '';

try {
  CREATOR_WS = makeTemp('vm-ws-');
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;

  await check('1. unit tests pass and lint is clean', async () => {
    const r = await sh([bun, 'test'], { cwd: WS, timeoutMs: 5 * MIN });
    const summary = r.stderr || r.stdout; // bun test writes its summary to stderr
    const pass = Number(/^\s*(\d+) pass\b/m.exec(summary)?.[1] ?? 0);
    const fail = Number(/^\s*(\d+) fail\b/m.exec(summary)?.[1] ?? 0);
    if (pass === 0 || fail > 0) throw new Error(`${pass} pass, ${fail} fail\n${lastLine(summary)}`);
    await sh([bun, 'run', 'lint'], { cwd: WS, env: { ...process.env }, timeoutMs: 5 * MIN });
    return `${pass} pass, 0 fail; tsc, Biome and ruff report nothing`;
  });

  await check('2. the plugin loads capture, make-video, research, setup and status', async () => {
    const r = await sh(['claude', '--plugin-dir', '.', 'plugin', 'details', 'video-machine'], {
      cwd: WS,
      timeoutMs: MIN,
    });
    const m = /^\s*Skills \((\d+)\)[ \t]+(.*)$/m.exec(r.stdout);
    const skills = m?.[2]?.trim().split(/,\s*/) ?? [];
    const missing = ['capture', 'make-video', 'research', 'setup', 'status'].filter((s) => !skills.includes(s));
    if (missing.length || Number(m?.[1]) !== skills.length) throw new Error(`missing ${missing}\n${r.stdout}`);
    return `skills: ${skills.join(', ')}`;
  });

  await check('3. snapshot of every file under the plugin root', async () => {
    snapshot = snapshotRoot();
    return `${snapshot.size} files (path, size, mtime; skipping ${SKIPPED.join(', ')})`;
  });

  await check('4. concept alone: research, page capture, found media, pool, panel', async () => {
    const a = await callOk('run', ['new', '--concept', '-'], { stdin: 'Why uv is fast\n' });
    conceptRun = String(a.run_dir);
    await callOk('run', ['brief', conceptRun], { stdin: JSON.stringify({ sources: [] }) });
    const w = await callOk('research', ['write', conceptRun], { stdin: RESEARCH_MD });
    if (w.facts !== 2) throw new Error(`research write: ${JSON.stringify(w)}`);

    const p = await needsNetwork(() => callOk('research', ['page', conceptRun, UV], { timeoutMs: 10 * MIN }));
    const page = p.page as { screenshots: string[]; palette: unknown[] };
    if (page.screenshots.length < 3 || page.palette.length === 0)
      throw new Error(`page capture: ${page.screenshots.length} screenshots, ${page.palette.length} palette colours`);

    const f = await needsNetwork(() => callOk('research', ['find', conceptRun, '--n', '2', 'laptop']));
    const found = f.assets as { license: string; attribution?: string }[];
    const licensed = found.filter((x) => /^(CC|Public Domain)/.test(x.license) && x.attribution);
    if (licensed.length < 1) throw new Error(`find: no CC asset with an attribution: ${JSON.stringify(found)}`);

    await callOk('assets', ['build', conceptRun]);
    const panel = String((await callOk('assets', ['panel', conceptRun])).panel);
    const pool = readJson(path.join(conceptRun, 'assets.json'), AssetsSchema).assets;
    const origins = new Set(pool.map((x) => x.origin));
    if (!origins.has('web') || !origins.has('found')) throw new Error(`origins: ${[...origins]}`);
    const noLicence = pool.filter((x) => !x.license.trim());
    if (noLicence.length) throw new Error(`no licence: ${noLicence.map((x) => x.asset_id)}`);
    const fonts = pool.filter((x) => x.kind === 'font');
    if (fonts.length === 0) throw new Error('the page capture kept no font, so the font rule was not exercised');
    const badFonts = fonts.filter((x) => !(x.license === 'unknown' && x.usage === 'reference_only'));
    if (badFonts.length)
      throw new Error(`fonts that are not unknown + reference_only: ${badFonts.map((x) => x.asset_id)}`);
    const panelFile = path.resolve(conceptRun, panel);
    const html = existsSync(panelFile) ? readFileSync(panelFile, 'utf8') : '';
    const absent = pool.filter((x) => !html.includes(x.asset_id));
    if (!html || absent.length) throw new Error(`panel ${panelFile}: missing ${absent.map((x) => x.asset_id)}`);
    const where = await callOk('run', ['where', conceptRun]);
    if (where.next !== 'M6') throw new Error(`where: ${JSON.stringify(where)}`);
    return `${page.screenshots.length} screenshots, ${page.palette.length} colours; ${found.length} found; ${pool.length} assets (${fonts.length} fonts, all unknown + reference_only); panel ok; next ${where.next}`;
  });

  await check('5. nav video: record, import, read', async () => {
    const video = path.join(makeTemp('vm-navvideo-'), 'nav.webm');
    await needsNetwork(() => recordNavVideo(video));
    const a = await callOk('run', ['new', '--concept', '-'], { stdin: 'Tour of the uv docs\n' });
    navRun = String(a.run_dir);
    const imp = await callOk('run', ['import', navRun, video]);
    const [rel] = imp.paths as string[];
    if (!rel) throw new Error(`import: ${JSON.stringify(imp)}`);
    await callOk('run', ['brief', navRun], {
      stdin: JSON.stringify({
        sources: [
          { kind: 'nav_video', path_or_url: rel },
          { kind: 'product_url', path_or_url: UV },
        ],
      }),
    });
    const nav = (await callOk('capture', ['read', navRun, rel], { timeoutMs: 10 * MIN })) as unknown as {
      frames: { i: number; path: string }[];
      sheets: string[];
      has_audio: boolean;
      transcript?: string;
    };
    if (nav.frames.length < 3 || nav.has_audio || nav.transcript !== undefined || nav.sheets.length < 1)
      throw new Error(
        `read: ${nav.frames.length} frames, audio ${nav.has_audio}, transcript ${nav.transcript}, ${nav.sheets.length} sheets`,
      );
    frameOne = nav.frames[1]?.path ?? '';
    await callOk('research', ['write', navRun], { stdin: RESEARCH_MD });
    return `${nav.frames.length} frames, ${nav.sheets.length} sheet(s), no audio, no transcript; frame 1 is ${frameOne}`;
  });

  await check('6. steps and replay: failed step, clips, clip alignment', async () => {
    needsCheck5();
    const steps = [
      { i: 0, url: UV, action: 'wait', target: 'page', expect: 'the docs home page is open' },
      { i: 1, url: UV, action: 'click', target: 'Installation', expect: 'the installation page opens' },
      { i: 2, url: UV, action: 'click', target: 'No such link', expect: 'nothing', frame: frameOne },
    ];
    await callOk('capture', ['steps', navRun], { stdin: JSON.stringify(steps) });
    // A temp VM_HOME keeps the replay's browser profile out of the real <VM_HOME>/profiles.
    const replayEnv = { ...ENV, VM_HOME: makeTemp('vm-replay-home-') };
    const r = await callOk('capture', ['replay', navRun], { env: replayEnv, timeoutMs: 10 * MIN });
    const failed = r.failed as { i: number; fallback?: string }[];
    if (failed.length !== 1 || failed[0]?.i !== 2 || failed[0].fallback !== frameOne)
      throw new Error(`failed steps: ${JSON.stringify(failed)} (expected step 2 with fallback ${frameOne})`);

    const cap = path.join(navRun, 'capture');
    const log = readJson(path.join(cap, 'log.json'), CaptureLogSchema);
    const lines: string[] = [];
    for (const e of log.filter((x) => x.failed === undefined)) {
      for (const f of [`shots/${e.i}.png`, `text/${e.i}.txt`, `clips/${e.i}.mp4`])
        if (!existsSync(path.join(cap, f))) throw new Error(`step ${e.i}: capture/${f} is missing`);
      const clip = path.join(cap, 'clips', `${e.i}.mp4`);
      const [codec, rate] = (
        await probe(clip, ['-select_streams', 'v', '-show_entries', 'stream=codec_name,r_frame_rate'])
      ).split(',');
      const nb = Number(await probe(clip, ['-select_streams', 'v', '-show_entries', 'stream=nb_frames']));
      const keys = Number(
        await probe(clip, [
          '-select_streams',
          'v',
          '-skip_frame',
          'nokey',
          '-count_frames',
          '-show_entries',
          'stream=nb_read_frames',
        ]),
      );
      if (codec !== 'h264' || rate !== '30/1' || !(nb > 0) || nb !== keys)
        throw new Error(`clip ${e.i}: ${codec} ${rate}, ${nb} frames, ${keys} keyframes`);
      lines.push(`clip ${e.i}: h264 30/1, ${nb} frames, all keyframes`);
    }

    // R9: the page navigation caused by the Installation click must show in the recording near that step's t1.
    const s1 = log.find((e) => e.i === 1);
    if (!s1 || s1.failed !== undefined) throw new Error('step 1 did not succeed');
    // Bounded to step 1's own window (plus 1 s), so a change from step 2 or the end of the replay can't be picked.
    const scores = (await sceneScores(path.join(cap, 'replay.webm'))).filter((x) => x.t >= s1.t0 && x.t <= s1.t1 + 1);
    const best = scores.reduce((m, x) => (x.score > m.score ? x : m), { t: Number.NaN, score: 0 });
    const offset = best.t - s1.t1;
    lines.push(
      `alignment: step 1 t0 ${s1.t0.toFixed(2)} t1 ${s1.t1.toFixed(2)}; biggest change at ${best.t.toFixed(2)} s (score ${best.score.toFixed(3)}); offset ${offset >= 0 ? '+' : ''}${offset.toFixed(2)} s`,
    );
    if (!(best.score > 0.05) || Math.abs(offset) > 0.5)
      throw new Error(`${lines.join('\n')}\nthe navigation is not within 0.5 s of step 1's t1`);
    // Smoke check only (not alignment): the cut clip 1 contains some visible change.
    const inClip = Math.max(0, ...(await sceneScores(path.join(cap, 'clips', '1.mp4'))).map((x) => x.score));
    lines.push(`smoke: clip 1 contains a change (score ${inClip.toFixed(3)})`);
    if (!(inClip > 0.05)) throw new Error(`${lines.join('\n')}\nsmoke: clip 1 contains no change`);
    return lines.join('\n');
  });

  await check('7. pool after capture: captured, fallback frame, marks survive a rebuild', async () => {
    needsCheck5();
    const built = await callOk('assets', ['build', navRun]);
    const file = path.join(navRun, 'assets.json');
    const pool = readJson(file, AssetsSchema).assets;
    if (!pool.some((x) => x.origin === 'captured')) throw new Error(`no captured assets: ${JSON.stringify(built)}`);
    if (pool.some((x) => x.path.endsWith('-before.png'))) throw new Error('a *-before.png shot is in the pool');
    const frames = pool.filter((x) => x.origin === 'nav_video' && x.kind === 'image');
    const rendered = frames.filter((x) => x.usage === 'render').map((x) => x.path);
    if (frames.length < 3 || rendered.length !== 1 || rendered[0] !== frameOne)
      throw new Error(`nav frames: ${frames.length}, rendered ${JSON.stringify(rendered)} (expected only ${frameOne})`);
    const target = pool.find((x) => x.origin === 'captured');
    if (!target) throw new Error('no captured asset to pin');
    await callOk('assets', ['mark', navRun, target.asset_id, 'pin']);
    await callOk('assets', ['build', navRun]);
    const after = readJson(file, AssetsSchema).assets.find((x) => x.asset_id === target.asset_id);
    if (after?.status !== 'pinned') throw new Error(`pin lost after a rebuild: ${after?.status}`);
    const where = await callOk('run', ['where', navRun]);
    if (where.next !== 'M6') throw new Error(`where: ${JSON.stringify(where)}`);
    return `${pool.length} assets, ${frames.length} nav frames (only ${frameOne} renders); pin survives; next ${where.next}`;
  });

  await check('8. untrusted inputs fail cleanly', async () => {
    needsCheck5();
    // A valid title, so only the fact line (line 4) can be what is wrong.
    await expectError('InputError', 'line 4: a fact needs', 'research', ['write', navRun], {
      stdin: '# uv\n\n## Facts\n- a fact with no quote and no source\n',
    });
    await expectError('InputError', 'x.mp4', 'capture', ['read', navRun, '../x.mp4']);
    await expectError('InputError', 'file:', 'research', ['page', navRun, 'file:///C:/x']);
    return 'a fact without a quote, a path outside the run and a file: URL all give InputError';
  });

  await check('9. nothing was written under the plugin root', async () => {
    if (!snapshot) throw new Error('check 3 made no snapshot');
    const now = snapshotRoot();
    const lines = [
      ...[...now.keys()].filter((p) => !snapshot?.has(p)).map((p) => `added:   ${p}`),
      ...[...snapshot.keys()].filter((p) => !now.has(p)).map((p) => `removed: ${p}`),
      ...[...now].filter(([p, v]) => snapshot?.has(p) && snapshot.get(p) !== v).map(([p, v]) => `changed: ${p} (${v})`),
    ];
    if (lines.length) throw new Error(lines.join('\n'));
    return `${now.size} files unchanged`;
  });
} finally {
  removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
