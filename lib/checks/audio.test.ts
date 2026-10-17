import { expect, test } from 'bun:test';
import { checkLoudness } from './audio';

test('checkLoudness passes inside -14 ±1 LUFS with true peak at or below -1 dBTP', () => {
  const r = checkLoudness('reel', { i: -13.1, tp: -1 });
  expect(r).toMatchObject({ id: 'audio.loudness', format: 'reel', blocking: true, status: 'pass', annotations: [] });
});

test('checkLoudness fails too quiet, too loud and a hot peak, naming the numbers', () => {
  for (const m of [
    { i: -15.2, tp: -3 },
    { i: -12.8, tp: -3 },
    { i: -14, tp: -0.4 },
  ]) {
    const r = checkLoudness('reel', m);
    expect(r.status).toBe('fail');
    expect(r.annotations[0]?.problem).toContain(`${m.i} LUFS`);
    expect(r.annotations[0]?.problem).toContain(`${m.tp} dBTP`);
  }
});
