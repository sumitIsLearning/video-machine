// Voice source `supplied`: the creator's own recording, converted to the run's 48 kHz mono audio/vo.wav.
// Not a VoiceAdapter: a recording has no voice id and costs nothing (R2).

import { mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import { runFileOf } from '../../../core/paths';

// ponytail: a copy of hf-tts's SAMPLE_RATE: adapters never import each other; move both to core if a third needs it.
const SAMPLE_RATE = 48_000;

/**
 * Convert the supplied recording at `runPath` (a file under the run, normally sources/) into audio/vo.wav and return
 * its absolute path. Removes the old vo.wav and the stale data/timing.json and data/audio.json first (R7). Throws
 * InputError for a bad or outside path (runFileOf) and for a source that is audio/vo.wav itself; a ToolError from
 * ffmpeg is rethrown naming the supplied file, and no vo.wav is left behind.
 */
export async function importSupplied(deps: Deps, runDir: string, runPath: string): Promise<string> {
  const root = path.resolve(runDir);
  const src = path.resolve(runFileOf(root, runPath));
  const audioDir = path.join(root, 'audio');
  const out = path.join(audioDir, 'vo.wav');
  if (src === out) throw new InputError('the supplied voice must not be audio/vo.wav; keep it under sources/');
  for (const stale of [out, path.join(root, 'data', 'timing.json'), path.join(root, 'data', 'audio.json')])
    rmSync(stale, { force: true });
  mkdirSync(audioDir, { recursive: true });
  const part = path.join(audioDir, 'vo.part.wav');
  try {
    await deps.sh(
      ['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', part],
      { env: deps.config.toolEnv },
    );
  } catch (cause) {
    rmSync(part, { force: true });
    if (!(cause instanceof ToolError)) throw cause;
    throw new ToolError(
      { cmd: cause.cmd, code: cause.code, stderr: `could not read the supplied voice ${runPath}: ${cause.stderrTail}` },
      { cause },
    );
  }
  renameSync(part, out);
  return out;
}
