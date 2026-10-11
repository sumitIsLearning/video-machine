import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { type PageCapture, PageCaptureSchema } from '../contracts/types';
import { HF_CMD } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { assertRunDir, slugOf } from '../run/intake';

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

/** True for a host that points inside the machine or its network (see the ponytail note at the call). */
const isPrivateHost = (hostname: string): boolean => {
  const h = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (!h.includes(':')) return false;
  if (h === '::' || h === '::1') return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // URL writes ::ffff:127.0.0.1 this way
  if (mapped) {
    const [hi, lo] = [Number.parseInt(mapped[1] ?? '', 16), Number.parseInt(mapped[2] ?? '', 16)];
    return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = Number.parseInt(h.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80; // fc00::/7, fe80::/10
};

/** Parse the URL and refuse what a page capture must not visit. Throws InputError; never echoes a password. */
const assertCapturableUrl = (url: string): URL => {
  if (!URL.canParse(url)) throw new InputError(`page capture needs an http(s) URL: ${url}`);
  const u = new URL(url);
  if (u.username || u.password) throw new InputError('page capture refuses a URL with a username or password');
  if (!/^https?:$/.test(u.protocol)) throw new InputError(`page capture needs an http(s) URL, not ${u.protocol}`);
  // ponytail: literal-host check only; a public name resolving to a private IP is not caught (DNS rebinding) — resolve and recheck if captures ever run unattended
  if (isPrivateHost(u.hostname)) throw new InputError(`page capture refuses a local or private address: ${u.host}`);
  return u;
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
  const { host, pathname, href } = assertCapturableUrl(url);
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
