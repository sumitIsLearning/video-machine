import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { AssetRefSchema } from '../../../contracts/types';
import { assetIdOf } from '../../../core/asset-id';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, VideoMachineError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { openverse, openverseLicense } from './index';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const runDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  return d;
};
const deps: Deps = { config: loadConfig({ PATH: '/bin' }), sh: async () => ({ code: 0, stdout: '', stderr: '' }) };
const RESULT = (i: number, extra: object = {}) => ({
  id: `id-${i}`,
  title: `Laptop ${i}`,
  url: `https://live.staticflickr.com/1/${i}_b.jpg`,
  creator: 'someone',
  license: 'by',
  license_version: '2.0',
  attribution: `"Laptop ${i}" by someone is licensed under CC BY 2.0.`,
  foreign_landing_url: `https://www.flickr.com/photos/x/${i}`,
  filetype: null,
  ...extra,
});
const imageResponse = () => new Response('img-bytes', { headers: { 'content-type': 'image/jpeg' } });

type Call = { url: string; init?: RequestInit };
/** A fake fetch: the API answers with `results`; every other URL is answered by `download` (an image by default). */
const fakeFetch = (
  results: object[],
  o: {
    status?: number;
    headers?: Record<string, string>;
    download?: (url: string) => Response | Promise<Response>;
  } = {},
) => {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://api.openverse.org/'))
      return new Response(JSON.stringify({ result_count: results.length, results }), {
        status: o.status ?? 200,
        headers: o.headers,
      });
    return o.download ? o.download(String(url)) : imageResponse();
  }) as unknown as typeof fetch;
  return { f, calls, downloads: () => calls.filter((c) => !c.url.startsWith('https://api.openverse.org/')) };
};

/** Run one search and collect what it returned and what it warned about. */
const search = async (
  results: object[],
  o: Parameters<typeof fakeFetch>[1] = {},
  kind: 'image' | 'audio' = 'image',
  run = runDir(),
) => {
  const warns: string[] = [];
  const ff = fakeFetch(results, o);
  const assets = await openverse(deps, { fetch: ff.f, onWarn: (l) => warns.push(l) }).find(
    run,
    'laptop',
    kind,
    results.length,
  );
  return { assets, warns, run, ...ff };
};
const indexOf = (run: string) => readJson(path.join(run, 'found', 'index.json'), z.array(AssetRefSchema));

test('find searches commercial + modifiable media and downloads each result into found/', async () => {
  const run = runDir();
  const { f, calls } = fakeFetch([RESULT(1), RESULT(2)]);
  const assets = await openverse(deps, { fetch: f }).find(run, 'laptop desk', 'image', 2);
  expect(calls[0]?.url).toBe(
    'https://api.openverse.org/v1/images/?q=laptop+desk&page_size=2&license_type=commercial%2Cmodification',
  );
  expect(assets).toHaveLength(2);
  const a = assets[0];
  expect(a).toMatchObject({ kind: 'image', origin: 'found', usage: 'render', license: 'CC BY 2.0', status: 'pool' });
  expect(a?.path).toMatch(/^found\/found-[0-9a-f]{8}\.jpg$/);
  expect(a?.source).toBe('https://www.flickr.com/photos/x/1');
  expect(a?.attribution).toContain('CC BY 2.0');
  expect(readFileSync(path.join(run, a?.path ?? ''), 'utf8')).toBe('img-bytes');
  expect(indexOf(run)).toHaveLength(2);
});

test('every request carries a User-Agent and a timeout', async () => {
  const { calls } = await search([RESULT(1)]);
  expect(calls).toHaveLength(2);
  for (const c of calls) {
    expect(new Headers(c.init?.headers).get('user-agent')).toStartWith('video-machine/');
    expect(c.init?.signal).toBeInstanceOf(AbortSignal);
  }
});

test('find refuses a folder that is not a run', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(dir);
  const err = await openverse(deps, { fetch: fakeFetch([RESULT(1)]).f })
    .find(dir, 'laptop', 'image', 1)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InputError);
});

test('a second search adds to found/index.json without duplicates', async () => {
  const run = runDir();
  await openverse(deps, { fetch: fakeFetch([RESULT(1)]).f }).find(run, 'laptop', 'image', 1);
  await openverse(deps, { fetch: fakeFetch([RESULT(1), RESULT(3)]).f }).find(run, 'laptop', 'image', 2);
  expect(indexOf(run)).toHaveLength(2);
});

test('a response that repeats an id is downloaded and recorded once', async () => {
  const { assets, downloads, run } = await search([RESULT(1), RESULT(1)]);
  expect(assets).toHaveLength(1);
  expect(downloads()).toHaveLength(1);
  expect(indexOf(run)).toHaveLength(1);
});

