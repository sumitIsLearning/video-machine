import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { RunPathSchema } from '../contracts/types';
import { InputError } from './errors';

/** The path of `realTarget` relative to `realRoot`, or undefined when it is outside. Both must be real paths. */
export const relInside = (realRoot: string, realTarget: string): string | undefined => {
  const rel = path.relative(realRoot, realTarget);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? undefined : rel;
};

/**
 * The absolute path of a file named by a run path, after checking it is a file whose real path is inside the run.
 * Returns the path. Throws InputError (naming `runPath`, with `hint` appended where the fix is known) for a bad run
 * path, a missing file, a folder, or a link out of the run.
 */
export function runFileOf(runDir: string, runPath: string, hint?: string): string {
  if (!RunPathSchema.safeParse(runPath).success)
    throw new InputError(`"${runPath}" is not a run path (use a POSIX path inside the run folder)`);
  const file = path.join(runDir, ...runPath.split('/'));
  if (!existsSync(file) || !statSync(file).isFile())
    throw new InputError(`${runPath} is not a file in the run folder${hint ? `; ${hint}` : ''}`);
  if (relInside(realpathSync.native(runDir), realpathSync.native(file)) === undefined)
    throw new InputError(`${runPath} resolves outside the run folder`);
  return file;
}
