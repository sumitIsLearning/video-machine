import type { CheckResult, FormatId } from '../contracts/types';
import type { Loudness } from '../core/media';

/**
 * Checks the mixed sound of one format against the -14 ±1 LUFS target and the -1 dBTP peak ceiling; returns a blocking CheckResult.
 * Never throws.
 */
export const checkLoudness = (format: FormatId, m: Loudness): CheckResult => {
  const pass = Math.abs(m.i + 14) <= 1 && m.tp <= -1;
  return {
    id: 'audio.loudness',
    format,
    blocking: true,
    status: pass ? 'pass' : 'fail',
    detail: `${m.i} LUFS, ${m.tp} dBTP`,
    annotations: pass
      ? []
      : [
          {
            problem: `integrated ${m.i} LUFS, true peak ${m.tp} dBTP; target -14 ±1 LUFS, ≤ -1 dBTP`,
            suggested_fix: 'mix the sound again (deliver mix), then export again',
          },
        ],
  };
};
