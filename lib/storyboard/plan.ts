import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
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
import { presetBox } from '../core/avatar';
import type { Deps } from '../core/deps';
import { InputError } from '../core/errors';
import { estimate, type LineEstimate } from '../core/estimate';
import { readJson, writeJson } from '../core/json';
import { assertRunDir } from '../core/paths';

type SceneInput = Omit<ScenePlan, 'input_hash'>;
type PlanInput = {
  scenes: (SceneInput & { input_hash?: string })[];
  sections?: Plan['sections'];
  asset_ids?: string[];
};
export type SceneTiming = { scene_id: string; lines: string[]; start_s: number; end_s: number };
export type PlanWritten = {
  scenes: SceneTiming[];
  est_s: number;
  target_s: [number, number];
  fits: boolean;
  changed: string[];
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** The value with every object's keys sorted, so the same data always stringifies the same (R7 canonical JSON). */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const v = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, canonical(v[k])]),
  );
};

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
 * for those failures and writes nothing. Returns the scenes' estimated timing, whether the estimate fits the brief's
 * duration target, and `changed`: the scenes whose input_hash is new or different, whose boards/<id>.png it deletes
 * after the write.
 */
export function writePlan(runDir: string, input: unknown): PlanWritten {
  assertRunDir(runDir);
  const { scenes, sections, asset_ids } = (input ?? {}) as Partial<PlanInput>;
  if (!Array.isArray(scenes) || scenes.length === 0)
    throw new InputError(
      'plan needs a non-empty "scenes" array; top-level keys are scenes, sections, asset_ids (visuals_plan is written by this command)',
    );
  if (asset_ids !== undefined && !Array.isArray(asset_ids))
    throw new InputError('asset_ids must be an array of asset ids');
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
      .update(JSON.stringify(canonical({ scene, lines, look })))
      .digest('hex')
      .slice(0, 16);
  };

  const planFile = path.join(runDir, 'plan.json');
  const previous = existsSync(planFile) ? readJson(planFile, PlanSchema) : undefined;
  const previousHash = new Map(previous?.visuals_plan.scenes.map((s) => [s.scene_id, s.input_hash]));
  const hashed = plain.map((s) => ({ ...s, input_hash: hashOf(s) }));
  const changed = hashed.filter((s) => previousHash.get(s.scene_id) !== s.input_hash).map((s) => s.scene_id);
  writeJson(planFile, PlanSchema, {
    run_id: brief.run_id,
    version: (previous?.version ?? 0) + 1,
    look_id: look.id,
    sections,
    visuals_plan: { scenes: hashed },
    asset_ids: planAssets,
    formats: brief.formats,
  });
  // The boards of changed scenes are stale now; the caller re-renders exactly these.
  for (const id of changed) rmSync(path.join(runDir, 'boards', `${id}.png`), { force: true });

  const { lines, total_s } = estimate(script);
  const [lo, hi] = brief.duration_target_s;
  return {
    scenes: sceneTimes(plain, lines),
    est_s: total_s,
    target_s: brief.duration_target_s,
    fits: total_s >= lo && total_s <= hi,
    changed,
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
  assertRunDir(runDir);
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const scene = plan.visuals_plan.scenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new InputError(`plan.json has no scene "${sceneId}"`);
  // The presenter band shows only where the whole scene is the presenter, so a voiceover line keeps the scene plain.
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
  const avatarIds = new Set(script.lines.filter((l) => l.delivery === 'avatar').map((l) => l.id));
  const allAvatar = scene.lines.length > 0 && scene.lines.every((id) => avatarIds.has(id));
  const box = brief.layout?.kind === 'stack' && allAvatar ? presetBox('stack', 'reel', brief.layout.split) : undefined;
  const band = box && { x: box.x, y: box.y, w: box.w, h: box.h };
  return renderBoard(
    deps,
    runDir,
    `boards/${sceneId}`,
    html,
    scene.asset_ids,
    at,
    `board ${sceneId}`,
    `boards/${sceneId}.png`,
    band,
  );
}
