import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { checkFactsCited } from '../checks/facts-cited';
import { BriefSchema, ScriptSchema } from '../contracts/types';
import { ContractError, InputError } from '../core/errors';
import { estimate, wordCount } from '../core/estimate';
import { readJson, writeJson } from '../core/json';
import { assertRunDir } from '../core/paths';
import { parseResearch } from '../research/research';

/**
 * Check a script against the brief and research.md, then store it as the run's next script.json version.
 * Returns the line count, word count, the estimated length and whether it fits duration_target_s. Throws
 * ContractError for a malformed script, InputError for a missing research.md or an uncited number (nothing is written
 * then).
 */
export function writeScript(
  runDir: string,
  input: unknown,
): { lines: number; words: number; est_s: number; target_s: [number, number]; fits: boolean } {
  assertRunDir(runDir);
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const researchFile = path.join(runDir, 'research.md');
  if (!existsSync(researchFile)) throw new InputError('research.md is missing: run research (M5) first');
  const scriptFile = path.join(runDir, 'script.json');
  const prev = existsSync(scriptFile) ? readJson(scriptFile, ScriptSchema).version : 0;
  const lines = typeof input === 'object' && input !== null && 'lines' in input ? input.lines : undefined;
  const parsed = ScriptSchema.safeParse({ run_id: brief.run_id, version: prev + 1, lines });
  if (!parsed.success) throw new ContractError(`script is not valid:\n${z.prettifyError(parsed.error)}`);
  const { urls } = parseResearch(readFileSync(researchFile, 'utf8'));
  const check = checkFactsCited(parsed.data, urls);
  if (check.status === 'fail') throw new InputError(check.annotations.map((a) => a.problem).join('\n'));
  const script = writeJson(scriptFile, ScriptSchema, parsed.data);
  const words = script.lines.reduce((sum, l) => sum + wordCount(l.spoken ?? l.text), 0);
  const est_s = estimate(script).total_s;
  const [min, max] = brief.duration_target_s;
  return {
    lines: script.lines.length,
    words,
    est_s,
    target_s: brief.duration_target_s,
    fits: min <= est_s && est_s <= max,
  };
}
