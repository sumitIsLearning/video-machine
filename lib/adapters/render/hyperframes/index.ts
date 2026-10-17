import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { FormatId, Issue, LayerPass, RenderAdapter } from '../../../contracts/types';
import { HF_CMD } from '../../../core/config';
import { type Deps, defaultDeps } from '../../../core/deps';
import { InputError, ToolError, UnsupportedError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { assertRunDir } from '../../../core/paths';
import { snapshotComposition } from './compose';

const LINT_TIMEOUT_MS = 120_000;
// `hyperframes check` runs browser layout and contrast passes, so it needs far longer than lint.
const CHECK_TIMEOUT_MS = 10 * 60_000;
const RENDER_TIMEOUT_MS = 20 * 60_000;
const CHECK_SECTIONS = ['lint', 'runtime', 'layout', 'contrast'] as const;
// Draft renders are the fast preview; final renders use HyperFrames' delivery quality.
const QUALITY = {
  draft: { dir: 'drafts', flag: 'draft' },
  final: { dir: 'final', flag: 'delivery' },
} as const;

const FindingSchema = z.object({
  code: z.string(),
  severity: z.string(),
  message: z.string(),
  file: z.string().optional(),
  selector: z.string().optional(),
  time: z.number().optional(),
});
type Finding = z.infer<typeof FindingSchema>;
const FindingsSchema = z.object({ findings: z.array(FindingSchema) });
const CheckSchema = z.object({
  lint: FindingsSchema.optional(),
  runtime: FindingsSchema.optional(),
  layout: FindingsSchema.optional(),
  contrast: FindingsSchema.optional(),
});
const SceneWindowsSchema = z.array(z.object({ scene_id: z.string(), start: z.number(), duration: z.number() }));
type SceneWindow = z.infer<typeof SceneWindowsSchema>[number];

/** Run `cmd` and parse its stdout against `schema`. Throws ToolError with the first 500 chars when it is not that JSON. */
const parseTool = <T extends z.ZodType>(
  cmd: string[],
  res: { code: number; stdout: string; stderr: string },
  schema: T,
): z.infer<T> => {
  const detail = (res.stderr || res.stdout).slice(0, 500);
  let raw: unknown;
  try {
    raw = JSON.parse(res.stdout);
  } catch (cause) {
    throw new ToolError({ cmd, code: res.code, stderr: detail }, { cause });
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ToolError({ cmd, code: res.code, stderr: detail }, { cause: r.error });
  return r.data;
};

/** The scene a finding belongs to: its composition file, else the scene whose window holds its time. */
const sceneOf = (f: Finding, windows: SceneWindow[]): string | undefined => {
  const fromFile = /[\\/]compositions[\\/]([^\\/]+)\.html$/.exec(f.file ?? '')?.[1];
  if (fromFile) return fromFile;
  const at = f.time;
  if (at === undefined) return undefined;
  return windows.find((w) => w.start <= at && at < w.start + w.duration)?.scene_id;
};

/** Map one HyperFrames finding to an Issue. `section` prefixes the message, except for lint. */
const toIssue = (f: Finding, section: string | undefined, windows: SceneWindow[]): Issue => {
  const at = f.time;
  const where = at === undefined ? '' : f.selector ? ` (${f.selector} at ${at} s)` : ` (at ${at} s)`;
  const sceneId = sceneOf(f, windows);
  return {
    severity: f.severity === 'error' ? 'error' : 'warning',
    ...(sceneId ? { scene_id: sceneId } : {}),
    message: `${section ? `${section} ` : ''}${f.code}: ${f.message}${where}`,
  };
};

/** Every build/<name>/ folder that has an index.html, in name order. Returns [] when there is no build folder. */
const buildDirs = (runDir: string): string[] => {
  assertRunDir(runDir);
  const root = path.join(runDir, 'build');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .filter((dir) => existsSync(path.join(dir, 'index.html')));
};

const sceneWindows = (buildDir: string): SceneWindow[] =>
  readJson(path.join(buildDir, 'scenes.json'), SceneWindowsSchema);

/** The build folder of a format. Throws InputError when the scenes were never built for it. */
const buildOf = (runDir: string, format: FormatId): string => {
  const dir = path.join(runDir, 'build', format);
  if (!existsSync(path.join(dir, 'index.html')))
    throw new InputError(`no build/${format}/index.html in ${runDir}: build the scenes first`);
  return dir;
};

/** Copy `src` to `dest` through a temp name, so a half-copied file never looks current. */
const publish = (src: string, dest: string): void => {
  copyFileSync(src, `${dest}.tmp`);
  renameSync(`${dest}.tmp`, dest);
};

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * The `hyperframes` render adapter: lints and checks every build folder, snapshots stills and a contact sheet, and
 * renders a format to out/drafts or out/final. Returns the adapter; throws nothing itself.
 */
export const hyperframesRender = (deps: Deps = defaultDeps()): RenderAdapter => ({
  name: 'hyperframes',
  supports: () => ({ ok: true }),

  async lint(runDir) {
    const issues: Issue[] = [];
    for (const dir of buildDirs(runDir)) {
      const cmd = [...HF_CMD, 'lint', '--json', dir];
      const res = await deps.sh(cmd, { env: deps.config.toolEnv, allowFail: true, timeoutMs: LINT_TIMEOUT_MS });
      const { findings } = parseTool(cmd, res, FindingsSchema);
      const windows = sceneWindows(dir);
      issues.push(...findings.map((f) => toIssue(f, undefined, windows)));
    }
    return issues;
  },

  async check(runDir) {
    const issues: Issue[] = [];
    for (const dir of buildDirs(runDir)) {
      const cmd = [...HF_CMD, 'check', '--json', '--no-browser-gpu', dir];
      const res = await deps.sh(cmd, { env: deps.config.toolEnv, allowFail: true, timeoutMs: CHECK_TIMEOUT_MS });
      const sections = parseTool(cmd, res, CheckSchema);
      const windows = sceneWindows(dir);
      for (const s of CHECK_SECTIONS) {
        const findings = sections[s]?.findings ?? [];
        issues.push(...findings.map((f) => toIssue(f, s === 'lint' ? undefined : s, windows)));
      }
    }
    return issues;
  },

  async still(runDir, format, t, only) {
    if (only) throw new UnsupportedError('hyperframes still does not filter by scene yet; drop the only list');
    const build = buildOf(runDir, format);
    const frames = await snapshotComposition(deps, build, t);
    if (frames.length !== t.length)
      throw new ToolError({
        cmd: [...HF_CMD, 'snapshot', build],
        code: 0,
        stderr: `snapshot wrote ${frames.length} frames for ${t.length} times`,
      });
    const outDir = path.join(runDir, 'out', 'stills', format);
    mkdirSync(outDir, { recursive: true });
    return t.map((time, i) => {
      const dest = path.join(outDir, `t-${time}.png`);
      publish(frames[i] as string, dest);
      return dest;
    });
  },

  async contactSheet(runDir, format, perScene) {
    const build = buildOf(runDir, format);
    const times = sceneWindows(build).flatMap((w) =>
      Array.from({ length: perScene }, (_, k) => round3(w.start + (w.duration * (k + 1)) / (perScene + 1))),
    );
    await snapshotComposition(deps, build, times);
    const sheet = path.join(build, 'snaps', 'contact-sheet.jpg');
    if (!existsSync(sheet))
      throw new ToolError({
        cmd: [...HF_CMD, 'snapshot', build],
        code: 0,
        stderr: 'snapshot wrote no contact-sheet.jpg',
      });
    const outDir = path.join(runDir, 'out', 'sheets');
    mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, `${format}.jpg`);
    publish(sheet, dest);
    return dest;
  },

  async render(runDir, format, quality, passes: LayerPass[] = [], container: 'mp4' | 'mov' = 'mp4') {
    if (passes.length)
      throw new UnsupportedError(`hyperframes render can't render layer passes (${passes.join(', ')}) yet`);
    const build = buildOf(runDir, format);
    const { dir, flag } = QUALITY[quality];
    const outDir = path.join(runDir, 'out', dir);
    const dest = path.join(outDir, `${format}.${container}`);
    const tmp = path.join(outDir, `${format}.tmp.${container}`);
    const formatArgs = container === 'mov' ? ['--format', 'mov'] : [];
    mkdirSync(outDir, { recursive: true });
    // A failed render must not leave the previous video looking current.
    rmSync(dest, { force: true });
    rmSync(tmp, { force: true });
    try {
      await deps.sh(
        [...HF_CMD, 'render', build, '--quality', flag, ...formatArgs, '--no-browser-gpu', '--quiet', '-o', tmp],
        { env: deps.config.toolEnv, timeoutMs: RENDER_TIMEOUT_MS },
      );
    } catch (cause) {
      rmSync(tmp, { force: true });
      throw cause;
    }
    renameSync(tmp, dest);
    return dest;
  },
});
export default hyperframesRender;
