import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssetsSchema, BriefSchema, type Plan, PlanSchema, TimingSchema } from '../../../contracts/types';
import { InputError, UnsupportedError } from '../../../core/errors';
import { writeJson } from '../../../core/json';
import { assembleProject } from './project';

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const HOOK = `<style>#h{position:absolute;left:var(--vm-safe-left);top:40%;width:600px;height:200px}</style>
<h1 id="h">Meet Firecrawl</h1><img src="assets/img-1.png">
<script>const s = VM.scene("hook"); const tl = gsap.timeline({ paused: true });
tl.from("#h", { opacity: 0, duration: 0.4 }, s.at("Firecrawl")); window.__timelines["hook"] = tl;</script>`;
const DEMO = `<p id="d">Crawl any site</p>
<script>const s = VM.scene("demo"); const tl = gsap.timeline({ paused: true });
tl.from("#d", { opacity: 0, duration: 0.4 }, s.at("Crawl")); window.__timelines["demo"] = tl;</script>`;

const w = (w: string, start: number, end: number) => ({ w, start, end });
const timing = {
  lines: [
    {
      id: 'l1',
      text: 'Meet Firecrawl today',
      start: 0.2,
      end: 1.4,
      words: [w('Meet', 0.2, 0.5), w('Firecrawl', 0.55, 1.1), w('today', 1.15, 1.4)],
    },
    {
      id: 'l2',
      text: 'Crawl any site',
      start: 1.8,
      end: 2.9,
      words: [w('Crawl', 1.8, 2.2), w('any', 2.25, 2.5), w('site', 2.55, 2.9)],
    },
    {
      id: 'l3',
      text: 'any site at all',
      start: 3.3,
      end: 4.5,
      words: [w('any', 3.3, 3.5), w('site', 3.55, 3.9), w('at', 3.95, 4.1), w('all', 4.15, 4.5)],
    },
  ],
};
const CUT = { anchor: '', rule: 'pause_before' } as const;
const scene = (id: string, lines: string[], assetIds: string[] = []) => ({
  scene_id: id,
  lines,
  cut_in: CUT,
  intent: 'x',
  beats: [],
  layout: { reel: 'x' },
  transition_out: 'cut',
  asset_ids: assetIds,
  input_hash: 'h',
});
const plan = (scenes: ReturnType<typeof scene>[]): Plan => ({
  run_id: 'r',
  version: 1,
  look_id: 'a',
  visuals_plan: { scenes },
  asset_ids: ['img-1'],
  formats: ['reel'],
});

// A voiceover run with hook [l1] and demo [l2, l3]; `scenes` picks which fragments exist.
const run = (opts: { timing_source?: 'voiceover' | 'text_only'; scenes?: Record<string, string> } = {}) => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-'));
  temps.push(d);
  writeFileSync(path.join(d, 'concept.md'), 'c');
  writeJson(path.join(d, 'brief.json'), BriefSchema, {
    run_id: 'r',
    concept: 'c',
    goals: [],
    duration_target_s: [5, 6],
    timing_source: opts.timing_source ?? 'voiceover',
  });
  writeJson(
    path.join(d, 'plan.json'),
    PlanSchema,
    plan([scene('hook', ['l1'], ['img-1']), scene('demo', ['l2', 'l3'])]),
  );
  writeJson(path.join(d, 'data', 'timing.json'), TimingSchema, timing);
  mkdirSync(path.join(d, 'audio'), { recursive: true });
  writeFileSync(path.join(d, 'audio', 'vo.wav'), 'RIFF');
  mkdirSync(path.join(d, 'capture', 'shots'), { recursive: true });
  writeFileSync(path.join(d, 'capture', 'shots', '1.png'), 'png');
  writeJson(path.join(d, 'assets.json'), AssetsSchema, {
    run_id: 'r',
    assets: [
      {
        asset_id: 'img-1',
        kind: 'image',
        path: 'capture/shots/1.png',
        source: 's',
        origin: 'captured',
        license: 'own capture of x',
        usage: 'render',
      },
    ],
  });
  mkdirSync(path.join(d, 'scenes'), { recursive: true });
  for (const [id, html] of Object.entries(opts.scenes ?? { hook: HOOK, demo: DEMO })) {
    writeFileSync(path.join(d, 'scenes', `${id}.html`), html);
  }
  return d;
};

