import type { CheckResult, Script } from '../contracts/types';

/**
 * Checks that every script line stating a number cites a URL listed in research.md.
 * Returns a blocking CheckResult; never throws.
 */
export const checkFactsCited = (script: Script, researchUrls: string[]): CheckResult => {
  const annotations: CheckResult['annotations'] = [];
  for (const line of script.lines) {
    const states = [line.text, line.spoken, line.on_screen].some((s) => s !== undefined && /\d/.test(s));
    const cites = line.cite ?? [];
    if (states && cites.length === 0) {
      annotations.push({
        problem: `line ${line.id} states a number but has no cite`,
        suggested_fix: 'add a cite URL from research.md, or drop the number',
      });
    }
    for (const url of cites) {
      if (!researchUrls.includes(url)) {
        annotations.push({
          problem: `line ${line.id} cites ${url}, which research.md does not list`,
          suggested_fix: 'cite a URL listed in research.md',
        });
      }
    }
  }
  const failed = annotations.length > 0;
  return {
    id: 'script.facts_cited',
    blocking: true,
    status: failed ? 'fail' : 'pass',
    detail: failed ? `${annotations.length} problem(s)` : 'every line with a number cites research.md',
    annotations,
  };
};
