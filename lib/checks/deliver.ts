import type { CheckResult } from '../contracts/types';
import type { MediaProbe } from '../core/media';

/** One delivered file and what ffprobe found in it; `expect` holds the format's numbers for video files. */
export type DeliverItem = {
  path: string;
  kind: 'mp4' | 'srt' | 'clip' | 'file';
  size: number;
  probe?: MediaProbe;
  expect?: { w: number; h: number; fps: number; duration: number };
};

const FPS_TOLERANCE = 0.01;
const MP4_DURATION_TOLERANCE_S = 0.1;

/** The problems with one delivered file, each as a message without its path; empty when the file is right. */
const problemsOf = (item: DeliverItem): string[] => {
  if (item.size === 0) return ['missing or empty'];
  if (item.kind === 'file') return [];
  const { probe, expect: e } = item;
  if (!probe) return ['ffprobe cannot read it'];
  if (item.kind === 'srt') return probe.subtitle?.codec === 'subrip' ? [] : ['not a subrip file'];

  const v = probe.video;
  if (!v) return ['no video stream'];
  const wantCodec = item.kind === 'mp4' ? 'h264' : 'prores';
  const problems: string[] = [];
  if (v.codec !== wantCodec) problems.push(`codec ${v.codec}, expected ${wantCodec}`);
  if (item.kind === 'clip' && v.profile !== '4444') problems.push(`prores profile ${v.profile}, expected 4444`);
  if (e) {
    if (v.w !== e.w || v.h !== e.h) problems.push(`${v.w}x${v.h}, expected ${e.w}x${e.h}`);
    if (Math.abs(v.fps - e.fps) > FPS_TOLERANCE) problems.push(`fps ${v.fps}, expected ${e.fps}`);
    // A ProRes clip is cut on frame boundaries, so it may run one frame longer than its expected duration.
    const tolerance = item.kind === 'mp4' ? MP4_DURATION_TOLERANCE_S : 1 / e.fps + 0.001;
    if (Math.abs(probe.duration - e.duration) > tolerance) {
      problems.push(`duration ${probe.duration} s, expected ${e.duration} s`);
    }
  }
  if (item.kind === 'mp4') {
    const a = probe.audio;
    if (!a) problems.push('no audio, expected aac 48000 Hz');
    else if (a.codec !== 'aac' || a.sample_rate !== 48000) {
      problems.push(`audio ${a.codec} ${a.sample_rate} Hz, expected aac 48000 Hz`);
    }
  }
  return problems;
};

/**
 * Checks every delivered file for existence, size, container, codec and format numbers; returns a blocking CheckResult
 * with one annotation per problem. Never throws.
 */
export const checkDeliverFiles = (items: DeliverItem[]): CheckResult => {
  const found = items.flatMap((item) => problemsOf(item).map((problem) => ({ path: item.path, problem })));
  return {
    id: 'deliver.files',
    blocking: true,
    status: found.length === 0 ? 'pass' : 'fail',
    detail:
      found.length === 0 ? `${items.length} file(s) checked` : `${found.length} problem(s) in ${items.length} file(s)`,
    annotations: found.map((f) => ({
      problem: `${f.path}: ${f.problem}`,
      suggested_fix: 'export again (deliver export)',
    })),
  };
};
