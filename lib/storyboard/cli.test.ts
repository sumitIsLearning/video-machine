import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanSchema } from '../contracts/types';
import { writeJson } from '../core/json';
import { main } from './cli';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

test('usage mistakes name the usage', async () => {
  await expect(main(['board', '/tmp/x'])).rejects.toThrow(
    'usage: cli.ts write <run_dir> (plan JSON on stdin) | board <run_dir> <scene_id> [--at s] (HTML on stdin) | page <run_dir>',
  );
});

test('a board with a bad --at is refused before stdin is read', async () => {
  await expect(main(['board', '/tmp/x', 'hook', '--at', 'soon'])).rejects.toThrow('--at must be a number of seconds');
});

test('a board with --at given last and no value is refused', async () => {
  await expect(main(['board', '/tmp/x', 'hook', '--at'])).rejects.toThrow('--at must be a number of seconds');
});

test('a plan on stdin that is not JSON is an InputError', async () => {
  const stdin = async () => new TextEncoder().encode('{nope');
  await expect(main(['write', '/tmp/x'], { stdin })).rejects.toThrow('plan on stdin is not JSON');
});

test('a board for a scene id the plan does not have is an InputError', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  writeJson(path.join(d, 'plan.json'), PlanSchema, {
    run_id: 'r',
    version: 1,
    look_id: 'ember',
    visuals_plan: {
      scenes: [
        {
          scene_id: 'hook',
          lines: ['l1'],
          cut_in: { anchor: 'l1', rule: 'pause_before' },
          intent: 'show hook',
          beats: [{ on: 'URL', does: 'cursor types' }],
          layout: { reel: 'stack' },
          transition_out: 'cut',
          asset_ids: [],
          input_hash: '0123456789abcdef',
        },
      ],
    },
    asset_ids: [],
    formats: ['reel'],
  });
  const stdin = async () => new TextEncoder().encode('<html></html>');
  await expect(main(['board', d, 'nope'], { stdin })).rejects.toThrow('plan.json has no scene "nope"');
});
