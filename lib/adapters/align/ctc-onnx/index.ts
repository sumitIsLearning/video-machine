// Align adapter: CTC forced alignment (wav2vec2-base-960h, quantized ONNX) via align.py, run with uv.

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AlignAdapter, TimingSchema } from '../../../contracts/types';
import { type Deps, defaultDeps } from '../../../core/deps';
import { UnsupportedError, VideoMachineError } from '../../../core/errors';
import { readJson } from '../../../core/json';

/**
 * The CTC aligner. `align(audioPath, lines, spokenWords)` aligns `audioPath` (inside <run>/audio/) against `lines`,
 * writes <run>/data/timing.json and audio.json, and returns the timing.json path.
 * `spokenWords` maps a display word to what is said ("MCP." → ["EM", "SEE", "PEE"]).
 * Throws UnsupportedError without lines, VideoMachineError when the audio is missing, ToolError when align.py fails
 * and ContractError when it writes an invalid timing.json.
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
    const { pluginRoot, toolEnv } = deps.config;
    const alignPy = path.join(pluginRoot, 'lib', 'adapters', 'align', 'ctc-onnx', 'align.py');
    const runDir = path.resolve(path.dirname(audio), '..');
    const out = path.join(runDir, 'data', 'timing.json');
    rmSync(out, { force: true }); // a stale file must never be validated and returned
    const specDir = mkdtempSync(path.join(tmpdir(), 'vm-align-'));
    const spec = path.join(specDir, 'lines.json');
    // ponytail: throwaway, unschema'd input for align.py, so it skips writeJson on purpose.
    writeFileSync(spec, JSON.stringify({ lines: lines.map((l) => ({ text: l.text })), spoken_words: spokenWords }));
    try {
      await deps.sh(['uv', 'run', '--project', pluginRoot, 'python', alignPy, audio, spec, runDir], { env: toolEnv });
      readJson(out, TimingSchema); // validate on write
      return out;
    } finally {
      rmSync(specDir, { recursive: true, force: true }); // the spec holds the script text
    }
  },
});
export default ctcOnnx;
