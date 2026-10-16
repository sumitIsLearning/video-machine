// Text size limits for a format (ruling R6). Pure: the browser helper VM.fit runs fitPx against real layout.

import { type FormatId, frameOf } from '../contracts/types';

export { fitPx } from './fit-px';

/** Largest text size as a share of frame height. */
export const MAX_TEXT_FRAC = 0.12;

/** Smallest legible text: 3.5 % of height on vertical frames, 2.5 % elsewhere, rounded up. */
export const minTextPx = (f: FormatId): number => {
  const { h, aspect } = frameOf(f);
  return Math.ceil(h * (aspect === 'vertical' ? 0.035 : 0.025));
};

/** Largest text size for a format, as a share of frame height. */
export const maxTextPx = (f: FormatId): number => Math.round(frameOf(f).h * MAX_TEXT_FRAC);
