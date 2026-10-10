import { afterEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema } from '../contracts/types';
import { ContractError, InputError } from '../core/errors';
import { readJson } from '../core/json';
import { importFiles, newRun, slugOf, writeBrief } from './intake';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};
const NOW = new Date('2026-10-10T09:00:00Z');
const enc = (s: string) => new TextEncoder().encode(s);
const run = (concept = 'Why async standups beat daily meetings\r\nfor remote teams 🎬') =>
  newRun({ runsDir: path.join(temp(), 'runs'), concept: enc(concept), now: NOW });

test('newRun makes runs/<date>-<slug>/ with the concept byte for byte and an input folder', () => {
  const text = '\u{FEFF}Why async standups beat daily meetings\r\nfor remote teams 🎬\r\n';
  const r = newRun({ runsDir: path.join(temp(), 'runs'), concept: enc(text), now: NOW });
  expect(r.run_id).toBe('2026-10-10-why-async-standups-beat-daily');
  expect(readFileSync(path.join(r.runDir, 'concept.md'))).toEqual(Buffer.from(enc(text)));
  expect(existsSync(path.join(r.runDir, 'input'))).toBe(true);
});

test('a second run with the same concept on the same day gets its own folder', () => {
  const runsDir = path.join(temp(), 'runs');
  const a = newRun({ runsDir, concept: enc('Ship faster'), now: NOW });
  const b = newRun({ runsDir, concept: enc('Ship faster'), now: NOW });
  expect(a.run_id).toBe('2026-10-10-ship-faster');
  expect(b.run_id).toBe('2026-10-10-ship-faster-2');
});

test('slugOf keeps five plain words and falls back to "video"', () => {
  expect(slugOf('Why async standups beat daily meetings for remote teams')).toBe('why-async-standups-beat-daily');
  expect(slugOf('🎬🎬 !!')).toBe('video');
});

test('an empty concept is refused and no folder is made', () => {
  const runsDir = path.join(temp(), 'runs');
  expect(() => newRun({ runsDir, concept: enc(' \r\n\t'), now: NOW })).toThrow(InputError);
  expect(existsSync(runsDir) ? readdirSync(runsDir) : []).toEqual([]);
});

test('importFiles copies files into input/ unchanged and returns run paths', () => {
  const r = run();
  const src = path.join(temp(), 'nav.mp4');
  writeFileSync(src, Buffer.from([0, 1, 2, 255]));
  expect(importFiles(r.runDir, [src])).toEqual(['input/nav.mp4']);
  expect(readFileSync(path.join(r.runDir, 'input', 'nav.mp4'))).toEqual(Buffer.from([0, 1, 2, 255]));
});

test('two files with the same name do not overwrite each other', () => {
  const r = run();
  const a = path.join(temp(), 'nav.mp4');
  const b = path.join(temp(), 'nav.mp4');
  writeFileSync(a, 'a');
  writeFileSync(b, 'b');
  expect(importFiles(r.runDir, [a, b])).toEqual(['input/nav.mp4', 'input/nav-2.mp4']);
  expect(readFileSync(path.join(r.runDir, 'input', 'nav-2.mp4'), 'utf8')).toBe('b');
});

test('a file already inside the run folder is not copied again', () => {
  const r = run();
  writeFileSync(path.join(r.runDir, 'input', 'logo.svg'), '<svg/>');
  expect(importFiles(r.runDir, [path.join(r.runDir, 'input', 'logo.svg')])).toEqual(['input/logo.svg']);
});

test('importFiles refuses a missing path, a folder, and a folder that is not a run', () => {
  const r = run();
  expect(() => importFiles(r.runDir, [path.join(temp(), 'nope.mp4')])).toThrow(/nope\.mp4/);
  expect(() => importFiles(r.runDir, [temp()])).toThrow(InputError);
  expect(() => importFiles(temp(), [])).toThrow(InputError);
});

test('a junction inside the run folder that points outside is copied, not trusted', () => {
  const r = run();
  const outside = temp();
  writeFileSync(path.join(outside, 'secret.txt'), 's');
  symlinkSync(outside, path.join(r.runDir, 'input', 'junc'), 'junction');
  expect(importFiles(r.runDir, [path.join(r.runDir, 'input', 'junc', 'secret.txt')])).toEqual(['input/secret.txt']);
  expect(readFileSync(path.join(r.runDir, 'input', 'secret.txt'), 'utf8')).toBe('s');
});

test('a brief that names a file behind a junction out of the run folder is refused', () => {
  const r = run();
  const outside = temp();
  writeFileSync(path.join(outside, 'secret.txt'), 's');
  symlinkSync(outside, path.join(r.runDir, 'input', 'junc'), 'junction');
  expect(() => writeBrief(r.runDir, { sources: [{ kind: 'file', path_or_url: 'input/junc/secret.txt' }] })).toThrow(
    /resolves outside the run folder/,
  );
  expect(existsSync(path.join(r.runDir, 'brief.json'))).toBe(false);
});

test.skipIf(process.platform !== 'win32')(
  'a file inside the run folder given in another case gets its on-disk case',
  () => {
    const r = run();
    writeFileSync(path.join(r.runDir, 'input', 'Logo.svg'), '<svg/>');
    expect(importFiles(r.runDir, [path.join(r.runDir, 'input', 'LOGO.SVG')])).toEqual(['input/Logo.svg']);
  },
);

