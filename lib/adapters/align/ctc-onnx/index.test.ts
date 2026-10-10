import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ContractError, ToolError, UnsupportedError, VideoMachineError } from '../../../core/errors';
import type { ShOptions } from '../../../core/sh';
import { alignerModel, ctcOnnx } from './index';

const lines = [{ id: 'l1', text: 'Ship faster.', delivery: 'voiceover' as const }];

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

/**
 * A run folder with audio/vo.wav, and a fake sh that writes `timing` as data/timing.json
 * (or throws `fail`, or writes nothing when `timing` is null).
 */
const setup = (timing: string | null, fail?: Error, { model = true } = {}) => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(run);
  const vmHome = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(vmHome);
  if (model) {
    mkdirSync(path.join(vmHome, 'models'));
    writeFileSync(alignerModel(vmHome).path, 'onnx');
  }
  mkdirSync(path.join(run, 'audio'));
  const audio = path.join(run, 'audio', 'vo.wav');
  writeFileSync(audio, 'RIFF');
  const calls: string[][] = [];
  const opts: (ShOptions | undefined)[] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: vmHome }),
    sh: async (cmd, o) => {
      calls.push(cmd);
      opts.push(o);
      if (fail) throw fail;
      if (timing !== null) {
        mkdirSync(path.join(run, 'data'), { recursive: true });
        writeFileSync(path.join(run, 'data', 'timing.json'), timing);
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { run, audio, calls, opts, deps };
};
const GOOD = JSON.stringify({ lines: [{ text: 'Ship faster.', start: 0, end: 1, words: [] }] });

test('align runs align.py through uv in the plugin project and returns the validated timing.json', async () => {
  const { run, audio, calls, opts, deps } = setup(GOOD);
  const out = await ctcOnnx(deps).align(audio, lines, { 'MCP.': ['EM', 'SEE', 'PEE'] });
  expect(out).toBe(path.join(run, 'data', 'timing.json'));
  const cmd = calls[0] ?? [];
  expect(cmd.slice(0, 7)).toEqual(['uv', 'run', '--frozen', '--no-dev', '--project', deps.config.pluginRoot, 'python']);
  expect(cmd[7]).toBe(path.join(deps.config.pluginRoot, 'lib', 'adapters', 'align', 'ctc-onnx', 'align.py'));
  expect(cmd[8]).toBe(audio);
  expect(cmd[10]).toBe(run);
  expect(cmd[11]).toBe(alignerModel(deps.config.vmHome).path);
  expect(opts[0]?.env).toBe(deps.config.toolEnv);
});

test('align hands align.py a spec with the line texts and spoken words', async () => {
  const { audio, deps } = setup(GOOD);
  let spec: unknown;
  const inner = deps.sh;
  deps.sh = async (cmd, o) => {
    spec = JSON.parse(readFileSync(cmd[9] ?? '', 'utf8'));
    return inner(cmd, o);
  };
  await ctcOnnx(deps).align(audio, lines, { 'MCP.': ['EM', 'SEE', 'PEE'] });
  expect(spec).toEqual({ lines: [{ text: 'Ship faster.' }], spoken_words: { 'MCP.': ['EM', 'SEE', 'PEE'] } });
});

test('align removes the spec folder after a success', async () => {
  const { audio, calls, deps } = setup(GOOD);
  await ctcOnnx(deps).align(audio, lines);
  expect(existsSync(path.dirname(calls[0]?.[9] ?? ''))).toBe(false);
});

test('align removes the spec folder after a failure', async () => {
  const { audio, calls, deps } = setup('{"lines": 3}');
  await ctcOnnx(deps)
    .align(audio, lines)
    .catch(() => {});
  const specDir = path.dirname(calls[0]?.[9] ?? '');
  expect(specDir).not.toBe('.');
  expect(existsSync(specDir)).toBe(false);
});

test('align refuses to start without the aligner model and says to run setup', async () => {
  const { audio, calls, deps } = setup(GOOD, undefined, { model: false });
  const err = await ctcOnnx(deps)
    .align(audio, lines)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).message).toContain(alignerModel(deps.config.vmHome).path);
  expect((err as Error).message).toContain('setup');
  expect(calls).toHaveLength(0);
});

test('the aligner model is the pinned Xenova wav2vec2-base-960h quantized ONNX under vmHome/models', () => {
  const m = alignerModel(path.join('vm'));
  expect(m.path).toBe(path.join('vm', 'models', 'w2v2_base_960h_q.onnx'));
  expect(m.url).toBe(
    'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/a19f851b3d42865797e410752b4c570c871e4825/onnx/model_quantized.onnx',
  );
  expect(m.sha256).toBe('cd5040c147381580ed73258143dd8e0c28e800a09e74ee42ee2b3e8cb4d760a3');
  expect(m.bytes).toBe(95_286_046);
});

