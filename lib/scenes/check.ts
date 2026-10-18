// Runs the render checks (R13) on a built run and writes test_results.json and report.md. Checks only read the run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hyperframesRender } from '../adapters/render/hyperframes';
import { frameDiffs, hfRuntimeFile, measureText, snapshotHashes } from '../adapters/render/hyperframes/measure';
import { assembleProject } from '../adapters/render/hyperframes/project';
import { checkLicensed, checkNoReferenceOnly } from '../checks/assets';
import { type CaptionSample, checkCaptions } from '../checks/captions';
import { checkContractsValid } from '../checks/contracts';
import { checkCoverage } from '../checks/coverage';
import { checkDuration } from '../checks/duration';
import { checkFactsCited } from '../checks/facts-cited';
import { checkMinTextSize, checkSafeArea, type TextSample } from '../checks/layout';
import { checkBeatsOnCues, checkDeadSpans } from '../checks/motion';
import { writeReport } from '../checks/report';
import { checkDeterministic, checkSeekSafe, sampleTimes } from '../checks/stability';
import {
  AssetsSchema,
  BriefSchema,
  type CheckResult,
  FORMATS,
  type FormatId,
  type Issue,
  LookSchema,
  type Plan,
  PlanSchema,
  type RenderAdapter,
  ScriptSchema,
  TestResultsSchema,
  TimingSchema,
} from '../contracts/types';
import { avatarBoxesOf } from '../core/avatar';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { type SceneTime, sceneTimes } from '../core/scene-times';
import { parseResearch } from '../research/research';

/** The measuring functions a check run uses; the defaults drive HyperFrames, Chrome and ffmpeg. */
export type Measure = {
  runtime: () => Promise<string>;
  text: (buildDir: string, runtimeFile: string, times: number[]) => Promise<TextSample[]>;
  diffs: (mp4: string) => Promise<number[]>;
  hashes: (dir: string, at: number[]) => Promise<string[]>;
};
/** What a scenes command may inject. Anything missing falls back to the real tool. */
export type ScenesIo = {
  deps?: Deps;
  render?: RenderAdapter;
  assemble?: typeof assembleProject;
  measure?: Measure;
};

/** The adapters and measuring functions a command uses: the injected ones, else the real ones. */
export const resolveIo = (io: ScenesIo) => {
  const deps = io.deps ?? defaultDeps();
  return {
    render: io.render ?? hyperframesRender(deps),
    assemble: io.assemble ?? assembleProject,
    measure: io.measure ?? {
      runtime: () => hfRuntimeFile(deps),
      text: measureText,
      diffs: (mp4: string) => frameDiffs(deps, mp4),
      hashes: (dir: string, at: number[]) => snapshotHashes(deps, dir, at),
    },
  };
};

/** A path inside the run, relative to it with POSIX separators, as the JSON records it. */
export const relRun = (runDir: string, file: string): string => path.relative(runDir, file).split(path.sep).join('/');

/** The scene ids named by the given problems, in plan order, each once. */
export const failingScenes = (plan: Plan, ids: string[]): string[] => {
  const named = new Set(ids);
  return plan.visuals_plan.scenes.map((s) => s.scene_id).filter((id) => named.has(id));
};

// The fraction-of-a-second slack for matching a caption sample to a word's time.
const TIME_EPSILON_S = 1e-6;
// The stills per layout sample grid (R11): every 0.5 s from 0.25 s, plus each word's midpoint.
const GRID_START_S = 0.25;
const GRID_STEP_S = 0.5;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** The problems of the adapter's issues as one blocking CheckResult, each with the given fix. */
const issuesResult = (id: string, problems: Issue[], fix: string): CheckResult => ({
  id,
  blocking: true,
  status: problems.length === 0 ? 'pass' : 'fail',
  detail: problems.length === 0 ? 'no problems' : `${problems.length} problem(s)`,
  annotations: problems.map((p) => ({
    ...(p.scene_id === undefined ? {} : { scene_id: p.scene_id }),
    problem: p.message,
    suggested_fix: fix,
  })),
});

