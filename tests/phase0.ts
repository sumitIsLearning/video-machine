// Phase 0 acceptance test.
//   node_modules/.bin/bun tests/phase0.ts
// 1. aligning the fixture voiceover through the ctc-onnx adapter reproduces the fixture's word times: 95% of edges within 10 ms, none over 100 ms
// 2. video-testing's file list and sizes (excluding app/node_modules) match the listing taken before Phase 0; skipped when the folder is absent

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { ctcOnnx } from '../lib/adapters/align/ctc-onnx';
import { TimingSchema } from '../lib/contracts/types';
import { readJson } from '../lib/core/json';

const WS = path.resolve(import.meta.dir, '..');
const FIXTURE = path.join(WS, 'tests/fixture');
const SOURCE = process.env.VM_VIDEO_TESTING ?? 'C:/Work-data/video-testing';

type Skip = { skip: string };
type Result = { test: string; ok: boolean; skipped?: boolean; detail: string };
const results: Result[] = [];
const check = async (test: string, fn: () => string | Skip | Promise<string | Skip>) => {
  const t0 = performance.now();
  let result: Result;
  try {
    const out = await fn();
    result =
      typeof out === 'string' ? { test, ok: true, detail: out } : { test, ok: true, skipped: true, detail: out.skip };
  } catch (e) {
    result = { test, ok: false, detail: String((e as Error).message ?? e) };
  }
  results.push(result);
  if (result.skipped) {
    console.log(`SKIP  ${test}\n      ${result.detail}`);
    return;
  }
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'}  ${test}  (${((performance.now() - t0) / 1000).toFixed(1)}s)\n      ${result.detail.replace(/\n/g, '\n      ')}`,
  );
};

await check('1. fixture alignment matches (95% of edges within 10 ms, all within 100 ms)', async () => {
  const run = path.join(WS, 'tests/out/align');
  rmSync(run, { recursive: true, force: true });
  mkdirSync(path.join(run, 'audio'), { recursive: true });
  copyFileSync(path.join(FIXTURE, 'audio/voiceover.mp3'), path.join(run, 'audio/voiceover.mp3'));
  const want = readJson(path.join(FIXTURE, 'data/lyrics.json'), TimingSchema);
  const spoken = JSON.parse(readFileSync(path.join(FIXTURE, 'spoken.json'), 'utf8'));
  const got = readJson(
    await ctcOnnx().align(
      path.join(run, 'audio/voiceover.mp3'),
      want.lines.map((l, i) => ({ id: `l${i}`, text: l.text, delivery: 'voiceover' as const })),
      spoken,
    ),
    TimingSchema,
  );
  const ww = want.lines.flatMap((l) => l.words),
    gw = got.lines.flatMap((l) => l.words);
  if (ww.length !== gw.length) throw new Error(`word count ${gw.length}, fixture ${ww.length}`);
  let worst = 0,
    at = '',
    within = 0,
    total = 0;
  ww.forEach((w, i) => {
    const g = gw[i];
    if (!g) throw new Error(`word ${i}: missing in aligned output`);
    if (g.w !== w.w) throw new Error(`word ${i}: "${g.w}" vs fixture "${w.w}"`);
    const edges = [
      [g.start, w.start],
      [g.end, w.end],
      ...(w.syl ?? []).flatMap((s, k) => [
        [g.syl?.[k]?.[0] ?? NaN, s[0]],
        [g.syl?.[k]?.[1] ?? NaN, s[1]],
      ]),
    ];
    for (const [a = Number.NaN, b = Number.NaN] of edges) {
      const d = Math.abs(a - b);
      if (Number.isNaN(d)) throw new Error(`"${w.w}" (word ${i}): missing syllable edge`);
      total++;
      if (d <= 0.01) within++;
      if (d > worst) {
        worst = d;
        at = `"${w.w}" (word ${i})`;
      }
    }
  });
  const detail = `${within}/${total} edges within 10 ms, max deviation ${(worst * 1000).toFixed(1)} ms at ${at}`;
  if (within < 0.95 * total || worst > 0.1) throw new Error(detail);
  return `${ww.length} words, ${detail}`;
});

await check('2. video-testing unchanged since before Phase 0', () => {
  if (!existsSync(SOURCE)) return { skip: `${SOURCE} not found; set VM_VIDEO_TESTING to the video-testing folder` };
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

const skipped = results.filter((r) => r.skipped).length;
const ran = results.length - skipped;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${ran - failed}/${ran} passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