test('audio results land as audio with their own extension', async () => {
  const r = RESULT(5, {
    url: 'https://cdn.freesound.org/previews/629/629154_1-hq.mp3',
    license: 'cc0',
    license_version: '1.0',
  });
  const { assets } = await search(
    [r],
    { download: () => new Response('mp3-bytes', { headers: { 'content-type': 'audio/mpeg' } }) },
    'audio',
  );
  expect(assets[0]).toMatchObject({ kind: 'audio', license: 'CC0 1.0' });
  expect(assets[0]?.path.endsWith('.mp3')).toBe(true);
});

test('an API error names the status and the query; nothing is written', async () => {
  const run = runDir();
  const err = await openverse(deps, { fetch: fakeFetch([], { status: 500 }).f })
    .find(run, 'laptop', 'image', 2)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).message).toContain('500');
  expect((err as Error).message).toContain('laptop');
  expect(existsSync(path.join(run, 'found'))).toBe(false);
});

test('a 429 says it was rate limited, with the limits and when to retry', async () => {
  const headers = {
    'retry-after': '30',
    'x-ratelimit-limit-anon_burst': '20/min',
    'x-ratelimit-limit-anon_sustained': '200/day',
  };
  const err = await openverse(deps, { fetch: fakeFetch([], { status: 429, headers }).f })
    .find(runDir(), 'laptop', 'image', 2)
    .catch((e: unknown) => e);
  expect((err as Error).message).toBe('openverse search "laptop" was rate limited (20/min, 200/day); retry after 30 s');
});

test('a network error is wrapped with its cause', async () => {
  const boom = new Error('offline');
  const f = (async () => {
    throw boom;
  }) as unknown as typeof fetch;
  const err = await openverse(deps, { fetch: f })
    .find(runDir(), 'laptop', 'image', 1)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(VideoMachineError);
  expect((err as Error).cause).toBe(boom);
});

test('a failed download is skipped with a warning and is absent from the index', async () => {
  const { assets, warns, run } = await search([RESULT(1), RESULT(2)], {
    download: (url) => (url.includes('/1_b') ? new Response('nope', { status: 404 }) : imageResponse()),
  });
  expect(assets.map((a) => a.title)).toEqual(['Laptop 2']);
  expect(warns).toHaveLength(1);
  expect(warns[0]).toStartWith('[M5]');
  expect(warns[0]).toContain('404');
  expect(indexOf(run).map((a) => a.title)).toEqual(['Laptop 2']);
  expect(readdirSync(path.join(run, 'found')).sort()).toEqual([`${assets[0]?.asset_id}.jpg`, 'index.json'].sort());
});

test('a download that throws (a timeout, a dropped connection) is skipped with a warning', async () => {
  const { assets, warns } = await search([RESULT(1), RESULT(2)], {
    download: (url) => {
      if (url.includes('/1_b')) throw new DOMException('The operation timed out.', 'TimeoutError');
      return imageResponse();
    },
  });
  expect(assets).toHaveLength(1);
  expect(warns[0]).toContain('timed out');
});

test('a file that cannot be written is skipped and leaves nothing behind', async () => {
  const run = runDir();
  // A folder where the file should go makes the write fail.
  mkdirSync(path.join(run, 'found', `${assetIdOf('found', 'found/id-1')}.jpg`), { recursive: true });
  const { assets, warns } = await search([RESULT(1), RESULT(2)], {}, 'image', run);
  expect(assets).toHaveLength(1);
  expect(warns).toHaveLength(1);
  expect(indexOf(run)).toHaveLength(1);
});

test.each(['../../evil', 'jpg:s', 'a/b', 'toolong1', 'constructor'])(
  'a hostile filetype %p never reaches the file path',
  async (filetype) => {
    const { assets, run } = await search([RESULT(1, { filetype })]);
    expect(assets[0]?.path).toMatch(/^found\/found-[0-9a-f]{8}\.jpg$/); // fell back to the URL's own extension
    expect(readdirSync(run).sort()).toEqual(['concept.md', 'found']);
  },
);

test('a real filetype is used for the extension', async () => {
  const { assets } = await search([RESULT(1, { filetype: 'PNG' })]);
  expect(assets[0]?.path.endsWith('.png')).toBe(true);
});

test('the extension falls back to the response content-type', async () => {
  const { assets } = await search([RESULT(7, { url: 'https://example.com/download?id=7' })]);
  expect(assets[0]?.path.endsWith('.jpg')).toBe(true);
});

test('with no usable extension anywhere the file is .bin', async () => {
  const { assets } = await search([RESULT(7, { url: 'https://example.com/download?id=7.x_y' })], {
    download: () => new Response('x', { headers: { 'content-type': 'image/x-unknown' } }),
  });
  expect(assets[0]?.path.endsWith('.bin')).toBe(true);
});

