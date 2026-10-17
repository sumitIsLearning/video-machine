import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InputError } from './errors';
import { deliverStageOf, relInside, runFileOf } from './paths';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};
const root = path.resolve('run-root');

test('relInside gives the path under the root, and undefined for the root’s siblings and parents', () => {
  expect(relInside(root, path.join(root, 'a', 'b.mp4'))).toBe(path.join('a', 'b.mp4'));
  expect(relInside(root, path.resolve('run-root-2', 'a.mp4'))).toBeUndefined();
  expect(relInside(root, path.dirname(root))).toBeUndefined();
  expect(relInside(root, path.join(root, '..', 'x'))).toBeUndefined();
});

test.skipIf(process.platform !== 'win32')('relInside refuses a path on another drive', () => {
  expect(relInside('C:\\run', 'D:\\run\\a.mp4')).toBeUndefined();
});

test('runFileOf returns the file for a run path inside the run', () => {
  const run = temp();
  mkdirSync(path.join(run, 'input'));
  writeFileSync(path.join(run, 'input', 'a.mp4'), 'x');
  expect(runFileOf(run, 'input/a.mp4')).toBe(path.join(run, 'input', 'a.mp4'));
});

test('runFileOf refuses `..`, a missing file and a folder, and appends the hint', () => {
  const run = temp();
  mkdirSync(path.join(run, 'input'));
  expect(() => runFileOf(run, '../outside.mp4')).toThrow(InputError);
  expect(() => runFileOf(run, 'input/none.mp4')).toThrow(/input\/none\.mp4 is not a file in the run folder/);
  expect(() => runFileOf(run, 'input/none.mp4', 'import it first')).toThrow(/; import it first/);
  expect(() => runFileOf(run, 'input')).toThrow(InputError);
});

test('runFileOf refuses a file behind a junction that points out of the run', () => {
  const run = temp();
  const outside = temp();
  writeFileSync(path.join(outside, 'secret.txt'), 's');
  mkdirSync(path.join(run, 'input'));
  symlinkSync(outside, path.join(run, 'input', 'junc'), 'junction');
  expect(() => runFileOf(run, 'input/junc/secret.txt')).toThrow(/resolves outside the run folder/);
});

test('deliverStageOf is out/deliver.tmp/<format> inside the run', () => {
  expect(deliverStageOf('/r', 'reel')).toBe(path.join('/r', 'out', 'deliver.tmp', 'reel'));
});
