import { expect, test } from 'bun:test';
import { checkMinTextSize, checkSafeArea, type TextSample } from './layout';

const s = (over: Partial<TextSample>): TextSample => ({
  t: 1,
  scene_id: 'hook',
  text: 'Hi',
  box: { x: 100, y: 800, w: 600, h: 120 },
  font_px: 100,
  caption: false,
  ...over,
});

test('safe area passes inside and fails a box in the reel bottom zone, once per scene and text', () => {
  expect(checkSafeArea([s({})], 'reel').status).toBe('pass');
  const r = checkSafeArea(
    [
      s({ t: 3, scene_id: 'demo', text: 'Tiny', box: { x: 20, y: 1800, w: 900, h: 35 } }),
      s({ t: 3.5, scene_id: 'demo', text: 'Tiny', box: { x: 20, y: 1800, w: 900, h: 35 } }),
    ],
    'reel',
  );
  expect(r).toMatchObject({ id: 'layout.safe_area', format: 'reel', blocking: true, status: 'fail' });
  expect(r.annotations).toHaveLength(1);
  expect(r.annotations[0]).toMatchObject({ scene_id: 'demo', t: 3 });
  expect(r.annotations[0]?.problem).toMatch(/Tiny.*bottom/);
});
test('safe area allows 2 px', () => {
  expect(checkSafeArea([s({ box: { x: 63, y: 800, w: 600, h: 100 } })], 'reel').status).toBe('pass'); // left edge 64.8
});
test('min text size fails under 3.5 % on reel (blocking) and 2.5 % on landscape (not blocking)', () => {
  const r = checkMinTextSize([s({ font_px: 30, text: 'Tiny' })], 'reel');
  expect(r).toMatchObject({ id: 'layout.min_text_size', blocking: true, status: 'fail' });
  expect(r.annotations[0]?.problem).toMatch(/Tiny.*30 px.*68 px/);
  expect(checkMinTextSize([s({ font_px: 26 })], 'landscape_1080p')).toMatchObject({ blocking: false, status: 'fail' });
  expect(checkMinTextSize([s({ font_px: 68 })], 'reel').status).toBe('pass');
});
test('no samples is a skip, not a pass', () => {
  expect(checkSafeArea([], 'reel').status).toBe('skip');
});
const box = { seg: 'a01', start: 2, end: 4, x: 587, y: 966, w: 428, h: 570, fit: 'right bottom', cover: false };
const sample = (t: number, x: number, y: number, text = 'Ship it') => ({
  t,
  scene_id: 's1',
  text,
  box: { x, y, w: 300, h: 80 },
  font_px: 80,
  caption: false,
});

test('layout.safe_area fails text under an avatar box only while the segment is on', () => {
  const under = sample(3, 600, 1000);
  const r = checkSafeArea([under, sample(1, 600, 1000, 'Before'), sample(4, 600, 1000, 'After')], 'reel', [box]);
  expect(r.status).toBe('fail');
  expect(r.annotations).toEqual([
    {
      scene_id: 's1',
      t: 3,
      problem: '"Ship it" sits under the avatar (a01)',
      suggested_fix: 'move the text inside var(--vm-safe-*)',
    },
  ]);
});

test('layout.safe_area allows text that only touches the avatar box within 2 px', () => {
  const beside = sample(3, 587 - 300 + 2, 1000); // right edge 2 px into the box
  expect(checkSafeArea([beside], 'reel', [box]).status).toBe('pass');
  expect(checkSafeArea([sample(3, 600, 1000)], 'reel').status).toBe('pass');
});
