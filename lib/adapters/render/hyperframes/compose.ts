import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isUnknownLicence } from '../../../assets/pool';
import { type AssetRef, AssetsSchema } from '../../../contracts/types';
import { HF_CMD, PLUGIN_ROOT } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { InputError, ToolError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { assertRunDir, relInside, runFileOf } from '../../../core/paths';

/** The GSAP build every composition vendors, so a board never loads a script from the web (R4). */
export const GSAP_FILE = path.join(PLUGIN_ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');

// Any src/href, CSS url() or @import that points at the web (absolute or protocol-relative); group 1 is the URL.
const WEB_LOAD =
  /(?:\b(?:src|href)\s*=\s*["']?|\burl\(\s*["']?|@import\s+(?:url\(\s*)?["']?)((?:https?:)?\/\/[^"'\s)>]+)/gi;
const LINT_TIMEOUT_MS = 120_000;
const SNAPSHOT_TIMEOUT_MS = 300_000;

type Finding = { code: string; severity: string; message: string };

/**
 * Write a self-contained composition folder: index.html, vendor/gsap.min.js and the named assets copied as
 * assets/<asset_id><ext>. Returns the folder and the run-relative path of each asset. Throws InputError when the
 * folder is outside the run, the HTML loads from the web, or an asset is unknown, dropped, reference-only or unlicensed;
 * nothing is written in that case.
 */
export function writeComposition(
  runDir: string,
  compRel: string,
  html: string,
  assetIds: string[],
): { dir: string; assets: Record<string, string> } {
  assertRunDir(runDir);
  const dir = path.resolve(runDir, compRel);
  if (!relInside(runDir, dir)) throw new InputError(`composition folder must be inside the run: ${compRel}`);

  const web = [...html.matchAll(WEB_LOAD)][0];
  if (web)
    throw new InputError(`index.html loads ${web[1]} from the web; use vendor/gsap.min.js and files under assets/`);

  const refs = renderableAssets(runDir, assetIds);

  rmSync(path.join(dir, 'assets'), { recursive: true, force: true });
  mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  copyFileSync(GSAP_FILE, path.join(dir, 'vendor', 'gsap.min.js'));
  const assets: Record<string, string> = {};
  for (const a of refs) {
    const name = `${a.asset_id}${path.extname(a.path)}`;
    copyFileSync(runFileOf(runDir, a.path), path.join(dir, 'assets', name));
    assets[a.asset_id] = `assets/${name}`;
  }
  writeFileSync(path.join(dir, 'index.html'), html);
  return { dir, assets };
}

/**
 * Resolve each asset id to its pool entry, in the given order. Returns [] without reading assets.json when no ids are
 * given. Throws InputError naming the first id that is unknown, dropped, reference-only, unlicensed, or whose file is
 * not inside the run.
 */
export function renderableAssets(runDir: string, assetIds: string[]): AssetRef[] {
  if (!assetIds.length) return [];
  const pool = readJson(path.join(runDir, 'assets.json'), AssetsSchema).assets;
  return assetIds.map((id) => {
    const a = pool.find((x) => x.asset_id === id);
    if (!a) throw new InputError(`unknown asset "${id}" in assets.json`);
    const reasons = [
      a.status === 'dropped' ? 'dropped' : '',
      a.usage === 'reference_only' ? 'reference only' : '',
      isUnknownLicence(a.license) ? 'unknown licence' : '',
    ].filter(Boolean);
    if (reasons.length) throw new InputError(`asset "${id}" can't render (${reasons.join(', ')})`);
    runFileOf(runDir, a.path);
    return a;
  });
}

/**
 * Lint a composition folder with the pinned HyperFrames CLI. Returns the error and warning lines (`code: message`).
 * Throws ToolError when the output is not the expected JSON.
 */
export async function lintComposition(deps: Deps, dir: string): Promise<{ errors: string[]; warnings: string[] }> {
  const cmd = [...HF_CMD, 'lint', '--json', dir];
  const res = await deps.sh(cmd, { env: deps.config.toolEnv, allowFail: true, timeoutMs: LINT_TIMEOUT_MS });
  let parsed: { findings?: Finding[] } | null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (cause) {
    throw new ToolError({ cmd, code: res.code, stderr: res.stdout.slice(0, 500) }, { cause });
  }
  if (!Array.isArray(parsed?.findings)) throw new ToolError({ cmd, code: res.code, stderr: res.stdout.slice(0, 500) });
  const line = (f: Finding) => `${f.code}: ${f.message}`;
  return {
    errors: parsed.findings.filter((f) => f.severity === 'error').map(line),
    warnings: parsed.findings.filter((f) => f.severity !== 'error').map(line),
  };
}

/**
 * Snapshot a composition at the given times, software-only. Returns the absolute frame paths in time order.
 * Throws ToolError when HyperFrames wrote no frame.
 */
export async function snapshotComposition(deps: Deps, dir: string, at: number[]): Promise<string[]> {
  if (!at.length) throw new InputError('snapshot needs at least one time');
  const out = path.join(dir, 'snaps');
  rmSync(out, { recursive: true, force: true });
  const cmd = [
    ...HF_CMD,
    'snapshot',
    dir,
    '--at',
    at.map(String).join(','),
    '--no-end',
    '--describe',
    'false',
    '--no-browser-gpu',
    '-o',
    out,
  ];
  await deps.sh(cmd, { env: deps.config.toolEnv, timeoutMs: SNAPSHOT_TIMEOUT_MS });
  const names = existsSync(out) ? readdirSync(out) : [];
  const frames = names
    .map((name) => ({ name, index: /^frame-(\d+)-.*\.png$/.exec(name)?.[1] }))
    .filter((f): f is { name: string; index: string } => f.index !== undefined)
    .sort((a, b) => Number(a.index) - Number(b.index));
  if (!frames.length) throw new ToolError({ cmd, code: 0, stderr: 'snapshot wrote no frames' });
  return frames.map((f) => path.join(out, f.name));
}

/**
 * Write a composition, lint it, snapshot it at `at` and copy the frame to `pngRel` in the run. The composition folder
 * stays on disk for Claude to fix. Returns the png path and the lint warnings. Throws InputError (`label` names the
 * board) when lint reports errors or an asset cannot render; ToolError when HyperFrames fails.
 */
export async function renderBoard(
  deps: Deps,
  runDir: string,
  compRel: string,
  html: string,
  assetIds: string[],
  at: number,
  label: string,
  pngRel: string,
): Promise<{ png: string; warnings: string[] }> {
  const comp = writeComposition(runDir, compRel, html, assetIds);
  const { errors, warnings } = await lintComposition(deps, comp.dir);
  if (errors.length) throw new InputError(`${label} has lint errors:\n- ${errors.join('\n- ')}`);
  // snapshotComposition throws when HyperFrames wrote no frame, so the first one exists.
  const frame = (await snapshotComposition(deps, comp.dir, [at]))[0] as string;
  copyFileSync(frame, path.join(runDir, pngRel));
  return { png: pngRel, warnings };
}
