import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PageCaptureSchema } from '../contracts/types';
import { HF_CMD, loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { readJson } from '../core/json';
import { capturePage } from './page';

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
/** The folder a URL is captured into: readable slug plus a hash of the whole URL (no fragment). */
const dirOf = (url: string, slug: string) => {
  const u = new URL(url);
  u.hash = '';
  return `capture/pages/${slug}-${createHash('sha1').update(u.href).digest('hex').slice(0, 8)}`;
};
const UV = 'https://docs.astral.sh/uv/';
const UV_DIR = dirOf(UV, 'docs-astral-sh-uv');

type FakeOptions = {
  fail?: boolean;
  noExtracted?: boolean;
  fonts?: { file: string; family: string }[];
  colors?: number;
  stdout?: string;
};

/** A fake HyperFrames capture that writes what the real one writes into the -o folder. */
const fakeCapture = (o: FakeOptions = {}) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd) => {
      calls.push(cmd);
      const out = cmd[cmd.indexOf('-o') + 1] ?? '';
      if (o.fail) {
        mkdirSync(out, { recursive: true });
        writeFileSync(path.join(out, 'partial.txt'), 'half a capture');
        throw new ToolError({ cmd, code: 1, stderr: 'net::ERR_NAME_NOT_RESOLVED' });
      }
      for (const d of ['screenshots', 'assets/fonts']) mkdirSync(path.join(out, d), { recursive: true });
      writeFileSync(path.join(out, 'screenshots', 'scroll-000.png'), 'png');
      writeFileSync(path.join(out, 'screenshots', 'full-page.png'), 'png');
      writeFileSync(path.join(out, 'assets', 'logo-4b5009c7.svg'), '<svg/>');
      writeFileSync(path.join(out, 'assets', 'fonts', 'a.woff2'), 'w');
      if (!o.noExtracted) {
        mkdirSync(path.join(out, 'extracted'), { recursive: true });
        writeFileSync(
          path.join(out, 'extracted', 'fonts-manifest.json'),
          JSON.stringify({ files: o.fonts ?? [{ file: 'a.woff2', family: 'Roboto' }] }),
        );
        const colorStats = o.colors
          ? Array.from({ length: o.colors }, (_, k) => ({
              hex: `#${k.toString(16).padStart(6, '0')}`,
              count: 1,
              bgCount: 1,
              textCount: 0,
            }))
          : [
              { hex: '#000000', count: 587, bgCount: 7, textCount: 580 },
              { hex: '#FFFFFFB3', count: 3, bgCount: 0, textCount: 3 },
              { hex: '#261230', count: 1, bgCount: 1, textCount: 0 },
            ];
        writeFileSync(path.join(out, 'extracted', 'tokens.json'), JSON.stringify({ colorStats }));
      }
      // The real CLI pretty-prints its JSON over many lines.
      const json = JSON.stringify({ ok: true, title: 'uv', screenshots: 2 }, null, 2);
      return { code: 0, stdout: o.stdout ?? `${json}\n`, stderr: '' };
    },
  };
  return { deps, calls };
};

test('capturePage runs hyperframes capture and records it by run path', async () => {
  const run = runDir();
  const { deps, calls } = fakeCapture();
  const page = await capturePage(deps, run, UV);
  expect(calls[0]?.slice(0, 5)).toEqual([...HF_CMD, 'capture', UV]);
  expect(calls[0]).toContain('--skip-vision');
  expect(page.dir).toBe(UV_DIR);
  expect(page.title).toBe('uv');
  expect(page.screenshots).toEqual([`${UV_DIR}/screenshots/full-page.png`, `${UV_DIR}/screenshots/scroll-000.png`]);
  expect(page.logos).toEqual([`${UV_DIR}/assets/logo-4b5009c7.svg`]);
  expect(page.fonts).toEqual([{ family: 'Roboto', path: `${UV_DIR}/assets/fonts/a.woff2` }]);
  expect(page.palette.map((c) => c.hex)).toEqual(['#000000', '#261230']);
  expect(readJson(path.join(run, `${UV_DIR}.json`), PageCaptureSchema)).toEqual(page);
});

test('capturePage hands hyperframes an absolute output folder', async () => {
  const { deps, calls } = fakeCapture();
  await capturePage(deps, path.relative(process.cwd(), runDir()), UV);
  expect(path.isAbsolute(calls[0]?.[(calls[0]?.indexOf('-o') ?? 0) + 1] ?? '')).toBe(true);
});

test('the same page with another fragment lands in the same folder', async () => {
  const a = await capturePage(fakeCapture().deps, runDir(), UV);
  const b = await capturePage(fakeCapture().deps, runDir(), `${UV}#install`);
  expect(b.dir).toBe(a.dir);
});

