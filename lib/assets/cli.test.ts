import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetIdOf } from '../core/asset-id';
import { InputError } from '../core/errors';
import { main } from './cli';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  for (const f of ['concept.md', 'a.png']) writeFileSync(path.join(d, f), 'x');
  writeFileSync(
    path.join(d, 'brief.json'),
    JSON.stringify({
      run_id: 'r',
      concept: 'c',
      goals: [],
      duration_target_s: [10, 20],
      timing_source: 'voiceover',
      sources: [{ kind: 'file', path_or_url: 'a.png' }],
    }),
  );
  return d;
};

test('build counts the assets by origin', async () => {
  expect(await main(['build', run()])).toEqual({ assets: 1, by_origin: { supplied: 1 }, unknown_licence: 0 });
});

test('mark sets the status', async () => {
  const dir = run();
  await main(['build', dir]);
  const id = assetIdOf('supplied', 'a.png');
  expect(await main(['mark', dir, id, 'pin'])).toEqual({ asset_id: id, status: 'pinned' });
  expect(await main(['mark', dir, id, 'drop'])).toEqual({ asset_id: id, status: 'dropped' });
});

test('panel returns the page path', async () => {
  const dir = run();
  await main(['build', dir]);
  const r = await main(['panel', dir]);
  expect(existsSync(String(r.panel))).toBe(true);
});

test('mark with an unknown id is an InputError', async () => {
  const dir = run();
  await main(['build', dir]);
  await expect(main(['mark', dir, 'nope-1', 'pin'])).rejects.toThrow(InputError);
});

test('a bad command or status is a usage error', async () => {
  const dir = run();
  await expect(main(['bogus', dir])).rejects.toThrow('usage:');
  await expect(main(['mark', dir, 'x', 'keep'])).rejects.toThrow('usage:');
});

test.each(['toString', 'constructor', '__proto__'])('an inherited name %p is not a status', async (mark) => {
  const dir = run();
  await expect(main(['mark', dir, 'x', mark])).rejects.toThrow('usage:');
});

test('build passes its warnings to the caller', async () => {
  const dir = run();
  writeFileSync(
    path.join(dir, 'brief.json'),
    JSON.stringify({
      run_id: 'r',
      concept: 'c',
      goals: [],
      duration_target_s: [10, 20],
      timing_source: 'voiceover',
      sources: [{ kind: 'file', path_or_url: 'missing.png' }],
    }),
  );
  const warns: string[] = [];
  await main(['build', dir], { onWarn: (l) => warns.push(l) });
  expect(warns[0]).toStartWith('[M4] skipped missing.png');
});
