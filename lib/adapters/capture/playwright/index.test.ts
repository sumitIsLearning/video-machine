import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CaptureLogSchema, type Steps } from '../../../contracts/types';
import { loadConfig } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { CaptureError, ToolError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import type { Box, Launch, ReplayPage } from './browser';
import { moveFile, playwrightCapture, profileDirOf } from './index';

const FRAME = 'capture/nav/nav/frames/003.png';
const DOCS = 'https://docs.astral.sh/uv/';
const STEPS: Steps = [
  { i: 0, url: DOCS, action: 'wait', target: '', expect: 'the docs open' },
  { i: 1, url: DOCS, action: 'click', target: 'Installation', expect: 'install page' },
  { i: 2, url: DOCS, action: 'click', target: 'No such link', expect: 'x', frame: FRAME },
];
const LATER: Steps[number] = { i: 3, url: DOCS, action: 'click', target: 'Installation', expect: 'x' };
const BOX: Box = { x: 10, y: 20, w: 100, h: 40 };

let run: string;
let profile: string;
let shCalls: string[][];
let pageCalls: unknown[][];
let urlNow: string;
let warnings: string[];
let closes: number;
// per-test behaviour of the fake page
let boxOf: (target: string) => Box | null;
let passwordTargets: Set<string>;
let onClick: (target: string) => void;
let redirect: (url: string) => string;
let closeFails: boolean;
let missingRecording: boolean;

beforeEach(() => {
  run = mkdtempSync(path.join(tmpdir(), 'vm-'));
  profile = path.join(run, 'profile');
  mkdirSync(path.join(run, 'capture/nav/nav/frames'), { recursive: true });
  writeFileSync(path.join(run, FRAME), 'png');
  shCalls = [];
  pageCalls = [];
  urlNow = 'about:blank';
  warnings = [];
  closes = 0;
  boxOf = (target) => (target === '' ? null : BOX);
  passwordTargets = new Set();
  onClick = () => {};
  redirect = (url) => url;
  closeFails = false;
  missingRecording = false;
});
afterEach(() => rmSync(run, { recursive: true, force: true }));

const deps = (failOn?: (cmd: string[]) => boolean): Deps => ({
  config: loadConfig({ PATH: '/bin' }),
  sh: async (cmd) => {
    shCalls.push(cmd);
    if (failOn?.(cmd)) throw new ToolError({ cmd, code: 1, stderr: 'ffmpeg exploded\nsecond line' });
    writeFileSync(cmd[cmd.length - 1] as string, 'out'); // ffmpeg's last argument is the -y output
    return { code: 0, stdout: '', stderr: '' };
  },
});

/** A page that records its calls, fails `click` on 'No such link', and writes the files the real one would. */
const fakeLaunch: Launch = async ({ recordDir }) => {
  const record = (...c: unknown[]) => void pageCalls.push(c);
  const page: ReplayPage = {
    goto: async (url) => {
      record('goto', url);
      urlNow = redirect(url);
    },
    click: async (target) => {
      record('click', target);
      if (target === 'No such link') throw new Error('click: Timeout 5000ms exceeded.\nCall log: waiting for locator');
      onClick(target);
    },
    type: async (target, value) => void record('type', target, value),
    scroll: async () => void record('scroll'),
    wait: async (ms) => void record('wait', ms),
    box: async (target, input) => {
      record('box', target, input);
      return boxOf(target);
    },
    isPassword: async (target) => passwordTargets.has(target),
    screenshot: async (file) => {
      record('screenshot', path.basename(file));
      writeFileSync(file, 'png');
    },
    text: async () => 'page text',
    url: () => urlNow,
    close: async () => {
      closes++;
      if (closeFails) throw new Error('close exploded');
      mkdirSync(recordDir ?? '', { recursive: true });
      const video = path.join(recordDir ?? '', 'rec.webm');
      if (!missingRecording) writeFileSync(video, 'webm');
      return video;
    },
    closed: async () => {},
  };
  return page;
};

const counting = () => {
  let t = 0;
  return () => t++;
};
const capture = (launch: Launch = fakeLaunch, clock: () => number = counting(), d: Deps = deps()) =>
  playwrightCapture(d, { launch, clock, onWarn: (l) => void warnings.push(l) });
const replayLog = async (steps: Steps, clock?: () => number) =>
  readJson(await capture(fakeLaunch, clock).replay(run, steps, profile), CaptureLogSchema);
const mp4Calls = () => shCalls.filter((c) => c.some((a) => a.endsWith('.mp4')));
const cropCalls = () => shCalls.filter((c) => c.some((a) => a.startsWith('crop=')));
const cropArg = (c: string[] | undefined) => c?.find((a) => a.startsWith('crop='));
const shown = (f: string) => existsSync(path.join(run, 'capture', f));

test('replay runs every step, logs times on the recording, and cuts one padded clip per step', async () => {
  const log = await replayLog(STEPS);
  expect(log.map((e) => e.i)).toEqual([0, 1, 2]);
  expect(log[0]).toMatchObject({ url: DOCS });
  expect(log.every((e) => e.t1 >= e.t0)).toBe(true);
  expect(mp4Calls()).toHaveLength(2); // failed step 2 has no clip
  expect(mp4Calls()[0]).toEqual(expect.arrayContaining(['-r', '30', '-g', '1', '-c:v', 'libx264']));
  expect(shown('replay.webm')).toBe(true);
});

test('a clip that would start before 0 is clamped to 0 and ends 0.3 s after the step', async () => {
  const readings = [10, 10, 10.5, 11, 11.5, 12, 12.5]; // the first step starts exactly at the first reading
  let n = 0;
  await replayLog(STEPS.slice(0, 1), () => readings[Math.min(n++, readings.length - 1)] as number);
  const [first] = mp4Calls();
  const at = (flag: string) => Number(first?.[(first?.indexOf(flag) ?? 0) + 1]);
  expect(at('-ss')).toBe(0);
  expect(at('-to')).toBeCloseTo(0.8);
});

test('a failed step is logged with its reason and the nav frame as fallback; later steps still run', async () => {
  const log = await replayLog([...STEPS, LATER]);
  const bad = log.find((e) => e.i === 2);
  expect(bad?.failed).toBe('click: Timeout 5000ms exceeded.');
  expect(bad?.fallback).toBe(FRAME);
  expect(log.find((e) => e.i === 3)?.failed).toBeUndefined();
  expect(warnings).toContain('[M3] step 2 click "No such link": click: Timeout 5000ms exceeded., using nav frame');
  expect(shown('shots/2.png')).toBe(false);
});

test('a target nothing matches fails the step with a timeout instead of clicking', async () => {
  boxOf = () => null;
  const log = await replayLog(STEPS.slice(1, 2));
  expect(log[0]?.failed).toContain('Timeout');
  expect(pageCalls.some((c) => c[0] === 'click')).toBe(false);
});

test('shots and page text are written per step; the focus crop is cut from the shot taken before the action', async () => {
  const log = await replayLog(STEPS);
  expect(shown('shots/1.png')).toBe(true);
  expect(readFileSync(path.join(run, 'capture/text/1.txt'), 'utf8')).toBe('page text');
  expect(shown('shots/1-before.png')).toBe(true);
  const [crop] = cropCalls();
  expect(cropArg(crop)).toBe('crop=134:84:0:0'); // 100x40 at 10,20 plus 24 px, clamped to the frame
  expect(crop).toContain(path.join(run, 'capture/shots/1-before.png'));
  expect(shown('crops/1.png')).toBe(true);
  expect(shown('crops/0.png')).toBe(false); // no box on the wait step
  expect(log[1]?.box).toEqual(BOX);
});

test('a click that navigates still gets its crop from the before-shot, and logs the pre-action box', async () => {
  onClick = () => {
    urlNow = 'https://docs.astral.sh/uv/other/';
  };
  const log = await replayLog(STEPS.slice(1, 2));
  expect(shown('crops/1.png')).toBe(true);
  expect(log[0]?.box).toEqual(BOX);
});

test('a box off the frame gets no crop and does not abort the replay', async () => {
  boxOf = () => ({ x: 2000, y: 20, w: 100, h: 40 });
  const log = await replayLog([STEPS[1] as Steps[number], { ...LATER, i: 2 }]);
  expect(cropCalls()).toHaveLength(0);
  expect(log.map((e) => e.failed)).toEqual([undefined, undefined]);
  expect(log[0]?.box).toBeUndefined();
});

test('a box with no area gets no crop', async () => {
  boxOf = () => ({ x: 10, y: 10, w: 0, h: 40 });
  await replayLog(STEPS.slice(1, 2));
  expect(cropCalls()).toHaveLength(0);
});

test('a box near the bottom-right corner is clamped to the frame', async () => {
  boxOf = () => ({ x: 1200, y: 760, w: 100, h: 100 });
  await replayLog(STEPS.slice(1, 2));
  expect(cropArg(cropCalls()[0])).toBe('crop=104:64:1176:736');
});

test('a crop that ffmpeg cannot cut warns, later steps still run, and log.json is written', async () => {
  const failing = deps((cmd) => cmd.some((a) => a.startsWith('crop=')));
  const file = await capture(fakeLaunch, counting(), failing).replay(run, [STEPS[1] as Steps[number], LATER], profile);
  const log = readJson(file, CaptureLogSchema);
  expect(log.map((e) => e.failed)).toEqual([undefined, undefined]);
  expect(warnings.some((w) => w.includes('step 1') && w.includes('no focus crop'))).toBe(true);
  expect(shown('crops/1.png')).toBe(false);
  expect(shown('shots/3.png')).toBe(true);
});

test('type steps type their value into the field', async () => {
  const typing: Steps = [
    { i: 0, url: 'https://x.example/', action: 'type', target: 'Search', value: 'uv', expect: 'r' },
  ];
  const log = await replayLog(typing);
  expect(pageCalls).toContainEqual(['type', 'Search', 'uv']);
  expect(pageCalls).toContainEqual(['box', 'Search', true]);
  expect(log[0]?.failed).toBeUndefined();
  expect(readFileSync(path.join(run, 'capture/log.json'), 'utf8')).not.toContain('"uv"');
});

const typed = (target: string): Steps[number] => ({
  i: 1,
  url: DOCS,
  action: 'type',
  target,
  value: 'hunter2',
  expect: 'x',
});
const PASSWORD_REFUSAL = 'passwords are typed by hand: run capture login';
const expectNoValue = () => {
  const everything = [
    readFileSync(path.join(run, 'capture/log.json'), 'utf8'),
    JSON.stringify(warnings),
    JSON.stringify(shCalls),
    JSON.stringify(pageCalls),
  ].join('\n');
  expect(everything).not.toContain('hunter2');
};

test('a step aimed at a password field by name is refused, the value is nowhere, later steps run', async () => {
  const log = await replayLog([STEPS[0] as Steps[number], typed('Password'), { ...LATER, i: 2 }]);
  expect(log[1]?.failed).toBe(PASSWORD_REFUSAL);
  expect(pageCalls.some((c) => c[0] === 'type')).toBe(false);
  expect(log[2]?.failed).toBeUndefined();
  expectNoValue();
});

test('a step whose element has type=password is refused even when its name looks harmless', async () => {
  passwordTargets.add('Your login');
  const log = await replayLog([STEPS[0] as Steps[number], typed('Your login'), { ...LATER, i: 2 }]);
  expect(log[1]?.failed).toBe(PASSWORD_REFUSAL);
  expect(pageCalls.some((c) => c[0] === 'type')).toBe(false);
  expect(log[2]?.failed).toBeUndefined();
  expectNoValue();
});

const withUrl = (url: string, i = 1): Steps[number] => ({ ...LATER, i, url });

test('a link-local metadata URL is refused and never opened', async () => {
  const log = await replayLog([
    STEPS[0] as Steps[number],
    withUrl('http://169.254.169.254/latest/meta-data'),
    withUrl(DOCS, 2),
  ]);
  expect(log[1]?.failed).toContain('refused 169.254.169.254');
  expect(pageCalls.some((c) => c[0] === 'goto' && String(c[1]).includes('169.254'))).toBe(false);
  expect(log[2]?.failed).toBeUndefined();
});

test('a private host other than the product host is refused', async () => {
  const log = await replayLog([STEPS[0] as Steps[number], withUrl('http://192.168.1.5/admin')]);
  expect(log[1]?.failed).toBe('refused 192.168.1.5: not the product host');
});

test('a localhost product host is allowed, and another localhost port is not', async () => {
  const product = 'http://localhost:3000/app';
  const log = await replayLog([
    { ...STEPS[0], url: product } as Steps[number],
    withUrl('http://localhost:3000/other'),
    withUrl('http://localhost:5173/'),
  ]);
  expect(log.map((e) => e.failed)).toEqual([undefined, undefined, 'refused localhost:5173: not the product host']);
});

test('a redirect to a refused host fails the step before its screenshot and text are taken', async () => {
  redirect = (url) => (url.endsWith('/go') ? 'http://169.254.169.254/' : url);
  const log = await replayLog([STEPS[0] as Steps[number], withUrl('https://docs.astral.sh/go')]);
  expect(log[1]?.failed).toContain('refused 169.254.169.254');
  expect(shown('shots/1.png')).toBe(false);
  expect(shown('text/1.txt')).toBe(false);
});

test('a click that lands on a refused host fails the step before its screenshot', async () => {
  onClick = () => {
    urlNow = 'http://10.0.0.7/internal';
  };
  const log = await replayLog(STEPS.slice(0, 2));
  expect(log[1]?.failed).toBe('refused 10.0.0.7: not the product host');
  expect(shown('shots/1.png')).toBe(false);
});

test('the step url is opened only when the page is not already there', async () => {
  await replayLog(STEPS);
  expect(pageCalls.filter((c) => c[0] === 'goto')).toEqual([['goto', DOCS]]);
});

test('output of an earlier replay is removed first', async () => {
  mkdirSync(path.join(run, 'capture/clips'), { recursive: true });
  writeFileSync(path.join(run, 'capture/clips/9.mp4'), 'old');
  await replayLog(STEPS);
  expect(shown('clips/9.mp4')).toBe(false);
});

test('log.json is written even when a clip cannot be cut; the failure is a warning', async () => {
  const failing = deps((cmd) => cmd.some((a) => a.endsWith('.mp4')));
  const file = await capture(fakeLaunch, counting(), failing).replay(run, STEPS, profile);
  expect(readJson(file, CaptureLogSchema)).toHaveLength(3);
  expect(warnings.some((w) => w.includes('no clip') && w.includes('step 0'))).toBe(true);
  expect(warnings.some((w) => w.includes('step 1'))).toBe(true);
});

test('when the loop throws, the browser is still closed and the recording is moved', async () => {
  let n = 0;
  const exploding = () => {
    if (++n > 3) throw new Error('clock exploded');
    return n;
  };
  const err = await capture(fakeLaunch, exploding)
    .replay(run, STEPS, profile)
    .catch((e: unknown) => e);
  expect((err as Error).message).toBe('clock exploded');
  expect(closes).toBe(1);
  expect(shown('replay.webm')).toBe(true);
});

test('a close that throws does not hide the loop error', async () => {
  closeFails = true;
  let n = 0;
  const exploding = () => {
    if (++n > 3) throw new Error('clock exploded');
    return n;
  };
  const err = await capture(fakeLaunch, exploding)
    .replay(run, STEPS, profile)
    .catch((e: unknown) => e);
  expect((err as Error).message).toBe('clock exploded');
  expect(warnings.some((w) => w.includes('close exploded'))).toBe(true);
});

test('profile folders are per host and port, with nothing a path cannot hold', () => {
  const home = path.join('vm');
  expect(profileDirOf(home, 'https://app.example.com/login')).toBe(path.join(home, 'profiles', 'app.example.com'));
  expect(profileDirOf(home, 'http://localhost:3000/')).toBe(path.join(home, 'profiles', 'localhost_3000'));
  expect(profileDirOf(home, 'http://localhost:5173/')).not.toBe(profileDirOf(home, 'http://localhost:3000/'));
  expect(path.basename(profileDirOf(home, 'http://[::1]:8080/'))).not.toContain(':');
  expect(path.basename(profileDirOf(home, 'http://[::1]/'))).not.toMatch(/[:[\]]/);
});

test('a launch failure surfaces as CaptureError naming the profile and the setup step', async () => {
  const failing = capture(async () => {
    throw new Error('Executable does not exist');
  });
  const err = await failing.replay(run, STEPS, profile).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CaptureError);
  expect((err as Error).message).toContain(profile);
  expect((err as Error).message).toContain('Executable does not exist');
  expect((err as Error).message).toContain('run setup');
});

