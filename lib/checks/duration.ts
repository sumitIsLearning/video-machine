import type { CheckResult } from '../contracts/types';

/**
 * Checks the reel duration against its target range, inclusive; returns a blocking CheckResult.
 * Seconds are rounded to 0.1 for the detail text; never throws.
 */
export const checkDuration = (seconds: number, target: [number, number]): CheckResult => {
  const [lo, hi] = target;
  const s = Math.round(seconds * 10) / 10;
  const inside = seconds >= lo && seconds <= hi;
  return {
    id: 'timing.duration',
    blocking: true,
    status: inside ? 'pass' : 'fail',
    detail: `${s} s is ${inside ? 'inside' : 'outside'} ${lo}–${hi} s`,
    annotations: [],
  };
};
