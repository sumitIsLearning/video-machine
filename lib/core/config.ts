// The only file that reads the environment (AGENT_PROMPT §6).

import { homedir } from 'node:os';
import path from 'node:path';

/** An environment: variable name to value. */
export type Env = Record<string, string | undefined>;
/** Settings every module gets from `loadConfig`. */
export type Config = { pluginRoot: string; vmHome: string; bun: string; toolEnv: Env };

/** The HyperFrames version every `npx hyperframes` call is pinned to. */
export const HYPERFRAMES_VERSION = '0.8.143';

/** Root of the plugin (the repo root). */
export const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');

/** Environment variables that hold API keys; child processes never see them. */
export const SECRET_ENV = ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'] as const;
const SECRETS = new Set<string>(SECRET_ENV);
const SECRET_PATTERN = /(_API_KEY|_TOKEN|_SECRET)$/i;

/**
 * Copy of `env` without API keys.
 * Returns a new env; the input is not changed.
 */
export const stripSecrets = (env: Env): Env =>
  // ponytail: known list + name pattern; add an allowlist if a tool ever needs a token.
  // Windows env names ignore case, so match keys upper-cased.
  Object.fromEntries(Object.entries(env).filter(([k]) => !SECRETS.has(k.toUpperCase()) && !SECRET_PATTERN.test(k)));

/**
 * The env for a child process: `env` without API keys, telemetry and skill installs off, UTF-8 Python.
 * Returns a new env; the input is not changed.
 */
export const toToolEnv = (env: Env): Env => ({
  ...stripSecrets(env),
  // Set last so the parent cannot override them.
  HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_SKIP_SKILLS: '1',
  PYTHONUTF8: '1',
});

/**
 * Read settings from `env` (default: the process environment).
 * Returns the plugin root, the user data folder, the pinned bun and the env for child processes (`toToolEnv`).
 */
export const loadConfig = (env: Env = process.env): Config => ({
  pluginRoot: PLUGIN_ROOT,
  vmHome: path.resolve(env.VM_HOME ?? path.join(homedir(), '.video-machine')),
  // The global bun (1.3.5) cannot launch Chrome; use the pinned one.
  bun: path.join(PLUGIN_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
  toolEnv: toToolEnv(env),
});
