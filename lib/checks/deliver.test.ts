import { expect, test } from 'bun:test';
import type { MediaProbe } from '../core/media';
import { checkDeliverFiles, type DeliverItem } from './deliver';

const expect30 = { w: 1080, h: 1920, fps: 30, duration: 9.5 };
const mp4: MediaProbe = {
  duration: 9.52,
  video: { codec: 'h264', w: 1080, h: 1920, fps: 30, pix_fmt: 'yuv420p' },
  audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
};
const clip: MediaProbe = { duration: 1.3, video: { codec: 'prores', profile: '4444', w: 1080, h: 1920, fps: 30 } };
const good: DeliverItem[] = [
  { path: 'out/deliver.tmp/reel/r-reel.mp4', kind: 'mp4', size: 10, probe: mp4, expect: expect30 },
  {
    path: 'out/deliver.tmp/reel/captions.srt',
    kind: 'srt',
    size: 10,
    probe: { duration: 0, subtitle: { codec: 'subrip' } },
  },
  {
    path: 'out/deliver.tmp/reel/ae/scenes/01-hook.mov',
    kind: 'clip',
    size: 10,
    probe: clip,
    expect: { ...expect30, duration: 1.3 },
  },
  { path: 'out/deliver.tmp/reel/ae/build_comp.jsx', kind: 'file', size: 10 },
];

test('checkDeliverFiles passes when every file exists and matches', () => {
  const r = checkDeliverFiles(good);
  expect(r).toMatchObject({ id: 'deliver.files', blocking: true, status: 'pass', detail: '4 file(s) checked' });
});

test('checkDeliverFiles names each problem with its file', () => {
  const bad: DeliverItem[] = [
    { ...good[0], probe: { ...mp4, duration: 9.8, video: { ...mp4.video, w: 720 } } } as DeliverItem,
    { ...good[1], probe: undefined } as DeliverItem,
    { ...good[2], probe: { ...clip, video: { ...clip.video, profile: 'HQ' } } } as DeliverItem,
    { ...good[3], size: 0 } as DeliverItem,
  ];
  const r = checkDeliverFiles(bad);
  expect(r.status).toBe('fail');
  const problems = r.annotations.map((a) => a.problem);
  expect(problems).toContain('out/deliver.tmp/reel/r-reel.mp4: 720x1920, expected 1080x1920');
  expect(problems).toContain('out/deliver.tmp/reel/r-reel.mp4: duration 9.8 s, expected 9.5 s');
  expect(problems).toContain('out/deliver.tmp/reel/captions.srt: ffprobe cannot read it');
  expect(problems).toContain('out/deliver.tmp/reel/ae/scenes/01-hook.mov: prores profile HQ, expected 4444');
  expect(problems).toContain('out/deliver.tmp/reel/ae/build_comp.jsx: missing or empty');
  expect(r.annotations.every((a) => a.scene_id === undefined && a.suggested_fix.length > 0)).toBe(true);
});

test('checkDeliverFiles fails an MP4 with no AAC audio at 48 kHz', () => {
  const r = checkDeliverFiles([{ ...good[0], probe: { ...mp4, audio: undefined } } as DeliverItem]);
  expect(r.annotations.map((a) => a.problem)).toEqual([
    'out/deliver.tmp/reel/r-reel.mp4: no audio, expected aac 48000 Hz',
  ]);
});
