// Background removal for one avatar clip: `hyperframes remove-background` writes a transparent webm.

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HF_CMD } from '../../../core/config';
import type { Deps } from '../../../core/deps';
import { ToolError } from '../../../core/errors';
import type { ShResult } from '../../../core/sh';

// The reply is the last stdout line that starts with `{`: `{"ok":true,...}` or `{"ok":false,"error":"..."}`.
const RemoveBackgroundReplySchema = z.looseObject({ ok: z.boolean().optional(), error: z.string().optional() });
type RemoveBackgroundReply = z.infer<typeof RemoveBackgroundReplySchema>;

/** The reply on the last `{` stdout line, or undefined when there is none (install lines come before it). */
const replyOf = (stdout: string): RemoveBackgroundReply | undefined => {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .at(-1);
  if (line === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined; // ponytail: a line that only looks like JSON counts as no reply; the caller reports it with stderr
  }
  const reply = RemoveBackgroundReplySchema.safeParse(json);
  return reply.success ? reply.data : undefined;
};

/**
 * Remove the background of `input` into the transparent webm `output` (CPU ≈ 0.6 s per frame, hence the long timeout).
 * Returns `output`. Throws ToolError naming the clip when the tool fails or writes no file; no partial output is left.
 */
export async function removeBackground(deps: Deps, input: string, output: string): Promise<string> {
  const cmd = [
    ...HF_CMD,
    'remove-background',
    input,
    '-o',
    output,
    '--device',
    'auto',
    '--quality',
    'balanced',
    '--json',
  ];
  // A stale file from an earlier run must not pass the existence check for a run that wrote nothing.
  rmSync(output, { force: true });
  let run: ShResult;
  try {
    run = await deps.sh(cmd, { env: deps.config.toolEnv, allowFail: true, timeoutMs: 1_800_000 });
  } catch (e) {
    // The runner throws on timeout or spawn failure; a half-written webm must not outlive it.
    rmSync(output, { force: true });
    throw e;
  }
  const { code, stdout, stderr } = run;
  const reply = replyOf(stdout);
  if (code !== 0 || reply?.ok !== true || !existsSync(output)) {
    rmSync(output, { force: true });
    throw new ToolError({
      cmd,
      code,
      stderr: `remove-background failed for ${path.basename(input)}: ${reply?.error ?? stderr}`,
    });
  }
  return output;
}
