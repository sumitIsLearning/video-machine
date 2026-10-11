import { expect, test } from 'bun:test';
import { assetIdOf } from './asset-id';

test('an asset id is pinned to the sha1 of its path, so marks survive a rebuild', () => {
  expect(assetIdOf('found', 'found/x.jpg')).toBe('found-6a354062');
});

test('an asset id is the origin plus 8 hex of sha1(path), stable for the same path', () => {
  expect(assetIdOf('found', 'found/x.jpg')).toMatch(/^found-[0-9a-f]{8}$/);
  expect(assetIdOf('found', 'found/x.jpg')).toBe(assetIdOf('found', 'found/x.jpg'));
  expect(assetIdOf('found', 'found/x.jpg')).not.toBe(assetIdOf('found', 'found/y.jpg'));
});
