import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AssetsSchema,
  type FormatId,
  type Issue,
  PlanSchema,
  type RenderAdapter,
  TimingSchema,
} from '../contracts/types';
import { InputError } from '../core/errors';
import { writeJson } from '../core/json';
import { main } from './cli';

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A reel run with one scene `demo` that uses asset a1 and has no draft yet. */
const makeRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(run);
  writeFileSync(path.join(run, 'concept.md'), 'c');
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
          asset_ids: ['a1'],
          input_hash: 'h',
        },
      ],
    },
    asset_ids: ['a1'],
    formats: ['reel'],
  });
  writeJson(path.join(run, 'assets.json'), AssetsSchema, {
    run_id: 'r',
    assets: [
      {
        asset_id: 'a1',
        kind: 'image',
        path: 'assets/a1.png',
        source: 'test',
        license: 'CC0',
        usage: 'render',
        origin: 'drawn',
      },
    ],
  });
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, {
    lines: [{ id: 'l1', text: 'Hi.', start: 0, end: 2, words: [{ w: 'Hi', start: 0, end: 0.5 }] }],
  });
  return run;
};

test('times prints the first format frame and each scene with its asset source', async () => {
  const run = makeRun();
  const result = await main(['times', run]);
  expect(result).toMatchObject({
    format: 'reel',
    frame: { w: 1080, h: 1920, safe_px: { top: 269, right: 65, bottom: 384, left: 65 }, min_text_px: 68 },
    scenes: [{ scene_id: 'demo', assets: [{ asset_id: 'a1', src: 'assets/a1.png' }] }],
  });
});

test('an unknown command is a usage error', async () => {
  const run = makeRun();
  await expect(main(['nope', run])).rejects.toThrow(InputError);
  await expect(main(['nope', run])).rejects.toThrow(
    'usage: cli.ts times <run_dir> | build <run_dir> | check <run_dir>',
  );
});

test('check calls through to checkScenes and so needs the draft first', async () => {
  const run = makeRun();
  await expect(main(['check', run])).rejects.toThrow('render the draft first');
});

test('build calls through to buildScenes and returns its failing scenes on an error issue', async () => {
  const run = makeRun();
  const error: Issue = { severity: 'error', scene_id: 'demo', message: 'lint: bad markup' };
  const render: RenderAdapter = {
    name: 'stub',
    supports: () => ({ ok: true }),
    lint: async () => [],
    check: async () => [error],
    still: async () => [],
    contactSheet: async (_runDir: string, format: FormatId) => `${format}.jpg`,
    render: async (_runDir: string, format: FormatId) => `${format}.mp4`,
  };
  const result = await main(['build', run], {
    render,
    assemble: async (runDir, format) => path.join(runDir, 'build', format),
  });
  expect(result).toEqual({ ok: false, failing_scenes: ['demo'], issues: [error] });
});
