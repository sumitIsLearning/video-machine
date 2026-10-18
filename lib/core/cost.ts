// The spend check every paid step runs before it spends anything.

import { InputError, VideoMachineError } from './errors';

export type Spend = { what: string; usd: number };

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * The spend the creator approved with `--approve-spend usd`, or 0 when the flag is absent. Throws InputError, naming
 * `usage`, when `rest` is anything else, and when the amount is not a plain number.
 */
export const approvedOf = (rest: string[], usage: string): number => {
  if (rest.length === 0) return 0;
  if (rest.length !== 2 || rest[0] !== '--approve-spend') throw new InputError(usage);
  if (!AMOUNT_PATTERN.test(rest[1] ?? '')) throw new InputError('--approve-spend must be a number');
  return Number(rest[1]);
};

/**
 * Totals the planned spend (rounded to cents) and says whether it fits the budget or the creator's approval.
 * Paid adapters report `costEstimate` first, so the gate sees the price before any money moves.
 * Throws VideoMachineError when an item has a negative or NaN usd.
 */
export const costGate = (items: Spend[], budget_usd: number, approved_usd = 0): { total_usd: number; ok: boolean } => {
  for (const item of items) {
    if (!(item.usd >= 0)) throw new VideoMachineError(`negative or invalid cost for "${item.what}": ${item.usd}`);
  }
  const sum = items.reduce((acc, item) => acc + item.usd, 0);
  const total_usd = Math.round(sum * 100) / 100;
  return { total_usd, ok: total_usd <= Math.max(budget_usd, approved_usd) };
};
