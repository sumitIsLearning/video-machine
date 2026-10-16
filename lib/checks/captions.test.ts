import { expect, test } from 'bun:test';
import { checkCaptions } from './captions';

test('skip when no caption was ever on screen', () => {
  expect(checkCaptions([{ t: 0.4, scene_id: 'hook', word: 'Meet', shown: '' }], false).status).toBe('skip');
});
test('each spoken word must be in the caption on screen at its midpoint', () => {
  const r = checkCaptions(
    [
      { t: 0.35, scene_id: 'hook', word: 'Meet', shown: 'Meet Firecrawl' },
      { t: 0.8, scene_id: 'hook', word: 'Firecrawl,', shown: 'meet firecrawl' },
      { t: 1.3, scene_id: 'hook', word: 'today', shown: 'Meet Firecrawl' },
    ],
    true,
  );
  expect(r).toMatchObject({ id: 'captions.match', blocking: true, status: 'fail' });
  expect(r.annotations).toEqual([
    {
      scene_id: 'hook',
      t: 1.3,
      problem: 'caption shows "Meet Firecrawl" while "today" is spoken',
      suggested_fix: 'show each word in the caption while it is spoken',
    },
  ]);
});
