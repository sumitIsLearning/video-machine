import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Script } from '../../../contracts/types';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import { hfTts, lineKey } from './index';

type Line = Script['lines'][number];

const L1: Line = { id: 'l1', text: 'One.', delivery: 'voiceover' };
const L2: Line = { id: 'l2', text: '5.5 points.', spoken: 'Five point five points.', delivery: 'voiceover' };
const LINES = [L1, L2];
const FAIL_TEXT = 'Five point five points.';

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A fresh temp run folder (no audio/ yet). */
const makeRun = (): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(run);
  return run;
};

const argAfter = (cmd: string[], flag: string): string => cmd[cmd.indexOf(flag) + 1] ?? '';
const ttsCalls = (calls: string[][]): string[][] => calls.filter((c) => c.includes('tts'));
const ffmpegCalls = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'ffmpeg');

/**
 * A fake sh: tts writes `TTS:<text>` to `-o` (or fails for `failText`), ffmpeg writes `WAV` to its last argument.
 * Records every command and the text of every tts call.
 */
const fake = (failText?: string) => {
  const calls: string[][] = [];
  const texts: string[] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin' }),
    sh: async (cmd) => {
      calls.push(cmd);
      if (cmd[0] === 'ffmpeg') {
        writeFileSync(cmd.at(-1) ?? '', 'WAV');
        return { code: 0, stdout: '', stderr: '' };
      }
      const text = readFileSync(argAfter(cmd, '--text-file'), 'utf8');
      texts.push(text);
      if (text === failText)
        return {
          code: 1,
          stdout: '{"ok":false,"error":"Speech synthesis failed\\nValueError: Voice zz not found"}',
          stderr: '',
        };
      writeFileSync(argAfter(cmd, '-o'), `TTS:${text}`);
      return { code: 0, stdout: '{"ok":true,"durationSeconds":1}', stderr: '' };
    },
  };
  return { calls, texts, deps };
};

/** The error a promise rejects with, or undefined when it resolves. */
const errorOf = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

test('synth voices each line once, joins them and returns audio/vo.wav', async () => {
  const run = makeRun();
  const { calls, texts, deps } = fake();
  const out = await hfTts(deps).synth(run, LINES, 'af_heart');
  expect(out).toBe(path.join(run, 'audio', 'vo.wav'));
  expect(existsSync(out)).toBe(true);
  expect(ttsCalls(calls)).toHaveLength(2);
  expect(ffmpegCalls(calls)).toHaveLength(1);
  expect(calls.at(-1)?.[0]).toBe('ffmpeg');
  const firstTts = ttsCalls(calls)[0] ?? [];
  expect(firstTts).toEqual(expect.arrayContaining(['--text-file', '-v', 'af_heart', '--json']));
  expect(firstTts).not.toContain('One.');
  expect(texts).toEqual(['One.', 'Five point five points.']);
});

test('the ffmpeg join pads 0.25 s between lines and resamples to 48 kHz mono', async () => {
  const run = makeRun();
  const { calls, deps } = fake();
  await hfTts(deps).synth(run, LINES, 'af_heart');
  const join = ffmpegCalls(calls)[0] ?? [];
  expect(join[join.indexOf('-filter_complex') + 1]).toBe(
    '[0:a]apad=pad_dur=0.25[a0];[1:a]anull[a1];[a0][a1]concat=n=2:v=0:a=1,aresample=48000[o]',
  );
  expect(join).toEqual(expect.arrayContaining(['-ac', '1', '-c:a', 'pcm_s16le']));
});

test('a second synth reuses cached lines; a changed line alone is re-voiced', async () => {
  const run = makeRun();
  await hfTts(fake().deps).synth(run, LINES, 'af_heart');
  const second = fake();
  await hfTts(second.deps).synth(run, [L1, { ...L2, spoken: 'Six point five points.' }], 'af_heart');
  expect(ttsCalls(second.calls)).toHaveLength(1);
});

