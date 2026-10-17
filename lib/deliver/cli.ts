// The deliver CLI: mix (M16's sound mix) and export (M17's deliverables).
import { runCli } from '../core/cli';
import { defaultDeps } from '../core/deps';
import { InputError } from '../core/errors';
import { type DeliverIo, deliver } from './deliver';
import { mixSound } from './mix';

const USAGE = 'usage: cli.ts mix <run_dir> | export <run_dir>';

/**
 * Run a deliver command: mix or export. Returns the fields of the CLI's JSON result. Throws InputError for a usage
 * mistake; the library functions throw their own errors.
 */
export const main = async (argv: string[], io: DeliverIo = {}): Promise<Record<string, unknown>> => {
  const [command, runDir, ...rest] = argv;
  if (runDir === undefined || rest.length > 0) throw new InputError(USAGE);
  switch (command) {
    case 'mix':
      return mixSound(io.deps ?? defaultDeps(), runDir);
    case 'export':
      return deliver(runDir, io);
    default:
      throw new InputError(USAGE);
  }
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
