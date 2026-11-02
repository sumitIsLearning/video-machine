import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  AvatarSegmentsSchema,
  BriefSchema,
  FORMATS,
  type FormatId,
  type Look,
  LookSchema,
  PlanSchema,
  ScriptSchema,
  TimingSchema,
} from '../../../contracts/types';
import { type AvatarBox, avatarBoxesOf, stackSpans } from '../../../core/avatar';
import { InputError, UnsupportedError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { type SceneTime, sceneTimes } from '../../../core/scene-times';
import { maxTextPx, minTextPx } from '../../../core/text-fit';
import { WEB_LOAD, writeComposition } from './compose';
import { vmScript } from './runtime/bundle';

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

const NONDETERMINISM =
  /\b(Math\.random|Date\.now|new Date|performance\.now|requestAnimationFrame|setTimeout|setInterval)\b/;

// The rule a scene fragment breaks, or undefined when it is valid. The assembler owns the wrapper and the scene id.
const fragmentRule = (id: string, html: string): string | undefined => {
  if (html.includes('<template')) return 'must not contain <template>; the assembler wraps the fragment';
  if (html.includes('data-composition-id')) return 'must not set data-composition-id; the assembler sets it';
  if (html.search(WEB_LOAD) !== -1) return 'loads from the web; use files under assets/';
  const nondeterministic = html.match(NONDETERMINISM);
  if (nondeterministic) {
    return `uses ${nondeterministic[1]}; scenes must be deterministic (times come from VM.scene)`;
  }
  if (!new RegExp(`VM\\.scene\\(\\s*["']${id}["']\\s*\\)`).test(html)) {
    return `must register its timeline with VM.scene("${id}")`;
  }
  return undefined;
};

// Reads every scene fragment; throws one InputError naming every missing or invalid scene.
const readFragments = (runDir: string, ids: string[]): Map<string, string> => {
  const found = new Map<string, string>();
  const problems: string[] = [];
  for (const id of ids) {
    const file = path.join(runDir, 'scenes', `${id}.html`);
    if (!existsSync(file)) {
      problems.push(`scene ${id}: scenes/${id}.html is missing`);
      continue;
    }
    const html = readFileSync(file, 'utf8');
    const rule = fragmentRule(id, html);
    if (rule) problems.push(`scene ${id}: ${rule}`);
    found.set(id, html);
  }
  if (problems.length) throw new InputError(problems.join('\n'));
  return found;
};

// Escapes the characters that would break out of a text node or a double-quoted attribute.
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The seam bar and label chip over each covering (stack) video, drawn above it. Nothing without look.seam.
const seamLines = (format: FormatId, times: SceneTime[], avatars: AvatarBox[], look: Look): string => {
  const seam = look.seam;
  if (!seam) return '';
  const display = look.type.find((t) => t.role === 'display');
  const family = display ? `'${esc(display.family)}', system-ui, sans-serif` : 'system-ui, sans-serif';
  const base = times.length + 1 + avatars.length;
  return avatars
    .filter((a) => a.cover)
    .map((a, k) => {
      const duration = round3(a.end - a.start);
      const bar = `\n<div id="seam-${a.seg}" class="clip" data-start="${a.start}" data-duration="${duration}" data-track-index="${base + 2 * k}" style="position:absolute;left:0px;top:${a.y - 3}px;width:${a.w}px;height:6px;background:${seam.color};z-index:11"></div>`;
      if (!seam.label) return bar;
      const chip = `\n<div id="seam-label-${a.seg}" class="clip" data-vm-chrome data-start="${a.start}" data-duration="${duration}" data-track-index="${base + 2 * k + 1}" style="position:absolute;left:50%;top:${a.y}px;transform:translate(-50%,-50%);padding:8px 24px;border-radius:999px;background:${seam.color};color:#fff;font-family:${family};font-weight:700;font-size:${minTextPx(format)}px;letter-spacing:0.08em;white-space:nowrap;z-index:12">${esc(seam.label)}</div>`;
      return bar + chip;
    })
    .join('');
};

// The root page: vendored scripts, the frame variables, one host per scene, the avatar layer and the voiceover audio.
const rootHtml = (format: FormatId, times: SceneTime[], total: number, avatars: AvatarBox[], look?: Look): string => {
  const { w, h, safe } = FORMATS[format];
  const hosts = times
    .map(
      (t, i) =>
        `<div id="host-${t.scene_id}" data-composition-id="${t.scene_id}" data-composition-src="compositions/${t.scene_id}.html" data-start="${t.start}" data-duration="${t.duration}" data-track-index="${i + 1}"></div>`,
    )
    .join('\n');
  const avatarLines = avatars
    .map(
      (a, k) =>
        `\n<video id="avatar-${a.seg}" class="clip" src="avatar/${a.seg}.webm" muted playsinline data-start="${a.start}" data-duration="${round3(a.end - a.start)}" data-track-index="${times.length + 1 + k}" style="position:absolute;left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px;object-fit:${a.cover ? 'cover' : 'contain'};object-position:${a.fit};z-index:10"></video>`,
    )
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="vendor/gsap.min.js"></script>
<script src="vendor/vm.js"></script>
<style>
:root { --vm-w: ${w}px; --vm-h: ${h}px; --vm-safe-top: ${Math.round(h * safe.top)}px; --vm-safe-right: ${Math.round(w * safe.right)}px; --vm-safe-bottom: ${Math.round(h * safe.bottom)}px; --vm-safe-left: ${Math.round(w * safe.left)}px; --vm-min-text: ${minTextPx(format)}px; }
html, body { margin: 0; background: #000; }
</style>
</head>
<body>
<div id="root" data-composition-id="root" data-start="0" data-width="${w}" data-height="${h}" data-duration="${total}">
<audio id="vo" src="vo.wav" data-start="0" data-duration="${total}" data-track-index="0"></audio>
${hosts}${avatarLines}${look ? seamLines(format, times, avatars, look) : ''}
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines.root = gsap.timeline({ paused: true });</script>
</body>
</html>
`;
};

// A scene's own composition: the fragment inside the template the root page loads.
const sceneHtml = (t: SceneTime, fragment: string, w: number, h: number): string =>
  `<template><div id="scene-${t.scene_id}" data-composition-id="${t.scene_id}" data-width="${w}" data-height="${h}" data-duration="${t.duration}" style="position:absolute;inset:0;overflow:hidden">\n${fragment}\n</div></template>\n`;

/**
 * Assemble a voiceover run into build/<format>: the root page, one composition per scene, vendored GSAP and the
 * browser helper, the assets, vo.wav and scenes.json. Returns the absolute build folder. Throws UnsupportedError for
 * non-voiceover runs, InputError when vo.wav or a scene fragment is missing or invalid (nothing is written then),
 * and ContractError for a malformed run file. A failed build leaves no build/<format> behind.
 */
export async function assembleProject(runDir: string, format: FormatId): Promise<string> {
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  if (brief.timing_source !== 'voiceover') {
    throw new UnsupportedError(
      `timing_source "${brief.timing_source}" can't be assembled yet: only voiceover runs (R5)`,
    );
  }
  const voice = path.join(runDir, 'audio', 'vo.wav');
  if (!existsSync(voice)) throw new InputError(`${voice} is missing: voice the script first`);
  // Without this check the build would drop the avatar lines silently; a run with no avatar line never needs one.
  if (brief.avatar !== undefined && !existsSync(path.join(runDir, 'avatar', 'segments.json'))) {
    const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
    if (script.lines.some((line) => line.delivery === 'avatar')) throw new InputError('make the avatar first (M11)');
  }

  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const timing = readJson(path.join(runDir, 'data', 'timing.json'), TimingSchema);
  const times = sceneTimes(plan, timing);
  const segmentsFile = path.join(runDir, 'avatar', 'segments.json');
  if (brief.layout?.kind === 'stack' && existsSync(segmentsFile)) {
    const spans = stackSpans(plan, readJson(path.join(runDir, 'script.json'), ScriptSchema), timing);
    const made = readJson(segmentsFile, AvatarSegmentsSchema).segments;
    const same =
      spans.length === made.length &&
      spans.every((s, i) => {
        const m = made[i];
        return m && m.seg === s.seg && Math.abs(m.start - s.start) <= 0.01 && Math.abs(m.end - s.end) <= 0.01;
      });
    if (!same) throw new InputError('the plan changed since the avatar was made: make the avatar again (M11)');
  }
  const fragments = readFragments(
    runDir,
    times.map((t) => t.scene_id),
  );

  const lookFile = path.join(runDir, 'look', 'look.json');
  const look = existsSync(lookFile) ? readJson(lookFile, LookSchema) : undefined;
  const avatars = avatarBoxesOf(runDir, format);
  for (const a of avatars) {
    const webm = path.join(runDir, 'avatar', `${a.seg}.webm`);
    if (!existsSync(webm)) throw new InputError(`avatar/${a.seg}.webm is missing: make the avatar again`);
  }

  const { w, h } = FORMATS[format];
  const total = round3(Math.max(...times.map((t) => t.start + t.duration)));
  const assetIds = [...new Set(plan.visuals_plan.scenes.flatMap((s) => s.asset_ids))];
  const buildRel = path.join('build', `.${format}.tmp`);
  const tmp = path.join(runDir, buildRel);
  const out = path.join(runDir, 'build', format);

  try {
    rmSync(tmp, { recursive: true, force: true });
    writeComposition(runDir, buildRel, rootHtml(format, times, total, avatars, look), assetIds);
    mkdirSync(path.join(tmp, 'compositions'), { recursive: true });
    for (const t of times) {
      writeFileSync(
        path.join(tmp, 'compositions', `${t.scene_id}.html`),
        sceneHtml(t, fragments.get(t.scene_id) ?? '', w, h),
      );
    }
    const vm = await vmScript({
      format: { w, h, min_text_px: minTextPx(format), max_text_px: maxTextPx(format) },
      scenes: Object.fromEntries(times.map((t) => [t.scene_id, t])),
    });
    writeFileSync(path.join(tmp, 'vendor', 'vm.js'), vm);
    copyFileSync(voice, path.join(tmp, 'vo.wav'));
    if (avatars.length > 0) {
      mkdirSync(path.join(tmp, 'avatar'), { recursive: true });
      for (const a of avatars) {
        copyFileSync(path.join(runDir, 'avatar', `${a.seg}.webm`), path.join(tmp, 'avatar', `${a.seg}.webm`));
      }
    }
    writeFileSync(
      path.join(tmp, 'scenes.json'),
      JSON.stringify(times.map(({ scene_id, start, duration }) => ({ scene_id, start, duration }))),
    );
    rmSync(out, { recursive: true, force: true });
    renameSync(tmp, out);
  } catch (cause) {
    rmSync(tmp, { recursive: true, force: true });
    throw cause;
  }
  return out;
}
