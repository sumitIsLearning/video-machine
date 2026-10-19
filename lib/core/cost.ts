// The spend check every paid step runs before it spends anything.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { type SpendLog, SpendLogSchema } from '../contracts/types';
import { InputError, VideoMachineError } from './errors';
import { readJson, writeJson } from './json';

export type Spend = { what: string; usd: number };

const SPEND_FILE = 'spend.json';

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
 * `spent_usd` is what the run already spent (see `spentOf`): the step fits when the spent money plus this step is within
 * the budget, or this step is within the creator's approval. Throws VideoMachineError when an item has a negative or
 * NaN usd.
 */
export const costGate = (
  items: Spend[],
  budget_usd: number,
  approved_usd = 0,
  spent_usd = 0,
): { total_usd: number; ok: boolean } => {
  for (const item of items) {
    if (!(item.usd >= 0)) throw new VideoMachineError(`negative or invalid cost for "${item.what}": ${item.usd}`);
  }
  const sum = items.reduce((acc, item) => acc + item.usd, 0);
  const total_usd = Math.round(sum * 100) / 100;
  const ok = Math.round((spent_usd + total_usd) * 100) / 100 <= budget_usd || total_usd <= approved_usd;
  return { total_usd, ok };
};

const readSpend = (runDir: string): SpendLog =>
  existsSync(path.join(runDir, SPEND_FILE)) ? readJson(path.join(runDir, SPEND_FILE), SpendLogSchema) : [];

/**
 * What the run has spent so far: the sum of `spend.json` rounded to cents, or 0 when the run has no ledger yet.
 * Throws ContractError when the ledger is malformed.
 */
export const spentOf = (runDir: string): number => {
  const sum = readSpend(runDir).reduce((acc, item) => acc + item.usd, 0);
  return Math.round(sum * 100) / 100;
};

/**
 * Append the items that cost money to the run's `spend.json`, so every later gate counts them. Items at $0 are not
 * recorded, and when nothing costs money no file is written. The ledger is never cleared.
 * Throws ContractError when the ledger cannot be read or written.
 */
export const recordSpend = (runDir: string, items: Spend[]): void => {
  const paid = items.filter((item) => item.usd > 0);
  if (paid.length === 0) return;
  writeJson(path.join(runDir, SPEND_FILE), SpendLogSchema, [...readSpend(runDir), ...paid]);
};
