import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema, PlanSchema, TimingSchema } from '../../../contracts/types';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { deliverStageOf } from '../../../core/paths';
import { sceneFrames, sceneTimes } from '../../../core/scene-times';
import { aeExport, buildCompJsx } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const w = (word: string, start: number, end: number) => ({ w: word, start, end });
const scene = (scene_id: string, line: string) => ({
  scene_id,
  lines: [line],
  cut_in: { anchor: line, rule: 'pause_before' as const },
  intent: 'i',
  beats: [],
  layout: { reel: 'centre' },
  transition_out: 'cut',
  asset_ids: [],
  input_hash: 'h',
});
const plan = PlanSchema.parse({
  run_id: 'r',
  version: 1,
  look_id: 'look',
  asset_ids: [],
  formats: ['reel'],
  visuals_plan: { scenes: [scene('hook', 'l1'), scene('cta', 'l2')] },
});
const timing = TimingSchema.parse({
  lines: [
    {
      id: 'l1',
      text: 'Scrape any site.',
      start: 0.2,
      end: 1.1,
      words: [w('Scrape', 0.2, 0.5), w('any', 0.55, 0.7), w('site', 0.75, 1.1)],
    },
    { id: 'l2', text: 'Try it.', start: 1.5, end: 2.2, words: [w('Try', 1.5, 1.8), w('it', 1.85, 2.2)] },
  ],
});

/** A run with the plan, timing, a final MOV, the mix and the staged SRT. */
const makeRun = (withMov = true): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-ae-'));
  dirs.push(run);
  for (const d of ['data', 'audio', 'out/final', 'out/deliver.tmp/reel'])
    mkdirSync(path.join(run, d), { recursive: true });
  writeJson(path.join(run, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [1, 30],
    timing_source: 'voiceover',
  });
  writeJson(path.join(run, 'plan.json'), PlanSchema, plan);
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, timing);
  if (withMov) writeFileSync(path.join(run, 'out', 'final', 'reel.mov'), 'mov');
  writeFileSync(path.join(run, 'audio', 'mix.wav'), 'wav');
  writeFileSync(path.join(run, 'out', 'deliver.tmp', 'reel', 'captions.srt'), '1\n');
  return run;
};

const fakeDeps = () => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd) => {
      calls.push(cmd);
      if (cmd[0] === 'ffmpeg') writeFileSync(cmd.at(-1) as string, 'clip');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { deps, calls };
};

test('aeExport cuts one clip per scene on whole frames and writes the package', async () => {
  const run = makeRun();
  const { deps, calls } = fakeDeps();
  const dir = await aeExport(deps).export(run, { format: 'reel', kind: 'ae_package', captions: 'separate' });
  expect(dir).toBe(path.join(run, 'out', 'deliver.tmp', 'reel', 'ae'));
  const frames = sceneFrames(sceneTimes(plan, timing), 30);
  expect(calls).toEqual(
    frames.map((f, k) => [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-ss',
      (f.f0 / 30).toFixed(6),
      '-i',
      path.join(run, 'out', 'final', 'reel.mov'),
      '-frames:v',
      String(f.n),
      '-c',
      'copy',
      '-an',
      path.join(path.dirname(dir), '.ae.tmp', 'scenes', `0${k + 1}-${f.scene_id}.mov`),
    ]),
  );
  expect(readFileSync(path.join(dir, 'audio', 'mix.wav'), 'utf8')).toBe('wav');
  expect(readFileSync(path.join(dir, 'captions.srt'), 'utf8')).toBe('1\n');
  const jsx = readFileSync(path.join(dir, 'build_comp.jsx'), 'utf8');
  expect(() => new Function(jsx)).not.toThrow();
  expect(jsx).toContain('"scenes/01-hook.mov"');
  expect(jsx).toContain('"Scrape"');
});

test('aeExport drops clips left in a stale .ae.tmp by an earlier killed run', async () => {
  const run = makeRun();
  const stale = path.join(deliverStageOf(run, 'reel'), '.ae.tmp', 'scenes', '99-stale.mov');
  mkdirSync(path.dirname(stale), { recursive: true });
  writeFileSync(stale, 'old');
  const { deps } = fakeDeps();
  const dir = await aeExport(deps).export(run, { format: 'reel', kind: 'ae_package', captions: 'separate' });
  expect(existsSync(path.join(dir, 'scenes', '99-stale.mov'))).toBe(false);
});

test('aeExport throws InputError when the final MOV is missing, and leaves no package', async () => {
  const run = makeRun(false);
  const { deps } = fakeDeps();
  await expect(
    aeExport(deps).export(run, { format: 'reel', kind: 'ae_package', captions: 'separate' }),
  ).rejects.toThrow(InputError);
  expect(existsSync(path.join(run, 'out', 'deliver.tmp', 'reel', 'ae'))).toBe(false);
});

test('buildCompJsx places each clip at its start, adds the mix and one marker per word', () => {
  const jsx = buildCompJsx({
    name: 'r-reel',
    w: 1080,
    h: 1920,
    fps: 30,
    duration: 3.2,
    clips: [
      { file: 'scenes/01-hook.mov', start: 0 },
      { file: 'scenes/02-cta.mov', start: 1.3 },
    ],
    words: [
      { t: 0.2, w: 'Scrape' },
      { t: 1.5, w: 'it\'s "ok"' },
    ],
  });
  expect(() => new Function(jsx)).not.toThrow();
  expect(jsx).toContain('app.project.items.addComp("r-reel", 1080, 1920, 1, 3.2, 30)');
  expect(jsx).toContain('["scenes/02-cta.mov", 1.3]');
  expect(jsx).toContain('[1.5, "it\'s \\"ok\\""]');
  expect(jsx).toContain('"audio/mix.wav"');
  expect(jsx).toContain('new MarkerValue(');
});
