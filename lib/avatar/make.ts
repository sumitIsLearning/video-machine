// M11: makes avatar/, one matted talking clip per avatar segment, in one step (R1, R4, R8, R10).
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { heygen } from '../adapters/avatar/heygen';
import { suppliedAvatar } from '../adapters/avatar/supplied';
import { removeBackground } from '../adapters/render/hyperframes/matte';
import {
  type AvatarAdapter,
  AvatarPlacementSchema,
  type AvatarSegments,
  AvatarSegmentsSchema,
  type Brief,
  BriefSchema,
  PlanSchema,
  ScriptSchema,
  TimingSchema,
} from '../contracts/types';
import { type AvatarSpan, avatarSegments, presetBox, stackSpans } from '../core/avatar';
import { costGate, recordSpend, spentOf } from '../core/cost';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { probeMedia } from '../core/media';
import { runFileOf } from '../core/paths';

export type MakeIo = {
  deps?: Deps;
  adapter?: AvatarAdapter;
  matte?: typeof removeBackground;
  approved_usd?: number;
};

/** The adapter the brief names: `supplied` cuts the creator's clip, `heygen` needs HEYGEN_API_KEY. Throws InputError or UnsupportedError. */
const adapterOf = (runDir: string, avatar: NonNullable<Brief['avatar']>, deps: Deps): AvatarAdapter => {
  if (avatar.source === 'supplied') return suppliedAvatar(deps, runFileOf(runDir, avatar.clip));
  if (avatar.adapter === 'heygen') {
    const apiKey = deps.config.heygenApiKey;
    if (!apiKey) throw new UnsupportedError('set HEYGEN_API_KEY to use HeyGen');
    return heygen({ apiKey, portrait: runFileOf(runDir, avatar.portrait) });
  }
  throw new UnsupportedError(`avatar adapter "${avatar.adapter}" is not available; use heygen or a supplied clip`);
};

/**
 * Make avatar/ for a voiceover run: cut each avatar segment from the voiceover, make its clip, matte it, and write
 * segments.json. The cost gate runs before anything is cut or sent. avatar.tmp is built first and renamed into place
 * only when every segment is done, so a failure leaves the previous avatar/ alone. A `stack` layout takes spans from
 * the scene windows, transcodes instead of matting, and writes placement.json (all `stack`); it needs plan.json.
 * Throws InputError (no avatar in the brief, no voice yet, no avatar lines, over budget, a bad clip path), UnsupportedError
 * (text_only or music runs, unknown adapter, no HeyGen key), or the adapter's and the tools' own errors.
 */
