import { describe, expect, test } from 'bun:test';
import type { Timing } from '../contracts/types';
import { InputError } from './errors';
import { lineConf, lineOf, timedLines, wordOf } from './timing';

const timing: Timing = {
  lines: [
    {
      id: 'l1',
      text: 'Pip install, then pip?',
      start: 0,
      end: 2,
      words: [
        { w: 'Pip', start: 0, end: 0.3 },
        { w: 'install,', start: 0.3, end: 0.9 },
        { w: 'then', start: 1, end: 1.2 },
        { w: 'pip?', start: 1.3, end: 2 },
      ],
    },
    {
      id: 'l2',
      text: 'Clean — data.',
      start: 2.25,
      end: 3.5,
      words: [
        { w: 'Clean', start: 2.25, end: 2.8 },
        { w: '—', start: 2.8, end: 2.9 },
        { w: 'data.', start: 2.9, end: 3.5 },
      ],
    },
  ],
};

describe('lineOf', () => {
  test('finds a line by id', () => expect(lineOf(timing, 'l2').start).toBe(2.25));
  test('an unknown id is an InputError naming it', () => {
    expect(() => lineOf(timing, 'l9')).toThrow(InputError);
    expect(() => lineOf(timing, 'l9')).toThrow('"l9"');
  });
});

describe('wordOf', () => {
  const l1 = lineOf(timing, 'l1');
  test('matches ignoring case and punctuation', () => expect(wordOf(l1, 'install')).toEqual({ start: 0.3, end: 0.9 }));
  test('nth picks the occurrence, 0 is the first', () => {
    expect(wordOf(l1, 'pip')).toEqual({ start: 0, end: 0.3 });
    expect(wordOf(l1, 'pip', 1)).toEqual({ start: 1.3, end: 2 });
  });
  test('a phrase spans its words; unspoken tokens are skipped', () =>
    expect(wordOf(lineOf(timing, 'l2'), 'clean data')).toEqual({ start: 2.25, end: 3.5 }));
  test('never leaves its line', () => expect(() => wordOf(l1, 'data')).toThrow('line "l1" has no "data"'));
  test('a missing occurrence names nth', () => expect(() => wordOf(l1, 'pip', 2)).toThrow('occurrence 2'));
  test('an empty word is an InputError', () => expect(() => wordOf(l1, ' ? ')).toThrow(InputError));
});

describe('timedLines', () => {
  test('gives LineEstimate-shaped lines from timing', () =>
    expect(timedLines(timing)).toEqual([
      { id: 'l1', words: 4, start_s: 0, end_s: 2 },
      { id: 'l2', words: 3, start_s: 2.25, end_s: 3.5 },
    ]));
  test('a line without an id is an InputError (re-run align)', () => {
    const old: Timing = { lines: [{ text: 'x', start: 0, end: 1, words: [] }] };
    expect(() => timedLines(old)).toThrow('re-run align');
  });
  test('lineConf is the unrounded mean of the word confs, skipping words without one', () =>
    expect(lineConf([{ conf: 0.5 }, { conf: 0.25 }, {}])).toBeCloseTo(0.375));
  test('lineConf is undefined when no word has a conf', () => expect(lineConf([{}, {}])).toBeUndefined());
});
