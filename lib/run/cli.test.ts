import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DOCTOR_TOOLS } from '../contracts/types';
import { InputError } from '../core/errors';
import { main } from './cli';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};
const stdinOf = (s: string) => async () => new TextEncoder().encode(s);

test('new → import → brief → where, end to end, with ./runs under the cwd by default', async () => {
  const cwd = temp();
  const d = temp();
  const made = await main(['new', '--concept', '-'], { stdin: stdinOf('Ship faster\n'), cwd, vmHome: d });
  const runDir = String(made.run_dir);
  expect(path.dirname(runDir)).toBe(path.join(cwd, 'runs'));
  expect(readFileSync(path.join(runDir, 'concept.md'), 'utf8')).toBe('Ship faster\n');
  const logo = path.join(temp(), 'logo.svg');
  writeFileSync(logo, '<svg/>');
  expect((await main(['import', runDir, logo], { cwd, vmHome: d })).paths).toEqual(['input/logo.svg']);
  const draft = JSON.stringify({ sources: [{ kind: 'file', path_or_url: 'input/logo.svg', note: 'logo' }] });
  const b = await main(['brief', runDir], { stdin: stdinOf(draft), cwd, vmHome: d });
  expect(b.brief).toBe(path.join(runDir, 'brief.json'));
  expect((await main(['where', runDir], { cwd, vmHome: d })).next).toBe('M5');
});

test('new reads the concept from a file', async () => {
  const cwd = temp();
  const f = path.join(temp(), 'concept.md');
  writeFileSync(f, '# Async standups\n\nFull script here.\n');
  const made = await main(['new', '--concept', f, '--runs', path.join(cwd, 'elsewhere')], { cwd, vmHome: temp() });
  expect(readFileSync(path.join(String(made.run_dir), 'concept.md'), 'utf8')).toBe(
    '# Async standups\n\nFull script here.\n',
  );
});

test('a brief draft that is not JSON is an InputError', async () => {
  const cwd = temp();
  const d = temp();
  const made = await main(['new', '--concept', '-'], { stdin: stdinOf('x'), cwd, vmHome: d });
  const err = await main(['brief', String(made.run_dir)], { stdin: stdinOf('{ nope'), cwd, vmHome: d }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InputError);
});

test('status lists runs and the doctor summary (null when setup never ran)', async () => {
  const cwd = temp();
  const d = temp();
  await main(['new', '--concept', '-'], { stdin: stdinOf('Ship faster'), cwd, vmHome: d });
  const s = await main(['status'], { cwd, vmHome: d });
  expect((s.runs as { next: string }[]).map((r) => r.next)).toEqual(['M1']);
  expect(s.doctor).toBeNull();
  const tools = Object.fromEntries(DOCTOR_TOOLS.map((t) => [t, { ok: t !== 'uv' }]));
  const save = (t: object) =>
    writeFileSync(
      path.join(d, 'doctor.json'),
      JSON.stringify({ checked_at: '2026-10-10T09:00:00Z', tools: t, smoke_s: {} }),
    );
  save(tools);
  expect((await main(['status'], { cwd, vmHome: d })).doctor).toEqual({
    ok: false,
    failing: ['uv'],
    checked_at: '2026-10-10T09:00:00Z',
  });
  // a tool the record does not mention counts as failing
  const { parakeet: _, ...withoutParakeet } = tools;
  save(withoutParakeet);
  expect(((await main(['status'], { cwd, vmHome: d })).doctor as { failing: string[] }).failing).toEqual([
    'uv',
    'parakeet',
  ]);
});

test('a concept path that cannot be read as a file is an InputError naming it', async () => {
  const cwd = temp();
  for (const concept of [path.join(cwd, 'missing.md'), cwd]) {
    const err = await main(['new', '--concept', concept], { cwd, vmHome: temp() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as Error).message).toContain(concept);
  }
});

test('a relative --runs resolves against the cwd', async () => {
  const cwd = temp();
  const made = await main(['new', '--concept', '-', '--runs', 'out/runs'], {
    stdin: stdinOf('Ship faster'),
    cwd,
    vmHome: temp(),
  });
  expect(path.dirname(String(made.run_dir))).toBe(path.join(cwd, 'out', 'runs'));
});

test('import with a run folder but no files is an InputError with usage', async () => {
  const err = await main(['import', temp()], { cwd: temp(), vmHome: temp() }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as Error).message).toContain('usage');
});

test('an unknown flag or a flag with no value is an InputError with usage', async () => {
  for (const argv of [
    ['where', 'x', '--bogus'],
    ['new', '--concept'],
  ]) {
    const err = await main(argv, { cwd: temp(), vmHome: temp() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as Error).message).toContain('usage');
  }
});

test('status reports a doctor.json that cannot be read as unreadable', async () => {
  const d = temp();
  mkdirSync(path.join(d, 'doctor.json'), { recursive: true });
  expect((await main(['status'], { cwd: temp(), vmHome: d })).doctor).toEqual({
    ok: false,
    failing: ['doctor.json unreadable'],
    checked_at: null,
  });
});

test('status keeps listing runs when one run folder is broken', async () => {
  const cwd = temp();
  const d = temp();
  const made = await main(['new', '--concept', '-'], { stdin: stdinOf('Ship faster'), cwd, vmHome: d });
  writeFileSync(path.join(String(made.run_dir), 'brief.json'), '{bad');
  const runs = (await main(['status'], { cwd, vmHome: d })).runs as { run_id: string; error?: string }[];
  expect(runs).toHaveLength(1);
  expect(runs[0]?.error).toBeString();
});

test('an unknown command or a missing argument is an InputError with usage', async () => {
  for (const argv of [['fly'], ['new'], ['import'], ['where']]) {
    const err = await main(argv, { cwd: temp(), vmHome: temp() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as Error).message).toContain('usage');
  }
});
