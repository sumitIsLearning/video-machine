import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DOCTOR_TOOLS, DoctorSchema, failingTools } from '../contracts/types';
import { HF_CMD, loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { ToolError } from '../core/errors';
import type { ShOptions } from '../core/sh';
import { runDoctor } from './doctor';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};

type Reply = { code?: number; stdout?: string } | 'missing' | 'timeout';
const hfDoctor = (over: Record<string, object> = {}) =>
  JSON.stringify({
    ok: false,
    checks: [
      { name: 'Version', ok: true, detail: '0.8.143 (latest)' },
      { name: 'Chrome', ok: true, detail: 'cache: C:\\chrome\\chrome-headless-shell.exe' },
      { name: 'TTS (Kokoro)', ok: true, detail: 'Kokoro deps installed' },
      { name: 'whisper-cpp', ok: false, detail: 'Not found' },
    ].map((c) => ({ ...c, ...over[c.name] })),
  });
const GOOD: Record<string, Reply> = {
  'node --version': { stdout: 'v22.19.0\n' },
  'ffmpeg -version': { stdout: 'ffmpeg version 9.0-full_build-www.gyan.dev Copyright (c) 2000-2026\n' },
  'ffprobe -version': { stdout: 'ffprobe version 9.0-full_build-www.gyan.dev Copyright (c) 2007-2026\n' },
  'uv --version': { stdout: 'uv 0.11.6 (65950801c 2026-04-09 x86_64-pc-windows-msvc)\n' },
  'doctor --json': { stdout: hfDoctor() },
  'sync --frozen': { stdout: 'Would make no changes\n' },
};

/** A fake world: tools answer from `replies` (matched by a substring of the command), a home with parakeet, a model. */
const world = (over: Record<string, Reply> = {}, opts: { parakeet?: boolean; model?: string } = {}) => {
  const replies = { ...GOOD, ...over };
  const calls: { cmd: string[]; opts?: ShOptions }[] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: temp() }),
    sh: async (cmd, o) => {
      calls.push({ cmd, opts: o });
      const line = cmd.join(' ');
      const reply = Object.entries(replies).find(([k]) => line.includes(k))?.[1];
      if (!reply) throw new Error(`unexpected command: ${line}`);
      if (reply === 'missing') throw new ToolError({ cmd, code: null, stderr: 'spawn ENOENT' });
      if (reply === 'timeout') throw new ToolError({ cmd, code: null, stderr: '', timedOut: true });
      const code = reply.code ?? 0;
      if (code !== 0 && !o?.allowFail) throw new ToolError({ cmd, code, stderr: '' });
      return { code, stdout: reply.stdout ?? '', stderr: '' };
    },
  };
  const home = temp();
  if (opts.parakeet ?? true)
    mkdirSync(path.join(home, '.cache', 'hyperframes', 'parakeet', 'parakeet-tdt-0.6b-v3-int8'), { recursive: true });
  const content = 'model bytes';
  const modelPath = path.join(temp(), 'm.onnx');
  writeFileSync(modelPath, opts.model ?? content);
  const model = {
    url: 'https://example.com/m.onnx',
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: Buffer.byteLength(content),
    path: modelPath,
  };
  const run = (m = model) => runDoctor(deps, { now: new Date('2026-10-10T09:00:00Z'), home, model: m });
  return { deps, calls, run, model };
};

test('a complete machine passes every check, with versions', async () => {
  const d = await world().run();
  expect(DoctorSchema.parse(d)).toEqual(d);
  expect(Object.keys(d.tools).sort()).toEqual([...DOCTOR_TOOLS].sort());
  expect(failingTools(d)).toEqual([]);
  expect(d.checked_at).toBe('2026-10-10T09:00:00.000Z');
  expect(d.tools.node?.version).toBe('22.19.0');
  expect(d.tools.ffmpeg?.version).toBe('9.0');
  expect(d.tools.uv?.version).toBe('0.11.6');
  expect(d.tools.hyperframes?.version).toBe('0.8.143');
  expect(d.smoke_s).toEqual({});
});

test('Node older than 22 fails and says what is needed', async () => {
  const d = await world({ 'node --version': { stdout: 'v20.11.1\n' } }).run();
  expect(d.tools.node?.ok).toBe(false);
  expect(d.tools.node?.detail).toContain('22');
});

test('a tool that is not installed fails as "not found" and the other checks still run', async () => {
  const d = await world({ 'uv --version': 'missing' }).run();
  expect(d.tools.uv).toMatchObject({ ok: false, detail: 'not found' });
  expect(d.tools.ffmpeg?.ok).toBe(true);
});

test('uv that exits 0 with an unparseable version fails and shows the first line', async () => {
  const d = await world({ 'uv --version': { stdout: 'something odd\nsecond line\n' } }).run();
  expect(d.tools.uv).toEqual({ ok: false, detail: 'something odd' });
});

