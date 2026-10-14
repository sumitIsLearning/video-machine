// The per-word spoken map the aligner needs (R8): built by a word diff of each line's `text` against its `spoken`.

import type { Script } from '../contracts/types';
import { InputError } from '../core/errors';

type Line = Script['lines'][number];

/** The word as the aligner compares it (same as align_vo.py `spoken()`): ’ to ', uppercase, only A-Z and ' kept. */
const up = (word: string): string =>
  word
    .replace(/’/g, "'")
    .toUpperCase()
    .replace(/[^A-Z' ]/g, '')
    .replace(/^'+|'+$/g, '');

/** Index pairs [i, j] of a longest common subsequence of `a` and `b`; an empty word never matches. */
const matchesOf = (a: string[], b: string[]): [number, number][] => {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  const len = (i: number, j: number): number => table[i]?.[j] ?? 0;
  const same = (i: number, j: number): boolean => a[i] !== '' && a[i] === b[j];
  for (let i = a.length - 1; i >= 0; i--) {
    const row = table[i];
    for (let j = b.length - 1; j >= 0 && row !== undefined; j--) {
      row[j] = same(i, j) ? len(i + 1, j + 1) + 1 : Math.max(len(i + 1, j), len(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(i, j)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (len(i + 1, j) >= len(i, j + 1)) i++;
    else j++;
  }
  return pairs;
};

/** A word said as itself: its aligner form, or [] for a token with no letters. */
const plainOf = (word: string): string[] => (up(word) === '' ? [] : [up(word)]);

/** Stores `values` for `word`; throws InputError when the same word already has different values. */
const putInto = (map: Map<string, string[]>, word: string, values: string[]): void => {
  const known = map.get(word);
  if (known !== undefined && JSON.stringify(known) !== JSON.stringify(values))
    throw new InputError(`"${word}" is spoken two ways in the script; write it the same way in both lines`);
  map.set(word, values);
};

/** The words one line's `spoken` changes, from a word diff of its `text` against it. Throws InputError as putInto does. */
const spokenMapOf = (line: Line, spoken: string): Map<string, string[]> => {
  const local = new Map<string, string[]>();
  const text = line.text.split(' ').filter(Boolean);
  const spokenWords = spoken.split(/\s+/).filter(Boolean);
  const textUp = text.map(up);
  const spokenUp = spokenWords.map(up);
  let ti = 0;
  let si = 0;
  for (const [mi, mj] of [...matchesOf(textUp, spokenUp), [text.length, spokenWords.length]] as [number, number][]) {
    const textGap = text.slice(ti, mi);
    const spokenGap = spokenUp.slice(si, mj).filter(Boolean);
    if (textGap.length > 0) {
      putInto(local, textGap[0] ?? '', spokenGap);
      for (const word of textGap.slice(1)) putInto(local, word, []);
    } else if (spokenGap.length > 0) {
      const before = text[ti - 1];
      const after = text[mi];
      if (before !== undefined) putInto(local, before, [up(before), ...spokenGap].filter(Boolean));
      else if (after !== undefined) putInto(local, after, [...spokenGap, up(after)].filter(Boolean));
      else throw new InputError(`line "${line.id}" has spoken words but no words in its text`);
    }
    ti = mi + 1;
    si = mj + 1;
  }
  return local;
};

/**
 * Maps each display word of the scripts (as written in `text`, e.g. "5.5%" or "MCP") to the words said for it, in the
 * aligner's form (uppercase, e.g. ["FIVE", "POINT"]). The map is global, since the aligner applies it to every line:
 * a word's entry is its line's `spoken` change where a line has one, and its plain form elsewhere, so plain uses in
 * any line count. A replaced run maps its first word to the spoken words and the rest to []; extra spoken words
 * attach to the word before them. Only entries that differ from the plain form are returned. Throws InputError
 * naming a word that is said two different ways in the script.
 */
export function spokenWordsOf(lines: Line[]): Record<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of lines) {
    const local = line.spoken === undefined ? new Map<string, string[]>() : spokenMapOf(line, line.spoken);
    for (const word of line.text.split(' ').filter(Boolean)) putInto(map, word, local.get(word) ?? plainOf(word));
  }
  return Object.fromEntries(
    [...map].filter(([word, values]) => JSON.stringify(values) !== JSON.stringify(plainOf(word))),
  );
}
