// Align adapter: CTC forced alignment (wav2vec2-base-960h, quantized ONNX) via align.py, run with uv.

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AlignAdapter, TimingSchema } from '../../../contracts/types';
import { type Deps, defaultDeps } from '../../../core/deps';
import { UnsupportedError, VideoMachineError } from '../../../core/errors';
import { readJson } from '../../../core/json';
import { lineConf } from '../../../core/timing';

/** A downloadable model: where it comes from, how to verify it, where it lives. */
export type ModelSpec = { url: string; sha256: string; bytes: number; path: string };

/**
 * The aligner model (wav2vec2-base-960h, quantized ONNX, Apache-2.0 upstream), pinned to one Hugging Face commit.
 * Setup fetches it into <vmHome>/models (never the plugin root, which plugin updates replace). Returns its spec.
 */
export const alignerModel = (vmHome: string): ModelSpec => ({
  url: 'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/a19f851b3d42865797e410752b4c570c871e4825/onnx/model_quantized.onnx',
  sha256: 'cd5040c147381580ed73258143dd8e0c28e800a09e74ee42ee2b3e8cb4d760a3',
  bytes: 95_286_046,
  path: path.join(vmHome, 'models', 'w2v2_base_960h_q.onnx'),
});

/**
 * A line whose mean word conf (mean token probability) is below this fails the align: the voice does not say the text.
 * ponytail: one fixed threshold; per-scene or per-voice tuning waits for a real case.
 */
export const MIN_LINE_CONF = 0.6;

/**
 * The CTC aligner. `align(audioPath, lines, spokenWords)` aligns `audioPath` (inside <run>/audio/) against `lines`,
 * writes <run>/data/timing.json and audio.json, and returns the timing.json path.
 * `spokenWords` maps a display word to what is said ("MCP." → ["EM", "SEE", "PEE"]).
 * Removes both outputs before running, and again if the run or the validation fails.
 * Throws UnsupportedError without lines, VideoMachineError when the audio is missing, not a file, empty or outside
 * <run>/audio/, VideoMachineError when the aligner model is missing (setup fetches it), VideoMachineError when a line's
 * mean word conf is below MIN_LINE_CONF (the message names each such line by id), ToolError when align.py fails and
 * ContractError when it writes an invalid timing.json.
 */
export const ctcOnnx = (deps: Deps = defaultDeps()): AlignAdapter => ({
  async align(audioPath, lines, spokenWords = {}) {
    if (lines.every((l) => l.text.trim() === ''))
      throw new UnsupportedError(
        'ctc-onnx.align needs the script lines: it aligns text to audio, it does not transcribe',
      );
    const audio = path.resolve(audioPath);
    const stat = statSync(audio, { throwIfNoEntry: false });
    if (!stat) throw new VideoMachineError(`ctc-onnx.align: audio not found: ${audioPath}`);
    if (!stat.isFile()) throw new VideoMachineError(`ctc-onnx.align: not a file: ${audioPath}`);
    if (stat.size === 0) throw new VideoMachineError(`ctc-onnx.align: audio is empty: ${audioPath}`);
    // align.py writes data/ next to audio/, so a stray audio path must not write into the run's parent.
    if (path.basename(path.dirname(audio)) !== 'audio')
      throw new VideoMachineError(`ctc-onnx.align: audio must be inside the run's audio/ folder: ${audioPath}`);
    const { pluginRoot, vmHome, toolEnv } = deps.config;
    const model = alignerModel(vmHome).path;
    if (!statSync(model, { throwIfNoEntry: false })?.isFile())
      throw new VideoMachineError(`ctc-onnx.align: aligner model not found at ${model}; run the setup skill`);
    const alignPy = path.join(pluginRoot, 'lib', 'adapters', 'align', 'ctc-onnx', 'align.py');
    const runDir = path.resolve(path.dirname(audio), '..');
    const out = path.join(runDir, 'data', 'timing.json');
    const outputs = [out, path.join(runDir, 'data', 'audio.json')];
    const removeOutputs = () => {
      for (const f of outputs) rmSync(f, { force: true });
    };
    removeOutputs(); // a stale file must never be validated and returned
    const specDir = mkdtempSync(path.join(tmpdir(), 'vm-align-'));
    const spec = path.join(specDir, 'lines.json');
    // ponytail: throwaway, unschema'd input for align.py, so it skips writeJson on purpose.
    writeFileSync(
      spec,
      JSON.stringify({ lines: lines.map((l) => ({ id: l.id, text: l.text })), spoken_words: spokenWords }),
    );
    try {
      await deps.sh(
        ['uv', 'run', '--frozen', '--no-dev', '--project', pluginRoot, 'python', alignPy, audio, spec, runDir, model],
        { env: toolEnv },
      );
      const timing = readJson(out, TimingSchema); // validate on write
      const bad: string[] = [];
      timing.lines.forEach((line, i) => {
        const mean = lineConf(line.words);
        if (mean !== undefined && mean < MIN_LINE_CONF) bad.push(`${line.id ?? i + 1} (${mean.toFixed(2)})`);
      });
      if (bad.length > 0)
        throw new VideoMachineError(
          `ctc-onnx.align: the audio does not match line(s) ${bad.join(', ')}; check their spoken text or re-voice them`,
        );
      return out;
    } catch (e) {
      removeOutputs(); // a half-finished run must never look done
      throw e;
    } finally {
      rmSync(specDir, { recursive: true, force: true }); // the spec holds the script text
    }
  },
});
export default ctcOnnx;
