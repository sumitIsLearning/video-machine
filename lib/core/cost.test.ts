import { expect, test } from 'bun:test';
import { costGate } from './cost';

test('free work passes a zero budget', () =>
  expect(costGate([{ what: 'voice (hf-tts)', usd: 0 }], 0)).toEqual({ total_usd: 0, ok: true }));
test('over budget fails', () =>
  expect(
    costGate(
      [
        { what: 'a', usd: 0.5 },
        { what: 'b', usd: 0.75 },
      ],
      1,
    ),
  ).toEqual({ total_usd: 1.25, ok: false }));
test('an approval at or above the total passes', () =>
  expect(costGate([{ what: 'a', usd: 1.25 }], 0, 1.25).ok).toBe(true));
test('total is rounded to cents', () =>
  expect(
    costGate(
      [
        { what: 'a', usd: 0.1 },
        { what: 'b', usd: 0.2 },
      ],
      1,
    ).total_usd,
  ).toBe(0.3));
test('a negative cost is a bug', () => expect(() => costGate([{ what: 'a', usd: -1 }], 0)).toThrow('a'));
test('a NaN cost is a bug', () => expect(() => costGate([{ what: 'b', usd: Number.NaN }], 0)).toThrow('b'));
