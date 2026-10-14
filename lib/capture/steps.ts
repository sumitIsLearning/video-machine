import path from 'node:path';
import { z } from 'zod';
import { type Steps, StepsSchema } from '../contracts/types';
import { ContractError } from '../core/errors';
import { writeJson } from '../core/json';
import { assertRunDir, runFileOf } from '../core/paths';

/**
 * Validate Claude's replay steps and write `capture/steps.json`.
 * Returns the steps. Throws InputError (not a run, or a `frame` that is not a file inside the run) or ContractError
 * (the draft does not match the steps schema); nothing is written then.
 */
export function writeSteps(runDir: string, draft: unknown): Steps {
  assertRunDir(runDir);
  const r = StepsSchema.safeParse(draft);
  if (!r.success)
    throw new ContractError(`steps draft for ${runDir} does not match the steps schema:\n${z.prettifyError(r.error)}`);
  for (const s of r.data)
    if (s.frame !== undefined) runFileOf(runDir, s.frame, 'the frame must come from capture read');
  return writeJson(path.join(runDir, 'capture', 'steps.json'), StepsSchema, r.data);
}
