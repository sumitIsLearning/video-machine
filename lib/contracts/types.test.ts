import { expect, test } from 'bun:test';
import {
  AssetRefSchema,
  AssetsSchema,
  BriefSchema,
  CaptureLogSchema,
  DEFAULT_VOICE,
  DOCTOR_TOOLS,
  DoctorSchema,
  DURATION_DEFAULTS,
  failingTools,
  frameOf,
  NavFramesSchema,
  PageCaptureSchema,
  PlanSchema,
  RunPathSchema,
  ScenePlanSchema,
  ScriptSchema,
  StepsSchema,
  TestResultsSchema,
} from './types';

test('frameOf gives the reel frame as vertical 1080x1920 with its safe area', () => {
  expect(frameOf('reel')).toEqual({
    w: 1080,
    h: 1920,
    aspect: 'vertical',
    safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 },
  });
});

const line = { id: 'l1', text: 'Ship faster.' };
const script = (lines: object[]) => ({ run_id: 'r', version: 1, lines });

test('script lines default to voiceover delivery', () => {
  expect(ScriptSchema.parse(script([line])).lines[0]?.delivery).toBe('voiceover');
});

test('script lines accept avatar delivery and reject anything else', () => {
  expect(ScriptSchema.parse(script([{ ...line, delivery: 'avatar' }])).lines[0]?.delivery).toBe('avatar');
  expect(ScriptSchema.safeParse(script([{ ...line, delivery: 'narrator' }])).success).toBe(false);
});

const scene = {
  scene_id: 'hook',
  lines: ['l1'],
  cut_in: { anchor: 'Ship', rule: 'on_word' },
  intent: 'open strong',
  beats: [],
  layout: {},
  transition_out: 'cut',
  asset_ids: [],
  input_hash: 'abc',
};

test('a scene plan is keyed by scene_id, not plate_id', () => {
  expect(ScenePlanSchema.parse(scene).scene_id).toBe('hook');
  const { scene_id, ...rest } = scene;
  expect(ScenePlanSchema.safeParse({ ...rest, plate_id: scene_id }).success).toBe(false);
});

test('plan.visuals_plan holds scenes, not plates', () => {
  const plan = { run_id: 'r', version: 1, look_id: 'a', asset_ids: [], formats: ['reel'] };
  expect(PlanSchema.safeParse({ ...plan, visuals_plan: { scenes: [scene] } }).success).toBe(true);
  expect(PlanSchema.safeParse({ ...plan, visuals_plan: { plates: [scene] } }).success).toBe(false);
});

test('check annotations point at a scene_id', () => {
  const results = TestResultsSchema.parse({
    run_id: 'r',
    plan_version: 1,
    output_paths: { stills: {}, contact_sheets: {}, drafts: {}, deliverables: [], report: 'report.md' },
    checks: [
      {
        id: 'layout.safe_area',
        blocking: true,
        status: 'fail',
        detail: '1 box outside',
        annotations: [{ scene_id: 'hook', t: 1.2, problem: 'title under the caption bar', suggested_fix: 'move up' }],
      },
    ],
    summary: { blocking_failed: 1, warnings: 0 },
  });
  expect(results.checks[0]?.annotations[0]?.scene_id).toBe('hook');
});

const brief = { run_id: 'r', concept: 'c', goals: [], duration_target_s: [15, 30], timing_source: 'voiceover' };

test('brief formats default to reel only', () => {
  expect(BriefSchema.parse(brief).formats).toEqual(['reel']);
});

test('a concept alone is a valid brief: sources default to empty', () => {
  expect(BriefSchema.parse(brief).sources).toEqual([]);
});

test('brief takes any mix of sources', () => {
  const sources = [
    { kind: 'nav_video', path_or_url: 'input/nav.mp4' },
    { kind: 'product_url', path_or_url: 'https://app.example.com/login' },
    { kind: 'file', path_or_url: 'input/logo.svg', note: 'logo' },
    { kind: 'link', path_or_url: 'http://blog.example.com/launch', note: 'competitor' },
  ];
  expect(BriefSchema.parse({ ...brief, sources }).sources).toHaveLength(4);
});

test('brief rejects a product_url or link source that is not an http(s) URL', () => {
  for (const kind of ['product_url', 'link']) {
    for (const bad of ['app dot example', 'file:///C:/Users/me/secrets.txt', 'javascript:alert(1)']) {
      expect(BriefSchema.safeParse({ ...brief, sources: [{ kind, path_or_url: bad }] }).success).toBe(false);
    }
  }
});

