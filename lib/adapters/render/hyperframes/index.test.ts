import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HF_CMD, loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError, UnsupportedError } from '../../../core/errors';
import { hyperframesRender } from './index';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  mkdirSync(path.join(d, 'build', 'reel'), { recursive: true });
  writeFileSync(path.join(d, 'build', 'reel', 'index.html'), '<html></html>');
  writeFileSync(
    path.join(d, 'build', 'reel', 'scenes.json'),
    JSON.stringify([
      { scene_id: 'hook', start: 0, duration: 1.6 },
      { scene_id: 'demo', start: 1.6, duration: 3.9 },
    ]),
  );
  return d;
};

const fakeDeps = (handler: (cmd: string[]) => { code: number; stdout: string; stderr?: string }) => {
  const calls: string[][] = [];
  const timeouts: (number | undefined)[] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      timeouts.push(opts?.timeoutMs);
      const r = handler(cmd);
      if (r.code !== 0 && !opts?.allowFail) throw new ToolError({ cmd, code: r.code, stderr: r.stderr ?? '' });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
    },
  };
  return { deps, calls, timeouts };
};

const sub = (cmd: string[]) => cmd[HF_CMD.length];
const outOf = (cmd: string[]) => cmd[cmd.indexOf('-o') + 1] as string;
const snapshotFrames = (cmd: string[]) => {
  const out = outOf(cmd);
  mkdirSync(out, { recursive: true });
  for (const f of ['frame-00-at-0.8s.png', 'frame-01-at-2.4s.png', 'contact-sheet.jpg']) {
    writeFileSync(path.join(out, f), 'x');
  }
  return { code: 0, stdout: '' };
};

const checkJson = {
  ok: false,
  lint: {
    findings: [
      {
        code: 'non_deterministic_code',
        severity: 'error',
        message: 'Math.random',
        file: '/x/build/reel/compositions/demo.html',
      },
      { code: 'studio_missing_editable_id', severity: 'warning', message: 'no id', file: '/x/build/reel/index.html' },
    ],
  },
  runtime: { findings: [] },
  layout: { findings: [{ code: 'text_overflow', severity: 'error', message: 'overflows', selector: '#h', time: 0.8 }] },
  contrast: { findings: [{ code: 'contrast', severity: 'warning', message: 'low', time: 2.4 }] },
};

test('check maps every section of the HyperFrames check JSON to issues', async () => {
  const d = run();
  const { deps, calls } = fakeDeps(() => ({ code: 1, stdout: JSON.stringify(checkJson) }));
  expect(await hyperframesRender(deps).check(d)).toEqual([
    { severity: 'error', scene_id: 'demo', message: 'non_deterministic_code: Math.random' },
    { severity: 'warning', message: 'studio_missing_editable_id: no id' },
    { severity: 'error', scene_id: 'hook', message: 'layout text_overflow: overflows (#h at 0.8 s)' },
    { severity: 'warning', scene_id: 'demo', message: 'contrast contrast: low (at 2.4 s)' },
  ]);
  expect(calls[0]).toEqual([...HF_CMD, 'check', '--json', '--no-browser-gpu', path.join(d, 'build', 'reel')]);
});

test('check allows hyperframes check more than the lint timeout', async () => {
  const d = run();
  const { deps, timeouts } = fakeDeps(() => ({ code: 1, stdout: JSON.stringify(checkJson) }));
  await hyperframesRender(deps).check(d);
  expect(timeouts[0]).toBeGreaterThan(120_000);
});

test('lint returns the lint findings of one composition folder', async () => {
  const d = run();
  const stdout = JSON.stringify({
    findings: [{ code: 'bad', severity: 'error', message: 'broken', file: '/x/build/reel/compositions/hook.html' }],
  });
  const { deps, calls } = fakeDeps(() => ({ code: 1, stdout }));
  expect(await hyperframesRender(deps).lint(d)).toEqual([
    { severity: 'error', scene_id: 'hook', message: 'bad: broken' },
  ]);
  expect(calls[0]).toEqual([...HF_CMD, 'lint', '--json', path.join(d, 'build', 'reel')]);
});

test('check output that is not JSON is a ToolError with its first 500 characters', async () => {
  const d = run();
  const { deps } = fakeDeps(() => ({ code: 1, stdout: 'boom' }));
  await expect(hyperframesRender(deps).check(d)).rejects.toThrow(ToolError);
});