test('assembleProject returns build/reel with the composition, vendor, audio and scenes files', async () => {
  const d = run();
  const out = await assembleProject(d, 'reel');
  expect(out).toBe(path.join(d, 'build', 'reel'));
  for (const f of [
    'index.html',
    'compositions/hook.html',
    'compositions/demo.html',
    'vendor/gsap.min.js',
    'vendor/vm.js',
    'assets/img-1.png',
    'vo.wav',
    'scenes.json',
  ]) {
    expect(existsSync(path.join(out, f))).toBe(true);
  }
});

test('index.html sets the frame, the audio, the scene hosts and the safe-area variables', async () => {
  const out = await assembleProject(run(), 'reel');
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  expect(html).toContain('data-width="1080" data-height="1920" data-duration="5.5"');
  expect(html).toContain('src="vo.wav"');
  expect(html).toMatch(/id="host-hook"[^>]*data-start="0" data-duration="1.6"/);
  expect(html).toMatch(/id="host-demo"[^>]*data-start="1.6" data-duration="3.9"/);
  expect(html).toContain('--vm-safe-top: 269px');
  expect(html).toContain('--vm-min-text: 68px');
});

test('a scene composition wraps its fragment unchanged', async () => {
  const out = await assembleProject(run(), 'reel');
  const html = readFileSync(path.join(out, 'compositions', 'hook.html'), 'utf8');
  expect(html.startsWith('<template><div id="scene-hook" data-composition-id="hook" data-width="1080"')).toBe(true);
  expect(html).toContain('data-height="1920" data-duration="1.6"');
  expect(html).toContain(HOOK);
});

test('vm.js inlines the timing data and scenes.json lists each scene window', async () => {
  const out = await assembleProject(run(), 'reel');
  const vm = readFileSync(path.join(out, 'vendor', 'vm.js'), 'utf8');
  expect(vm).toContain('"demo"');
  expect(vm).toContain('"Crawl"');
  expect(JSON.parse(readFileSync(path.join(out, 'scenes.json'), 'utf8'))).toEqual([
    { scene_id: 'hook', start: 0, duration: 1.6 },
    { scene_id: 'demo', start: 1.6, duration: 3.9 },
  ]);
});

test('a missing scene fragment throws InputError naming every missing scene', async () => {
  await expect(assembleProject(run({ scenes: { hook: HOOK } }), 'reel')).rejects.toThrow(/scene demo/);
  await expect(assembleProject(run({ scenes: {} }), 'reel')).rejects.toThrow(/scene hook[\s\S]*scene demo/);
  await expect(assembleProject(run({ scenes: {} }), 'reel')).rejects.toBeInstanceOf(InputError);
});

test('an invalid fragment throws InputError naming the scene and the rule, and leaves build/reel alone', async () => {
  const bad: [string, string][] = [
    ['must not contain <template>', `<template>${DEMO}</template>`],
    ['must not set data-composition-id', `<div data-composition-id="x">${DEMO}</div>`],
    ['loads from the web', `<img src="https://example.com/a.png">${DEMO}`],
    ['must register its timeline with VM.scene("demo")', '<p>Crawl any site</p>'],
  ];
  for (const [rule, html] of bad) {
    const d = run({ scenes: { hook: HOOK, demo: html } });
    mkdirSync(path.join(d, 'build', 'reel'), { recursive: true });
    writeFileSync(path.join(d, 'build', 'reel', 'old.txt'), 'keep');
    const err = await assembleProject(d, 'reel').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as Error).message).toContain(`scene demo: ${rule}`);
    expect(readFileSync(path.join(d, 'build', 'reel', 'old.txt'), 'utf8')).toBe('keep');
  }
});

test('a text_only run throws UnsupportedError', async () => {
  await expect(assembleProject(run({ timing_source: 'text_only' }), 'reel')).rejects.toBeInstanceOf(UnsupportedError);
});

test('a rebuild replaces the old build folder', async () => {
  const d = run();
  mkdirSync(path.join(d, 'build', 'reel'), { recursive: true });
  writeFileSync(path.join(d, 'build', 'reel', 'stale.txt'), 'old');
  const out = await assembleProject(d, 'reel');
  expect(existsSync(path.join(out, 'stale.txt'))).toBe(false);
  expect(existsSync(path.join(out, 'index.html'))).toBe(true);
});
