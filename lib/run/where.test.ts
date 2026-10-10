import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContractError, InputError } from '../core/errors';
import { listRuns, whereAmI } from './where';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const BRIEF = { run_id: 'r', concept: 'c', goals: [], duration_target_s: [15, 30], timing_source: 'voiceover' };

/** A run folder holding `files` (path → content; a trailing "/" makes a folder) and optionally a brief. */
const runWith = (files: Record<string, string> = {}, brief: object | null = BRIEF, name = 'r') => {
  const runs = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(runs);
  const dir = path.join(runs, name);
  mkdirSync(path.join(dir, 'input'), { recursive: true });
  writeFileSync(path.join(dir, 'concept.md'), 'c');
  if (brief) writeFileSync(path.join(dir, 'brief.json'), JSON.stringify({ ...brief, run_id: name }));
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(dir, ...p.split('/'));
    if (p.endsWith('/')) mkdirSync(full, { recursive: true });
    else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  return { runs, dir };
};

test('a new run with no brief is at M1', () => {
  expect(whereAmI(runWith({}, null).dir)).toEqual({ run_id: 'r', next: 'M1', skipped: [] });
});

test('a concept-only run goes to research next and skips the nav-video parts', () => {
  const w = whereAmI(runWith().dir);
  expect(w.next).toBe('M5');
  expect(w.skipped).toEqual(['M2', 'M3', 'M11']);
});

const NAV = { ...BRIEF, sources: [{ kind: 'nav_video', path_or_url: 'input/nav.mp4' }] };
const NAV_AND_URL = {
  ...BRIEF,
  sources: [...NAV.sources, { kind: 'product_url', path_or_url: 'https://app.example.com' }],
};

test('a nav video makes M2 needed and M3 skipped; research still comes first', () => {
  const w = whereAmI(runWith({ 'input/nav.mp4': 'v' }, NAV).dir);
  expect(w.next).toBe('M5');
  expect(w.skipped).toContain('M3');
  expect(w.skipped).not.toContain('M2');
  expect(whereAmI(runWith({ 'input/nav.mp4': 'v', 'research.md': '# r' }, NAV).dir).next).toBe('M2');
});

test('a nav video plus a product URL needs M2 and M3 from the brief alone; M3 comes after M2', () => {
  const files = { 'input/nav.mp4': 'v', 'research.md': '# r' };
  const w = whereAmI(runWith(files, NAV_AND_URL).dir);
  expect(w.next).toBe('M2');
  expect(w.skipped).not.toContain('M2');
  expect(w.skipped).not.toContain('M3');
  expect(whereAmI(runWith({ ...files, 'capture/steps.json': '[]' }, NAV_AND_URL).dir).next).toBe('M3');
});

test('text-only runs skip voice and alignment', () => {
  const w = whereAmI(runWith({}, { ...BRIEF, timing_source: 'text_only' }).dir);
  expect(w.skipped).toEqual(['M2', 'M3', 'M9', 'M10', 'M11']);
});

test('an empty marker folder does not count as done', () => {
  const done = {
    'research.md': '',
    'assets.json': '[]',
    'script.json': JSON.stringify({ run_id: 'r', version: 1, lines: [{ id: 'l1', text: 'Hi.' }] }),
    'look/look.json': '{}',
    'plan.json': '{}',
    'audio/vo.wav': 'RIFF',
    'data/timing.json': '{}',
    'index.html': '<html>',
    'out/drafts/': '',
  };
  expect(whereAmI(runWith(done).dir).next).toBe('M13');
});

test('every part done means done', () => {
  const all = {
    'research.md': '',
    'assets.json': '[]',
    'script.json': JSON.stringify({ run_id: 'r', version: 1, lines: [{ id: 'l1', text: 'Hi.' }] }),
    'look/look.json': '{}',
    'plan.json': '{}',
    'audio/vo.wav': 'RIFF',
    'data/timing.json': '{}',
    'index.html': '<html>',
    'out/drafts/reel.mp4': 'mp4',
    'test_results.json': '{}',
    'audio/mix.wav': 'RIFF',
    'out/deliver/reel.mp4': 'mp4',
  };
  expect(whereAmI(runWith(all).dir).next).toBe('done');
});

