// M11: makes avatar/, one matted talking clip per avatar segment, in one step (R1, R4, R8, R10).
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { heygen } from '../adapters/avatar/heygen';
import { suppliedAvatar } from '../adapters/avatar/supplied';
import { removeBackground } from '../adapters/render/hyperframes/matte';
import {
  type AvatarAdapter,
  type AvatarSegments,
  AvatarSegmentsSchema,
  type Brief,
  BriefSchema,
  ScriptSchema,
  TimingSchema,
} from '../contracts/types';
import { type AvatarSpan, avatarSegments } from '../core/avatar';
import type { Env } from '../core/config';
import { costGate } from '../core/cost';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { runFileOf } from '../core/paths';

export type MakeIo = {
  deps?: Deps;
  adapter?: AvatarAdapter;
  matte?: typeof removeBackground;
  approved_usd?: number;
  env?: Env;
};

/** The adapter the brief names: `supplied` cuts the creator's clip, `heygen` needs HEYGEN_API_KEY. Throws InputError or UnsupportedError. */
const adapterOf = (runDir: string, avatar: NonNullable<Brief['avatar']>, deps: Deps, env: Env): AvatarAdapter => {
  if (avatar.source === 'supplied') return suppliedAvatar(deps, runFileOf(runDir, avatar.clip));
  if (avatar.adapter === 'heygen') {
    const apiKey = env.HEYGEN_API_KEY;
    if (!apiKey) throw new UnsupportedError('set HEYGEN_API_KEY to use HeyGen');
    return heygen({ apiKey, portrait: runFileOf(runDir, avatar.portrait) });
  }
  throw new UnsupportedError(`avatar adapter "${avatar.adapter}" is not available; use heygen or a supplied clip`);
};

/**
 * Make avatar/ for a voiceover run: cut each avatar segment from the voiceover, make its clip, matte it, and write
 * segments.json. The cost gate runs before anything is cut or sent. avatar.tmp is built first and renamed into place
 * only when every segment is done, so a failure leaves the previous avatar/ alone. Throws InputError (no avatar in the
 * brief, no voice yet, no avatar lines, over budget, a bad clip path), UnsupportedError (text_only or music runs,
 * unknown adapter, no HeyGen key), or the adapter's and the tools' own errors.
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
  const spans = avatarSegments(script, readJson(timingFile, TimingSchema));
  if (spans.length === 0) throw new InputError('no script line has delivery "avatar"');

  const deps = io.deps ?? defaultDeps();
  const adapter = io.adapter ?? adapterOf(runDir, brief.avatar, deps, io.env ?? process.env);
  const { total_usd, ok } = costGate(
    spans.map((s: AvatarSpan) => ({
      what: `avatar ${s.seg} (${adapter.name})`,
      usd: adapter.costEstimate(s.end - s.start),
    })),
    brief.budget_usd,
    io.approved_usd ?? 0,
  );
  if (!ok)
    throw new InputError(
      `the avatar costs $${total_usd.toFixed(2)} and the budget is $${brief.budget_usd.toFixed(2)}; ask the creator, then re-run with --approve-spend ${total_usd}`,
    );

  const avatarDir = path.join(runDir, 'avatar');
  const tmp = path.join(runDir, 'avatar.tmp');
  const matte = io.matte ?? removeBackground;
  rmSync(tmp, { recursive: true, force: true });
  try {
    mkdirSync(tmp);
    const segments: AvatarSegments['segments'] = [];
    for (const span of spans) {
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
          span.end.toFixed(3),
          '-i',
          audio,
          '-c:a',
          'pcm_s16le',
          wav,
        ],
        { env: deps.config.toolEnv },
      );
      await adapter.make({ seg: span.seg, start: span.start, end: span.end, audio: wav }, raw);
      await matte(deps, raw, webm);
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
    rmSync(avatarDir, { recursive: true, force: true });
    renameSync(tmp, avatarDir);
    return { adapter: adapter.name, usd: total_usd, segments };
  } catch (cause) {
    rmSync(tmp, { recursive: true, force: true });
    throw cause;
  }
};
