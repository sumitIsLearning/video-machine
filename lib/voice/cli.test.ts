import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema, ScriptSchema, SpendLogSchema, TimingSchema, type VoiceAdapter } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { main } from './cli';

const runs: string[] = [];
afterEach(() => {
  for (const r of runs.splice(0)) rmSync(r, { recursive: true, force: true });
});

const USAGE = 'usage: cli.ts synth <run_dir> [--approve-spend usd] | align <run_dir>';
const LINES = [
  { id: 'l1', text: 'One.', delivery: 'voiceover' as const },
  { id: 'l2', text: '5.5 points.', spoken: 'Five point five points.', delivery: 'voiceover' as const },
];

/** A fresh run folder with brief.json and script.json written through the schemas. */
const makeRun = (brief: Partial<Record<string, unknown>> = {}, lines = LINES): string => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  runs.push(run);
  writeJson(path.join(run, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [15, 30],
    timing_source: 'voiceover',
    ...brief,
  });
  writeJson(path.join(run, 'script.json'), ScriptSchema, { run_id: 'r', version: 1, lines });
  return run;
};

const argAfter = (cmd: string[], flag: string): string => cmd[cmd.indexOf(flag) + 1] ?? '';

/** A fake sh: tts writes its text to `-o`, ffmpeg writes `WAV` to its last argument. Records every command. */
const fakeDeps = () => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin' }),
    sh: async (cmd) => {
      calls.push(cmd);
      if (cmd[0] === 'ffmpeg') {
        writeFileSync(cmd.at(-1) ?? '', 'WAV');
        return { code: 0, stdout: '', stderr: '' };
      }
      writeFileSync(argAfter(cmd, '-o'), 'TTS');
      return { code: 0, stdout: '{"ok":true}', stderr: '' };
    },
  };
  return { deps, calls };
};

test('synth with the default voice calls hf-tts and returns the vo path and line count', async () => {
  const run = makeRun();
  const { deps, calls } = fakeDeps();
  const result = await main(['synth', run], { deps });
  expect(result).toEqual({ vo: 'audio/vo.wav', source: 'tts', voice: 'af_heart', lines: 2, usd: 0 });
  expect(calls.filter((c) => c.includes('tts')).map((c) => argAfter(c, '-v'))).toEqual(['af_heart', 'af_heart']);
  expect(existsSync(path.join(run, 'audio', 'vo.wav'))).toBe(true);
});

test('synth with a supplied voice imports it', async () => {
  const run = makeRun({ voice: { source: 'supplied', path: 'sources/voice.wav' } });
  mkdirSync(path.join(run, 'sources'));
  writeFileSync(path.join(run, 'sources', 'voice.wav'), 'SUPPLIED');
  const { deps } = fakeDeps();
  expect(await main(['synth', run], { deps })).toEqual({ vo: 'audio/vo.wav', source: 'supplied' });
  expect(existsSync(path.join(run, 'audio', 'vo.wav'))).toBe(true);
});

test('synth refuses a run without a voiceover', async () => {
  const run = makeRun({ timing_source: 'text_only' });
  await expect(main(['synth', run], { deps: fakeDeps().deps })).rejects.toThrow(
    'this run has no voiceover (timing_source: text_only)',
  );
});

test('synth refuses an unknown voice adapter', async () => {
  const run = makeRun({ voice: { source: 'tts', adapter: 'elevenlabs', voice_id: 'x' } });
  await expect(main(['synth', run], { deps: fakeDeps().deps })).rejects.toThrow(
    'voice adapter "elevenlabs" is not available; use hf-tts',
  );
  await expect(main(['synth', run], { deps: fakeDeps().deps })).rejects.toBeInstanceOf(UnsupportedError);
});

test('synth over budget refuses with the amount and --approve-spend; the flag lets it through', async () => {
  const run = makeRun();
  let synthed = 0;
  const voice: VoiceAdapter = {
    costEstimate: () => 1.5,
    synth: async () => {
      synthed++;
      return path.join(run, 'audio', 'vo.wav');
    },
  };
  const deps = fakeDeps().deps;
  await expect(main(['synth', run], { deps, voice })).rejects.toThrow('$1.50');
  await expect(main(['synth', run], { deps, voice })).rejects.toThrow('--approve-spend 1.5');
  expect(synthed).toBe(0);
  expect(await main(['synth', run, '--approve-spend', '1.5'], { deps, voice })).toEqual({
    vo: 'audio/vo.wav',
    source: 'tts',
    voice: 'af_heart',
    lines: 2,
    usd: 1.5,
  });
  expect(synthed).toBe(1);
});

