// Avatar source `supplied`: the creator's own talking clip. One clip runs along the whole voiceover (U2); each
// segment is a window cut out of it (R4). Costs nothing and never uses the segment's audio.

import { renameSync, rmSync } from 'node:fs';
import type { AvatarAdapter, AvatarJob } from '../../../contracts/types';
import type { Deps } from '../../../core/deps';
import { InputError } from '../../../core/errors';
import { type MediaProbe, probeMedia } from '../../../core/media';

// ponytail: a clip that is 50 ms short still counts as long enough, so ffprobe's rounding cannot reject a good clip.
const DURATION_SLACK_S = 0.05;

/**
 * Build the `supplied` avatar adapter for the clip at `clip`. `make` cuts `[start, end]` out of the clip into `out`
 * (no audio) and resolves to `out`. Throws InputError when the clip ends before a segment does; an ffmpeg failure
 * is rethrown and no partial file is left behind.
 */
export const suppliedAvatar = (deps: Deps, clip: string): AvatarAdapter => {
  let probe: Promise<MediaProbe | undefined> | undefined;
  const probed = () => {
    probe ??= probeMedia(deps, clip);
    return probe;
  };

  return {
    name: 'supplied',
    costEstimate: () => 0,
    async make(job: AvatarJob, out: string): Promise<string> {
      const info = await probed();
      if (info === undefined) {
        throw new InputError(`cannot read the avatar clip ${clip}: check the path and that it is a video`);
      }
      if (info.duration + DURATION_SLACK_S < job.end) {
        throw new InputError(
          `the avatar clip runs ${info.duration}s but ${job.seg} ends at ${job.end}s: supply a clip that runs along the whole voiceover`,
        );
      }
      const part = `${out}.part.mp4`;
      try {
        await deps.sh(
          [
            'ffmpeg',
            '-v',
            'error',
            '-y',
            '-ss',
            job.start.toFixed(3),
            '-to',
            job.end.toFixed(3),
            '-i',
            clip,
            '-an',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            part,
          ],
          { env: deps.config.toolEnv },
        );
      } catch (cause) {
        rmSync(part, { force: true });
        throw cause;
      }
      renameSync(part, out);
      return out;
    },
  };
};
