// The search for the largest font size that still fits its box (ruling R6). No imports: the browser helper
// bundles this file, so it must stay free of Node and zod code.

/**
 * Binary search for the largest integer size in [minPx, maxPx] that fits. `fits` must be monotone: true up to a
 * size, false above it. Returns minPx when even that does not fit. Never throws.
 */
export const fitPx = (fits: (px: number) => boolean, minPx: number, maxPx: number): number => {
  let best = minPx;
  let lo = minPx;
  let hi = maxPx;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
};