test('a profile that is in use is reported as such, not as a setup problem', async () => {
  const busy = capture(async () => {
    throw new Error('launchPersistentContext: Target page, context or browser has been closed');
  });
  const err = await busy.replay(run, STEPS, profile).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CaptureError);
  expect((err as Error).message).toBe(
    `the browser profile ${profile} is in use: close the capture login window or the other replay`,
  );
});

const busy = (code: string) => Object.assign(new Error(code), { code });
const fileIn = (name: string, text: string) => {
  const f = path.join(run, name);
  writeFileSync(f, text);
  return f;
};

test('moveFile retries a rename that Windows refuses while the browser still holds the file', async () => {
  const from = fileIn('a.webm', 'video');
  const to = path.join(run, 'b.webm');
  let attempts = 0;
  let sleeps = 0;
  const rename = (a: string, b: string) => {
    if (++attempts < 3) throw busy('EBUSY');
    writeFileSync(b, readFileSync(a));
    rmSync(a);
  };
  await moveFile(from, to, { rename, sleep: async () => void sleeps++ });
  expect([attempts, sleeps]).toEqual([3, 2]);
  expect(readFileSync(to, 'utf8')).toBe('video');
});

test('moveFile copies and removes the source when the rename keeps failing', async () => {
  const from = fileIn('a.webm', 'video');
  const to = path.join(run, 'b.webm');
  const rename = () => {
    throw busy('EBUSY');
  };
  await moveFile(from, to, { rename, sleep: async () => {} });
  expect(readFileSync(to, 'utf8')).toBe('video');
  expect(existsSync(from)).toBe(false);
});

