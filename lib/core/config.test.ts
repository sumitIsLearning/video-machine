import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { HYPERFRAMES_VERSION, loadConfig, PLUGIN_ROOT, SECRET_ENV } from './config';

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

test('a parent setting cannot switch telemetry back on', () => {
  expect(loadConfig({ HYPERFRAMES_NO_TELEMETRY: '0' }).toolEnv.HYPERFRAMES_NO_TELEMETRY).toBe('1');
});

test('toolEnv never hands API keys to child processes', () => {
  expect(SECRET_ENV).toEqual(expect.arrayContaining(['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY']));
  const env = Object.fromEntries(SECRET_ENV.map((k) => [k, 'secret']));
  const { toolEnv } = loadConfig({ ...env, PATH: '/bin' });
  for (const k of SECRET_ENV) expect(toolEnv[k]).toBeUndefined();
  expect(toolEnv.PATH).toBe('/bin');
});

test('keys, tokens and secrets are removed whatever their letter case, other keys survive', () => {
  const { toolEnv } = loadConfig({
    heygen_api_key: 'secret',
    Gemini_Api_Key: 'secret',
    Anthropic_Api_Key: 'secret',
    hf_token: 'secret',
    Some_Secret: 'secret',
    Path: 'C:\\bin',
  });
  expect(Object.keys(toolEnv).filter((k) => /(_API_KEY|_TOKEN|_SECRET)$/i.test(k))).toEqual([]);
  expect(toolEnv.Path).toBe('C:\\bin');
});
