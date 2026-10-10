// Phase 0 acceptance test.
//   node_modules/.bin/bun tests/phase0.ts
// 1. aligning the fixture voiceover through the ctc-onnx adapter reproduces the fixture's word times within 10 ms
// 2. video-testing's file list and sizes (excluding app/node_modules) match the listing taken before Phase 0

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { ctcOnnx } from '../lib/adapters/align/ctc-onnx';
import { TimingSchema } from '../lib/contracts/types';
import { readJson } from '../lib/core/json';

const WS = path.resolve(import.meta.dir, '..');
const FIXTURE = path.join(WS, 'tests/fixture');
const SOURCE = 'C:/Work-data/video-testing';

const results: { test: string; ok: boolean; detail: string }[] = [];
const check = async (test: string, fn: () => string | Promise<string>) => {
  const t0 = performance.now();
  let result: { test: string; ok: boolean; detail: string };
  try {
    result = { test, ok: true, detail: await fn() };
  } catch (e) {
    result = { test, ok: false, detail: String((e as Error).message ?? e) };
  }
  results.push(result);
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'}  ${test}  (${((performance.now() - t0) / 1000).toFixed(1)}s)\n      ${result.detail.replace(/\n/g, '\n      ')}`,
  );
};

await check('1. fixture alignment within 10 ms', async () => {
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
    at = '';
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
      if (d > worst) {
        worst = d;
        at = `"${w.w}" (word ${i})`;
      }
    }
  });
  if (!(worst <= 0.01)) throw new Error(`max deviation ${(worst * 1000).toFixed(1)} ms at ${at}`);
  return `${ww.length} words, max deviation ${(worst * 1000).toFixed(1)} ms`;
});

await check('2. video-testing unchanged since before Phase 0', () => {
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

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
