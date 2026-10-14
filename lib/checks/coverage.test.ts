import { expect, test } from 'bun:test';
import { ScriptSchema } from '../contracts/types';
import { checkCoverage } from './coverage';

const script = ScriptSchema.parse({
  run_id: 'r',
  version: 1,
  lines: [
    { id: 'l1', text: 'a' },
    { id: 'l2', text: 'b' },
    { id: 'l3', text: 'c' },
  ],
});
const scenes = (...lines: string[][]) => lines.map((l, i) => ({ scene_id: `s${i + 1}`, lines: l }));

test('every line once, in order, passes', () => {
  expect(checkCoverage(scenes(['l1', 'l2'], ['l3']), script)).toMatchObject({
    id: 'plan.coverage',
    blocking: true,
    status: 'pass',
  });
});

test('missing, repeated, unknown and out-of-order lines each fail by name', () => {
  const problems = (s: ReturnType<typeof scenes>) => checkCoverage(s, script).annotations.map((a) => a.problem);
  expect(problems(scenes(['l1'], ['l3']))).toEqual(['line l2 is in no scene']);
  expect(problems(scenes(['l1', 'l2'], ['l2', 'l3']))).toEqual(['line l2 is in more than one scene (s1, s2)']);
  expect(problems(scenes(['l1', 'l2', 'l3', 'l9']))).toEqual(['scene s1 names unknown line l9']);
  expect(problems(scenes(['l2'], ['l1', 'l3']))).toEqual(['scenes are not in script order: l1 comes after l2']);
});
