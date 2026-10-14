// Finds lines and words in timing.json by their content, so scenes never hard-code seconds.

import type { Timing } from '../contracts/types';
import { InputError } from './errors';
import type { LineEstimate } from './estimate';

export type TimedLine = Timing['lines'][number];

// Case, curly apostrophes and punctuation must not stop a match: "Pip" finds "pip?".
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');

/** The timed line with this id. Throws InputError when timing.json has no such line. */
export const lineOf = (timing: Timing, id: string): TimedLine => {
  const line = timing.lines.find((l) => l.id === id);
  if (!line) throw new InputError(`timing.json has no line "${id}"; re-run align`);
  return line;
};

/**
 * The time span of the nth (0-based) occurrence of `word` inside `line`; a phrase spans its words.
 * Throws InputError when `word` has no letters or the line has no such occurrence.
 */
export const wordOf = (line: TimedLine, word: string, nth = 0): { start: number; end: number } => {
  const tokens = word.split(/\s+/).map(norm).filter(Boolean);
  if (tokens.length === 0) throw new InputError('wordOf needs a word');
  // Tokens with no letters (a lone "?" or "—") are not matchable; keep their timings out of the search.
  const spoken = line.words.map((w) => ({ n: norm(w.w), start: w.start, end: w.end })).filter((w) => w.n !== '');
  let seen = 0;
  for (let i = 0; i + tokens.length <= spoken.length; i++) {
    const hit = tokens.every((t, j) => spoken[i + j]?.n === t);
    if (!hit) continue;
    if (seen === nth) {
      return { start: spoken[i]?.start ?? 0, end: spoken[i + tokens.length - 1]?.end ?? 0 };
    }
    seen++;
  }
  const occurrence = nth > 0 ? ` (occurrence ${nth})` : '';
  throw new InputError(`line "${line.id ?? '?'}" has no "${word}"${occurrence}`);
};

/**
 * The mean conf of the words that have one, unrounded (callers round for display), or undefined when none does.
 * Returns undefined rather than 0 so a line the aligner did not score is not read as a failed one.
 */
export const lineConf = (words: { conf?: number | undefined }[]): number | undefined => {
  const confs = words.flatMap((w) => (w.conf === undefined ? [] : [w.conf]));
  if (confs.length === 0) return undefined;
  return confs.reduce((sum, c) => sum + c, 0) / confs.length;
};

/** Per-line word counts and spans in the LineEstimate shape. Throws InputError when a line has no id (re-run align). */
export const timedLines = (timing: Timing): LineEstimate[] =>
  timing.lines.map((line) => {
    if (line.id === undefined) throw new InputError('timing.json lines have no ids; re-run align');
    return { id: line.id, words: line.words.length, start_s: line.start, end_s: line.end };
  });
