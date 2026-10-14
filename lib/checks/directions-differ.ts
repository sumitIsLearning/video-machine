import type { CheckResult, Look } from '../contracts/types';

const sameSet = (a: string[], b: string[]): boolean => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Checks that two look directions differ enough: 2 of palette, type, motion and motifs, or motion and motifs
 * both when the brand fixes palette or type. Returns a blocking CheckResult; never throws.
 */
export const checkDirectionsDiffer = (a: Look, b: Look, brandFixed: boolean): CheckResult => {
  const differs = {
    palette: !sameSet(
      a.palette.map((p) => p.hex.toLowerCase()),
      b.palette.map((p) => p.hex.toLowerCase()),
    ),
    type: !sameSet(
      a.type.map((t) => norm(t.family)),
      b.type.map((t) => norm(t.family)),
    ),
    motion: norm(a.motion.character) !== norm(b.motion.character) || !sameSet(a.motion.easings, b.motion.easings),
    motifs: !sameSet(
      a.motifs.map((m) => m.id),
      b.motifs.map((m) => m.id),
    ),
  };
  const names = Object.keys(differs).filter((k) => differs[k as keyof typeof differs]);
  const yes = (v: boolean): string => (v ? 'yes' : 'no');

  let pass: boolean;
  let detail: string;
  if (brandFixed) {
    pass = differs.motion && differs.motifs;
    detail = `brand fixes palette or type; motion ${yes(differs.motion)}, motifs ${yes(differs.motifs)} differ; need both`;
  } else {
    pass = names.length >= 2;
    detail = `A and B differ in ${names.length} of palette, type, motion, motifs (${names.join(', ') || 'none'}); need 2`;
  }
  return {
    id: 'look.directions_differ',
    blocking: true,
    status: pass ? 'pass' : 'fail',
    detail,
    annotations: pass
      ? []
      : [{ problem: detail, suggested_fix: 'change direction B in more of palette, type, motion, motifs' }],
  };
};
