import { type Env, loadConfig, toToolEnv } from './config';
import { ToolError } from './errors';

export type ShResult = { code: number; stdout: string; stderr: string };
export type ShOptions = { cwd?: string; env?: Env; timeoutMs?: number; allowFail?: boolean };
export type Sh = (cmd: string[], opts?: ShOptions) => Promise<ShResult>;

export const DEFAULT_TIMEOUT_MS = 600_000;
/** After a timeout kill, how long to keep waiting for the pipes before giving up on them. */
const PIPE_GRACE_MS = 2000;

// ponytail: the whole-tree kill is Windows-only in v1. On macOS/Linux this kills the direct child, then cancels the
// pipes after the grace period; spawn detached and kill the process group if grandchildren leak.
/** Kill a process and everything it started (Windows), or at least the process itself. */
const killTree = (proc: Bun.Subprocess): void => {
  if (process.platform === 'win32') {
    // proc.kill() orphans grandchildren on Windows (cmd → node, bunx → vite; probed in Phase 0 and Phase 1)
    const r = Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(proc.pid)]);
    if (r.exitCode === 0 || proc.exitCode !== null) return;
  }
  proc.kill('SIGKILL');
};

/** Read a stream to a string. `cancel` ends the read early; `done` then resolves with what arrived so far. */
const drain = (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    let text = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      text += decoder.decode(chunk.value, { stream: true });
    }
  })();
  return { done, cancel: () => void reader.cancel() };
};

/**
 * Run a command with a timeout. Returns code, stdout and stderr.
 * Throws ToolError when the command cannot start, times out (after killing its process tree and giving up on
 * pipes that stay open), or exits non-zero (unless `allowFail`). The child gets the tool env
 * (`toToolEnv`: no API keys, telemetry off), built from `opts.env` or from the process environment.
 */
export const sh: Sh = async (cmd, opts = {}) => {
  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, allowFail = false } = opts;
  const env = opts.env ? toToolEnv(opts.env) : loadConfig().toolEnv;
  if (cmd.length === 0) throw new ToolError({ cmd, code: null, stderr: 'empty command' });
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn(cmd, { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (cause) {
    throw new ToolError({ cmd, code: null, stderr: (cause as Error).message }, { cause });
  }
  const out = drain(proc.stdout);
  const err = drain(proc.stderr);
  let timedOut = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    // An already-exited child is neither killed nor a timeout, but a grandchild may still hold its pipes.
    if (proc.exitCode === null) {
      timedOut = true;
      killTree(proc);
    }
    // A grandchild that escaped the kill can hold the pipes open; stop waiting for them.
    graceTimer = setTimeout(() => {
      out.cancel();
      err.cancel();
    }, PIPE_GRACE_MS);
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([out.done, err.done, proc.exited]).finally(() => {
    clearTimeout(timer);
    clearTimeout(graceTimer);
  });
  // Many tools report failures on stdout; keep that tail when stderr says nothing.
  const detail = stderr || stdout;
  if (timedOut) throw new ToolError({ cmd, code: null, stderr: detail, timedOut: true });
  if (code !== 0 && !allowFail) throw new ToolError({ cmd, code, stderr: detail });
  return { code, stdout, stderr };
};