test.each([
  ['file:', 'file:///C:/secret.jpg'],
  ['data:', 'data:image/png;base64,AAAA'],
  ['plain http', 'http://example.com/a.jpg'],
  ['a private host', 'https://192.168.1.5/a.jpg'],
  ['a loopback host', 'https://localhost/a.jpg'],
  ['credentials', 'https://u:p@example.com/a.jpg'],
])('a result at %s is skipped with a warning and nothing is fetched or written', async (_name, url) => {
  const { assets, warns, downloads, run } = await search([RESULT(1, { url })]);
  expect(assets).toHaveLength(0);
  expect(warns).toHaveLength(1);
  expect(downloads()).toHaveLength(0);
  expect(existsSync(path.join(run, 'found'))).toBe(false);
});

test('a redirecting download is skipped, never followed', async () => {
  const { assets, warns, downloads, run } = await search([RESULT(1)], {
    download: () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
  });
  expect(downloads()[0]?.init?.redirect).toBe('manual');
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain('302');
  expect(existsSync(path.join(run, 'found'))).toBe(false);
});

test('a source link that is not http(s) falls back to the result url', async () => {
  const { assets } = await search([RESULT(1, { foreign_landing_url: 'javascript:alert(1)' })]);
  expect(assets[0]?.source).toBe('https://live.staticflickr.com/1/1_b.jpg');
});

test('a content-length over the cap is skipped before the body is read', async () => {
  const { assets, warns } = await search([RESULT(1)], {
    download: () =>
      new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(26 * 1024 * 1024) } }),
  });
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain('too large');
});

test('a body that grows past the cap is cut off and skipped', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      sent++;
      c.enqueue(chunk);
      if (sent >= 30) c.close();
    },
  });
  const { assets, warns, run } = await search([RESULT(1)], {
    download: () => new Response(body, { headers: { 'content-type': 'image/jpeg' } }),
  });
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain('too large');
  expect(sent).toBeLessThan(30);
  expect(existsSync(path.join(run, 'found'))).toBe(false);
});

test('an html body for an image is skipped', async () => {
  const { assets, warns } = await search([RESULT(1)], {
    download: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
  });
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain('text/html');
});

test('an audio result whose body is an image is skipped', async () => {
  const { assets } = await search([RESULT(1, { url: 'https://example.com/a.mp3' })], {}, 'audio');
  expect(assets).toHaveLength(0);
});

test('an empty body is skipped', async () => {
  const { assets, warns, run } = await search([RESULT(1)], {
    download: () => new Response('', { headers: { 'content-type': 'image/jpeg' } }),
  });
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain('empty');
  expect(existsSync(path.join(run, 'found'))).toBe(false);
});

test.each([
  ['by-nc', '2.0'],
  ['by-nd', '2.0'],
  ['by-nc-sa', '4.0'],
  ['sampling+', '1.0'],
  ['by', null],
  ['by-sa', null],
])('licence %s version %p is skipped with a warning', async (license, license_version) => {
  const { assets, warns, downloads } = await search([RESULT(1, { license, license_version })]);
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain(license);
  expect(downloads()).toHaveLength(0);
});

test('cc0 and pdm need neither a version nor an attribution', async () => {
  const { assets } = await search([
    RESULT(1, { license: 'cc0', license_version: null, attribution: null, creator: null }),
    RESULT(2, { license: 'pdm', license_version: '1.0', attribution: null, creator: null }),
  ]);
  expect(assets.map((a) => a.license)).toEqual(['CC0', 'Public Domain Mark 1.0']);
  expect(assets[0]?.attribution).toBeUndefined();
});

test('a missing attribution is built from title, creator, link and licence', async () => {
  const { assets } = await search([RESULT(1, { attribution: null })]);
  expect(assets[0]?.attribution).toBe(
    '"Laptop 1" by someone (https://www.flickr.com/photos/x/1) is licensed under CC BY 2.0',
  );
});

test('a missing attribution with no creator is skipped with a warning', async () => {
  const { assets, warns } = await search([RESULT(1, { attribution: null, creator: null })]);
  expect(assets).toHaveLength(0);
  expect(warns[0]).toContain('attribution');
});

test('licence names follow Creative Commons spelling', () => {
  expect(openverseLicense('by-sa', '2.0')).toBe('CC BY-SA 2.0');
  expect(openverseLicense('cc0', '1.0')).toBe('CC0 1.0');
  expect(openverseLicense('pdm', '1.0')).toBe('Public Domain Mark 1.0');
  expect(openverseLicense('by', null)).toBe('CC BY');
});
