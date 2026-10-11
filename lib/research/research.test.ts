import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InputError } from '../core/errors';
import { parseResearch, writeResearch } from './research';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const MD = `# Research: uv

## Facts
- uv is 10-100x faster than pip — "10-100x faster than pip." — https://docs.astral.sh/uv/
- One tool replaces pip, poetry and pyenv — "A single tool to replace pip, pip-tools, pipx, poetry, pyenv" — https://docs.astral.sh/uv/

## Notes
Benchmarks from Real Python were slower (about 8x): https://realpython.com/uv-vs-pip/
`;
const GOOD = '- uv is fast — "very fast" — https://docs.astral.sh/uv/';

test('parseResearch reads each fact with its quote and URL, and every URL in the file', () => {
  const r = parseResearch(MD);
  expect(r.facts).toHaveLength(2);
  expect(r.facts[0]).toEqual({
    fact: 'uv is 10-100x faster than pip',
    quote: '10-100x faster than pip.',
    url: 'https://docs.astral.sh/uv/',
  });
  expect(r.urls).toEqual(['https://docs.astral.sh/uv/', 'https://realpython.com/uv-vs-pip/']);
});

test('a fact without a quote or without a URL is refused, naming the line', () => {
  expect(() => parseResearch('## Facts\n- uv is fast — https://docs.astral.sh/uv/\n')).toThrow(/line 2/);
  expect(() => parseResearch('## Facts\n- uv is fast — "very fast"\n')).toThrow(InputError);
  expect(() => parseResearch('## Facts\n- uv is fast — "very fast" — javascript:alert(1)\n')).toThrow(InputError);
});

test.each([
  ['a * bullet', '* uv is fast — "very fast" — https://docs.astral.sh/uv/'],
  ['an indented bullet', '  - uv is fast — "very fast" — https://docs.astral.sh/uv/'],
  ['a numbered bullet', '1. uv is fast — "very fast" — https://docs.astral.sh/uv/'],
  ['a prose line', 'uv is very fast, trust me'],
  ['a whitespace-only quote', '- uv is fast — "   " — https://docs.astral.sh/uv/'],
  ['a whitespace-only fact', '-    — "very fast" — https://docs.astral.sh/uv/'],
])('a line under Facts that is %s is refused, naming the line', (_name, bad) => {
  const md = `## Facts\n${GOOD}\n${bad}\n`;
  expect(() => parseResearch(md)).toThrow(InputError);
  expect(() => parseResearch(md)).toThrow(/line 3/);
});

test('bullets under another heading are not checked as facts', () => {
  const r = parseResearch(`## Facts\n${GOOD}\n\n## Notes\n- just a note\n* another\n`);
  expect(r.facts).toHaveLength(1);
});

test('a Facts heading with no fact under it is refused', () => {
  expect(() => parseResearch('## Facts\n\n## Notes\n- a note\n')).toThrow(/Facts/);
});

test('research needs a Facts section with at least one fact', () => {
  expect(() => parseResearch('# Notes only\n')).toThrow(/Facts/);
});

test('urls are cut out of <>, ** and () wrappers and lose trailing punctuation', () => {
  const md = `## Facts\n${GOOD}\n\n## Notes\nSee <https://x.com/a> and **https://x.com/c** and (https://x.com/d).\nAlso https://x.com/e: done\n`;
  expect(parseResearch(md).urls).toEqual([
    'https://docs.astral.sh/uv/',
    'https://x.com/a',
    'https://x.com/c',
    'https://x.com/d',
    'https://x.com/e',
  ]);
});

test('writeResearch stores research.md byte for byte and reports the counts', () => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(run);
  writeFileSync(path.join(run, 'concept.md'), 'c');
  const md = MD.replaceAll('\n', '\r\n');
  expect(writeResearch(run, md)).toEqual({
    facts: 2,
    urls: ['https://docs.astral.sh/uv/', 'https://realpython.com/uv-vs-pip/'],
  });
  expect(readFileSync(path.join(run, 'research.md'), 'utf8')).toBe(md);
});
