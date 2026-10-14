// Rough timing of a script before any voice exists: words at a fixed speaking rate plus a gap between lines.
// ponytail: a word-count guess, not a measured duration; the aligner (M10) gives the real timings later.

import type { Script } from '../contracts/types';

export const WORDS_PER_S = 2.5;
export const LINE_GAP_S = 0.25;

export type LineEstimate = { id: string; words: number; start_s: number; end_s: number };

/** Counts the words in `s`; whitespace of any kind separates them. */
export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * Estimates each line's start and end on the timeline, and the total length.
 * The clock is kept unrounded so rounding never accumulates; only the returned numbers are rounded.
 * Returns data only; throws nothing.
 */
export const estimate = (script: Script): { lines: LineEstimate[]; total_s: number } => {
  let clock = 0;
  let lastEnd = 0;
  const lines = script.lines.map((line) => {
    const words = wordCount(line.spoken ?? line.text);
    const start = clock;
    const end = start + words / WORDS_PER_S;
    clock = end + LINE_GAP_S;
    lastEnd = end;
    return {
      id: line.id,
      words,
      start_s: Math.round(start * 100) / 100,
      end_s: Math.round(end * 100) / 100,
    };
  });
  return { lines, total_s: Math.round(lastEnd * 10) / 10 };
};