test('synth refuses when the run has already spent enough to break the budget', async () => {
  const run = makeRun({ budget_usd: 5 });
  writeJson(path.join(run, 'spend.json'), SpendLogSchema, [{ what: 'avatar a01 (heygen)', usd: 4.5 }]);
  let synthed = 0;
  const voice: VoiceAdapter = {
    costEstimate: () => 1,
    synth: async () => {
      synthed++;
      return path.join(run, 'audio', 'vo.wav');
    },
  };
  await expect(main(['synth', run], { deps: fakeDeps().deps, voice })).rejects.toThrow('$4.50 is already spent');
  expect(synthed).toBe(0);
});

test('a paid synth appends its cost to spend.json', async () => {
  const run = makeRun({ budget_usd: 5 });
  const voice: VoiceAdapter = {
    costEstimate: () => 1.5,
    synth: async () => path.join(run, 'audio', 'vo.wav'),
  };
  await main(['synth', run, '--approve-spend', '1.5'], { deps: fakeDeps().deps, voice });
  expect(readJson(path.join(run, 'spend.json'), SpendLogSchema)).toEqual([{ what: 'voice (hf-tts)', usd: 1.5 }]);
});

test('--approve-spend must be a number', async () => {
  const run = makeRun();
  await expect(main(['synth', run, '--approve-spend', 'lots'], { deps: fakeDeps().deps })).rejects.toThrow(
    '--approve-spend must be a number',
  );
});

test('align passes the spoken map and returns per-line times, total and fit', async () => {
  const run = makeRun({ duration_target_s: [15, 30] }, [
    { id: 'l1', text: 'Up 5.5% today.', spoken: 'Up five point five percent today.', delivery: 'voiceover' },
    { id: 'l2', text: 'Hi.', delivery: 'voiceover' },
  ]);
  mkdirSync(path.join(run, 'audio'));
  writeFileSync(path.join(run, 'audio', 'vo.wav'), 'WAV');
  let spokenSeen: Record<string, string[]> | undefined;
  const align = {
    align: async (_audio: string, _lines: unknown, spoken?: Record<string, string[]>) => {
      spokenSeen = spoken;
      const timing = path.join(run, 'data', 'timing.json');
      writeJson(timing, TimingSchema, {
        lines: [
          {
            id: 'l1',
            text: 'Up 5.5% today.',
            start: 0,
            end: 4,
            words: [
              { w: 'Up', start: 0, end: 1, conf: 0.8 },
              { w: '5.5%', start: 1, end: 3, conf: 0.9 },
            ],
          },
          { id: 'l2', text: 'Hi.', start: 4, end: 9, words: [] },
        ],
      });
      return timing;
    },
  };
  expect(await main(['align', run], { align })).toEqual({
    timing: 'data/timing.json',
    lines: [
      { id: 'l1', start: 0, end: 4, conf: 0.85 },
      { id: 'l2', start: 4, end: 9, conf: null },
    ],
    total_s: 9,
    target_s: [15, 30],
    fits: false,
  });
  expect(spokenSeen).toEqual({ '5.5%': ['FIVE', 'POINT', 'FIVE', 'PERCENT'] });
});

test('align without audio/vo.wav says to run synth first', async () => {
  const run = makeRun();
  await expect(main(['align', run])).rejects.toThrow('no audio/vo.wav yet; run synth first');
});

test('usage errors', async () => {
  const run = makeRun();
  await expect(main([])).rejects.toThrow(USAGE);
  await expect(main(['synth'])).rejects.toThrow(USAGE);
  await expect(main(['bogus', run])).rejects.toThrow(USAGE);
  await expect(main(['align', run, 'extra'])).rejects.toThrow(USAGE);
  await expect(main(['synth', run, '--nope'])).rejects.toThrow(USAGE);
  await expect(main(['synth', run, '--approve-spend'])).rejects.toBeInstanceOf(InputError);
});
