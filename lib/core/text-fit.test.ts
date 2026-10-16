import { expect, test } from 'bun:test';
import { fitPx, minTextPx } from './text-fit';

test('minTextPx is 3.5 % of height on vertical, 2.5 % elsewhere, rounded up', () => {
  expect(minTextPx('reel')).toBe(68); // 1920 * 0.035 = 67.2
  expect(minTextPx('portrait_feed')).toBe(48); // 1350 * 0.035 = 47.25
  expect(minTextPx('landscape_1080p')).toBe(27); // 1080 * 0.025
  expect(minTextPx('square')).toBe(27);
});
test('fitPx finds the largest size that fits', () => {
  expect(fitPx((px) => px <= 93, 40, 200)).toBe(93);
  expect(fitPx(() => true, 40, 200)).toBe(200);
});
test('fitPx returns the minimum when nothing fits', () => {
  expect(fitPx(() => false, 40, 200)).toBe(40);
});
