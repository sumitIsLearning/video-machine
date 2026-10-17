import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanSchema, SceneHashesSchema, SceneNotesSchema } from '../contracts/types';
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
