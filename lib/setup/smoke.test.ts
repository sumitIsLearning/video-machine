import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HF_CMD, loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { ToolError, VideoMachineError } from '../core/errors';
import { runSmoke } from './smoke';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const TWO_WORDS = JSON.stringify({
  lines: [
    {
      text: 'Smoke test.',
      start: 0,
      end: 1,
      words: [
        { w: 'Smoke', start: 0, end: 0.4 },
        { w: 'test.', start: 0.5, end: 1 },
      ],
    },
  ],
});

/** Fake HyperFrames and uv that write the files the real ones would; `skip` names a stage that writes nothing. */
const world = (o: { skip?: 'render' | 'tts'; timing?: string; ttsOut?: string; renderFails?: ToolError } = {}) => {
  const vm = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(vm);
  mkdirSync(path.join(vm, 'models'));
  writeFileSync(path.join(vm, 'models', 'w2v2_base_960h_q.onnx'), 'onnx');
  const calls: string[][] = [];
  const cwds: (string | undefined)[] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: vm }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      cwds.push(opts?.cwd);
      const out = (flag: string) => cmd[cmd.indexOf(flag) + 1] ?? '';
      if (cmd.includes('init')) mkdirSync(path.join(opts?.cwd ?? '', 'smoke'));
      if (cmd.includes('render') && o.renderFails) throw o.renderFails;
      if (cmd.includes('render') && o.skip !== 'render') writeFileSync(out('-o'), 'mp4');
      if (cmd.includes('tts')) {
        if (o.skip !== 'tts') writeFileSync(out('-o'), 'RIFF');
        return { code: 0, stdout: o.ttsOut ?? '{"ok":true,"voice":"af_heart"}\n', stderr: '' };
      }
      if (cmd[0] === 'uv') {
        const runDir = cmd[10] ?? '';
        mkdirSync(path.join(runDir, 'data'), { recursive: true });
        writeFileSync(path.join(runDir, 'data', 'timing.json'), o.timing ?? TWO_WORDS);
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  let t = 0;
  const clock = () => (t += 1.5);
  return { deps, calls, cwds, run: () => runSmoke(deps, { clock }) };
};

test('smoke renders a blank reel draft, speaks one line and aligns it, timing each stage', async () => {
  const w = world();
  const s = await w.run();
  expect(s).toEqual({ render: 1.5, tts: 1.5, align: 1.5 });
  expect(w.calls[0]).toEqual([
    ...HF_CMD,
    'init',
    'smoke',
    '--example',
    'blank',
    '--resolution',
    'portrait',
    '--non-interactive',
  ]);
  expect(w.calls[1]?.slice(0, 4)).toEqual([...HF_CMD, 'render']);
  expect(w.calls[1]).toContain('--no-browser-gpu');
  expect(w.calls[1]).toContain('draft');
  expect(w.calls[2]?.slice(0, 5)).toEqual([...HF_CMD, 'tts', 'Smoke test.']);
  expect(w.calls[3]?.[0]).toBe('uv');
});

test('smoke fails naming the render stage when no video comes out', async () => {
  const err = await world({ skip: 'render' })
    .run()
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).message).toStartWith('smoke render');
});

test('smoke wraps a failing render command, keeps it as the cause and still removes the temp folder', async () => {
  const cause = new ToolError({ cmd: ['npx'], code: 1, stderr: 'boom' });
  const w = world({ renderFails: cause });
  const err = await w.run().catch((e: unknown) => e);
  expect((err as Error).message).toStartWith('smoke render');
  expect((err as Error).cause).toBe(cause);
  expect(existsSync(w.cwds[0] ?? '')).toBe(false);
});

test('smoke fails naming the tts stage when hyperframes prints something that is not JSON', async () => {
  const err = await world({ ttsOut: 'garbage' })
    .run()
    .catch((e: unknown) => e);
  expect((err as Error).message).toStartWith('smoke tts');
});

test('smoke fails naming the tts stage when hyperframes prints JSON null', async () => {
  const err = await world({ ttsOut: 'null' })
    .run()
    .catch((e: unknown) => e);
  expect((err as Error).message).toStartWith('smoke tts');
});

test('smoke fails naming the align stage when the words do not come back', async () => {
  const one = JSON.stringify({
    lines: [{ text: 'Smoke test.', start: 0, end: 1, words: [{ w: 'Smoke', start: 0, end: 1 }] }],
  });
  const err = await world({ timing: one })
    .run()
    .catch((e: unknown) => e);
  expect((err as Error).message).toStartWith('smoke align');
});

test('smoke always removes its temp folder', async () => {
  const ok = world();
  await ok.run();
  expect(existsSync(ok.cwds[0] ?? '')).toBe(false);
  const bad = world({ skip: 'tts' });
  await bad.run().catch(() => {});
  expect(existsSync(bad.cwds[0] ?? '')).toBe(false);
});
