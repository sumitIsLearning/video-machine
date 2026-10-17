import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type ExportAdapter, type Script, ScriptSchema, type Timing, TimingSchema } from '../../../contracts/types';
import { InputError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { deliverStageOf } from '../../../core/paths';

/** The longest cue text, in characters: two lines of a reel caption read comfortably at this length. */
export const MAX_CUE_CHARS = 42;

type Cue = { start: number; end: number; text: string };
type TimingLine = Timing['lines'][number];

/** `HH:MM:SS,mmm` for a time in seconds. Rounds to whole milliseconds, as SRT needs. */
const stamp = (t: number): string => {
  const ms = Math.round(t * 1000);
  const parts = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60];
  return `${parts.map((p) => String(p).padStart(2, '0')).join(':')},${String(ms % 1000).padStart(3, '0')}`;
};

/** Greedy word groups of at most MAX_CUE_CHARS each, as [first, one past last] word indexes. A longer word stands alone. */
const groupsOf = (words: string[]): [number, number][] => {
  const groups: [number, number][] = [];
  words.forEach((_word, i) => {
    const last = groups.at(-1);
    if (last && words.slice(last[0], i + 1).join(' ').length <= MAX_CUE_CHARS) last[1] = i + 1;
    else groups.push([i, i + 1]);
  });
  return groups;
};

/**
 * The cues of one timing line. When the script text and the timing have the same word count, a cue takes its
 * words' own times. Otherwise (the aligner merged or split words) it takes a share of the line in proportion to
 * its characters, because the words cannot be matched up.
 */
const cuesOf = (text: string, line: TimingLine): Cue[] => {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const joined = words.join(' ');
  const exact = words.length === line.words.length;
  return groupsOf(words).map(([a, b]) => {
    const first = line.words[a];
    const last = line.words[b - 1];
    const chunk = words.slice(a, b).join(' ');
    if (exact && first && last) return { start: first.start, end: last.end, text: chunk };
    const off = words.slice(0, a).reduce((n, w) => n + w.length + 1, 0);
    const span = line.end - line.start;
    return {
      start: line.start + (span * off) / joined.length,
      end: line.start + (span * (off + chunk.length)) / joined.length,
      text: chunk,
    };
  });
};

/** The script text of a timing line: matched by id, or by position when the timing line has no id. */
const textOf = (script: Script, line: TimingLine, k: number): string => {
  const found = line.id === undefined ? script.lines[k] : script.lines.find((l) => l.id === line.id);
  if (!found) throw new InputError(`timing line ${line.id ?? k} is not in script.json: align again`);
  return found.text;
};

/**
 * The SRT text of a script and its timing: numbered cues, blank line between, one trailing newline.
 * Returns the text. Throws InputError when a timing line has no matching script line.
 */
export function srtOf(script: Script, timing: Timing): string {
  const cues = timing.lines.flatMap((line, k) => cuesOf(textOf(script, line, k), line));
  return `${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n')}\n`;
}

/**
 * The SRT export adapter. It writes captions.srt into the format's staging folder and returns its path.
 * Throws InputError for a deliverable that is not kind 'srt', and ContractError for a bad script or timing file.
 */
export const srtExport = (): ExportAdapter => ({
  kind: 'srt',
  async export(runDir, d) {
    if (d.kind !== 'srt') throw new InputError(`srtExport cannot make ${d.kind}; use the adapter for that kind`);
    const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
    const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
    const dir = deliverStageOf(runDir, d.format);
    mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, 'captions.srt.tmp');
    const file = path.join(dir, 'captions.srt');
    writeFileSync(tmp, srtOf(script, timing));
    renameSync(tmp, file);
    return file;
  },
});
