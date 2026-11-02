import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssetsSchema } from '../../../contracts/types';
import { HF_CMD, loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { lintComposition, renderBoard, snapshotComposition, writeComposition } from './compose';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const HTML = '<!doctype html><html><head><script src="vendor/gsap.min.js"></script></head><body></body></html>';
const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  mkdirSync(path.join(d, 'capture', 'shots'), { recursive: true });
  writeFileSync(path.join(d, 'capture', 'shots', '7.png'), 'png');
  const a = { kind: 'image', path: 'capture/shots/7.png', source: 's', origin: 'captured' } as const;
  writeJson(path.join(d, 'assets.json'), AssetsSchema, {
    run_id: 'r',
    assets: [
      { ...a, asset_id: 'captured-aaaa1111', license: 'own capture of x', usage: 'render' },
      { ...a, asset_id: 'captured-dropped1', license: 'own capture of x', usage: 'render', status: 'dropped' },
      { ...a, asset_id: 'web-font0001', kind: 'font', license: 'unknown', usage: 'reference_only' },
    ],
  });
  return d;
};

test('writes index.html, vendors GSAP and copies assets by id', () => {
  const d = run();
  const out = writeComposition(d, 'boards/s1', HTML, ['captured-aaaa1111']);
  expect(out.assets).toEqual({ 'captured-aaaa1111': 'assets/captured-aaaa1111.png' });
  expect(readFileSync(path.join(out.dir, 'index.html'), 'utf8')).toBe(HTML);
  expect(existsSync(path.join(out.dir, 'vendor', 'gsap.min.js'))).toBe(true);
  expect(readFileSync(path.join(out.dir, 'assets', 'captured-aaaa1111.png'), 'utf8')).toBe('png');
});

test('refuses unknown, dropped and reference-only assets', () => {
  const d = run();
  expect(() => writeComposition(d, 'boards/s1', HTML, ['nope'])).toThrow('unknown asset "nope"');
  expect(() => writeComposition(d, 'boards/s1', HTML, ['captured-dropped1'])).toThrow(
    'asset "captured-dropped1" can\'t render (dropped)',
  );
  expect(() => writeComposition(d, 'boards/s1', HTML, ['web-font0001'])).toThrow(
    'asset "web-font0001" can\'t render (reference only, unknown licence)',
  );
  expect(existsSync(path.join(d, 'boards', 's1'))).toBe(false);
});

test('refuses HTML that loads a script or stylesheet from the web', () => {
  const d = run();
  const cdn = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>';
  expect(() => writeComposition(d, 'boards/s1', cdn, [])).toThrow(InputError);
  expect(() => writeComposition(d, 'boards/s1', '<link rel="stylesheet" href="http://x.example/a.css">', [])).toThrow(
    'loads http://x.example/a.css from the web',
  );
  expect(existsSync(path.join(d, 'boards', 's1'))).toBe(false);
});

test('refuses an image that loads from the web', () => {
  const d = run();
  expect(() => writeComposition(d, 'boards/s1', '<img src="https://cdn.example/a.png">', [])).toThrow(
    'loads https://cdn.example/a.png from the web',
  );
  expect(existsSync(path.join(d, 'boards', 's1'))).toBe(false);
});

test('refuses CSS that loads a URL from the web', () => {
  const d = run();
  const css = '<style>body { background: url(//cdn.example/bg.png); }</style>';
  expect(() => writeComposition(d, 'boards/s1', css, [])).toThrow('loads //cdn.example/bg.png from the web');
  expect(existsSync(path.join(d, 'boards', 's1'))).toBe(false);
});

test('refuses a folder outside the run', () => {
  const d = run();
  expect(() => writeComposition(d, '../escape', HTML, [])).toThrow(InputError);
  expect(existsSync(path.join(d, '..', 'escape'))).toBe(false);
});

const fakeDeps = (handler: (cmd: string[]) => { code: number; stdout: string; stderr?: string }) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      const r = handler(cmd);
      if (r.code !== 0 && !opts?.allowFail) throw new ToolError({ cmd, code: r.code, stderr: r.stderr ?? '' });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
    },
  };
  return { deps, calls };
};

test('a board that fails lint leaves no PNG from an earlier render', async () => {
  const d = run();
  mkdirSync(path.join(d, 'boards'), { recursive: true });
  writeFileSync(path.join(d, 'boards', 'hook.png'), 'old');
  const stdout = JSON.stringify({ findings: [{ code: 'bad', severity: 'error', message: 'broken' }] });
  const { deps } = fakeDeps(() => ({ code: 1, stdout }));
  await expect(
    renderBoard(deps, d, 'boards/hook', '<html></html>', [], 1, 'board hook', 'boards/hook.png'),
  ).rejects.toThrow('board hook has lint errors');
  expect(existsSync(path.join(d, 'boards', 'hook.png'))).toBe(false);
});

