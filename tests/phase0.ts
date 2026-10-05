// Phase 0 acceptance test.
//   node_modules/.bin/bun tests/phase0.ts
// 1. 1920x1080 stills of the fixture through the pdoom adapter are byte-identical to tests/baseline/
// 2. aligning the fixture voiceover through the ctc-onnx adapter reproduces the fixture's word times within 10 ms
// 3. a 1080x1920 (reel) still renders with no plate or page errors
// 4. video-testing's file list and sizes (excluding app/node_modules) match the listing taken before Phase 0
import path from 'node:path';
import { readFileSync, readdirSync, statSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { pdoom } from '../.claude/skills/video-machine/adapters/render/pdoom';
import { align } from '../.claude/skills/video-machine/adapters/align/ctc-onnx';
import { readJson, TimingSchema } from '../.claude/skills/video-machine/contracts/types';

const WS = path.resolve(import.meta.dir, '..');
const FIXTURE = path.join(WS, 'tests/fixture');
const SOURCE = 'C:/Work-data/video-testing';
const TIMES = [5, 12.5, 40.2, 70, 90];
// The source engine's hairline text is not bit-stable on this GPU: the same code gives one of two images at t=5
// (~15 px differ by 1/255, see HANDOFF.md). Exact bytes are still required; a frame gets this many renders to hit them.
const ATTEMPTS = 3;

const results: { test: string; ok: boolean; detail: string }[] = [];
const check = (test: string, fn: () => string) => {
  const t0 = performance.now();
  try { results.push({ test, ok: true, detail: fn() }); }
  catch (e) { results.push({ test, ok: false, detail: String((e as Error).message ?? e) }); }
  console.log(`${results.at(-1)!.ok ? 'PASS' : 'FAIL'}  ${test}  (${((performance.now() - t0) / 1000).toFixed(1)}s)\n      ${results.at(-1)!.detail.replace(/\n/g, '\n      ')}`);
};

check('1. landscape stills byte-identical to baseline', () => {
  rmSync(path.join(FIXTURE, 'out'), { recursive: true, force: true });
  const name = (t: number) => `f_${t.toFixed(2).padStart(7, '0')}.png`;
  const same = (t: number) => Bun.hash(readFileSync(path.join(FIXTURE, 'out/stills/landscape_1080p', name(t)))) === Bun.hash(readFileSync(path.join(WS, 'tests/baseline', name(t))));
  const tries = new Map<number, number>();
  let todo = TIMES;
  for (let a = 1; a <= ATTEMPTS && todo.length; a++) {
    pdoom.still(FIXTURE, 'landscape_1080p', todo);
    for (const t of todo) tries.set(t, a);
    todo = todo.filter((t) => !same(t));
  }
  const report = TIMES.map((t) => `t=${t}: ${todo.includes(t) ? `DIFFERENT after ${ATTEMPTS} renders` : `identical (render ${tries.get(t)})`}`).join('\n');
  if (todo.length) throw new Error(report);
  return report;
});

check('2. fixture alignment within 10 ms', () => {
  const run = path.join(WS, 'tests/out/align');
  rmSync(run, { recursive: true, force: true });
  mkdirSync(path.join(run, 'audio'), { recursive: true });
  copyFileSync(path.join(FIXTURE, 'audio/voiceover.mp3'), path.join(run, 'audio/voiceover.mp3'));
  const want = readJson(path.join(FIXTURE, 'data/lyrics.json'), TimingSchema);
  const spoken = JSON.parse(readFileSync(path.join(FIXTURE, 'spoken.json'), 'utf8'));
  const got = readJson(align(path.join(run, 'audio/voiceover.mp3'), want.lines.map((l, i) => ({ id: `l${i}`, text: l.text })), spoken), TimingSchema);
  const ww = want.lines.flatMap((l) => l.words), gw = got.lines.flatMap((l) => l.words);
  if (ww.length !== gw.length) throw new Error(`word count ${gw.length}, fixture ${ww.length}`);
  let worst = 0, at = '';
  ww.forEach((w, i) => {
    const g = gw[i]!;
    if (g.w !== w.w) throw new Error(`word ${i}: "${g.w}" vs fixture "${w.w}"`);
    const edges = [[g.start, w.start], [g.end, w.end], ...(w.syl ?? []).flatMap((s, k) => [[g.syl?.[k]?.[0] ?? NaN, s[0]], [g.syl?.[k]?.[1] ?? NaN, s[1]]])];
    for (const [a, b] of edges) { const d = Math.abs(a! - b!); if (!(d <= worst)) { worst = d; at = `"${w.w}" (word ${i})`; } }
  });
  if (!(worst <= 0.010)) throw new Error(`max deviation ${(worst * 1000).toFixed(1)} ms at ${at}`);
  return `${ww.length} words, max deviation ${(worst * 1000).toFixed(1)} ms`;
});

check('3. reel (1080x1920) still renders without errors', () => {
  const [f] = pdoom.still(FIXTURE, 'reel', [5]); // --strict: plate or page errors throw
  const png = readFileSync(f!);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20); // IHDR
  if (w !== 1080 || h !== 1920) throw new Error(`${f} is ${w}x${h}`);
  return `${path.relative(WS, f!)} is ${w}x${h}`;
});

check('4. video-testing unchanged since before Phase 0', () => {
  const now: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), rel = './' + path.relative(SOURCE, p).replaceAll('\\', '/');
      if (rel === './app/node_modules') continue;
      if (e.isDirectory()) walk(p);
      else now.push(`${statSync(p).size} ${rel}`);
    }
  };
  walk(SOURCE);
  const before = readFileSync(path.join(WS, 'tests/phase0/video-testing.before.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const a = new Set(before), b = new Set(now);
  const gone = before.filter((l) => !b.has(l)), added = now.filter((l) => !a.has(l));
  if (gone.length || added.length) throw new Error([...gone.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n'));
  return `${now.length} files, same names and sizes`;
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
