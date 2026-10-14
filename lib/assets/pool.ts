import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  type AssetRef,
  AssetRefSchema,
  type Assets,
  AssetsSchema,
  BriefSchema,
  CaptureLogSchema,
  NavFramesSchema,
  PageCaptureSchema,
} from '../contracts/types';
import { assetIdOf } from '../core/asset-id';
import { InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { assertRunDir, relInside, runFileOf } from '../core/paths';
import { runIdOf } from '../run/intake';

const ASSETS = 'assets.json';
const ORIGINS: AssetRef['origin'][] = ['supplied', 'nav_video', 'captured', 'web', 'found', 'drawn'];

const KINDS: Record<string, AssetRef['kind']> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  wav: 'audio',
  mp3: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  svg: 'svg',
  ttf: 'font',
  otf: 'font',
  woff: 'font',
  woff2: 'font',
};
const kindOf = (file: string): AssetRef['kind'] => KINDS[path.extname(file).slice(1).toLowerCase()] ?? 'data';

/** Whether a licence is empty or "unknown" (any case): such an asset never renders and can't be pinned. */
export const isUnknownLicence = (license: string): boolean => ['', 'unknown'].includes(license.trim().toLowerCase());

export type PoolOptions = { onWarn?: (line: string) => void };

/**
 * Collect every asset of a run into `assets.json`, keeping the creator's pin and drop marks by asset id.
 * A file it cannot use (missing, outside the run, a folder, wrong extension, dangling link) is skipped with an
 * `[M4] skipped <path>: <reason>` line to `onWarn` (silent when none is given; the CLI passes stderr); it never aborts the build.
 * Returns the pool, sorted by origin then path. Throws InputError when the folder is not a run, ContractError for a
 * malformed record file.
 */
