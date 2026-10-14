import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetIdOf } from '../core/asset-id';
import { InputError } from '../core/errors';
import { buildPool, markAsset } from './pool';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const put = (dir: string, rel: string, body: unknown = 'x') => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body));
};

/** A run with one of each source. Nav folder is capture/nav/demo-1a2b3c4d (never assume capture/nav/nav). */
const makeRun = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(dir);
  const frames = [
    { i: 0, t: 0, path: 'capture/nav/demo-1a2b3c4d/f0.jpg' },
    { i: 1, t: 2, path: 'capture/nav/demo-1a2b3c4d/f1.jpg' },
  ];
  put(dir, 'concept.md', 'c');
  put(dir, 'brief.json', {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [10, 20],
    timing_source: 'voiceover',
    sources: [
      { kind: 'file', path_or_url: 'input/logo.png' },
      { kind: 'file', path_or_url: 'input/notes.txt' },
      { kind: 'file', path_or_url: 'input/gone.png' },
      { kind: 'nav_video', path_or_url: 'input/nav.webm' },
    ],
  });
  for (const f of ['input/logo.png', 'input/notes.txt', 'input/nav.webm', ...frames.map((f) => f.path)]) put(dir, f);
  put(dir, 'capture/nav/demo-1a2b3c4d/frames.json', {
    source: 'input/nav.webm',
    has_audio: false,
    frames,
    sheets: ['capture/nav/demo-1a2b3c4d/sheet-01.jpg'],
  });
  put(dir, 'capture/log.json', [{ i: 0, t0: 0, t1: 1, url: 'https://example.com/app', fallback: frames[0]?.path }]);
  for (const f of ['capture/shots/0.png', 'capture/shots/0-before.png', 'capture/crops/0.png', 'capture/clips/0.mp4'])
    put(dir, f);
  for (const f of ['shot.png', 'logo.svg', 'f.woff2']) put(dir, `capture/pages/ex/${f}`);
  put(dir, 'capture/pages/ex.json', {
    url: 'https://ex.com/',
    title: 'Ex',
    dir: 'capture/pages/ex',
    screenshots: ['capture/pages/ex/shot.png'],
    logos: ['capture/pages/ex/logo.svg'],
    fonts: [{ family: 'Inter', path: 'capture/pages/ex/f.woff2' }],
    palette: [],
  });
  put(dir, 'found/a.jpg');
  put(dir, 'found/b.svg');
  put(dir, 'found/index.json', [
    {
      asset_id: assetIdOf('found', 'found/a.jpg'),
      kind: 'image',
      path: 'found/a.jpg',
      source: 'https://openverse.org/a',
      license: 'CC BY 2.0',
      usage: 'render',
      origin: 'found',
      attribution: 'By A',
    },
    {
      asset_id: assetIdOf('found', 'found/b.svg'),
      kind: 'image',
      path: 'found/b.svg',
      source: 'https://openverse.org/b',
      license: 'CC0 1.0',
      usage: 'render',
      origin: 'found',
    },
  ]);
  return dir;
};

const byPath = (dir: string) => {
  const pool = buildPool(dir);
  const get = (p: string) => {
    const a = pool.assets.find((x) => x.path === p);
    if (!a) throw new Error(`no asset for ${p}`);
    return a;
  };
  return { pool, get };
};

test('buildPool gives supplied files their kind, licence and usage, and skips missing files', () => {
  const { pool, get } = byPath(makeRun());
  expect(get('input/logo.png')).toMatchObject({
    origin: 'supplied',
    kind: 'image',
    license: 'creator-supplied',
    usage: 'render',
    source: 'creator',
    status: 'pool',
  });
  expect(get('input/notes.txt').kind).toBe('data');
  expect(pool.assets.some((a) => a.path === 'input/gone.png')).toBe(false);
});

test('buildPool marks the fallback frame render and the other frame reference_only', () => {
  const { get } = byPath(makeRun());
  expect(get('input/nav.webm')).toMatchObject({ origin: 'nav_video', kind: 'video', usage: 'reference_only' });
  expect(get('capture/nav/demo-1a2b3c4d/f0.jpg')).toMatchObject({ origin: 'nav_video', usage: 'render' });
  expect(get('capture/nav/demo-1a2b3c4d/f1.jpg').usage).toBe('reference_only');
});

