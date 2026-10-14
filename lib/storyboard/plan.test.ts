import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssetsSchema, BriefSchema, LookSchema, PlanSchema, ScriptSchema } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { writeLook } from '../look/look';
import { writePlan, writeSceneBoard } from './plan';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const LOOK = LookSchema.parse({
  id: 'ember',
  based_on: [],
  idea: 'i',
  palette: [{ name: 'ink', hex: '#111111', role: 'bg' }],
  type: [{ role: 'display', family: 'Inter', weights: [700], license: 'OFL' }],
  motion: { character: 's', easings: [], typical_beat_s: [0.4, 0.8], camera: 'static' },
  motifs: [],
  post: {},
  layout_rules: { landscape: '', vertical: '', square: '' },
});
const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  writeJson(path.join(d, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [15, 30],
    timing_source: 'voiceover',
  });
  writeJson(path.join(d, 'script.json'), ScriptSchema, {
    run_id: 'r',
    version: 1,
    lines: [
      { id: 'l1', text: 'Paste a URL.' },
      { id: 'l2', text: 'Get clean data.' },
      { id: 'l3', text: 'Try Firecrawl.' },
    ],
  });
  writeJson(path.join(d, 'look', 'look.json'), LookSchema, LOOK);
  mkdirSync(path.join(d, 'capture', 'shots'), { recursive: true });
  writeFileSync(path.join(d, 'capture', 'shots', '7.png'), 'png');
  writeJson(path.join(d, 'assets.json'), AssetsSchema, {
    run_id: 'r',
    assets: [
      {
        asset_id: 'captured-aaaa1111',
        kind: 'image',
        path: 'capture/shots/7.png',
        source: 's',
        license: 'own capture of x',
        usage: 'render',
        origin: 'captured',
      },
    ],
  });
  return d;
};
const scene = (scene_id: string, lines: string[], extra: object = {}) => ({
  scene_id,
  lines,
  cut_in: { anchor: lines[0], rule: 'pause_before' },
  intent: `show ${scene_id}`,
  beats: [{ on: 'URL', does: 'cursor types' }],
  layout: { reel: 'stack' },
  transition_out: 'cut',
  asset_ids: [],
  ...extra,
});

test('writes plan.json with run_id, version, look_id, formats, hashes and the union of asset ids', () => {
  const d = run();
  const r = writePlan(d, {
    scenes: [scene('hook', ['l1']), scene('demo', ['l2', 'l3'], { asset_ids: ['captured-aaaa1111'] })],
  });
  const plan = readJson(path.join(d, 'plan.json'), PlanSchema);
  expect(plan).toMatchObject({
    run_id: 'r',
    version: 1,
    look_id: 'ember',
    formats: ['reel'],
    asset_ids: ['captured-aaaa1111'],
  });
  expect(plan.visuals_plan.scenes[0]?.input_hash).toMatch(/^[0-9a-f]{16}$/);
  expect(r.scenes).toEqual([
    { scene_id: 'hook', lines: ['l1'], start_s: 0, end_s: 1.2 },
    { scene_id: 'demo', lines: ['l2', 'l3'], start_s: 1.45, end_s: 3.7 },
  ]);
  expect(r).toMatchObject({ est_s: 3.7, target_s: [15, 30], fits: false });
});

test('input_hash changes with the scene, its lines or the look, and only then', () => {
  const d = run();
  const hashes = () => readJson(path.join(d, 'plan.json'), PlanSchema).visuals_plan.scenes.map((s) => s.input_hash);
  const write = (hookIntent = 'show hook') =>
    writePlan(d, { scenes: [scene('hook', ['l1'], { intent: hookIntent }), scene('demo', ['l2', 'l3'])] });
  write();
  const [h1, d1] = hashes() as [string, string];
  write();
  expect(hashes()).toEqual([h1, d1]);
  write('bigger hook');
  expect(hashes()[0]).not.toBe(h1);
  expect(hashes()[1]).toBe(d1);
  writeJson(path.join(d, 'look', 'look.json'), LookSchema, { ...LOOK, id: 'paper' });
  write('bigger hook');
  expect(hashes()[1]).not.toBe(d1);
});

test('input_hash changes when the look content changes under the same id', () => {
  const d = run();
  const hash = () => readJson(path.join(d, 'plan.json'), PlanSchema).visuals_plan.scenes[0]?.input_hash;
  const scenes = () => [scene('hook', ['l1']), scene('demo', ['l2', 'l3'])];
  writePlan(d, { scenes: scenes() });
  const before = hash();
  writeJson(path.join(d, 'look', 'look.json'), LookSchema, { ...LOOK, idea: 'another idea' });
  writePlan(d, { scenes: scenes() });
  expect(hash()).not.toBe(before);
});

test('a scene with its keys in another order keeps its hash and is not changed', () => {
  const d = run();
  const reversed = (o: object) => Object.fromEntries(Object.entries(o).reverse());
  writePlan(d, { scenes: [scene('hook', ['l1']), scene('demo', ['l2', 'l3'])] });
  const r = writePlan(d, { scenes: [reversed(scene('hook', ['l1'])), reversed(scene('demo', ['l2', 'l3']))] });
  expect(r.changed).toEqual([]);
});

