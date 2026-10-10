import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { alignerModel, type ModelSpec } from '../adapters/align/ctc-onnx';
import type { Doctor } from '../contracts/types';
import { HF_CMD, HYPERFRAMES_VERSION } from '../core/config';
import { type Deps, defaultDeps } from '../core/deps';
import { ToolError } from '../core/errors';

export type DoctorOptions = { now?: Date; home?: string; model?: ModelSpec };

type Status = Doctor['tools'][string];

const HfDoctorSchema = z.object({
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string(), hint: z.string().optional() })),
});

const firstLine = (s: string, max = 80) => (s.split('\n')[0] ?? '').trim().slice(0, max);

/** Why a command that threw `ToolError` did not run: it timed out, or could not start. */
const whyNotRun = (e: ToolError, missing: string) => (e.timedOut ? 'timed out' : missing);

/** Run `cmd` and return its exit code and the first line of stdout, or a failed status when it cannot run. */
const version = async (
  deps: Deps,
  cmd: string[],
): Promise<{ code: number; line: string; fail?: undefined } | { fail: Status }> => {
  try {
    const r = await deps.sh(cmd, { allowFail: true, env: deps.config.toolEnv });
    return { code: r.code, line: firstLine(r.stdout) };
  } catch (e) {
    if (e instanceof ToolError) return { fail: { ok: false, detail: whyNotRun(e, 'not found') } };
    throw e;
  }
};

/** A filesystem error with an errno code (EACCES, EISDIR, ...) becomes a failed status; anything else is a bug. */
const fsFail = (e: unknown, p: string): Status => {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code !== 'string') throw e;
  return { ok: false, detail: `${code}: ${p}` };
};

const checkNode = async (deps: Deps): Promise<Status> => {
  const r = await version(deps, ['node', '--version']);
  if (r.fail) return r.fail;
  const m = /^v(\d+)\.(\d+)\.(\d+)/.exec(r.line);
  if (!m) return { ok: false, detail: `found ${r.line}, need Node.js 22 or newer` };
  const v = `${m[1]}.${m[2]}.${m[3]}`;
  return Number(m[1]) >= 22 ? { ok: true, version: v } : { ok: false, detail: `found ${v}, need Node.js 22 or newer` };
};

const checkFf = async (deps: Deps, tool: 'ffmpeg' | 'ffprobe'): Promise<Status> => {
  const r = await version(deps, [tool, '-version']);
  if (r.fail) return r.fail;
  const m = /^ff(?:mpeg|probe) version n?(\d+)\.(\d+)/.exec(r.line);
  if (m) {
    const v = `${m[1]}.${m[2]}`;
    return Number(m[1]) >= 6 ? { ok: true, version: v } : { ok: false, detail: `found ${v}, need ${tool} 6 or newer` };
  }
  // Git builds carry no release number; they are accepted.
  if (r.line.startsWith(`${tool} version`)) return { ok: true, detail: `version not parsed: ${r.line}` };
  return { ok: false, detail: `unexpected output: ${r.line}` };
};

const checkUv = async (deps: Deps): Promise<Status> => {
  const r = await version(deps, ['uv', '--version']);
  if (r.fail) return r.fail;
  const m = /^uv (\S+)/.exec(r.line);
  return r.code === 0 && m ? { ok: true, version: m[1] } : { ok: false, detail: r.line };
};