test('a file whose name starts with ".." and sits inside the run folder is not treated as outside', () => {
  const r = run();
  writeFileSync(path.join(r.runDir, 'input', '..x.mp4'), 'v');
  expect(importFiles(r.runDir, [path.join(r.runDir, 'input', '..x.mp4')])).toEqual(['input/..x.mp4']);
});

test('importFiles imports nothing when one file in the list is missing', () => {
  const r = run();
  const ok = path.join(temp(), 'ok.mp4');
  writeFileSync(ok, 'v');
  expect(() => importFiles(r.runDir, [ok, path.join(temp(), 'missing.mp4')])).toThrow(InputError);
  expect(readdirSync(path.join(r.runDir, 'input'))).toEqual([]);
});

test('a name taken by another import is never overwritten', () => {
  const r = run();
  const a = path.join(temp(), 'nav.mp4');
  writeFileSync(a, 'new');
  writeFileSync(path.join(r.runDir, 'input', 'nav.mp4'), 'old');
  expect(importFiles(r.runDir, [a])).toEqual(['input/nav-2.mp4']);
  expect(readFileSync(path.join(r.runDir, 'input', 'nav.mp4'), 'utf8')).toBe('old');
});

test('a concept with invalid UTF-8 and a 50 000 line script is stored byte for byte', () => {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0x41, 0x0a]),
    Buffer.from(Array.from({ length: 50_000 }, (_, i) => `line ${i}`).join('\r\n')),
  ]);
  const r = newRun({ runsDir: path.join(temp(), 'runs'), concept: bytes, now: NOW });
  expect(readFileSync(path.join(r.runDir, 'concept.md')).equals(bytes)).toBe(true);
});

test('the concept default is cut at 200 characters without splitting an emoji', () => {
  const r = run(`${'a'.repeat(199)}🎬🎬`);
  const { concept } = writeBrief(r.runDir, {});
  expect(Array.from(concept)).toHaveLength(200);
  expect(concept.endsWith('🎬')).toBe(true);
});

test.each(['../x.mp4', '/etc/passwd', 'input\\a.mp4'])('writeBrief rejects the source path %s', (p) => {
  const r = run();
  expect(() => writeBrief(r.runDir, { sources: [{ kind: 'file', path_or_url: p }] })).toThrow(ContractError);
  expect(existsSync(path.join(r.runDir, 'brief.json'))).toBe(false);
});

test('a concept-only draft gets every intake default', () => {
  const r = run();
  const b = writeBrief(r.runDir, {});
  expect(b).toMatchObject({
    run_id: r.run_id,
    concept: 'Why async standups beat daily meetings',
    goals: [],
    formats: ['reel'],
    duration_target_s: [15, 30],
    timing_source: 'voiceover',
    voice: { source: 'tts', adapter: 'hf-tts', voice_id: 'af_heart' },
    sources: [],
    budget_usd: 0,
  });
  expect(readJson(path.join(r.runDir, 'brief.json'), BriefSchema)).toEqual(b);
  expect(readFileSync(path.join(r.runDir, 'brief.json'), 'utf8').endsWith('}\n')).toBe(true);
});

test('values the creator gave are kept; text-only gets no voice', () => {
  const r = run();
  const b = writeBrief(r.runDir, { duration_target_s: [20, 25], timing_source: 'text_only', concept: 'Async wins' });
  expect(b.duration_target_s).toEqual([20, 25]);
  expect(b.concept).toBe('Async wins');
  expect(b.voice).toBeUndefined();
});

test('a brief source must already be in the run folder', () => {
  const r = run();
  expect(() => writeBrief(r.runDir, { sources: [{ kind: 'nav_video', path_or_url: 'input/nav.mp4' }] })).toThrow(
    /input\/nav\.mp4/,
  );
  expect(existsSync(path.join(r.runDir, 'brief.json'))).toBe(false);
  writeFileSync(path.join(r.runDir, 'input', 'nav.mp4'), 'v');
  expect(writeBrief(r.runDir, { sources: [{ kind: 'nav_video', path_or_url: 'input/nav.mp4' }] }).sources).toHaveLength(
    1,
  );
});

test('a path outside the run folder is a contract error and nothing is written', () => {
  const r = run();
  expect(() => writeBrief(r.runDir, { sources: [{ kind: 'file', path_or_url: 'C:/Users/me/x.png' }] })).toThrow(
    ContractError,
  );
  expect(existsSync(path.join(r.runDir, 'brief.json'))).toBe(false);
});

test('a format with no default length asks for duration_target_s', () => {
  const r = run();
  expect(() => writeBrief(r.runDir, { formats: ['landscape_1080p'] })).toThrow(/duration_target_s/);
});

test('a draft that is not an object, or names another run, is refused', () => {
  const r = run();
  expect(() => writeBrief(r.runDir, [])).toThrow(InputError);
  expect(() => writeBrief(r.runDir, null)).toThrow(InputError);
  expect(() => writeBrief(r.runDir, { run_id: 'someone-else' })).toThrow(InputError);
});

test('writeBrief refuses a folder that is not a run', () => {
  const d = temp();
  mkdirSync(path.join(d, 'input'));
  expect(() => writeBrief(d, {})).toThrow(InputError);
});