/** Names the scene playing at each time of a failed blocking check's annotation that has a time but no scene. */
const pinScenes = (scenes: SceneTime[], checks: CheckResult[]): CheckResult[] =>
  checks.map((c) => {
    if (!c.blocking || c.status !== 'fail') return c;
    return {
      ...c,
      annotations: c.annotations.map((a) => {
        const t = a.t;
        if (t === undefined || a.scene_id !== undefined) return a;
        const started = scenes.filter((s) => s.start <= t);
        const id = started[started.length - 1]?.scene_id;
        return id === undefined ? a : { ...a, scene_id: id };
      }),
    };
  });

/** The times the layout and caption checks sample (R11), sorted, each once. */
const layoutTimes = (scenes: SceneTime[], total: number): number[] => {
  const grid: number[] = [];
  for (let t = GRID_START_S; t < total; t += GRID_STEP_S) grid.push(round3(t));
  const mids = scenes.flatMap((s) => s.words.map((w) => round3((w.start + w.end) / 2)));
  return [...new Set([...grid, ...mids])].sort((a, b) => a - b);
};

/** The asset ids built into a format, by file stem (the build copies each asset as `<id><ext>`). */
const builtAssetIds = (build: string): string[] => {
  const dir = path.join(build, 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((file) => path.parse(file).name);
};

/** Each spoken word's caption check: the caption on screen at the sampled time nearest the word's midpoint. */
const captionSamples = (scenes: SceneTime[], text: TextSample[], times: number[]): CaptionSample[] =>
  scenes.flatMap((scene) =>
    scene.words.map((w) => {
      const mid = (w.start + w.end) / 2;
      const t = times.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best), times[0] ?? mid);
      const shown = text
        .filter((s) => s.caption && Math.abs(s.t - t) < TIME_EPSILON_S)
        .map((s) => s.text)
        .join(' ');
      return { t: mid, scene_id: scene.scene_id, word: w.w, shown };
    }),
  );

/** What the per-format checks measure for one format. */
type Measured = {
  format: FormatId;
  build: string;
  at: number[];
  first: string[];
  second: string[];
  single: string[];
  diffs: number[];
  text: TextSample[];
  times: number[];
};

/** Samples the built format: text boxes, frame differences and snapshot hashes at the seeded times. */
const measureFormat = async (
  measure: Measure,
  runDir: string,
  format: FormatId,
  seed: string,
  scenes: SceneTime[],
  total: number,
): Promise<Measured> => {
  const build = path.join(runDir, 'build', format);
  const times = layoutTimes(scenes, total);
  const at = sampleTimes(seed, total, 5);
  const text = await measure.text(build, await measure.runtime(), times);
  const diffs = await measure.diffs(path.join(runDir, 'out', 'drafts', `${format}.mp4`));
  const first = await measure.hashes(build, at);
  const second = await measure.hashes(build, at);
  const single: string[] = [];
  for (const t of at) single.push((await measure.hashes(build, [t]))[0] ?? '');
  return { format, build, at, first, second, single, diffs, text, times };
};

/**
 * Runs every check on the run's built formats, writes test_results.json and report.md, and returns the blocking
 * failure count, the failing scene ids and the report's name. Throws InputError when a format has no draft yet.
 * Throws ContractError for a malformed run file.
 */
