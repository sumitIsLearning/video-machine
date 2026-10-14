import { expect, test } from 'bun:test';
import { main } from './cli';

test('usage mistakes name the usage', async () => {
  await expect(main(['board', '/tmp/x'])).rejects.toThrow(
    'usage: cli.ts write <run_dir> (plan JSON on stdin) | board <run_dir> <scene_id> [--at s] (HTML on stdin) | page <run_dir>',
  );
});
