import path from 'node:path';
import { type Doctor, DoctorSchema, failingTools } from '../contracts/types';
import { runCli } from '../core/cli';
import { type Deps, defaultDeps } from '../core/deps';
import { ContractError, InputError } from '../core/errors';
import { readJson, writeJson } from '../core/json';
import { runDoctor } from './doctor';
import { INSTALL_STEPS, type InstallStep, install } from './install';
import { runSmoke } from './smoke';

const USAGE = `usage: cli.ts doctor | install | smoke (install takes optional steps: ${INSTALL_STEPS.join(', ')})`;

/**
 * The saved doctor.json, or undefined when there is none (ENOENT) or it cannot be read: invalid content or any
 * fs error with a code (EISDIR, EACCES). An unreadable file is reported on stderr and the caller rewrites it,
 * the same policy as `status`.
 */
const readSaved = (file: string): Doctor | undefined => {
  try {
    return readJson(file, DoctorSchema);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    if (!(e instanceof ContractError) && typeof code !== 'string') throw e;
    process.stderr.write('[M0] doctor.json was unreadable; rewritten\n');
    return undefined;
  }
};

/** Run the doctor and save the result, keeping the earlier smoke timings. Returns the Doctor that was written. */
const runAndSaveDoctor = async (deps: Deps, file: string, saved: Doctor | undefined): Promise<Doctor> => {
  const d = await runDoctor(deps);
  return writeJson(file, DoctorSchema, { ...d, smoke_s: saved?.smoke_s ?? {} });
};

/**
 * Run one setup command: `doctor`, `install [step...]` or `smoke`.
 * Returns the fields of the CLI's JSON result. Throws InputError for an unknown command or install step.
 */
export const main = async (argv: string[], deps: Deps = defaultDeps()): Promise<Record<string, unknown>> => {
  const file = path.join(deps.config.vmHome, 'doctor.json');
  const [command, ...rest] = argv;
  if (command === 'doctor') {
    const d = await runAndSaveDoctor(deps, file, readSaved(file));
    const failing = failingTools(d);
    // So the setup skill never has to read the file (its path arrives JSON-escaped).
    const details = Object.fromEntries(failing.map((t) => [t, d.tools[t]?.detail ?? 'missing from doctor.json']));
    return { ok: failing.length === 0, failing, details, doctor: file };
  }
  if (command === 'install') {
    const unknown = rest.find((s) => !(INSTALL_STEPS as readonly string[]).includes(s));
    if (unknown) throw new InputError(`unknown install step "${unknown}"; steps: ${INSTALL_STEPS.join(', ')}`);
    const steps = await install(deps, rest.length ? (rest as InstallStep[]) : INSTALL_STEPS);
    return { ok: steps.every((s) => s.ok), steps };
  }
  if (command === 'smoke') {
    const before = readSaved(file) ?? (await runAndSaveDoctor(deps, file, undefined));
    const smoke_s = await runSmoke(deps, { onWarn: (line) => process.stderr.write(`${line}\n`) });
    // The smoke takes ~25 s; a doctor run in that time must not be overwritten with the tools read before it.
    writeJson(file, DoctorSchema, { ...(readSaved(file) ?? before), smoke_s });
    return { smoke_s };
  }
  throw new InputError(USAGE);
};

if (import.meta.main) process.exitCode = await runCli(() => main(process.argv.slice(2)));
