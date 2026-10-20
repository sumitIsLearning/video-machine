import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AvatarPlacementSchema, AvatarSegmentsSchema, ScriptSchema, TimingSchema } from '../contracts/types';
import { avatarBoxes, avatarBoxesOf, avatarSegments, presetBox } from './avatar';
import { InputError } from './errors';
import { writeJson } from './json';

const line = (id: string, delivery: 'voiceover' | 'avatar') => ({ id, text: `Line ${id}.`, delivery });
const script = ScriptSchema.parse({
  run_id: 'r',
  version: 1,
  lines: [
    line('l1', 'voiceover'),
    line('l2', 'avatar'),
    line('l3', 'avatar'),
    line('l4', 'voiceover'),
    line('l5', 'avatar'),
  ],
});
const timed = (id: string, start: number, end: number) => ({ id, text: `Line ${id}.`, start, end, words: [] });
const timing = TimingSchema.parse({
  lines: [
    timed('l1', 0.2, 1.1),
    timed('l2', 1.35, 2.5),
    timed('l3', 2.75, 4.0004),
    timed('l4', 4.25, 5),
    timed('l5', 5.25, 6.5),
  ],
});

test('avatarSegments groups consecutive avatar lines and times them from timing.json', () => {
  expect(avatarSegments(script, timing)).toEqual([
    { seg: 'a01', line_ids: ['l2', 'l3'], start: 1.35, end: 4 },
    { seg: 'a02', line_ids: ['l5'], start: 5.25, end: 6.5 },
  ]);
  const none = ScriptSchema.parse({ run_id: 'r', version: 1, lines: [line('l1', 'voiceover')] });
  expect(avatarSegments(none, timing)).toEqual([]);
  const missing = TimingSchema.parse({ lines: [timed('l1', 0, 1)] });
  expect(() => avatarSegments(script, missing)).toThrow(InputError);
});

test('presetBox places each preset inside the safe area', () => {
  expect(presetBox('corner-br', 'reel')).toEqual({ x: 684, y: 807, w: 331, h: 441, fit: 'right bottom' });
  expect(presetBox('corner-bl', 'reel')).toEqual({ x: 65, y: 807, w: 331, h: 441, fit: 'left bottom' });
  expect(presetBox('bottom', 'reel')).toEqual({ x: 65, y: 807, w: 950, h: 441, fit: 'center bottom' });
  expect(presetBox('full', 'reel')).toEqual({ x: 65, y: 269, w: 950, h: 979, fit: 'center bottom' });
  expect(presetBox('corner-br', 'landscape_1080p')).toEqual({ x: 1496, y: 589, w: 328, h: 437, fit: 'right bottom' });
});

const segments = AvatarSegmentsSchema.parse({
  run_id: 'r',
  adapter: 'supplied',
  segments: [
    { seg: 'a01', line_ids: ['l2', 'l3'], start: 1.35, end: 4, file: 'avatar/a01.webm' },
    { seg: 'a02', line_ids: ['l5'], start: 5.25, end: 6.5, file: 'avatar/a02.webm' },
  ],
});

test('avatarBoxes joins each segment with its preset box and refuses a gap or an unknown segment', () => {
  const placement = AvatarPlacementSchema.parse({ segments: { a01: 'corner-br', a02: 'full' } });
  expect(avatarBoxes(segments, placement, 'reel')).toEqual([
    { seg: 'a01', start: 1.35, end: 4, x: 684, y: 807, w: 331, h: 441, fit: 'right bottom' },
    { seg: 'a02', start: 5.25, end: 6.5, x: 65, y: 269, w: 950, h: 979, fit: 'center bottom' },
  ]);
  expect(() => avatarBoxes(segments, { segments: { a01: 'full' } }, 'reel')).toThrow(/a02/);
  expect(() => avatarBoxes(segments, { segments: { a01: 'full', a02: 'full', a09: 'full' } }, 'reel')).toThrow(/a09/);
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('avatarBoxesOf reads the run: none without segments, InputError without a placement', () => {
  const run = mkdtempSync(path.join(tmpdir(), 'vm-avatar-'));
  dirs.push(run);
  expect(avatarBoxesOf(run, 'reel')).toEqual([]);
  mkdirSync(path.join(run, 'avatar'));
  writeJson(path.join(run, 'avatar', 'segments.json'), AvatarSegmentsSchema, segments);
  expect(() => avatarBoxesOf(run, 'reel')).toThrow(InputError);
  writeJson(path.join(run, 'avatar', 'placement.json'), AvatarPlacementSchema, {
    segments: { a01: 'bottom', a02: 'bottom' },
  });
  expect(avatarBoxesOf(run, 'reel').map((b) => b.seg)).toEqual(['a01', 'a02']);
});
