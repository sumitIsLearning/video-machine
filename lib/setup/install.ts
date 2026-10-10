import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { alignerModel, type ModelSpec } from '../adapters/align/ctc-onnx';
import { HF_CMD } from '../core/config';
import { type Deps, defaultDeps } from '../core/deps';
import { VideoMachineError } from '../core/errors';

export const INSTALL_STEPS = ['venv', 'model', 'browser', 'parakeet'] as const;
export type InstallStep = (typeof INSTALL_STEPS)[number];
export type StepResult = { step: InstallStep; ok: boolean; detail: string };
export type InstallOptions = { fetch?: typeof fetch; model?: ModelSpec };

const FIFTEEN_MIN = 15 * 60_000;

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const lastLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);

/**
 * Make the uv venv under VM_HOME match uv.lock (no dev packages). Does nothing when it already does.
 * Returns a detail line. Throws ToolError when uv fails.
 */
export const installVenv = async (deps: Deps = defaultDeps()): Promise<string> => {
  const { pluginRoot, venvDir, toolEnv } = deps.config;
  const check = await deps.sh(['uv', 'sync', '--frozen', '--no-dev', '--check', '--project', pluginRoot], {
    allowFail: true,
    env: toolEnv,
  });
  if (check.code === 0) return `venv already in sync at ${venvDir}`;
  await deps.sh(['uv', 'sync', '--frozen', '--no-dev', '--project', pluginRoot], {
    env: toolEnv,
    timeoutMs: FIFTEEN_MIN,
  });
  return `venv synced at ${venvDir}`;
};

const isModelValid = (m: ModelSpec): boolean => {
  const stat = statSync(m.path, { throwIfNoEntry: false });
  return !!stat?.isFile() && stat.size === m.bytes && sha256Of(readFileSync(m.path)) === m.sha256;
};

/**
 * Run one model operation. A VideoMachineError passes through; any other failure (network, disk, permissions)
 * becomes one that names the operation, the model path and a hint, so `install()` can record it and carry on.
 */
const modelStep = async <T>(what: string, modelPath: string, hint: string, fn: () => T | Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof VideoMachineError) throw cause;
    const reason = (cause as Error).name === 'TimeoutError' ? 'timed out' : ((cause as Error).message ?? String(cause));
    throw new VideoMachineError(`${what} failed for ${modelPath}: ${reason}. ${hint}`, { cause });
  }
};

/**
 * Fetch the aligner model into VM_HOME, verified by size and sha256. Does nothing when a valid copy is there.
 * A corrupt file at the model path is removed first, so a failed download never leaves it for the aligner to use.
 * Returns a detail line. Throws VideoMachineError on a network, disk or permission failure, a 15-minute timeout,
 * an HTTP error or a size or sha256 mismatch (nothing is installed).
 */
export const installModel = async (deps: Deps = defaultDeps(), opts: InstallOptions = {}): Promise<string> => {
  const model = opts.model ?? alignerModel(deps.config.vmHome);
  const step = <T>(what: string, hint: string, fn: () => T | Promise<T>) => modelStep(what, model.path, hint, fn);
  const close = 'Close anything using the model and run setup again.';
  if (await step('checking the aligner model', close, () => isModelValid(model)))
    return `aligner model already at ${model.path}`;
  // The aligner only checks that the file exists, so a corrupt one must not outlive a failed download.
  await step('removing the invalid aligner model', close, () => rmSync(model.path, { force: true }));
  const bytes = await step(
    `aligner model download from ${model.url}`,
    'Check the network and run setup again.',
    async () => {
      // The timeout signal covers the body read too.
      const res = await (opts.fetch ?? fetch)(model.url, { signal: AbortSignal.timeout(FIFTEEN_MIN) });
      if (!res.ok) throw new VideoMachineError(`aligner model download failed: HTTP ${res.status} from ${model.url}`);
      // ponytail: whole file in memory (95 MB); stream it if models grow
      return new Uint8Array(await res.arrayBuffer());
    },
  );
  const sha = sha256Of(bytes);
  if (bytes.length !== model.bytes || sha !== model.sha256)
    throw new VideoMachineError(
      `aligner model from ${model.url} is wrong: got ${bytes.length} bytes, sha256 ${sha}; expected ${model.bytes} bytes, sha256 ${model.sha256}. Nothing was installed.`,
    );
  const tmp = `${model.path}.${process.pid}.download`;
  await step('writing the aligner model', close, () => {
    try {
      mkdirSync(path.dirname(model.path), { recursive: true });
      writeFileSync(tmp, bytes);
      renameSync(tmp, model.path);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  });
  return `aligner model fetched to ${model.path}`;
};

/**
 * Find or download Chrome through HyperFrames.
 * Returns the last line HyperFrames printed. Throws ToolError when it fails.
 */
export const installBrowser = async (deps: Deps = defaultDeps()): Promise<string> => {
  const r = await deps.sh([...HF_CMD, 'browser', 'ensure'], { env: deps.config.toolEnv, timeoutMs: FIFTEEN_MIN });
  return lastLine(r.stdout) ?? 'Chrome ready';
};

/**
 * Install the parakeet transcription model through HyperFrames.
 * Returns a detail line. Throws ToolError when it fails, VideoMachineError when its output is not the expected JSON.
 */
export const installParakeet = async (deps: Deps = defaultDeps()): Promise<string> => {
  const r = await deps.sh([...HF_CMD, 'models', 'install', 'parakeet', '--json'], {
    env: deps.config.toolEnv,
    timeoutMs: 20 * 60_000,
  });
  const line = lastLine(r.stdout) ?? '';
  let out: { ok?: unknown; changed?: unknown; modelDir?: unknown } | null = null;
  try {
    out = JSON.parse(line);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  if (out?.ok !== true)
    throw new VideoMachineError(`hyperframes models install parakeet: unexpected output: ${line.slice(0, 200)}`);
  const where = typeof out.modelDir === 'string' ? ` at ${out.modelDir}` : '';
  return `${out.changed === false ? 'parakeet already installed' : 'parakeet installed'}${where}`;
};

/**
 * Run the install steps in order, continuing after a failure.
 * Returns one result per step. Only a VideoMachineError (including ToolError) is recorded; a bug still throws.
 */
export const install = async (
  deps: Deps = defaultDeps(),
  steps: readonly InstallStep[] = INSTALL_STEPS,
  opts: InstallOptions = {},
): Promise<StepResult[]> => {
  const run: Record<InstallStep, () => Promise<string>> = {
    venv: () => installVenv(deps),
    model: () => installModel(deps, opts),
    browser: () => installBrowser(deps),
    parakeet: () => installParakeet(deps),
  };
  const results: StepResult[] = [];
  for (const step of steps) {
    try {
      results.push({ step, ok: true, detail: await run[step]() });
    } catch (e) {
      if (!(e instanceof VideoMachineError)) throw e;
      results.push({ step, ok: false, detail: e.message });
    }
  }
  return results;
};