test('brief rejects an unknown source kind and an empty path', () => {
  expect(BriefSchema.safeParse({ ...brief, sources: [{ kind: 'dream', path_or_url: 'x' }] }).success).toBe(false);
  expect(BriefSchema.safeParse({ ...brief, sources: [{ kind: 'file', path_or_url: '' }] }).success).toBe(false);
});

test('brief no longer has source_material, assets or references', () => {
  expect(BriefSchema.safeParse({ ...brief, source_material: ['a'], assets: ['b'], references: [] }).success).toBe(
    false,
  );
});

test('a misspelt key is rejected rather than dropped', () => {
  expect(BriefSchema.safeParse({ ...brief, format: ['reel'] }).success).toBe(false);
});

test('unknown keys are rejected in nested objects too', () => {
  expect(BriefSchema.safeParse({ ...brief, cta: { text: 'Go', link: 'x' } }).success).toBe(false);
  expect(ScriptSchema.safeParse(script([{ ...line, speaker: 'me' }])).success).toBe(false);
  expect(ScenePlanSchema.safeParse({ ...scene, cut_in: { anchor: 'a', rule: 'on_word', extra: 1 } }).success).toBe(
    false,
  );
});

test('script line ids must be unique', () => {
  const dup = ScriptSchema.safeParse(script([line, { ...line, text: 'Again.' }]));
  expect(dup.success).toBe(false);
  expect(dup.error?.issues.map((i) => i.message)).toEqual(['duplicate id "l1"']);
});

test('scene ids must be unique within a plan', () => {
  const plan = { run_id: 'r', version: 1, look_id: 'a', asset_ids: [], formats: ['reel'] };
  const dup = PlanSchema.safeParse({ ...plan, visuals_plan: { scenes: [scene, scene] } });
  expect(dup.success).toBe(false);
  expect(dup.error?.issues.map((i) => i.message)).toEqual(['duplicate scene_id "hook"']);
});

test('section ids must be unique within a plan', () => {
  const plan = { run_id: 'r', version: 1, look_id: 'a', asset_ids: [], formats: ['reel'] };
  const sections = [
    { id: 'intro', title: 'A' },
    { id: 'intro', title: 'B' },
  ];
  const dup = PlanSchema.safeParse({ ...plan, sections, visuals_plan: { scenes: [scene] } });
  expect(dup.success).toBe(false);
  expect(dup.error?.issues.map((i) => i.message)).toEqual(['duplicate section id "intro"']);
});

test('script lines take a section and http(s) cite URLs', () => {
  const parsed = ScriptSchema.parse(script([{ ...line, section: 'intro', cite: ['https://example.com/stats'] }]));
  expect(parsed.lines[0]?.cite).toEqual(['https://example.com/stats']);
  for (const bad of ['not a url', 'file:///C:/x', 'javascript:alert(1)', 'ftp://a.com']) {
    expect(ScriptSchema.safeParse(script([{ ...line, cite: [bad] }])).success).toBe(false);
  }
  expect(ScriptSchema.safeParse(script([{ ...line, cite: [] }])).success).toBe(false);
});

test('plan sections are optional, and a scene may only name a declared section', () => {
  const plan = { run_id: 'r', version: 1, look_id: 'a', asset_ids: [], formats: ['reel'] };
  const sections = [{ id: 'intro', title: 'Why it matters' }];
  const inIntro = { ...scene, section: 'intro' };
  expect(PlanSchema.safeParse({ ...plan, sections, visuals_plan: { scenes: [inIntro] } }).success).toBe(true);
  expect(PlanSchema.safeParse({ ...plan, visuals_plan: { scenes: [inIntro] } }).success).toBe(false);
  expect(PlanSchema.safeParse({ ...plan, sections: [], visuals_plan: { scenes: [scene] } }).success).toBe(false);
});

const asset = {
  asset_id: 'a1',
  kind: 'image',
  path: 'capture/shots/1.png',
  source: 'replay',
  license: 'own',
  usage: 'render',
};

test('every asset records where it came from', () => {
  for (const origin of ['supplied', 'nav_video', 'captured', 'web', 'found', 'drawn'] as const) {
    expect(AssetRefSchema.parse({ ...asset, origin }).origin).toBe(origin);
  }
  expect(AssetRefSchema.safeParse(asset).success).toBe(false);
  expect(AssetRefSchema.safeParse({ ...asset, origin: 'ai' }).success).toBe(false);
});

