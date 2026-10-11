import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError } from '../core/errors';
import { main } from './cli';

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
const MD = `# Research: uv

## Facts
- uv is 10-100x faster than pip — "10-100x faster than pip." — https://docs.astral.sh/uv/
- One tool replaces pip, poetry and pyenv — "A single tool to replace pip, pip-tools, pipx, poetry, pyenv" — https://docs.astral.sh/uv/
`;

/** A fake HyperFrames capture that writes a screenshot into the -o folder. */
const captureDeps: Deps = {
  config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
  sh: async (cmd) => {
    const out = cmd[cmd.indexOf('-o') + 1] ?? '';
    mkdirSync(path.join(out, 'screenshots'), { recursive: true });
    writeFileSync(path.join(out, 'screenshots', 'full-page.png'), 'png');
    return { code: 0, stdout: JSON.stringify({ ok: true, title: 'uv' }), stderr: '' };
  },
};
const noSh: Deps = {
  config: captureDeps.config,
  sh: async () => {
    throw new Error('no process expected');
  },
};
const RESULT = {
  id: 'id-1',
  title: 'Laptop',
  url: 'https://live.staticflickr.com/1/1_b.jpg',
  creator: 'someone',
  license: 'by',
  license_version: '2.0',
  attribution: '"Laptop" by someone is licensed under CC BY 2.0.',
  foreign_landing_url: 'https://www.flickr.com/photos/x/1',
  filetype: null,
};
/** A fake fetch that answers the search with `results` and every download with `download` (an image by default). */
const fakeFetch = (results: object[] = [RESULT], download: (url: string) => Response = () => imageResponse()) => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    return String(url).startsWith('https://api.openverse.org/')
      ? new Response(JSON.stringify({ results }))
      : download(String(url));
  }) as unknown as typeof fetch;
  return { f, urls };
};
const imageResponse = () => new Response('img', { headers: { 'content-type': 'image/jpeg' } });
const stdinOf = (bytes: Uint8Array) => async () => bytes;

test('page captures the URL and names its record file', async () => {
  const run = runDir();
  const r = (await main(['page', run, 'https://docs.astral.sh/uv/'], { deps: captureDeps })) as {
    page: { dir: string; title: string };
    record: string;
  };
  expect(r.page.title).toBe('uv');
  expect(r.record).toBe(`${r.page.dir}.json`);
  expect(existsSync(path.join(run, ...r.record.split('/')))).toBe(true);
});

test('a relative run_dir resolves against cwd', async () => {
  const run = runDir();
  const r = (await main(['write', path.basename(run)], {
    cwd: path.dirname(run),
    stdin: async () => new TextEncoder().encode(MD),
  })) as { facts: number };
  expect(r.facts).toBe(2);
  expect(readFileSync(path.join(run, 'research.md'), 'utf8')).toBe(MD);
});

test('find returns the found assets and defaults to three images', async () => {
  const run = runDir();
  const ff = fakeFetch();
  const r = (await main(['find', run, 'laptop'], { deps: noSh, fetch: ff.f })) as {
    assets: { origin: string; kind: string }[];
  };
  expect(r.assets[0]?.origin).toBe('found');
  expect(r.assets[0]?.kind).toBe('image');
  expect(ff.urls[0]).toContain('/images/');
  expect(ff.urls[0]).toContain('page_size=3');
});

test('find --kind audio --n 5 searches audio, five results', async () => {
  const ff = fakeFetch([]);
  await main(['find', runDir(), 'rain', '--kind', 'audio', '--n', '5'], { deps: noSh, fetch: ff.f });
  expect(ff.urls[0]).toContain('/audio/');
  expect(ff.urls[0]).toContain('page_size=5');
});

test('a repeated flag takes the last value', async () => {
  const ff = fakeFetch([]);
  await main(['find', runDir(), 'q', '--n', '20', '--n', '4'], { deps: noSh, fetch: ff.f });
  expect(ff.urls[0]).toContain('page_size=4');
});

