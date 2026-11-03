// Phase 2 acceptance test (real tools; takes several minutes: the model download, the venv, a Chrome render, Phase 0).
//   node_modules/.bin/bun tests/phase2.ts
// 1. unit tests pass                  2. lint is clean              3. the plugin loads new, setup, status
// 4. snapshot of the plugin root      5. setup install (fresh VM_HOME)  6. setup doctor   7. setup smoke
// 8. Phase 0 passes on the fresh VM_HOME   9. intake end to end   10. bad inputs fail cleanly
// 11. nothing was written under the plugin root
// Everything runs against a fresh VM_HOME and a fresh creator workspace, both removed at the end.
// Limits of "fresh": check 5 is fresh only for the venv and the aligner model; Chrome and Parakeet live in the shared
// ~/.cache and may already be there. Check 2's lint gets the plain process env, so ruff uses the repo .venv, not a VM_HOME venv.
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DOCTOR_TOOLS, DoctorSchema } from '../lib/contracts/types';
import { type Env, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { readJson } from '../lib/core/json';
import { sh } from '../lib/core/sh';
import { INSTALL_STEPS } from '../lib/setup/install';

const WS = PLUGIN_ROOT;
// Set inside the try below, so the cleanup covers whichever folders exist.
let VM_HOME = '';
let CREATOR_WS = '';
let ENV: Env = {};
let bun = '';
const temps: string[] = [];
const makeTemp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
const removeTemps = () => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      // Chrome can hold files for a moment on Windows; the results below still count.
      console.error(`[M0] could not remove ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
    }
  }
};
process.on('SIGINT', () => {
  removeTemps();
  process.exit(130);
});
const MIN = 60_000;
const MP3 = path.join(WS, 'tests', 'fixture', 'audio', 'voiceover.mp3');
const lastLine = (s: string) => s.trim().split(/\r?\n/).at(-1) ?? '';

const results: { test: string; ok: boolean; detail: string }[] = [];
const check = async (test: string, fn: () => Promise<string>) => {
  const t0 = performance.now();
  let result: { test: string; ok: boolean; detail: string };
  try {
    result = { test, ok: true, detail: await fn() };
  } catch (e) {
    result = { test, ok: false, detail: String((e as Error).message ?? e) };
  }
  results.push(result);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${test}  (${secs}s)\n      ${result.detail.replace(/\n/g, '\n      ')}`);
};

type Json = Record<string, unknown>;
type Called = { code: number; out: Json };

/** Run `lib/<cli>/cli.ts` and parse its JSON line. A non-zero exit is returned, not thrown. */
const call = async (
  cli: 'setup' | 'run',
  args: string[],
  o: { cwd?: string; stdin?: string; timeoutMs?: number } = {},
): Promise<Called> => {
  const r = await sh([bun, path.join(WS, 'lib', cli, 'cli.ts'), ...args], {
    cwd: o.cwd ?? WS,
    env: ENV,
    stdin: o.stdin,
    allowFail: true,
    timeoutMs: o.timeoutMs ?? 5 * MIN,
  });
  try {
    return { code: r.code, out: JSON.parse(lastLine(r.stdout)) as Json };
  } catch (cause) {
    throw new Error(`${cli} ${args[0]}: output is not JSON\nstdout: ${r.stdout}\nstderr: ${r.stderr}`, { cause });
  }
};

/** Like `call`, but the CLI must exit 0 with `"ok":true`. */
const callOk = async (...a: Parameters<typeof call>): Promise<Json> => {
  const { code, out } = await call(...a);
  if (code !== 0 || out.ok !== true)
    throw new Error(`${a[0]} ${a[1][0]} failed (exit ${code}): ${JSON.stringify(out)}`);
  return out;
};

/** Throw unless the CLI exited 1 with `"ok":false`, the given error class and a message containing `mention`. */
const expectError = async (error: string, mention: string, ...a: Parameters<typeof call>) => {
  const { code, out } = await call(...a);
  if (code !== 1 || out.ok !== false || out.error !== error || !String(out.message).includes(mention))
    throw new Error(
      `${a[0]} ${a[1][0]}: expected exit 1 with ${error} mentioning "${mention}", got exit ${code}: ${JSON.stringify(out)}`,
    );
};

// Not `git status --ignored`: it collapses an ignored or untracked folder (.venv, node_modules) into one line, so a
// write inside it would go unseen. Skipped: .git, .claude (the orchestrator's session writes there), tests/out
// (Phase 0 writes there by design) and runs (dev spike folders).
const SKIPPED = ['.git', '.claude', 'tests/out', 'runs'];
type Files = Map<string, string>;
const snapshotRoot = (): Files => {
  const files: Files = new Map();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(WS, full).replaceAll('\\', '/');
      if (SKIPPED.includes(rel)) continue;
      if (e.isDirectory()) walk(full);
      else {
        const s = lstatSync(full);
        files.set(rel, `${s.size} bytes, mtime ${s.mtimeMs}`);
      }
    }
  };
  walk(WS);
  return files;
};

