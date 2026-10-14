import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { renderableAssets, renderBoard } from '../adapters/render/hyperframes/compose';
import { checkCoverage } from '../checks/coverage';
import {
  BriefSchema,
  LookSchema,
  type Plan,
  PlanSchema,
  type ScenePlan,
  type Script,
  ScriptSchema,
} from '../contracts/types';
import type { Deps } from '../core/deps';
import { InputError } from '../core/errors';
import { estimate, type LineEstimate } from '../core/estimate';
import { readJson, writeJson } from '../core/json';

type SceneInput = Omit<ScenePlan, 'input_hash'>;
type PlanInput = {
  scenes: (SceneInput & { input_hash?: string })[];
  sections?: Plan['sections'];
  asset_ids?: string[];
};
export type SceneTiming = { scene_id: string; lines: string[]; start_s: number; end_s: number };
export type PlanWritten = { scenes: SceneTiming[]; est_s: number; target_s: [number, number]; fits: boolean };

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/**
 * The estimated start of each scene's first line and end of its last line. Returns data only; throws InputError when
 * a scene names a line the estimate does not have (checkCoverage catches that first).
 */
export function sceneTimes(scenes: { scene_id: string; lines: string[] }[], lines: LineEstimate[]): SceneTiming[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return scenes.map((s) => {
    const first = byId.get(s.lines[0] as string);
    const last = byId.get(s.lines.at(-1) as string);
    if (!first || !last) throw new InputError(`scene "${s.scene_id}" names a line that is not in script.json`);
    return { scene_id: s.scene_id, lines: s.lines, start_s: first.start_s, end_s: last.end_s };
  });
}

/**
 * Write plan.json from the scenes: each scene's input_hash (R7) and the plan's version (previous + 1). Checks the
 * script and look exist, the assets render, and every script line is in exactly one scene, in order. Throws InputError
 * for those failures and writes nothing. Returns the scenes' estimated timing and whether the estimate fits the brief's
 * duration target.
 */
export function writePlan(runDir: string, input: unknown): PlanWritten {
  const { scenes, sections, asset_ids } = (input ?? {}) as Partial<PlanInput>;
  if (!Array.isArray(scenes) || scenes.length === 0)
    throw new InputError(
      'plan needs a non-empty "scenes" array; top-level keys are scenes, sections, asset_ids (visuals_plan is written by this command)',
    );
  const scriptFile = path.join(runDir, 'script.json');
  if (!existsSync(scriptFile)) throw new InputError('script.json is missing: write the script (M6) first');
  const lookFile = path.join(runDir, 'look', 'look.json');
  if (!existsSync(lookFile)) throw new InputError('look/look.json is missing: pick a look (M7) first');
  const script = readJson(scriptFile, ScriptSchema);
  const look = readJson(lookFile, LookSchema);
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const badScene = (s: unknown): boolean =>
    typeof s !== 'object' ||
    s === null ||
    !Array.isArray((s as PlanInput['scenes'][number]).lines) ||
    !Array.isArray((s as PlanInput['scenes'][number]).asset_ids);
  if (scenes.some(badScene)) throw new InputError('plan needs scenes: [{ scene_id, lines[], asset_ids[], ... }]');

  const coverage = checkCoverage(scenes, script);
  if (coverage.status === 'fail')
    throw new InputError(`${coverage.id} failed:\n- ${coverage.annotations.map((a) => a.problem).join('\n- ')}`);

  const plain = scenes.map(({ input_hash: _ignored, ...scene }) => scene);
  const sceneAssets = plain.flatMap((s) => s.asset_ids);
  const planAssets = asset_ids ?? unique(sceneAssets);
  renderableAssets(runDir, unique([...planAssets, ...sceneAssets]));

  const lineOf = new Map(script.lines.map((l) => [l.id, l]));
  const hashOf = (scene: SceneInput): string => {
    // checkCoverage has passed, so every line id is in the script.
    const lines = scene.lines.map((id) => {
      const l = lineOf.get(id) as Script['lines'][number];
      return [l.id, l.text, l.spoken, l.on_screen];
    });
    return createHash('sha256')
      .update(JSON.stringify({ scene, lines, look_id: look.id }))
      .digest('hex')
      .slice(0, 16);
  };

  const planFile = path.join(runDir, 'plan.json');
  const version = existsSync(planFile) ? readJson(planFile, PlanSchema).version + 1 : 1;
  writeJson(planFile, PlanSchema, {
    run_id: brief.run_id,
    version,
    look_id: look.id,
    sections,
    visuals_plan: { scenes: plain.map((s) => ({ ...s, input_hash: hashOf(s) })) },
    asset_ids: planAssets,
    formats: brief.formats,
  });

  const { lines, total_s } = estimate(script);
  const [lo, hi] = brief.duration_target_s;
  return {
    scenes: sceneTimes(plain, lines),
    est_s: total_s,
    target_s: brief.duration_target_s,
    fits: total_s >= lo && total_s <= hi,
  };
}

/**
 * Render boards/<scene_id>.png for one scene of plan.json from its composition folder boards/<scene_id>/. Returns the
 * png path and the lint warnings. Throws InputError when plan.json has no such scene, lint reports errors or an asset
 * cannot render; ToolError when HyperFrames fails.
 */
export async function writeSceneBoard(
  deps: Deps,
  runDir: string,
  sceneId: string,
  html: string,
  at: number,
): Promise<{ png: string; warnings: string[] }> {
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const scene = plan.visuals_plan.scenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new InputError(`plan.json has no scene "${sceneId}"`);
  return renderBoard(
    deps,
    runDir,
    `boards/${sceneId}`,
    html,
    scene.asset_ids,
    at,
    `board ${sceneId}`,
    `boards/${sceneId}.png`,
  );
}
