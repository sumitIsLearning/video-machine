// Phase 4 acceptance test (real HyperFrames and ffmpeg; about 2 minutes: 8 snapshots).
//   node_modules/.bin/bun tests/phase4.ts        (KEEP=1 keeps the temp run and prints its path)
// One temp run under tmpdir(), removed at the end. 1. run setup  2. script.facts_cited  3. looks
// 4. look.directions_differ  5. cdn refused  6. plan.coverage  7. where
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssetsSchema } from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { writeJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const MIN = 60_000;
const FC_HOME = 'https://www.firecrawl.dev/';
const FC_SCRAPE = 'https://docs.firecrawl.dev/features/scrape';
let ENV: Env = {};
let bun = '';
let RUN = '';
let RUN_ID = '';
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
      console.error(`[phase4] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
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
type Cli = 'run' | 'research' | 'script' | 'look' | 'storyboard';

/** Run `lib/<cli>/cli.ts` and parse its JSON line. A non-zero exit is returned, not thrown. */
const call = async (cli: Cli, args: string[], o: { stdin?: string; timeoutMs?: number } = {}): Promise<Called> => {
  const r = await sh([bun, path.join(WS, 'lib', cli, 'cli.ts'), ...args], {
    cwd: WS,
    env: ENV,
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

/** The CLI must exit non-zero with `"ok":false`; returns its message. */
const callRefused = async (...a: Parameters<typeof call>): Promise<string> => {
  const { code, out } = await call(...a);
  if (code === 0 || out.ok !== false)
    throw new Error(`${a[0]} ${a[1][0]}: expected a refusal, got exit ${code}: ${JSON.stringify(out)}`);
  return String(out.message);
};

/** Width and height of the first video stream of a PNG, as "w,h". */
const sizeOf = async (file: string): Promise<string> =>
  (
    await sh(
      [
        'ffprobe',
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        file,
      ],
      { env: loadConfig(ENV).toolEnv },
    )
  ).stdout.trim();

const RESEARCH_MD = `# Firecrawl

## Facts
- Firecrawl turns a web page into LLM-ready markdown — "Turn any website into LLM-ready data." — ${FC_HOME}
- A single scrape request returns the page as markdown — "Scrape a single URL and get markdown back." — ${FC_SCRAPE}
`;

const LOOK_A = {
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
const LOOK_B = {
  ...LOOK_A,
  id: 'paper',
  palette: [{ name: 'paper', hex: '#FDFBF9', role: 'bg' }],
  type: [{ role: 'display', family: 'DM Sans', weights: [500], license: 'OFL' }],
};

const GSAP_TAG = '<script src="vendor/gsap.min.js"></script>';

/** A 1080x1920 board: one paused timeline, one headline, and the PNG `assetId` when given. */
const boardHtml = (bg: string, headline: string, assetId?: string) => `<!doctype html>
<html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="1080" data-height="1920" style="position:relative;width:1080px;height:1920px;background:${bg};overflow:hidden">
<h1 style="position:absolute;top:30%;left:6%;right:6%;margin:0;font:700 96px sans-serif;color:#ffffff">${headline}</h1>
${assetId ? `<img src="assets/${assetId}.png" style="position:absolute;left:6%;top:50%;width:400px;height:400px">` : ''}
</div>
${GSAP_TAG}
<script>
const tl = gsap.timeline({ paused: true });
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;
</script>
</body></html>`;

const scene = (scene_id: string, lines: string[]) => ({
  scene_id,
  lines,
  cut_in: { anchor: 'beat:0', rule: 'pause_before' },
  intent: `show ${scene_id}`,
  beats: [{ on: 'beat:0', does: 'headline appears' }],
  layout: { reel: 'centered headline' },
  transition_out: 'cut',
  asset_ids: ['captured'],
});

try {
  ENV = { ...process.env };
  bun = loadConfig(ENV).bun;

  await check('1. run setup: new, brief, research.md with two facts, one PNG registered as captured', async () => {
    const a = await callOk('run', ['new', '--concept', '-', '--runs', makeTemp('vm-runs-')], {
      stdin: 'Why Firecrawl is useful\n',
    });
    RUN = String(a.run_dir);
    RUN_ID = String(a.run_id);
    await callOk('run', ['brief', RUN], { stdin: JSON.stringify({ sources: [] }) });
    const w = await callOk('research', ['write', RUN], { stdin: RESEARCH_MD });
    if (w.facts !== 2) throw new Error(`research write: ${JSON.stringify(w)}`);
    const png = path.join(RUN, 'assets', 'captured.png');
    mkdirSync(path.dirname(png), { recursive: true });
    await sh(
      [
        'ffmpeg',
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=orange:s=64x64',
        '-frames:v',
        '1',
        png,
      ],
      { env: loadConfig(ENV).toolEnv, timeoutMs: MIN },
    );
    writeJson(path.join(RUN, 'assets.json'), AssetsSchema, {
      run_id: RUN_ID,
      assets: [
        {
          asset_id: 'captured',
          kind: 'image',
          path: 'assets/captured.png',
          source: FC_HOME,
          license: `own capture of ${FC_HOME}`,
          usage: 'render',
          origin: 'captured',
        },
      ],
    });
    return `run ${RUN}, 2 facts, assets/captured.png`;
  });

  await check('2. script.facts_cited: an uncited 93% line is refused, a cited 3-line script is written', async () => {
    const uncited = {
      run_id: RUN_ID,
      version: 1,
      lines: [
        { id: 'l1', text: 'Teams cut scraping costs by 93%.' },
        { id: 'l2', text: 'Scrape any page into markdown.', cite: [FC_SCRAPE] },
        { id: 'l3', text: 'Start with the free plan.', cite: [FC_HOME] },
      ],
    };
    const message = await callRefused('script', ['write', RUN], { stdin: JSON.stringify(uncited) });
    if (!/l1|93%/.test(message)) throw new Error(`refusal does not name the line: ${message}`);
    const cited = {
      ...uncited,
      lines: [
        { id: 'l1', text: 'Scrape any page into markdown.', cite: [FC_SCRAPE] },
        { id: 'l2', text: 'Scrape a single URL and get markdown back.', cite: [FC_SCRAPE] },
        { id: 'l3', text: 'Start with the free plan.', cite: [FC_HOME] },
      ],
    };
    await callOk('script', ['write', RUN], { stdin: JSON.stringify(cited) });
    return `refused: ${message}; cited script written`;
  });

  await check('3. looks: two looks that differ in palette and type give six 1080x1920 boards', async () => {
    const dirs = [
      ['A', LOOK_A, '#111111'],
      ['B', LOOK_B, '#FDFBF9'],
    ] as const;
    for (const [dir, look, bg] of dirs) {
      await callOk('look', ['write', RUN, dir], { stdin: JSON.stringify({ look, md: `# ${look.id}\n` }) });
      for (const board of ['hook', 'product', 'ending'] as const) {
        const asset = board === 'product' ? 'captured' : undefined;
        const assets = asset ? ['--assets', asset] : [];
        await callOk('look', ['board', RUN, dir, board, ...assets, '--at', '1'], {
          stdin: boardHtml(bg, board, asset),
        });
      }
    }
    const sizes: string[] = [];
    for (const [dir] of dirs)
      for (const board of ['hook', 'product', 'ending']) {
        const png = path.join(RUN, 'directions', dir, 'boards', `${board}.png`);
        if (!existsSync(png)) throw new Error(`missing ${png}`);
        const size = await sizeOf(png);
        if (size !== '1080,1920') throw new Error(`${png} is ${size}, not 1080,1920`);
        sizes.push(size);
      }
    const hookA = path.join(RUN, 'directions', 'A', 'boards', 'hook.png');
    const hookB = path.join(RUN, 'directions', 'B', 'boards', 'hook.png');
    if (readFileSync(hookA).equals(readFileSync(hookB))) throw new Error('A and B hook boards are byte-identical');
    return `${sizes.length} boards, all 1080x1920; A and B hook boards differ`;
  });

  await check(
    '4. look.directions_differ: identical B fails compare, restored B passes and pick A writes look.json',
    async () => {
      await callOk('look', ['write', RUN, 'B'], { stdin: JSON.stringify({ look: LOOK_A, md: '# same\n' }) });
      const message = await callRefused('look', ['compare', RUN]);
      if (!/differ in \d+ of palette, type, motion, motifs/.test(message))
        throw new Error(`refusal is not the directions check: ${message}`);
      await callOk('look', ['write', RUN, 'B'], { stdin: JSON.stringify({ look: LOOK_B, md: '# paper\n' }) });
      await callOk('look', ['compare', RUN]);
      if (!existsSync(path.join(RUN, 'out', 'looks.html'))) throw new Error('out/looks.html was not written');
      const picked = await callOk('look', ['pick', RUN, 'A']);
      if (picked.look !== 'look/look.json' || !existsSync(path.join(RUN, 'look', 'look.json')))
        throw new Error(`pick A: ${JSON.stringify(picked)}`);
      return `identical refused: ${message}; picked A`;
    },
  );

  await check('5. cdn refused: a board that loads gsap from jsDelivr fails', async () => {
    const cdn = boardHtml('#111111', 'hook').replace(
      GSAP_TAG,
      '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
    );
    const message = await callRefused('look', ['board', RUN, 'A', 'hook', '--at', '1'], { stdin: cdn });
    if (!/jsdelivr|cdn|http/i.test(message)) throw new Error(`refusal does not name the CDN URL: ${message}`);
    return `refused: ${message}`;
  });

  await check(
    '6. plan.coverage: a plan missing a line fails, a 2-scene plan passes, boards and page render',
    async () => {
      const plan = (scenes: ReturnType<typeof scene>[]) => ({ scenes, asset_ids: ['captured'] });
      const planJson = path.join(RUN, 'plan.json');
      const missing = await callRefused('storyboard', ['write', RUN], {
        stdin: JSON.stringify(plan([scene('hook', ['l1', 'l2'])])),
      });
      if (!/plan\.coverage/.test(missing) || !/\bl3\b/.test(missing))
        throw new Error(`refusal does not name plan.coverage and line l3: ${missing}`);
      if (existsSync(planJson)) throw new Error('the refused plan was written to plan.json');
      await callOk('storyboard', ['write', RUN], {
        stdin: JSON.stringify(plan([scene('hook', ['l1']), scene('product', ['l2', 'l3'])])),
      });
      for (const id of ['hook', 'product']) {
        await callOk('storyboard', ['board', RUN, id, '--at', '1'], { stdin: boardHtml('#111111', id) });
        if (!existsSync(path.join(RUN, 'boards', `${id}.png`))) throw new Error(`missing boards/${id}.png`);
      }
      const page = await callOk('storyboard', ['page', RUN]);
      const html = readFileSync(path.join(RUN, 'out', 'storyboard.html'), 'utf8');
      const imgs = html.match(/<img/g)?.length ?? 0;
      if (imgs !== 2) throw new Error(`storyboard.html has ${imgs} <img, expected 2 (${JSON.stringify(page)})`);
      return `refused: ${missing}; 2 boards; storyboard.html has ${imgs} <img`;
    },
  );

  await check('7. where: the next part after the plan is M9', async () => {
    const w = await callOk('run', ['where', RUN]);
    if (w.next !== 'M9') throw new Error(`where: ${JSON.stringify(w)}`);
    return `next ${w.next}`;
  });
} finally {
  if (process.env.KEEP === '1') console.log(`KEEP=1: temp dirs kept: ${temps.join(', ')}`);
  else removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
