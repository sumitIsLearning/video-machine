import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { type Feedback, FeedbackSchema, PlanSchema, SceneNotesSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { assertRunDir } from '../core/paths';

export type ReviewInput = { text: string; route: Feedback['route']; scenes?: string[] };
export type ReviewResult = { n: number; route: Feedback['route']; redo: string[]; removed: string[] };

/** Run-relative text files copied into `history/<n>/` before a review clears anything. */
const SNAPSHOT_FILES = [
  'brief.json',
  'script.json',
  'plan.json',
  'data/timing.json',
  'test_results.json',
  'report.md',
  'look/look.json',
  'look/LOOK.md',
  'directions/A/look.json',
  'directions/A/LOOK.md',
  'directions/B/look.json',
  'directions/B/LOOK.md',
];

/** Outputs every route clears (R9). */
const OUTPUT_PATHS = [
  'build',
  'out/drafts',
  'out/sheets',
  'out/final',
  'out/deliver',
  'out/deliver.tmp',
  'test_results.json',
  'report.md',
];

/** Validate the feedback, snapshot the run's text files, then clear what the route makes stale.
 * Returns the review number, the scenes to redo and the paths removed. Throws InputError for bad feedback (nothing is
 * touched then) and ContractError when plan.json or redo.json is invalid.
 */
export function review(runDir: string, input: ReviewInput): ReviewResult {
  assertRunDir(runDir);
  const { text, scenes } = validate(runDir, input);
  const n = nextReviewNumber(runDir);
  snapshot(runDir, n, { text, route: input.route, scenes });
  if (input.route === 'scenes') addSceneNotes(runDir, scenes, text);
  const removed = clear(runDir, input.route);
  return { n, route: input.route, redo: scenes, removed };
}

/** Refuse empty text, a scenes route without known scene ids, and scene ids on any other route. */
function validate(runDir: string, input: ReviewInput): { text: string; scenes: string[] } {
  const text = input.text.trim();
  if (text === '') throw new InputError('review feedback is empty');
  if (input.route !== 'scenes') {
    if (input.scenes !== undefined) throw new InputError(`the ${input.route} route takes no scene ids`);
    return { text, scenes: [] };
  }
  const scenes = [...new Set(input.scenes ?? [])];
  if (scenes.length === 0) throw new InputError('the scenes route needs at least one scene id');
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const known = new Set(plan.visuals_plan.scenes.map((s) => s.scene_id));
  const unknown = scenes.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new InputError(`unknown scene id: ${unknown.join(', ')}`);
  return { text, scenes };
}

/** One more than the largest integer folder in `history/`, or 1 when there is none. */
function nextReviewNumber(runDir: string): number {
  const dir = path.join(runDir, 'history');
  if (!existsSync(dir)) return 1;
  const numbers = readdirSync(dir)
    .filter((name) => /^\d+$/.test(name))
    .map(Number);
  return Math.max(0, ...numbers) + 1;
}

/** Copy the text files into `history/.<n>.tmp/` with feedback.json, then rename it to `history/<n>`. */
function snapshot(runDir: string, n: number, fb: { text: string; route: Feedback['route']; scenes: string[] }): void {
  const history = path.join(runDir, 'history');
  const tmp = path.join(history, `.${n}.tmp`);
  rmSync(tmp, { recursive: true, force: true });
  const sceneFiles = listSceneFiles(runDir);
  for (const rel of [...SNAPSHOT_FILES, ...sceneFiles]) {
    const src = path.join(runDir, rel);
    if (!existsSync(src)) continue;
    mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    copyFileSync(src, path.join(tmp, rel));
  }
  writeJson(path.join(tmp, 'feedback.json'), FeedbackSchema, {
    n,
    at: new Date().toISOString(),
    text: fb.text,
    route: fb.route,
    scenes: fb.scenes,
  });
  renameSync(tmp, path.join(history, String(n)));
}

/** The run-relative paths of the regular files directly in `scenes/`. */
function listSceneFiles(runDir: string): string[] {
  const dir = path.join(runDir, 'scenes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `scenes/${e.name}`);
}

/** Merge the note into `scenes/redo.json`, on a new line after any earlier note for the scene. */
function addSceneNotes(runDir: string, scenes: string[], text: string): void {
  const file = path.join(runDir, 'scenes', 'redo.json');
  const notes = existsSync(file) ? readJson(file, SceneNotesSchema) : {};
  for (const id of scenes) notes[id] = notes[id] === undefined ? text : `${notes[id]}\n${text}`;
  writeJson(file, SceneNotesSchema, notes);
}

/** Delete the outputs the route makes stale (R9). Returns the run-relative paths that existed. */
function clear(runDir: string, route: Feedback['route']): string[] {
  const stale = [...OUTPUT_PATHS];
  if (route === 'plan' || route === 'words') stale.push('audio/mix.wav');
  if (route === 'words') stale.push('audio/vo.wav', 'data/timing.json');
  const removed: string[] = [];
  for (const rel of stale) {
    if (!existsSync(path.join(runDir, rel))) continue;
    rmSync(path.join(runDir, rel), { recursive: true, force: true });
    removed.push(rel);
  }
  return removed;
}
