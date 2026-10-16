import type { CheckResult } from '../contracts/types';
import type { SceneTime } from '../core/scene-times';

/** A frame whose change from the previous frame is at most this is still. */
export const MOTION_THRESHOLD = 8;
/** A still span longer than this many seconds fails unless a hold beat excuses it. */
export const DEAD_SPAN_S = 1.5;
/** A beat is on cue when a visual change lands within this many frames of it. */
export const BEAT_TOLERANCE_FRAMES = 2;

type Annotation = CheckResult['annotations'][number];

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

const note = (
  scene_id: string | undefined,
  t: number | undefined,
  problem: string,
  suggested_fix: string,
): Annotation => ({
  ...(scene_id === undefined ? {} : { scene_id }),
  ...(t === undefined ? {} : { t }),
  problem,
  suggested_fix,
});

const skip = (id: string, detail: string): CheckResult => ({
  id,
  blocking: true,
  status: 'skip',
  detail,
  annotations: [],
});

const verdict = (id: string, annotations: Annotation[], passDetail: string): CheckResult => ({
  id,
  blocking: true,
  status: annotations.length === 0 ? 'pass' : 'fail',
  detail: annotations.length === 0 ? passDetail : `${annotations.length} problem(s)`,
  annotations,
});

/** True when the last beat at or before `t` in the scene is a hold beat. */
const isHeld = (scene: SceneTime, t: number): boolean => {
  let last: SceneTime['beats'][number] | undefined;
  for (const beat of scene.beats) {
    if (scene.start + beat.t <= t && (last === undefined || beat.t > last.t)) last = beat;
  }
  return last?.hold === true;
};

/**
 * Checks that no run of still frames outlasts DEAD_SPAN_S unless a hold beat excuses it; returns a blocking CheckResult.
 * `diffs[i]` is the change into frame i. Skips on no frames; never throws.
 */
export const checkDeadSpans = (diffs: number[], fps: number, scenes: SceneTime[]): CheckResult => {
  const id = 'motion.no_dead_spans';
  if (diffs.length === 0) return skip(id, 'no frame differences');
  const limit = DEAD_SPAN_S * fps;
  const annotations: Annotation[] = [];
  let i = 0;
  while (i < diffs.length) {
    if ((diffs[i] ?? 0) > MOTION_THRESHOLD) {
      i++;
      continue;
    }
    const first = i;
    while (i < diffs.length && (diffs[i] ?? 0) <= MOTION_THRESHOLD) i++;
    const frames = i - first;
    if (frames <= limit) continue;
    const t = first / fps;
    const scene = scenes.find((s) => s.start <= t && t < s.start + s.duration);
    if (scene !== undefined && isHeld(scene, t)) continue;
    annotations.push(
      note(
        scene?.scene_id,
        round3(t),
        `still for ${(frames / fps).toFixed(2)} s from ${round3(t)} s`,
        'add motion or mark the beat hold',
      ),
    );
  }
  return verdict(id, annotations, `${diffs.length} frames checked`);
};

/**
 * Checks that every beat has a visual change within BEAT_TOLERANCE_FRAMES of its frame; returns a blocking CheckResult.
 * Skips on no beats; never throws.
 */
export const checkBeatsOnCues = (diffs: number[], fps: number, scenes: SceneTime[]): CheckResult => {
  const id = 'timing.beats_on_cues';
  const beats = scenes.flatMap((scene) =>
    scene.beats.map((beat) => ({ scene_id: scene.scene_id, beat, at: scene.start + beat.t })),
  );
  if (beats.length === 0) return skip(id, 'no beats');
  const annotations: Annotation[] = [];
  for (const { scene_id, beat, at } of beats) {
    const frame = Math.round(at * fps);
    const window = diffs.slice(Math.max(0, frame - BEAT_TOLERANCE_FRAMES), frame + BEAT_TOLERANCE_FRAMES + 1);
    if (window.some((d) => d > MOTION_THRESHOLD)) continue;
    annotations.push(
      note(
        scene_id,
        round3(at),
        `beat "${beat.on}" at ${round3(at)} s has no visual change within ±${BEAT_TOLERANCE_FRAMES} frames`,
        'start a visible change on the beat word',
      ),
    );
  }
  return verdict(id, annotations, `${beats.length} beats checked`);
};