test('an avatar line makes M11 needed once the script exists', () => {
  const brief = { ...BRIEF, avatar: { source: 'supplied', portrait: 'input/me.png' } };
  const script = JSON.stringify({ run_id: 'r', version: 1, lines: [{ id: 'l1', text: 'Hi.', delivery: 'avatar' }] });
  const files = {
    'input/me.png': 'p',
    'research.md': '',
    'assets.json': '[]',
    'script.json': script,
    'look/look.json': '{}',
    'plan.json': '{}',
    'audio/vo.wav': 'RIFF',
    'data/timing.json': '{}',
  };
  expect(whereAmI(runWith(files, brief).dir).next).toBe('M11');
});

test('a folder without concept.md is not a run', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  expect(() => whereAmI(d)).toThrow(InputError);
});

test('listRuns lists run folders newest first and ignores other folders', () => {
  const { runs } = runWith({}, BRIEF, '2026-10-09-a');
  const second = path.join(runs, '2026-10-10-b');
  mkdirSync(path.join(second, 'input'), { recursive: true });
  writeFileSync(path.join(second, 'concept.md'), 'c');
  mkdirSync(path.join(runs, 'not-a-run'));
  expect(listRuns(runs)).toEqual([
    { run_id: '2026-10-10-b', next: 'M1', skipped: [] },
    { run_id: '2026-10-09-a', next: 'M5', skipped: ['M2', 'M3', 'M11'] },
  ]);
  expect(listRuns(path.join(runs, 'missing'))).toEqual([]);
});

test('listRuns reports a run with a broken brief.json as an error entry and still lists the others', () => {
  const { runs } = runWith({}, BRIEF, '2026-10-09-good');
  const bad = path.join(runs, '2026-10-10-bad');
  mkdirSync(bad);
  writeFileSync(path.join(bad, 'concept.md'), 'c');
  writeFileSync(path.join(bad, 'brief.json'), '{bad');
  const [first, second] = listRuns(runs);
  expect(first).toMatchObject({ run_id: '2026-10-10-bad' });
  expect(typeof (first as { error: string }).error).toBe('string');
  expect((first as { error: string }).error).not.toContain('\n');
  expect(second).toMatchObject({ run_id: '2026-10-09-good', next: 'M5' });
});

test('the single-run where still fails loudly on a broken brief.json', () => {
  const { dir } = runWith({}, null);
  writeFileSync(path.join(dir, 'brief.json'), '{bad');
  expect(() => whereAmI(dir)).toThrow(ContractError);
});

test('an invalid script.json is a ContractError', () => {
  expect(() => whereAmI(runWith({ 'script.json': '{"nope":1}' }).dir)).toThrow(ContractError);
});

test('an avatar brief skips M11 when the script has no avatar line, and keeps it before the script exists', () => {
  const brief = { ...BRIEF, avatar: { source: 'supplied', portrait: 'input/me.png' } };
  const script = JSON.stringify({ run_id: 'r', version: 1, lines: [{ id: 'l1', text: 'Hi.' }] });
  expect(whereAmI(runWith({ 'script.json': script }, brief).dir).skipped).toContain('M11');
  expect(whereAmI(runWith({}, brief).dir).skipped).not.toContain('M11');
});

test('an empty out/deliver folder is not done', () => {
  const files = {
    'research.md': '',
    'assets.json': '[]',
    'script.json': JSON.stringify({ run_id: 'r', version: 1, lines: [{ id: 'l1', text: 'Hi.' }] }),
    'look/look.json': '{}',
    'plan.json': '{}',
    'audio/vo.wav': 'RIFF',
    'data/timing.json': '{}',
    'index.html': '<html>',
    'out/drafts/reel.mp4': 'mp4',
    'test_results.json': '{}',
    'audio/mix.wav': 'RIFF',
    'out/deliver/': '',
  };
  expect(whereAmI(runWith(files).dir).next).toBe('M17');
});

test('a zero-byte audio/vo.wav is not done', () => {
  const files = {
    'research.md': '',
    'assets.json': '[]',
    'script.json': JSON.stringify({ run_id: 'r', version: 1, lines: [{ id: 'l1', text: 'Hi.' }] }),
    'look/look.json': '{}',
    'plan.json': '{}',
    'audio/vo.wav': '',
  };
  expect(whereAmI(runWith(files).dir).next).toBe('M9');
});
