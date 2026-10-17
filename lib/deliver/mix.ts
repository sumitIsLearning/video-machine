import { existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AssetsSchema, type Brief, BriefSchema, PlanSchema, TimingSchema } from '../contracts/types';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { readJson } from '../core/json';
import { loudnessOf } from '../core/media';
import { runFileOf } from '../core/paths';
import { sceneTimes } from '../core/scene-times';

/** Ten minutes, the same ceiling the other ffmpeg calls use: a hang is a fault, not a slow mix. */
const FFMPEG_TIMEOUT_MS = 600_000;
/** The music bed sits under the voice at this gain (dB) before the sidechain ducks it. */
export const MUSIC_GAIN_DB = -12;
/** The integrated loudness, true peak and loudness range the reel is normalised to (EBU R128 streaming target). */
export const LOUDNESS = { I: -14, TP: -1.5, LRA: 11 } as const;

export type MixResult = { mix: 'audio/mix.wav'; music: string | null; i: number; tp: number; duration: number };

/** The numbers loudnorm's first pass prints as one JSON block on stderr. */
const Pass1Schema = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  target_offset: z.string(),
});

/**
 * The run path of the music bed, or null for voice only. A supplied track wins; otherwise the one pinned audio asset
 * in assets.json is the music. Never searches the web. Throws InputError for two pinned audio assets or a pinned
 * asset whose licence is unknown.
 */
const musicPathOf = (runDir: string, brief: Brief): string | null => {
  if (brief.music?.source === 'supplied') return brief.music.path;
  const poolFile = path.join(runDir, 'assets.json');
  if (!existsSync(poolFile)) return null;
  const pool = readJson(poolFile, AssetsSchema);
  const pinned = pool.assets.filter((a) => a.kind === 'audio' && a.status === 'pinned');
  if (pinned.length > 1)
    throw new InputError(`${pinned.length} audio assets are pinned in assets.json; pin one music track or none`);
  const [one] = pinned;
  if (one === undefined) return null;
  if (one.license === 'unknown')
    throw new InputError(`${one.asset_id} is pinned with an unknown licence; give the music a known licence`);
  return one.path;
};

/** The first-pass loudnorm numbers, parsed from the last JSON block of ffmpeg's stderr. Throws ToolError if absent. */
const pass1Of = (cmd: string[], stderr: string): z.infer<typeof Pass1Schema> => {
  const block = stderr.match(/\{[^{}]*\}/g)?.at(-1);
  if (block === undefined) throw new ToolError({ cmd, code: 0, stderr });
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch (cause) {
    throw new ToolError({ cmd, code: 0, stderr }, { cause });
  }
  const parsed = Pass1Schema.safeParse(json);
  if (!parsed.success) throw new ToolError({ cmd, code: 0, stderr }, { cause: parsed.error });
  return parsed.data;
};

/** The pre-mix filter graph: the voice padded to the reel length, with the music ducked under it when there is music. */
const preGraph = (T: number, music: boolean): string =>
  music
    ? `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${T},afade=t=in:d=0.5,afade=t=out:st=${T - 1}:d=1,volume=${MUSIC_GAIN_DB}dB[m];[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${T},asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[d];[v][d]amix=inputs=2:normalize=0[mix]`
    : `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${T},atrim=0:${T}[mix]`;

/**
 * Mix the voice and the music bed into `audio/mix.wav` at the reel length, normalised to LOUDNESS in two loudnorm passes.
 * The mix is written to a temp name and renamed only when complete; the temp files are removed either way. Throws
 * InputError when the voice is missing or the music choice is ambiguous, and ToolError when an ffmpeg pass fails.
 */
export async function mixSound(deps: Deps, runDir: string): Promise<MixResult> {
  const vo = path.join(runDir, 'audio', 'vo.wav');
  if (!existsSync(vo)) throw new InputError(`${vo} is missing: voice the script first`);
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
  const music = musicPathOf(runDir, brief);
  const musicFile = music === null ? null : runFileOf(runDir, music);
  const T = Math.max(...sceneTimes(plan, timing).map((t) => t.start + t.duration));
  const mix = path.join(runDir, 'audio', 'mix.wav');
  const pre = path.join(runDir, 'audio', '.mix.pre.wav');
  const tmp = path.join(runDir, 'audio', '.mix.tmp.wav');
  rmSync(mix, { force: true });
  try {
    const preCmd = [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-i',
      vo,
      ...(musicFile === null ? [] : ['-stream_loop', '-1', '-i', musicFile]),
      '-filter_complex',
      preGraph(T, musicFile !== null),
      '-map',
      '[mix]',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      pre,
    ];
    await deps.sh(preCmd, { timeoutMs: FFMPEG_TIMEOUT_MS });

    const pass1 = [
      'ffmpeg',
      '-hide_banner',
      '-nostats',
      '-i',
      pre,
      '-af',
      `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`,
      '-f',
      'null',
      '-',
    ];
    const measured = pass1Of(pass1, (await deps.sh(pass1, { timeoutMs: FFMPEG_TIMEOUT_MS })).stderr);

    const pass2 = [
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-i',
      pre,
      '-af',
      `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`,
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      tmp,
    ];
    await deps.sh(pass2, { timeoutMs: FFMPEG_TIMEOUT_MS });

    // Measure the temp file before the rename, so a failed measurement never leaves a mix.wav that looks finished.
    const { i, tp } = await loudnessOf(deps, tmp);
    renameSync(tmp, mix);
    return { mix: 'audio/mix.wav', music, i, tp, duration: T };
  } finally {
    rmSync(pre, { force: true });
    rmSync(tmp, { force: true });
  }
}
