import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { InputError } from '../core/errors';
import { assertRunDir } from '../run/intake';

export type ResearchFact = { fact: string; quote: string; url: string };

const FACT_LINE = /^- (.+?) (?:—|-) "(.+)" (?:—|-) (\S+)\s*$/;

/**
 * Read `research.md`: the facts under "## Facts" (each with a verbatim quote and a source URL) and every URL in the file.
 * Every non-blank line under "## Facts" must be a fact. Returns both, URLs in first-seen order. Throws InputError when
 * "## Facts" is missing or empty, or a line under it is not a well-formed fact (the message names the line).
 */
export function parseResearch(md: string): { facts: ResearchFact[]; urls: string[] } {
  const facts: ResearchFact[] = [];
  let inFacts = false;
  for (const [k, line] of md.split(/\r?\n/).entries()) {
    if (/^## /.test(line)) {
      inFacts = /^## facts\s*$/i.test(line);
      continue;
    }
    if (!inFacts || line.trim() === '') continue;
    const [, fact = '', quote = '', url = ''] = FACT_LINE.exec(line) ?? [];
    if (!fact.trim() || !quote.trim() || !/^https?:$/.test(URL.canParse(url) ? new URL(url).protocol : ''))
      throw new InputError(`research.md line ${k + 1}: a fact needs: - <fact> — "<verbatim quote>" — <https URL>`);
    facts.push({ fact: fact.trim(), quote: quote.trim(), url });
  }
  if (facts.length === 0) throw new InputError('research.md needs a "## Facts" section with at least one fact');
  const found = md.matchAll(/https?:\/\/[^\s<>"'()[\]*]+/g);
  const urls = [...new Set([...found].map((m) => m[0].replace(/[.,;:]+$/, '')))];
  return { facts, urls };
}

/**
 * Check `research.md` and store it in the run folder byte for byte.
 * Returns the fact count and the URLs. Throws InputError for a non-run folder or a research file that fails `parseResearch`.
 */
export function writeResearch(runDir: string, md: string): { facts: number; urls: string[] } {
  assertRunDir(runDir);
  const { facts, urls } = parseResearch(md);
  writeFileSync(path.join(runDir, 'research.md'), md);
  return { facts: facts.length, urls };
}
