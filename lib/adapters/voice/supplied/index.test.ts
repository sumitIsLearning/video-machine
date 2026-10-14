import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import { importSupplied } from './index';

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A fresh run folder with sources/voice.m4a in it. */
const makeRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(run);
  mkdirSync(path.join(run, 'sources'));
  writeFileSync(path.join(run, 'sources', 'voice.m4a'), 'M4A');
  return run;
};

/** A fake sh: ffmpeg writes `WAV` to its last argument, or throws `fail` when given. Records every command. */
const fake = (fail?: ToolError) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin' }),
    sh: async (cmd) => {
      calls.push(cmd);
      if (fail) throw fail;
      writeFileSync(cmd.at(-1) ?? '', 'WAV');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { calls, deps };
};

/** The error a promise rejects with, or undefined when it resolves. */
const errorOf = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

test('imports sources/voice.m4a as 48 kHz mono audio/vo.wav', async () => {
  const run = makeRun();
  const { calls, deps } = fake();
  const out = await importSupplied(deps, run, 'sources/voice.m4a');
  expect(out).toBe(path.join(run, 'audio', 'vo.wav'));
  expect(existsSync(out)).toBe(true);
  expect(calls[0]).toEqual([
    'ffmpeg',
    '-v',
    'error',
    '-y',
    '-i',
    path.join(run, 'sources', 'voice.m4a'),
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    path.join(run, 'audio', 'vo.part.wav'),
  ]);
});

test('removes stale timing first', async () => {
  const run = makeRun();
  mkdirSync(path.join(run, 'data'));
  const timing = path.join(run, 'data', 'timing.json');
  const audio = path.join(run, 'data', 'audio.json');
  writeFileSync(timing, '{}');
  writeFileSync(audio, '{}');
  await importSupplied(fake().deps, run, 'sources/voice.m4a');
  expect(existsSync(timing)).toBe(false);
  expect(existsSync(audio)).toBe(false);
});

test('a path outside the run is refused (runFileOf)', async () => {
  const run = makeRun();
  const err = await errorOf(importSupplied(fake().deps, run, '../outside.m4a'));
  expect(err).toBeInstanceOf(InputError);
});

test('audio/vo.wav itself as the source is an InputError', async () => {
  const run = makeRun();
  mkdirSync(path.join(run, 'audio'));
  writeFileSync(path.join(run, 'audio', 'vo.wav'), 'WAV');
  const err = await errorOf(importSupplied(fake().deps, run, 'audio/vo.wav'));
  expect(err).toBeInstanceOf(InputError);
  expect((err as Error).message).toContain('the supplied voice must not be audio/vo.wav');
});

test('an ffmpeg failure names the supplied file and leaves no vo.wav', async () => {
  const run = makeRun();
  const { deps } = fake(new ToolError({ cmd: ['ffmpeg'], code: 1, stderr: 'Invalid data found' }));
  const err = await errorOf(importSupplied(deps, run, 'sources/voice.m4a'));
  expect(err).toBeInstanceOf(ToolError);
  expect((err as Error).message).toContain('could not read the supplied voice sources/voice.m4a: ');
  expect(existsSync(path.join(run, 'audio', 'vo.wav'))).toBe(false);
});
