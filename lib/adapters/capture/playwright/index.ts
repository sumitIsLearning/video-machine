import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type CaptureAdapter, type CaptureLog, CaptureLogSchema, type Steps } from '../../../contracts/types';
import { type Deps, defaultDeps } from '../../../core/deps';
import { CaptureError, ToolError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { isLinkLocalHost, isPrivateHost } from '../../../core/url';
import { type Box, isProfileInUse, type Launch, launchPlaywright, type ReplayPage } from './browser';

type Step = Steps[number];

const FRAME = { w: 1280, h: 800 };
const CROP_MARGIN_PX = 24;
const CLIP_PAD_S = 0.3; // the recording lags the script clock by about 0.45 s (probed), so clips get slack on both sides
const WAIT_MS = 1500;
const SCROLL_SETTLE_MS = 500;
const OUTPUT = ['shots', 'crops', 'text', 'clips', 'rec'] as const;
const MOVE_ATTEMPTS = 3;
const MOVE_DELAY_MS = 200;
const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']); // Windows keeps the file locked for a moment after the browser closes
// BLUEPRINT 2.6: a password is typed by the creator, never by automation. Matches the target's name; the browser also reports type=password.
const PASSWORD_TARGET = /pass(word|code|phrase)?|pwd|secret|otp|2fa/i;
const PASSWORD_REFUSAL = 'passwords are typed by hand: run capture login';

export type CaptureOptions = { launch?: Launch; clock?: () => number; onWarn?: (line: string) => void };

/**
 * The browser profile folder for a URL: `<vmHome>/profiles/<host>[_<port>]`, so a login done once serves every run and
 * two dev servers on one machine keep apart. Anything outside `[a-z0-9.-]` becomes `_`.
 * Returns the path; throws TypeError for a string that is not a URL.
 */
export const profileDirOf = (vmHome: string, url: string): string => {
  const u = new URL(url);
  const host = u.hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .replace(/^\.+$/, (dots) => '_'.repeat(dots.length)); // "." or ".." would climb out of profiles/
  return path.join(vmHome, 'profiles', u.port ? `${host}_${u.port}` : host);
};

/** The first line of an error's message, or `step failed` when there is none. */
const reasonOf = (cause: unknown): string =>
  String((cause as Error | undefined)?.message ?? cause).split('\n')[0] || 'step failed';

/** Whether a box can be cropped: it has an area and overlaps the frame. */
const isOnFrame = (b: Box): boolean =>
  b.w > 0 && b.h > 0 && b.x < FRAME.w && b.y < FRAME.h && b.x + b.w > 0 && b.y + b.h > 0;

/** The focus crop for a box: the box plus a margin, clamped to the frame, as an ffmpeg `crop=w:h:x:y`. */
const cropOf = (b: Box): string => {
  const x0 = Math.max(0, Math.round(b.x - CROP_MARGIN_PX));
  const y0 = Math.max(0, Math.round(b.y - CROP_MARGIN_PX));
  const x1 = Math.min(FRAME.w, Math.round(b.x + b.w + CROP_MARGIN_PX));
  const y1 = Math.min(FRAME.h, Math.round(b.y + b.h + CROP_MARGIN_PX));
  return `crop=${x1 - x0}:${y1 - y0}:${x0}:${y0}`;
};

/**
 * Why the replay may not visit a URL, or undefined when it may. Only http(s) pages are visited; link-local and
 * metadata addresses never; private, loopback and `*.localhost` hosts only when they are the product host itself.
 */
const refusalOf = (url: string, productHost: string): string | undefined => {
  if (!URL.canParse(url)) return 'refused page: not an http(s) address';
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) return `refused ${u.protocol}: not an http(s) page`;
  if (isLinkLocalHost(u.hostname)) return `refused ${u.host}: link-local and metadata addresses are never visited`;
  if (isPrivateHost(u.hostname) && u.host !== productHost) return `refused ${u.host}: not the product host`;
  return undefined;
};

type FileMover = { rename: (from: string, to: string) => void; sleep: (ms: number) => Promise<unknown> };

/**
 * Move a file: try a rename 3 times (200 ms apart) while the file is busy, then copy it and remove the original.
 * Throws the fs error for anything that is not a busy file.
 */
export async function moveFile(
  from: string,
  to: string,
  io: FileMover = { rename: renameSync, sleep: (ms) => Bun.sleep(ms) },
): Promise<void> {
  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt++) {
    try {
      io.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (code === 'EXDEV') break; // another drive: only a copy can move it
      if (!BUSY_CODES.has(code)) throw error;
      await io.sleep(MOVE_DELAY_MS);
    }
  }
  copyFileSync(from, to);
  rmSync(from, { force: true });
}

/**
 * The Playwright capture adapter: replays the steps in a persistent browser profile while recording the screen.
 * A failed step never stops the replay; it is logged with its reason (and the nav frame as fallback).
 * Passwords are never typed by automation: log in once by hand (`capture login`), the profile keeps the session.
 */