export const checkScenes = async (
  runDir: string,
  io: ScenesIo = {},
): Promise<{ blocking_failed: number; failing_scenes: string[]; report: string }> => {
  const { render, measure } = resolveIo(io);
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  for (const format of plan.formats) {
    const draft = path.join(runDir, 'out', 'drafts', `${format}.mp4`);
    if (!existsSync(draft)) throw new InputError(`render the draft first: ${relRun(runDir, draft)} is missing`);
  }
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
  const look = readJson(path.join(runDir, 'look', 'look.json'), LookSchema);
  const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
  const pool = readJson(path.join(runDir, 'assets.json'), AssetsSchema);

  const scenes = sceneTimes(plan, timing);
  const total = Math.max(0, ...scenes.map((s) => s.start + s.duration));
  const researchFile = path.join(runDir, 'research.md');
  if (!existsSync(researchFile)) throw new InputError('research.md is missing: run research (M5) first');
  const { urls } = parseResearch(readFileSync(researchFile, 'utf8'));
  const issues = await render.check(runDir);
  // The same error can come back once per format; one annotation per scene and message is enough.
  const errorKey = (i: Issue): string => `${i.scene_id ?? ''}\n${i.message}`;
  const errors = issues
    .filter((i) => i.severity === 'error')
    .filter((e, k, all) => all.findIndex((o) => errorKey(o) === errorKey(e)) === k);
  const fragments: [string, string][] = [];
  for (const s of plan.visuals_plan.scenes) {
    const file = path.join(runDir, 'scenes', `${s.scene_id}.html`);
    if (existsSync(file)) fragments.push([s.scene_id, readFileSync(file, 'utf8')]);
  }
  const fonts = look.type.map((t) => ({ family: t.family, license: t.license }));

  const measured: Measured[] = [];
  for (const format of plan.formats) {
    measured.push(await measureFormat(measure, runDir, format, brief.run_id, scenes, total));
  }
  const perFormat = (fn: (m: Measured) => CheckResult): CheckResult[] =>
    measured.map((m) => ({ ...fn(m), format: m.format }));

  const coverage = checkCoverage(
    plan.visuals_plan.scenes.map((s) => ({ scene_id: s.scene_id, lines: s.lines })),
    script,
  );
  const factsCited = checkFactsCited(script, urls);
  const lint = issuesResult(
    'render.lint',
    errors.filter((i) => !i.message.startsWith('layout ')),
    'fix the scene HTML so hyperframes lint passes',
  );
  const duration = checkDuration(total, brief.duration_target_s);
  const overflow = issuesResult(
    'layout.no_overflow',
    errors.filter((i) => i.message.startsWith('layout ')),
    'shrink or move the text so it fits its scene',
  );
  const noReference = checkNoReferenceOnly(pool.assets, Object.fromEntries(fragments));
  const checks: CheckResult[] = pinScenes(scenes, [
    checkContractsValid(runDir),
    coverage,
    factsCited,
    lint,
    ...perFormat((m) => checkDeterministic(m.at, m.first, m.second)),
    ...perFormat((m) => checkSeekSafe(m.at, m.first, m.single)),
    ...perFormat((m) => checkDeadSpans(m.diffs, FORMATS[m.format].fps, scenes)),
    ...perFormat((m) => checkBeatsOnCues(m.diffs, FORMATS[m.format].fps, scenes)),
    duration,
    ...perFormat((m) => checkSafeArea(m.text, m.format, avatarBoxesOf(runDir, m.format))),
    ...perFormat((m) => checkMinTextSize(m.text, m.format)),
    overflow,
    noReference,
    ...perFormat((m) => checkLicensed(pool.assets, builtAssetIds(m.build), fonts)),
    ...perFormat((m) =>
      checkCaptions(
        captionSamples(scenes, m.text, m.times),
        m.text.some((s) => s.caption),
      ),
    ),
  ]);

  const failed = checks.filter((c) => c.status === 'fail' && c.blocking);
  const failing = failingScenes(
    plan,
    failed.flatMap((c) => c.annotations.flatMap((a) => (a.scene_id === undefined ? [] : [a.scene_id]))),
  );
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  writeJson(path.join(runDir, 'test_results.json'), TestResultsSchema, {
    run_id: brief.run_id,
    plan_version: plan.version,
    output_paths: {
      stills: {},
      contact_sheets: Object.fromEntries(plan.formats.map((f) => [f, `out/sheets/${f}.jpg`])),
      drafts: Object.fromEntries(plan.formats.map((f) => [f, `out/drafts/${f}.mp4`])),
      deliverables: [],
      report: 'report.md',
    },
    checks,
    summary: { blocking_failed: failed.length, warnings },
  });
  writeReport(runDir, checks, failed.length);
  return { blocking_failed: failed.length, failing_scenes: failing, report: 'report.md' };
};
