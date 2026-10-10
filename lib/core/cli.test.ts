import { expect, test } from 'bun:test';
import { runCli } from './cli';
import { InputError } from './errors';

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) } };
};

test('runCli prints the result as one JSON line with ok:true and returns 0', async () => {
  const t = capture();
  expect(await runCli(async () => ({ run_id: 'r1' }), t.io)).toBe(0);
  expect(t.out).toEqual(['{"ok":true,"run_id":"r1"}']);
  expect(t.err).toEqual([]);
});

test('a result may report ok:false without being an error', async () => {
  const t = capture();
  expect(await runCli(async () => ({ ok: false, failing: ['node'] }), t.io)).toBe(0);
  expect(t.out).toEqual(['{"ok":false,"failing":["node"]}']);
});

test('a VideoMachineError becomes ok:false with its class name and exit 1', async () => {
  const t = capture();
  const code = await runCli(async () => {
    throw new InputError('input/x.mp4 is missing');
  }, t.io);
  expect(code).toBe(1);
  expect(t.out).toEqual(['{"ok":false,"error":"InputError","message":"input/x.mp4 is missing"}']);
  expect(t.err).toEqual([]);
});

test('runCli still returns an exit code when stdout cannot be written', async () => {
  const err: string[] = [];
  const io = {
    out: () => {
      throw new Error('EPIPE');
    },
    err: (s: string) => void err.push(s),
  };
  expect(await runCli(async () => ({ run_id: 'r1' }), io)).toBe(1);
  expect(err.join('\n')).toContain('EPIPE');
});

test('runCli does not throw when both outputs fail', async () => {
  const fail = () => {
    throw new Error('EPIPE');
  };
  expect(await runCli(async () => ({}), { out: fail, err: fail })).toBe(1);
});

test('any other error is reported the same way, with its stack on stderr', async () => {
  const t = capture();
  const code = await runCli(async () => {
    throw new TypeError('boom');
  }, t.io);
  expect(code).toBe(1);
  expect(JSON.parse(t.out[0] ?? '')).toEqual({ ok: false, error: 'TypeError', message: 'boom' });
  expect(t.err.join('\n')).toContain('boom');
});
