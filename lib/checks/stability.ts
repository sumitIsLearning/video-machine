import type { CheckResult } from '../contracts/types';

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** FNV-1a 32-bit hash of the seed string: the starting state of the PRNG. */
const fnv1a = (seed: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

/** A mulberry32 generator started from the seed; each call returns a float in [0, 1). */
const prng = (seed: string): (() => number) => {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Picks up to `n` distinct seeded times inside the middle 80% of `total`, 3 decimals, sorted ascending.
 * Returns [] when `total` or `n` is not positive; never throws.
 */
export const sampleTimes = (seed: string, total: number, n: number): number[] => {
  if (total <= 0 || n <= 0) return [];
  const draw = prng(seed);
  const found = new Set<number>();
  for (let k = 0; k < 1000 && found.size < n; k++) found.add(round3(total * (0.1 + 0.8 * draw())));
  return [...found].sort((x, y) => x - y);
};

/**
 * Compares two hash lists taken at the same times; one annotation per differing time.
 * Fails on mismatched counts, skips on no times; never throws.
 */
const compare = (
  id: string,
  at: number[],
  a: string[],
  b: string[],
  problem: (t: number) => string,
  suggested_fix: string,
): CheckResult => {
  if (a.length !== at.length || b.length !== at.length) {
    return { id, blocking: true, status: 'fail', detail: 'hash counts differ', annotations: [] };
  }
  if (at.length === 0) return { id, blocking: true, status: 'skip', detail: 'no sampled times', annotations: [] };
  const annotations = at.flatMap((time, i) => {
    if (a[i] === b[i]) return [];
    const t = round3(time);
    return [{ t, problem: problem(t), suggested_fix }];
  });
  return {
    id,
    blocking: true,
    status: annotations.length === 0 ? 'pass' : 'fail',
    detail: annotations.length === 0 ? `${at.length} frames checked` : `${annotations.length} problem(s)`,
    annotations,
  };
};

/**
 * Checks that the same frame hashes match between two full renders; returns a blocking CheckResult.
 * Never throws.
 */
export const checkDeterministic = (at: number[], first: string[], second: string[]): CheckResult =>
  compare(
    'render.deterministic',
    at,
    first,
    second,
    (t) => `frame at ${t} s differs between two renders`,
    'remove clock reads and unseeded randomness from the scene',
  );

/**
 * Checks that each frame hash from a batch render matches the same frame rendered alone; returns a blocking CheckResult.
 * Never throws.
 */
export const checkSeekSafe = (at: number[], batch: string[], single: string[]): CheckResult =>
  compare(
    'render.seek_safe',
    at,
    batch,
    single,
    (t) => `frame at ${t} s differs when seeked alone`,
    'make the scene a pure function of time (no state carried between seeks)',
  );
