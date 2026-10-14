import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BriefSchema, LookSchema, ScriptSchema } from '../contracts/types';
import { writeJson } from '../core/json';
import { writeStoryboardPage } from './page';
import { writePlan } from './plan';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const LOOK = LookSchema.parse({
  id: 'ember',
  based_on: [],
  idea: 'i',
  palette: [{ name: 'ink', hex: '#111111', role: 'bg' }],
  type: [{ role: 'display', family: 'Inter', weights: [700], license: 'OFL' }],
  motion: { character: 's', easings: [], typical_beat_s: [0.4, 0.8], camera: 'static' },
  motifs: [],
  post: {},
  layout_rules: { landscape: '', vertical: '', square: '' },
});

const run = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  writeJson(path.join(d, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [15, 30],
    timing_source: 'voiceover',
  });
  writeJson(path.join(d, 'script.json'), ScriptSchema, {
    run_id: 'r',
    version: 1,
    lines: [
      { id: 'l1', text: 'Paste <b>a</b> URL.' },
      { id: 'l2', text: 'Get clean data.' },
    ],
  });
  writeJson(path.join(d, 'look', 'look.json'), LookSchema, LOOK);
  writePlan(d, {
    scenes: [
      {
        scene_id: 'hook',
        lines: ['l1'],
        cut_in: { anchor: 'l1', rule: 'pause_before' },
        intent: 'show hook',
        beats: [{ on: 'URL', does: 'cursor types' }],
        layout: { reel: 'stack' },
        transition_out: 'cut',
        asset_ids: [],
      },
      {
        scene_id: 'demo',
        lines: ['l2'],
        cut_in: { anchor: 'l2', rule: 'pause_before' },
        intent: 'show demo',
        beats: [{ on: 'data', does: 'table fills' }],
        layout: { reel: 'stack' },
        transition_out: 'cut',
        asset_ids: [],
      },
    ],
  });
  mkdirSync(path.join(d, 'boards'), { recursive: true });
  writeFileSync(path.join(d, 'boards', 'hook.png'), 'frame');
  return d;
};

test('two scenes give two rows in order, and a missing board is listed', () => {
  const d = run();
  const r = writeStoryboardPage(d);
  expect(r.missing_boards).toEqual(['demo']);
  expect(r.page).toBe(path.join(d, 'out', 'storyboard.html'));
  expect(existsSync(r.page)).toBe(true);
  const html = readFileSync(r.page, 'utf8');
  expect(html.split('class="scene"').length - 1).toBe(2);
  expect(html.indexOf('hook')).toBeLessThan(html.indexOf('demo'));
  expect(html).toContain('../boards/hook.png');
  expect(html).toContain('not rendered yet');
  expect(html).toContain('Paste &lt;b&gt;a&lt;/b&gt; URL.');
});
