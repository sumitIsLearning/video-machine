// The avatar CLI: make (M11) builds avatar/ after the spend check; boxes reports where each segment sits in each format.
import path from 'node:path';
import { PlanSchema } from '../contracts/types';
import { avatarBoxesOf } from '../core/avatar';
import { runCli } from '../core/cli';
import { approvedOf } from '../core/cost';
import { InputError } from '../core/errors';
import { readJson } from '../core/json';
import { makeAvatar } from './make';

const USAGE = 'usage: cli.ts make <run_dir> [--approve-spend usd] | boxes <run_dir>';

/**
 * Run an avatar command: make or boxes. Returns the fields of the CLI's JSON result. Throws InputError for a usage
 * mistake, a bad --approve-spend, or a run that cannot be made; the library functions throw their own errors.
 */
export const main = async (argv: string[]): Promise<Record<string, unknown>> => {
  const [command, runDir, ...rest] = argv;
  if (runDir === undefined) throw new InputError(USAGE);
  switch (command) {
    case 'make':
      return makeAvatar(runDir, { approved_usd: approvedOf(rest, USAGE) });
    case 'boxes': {
      if (rest.length !== 0) throw new InputError(USAGE);
      const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
      return { boxes: Object.fromEntries(plan.formats.map((f) => [f, avatarBoxesOf(runDir, f)])) };
    }
    default:
      throw new InputError(USAGE);
  }
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
