import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from './config';
import { ToolError } from './errors';
import { sh } from './sh';

const js = (code: string) => [process.execPath, '-e', code]; // the bun running the tests

test('returns code, stdout and stderr of a successful command', async () => {
  const r = await sh(js("process.stdout.write('out'); process.stderr.write('err')"));
  expect(r).toEqual({ code: 0, stdout: 'out', stderr: 'err' });
});

test('throws a ToolError with the exit code and stderr when the command fails', async () => {
  const e = await sh(js("process.stderr.write('boom'); process.exit(3)")).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ToolError);
  expect((e as ToolError).code).toBe(3);
  expect((e as ToolError).stderrTail).toBe('boom');
});

test('allowFail returns a failed result instead of throwing', async () => {
  const r = await sh(js("process.stdout.write('{}'); process.exit(1)"), { allowFail: true });
  expect(r).toEqual({ code: 1, stdout: '{}', stderr: '' });
});

test('stdin reaches the child byte for byte, BOM, CRLF and emoji included', async () => {
  const input = '\u{FEFF}Why async\r\nFull script 🎬\r\n';
  // hex out, because a text decoder may drop a leading BOM
  const echo = "process.stdout.write(Buffer.from(await Bun.stdin.arrayBuffer()).toString('hex'))";
  const r = await sh(js(echo), { stdin: input });
  expect(r.stdout).toBe(Buffer.from(input, 'utf8').toString('hex'));
});

test('a missing executable is a ToolError', async () => {
  await expect(sh(['vm-no-such-tool-xyz'])).rejects.toBeInstanceOf(ToolError);
});

test('an empty command is rejected before anything is spawned', async () => {
  await expect(sh([])).rejects.toBeInstanceOf(ToolError);
});

test('passes cwd and env to the child', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-'));
  const env = { ...loadConfig().toolEnv, VM_T: 'yes' };
  const r = await sh(js("process.stdout.write(process.cwd() + '|' + process.env.VM_T)"), { cwd: dir, env });
  expect(r.stdout.endsWith(`${path.basename(dir)}|yes`)).toBe(true);
});

test('without an env the child gets the tool env (telemetry off)', async () => {
  const r = await sh(js('process.stdout.write(String(process.env.HYPERFRAMES_NO_TELEMETRY))'));
  expect(r.stdout).toBe('1');
});

test('a command that outlives its timeout is killed and reported as timed out', async () => {
  const e = await sh(js('setInterval(() => {}, 1e6)'), { timeoutMs: 500 }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ToolError);
  expect((e as ToolError).timedOut).toBe(true);
});

test('an explicit env is stripped of API keys and still gets the tool vars', async () => {
  const env = { ...process.env, OPENAI_API_KEY: 'sk-secret' };
  const r = await sh(
    js("process.stdout.write((process.env.OPENAI_API_KEY ?? 'unset') + '|' + process.env.PYTHONUTF8)"),
    {
      env,
    },
  );
  expect(r.stdout).toBe('unset|1');
});

test('when stderr is empty the ToolError carries the stdout tail', async () => {
  const e = await sh(js("process.stdout.write('oops'); process.exit(2)")).catch((x: unknown) => x);
  expect((e as ToolError).stderrTail).toBe('oops');
});

test.skipIf(process.platform !== 'win32')(
  'a timed-out command whose pipes stay open elsewhere still rejects shortly after the timeout',
  async () => {
    // z outlives the killed tree (its parent y exits at once) and keeps the inherited pipes open for 6 s
    const z = 'setTimeout(() => {}, 6000)';
    const spawnOf = (code: string, opts: string) =>
      `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(code)}], ${opts})`;
    const y = `${spawnOf(z, "{ stdio: 'inherit', detached: true }")}.unref()`;
    const x = `${spawnOf(y, "{ stdio: 'inherit' }")}; setInterval(() => {}, 1e6)`;
    const started = Date.now();
    const e = await sh(js(x), { timeoutMs: 1500 }).catch((err: unknown) => err);
    expect((e as ToolError).timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500 + 3500);
  },
  15_000,
);

test.skipIf(process.platform !== 'win32')(
  'a command that already exited resolves normally even if a grandchild keeps the pipes open',
  async () => {
    const z = 'setTimeout(() => {}, 6000)';
    const y = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(z)}], { stdio: 'inherit', detached: true }).unref()`;
    const started = Date.now();
    const r = await sh(js(y), { timeoutMs: 1500 });
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(1500 + 3500);
  },
  15_000,
);

test.skipIf(process.platform !== 'win32')(
  'on Windows the timeout kills the whole process tree, not just the child',
  async () => {
    const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'vm-')), 'gc.pid').replaceAll('\\', '/');
    // cmd reads > < | & ^ as redirects and operators, so none may reach it: "=>" would create a file named "{}".
    const script = `require('fs').writeFileSync('${pidFile}', String(process.pid)); setInterval(Object, 1e6)`;
    expect(script).not.toMatch(/[<>|&^]/);
    const e = await sh(['cmd', '/c', process.execPath, '-e', script], { timeoutMs: 2000 }).catch((x: unknown) => x);
    expect((e as ToolError).timedOut).toBe(true);
    expect(existsSync(pidFile)).toBe(true); // the grandchild really started
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    const isAlive = () => {
      try {
        process.kill(grandchild, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 50 && isAlive(); i++) await Bun.sleep(100);
    expect(isAlive()).toBe(false);
  },
  15_000,
);
