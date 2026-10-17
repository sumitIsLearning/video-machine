// Data contracts for the Video Machine (spec §3) and adapter contracts (§4).
// Every JSON file the skill writes goes through writeJson/readJson: a failed parse is an error, never a warning.

import path from 'node:path';
import { z } from 'zod';

// ------------------------------------------------------------------ formats
export const FormatIdSchema = z.enum(['landscape_1080p', 'reel', 'square', 'portrait_feed']);
export type FormatId = z.infer<typeof FormatIdSchema>;

export const DirectionIdSchema = z.enum(['A', 'B']);
export type DirectionId = z.infer<typeof DirectionIdSchema>;
export const BoardIdSchema = z.enum(['hook', 'product', 'ending']);
export type BoardId = z.infer<typeof BoardIdSchema>;

type Safe = { top: number; bottom: number; left: number; right: number };
/** Fixed table; adding a format = one line here (and one in FormatIdSchema). */
export const FORMATS: Record<FormatId, { w: number; h: number; fps: number; safe: Safe }> = {
  landscape_1080p: { w: 1920, h: 1080, fps: 30, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
  reel: { w: 1080, h: 1920, fps: 30, safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 } },
  square: { w: 1080, h: 1080, fps: 30, safe: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 } },
  portrait_feed: { w: 1080, h: 1350, fps: 30, safe: { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 } },
};

/** What a scene lays itself out against (§7). */
export type Frame = { w: number; h: number; aspect: 'landscape' | 'vertical' | 'square'; safe: Safe };
/** The frame (size, aspect, safe area) of a format. Returns a new object; never throws for a valid FormatId. */
export const frameOf = (f: FormatId): Frame => {
  const { w, h, safe } = FORMATS[f];
  return { w, h, safe, aspect: w > h ? 'landscape' : w < h ? 'vertical' : 'square' };
};

/** Intake fills `duration_target_s` from the first format when the creator gives none (BLUEPRINT 2.7). */
// ponytail: reel only; long-form defaults come with Phase 9.
export const DURATION_DEFAULTS: Partial<Record<FormatId, [number, number]>> = { reel: [15, 30] };

const formatRecord = <T extends z.ZodType>(v: T) => z.partialRecord(FormatIdSchema, v);
// No credentials in URLs: they would leak into run folders and logs.
const httpUrl = z.url({ protocol: /^https?$/ }).refine((u) => {
  // zod runs this even when the url check failed, so unparseable input must pass through to that error
  if (!URL.canParse(u)) return true;
  const { username, password } = new URL(u);
  return !username && !password;
}, 'URL must not contain a username or password');

// Paths inside run-folder JSON are run-relative POSIX paths (AGENT_PROMPT §9): never absolute, never climbing out.
export const RunPathSchema = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.includes('\\') &&
      !p.includes('\0') &&
      !p.includes(':') && // drive letters and Windows alternate data streams (a.mp4:s)
      !p.startsWith('/') &&
      !p.split('/').includes('..') &&
      !p.endsWith('/') &&
      path.posix.normalize(p) === p && // canonical: no ".", "./x", "a//b"; also rejects the run folder itself
      p !== '.',
    'must be a canonical run-relative POSIX path to a file (no "..", ":", NUL, leading "/", backslash, "./", "//", trailing "/", or the run folder itself)',
  );