test('contactSheet snapshots inner points of each scene and returns out/sheets/reel.jpg', async () => {
  const d = run();
  const { deps, calls } = fakeDeps((cmd) => snapshotFrames(cmd));
  const sheet = await hyperframesRender(deps).contactSheet(d, 'reel', 2);
  expect(sheet).toBe(path.join(d, 'out', 'sheets', 'reel.jpg'));
  expect(existsSync(sheet)).toBe(true);
  expect(calls[0]).toContain('0.533,1.067,2.9,4.2');
});

test('still snapshots the given times and returns one PNG per time', async () => {
  const d = run();
  const { deps } = fakeDeps((cmd) => snapshotFrames(cmd));
  const stills = await hyperframesRender(deps).still(d, 'reel', [0.8, 2.4]);
  expect(stills).toEqual([
    path.join(d, 'out', 'stills', 'reel', 't-0.8.png'),
    path.join(d, 'out', 'stills', 'reel', 't-2.4.png'),
  ]);
  expect(stills.every((p) => existsSync(p))).toBe(true);
});

test('still refuses a pass filter it cannot honour', async () => {
  const d = run();
  const { deps } = fakeDeps((cmd) => snapshotFrames(cmd));
  await expect(hyperframesRender(deps).still(d, 'reel', [0.8], ['hook'])).rejects.toThrow(UnsupportedError);
});

test('render draft writes a temp file and renames it to out/drafts/reel.mp4', async () => {
  const d = run();
  const { deps, calls } = fakeDeps((cmd) => {
    if (sub(cmd) === 'render') writeFileSync(outOf(cmd), 'mp4');
    return { code: 0, stdout: '' };
  });
  const dest = await hyperframesRender(deps).render(d, 'reel', 'draft');
  expect(dest).toBe(path.join(d, 'out', 'drafts', 'reel.mp4'));
  expect(readFileSync(dest, 'utf8')).toBe('mp4');
  expect(existsSync(path.join(d, 'out', 'drafts', 'reel.tmp.mp4'))).toBe(false);
  expect(calls[0]).toEqual([
    ...HF_CMD,
    'render',
    path.join(d, 'build', 'reel'),
    '--quality',
    'draft',
    '--no-browser-gpu',
    '--quiet',
    '-o',
    path.join(d, 'out', 'drafts', 'reel.tmp.mp4'),
  ]);
});

test('render final uses delivery quality and out/final/reel.mp4', async () => {
  const d = run();
  const { deps, calls } = fakeDeps((cmd) => {
    if (sub(cmd) === 'render') writeFileSync(outOf(cmd), 'mp4');
    return { code: 0, stdout: '' };
  });
  expect(await hyperframesRender(deps).render(d, 'reel', 'final')).toBe(path.join(d, 'out', 'final', 'reel.mp4'));
  expect(calls[0]).toContain('delivery');
});

test('a failed render leaves no out/drafts/reel.mp4, even if an earlier one existed', async () => {
  const d = run();
  mkdirSync(path.join(d, 'out', 'drafts'), { recursive: true });
  writeFileSync(path.join(d, 'out', 'drafts', 'reel.mp4'), 'old');
  const { deps } = fakeDeps(() => ({ code: 1, stdout: '', stderr: 'boom' }));
  await expect(hyperframesRender(deps).render(d, 'reel', 'draft')).rejects.toThrow(ToolError);
  expect(existsSync(path.join(d, 'out', 'drafts', 'reel.mp4'))).toBe(false);
});

test('render refuses layer passes', async () => {
  const d = run();
  const { deps } = fakeDeps(() => ({ code: 0, stdout: '' }));
  await expect(hyperframesRender(deps).render(d, 'reel', 'draft', ['bg'])).rejects.toThrow(UnsupportedError);
});

test('supports reports every format as ok', () => {
  const { deps } = fakeDeps(() => ({ code: 0, stdout: '' }));
  expect(hyperframesRender(deps).supports('square')).toEqual({ ok: true });
});

test('a format with no build folder asks for the scenes to be built first', async () => {
  const d = run();
  const { deps } = fakeDeps((cmd) => snapshotFrames(cmd));
  await expect(hyperframesRender(deps).still(d, 'square', [1])).rejects.toThrow(InputError);
  await expect(hyperframesRender(deps).still(d, 'square', [1])).rejects.toThrow('build the scenes first');
});
