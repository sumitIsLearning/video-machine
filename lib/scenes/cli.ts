// The scenes CLI: times (the first format's frame and each scene's timing and assets), build (M12) and check (M13's checks).
import path from 'node:path';
import { AssetsSchema, frameOf, PlanSchema, TimingSchema } from '../contracts/types';
import { runCli } from '../core/cli';
import { InputError } from '../core/errors';
import { readJson } from '../core/json';
import { sceneTimes } from '../core/scene-times';
import { minTextPx } from '../core/text-fit';
import { buildScenes } from './build';
import { checkScenes, type ScenesIo } from './check';
import { markDone, scenesTodo } from './todo';

const USAGE =
  'usage: cli.ts times <run_dir> | build <run_dir> | check <run_dir> | todo <run_dir> | done <run_dir> <scene_id>...';

/** The first format's frame and each scene's start, duration, beats, words and assets (src is run-relative). */
const timesOf = (runDir: string): Record<string, unknown> => {
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
  const pool = readJson(path.join(runDir, 'assets.json'), AssetsSchema);
  const format = plan.formats[0];
  if (format === undefined) throw new InputError('plan.json names no format');
  const { w, h, safe } = frameOf(format);
  const sceneAssets = new Map(plan.visuals_plan.scenes.map((s) => [s.scene_id, s.asset_ids]));
  return {
    format,
    frame: {
      w,
      h,
      safe_px: {
        top: Math.round(h * safe.top),
        right: Math.round(w * safe.right),
        bottom: Math.round(h * safe.bottom),
        left: Math.round(w * safe.left),
      },
      min_text_px: minTextPx(format),
    },
    scenes: sceneTimes(plan, timing).map((s) => ({
      scene_id: s.scene_id,
      start: s.start,
      duration: s.duration,
      beats: s.beats,
      words: s.words,
      assets: pool.assets
        .filter((a) => (sceneAssets.get(s.scene_id) ?? []).includes(a.asset_id))
        .map((a) => ({ asset_id: a.asset_id, src: `assets/${a.asset_id}${path.extname(a.path)}` })),
    })),
  };
};

/**
 * Run a scenes command: times, build, check, todo or done. Returns the fields of the CLI's JSON result. Throws InputError
 * for a usage mistake, a missing draft (check) or a missing plan format; the library functions throw their own errors.
 */
export const main = async (argv: string[], io: ScenesIo = {}): Promise<Record<string, unknown>> => {
  const [command, runDir, ...rest] = argv;
  if (runDir === undefined || (command !== 'done' && rest.length > 0)) throw new InputError(USAGE);
  switch (command) {
    case 'times':
      return timesOf(runDir);
    case 'build':
      return buildScenes(runDir, io);
    case 'check':
      return checkScenes(runDir, io);
    case 'todo':
      return { todo: scenesTodo(runDir) };
    case 'done':
      markDone(runDir, rest);
      return { done: rest };
    default:
      throw new InputError(USAGE);
  }
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
