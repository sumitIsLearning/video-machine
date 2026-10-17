import { FeedbackSchema } from '../contracts/types';
import { runCli } from '../core/cli';
import { InputError } from '../core/errors';
import { type ReviewResult, review } from './review';

const USAGE = 'usage: cli.ts snapshot <run_dir> --route words|plan|scenes [--scenes id,id] (feedback on stdin)';
const MAX_STDIN_BYTES = 64 * 1024;

/**
 * Run the review command: `snapshot <run_dir> --route X [--scenes a,b]` takes the feedback text as `stdin`.
 * Returns the fields of the CLI's JSON result. Throws InputError for a usage mistake or an unknown route;
 * review throws its own errors.
 */
export const main = async (argv: string[], stdin: string): Promise<ReviewResult> => {
  const [command, runDir, ...flags] = argv;
  if (command !== 'snapshot' || runDir === undefined) throw new InputError(USAGE);
  let route: string | undefined;
  let scenes: string | undefined;
  for (let i = 0; i < flags.length; i += 2) {
    const value = flags[i + 1];
    if (value === undefined) throw new InputError(USAGE);
    if (flags[i] === '--route') route = value;
    else if (flags[i] === '--scenes') scenes = value;
    else throw new InputError(USAGE);
  }
  const parsed = FeedbackSchema.shape.route.safeParse(route);
  if (!parsed.success) throw new InputError(USAGE);
  return review(runDir, {
    text: stdin,
    route: parsed.data,
    scenes: scenes?.split(','),
  });
};

if (import.meta.main) {
  process.exitCode = await runCli(async () => {
    const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
    if (bytes.byteLength > MAX_STDIN_BYTES) throw new InputError('feedback on stdin is over 64 KB');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause;
      throw new InputError('feedback on stdin is not valid UTF-8 (save it as UTF-8)', { cause });
    }
    return main(process.argv.slice(2), text);
  });
}
