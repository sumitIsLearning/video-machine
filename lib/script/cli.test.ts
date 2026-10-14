import { expect, test } from 'bun:test';
import { main } from './cli';

test('usage mistakes are InputErrors with the usage line', async () => {
  await expect(main(['nope'])).rejects.toThrow('usage: cli.ts write <run_dir> (script JSON on stdin)');
});

test('stdin that is not JSON is an InputError', async () => {
  const stdin = async () => new TextEncoder().encode('{nope');
  await expect(main(['write', '/tmp/x'], { stdin })).rejects.toThrow('script on stdin is not JSON');
});

test('stdin that is not UTF-8 is an InputError', async () => {
  const stdin = async () => new Uint8Array([0x7b, 0xff, 0x7d]);
  await expect(main(['write', '/tmp/x'], { stdin })).rejects.toThrow('script on stdin is not valid UTF-8');
});