test('brief takes an optional avatar with a known source', () => {
  expect(BriefSchema.parse({ ...brief, avatar: { source: 'supplied', portrait: 'input/me.png' } }).avatar?.source).toBe(
    'supplied',
  );
  expect(BriefSchema.safeParse({ ...brief, avatar: { source: 'magic' } }).success).toBe(false);
});

const step = (i: number, extra: object = {}) => ({
  i,
  url: 'https://app.example.com',
  action: 'click',
  target: 'Export',
  expect: 'dialog opens',
  ...extra,
});

test('a step url must be http(s), since the replay opens it', () => {
  for (const bad of ['file:///C:/x', 'javascript:alert(1)']) {
    expect(StepsSchema.safeParse([step(0, { url: bad })]).success).toBe(false);
  }
});

test('urls carrying a username or password are rejected', () => {
  const bad = 'https://user:pw@a.com/x';
  expect(BriefSchema.safeParse({ ...brief, sources: [{ kind: 'product_url', path_or_url: bad }] }).success).toBe(false);
  expect(ScriptSchema.safeParse(script([{ ...line, cite: [bad] }])).success).toBe(false);
});

test('steps parse a click and a type with a value', () => {
  expect(StepsSchema.parse([step(0), step(1, { action: 'type', target: 'Name', value: 'Q3 report' })])).toHaveLength(2);
});

test('a type step without a value is rejected', () => {
  expect(StepsSchema.safeParse([step(0, { action: 'type' })]).success).toBe(false);
});

test('step numbers must go up', () => {
  expect(StepsSchema.safeParse([step(0), step(0)]).success).toBe(false);
  expect(StepsSchema.safeParse([step(1), step(0)]).success).toBe(false);
});

test('an unknown step action is rejected', () => {
  expect(StepsSchema.safeParse([step(0, { action: 'hover' })]).success).toBe(false);
});

const entry = { i: 0, t0: 1.2, t1: 3.4, url: 'https://app.example.com' };

test('capture log entries take an optional box, failure reason and fallback', () => {
  const log = CaptureLogSchema.parse([
    entry,
    {
      ...entry,
      i: 1,
      t0: 3.4,
      t1: 3.4,
      failed: 'target "Export" not found',
      fallback: 'capture/nav/nav/frames/012.png',
    },
    { ...entry, i: 2, box: { x: 10, y: 20, w: 300, h: 40 } },
  ]);
  expect(log[1]?.failed).toContain('Export');
});

test('a capture log entry cannot end before it starts', () => {
  expect(CaptureLogSchema.safeParse([{ ...entry, t0: 5, t1: 4 }]).success).toBe(false);
});

test('doctor.json records tool versions, paths and smoke timings', () => {
  const d = DoctorSchema.parse({
    checked_at: '2026-10-09T17:00:00Z',
    tools: {
      hyperframes: { ok: true, version: '0.8.143' },
      ffmpeg: { ok: true, version: '9.0', path: 'C:/ffmpeg/bin/ffmpeg.exe' },
      whisper: { ok: false, detail: 'not installed' },
    },
    smoke_s: { draft_render: 15.2 },
  });
  expect(d.tools.hyperframes?.version).toBe('0.8.143');
  expect(DoctorSchema.safeParse({ checked_at: 'yesterday', tools: {}, smoke_s: {} }).success).toBe(false);
});

test('a doctor record missing a required tool lists it as failing', () => {
  const tools = Object.fromEntries(DOCTOR_TOOLS.map((t) => [t, { ok: true }]));
  delete tools.parakeet;
  const d = DoctorSchema.parse({ checked_at: '2026-10-09T17:00:00Z', tools, smoke_s: {} });
  expect(failingTools(d)).toEqual(['parakeet']);
});

test('the doctor checks the capture browser', () => {
  expect(DOCTOR_TOOLS).toContain('capture_browser');
});

test('run paths are relative POSIX paths inside the run folder', () => {
  for (const ok of ['input/nav.mp4', 'capture/clips/3.mp4', 'concept.md'])
    expect(RunPathSchema.safeParse(ok).success).toBe(true);
  for (const bad of [
    './input/a.png',
    'input//a.mp4',
    'input/a.mp4/',
    '',
    '..',
    '../x.mp4',
    'input/../../x.mp4',
    'C:/Users/me/a.mp4',
    'c:a.mp4',
    '/etc/passwd',
    'input\\a.mp4',
    'C:\\a.mp4',
    '.',
    './',
    'a/..',
    'input/\0x',
    'input/a.mp4:s',
  ])
    expect(RunPathSchema.safeParse(bad).success).toBe(false);
});

