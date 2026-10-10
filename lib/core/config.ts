// The only file that reads the environment (AGENT_PROMPT §6).

import { homedir } from 'node:os';
import path from 'node:path';

/** An environment: variable name to value. */
export type Env = Record<string, string | undefined>;
/** Settings every module gets from `loadConfig`. */
export type Config = { pluginRoot: string; vmHome: string; venvDir: string; bun: string; toolEnv: Env };

/** The HyperFrames version every `npx hyperframes` call is pinned to. */
export const HYPERFRAMES_VERSION = '0.8.143';

/** Root of the plugin (the repo root). */
export const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');

// Child processes never see variables whose name looks like a secret (the /i flag covers Windows' case-blind names).
// ponytail: name pattern only; add an allowlist if a tool ever needs a token.
const SECRET_PATTERN = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i;

const stripSecrets = (env: Env): Env =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_PATTERN.test(k)));

// Windows env names are case-blind: drop every parent key that matches a forced one in any case, or the child
// would see both and pick one at random.
const force = (env: Env, forced: Record<string, string>): Env => {
  const names = new Set(Object.keys(forced).map((k) => k.toUpperCase()));
  const kept = Object.entries(env).filter(([k]) => !names.has(k.toUpperCase()));
  return { ...Object.fromEntries(kept), ...forced };
};

/**
 * The env for a child process: `env` without API keys, telemetry and skill installs off, UTF-8 Python,
 * no .pyc files (nothing is written under the plugin root at runtime).
 * Returns a new env; the input is not changed.
 */
export const toToolEnv = (env: Env): Env =>
  force(stripSecrets(env), {
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  });

/** The pinned HyperFrames CLI; every HyperFrames call starts with these words. */
export const HF_CMD = ['npx', '--yes', `hyperframes@${HYPERFRAMES_VERSION}`] as const;

const venvPython = (venvDir: string) =>
  process.platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');

/**
 * Read settings from `env` (default: the process environment).
 * Returns the plugin root, the user data folder, the uv venv in it, the pinned bun and the env for child processes:
 * `toToolEnv` plus the venv for uv (`UV_PROJECT_ENVIRONMENT`) and for HyperFrames' Kokoro (`HYPERFRAMES_PYTHON`).
 */
export const loadConfig = (env: Env = process.env): Config => {
  const vmHome = path.resolve(env.VM_HOME ?? path.join(homedir(), '.video-machine'));
  const venvDir = path.join(vmHome, 'venv');
  return {
    pluginRoot: PLUGIN_ROOT,
    vmHome,
    venvDir,
    // The global bun (1.3.5) cannot launch Chrome; use the pinned one.
    bun: path.join(PLUGIN_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
    // Set after toToolEnv so the parent's own Python settings never redirect ours; nothing lands in the plugin root.
    toolEnv: force(toToolEnv(env), { UV_PROJECT_ENVIRONMENT: venvDir, HYPERFRAMES_PYTHON: venvPython(venvDir) }),
  };
};
