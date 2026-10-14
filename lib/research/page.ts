import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type PageCapture, PageCaptureSchema } from '../contracts/types';
import { HF_CMD } from '../core/config';
import type { Deps } from '../core/deps';
import { ToolError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { assertRunDir } from '../core/paths';
import { assertPublicHttpUrl } from '../core/url';
import { slugOf } from '../run/intake';

const CAPTURE_TIMEOUT_MS = 5 * 60_000;
const MAX_PALETTE = 12;
const FONT_FILE = /^\w[\w.-]*$/; // a plain file name: no folders, no `..`

// Only the fields we keep; HyperFrames writes many more.
const FontsManifestSchema = z.looseObject({ files: z.array(z.looseObject({ file: z.string(), family: z.string() })) });
const TokensSchema = z.looseObject({
  colorStats: z.array(z.looseObject({ hex: z.string(), bgCount: z.number(), textCount: z.number() })),
});

/** File names in `dir` that pass `keep`, sorted; an absent folder has none. */
const listFiles = (dir: string, keep: (name: string) => boolean): string[] =>
  existsSync(dir) ? readdirSync(dir).filter(keep).sort() : [];

const parseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch (cause) {
    if (cause instanceof SyntaxError) return undefined;
    throw cause;
  }
};

/** The `title` in the JSON object HyperFrames printed (it spans many lines), or undefined when there is none. */
const titleOf = (stdout: string): string | undefined => {
  const text = stdout.trim();
  const object = parseObject(text) ?? parseObject(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return typeof object?.title === 'string' && object.title !== '' ? object.title : undefined;
};

/**
 * Capture a web page with HyperFrames into `capture/pages/<slug>/` and record what was kept in `capture/pages/<slug>.json`.
 * The slug is readable text plus a hash of the URL (without its fragment), so different pages never share a folder.
 * Returns the record (run-relative POSIX paths). Throws InputError for a non-run folder or a URL that is not public
 * http(s) without credentials, and ToolError (naming the URL) when HyperFrames fails. A second capture of the same
 * page replaces the first; a failed one leaves the first untouched.
 */
export async function capturePage(deps: Deps, runDir: string, url: string): Promise<PageCapture> {
  assertRunDir(runDir);
  const { host, pathname, href } = assertPublicHttpUrl(url, 'page capture');
  const noFragment = new URL(href);
  noFragment.hash = '';
  const hash = createHash('sha1').update(noFragment.href).digest('hex').slice(0, 8);
  const rel = `capture/pages/${slugOf(`${host} ${pathname}`)}-${hash}`;
  const dir = path.resolve(runDir, ...rel.split('/'));
  const tmp = `${dir}.tmp-${process.pid}`;
  const under = (...parts: string[]) => `${rel}/${parts.join('/')}`;

  let stdout: string;
  let record: PageCapture;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.dirname(dir), { recursive: true });
  try {
    try {
      ({ stdout } = await deps.sh([...HF_CMD, 'capture', url, '-o', path.resolve(tmp), '--skip-vision', '--json'], {
        env: deps.config.toolEnv,
        timeoutMs: CAPTURE_TIMEOUT_MS,
      }));
    } catch (cause) {
      if (!(cause instanceof ToolError)) throw cause;
      throw new ToolError(
        { cmd: cause.cmd, code: cause.code, stderr: `capture of ${url} failed: ${cause.stderrTail}` },
        { cause },
      );
    }

    const fontsManifest = path.join(tmp, 'extracted', 'fonts-manifest.json');
    const tokens = path.join(tmp, 'extracted', 'tokens.json');
    const fonts = existsSync(fontsManifest)
      ? readJson(fontsManifest, FontsManifestSchema)
          .files.filter((f) => FONT_FILE.test(f.file) && existsSync(path.join(tmp, 'assets', 'fonts', f.file)))
          .map((f) => ({ family: f.family, path: under('assets', 'fonts', f.file) }))
      : [];
    const palette = existsSync(tokens)
      ? readJson(tokens, TokensSchema)
          .colorStats.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex))
          .slice(0, MAX_PALETTE)
          .map((c) => ({ hex: c.hex, bg: c.bgCount, text: c.textCount }))
      : [];
    record = {
      url,
      title: titleOf(stdout) ?? host,
      dir: rel,
      screenshots: listFiles(path.join(tmp, 'screenshots'), (n) => n.endsWith('.png')).map((n) =>
        under('screenshots', n),
      ),
      logos: listFiles(path.join(tmp, 'assets'), (n) => /^logo-.*\.svg$/.test(n)).map((n) => under('assets', n)),
      fonts,
      palette,
    };
    // Only now, with a whole capture in hand, does the old one go.
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return writeJson(`${dir}.json`, PageCaptureSchema, record);
}
