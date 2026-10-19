import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AvatarPlacementSchema,
  AvatarSegmentsSchema,
  PlanSchema,
  SceneHashesSchema,
  SceneNotesSchema,
  TimingSchema,
} from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { markDone, scenesTodo } from './todo';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scene = (scene_id: string, input_hash: string) => ({
  scene_id,
  lines: ['l1'],
  cut_in: { anchor: 'l1', rule: 'pause_before' as const },
  intent: 'i',
  beats: [],
  layout: { reel: 'c' },
  transition_out: 'cut',
  asset_ids: [],
  input_hash,
});
/** Plan scenes a (hash ha), b (hb), c (hc); fragments for the ids in `written`. */
const makeRun = (written: string[]): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-todo-'));
  dirs.push(run);
  mkdirSync(path.join(run, 'scenes'));
  writeJson(path.join(run, 'plan.json'), PlanSchema, {
    run_id: 'r',
    version: 2,
    look_id: 'l',
    asset_ids: [],
    formats: ['reel'],
    visuals_plan: { scenes: [scene('a', 'ha'), scene('b', 'hb'), scene('c', 'hc')] },
  });
  for (const id of written) writeFileSync(path.join(run, 'scenes', `${id}.html`), `<div>${id}</div>`);
  return run;
};

const w = (text: string, start: number, end: number) => ({ w: text, start, end });
const timedScene = (scene_id: string, lines: string[]) => ({
  scene_id,
  lines,
  cut_in: { anchor: '', rule: 'pause_before' as const },
  intent: 'x',
  beats: [],
  layout: { reel: 'x' },
  transition_out: 'cut',
  asset_ids: [],
  input_hash: 'h',
});
/** A run with hook [l1] (0-1.6 s) and demo [l2, l3] (1.6-5.5 s), and avatar a01 on 2-4.25 s at corner-br. */
const avatarRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-todo-'));
  dirs.push(run);
  mkdirSync(path.join(run, 'data'));
  mkdirSync(path.join(run, 'avatar'));
  writeJson(path.join(run, 'plan.json'), PlanSchema, {
    run_id: 'r',
    version: 2,
    look_id: 'l',
    asset_ids: [],
    formats: ['reel'],
    visuals_plan: { scenes: [timedScene('hook', ['l1']), timedScene('demo', ['l2', 'l3'])] },
  });
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, {
    lines: [
      {
        id: 'l1',
        text: 'Meet Firecrawl today',
        start: 0.2,
        end: 1.4,
        words: [w('Meet', 0.2, 0.5), w('today', 1.15, 1.4)],
      },
      { id: 'l2', text: 'Crawl any site', start: 1.8, end: 2.9, words: [w('Crawl', 1.8, 2.2), w('site', 2.55, 2.9)] },
      { id: 'l3', text: 'any site at all', start: 3.3, end: 4.5, words: [w('any', 3.3, 3.5), w('all', 4.15, 4.5)] },
    ],
  });
  writeJson(path.join(run, 'avatar', 'segments.json'), AvatarSegmentsSchema, {
    run_id: 'r',
    adapter: 'supplied',
    segments: [{ seg: 'a01', line_ids: ['l2'], start: 2, end: 4.25, file: 'avatar/a01.webm' }],
  });
  writeJson(path.join(run, 'avatar', 'placement.json'), AvatarPlacementSchema, { segments: { a01: 'corner-br' } });
  return run;
};

test('scenesTodo gives each todo scene the avatar boxes over its window, relative to its start', () => {
  const todo = scenesTodo(avatarRun());
  expect(todo.find((t) => t.scene_id === 'demo')).toEqual({
    scene_id: 'demo',
    reason: 'new',
    avatar: [{ format: 'reel', seg: 'a01', start: 0.4, end: 2.65, box: { x: 587, y: 966, w: 428, h: 570 } }],
  });
  expect(todo.find((t) => t.scene_id === 'hook')).not.toHaveProperty('avatar');
});

test('a fresh run has every scene to write', () => {
  expect(scenesTodo(makeRun([]))).toEqual([
    { scene_id: 'a', reason: 'new' },
    { scene_id: 'b', reason: 'new' },
    { scene_id: 'c', reason: 'new' },
  ]);
});

test('fragments with no recorded hash count as current', () => {
  expect(scenesTodo(makeRun(['a', 'b', 'c']))).toEqual([]);
});

test('a changed plan hash and a feedback note make a scene to write, in plan order', () => {
  const run = makeRun(['a', 'b', 'c']);
  writeJson(path.join(run, 'scenes', 'hashes.json'), SceneHashesSchema, { a: 'ha', b: 'old', c: 'hc' });
  writeJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema, { c: 'slower' });
  expect(scenesTodo(run)).toEqual([
    { scene_id: 'b', reason: 'changed' },
    { scene_id: 'c', reason: 'feedback', feedback: 'slower' },
  ]);
});

test('markDone records the plan hash and drops the note of each scene', () => {
  const run = makeRun(['a', 'b', 'c']);
  writeJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema, { b: 'x', c: 'slower' });
  markDone(run, ['c']);
  expect(readJson(path.join(run, 'scenes', 'hashes.json'), SceneHashesSchema)).toEqual({ c: 'hc' });
  expect(readJson(path.join(run, 'scenes', 'redo.json'), SceneNotesSchema)).toEqual({ b: 'x' });
  markDone(run, ['b']);
  expect(existsSync(path.join(run, 'scenes', 'redo.json'))).toBe(false);
  expect(scenesTodo(run)).toEqual([]);
});

test('markDone refuses an unknown scene, a scene with no fragment and an empty list, changing nothing', () => {
  const run = makeRun(['a']);
  for (const ids of [['z'], ['b'], []]) expect(() => markDone(run, ids)).toThrow(InputError);
  expect(existsSync(path.join(run, 'scenes', 'hashes.json'))).toBe(false);
});