test('align refuses to run without script lines', async () => {
  const { audio, calls, deps } = setup(GOOD);
  await expect(ctcOnnx(deps).align(audio, [])).rejects.toBeInstanceOf(UnsupportedError);
  expect(calls).toHaveLength(0);
});

test('align refuses to run when every script line is blank', async () => {
  const { audio, calls, deps } = setup(GOOD);
  const blank = [{ id: 'l1', text: '  ', delivery: 'voiceover' as const }];
  await expect(ctcOnnx(deps).align(audio, blank)).rejects.toBeInstanceOf(UnsupportedError);
  expect(calls).toHaveLength(0);
});

test('align names the audio file when it does not exist, before running anything', async () => {
  const { run, calls, deps } = setup(GOOD);
  const missing = path.join(run, 'audio', 'nope.wav');
  const e = await ctcOnnx(deps)
    .align(missing, lines)
    .catch((x: unknown) => x);
  expect(e).toBeInstanceOf(VideoMachineError);
  expect((e as Error).message).toContain(`audio not found: ${missing}`);
  expect(calls).toHaveLength(0);
});

test('align names the path when the audio is a folder, before running anything', async () => {
  const { run, calls, deps } = setup(GOOD);
  const dir = path.join(run, 'audio', 'sub');
  mkdirSync(dir);
  const e = await ctcOnnx(deps)
    .align(dir, lines)
    .catch((x: unknown) => x);
  expect(e).toBeInstanceOf(VideoMachineError);
  expect((e as Error).message).toContain(`not a file: ${dir}`);
  expect(calls).toHaveLength(0);
});

test('align names the audio file when it is empty, before running anything', async () => {
  const { audio, calls, deps } = setup(GOOD);
  writeFileSync(audio, '');
  const e = await ctcOnnx(deps)
    .align(audio, lines)
    .catch((x: unknown) => x);
  expect(e).toBeInstanceOf(VideoMachineError);
  expect((e as Error).message).toContain(`audio is empty: ${audio}`);
  expect(calls).toHaveLength(0);
});

test('align refuses audio that is not inside an audio folder, before running anything', async () => {
  const { run, calls, deps } = setup(GOOD);
  const outside = path.join(run, 'vo.wav');
  writeFileSync(outside, 'RIFF');
  const e = await ctcOnnx(deps)
    .align(outside, lines)
    .catch((x: unknown) => x);
  expect(e).toBeInstanceOf(VideoMachineError);
  expect((e as Error).message).toContain(outside);
  expect(calls).toHaveLength(0);
});

test('align never returns a stale timing.json left by an earlier run', async () => {
  const { run, audio, deps } = setup(null);
  mkdirSync(path.join(run, 'data'));
  writeFileSync(path.join(run, 'data', 'timing.json'), GOOD);
  await expect(ctcOnnx(deps).align(audio, lines)).rejects.toThrow();
  expect(existsSync(path.join(run, 'data', 'timing.json'))).toBe(false);
});

test('after a failed align neither timing.json nor audio.json exists', async () => {
  for (const [timing, fail] of [
    [GOOD, new ToolError({ cmd: ['uv'], code: 1, stderr: 'boom' })],
    ['{"lines": 3}', undefined],
  ] as const) {
    const { run, audio, deps } = setup(timing, fail);
    mkdirSync(path.join(run, 'data'));
    writeFileSync(path.join(run, 'data', 'audio.json'), '{}');
    await ctcOnnx(deps)
      .align(audio, lines)
      .catch(() => {});
    expect(existsSync(path.join(run, 'data', 'timing.json'))).toBe(false);
    expect(existsSync(path.join(run, 'data', 'audio.json'))).toBe(false);
  }
});

test('align removes a stale audio.json before running align.py', async () => {
  const { run, audio, deps } = setup(GOOD);
  mkdirSync(path.join(run, 'data'));
  writeFileSync(path.join(run, 'data', 'audio.json'), '{}');
  await ctcOnnx(deps).align(audio, lines);
  expect(existsSync(path.join(run, 'data', 'audio.json'))).toBe(false);
});

test('align passes a ToolError from the runner through unchanged', async () => {
  const failure = new ToolError({ cmd: ['uv'], code: 1, stderr: 'boom' });
  const { audio, deps } = setup(GOOD, failure);
  await expect(ctcOnnx(deps).align(audio, lines)).rejects.toBe(failure);
});

test('align fails with a ContractError when align.py writes an invalid timing.json', async () => {
  const { audio, deps } = setup('{"lines": 3}');
  await expect(ctcOnnx(deps).align(audio, lines)).rejects.toBeInstanceOf(ContractError);
});
