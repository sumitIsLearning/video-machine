import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BoardIdSchema, type CheckResult, type Look } from '../contracts/types';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `body{font:14px system-ui,sans-serif;margin:16px;color:#111;background:#fff}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.sw{display:inline-block;width:16px;height:16px;border:1px solid #888;vertical-align:middle;margin-right:4px}
.boards{display:grid;grid-template-columns:1fr;gap:8px}
.boards img{width:100%}
.missing{color:#888;font-style:italic}`;

const column = (runDir: string, dir: 'A' | 'B', look: Look): string => {
  const palette = look.palette
    .map((p) => `<li><span class="sw" style="background:${esc(p.hex)}"></span>${esc(p.hex)} (${esc(p.role)})</li>`)
    .join('');
  const type = look.type.map((t) => `<li>${esc(t.role)}: ${esc(t.family)}</li>`).join('');
  const motifs = look.motifs.map((m) => esc(m.id)).join(', ');
  const boards = BoardIdSchema.options
    .map((b) => {
      const rel = `directions/${dir}/boards/${b}.png`;
      const img = existsSync(path.join(runDir, rel))
        ? `<img src="../${esc(rel)}" alt="${esc(dir)} ${b}">`
        : '<p class="missing">not rendered yet</p>';
      return `<figure><figcaption>${b}</figcaption>${img}</figure>`;
    })
    .join('');
  return `<section><h2>${esc(dir)}: ${esc(look.id)}</h2>
<p>${esc(look.idea)}</p>
<h3>Palette</h3><ul>${palette}</ul>
<h3>Type</h3><ul>${type}</ul>
<p>Motion: ${esc(look.motion.character)}</p>
<p>Motifs: ${motifs}</p>
<div class="boards">${boards}</div>
</section>`;
};

/**
 * Write the static side-by-side page out/looks.html for the two directions. Missing boards show "not rendered yet".
 * Returns the absolute path of the page. Throws the fs error when out/ cannot be written.
 */
export function writeLooksPage(runDir: string, a: Look, b: Look, check: CheckResult): string {
  const file = path.join(runDir, 'out', 'looks.html');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Looks</title><style>${CSS}</style></head><body>
<p>${esc(check.detail)}</p>
<div class="cols">${column(runDir, 'A', a)}${column(runDir, 'B', b)}</div>
</body></html>
`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  return path.resolve(file);
}