test('ffmpeg older than 6 fails; a git build whose version cannot be parsed passes', async () => {
  const old = await world({ 'ffmpeg -version': { stdout: 'ffmpeg version 5.1.2 Copyright\n' } }).run();
  expect(old.tools.ffmpeg?.ok).toBe(false);
  const git = await world({ 'ffmpeg -version': { stdout: 'ffmpeg version N-112233-gabc123 Copyright\n' } }).run();
  expect(git.tools.ffmpeg?.ok).toBe(true);
  expect(git.tools.ffmpeg?.version).toBeUndefined();
});

test('HyperFrames other than the pinned version fails', async () => {
  const d = await world({ 'doctor --json': { stdout: hfDoctor({ Version: { detail: '0.8.150 (latest)' } }) } }).run();
  expect(d.tools.hyperframes?.ok).toBe(false);
  expect(d.tools.hyperframes?.detail).toContain('0.8.143');
});

test('Kokoro missing fails with HyperFrames hint, and HyperFrames ran with the venv python', async () => {
  const w = world({
    'doctor --json': {
      stdout: hfDoctor({ 'TTS (Kokoro)': { ok: false, detail: 'Not installed', hint: 'pip install kokoro-onnx' } }),
    },
  });
  const d = await w.run();
  expect(d.tools.kokoro?.ok).toBe(false);
  expect(d.tools.kokoro?.detail).toContain('Not installed');
  const call = w.calls.find((c) => c.cmd.includes('doctor'));
  expect(call?.cmd).toEqual([...HF_CMD, 'doctor', '--json']);
  expect(call?.opts?.env).toBe(w.deps.config.toolEnv);
});

test('HyperFrames 0.8.1431 is not the pinned 0.8.143', async () => {
  const d = await world({ 'doctor --json': { stdout: hfDoctor({ Version: { detail: '0.8.1431 (latest)' } }) } }).run();
  expect(d.tools.hyperframes?.ok).toBe(false);
});

test('when npx cannot start, hyperframes, chrome and kokoro say npx is not found', async () => {
  const d = await world({ 'doctor --json': 'missing' }).run();
  for (const t of ['hyperframes', 'chrome', 'kokoro'])
    expect(d.tools[t]?.detail).toBe('hyperframes doctor did not run: npx not found');
});

test('a tool that times out fails as "timed out", not "not found"', async () => {
  const d = await world({ 'uv --version': 'timeout', 'doctor --json': 'timeout' }).run();
  expect(d.tools.uv).toMatchObject({ ok: false, detail: 'timed out' });
  expect(d.tools.chrome?.detail).toBe('hyperframes doctor did not run: timed out');
});

test('Node.js missing fails as "not found"', async () => {
  const d = await world({ 'node --version': 'missing' }).run();
  expect(d.tools.node).toMatchObject({ ok: false, detail: 'not found' });
});

test('Windows line endings do not break version parsing', async () => {
  const d = await world({
    'node --version': { stdout: 'v22.19.0\r\n' },
    'ffmpeg -version': { stdout: 'ffmpeg version 9.0 Copyright\r\n' },
  }).run();
  expect(d.tools.node).toMatchObject({ ok: true, version: '22.19.0' });
  expect(d.tools.ffmpeg).toMatchObject({ ok: true, version: '9.0' });
});

test('when hyperframes doctor cannot run, hyperframes, chrome and kokoro fail', async () => {
  const d = await world({ 'doctor --json': { stdout: 'npm ERR! network' } }).run();
  for (const t of ['hyperframes', 'chrome', 'kokoro']) expect(d.tools[t]?.ok).toBe(false);
});

test('a venv out of sync with uv.lock fails; the check never installs', async () => {
  const w = world({ 'sync --frozen': { code: 1, stdout: 'The environment is outdated' } });
  const d = await w.run();
  expect(d.tools.venv).toMatchObject({ ok: false, detail: 'missing or out of sync with uv.lock' });
  const call = w.calls.find((c) => c.cmd.includes('sync'));
  expect(call?.cmd).toEqual(['uv', 'sync', '--frozen', '--no-dev', '--check', '--project', w.deps.config.pluginRoot]);
  expect(call?.opts?.env).toBe(w.deps.config.toolEnv);
});

test('an aligner model of the right size but the wrong sha256 fails', async () => {
  const d = await world({}, { model: 'tampered!!!' }).run();
  expect(d.tools.aligner_model).toMatchObject({ ok: false, detail: 'sha256 mismatch' });
});

test('an aligner model of the wrong size fails', async () => {
  const d = await world({}, { model: 'short' }).run();
  expect(d.tools.aligner_model?.detail).toBe('size 5, expected 11');
});

test('a missing aligner model fails', async () => {
  const w = world();
  const d = await w.run({ ...w.model, path: `${w.model.path}.nope` });
  expect(d.tools.aligner_model).toMatchObject({ ok: false, detail: 'missing' });
});

test('an aligner model path that is a folder fails without throwing', async () => {
  const w = world();
  const d = await w.run({ ...w.model, path: path.dirname(w.model.path) });
  expect(d.tools.aligner_model?.ok).toBe(false);
});

test('parakeet passes only when its model folder exists', async () => {
  expect((await world({}, { parakeet: false }).run()).tools.parakeet?.ok).toBe(false);
});
