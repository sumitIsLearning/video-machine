import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CheckResult } from '../contracts/types';
import { mergeChecks, writeReport } from './report';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-report-'));
  dirs.push(d);
  return d;
};
const result = (id: string, status: CheckResult['status'], format?: CheckResult['format']): CheckResult => ({
  id,
  ...(format ? { format } : {}),
  blocking: true,
  status,
  detail: `${id} ${status}`,
  annotations: [],
});

test('writeReport lists blocking failures first, then warnings, then the passed checks', () => {
  const run = tmp();
  writeReport(
    run,
    [
      result('a.pass', 'pass'),
      { ...result('b.warn', 'fail'), blocking: false },
      {
        ...result('c.fail', 'fail', 'reel'),
        annotations: [{ scene_id: 's1', t: 1.5, problem: 'p', suggested_fix: 'f' }],
      },
    ],
    1,
  );
  const text = readFileSync(path.join(run, 'report.md'), 'utf8');
  expect(text.startsWith('# Checks: 1 blocking failed\n')).toBe(true);
  expect(text.indexOf('## c.fail (reel)')).toBeLessThan(text.indexOf('## b.warn'));
  expect(text).toContain('- scene s1 at 1.5 s: p → f');
  expect(text).toContain('- b.warn fail');
  expect(text).toContain('## Passed\n- a.pass');
  expect(readdirSync(run)).toEqual(['report.md']);
});

test('mergeChecks replaces a check with the same id and format in place and appends new ones', () => {
  const merged = mergeChecks(
    [result('x', 'fail', 'reel'), result('x', 'pass', 'square'), result('y', 'pass')],
    [result('x', 'pass', 'reel'), result('z', 'pass')],
  );
  expect(merged.map((c) => `${c.id}/${c.format ?? '-'}/${c.status}`)).toEqual([
    'x/reel/pass',
    'x/square/pass',
    'y/-/pass',
    'z/-/pass',
  ]);
});