export function buildPool(runDir: string, opts: PoolOptions = {}): Assets {
  assertRunDir(runDir);
  const warn = opts.onWarn ?? (() => {});
  const skip = (rel: string, reason: string) => warn(`[M4] skipped ${rel}: ${reason}`);
  const lexical = (rel: string) => path.join(runDir, ...rel.split('/'));
  const realRun = realpathSync.native(runDir);
  const found: AssetRef[] = [];

  /** The file of a run path when it is a file inside the run; otherwise warn and give undefined. */
  const usable = (rel: string): string | undefined => {
    try {
      return runFileOf(runDir, rel);
    } catch (cause) {
      if (!(cause instanceof InputError)) throw cause;
      skip(rel, cause.message);
      return undefined;
    }
  };
  /** A record file: absent is normal (no warning), present but unusable is skipped with a warning. */
  const recordOf = <T extends z.ZodType>(rel: string, schema: T): z.infer<T> | undefined => {
    if (!existsSync(lexical(rel))) return undefined;
    const file = usable(rel);
    return file === undefined ? undefined : readJson(file, schema);
  };
  /** Names inside a run folder; a folder that resolves outside the run (or is no folder) is skipped. */
  const listDir = (rel: string): string[] => {
    const dir = lexical(rel);
    if (!existsSync(dir)) return [];
    if (!statSync(dir).isDirectory()) {
      skip(rel, 'not a folder');
      return [];
    }
    if (relInside(realRun, realpathSync.native(dir)) === undefined) {
      skip(rel, 'resolves outside the run');
      return [];
    }
    return readdirSync(dir).sort();
  };
  const add = (a: Omit<AssetRef, 'asset_id' | 'status'>) => {
    if (usable(a.path) === undefined) return;
    found.push({ ...a, asset_id: assetIdOf(a.origin, a.path), status: 'pool' });
  };

  const brief = recordOf('brief.json', BriefSchema);

  // 1 and 2: what the creator handed over.
  for (const s of brief?.sources ?? []) {
    if (s.kind === 'file')
      add({
        origin: 'supplied',
        kind: kindOf(s.path_or_url),
        path: s.path_or_url,
        source: 'creator',
        license: 'creator-supplied',
        usage: 'render',
      });
    if (s.kind === 'nav_video')
      add({
        origin: 'nav_video',
        kind: 'video',
        path: s.path_or_url,
        source: 'creator',
        license: 'creator-supplied',
        usage: 'reference_only',
      });
  }
  const log = recordOf('capture/log.json', CaptureLogSchema) ?? [];
  const fallbacks = new Set(log.flatMap((e) => (e.fallback === undefined ? [] : [e.fallback])));
  // Folder names are capture/nav/<slug>-<hash>: list them, never assume a name.
  for (const dir of listDir('capture/nav')) {
    if (listDir(`capture/nav/${dir}`).length === 0) continue;
    for (const f of recordOf(`capture/nav/${dir}/frames.json`, NavFramesSchema)?.frames ?? [])
      add({
        origin: 'nav_video',
        kind: 'image',
        path: f.path,
        source: 'creator',
        license: 'creator-supplied',
        usage: fallbacks.has(f.path) ? 'render' : 'reference_only',
      });
  }

  // 3: replay output. The *-before.png shots only feed the crops.
  const urlOfStep = (file: string) => log.find((e) => String(e.i) === path.parse(file).name)?.url;
  const EXT = { shots: '.png', crops: '.png', clips: '.mp4' } as const;
  for (const sub of ['shots', 'crops', 'clips'] as const) {
    for (const name of listDir(`capture/${sub}`)) {
      if (name.toLowerCase().endsWith('-before.png')) continue;
      const rel = `capture/${sub}/${name}`;
      if (path.extname(name).toLowerCase() !== EXT[sub]) {
        skip(rel, `not a ${EXT[sub]} file`);
        continue;
      }
      const url = urlOfStep(name);
      add({
        origin: 'captured',
        kind: kindOf(name),
        path: rel,
        source: url ?? 'capture/log.json',
        license: url === undefined ? 'own capture' : `own capture of ${url}`,
        usage: 'render',
      });
    }
  }

  // 4: page captures.
  for (const name of listDir('capture/pages').filter((n) => n.endsWith('.json'))) {
    const page = recordOf(`capture/pages/${name}`, PageCaptureSchema);
    if (!page) continue;
    for (const p of [...page.screenshots, ...page.logos])
      add({
        origin: 'web',
        kind: kindOf(p),
        path: p,
        source: page.url,
        license: `page capture of ${page.url}`,
        usage: 'render',
      });
    // Captured fonts are often unicode-range subsets, so their licence is never assumed.
    for (const f of page.fonts)
      add({
        origin: 'web',
        kind: 'font',
        path: f.path,
        source: page.url,
        license: 'unknown',
        usage: 'reference_only',
        title: f.family,
      });
  }

  // 5: found media. The index is normalised on read (origin, id, status and an unknown licence's usage are ours to set,
  // not the file's). Openverse reports SVG as an image, so the extension decides the kind.
  for (const a of recordOf('found/index.json', z.array(AssetRefSchema)) ?? []) {
    if (usable(a.path) === undefined) continue;
    found.push({
      ...a,
      origin: 'found',
      asset_id: assetIdOf('found', a.path),
      kind: a.kind === 'image' && kindOf(a.path) === 'svg' ? 'svg' : a.kind,
      status: 'pool',
      usage: isUnknownLicence(a.license) ? 'reference_only' : a.usage,
    });
  }

  const marks = new Map<string, AssetRef['status']>();
  for (const a of recordOf(ASSETS, AssetsSchema)?.assets ?? []) marks.set(a.asset_id, a.status);
  const seen = new Set<string>();
  const assets = found
    .filter((a) => !seen.has(a.asset_id) && seen.add(a.asset_id))
    .map((a) => {
      const mark = marks.get(a.asset_id) ?? a.status;
      // A licence that became unknown since the pin takes the pin back.
      return { ...a, status: mark === 'pinned' && isUnknownLicence(a.license) ? ('pool' as const) : mark };
    })
    .sort(
      (a, b) =>
        ORIGINS.indexOf(a.origin) - ORIGINS.indexOf(b.origin) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
  return writeJson(path.join(runDir, ASSETS), AssetsSchema, { run_id: runIdOf(runDir), assets });
}

/**
 * Set the creator's mark on one asset in `assets.json`.
 * Returns the updated pool. Throws InputError for an unknown id, for pinning an asset whose licence is unknown,
 * or when the pool has not been built yet.
 */
export function markAsset(runDir: string, id: string, status: AssetRef['status']): Assets {
  assertRunDir(runDir);
  const file = path.join(runDir, ASSETS);
  if (!existsSync(file)) throw new InputError(`${ASSETS} does not exist in ${runDir}; run assets build first`);
  const pool = readJson(file, AssetsSchema);
  const asset = pool.assets.find((a) => a.asset_id === id);
  if (!asset) throw new InputError(`no asset "${id}" in ${ASSETS}`);
  if (status === 'pinned' && isUnknownLicence(asset.license))
    throw new InputError(`cannot pin ${id}: its licence is unknown`);
  asset.status = status;
  return writeJson(file, AssetsSchema, pool);
}
