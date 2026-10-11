import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { type NavFrames, NavFramesSchema } from '../contracts/types';
import { HF_CMD } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { writeJson } from '../core/json';
import { relInside, runFileOf } from '../core/paths';
import { assertRunDir, slugOf } from '../run/intake';

// A page navigation scores 0.06-0.09 on a real screen recording (probed), so the usual 0.3 finds nothing.
export const NAV_SCENE_THRESHOLD = 0.05;
export const NAV_EVERY_S = 2;
export const NAV_MIN_GAP_S = 0.5;
const SHEET_TILES = 12; // the sheets are tiled 4x3

/**
 * What the `metadata=print` scan wrote to stderr (`pts_time:<t>` then `lavfi.scene_score=<s>` per frame):
 * the scene-change times (score above the threshold) and the last frame time.
 */
const readScan = (stderr: string): { scenes: number[]; last: number } => {
  const scenes: number[] = [];
  let last = 0;
  let t = Number.NaN;
  for (const line of stderr.split(/\r?\n/)) {
    // a stream can start at a small negative time
    const pts = /pts_time:(-?[\d.]+)/.exec(line)?.[1];
    if (pts !== undefined) t = Math.max(0, Number(pts));
    const score = Number(/lavfi\.scene_score=([\d.]+)/.exec(line)?.[1]);
    if (!Number.isFinite(t) || !Number.isFinite(score)) continue;
    last = Math.max(last, t);
    if (score > NAV_SCENE_THRESHOLD) scenes.push(t);
  }
  return { scenes, last };
};

/** The times to grab: scene changes plus a frame every 2 s, in order, each at least 0.5 s after the last one kept. */
const frameTimes = (duration: number, scenes: number[]): number[] => {
  const every = Array.from({ length: Math.ceil(duration / NAV_EVERY_S) }, (_, k) => k * NAV_EVERY_S);
  const kept: number[] = [];
  for (const t of [...every, ...scenes].sort((a, b) => a - b))
    if (kept.length === 0 || t - (kept.at(-1) ?? 0) >= NAV_MIN_GAP_S - 1e-9) kept.push(t);
  return kept;
};

/**
 * Read a navigation video into numbered frames and contact sheets under `capture/nav/<slug>-<hash of source>/`, plus a
 * transcript when it has audio, and record them in `frames.json`. A second read of the same video replaces the first;
 * a different video never shares its folder.
 * Returns the record (run-relative POSIX paths). Throws InputError (not a run, `source` not a file inside the run, no
 * readable length, or `capture/nav` leading outside the run) and ToolError (ffmpeg or HyperFrames failed or wrote nothing).
 */
export async function readNavVideo(deps: Deps, runDir: string, source: string): Promise<NavFrames> {
  assertRunDir(runDir);
  const file = path.resolve(runFileOf(runDir, source));
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 8);
  const rel = `capture/nav/${slugOf(path.parse(source).name)}-${hash}`;
  const dir = path.resolve(runDir, ...rel.split('/'));
  const run = (cmd: string[], cwd?: string) => deps.sh(cmd, { env: deps.config.toolEnv, cwd });

  const scan = readScan(
    (
      await run([
        'ffmpeg',
        '-hide_banner',
        '-i',
        file,
        '-vf',
        "select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
        '-f',
        'null',
        '-',
      ])
    ).stderr,
  );
  // A streamed recording (MediaRecorder, piped) has no container duration: ffprobe prints N/A.
  const probed = Number(
    (await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).stdout,
  );
  const duration = probed > 0 ? probed : scan.last;
  if (!(duration > 0)) throw new InputError(`${source} has no readable duration; is it a video?`);
  const hasAudio =
    (
      await run([
        'ffprobe',
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        file,
      ])
    ).stdout.trim() !== '';
  const times = frameTimes(duration, scan.scenes);

  // The delete below follows links, so the parent must really be inside the run.
  mkdirSync(path.dirname(dir), { recursive: true });
  if (relInside(realpathSync.native(runDir), realpathSync.native(path.dirname(dir))) === undefined)
    throw new InputError(`capture/nav resolves outside the run folder; refusing to write ${rel}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'frames'), { recursive: true });
  const name = (i: number) => String(i).padStart(3, '0');
  for (const [i, t] of times.entries()) {
    const out = `frames/${name(i)}.png`;
    // relative patterns from the nav folder: a "%" in the run path can't confuse ffmpeg
    const cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', out];
    await run(cmd, dir);
    // ffmpeg exits 0 and writes nothing when -ss is past the end
    if (!existsSync(path.join(dir, out)))
      throw new ToolError({ cmd, code: 0, stderr: `no frame at t=${t} s in ${source}` });
  }
  const sheets = Array.from(
    { length: Math.ceil(times.length / SHEET_TILES) },
    (_, k) => `sheet-${String(k + 1).padStart(2, '0')}.jpg`,
  );
  const tile = [
    'ffmpeg',
    '-v',
    'error',
    '-y',
    '-i',
    'frames/%03d.png',
    '-vf',
    'scale=480:-1,tile=4x3',
    'sheet-%02d.jpg',
  ];
  await run(tile, dir);
  for (const sheet of sheets)
    if (!existsSync(path.join(dir, sheet))) throw new ToolError({ cmd: tile, code: 0, stderr: `no ${sheet} written` });

  let transcript: string | undefined;
  if (hasAudio) {
    // `hyperframes transcribe` fails on a file with no audio stream, so only a video that has audio gets here.
    const cmd = [...HF_CMD, 'transcribe', file, '-d', dir, '--json'];
    await run(cmd);
    if (!existsSync(path.join(dir, 'transcript.json')))
      throw new ToolError({ cmd, code: 0, stderr: `transcribing ${source} wrote no transcript.json` });
    transcript = `${rel}/transcript.json`;
  }

  return writeJson(path.join(dir, 'frames.json'), NavFramesSchema, {
    source,
    has_audio: hasAudio,
    frames: times.map((t, i) => ({ i, t, path: `${rel}/frames/${name(i)}.png` })),
    sheets: sheets.map((s) => `${rel}/${s}`),
    transcript,
  });
}
