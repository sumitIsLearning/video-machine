import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssetsSchema, BriefSchema, PlanSchema, TimingSchema } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { writeJson } from '../core/json';
import { sceneTimes } from '../core/scene-times';
import { mixSound } from './mix';

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

const PASS1 = `[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-23.04",
	"input_tp" : "-18.72",
	"input_lra" : "2.70",
	"input_thresh" : "-34.72",
	"output_i" : "-14.01",
	"output_tp" : "-9.84",
	"output_lra" : "2.10",
	"output_thresh" : "-25.49",
	"normalization_type" : "dynamic",
	"target_offset" : "0.01"
}`;
const EBUR = 'Summary:\n  Integrated loudness:\n    I:         -13.9 LUFS\n  True peak:\n    Peak:       -9.7 dBFS\n';

type Music = 'none' | 'supplied' | 'pinned' | 'two-pinned' | 'unknown-licence';
const makeRun = (music: Music, withVo = true): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-mix-'));
  dirs.push(run);
  for (const d of ['data', 'audio', 'input', 'assets']) mkdirSync(path.join(run, d), { recursive: true });
  writeJson(path.join(run, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [1, 30],
    timing_source: 'voiceover',
    ...(music === 'supplied' ? { music: { source: 'supplied', path: 'input/song.mp3' } } : {}),
  });
  writeJson(path.join(run, 'plan.json'), PlanSchema, plan);
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, timing);
  if (music === 'supplied') writeFileSync(path.join(run, 'input', 'song.mp3'), 'mp3');
  const pinned = (asset_id: string, license: string) => {
    writeFileSync(path.join(run, 'assets', `${asset_id}.mp3`), 'mp3');
    return {
      asset_id,
      kind: 'audio' as const,
      path: `assets/${asset_id}.mp3`,
      source: 'openverse',
      license,
      usage: 'render' as const,
      origin: 'found' as const,
      status: 'pinned' as const,
    };
  };
  const assets =
    music === 'pinned'
      ? [pinned('m1', 'CC0')]
      : music === 'two-pinned'
        ? [pinned('m1', 'CC0'), pinned('m2', 'CC0')]
        : music === 'unknown-licence'
          ? [pinned('m1', 'unknown')]
          : [];
  writeJson(path.join(run, 'assets.json'), AssetsSchema, { run_id: 'r', assets });
  if (withVo) writeFileSync(path.join(run, 'audio', 'vo.wav'), 'wav');
  return run;
};

const fakeDeps = (failPass2 = false) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd) => {
      calls.push(cmd);
      const af = cmd[cmd.indexOf('-af') + 1] ?? '';
      if (af.includes('print_format=json')) return { code: 0, stdout: '', stderr: PASS1 };
      if (af.includes('ebur128')) return { code: 0, stdout: '', stderr: EBUR };
      if (failPass2 && af.includes('measured_I')) throw new ToolError({ cmd, code: 1, stderr: 'boom' });
      writeFileSync(cmd.at(-1) as string, 'wav');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { deps, calls };
};

test('mixSound with no music pads the voice to the reel length and normalises it in two passes', async () => {
  const run = makeRun('none');
  const { deps, calls } = fakeDeps();
  const total = Math.max(...sceneTimes(plan, timing).map((t) => t.start + t.duration));
  const r = await mixSound(deps, run);
  expect(r).toEqual({ mix: 'audio/mix.wav', music: null, i: -13.9, tp: -9.7, duration: total });
  const pre = calls[0]?.join(' ') ?? '';
  expect(pre).toContain(`apad=whole_dur=${total}`);
  expect(pre).not.toContain('sidechaincompress');
  expect(calls[2]?.join(' ')).toContain(
    'measured_I=-23.04:measured_TP=-18.72:measured_LRA=2.70:measured_thresh=-34.72:offset=0.01:linear=true',
  );
  expect(readdirSync(path.join(run, 'audio')).sort()).toEqual(['mix.wav', 'vo.wav']);
});

test('mixSound loops a supplied music bed under the voice, ducked and at -12 dB', async () => {
  const run = makeRun('supplied');
  const { deps, calls } = fakeDeps();
  const r = await mixSound(deps, run);
  expect(r.music).toBe('input/song.mp3');
  const pre = calls[0] ?? [];
  expect(pre.slice(pre.indexOf('-stream_loop'), pre.indexOf('-stream_loop') + 4)).toEqual([
    '-stream_loop',
    '-1',
    '-i',
    path.join(run, 'input', 'song.mp3'),
  ]);
  const graph = pre[pre.indexOf('-filter_complex') + 1] ?? '';
  expect(graph).toContain('volume=-12dB');
  expect(graph).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300');
  expect(graph).toContain('amix=inputs=2:duration=first:normalize=0');
  expect(graph).toMatch(/apad=whole_dur=[\d.]+,atrim=0:[\d.]+,asplit/);
});

test('mixSound takes the one pinned audio asset as music', async () => {
  const run = makeRun('pinned');
  const { deps } = fakeDeps();
  expect((await mixSound(deps, run)).music).toBe('assets/m1.mp3');
});

test('mixSound mixes the voice alone when the run has no assets.json', async () => {
  const run = makeRun('none');
  rmSync(path.join(run, 'assets.json'));
  expect((await mixSound(fakeDeps().deps, run)).music).toBeNull();
});

test('mixSound refuses two pinned music assets, an unknown licence and a missing voice', async () => {
  for (const [m, vo] of [
    ['two-pinned', true],
    ['unknown-licence', true],
    ['none', false],
  ] as const) {
    const run = makeRun(m, vo);
    await expect(mixSound(fakeDeps().deps, run)).rejects.toThrow(InputError);
  }
});

test('mixSound leaves no mix.wav and no temp file when a pass fails', async () => {
  const run = makeRun('none');
  writeFileSync(path.join(run, 'audio', 'mix.wav'), 'old');
  await expect(mixSound(fakeDeps(true).deps, run)).rejects.toThrow(ToolError);
  expect(readdirSync(path.join(run, 'audio'))).toEqual(['vo.wav']);
});
