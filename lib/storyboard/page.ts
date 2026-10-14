import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PlanSchema, ScriptSchema } from '../contracts/types';
import { estimate } from '../core/estimate';
import { readJson } from '../core/json';
import { type SceneTiming, sceneTimes } from './plan';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `body{font:14px system-ui,sans-serif;margin:16px;color:#111;background:#fff}
section{border-top:1px solid #ccc;padding:12px 0}
.scene img{width:360px;border:1px solid #888}
.screen{color:#555;font-style:italic;margin-left:8px}
.missing{color:#888;font-style:italic}`;

/** One scene as a section of the page: board, estimated range, lines, intent, beats and overrides. */
const row = (
  runDir: string,
  scene: { scene_id: string; intent: string; overrides?: string; beats: { on: string; does: string }[] },
  time: SceneTiming,
  lines: { text: string; on_screen?: string }[],
): string => {
  const rel = `boards/${scene.scene_id}.png`;
  const img = existsSync(path.join(runDir, rel))
    ? `<img src="../${esc(rel)}" alt="${esc(scene.scene_id)}">`
    : '<p class="missing">not rendered yet</p>';
  const said = lines
    .map((l) => `<li>${esc(l.text)}${l.on_screen ? `<span class="screen">${esc(l.on_screen)}</span>` : ''}</li>`)
    .join('');
  const beats = scene.beats.map((b) => `<li>${esc(b.on)} → ${esc(b.does)}</li>`).join('');
  const overrides = scene.overrides ? `<p>Overrides: ${esc(scene.overrides)}</p>` : '';
  return `<section class="scene"><h2>${esc(scene.scene_id)} <small>${time.start_s}–${time.end_s} s</small></h2>
${img}
<ul>${said}</ul>
<p>${esc(scene.intent)}</p>
<ul>${beats}</ul>
${overrides}</section>`;
};

/**
 * Write the storyboard page out/storyboard.html: one section per scene of plan.json in order, with its board (or "not
 * rendered yet"), estimated time range, script lines, intent, beats and overrides. Returns the absolute page path and
 * the scene ids whose board is not rendered yet. Throws the fs or contract error when a file cannot be read or written.
 */
export function writeStoryboardPage(runDir: string): { page: string; missing_boards: string[] } {
  const plan = readJson(path.join(runDir, 'plan.json'), PlanSchema);
  const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
  const times = sceneTimes(plan.visuals_plan.scenes, estimate(script).lines);
  const lineOf = new Map(script.lines.map((l) => [l.id, l]));
  const missing_boards = plan.visuals_plan.scenes
    .map((s) => s.scene_id)
    .filter((id) => !existsSync(path.join(runDir, 'boards', `${id}.png`)));
  const rows = plan.visuals_plan.scenes.map((scene, k) =>
    row(
      runDir,
      scene,
      times[k] as SceneTiming,
      scene.lines.map((id) => lineOf.get(id) as (typeof script.lines)[number]),
    ),
  );
  const file = path.join(runDir, 'out', 'storyboard.html');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Storyboard</title><style>${CSS}</style></head><body>
${rows.join('\n')}
</body></html>
`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  return { page: path.resolve(file), missing_boards };
}
