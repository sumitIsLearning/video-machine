import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type AssetAdapter, type AssetRef, AssetRefSchema, RunPathSchema } from '../../../contracts/types';
import { assetIdOf } from '../../../core/asset-id';
import { type Deps, defaultDeps } from '../../../core/deps';
import { InputError, VideoMachineError } from '../../../core/errors';
import { readJson, writeJson } from '../../../core/json';
import { assertRunDir } from '../../../core/paths';
import { assertPublicHttpUrl } from '../../../core/url';

const API = 'https://api.openverse.org/v1';
const USER_AGENT = 'video-machine/0.1 (+https://github.com/)'; // Wikimedia answers 429 to clients without one
const SEARCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_BYTES = { image: 25 * 1024 * 1024, audio: 50 * 1024 * 1024 };
const SAFE_EXT = /^[a-z0-9]{1,5}$/;
const SAFE_VERSION = /^\d+(\.\d+)*$/;
const SAFE_LICENSES = new Set(['by', 'by-sa', 'cc0', 'pdm']); // commercial use and modification allowed

// Only the fields we use; the API sends many more and often null for the optional ones.
const SearchSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      title: z.string().nullish(),
      creator: z.string().nullish(),
      license: z.string(),
      license_version: z.string().nullish(),
      attribution: z.string().nullish(),
      foreign_landing_url: z.string().nullish(),
      filetype: z.string().nullish(),
    }),
  ),
});
type Result = z.infer<typeof SearchSchema>['results'][number];

// A Map, not an object: a hostile content-type such as "constructor" must not find an inherited member.
const EXT_BY_CONTENT_TYPE = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['audio/mpeg', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/wav', 'wav'],
]);

/**
 * Creative Commons spelling of an Openverse licence code, e.g. `by-sa` + `2.0` gives `CC BY-SA 2.0`.
 * Returns the name (version omitted when null); throws nothing.
 */
export const openverseLicense = (license: string, version: string | null): string => {
  const name = license === 'cc0' ? 'CC0' : license === 'pdm' ? 'Public Domain Mark' : `CC ${license.toUpperCase()}`;
  return version ? `${name} ${version}` : name;
};

/** The first extension from the checked content-type, then filetype, then the URL path that is plain letters and digits; else `bin`. */
const extOf = (filetype: string | null | undefined, url: URL, contentType: string): string => {
  const candidates = [
    EXT_BY_CONTENT_TYPE.get(contentType),
    filetype?.toLowerCase(),
    path.extname(url.pathname).slice(1).toLowerCase(),
  ];
  return candidates.find((e): e is string => e !== undefined && SAFE_EXT.test(e)) ?? 'bin';
};