test('moveFile resolves when the copy worked but the locked source cannot be removed', async () => {
  const from = fileIn('a.webm', 'video');
  const to = path.join(run, 'b.webm');
  const rename = () => {
    throw busy('EBUSY');
  };
  const remove = () => {
    throw busy('EBUSY');
  };
  await moveFile(from, to, { rename, sleep: async () => {}, remove });
  expect(readFileSync(to, 'utf8')).toBe('video');
});

test('log.json survives a recording that cannot be moved; the failure is a warning', async () => {
  missingRecording = true;
  const file = await capture().replay(run, STEPS, profile);
  expect(readJson(file, CaptureLogSchema)).toHaveLength(3);
  expect(shown('replay.webm')).toBe(false);
  expect(warnings.some((w) => w.includes('[M3]') && w.includes('replay.webm'))).toBe(true);
});

test('a page that moves to a refused host while the target is measured gets no before-shot and no crop', async () => {
  boxOf = () => {
    urlNow = 'http://169.254.169.254/';
    return BOX;
  };
  const log = await replayLog(STEPS.slice(1, 2));
  expect(log[0]?.failed).toContain('refused 169.254.169.254');
  expect(shown('shots/1-before.png')).toBe(false);
  expect(shown('crops/1.png')).toBe(false);
  expect(cropCalls()).toHaveLength(0);
});

test('moveFile does not hide an error that is not about a busy file', async () => {
  const rename = () => {
    throw busy('ENOENT');
  };
  await expect(
    moveFile(path.join(run, 'nope'), path.join(run, 'b'), { rename, sleep: async () => {} }),
  ).rejects.toThrow('ENOENT');
});
