// Builds every planned format of a run, checks the build for errors, then makes each format's contact sheet and draft.
import path from 'node:path';
import { type FormatId, type Issue, PlanSchema } from '../contracts/types';
import { readJson } from '../core/json';
import { failingScenes, relRun, resolveIo, type ScenesIo } from './check';

/** What the build reports per format: run-relative paths and the render warnings. */
export type BuildResult =
  | {
      ok: true;
      formats: Record<string, { build: string; sheet: string; draft: string; warnings: Issue[] }>;
    }
  | { ok: false; failing_scenes: string[]; issues: Issue[] };

/**
 * Assembles each planned format, then makes its contact sheet (two stills per scene) and draft. A render error stops
 * the build before any sheet or draft is made. Returns the paths per format, or the failing scenes and the errors.
 * Throws InputError when a scene fragment or vo.wav is missing and UnsupportedError for a non-voiceover run.
 */
export const buildScenes = async (runDir: string, io: ScenesIo = {}): Promise<BuildResult> => {
  const { render, assemble } = resolveIo(io);
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const builds = new Map<FormatId, string>();
  for (const format of plan.formats) builds.set(format, await assemble(runDir, format));

  const issues = await render.check(runDir);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    const ids = errors.flatMap((e) => (e.scene_id === undefined ? [] : [e.scene_id]));
    return { ok: false, failing_scenes: failingScenes(plan, ids), issues: errors };
  }

  const warnings = issues.filter((i) => i.severity === 'warning');
  const formats: Record<string, { build: string; sheet: string; draft: string; warnings: Issue[] }> = {};
  for (const format of plan.formats) {
    const sheet = await render.contactSheet(runDir, format, 2);
    const draft = await render.render(runDir, format, 'draft');
    formats[format] = {
      build: relRun(runDir, builds.get(format) ?? ''),
      sheet: relRun(runDir, sheet),
      draft: relRun(runDir, draft),
      warnings,
    };
  }
  return { ok: true, formats };
};
