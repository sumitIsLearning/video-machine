import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { type Brief, BriefSchema, type Script, ScriptSchema } from '../contracts/types';
import { ContractError } from '../core/errors';
import { readJson } from '../core/json';
import { assertRunDir, runIdOf } from './intake';

/** The parts in run order (BLUEPRINT 2.1): M5 research comes before M2 capture. */
export const PART_ORDER = [
  'M1',
  'M5',
  'M2',
  'M3',
  'M4',
  'M6',
  'M7',
  'M8',
  'M9',
  'M10',
  'M11',
  'M12',
  'M13',
  'M14',
  'M16',
  'M17',
] as const;
export type PartId = (typeof PART_ORDER)[number];
/** Where a run stands: the next part to do and the parts this run does not need. */
export type Where = { run_id: string; next: PartId | 'done'; skipped: PartId[] };
/** One entry of `listRuns`: a run's `Where`, or the first line of the error that made it unreadable. */
export type RunStatus = Where | { run_id: string; error: string };

// ponytail: markers for parts not built yet follow BLUEPRINT 2.1; the phase that builds each part confirms its own marker.
// M2 and M3 are needed from the brief alone (nav_video; nav_video and product_url), not from files made so far.
// A trailing "/" marks a folder, which counts as done only when it is not empty.
const MARKER: Record<PartId, string> = {
  M1: 'brief.json',
  M5: 'research.md',
  M2: 'capture/steps.json',
  M3: 'capture/log.json',
  M4: 'assets.json',
  M6: 'script.json',
  M7: 'look/look.json',
  M8: 'plan.json',
  M9: 'audio/vo.wav',
  M10: 'data/timing.json',
  M11: 'avatar/',
  M12: 'index.html',
  M13: 'out/drafts/',
  M14: 'test_results.json',
  M16: 'audio/mix.wav',
  M17: 'out/deliver/',
};

// An empty file is a failed write, not a finished part.
const NON_EMPTY_FILE: readonly PartId[] = ['M9', 'M16'];

const isDone = (runDir: string, part: PartId): boolean => {
  const marker = MARKER[part];
  const full = path.join(runDir, ...marker.split('/').filter(Boolean));
  if (!existsSync(full)) return false;
  if (marker.endsWith('/')) return statSync(full).isDirectory() && readdirSync(full).length > 0;
  return !NON_EMPTY_FILE.includes(part) || statSync(full).size > 0;
};

/** Whether a part is needed, given the brief and the script if there is one (the "Needed when" column). */
const isNeeded = (brief: Brief, script: Script | undefined, part: PartId): boolean => {
  const hasSource = (kind: string) => brief.sources.some((s) => s.kind === kind);
  switch (part) {
    case 'M2':
      return hasSource('nav_video');
    case 'M3':
      // Decided from the brief alone, like M2; `next` reaches it after M2 only because of PART_ORDER.
      return hasSource('nav_video') && hasSource('product_url');
    case 'M9':
    case 'M10':
      return brief.timing_source === 'voiceover';
    case 'M11':
      return brief.avatar !== undefined && (script === undefined || script.lines.some((l) => l.delivery === 'avatar'));
    default:
      return true;
  }
};

/**
 * Work out which part of a run comes next, and which parts this run skips.
 * Returns a `Where`. Throws InputError when the folder is not a run, ContractError when brief.json or script.json is invalid.
 */
export function whereAmI(runDir: string): Where {
  assertRunDir(runDir);
  const run_id = runIdOf(runDir);
  if (!isDone(runDir, 'M1')) return { run_id, next: 'M1', skipped: [] };
  const brief = readJson(path.join(runDir, MARKER.M1), BriefSchema);
  const script = isDone(runDir, 'M6') ? readJson(path.join(runDir, MARKER.M6), ScriptSchema) : undefined;
  const needed = PART_ORDER.filter((p) => isNeeded(brief, script, p));
  return {
    run_id,
    next: needed.find((p) => !isDone(runDir, p)) ?? 'done',
    skipped: PART_ORDER.filter((p) => !needed.includes(p)),
  };
}

/**
 * Every run in a runs folder, sorted by folder name, descending (folder names start with the date).
 * Returns a `Where` per run, or `{ run_id, error }` for a run whose brief.json or script.json is invalid or cannot
 * be read (one bad run must not hide the others); a missing folder gives [].
 */
export function listRuns(runsDir: string): RunStatus[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(runsDir, e.name, 'concept.md')))
    .map((e) => e.name)
    .sort()
    .reverse()
    .map((name): RunStatus => {
      try {
        return whereAmI(path.join(runsDir, name));
      } catch (e) {
        // an fs error with a code (EISDIR, EACCES) is one unreadable run, not a reason to hide the others
        if (!(e instanceof ContractError) && typeof (e as NodeJS.ErrnoException).code !== 'string') throw e;
        const message = (e as Error).message;
        return { run_id: name, error: message.split('\n')[0] ?? message };
      }
    });
}
