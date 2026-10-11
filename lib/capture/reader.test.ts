import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NavFramesSchema } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { readJson } from '../core/json';
import { readNavVideo } from './reader';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};
/** The folder a source is read into: readable slug plus a hash of its run path. */
const navDir = (slug: string, source: string) =>
  `capture/nav/${slug}-${createHash('sha1').update(source).digest('hex').slice(0, 8)}`;
const NAV = navDir('nav', 'input/nav.webm');

type Score = [t: number | string, score: number];
// Three page navigations (0.06-0.09) among filler frames, as probed on a real recording.
const PAGE_NAVS: Score[] = [
  [0, 0],
  [0.04, 0.01],
  [2.4, 0.0896],
  [3.52, 0.0602],
  [4.56, 0.0885],
];
const scoreLines = (scores: Score[]) =>
  scores.flatMap(([t, s]) => [
    `[Parsed_metadata_1 @ 0000] frame:0    pts:0       pts_time:${t}`,
    `[Parsed_metadata_1 @ 0000] lavfi.scene_score=${s}`,
  ]);

type Options = {
  audio?: boolean;
  duration?: string;
  scores?: Score[];
  skipFrameAt?: string;
  skipSheets?: boolean;
  files?: string[];
};

/** A run with input files, and a fake ffprobe/ffmpeg/HyperFrames that write what the real ones write. */
const world = (o: Options = {}) => {
  const run = temp();
  mkdirSync(path.join(run, 'input'));
  for (const f of ['concept.md', ...(o.files ?? ['input/nav.webm', 'input/nav.mp4'])])
    writeFileSync(path.join(run, f), 'x');
  const calls: string[] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd, opts) => {
      const line = cmd.join(' ');
      calls.push(line);
      const cwd = opts?.cwd ?? '';
      const ok = (stdout = '', stderr = '') => ({ code: 0, stdout, stderr });
      if (cmd[0] === 'ffprobe')
        return line.includes('format=duration') ? ok(o.duration ?? '9.16\n') : ok(o.audio ? '1\n' : '');
      if (line.includes('metadata=print')) return ok('', scoreLines(o.scores ?? PAGE_NAVS).join('\n'));
      if (line.includes('-frames:v 1') && cmd[cmd.indexOf('-ss') + 1] !== o.skipFrameAt)
        writeFileSync(path.join(cwd, cmd.at(-1) ?? ''), 'png');
      if (line.includes('tile=4x3') && !o.skipSheets)
        for (let k = 1; k <= Math.ceil(readdirSync(path.join(cwd, 'frames')).length / 12); k++)
          writeFileSync(path.join(cwd, `sheet-${String(k).padStart(2, '0')}.jpg`), 'jpg');
      if (line.includes('transcribe'))
        writeFileSync(path.join(cmd[cmd.indexOf('-d') + 1] ?? '', 'transcript.json'), '{}');
      return ok();
    },
  };
  return { run, deps, calls };
};

test('frames are taken at scene changes above 0.05 and every 2 s, merged within 0.5 s, in time order', async () => {
  // candidates (sorted): 0, 2, 2.40, 3.52, 4, 4.56, 6, 8 (every 2 s below 9.16, plus the three scene times)
  // keep a candidate only if it is >= 0.5 s after the last kept one: 2.40 (0.40 after 2) and 4 (0.48 after 3.52) drop
  const w = world();
  const nav = await readNavVideo(w.deps, w.run, 'input/nav.webm');
  expect(nav.frames.map((f) => f.t)).toEqual([0, 2, 3.52, 4.56, 6, 8]);
  expect(nav.frames.map((f) => f.path)).toEqual(
    [0, 1, 2, 3, 4, 5].map((i) => `${NAV}/frames/${String(i).padStart(3, '0')}.png`),
  );
  expect(nav.sheets).toEqual([`${NAV}/sheet-01.jpg`]);
  expect(readJson(path.join(w.run, NAV, 'frames.json'), NavFramesSchema)).toEqual(nav);
  expect(w.calls.some((c) => c.includes('-ss 3.52 -i'))).toBe(true);
  expect(w.calls.some((c) => c.includes('-ss 0 -i'))).toBe(true);
});

test('scene scores at or below 0.05 are not scene changes', async () => {
  // each would survive the merge: 1.0 (score exactly 0.05, pins `>`), 5.5 (0.01) and 7.1 (0.049)
  const w = world({
    scores: [...PAGE_NAVS, [1, 0.05], [5.5, 0.01], [7.1, 0.049]],
  });
  const nav = await readNavVideo(w.deps, w.run, 'input/nav.webm');
  expect(nav.frames.map((f) => f.t)).toEqual([0, 2, 3.52, 4.56, 6, 8]);
});

test('a negative first timestamp is clamped to 0', async () => {
  const w = world({ scores: [['-0.04', 0.09], ...PAGE_NAVS.slice(1)] });
  const nav = await readNavVideo(w.deps, w.run, 'input/nav.webm');
  expect(nav.frames.map((f) => f.t)).toEqual([0, 2, 3.52, 4.56, 6, 8]);
});