const abs = 'C:/Users/me/x.mp4';
test.each([
  ['sources nav_video', { sources: [{ kind: 'nav_video', path_or_url: abs }] }],
  ['sources file', { sources: [{ kind: 'file', path_or_url: '../x.png' }] }],
  ['voice.path', { voice: { source: 'supplied', path: abs } }],
  ['music.path', { music: { source: 'supplied', path: '/music.wav' } }],
  ['avatar.portrait', { avatar: { source: 'supplied', portrait: abs } }],
  ['brand.logo', { brand: { logo: abs } }],
  ['brand.fonts[].path', { brand: { fonts: [{ family: 'Inter', path: '..\\Inter.ttf', license: 'OFL' }] } }],
])('a brief refuses a non-run path in %s', (_field, extra) => {
  expect(BriefSchema.safeParse({ ...brief, ...extra }).success).toBe(false);
});

test('a brief with a run path in every creator-file field is valid', () => {
  const good = {
    ...brief,
    sources: [{ kind: 'nav_video', path_or_url: 'input/nav.mp4' }],
    voice: { source: 'supplied', path: 'input/vo.wav' },
    music: { source: 'supplied', path: 'input/m.wav' },
    avatar: { source: 'supplied', portrait: 'input/me.png' },
    brand: { logo: 'input/logo.svg', fonts: [{ family: 'Inter', path: 'input/Inter.ttf', license: 'OFL' }] },
  };
  expect(BriefSchema.safeParse(good).success).toBe(true);
});

test('asset paths and capture fallbacks are run paths', () => {
  expect(AssetRefSchema.safeParse({ ...asset, origin: 'captured', path: 'C:/shots/1.png' }).success).toBe(false);
  expect(CaptureLogSchema.safeParse([{ ...entry, fallback: '../nav/0012.png' }]).success).toBe(false);
});

test('intake defaults: a reel runs 15 to 30 s with the Kokoro af_heart voice', () => {
  expect(DURATION_DEFAULTS.reel).toEqual([15, 30]);
  expect(DURATION_DEFAULTS.landscape_1080p).toBeUndefined();
  expect(BriefSchema.parse({ ...brief, voice: DEFAULT_VOICE }).voice).toEqual({
    source: 'tts',
    adapter: 'hf-tts',
    voice_id: 'af_heart',
  });
});

test('an asset defaults to the pool and takes a pin or a drop, nothing else', () => {
  expect(AssetRefSchema.parse({ ...asset, origin: 'found' }).status).toBe('pool');
  for (const status of ['pinned', 'dropped'] as const)
    expect(AssetRefSchema.parse({ ...asset, origin: 'found', status }).status).toBe(status);
  expect(AssetRefSchema.safeParse({ ...asset, origin: 'found', status: 'maybe' }).success).toBe(false);
});

test('a found asset keeps its attribution', () => {
  const a = AssetRefSchema.parse({
    ...asset,
    origin: 'found',
    license: 'CC BY 2.0',
    attribution: '"Tests" by L. Hardy',
  });
  expect(a.attribution).toContain('Hardy');
});

test('assets.json holds one pool with unique ids', () => {
  const a = { ...asset, origin: 'found' };
  expect(AssetsSchema.parse({ run_id: 'r', assets: [a] }).assets).toHaveLength(1);
  const dup = AssetsSchema.safeParse({ run_id: 'r', assets: [a, a] });
  expect(dup.success).toBe(false);
  expect(JSON.stringify(dup.error?.issues)).toContain(`duplicate asset_id \\"${a.asset_id}\\"`);
  expect(dup.error?.issues[0]?.path).toEqual(['assets', 1]);
});

test('a step may name the nav frame it was read from, as a run path', () => {
  expect(StepsSchema.parse([step(0, { frame: 'capture/nav/nav/frames/003.png' })])[0]?.frame).toBe(
    'capture/nav/nav/frames/003.png',
  );
  expect(StepsSchema.safeParse([step(0, { frame: 'C:/frames/3.png' })]).success).toBe(false);
});