/** One `hyperframes doctor --json` call answers three tools. */
const checkHyperframes = async (deps: Deps): Promise<Record<'hyperframes' | 'chrome' | 'kokoro', Status>> => {
  const failAll = (reason: string): Record<'hyperframes' | 'chrome' | 'kokoro', Status> => {
    const s = { ok: false, detail: `hyperframes doctor did not run: ${firstLine(reason, 200)}` };
    return { hyperframes: s, chrome: s, kokoro: s };
  };
  let checks: z.infer<typeof HfDoctorSchema>['checks'];
  try {
    const r = await deps.sh([...HF_CMD, 'doctor', '--json'], {
      allowFail: true,
      env: deps.config.toolEnv,
      timeoutMs: 180_000,
    });
    const parsed = HfDoctorSchema.safeParse(JSON.parse(r.stdout));
    if (!parsed.success) return failAll('unexpected output shape');
    checks = parsed.data.checks;
  } catch (e) {
    if (e instanceof ToolError) return failAll(whyNotRun(e, 'npx not found'));
    if (e instanceof SyntaxError) return failAll(e.message);
    throw e;
  }
  const find = (name: string): Status => {
    const c = checks.find((x) => x.name === name);
    if (!c) return { ok: false, detail: 'not reported by hyperframes doctor' };
    return { ok: c.ok, detail: c.hint ? `${c.detail} (${c.hint})` : c.detail };
  };
  const v = checks.find((x) => x.name === 'Version');
  const hyperframes: Status = !v
    ? find('Version')
    : v.detail.split(/\s+/)[0] === HYPERFRAMES_VERSION // exact token: "0.8.1431" must not pass
      ? { ok: true, version: HYPERFRAMES_VERSION }
      : { ok: false, detail: `found ${v.detail}, need ${HYPERFRAMES_VERSION}` };
  return { hyperframes, chrome: find('Chrome'), kokoro: find('TTS (Kokoro)') };
};

const checkVenv = async (deps: Deps): Promise<Status> => {
  const cmd = ['uv', 'sync', '--frozen', '--no-dev', '--check', '--project', deps.config.pluginRoot];
  try {
    const r = await deps.sh(cmd, { allowFail: true, env: deps.config.toolEnv });
    return r.code === 0
      ? { ok: true, path: deps.config.venvDir }
      : { ok: false, detail: 'missing or out of sync with uv.lock' };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, detail: `uv ${whyNotRun(e, 'not found')}` };
    throw e;
  }
};

/** Check the aligner model file by size and sha256. Returns a status; a filesystem error becomes a failed status. */
export const checkModel = (model: ModelSpec): Status => {
  try {
    const stat = statSync(model.path, { throwIfNoEntry: false });
    if (!stat) return { ok: false, detail: 'missing' };
    if (!stat.isFile()) return { ok: false, detail: `not a file: ${model.path}` };
    if (stat.size !== model.bytes) return { ok: false, detail: `size ${stat.size}, expected ${model.bytes}` };
    const sha = createHash('sha256').update(readFileSync(model.path)).digest('hex');
    return sha === model.sha256 ? { ok: true, path: model.path } : { ok: false, detail: 'sha256 mismatch' };
  } catch (e) {
    return fsFail(e, model.path);
  }
};

const checkParakeet = (home: string): Status => {
  // ponytail: HyperFrames' internal cache path (probed 0.8.143); re-probe when the pin changes.
  const dir = path.join(home, '.cache', 'hyperframes', 'parakeet', 'parakeet-tdt-0.6b-v3-int8');
  try {
    return statSync(dir, { throwIfNoEntry: false })?.isDirectory()
      ? { ok: true, path: dir }
      : { ok: false, detail: `model folder missing: ${dir}` };
  } catch (e) {
    return fsFail(e, dir);
  }
};

/**
 * Check every tool the Video Machine needs. Writes nothing except npm's own cache when the pinned HyperFrames
 * isn't cached yet (`npx --yes`).
 * Returns a `Doctor` with one entry per `DOCTOR_TOOLS` name and an empty `smoke_s`.
 * Throws only on a bug (a tool that cannot start is a failed entry, not an error).
 */
export const runDoctor = async (deps: Deps = defaultDeps(), opts: DoctorOptions = {}): Promise<Doctor> => {
  const { now = new Date(), home = homedir(), model = alignerModel(deps.config.vmHome) } = opts;
  const hf = await checkHyperframes(deps);
  const tools: Doctor['tools'] = {
    node: await checkNode(deps),
    ffmpeg: await checkFf(deps, 'ffmpeg'),
    ffprobe: await checkFf(deps, 'ffprobe'),
    uv: await checkUv(deps),
    ...hf,
    venv: await checkVenv(deps),
    aligner_model: checkModel(model),
    parakeet: checkParakeet(home),
  };
  return { checked_at: now.toISOString(), tools, smoke_s: {} };
};