// Every schema for a file Claude writes is strict (z.strictObject): a misspelt key is an error, not silently dropped.
const addDuplicateIssues = (ids: string[], label: string, ctx: z.core.$RefinementCtx, path: (string | number)[]) => {
  const seen = new Set<string>();
  ids.forEach((id, k) => {
    if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate ${label} "${id}"`, path: [...path, k] });
    seen.add(id);
  });
};

// ------------------------------------------------------------------ brief
export const DeliverableSchema = z.strictObject({
  format: FormatIdSchema,
  kind: z.enum(['mp4_h264', 'mov_prores4444', 'png_sequence', 'webm', 'gif', 'srt', 'ae_package']),
  captions: z.enum(['burned', 'separate', 'none']),
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

// brief.sources: whatever the creator handed over besides concept.md (BLUEPRINT 1.6 Inputs). Empty = concept only.
export const SourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['nav_video', 'file']), path_or_url: RunPathSchema, note: z.string().optional() }),
  z.strictObject({ kind: z.enum(['product_url', 'link']), path_or_url: httpUrl, note: z.string().optional() }),
]);
export type Source = z.infer<typeof SourceSchema>;

export const BriefSchema = z.strictObject({
  run_id: z.string().min(1),
  concept: z.string().min(1),
  goals: z.array(z.string()),
  audience: z.string().optional(),
  tone: z.string().optional(),
  duration_target_s: z.tuple([z.number().positive(), z.number().positive()]).refine(([a, b]) => a <= b, 'min > max'),
  timing_source: z.enum(['voiceover', 'music', 'text_only']),
  voice: z
    .discriminatedUnion('source', [
      z.strictObject({ source: z.literal('supplied'), path: RunPathSchema }),
      z.strictObject({ source: z.literal('tts'), adapter: z.string(), voice_id: z.string() }),
    ])
    .optional(),
  music: z
    .discriminatedUnion('source', [
      z.strictObject({ source: z.literal('supplied'), path: RunPathSchema }),
      z.strictObject({ source: z.literal('adapter'), adapter: z.string(), query: z.string() }),
    ])
    .optional(),
  formats: z.array(FormatIdSchema).min(1).default(['reel']),
  deliverables: z.array(DeliverableSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  // ponytail: Phase 8 decides where a supplied avatar clip's path lives; only the portrait is modelled now.
  avatar: z
    .strictObject({
      source: z.enum(['adapter', 'supplied']),
      adapter: z.string().optional(),
      portrait: RunPathSchema.optional(),
    })
    .optional(),
  look_hint: z.string().optional(),
  brand: z
    .strictObject({
      logo: RunPathSchema.optional(),
      colors: z
        .array(
          z.strictObject({
            hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            role: z.enum(['bg', 'fg', 'accent', 'muted']).optional(),
          }),
        )
        .optional(),
      fonts: z
        .array(z.strictObject({ family: z.string(), path: RunPathSchema.optional(), license: z.string().min(1) }))
        .optional(),
    })
    .optional(),
  cta: z.strictObject({ text: z.string(), url_or_handle: z.string().optional() }).optional(),
  must_include: z.array(z.string()).optional(),
  must_avoid: z.array(z.string()).optional(),
  budget_usd: z.number().min(0).default(0),
});
export type Brief = z.infer<typeof BriefSchema>;

/** The default voice when the timing source is a voiceover (BLUEPRINT 2.7): Kokoro through HyperFrames. */
export const DEFAULT_VOICE = { source: 'tts', adapter: 'hf-tts', voice_id: 'af_heart' } as const;

// ------------------------------------------------------------------ script
export const ScriptSchema = z
  .strictObject({
    run_id: z.string(),
    version: z.number().int().min(1),
    lines: z
      .array(
        z.strictObject({
          id: z.string(),
          text: z.string().min(1), // what is said (or shown, if text_only)
          // how TTS reads the line (M9), e.g. "5.5" → "five point five"; the aligner (M10) aligns `text` and takes a
          // per-word `spokenWords` map built by its caller
          spoken: z.string().optional(),
          on_screen: z.string().optional(),
          delivery: z.enum(['voiceover', 'avatar']).default('voiceover'),
          section: z.string().min(1).optional(),
          cite: z.array(httpUrl).min(1).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((script, ctx) =>
    addDuplicateIssues(
      script.lines.map((l) => l.id),
      'id',
      ctx,
      ['lines'],
    ),
  );
export type Script = z.infer<typeof ScriptSchema>;

// ------------------------------------------------------------------ look
export const LookSchema = z.strictObject({
  id: z.string(),
  based_on: z.array(z.string()),
  idea: z.string(),
  palette: z
    .array(
      z.strictObject({
        name: z.string(),
        hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        role: z.enum(['bg', 'fg', 'accent', 'muted']),
      }),
    )
    .min(1),
  type: z
    .array(
      z.strictObject({
        role: z.enum(['display', 'body', 'mono', 'label']),
        family: z.string(),
        weights: z.array(z.number()),
        license: z.string().min(1),
      }),
    )
    .min(1),
  motion: z.strictObject({
    character: z.string(),
    easings: z.array(z.string()),
    typical_beat_s: z.tuple([z.number(), z.number()]),
    camera: z.string(),
  }),
  motifs: z.array(z.strictObject({ id: z.string(), meaning: z.string(), code: z.string().optional() })),
  post: z.record(z.string(), z.number()),
  layout_rules: z.strictObject({ landscape: z.string(), vertical: z.string(), square: z.string() }),
});
export type Look = z.infer<typeof LookSchema>;

// ------------------------------------------------------------------ plan
export const ScenePlanSchema = z.strictObject({
  scene_id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  section: z.string().optional(),
  lines: z.array(z.string()).min(1),
  cut_in: z.strictObject({ anchor: z.string(), rule: z.enum(['pause_before', 'on_word', 'on_beat']) }),
  intent: z.string(),
  beats: z.array(
    z.strictObject({
      on: z.string(), // word/phrase found by content, or "beat:12"
      nth: z.number().int().min(0).optional(),
      does: z.string(),
      motif: z.string().optional(),
      hold: z.boolean().optional(),
    }),
  ),
  layout: formatRecord(z.string()),
  transition_out: z.string(),
  asset_ids: z.array(z.string()),
  overrides: z.string().optional(),
  input_hash: z.string(),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const PlanSchema = z
  .strictObject({
    run_id: z.string(),
    version: z.number().int().min(1),
    look_id: z.string(),
    // Long-form (Phase 9) fills sections; reels leave them out.
    sections: z
      .array(z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9_-]*$/), title: z.string().min(1) }))
      .min(1)
      .optional(),
    visuals_plan: z.strictObject({ scenes: z.array(ScenePlanSchema).min(1) }),
    asset_ids: z.array(z.string()),
    formats: z.array(FormatIdSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    addDuplicateIssues(
      plan.visuals_plan.scenes.map((s) => s.scene_id),
      'scene_id',
      ctx,
      ['visuals_plan', 'scenes'],
    );
    addDuplicateIssues(
      (plan.sections ?? []).map((s) => s.id),
      'section id',
      ctx,
      ['sections'],
    );
    const known = new Set(plan.sections?.map((s) => s.id));
    plan.visuals_plan.scenes.forEach((s, k) => {
      if (s.section === undefined || known.has(s.section)) return;
      ctx.addIssue({
        code: 'custom',
        message: `scene "${s.scene_id}" names unknown section "${s.section}"`,
        path: ['visuals_plan', 'scenes', k, 'section'],
      });
    });
  });
export type Plan = z.infer<typeof PlanSchema>;

// ------------------------------------------------------------------ review

export const FeedbackSchema = z.strictObject({
  n: z.number().int().min(1),
  at: z.string(),
  text: z.string().min(1),
  route: z.enum(['words', 'plan', 'scenes']),
  scenes: z.array(z.string()),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

/** `scenes/redo.json`: scene id to the feedback note for it. */
export const SceneNotesSchema = z.record(z.string(), z.string());

/** `scenes/hashes.json`: scene id to its input hash. */
export const SceneHashesSchema = z.record(z.string(), z.string());

// ------------------------------------------------------------------ assets
export const AssetRefSchema = z.strictObject({
  asset_id: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'font', 'svg', 'data']),
  path: RunPathSchema,
  source: z.string(),
  license: z.string(),
  usage: z.enum(['render', 'reference_only']),
  origin: z.enum(['supplied', 'nav_video', 'captured', 'web', 'found', 'drawn']),
  status: z.enum(['pool', 'pinned', 'dropped']).default('pool'),
  attribution: z.string().min(1).optional(),
  title: z.string().optional(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

// assets.json: the one pool of everything gathered, with the creator's pin and drop marks.
export const AssetsSchema = z
  .strictObject({ run_id: z.string().min(1), assets: z.array(AssetRefSchema) })
  .superRefine((pool, ctx) =>
    addDuplicateIssues(
      pool.assets.map((a) => a.asset_id),
      'asset_id',
      ctx,
      ['assets'],
    ),
  );
export type Assets = z.infer<typeof AssetsSchema>;

// ------------------------------------------------------------------ timing
// data/timing.json: the aligner's word-timed format (what align_vo.py writes as lyrics.json).
// Plain z.object (not strict) on purpose: this is aligner output, not a file Claude writes.
const WordTimingSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
  syl: z.array(z.tuple([z.number(), z.number()])).optional(),
  conf: z.number().optional(),
});
export const TimingSchema = z.object({
  source: z.string().optional(),
  lines: z.array(
    z.object({
      id: z.string().optional(),
      text: z.string(),
      start: z.number(),
      end: z.number(),
      words: z.array(WordTimingSchema),
    }),
  ),
  beats: z.array(z.number()).optional(),
});
export type Timing = z.infer<typeof TimingSchema>;

// ------------------------------------------------------------------ capture
// capture/steps.json: the replay script for the product walk-through.
const StepSchema = z
  .strictObject({
    i: z.number().int().min(0),
    url: httpUrl, // the replay opens it
    action: z.enum(['click', 'type', 'scroll', 'wait']),
    target: z.string(),
    value: z.string().optional(),
    expect: z.string(),
    frame: RunPathSchema.optional(), // the nav-video frame this step was read from; the replay falls back to it
  })
  .refine((s) => s.action !== 'type' || s.value !== undefined, {
    message: 'a type step needs a value',
    path: ['value'],
  });
export const StepsSchema = z
  .array(StepSchema)
  .refine((steps) => steps.every((s, k) => k === 0 || s.i > (steps[k - 1]?.i ?? -1)), 'step numbers must go up');
export type Steps = z.infer<typeof StepsSchema>;

// capture/nav/<name>/frames.json: the nav video read into numbered frames and contact sheets (M2).
export const NavFramesSchema = z
  .strictObject({
    source: RunPathSchema,
    has_audio: z.boolean(),
    frames: z.array(z.strictObject({ i: z.number().int().min(0), t: z.number().min(0), path: RunPathSchema })).min(1),
    sheets: z.array(RunPathSchema).min(1),
    transcript: RunPathSchema.optional(),
  })
  .superRefine((nav, ctx) => {
    // `i` is the contact-sheet tile index, so it must equal the array position
    nav.frames.forEach((f, k) => {
      if (f.i !== k) ctx.addIssue({ code: 'custom', message: `frame ${k} has i ${f.i}`, path: ['frames', k, 'i'] });
      if (k > 0 && f.t <= (nav.frames[k - 1]?.t ?? 0))
        ctx.addIssue({ code: 'custom', message: `frame ${k} time does not rise`, path: ['frames', k, 't'] });
    });
    if (nav.transcript !== undefined && !nav.has_audio)
      ctx.addIssue({ code: 'custom', message: 'a transcript needs has_audio', path: ['transcript'] });
  });
export type NavFrames = z.infer<typeof NavFramesSchema>;

// capture/pages/<slug>.json: what a page capture (M5) kept of a web page. The folder capture/pages/<slug>/ beside it
// is HyperFrames' own output.
export const PageCaptureSchema = z.strictObject({
  url: httpUrl,
  title: z.string(),
  dir: RunPathSchema,
  screenshots: z.array(RunPathSchema),
  logos: z.array(RunPathSchema),
  fonts: z.array(z.strictObject({ family: z.string(), path: RunPathSchema })),
  palette: z.array(
    z.strictObject({
      hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      bg: z.number().int().min(0),
      text: z.number().int().min(0),
    }),
  ),
});
export type PageCapture = z.infer<typeof PageCaptureSchema>;

// capture/log.json: what the replay did for each step. Times are seconds on the replay recording
// (capture/replay.webm), which is what cuts the clips; `fallback` is the nav frame used instead of a failed step.
export const CaptureLogSchema = z.array(
  z
    .strictObject({
      i: z.number().int().min(0),
      t0: z.number().min(0),
      t1: z.number().min(0),
      box: z
        .strictObject({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
        .optional(),
      url: z.string(),
      failed: z.string().optional(), // why the step failed, in words
      fallback: RunPathSchema.optional(), // run-relative path of the nav-video frame used instead
    })
    .refine((e) => e.t1 >= e.t0, { message: 't1 is before t0', path: ['t1'] }),
);
export type CaptureLog = z.infer<typeof CaptureLogSchema>;

// ~/.video-machine/doctor.json (VM_HOME, never in a run folder): tool versions and smoke-render timings.
export const DoctorSchema = z.strictObject({
  checked_at: z.iso.datetime(),
  tools: z.record(
    z.string(),
    z.strictObject({
      ok: z.boolean(),
      version: z.string().optional(),
      path: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
  smoke_s: z.record(z.string(), z.number().min(0)),
});
export type Doctor = z.infer<typeof DoctorSchema>;

/** The tools the doctor must report on. */
export const DOCTOR_TOOLS = [
  'node',
  'ffmpeg',
  'ffprobe',
  'uv',
  'hyperframes',
  'chrome',
  'kokoro',
  'venv',
  'aligner_model',
  'parakeet',
  'capture_browser',
] as const;

/** The names of the tools whose check failed, in `DOCTOR_TOOLS` order. A tool missing from `d` counts as failed. */
export const failingTools = (d: Doctor): string[] => DOCTOR_TOOLS.filter((t) => !d.tools[t]?.ok);

// ------------------------------------------------------------------ test results
export const CheckResultSchema = z.strictObject({
  id: z.string(),
  format: FormatIdSchema.optional(),
  blocking: z.boolean(),
  status: z.enum(['pass', 'fail', 'skip']),
  detail: z.string(),
  annotations: z.array(
    z.strictObject({
      scene_id: z.string().optional(),
      t: z.number().optional(),
      problem: z.string(),
      suggested_fix: z.string(),
    }),
  ),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const TestResultsSchema = z.strictObject({
  run_id: z.string(),
  plan_version: z.number().int(),
  output_paths: z.strictObject({
    stills: formatRecord(z.array(z.string())),
    contact_sheets: formatRecord(z.string()),
    drafts: formatRecord(z.string()),
    deliverables: z.array(z.strictObject({ deliverable: DeliverableSchema, path: z.string() })),
    report: z.string(),
  }),
  checks: z.array(CheckResultSchema),
  summary: z.strictObject({ blocking_failed: z.number().int(), warnings: z.number().int() }),
});
export type TestResults = z.infer<typeof TestResultsSchema>;

// ------------------------------------------------------------------ adapter contracts (§4)
export type Issue = { severity: 'error' | 'warning'; scene_id?: string; message: string };
export type LayerPass = 'bg' | 'graphics' | 'type' | 'captions' | 'fx';

export interface RenderAdapter {
  name: string;
  supports(format: FormatId): { ok: boolean; reason?: string };
  lint(runDir: string): Promise<Issue[]>;
  check(runDir: string): Promise<Issue[]>;
  still(runDir: string, format: FormatId, t: number[], only?: string[]): Promise<string[]>;
  contactSheet(runDir: string, format: FormatId, perScene: number): Promise<string>;
  render(
    runDir: string,
    format: FormatId,
    quality: 'draft' | 'final',
    passes?: LayerPass[],
    container?: 'mp4' | 'mov',
  ): Promise<string>;
}
export interface VoiceAdapter {
  synth(runDir: string, lines: Script['lines'], voice_id: string): Promise<string>;
  costEstimate(lines: Script['lines']): number;
}
export interface MusicAdapter {
  get(query: string, duration_s: number): Promise<AssetRef>;
  costEstimate?(query: string): number;
}
export interface AlignAdapter {
  /** Resolves to the timing.json path. */
  align(audioPath: string, lines: Script['lines'], spokenWords?: Record<string, string[]>): Promise<string>;
}
export interface AssetAdapter {
  /** Searches, downloads into the run folder, and returns up to `n` assets. */
  find(runDir: string, query: string, kind: 'image' | 'audio', n: number): Promise<AssetRef[]>;
}
export interface CaptureAdapter {
  /** Replays the steps in the browser profile and resolves to the log.json path. */
  replay(runDir: string, steps: Steps, profile: string): Promise<string>;
}
export interface ExportAdapter {
  kind: Deliverable['kind'];
  export(runDir: string, d: Deliverable): Promise<string>;
}
