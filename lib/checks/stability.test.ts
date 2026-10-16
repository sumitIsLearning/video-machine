import { expect, test } from 'bun:test';
import { checkDeterministic, checkSeekSafe, sampleTimes } from './stability';

test('sampleTimes is seeded: same run id, same times; inside (0, total)', () => {
  const a = sampleTimes('run-a', 20, 5);
  expect(a).toEqual(sampleTimes('run-a', 20, 5));
  expect(a).not.toEqual(sampleTimes('run-b', 20, 5));
  expect(a.every((t) => t > 0 && t < 20)).toBe(true);
  expect(a).toEqual([...a].sort((x, y) => x - y));
});
test('deterministic and seek-safe compare hashes per time', () => {
  expect(checkDeterministic([1, 2], ['a', 'b'], ['a', 'b']).status).toBe('pass');
  const r = checkDeterministic([1, 2], ['a', 'b'], ['a', 'c']);
  expect(r).toMatchObject({ id: 'render.deterministic', blocking: true, status: 'fail' });
  expect(r.annotations[0]).toMatchObject({ t: 2 });
  expect(checkSeekSafe([1, 2], ['a', 'b'], ['x', 'b'])).toMatchObject({ id: 'render.seek_safe', status: 'fail' });
});