test('writePlan lists every scene as changed on the first write and none on a repeat', () => {
  const d = run();
  const scenes = () => [scene('hook', ['l1']), scene('demo', ['l2', 'l3'])];
  expect(writePlan(d, { scenes: scenes() }).changed).toEqual(['hook', 'demo']);
  expect(writePlan(d, { scenes: scenes() }).changed).toEqual([]);
});

test('an edited scene is the only changed one, and only its board is deleted', () => {
  const d = run();
  writePlan(d, { scenes: [scene('hook', ['l1']), scene('demo', ['l2', 'l3'])] });
  mkdirSync(path.join(d, 'boards'), { recursive: true });
  writeFileSync(path.join(d, 'boards', 'hook.png'), 'png');
  writeFileSync(path.join(d, 'boards', 'demo.png'), 'png');
  const r = writePlan(d, {
    scenes: [scene('hook', ['l1'], { intent: 'bigger hook' }), scene('demo', ['l2', 'l3'])],
  });
  expect(r.changed).toEqual(['hook']);
  expect(existsSync(path.join(d, 'boards', 'hook.png'))).toBe(false);
  expect(existsSync(path.join(d, 'boards', 'demo.png'))).toBe(true);
});

test('asset_ids that is not an array is refused with an InputError', () => {
  const d = run();
  expect(() => writePlan(d, { scenes: [scene('a', ['l1', 'l2', 'l3'])], asset_ids: 'captured-aaaa1111' })).toThrow(
    'asset_ids must be an array of asset ids',
  );
});

test('a folder without concept.md is refused by writeLook and by writePlan', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  expect(() => writeLook(d, 'A', { look: LOOK, md: '# A' })).toThrow('is not a run folder');
  expect(() => writePlan(d, { scenes: [scene('a', ['l1'])] })).toThrow('is not a run folder');
});

test('a coverage failure is refused and nothing is written', () => {
  const d = run();
  expect(() => writePlan(d, { scenes: [scene('hook', ['l1']), scene('demo', ['l3'])] })).toThrow(
    'line l2 is in no scene',
  );
  expect(existsSync(path.join(d, 'plan.json'))).toBe(false);
});

test('needs script.json and look/look.json, and renderable assets', () => {
  const d = run();
  rmSync(path.join(d, 'look'), { recursive: true });
  expect(() => writePlan(d, { scenes: [scene('a', ['l1', 'l2', 'l3'])] })).toThrow(
    'look/look.json is missing: pick a look (M7) first',
  );
  const e = run();
  expect(() => writePlan(e, { scenes: [scene('a', ['l1', 'l2', 'l3'], { asset_ids: ['nope'] })] })).toThrow(
    'unknown asset "nope"',
  );
});

test('a malformed plan is refused with an InputError', () => {
  const d = run();
  const msg = 'plan needs scenes: [{ scene_id, lines[], asset_ids[], ... }]';
  expect(() => writePlan(d, { scenes: 'x' })).toThrow(/scenes/);
  expect(() => writePlan(d, { scenes: [null] })).toThrow(msg);
  expect(() => writePlan(d, { scenes: [{ scene_id: 'a' }] })).toThrow(msg);
});

test('a plan with no non-empty scenes array is refused with an InputError', () => {
  const d = run();
  expect(() => writePlan(d, {})).toThrow(InputError);
  expect(() => writePlan(d, {})).toThrow(/scenes/);
  expect(() => writePlan(d, { visuals_plan: {} })).toThrow(InputError);
  expect(() => writePlan(d, { visuals_plan: {} })).toThrow(/scenes/);
});

const deps: Deps = {
  config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
  sh: async (cmd) => {
    if (cmd.includes('lint')) return { code: 0, stdout: JSON.stringify({ ok: true, findings: [] }), stderr: '' };
    const out = cmd[cmd.indexOf('-o') + 1] as string;
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'frame-00-at-1s.png'), 'frame');
    return { code: 0, stdout: '', stderr: '' };
  },
};

test("a scene board copies that scene's assets and renders boards/<scene_id>.png", async () => {
  const d = run();
  writePlan(d, { scenes: [scene('hook', ['l1']), scene('demo', ['l2', 'l3'], { asset_ids: ['captured-aaaa1111'] })] });
  expect(await writeSceneBoard(deps, d, 'demo', '<html></html>', 1)).toEqual({ png: 'boards/demo.png', warnings: [] });
  expect(existsSync(path.join(d, 'boards', 'demo', 'assets', 'captured-aaaa1111.png'))).toBe(true);
  expect(readFileSync(path.join(d, 'boards', 'demo.png'), 'utf8')).toBe('frame');
  await expect(writeSceneBoard(deps, d, 'nope', '<html></html>', 1)).rejects.toThrow('plan.json has no scene "nope"');
});
