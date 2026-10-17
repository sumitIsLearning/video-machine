import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScriptSchema, TimingSchema } from '../../../contracts/types';
import { InputError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { srtExport, srtOf } from './index';

const w = (word: string, start: number, end: number) => ({ w: word, start, end });
const L2 = 'Firecrawl turns the whole web into clean markdown for your agents in seconds.';
const script = ScriptSchema.parse({
  run_id: 'r',
  version: 1,
  lines: [
    { id: 'l1', text: 'Scrape any site.' },
    { id: 'l2', text: L2 },
    { id: 'l3', text: 'Costs $5.', spoken: 'Costs five dollars.' },
  ],
});
const timing = TimingSchema.parse({
  lines: [
    {
      id: 'l1',
      text: 'Scrape any site.',
      start: 0.2,
      end: 1.1,
      words: [w('scrape', 0.2, 0.5), w('any', 0.55, 0.7), w('site', 0.75, 1.1)],
    },
    {
      id: 'l2',
      text: L2,
      start: 1.5,
      end: 6.0,
      words: L2.split(' ').map((x, i) => w(x, 1.5 + i * 0.33, 1.5 + i * 0.33 + 0.3)),
    },
    {
      id: 'l3',
      text: 'Costs $5.',
      start: 6.5,
      end: 7.5,
      words: [w('costs', 6.5, 6.8), w('five', 6.85, 7.1), w('dollars', 7.15, 7.5)],
    },
  ],
});

test('srtOf makes cues of at most 42 characters, timed by their words', () => {
  expect(srtOf(script, timing)).toBe(
    [
      '1\n00:00:00,200 --> 00:00:01,100\nScrape any site.',
      '2\n00:00:01,500 --> 00:00:03,780\nFirecrawl turns the whole web into clean',
      '3\n00:00:03,810 --> 00:00:05,760\nmarkdown for your agents in seconds.',
      '4\n00:00:06,500 --> 00:00:07,500\nCosts $5.',
    ].join('\n\n') + '\n',
  );
});

test('srtOf splits a line whose word count differs from its timing in proportion to characters', () => {
  const text = `${'x'.repeat(40)} ${'y'.repeat(39)}`;
  const s = ScriptSchema.parse({ run_id: 'r', version: 1, lines: [{ id: 'a', text }] });
  const t = TimingSchema.parse({ lines: [{ id: 'a', text, start: 0, end: 8, words: [w('xy', 0, 8)] }] });
  expect(srtOf(s, t)).toBe(
    `1\n00:00:00,000 --> 00:00:04,000\n${'x'.repeat(40)}\n\n2\n00:00:04,100 --> 00:00:08,000\n${'y'.repeat(39)}\n`,
  );
});

test('srtOf matches timing lines without an id by position and refuses a line the script lacks', () => {
  const t = TimingSchema.parse({ lines: timing.lines.map(({ id: _id, ...l }) => l) });
  expect(srtOf(script, t)).toBe(srtOf(script, timing));
  const extra = TimingSchema.parse({
    lines: [...timing.lines, { id: 'l9', text: 'x', start: 8, end: 9, words: [w('x', 8, 9)] }],
  });
  expect(() => srtOf(script, extra)).toThrow(InputError);
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('srtExport writes out/deliver.tmp/<format>/captions.srt and returns its path', async () => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-srt-'));
  dirs.push(run);
  mkdirSync(path.join(run, 'data'));
  writeJson(path.join(run, 'script.json'), ScriptSchema, script);
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, timing);
  const file = await srtExport().export(run, { format: 'reel', kind: 'srt', captions: 'separate' });
  expect(file).toBe(path.join(run, 'out', 'deliver.tmp', 'reel', 'captions.srt'));
  expect(readFileSync(file, 'utf8')).toBe(srtOf(script, timing));
  expect(readdirSync(path.dirname(file))).toEqual(['captions.srt']);
  await expect(srtExport().export(run, { format: 'reel', kind: 'mp4_h264', captions: 'burned' })).rejects.toThrow(
    InputError,
  );
});