test('lint maps findings into errors and warnings', async () => {
  const stdout = JSON.stringify({
    ok: false,
    errorCount: 1,
    warningCount: 1,
    findings: [
      { code: 'missing_local_asset', severity: 'error', message: 'img missing' },
      { code: 'slow', severity: 'warning', message: 'be quick' },
    ],
  });
  const { deps, calls } = fakeDeps(() => ({ code: 1, stdout }));
  expect(await lintComposition(deps, '/x/comp')).toEqual({
    errors: ['missing_local_asset: img missing'],
    warnings: ['slow: be quick'],
  });
  expect(calls[0]).toEqual([...HF_CMD, 'lint', '--json', '/x/comp']);
});

test('lint output that is not JSON is a ToolError', async () => {
  const { deps } = fakeDeps(() => ({ code: 1, stdout: 'boom' }));
  await expect(lintComposition(deps, '/x/comp')).rejects.toThrow(ToolError);
});

test('snapshot runs software-only and returns the frames in --at order', async () => {
  const d = run();
  const { deps, calls } = fakeDeps((cmd) => {
    const out = cmd[cmd.indexOf('-o') + 1] ?? '';
    mkdirSync(out, { recursive: true });
    for (const f of ['frame-01-at-2s.png', 'frame-00-at-0.5s.png', 'contact-sheet.jpg'])
      writeFileSync(path.join(out, f), f);
    return { code: 0, stdout: '' };
  });
  const frames = await snapshotComposition(deps, path.join(d, 'boards', 's1'), [0.5, 2]);
  expect(frames.map((f) => path.basename(f))).toEqual(['frame-00-at-0.5s.png', 'frame-01-at-2s.png']);
  expect(calls[0]).toEqual([
    ...HF_CMD,
    'snapshot',
    path.join(d, 'boards', 's1'),
    '--at',
    '0.5,2',
    '--no-end',
    '--describe',
    'false',
    '--no-browser-gpu',
    '-o',
    path.join(d, 'boards', 's1', 'snaps'),
  ]);
});

test('snapshot refuses an empty list of times', async () => {
  const { deps, calls } = fakeDeps(() => ({ code: 0, stdout: '' }));
  await expect(snapshotComposition(deps, '/x/comp', [])).rejects.toThrow('snapshot needs at least one time');
  expect(calls).toEqual([]);
});

const BAND = { x: 0, y: 1056, w: 1080, h: 864 };
const BAND_DIV =
  '<div data-vm-band style="position:absolute;left:0px;top:1056px;width:1080px;height:864px;background:#9aa1b0;display:flex;align-items:center;justify-content:center;font:40px sans-serif;color:#ffffff">presenter</div>';
const ROOT_HTML = '<html><body><div id="root"><p>a</p></div></body></html>';
const passingBoardDeps = () =>
  fakeDeps((cmd) => {
    if (cmd.includes('lint')) return { code: 0, stdout: '{"findings":[]}' };
    const out = cmd[cmd.indexOf('-o') + 1] ?? '';
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'frame-00-at-1s.png'), 'png');
    return { code: 0, stdout: '' };
  });

test('renderBoard with a band puts the presenter band right before the root close tag', async () => {
  const d = run();
  const { deps } = passingBoardDeps();
  await renderBoard(deps, d, 'boards/hook', ROOT_HTML, [], 1, 'board hook', 'boards/hook.png', BAND);
  expect(readFileSync(path.join(d, 'boards', 'hook', 'index.html'), 'utf8')).toBe(
    `<html><body><div id="root"><p>a</p>${BAND_DIV}</div></body></html>`,
  );
});

test('renderBoard without a band writes no presenter band', async () => {
  const d = run();
  const { deps } = passingBoardDeps();
  await renderBoard(deps, d, 'boards/hook', ROOT_HTML, [], 1, 'board hook', 'boards/hook.png');
  expect(readFileSync(path.join(d, 'boards', 'hook', 'index.html'), 'utf8')).toBe(ROOT_HTML);
});

test('renderBoard with a band refuses html without id="root"', async () => {
  const d = run();
  const { deps, calls } = passingBoardDeps();
  await expect(
    renderBoard(
      deps,
      d,
      'boards/hook',
      '<html><body><p>a</p></body></html>',
      [],
      1,
      'board hook',
      'boards/hook.png',
      BAND,
    ),
  ).rejects.toThrow('board hook has no <div id="root">; the presenter band needs it');
  expect(calls).toEqual([]);
});

test('renderBoard with a band refuses html whose root has no closing </div>', async () => {
  const d = run();
  const { deps, calls } = passingBoardDeps();
  await expect(
    renderBoard(
      deps,
      d,
      'boards/hook',
      '<html><body><div id="root"><p>a</p></body></html>',
      [],
      1,
      'board hook',
      'boards/hook.png',
      BAND,
    ),
  ).rejects.toThrow('board hook has no <div id="root">; the presenter band needs it');
  expect(calls).toEqual([]);
});