test('a query that starts with a dash is read after --', async () => {
  const ff = fakeFetch([]);
  await main(['find', runDir(), '--', '-cats'], { deps: noSh, fetch: ff.f });
  expect(new URL(ff.urls[0] ?? '').searchParams.get('q')).toBe('-cats');
});

test('find succeeds when one download fails and warns on stderr', async () => {
  const run = runDir();
  const ff = fakeFetch([RESULT, { ...RESULT, id: 'id-2', url: 'https://live.staticflickr.com/1/2_b.jpg' }], (url) =>
    url.includes('/2_b') ? new Response('boom', { status: 500 }) : imageResponse(),
  );
  const written: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string) => !!written.push(String(chunk))) as typeof process.stderr.write;
  let r: { assets: unknown[] };
  try {
    r = (await main(['find', run, 'laptop', '--n', '2'], { deps: noSh, fetch: ff.f })) as { assets: unknown[] };
  } finally {
    process.stderr.write = original;
  }
  expect(r.assets).toHaveLength(1);
  expect(written.join('')).toContain('[M5] skipping openverse result id-2');
});

test('write returns the fact count and URLs from stdin', async () => {
  const run = runDir();
  const r = await main(['write', run], { stdin: stdinOf(new TextEncoder().encode(MD)) });
  expect(r).toEqual({ facts: 2, urls: ['https://docs.astral.sh/uv/'] });
});

test('write refuses stdin that is not UTF-8 and leaves no research.md', async () => {
  const run = runDir();
  const err = await main(['write', run], { stdin: stdinOf(new Uint8Array([0x41, 0xff])) }).catch((e) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as InputError).message).toBe('research.md on stdin is not valid UTF-8 (save it as UTF-8)');
  expect(existsSync(path.join(run, 'research.md'))).toBe(false);
});

test('write refuses stdin over 1 MB', async () => {
  const run = runDir();
  const big = new Uint8Array(1024 * 1024 + 1).fill(0x0a); // newlines: valid UTF-8, and no long line for the parser
  big.set(new TextEncoder().encode(MD));
  const err = await main(['write', run], { stdin: stdinOf(big) }).catch((e) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as InputError).message).toContain('1 MB');
  expect(existsSync(path.join(run, 'research.md'))).toBe(false);
});

test.each(['1', '10'])('find --n %s is accepted', async (n) => {
  const ff = fakeFetch([]);
  await main(['find', runDir(), 'q', '--n', n], { deps: noSh, fetch: ff.f });
  expect(ff.urls[0]).toContain(`page_size=${n}`);
});

test.each(['0', '11', '50', 'x', '0x3', '3e0', ' 3 ', '1.5', '-1', ''])('find --n "%s" is an InputError', async (n) => {
  const err = await main(['find', runDir(), 'q', `--n=${n}`], { deps: noSh, fetch: fakeFetch().f }).catch((e) => e);
  expect(err).toBeInstanceOf(InputError);
});

test('find --kind video is an InputError', async () => {
  const err = await main(['find', runDir(), 'q', '--kind', 'video'], { deps: noSh, fetch: fakeFetch().f }).catch(
    (e) => e,
  );
  expect(err).toBeInstanceOf(InputError);
});

test.each([
  [['bogus']],
  [['page', '/x']],
  [['find', '/x']],
  [['write']],
  [['write', '/x', '--nope']],
  [[]],
  [['page', '/x', 'https://a.example/', '--n', '3']],
  [['page', '/x', 'https://a.example/', '--kind', 'image']],
  [['write', '/x', '--kind', 'image']],
  [['find', '/x', 'a', 'b']],
])('bad arguments %j give an InputError with the usage text', async (argv) => {
  const err = await main(argv, { deps: noSh }).catch((e) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as InputError).message).toContain('usage');
});

test('the usage text shows where the query goes', async () => {
  const err = await main([]).catch((e) => e);
  expect((err as InputError).message).toContain('find <run_dir> [--kind image|audio] [--n 1-10] [--] <query>');
});
