import { expect, test } from 'bun:test';
import type { AssetRef } from '../contracts/types';
import { checkLicensed, checkNoReferenceOnly } from './assets';

const a = (asset_id: string, over: Partial<AssetRef> = {}) =>
  ({
    asset_id,
    kind: 'image',
    path: `assets/${asset_id}.png`,
    usage: 'render',
    license: 'CC0',
    origin: 'web',
    status: 'pool',
    ...over,
  }) as AssetRef;

test('licensed: every built asset and every look font needs a known licence', () => {
  expect(checkLicensed([a('img-1')], ['img-1'], [{ family: 'Inter', license: 'OFL' }]).status).toBe('pass');
  const r = checkLicensed(
    [a('img-1', { license: 'unknown' })],
    ['img-1', 'img-9'],
    [{ family: 'Brand Sans', license: 'unknown' }],
  );
  expect(r).toMatchObject({ id: 'assets.licensed', blocking: true, status: 'fail' });
  expect(r.annotations.map((x) => x.problem)).toEqual([
    'asset img-1 has licence "unknown"',
    'asset img-9 is not in assets.json',
    'font Brand Sans has licence "unknown"',
  ]);
});
test('no reference-only: a scene that names a reference-only file fails', () => {
  const pool = [a('nav-1', { usage: 'reference_only', path: 'input/nav.mp4' })];
  expect(checkNoReferenceOnly(pool, { hook: '<video src="assets/x.mp4">' }).status).toBe('pass');
  const r = checkNoReferenceOnly(pool, { demo: '<video src="../../input/nav.mp4">' });
  expect(r).toMatchObject({ id: 'assets.no_reference_only', status: 'fail' });
  expect(r.annotations[0]).toMatchObject({ scene_id: 'demo' });
});
