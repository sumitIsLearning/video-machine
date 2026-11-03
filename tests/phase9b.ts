// Phase 9b acceptance (short commands). Run: node_modules/.bin/bun tests/phase9b.ts
// 1. the plugin vm loads 11 skills  2. the menu shows feedback, new, setup, status  3. new and feedback have an argument-hint
// 4. no old names in skills, agents, .claude-plugin, README.md  5. strict validate reports no errors
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from '../lib/core/config';
import { sh } from '../lib/core/sh';

const WS = PLUGIN_ROOT;
const MIN = 60_000;

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

type Issue = { message?: string };
type ValidateReport = {
  manifest?: { errors?: Issue[]; warnings?: Issue[] };
  contents?: { errors?: Issue[]; warnings?: Issue[] }[];
};

// The frontmatter is the text between the first two `---` lines of a SKILL.md.
const frontmatter = (src: string) => src.split(/^---[ \t]*\r?$/m)[1] ?? '';
const skillFile = (name: string) => path.join(WS, 'skills', name, 'SKILL.md');
const skillNames = () =>
  readdirSync(path.join(WS, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
const listFiles = (p: string): string[] =>
  statSync(p).isDirectory() ? readdirSync(p).flatMap((e) => listFiles(path.join(p, e))) : [p];

await check('1. the plugin vm loads 11 skills', async () => {
  const r = await sh(['claude', '--plugin-dir', '.', 'plugin', 'details', 'vm'], { cwd: WS, timeoutMs: MIN });
  const m = /^\s*Skills \((\d+)\)[ \t]+(.*)$/m.exec(r.stdout);
  const skills = m?.[2]?.trim().split(/,\s*/) ?? [];
  const missing = ['new', 'feedback', 'setup', 'status'].filter((s) => !skills.includes(s));
  if (skills.length !== 11 || Number(m?.[1]) !== skills.length || missing.length)
    throw new Error(`missing ${missing}\n${r.stdout}`);
  return `skills: ${skills.join(', ')}`;
});

await check('2. the menu shows feedback, new, setup, status', async () => {
  const shown: string[] = [];
  for (const name of skillNames()) {
    const fm = frontmatter(readFileSync(skillFile(name), 'utf8'));
    if (/^disable-model-invocation:/m.test(fm)) throw new Error(`${name} sets disable-model-invocation`);
    if (!/^user-invocable:\s*false\s*$/m.test(fm)) shown.push(name);
  }
  shown.sort();
  const want = ['feedback', 'new', 'setup', 'status'];
  if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`shown: ${shown.join(', ')}`);
  return `shown: ${shown.join(', ')}`;
});

await check('3. new and feedback have an argument-hint', async () => {
  const missing = ['new', 'feedback'].filter(
    (name) => !/^argument-hint:\s*\S/m.test(frontmatter(readFileSync(skillFile(name), 'utf8'))),
  );
  if (missing.length) throw new Error(`no argument-hint in: ${missing.join(', ')}`);
  return 'skills/new and skills/feedback each have one';
});

await check('4. no old names in skills, agents, .claude-plugin, README.md', async () => {
  const files = [
    ...['skills', 'agents', '.claude-plugin'].flatMap((d) => listFiles(path.join(WS, d))),
    path.join(WS, 'README.md'),
  ];
  const hits: string[] = [];
  for (const f of files) {
    for (const [i, line] of readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
      if (/video-machine:|make-video/.test(line)) hits.push(`${path.relative(WS, f).replaceAll('\\', '/')}:${i + 1}`);
    }
  }
  if (hits.length) throw new Error(hits.slice(0, 20).join('\n'));
  return `${files.length} files, no old names`;
});

await check('5. strict validate reports no errors', async () => {
  const v = await sh(['claude', 'plugin', 'validate', '.claude-plugin/plugin.json', '--strict', '--json'], {
    cwd: WS,
    timeoutMs: MIN,
    allowFail: true,
  });
  let report: ValidateReport;
  try {
    report = JSON.parse(v.stdout);
  } catch (cause) {
    throw new Error(`validate output is not JSON\nstdout: ${v.stdout}\nstderr: ${v.stderr}`, { cause });
  }
  const contents = report.contents ?? [];
  const errors = [report.manifest?.errors ?? [], ...contents.map((c) => c.errors ?? [])].flat();
  const warnings = [report.manifest?.warnings ?? [], ...contents.map((c) => c.warnings ?? [])].flat();
  if (errors.length) throw new Error(errors.map((e) => e.message).join('\n'));
  return `errors: 0, warnings: ${warnings.length}`;
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
