import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type Brief, BriefSchema, DEFAULT_VOICE, DURATION_DEFAULTS, type FormatId } from '../contracts/types';
import { ContractError, InputError } from '../core/errors';
import { writeJson } from '../core/json';

const stripBom = (s: string) => s.replace(/^\u{FEFF}/u, '');

/** A short folder-name slug: the first five plain words of the text, joined with "-", at most 40 characters. Returns "video" when no word is left. */
export function slugOf(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5);
  return words.join('-').slice(0, 40).replace(/-+$/, '') || 'video';
}

/**
 * Make `runs/<date>-<slug>/` holding the concept byte for byte, plus an empty `input/`.
 * Returns the run id and folder. Throws InputError for an empty concept (nothing is made then).
 */
export function newRun(o: { runsDir: string; concept: Uint8Array; now?: Date }): { run_id: string; runDir: string } {
  const text = stripBom(new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(o.concept));
  if (text.trim() === '') throw new InputError('the concept is empty; concept.md is the one required input');
  mkdirSync(o.runsDir, { recursive: true });
  const base = `${(o.now ?? new Date()).toISOString().slice(0, 10)}-${slugOf(text)}`;
  for (let n = 1; ; n++) {
    const run_id = n === 1 ? base : `${base}-${n}`;
    const runDir = path.join(o.runsDir, run_id);
    try {
      mkdirSync(runDir); // not recursive: an existing folder is never reused
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw cause;
    }
    try {
      writeFileSync(path.join(runDir, 'concept.md'), o.concept);
      mkdirSync(path.join(runDir, 'input'));
    } catch (cause) {
      // a half-made folder has no concept.md and would block this name for nothing
      rmSync(runDir, { recursive: true, force: true });
      throw cause;
    }
    return { run_id, runDir };
  }
}

// The path of `target` relative to `base`, or undefined when it is outside. Both must be real paths.
const relInside = (base: string, target: string): string | undefined => {
  const rel = path.relative(base, target);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? undefined : rel;
};

/** Check that the folder is a run. Throws InputError when it has no concept.md. */
export function assertRunDir(runDir: string): void {
  if (!existsSync(path.join(runDir, 'concept.md')))
    throw new InputError(`${runDir} is not a run folder (no concept.md)`);
}

/**
 * Copy the creator's files into `input/` (a name that is taken gets `-2`, `-3`, ...).
 * Returns each file's run path; a file already inside the run folder is not copied.
 * Throws InputError for a missing file, a folder, or a folder that is not a run.
 */
export function importFiles(runDir: string, files: string[]): string[] {
  assertRunDir(runDir);
  const realRun = realpathSync.native(runDir);
  // Validate everything before copying anything: a bad list imports nothing.
  const checked = files.map((file) => {
    const src = path.resolve(file);
    if (!existsSync(src)) throw new InputError(`file not found: ${file}`);
    if (statSync(src).isDirectory()) throw new InputError(`${file} is a folder; hand over files`);
    if (/[:\\]/.test(path.basename(src)))
      throw new InputError(`${file} has ":" or "\\" in its name; rename it before importing`);
    // Real paths, so a junction or symlink inside the run folder can't smuggle in a file from outside.
    const real = realpathSync.native(src);
    return { src, rel: relInside(realRun, real) };
  });
  return checked.map(({ src, rel }) => {
    if (rel !== undefined) return rel.split(path.sep).join('/');
    const { name, ext } = path.parse(src);
    for (let n = 1; ; n++) {
      const target = n === 1 ? `${name}${ext}` : `${name}-${n}${ext}`;
      try {
        copyFileSync(src, path.join(runDir, 'input', target), constants.COPYFILE_EXCL);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw cause;
      }
      return `input/${target}`;
    }
  });
}

/** Every run path the brief names (sources, supplied voice and music, avatar portrait, logo, font files). */
export function briefPaths(b: Brief): string[] {
  const paths = [
    ...b.sources.flatMap((s) => (s.kind === 'nav_video' || s.kind === 'file' ? [s.path_or_url] : [])),
    b.voice?.source === 'supplied' ? b.voice.path : undefined,
    b.music?.source === 'supplied' ? b.music.path : undefined,
    b.avatar?.portrait,
    b.brand?.logo,
    ...(b.brand?.fonts ?? []).map((f) => f.path),
  ];
  return paths.filter((p): p is string => p !== undefined);
}

/**
 * Fill the intake defaults into a draft, validate it, and write `brief.json`.
 * Returns the brief. Throws InputError (not a run, bad draft, no default length, a named file is missing)
 * or ContractError (the draft does not match the brief schema); nothing is written then.
 */
export function writeBrief(runDir: string, draft: unknown): Brief {
  assertRunDir(runDir);
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft))
    throw new InputError('the brief draft must be a JSON object');
  const d = draft as Record<string, unknown>;
  const run_id = path.basename(path.resolve(runDir));
  if (d.run_id !== undefined && d.run_id !== run_id)
    throw new InputError(`the draft names run "${String(d.run_id)}" but this folder is run "${run_id}"`);

  const formats = Array.isArray(d.formats) && d.formats.length > 0 ? d.formats : ['reel'];
  const duration_target_s = d.duration_target_s ?? DURATION_DEFAULTS[formats[0] as FormatId];
  if (duration_target_s === undefined)
    throw new InputError(`no default length for format "${formats[0]}"; ask the creator for duration_target_s`);

  const timing_source = d.timing_source ?? 'voiceover';
  const firstLine = stripBom(readFileSync(path.join(runDir, 'concept.md'), 'utf8'))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '');
  const filled = {
    ...d,
    run_id,
    formats,
    duration_target_s,
    timing_source,
    goals: d.goals ?? [],
    concept: d.concept ?? (firstLine === undefined ? undefined : Array.from(firstLine).slice(0, 200).join('')),
    ...(timing_source === 'voiceover' && d.voice === undefined ? { voice: DEFAULT_VOICE } : {}),
  };
  const r = BriefSchema.safeParse(filled);
  if (!r.success)
    throw new ContractError(`brief draft for ${runDir} does not match the brief schema:\n${z.prettifyError(r.error)}`);

  const realRun = realpathSync.native(runDir);
  for (const p of briefPaths(r.data)) {
    const file = path.join(runDir, p);
    if (!existsSync(file) || !statSync(file).isFile())
      throw new InputError(`the brief names ${p}, which is not in the run folder; import it first`);
    if (relInside(realRun, realpathSync.native(file)) === undefined)
      throw new InputError(`the brief names ${p}, which resolves outside the run folder`);
  }
  return writeJson(path.join(runDir, 'brief.json'), BriefSchema, r.data);
}
