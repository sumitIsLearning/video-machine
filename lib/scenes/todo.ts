// The scenes still to write before a build: no fragment yet, a feedback note, or a plan hash that moved since the last build.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PlanSchema, SceneHashesSchema, SceneNotesSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';

/** One scene to write, with the reason and the feedback note when there is one. */
export type Todo = { scene_id: string; reason: 'new' | 'feedback' | 'changed'; feedback?: string };

const fragmentOf = (runDir: string, id: string): string => path.join(runDir, 'scenes', `${id}.html`);

/** `scenes/hashes.json`, or no hashes when the file does not exist yet. */
const hashesOf = (runDir: string): Record<string, string> => {
  const file = path.join(runDir, 'scenes', 'hashes.json');
  return existsSync(file) ? readJson(file, SceneHashesSchema) : {};
};

/** `scenes/redo.json`, or no notes when the file does not exist yet. */
const notesOf = (runDir: string): Record<string, string> => {
  const file = path.join(runDir, 'scenes', 'redo.json');
  return existsSync(file) ? readJson(file, SceneNotesSchema) : {};
};

/**
 * Lists the scenes to write, in plan order. A scene with no fragment is `new`; a scene with a feedback note is
 * `feedback`; a scene whose recorded hash differs from the plan's is `changed`. Returns [] when all are current.
 * Throws ContractError when plan.json or the scenes/ JSON does not match its schema.
 */
export const scenesTodo = (runDir: string): Todo[] => {
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const hashes = hashesOf(runDir);
  const notes = notesOf(runDir);
  const todo: Todo[] = [];
  for (const { scene_id, input_hash } of plan.visuals_plan.scenes) {
    const note = notes[scene_id];
    if (!existsSync(fragmentOf(runDir, scene_id))) {
      todo.push(note === undefined ? { scene_id, reason: 'new' } : { scene_id, reason: 'new', feedback: note });
    } else if (note !== undefined) {
      todo.push({ scene_id, reason: 'feedback', feedback: note });
    } else if (hashes[scene_id] !== undefined && hashes[scene_id] !== input_hash) {
      todo.push({ scene_id, reason: 'changed' });
    }
  }
  return todo;
};

/**
 * Marks the scenes as written: records each plan hash in `scenes/hashes.json` and drops its feedback note.
 * Throws InputError, writing nothing, when ids is empty or names a scene that is not in the plan or has no fragment.
 */
export const markDone = (runDir: string, ids: string[]): void => {
  if (ids.length === 0) throw new InputError('done needs at least one scene id');
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const hashes = hashesOf(runDir);
  const notes = notesOf(runDir);
  for (const id of ids) {
    if (!plan.visuals_plan.scenes.some((s) => s.scene_id === id)) {
      throw new InputError(`done: scene "${id}" is not in plan.json`);
    }
    if (!existsSync(fragmentOf(runDir, id))) throw new InputError(`done: scenes/${id}.html is missing`);
  }
  for (const id of ids) {
    const scene = plan.visuals_plan.scenes.find((s) => s.scene_id === id);
    if (scene !== undefined) hashes[id] = scene.input_hash;
    delete notes[id];
  }
  writeJson(path.join(runDir, 'scenes', 'hashes.json'), SceneHashesSchema, hashes);
  const redo = path.join(runDir, 'scenes', 'redo.json');
  if (Object.keys(notes).length > 0) writeJson(redo, SceneNotesSchema, notes);
  else rmSync(redo, { force: true });
};
