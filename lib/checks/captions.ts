import type { CheckResult } from '../contracts/types';

/** One spoken word at time `t` and the caption text on screen at that moment. */
export type CaptionSample = { t: number; scene_id?: string; word: string; shown: string };

/** Lower-cases a word and strips everything that is not a letter or digit. */
const normalise = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Checks that each spoken word appears in the caption on screen at its midpoint; returns a blocking CheckResult.
 * Skips when no caption was ever shown; never throws.
 */
export const checkCaptions = (samples: CaptionSample[], everShown: boolean): CheckResult => {
  if (!everShown)
    return { id: 'captions.match', blocking: true, status: 'skip', detail: 'no caption on screen', annotations: [] };
  const annotations = samples.flatMap((s) => {
    const shownWords = new Set(s.shown.split(/\s+/).map(normalise));
    if (shownWords.has(normalise(s.word))) return [];
    return [
      {
        ...(s.scene_id === undefined ? {} : { scene_id: s.scene_id }),
        t: s.t,
        problem: `caption shows "${s.shown}" while "${s.word}" is spoken`,
        suggested_fix: 'show each word in the caption while it is spoken',
      },
    ];
  });
  const status = annotations.length === 0 ? 'pass' : 'fail';
  const detail =
    status === 'pass' ? `${samples.length} words checked` : `${annotations.length} word(s) missing from the caption`;
  return { id: 'captions.match', blocking: true, status, detail, annotations };
};
