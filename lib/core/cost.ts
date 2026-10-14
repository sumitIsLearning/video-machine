// The spend check every paid step runs before it spends anything.

import { VideoMachineError } from './errors';

export type Spend = { what: string; usd: number };

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