test('buildPool takes replay output with the step url, but not the before shots', () => {
  const { pool, get } = byPath(makeRun());
  for (const p of ['capture/shots/0.png', 'capture/crops/0.png', 'capture/clips/0.mp4'])
    expect(get(p)).toMatchObject({
      origin: 'captured',
      license: 'own capture of https://example.com/app',
      source: 'https://example.com/app',
      usage: 'render',
    });
  expect(get('capture/clips/0.mp4').kind).toBe('video');
  expect(pool.assets.some((a) => a.path.endsWith('-before.png'))).toBe(false);
});

test('buildPool takes page captures, and their fonts are unknown and reference_only', () => {
  const { get } = byPath(makeRun());
  expect(get('capture/pages/ex/shot.png')).toMatchObject({
    origin: 'web',
    license: 'page capture of https://ex.com/',
    usage: 'render',
  });
  expect(get('capture/pages/ex/logo.svg').kind).toBe('svg');
  expect(get('capture/pages/ex/f.woff2')).toMatchObject({
    kind: 'font',
    license: 'unknown',
    usage: 'reference_only',
    title: 'Inter',
  });
});

test('buildPool keeps found assets as is, but an svg result becomes kind svg', () => {
  const { get } = byPath(makeRun());
  expect(get('found/a.jpg')).toMatchObject({ origin: 'found', kind: 'image', attribution: 'By A' });
  expect(get('found/b.svg').kind).toBe('svg');
});

test('buildPool ids match assetIdOf and the order is origin then path', () => {
  const { pool, get } = byPath(makeRun());
  expect(get('input/logo.png').asset_id).toBe(assetIdOf('supplied', 'input/logo.png'));
  expect(get('capture/shots/0.png').asset_id).toBe(assetIdOf('captured', 'capture/shots/0.png'));
  const order = ['supplied', 'nav_video', 'captured', 'web', 'found'];
  const origins = pool.assets.map((a) => order.indexOf(a.origin));
  expect(origins).toEqual([...origins].sort((a, b) => a - b));
});

test('buildPool works on a run with no brief, capture or found folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(dir);
  put(dir, 'concept.md', 'c');
  expect(buildPool(dir).assets).toEqual([]);
});

test('a pin survives a second buildPool', () => {
  const dir = makeRun();
  const id = assetIdOf('supplied', 'input/logo.png');
  buildPool(dir);
  markAsset(dir, id, 'pinned');
  markAsset(dir, assetIdOf('found', 'found/a.jpg'), 'dropped');
  const again = buildPool(dir);
  expect(again.assets.find((a) => a.asset_id === id)?.status).toBe('pinned');
  expect(again.assets.find((a) => a.path === 'found/a.jpg')?.status).toBe('dropped');
});

const foundRecord = (extra: object) => ({
  asset_id: 'whatever-00000000',
  kind: 'image',
  path: 'found/a.jpg',
  source: 'https://openverse.org/a',
  license: 'CC0 1.0',
  usage: 'render',
  origin: 'found',
  ...extra,
});

test('a found record with an unknown licence is forced to reference_only and pool', () => {
  const dir = makeRun();
  put(dir, 'found/index.json', [foundRecord({ license: ' Unknown ', status: 'pinned' })]);
  const a = buildPool(dir).assets.find((x) => x.path === 'found/a.jpg');
  expect(a).toMatchObject({ usage: 'reference_only', status: 'pool' });
  put(dir, 'found/index.json', [foundRecord({ license: '  ' })]);
  expect(buildPool(dir).assets.find((x) => x.path === 'found/a.jpg')?.usage).toBe('reference_only');
});

test('a found record is normalised to origin found and the assetIdOf id', () => {
  const dir = makeRun();
  put(dir, 'found/index.json', [foundRecord({ origin: 'supplied', asset_id: 'supplied-deadbeef' })]);
  const a = buildPool(dir).assets.find((x) => x.path === 'found/a.jpg');
  expect(a?.origin).toBe('found');
  expect(a?.asset_id).toBe(assetIdOf('found', 'found/a.jpg'));
});

test('a pin resets to pool on rebuild when the licence became unknown', () => {
  const dir = makeRun();
  put(dir, 'found/index.json', [foundRecord({})]);
  buildPool(dir);
  const id = assetIdOf('found', 'found/a.jpg');
  expect(markAsset(dir, id, 'pinned').assets.find((a) => a.asset_id === id)?.status).toBe('pinned');
  put(dir, 'found/index.json', [foundRecord({ license: 'unknown' })]);
  expect(buildPool(dir).assets.find((a) => a.asset_id === id)?.status).toBe('pool');
});

