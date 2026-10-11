import path from 'node:path';
import { parseArgs } from 'node:util';
import openverse from '../adapters/assets/openverse';
import { runCli } from '../core/cli';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError } from '../core/errors';
import { capturePage } from './page';
import { writeResearch } from './research';

const USAGE =
  'usage: cli.ts page <run_dir> <url> | find <run_dir> [--kind image|audio] [--n 1-10] [--] <query> | write <run_dir> (research.md on stdin)';
const MAX_STDIN_BYTES = 1024 * 1024;

/** parseArgs, with its TypeError for an unknown flag or a flag with no value turned into an InputError. */
const parse = (argv: string[]) => {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: { kind: { type: 'string' }, n: { type: 'string' } },
    });
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new InputError(`${cause.message}\n${USAGE}`, { cause });
  }
};

type Io = { stdin?: () => Promise<Uint8Array>; cwd?: string; deps?: Deps; fetch?: typeof fetch };

/**
 * Run one research command: `page`, `find` or `write`.
 * Returns the fields of the CLI's JSON result. Throws InputError for a usage mistake, a `--kind` other than image or
 * audio, or an `--n` outside 1-10; the capture, search and research functions throw their own errors.
 */
export const main = async (argv: string[], io: Io = {}): Promise<Record<string, unknown>> => {
  const cwd = io.cwd ?? process.cwd();
  const { positionals, values } = parse(argv);
  const [command, first, second, ...extra] = positionals;
  const runDir = first === undefined ? undefined : path.resolve(cwd, first);
  const hasFlags = values.kind !== undefined || values.n !== undefined;
  const deps = () => io.deps ?? defaultDeps(); // lazy: `write` never loads the config

  if (command === 'page' && runDir && second && extra.length === 0 && !hasFlags) {
    const page = await capturePage(deps(), runDir, second);
    return { page, record: `${page.dir}.json` };
  }
  if (command === 'find' && runDir && second && extra.length === 0) {
    const kind = values.kind ?? 'image';
    if (kind !== 'image' && kind !== 'audio') throw new InputError(`--kind must be image or audio, not "${kind}"`);
    const rawN = values.n ?? '3';
    const n = Number(rawN);
    // digits only: Number() would also take "0x3", "3e0" and " 3 "
    if (!/^\d+$/.test(rawN) || n < 1 || n > 10) throw new InputError('--n must be a whole number from 1 to 10');
    const assets = await openverse(deps(), {
      fetch: io.fetch,
      onWarn: (line) => void process.stderr.write(`${line}\n`),
    }).find(runDir, second, kind, n);
    return { assets };
  }
  if (command === 'write' && runDir && second === undefined && !hasFlags) {
    const stdin = io.stdin ?? (async () => new Uint8Array(await Bun.stdin.arrayBuffer()));
    const bytes = await stdin();
    if (bytes.byteLength > MAX_STDIN_BYTES) throw new InputError('research.md on stdin is over 1 MB');
    let md: string;
    try {
      md = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause;
      throw new InputError('research.md on stdin is not valid UTF-8 (save it as UTF-8)', { cause });
    }
    return writeResearch(runDir, md);
  }
  throw new InputError(USAGE);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
