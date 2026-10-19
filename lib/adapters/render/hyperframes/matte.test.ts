import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ToolError } from '../../../core/errors';
import type { Sh } from '../../../core/sh';
import { removeBackground } from './matte';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-matte-'));
  dirs.push(d);
  return d;
};
const depsWith = (sh: Sh): Deps => ({ sh, config: loadConfig({}) });

test('removeBackground runs remove-background to the output and returns it', async () => {
  const d = tmp();
  const calls: string[][] = [];
  const sh: Sh = async (cmd) => {
    calls.push(cmd);
    const out = cmd[cmd.indexOf('-o') + 1] ?? '';
    writeFileSync(out, 'webm');
    return {
      code: 0,
      stdout: `installing onnxruntime-node for background removal, once\n{"ok":true,"outputPath":"${out}","framesProcessed":60}\n`,
      stderr: '',
    };
  };
  const out = path.join(d, 'a01.webm');
  expect(await removeBackground(depsWith(sh), path.join(d, 'a01.mp4'), out)).toBe(out);
  expect(calls[0]?.slice(-9)).toEqual([
    'remove-background',
    path.join(d, 'a01.mp4'),
    '-o',
    out,
    '--device',
    'auto',
    '--quality',
    'balanced',
    '--json',
  ]);
  expect(existsSync(out)).toBe(true);
});

test('removeBackground throws ToolError on a failed reply and leaves no output', async () => {
  const d = tmp();
  const out = path.join(d, 'a01.webm');
  const sh: Sh = async (cmd) => {
    writeFileSync(cmd[cmd.indexOf('-o') + 1] ?? '', 'half');
    return { code: 1, stdout: '{"ok":false,"error":"no frames"}\n', stderr: 'boom' };
  };
  await expect(removeBackground(depsWith(sh), path.join(d, 'a01.mp4'), out)).rejects.toThrow(ToolError);
  expect(existsSync(out)).toBe(false);
});

test('removeBackground leaves no output when the runner throws ToolError', async () => {
  const d = tmp();
  const out = path.join(d, 'a01.webm');
  const sh: Sh = async (cmd) => {
    writeFileSync(cmd[cmd.indexOf('-o') + 1] ?? '', 'half');
    throw new ToolError({ cmd, code: null, stderr: 'timed out', timedOut: true });
  };
  await expect(removeBackground(depsWith(sh), path.join(d, 'a01.mp4'), out)).rejects.toThrow(ToolError);
  expect(existsSync(out)).toBe(false);
});

test('removeBackground ignores a stale output the tool did not write', async () => {
  const d = tmp();
  const out = path.join(d, 'a01.webm');
  writeFileSync(out, 'stale');
  const sh: Sh = async () => ({ code: 0, stdout: '{"ok":true}\n', stderr: '' });
  await expect(removeBackground(depsWith(sh), path.join(d, 'a01.mp4'), out)).rejects.toThrow(ToolError);
  expect(existsSync(out)).toBe(false);
});
