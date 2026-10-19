import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { approvedOf, costGate, recordSpend, spentOf } from './cost';
import { InputError } from './errors';

const U = 'usage: x';
test('approvedOf is 0 when no flag is given', () => expect(approvedOf([], U)).toBe(0));
test('approvedOf reads the amount after --approve-spend', () =>
  expect(approvedOf(['--approve-spend', '2.5'], U)).toBe(2.5));
test('approvedOf refuses a non-number amount', () =>
  expect(() => approvedOf(['--approve-spend', 'x'], U)).toThrow(InputError));
test('approvedOf refuses an unknown flag with the usage', () => expect(() => approvedOf(['--x'], U)).toThrow(U));

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
test('spent plus this step over budget fails', () =>
  expect(costGate([{ what: 'a', usd: 1 }], 2, 0, 1.5).ok).toBe(false));
test('an approval covering this step passes even when the ledger is over budget', () =>
  expect(costGate([{ what: 'a', usd: 1 }], 2, 1, 1.5).ok).toBe(true));
test('spentOf is 0 when the run has no spend.json', () =>
  expect(spentOf(mkdtempSync(path.join(tmpdir(), 'vm-')))).toBe(0));
test('recordSpend twice, then spentOf sums both', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  recordSpend(dir, [{ what: 'voice (hf-tts)', usd: 1.25 }]);
  recordSpend(dir, [{ what: 'avatar a01 (heygen)', usd: 2 }]);
  expect(spentOf(dir)).toBe(3.25);
});
test('recordSpend writes nothing when no item costs money', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  recordSpend(dir, [{ what: 'voice (hf-tts)', usd: 0 }]);
  expect(existsSync(path.join(dir, 'spend.json'))).toBe(false);
});
test('a negative cost is a bug', () => expect(() => costGate([{ what: 'a', usd: -1 }], 0)).toThrow('a'));
test('a NaN cost is a bug', () => expect(() => costGate([{ what: 'b', usd: Number.NaN }], 0)).toThrow('b'));
