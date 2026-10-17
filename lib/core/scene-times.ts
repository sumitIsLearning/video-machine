// Places each plan scene on the voiceover timeline: where it starts, how long it runs, and where its beats land.

import type { Plan, Timing } from '../contracts/types';
import { InputError, UnsupportedError } from './errors';
import { lineOf, type TimedLine, wordOf } from './timing';

/** Seconds the last scene holds after its last word (ruling R3). */
export const TAIL_S = 1;

export type SceneTime = {
  scene_id: string;
  start: number;
  duration: number;
  lines: string[];
  beats: { on: string; nth: number; t: number; hold: boolean }[];
  words: { line: string; w: string; start: number; end: number }[];
};

type Scene = Plan['visuals_plan']['scenes'][number];

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

// The span of the nth occurrence in one line, or undefined when that line has no such occurrence.
const findWord = (line: TimedLine, on: string, nth: number): { start: number; end: number } | undefined => {
  try {
    return wordOf(line, on, nth);
  } catch (err) {
    if (err instanceof InputError) return undefined;
    throw err;
  }
};

// A beat's word is counted across the scene's lines in order; nth 0 is its first occurrence in the scene.
const beatSpan = (scene: Scene, lines: TimedLine[], on: string, nth: number): { start: number; end: number } => {
  if (on.startsWith('beat:')) {
    throw new UnsupportedError(`scene ${scene.scene_id}: beat "${on}" needs music beats, which arrive in Phase 7`);
  }
  let seen = 0;
  for (const line of lines) {
    for (let k = 0; ; k++) {
      const span = findWord(line, on, k);
      if (!span) break;
      if (seen === nth) return span;
      seen++;
    }
  }
  const occurrence = nth > 0 ? ` (occurrence ${nth})` : '';
  throw new InputError(`scene ${scene.scene_id}: beat word "${on}"${occurrence} is not in its lines`);
};

// Where a scene starts: scene 0 at 0; pause_before at the midpoint of the gap; on_word at the anchor.
const cutStart = (scene: Scene, index: number, timing: Timing): number => {
  if (scene.cut_in.rule === 'on_beat') {
    throw new UnsupportedError(
      `scene ${scene.scene_id}: cut_in rule on_beat needs music beats, which arrive in Phase 7`,
    );
  }
  if (index === 0) return 0;
  const line = lineOf(timing, scene.lines[0] ?? '');
  if (scene.cut_in.rule === 'on_word') {
    try {
      return wordOf(line, scene.cut_in.anchor).start;
    } catch (cause) {
      throw new InputError(`scene ${scene.scene_id}: cut_in anchor "${scene.cut_in.anchor}" is not in its first line`, {
        cause,
      });
    }
  }
  const at = timing.lines.indexOf(line);
  const prevEnd = timing.lines[at - 1]?.end ?? 0;
  return (prevEnd + line.start) / 2;
};

// The end of the scene's last word; the last scene runs TAIL_S past it.
const lastWordEnd = (scene: Scene, timing: Timing): number => {
  const line = lineOf(timing, scene.lines[scene.lines.length - 1] ?? '');
  return line.words[line.words.length - 1]?.end ?? line.end;
};

/**
 * The start, duration, beats and words of every scene, in seconds on the voiceover timeline, rounded to 3 decimals.
 * Throws InputError when a scene's cut or beat word is not found or a scene does not start after the previous one,
 * and UnsupportedError for on_beat cuts and beat:N beats (no music beats before Phase 7).
 */
export function sceneTimes(plan: Plan, timing: Timing): SceneTime[] {
  const scenes = plan.visuals_plan.scenes;
  const starts: number[] = [];
  scenes.forEach((scene, i) => {
    const start = cutStart(scene, i, timing);
    const prev = starts[i - 1];
    if (prev !== undefined && start <= prev) {
      throw new InputError(`scene ${scene.scene_id}: starts at ${round3(start)}s, not after the previous scene`);
    }
    starts.push(start);
  });
  return scenes.map((scene, i) => {
    const start = starts[i] ?? 0;
    const end = starts[i + 1] ?? lastWordEnd(scene, timing) + TAIL_S;
    const timed = scene.lines.map((id) => ({ id, line: lineOf(timing, id) }));
    const beats = scene.beats.map((b) => {
      const nth = b.nth ?? 0;
      const span = beatSpan(
        scene,
        timed.map((x) => x.line),
        b.on,
        nth,
      );
      if (span.start < start) {
        throw new InputError(`scene ${scene.scene_id}: beat "${b.on}" falls before the scene starts`);
      }
      return { on: b.on, nth, t: round3(span.start - start), hold: b.hold ?? false };
    });
    const words = timed.flatMap(({ id, line }) =>
      line.words.map((w) => ({ line: id, w: w.w, start: round3(w.start - start), end: round3(w.end - start) })),
    );
    return {
      scene_id: scene.scene_id,
      start: round3(start),
      duration: round3(end - start),
      lines: scene.lines,
      beats,
      words,
    };
  });
}

/**
 * The first frame and frame count of every scene at `fps`. Each scene's end is rounded the same way as its start,
 * so consecutive scenes leave no gap or overlap. Returns one entry per scene; never throws.
 */
export function sceneFrames(times: SceneTime[], fps: number): { scene_id: string; f0: number; n: number }[] {
  return times.map((t) => {
    const f0 = Math.round(t.start * fps);
    return { scene_id: t.scene_id, f0, n: Math.round((t.start + t.duration) * fps) - f0 };
  });
}