test('stray files in the shots, crops and clips folders are not assets', () => {
  const dir = makeRun();
  for (const f of ['shots/.DS_Store', 'shots/n.json', 'crops/n.txt', 'clips/0.png', 'shots/0.mp4'])
    put(dir, `capture/${f}`);
  const paths = buildPool(dir, { onWarn: () => {} }).assets.map((a) => a.path);
  for (const f of ['shots/.DS_Store', 'shots/n.json', 'crops/n.txt', 'clips/0.png', 'shots/0.mp4'])
    expect(paths).not.toContain(`capture/${f}`);
  expect(paths).toContain('capture/shots/0.png');
});

test('symlinked folders that point outside the run contribute nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'vm-out-'));
  temps.push(dir, outside);
  put(dir, 'concept.md', 'c');
  put(outside, 'shots/0.png');
  put(outside, 'nav/frames.json', {
    source: 'input/nav.webm',
    has_audio: false,
    frames: [{ i: 0, t: 0, path: 'capture/nav/x/f.jpg' }],
    sheets: ['capture/nav/x/s.jpg'],
  });
  put(outside, 'nav/f.jpg');
  mkdirSync(path.join(dir, 'capture', 'nav'), { recursive: true });
  symlinkSync(path.join(outside, 'shots'), path.join(dir, 'capture', 'shots'));
  symlinkSync(path.join(outside, 'nav'), path.join(dir, 'capture', 'nav', 'x'));
  const warns: string[] = [];
  expect(buildPool(dir, { onWarn: (l) => warns.push(l) }).assets).toEqual([]);
  expect(warns.some((w) => w.startsWith('[M4] skipped capture/shots'))).toBe(true);
  expect(warns.some((w) => w.startsWith('[M4] skipped capture/nav/x'))).toBe(true);
});

test('a missing, dangling or folder asset is skipped with a warning, not an abort', () => {
  const dir = makeRun();
  put(dir, 'input/dir/x');
  put(dir, 'brief.json', {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [10, 20],
    timing_source: 'voiceover',
    sources: [
      { kind: 'file', path_or_url: 'input/gone.png' },
      { kind: 'file', path_or_url: 'input/dir' },
      { kind: 'file', path_or_url: 'input/dangling.png' },
      { kind: 'file', path_or_url: 'input/logo.png' },
    ],
  });
  symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'input', 'dangling.png'));
  const warns: string[] = [];
  const paths = buildPool(dir, { onWarn: (l) => warns.push(l) }).assets.map((a) => a.path);
  expect(paths).toContain('input/logo.png');
  for (const p of ['input/gone.png', 'input/dir', 'input/dangling.png'])
    expect(warns.some((w) => w.startsWith(`[M4] skipped ${p}: `))).toBe(true);
});

test('two page captures naming the same font give one asset', () => {
  const dir = makeRun();
  put(dir, 'capture/pages/ex2.json', {
    url: 'https://ex2.com/',
    title: 'Ex2',
    dir: 'capture/pages/ex',
    screenshots: [],
    logos: [],
    fonts: [{ family: 'Inter', path: 'capture/pages/ex/f.woff2' }],
    palette: [],
  });
  const fonts = buildPool(dir).assets.filter((a) => a.path === 'capture/pages/ex/f.woff2');
  expect(fonts).toHaveLength(1);
});

test('shots with no log.json get the plain own-capture licence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(dir);
  put(dir, 'concept.md', 'c');
  put(dir, 'capture/shots/0.png');
  expect(buildPool(dir).assets[0]).toMatchObject({ license: 'own capture', origin: 'captured' });
});

test('markAsset refuses an unknown id and an unknown-licence pin', () => {
  const dir = makeRun();
  buildPool(dir);
  expect(() => markAsset(dir, 'nope-00000000', 'pinned')).toThrow(InputError);
  const font = assetIdOf('web', 'capture/pages/ex/f.woff2');
  expect(() => markAsset(dir, font, 'pinned')).toThrow('cannot pin web-');
  expect(markAsset(dir, font, 'dropped').assets.find((a) => a.asset_id === font)?.status).toBe('dropped');
});
