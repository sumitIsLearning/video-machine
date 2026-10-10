import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ContractError } from './errors';

/**
 * Read a JSON file and parse it against its schema.
 * Returns the parsed data (defaults applied). Throws ContractError naming the file when the JSON is malformed
 * or does not match the schema; a missing file throws the fs error, which already names the path.
 */
export function readJson<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  let raw: unknown;
  try {
    // Windows tools (Notepad, PowerShell) write a BOM that JSON.parse rejects.
    raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\u{FEFF}/u, ''));
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new ContractError(`${file} is not valid JSON: ${cause.message}`, { cause });
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ContractError(`${file} does not match its schema:\n${z.prettifyError(r.error)}`);
  return r.data;
}

/**
 * Validate, then write (1-space indent, LF, trailing newline), creating folders.
 * Returns the validated data. Throws ContractError when the data is invalid; nothing is written then.
 */
export function writeJson<T extends z.ZodType>(file: string, schema: T, data: z.input<T>): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ContractError(`refusing to write ${file}:\n${z.prettifyError(r.error)}`);
  mkdirSync(path.dirname(file), { recursive: true });
  // Write beside the target, then rename: a crash never leaves a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(r.data, null, 1)}\n`);
  try {
    renameSync(tmp, file);
  } catch (cause) {
    rmSync(tmp, { force: true });
    throw cause;
  }
  return r.data;
}
