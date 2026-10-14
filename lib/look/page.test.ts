import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Look, LookSchema } from '../contracts/types';
import { writeLooksPage } from './page';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const newRun = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  return d;
};
const LOOK: Look = LookSchema.parse({
  id: 'ember',
  based_on: [],
  idea: 'orange heat on black',
  palette: [{ name: 'ink', hex: '#111111', role: 'bg' }],
  type: [{ role: 'display', family: 'Inter', weights: [700], license: 'OFL' }],
  motion: { character: 'snappy', easings: ['power3.out'], typical_beat_s: [0.4, 0.8], camera: 'static' },
  motifs: [{ id: 'cursor', meaning: 'action' }],
  post: {},
  layout_rules: { landscape: '', vertical: 'stack', square: '' },
});

test('writeLooksPage escapes markup in a look idea', () => {
  const d = newRun();
  const page = writeLooksPage(d, { ...LOOK, idea: '<b>bold</b>' }, LOOK, {
    id: 'look.directions_differ',
    blocking: true,
    status: 'pass',
    detail: 'ok',
    annotations: [],
  });
  const html = readFileSync(page, 'utf8');
  expect(html).not.toContain('<b>bold</b>');
  expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
});

test('writeLooksPage has a slot for each of the six boards', () => {
  const d = newRun();
  const page = writeLooksPage(d, LOOK, LOOK, {
    id: 'look.directions_differ',
    blocking: true,
    status: 'pass',
    detail: 'ok',
    annotations: [],
  });
  const html = readFileSync(page, 'utf8');
  expect(html.split('not rendered yet').length - 1).toBe(6);
});
