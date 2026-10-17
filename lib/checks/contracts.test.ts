import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkContractsValid } from './contracts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-contracts-'));
  dirs.push(d);
  return d;
};

test('checkContractsValid passes when the files present all parse, and skips absent ones', () => {
  const d = run();
  writeFileSync(path.join(d, 'assets.json'), JSON.stringify({ run_id: 'r', assets: [] }));
  expect(checkContractsValid(d)).toMatchObject({
    id: 'contracts.valid',
    blocking: true,
    status: 'pass',
    detail: '1 file(s) valid',
  });
});

test('checkContractsValid names every file that is not valid JSON or breaks its schema', () => {
  const d = run();
  mkdirSync(path.join(d, 'capture'));
  writeFileSync(path.join(d, 'capture', 'steps.json'), '[{}]');
  writeFileSync(path.join(d, 'plan.json'), '{not json');
  const r = checkContractsValid(d);
  expect(r.status).toBe('fail');
  expect(r.annotations.map((a) => a.problem.split(':')[0])).toEqual(['plan.json', 'capture/steps.json']);
});

test('checkContractsValid annotates a run file that cannot be read instead of throwing', () => {
  const d = run();
  mkdirSync(path.join(d, 'script.json'));
  const r = checkContractsValid(d);
  expect(r.status).toBe('fail');
  expect(r.annotations[0]?.problem.startsWith('script.json: ')).toBe(true);
});
