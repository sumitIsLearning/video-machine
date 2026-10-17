import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AssetsSchema,
  BriefSchema,
  type FormatId,
  type Issue,
  LookSchema,
  PlanSchema,
  type RenderAdapter,
  ScriptSchema,
  TestResultsSchema,
  TimingSchema,
} from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { checkScenes } from './check';

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

const CHECK_ORDER = [
  'contracts.valid',
  'plan.coverage',
  'script.facts_cited',
  'render.lint',
  'render.deterministic',
  'render.seek_safe',
  'motion.no_dead_spans',
  'timing.beats_on_cues',
  'timing.duration',
  'layout.safe_area',
  'layout.min_text_size',
  'layout.no_overflow',
  'assets.no_reference_only',
  'assets.licensed',
  'captions.match',
];

/** A reel run with one scene `demo` that has a draft, unless `draft` is false. */
const makeRun = (draft = true): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(run);
  writeFileSync(path.join(run, 'concept.md'), 'c');
  writeJson(path.join(run, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [1, 60],
    timing_source: 'voiceover',
    formats: ['reel'],
  });
  writeJson(path.join(run, 'plan.json'), PlanSchema, {
    run_id: 'r',
    version: 1,
    look_id: 'look',
    visuals_plan: {
      scenes: [
        {
          scene_id: 'demo',
          lines: ['l1'],
          cut_in: { anchor: 'l1', rule: 'pause_before' },
          intent: 'i',
          beats: [],
          layout: { reel: 'centre' },
          transition_out: 'cut',
          asset_ids: [],
          input_hash: 'h',
        },
      ],
    },
    asset_ids: [],
    formats: ['reel'],
  });
  writeJson(path.join(run, 'script.json'), ScriptSchema, {
    run_id: 'r',
    version: 1,
    lines: [{ id: 'l1', text: 'Hi.' }],
  });
  writeJson(path.join(run, 'look', 'look.json'), LookSchema, {
    id: 'look',
    based_on: [],
    idea: 'i',
    palette: [{ name: 'ink', hex: '#000000', role: 'bg' }],
    type: [{ role: 'display', family: 'Inter', weights: [400], license: 'OFL' }],
    motion: { character: 'calm', easings: [], typical_beat_s: [0.5, 1], camera: 'static' },
    motifs: [],
    post: {},
    layout_rules: { landscape: 'l', vertical: 'v', square: 's' },
  });
  writeJson(path.join(run, 'assets.json'), AssetsSchema, { run_id: 'r', assets: [] });
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, {
    lines: [{ id: 'l1', text: 'Hi.', start: 0, end: 2, words: [{ w: 'Hi', start: 0, end: 0.5 }] }],
  });
  mkdirSync(path.join(run, 'scenes'), { recursive: true });
  writeFileSync(path.join(run, 'scenes', 'demo.html'), '<div>Hi</div>');
  writeFileSync(path.join(run, 'research.md'), '## Facts\n- uv is fast — "uv is fast" — https://docs.astral.sh/uv/\n');
  if (draft) {
    mkdirSync(path.join(run, 'out', 'drafts'), { recursive: true });
    writeFileSync(path.join(run, 'out', 'drafts', 'reel.mp4'), 'mp4');
  }
  return run;
};

const renderStub = (issues: Issue[] = []): RenderAdapter => ({
  name: 'stub',
  supports: () => ({ ok: true }),
  lint: async () => [],
  check: async () => issues,
  still: async () => [],
  contactSheet: async (runDir: string, format: FormatId) => path.join(runDir, 'out', 'sheets', `${format}.jpg`),
  render: async (runDir: string, format: FormatId) => path.join(runDir, 'out', 'drafts', `${format}.mp4`),
});

/** A text sample in the bottom band of the reel (below the 20% safe margin) with a legible size. */
const badText = {
  t: 1,
  scene_id: 'demo',
  text: 'Hi',
  box: { x: 100, y: 1700, w: 200, h: 100 },
  font_px: 80,
  caption: false,
};

const measure = {
  runtime: async () => '/runtime.js',
  text: async () => [badText],
  diffs: async () => Array.from({ length: 300 }, () => 100),
  hashes: async (_dir: string, at: number[]) => at.map(() => 'same'),
};

test('checkScenes writes test_results.json with every check in order and the safe-area failure', async () => {
  const run = makeRun();
  await checkScenes(run, { render: renderStub(), measure });
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(results.checks.map((c) => c.id)).toEqual(CHECK_ORDER);
  expect(results.plan_version).toBe(1);
  expect(results.output_paths.drafts).toEqual({ reel: 'out/drafts/reel.mp4' });
  expect(results.output_paths.contact_sheets).toEqual({ reel: 'out/sheets/reel.jpg' });
  const safe = results.checks.find((c) => c.id === 'layout.safe_area');
  expect(safe?.status).toBe('fail');
  expect(safe?.annotations[0]?.scene_id).toBe('demo');
  expect(results.summary.blocking_failed).toBe(1);
});

test('checkScenes fails contracts.valid when a run file breaks its schema', async () => {
  const run = makeRun();
  mkdirSync(path.join(run, 'capture'), { recursive: true });
  writeFileSync(path.join(run, 'capture', 'steps.json'), '[{}]');
  await checkScenes(run, { render: renderStub(), measure });
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(results.checks[0]).toMatchObject({ id: 'contracts.valid', status: 'fail' });
});

