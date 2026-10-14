import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type AssetRef, AssetsSchema } from '../contracts/types';
import { InputError } from '../core/errors';
import { readJson } from '../core/json';
import { runFileOf } from '../core/paths';
import { assertRunDir } from '../run/intake';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#111;--card:#f3f3f3}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--card:#262626}}
body{background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif;margin:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:var(--card);padding:8px;border-radius:6px;overflow-wrap:anywhere}
.card img,.card video{width:100%;max-height:160px;object-fit:contain}
.badge{display:block;padding:24px 0;text-align:center;font-weight:bold}
.card p{margin:2px 0}a{color:inherit}`;

const count = (items: string[]): string => {
  const n = new Map<string, number>();
  for (const k of items) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n].map(([k, c]) => `${esc(k)}: ${c}`).join(', ');
};

const thumb = (a: AssetRef): string => {
  const src = `../${a.path.split('/').map(encodeURIComponent).join('/')}`;
  if (a.kind === 'image' || a.kind === 'svg') return `<img src="${esc(src)}" alt="${esc(a.title ?? a.asset_id)}">`;
  if (a.kind === 'video') return `<video controls muted src="${esc(src)}"></video>`;
  if (a.kind === 'audio') return `<audio controls src="${esc(src)}"></audio>`;
  return `<span class="badge">${esc(a.kind)}</span>`;
};

const card = (a: AssetRef): string => {
  const link = /^https?:\/\//.test(a.source)
    ? `<a href="${esc(a.source)}" rel="noopener noreferrer">${esc(a.source)}</a>`
    : esc(a.source);
  return `<div class="card">${thumb(a)}
<p><b>${esc(a.asset_id)}</b></p>
${a.title ? `<p>${esc(a.title)}</p>\n` : ''}<p>origin: ${esc(a.origin)}</p>
<p>licence: ${esc(a.license)}</p>
${a.attribution ? `<p>${esc(a.attribution)}</p>\n` : ''}<p>status: ${esc(a.status)}, usage: ${esc(a.usage)}</p>
<p>source: ${link}</p></div>`;
};

/**
 * Write the read-only assets panel, a self-contained page with no scripts, to `out/assets-panel.html`.
 * Returns its absolute path. Throws InputError when the folder is not a run, and the fs error or ContractError when
 * `assets/assets.json` is missing or malformed. An asset whose file no longer resolves inside the run is left out,
 * with an `[M4] skipped <path>: <reason>` line to `onWarn` (stderr by default).
 */
export function writePanel(runDir: string, opts: { onWarn?: (line: string) => void } = {}): string {
  assertRunDir(runDir);
  const warn = opts.onWarn ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const assets = readJson(path.join(runDir, 'assets', 'assets.json'), AssetsSchema).assets.filter((a) => {
    try {
      runFileOf(runDir, a.path);
      return true;
    } catch (cause) {
      if (!(cause instanceof InputError)) throw cause;
      warn(`[M4] skipped ${a.path}: ${cause.message}`);
      return false;
    }
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Assets</title><style>${CSS}</style></head>
<body><h1>Assets (${assets.length})</h1>
<p>By origin: ${count(assets.map((a) => a.origin))}</p>
<p>By status: ${count(assets.map((a) => a.status))}</p>
<div class="grid">
${assets.map(card).join('\n')}
</div></body></html>
`;
  const file = path.join(runDir, 'out', 'assets-panel.html');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  return file;
}
