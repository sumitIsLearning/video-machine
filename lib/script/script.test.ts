import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema, ScriptSchema } from '../contracts/types';
import { readJson, writeJson } from '../core/json';
import { writeScript } from './script';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const URL_A = 'https://www.firecrawl.dev/';
const run = (research = true) => {
  const d = path.join(mkdtempSync(path.join(tmpdir(), 'vm-')), 'run-1');
  temps.push(path.dirname(d));
  mkdirSync(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  writeJson(path.join(d, 'brief.json'), BriefSchema, {
    run_id: 'run-1',
    concept: 'c',
    goals: [],
    duration_target_s: [2, 4],
    timing_source: 'voiceover',
  });
  if (research)
    writeFileSync(path.join(d, 'research.md'), `# R\n\n## Facts\n- fast — "93% fewer input tokens" — ${URL_A}\n`);
  return d;
};
const LINES = [
  { id: 'l1', text: 'Paste a URL.' },
  { id: 'l2', text: 'Get clean markdown, 93% fewer tokens.', cite: [URL_A] },
];

test('writes script.json with run_id and version 1, and returns the estimate', () => {
  const d = run();
  const r = writeScript(d, { lines: LINES });
  expect(readJson(path.join(d, 'script.json'), ScriptSchema)).toMatchObject({ run_id: 'run-1', version: 1 });
  expect(r).toEqual({ lines: 2, words: 9, est_s: 3.9, target_s: [2, 4], fits: true });
});

test('a second write bumps the version', () => {
  const d = run();
  writeScript(d, { lines: LINES });
  writeScript(d, { lines: LINES });
  expect(readJson(path.join(d, 'script.json'), ScriptSchema).version).toBe(2);
});

test('an uncited number is refused and nothing is written', () => {
  const d = run();
  expect(() => writeScript(d, { lines: [{ id: 'l1', text: '93% fewer.' }] })).toThrow(
    'line l1 states a number but has no cite',
  );
  expect(existsSync(path.join(d, 'script.json'))).toBe(false);
});

test('needs research.md first', () => {
  expect(() => writeScript(run(false), { lines: LINES })).toThrow('research.md is missing: run research (M5) first');
});

test('fits is false when the estimate is outside duration_target_s', () => {
  const r = writeScript(run(), { lines: [{ id: 'l1', text: 'one' }] });
  expect(r.fits).toBe(false);
});

test('bad JSON shape is a ContractError naming the field', () => {
  expect(() => writeScript(run(), { lines: [{ id: 'l1' }] })).toThrow(/text/);
});
