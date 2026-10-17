import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { writeJson } from '../core/json';
import { main } from './cli';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A delivered run with scenes s1 and s2: every output and every input exists. */
const makeRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-review-'));
  dirs.push(run);
  for (const rel of [
    'build/reel/index.html',
    'out/drafts/reel.mp4',
    'out/sheets/reel.jpg',
    'out/final/reel.mp4',
    'out/deliver/reel/r-reel.mp4',
    'out/deliver.tmp/reel/captions.srt',
    'test_results.json',
    'report.md',
    'audio/vo.wav',
    'audio/mix.wav',
    'data/timing.json',
    'scenes/s1.html',
    'scenes/s2.html',
    'script.json',
    'plan.json',
    'concept.md',
    'brief.json',
  ]) {
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

test('snapshot reads the feedback from stdin and prints the review result', async () => {
  const run = makeRun();
  const r = await main(['snapshot', run, '--route', 'scenes', '--scenes', 's1,s2'], 'tighter cuts\n');
  expect(r).toMatchObject({ n: 1, route: 'scenes', redo: ['s1', 's2'] });
});

test('snapshot refuses a missing or unknown route and extra arguments', async () => {
  const run = makeRun();
  for (const argv of [
    ['snapshot', run],
    ['snapshot', run, '--route', 'look'],
    ['snapshot', run, '--route', 'plan', 'x'],
    ['other', run],
  ]) {
    await expect(main(argv, 'x')).rejects.toThrow(InputError);
  }
});
