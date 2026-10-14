import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Assets } from '../contracts/types';
import { writePanel } from './panel';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const base = { license: 'CC0', usage: 'render', status: 'pool', source: 'creator' } as const;
const pool: Assets = {
  run_id: 'r',
  assets: [
    { ...base, asset_id: 'captured-11111111', kind: 'image', path: 'capture/shots/0.png', origin: 'captured' },
    {
      ...base,
      asset_id: 'found-22222222',
      kind: 'image',
      path: 'found/a.jpg',
      origin: 'found',
      title: '<script>alert(1)</script>',
      attribution: 'By "A" & B',
      source: 'https://openverse.org/a?x=1&y=2',
    },
    { ...base, asset_id: 'captured-33333333', kind: 'video', path: 'capture/clips/0.mp4', origin: 'captured' },
    { ...base, asset_id: 'supplied-44444444', kind: 'audio', path: 'input/v.wav', origin: 'supplied' },
    { ...base, asset_id: 'web-55555555', kind: 'font', path: 'capture/pages/x/f.woff2', origin: 'web', title: 'Inter' },
  ],
};

const panelOf = (assets: Assets['assets'], files: string[] = [], onWarn: (l: string) => void = () => {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(dir);
  writeFileSync(path.join(dir, 'concept.md'), 'c');
  writeFileSync(path.join(dir, 'assets.json'), JSON.stringify({ run_id: 'r', assets }));
  for (const f of files) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), 'x');
  }
  return readFileSync(writePanel(dir, { onWarn }), 'utf8');
};
const one = (extra: object) =>
  ({
    ...base,
    asset_id: 'found-9',
    kind: 'image',
    path: 'found/a.jpg',
    origin: 'found',
    ...extra,
  }) as Assets['assets'][0];

test('a javascript: source is not made a link', () => {
  const html = panelOf([one({ source: 'javascript:alert(1)' })], ['found/a.jpg']);
  expect(html).not.toContain('href="javascript');
  expect(html).not.toContain('<a href');
});

test('quotes and onerror= in a title stay inside the attribute', () => {
  const html = panelOf([one({ title: '" onerror="alert(1)' })], ['found/a.jpg']);
  expect(html).not.toContain('" onerror=');
  expect(html).toContain('alt="&quot; onerror=&quot;alert(1)"');
});

test('a path with a space or # is encoded', () => {
  const html = panelOf([one({ path: 'found/a b#c.jpg' })], ['found/a b#c.jpg']);
  expect(html).toContain('src="../found/a%20b%23c.jpg"');
});

test('a link gets rel noopener noreferrer', () => {
  expect(panelOf([one({ source: 'https://x.org/a' })], ['found/a.jpg'])).toContain('rel="noopener noreferrer"');
});

test('an asset whose file is gone is left out with a warning', () => {
  const warns: string[] = [];
  const html = panelOf([one({})], [], (l) => warns.push(l));
  expect(html).not.toContain('found-9');
  expect(warns[0]).toStartWith('[M4] skipped found/a.jpg');
});

const panel = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(dir);
  writeFileSync(path.join(dir, 'concept.md'), 'c');
  writeFileSync(path.join(dir, 'assets.json'), JSON.stringify(pool));
  for (const a of pool.assets) {
    mkdirSync(path.dirname(path.join(dir, a.path)), { recursive: true });
    writeFileSync(path.join(dir, a.path), 'x');
  }
  const file = writePanel(dir);
  expect(file).toBe(path.join(dir, 'out', 'assets-panel.html'));
  return readFileSync(file, 'utf8');
};

test('the panel shows every asset id', () => {
  const html = panel();
  for (const a of pool.assets) expect(html).toContain(a.asset_id);
});

test('the panel escapes values and has no script tag', () => {
  const html = panel();
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script');
  expect(html).toContain('By &quot;A&quot; &amp; B');
  expect(html).toContain('href="https://openverse.org/a?x=1&amp;y=2"');
});

test('the panel points thumbnails at the run files', () => {
  const html = panel();
  expect(html).toContain('<img src="../capture/shots/0.png"');
  expect(html).toContain('<video controls muted src="../capture/clips/0.mp4"');
  expect(html).toContain('<audio controls src="../input/v.wav"');
  expect(html).toContain('prefers-color-scheme');
});
