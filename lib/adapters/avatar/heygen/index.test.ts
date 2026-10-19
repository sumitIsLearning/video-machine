import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InputError, VideoMachineError } from '../../../core/errors';
import { heygen } from './index';

const KEY = 'sk-test-secret';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const setup = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-heygen-'));
  dirs.push(d);
  writeFileSync(path.join(d, 'me.png'), 'png');
  writeFileSync(path.join(d, 'a01.wav'), 'wav1');
  writeFileSync(path.join(d, 'a02.wav'), 'wav2');
  return d;
};
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A scripted fetch: each request takes the next reply for its route. */
const scripted = (routes: Record<string, Response[]>, calls: Call[]): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
    const key = `${method} ${url.replace('https://api.heygen.com', '')}`;
    const reply = routes[key]?.shift();
    if (!reply) throw new Error(`unscripted ${key}`);
    return reply;
  }) as typeof fetch;

test('heygen uploads the portrait once, makes each segment and downloads the video', async () => {
  const d = setup();
  const calls: Call[] = [];
  const fetch = scripted(
    {
      'POST /v3/assets': [
        json(200, { data: { asset_id: 'img1' } }),
        json(200, { data: { asset_id: 'aud1' } }),
        json(200, { data: { asset_id: 'aud2' } }),
      ],
      'POST /v3/videos': [
        json(200, { data: { video_id: 'v1', status: 'waiting' } }),
        json(200, { data: { video_id: 'v2', status: 'waiting' } }),
      ],
      'GET /v3/videos/v1': [
        json(200, { data: { status: 'processing' } }),
        json(200, { data: { status: 'completed', video_url: 'https://cdn.example/v1.mp4' } }),
      ],
      'GET /v3/videos/v2': [json(200, { data: { status: 'completed', video_url: 'https://cdn.example/v2.mp4' } })],
      'GET https://cdn.example/v1.mp4': [new Response('mp4-1')],
      'GET https://cdn.example/v2.mp4': [new Response('mp4-2')],
    },
    calls,
  );
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  expect(adapter.name).toBe('heygen');
  const out1 = path.join(d, 'a01.mp4');
  expect(await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, out1)).toBe(out1);
  await adapter.make({ seg: 'a02', start: 3, end: 4, audio: path.join(d, 'a02.wav') }, path.join(d, 'a02.mp4'));
  expect(readFileSync(out1, 'utf8')).toBe('mp4-1');
  expect(calls.filter((c) => c.url.endsWith('/v3/assets'))).toHaveLength(3);
  const create = calls.find((c) => c.url.endsWith('/v3/videos'));
  expect(JSON.parse(String(create?.body))).toEqual({
    type: 'image',
    image: { type: 'asset_id', asset_id: 'img1' },
    audio_asset_id: 'aud1',
    aspect_ratio: 'auto',
    resolution: '1080p',
    background: { type: 'color', value: '#00b140' },
  });
  expect(create?.headers['x-api-key']).toBe(KEY);
  expect(create?.headers['idempotency-key']).toMatch(/^vm-[0-9a-f]{32}$/);
  expect(
    calls.filter((c) => c.url.startsWith('https://cdn.example')).every((c) => c.headers['x-api-key'] === undefined),
  ).toBe(true);
});

test('heygen estimates the cost per minute, rounded up to cents', () => {
  const adapter = heygen({ apiKey: KEY, portrait: 'x', fetch: scripted({}, []), sleep: async () => {} });
  expect(adapter.costEstimate(60)).toBe(1);
  expect(adapter.costEstimate(10)).toBe(0.17);
});

test('heygen waits out a 429 and refuses a 401 without the key in the message', async () => {
  const d = setup();
  const waits: number[] = [];
  const busy = scripted(
    {
      'POST /v3/assets': [
        json(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } }, { 'retry-after': '2' }),
        json(401, { error: { code: 'unauthorized', message: `bad key ${KEY}`, request_id: 'q1' } }),
      ],
    },
    [],
  );
  const adapter = heygen({
    apiKey: KEY,
    portrait: path.join(d, 'me.png'),
    fetch: busy,
    sleep: async (ms) => void waits.push(ms),
  });
  const err = await adapter
    .make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, path.join(d, 'a01.mp4'))
    .catch((e) => e);
  expect(err).toBeInstanceOf(InputError);
  expect(String(err.message)).not.toContain(KEY);
  expect(waits).toEqual([2000]);
});

