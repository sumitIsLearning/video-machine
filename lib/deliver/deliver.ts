// M17: makes the deliverables of each format in a staging folder, checks them, and publishes them as out/deliver.
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { aeExport } from '../adapters/export/ae';
import { srtExport } from '../adapters/export/srt';
import { hyperframesRender } from '../adapters/render/hyperframes';
import { checkLoudness } from '../checks/audio';
import { checkDeliverFiles, type DeliverItem } from '../checks/deliver';
import { mergeChecks, writeReport } from '../checks/report';
import {
  BriefSchema,
  type CheckResult,
  type Deliverable,
  type ExportAdapter,
  FORMATS,
  type FormatId,
  type Plan,
  PlanSchema,
  type RenderAdapter,
  TestResultsSchema,
  TimingSchema,
} from '../contracts/types';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { loudnessOf, probeMedia } from '../core/media';
import { deliverStageOf } from '../core/paths';
import { sceneFrames, sceneTimes } from '../core/scene-times';

/** What a deliver run may inject. Anything missing falls back to the real tool. */
export type DeliverIo = {
  deps?: Deps;
  render?: RenderAdapter;
  srt?: ExportAdapter;
  ae?: ExportAdapter;
  loudness?: typeof loudnessOf;
  probe?: typeof probeMedia;
};

/** The outcome of a deliver run: the published paths, or the blocking checks that failed (nothing is published). */
export type DeliverResult =
  | { ok: true; deliverables: string[]; report: 'report.md' }
  | {
      ok: false;
      failed: { id: string; format?: FormatId; detail: string; problems: string[] }[];
      stage: 'out/deliver.tmp';
    };

// ponytail: the mux runs in ffmpeg with a fixed 10 min cap; a longer reel would need a per-run setting.
const MUX_TIMEOUT_MS = 600_000;
// The order in which one format's deliverables are made.
const KIND_ORDER: Deliverable['kind'][] = ['srt', 'mp4_h264', 'ae_package'];

/** The deliverables of a brief that lists none: an MP4 with burned captions and an SRT, per format. */
const defaultDeliverables = (plan: Plan): Deliverable[] =>
  plan.formats.flatMap((format) => [
    { format, kind: 'mp4_h264', captions: 'burned' },
    { format, kind: 'srt', captions: 'separate' },
  ]);

/** Refuses a deliverable whose format is not in the plan (InputError) or whose kind or captions are not supported. */
const validate = (plan: Plan, list: Deliverable[]): void => {
  for (const d of list) {
    if (!plan.formats.includes(d.format)) throw new InputError(`deliverable format ${d.format} is not in plan.json`);
    if (!KIND_ORDER.includes(d.kind)) throw new UnsupportedError(`deliverable kind ${d.kind} is not supported yet`);
    if (d.kind === 'mp4_h264' && d.captions !== 'burned')
      throw new UnsupportedError(`mp4_h264 for ${d.format} supports only burned captions`);
  }
};

/** Refuses to deliver until the scene checks pass and the sound is mixed (both InputError). */
const assertReady = (runDir: string, mix: string): void => {
  const results = path.join(runDir, 'test_results.json');
  if (!existsSync(results) || readJson(results, TestResultsSchema).summary.blocking_failed !== 0)
    throw new InputError('the scene checks have not passed: run the scenes check first');
  if (!existsSync(mix)) throw new InputError(`${mix} is missing: mix the sound first`);
};

const relRun = (runDir: string, file: string): string => path.relative(runDir, file).split(path.sep).join('/');
const sizeOf = (file: string): number => (existsSync(file) ? statSync(file).size : 0);

/**
 * Delivers every deliverable of a run: checks the scene results and the mix, renders and muxes or exports each one into
 * out/deliver.tmp, checks the files, then publishes them as out/deliver. Returns the published paths, or the failing
 * blocking checks with nothing published. Throws InputError or UnsupportedError before any render, and ToolError when a tool fails.
 */
