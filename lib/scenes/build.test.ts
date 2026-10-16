import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type FormatId, type Issue, PlanSchema, type RenderAdapter } from '../contracts/types';
import { InputError } from '../core/errors';
import { writeJson } from '../core/json';
import { buildScenes } from './build';

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A reel run with one scene `demo`: concept.md and plan.json only, which is all the build reads. */
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
          asset_ids: [],
          input_hash: 'h',
        },
      ],
    },
    asset_ids: [],
    formats: ['reel'],
  });
  return run;
};

/** A render stub that records the calls the build makes and reports the given issues from check. */
const recordingRender = (issues: Issue[]) => {
  const calls: string[] = [];
  const render: RenderAdapter = {
    name: 'stub',
    supports: () => ({ ok: true }),
    lint: async () => [],
    check: async () => issues,
    still: async () => [],
    contactSheet: async (runDir: string, format: FormatId, perScene: number) => {
      calls.push(`sheet ${format} ${perScene}`);
      return path.join(runDir, 'out', 'sheets', `${format}.jpg`);
    },
    render: async (runDir: string, format: FormatId, quality: 'draft' | 'final') => {
      calls.push(`render ${format} ${quality}`);
      return path.join(runDir, 'out', 'drafts', `${format}.mp4`);
    },
  };
  return { render, calls };
};

test('buildScenes makes the sheet and the draft and returns their run paths when no error issue', async () => {
  const run = makeRun();
  const warning: Issue = { severity: 'warning', scene_id: 'demo', message: 'soft' };
  const { render, calls } = recordingRender([warning]);
  const result = await buildScenes(run, {
    render,
    assemble: async (runDir, format) => path.join(runDir, 'build', format),
  });
  expect(result).toEqual({
    ok: true,
    formats: {
      reel: {
        build: 'build/reel',
        sheet: 'out/sheets/reel.jpg',
        draft: 'out/drafts/reel.mp4',
        warnings: [warning],
      },
    },
  });
  expect(calls).toEqual(['sheet reel 2', 'render reel draft']);
});

test('buildScenes names the failing scene and makes no sheet or draft on an error issue', async () => {
  const run = makeRun();
  const error: Issue = { severity: 'error', scene_id: 'demo', message: 'lint: bad markup' };
  const { render, calls } = recordingRender([error]);
  const result = await buildScenes(run, {
    render,
    assemble: async (runDir, format) => path.join(runDir, 'build', format),
  });
  expect(result).toEqual({ ok: false, failing_scenes: ['demo'], issues: [error] });
  expect(calls).toEqual([]);
});

test('buildScenes lets an assemble InputError propagate', async () => {
  const run = makeRun();
  const { render } = recordingRender([]);
  await expect(
    buildScenes(run, {
      render,
      assemble: async () => {
        throw new InputError('scenes/demo.html is missing');
      },
    }),
  ).rejects.toThrow(InputError);
});
