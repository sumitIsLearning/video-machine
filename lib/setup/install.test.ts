import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HF_CMD, loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { ToolError, VideoMachineError } from '../core/errors';
import { INSTALL_STEPS, install, installBrowser, installModel, installParakeet, installVenv } from './install';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const BODY = 'pretend onnx';
const spec = (dir: string) => ({
  url: 'https://example.com/m.onnx',
  sha256: createHash('sha256').update(BODY).digest('hex'),
  bytes: Buffer.byteLength(BODY),
  path: path.join(dir, 'models', 'm.onnx'),
});

/** Fake deps: `sh` answers by substring; `checkCode` is what `uv sync --check` exits with. */
const world = (o: { checkCode?: number; parakeet?: string; failOn?: string } = {}) => {
  const vm = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(vm);
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: vm }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      const line = cmd.join(' ');
      if (o.failOn && line.includes(o.failOn)) throw new ToolError({ cmd, code: 1, stderr: 'boom' });
      if (line.includes('--check')) {
        const code = o.checkCode ?? 0;
        if (code !== 0 && !opts?.allowFail) throw new ToolError({ cmd, code, stderr: '' });
        return { code, stdout: '', stderr: '' };
      }
      if (line.includes('models install'))
        return { code: 0, stdout: o.parakeet ?? '{"ok":true,"changed":false,"modelDir":"C:/p"}\n', stderr: '' };
      return { code: 0, stdout: 'done\n', stderr: '' };
    },
  };
  return { vm, deps, calls };
};
const fakeFetch = (body: string, status = 200) => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { f, urls };
};

test('venv already in sync: checks and installs nothing', async () => {
  const { deps, calls } = world({ checkCode: 0 });
  expect(await installVenv(deps)).toContain('already');
  expect(calls).toHaveLength(1);
});

test('venv out of sync: uv sync --frozen --no-dev into vmHome/venv', async () => {
  const { deps, calls } = world({ checkCode: 1 });
  await installVenv(deps);
  expect(calls[1]).toEqual(['uv', 'sync', '--frozen', '--no-dev', '--project', deps.config.pluginRoot]);
});

test('model: downloads, verifies and moves into place, leaving no temp file', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  const { f, urls } = fakeFetch(BODY);
  await installModel(deps, { fetch: f, model: m });
  expect(urls).toEqual([m.url]);
  expect(readFileSync(m.path, 'utf8')).toBe(BODY);
  expect(readdirSync(path.dirname(m.path))).toEqual(['m.onnx']);
});

test('model already present and valid: no download', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  mkdirSync(path.dirname(m.path), { recursive: true });
  writeFileSync(m.path, BODY);
  const { f, urls } = fakeFetch('never');
  expect(await installModel(deps, { fetch: f, model: m })).toContain('already');
  expect(urls).toEqual([]);
});

test('model with a wrong sha256 is refused and nothing is left behind', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  // same length as BODY, so only the sha256 check can catch it
  const err = await installModel(deps, { fetch: fakeFetch('pretend onxx').f, model: m }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).message).toContain('sha256');
  expect(existsSync(m.path)).toBe(false);
  expect(existsSync(path.dirname(m.path)) ? readdirSync(path.dirname(m.path)) : []).toEqual([]);
});

test('model download that returns HTTP 404 names the status and the url', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  const err = await installModel(deps, { fetch: fakeFetch('nope', 404).f, model: m }).catch((e: unknown) => e);
  expect((err as Error).message).toContain('404');
  expect((err as Error).message).toContain(m.url);
});

test('a corrupt model in place is replaced', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  mkdirSync(path.dirname(m.path), { recursive: true });
  writeFileSync(m.path, 'pretend onxx'); // right size, wrong content
  await installModel(deps, { fetch: fakeFetch(BODY).f, model: m });
  expect(readFileSync(m.path, 'utf8')).toBe(BODY);
});

test('a corrupt model in place is removed when the download then fails', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  mkdirSync(path.dirname(m.path), { recursive: true });
  writeFileSync(m.path, 'pretend onxx');
  const f = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await installModel(deps, { fetch: f, model: m }).catch(() => {});
  expect(existsSync(m.path)).toBe(false);
});

test('a fetch that rejects becomes a VideoMachineError naming the model path', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  const f = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const err = await installModel(deps, { fetch: f, model: m }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).message).toContain(m.path);
});

test('a download that dies mid-stream becomes a VideoMachineError', async () => {
  const { vm, deps } = world();
  const body = new ReadableStream({
    pull(c) {
      c.error(new Error('reset'));
    },
  });
  const f = (async () => new Response(body)) as unknown as typeof fetch;
  const err = await installModel(deps, { fetch: f, model: spec(vm) }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
});

test('a download that times out says so', async () => {
  const { vm, deps } = world();
  const f = (async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  }) as unknown as typeof fetch;
  const err = await installModel(deps, { fetch: f, model: spec(vm) }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).message).toContain('timed out');
});

test('a directory in the model path is a VideoMachineError and leaves no .download file', async () => {
  const { vm, deps } = world();
  const m = spec(vm);
  mkdirSync(m.path, { recursive: true });
  writeFileSync(path.join(m.path, 'x'), 'x');
  const err = await installModel(deps, { fetch: fakeFetch(BODY).f, model: m }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect(readdirSync(path.dirname(m.path)).filter((n) => n.endsWith('.download'))).toEqual([]);
});

test('a second install run with everything in place downloads and syncs nothing', async () => {
  const { vm, deps, calls } = world();
  const m = spec(vm);
  await install(deps, INSTALL_STEPS, { fetch: fakeFetch(BODY).f, model: m });
  calls.length = 0;
  const { f, urls } = fakeFetch('never');
  const r = await install(deps, INSTALL_STEPS, { fetch: f, model: m });
  expect(r.every((s) => s.ok)).toBe(true);
  expect(urls).toEqual([]);
  expect(calls.filter((c) => c.includes('sync') && !c.includes('--check'))).toEqual([]);
});

test('browser: hyperframes browser ensure', async () => {
  const { deps, calls } = world();
  await installBrowser(deps);
  expect(calls[0]).toEqual([...HF_CMD, 'browser', 'ensure']);
});

test('parakeet: reports whether it was already installed', async () => {
  const { deps, calls } = world();
  expect(await installParakeet(deps)).toContain('already');
  expect(calls[0]).toEqual([...HF_CMD, 'models', 'install', 'parakeet', '--json']);
  const fresh = world({ parakeet: '{"ok":true,"changed":true,"modelDir":"C:/p"}' });
  expect(await installParakeet(fresh.deps)).not.toContain('already');
});

test('install runs every step, keeps going after a failure, and reports each one', async () => {
  const { vm, deps } = world({ failOn: 'browser' });
  const m = spec(vm);
  const r = await install(deps, ['venv', 'model', 'browser', 'parakeet'], { fetch: fakeFetch(BODY).f, model: m });
  expect(r.map((s) => [s.step, s.ok])).toEqual([
    ['venv', true],
    ['model', true],
    ['browser', false],
    ['parakeet', true],
  ]);
  expect(r[2]?.detail).toContain('boom');
});

test('install keeps going after the model download fails', async () => {
  const { vm, deps } = world();
  const f = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const r = await install(deps, INSTALL_STEPS, { fetch: f, model: spec(vm) });
  expect(r.map((s) => [s.step, s.ok])).toEqual([
    ['venv', true],
    ['model', false],
    ['browser', true],
    ['parakeet', true],
  ]);
});