test('a streamed video with no container duration takes its length from the last scan timestamp', async () => {
  const w = world({ duration: 'N/A\n' });
  const nav = await readNavVideo(w.deps, w.run, 'input/nav.webm');
  expect(nav.frames.map((f) => f.t)).toEqual([0, 2, 3.52, 4.56]);
});

test('a video with no duration anywhere is an input error', async () => {
  const w = world({ duration: 'N/A\n', scores: [] });
  await expect(readNavVideo(w.deps, w.run, 'input/nav.webm')).rejects.toThrow(InputError);
});

test('a long video gets a second contact sheet, and lists it', async () => {
  const w = world({ duration: '40\n', scores: [] });
  const nav = await readNavVideo(w.deps, w.run, 'input/nav.webm');
  expect(nav.frames.length).toBeGreaterThan(12);
  expect(nav.sheets).toEqual([`${NAV}/sheet-01.jpg`, `${NAV}/sheet-02.jpg`]);
  expect(existsSync(path.join(w.run, NAV, 'sheet-02.jpg'))).toBe(true);
});

test('a frame that ffmpeg did not write is a tool error naming its time', async () => {
  const w = world({ skipFrameAt: '3.52' });
  const err = await readNavVideo(w.deps, w.run, 'input/nav.webm').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ToolError);
  expect((err as ToolError).message).toContain('3.52');
});

test('a contact sheet that ffmpeg did not write is a tool error naming it', async () => {
  const w = world({ skipSheets: true });
  const err = await readNavVideo(w.deps, w.run, 'input/nav.webm').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ToolError);
  expect((err as ToolError).message).toContain('sheet-01.jpg');
});

test('frame and sheet patterns are relative to the nav folder, so a "%" in the run path cannot break them', async () => {
  const w = world();
  await readNavVideo(w.deps, w.run, 'input/nav.webm');
  const tile = w.calls.find((c) => c.includes('tile=4x3')) ?? '';
  expect(tile).toContain(' frames/%03d.png ');
  expect(tile.endsWith(' sheet-%02d.jpg')).toBe(true);
});

test('a silent video skips transcription and says so', async () => {
  const silent = world();
  const nav = await readNavVideo(silent.deps, silent.run, 'input/nav.webm');
  expect(nav.has_audio).toBe(false);
  expect(nav.transcript).toBeUndefined();
  expect(silent.calls.some((c) => c.includes('transcribe'))).toBe(false);
});

test('a video with audio is transcribed into the nav folder', async () => {
  const talky = world({ audio: true });
  const nav = await readNavVideo(talky.deps, talky.run, 'input/nav.mp4');
  expect(nav.has_audio).toBe(true);
  expect(nav.transcript).toBe(`${navDir('nav', 'input/nav.mp4')}/transcript.json`);
});

test('the source must be a file inside the run folder', async () => {
  const w = world();
  await expect(readNavVideo(w.deps, w.run, 'input/missing.mp4')).rejects.toThrow(InputError);
  await expect(readNavVideo(w.deps, w.run, '../outside.mp4')).rejects.toThrow(InputError);
});

test('a source behind a junction out of the run folder is refused', async () => {
  const w = world();
  const outside = temp();
  writeFileSync(path.join(outside, 'nav.webm'), 'x');
  symlinkSync(outside, path.join(w.run, 'input', 'junc'), 'junction');
  await expect(readNavVideo(w.deps, w.run, 'input/junc/nav.webm')).rejects.toThrow(/outside the run folder/);
});

test('a nav folder that is a junction out of the run folder is refused, and nothing outside is deleted', async () => {
  const w = world();
  const outside = temp();
  writeFileSync(path.join(outside, 'keep.txt'), 'k');
  mkdirSync(path.join(w.run, 'capture'));
  symlinkSync(outside, path.join(w.run, 'capture', 'nav'), 'junction');
  await expect(readNavVideo(w.deps, w.run, 'input/nav.webm')).rejects.toThrow(/outside the run folder/);
  expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
});

test('reading the same video again replaces its frames', async () => {
  const w = world();
  await readNavVideo(w.deps, w.run, 'input/nav.webm');
  writeFileSync(path.join(w.run, NAV, 'frames/099.png'), 'stale');
  await readNavVideo(w.deps, w.run, 'input/nav.webm');
  expect(existsSync(path.join(w.run, NAV, 'frames/099.png'))).toBe(false);
});

test('two videos with the same name or the same first five words each keep their own folder', async () => {
  const a = 'input/one two three four five six.mp4';
  const b = 'input/one two three four five seven.mp4';
  const w = world({ files: ['input/nav.webm', 'input/nav.mp4', a, b] });
  const navs = [];
  for (const s of ['input/nav.webm', 'input/nav.mp4', a, b]) navs.push(await readNavVideo(w.deps, w.run, s));
  expect(new Set(navs.map((n) => path.posix.dirname(n.frames[0]?.path ?? ''))).size).toBe(4);
  for (const n of navs) expect(existsSync(path.join(w.run, ...(n.frames[0]?.path ?? '').split('/')))).toBe(true);
});
