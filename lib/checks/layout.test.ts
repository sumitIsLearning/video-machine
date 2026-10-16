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
