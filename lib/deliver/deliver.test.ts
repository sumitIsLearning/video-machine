import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BriefSchema,
  type Deliverable,
  type FormatId,
  type LayerPass,
  PlanSchema,
  type RenderAdapter,
  TestResultsSchema,
  TimingSchema,
} from '../contracts/types';
import { loadConfig } from '../core/config';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import type { Loudness } from '../core/media';
import { deliverStageOf } from '../core/paths';
import { sceneFrames, sceneTimes } from '../core/scene-times';
import { type DeliverIo, deliver } from './deliver';

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

const TOTAL = Math.max(...sceneTimes(plan, timing).map((t) => t.start + t.duration));
const FRAMES = sceneFrames(sceneTimes(plan, timing), 30);

/** A run with the brief, plan, timing, test results and (unless asked not to) the mixed sound. */
const makeRun = (o: { deliverables: Deliverable[]; blockingFailed?: number; noMix?: boolean }): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-deliver-'));
  dirs.push(run);
  for (const d of ['data', 'audio']) mkdirSync(path.join(run, d), { recursive: true });
  writeJson(path.join(run, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [1, 30],
    timing_source: 'voiceover',
    deliverables: o.deliverables,
  });
  writeJson(path.join(run, 'plan.json'), PlanSchema, plan);
  writeJson(path.join(run, 'data', 'timing.json'), TimingSchema, timing);
  writeJson(path.join(run, 'test_results.json'), TestResultsSchema, {
    run_id: 'r',
    plan_version: 1,
    output_paths: { stills: {}, contact_sheets: {}, drafts: {}, deliverables: [], report: 'report.md' },
    checks: [{ id: 'plan.coverage', blocking: true, status: 'pass', detail: 'ok', annotations: [] }],
    summary: { blocking_failed: o.blockingFailed ?? 0, warnings: 0 },
  });
  if (!o.noMix) writeFileSync(path.join(run, 'audio', 'mix.wav'), 'wav');
  return run;
};

/** Stubs: render writes the file it returns; srt/ae write their outputs; probe answers by extension. */
const stubs = (o: { loud?: Loudness; clipProfile?: string } = {}) => {
  const renders: unknown[][] = [];
  const sh: string[][] = [];
  const probes: string[] = [];
  const io: DeliverIo = {
    deps: {
      config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
      sh: async (cmd) => {
        sh.push(cmd);
        writeFileSync(cmd.at(-1) as string, 'mp4');
        return { code: 0, stdout: '', stderr: '' };
      },
    },
    render: {
      render: async (
        runDir: string,
        format: FormatId,
        quality: 'draft' | 'final',
        passes?: LayerPass[],
        container?: 'mp4' | 'mov',
      ) => {
        renders.push([runDir, format, quality, passes, container]);
        const file = path.join(runDir, 'out', 'final', `${format}.${container ?? 'mp4'}`);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, container ?? 'mp4');
        return file;
      },
    } as unknown as RenderAdapter,
    srt: {
      kind: 'srt',
      export: async (runDir, d) => {
        const stage = deliverStageOf(runDir, d.format);
        mkdirSync(stage, { recursive: true });
        const file = path.join(stage, 'captions.srt');
        writeFileSync(file, 'srt');
        return file;
      },
    },
    ae: {
      kind: 'ae_package',
      export: async (runDir, d) => {
        const ae = path.join(deliverStageOf(runDir, d.format), 'ae');
        mkdirSync(path.join(ae, 'scenes'), { recursive: true });
        mkdirSync(path.join(ae, 'audio'), { recursive: true });
        for (const [k, f] of FRAMES.entries()) {
          writeFileSync(path.join(ae, 'scenes', `${String(k + 1).padStart(2, '0')}-${f.scene_id}.mov`), 'mov');
        }
        writeFileSync(path.join(ae, 'build_comp.jsx'), 'jsx');
        writeFileSync(path.join(ae, 'audio', 'mix.wav'), 'wav');
        return ae;
      },
    },
    loudness: async () => o.loud ?? { i: -14.1, tp: -2 },
    probe: async (_deps, file) => {
      probes.push(file);
      return file.endsWith('.mp4')
        ? {
            duration: TOTAL,
            video: { codec: 'h264', w: 1080, h: 1920, fps: 30 },
            audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
          }
        : file.endsWith('.srt')
          ? { duration: 0, subtitle: { codec: 'subrip' } }
          : {
              duration: (FRAMES.find((f) => file.includes(f.scene_id))?.n ?? 0) / 30,
              video: { codec: 'prores', profile: o.clipProfile ?? '4444', w: 1080, h: 1920, fps: 30 },
            };
    },
  };
  return { io, renders, sh, probes };
};

