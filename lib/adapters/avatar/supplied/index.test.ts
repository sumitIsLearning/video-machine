import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import type { Sh } from '../../../core/sh';
import { suppliedAvatar } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-sup-'));
  dirs.push(d);
  return d;
};
const probeOf = (duration: number) =>
  JSON.stringify({
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, r_frame_rate: '30/1' }],
    format: { duration: String(duration) },
  });

/** A fake sh: ffprobe reports `duration`; ffmpeg writes its last argument. */
const fake = (duration: number, calls: string[][]): Deps => {
  const sh: Sh = async (cmd) => {
    calls.push(cmd);
    if (cmd[0] === 'ffprobe') return { code: 0, stdout: probeOf(duration), stderr: '' };
    writeFileSync(cmd.at(-1) ?? '', 'mp4');
    return { code: 0, stdout: '', stderr: '' };
  };
  return { sh, config: loadConfig({}) };
};

test('supplied cuts the segment window out of the clip, without audio, and costs nothing', async () => {
  const d = tmp();
  const calls: string[][] = [];
  const adapter = suppliedAvatar(fake(10, calls), path.join(d, 'me.mp4'));
  const out = path.join(d, 'a01.mp4');
  expect(adapter.name).toBe('supplied');
  expect(adapter.costEstimate(30)).toBe(0);
  expect(await adapter.make({ seg: 'a01', start: 1.35, end: 4, audio: path.join(d, 'a01.wav') }, out)).toBe(out);
  const cut = calls.find((c) => c[0] === 'ffmpeg') ?? [];
  expect(cut.slice(cut.indexOf('-ss'), cut.indexOf('-ss') + 6)).toEqual([
    '-ss',
    '1.350',
    '-to',
    '4.000',
    '-i',
    path.join(d, 'me.mp4'),
  ]);
  expect(cut).toContain('-an');
  expect(existsSync(out)).toBe(true);
});

test('supplied refuses a clip that ends before the segment', async () => {
  const d = tmp();
  const adapter = suppliedAvatar(fake(3, []), path.join(d, 'me.mp4'));
  await expect(adapter.make({ seg: 'a01', start: 1.35, end: 4, audio: '' }, path.join(d, 'a01.mp4'))).rejects.toThrow(
    InputError,
  );
});

test('supplied refuses an unreadable clip with a path hint, not a duration', async () => {
  const d = tmp();
  const sh: Sh = async () => ({ code: 1, stdout: '', stderr: 'no such file' });
  const adapter = suppliedAvatar({ sh, config: loadConfig({}) }, path.join(d, 'me.mp4'));
  const attempt = () => adapter.make({ seg: 'a01', start: 1.35, end: 4, audio: '' }, path.join(d, 'a01.mp4'));
  await expect(attempt()).rejects.toThrow(InputError);
  await expect(attempt()).rejects.toThrow(/cannot read the avatar clip/);
});

test('supplied leaves no output when the ffmpeg cut fails', async () => {
  const d = tmp();
  const out = path.join(d, 'a01.mp4');
  const sh: Sh = async (cmd) => {
    if (cmd[0] === 'ffprobe') return { code: 0, stdout: probeOf(10), stderr: '' };
    writeFileSync(cmd.at(-1) ?? '', 'partial');
    throw new ToolError({ cmd, code: 1, stderr: 'boom' });
  };
  const adapter = suppliedAvatar({ sh, config: loadConfig({}) }, path.join(d, 'me.mp4'));
  await expect(adapter.make({ seg: 'a01', start: 1.35, end: 4, audio: '' }, out)).rejects.toThrow(ToolError);
  expect(existsSync(out)).toBe(false);
  expect(existsSync(`${out}.part.mp4`)).toBe(false);
});