export const playwrightCapture = (deps: Deps = defaultDeps(), opts: CaptureOptions = {}): CaptureAdapter => {
  const launch = opts.launch ?? launchPlaywright;
  const clock = opts.clock ?? (() => performance.now() / 1000);
  const warn = opts.onWarn ?? (() => {});
  const ffmpeg = (args: string[]) => deps.sh(['ffmpeg', '-v', 'error', '-y', ...args], { env: deps.config.toolEnv });

  return {
    async replay(runDir, steps, profile) {
      const capture = path.join(runDir, 'capture');
      const shotOf = (name: string) => path.join(capture, 'shots', name);
      // Products under development run on localhost, so the first step's host may be private.
      const productHost = steps[0] ? new URL(steps[0].url).host : '';
      for (const d of OUTPUT) rmSync(path.join(capture, d), { recursive: true, force: true });
      rmSync(path.join(capture, 'log.json'), { force: true });
      rmSync(path.join(capture, 'replay.webm'), { force: true });
      for (const d of ['shots', 'crops', 'text', 'clips']) mkdirSync(path.join(capture, d), { recursive: true });

      let page: ReplayPage;
      try {
        page = await launch({ profileDir: profile, recordDir: path.join(capture, 'rec'), headless: true });
      } catch (cause) {
        const why = reasonOf(cause);
        throw new CaptureError(
          isProfileInUse(why)
            ? `the browser profile ${profile} is in use: close the capture login window or the other replay`
            : `could not open the browser with profile ${profile}: ${why}; run setup (capture_browser)`,
          { cause },
        );
      }

      // ponytail: the URL is checked after the browser got there; block the request with context.route if a
      // product page must never be fetched from a refused host.
      const guard = (url: string) => {
        const why = refusalOf(url, productHost);
        if (why) throw new Error(why);
      };

      /** Cut the focus crop for a step from a shot taken before the action. A crop never fails the replay. */
      const cropFocus = async (step: Step, box: Box) => {
        const before = shotOf(`${step.i}-before.png`);
        const crop = path.join(capture, 'crops', `${step.i}.png`);
        try {
          await page.screenshot(before);
          await ffmpeg(['-i', before, '-vf', cropOf(box), crop]);
        } catch (cause) {
          // ponytail: any failure here (page or ffmpeg) only costs the crop; the shot and clip are the deliverable.
          rmSync(crop, { force: true });
          warn(`[M3] step ${step.i}: no focus crop: ${reasonOf(cause)}`);
        }
      };

      /** Do one step. Returns the target's box (measured before the action) when it can be cropped. */
      const doStep = async (step: Step): Promise<Box | undefined> => {
        guard(step.url);
        if (step.url !== page.url()) {
          await page.goto(step.url);
          guard(page.url()); // a redirect may have led elsewhere
        }
        let box: Box | undefined;
        const isType = step.action === 'type';
        if (isType && PASSWORD_TARGET.test(step.target)) throw new Error(PASSWORD_REFUSAL);
        if (step.action === 'click' || isType) {
          const measured = await page.box(step.target, isType);
          if (!measured)
            throw new Error(`${step.action}: Timeout 5000ms exceeded: no visible element named "${step.target}"`);
          if (isType && (await page.isPassword(step.target))) throw new Error(PASSWORD_REFUSAL);
          if (isOnFrame(measured)) {
            box = measured;
            await cropFocus(step, measured);
          } else {
            warn(`[M3] step ${step.i}: target is off the frame, no focus crop`);
          }
        }
        if (step.action === 'click') await page.click(step.target);
        else if (isType) await page.type(step.target, step.value ?? '');
        else if (step.action === 'scroll') await page.scroll();
        await page.wait(step.action === 'scroll' ? SCROLL_SETTLE_MS : step.action === 'wait' ? WAIT_MS : 0);
        guard(page.url()); // before anything of the page is kept
        await page.screenshot(shotOf(`${step.i}.png`));
        writeFileSync(path.join(capture, 'text', `${step.i}.txt`), await page.text());
        return box;
      };

      const start = clock();
      const log: CaptureLog = [];
      const runSteps = async () => {
        for (const step of steps) {
          const t0 = clock() - start;
          let box: Box | undefined;
          let failed: string | undefined;
          try {
            box = await doStep(step);
          } catch (cause) {
            // A missing target is data for the log, not a reason to stop. The warning names the target, never the value.
            failed = reasonOf(cause);
            warn(
              `[M3] step ${step.i} ${step.action} "${step.target}": ${failed}${step.frame ? ', using nav frame' : ''}`,
            );
          }
          log.push({
            i: step.i,
            t0,
            t1: clock() - start,
            ...(box && { box }),
            url: page.url(),
            ...(failed !== undefined && { failed, ...(step.frame && { fallback: step.frame }) }),
          });
        }
      };
      const finish = async () => {
        const recording = await page.close();
        await moveFile(recording, path.join(capture, 'replay.webm'));
        rmSync(path.join(capture, 'rec'), { recursive: true, force: true });
      };
      try {
        await runSteps();
      } catch (error) {
        // The loop's error is the one to report; a failure to close is only a warning beside it.
        await finish().catch((closeError) => warn(`[M3] could not close the browser cleanly: ${reasonOf(closeError)}`));
        throw error;
      }
      await finish();

      // The log is the contract; write it before the clips so a clip failure cannot lose it.
      const file = path.join(capture, 'log.json');
      writeJson(file, CaptureLogSchema, log);
      for (const e of log) {
        if (e.failed !== undefined) continue;
        try {
          await ffmpeg([
            '-ss',
            String(Math.max(0, e.t0 - CLIP_PAD_S)),
            '-to',
            String(e.t1 + CLIP_PAD_S),
            '-i',
            path.join(capture, 'replay.webm'),
            '-r',
            '30',
            '-c:v',
            'libx264',
            '-g',
            '1',
            '-pix_fmt',
            'yuv420p',
            '-an',
            path.join(capture, 'clips', `${e.i}.mp4`),
          ]);
        } catch (cause) {
          if (!(cause instanceof ToolError)) throw cause;
          warn(`[M3] step ${e.i}: no clip: ${reasonOf(cause)}`);
        }
      }
      return file;
    },
  };
};

export default playwrightCapture;
