import { runCli } from '../core/cli';
import { InputError } from '../core/errors';
import { writeScript } from './script';

const USAGE = 'usage: cli.ts write <run_dir> (script JSON on stdin)';
const MAX_STDIN_BYTES = 1024 * 1024;

type Io = { stdin?: () => Promise<Uint8Array> };

/**
 * Run the script command: `write <run_dir>` reads the script JSON on stdin.
 * Returns the fields of the CLI's JSON result. Throws InputError for a usage mistake, a stdin over 1 MB, or stdin that
 * is not UTF-8 or not JSON; writeScript throws its own errors.
 */
export const main = async (argv: string[], io: Io = {}): Promise<Record<string, unknown>> => {
  const [command, runDir, ...extra] = argv;
  if (command !== 'write' || runDir === undefined || extra.length > 0) throw new InputError(USAGE);
  const stdin = io.stdin ?? (async () => new Uint8Array(await Bun.stdin.arrayBuffer()));
  const bytes = await stdin();
  if (bytes.byteLength > MAX_STDIN_BYTES) throw new InputError('script on stdin is over 1 MB');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new InputError('script on stdin is not valid UTF-8 (save it as UTF-8)', { cause });
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new InputError(`script on stdin is not JSON: ${cause.message}`, { cause });
  }
  return writeScript(runDir, input);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
