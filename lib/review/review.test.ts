import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FeedbackSchema, PlanSchema, SceneNotesSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { review } from './review';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const OUTPUTS = [
  'build/reel/index.html',
  'out/drafts/reel.mp4',
  'out/sheets/reel.jpg',
  'out/final/reel.mp4',
  'out/deliver/reel/r-reel.mp4',
  'out/deliver.tmp/reel/captions.srt',
  'test_results.json',
  'report.md',
];
const KEPT = [
  'audio/vo.wav',
  'audio/mix.wav',
  'data/timing.json',
  'scenes/s1.html',
  'scenes/s2.html',
  'script.json',
  'plan.json',
  'concept.md',
];

/** A delivered run with scenes s1 and s2: every output and every input exists. */
const makeRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-review-'));
  dirs.push(run);
  for (const rel of [...OUTPUTS, ...KEPT, 'brief.json']) {
    mkdirSync(path.dirname(path.join(run, rel)), { recursive: true });
    writeFileSync(path.join(run, rel), rel);
  }
  const scene = (scene_id: string) => ({
    scene_id,
    lines: ['l1'],
    cut_in: { anchor: 'l1', rule: 'pause_before' as const },
    intent: 'i',
    beats: [],
    layout: { reel: 'c' },
    transition_out: 'cut',
    asset_ids: [],
    input_hash: scene_id,
  });
  writeJson(path.join(run, 'plan.json'), PlanSchema, {
    run_id: 'r',
    version: 1,
    look_id: 'l',
    asset_ids: [],
    formats: ['reel'],
    visuals_plan: { scenes: [scene('s1'), scene('s2')] },
  });
  return run;
};
const exists = (run: string, rel: string) => existsSync(path.join(run, rel));

test('a scenes review snapshots the text files, notes the scene and clears only the outputs', () => {
  const run = makeRun();
  const r = review(run, { text: 'make scene 2 slower', route: 'scenes', scenes: ['s2'] });
  expect(r).toEqual({ n: 1, route: 'scenes', redo: ['s2'], removed: expect.any(Array) });
  for (const rel of OUTPUTS) expect(exists(run, rel)).toBe(false);
  for (const rel of KEPT) expect(exists(run, rel)).toBe(true);
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({ s2: 'make scene 2 slower' });
  const fb = readJson(path.join(run, 'history', '1', 'feedback.json'), FeedbackSchema);
  expect(fb).toMatchObject({ n: 1, text: 'make scene 2 slower', route: 'scenes', scenes: ['s2'] });
  expect(readFileSync(path.join(run, 'history', '1', 'scenes', 's2.html'), 'utf8')).toBe('scenes/s2.html');
  expect(readFileSync(path.join(run, 'history', '1', 'report.md'), 'utf8')).toBe('report.md');
  expect(exists(run, 'history/1/audio')).toBe(false);
  expect(readdirSync(path.join(run, 'history'))).toEqual(['1']);
});

test('a second note for the same scene is added on a new line, and the next snapshot is history/2', () => {
  const run = makeRun();
  review(run, { text: 'slower', route: 'scenes', scenes: ['s2'] });
  const r = review(run, { text: 'bigger logo', route: 'scenes', scenes: ['s1', 's2'] });
  expect(r.n).toBe(2);
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({
    s1: 'bigger logo',
    s2: 'slower\nbigger logo',
  });
});

test('a scene id listed twice gets the note once', () => {
  const run = makeRun();
  const r = review(run, { text: 'slower', route: 'scenes', scenes: ['s2', 's2'] });
  expect(r.redo).toEqual(['s2']);
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({ s2: 'slower' });
});

test('a plan review also clears the mix; a words review also clears the voice and the timing', () => {
  const plan = makeRun();
  review(plan, { text: 'swap scenes 1 and 2', route: 'plan' });
  expect(exists(plan, 'audio/mix.wav')).toBe(false);
  expect(exists(plan, 'audio/vo.wav')).toBe(true);
  expect(exists(plan, 'scenes/redo.json')).toBe(false);
  const words = makeRun();
  review(words, { text: 'say "fast" not "quick"', route: 'words' });
  for (const rel of ['audio/mix.wav', 'audio/vo.wav', 'data/timing.json']) expect(exists(words, rel)).toBe(false);
  expect(exists(words, 'history/1/data/timing.json')).toBe(true);
});

test('a words review clears the avatar and keeps its JSON in history; a plan review keeps the avatar', () => {
  const plan = makeRun();
  for (const rel of ['avatar/a01.webm', 'avatar/segments.json', 'avatar/placement.json']) {
    mkdirSync(path.dirname(path.join(plan, rel)), { recursive: true });
    writeFileSync(path.join(plan, rel), rel);
  }
  const words = makeRun();
  for (const rel of ['avatar/a01.webm', 'avatar/segments.json', 'avatar/placement.json']) {
    mkdirSync(path.dirname(path.join(words, rel)), { recursive: true });
    writeFileSync(path.join(words, rel), rel);
  }
  review(plan, { text: 'swap scenes 1 and 2', route: 'plan' });
  expect(exists(plan, 'avatar/a01.webm')).toBe(true);
  review(words, { text: 'say "fast" not "quick"', route: 'words' });
  expect(exists(words, 'avatar')).toBe(false);
  for (const rel of ['avatar/segments.json', 'avatar/placement.json']) {
    expect(exists(words, `history/1/${rel}`)).toBe(true);
  }
});

test('review refuses a folder that is not a run and creates nothing in it', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'vm-review-'));
  dirs.push(parent);
  const missing = path.join(parent, 'nope');
  expect(() => review(missing, { text: 'x', route: 'words' })).toThrow(InputError);
  expect(existsSync(missing)).toBe(false);
});

test('review refuses bad input before it snapshots or deletes anything', () => {
  const bad = [
    { text: 'x', route: 'scenes' as const },
    { text: 'x', route: 'scenes' as const, scenes: ['s9'] },
    { text: 'x', route: 'plan' as const, scenes: ['s1'] },
    { text: '  ', route: 'words' as const },
  ];
  for (const input of bad) {
    const run = makeRun();
    expect(() => review(run, input)).toThrow(InputError);
    expect(exists(run, 'history')).toBe(false);
    expect(exists(run, 'test_results.json')).toBe(true);
  }
});
