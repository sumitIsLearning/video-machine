import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Launch, ReplayPage } from '../adapters/capture/playwright/browser';
import { profileDirOf } from '../adapters/capture/playwright/index';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError } from '../core/errors';
import { main } from './cli';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};
const run = () => {
  const d = temp();
  mkdirSync(path.join(d, 'input'));
  for (const f of ['concept.md', 'input/nav.webm']) writeFileSync(path.join(d, f), 'x');
  return d;
};
const NAV = 'capture/nav/nav-';

/** A fake ffmpeg/ffprobe: a 3 s silent video with no scene changes, and it writes whatever file it is asked for. */
const deps = (vmHome = temp()): Deps => ({
  config: loadConfig({ PATH: '/bin', VM_HOME: vmHome }),
  sh: async (cmd, opts) => {
    const line = cmd.join(' ');
    const cwd = opts?.cwd ?? '';
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (cmd[0] === 'ffprobe') return ok(line.includes('format=duration') ? '3\n' : '');
    if (line.includes('metadata=print')) return ok();
    if (line.includes('tile=4x3')) writeFileSync(path.join(cwd, 'sheet-01.jpg'), 'jpg');
    else if (cmd[0] === 'ffmpeg') writeFileSync(path.join(cwd, cmd.at(-1) ?? ''), 'out');
    return ok();
  },
});

const step = (i: number, target: string, extra: object = {}) => ({
  i,
  url: 'https://example.com/app',
  action: 'click',
  target,
  expect: 'something happens',
  ...extra,
});

test('read returns the nav frames of the video', async () => {
  const dir = run();
  const r = await main(['read', dir, 'input/nav.webm'], { deps: deps() });
  expect(r.source).toBe('input/nav.webm');
  expect(String((r.frames as { path: string }[])[0]?.path).startsWith(NAV)).toBe(true);
  expect(r.sheets).toHaveLength(1);
});

test('steps validates the draft on stdin and writes capture/steps.json', async () => {
  const dir = run();
  const draft = JSON.stringify([step(0, 'Export')]);
  const r = await main(['steps', dir], { deps: deps(), stdin: async () => new TextEncoder().encode(draft) });
  expect(r).toEqual({ steps: 'capture/steps.json', count: 1 });
});

test('steps with a draft that is not JSON is an input error', async () => {
  const err = await main(['steps', run()], { deps: deps(), stdin: async () => new TextEncoder().encode('{') }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InputError);
});

/** A page where 'Nope' cannot be found; it records the profile and whether it was asked to record video. */
const launches: Parameters<Launch>[0][] = [];
const fakeLaunch: Launch = async (o) => {
  launches.push(o);
  let url = '';
  const page: ReplayPage = {
    goto: async (u) => {
      url = u;
    },
    click: async () => {},
    type: async () => {},
    scroll: async () => {},
    wait: async () => {},
    box: async (target) => (target === 'Nope' ? null : { x: 10, y: 10, w: 100, h: 40 }),
    isPassword: async () => false,
    screenshot: async (f) => writeFileSync(f, 'png'),
    text: async () => 'text',
    url: () => url,
    close: async () => {
      mkdirSync(o.recordDir ?? '', { recursive: true });
      const video = path.join(o.recordDir ?? '', 'rec.webm');
      writeFileSync(video, 'webm');
      return video;
    },
    closed: async () => {},
  };
  return page;
};

test('replay reports the failed step with its fallback and uses the profile of the first step host', async () => {
  const dir = run();
  const d = deps();
  const frame = `${NAV}12345678/frames/001.png`;
  mkdirSync(path.join(dir, path.dirname(frame)), { recursive: true });
  writeFileSync(path.join(dir, frame), 'png');
  const draft = JSON.stringify([step(0, 'Export'), step(1, 'Nope', { frame })]);
  await main(['steps', dir], { deps: d, stdin: async () => new TextEncoder().encode(draft) });
  launches.length = 0;
  const r = await main(['replay', dir], { deps: d, launch: fakeLaunch });
  expect(r.log).toBe('capture/log.json');
  expect(r.ok_steps).toBe(1);
  expect(r.failed).toEqual([{ i: 1, failed: expect.stringContaining('Nope'), fallback: frame }]);
  expect(launches[0]?.profileDir).toBe(profileDirOf(d.config.vmHome, 'https://example.com/app'));
  expect(readdirSync(path.join(dir, 'capture'))).toContain('log.json');
});

test('replay with no steps file is an input error', async () => {
  const err = await main(['replay', run()], { deps: deps(), launch: fakeLaunch }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InputError);
});

test('login opens a headed window with no recording and returns the profile', async () => {
  const d = deps();
  launches.length = 0;
  const r = await main(['login', 'https://example.com/signin'], { deps: d, launch: fakeLaunch });
  expect(r).toEqual({ profile: profileDirOf(d.config.vmHome, 'https://example.com/signin') });
  expect(launches[0]?.headless).toBe(false);
  expect(launches[0]?.recordDir).toBeUndefined();
});

test('login refuses an address that is not http(s)', async () => {
  const err = await main(['login', 'file:///etc/passwd'], { deps: deps(), launch: fakeLaunch }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InputError);
});

test('an unknown command is a usage error', async () => {
  const err = await main(['dance'], { deps: deps() }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as Error).message).toContain('usage');
});
