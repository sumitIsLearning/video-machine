import { z } from 'zod';
import type { Deps } from './deps';
import { ToolError } from './errors';

export type Loudness = { i: number; tp: number };
export type MediaProbe = {
  duration: number;
  video?: { codec: string; profile?: string; w: number; h: number; fps: number; pix_fmt?: string };
  audio?: { codec: string; sample_rate: number; channels: number };
  subtitle?: { codec: string };
};

const LOUDNESS_TIMEOUT_MS = 600_000;
const PROBE_TIMEOUT_MS = 60_000;

// ponytail: unknown keys are ignored and every field is optional, so a stream type this file does not
// map (data, attachment) cannot break the parse.
const ProbeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string().optional(),
      codec_name: z.string().optional(),
      profile: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      pix_fmt: z.string().optional(),
      r_frame_rate: z.string().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().optional(),
    }),
  ),
  format: z.object({ duration: z.string().optional() }).optional(),
});

/**
 * Measure integrated loudness (LUFS) and true peak (dBFS) of a file with ffmpeg's ebur128 filter.
 * Returns the values from the summary; throws `ToolError` when the run fails or the summary is missing.
 */
export const loudnessOf = async (deps: Deps, file: string): Promise<Loudness> => {
  const cmd = ['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'];
  // ffmpeg prints the per-frame lines first; only the text after the last "Summary:" holds the totals.
  const { stderr } = await deps.sh(cmd, { timeoutMs: LOUDNESS_TIMEOUT_MS });
  const at = stderr.lastIndexOf('Summary:');
  const summary = at < 0 ? '' : stderr.slice(at);
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(summary);
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  if (!i || !peak) throw new ToolError({ cmd, code: 0, stderr });
  return { i: Number(i[1]), tp: peak[1] === '-inf' ? -Infinity : Number(peak[1]) };
};

/**
 * Read the first video, audio and subtitle streams and the duration of a media file with ffprobe.
 * Returns `undefined` when ffprobe cannot read the file; throws only when its output is not the expected JSON.
 */
export const probeMedia = async (deps: Deps, file: string): Promise<MediaProbe | undefined> => {
  const cmd = [
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,sample_rate,channels:format=duration',
    '-of',
    'json',
    file,
  ];
  const r = await deps.sh(cmd, { allowFail: true, timeoutMs: PROBE_TIMEOUT_MS });
  if (r.code !== 0) return undefined;
  const { streams, format } = ProbeSchema.parse(JSON.parse(r.stdout));
  const duration = Number(format?.duration);
  const probe: MediaProbe = { duration: Number.isFinite(duration) ? duration : 0 };

  const v = streams.find((s) => s.codec_type === 'video');
  if (v) {
    const [num, den] = (v.r_frame_rate ?? '0/1').split('/').map(Number);
    probe.video = {
      codec: v.codec_name ?? '',
      w: v.width ?? 0,
      h: v.height ?? 0,
      fps: num && den ? num / den : 0,
      ...(v.profile !== undefined && { profile: v.profile }),
      ...(v.pix_fmt !== undefined && { pix_fmt: v.pix_fmt }),
    };
  }
  const a = streams.find((s) => s.codec_type === 'audio');
  if (a) {
    probe.audio = { codec: a.codec_name ?? '', sample_rate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0 };
  }
  const s = streams.find((st) => st.codec_type === 'subtitle');
  if (s) probe.subtitle = { codec: s.codec_name ?? '' };
  return probe;
};
