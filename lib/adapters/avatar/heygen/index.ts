// Avatar source `heygen`: a paid HeyGen talking-head clip per segment, made from the creator's portrait and the
// segment's audio. Only the cost gate sums `costEstimate` before the first call; this adapter just reports the price.

import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AvatarAdapter, AvatarJob } from '../../../contracts/types';
import { HEYGEN_USD_PER_MIN } from '../../../core/config';
import { InputError, VideoMachineError } from '../../../core/errors';

const API = 'https://api.heygen.com';
const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_S = 10;

export type HeygenOptions = {
  apiKey: string;
  portrait: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
};

type ApiError = { error?: { code?: string; message?: string; request_id?: string } };
type VideoStatus = { status: string; video_url?: string; failure_code?: string; failure_message?: string };

/**
 * Build the HeyGen avatar adapter. `make` uploads the portrait once, uploads the segment audio, renders the clip
 * and downloads it to `out`; it resolves to `out`. Throws InputError when HeyGen refuses the key or the request
 * (401/402), and VideoMachineError on any other HeyGen failure or timeout. The API key never appears in a message.
 */
export const heygen = (o: HeygenOptions): AvatarAdapter => {
  const fetchFn = o.fetch ?? globalThis.fetch;
  const sleep = o.sleep ?? ((ms: number) => Bun.sleep(ms));
  const pollMs = o.pollMs ?? 5_000;
  const timeoutMs = o.timeoutMs ?? 1_200_000;
  // An empty key would make replaceAll insert *** between every character, so only scrub a real key.
  const scrub = (text: string) => (o.apiKey ? text.replaceAll(o.apiKey, '***') : text);
  let imageId: string | undefined;

  /** Calls the HeyGen API, waits out rate limits, and returns the reply's `data`. */
  const request = async <T>(
    method: string,
    route: string,
    body?: FormData | object,
    idempotency?: string,
  ): Promise<T> => {
    for (let retries = 0; ; retries++) {
      const isJson = body !== undefined && !(body instanceof FormData);
      const res = await fetchFn(`${API}${route}`, {
        method,
        headers: {
          'x-api-key': o.apiKey,
          ...(isJson ? { 'content-type': 'application/json' } : {}),
          ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
        },
        body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
      });
      if (res.status === 429 && retries < MAX_RETRIES) {
        // Retry-After may be an HTTP date, which Number() reads as NaN; fall back to the default then.
        // A missing header must not read as Number(null) = 0.
        const s = Number(res.headers.get('retry-after') ?? DEFAULT_RETRY_AFTER_S);
        await sleep((Number.isFinite(s) && s >= 0 ? s : DEFAULT_RETRY_AFTER_S) * 1000);
        continue;
      }
      if (res.ok) {
        const reply = (await res.json().catch((cause: unknown) => {
          throw new VideoMachineError(scrub(`HeyGen ${res.status} returned a non-JSON body`), { cause });
        })) as { data: T };
        return reply.data;
      }
      // ponytail: a non-JSON error body still reports the status; the message just has no code.
      const {
        code = 'unknown',
        message = res.statusText,
        request_id = 'none',
      } = ((await res.json().catch(() => ({}))) as ApiError).error ?? {};
      if (res.status === 401 || res.status === 402)
        throw new InputError(scrub(`HeyGen refused the request (${code}): ${message}`));
      throw new VideoMachineError(scrub(`HeyGen ${res.status} ${code}: ${message} (request ${request_id})`));
    }
  };

  const upload = async (file: string): Promise<string> => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)]), path.basename(file));
    return (await request<{ asset_id: string }>('POST', '/v3/assets', form)).asset_id;
  };

  return {
    name: 'heygen',
    costEstimate: (audio_s: number) => Math.ceil((audio_s / 60) * HEYGEN_USD_PER_MIN * 100) / 100,
    make: async (job: AvatarJob, out: string) => {
      imageId ??= await upload(o.portrait);
      const audioId = await upload(job.audio);
      // Same portrait and audio give the same key, so a re-run after a crash is not billed twice.
      const hash = createHash('sha256').update(readFileSync(o.portrait)).update(readFileSync(job.audio)).digest('hex');
      const created = await request<{ video_id: string }>(
        'POST',
        '/v3/videos',
        {
          type: 'image',
          image: { type: 'asset_id', asset_id: imageId },
          audio_asset_id: audioId,
          aspect_ratio: 'auto',
          resolution: '1080p',
          background: { type: 'color', value: '#00b140' },
        },
        `vm-${hash.slice(0, 32)}`,
      );
      const url = await waitForVideo(created.video_id, job.seg);
      const part = `${out}.part`;
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new VideoMachineError(`HeyGen download failed for ${job.seg}: ${res.status}`);
        writeFileSync(part, new Uint8Array(await res.arrayBuffer()));
        renameSync(part, out);
      } catch (e) {
        rmSync(part, { force: true });
        throw e;
      }
      return out;
    },
  };

  /** Polls the video until HeyGen finishes it; resolves to the download URL. */
  async function waitForVideo(id: string, seg: string): Promise<string> {
    for (let waited = 0; ; waited += pollMs) {
      const video = await request<VideoStatus>('GET', `/v3/videos/${id}`);
      if (video.status === 'completed') {
        if (!video.video_url) throw new VideoMachineError(`HeyGen could not make ${seg}: completed without video_url`);
        return video.video_url;
      }
      if (video.status === 'failed')
        throw new VideoMachineError(
          scrub(`HeyGen could not make ${seg}: ${video.failure_code}: ${video.failure_message}`),
        );
      if (waited >= timeoutMs)
        throw new VideoMachineError(`HeyGen did not finish ${seg} within ${timeoutMs} ms (video ${id})`);
      await sleep(pollMs);
    }
  }
};
