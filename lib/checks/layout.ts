import type { CheckResult, FormatId } from '../contracts/types';
import { FORMATS } from '../contracts/types';
import { minTextPx } from '../core/text-fit';

/** One text box on screen at time `t`, as sampled from the render. */
export type TextSample = {
  t: number;
  scene_id?: string;
  text: string;
  box: { x: number; y: number; w: number; h: number };
  font_px: number;
  caption: boolean;
};

/** Tolerance in px for the safe-area edges, so rounding in the layout does not fail a box. */
const SAFE_TOLERANCE_PX = 2;

/**
 * Builds a layout result: one annotation per (scene_id, text), keeping the earliest sample.
 * Skips when there are no samples; never throws.
 */
const report = (
  id: string,
  format: FormatId,
  blocking: boolean,
  samples: TextSample[],
  problemOf: (s: TextSample) => string | undefined,
  suggested_fix: string,
): CheckResult => {
  if (samples.length === 0) return { id, format, blocking, status: 'skip', detail: 'no text samples', annotations: [] };
  const earliest = new Map<string, { s: TextSample; problem: string }>();
  for (const s of samples) {
    const problem = problemOf(s);
    if (problem === undefined) continue;
    const key = JSON.stringify([s.scene_id ?? null, s.text]);
    const kept = earliest.get(key);
    if (kept === undefined || s.t < kept.s.t) earliest.set(key, { s, problem });
  }
  const annotations = [...earliest.values()].map(({ s, problem }) => ({
    ...(s.scene_id === undefined ? {} : { scene_id: s.scene_id }),
    t: s.t,
    problem,
    suggested_fix,
  }));
  const status = annotations.length === 0 ? 'pass' : 'fail';
  const detail = status === 'pass' ? `${samples.length} text samples checked` : `${annotations.length} text(s) fail`;
  return { id, format, blocking, status, detail, annotations };
};

/**
 * Checks that every text box stays inside the format's safe area; returns a blocking CheckResult.
 * Skips on no samples; never throws.
 */
export const checkSafeArea = (samples: TextSample[], format: FormatId): CheckResult => {
  const { w, h, safe } = FORMATS[format];
  const x0 = w * safe.left;
  const x1 = w * (1 - safe.right);
  const y0 = h * safe.top;
  const y1 = h * (1 - safe.bottom);
  const problemOf = (s: TextSample): string | undefined => {
    const { x, y, w: bw, h: bh } = s.box;
    const edges: string[] = [];
    if (y < y0 - SAFE_TOLERANCE_PX) edges.push('top');
    if (y + bh > y1 + SAFE_TOLERANCE_PX) edges.push('bottom');
    if (x < x0 - SAFE_TOLERANCE_PX) edges.push('left');
    if (x + bw > x1 + SAFE_TOLERANCE_PX) edges.push('right');
    if (edges.length === 0) return undefined;
    return `"${s.text}" crosses the ${edges.join(', ')} edge of the safe area`;
  };
  return report('layout.safe_area', format, true, samples, problemOf, 'move the text inside var(--vm-safe-*)');
};

/**
 * Checks that no text is smaller than the format's legible floor; blocking only on reel.
 * Skips on no samples; never throws.
 */
export const checkMinTextSize = (samples: TextSample[], format: FormatId): CheckResult => {
  const floor = minTextPx(format);
  const problemOf = (s: TextSample): string | undefined =>
    s.font_px < floor ? `"${s.text}" is ${s.font_px} px; the floor is ${floor} px` : undefined;
  return report(
    'layout.min_text_size',
    format,
    format === 'reel',
    samples,
    problemOf,
    'size it with VM.fit or at least var(--vm-min-text)',
  );
};
