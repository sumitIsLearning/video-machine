import path from 'node:path';
import { type Launch, launchPlaywright } from '../adapters/capture/playwright/browser';
import { playwrightCapture, profileDirOf } from '../adapters/capture/playwright/index';
import { CaptureLogSchema, StepsSchema } from '../contracts/types';
import { runCli } from '../core/cli';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError } from '../core/errors';
import { readJson } from '../core/json';
import { assertRunDir } from '../run/intake';
import { readNavVideo } from './reader';
import { writeSteps } from './steps';

const USAGE =
  'usage: cli.ts read <run_dir> <source> | steps <run_dir> (draft JSON on stdin) | replay <run_dir> | login <url>';

type Io = { stdin?: () => Promise<Uint8Array>; cwd?: string; deps?: Deps; launch?: Launch };

const LOG = 'capture/log.json';
const STEPS = 'capture/steps.json';

/** The steps of a run, or an InputError that names the command which writes it. */
const stepsOf = (runDir: string) => {
  try {
    return readJson(path.join(runDir, STEPS), StepsSchema);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    throw new InputError(`${runDir} has no ${STEPS}; run the steps command first`, { cause });
  }
};

/**
 * Run one capture command: `read`, `steps`, `replay` or `login`.
 * Returns the fields of the CLI's JSON result. Throws InputError for a usage mistake, a draft that is not JSON, a run
 * with no steps file or a login URL that is not http(s); the reader, steps writer and replay throw their own errors.
 */
export const main = async (argv: string[], io: Io = {}): Promise<Record<string, unknown>> => {
  const cwd = io.cwd ?? process.cwd();
  const deps = io.deps ?? defaultDeps();
  const [command, first, ...rest] = argv;
  const runDir = first === undefined ? undefined : path.resolve(cwd, first);

  if (command === 'read' && runDir && rest.length === 1 && rest[0])
    return { ...(await readNavVideo(deps, runDir, rest[0])) };
  if (command === 'steps' && runDir && rest.length === 0) {
    let draft: unknown;
    try {
      const stdin = io.stdin ?? (async () => new Uint8Array(await Bun.stdin.arrayBuffer()));
      draft = JSON.parse(new TextDecoder().decode(await stdin()));
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      throw new InputError(`the steps draft on stdin is not JSON: ${cause.message}`, { cause });
    }
    return { steps: STEPS, count: writeSteps(runDir, draft).length };
  }
  if (command === 'replay' && runDir && rest.length === 0) {
    assertRunDir(runDir);
    const steps = stepsOf(runDir);
    const firstStep = steps[0];
    if (!firstStep) throw new InputError(`${STEPS} in ${runDir} has no steps`);
    const adapter = playwrightCapture(deps, {
      launch: io.launch,
      onWarn: (line) => process.stderr.write(`${line}\n`),
    });
    const log = readJson(
      await adapter.replay(runDir, steps, profileDirOf(deps.config.vmHome, firstStep.url)),
      CaptureLogSchema,
    );
    return {
      log: LOG,
      ok_steps: log.filter((e) => e.failed === undefined).length,
      failed: log.flatMap((e) => (e.failed === undefined ? [] : [{ i: e.i, failed: e.failed, fallback: e.fallback }])),
    };
  }
  if (command === 'login' && first && rest.length === 0) {
    if (!URL.canParse(first) || !/^https?:$/.test(new URL(first).protocol))
      throw new InputError(`cannot log in at ${first}: it is not an http(s) address`);
    const profile = profileDirOf(deps.config.vmHome, first);
    // Passwords are typed by the creator, and no video is recorded, so nothing typed here is kept.
    const launch = io.launch ?? launchPlaywright;
    const page = await launch({ profileDir: profile, headless: false });
    await page.goto(first);
    await page.closed();
    return { profile };
  }
  throw new InputError(USAGE);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
