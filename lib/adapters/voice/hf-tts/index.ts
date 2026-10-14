// Voice adapter hf-tts: one TTS clip per script line through HyperFrames, joined into audio/vo.wav with ffmpeg.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Script, VoiceAdapter } from '../../../contracts/types';
import { HF_CMD } from '../../../core/config';
import { type Deps, defaultDeps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import { LINE_GAP_S } from '../../../core/estimate';

export const SAMPLE_RATE = 48_000;

type Line = Script['lines'][number];

// The last stdout line of `hyperframes tts --json`: `{"ok":true,...}` or `{"ok":false,"error":"..."}`.
const TtsReplySchema = z.looseObject({ ok: z.boolean().optional(), error: z.string().optional() });

/**
 * The cache key of one spoken line for one voice: 16 hex chars of sha256 over the voice id and the spoken text (R6).
 * Returns the key without the `.wav`.
 */
export const lineKey = (voiceId: string, text: string): string =>
  createHash('sha256').update(`${voiceId}\n${text}`).digest('hex').slice(0, 16);

/** The reply on the last stdout line, or undefined when it is not a JSON object (the caller counts that as a failure). */
const ttsReply = (stdout: string): z.infer<typeof TtsReplySchema> | undefined => {
  const last = stdout.trim().split('\n').at(-1) ?? '';
  let json: unknown;
  try {
    json = JSON.parse(last);
  } catch {
    return undefined; // ponytail: a tts that prints no JSON is a failed line, reported by the caller with its stderr
  }
  const reply = TtsReplySchema.safeParse(json);
  return reply.success ? reply.data : undefined;
};

/** The text a line is voiced from: how TTS should read it (`spoken`), else the line itself. */
const spokenOf = (line: Line): string => line.spoken ?? line.text;

/** A cached line counts only when it is a non-empty file. */
const isCached = (wav: string): boolean => (statSync(wav, { throwIfNoEntry: false })?.size ?? 0) > 0;

/**
 * Synthesize one line into `wav` through a temp dir, which is always removed. The temp dir sits beside `wav` so the
 * rename never crosses a filesystem (EXDEV). Throws ToolError naming the line when tts fails or writes no audio.
 */
const voiceLine = async (deps: Deps, voiceId: string, line: Line, wav: string): Promise<void> => {
  const tmp = mkdtempSync(path.join(path.dirname(wav), '.vm-tts-'));
  try {
    const textFile = path.join(tmp, 'line.txt');
    const tmpWav = path.join(tmp, 'line.wav');
    writeFileSync(textFile, spokenOf(line));
    const cmd = [...HF_CMD, 'tts', '--text-file', textFile, '-o', tmpWav, '-v', voiceId, '--json'];
    const { code, stdout, stderr } = await deps.sh(cmd, { env: deps.config.toolEnv, allowFail: true });
    const reply = ttsReply(stdout);
    if (code !== 0 || reply?.ok !== true)
      throw new ToolError({ cmd, code, stderr: `tts failed for line "${line.id}": ${reply?.error ?? stderr}` });
    if (!isCached(tmpWav)) throw new ToolError({ cmd, code, stderr: `tts wrote no audio for line "${line.id}"` });
    renameSync(tmpWav, wav);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

/**
 * The hf-tts voice adapter. `synth(runDir, lines, voiceId)` voices each line (reusing `audio/lines/<key>.wav` when
 * cached), joins them with LINE_GAP_S of silence between lines into `audio/vo.wav` (48 kHz mono), prunes cached lines
 * no longer used, and returns the absolute path of `vo.wav`. A new voice first removes `audio/vo.wav` and the stale
 * `data/timing.json` and `data/audio.json` (R7). Throws InputError for no lines, ToolError when tts or the join fails
 * (naming the line for tts); a failed join leaves no `vo.wav`. `costEstimate` is 0: the voice runs locally.
 */
export const hfTts = (deps: Deps = defaultDeps()): VoiceAdapter => ({
  async synth(runDir, lines, voiceId) {
    if (lines.length === 0) throw new InputError('hf-tts: no lines to voice');
    const root = path.resolve(runDir);
    const audioDir = path.join(root, 'audio');
    const cacheDir = path.join(audioDir, 'lines');
    const out = path.join(audioDir, 'vo.wav');
    const part = path.join(audioDir, 'vo.part.wav');
    for (const stale of [out, path.join(root, 'data', 'timing.json'), path.join(root, 'data', 'audio.json')])
      rmSync(stale, { force: true });
    mkdirSync(cacheDir, { recursive: true });

    const wavs: string[] = [];
    for (const line of lines) {
      const wav = path.join(cacheDir, `${lineKey(voiceId, spokenOf(line))}.wav`);
      if (!isCached(wav)) await voiceLine(deps, voiceId, line, wav);
      wavs.push(wav);
    }

    const inputs = wavs.flatMap((wav) => ['-i', wav]);
    const pads = wavs.map((_, i) => `[${i}:a]${i < wavs.length - 1 ? `apad=pad_dur=${LINE_GAP_S}` : 'anull'}[a${i}]`);
    const labels = wavs.map((_, i) => `[a${i}]`).join('');
    const filter = [...pads, `${labels}concat=n=${wavs.length}:v=0:a=1,aresample=${SAMPLE_RATE}[o]`].join(';');
    try {
      await deps.sh(
        [
          'ffmpeg',
          '-v',
          'error',
          '-y',
          ...inputs,
          '-filter_complex',
          filter,
          '-map',
          '[o]',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          part,
        ],
        { env: deps.config.toolEnv },
      );
      renameSync(part, out);
    } catch (cause) {
      rmSync(part, { force: true }); // a half-made join must never look done
      throw cause;
    }

    const used = new Set(wavs.map((wav) => path.basename(wav)));
    for (const name of readdirSync(cacheDir))
      if (name.endsWith('.wav') && !used.has(name)) rmSync(path.join(cacheDir, name), { force: true });
    return out;
  },
  costEstimate: () => 0,
});
export default hfTts;
