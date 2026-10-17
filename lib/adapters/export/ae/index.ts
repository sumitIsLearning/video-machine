import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BriefSchema,
  type Deliverable,
  type ExportAdapter,
  FORMATS,
  PlanSchema,
  TimingSchema,
} from '../../../contracts/types';
import type { Deps } from '../../../core/deps';
import { InputError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { deliverStageOf } from '../../../core/paths';
import { sceneFrames, sceneTimes } from '../../../core/scene-times';

/** Ten minutes: one scene cut of a long reel is far below this, so a hang is a fault, not a slow render. */
const CUT_TIMEOUT_MS = 600_000;

/** The inputs of build_comp.jsx: the comp, the clips on its timeline and the word markers. */
export type CompSpec = {
  name: string;
  w: number;
  h: number;
  fps: number;
  duration: number;
  clips: { file: string; start: number }[];
  words: { t: number; w: string }[];
};

/**
 * The ExtendScript that builds the After Effects comp from the package folder. The strings go through JSON.stringify,
 * so quotes in a word cannot break the script. Returns the script text; never throws.
 */
export function buildCompJsx(o: CompSpec): string {
  const clips = o.clips.map((c) => `[${JSON.stringify(c.file)}, ${c.start}]`).join(', ');
  const words = o.words.map((x) => `[${x.t}, ${JSON.stringify(x.w)}]`).join(', ');
  return `// build_comp.jsx: in After Effects choose File > Scripts > Run Script File and pick this file.
(function () {
  var root = File($.fileName).parent.fsName;
  var load = function (rel) { return app.project.importFile(new ImportOptions(new File(root + "/" + rel))); };
  app.beginUndoGroup("Video Machine");
  var comp = app.project.items.addComp(${JSON.stringify(o.name)}, ${o.w}, ${o.h}, 1, ${o.duration}, ${o.fps});
  var clips = [${clips}];
  for (var i = 0; i < clips.length; i++) { comp.layers.add(load(clips[i][0])).startTime = clips[i][1]; }
  comp.layers.add(load("audio/mix.wav"));
  var words = [${words}];
  for (var j = 0; j < words.length; j++) { comp.markerProperty.setValueAtTime(words[j][0], new MarkerValue(words[j][1])); }
  comp.openInViewer();
  app.endUndoGroup();
})();
`;
}

/**
 * The After Effects package adapter. It cuts the final MOV into one clip per scene on whole frames, copies the mix and
 * captions, and writes build_comp.jsx. The package is built in `<stage>/.ae.tmp` and renamed to `<stage>/ae`; it
 * returns that folder. Throws InputError for a deliverable of another kind or a missing final MOV or mix, and removes
 * the partial package before rethrowing any failure.
 */
export const aeExport = (deps: Deps): ExportAdapter => ({
  kind: 'ae_package',
  async export(runDir, d: Deliverable) {
    if (d.kind !== 'ae_package') throw new InputError(`aeExport cannot make ${d.kind}; use the adapter for that kind`);
    const { format } = d;
    const mov = path.join(runDir, 'out', 'final', `${format}.mov`);
    const mix = path.join(runDir, 'audio', 'mix.wav');
    for (const file of [mov, mix]) {
      if (!existsSync(file)) throw new InputError(`${file} is missing: render and mix the run before the AE package`);
    }
    const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
    const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
    const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
    const { fps, w, h } = FORMATS[format];
    const times = sceneTimes(plan, timing);
    const frames = sceneFrames(times, fps);
    const stage = deliverStageOf(runDir, format);
    const dir = path.join(stage, 'ae');
    const tmp = path.join(stage, '.ae.tmp');
    try {
      // A killed earlier run can leave a .ae.tmp behind; its old clips must not reach the package.
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(path.join(tmp, 'scenes'), { recursive: true });
      mkdirSync(path.join(tmp, 'audio'), { recursive: true });
      const clips = frames.map((f, k) => {
        const file = `scenes/${String(k + 1).padStart(2, '0')}-${f.scene_id}.mov`;
        const t = times[k];
        if (!t) throw new InputError(`scene ${f.scene_id} has no timing; the plan and timing disagree`);
        return { file, start: t.start, f };
      });
      for (const clip of clips) {
        await deps.sh(
          [
            'ffmpeg',
            '-v',
            'error',
            '-y',
            '-ss',
            (clip.f.f0 / fps).toFixed(6),
            '-i',
            mov,
            '-frames:v',
            String(clip.f.n),
            '-c',
            'copy',
            '-an',
            path.join(tmp, clip.file),
          ],
          { timeoutMs: CUT_TIMEOUT_MS },
        );
      }
      copyFileSync(mix, path.join(tmp, 'audio', 'mix.wav'));
      const srt = path.join(stage, 'captions.srt');
      if (existsSync(srt)) copyFileSync(srt, path.join(tmp, 'captions.srt'));
      const last = times.at(-1);
      const words = timing.lines.flatMap((line) => line.words.map((x) => ({ t: x.start, w: x.w })));
      writeFileSync(
        path.join(tmp, 'build_comp.jsx'),
        buildCompJsx({
          name: `${brief.run_id}-${format}`,
          w,
          h,
          fps,
          duration: (last?.start ?? 0) + (last?.duration ?? 0),
          clips: clips.map((c) => ({ file: c.file, start: c.start })),
          words,
        }),
      );
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      return dir;
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      throw err;
    }
  },
});
