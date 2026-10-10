import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DoctorSchema } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { InputError, ToolError } from '../core/errors';
import { readJson } from '../core/json';
import { main } from './cli';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** Deps whose tools are all missing: the doctor fails every subprocess check but still writes doctor.json. */
const missingWorld = (): Deps => {
  const vm = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(vm);
  return {
    config: loadConfig({ PATH: '/bin', VM_HOME: vm }),
    sh: async (cmd) => {
      throw new ToolError({ cmd, code: null, stderr: 'spawn ENOENT' });
    },
  };
};

test('doctor writes doctor.json under vmHome and lists the failing tools', async () => {
  const deps = missingWorld();
  const r = await main(['doctor'], deps);
  const file = path.join(deps.config.vmHome, 'doctor.json');
  expect(r.doctor).toBe(file);
  expect(r.ok).toBe(false);
  expect(r.failing).toContain('node');
  readJson(file, DoctorSchema);
});

test('doctor returns the detail of each failing tool', async () => {
  const r = await main(['doctor'], missingWorld());
  const details = r.details as Record<string, string>;
  expect(Object.keys(details).sort()).toEqual([...(r.failing as string[])].sort());
  expect(details.node).toBe('not found');
});

test('doctor treats a doctor.json it cannot read (a folder) as unreadable and says so on stderr', async () => {
  const deps = missingWorld();
  mkdirSync(path.join(deps.config.vmHome, 'doctor.json'));
  const lines: string[] = [];
  const spy = spyOn(process.stderr, 'write').mockImplementation((s) => {
    lines.push(String(s));
    return true;
  });
  try {
    // The folder then blocks the rewrite itself; what matters here is that the read was not the failure.
    await main(['doctor'], deps).catch(() => {});
  } finally {
    spy.mockRestore();
  }
  expect(lines).toContain('[M0] doctor.json was unreadable; rewritten\n');
});

test('doctor keeps the smoke timings from the previous doctor.json', async () => {
  const deps = missingWorld();
  writeFileSync(
    path.join(deps.config.vmHome, 'doctor.json'),
    JSON.stringify({ checked_at: '2026-10-09T00:00:00Z', tools: {}, smoke_s: { render: 25 } }),
  );
  await main(['doctor'], deps);
  expect(readJson(path.join(deps.config.vmHome, 'doctor.json'), DoctorSchema).smoke_s).toEqual({ render: 25 });
});

test('doctor overwrites an unreadable doctor.json instead of failing', async () => {
  const deps = missingWorld();
  writeFileSync(path.join(deps.config.vmHome, 'doctor.json'), '{ half');
  await main(['doctor'], deps);
  expect(readJson(path.join(deps.config.vmHome, 'doctor.json'), DoctorSchema).smoke_s).toEqual({});
});

/** Deps whose HyperFrames and uv are fakes that write what the real ones would; `duringRender` runs mid-smoke. */
const smokeWorld = (duringRender: (vm: string) => void = () => {}): Deps => {
  const vm = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(vm);
  mkdirSync(path.join(vm, 'models'));
  writeFileSync(path.join(vm, 'models', 'w2v2_base_960h_q.onnx'), 'onnx');
  const timing = {
    lines: [
      {
        text: 'Smoke test.',
        start: 0,
        end: 1,
        words: [
          { w: 'a', start: 0, end: 1 },
          { w: 'b', start: 1, end: 2 },
        ],
      },
    ],
  };
  return {
    config: loadConfig({ PATH: '/bin', VM_HOME: vm }),
    sh: async (cmd, opts) => {
      const out = (flag: string) => cmd[cmd.indexOf(flag) + 1] ?? '';
      if (cmd.includes('init')) mkdirSync(path.join(opts?.cwd ?? '', 'smoke'));
      if (cmd.includes('render')) {
        writeFileSync(out('-o'), 'mp4');
        duringRender(vm);
      }
      if (cmd.includes('tts')) {
        writeFileSync(out('-o'), 'RIFF');
        return { code: 0, stdout: '{"ok":true}\n', stderr: '' };
      }
      if (cmd[0] === 'uv' && cmd.includes('python')) {
        const runDir = cmd[10] ?? '';
        mkdirSync(path.join(runDir, 'data'), { recursive: true });
        writeFileSync(path.join(runDir, 'data', 'timing.json'), JSON.stringify(timing));
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
};

test('smoke with no doctor.json runs the doctor, then saves the timings and returns them', async () => {
  const deps = smokeWorld();
  const r = await main(['smoke'], deps);
  const saved = readJson(path.join(deps.config.vmHome, 'doctor.json'), DoctorSchema);
  expect(Object.keys(r.smoke_s as object).sort()).toEqual(['align', 'render', 'tts']);
  expect(saved.smoke_s).toEqual(r.smoke_s as Record<string, number>);
  expect(Object.keys(saved.tools)).toContain('node');
});

test('smoke keeps a doctor.json that was rewritten while the smoke ran', async () => {
  const fresh = { checked_at: '2026-10-10T00:00:00Z', tools: { node: { ok: true, version: '22.0.0' } }, smoke_s: {} };
  const deps = smokeWorld((vm) => writeFileSync(path.join(vm, 'doctor.json'), JSON.stringify(fresh)));
  const stale = { checked_at: '2026-10-01T00:00:00Z', tools: {}, smoke_s: {} };
  writeFileSync(path.join(deps.config.vmHome, 'doctor.json'), JSON.stringify(stale));
  await main(['smoke'], deps);
  const saved = readJson(path.join(deps.config.vmHome, 'doctor.json'), DoctorSchema);
  expect(saved.tools).toEqual(fresh.tools);
  expect(saved.checked_at).toBe('2026-10-10T00:00:00Z');
});

test('install refuses an unknown step and names the known ones', async () => {
  const err = await main(['install', 'gpu'], missingWorld()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as Error).message).toContain('venv, model, browser, parakeet');
});

test('an unknown command is an InputError listing the commands', async () => {
  const err = await main(['fly'], missingWorld()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(InputError);
  expect((err as Error).message).toContain('doctor | install | smoke');
});