test('checkScenes writes report.md with the failing count first and the failing scene listed', async () => {
  const run = makeRun();
  await checkScenes(run, { render: renderStub(), measure });
  const report = readFileSync(path.join(run, 'report.md'), 'utf8');
  expect(report.split('\n')[0]).toBe('# Checks: 1 blocking failed');
  expect(report).toContain('layout.safe_area');
  expect(report).toContain('scene demo');
});

test('checkScenes returns the failing count, the failing scenes and the report name', async () => {
  const run = makeRun();
  const result = await checkScenes(run, { render: renderStub(), measure });
  expect(result).toEqual({ blocking_failed: 1, failing_scenes: ['demo'], report: 'report.md' });
});

test('checkScenes throws InputError before measuring when research.md is missing', async () => {
  const run = makeRun();
  rmSync(path.join(run, 'research.md'));
  let measured = false;
  const spy = {
    ...measure,
    text: async () => {
      measured = true;
      return [badText];
    },
  };
  await expect(checkScenes(run, { render: renderStub(), measure: spy })).rejects.toThrow(
    'research.md is missing: run research (M5) first',
  );
  expect(measured).toBe(false);
});

test('checkScenes counts a layout overflow once, under layout.no_overflow', async () => {
  const run = makeRun();
  const issues: Issue[] = [{ severity: 'error', scene_id: 'demo', message: 'layout text overflows its box' }];
  const clean = { ...badText, box: { x: 100, y: 800, w: 200, h: 100 } };
  const result = await checkScenes(run, {
    render: renderStub(issues),
    measure: { ...measure, text: async () => [clean] },
  });
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  const byId = (id: string) => results.checks.find((c) => c.id === id);
  expect(byId('render.lint')?.status).toBe('pass');
  expect(byId('layout.no_overflow')?.status).toBe('fail');
  expect(results.summary.blocking_failed).toBe(1);
  expect(result.blocking_failed).toBe(1);
});

test('checkScenes throws InputError when the draft is not rendered', async () => {
  const run = makeRun(false);
  await expect(checkScenes(run, { render: renderStub(), measure })).rejects.toThrow(InputError);
  await expect(checkScenes(run, { render: renderStub(), measure })).rejects.toThrow('render the draft first');
});

test('checkScenes throws InputError before running the render check when research.md is missing', async () => {
  const run = makeRun();
  rmSync(path.join(run, 'research.md'));
  let checked = false;
  const render = {
    ...renderStub(),
    check: async () => {
      checked = true;
      return [];
    },
  };
  await expect(checkScenes(run, { render, measure })).rejects.toThrow(InputError);
  expect(checked).toBe(false);
});

test('checkScenes gives one annotation for an error repeated in the render check', async () => {
  const run = makeRun();
  const issue: Issue = { severity: 'error', scene_id: 'demo', message: 'layout text overflows its box' };
  const clean = { ...badText, box: { x: 100, y: 800, w: 200, h: 100 } };
  await checkScenes(run, {
    render: renderStub([issue, { ...issue }]),
    measure: { ...measure, text: async () => [clean] },
  });
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(results.checks.find((c) => c.id === 'layout.no_overflow')?.annotations).toHaveLength(1);
});

test('checkScenes names the scene of a blocking failure that has only a time', async () => {
  const run = makeRun();
  const plan = readJson(path.join(run, 'plan.json'), PlanSchema);
  const demo = plan.visuals_plan.scenes[0];
  if (demo === undefined) throw new Error('the fixture has a scene');
  writeJson(path.join(run, 'plan.json'), PlanSchema, {
    ...plan,
    visuals_plan: {
      scenes: [demo, { ...demo, scene_id: 'second', lines: ['l2'], cut_in: { anchor: 'l2', rule: 'pause_before' } }],
    },
  });
  writeJson(path.join(run, 'script.json'), ScriptSchema, {
    run_id: 'r',
    version: 1,
    lines: [
      { id: 'l1', text: 'Hi.' },
      { id: 'l2', text: 'Yo.' },
    ],
  });
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, {
    lines: [
      { id: 'l1', text: 'Hi.', start: 0, end: 0.1, words: [{ w: 'Hi', start: 0, end: 0.1 }] },
      { id: 'l2', text: 'Yo.', start: 0.1, end: 3, words: [{ w: 'Yo', start: 0.1, end: 3 }] },
    ],
  });
  const clean = { ...badText, box: { x: 100, y: 800, w: 200, h: 100 } };
  let renders = 0;
  const unstable = {
    ...measure,
    text: async () => [clean],
    hashes: async (_dir: string, at: number[]) => {
      renders++;
      return at.map(() => (renders === 2 ? 'b' : 'a'));
    },
  };
  const result = await checkScenes(run, { render: renderStub(), measure: unstable });
  expect(result.failing_scenes).toEqual(['second']);
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  const det = results.checks.find((c) => c.id === 'render.deterministic');
  expect(det?.status).toBe('fail');
  expect(det?.annotations.every((a) => a.scene_id === 'second')).toBe(true);
});