test('heygen reports a failed render and leaves no output', async () => {
  const d = setup();
  const fetch = scripted(
    {
      'POST /v3/assets': [json(200, { data: { asset_id: 'img1' } }), json(200, { data: { asset_id: 'aud1' } })],
      'POST /v3/videos': [json(200, { data: { video_id: 'v1', status: 'waiting' } })],
      'GET /v3/videos/v1': [
        json(200, { data: { status: 'failed', failure_code: 'avatar_not_usable', failure_message: 'no face' } }),
      ],
    },
    [],
  );
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  const out = path.join(d, 'a01.mp4');
  const err = await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, out).catch((e) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect(String(err.message)).toContain('avatar_not_usable: no face');
  expect(existsSync(out)).toBe(false);
});

test('heygen falls back to 10 s when Retry-After is an HTTP date', async () => {
  const d = setup();
  const waits: number[] = [];
  const busy = scripted(
    {
      'POST /v3/assets': [
        json(
          429,
          { error: { code: 'rate_limit_exceeded', message: 'slow down' } },
          { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        ),
        json(401, { error: { code: 'unauthorized', message: 'no' } }),
      ],
    },
    [],
  );
  const adapter = heygen({
    apiKey: KEY,
    portrait: path.join(d, 'me.png'),
    fetch: busy,
    sleep: async (ms) => void waits.push(ms),
  });
  await adapter
    .make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, path.join(d, 'a01.mp4'))
    .catch((e) => e);
  expect(waits).toEqual([10000]);
});

test('heygen waits the 10 s default on a 429 without Retry-After, then succeeds', async () => {
  const d = setup();
  const waits: number[] = [];
  const fetch = scripted(
    {
      'POST /v3/assets': [
        json(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } }),
        json(200, { data: { asset_id: 'img1' } }),
        json(200, { data: { asset_id: 'aud1' } }),
      ],
      'POST /v3/videos': [json(200, { data: { video_id: 'v1', status: 'waiting' } })],
      'GET /v3/videos/v1': [json(200, { data: { status: 'completed', video_url: 'https://cdn.example/v1.mp4' } })],
      'GET https://cdn.example/v1.mp4': [new Response('mp4-1')],
    },
    [],
  );
  const adapter = heygen({
    apiKey: KEY,
    portrait: path.join(d, 'me.png'),
    fetch,
    sleep: async (ms) => void waits.push(ms),
  });
  const out = path.join(d, 'a01.mp4');
  await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, out);
  expect(waits).toEqual([10000]);
  expect(readFileSync(out, 'utf8')).toBe('mp4-1');
});

test('heygen keeps the message readable when the API key is empty', async () => {
  const d = setup();
  const fetch = scripted(
    { 'POST /v3/assets': [json(500, { error: { code: 'server', message: 'boom', request_id: 'r1' } })] },
    [],
  );
  const adapter = heygen({ apiKey: '', portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  const err = await adapter
    .make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, path.join(d, 'a01.mp4'))
    .catch((e) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect(String(err.message)).toBe('HeyGen 500 server: boom (request r1)');
});

test('heygen reports a 2xx reply with a non-JSON body as a VideoMachineError', async () => {
  const d = setup();
  const fetch = scripted({ 'POST /v3/assets': [new Response('<html>oops</html>', { status: 200 })] }, []);
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  const err = await adapter
    .make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, path.join(d, 'a01.mp4'))
    .catch((e) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect(String(err.message)).toBe('HeyGen 200 returned a non-JSON body');
});

test('heygen fails at once when a completed video has no video_url', async () => {
  const d = setup();
  const fetch = scripted(
    {
      'POST /v3/assets': [json(200, { data: { asset_id: 'img1' } }), json(200, { data: { asset_id: 'aud1' } })],
      'POST /v3/videos': [json(200, { data: { video_id: 'v1', status: 'waiting' } })],
      'GET /v3/videos/v1': [json(200, { data: { status: 'completed' } })],
    },
    [],
  );
  const adapter = heygen({ apiKey: KEY, portrait: path.join(d, 'me.png'), fetch, sleep: async () => {} });
  const out = path.join(d, 'a01.mp4');
  const err = await adapter.make({ seg: 'a01', start: 0, end: 2, audio: path.join(d, 'a01.wav') }, out).catch((e) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect(String(err.message)).toBe('HeyGen could not make a01: completed without video_url');
  expect(existsSync(out)).toBe(false);
  expect(existsSync(`${out}.part`)).toBe(false);
});
