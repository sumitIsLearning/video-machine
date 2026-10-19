import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AvatarAdapter,
  AvatarSegmentsSchema,
  BriefSchema,
  ScriptSchema,
  SpendLogSchema,
  TimingSchema,
} from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import type { Sh } from '../core/sh';
import { makeAvatar } from './make';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const BRIEF = {
  run_id: 'r',
  concept: 'c',
  goals: [],
  duration_target_s: [5, 12] as [number, number],
  timing_source: 'voiceover' as const,
};
const line = (id: string, delivery: 'voiceover' | 'avatar') => ({ id, text: `Line ${id}.`, delivery });
const timed = (id: string, start: number, end: number) => ({ id, text: `Line ${id}.`, start, end, words: [] });

const run = (brief: Record<string, unknown> = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-m11-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'audio'));
  mkdirSync(path.join(dir, 'data'));
  writeFileSync(path.join(dir, 'audio', 'vo.wav'), 'wav');
  writeJson(path.join(dir, 'brief.json'), BriefSchema, {
    ...BRIEF,
    avatar: { source: 'adapter', adapter: 'fake', portrait: 'input/me.png' },
    ...brief,
  });
  writeJson(path.join(dir, 'script.json'), ScriptSchema, {
    run_id: 'r',
    version: 1,
    lines: [line('l1', 'voiceover'), line('l2', 'avatar'), line('l3', 'avatar')],
  });
  writeJson(path.join(dir, 'data', 'timing.json'), TimingSchema, {
    lines: [timed('l1', 0.2, 1.1), timed('l2', 1.35, 2.5), timed('l3', 2.75, 4)],
  });
  return dir;
};

/** ffmpeg and remove-background write their output; every command is recorded. */
const fakeDeps = (calls: string[][]): Deps => {
  const sh: Sh = async (cmd) => {
    calls.push(cmd);
    const o = cmd.indexOf('-o');
    writeFileSync(o === -1 ? (cmd.at(-1) ?? '') : (cmd[o + 1] ?? ''), 'x');
    return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
  };
  return { sh, config: loadConfig({}) };
};
const fakeAdapter = (usdPerS: number, made: string[]): AvatarAdapter => ({
  name: 'fake',
  costEstimate: (s) => Math.round(s * usdPerS * 100) / 100,
  make: async (job, out) => {
    made.push(job.seg);
    expect(existsSync(job.audio)).toBe(true);
    writeFileSync(out, 'raw');
    return out;
  },
});

test('makeAvatar cuts each segment, makes it, mattes it and writes avatar/ in one step', async () => {
  const dir = run();
  const calls: string[][] = [];
  const made: string[] = [];
  const res = await makeAvatar(dir, { deps: fakeDeps(calls), adapter: fakeAdapter(0, made) });
  expect(res).toEqual({
    adapter: 'fake',
    usd: 0,
    segments: [{ seg: 'a01', line_ids: ['l2', 'l3'], start: 1.35, end: 4, file: 'avatar/a01.webm' }],
  });
  expect(made).toEqual(['a01']);
  expect(readdirSync(path.join(dir, 'avatar')).sort()).toEqual(['a01.webm', 'segments.json']);
  expect(readJson(path.join(dir, 'avatar', 'segments.json'), AvatarSegmentsSchema).segments).toEqual(res.segments);
  expect(existsSync(path.join(dir, 'avatar.tmp'))).toBe(false);
  const cut = calls.find((c) => c[0] === 'ffmpeg') ?? [];
  expect(cut.slice(cut.indexOf('-ss'), cut.indexOf('-ss') + 4)).toEqual(['-ss', '1.350', '-to', '4.000']);
  expect(calls.some((c) => c.includes('remove-background'))).toBe(true);
});

test('makeAvatar refuses an over-budget adapter before making anything', async () => {
  const dir = run();
  const made: string[] = [];
  await expect(makeAvatar(dir, { deps: fakeDeps([]), adapter: fakeAdapter(1, made) })).rejects.toThrow(
    /--approve-spend 2.65/,
  );
  expect(made).toEqual([]);
  expect(existsSync(path.join(dir, 'avatar'))).toBe(false);
  const ok = await makeAvatar(dir, { deps: fakeDeps([]), adapter: fakeAdapter(1, made), approved_usd: 2.65 });
  expect(ok.usd).toBe(2.65);
});

test('makeAvatar refuses when the run has already spent enough to break the budget', async () => {
  const dir = run({ budget_usd: 5 });
  writeJson(path.join(dir, 'spend.json'), SpendLogSchema, [{ what: 'voice (hf-tts)', usd: 4 }]);
  const made: string[] = [];
  await expect(makeAvatar(dir, { deps: fakeDeps([]), adapter: fakeAdapter(1, made) })).rejects.toThrow(
    '$4.00 is already spent',
  );
  expect(made).toEqual([]);
});

test('a paid makeAvatar appends each segment cost to spend.json', async () => {
  const dir = run({ budget_usd: 5 });
  await makeAvatar(dir, { deps: fakeDeps([]), adapter: fakeAdapter(1, []) });
  expect(readJson(path.join(dir, 'spend.json'), SpendLogSchema)).toEqual([{ what: 'avatar a01 (fake)', usd: 2.65 }]);
});

test('a failed make keeps the previous avatar/ and leaves no avatar.tmp', async () => {
  const dir = run();
  mkdirSync(path.join(dir, 'avatar'));
  writeFileSync(path.join(dir, 'avatar', 'placement.json'), '{"segments":{"a01":"full"}}');
  const broken: AvatarAdapter = {
    name: 'fake',
    costEstimate: () => 0,
    make: async () => {
      throw new Error('gpu fell over');
    },
  };
  await expect(makeAvatar(dir, { deps: fakeDeps([]), adapter: broken })).rejects.toThrow('gpu fell over');
  expect(readdirSync(path.join(dir, 'avatar'))).toEqual(['placement.json']);
  expect(existsSync(path.join(dir, 'avatar.tmp'))).toBe(false);
});

test('makeAvatar refuses runs it cannot serve', async () => {
  await expect(makeAvatar(run({ avatar: undefined }), { deps: fakeDeps([]) })).rejects.toThrow(InputError);
  await expect(makeAvatar(run({ timing_source: 'text_only' }), { deps: fakeDeps([]) })).rejects.toThrow(
    UnsupportedError,
  );
  await expect(
    makeAvatar(run({ avatar: { source: 'adapter', adapter: 'sadtalker', portrait: 'input/me.png' } }), {
      deps: fakeDeps([]),
    }),
  ).rejects.toThrow(UnsupportedError);
  await expect(
    makeAvatar(run({ avatar: { source: 'adapter', adapter: 'heygen', portrait: 'input/me.png' } }), {
      deps: fakeDeps([]),
    }),
  ).rejects.toThrow(/HEYGEN_API_KEY/);
});
