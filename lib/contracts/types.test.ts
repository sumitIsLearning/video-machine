import { expect, test } from 'bun:test';
import { frameOf } from './types';

test('frameOf gives the reel frame as vertical 1080x1920 with its safe area', () => {
  expect(frameOf('reel')).toEqual({
    w: 1080,
    h: 1920,
    aspect: 'vertical',
    safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 },
  });
});