test('a different voice id is a different cache key', async () => {
  const run = makeRun();
  const { calls, deps } = fake();
  const adapter = hfTts(deps);
  await adapter.synth(run, LINES, 'af_heart');
  await adapter.synth(run, LINES, 'af_bella');
  expect(ttsCalls(calls)).toHaveLength(4);
});

test('unused cached lines are pruned after the join', async () => {
  const run = makeRun();
  const { deps } = fake();
  const adapter = hfTts(deps);
  await adapter.synth(run, LINES, 'af_heart');
  await adapter.synth(run, [L1, { ...L2, spoken: 'Six point five points.' }], 'af_heart');
  const cached = readdirSync(path.join(run, 'audio', 'lines')).filter((f) => f.endsWith('.wav'));
  expect(cached).toHaveLength(2);
  expect(cached).not.toContain(`${lineKey('af_heart', FAIL_TEXT)}.wav`);
});

test('a temp dir left by a killed synth is pruned after the join', async () => {
  const run = makeRun();
  const stale = path.join(run, 'audio', 'lines', '.vm-tts-x');
  mkdirSync(stale, { recursive: true });
  writeFileSync(path.join(stale, 'line.txt'), 'left behind');
  await hfTts(fake().deps).synth(run, LINES, 'af_heart');
  expect(existsSync(stale)).toBe(false);
});

test('a new voice deletes data/timing.json and data/audio.json first', async () => {
  const run = makeRun();
  mkdirSync(path.join(run, 'data'));
  const timing = path.join(run, 'data', 'timing.json');
  const audio = path.join(run, 'data', 'audio.json');
  writeFileSync(timing, '{}');
  writeFileSync(audio, '{}');
  await hfTts(fake().deps).synth(run, LINES, 'af_heart');
  expect(existsSync(timing)).toBe(false);
  expect(existsSync(audio)).toBe(false);
});

test('tts failure names the line and the tool error, leaves no vo.wav', async () => {
  const run = makeRun();
  const { deps } = fake(FAIL_TEXT);
  const err = await errorOf(hfTts(deps).synth(run, LINES, 'af_heart'));
  expect(err).toBeInstanceOf(ToolError);
  expect((err as Error).message).toContain('line "l2"');
  expect((err as Error).message).toContain('Voice zz not found');
  expect(existsSync(path.join(run, 'audio', 'vo.wav'))).toBe(false);
});

test('the tts temp dir sits in audio/lines/ and is gone afterwards', async () => {
  const run = makeRun();
  const { calls, deps } = fake();
  await hfTts(deps).synth(run, LINES, 'af_heart');
  const tmpDir = path.dirname(argAfter(ttsCalls(calls)[0] ?? [], '--text-file'));
  expect(path.dirname(tmpDir)).toBe(path.join(run, 'audio', 'lines'));
  expect(path.basename(tmpDir).startsWith('.vm-tts-')).toBe(true);
  expect(existsSync(tmpDir)).toBe(false);
});

test('tts that reports ok but writes no audio is a ToolError naming the line', async () => {
  const run = makeRun();
  const { deps } = fake();
  const silent: Deps = {
    ...deps,
    sh: async (cmd, opts) =>
      cmd.includes('tts') ? { code: 0, stdout: '{"ok":true,"durationSeconds":1}', stderr: '' } : deps.sh(cmd, opts),
  };
  const err = await errorOf(hfTts(silent).synth(run, LINES, 'af_heart'));
  expect(err).toBeInstanceOf(ToolError);
  expect((err as Error).message).toContain('tts wrote no audio for line "l1"');
  expect(existsSync(path.join(run, 'audio', 'vo.wav'))).toBe(false);
});

test('no lines is an InputError', async () => {
  const run = makeRun();
  const err = await errorOf(hfTts(fake().deps).synth(run, [], 'af_heart'));
  expect(err).toBeInstanceOf(InputError);
  expect((err as Error).message).toBe('hf-tts: no lines to voice');
});

test('costEstimate is 0', () => {
  expect(hfTts(fake().deps).costEstimate(LINES)).toBe(0);
});
