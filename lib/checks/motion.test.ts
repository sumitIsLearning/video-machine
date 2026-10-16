import { expect, test } from 'bun:test';
import type { SceneTime } from '../core/scene-times';
import { checkBeatsOnCues, checkDeadSpans, MOTION_THRESHOLD } from './motion';

const fps = 30;
const scene = (scene_id: string, start: number, duration: number, beats: SceneTime['beats']): SceneTime => ({
  scene_id,
  start,
  duration,
  lines: [],
  beats,
  words: [],
});
// 140 frames: change on 0-14 and 60-75. Still 15-59 = 45 frames = 1.5 s (not over: passes);
// still 76-139 = 64 frames (fails; starts at 76/30 = 2.533 s, inside demo). Frame 20 is an encoder blip of 5.
const diffs = Array.from({ length: 140 }, (_, i) => (i < 15 || (i >= 60 && i <= 75) ? 40 : i === 20 ? 5 : 0));
const scenes = (holdDemo: boolean) => [
  scene('hook', 0, 2, []),
  scene('demo', 2, 2.667, holdDemo ? [{ on: 'y', nth: 0, t: 0.4, hold: true }] : []),
];

test('threshold is 8', () => expect(MOTION_THRESHOLD).toBe(8));
test('a still span over 1.5 s fails naming its scene and start', () => {
  const r = checkDeadSpans(diffs, fps, scenes(false));
  expect(r).toMatchObject({ id: 'motion.no_dead_spans', blocking: true, status: 'fail' });
  expect(r.annotations).toEqual([expect.objectContaining({ scene_id: 'demo', t: 2.533 })]);
});
test('a span that follows a hold beat is excused', () => {
  expect(checkDeadSpans(diffs, fps, scenes(true)).status).toBe('pass');
});
test('a beat is on cue when a frame within ±2 changes', () => {
  const ok = checkBeatsOnCues(diffs, fps, [scene('demo', 2, 2.667, [{ on: 'site', nth: 0, t: 0.03, hold: false }])]); // frame 61
  expect(ok.status).toBe('pass');
  const bad = checkBeatsOnCues(diffs, fps, [scene('hook', 0, 2, [{ on: 'today', nth: 0, t: 1.2, hold: false }])]); // frame 36
  expect(bad).toMatchObject({ id: 'timing.beats_on_cues', status: 'fail' });
  expect(bad.annotations[0]).toMatchObject({ scene_id: 'hook', t: 1.2 });
  expect(bad.annotations[0]?.problem).toMatch(/today/);
});
