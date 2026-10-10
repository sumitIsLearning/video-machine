// Align adapter: CTC forced alignment (wav2vec2-base-960h, quantized ONNX) via align.py, run with uv.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AlignAdapter, type Script, TimingSchema } from '../../../contracts/types';
import { readJson } from '../../../core/json';

const WORKSPACE = path.resolve(import.meta.dir, '../../../..');

/**
 * Align `audioPath` (inside <run>/audio/) against `lines`; writes <run>/data/timing.json and audio.json.
 * `spokenWords` maps a display word to what is said ("MCP." → ["EM", "SEE", "PEE"]).
 */
export function align(audioPath: string, lines?: Script['lines'], spokenWords: Record<string, string[]> = {}) {
  if (!lines?.length)
    throw new Error('ctc-onnx.align: needs the script lines (it aligns text to audio, it does not transcribe)');
  const runDir = path.resolve(path.dirname(audioPath), '..');
  const spec = path.join(mkdtempSync(path.join(tmpdir(), 'vm-align-')), 'lines.json');
  writeFileSync(spec, JSON.stringify({ lines: lines.map((l) => ({ text: l.text })), spoken_words: spokenWords }));
  const p = Bun.spawnSync(
    [
      'uv',
      'run',
      '--project',
      WORKSPACE,
      'python',
      path.join(import.meta.dir, 'align.py'),
      path.resolve(audioPath),
      spec,
      runDir,
    ],
    { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PYTHONUTF8: '1' } },
  ); // UTF-8 pipes on Windows (script prints →)
  if (p.exitCode !== 0) throw new Error(`ctc-onnx.align failed:\n${p.stderr.toString()}`);
  const out = path.join(runDir, 'data', 'timing.json');
  readJson(out, TimingSchema); // validate on write
  return out;
}

export const ctcOnnx: AlignAdapter = { align };
export default ctcOnnx;
