// Turns the script's avatar lines into timed segments (R1) and each segment into a screen box (R5).

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  type AvatarPlacement,
  AvatarPlacementSchema,
  type AvatarPreset,
  type AvatarSegments,
  AvatarSegmentsSchema,
  BriefSchema,
  FORMATS,
  type FormatId,
  type Plan,
  type Script,
  type Timing,
} from '../contracts/types';
import { InputError } from './errors';
import { readJson } from './json';
import { sceneTimes } from './scene-times';
import { lineOf } from './timing';

export type AvatarSpan = { seg: string; line_ids: string[]; start: number; end: number };
export type PresetBox = { x: number; y: number; w: number; h: number; fit: string; cover: boolean };
export type AvatarBox = { seg: string; start: number; end: number } & PresetBox;

const round3 = (t: number): number => Math.round(t * 1000) / 1000;

/**
 * The avatar segments of a script: each maximal run of consecutive `avatar` lines, named a01, a02, ...
 * Timed from the first and last line in timing.json. Throws InputError when timing.json lacks a line.
 */
export const avatarSegments = (script: Script, timing: Timing): AvatarSpan[] => {
  const runs: string[][] = [];
  let previousWasAvatar = false;
  for (const l of script.lines) {
    if (l.delivery !== 'avatar') {
      previousWasAvatar = false;
      continue;
    }
    if (previousWasAvatar) runs[runs.length - 1]?.push(l.id);
    else runs.push([l.id]);
    previousWasAvatar = true;
  }
  return runs.map((ids, k) => {
    const first = lineOf(timing, ids[0] ?? '');
    const last = lineOf(timing, ids[ids.length - 1] ?? '');
    return {
      seg: `a${String(k + 1).padStart(2, '0')}`,
      line_ids: ids,
      start: round3(first.start),
      end: round3(last.end),
    };
  });
};

/**
 * The avatar spans of a stack run: each maximal run of consecutive avatar scenes, named a01, a02, ...
 * Windows come from the scene times (sceneTimes). Throws InputError when a scene mixes avatar and voiceover lines.
 */
export const stackSpans = (plan: Plan, script: Script, timing: Timing): AvatarSpan[] => {
  const delivery = new Map(script.lines.map((l) => [l.id, l.delivery]));
  const spans: AvatarSpan[] = [];
  let previousWasAvatar = false;
  for (const scene of sceneTimes(plan, timing)) {
    const kinds = new Set(scene.lines.map((id) => delivery.get(id)));
    if (kinds.has('avatar') && kinds.has('voiceover')) {
      throw new InputError(`scene ${scene.scene_id} mixes avatar and voiceover lines`);
    }
    if (!kinds.has('avatar')) {
      previousWasAvatar = false;
      continue;
    }
    const end = round3(scene.start + scene.duration);
    const span = spans[spans.length - 1];
    if (previousWasAvatar && span) {
      span.line_ids.push(...scene.lines);
      span.end = end;
    } else {
      spans.push({ seg: '', line_ids: [...scene.lines], start: round3(scene.start), end });
    }
    previousWasAvatar = true;
  }
  return spans.map((s, k) => ({ ...s, seg: `a${String(k + 1).padStart(2, '0')}` }));
};

/**
 * The box of a screen preset in a format, from its safe area (R5). Edges are rounded before the sizes are
 * taken, so the box sits on whole pixels. `split` is where the stack preset starts, as a share of the height.
 * Throws only on an unknown format (a TypeError from FORMATS).
 */
export const presetBox = (preset: AvatarPreset, format: FormatId, split = 0.55): PresetBox => {
  const { w, h, safe } = FORMATS[format];
  const sx0 = Math.round(w * safe.left);
  const sx1 = Math.round(w * (1 - safe.right));
  const sy0 = Math.round(h * safe.top);
  const sy1 = Math.round(h * (1 - safe.bottom));
  const sw = sx1 - sx0;
  const sh = sy1 - sy0;
  const bh = Math.round(0.45 * sh);
  const bw = Math.round(0.75 * bh);
  const stackY = Math.round(h * split);
  const boxes: Record<AvatarPreset, PresetBox> = {
    'corner-br': { x: sx1 - bw, y: sy1 - bh, w: bw, h: bh, fit: 'right bottom', cover: false },
    'corner-bl': { x: sx0, y: sy1 - bh, w: bw, h: bh, fit: 'left bottom', cover: false },
    bottom: { x: sx0, y: sy1 - bh, w: sw, h: bh, fit: 'center bottom', cover: false },
    full: { x: sx0, y: sy0, w: sw, h: sh, fit: 'center bottom', cover: false },
    stack: { x: 0, y: stackY, w, h: h - stackY, fit: 'center 30%', cover: true },
  };
  return boxes[preset];
};

/**
 * Each segment joined with the box of its placed preset, in segment order.
 * Throws InputError when a segment has no preset or the placement names a segment that does not exist.
 */
export const avatarBoxes = (
  segments: AvatarSegments,
  placement: AvatarPlacement,
  format: FormatId,
  split?: number,
): AvatarBox[] => {
  const known = new Set(segments.segments.map((s) => s.seg));
  for (const key of Object.keys(placement.segments)) {
    if (!known.has(key)) throw new InputError(`avatar/placement.json names unknown segment ${key}`);
  }
  return segments.segments.map((s) => {
    const preset = placement.segments[s.seg];
    if (!preset) throw new InputError(`avatar/placement.json has no preset for ${s.seg}`);
    return { seg: s.seg, start: s.start, end: s.end, ...presetBox(preset, format, split) };
  });
};

/**
 * The avatar boxes of a run. Returns [] when the run has no avatar/segments.json (no avatar segments).
 * Throws InputError when segments exist but avatar/placement.json is missing, or on any avatarBoxes error.
 */
export const avatarBoxesOf = (runDir: string, format: FormatId): AvatarBox[] => {
  const segmentsFile = path.join(runDir, 'avatar', 'segments.json');
  if (!existsSync(segmentsFile)) return [];
  const placementFile = path.join(runDir, 'avatar', 'placement.json');
  if (!existsSync(placementFile)) throw new InputError('avatar/placement.json is missing: place the avatar first');
  const briefFile = path.join(runDir, 'brief.json');
  const split = existsSync(briefFile) ? readJson(briefFile, BriefSchema).layout?.split : undefined;
  return avatarBoxes(
    readJson(segmentsFile, AvatarSegmentsSchema),
    readJson(placementFile, AvatarPlacementSchema),
    format,
    split,
  );
};
