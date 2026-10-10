import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DoctorSchema, failingTools } from '../contracts/types';
import { runCli } from '../core/cli';
import { loadConfig } from '../core/config';
import { ContractError, InputError } from '../core/errors';
import { readJson } from '../core/json';
import { importFiles, newRun, writeBrief } from './intake';
import { listRuns, whereAmI } from './where';

const USAGE =
  'usage: cli.ts new --concept <file|-> [--runs <dir>] | import <run_dir> <file...> | brief <run_dir> (draft JSON on stdin) | where <run_dir> | status [--runs <dir>]';

/** parseArgs, with its TypeError for an unknown flag or a flag with no value turned into an InputError. */
const parse = (argv: string[]) => {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: { concept: { type: 'string' }, runs: { type: 'string' } },
    });
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new InputError(`${cause.message}\n${USAGE}`, { cause });
  }
};

type Io = { stdin?: () => Promise<Uint8Array>; cwd?: string; vmHome?: string };

/** The doctor summary for `status`: null when setup never ran, "unreadable" for any other read or parse failure. */
const doctorSummary = (vmHome: string) => {
  try {
    const d = readJson(path.join(vmHome, 'doctor.json'), DoctorSchema);
    const failing = failingTools(d);
    return { ok: failing.length === 0, failing, checked_at: d.checked_at };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (e instanceof ContractError || code !== undefined)
      return { ok: false, failing: ['doctor.json unreadable'], checked_at: null };
    throw e;
  }
};

/**
 * Run one run command: `new`, `import`, `brief`, `where` or `status`.
 * Returns the fields of the CLI's JSON result. Throws InputError for a usage mistake, a missing concept file or a
 * brief draft that is not JSON; the intake and where functions throw their own errors.
 */
export const main = async (argv: string[], io: Io = {}): Promise<Record<string, unknown>> => {
  const cwd = io.cwd ?? process.cwd();
  const stdin = io.stdin ?? (async () => new Uint8Array(await Bun.stdin.arrayBuffer()));
  const { positionals, values } = parse(argv);
  const [command, first, ...rest] = positionals;
  const runsDir = path.resolve(cwd, values.runs ?? 'runs');
  const runDir = first === undefined ? undefined : path.resolve(cwd, first);

  if (command === 'new' && values.concept !== undefined) {
    let concept: Uint8Array;
    try {
      concept = values.concept === '-' ? await stdin() : readFileSync(path.resolve(cwd, values.concept));
    } catch (cause) {
      // any fs error (missing, a folder, no permission) means the creator's path is wrong
      if ((cause as NodeJS.ErrnoException).code === undefined) throw cause;
      throw new InputError(`cannot read the concept file ${values.concept}: ${(cause as Error).message}`, { cause });
    }
    const { run_id, runDir: dir } = newRun({ runsDir, concept });
    return { run_id, run_dir: dir };
  }
  if (command === 'import' && runDir && rest.length > 0)
    return {
      paths: importFiles(
        runDir,
        rest.map((f) => path.resolve(cwd, f)),
      ),
    };
  if (command === 'brief' && runDir) {
    let draft: unknown;
    try {
      draft = JSON.parse(new TextDecoder().decode(await stdin()));
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      throw new InputError(`the brief draft on stdin is not JSON: ${cause.message}`, { cause });
    }
    const brief = writeBrief(runDir, draft);
    return { run_id: brief.run_id, brief: path.join(runDir, 'brief.json') };
  }
  if (command === 'where' && runDir) return { ...whereAmI(runDir) };
  if (command === 'status' && first === undefined)
    return { runs: listRuns(runsDir), doctor: doctorSummary(io.vmHome ?? loadConfig().vmHome) };
  throw new InputError(USAGE);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