/** Read a body into one buffer, giving up as soon as it passes `cap` bytes. Throws VideoMachineError when it does. */
const readCapped = async (res: Response, cap: number): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new VideoMachineError(`file is too large (over ${cap} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};

/** The credit line for an asset: the API's own, else one built from creator and title; undefined when neither is possible. */
const attributionOf = (r: Result, source: string, license: string): string | undefined => {
  if (r.attribution) return r.attribution;
  if (!r.creator) return undefined;
  return `"${r.title || 'Untitled'}" by ${r.creator} (${source}) is licensed under ${license}`;
};

const isHttpUrl = (s: string | null | undefined): s is string =>
  !!s && URL.canParse(s) && /^https?:$/.test(new URL(s).protocol);

/**
 * The Openverse adapter: free-licence (commercial use + modification allowed) images and audio.
 * Returns an `AssetAdapter`. `find` throws InputError for a folder that is not a run and VideoMachineError when the
 * search fails (a 429 says so, with the limits); a result that is unsafe or fails to download is skipped and reported to `onWarn`.
 */
export const openverse = (
  _deps: Deps = defaultDeps(),
  opts: { fetch?: typeof fetch; onWarn?: (line: string) => void } = {},
): AssetAdapter => {
  const doFetch = opts.fetch ?? fetch;
  const get = (url: string, timeoutMs: number) =>
    doFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': USER_AGENT } });

  const search = async (query: string, kind: 'image' | 'audio', n: number) => {
    const params = new URLSearchParams({ q: query, page_size: String(n), license_type: 'commercial,modification' });
    let res: Response;
    try {
      res = await get(`${API}/${kind === 'image' ? 'images' : 'audio'}/?${params}`, SEARCH_TIMEOUT_MS);
    } catch (cause) {
      throw new VideoMachineError(`openverse search "${query}" failed: network error`, { cause });
    }
    if (res.status === 429) {
      const limits = [...res.headers].filter(([k]) => k.startsWith('x-ratelimit-limit-')).map(([, v]) => v);
      const retry = res.headers.get('retry-after');
      throw new VideoMachineError(
        `openverse search "${query}" was rate limited${limits.length ? ` (${limits.join(', ')})` : ''}${retry ? `; retry after ${retry} s` : ''}`,
      );
    }
    if (!res.ok) throw new VideoMachineError(`openverse search "${query}" failed: HTTP ${res.status}`);
    const parsed = SearchSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new VideoMachineError(`openverse search "${query}" failed: unexpected response body`);
    return parsed.data.results;
  };

  /** Check one result and download it into `found/`. Throws (InputError or VideoMachineError) to say why it is skipped. */
  const take = async (runDir: string, r: Result, kind: 'image' | 'audio', stem: string): Promise<AssetRef> => {
    const license = r.license.toLowerCase();
    if (!SAFE_LICENSES.has(license))
      throw new VideoMachineError(`licence "${r.license}" is not free for commercial reuse`);
    if ((license === 'by' || license === 'by-sa') && !r.license_version)
      throw new VideoMachineError(`licence "${r.license}" has no version`);
    // The version lands in the credit line and the licence name, so only a plain number is let through.
    if (r.license_version && !SAFE_VERSION.test(r.license_version))
      throw new VideoMachineError(`licence version "${r.license_version.slice(0, 20)}" is not a number`);
    const source = isHttpUrl(r.foreign_landing_url) ? r.foreign_landing_url : r.url;
    const licenseName = openverseLicense(license, r.license_version ?? null);
    const attribution = attributionOf(r, source, licenseName);
    if (!attribution && license !== 'cc0' && license !== 'pdm')
      throw new VideoMachineError('no attribution and no creator to build one from');

    const url = assertPublicHttpUrl(r.url, 'openverse download');
    if (url.protocol !== 'https:') throw new InputError(`openverse download needs https, not ${url.protocol}`);

    const res = await get(url.href, DOWNLOAD_TIMEOUT_MS);
    if (res.status >= 300 && res.status < 400) throw new VideoMachineError(`HTTP ${res.status} redirect not followed`);
    if (!res.ok) throw new VideoMachineError(`HTTP ${res.status}`);
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!contentType.startsWith(`${kind}/`))
      throw new VideoMachineError(`content-type "${contentType}" is not ${kind}`);
    const cap = MAX_BYTES[kind];
    if (Number(res.headers.get('content-length')) > cap)
      throw new VideoMachineError(`file is too large (over ${cap} bytes)`);
    const body = await readCapped(res, cap);
    if (body.byteLength === 0) throw new VideoMachineError('the file is empty');

    const rel = `found/${stem}.${extOf(r.filetype, url, contentType)}`;
    RunPathSchema.parse(rel);
    mkdirSync(path.join(runDir, 'found'), { recursive: true });
    try {
      writeFileSync(path.join(runDir, rel), body);
    } catch (cause) {
      rmSync(path.join(runDir, rel), { force: true });
      throw cause;
    }
    return {
      asset_id: assetIdOf('found', rel), // the rule buildPool applies, so `assets mark` finds this id after a build
      kind,
      path: rel,
      source,
      license: licenseName,
      ...(attribution ? { attribution } : {}),
      ...(r.title ? { title: r.title } : {}),
      usage: 'render',
      origin: 'found',
      status: 'pool',
    };
  };

  return {
    async find(runDir, query, kind, n) {
      assertRunDir(runDir);
      const results = await search(query, kind, n);
      const indexFile = path.join(runDir, 'found', 'index.json');
      const existing = existsSync(indexFile) ? readJson(indexFile, z.array(AssetRefSchema)) : [];
      const known = new Set(existing.map((a) => path.parse(a.path).name));
      const added: AssetRef[] = [];

      for (const r of results.slice(0, n)) {
        // The file name hashes the result id, so it is stable and unique before the extension is known.
        const stem = assetIdOf('found', `found/${r.id}`);
        if (known.has(stem)) continue;
        try {
          added.push(await take(runDir, r, kind, stem));
          known.add(stem);
        } catch (e) {
          // A bad result costs that result only; the creator hears why through onWarn.
          if (!(e instanceof Error)) throw e;
          opts.onWarn?.(`[M5] skipping openverse result ${r.id}: ${e.message}`);
        }
      }

      if (added.length > 0) writeJson(indexFile, z.array(AssetRefSchema), [...existing, ...added]);
      return added;
    },
  };
};

export default openverse;
