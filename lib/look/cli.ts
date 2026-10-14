import { type BoardId, BoardIdSchema, type DirectionId, DirectionIdSchema } from '../contracts/types';
import { runCli } from '../core/cli';
import { defaultDeps } from '../core/deps';
import { InputError } from '../core/errors';
import { compareLooks, pickLook, writeBoard, writeLook } from './look';

const USAGE =
  'usage: cli.ts write <run_dir> <A|B> (JSON {look, md} on stdin) | board <run_dir> <A|B> <hook|product|ending> [--assets id,id] [--at s] (HTML on stdin) | compare <run_dir> | pick <run_dir> <A|B>';
const MAX_STDIN_BYTES = 1024 * 1024;
const AT_PATTERN = /^\d+(\.\d+)?$/;

type Io = { stdin?: () => Promise<Uint8Array> };

/** The value after a flag, or undefined when the flag is last. */
const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};

const parseDir = (value: string | undefined): DirectionId => {
  const r = DirectionIdSchema.safeParse(value);
  if (!r.success) throw new InputError(USAGE);
  return r.data;
};

const parseBoard = (value: string | undefined): BoardId => {
  const r = BoardIdSchema.safeParse(value);
  if (!r.success) throw new InputError(USAGE);
  return r.data;
};

/** Read stdin as UTF-8 text, capped at 1 MB. `what` names the input in the errors. */
const readStdin = async (io: Io, what: string): Promise<string> => {
  const bytes = await (io.stdin ?? (async () => new Uint8Array(await Bun.stdin.arrayBuffer())))();
  if (bytes.byteLength > MAX_STDIN_BYTES) throw new InputError(`${what} on stdin is over 1 MB`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new InputError(`${what} on stdin is not valid UTF-8 (save it as UTF-8)`, { cause });
  }
};

/**
 * Run a look command: write, board, compare or pick. Returns the fields of the CLI's JSON result. Throws InputError for
 * a usage mistake, a bad --at, or stdin that is not UTF-8 or JSON; the library functions throw their own errors.
 */
export const main = async (argv: string[], io: Io = {}): Promise<Record<string, unknown>> => {
  const [command, runDir, ...rest] = argv;
  if (runDir === undefined) throw new InputError(USAGE);
  switch (command) {
    case 'write': {
      if (rest.length !== 1) throw new InputError(USAGE);
      const dir = parseDir(rest[0]);
      const text = await readStdin(io, 'look');
      let input: unknown;
      try {
        input = JSON.parse(text);
      } catch (cause) {
        if (!(cause instanceof SyntaxError)) throw cause;
        throw new InputError(`look on stdin is not JSON: ${cause.message}`, { cause });
      }
      return writeLook(runDir, dir, input);
    }
    case 'board': {
      const [dirArg, boardArg, ...flags] = rest;
      const dir = parseDir(dirArg);
      const board = parseBoard(boardArg);
      const assetsArg = flag(flags, '--assets');
      const assets = assetsArg ? assetsArg.split(',') : [];
      const at = flags.includes('--at') ? flag(flags, '--at') : '1';
      if (at === undefined || !AT_PATTERN.test(at)) throw new InputError('--at must be a number of seconds');
      const html = await readStdin(io, 'HTML');
      return writeBoard(defaultDeps(), runDir, dir, board, html, assets, Number(at));
    }
    case 'compare':
      if (rest.length !== 0) throw new InputError(USAGE);
      return compareLooks(runDir);
    case 'pick':
      if (rest.length !== 1) throw new InputError(USAGE);
      return pickLook(runDir, parseDir(rest[0]));
    default:
      throw new InputError(USAGE);
  }
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
