import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema, type Look, LookSchema } from '../contracts/types';
import { loadConfig } from '../core/config';
import type { Deps } from '../core/deps';
import { readJson, writeJson } from '../core/json';
import { compareLooks, pickLook, writeBoard, writeLook } from './look';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const run = (brand?: object) => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  writeJson(path.join(d, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [15, 30],
    timing_source: 'voiceover',
    ...(brand && { brand }),
  });
  return d;
};
const LOOK_A: Look = LookSchema.parse({
  id: 'ember',
  based_on: [],
  idea: 'orange heat on black',
  palette: [
    { name: 'ink', hex: '#111111', role: 'bg' },
    { name: 'fire', hex: '#FF4D00', role: 'accent' },
  ],
  type: [{ role: 'display', family: 'Inter', weights: [700], license: 'OFL' }],
  motion: { character: 'snappy', easings: ['power3.out'], typical_beat_s: [0.4, 0.8], camera: 'static' },
  motifs: [{ id: 'cursor', meaning: 'action' }],
  post: {},
  layout_rules: { landscape: '', vertical: 'stack', square: '' },
});
const LOOK_B: Look = {
  ...LOOK_A,
  id: 'paper',
  palette: [{ name: 'paper', hex: '#FDFBF9', role: 'bg' }],
  type: [{ role: 'display', family: 'DM Sans', weights: [500], license: 'OFL' }],
};

/** A fake HyperFrames: lint passes, snapshot writes one frame. */
const deps: Deps = {
  config: loadConfig({ PATH: '/bin', VM_HOME: tmpdir() }),
  sh: async (cmd) => {
    if (cmd.includes('lint'))
      return { code: 0, stdout: JSON.stringify({ ok: true, errorCount: 0, findings: [] }), stderr: '' };
    const out = cmd[cmd.indexOf('-o') + 1] as string;
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'frame-00-at-1s.png'), 'frame');
    return { code: 0, stdout: '', stderr: '' };
  },
};
const HTML = '<!doctype html><html><body></body></html>';
const allBoards = async (d: string) => {
  for (const dir of ['A', 'B'] as const)
    for (const b of ['hook', 'product', 'ending'] as const) await writeBoard(deps, d, dir, b, HTML, [], 1);
};

const ROOT_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const BAND_TOP = 'top:1056px';
const stackRun = () => {
  const d = run();
  writeJson(path.join(d, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [15, 30],
    timing_source: 'voiceover',
    avatar: { source: 'supplied', clip: 'input/me.mp4' },
    layout: { kind: 'stack', split: 0.55 },
  });
  writeLook(d, 'A', { look: LOOK_A, md: '# Ember' });
  return d;
};

test('look boards of a stack brief get the presenter band', async () => {
  const d = stackRun();
  await writeBoard(deps, d, 'A', 'hook', ROOT_HTML, [], 1);
  const page = readFileSync(path.join(d, 'directions', 'A', 'boards', 'hook', 'index.html'), 'utf8');
  expect(page).toContain('data-vm-band');
  expect(page).toContain(BAND_TOP);
});

test('look boards of a brief without a layout get no presenter band', async () => {
  const d = run();
  writeLook(d, 'A', { look: LOOK_A, md: '# Ember' });
  await writeBoard(deps, d, 'A', 'hook', ROOT_HTML, [], 1);
  const page = readFileSync(path.join(d, 'directions', 'A', 'boards', 'hook', 'index.html'), 'utf8');
  expect(page).not.toContain('data-vm-band');
});

test('writeLook writes look.json and LOOK.md for a direction', () => {
  const d = run();
  expect(writeLook(d, 'A', { look: LOOK_A, md: '# Ember' })).toEqual({
    look: 'directions/A/look.json',
    md: 'directions/A/LOOK.md',
  });
  expect(readJson(path.join(d, 'directions/A/look.json'), LookSchema).id).toBe('ember');
  expect(() => writeLook(d, 'A', { look: LOOK_A, md: '' })).toThrow('LOOK.md text is empty');
});

test('a board needs its direction first, then renders to boards/<board>.png', async () => {
  const d = run();
  await expect(writeBoard(deps, d, 'A', 'hook', HTML, [], 1)).rejects.toThrow('write look A first');
  writeLook(d, 'A', { look: LOOK_A, md: '# A' });
  expect(await writeBoard(deps, d, 'A', 'hook', HTML, [], 1)).toEqual({
    png: 'directions/A/boards/hook.png',
    warnings: [],
  });
  expect(readFileSync(path.join(d, 'directions/A/boards/hook.png'), 'utf8')).toBe('frame');
});

test('a board with lint errors is refused and names them', async () => {
  const d = run();
  writeLook(d, 'A', { look: LOOK_A, md: '# A' });
  const bad: Deps = {
    ...deps,
    sh: async () => ({
      code: 1,
      stderr: '',
      stdout: JSON.stringify({ ok: false, findings: [{ code: 'x', severity: 'error', message: 'broken' }] }),
    }),
  };
  await expect(writeBoard(bad, d, 'A', 'hook', HTML, [], 1)).rejects.toThrow(
    'board A/hook has lint errors:\n- x: broken',
  );
});

test('compare writes the page, lists missing boards and passes for different looks', async () => {
  const d = run();
  writeLook(d, 'A', { look: LOOK_A, md: '# A' });
  writeLook(d, 'B', { look: LOOK_B, md: '# B' });
  const first = compareLooks(d);
  expect(first.missing_boards).toHaveLength(6);
  await allBoards(d);
  const r = compareLooks(d);
  expect(r.check.status).toBe('pass');
  expect(r.missing_boards).toEqual([]);
  expect(existsSync(r.page)).toBe(true);
  expect(readFileSync(r.page, 'utf8')).toContain('../directions/B/boards/ending.png');
});

test('compare refuses looks that differ in fewer than two ways, after writing the page', () => {
  const d = run();
  writeLook(d, 'A', { look: LOOK_A, md: '# A' });
  writeLook(d, 'B', { look: { ...LOOK_A, id: 'same' }, md: '# B' });
  expect(() => compareLooks(d)).toThrow('A and B differ in 0 of');
  expect(existsSync(path.join(d, 'out', 'looks.html'))).toBe(true);
});

test('brand colours make only motion and motifs count', () => {
  const d = run({ colors: [{ hex: '#FF4D00' }] });
  writeLook(d, 'A', { look: LOOK_A, md: '# A' });
  writeLook(d, 'B', { look: LOOK_B, md: '# B' });
  expect(() => compareLooks(d)).toThrow('brand fixes palette or type');
});

test('pick copies the direction to look/ once its three boards exist', async () => {
  const d = run();
  writeLook(d, 'A', { look: LOOK_A, md: '# A' });
  writeLook(d, 'B', { look: LOOK_B, md: '# B' });
  expect(() => pickLook(d, 'A')).toThrow('direction A is missing boards: hook, product, ending');
  await allBoards(d);
  expect(pickLook(d, 'A')).toEqual({ look: 'look/look.json', id: 'ember' });
  expect(readFileSync(path.join(d, 'look', 'LOOK.md'), 'utf8')).toBe('# A');
});