const nav = {
  source: 'input/nav.mp4',
  has_audio: false,
  frames: [
    { i: 0, t: 0, path: 'capture/nav/nav/frames/000.png' },
    { i: 1, t: 2, path: 'capture/nav/nav/frames/001.png' },
  ],
  sheets: ['capture/nav/nav/sheet-01.jpg'],
};

test('nav frames record the source, frames in order, sheets and an optional transcript', () => {
  expect(NavFramesSchema.parse(nav).transcript).toBeUndefined();
  expect(
    NavFramesSchema.parse({ ...nav, has_audio: true, transcript: 'capture/nav/nav/transcript.json' }).transcript,
  ).toBe('capture/nav/nav/transcript.json');
  expect(NavFramesSchema.safeParse({ ...nav, frames: [] }).success).toBe(false);
});

test.each([
  ['a repeated frame index', { frames: [nav.frames[0], { ...nav.frames[1], i: 0 }] }],
  ['a frame index that skips', { frames: [nav.frames[0], { ...nav.frames[1], i: 2 }] }],
  ['a falling frame time', { frames: [{ ...nav.frames[0], t: 3 }, nav.frames[1]] }],
  ['a repeated frame time', { frames: [nav.frames[0], { ...nav.frames[1], t: 0 }] }],
  ['a transcript with no audio', { transcript: 'capture/nav/nav/transcript.json' }],
])('nav frames reject %s', (_label, change) => {
  expect(NavFramesSchema.safeParse({ ...nav, ...change }).success).toBe(false);
});

const page = {
  url: 'https://docs.astral.sh/uv/',
  title: 'uv',
  dir: 'capture/pages/docs-astral-sh-uv',
  screenshots: ['capture/pages/docs-astral-sh-uv/screenshots/scroll-000.png'],
  logos: ['capture/pages/docs-astral-sh-uv/assets/logo-4b5009c7.svg'],
  fonts: [{ family: 'Roboto', path: 'capture/pages/docs-astral-sh-uv/assets/fonts/a.woff2' }],
  palette: [{ hex: '#261230', bg: 1, text: 0 }],
};

test('a page capture lists screenshots, logos, fonts and palette by run path', () => {
  expect(PageCaptureSchema.parse(page).palette[0]?.hex).toBe('#261230');
  expect(PageCaptureSchema.safeParse({ ...page, url: 'file:///x' }).success).toBe(false);
});

test.each([
  ['assets.json top level', AssetsSchema, { run_id: 'r', assets: [], extra: 1 }],
  [
    'an asset with the new fields',
    AssetRefSchema,
    { ...asset, origin: 'found', status: 'pool', attribution: 'a', title: 't', extra: 1 },
  ],
  ['nav frames top level', NavFramesSchema, { ...nav, extra: 1 }],
  ['a nav frames entry', NavFramesSchema, { ...nav, frames: [{ ...nav.frames[0], extra: 1 }] }],
  ['page capture top level', PageCaptureSchema, { ...page, extra: 1 }],
  ['a page capture font', PageCaptureSchema, { ...page, fonts: [{ ...page.fonts[0], extra: 1 }] }],
  ['a page capture palette entry', PageCaptureSchema, { ...page, palette: [{ ...page.palette[0], extra: 1 }] }],
])('a misspelt key is rejected in %s', (_label, schema, value) => {
  expect(schema.safeParse(value).success).toBe(false);
});

test.each([
  ['nav source', NavFramesSchema, { ...nav, source: 'C:/x.png' }],
  ['nav frame path', NavFramesSchema, { ...nav, frames: [{ ...nav.frames[0], path: '..\\x.png' }, nav.frames[1]] }],
  ['nav sheet', NavFramesSchema, { ...nav, sheets: ['C:/x.png'] }],
  ['nav transcript', NavFramesSchema, { ...nav, has_audio: true, transcript: '..\\x.json' }],
  ['page dir', PageCaptureSchema, { ...page, dir: 'C:/x' }],
  ['page screenshot', PageCaptureSchema, { ...page, screenshots: ['..\\x.png'] }],
  ['page logo', PageCaptureSchema, { ...page, logos: ['C:/x.svg'] }],
  ['page font path', PageCaptureSchema, { ...page, fonts: [{ family: 'Roboto', path: '..\\a.woff2' }] }],
])('an absolute or escaping path is rejected in %s', (_label, schema, value) => {
  expect(schema.safeParse(value).success).toBe(false);
});
