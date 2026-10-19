import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AvatarPlacementSchema, AvatarSegmentsSchema, PlanSchema } from '../contracts/types';
import { presetBox } from '../core/avatar';
import { InputError } from '../core/errors';
import { writeJson } from '../core/json';
import { main } from './cli';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('avatar make refuses a bad --approve-spend before reading the run', async () => {
  await expect(main(['make', '/no/such/run', '--approve-spend', 'x'])).rejects.toThrow(InputError);
});

test('avatar boxes places each segment on the reel format', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-m11-cli-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'avatar'));
  writeJson(path.join(dir, 'plan.json'), PlanSchema, {
    run_id: 'r',
    version: 1,
    look_id: 'x',
    visuals_plan: {
      scenes: [
        {
          scene_id: 's1',
          lines: ['l1'],
          cut_in: { anchor: 'l1', rule: 'pause_before' },
          intent: 'i',
          beats: [],
          layout: { reel: 'full' },
          transition_out: 'cut',
          asset_ids: [],
          input_hash: 'h',
        },
      ],
    },
    asset_ids: [],
    formats: ['reel'],
  });
  writeJson(path.join(dir, 'avatar', 'segments.json'), AvatarSegmentsSchema, {
    run_id: 'r',
    adapter: 'fake',
    segments: [{ seg: 'a01', line_ids: ['l2'], start: 1.35, end: 4, file: 'avatar/a01.webm' }],
  });
  writeJson(path.join(dir, 'avatar', 'placement.json'), AvatarPlacementSchema, { segments: { a01: 'full' } });
  expect(await main(['boxes', dir])).toEqual({
    boxes: { reel: [{ seg: 'a01', start: 1.35, end: 4, ...presetBox('full', 'reel') }] },
  });
});

test('avatar refuses an unknown command with the usage', async () => {
  await expect(main(['nope', '/no/such/run'])).rejects.toThrow(InputError);
});