export const deliver = async (runDir: string, io: DeliverIo = {}): Promise<DeliverResult> => {
  const deps = io.deps ?? defaultDeps();
  const render = io.render ?? hyperframesRender(deps);
  const srt = io.srt ?? srtExport();
  const ae = io.ae ?? aeExport(deps);
  const loudness = io.loudness ?? loudnessOf;
  const probe = io.probe ?? probeMedia;

  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
  const mix = path.join(runDir, 'audio', 'mix.wav');
  assertReady(runDir, mix);
  const list = brief.deliverables.length > 0 ? brief.deliverables : defaultDeliverables(plan);
  validate(plan, list);

  const times = sceneTimes(plan, timing);
  const total = Math.max(...times.map((t) => t.start + t.duration));
  rmSync(path.join(runDir, 'out', 'deliver.tmp'), { recursive: true, force: true });

  const items: DeliverItem[] = [];
  const checks: CheckResult[] = [];
  const outputs: { deliverable: Deliverable; path: string }[] = [];
  const media = async (
    kind: DeliverItem['kind'],
    file: string,
    expect?: DeliverItem['expect'],
  ): Promise<DeliverItem> => ({
    path: relRun(runDir, file),
    kind,
    size: sizeOf(file),
    probe: kind === 'file' ? undefined : await probe(deps, file),
    expect,
  });
  const publishedAs = (d: Deliverable, file: string): string =>
    ['out', 'deliver', d.format, path.basename(file)].join('/');

  for (const format of plan.formats) {
    const stage = deliverStageOf(runDir, format);
    const { w, h, fps } = FORMATS[format];
    for (const kind of KIND_ORDER) {
      for (const d of list.filter((x) => x.format === format && x.kind === kind)) {
        if (d.kind === 'srt') {
          const file = await srt.export(runDir, d);
          items.push(await media('srt', file));
          outputs.push({ deliverable: d, path: publishedAs(d, file) });
        } else if (d.kind === 'mp4_h264') {
          const rendered = await render.render(runDir, format, 'final', [], 'mp4');
          const file = path.join(stage, `${brief.run_id}-${format}.mp4`);
          mkdirSync(stage, { recursive: true });
          await deps.sh(
            [
              'ffmpeg',
              '-v',
              'error',
              '-y',
              '-i',
              rendered,
              '-i',
              mix,
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
              file,
            ],
            { timeoutMs: MUX_TIMEOUT_MS },
          );
          checks.push(checkLoudness(format, await loudness(deps, file)));
          items.push(await media('mp4', file, { w, h, fps, duration: total }));
          outputs.push({ deliverable: d, path: publishedAs(d, file) });
        } else {
          await render.render(runDir, format, 'final', [], 'mov');
          const dir = await ae.export(runDir, d);
          for (const [k, f] of sceneFrames(times, fps).entries()) {
            const clip = path.join(dir, 'scenes', `${String(k + 1).padStart(2, '0')}-${f.scene_id}.mov`);
            items.push(await media('clip', clip, { w, h, fps, duration: f.n / fps }));
          }
          items.push(await media('file', path.join(dir, 'build_comp.jsx')));
          items.push(await media('file', path.join(dir, 'audio', 'mix.wav')));
          outputs.push({ deliverable: d, path: publishedAs(d, dir) });
        }
      }
    }
  }

  const all = [...checks, checkDeliverFiles(items)];
  const failed = all.filter((c) => c.blocking && c.status === 'fail');
  if (failed.length > 0) {
    return {
      ok: false,
      failed: failed.map((c) => ({
        id: c.id,
        format: c.format,
        detail: c.detail,
        problems: c.annotations.map((a) => a.problem),
      })),
      stage: 'out/deliver.tmp',
    };
  }

  const finalDir = path.join(runDir, 'out', 'deliver');
  rmSync(finalDir, { recursive: true, force: true });
  renameSync(path.join(runDir, 'out', 'deliver.tmp'), finalDir);
  const resultsFile = path.join(runDir, 'test_results.json');
  const prev = readJson(resultsFile, TestResultsSchema);
  const merged = mergeChecks(prev.checks, all);
  const blocking = merged.filter((c) => c.blocking && c.status === 'fail').length;
  const delivered = outputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeJson(resultsFile, TestResultsSchema, {
    ...prev,
    checks: merged,
    summary: { ...prev.summary, blocking_failed: blocking },
    output_paths: { ...prev.output_paths, deliverables: delivered },
  });
  writeReport(runDir, merged, blocking);
  return { ok: true, deliverables: delivered.map((o) => o.path), report: 'report.md' };
};
