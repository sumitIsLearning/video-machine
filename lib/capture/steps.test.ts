import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StepsSchema } from '../contracts/types';
import { ContractError, InputError } from '../core/errors';
import { readJson } from '../core/json';
import { writeSteps } from './steps';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const runDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  return d;
};
const step = (i: number, extra: object = {}) => ({
  i,
  url: 'https://example.com/',
  action: 'click',
  target: 'Export',
  expect: 'a menu opens',
  ...extra,
});
const FRAME = 'capture/nav/nav/frames/003.png';

test('a valid draft with an existing frame is written and reads back', () => {
  const run = runDir();
  mkdirSync(path.join(run, 'capture/nav/nav/frames'), { recursive: true });
  writeFileSync(path.join(run, FRAME), 'png');
  const steps = writeSteps(run, [step(0, { frame: FRAME }), step(1)]);
  expect(readJson(path.join(run, 'capture/steps.json'), StepsSchema)).toEqual(steps);
});

test('a frame that does not exist is an input error naming it, and nothing is written', () => {
  const run = runDir();
  expect(() => writeSteps(run, [step(0, { frame: FRAME })])).toThrow(InputError);
  expect(() => writeSteps(run, [step(0, { frame: FRAME })])).toThrow(FRAME);
  expect(existsSync(path.join(run, 'capture/steps.json'))).toBe(false);
});

test('a missing frame says to read the nav video, not to import', () => {
  expect(() => writeSteps(runDir(), [step(0, { frame: FRAME })])).toThrow(/the frame must come from capture read/);
});

test('a frame behind a junction out of the run folder is refused, and nothing is written', () => {
  const run = runDir();
  const outside = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(outside);
  writeFileSync(path.join(outside, 'f.png'), 'png');
  mkdirSync(path.join(run, 'input'));
  symlinkSync(outside, path.join(run, 'input', 'junc'), 'junction');
  expect(() => writeSteps(run, [step(0, { frame: 'input/junc/f.png' })])).toThrow(/outside the run folder/);
  expect(existsSync(path.join(run, 'capture/steps.json'))).toBe(false);
});

test('step numbers out of order are a contract error', () => {
  expect(() => writeSteps(runDir(), [step(1), step(0)])).toThrow(ContractError);
});

test('a draft that is not an array is a contract error', () => {
  expect(() => writeSteps(runDir(), step(0))).toThrow(ContractError);
});
