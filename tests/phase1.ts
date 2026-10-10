// Phase 1 acceptance test (real tools; takes several minutes because it runs Phase 0).
//   node_modules/.bin/bun tests/phase1.ts
// 1. unit tests pass                        2. lint is clean (tsc, Biome, ruff)
// 3. Phase 0 acceptance still passes        4. plugin and marketplace manifests pass strict validation
// 5. claude --plugin-dir . loads make-video  6. lib/ keeps its boundaries (env, processes, retired folders gone)
// 7. the pinned HyperFrames version resolves (fills the npx cache, ~/.npm/_npx, on first run)
// Check 6 scans TypeScript only on purpose: the vendored aligner Python under lib/adapters/align/ctc-onnx/analysis/
// calls subprocess by design.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HYPERFRAMES_VERSION, loadConfig, PLUGIN_ROOT } from '../lib/core/config';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const { bun } = loadConfig();
const MIN = 60_000;
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

await check('1. unit tests pass', async () => {
  const r = await sh([bun, 'test'], { cwd: WS, timeoutMs: 5 * MIN });
  const summary = r.stderr || r.stdout; // bun test writes its summary to stderr
  const pass = Number(/^\s*(\d+) pass\b/m.exec(summary)?.[1] ?? 0);
  const fail = Number(/^\s*(\d+) fail\b/m.exec(summary)?.[1] ?? 0);
  if (pass === 0 || fail > 0) throw new Error(`${pass} pass, ${fail} fail\n${lastLine(summary)}`);
  return `${pass} pass, 0 fail`;
});

await check('2. lint is clean', async () => {
  await sh([bun, 'run', 'lint'], { cwd: WS, timeoutMs: 5 * MIN });
  return 'tsc, Biome and ruff report nothing';
});

await check('3. Phase 0 acceptance still passes', async () =>
  lastLine((await sh([bun, 'tests/phase0.ts'], { cwd: WS, timeoutMs: 30 * MIN })).stdout),
);

await check('4. plugin and marketplace manifests pass strict validation', async () => {
  const out: string[] = [];
  for (const f of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const r = await sh(['claude', 'plugin', 'validate', f, '--strict', '--json'], {
      cwd: WS,
      allowFail: true,
      timeoutMs: MIN,
    });
    let report: { success: boolean; manifest?: { errors?: unknown[]; warnings?: unknown[] } };
    try {
      report = JSON.parse(r.stdout);
    } catch (cause) {
      throw new Error(`${f}: output is not JSON\nstdout: ${r.stdout}\nstderr: ${r.stderr}`, { cause });
    }
    const { errors, warnings } = report.manifest ?? {};
    if (r.code !== 0 || !report.success || errors?.length || warnings?.length)
      throw new Error(`${f}: errors ${JSON.stringify(errors)}, warnings ${JSON.stringify(warnings)}`);
    out.push(`${f}: no errors, no warnings`);
  }
  return out.join('\n');
});

await check('5. claude --plugin-dir . loads the make-video skill', async () => {
  const r = await sh(['claude', '--plugin-dir', '.', 'plugin', 'details', 'video-machine'], {
    cwd: WS,
    timeoutMs: MIN,
  });
  const m = /^\s*Skills \((\d+)\)[ \t]+(.*)$/m.exec(r.stdout);
  const skills = m?.[2]?.trim().split(/,\s*/) ?? [];
  if (!skills.includes('make-video') || Number(m?.[1]) !== skills.length) throw new Error(r.stdout);
  return `skills: ${skills.join(', ')}`;
});

await check('6. lib/ keeps its boundaries', async () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(path.join(WS, 'lib'));
  const rel = (f: string) => path.relative(WS, f).replaceAll('\\', '/');
  if (files.length === 0) throw new Error('no .ts files found under lib/');
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (
      /\b(process|Bun)\s*(\.|\[\s*['"])env\b|import\.meta\.env\b|from ['"](node:)?process['"]/.test(src) &&
      rel(f) !== 'lib/core/config.ts'
    )
      bad.push(`${rel(f)} reads the environment`);
    if (/\bchild_process\b|Bun\.(spawn|\$)/.test(src) && rel(f) !== 'lib/core/sh.ts')
      bad.push(`${rel(f)} spawns a process`);
  }
  for (const gone of ['.claude/skills/video-machine', 'engine', 'lib/adapters/render/pdoom', 'tests/baseline'])
    if (existsSync(path.join(WS, gone))) bad.push(`${gone} still exists`);
  if (bad.length) throw new Error(bad.join('\n'));
  return `${files.length} files checked`;
});

await check('7. pinned HyperFrames resolves', async () => {
  const r = await sh(['npx', '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, '--version'], {
    cwd: WS,
    timeoutMs: 5 * MIN,
  });
  if (lastLine(r.stdout) !== HYPERFRAMES_VERSION) throw new Error(`got "${lastLine(r.stdout)}"`);
  return `hyperframes ${HYPERFRAMES_VERSION}`;
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
