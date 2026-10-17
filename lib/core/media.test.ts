import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { loadConfig } from './config';
import type { Deps } from './deps';
import { ToolError } from './errors';
import { loudnessOf, probeMedia } from './media';

const fakeDeps = (r: { code?: number; stdout?: string; stderr?: string }) => {
  const calls: string[][] = [];
  const deps: Deps = {
    config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
    sh: async (cmd, opts) => {
      calls.push(cmd);
      const code = r.code ?? 0;
      if (code !== 0 && !opts?.allowFail) throw new ToolError({ cmd, code, stderr: r.stderr ?? '' });
      return { code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
  return { deps, calls };
};

const EBUR = `[Parsed_ebur128_0 @ 0x1] t: 10.9 TARGET:-23 LUFS M: -14.0 S: -13.9 I: -20.0 LUFS LRA: 2.6 LU TPK: -9.8 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -13.9 LUFS
    Threshold: -25.4 LUFS

  Loudness range:
    LRA:         2.6 LU
    Threshold: -35.2 LUFS

  True peak:
    Peak:       -9.7 dBFS
`;

test('loudnessOf reads integrated loudness and true peak from the ebur128 summary', async () => {
  const { deps, calls } = fakeDeps({ stderr: EBUR });
  expect(await loudnessOf(deps, '/r/a.mp4')).toEqual({ i: -13.9, tp: -9.7 });
  expect(calls[0]).toEqual([
    'ffmpeg',
    '-hide_banner',
    '-nostats',
    '-i',
    '/r/a.mp4',
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
});

test('loudnessOf gives -Infinity for the true peak of silence', async () => {
  const { deps } = fakeDeps({ stderr: EBUR.replace('-13.9 LUFS', '-70.0 LUFS').replace('-9.7 dBFS', '-inf dBFS') });
  expect(await loudnessOf(deps, '/r/a.wav')).toEqual({ i: -70, tp: -Infinity });
});

test('loudnessOf throws ToolError when there is no summary', async () => {
  const { deps } = fakeDeps({ stderr: 'nothing' });
  await expect(loudnessOf(deps, '/r/a.wav')).rejects.toThrow(ToolError);
});

test('probeMedia maps the video, audio and subtitle streams and the duration', async () => {
  const stdout = JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        profile: 'High',
        width: 1080,
        height: 1920,
        pix_fmt: 'yuv420p',
        r_frame_rate: '30000/1001',
      },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, r_frame_rate: '0/0' },
      { codec_type: 'subtitle', codec_name: 'subrip' },
    ],
    format: { duration: '11.000000' },
  });
  const { deps, calls } = fakeDeps({ stdout });
  const p = await probeMedia(deps, '/r/a.mp4');
  expect(p?.duration).toBe(11);
  expect(p?.video).toEqual({ codec: 'h264', profile: 'High', w: 1080, h: 1920, fps: 30000 / 1001, pix_fmt: 'yuv420p' });
  expect(p?.audio).toEqual({ codec: 'aac', sample_rate: 48000, channels: 2 });
  expect(p?.subtitle).toEqual({ codec: 'subrip' });
  expect(calls[0]?.slice(0, 3)).toEqual(['ffprobe', '-v', 'error']);
  expect(calls[0]?.at(-1)).toBe('/r/a.mp4');
});

test('probeMedia gives duration 0 when ffprobe reports none, and undefined when it cannot read the file', async () => {
  const none = fakeDeps({
    stdout: JSON.stringify({ streams: [{ codec_type: 'subtitle', codec_name: 'subrip' }], format: {} }),
  });
  expect((await probeMedia(none.deps, '/r/c.srt'))?.duration).toBe(0);
  const bad = fakeDeps({ code: 1, stderr: 'No such file' });
  expect(await probeMedia(bad.deps, '/r/missing.mp4')).toBeUndefined();
});
