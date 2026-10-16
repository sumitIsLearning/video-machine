import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ToolError } from '../../../core/errors';
import { browserChannel } from '../../capture/playwright/browser';
import { frameDiffs, hfRuntimeFile, measureText, snapshotHashes } from './measure';

const roots: string[] = [];
const tempRoot = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

type Handler = (cmd: string[]) => { code: number; stdout: string; stderr?: string };

const fakeDeps = (vmHome: string, handler: Handler) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: vmHome }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      const r = handler(cmd);
      if (r.code !== 0 && !opts?.allowFail) throw new ToolError({ cmd, code: r.code, stderr: r.stderr ?? '' });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
    },
  };
  return { deps, calls };
};

const argAfter = (cmd: string[], flag: string): string => cmd[cmd.indexOf(flag) + 1] as string;

test('hfRuntimeFile when the file is missing packs and extracts it, then removes the temp folder', async () => {
  const vmHome = tempRoot();
  const runtime = path.join(vmHome, 'hf', '0.8.143', 'hyperframe.runtime.iife.js');
  const { deps, calls } = fakeDeps(vmHome, (cmd) => {
    if (cmd[1] === 'pack') {
      writeFileSync(path.join(argAfter(cmd, '--pack-destination'), 'hyperframes-0.8.143.tgz'), 'tgz');
    } else {
      const dest = cmd[cmd.indexOf('-C') + 1] as string;
      mkdirSync(path.join(dest, 'package', 'dist'), { recursive: true });
      writeFileSync(path.join(dest, 'package', 'dist', 'hyperframe.runtime.iife.js'), 'runtime');
    }
    return { code: 0, stdout: '' };
  });

  expect(await hfRuntimeFile(deps)).toBe(runtime);
  expect(readFileSync(runtime, 'utf8')).toBe('runtime');
  const pack = calls[0] as string[];
  expect(pack.slice(0, 3)).toEqual(['npm', 'pack', 'hyperframes@0.8.143']);
  const tmp = argAfter(pack, '--pack-destination');
  const tar = calls[1] as string[];
  expect(tar.slice(0, 6)).toEqual([
    'tar',
    '-xzf',
    path.join(tmp, 'hyperframes-0.8.143.tgz'),
    '-C',
    tmp,
    'package/dist/hyperframe.runtime.iife.js',
  ]);
  expect(existsSync(tmp)).toBe(false);
});

test('hfRuntimeFile runs nothing when the runtime file already exists', async () => {
  const vmHome = tempRoot();
  const runtime = path.join(vmHome, 'hf', '0.8.143', 'hyperframe.runtime.iife.js');
  mkdirSync(path.dirname(runtime), { recursive: true });
  writeFileSync(runtime, 'runtime');
  const { deps, calls } = fakeDeps(vmHome, () => ({ code: 0, stdout: '' }));

  expect(await hfRuntimeFile(deps)).toBe(runtime);
  expect(calls).toEqual([]);
});

test('hfRuntimeFile rejects when npm fails and leaves no temp folder behind', async () => {
  const vmHome = tempRoot();
  const { deps } = fakeDeps(vmHome, () => ({ code: 1, stdout: '', stderr: 'npm ERR! network' }));

  await expect(hfRuntimeFile(deps)).rejects.toBeInstanceOf(ToolError);
  const hfDir = path.join(vmHome, 'hf');
  expect(readdirSync(hfDir).filter((name) => name.startsWith('tmp-'))).toEqual([]);
});

test('frameDiffs parses the YMAX line of each frame pair and prepends 0', async () => {
  const vmHome = tempRoot();
  const mp4 = path.join(vmHome, 'clip.mp4');
  const { deps, calls } = fakeDeps(vmHome, () => ({
    code: 0,
    stdout: 'frame:0 pts:1\nlavfi.signalstats.YMAX=39\nframe:1 pts:2\nlavfi.signalstats.YMAX=0\n',
  }));

  expect(await frameDiffs(deps, mp4)).toEqual([0, 39, 0]);
  expect(calls[0]).toEqual([
    'ffmpeg',
    '-v',
    'error',
    '-i',
    mp4,
    '-vf',
    'format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-',
    '-f',
    'null',
    '-',
  ]);
});

test('snapshotHashes returns the sha256 of each snapshot frame in time order', async () => {
  const vmHome = tempRoot();
  const dir = tempRoot();
  const contents = ['first frame', 'second frame'];
  const { deps } = fakeDeps(vmHome, (cmd) => {
    const out = argAfter(cmd, '-o');
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'frame-00-at-1s.png'), contents[0] as string);
    writeFileSync(path.join(out, 'frame-01-at-2s.png'), contents[1] as string);
    return { code: 0, stdout: '' };
  });

  const hashes = await snapshotHashes(deps, dir, [1, 2]);
  expect(hashes).toEqual(contents.map((c) => createHash('sha256').update(c).digest('hex')));
});

// A tiny build that stands in for a composition: its own `__player` (seek sets a class) replaces the HyperFrames runtime.
const writeFixtureBuild = (dir: string): string => {
  writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><html><body style="margin:0">
<div id="root" data-composition-id="root" data-width="640" data-height="360">
  <div data-composition-id="intro" style="position:absolute;inset:0">
    <h1 style="font-size:40px;margin:0">Hello world</h1>
    <p style="visibility:hidden;font-size:20px">Hidden text</p>
    <div data-vm-caption style="font-size:16px">Caption words</div>
  </div>
</div>
</body></html>`,
  );
  const stub = path.join(dir, 'runtime-stub.js');
  writeFileSync(
    stub,
    `window.__player = { seek(t) { document.body.classList.add('seeked-' + t); } };
window.__playerReady = true;
window.__renderReady = true;`,
  );
  return stub;
};

test.skipIf((await browserChannel()) === null)(
  'measureText throws ToolError when the root composition has no data-width',
  async () => {
    const build = tempRoot();
    writeFileSync(
      path.join(build, 'index.html'),
      '<!doctype html><html><body><div id="root" data-composition-id="root"></div></body></html>',
    );
    const runtime = path.join(build, 'runtime-stub.js');
    writeFileSync(runtime, 'window.__playerReady = true;\nwindow.__renderReady = true;');

    const error = await measureText(build, runtime, [0.5]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).stderrTail).toContain('root composition has no data-width/data-height');
  },
  60_000,
);

test.skipIf((await browserChannel()) === null)(
  'measureText returns visible text boxes with caption and scene ids',
  async () => {
    const build = tempRoot();
    const runtime = writeFixtureBuild(build);
    const samples = await measureText(build, runtime, [0.5]);

    const h1 = samples.find((s) => s.text === 'Hello world');
    expect(h1?.t).toBe(0.5);
    expect(h1?.scene_id).toBe('intro');
    expect(h1?.caption).toBe(false);
    expect(h1?.font_px).toBe(40);
    expect(h1?.box.w).toBeGreaterThan(0);
    expect(samples.some((s) => s.text === 'Hidden text')).toBe(false);
    expect(samples.find((s) => s.text === 'Caption words')?.caption).toBe(true);
  },
  60_000,
);