test('deliver with no deliverables listed makes the MP4 and the SRT per format and publishes out/deliver', async () => {
  const run = makeRun({ deliverables: [] });
  const { io, renders, sh } = stubs();
  const r = await deliver(run, io);
  expect(r).toEqual({
    ok: true,
    deliverables: ['out/deliver/reel/captions.srt', 'out/deliver/reel/r-reel.mp4'],
    report: 'report.md',
  });
  expect(renders).toEqual([[run, 'reel', 'final', [], 'mp4']]);
  expect(sh[0]).toEqual([
    'ffmpeg',
    '-v',
    'error',
    '-y',
    '-i',
    path.join(run, 'out', 'final', 'reel.mp4'),
    '-i',
    path.join(run, 'audio', 'mix.wav'),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    path.join(run, 'out', 'deliver.tmp', 'reel', 'r-reel.mp4'),
  ]);
  expect(existsSync(path.join(run, 'out', 'deliver.tmp'))).toBe(false);
  const results = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(results.checks.map((c) => `${c.id}/${c.format ?? '-'}/${c.status}`)).toEqual([
    'plan.coverage/-/pass',
    'audio.loudness/reel/pass',
    'deliver.files/-/pass',
  ]);
  expect(results.output_paths.deliverables.map((d) => d.path)).toEqual([
    'out/deliver/reel/captions.srt',
    'out/deliver/reel/r-reel.mp4',
  ]);
  expect(readFileSync(path.join(run, 'report.md'), 'utf8')).toContain('- deliver.files');
});

test('an ae_package renders the MOV and checks every clip', async () => {
  const run = makeRun({ deliverables: [{ format: 'reel', kind: 'ae_package', captions: 'separate' }] });
  const { io, renders, probes } = stubs();
  const r = await deliver(run, io);
  expect(r).toMatchObject({ ok: true, deliverables: ['out/deliver/reel/ae'] });
  expect(renders).toEqual([[run, 'reel', 'final', [], 'mov']]);
  const scenes = path.join(run, 'out', 'deliver.tmp', 'reel', 'ae', 'scenes');
  expect(probes).toContain(path.join(scenes, `01-${FRAMES[0]?.scene_id}.mov`));
  const clips = FRAMES.map((f, k) => path.join(scenes, `${String(k + 1).padStart(2, '0')}-${f.scene_id}.mov`));
  expect(probes).toEqual(expect.arrayContaining(clips));
});

test('an ae_package whose clip is not ProRes 4444 fails deliver.files', async () => {
  const run = makeRun({ deliverables: [{ format: 'reel', kind: 'ae_package', captions: 'separate' }] });
  const r = await deliver(run, stubs({ clipProfile: '422' }).io);
  expect(r).toMatchObject({
    ok: false,
    failed: expect.arrayContaining([expect.objectContaining({ id: 'deliver.files' })]),
  });
});

test('a second deliver leaves the same check ids in test_results.json, none blocking', async () => {
  const run = makeRun({ deliverables: [] });
  expect((await deliver(run, stubs().io)).ok).toBe(true);
  const first = readJson(path.join(run, 'test_results.json'), TestResultsSchema).checks.map((c) => c.id);
  expect((await deliver(run, stubs().io)).ok).toBe(true);
  const after = readJson(path.join(run, 'test_results.json'), TestResultsSchema);
  expect(after.checks.map((c) => c.id)).toEqual(first);
  expect(after.summary.blocking_failed).toBe(0);
});

test('a failing deliver check keeps out/deliver.tmp, publishes nothing and leaves test_results.json alone', async () => {
  const run = makeRun({ deliverables: [] });
  const before = readFileSync(path.join(run, 'test_results.json'), 'utf8');
  mkdirSync(path.join(run, 'out', 'deliver'), { recursive: true });
  writeFileSync(path.join(run, 'out', 'deliver', 'old.mp4'), 'old');
  const r = await deliver(run, stubs({ loud: { i: -9, tp: 0 } }).io);
  expect(r.ok).toBe(false);
  expect(r).toMatchObject({ failed: [{ id: 'audio.loudness', format: 'reel' }] });
  expect(existsSync(path.join(run, 'out', 'deliver.tmp', 'reel', 'r-reel.mp4'))).toBe(true);
  expect(readFileSync(path.join(run, 'out', 'deliver', 'old.mp4'), 'utf8')).toBe('old');
  expect(readFileSync(path.join(run, 'test_results.json'), 'utf8')).toBe(before);
});

test('deliver refuses failing scene checks, a missing mix and unsupported deliverables before rendering', async () => {
  const cases: [Parameters<typeof makeRun>[0], typeof InputError | typeof UnsupportedError][] = [
    [{ deliverables: [], blockingFailed: 1 }, InputError],
    [{ deliverables: [], noMix: true }, InputError],
    [{ deliverables: [{ format: 'square', kind: 'srt', captions: 'separate' }] }, InputError],
    [{ deliverables: [{ format: 'reel', kind: 'mp4_h264', captions: 'none' }] }, UnsupportedError],
    [{ deliverables: [{ format: 'reel', kind: 'gif', captions: 'burned' }] }, UnsupportedError],
  ];
  for (const [opts, err] of cases) {
    const { io, renders } = stubs();
    await expect(deliver(makeRun(opts), io)).rejects.toThrow(err);
    expect(renders).toEqual([]);
  }
});
