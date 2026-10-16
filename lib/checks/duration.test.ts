import { expect, test } from 'bun:test';
import { checkDuration } from './duration';

test('inside the target passes; outside fails with the numbers', () => {
  expect(checkDuration(22.4, [15, 30]).status).toBe('pass');
  const r = checkDuration(31.2, [15, 30]);
  expect(r).toMatchObject({ id: 'timing.duration', blocking: true, status: 'fail' });
  expect(r.detail).toBe('31.2 s is outside 15–30 s');
});