test('pages whose slug text matches but whose URLs differ get different folders', async () => {
  const run = runDir();
  const { deps } = fakeCapture();
  const dirs = [
    'https://x.com/a/b/c/d/e/x',
    'https://x.com/a/b/c/d/e/y',
    'https://x.com/p?id=1',
    'https://x.com/p?id=2',
  ].map(async (u) => (await capturePage(deps, run, u)).dir);
  expect(new Set(await Promise.all(dirs)).size).toBe(4);
});

test.each([
  ['stdout is pretty-printed JSON', undefined, 'uv'],
  ['the JSON has text around it', `log line\n${JSON.stringify({ title: 'uv' }, null, 2)}\nbye\n`, 'uv'],
  ['stdout is not JSON', 'done', 'docs.astral.sh'],
  ['stdout is JSON null', 'null', 'docs.astral.sh'],
  ['the title is not a string', '{"title": 3}', 'docs.astral.sh'],
])('title when %s', async (_name, stdout, title) => {
  const page = await capturePage(fakeCapture({ stdout }).deps, runDir(), UV);
  expect(page.title).toBe(title);
});

test('a second capture of the same page replaces the first', async () => {
  const run = runDir();
  await capturePage(fakeCapture().deps, run, UV);
  writeFileSync(path.join(run, UV_DIR, 'stale.txt'), 'old');
  await capturePage(fakeCapture().deps, run, UV);
  expect(existsSync(path.join(run, UV_DIR, 'stale.txt'))).toBe(false);
  expect(existsSync(path.join(run, UV_DIR, 'screenshots', 'full-page.png'))).toBe(true);
  const slug = path.posix.basename(UV_DIR);
  expect(readdirSync(path.join(run, 'capture', 'pages')).sort()).toEqual([slug, `${slug}.json`]);
});

test('a failed re-capture keeps the old capture and its record', async () => {
  const run = runDir();
  await capturePage(fakeCapture().deps, run, UV);
  await expect(capturePage(fakeCapture({ fail: true }).deps, run, UV)).rejects.toBeInstanceOf(ToolError);
  expect(existsSync(path.join(run, UV_DIR, 'screenshots', 'full-page.png'))).toBe(true);
  expect(existsSync(path.join(run, `${UV_DIR}.json`))).toBe(true);
  expect(existsSync(path.join(run, UV_DIR, 'partial.txt'))).toBe(false);
  expect(readdirSync(path.join(run, 'capture', 'pages'))).toHaveLength(2); // no .tmp- leftovers
});

test('a failed capture surfaces as ToolError naming the URL', async () => {
  const err = await capturePage(fakeCapture({ fail: true }).deps, runDir(), 'https://nope.invalid/').catch((e) => e);
  expect(err).toBeInstanceOf(ToolError);
  expect(err.message).toContain('capture of https://nope.invalid/ failed');
});

test('capturePage refuses a non-http URL before running anything', async () => {
  const { deps, calls } = fakeCapture();
  await expect(capturePage(deps, runDir(), 'file:///C:/secret.txt')).rejects.toThrow('http');
  expect(calls).toHaveLength(0);
});

// The full list of refused and allowed hosts is tested in lib/core/url.test.ts.
test.each([
  'not a url',
  'https://user:pw@example.com/',
  'http://127.0.0.1/',
  'http://169.254.169.254/latest/meta-data',
])('refuses %s before running anything', async (url) => {
  const { deps, calls } = fakeCapture();
  await expect(capturePage(deps, runDir(), url)).rejects.toBeInstanceOf(InputError);
  expect(calls).toHaveLength(0);
});

test('allows a public address', async () => {
  const { deps, calls } = fakeCapture();
  await capturePage(deps, runDir(), 'http://11.0.0.1/');
  expect(calls).toHaveLength(1);
});

test('a refused URL with a password does not echo the password', async () => {
  const err = await capturePage(fakeCapture().deps, runDir(), 'https://user:hunter2@example.com/').catch((e) => e);
  expect(err.message).not.toContain('hunter2');
});

test('a manifest font with an odd file name or a missing file is dropped, the rest kept', async () => {
  const fonts = [
    { file: '../../escape.woff2', family: 'Evil' },
    { file: '..', family: 'Dots' },
    { file: 'gone.woff2', family: 'Missing' },
    { file: 'a.woff2', family: 'Roboto' },
  ];
  const page = await capturePage(fakeCapture({ fonts }).deps, runDir(), UV);
  expect(page.fonts).toEqual([{ family: 'Roboto', path: `${UV_DIR}/assets/fonts/a.woff2` }]);
});

test('the palette keeps at most 12 colours', async () => {
  const page = await capturePage(fakeCapture({ colors: 15 }).deps, runDir(), UV);
  expect(page.palette).toHaveLength(12);
});

test('a capture without an extracted folder has no fonts and no palette', async () => {
  const page = await capturePage(fakeCapture({ noExtracted: true }).deps, runDir(), UV);
  expect(page.fonts).toEqual([]);
  expect(page.palette).toEqual([]);
});
