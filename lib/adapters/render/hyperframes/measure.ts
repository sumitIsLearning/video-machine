// Measures a built composition: text boxes in the browser, frame differences with ffmpeg, snapshot hashes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import { HYPERFRAMES_VERSION } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ToolError } from '../../../core/errors';
import { snapshotComposition } from './compose';

/** One visible text box at a time `t`; the same fields as `lib/checks/layout.ts` `TextSample` (adapters never import checks). */
export type TextSample = {
  t: number;
  scene_id?: string;
  text: string;
  box: { x: number; y: number; w: number; h: number };
  font_px: number;
  caption: boolean;
};

const READY_TIMEOUT_MS = 30_000;

/**
 * The HyperFrames runtime used for measuring, fetched once with `npm pack` into `<vmHome>/hf/<version>/`.
 * Returns the absolute path of the runtime file; throws ToolError when npm or tar fails.
 */
export async function hfRuntimeFile(deps: Deps): Promise<string> {
  const dir = path.join(deps.config.vmHome, 'hf', HYPERFRAMES_VERSION);
  const runtime = path.join(dir, 'hyperframe.runtime.iife.js');
  if (existsSync(runtime)) return runtime;
  mkdirSync(dir, { recursive: true });
  const tmp = mkdtempSync(path.join(deps.config.vmHome, 'hf', 'tmp-'));
  try {
    const tgz = path.join(tmp, `hyperframes-${HYPERFRAMES_VERSION}.tgz`);
    await deps.sh(['npm', 'pack', `hyperframes@${HYPERFRAMES_VERSION}`, '--pack-destination', tmp], {
      env: deps.config.toolEnv,
    });
    const entry = 'package/dist/hyperframe.runtime.iife.js';
    await deps.sh(['tar', '-xzf', tgz, '-C', tmp, entry], { env: deps.config.toolEnv });
    renameSync(path.join(tmp, entry), runtime);
    return runtime;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Per-frame change of an mp4: `diffs[i]` is the luma change into frame i (0 for the first frame).
 * Returns the numbers in frame order; throws ToolError when ffmpeg fails.
 */
export async function frameDiffs(deps: Deps, mp4: string): Promise<number[]> {
  const { stdout } = await deps.sh(
    [
      'ffmpeg',
      '-v',
      'error',
      '-i',
      mp4,
      '-vf',
      'format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-',
      '-f',
      'null',
      '-',
    ],
    { env: deps.config.toolEnv },
  );
  const diffs = [...stdout.matchAll(/lavfi\.signalstats\.YMAX=(\d+)/g)].map((m) => Number(m[1]));
  return [0, ...diffs];
}

/**
 * sha256 hex of each snapshot frame of the composition in `dir` at the given times, in time order.
 * Throws ToolError when HyperFrames wrote no frame.
 */
export async function snapshotHashes(deps: Deps, dir: string, at: number[]): Promise<string[]> {
  const frames = await snapshotComposition(deps, dir, at);
  return frames.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex'));
}

// ponytail: Chrome first, then Playwright's own Chromium; no retry. Mirrors the capture adapter's launch order without importing it.
const launchBrowser = async (): Promise<Browser> => {
  try {
    return await chromium.launch({ channel: 'chrome', args: ['--disable-gpu'] });
  } catch {
    return chromium.launch({ args: ['--disable-gpu'] });
  }
};

/** Serves `root` over HTTP on a free port, answering 404 for any path that resolves outside it. */
const serveBuild = (root: string) =>
  Bun.serve({
    port: 0,
    async fetch(req) {
      const file = path.join(root, decodeURIComponent(new URL(req.url).pathname));
      const inside = file === root || file.startsWith(root + path.sep);
      const body = inside ? Bun.file(file.endsWith(path.sep) ? path.join(file, 'index.html') : file) : null;
      return body && (await body.exists()) ? new Response(body) : new Response('not found', { status: 404 });
    },
  });

/**
 * Text boxes of the build at each time in `times`, seeking the page with the runtime. Opens and closes a browser
 * and a local server; throws ToolError when the page is not ready within 30 s.
 */
export async function measureText(buildDir: string, runtimeFile: string, times: number[]): Promise<TextSample[]> {
  const root = path.resolve(buildDir);
  const server = serveBuild(root);
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/index.html`);
    const size = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-composition-id="root"]');
      return { width: Number(el?.dataset.width), height: Number(el?.dataset.height) };
    });
    if (!(size.width > 0 && size.height > 0)) {
      throw new ToolError({
        cmd: ['measure', buildDir],
        code: null,
        stderr: `root composition has no data-width/data-height: ${buildDir}`,
      });
    }
    await page.setViewportSize(size);
    await page.addScriptTag({ path: runtimeFile });
    try {
      await page.waitForFunction(
        () => {
          const w = window as unknown as { __playerReady?: boolean; __renderReady?: boolean };
          return Boolean(w.__playerReady && w.__renderReady);
        },
        undefined,
        { timeout: READY_TIMEOUT_MS },
      );
    } catch (cause) {
      throw new ToolError(
        { cmd: ['measure', buildDir], code: null, stderr: `runtime not ready in 30 s: ${buildDir}`, timedOut: true },
        { cause },
      );
    }

    const samples: TextSample[] = [];
    for (const t of times) {
      await page.evaluate(async (time) => {
        const w = window as unknown as {
          __player: { seek(t: number): unknown };
          __hfWaitForSeekCompletion?: () => Promise<void>;
        };
        await w.__player.seek(time);
        await w.__hfWaitForSeekCompletion?.();
      }, t);
      const found = await page.evaluate(() => {
        // Only an element's own text nodes count, so a parent is not reported with its children's text.
        const ownText = (el: Element): string =>
          Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim();
        return Array.from(document.body.querySelectorAll<HTMLElement>('*'))
          .filter((el) => ownText(el) !== '' && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
          .map((el) => ({ el, text: ownText(el), rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0)
          .map(({ el, text, rect }) => ({
            text: text.slice(0, 60),
            box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            font_px:
              Math.round(parseFloat(getComputedStyle(el).fontSize) * (rect.height / el.offsetHeight || 1) * 10) / 10,
            caption: el.closest('[data-vm-caption]') !== null,
            scene_id:
              el
                .closest('[data-composition-id]:not([data-composition-id="root"])')
                ?.getAttribute('data-composition-id') ?? undefined,
          }));
      });
      for (const sample of found) samples.push({ t, ...sample });
    }
    return samples;
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
