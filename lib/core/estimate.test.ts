import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ScriptSchema } from '../contracts/types';
import { PLUGIN_ROOT } from './config';
import { estimate, wordCount } from './estimate';

const script = (lines: { id: string; text: string; spoken?: string }[]) =>
  ScriptSchema.parse({ run_id: 'r', version: 1, lines });

test('wordCount splits on any whitespace and ignores empty pieces', () => {
  expect(wordCount('  paste a\nURL ')).toBe(3);
  expect(wordCount('')).toBe(0);
});

test('each line takes words / 2.5 s with a 0.25 s gap between lines', () => {
  const e = estimate(
    script([
      { id: 'l1', text: 'one two three four five' }, // 2.0 s
      { id: 'l2', text: 'x', spoken: 'six seven eight nine ten' }, // spoken wins: 2.0 s
    ]),
  );
  expect(e.lines).toEqual([
    { id: 'l1', words: 5, start_s: 0, end_s: 2 },
    { id: 'l2', words: 5, start_s: 2.25, end_s: 4.25 },
  ]);
  expect(e.total_s).toBe(4.3); // rounded to 0.1
});

test('gsap 3.14.2 is installed where compositions copy it from', () => {
  expect(existsSync(path.join(PLUGIN_ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js'))).toBe(true);
});
