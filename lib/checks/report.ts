// Report and results helpers shared by the check runners: report.md text and merging check results.
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CheckResult } from '../contracts/types';

/** One line per problem, naming the scene and time when there are any. */
const lineOf = (a: CheckResult['annotations'][number]): string => {
  const where = a.scene_id === undefined ? '' : `scene ${a.scene_id}${a.t === undefined ? '' : ` at ${a.t} s`}: `;
  return `- ${where}${a.problem} → ${a.suggested_fix}`;
};

/** Writes report.md through a temp name and a rename, so a crash never leaves a half-written report. */
export const writeReport = (runDir: string, checks: CheckResult[], blocking: number): void => {
  const label = (c: CheckResult) => (c.format === undefined ? c.id : `${c.id} (${c.format})`);
  const fails = checks.filter((c) => c.status === 'fail').sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const sections = fails.map((c) => {
    const body = c.annotations.length === 0 ? `- ${c.detail}` : c.annotations.map(lineOf).join('\n');
    return `## ${label(c)}\n${body}`;
  });
  const passed = `## Passed\n${checks
    .filter((c) => c.status === 'pass')
    .map((c) => `- ${label(c)}`)
    .join('\n')}`;
  const text = [`# Checks: ${blocking} blocking failed`, ...sections, passed].join('\n\n');
  const dest = path.join(runDir, 'report.md');
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, `${text}\n`);
  renameSync(tmp, dest);
};

/**
 * Merges re-run checks into previous results: a check with the same id and format replaces the old one in
 * place, the rest of `next` is appended in order. Returns a new array and throws nothing.
 */
export const mergeChecks = (prev: CheckResult[], next: CheckResult[]): CheckResult[] => {
  const keyOf = (c: CheckResult) => `${c.id}\u0000${c.format ?? ''}`;
  const fresh = new Map(next.map((c) => [keyOf(c), c]));
  const merged = prev.map((c) => fresh.get(keyOf(c)) ?? c);
  const prevKeys = new Set(prev.map(keyOf));
  return [...merged, ...next.filter((c) => !prevKeys.has(keyOf(c)))];
};