export const makeAvatar = async (
  runDir: string,
  io: MakeIo = {},
): Promise<{ adapter: string; usd: number; segments: AvatarSegments['segments'] }> => {
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  if (brief.avatar === undefined) throw new InputError('the brief asks for no avatar');
  if (brief.timing_source !== 'voiceover')
    throw new UnsupportedError(`this run has no voiceover (timing_source: ${brief.timing_source}), so no avatar`);
  const audio = path.join(runDir, 'audio', 'vo.wav');
  const timingFile = path.join(runDir, 'data', 'timing.json');
  if (!existsSync(audio) || !existsSync(timingFile)) throw new InputError('voice and align first');
  const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
  const timing = readJson(timingFile, TimingSchema);
  const stack = brief.layout?.kind === 'stack';
  let spans: AvatarSpan[];
  if (stack) {
    const planFile = path.join(runDir, 'plan.json');
    if (!existsSync(planFile)) throw new InputError('storyboard first (M8)');
    spans = stackSpans(readJson(planFile, PlanSchema), script, timing);
  } else spans = avatarSegments(script, timing);
  if (spans.length === 0) throw new InputError('no script line has delivery "avatar"');

  const deps = io.deps ?? defaultDeps();
  const adapter = io.adapter ?? adapterOf(runDir, brief.avatar, deps);
  const spent = spentOf(runDir);
  const { total_usd, ok } = costGate(
    spans.map((s: AvatarSpan) => ({
      what: `avatar ${s.seg} (${adapter.name})`,
      usd: adapter.costEstimate(s.end - s.start),
    })),
    brief.budget_usd,
    io.approved_usd ?? 0,
    spent,
  );
  if (!ok)
    throw new InputError(
      `the avatar costs $${total_usd.toFixed(2)}, $${spent.toFixed(2)} is already spent and the budget is $${brief.budget_usd.toFixed(2)}; ask the creator, then re-run with --approve-spend ${total_usd}`,
    );

  const avatarDir = path.join(runDir, 'avatar');
  const tmp = path.join(runDir, 'avatar.tmp');
  const matte = io.matte ?? removeBackground;
  rmSync(tmp, { recursive: true, force: true });
  try {
    mkdirSync(tmp);
    const segments: AvatarSegments['segments'] = [];
    // A stack span can run past the last word; the clip stops at the voice and the video is padded after.
    let voEnd = Number.POSITIVE_INFINITY;
    if (stack) {
      const probe = await probeMedia(deps, audio);
      if (probe === undefined) throw new InputError('audio/vo.wav is unreadable');
      voEnd = probe.duration;
    }
    for (const span of spans) {
      const jobEnd = Math.min(span.end, voEnd);
      const wav = path.join(tmp, `${span.seg}.wav`);
      const raw = path.join(tmp, `${span.seg}.raw.mp4`);
      const webm = path.join(tmp, `${span.seg}.webm`);
      await deps.sh(
        [
          'ffmpeg',
          '-v',
          'error',
          '-y',
          '-ss',
          span.start.toFixed(3),
          '-to',
          jobEnd.toFixed(3),
          '-i',
          audio,
          '-c:a',
          'pcm_s16le',
          wav,
        ],
        { env: deps.config.toolEnv },
      );
      await adapter.make({ seg: span.seg, start: span.start, end: jobEnd, audio: wav }, raw);
      // Recorded per segment: money spent on segment 1 stays on the ledger if segment 2 fails.
      recordSpend(runDir, [
        { what: `avatar ${span.seg} (${adapter.name})`, usd: adapter.costEstimate(span.end - span.start) },
      ]);
      if (stack) {
        const box = presetBox('stack', 'reel', brief.layout?.kind === 'stack' ? brief.layout.split : undefined);
        const pad = span.end - jobEnd;
        const vf = [
          `scale=${box.w}:${box.h}:force_original_aspect_ratio=increase`,
          ...(pad > 0.001 ? [`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`] : []),
        ].join(',');
        await deps.sh(
          [
            'ffmpeg',
            '-v',
            'error',
            '-y',
            '-i',
            raw,
            '-an',
            '-vf',
            vf,
            '-c:v',
            'libvpx-vp9',
            '-b:v',
            '0',
            '-crf',
            '32',
            '-row-mt',
            '1',
            '-deadline',
            'good',
            '-cpu-used',
            '4',
            webm,
          ],
          { env: deps.config.toolEnv },
        );
      } else await matte(deps, raw, webm);
      rmSync(wav, { force: true });
      rmSync(raw, { force: true });
      segments.push({
        seg: span.seg,
        line_ids: span.line_ids,
        start: span.start,
        end: span.end,
        file: `avatar/${span.seg}.webm`,
      });
    }
    writeJson(path.join(tmp, 'segments.json'), AvatarSegmentsSchema, {
      run_id: brief.run_id,
      adapter: adapter.name,
      segments,
    });
    if (stack)
      writeJson(path.join(tmp, 'placement.json'), AvatarPlacementSchema, {
        segments: Object.fromEntries(segments.map((s) => [s.seg, 'stack' as const])),
      });
    rmSync(avatarDir, { recursive: true, force: true });
    renameSync(tmp, avatarDir);
    return { adapter: adapter.name, usd: total_usd, segments };
  } catch (cause) {
    rmSync(tmp, { recursive: true, force: true });
    throw cause;
  }
};
