// The voice CLI: synth (M9) voices or imports audio/vo.wav after the cost gate; align (M10) writes data/timing.json and reports the fit.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ctcOnnx } from '../adapters/align/ctc-onnx';
import { hfTts } from '../adapters/voice/hf-tts';
import { importSupplied } from '../adapters/voice/supplied';
import {
  type AlignAdapter,
  BriefSchema,
  DEFAULT_VOICE,
  ScriptSchema,
  TimingSchema,
  type VoiceAdapter,
} from '../contracts/types';
import { runCli } from '../core/cli';
import { approvedOf, costGate } from '../core/cost';
import { type Deps, defaultDeps } from '../core/deps';
import { InputError, UnsupportedError } from '../core/errors';
import { readJson } from '../core/json';
import { lineConf } from '../core/timing';
import { spokenWordsOf } from './spoken';

const USAGE = 'usage: cli.ts synth <run_dir> [--approve-spend usd] | align <run_dir>';
// ponytail: a fixed slack for the duration check; a per-format tolerance waits for a real case.
const EPSILON_S = 1e-6;

type Io = { deps?: Deps; voice?: VoiceAdapter; align?: AlignAdapter };

/** Voice every line (or import the supplied voice) into audio/vo.wav after the spend check. */
const synth = async (runDir: string, rest: string[], io: Io): Promise<Record<string, unknown>> => {
  const approved = approvedOf(rest, USAGE);
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
  if (brief.timing_source !== 'voiceover')
    throw new InputError(`this run has no voiceover (timing_source: ${brief.timing_source})`);
  const voice = brief.voice ?? DEFAULT_VOICE;
  if (voice.source === 'supplied') {
    await importSupplied(io.deps ?? defaultDeps(), runDir, voice.path);
    return { vo: 'audio/vo.wav', source: 'supplied' };
  }
  const adapter = io.voice ?? (voice.adapter === 'hf-tts' ? hfTts(io.deps ?? defaultDeps()) : undefined);
  if (adapter === undefined)
    throw new UnsupportedError(`voice adapter "${voice.adapter}" is not available; use hf-tts`);
  const { total_usd, ok } = costGate(
    [{ what: `voice (${voice.adapter})`, usd: adapter.costEstimate(script.lines) }],
    brief.budget_usd,
    approved,
  );
  if (!ok)
    throw new InputError(
      `the voice costs $${total_usd.toFixed(2)} and the budget is $${brief.budget_usd.toFixed(2)}; ask the creator, then re-run with --approve-spend ${total_usd}`,
    );
  await adapter.synth(runDir, script.lines, voice.voice_id);
  return { vo: 'audio/vo.wav', source: 'tts', voice: voice.voice_id, lines: script.lines.length, usd: total_usd };
};

/** The mean of the words' conf rounded to 2 places, or null when no word has a conf. */
const meanConf = (words: { conf?: number | undefined }[]): number | null => {
  const mean = lineConf(words);
  return mean === undefined ? null : Math.round(mean * 100) / 100;
};

/** Align the voiceover to the script lines and report per-line times against duration_target_s. */
const align = async (runDir: string, io: Io): Promise<Record<string, unknown>> => {
  const vo = path.join(runDir, 'audio', 'vo.wav');
  if (!existsSync(vo)) throw new InputError('no audio/vo.wav yet; run synth first');
  const brief = readJson(path.join(runDir, 'brief.json'), BriefSchema);
  const script = readJson(path.join(runDir, 'script.json'), ScriptSchema);
  const aligner = io.align ?? ctcOnnx(io.deps ?? defaultDeps());
  const timing = readJson(await aligner.align(vo, script.lines, spokenWordsOf(script.lines)), TimingSchema);
  const [min, max] = brief.duration_target_s;
  const total_s = timing.lines.at(-1)?.end ?? 0;
  return {
    timing: 'data/timing.json',
    lines: timing.lines.map((l) => ({ id: l.id, start: l.start, end: l.end, conf: meanConf(l.words) })),
    total_s,
    target_s: brief.duration_target_s,
    fits: total_s >= min - EPSILON_S && total_s <= max + EPSILON_S,
  };
};

/**
 * Run a voice command: synth or align. Returns the fields of the CLI's JSON result. Throws InputError for a usage
 * mistake, a run without a voiceover, an over-budget voice or a missing vo.wav; UnsupportedError for a voice adapter
 * that is not available; the library functions throw their own errors.
 */
export const main = async (argv: string[], io: Io = {}): Promise<Record<string, unknown>> => {
  const [command, runDir, ...rest] = argv;
  if (runDir === undefined) throw new InputError(USAGE);
  switch (command) {
    case 'synth':
      return synth(runDir, rest, io);
    case 'align':
      if (rest.length !== 0) throw new InputError(USAGE);
      return align(runDir, io);
    default:
      throw new InputError(USAGE);
  }
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
