import { expect, test } from 'bun:test';
import { main } from './cli';

const USAGE =
  'usage: cli.ts write <run_dir> <A|B> (JSON {look, md} on stdin) | board <run_dir> <A|B> <hook|product|ending> [--assets id,id] [--at s] (HTML on stdin) | compare <run_dir> | pick <run_dir> <A|B>';

test('usage mistakes name the usage', async () => {
  await expect(main(['board', '/tmp/x', 'C', 'hook'])).rejects.toThrow(USAGE);
  await expect(main(['pick', '/tmp/x'])).rejects.toThrow(USAGE);
});

test('--at must be a non-negative number', async () => {
  const stdin = async () => new TextEncoder().encode('<html></html>');
  await expect(main(['board', '/tmp/x', 'A', 'hook', '--at', 'soon'], { stdin })).rejects.toThrow(
    '--at must be a number of seconds',
  );
});
