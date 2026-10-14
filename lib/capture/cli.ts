import path from 'node:path';
import { type Launch, launchPlaywright } from '../adapters/capture/playwright/browser';
import { launchFailure, playwrightCapture, profileDirOf } from '../adapters/capture/playwright/index';
import { BriefSchema, CaptureLogSchema, StepsSchema } from '../contracts/types';
import { runCli } from '../core/cli';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError } from '../core/errors';
import { readJson } from '../core/json';
import { assertRunDir, runFileOf } from '../core/paths';
import { readNavVideo } from './reader';
import { writeSteps } from './steps';

const USAGE =
  'usage: cli.ts read <run_dir> <source> | steps <run_dir> (draft JSON on stdin) | replay <run_dir> | login <run_dir>';

type Io = { stdin?: () => Promise<Uint8Array>; cwd?: string; deps?: Deps; launch?: Launch };

const LOG = 'capture/log.json';
const STEPS = 'capture/steps.json';

/**
 * The product URL of a run's brief: the one host a replay may visit even when it is private, and the browser profile.
 * Returns the URL. Throws InputError when the brief is missing or lists no product_url.
 */
const productUrlOf = (runDir: string): string => {
  const brief = readJson(runFileOf(runDir, 'brief.json', 'run the brief command first'), BriefSchema);
  const url = brief.sources.find((s) => s.kind === 'product_url')?.path_or_url;
  if (!url) throw new InputError(`brief.json in ${runDir} has no product_url source; add the product's address`);
  return url;
};

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
 * with no steps file, or a brief with no product_url (replay and login); a browser that will not open is a CaptureError;
 * the reader, steps writer and replay throw their own errors.
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
    const productUrl = productUrlOf(runDir);
    const steps = stepsOf(runDir);
    if (steps.length === 0) throw new InputError(`${STEPS} in ${runDir} has no steps`);
    const adapter = playwrightCapture(deps, {
      launch: io.launch,
      productUrl,
      onWarn: (line) => process.stderr.write(`${line}\n`),
    });
    const log = readJson(
      await adapter.replay(runDir, steps, profileDirOf(deps.config.vmHome, productUrl)),
      CaptureLogSchema,
    );
    return {
      log: LOG,
      ok_steps: log.filter((e) => e.failed === undefined).length,
      failed: log.flatMap((e) => (e.failed === undefined ? [] : [{ i: e.i, failed: e.failed, fallback: e.fallback }])),
    };
  }
  if (command === 'login' && runDir && rest.length === 0) {
    assertRunDir(runDir);
    const productUrl = productUrlOf(runDir);
    const profile = profileDirOf(deps.config.vmHome, productUrl);
    // Passwords are typed by the creator, and no video is recorded, so nothing typed here is kept.
    const launch = io.launch ?? launchPlaywright;
    let page: Awaited<ReturnType<Launch>>;
    try {
      page = await launch({ profileDir: profile, headless: false });
    } catch (cause) {
      throw launchFailure(profile, cause);
    }
    await page.goto(productUrl);
    await page.closed();
    return { profile };
  }
  throw new InputError(USAGE);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
