import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { HF_CMD, HYPERFRAMES_VERSION, loadConfig, PLUGIN_ROOT, toToolEnv } from './config';

test('HyperFrames is pinned to 0.8.143', () => {
  expect(HYPERFRAMES_VERSION).toBe('0.8.143');
});

test('PLUGIN_ROOT is the repo root', () => {
  expect(existsSync(path.join(PLUGIN_ROOT, 'package.json'))).toBe(true);
  expect(existsSync(path.join(PLUGIN_ROOT, 'lib', 'core', 'config.ts'))).toBe(true);
});

test('vmHome defaults to ~/.video-machine', () => {
  expect(loadConfig({}).vmHome).toBe(path.join(homedir(), '.video-machine'));
});

test('VM_HOME overrides vmHome', () => {
  expect(loadConfig({ VM_HOME: 'some/vm-home' }).vmHome).toBe(path.resolve('some/vm-home'));
});

test('bun is the pinned bun inside the plugin', () => {
  expect(loadConfig({}).bun.startsWith(path.join(PLUGIN_ROOT, 'node_modules', '.bin', 'bun'))).toBe(true);
});

test('toolEnv keeps the parent env and switches off telemetry, skills installs and cp1252 pipes', () => {
  expect(loadConfig({ PATH: '/bin', FOO: 'bar' }).toolEnv).toMatchObject({
    PATH: '/bin',
    FOO: 'bar',
    HYPERFRAMES_NO_TELEMETRY: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    PYTHONUTF8: '1',
  });
});

test('the Python venv lives under vmHome, never in the plugin', () => {
  const c = loadConfig({ VM_HOME: 'some/vm-home' });
  expect(c.venvDir).toBe(path.join(path.resolve('some/vm-home'), 'venv'));
  expect(c.toolEnv.UV_PROJECT_ENVIRONMENT).toBe(c.venvDir);
});

test('HyperFrames gets the venv python, where Kokoro is installed', () => {
  const c = loadConfig({});
  const py =
    process.platform === 'win32'
      ? path.join(c.venvDir, 'Scripts', 'python.exe')
      : path.join(c.venvDir, 'bin', 'python');
  expect(c.toolEnv.HYPERFRAMES_PYTHON).toBe(py);
});

test('a parent env cannot point uv or HyperFrames at another Python', () => {
  const c = loadConfig({ UV_PROJECT_ENVIRONMENT: 'elsewhere', HYPERFRAMES_PYTHON: 'other.exe' });
  expect(c.toolEnv.UV_PROJECT_ENVIRONMENT).toBe(c.venvDir);
  expect(c.toolEnv.HYPERFRAMES_PYTHON).not.toBe('other.exe');
});

test('a parent Python home, path or uv interpreter never reaches a child, whatever the letter case', () => {
  const env = toToolEnv({ PYTHONHOME: 'x', pythonpath: 'y', Uv_Python: 'z', PATH: '/bin' });
  expect(Object.keys(env).sort()).toEqual(
    ['HYPERFRAMES_NO_TELEMETRY', 'HYPERFRAMES_SKIP_SKILLS', 'PATH', 'PYTHONDONTWRITEBYTECODE', 'PYTHONUTF8'].sort(),
  );
});

test('HF_CMD runs the pinned HyperFrames through npx', () => {
  expect([...HF_CMD]).toEqual(['npx', '--yes', 'hyperframes@0.8.143']);
});

test('a parent setting cannot switch telemetry back on', () => {
  expect(loadConfig({ HYPERFRAMES_NO_TELEMETRY: '0' }).toolEnv.HYPERFRAMES_NO_TELEMETRY).toBe('1');
});

test('Python never writes bytecode into the plugin, whatever the parent says', () => {
  expect(loadConfig({}).toolEnv.PYTHONDONTWRITEBYTECODE).toBe('1');
  expect(loadConfig({ PYTHONDONTWRITEBYTECODE: '0' }).toolEnv.PYTHONDONTWRITEBYTECODE).toBe('1');
});

test('a parent key that differs only in letter case cannot sit next to a forced one', () => {
  const { toolEnv } = loadConfig({ Uv_Project_Environment: 'x', hyperframes_no_telemetry: '0', pythonutf8: '0' });
  const names = Object.keys(toolEnv).map((k) => k.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  expect(toolEnv.UV_PROJECT_ENVIRONMENT).toBe(loadConfig({}).venvDir);
  expect(toolEnv.HYPERFRAMES_NO_TELEMETRY).toBe('1');
  expect(toolEnv.PYTHONUTF8).toBe('1');
});

test('toolEnv never hands API keys to child processes', () => {
  const names = ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'];
  const { toolEnv } = loadConfig({ ...Object.fromEntries(names.map((k) => [k, 'secret'])), PATH: '/bin' });
  for (const k of names) expect(toolEnv[k]).toBeUndefined();
  expect(toolEnv.PATH).toBe('/bin');
});

test('keys, tokens, secrets, passwords and credentials are removed whatever their letter case, other keys survive', () => {
  const { toolEnv } = loadConfig({
    heygen_api_key: 'secret',
    Gemini_Api_Key: 'secret',
    hf_token: 'secret',
    Some_Secret: 'secret',
    AWS_SECRET_ACCESS_KEY: 'secret',
    OPENAI_KEY: 'secret',
    DB_PASSWORD: 'secret',
    GOOGLE_APPLICATION_CREDENTIALS: 'secret',
    Path: 'C:\\bin',
  });
  expect(Object.keys(toolEnv).filter((k) => /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i.test(k))).toEqual([]);
  expect(toolEnv.Path).toBe('C:\\bin');
});