let snapshot: Files | undefined;
const runIds: string[] = [];
const runDirs: string[] = [];

try {
  VM_HOME = makeTemp('vm-home-');
  CREATOR_WS = makeTemp('vm-ws-');
  ENV = { ...process.env, VM_HOME };
  bun = loadConfig(ENV).bun;

  await check('1. unit tests pass', async () => {
    const r = await sh([bun, 'test'], { cwd: WS, timeoutMs: 5 * MIN });
    const summary = r.stderr || r.stdout; // bun test writes its summary to stderr
    const pass = Number(/^\s*(\d+) pass\b/m.exec(summary)?.[1] ?? 0);
    const fail = Number(/^\s*(\d+) fail\b/m.exec(summary)?.[1] ?? 0);
    if (pass === 0 || fail > 0) throw new Error(`${pass} pass, ${fail} fail\n${lastLine(summary)}`);
    return `${pass} pass, 0 fail`;
  });

  await check('2. lint is clean', async () => {
    await sh([bun, 'run', 'lint'], { cwd: WS, env: { ...process.env }, timeoutMs: 5 * MIN });
    return 'tsc, Biome and ruff report nothing';
  });

  await check('3. the plugin loads new, setup and status', async () => {
    const r = await sh(['claude', '--plugin-dir', '.', 'plugin', 'details', 'vm'], {
      cwd: WS,
      timeoutMs: MIN,
    });
    const m = /^\s*Skills \((\d+)\)[ \t]+(.*)$/m.exec(r.stdout);
    const skills = m?.[2]?.trim().split(/,\s*/) ?? [];
    const missing = ['new', 'setup', 'status'].filter((s) => !skills.includes(s));
    if (missing.length || Number(m?.[1]) !== skills.length) throw new Error(`missing ${missing}\n${r.stdout}`);

    const v = await sh(['claude', 'plugin', 'validate', '.claude-plugin/plugin.json', '--strict', '--json'], {
      cwd: WS,
      allowFail: true,
      timeoutMs: MIN,
    });
    let report: { success: boolean; manifest?: { errors?: unknown[]; warnings?: unknown[] } };
    try {
      report = JSON.parse(v.stdout);
    } catch (cause) {
      throw new Error(`plugin.json: validate output is not JSON\nstdout: ${v.stdout}\nstderr: ${v.stderr}`, { cause });
    }
    const { errors, warnings } = report.manifest ?? {};
    if (v.code !== 0 || !report.success || errors?.length || warnings?.length)
      throw new Error(`plugin.json: errors ${JSON.stringify(errors)}, warnings ${JSON.stringify(warnings)}`);
    return `skills: ${skills.join(', ')}\nplugin.json: no errors, no warnings`;
  });

  await check('4. snapshot of every file under the plugin root', async () => {
    snapshot = snapshotRoot();
    return `${snapshot.size} files (path, size, mtime; skipping ${SKIPPED.join(', ')})`;
  });

  await check('5. setup install on a fresh VM_HOME', async () => {
    // `call`, not `callOk`: a failed step must print its own line.
    const { out } = await call('setup', ['install'], { timeoutMs: 40 * MIN });
    const steps = out.steps as { step: string; ok: boolean; detail: string }[] | undefined;
    if (!steps) throw new Error(`no steps in the result: ${JSON.stringify(out)}`);
    const lines = steps.map((s) => `${s.ok ? 'ok  ' : 'FAIL'} ${s.step}: ${s.detail}`);
    if (steps.length !== INSTALL_STEPS.length || !steps.every((s) => s.ok)) throw new Error(lines.join('\n'));
    return lines.join('\n');
  });

  await check('6. setup doctor', async () => {
    // callOk already requires ok: true, i.e. no failing tool.
    await callOk('setup', ['doctor']);
    const d = readJson(path.join(VM_HOME, 'doctor.json'), DoctorSchema);
    const missing = DOCTOR_TOOLS.filter((t) => d.tools[t] === undefined);
    if (missing.length) throw new Error(`missing from doctor.json: ${missing}`);
    return `doctor.json lists ${DOCTOR_TOOLS.length} tools, none failing`;
  });

  await check('7. setup smoke', async () => {
    const { smoke_s } = (await callOk('setup', ['smoke'], { timeoutMs: 15 * MIN })) as {
      smoke_s: Record<string, number>;
    };
    const bad = ['render', 'tts', 'align'].filter((k) => !((smoke_s[k] ?? 0) > 0));
    const detail = JSON.stringify(smoke_s);
    if (bad.length) throw new Error(`not > 0: ${bad}\n${detail}`);
    return detail;
  });

  await check('8. Phase 0 passes on the fresh VM_HOME', async () => {
    const r = await sh([bun, 'tests/phase0.ts'], { cwd: WS, env: ENV, timeoutMs: 30 * MIN, allowFail: true });
    const last = lastLine(r.stdout);
    if (r.code !== 0 || last !== '2/2 passed') throw new Error(`exit ${r.code}\n${r.stdout}\n${r.stderr}`);
    return last;
  });

  await check('9. intake end to end', async () => {
    const concept = '\u{FEFF}Why async standups beat meetings\r\nFull script 🎬\r\n';
    const a = await callOk('run', ['new', '--concept', '-'], { cwd: CREATOR_WS, stdin: concept });
    const runA = String(a.run_dir);
    runIds.push(String(a.run_id));
    runDirs.push(runA);
    if (!readFileSync(path.join(runA, 'concept.md')).equals(Buffer.from(concept, 'utf8')))
      throw new Error('concept.md differs from the bytes sent on stdin');

    const imp = await callOk('run', ['import', runA, MP3], { cwd: CREATOR_WS });
    if (JSON.stringify(imp.paths) !== '["input/voiceover.mp3"]') throw new Error(`paths: ${JSON.stringify(imp.paths)}`);
    if (!readFileSync(path.join(runA, 'input', 'voiceover.mp3')).equals(readFileSync(MP3)))
      throw new Error('the imported mp3 differs from the original');

    await callOk('run', ['brief', runA], {
      cwd: CREATOR_WS,
      stdin: JSON.stringify({ sources: [{ kind: 'file', path_or_url: 'input/voiceover.mp3' }] }),
    });
    const whereA = await callOk('run', ['where', runA], { cwd: CREATOR_WS });
    const skippedA = whereA.skipped as string[];
    if (whereA.next !== 'M5' || !skippedA.includes('M2') || !skippedA.includes('M3'))
      throw new Error(`file source: ${JSON.stringify(whereA)}`);

    const b = await callOk('run', ['new', '--concept', '-'], { cwd: CREATOR_WS, stdin: 'Tour of the export screen\n' });
    const runB = String(b.run_dir);
    runIds.push(String(b.run_id));
    runDirs.push(runB);
    await callOk('run', ['import', runB, MP3], { cwd: CREATOR_WS });
    await callOk('run', ['brief', runB], {
      cwd: CREATOR_WS,
      stdin: JSON.stringify({ sources: [{ kind: 'nav_video', path_or_url: 'input/voiceover.mp3' }] }),
    });
    const whereB = await callOk('run', ['where', runB], { cwd: CREATOR_WS });
    if ((whereB.skipped as string[]).includes('M2')) throw new Error(`nav_video source: ${JSON.stringify(whereB)}`);
    return `file source: next ${whereA.next}, skipped ${skippedA}\nnav_video source: next ${whereB.next}, skipped ${whereB.skipped}`;
  });

  await check('10. bad inputs fail cleanly', async () => {
    const [runA] = runDirs;
    if (runA === undefined) throw new Error('check 9 made no run');
    // A separate runs folder keeps `status` below to the two runs of check 9.
    const scratch = path.join(CREATOR_WS, 'scratch-runs');
    const c = await callOk('run', ['new', '--concept', '-', '--runs', scratch], {
      cwd: CREATOR_WS,
      stdin: 'Bad path test\n',
    });
    await expectError('ContractError', 'path_or_url', 'run', ['brief', String(c.run_dir)], {
      cwd: CREATOR_WS,
      stdin: JSON.stringify({ sources: [{ kind: 'file', path_or_url: '../outside.mp4' }] }),
    });
    if (await Bun.file(path.join(String(c.run_dir), 'brief.json')).exists())
      throw new Error('a brief.json was written for the bad brief');
    await expectError('InputError', 'missing.mp3', 'run', ['import', runA, path.join(CREATOR_WS, 'missing.mp3')], {
      cwd: CREATOR_WS,
    });

    const status = await callOk('run', ['status'], { cwd: CREATOR_WS });
    const runs = status.runs as { run_id: string; next?: string }[];
    const notReady = runIds.filter((id) => runs.find((r) => r.run_id === id)?.next !== 'M5');
    const doctor = status.doctor as { ok?: boolean } | null;
    if (notReady.length || doctor?.ok !== true)
      throw new Error(`not at M5: ${notReady}; doctor: ${JSON.stringify(doctor)}\n${JSON.stringify(runs)}`);
    return `status lists ${runIds.join(', ')} at M5; doctor ok`;
  });

  await check('11. nothing was written under the plugin root', async () => {
    if (!snapshot) throw new Error('check 4 made no snapshot');
    const now = snapshotRoot();
    const lines = [
      ...[...now.keys()].filter((p) => !snapshot?.has(p)).map((p) => `added:   ${p}`),
      ...[...snapshot.keys()].filter((p) => !now.has(p)).map((p) => `removed: ${p}`),
      ...[...now].filter(([p, v]) => snapshot?.has(p) && snapshot.get(p) !== v).map(([p, v]) => `changed: ${p} (${v})`),
    ];
    if (lines.length) throw new Error(lines.join('\n'));
    return `${now.size} files unchanged`;
  });
} finally {
  removeTemps();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
