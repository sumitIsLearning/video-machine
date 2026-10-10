import { VideoMachineError } from './errors';

/** Where a CLI writes: one JSON line to `out`, diagnostics to `err`. */
export type CliIo = { out: (line: string) => void; err: (line: string) => void };

const STDIO: CliIo = {
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

/**
 * Run a CLI body and print its result as one JSON line: `{"ok":true,...result}` (a result may set `ok:false`).
 * Returns the exit code: 0 when the body returned, 1 when it threw. A thrown error becomes
 * `{"ok":false,"error":"<class>","message":"..."}`; an error that is not a VideoMachineError is a bug, so its stack
 * also goes to stderr. Never throws: if the output itself cannot be written (EPIPE on a closed stdout), it tries to
 * say so on stderr and returns 1.
 */
export const runCli = async (body: () => Promise<Record<string, unknown>>, io: CliIo = STDIO): Promise<number> => {
  let line: string;
  let code = 0;
  let bug: Error | undefined;
  try {
    line = JSON.stringify({ ok: true, ...(await body()) });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    line = JSON.stringify({ ok: false, error: error.name, message: error.message });
    code = 1;
    if (!(error instanceof VideoMachineError)) bug = error;
  }
  try {
    io.out(line);
    if (bug) io.err(bug.stack ?? bug.message);
    return code;
  } catch (e) {
    try {
      io.err(`[cli] could not write the result: ${e instanceof Error ? e.message : String(e)}`);
    } catch {
      // stderr is gone too: nothing left to tell, the exit code is the last signal.
    }
    return 1;
  }
};
