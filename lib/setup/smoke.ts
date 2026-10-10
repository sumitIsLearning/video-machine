import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ctcOnnx } from '../adapters/align/ctc-onnx';
import { TimingSchema } from '../contracts/types';
import { HF_CMD } from '../core/config';
import { type Deps, defaultDeps } from '../core/deps';
import { VideoMachineError } from '../core/errors';
import { readJson } from '../core/json';

/** Seconds each smoke stage took. */
export type SmokeTimes = { render: number; tts: number; align: number };

const SMOKE_LINE = 'Smoke test.';
const TEN_MIN = 10 * 60_000;

const isNonEmptyFile = (p: string) => (statSync(p, { throwIfNoEntry: false })?.size ?? 0) > 0;

/** On Windows a child (Chrome) can still hold files for a moment; a cleanup failure must not hide the real result. */
const removeTemp = (dir: string, onWarn: (line: string) => void) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (typeof code !== 'string') throw e;
    onWarn(`[M0] could not remove ${dir}: ${code}`);
  }
};

/**
 * Prove the whole chain works on this machine: render a blank reel draft, speak one line, align it.
 * Needs the network (the blank example loads GSAP from a CDN). Uses and removes a temp folder; a folder that
 * cannot be removed is reported through `opts.onWarn` (default: ignored), not thrown.
 * Returns the seconds each stage took (0.1 s resolution).
 * Throws VideoMachineError whose message starts with `smoke <stage>` (the original error, a ToolError or
 * ContractError for example, is its `cause`).
 */
export const runSmoke = async (
  deps: Deps = defaultDeps(),
  {
    clock = () => performance.now() / 1000,
    onWarn = () => {},
  }: { clock?: () => number; onWarn?: (line: string) => void } = {},
): Promise<SmokeTimes> => {
  const env = deps.config.toolEnv;
  const tmp = mkdtempSync(path.join(tmpdir(), 'vm-smoke-'));
  const times = { render: 0, tts: 0, align: 0 };
  const stage = async (name: keyof SmokeTimes, fn: () => Promise<void>) => {
    const t0 = clock();
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof VideoMachineError) || e.message.startsWith(`smoke ${name}`)) throw e;
      throw new VideoMachineError(`smoke ${name}: ${e.message}`, { cause: e });
    }
    times[name] = Math.round((clock() - t0) * 10) / 10;
  };
  try {
    const mp4 = path.join(tmp, 'smoke.mp4');
    const wav = path.join(tmp, 'run', 'audio', 'vo.wav');
    await stage('render', async () => {
      await deps.sh(
        [...HF_CMD, 'init', 'smoke', '--example', 'blank', '--resolution', 'portrait', '--non-interactive'],
        {
          cwd: tmp,
          env,
        },
      );
      await deps.sh(
        [...HF_CMD, 'render', path.join(tmp, 'smoke'), '--quality', 'draft', '--no-browser-gpu', '-o', mp4],
        { env, timeoutMs: TEN_MIN },
      );
      if (!isNonEmptyFile(mp4)) throw new VideoMachineError('smoke render: no smoke.mp4 was written');
    });
    await stage('tts', async () => {
      mkdirSync(path.dirname(wav), { recursive: true });
      const r = await deps.sh([...HF_CMD, 'tts', SMOKE_LINE, '-o', wav, '-v', 'af_heart', '--json'], { env });
      const last = r.stdout.trim().split('\n').at(-1) ?? '';
      let ok: unknown;
      try {
        ok = (JSON.parse(last) as { ok?: unknown } | null)?.ok;
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
      if (ok !== true) throw new VideoMachineError(`smoke tts: unexpected output: ${last.slice(0, 200)}`);
      if (!isNonEmptyFile(wav)) throw new VideoMachineError('smoke tts: no vo.wav was written');
    });
    await stage('align', async () => {
      const out = await ctcOnnx(deps).align(wav, [{ id: 'smoke', text: SMOKE_LINE, delivery: 'voiceover' }]);
      const words = readJson(out, TimingSchema).lines.flatMap((l) => l.words).length;
      if (words !== 2) throw new VideoMachineError(`smoke align: expected 2 words, got ${words}`);
    });
    return times;
  } finally {
    removeTemp(tmp, onWarn);
  }
};
