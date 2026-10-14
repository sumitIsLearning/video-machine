import { expect, test } from 'bun:test';
import { spokenWordsOf } from './spoken';

const line = (id: string, text: string, spoken?: string) => ({ id, text, spoken, delivery: 'voiceover' as const });

test('lines without spoken give an empty map', () => expect(spokenWordsOf([line('l1', 'Hi there.')])).toEqual({}));
test('a replaced word maps to its spoken words', () =>
  expect(spokenWordsOf([line('l1', 'Up 5.5% today.', 'Up five point five percent today.')])).toEqual({
    '5.5%': ['FIVE', 'POINT', 'FIVE', 'PERCENT'],
  }));
test('a replaced run maps to the first word; the rest are unspoken', () =>
  expect(spokenWordsOf([line('l1', 'Use MCP SDK now.', 'Use the em see pee kit now.')])).toEqual({
    MCP: ['THE', 'EM', 'SEE', 'PEE', 'KIT'],
    SDK: [],
  }));
test('extra spoken words attach to the word before', () =>
  expect(spokenWordsOf([line('l1', 'Go fast.', 'Go really fast.')])).toEqual({ Go: ['GO', 'REALLY'] }));
test('the same word spoken two ways is refused by name', () =>
  expect(() =>
    spokenWordsOf([line('l1', 'v2 ships.', 'vee two ships.'), line('l2', 'v2 rocks.', 'version two rocks.')]),
  ).toThrow('"v2"'));
test('a word re-mapped in one line is refused when a plain line uses it', () =>
  expect(() =>
    spokenWordsOf([line('l1', 'Claude Code rocks.', 'Claude Code really rocks.'), line('l2', 'Code is fun.')]),
  ).toThrow('"Code"'));
test('a dropped word of a replaced run is refused when a plain line uses it', () =>
  expect(() =>
    spokenWordsOf([line('l1', 'Use MCP SDK now.', 'Use the em see pee kit now.'), line('l2', 'The SDK is open.')]),
  ).toThrow('"SDK"'));
test('plain lines alone add no entries', () => expect(spokenWordsOf([line('l1', 'Code is fun.')])).toEqual({}));
