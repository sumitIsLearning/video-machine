import type { CheckResult, Script } from '../contracts/types';

/**
 * Checks that the scenes cover each script line exactly once, in script order.
 * Unknown, repeated and missing lines are reported first; order is checked only when those are clean.
 * Returns a blocking CheckResult; never throws.
 */
export const checkCoverage = (scenes: { scene_id: string; lines: string[] }[], script: Script): CheckResult => {
  const order = script.lines.map((l) => l.id);
  const known = new Set(order);
  const where = new Map<string, string[]>();
  const problems: string[] = [];

  for (const scene of scenes) {
    for (const id of scene.lines) {
      if (!known.has(id)) {
        problems.push(`scene ${scene.scene_id} names unknown line ${id}`);
        continue;
      }
      where.set(id, [...(where.get(id) ?? []), scene.scene_id]);
    }
  }
  for (const [id, sceneIds] of where) {
    if (sceneIds.length > 1) problems.push(`line ${id} is in more than one scene (${sceneIds.join(', ')})`);
  }
  for (const id of order) {
    if (!where.has(id)) problems.push(`line ${id} is in no scene`);
  }
  if (problems.length === 0) {
    const flat = scenes.flatMap((s) => s.lines);
    let maxIndex = -1;
    let maxId = '';
    for (const id of flat) {
      const index = order.indexOf(id);
      if (index < maxIndex) {
        problems.push(`scenes are not in script order: ${id} comes after ${maxId}`);
        break;
      }
      if (index > maxIndex) {
        maxIndex = index;
        maxId = id;
      }
    }
  }

  const failed = problems.length > 0;
  return {
    id: 'plan.coverage',
    blocking: true,
    status: failed ? 'fail' : 'pass',
    detail: failed ? `${problems.length} problem(s)` : 'every line is in one scene, in script order',
    annotations: problems.map((problem) => ({
      problem,
      suggested_fix: 'put each script line in exactly one scene, in script order',
    })),
  };
};
