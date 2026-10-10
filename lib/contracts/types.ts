// Data contracts for the Video Machine (spec §3) and adapter contracts (§4).
// Every JSON file the skill writes goes through writeJson/readJson: a failed parse is an error, never a warning.

import { z } from 'zod';

// ------------------------------------------------------------------ formats
export const FormatIdSchema = z.enum(['landscape_1080p', 'reel', 'square', 'portrait_feed']);
export type FormatId = z.infer<typeof FormatIdSchema>;

type Safe = { top: number; bottom: number; left: number; right: number };
/** Fixed table; adding a format = one line here (and one in FormatIdSchema). */
export const FORMATS: Record<FormatId, { w: number; h: number; fps: number; safe: Safe }> = {
  landscape_1080p: { w: 1920, h: 1080, fps: 30, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
  reel: { w: 1080, h: 1920, fps: 30, safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 } },
  square: { w: 1080, h: 1080, fps: 30, safe: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 } },
  portrait_feed: { w: 1080, h: 1350, fps: 30, safe: { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 } },
};

/** What a plate lays itself out against (§7). */
export type Frame = { w: number; h: number; aspect: 'landscape' | 'vertical' | 'square'; safe: Safe };
export const frameOf = (f: FormatId): Frame => {
  const { w, h, safe } = FORMATS[f];
  return { w, h, safe, aspect: w > h ? 'landscape' : w < h ? 'vertical' : 'square' };
};

const formatRecord = <T extends z.ZodType>(v: T) => z.partialRecord(FormatIdSchema, v);
// No credentials in URLs: they would leak into run folders and logs.
const httpUrl = z.url({ protocol: /^https?$/ }).refine((u) => {
  // zod runs this even when the url check failed, so unparseable input must pass through to that error
  if (!URL.canParse(u)) return true;
  const { username, password } = new URL(u);
  return !username && !password;
}, 'URL must not contain a username or password');

// ------------------------------------------------------------------ brief
export const DeliverableSchema = z.object({
  format: FormatIdSchema,
  kind: z.enum(['mp4_h264', 'mov_prores4444', 'png_sequence', 'webm', 'gif', 'srt', 'ae_package']),
  captions: z.enum(['burned', 'separate', 'none']),
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

// brief.sources: whatever the creator handed over besides concept.md (BLUEPRINT 1.6 Inputs). Empty = concept only.
export const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['nav_video', 'file']), path_or_url: z.string().min(1), note: z.string().optional() }),
  z.object({ kind: z.enum(['product_url', 'link']), path_or_url: httpUrl, note: z.string().optional() }),
]);
export type Source = z.infer<typeof SourceSchema>;

export const BriefSchema = z.object({
  run_id: z.string().min(1),
  concept: z.string().min(1),
  goals: z.array(z.string()),
  audience: z.string().optional(),
  tone: z.string().optional(),
  duration_target_s: z.tuple([z.number().positive(), z.number().positive()]).refine(([a, b]) => a <= b, 'min > max'),
  timing_source: z.enum(['voiceover', 'music', 'text_only']),
  voice: z
    .discriminatedUnion('source', [
      z.object({ source: z.literal('supplied'), path: z.string() }),
      z.object({ source: z.literal('tts'), adapter: z.string(), voice_id: z.string() }),
    ])
    .optional(),
  music: z
    .discriminatedUnion('source', [
      z.object({ source: z.literal('supplied'), path: z.string() }),
      z.object({ source: z.literal('adapter'), adapter: z.string(), query: z.string() }),
    ])
    .optional(),
  formats: z.array(FormatIdSchema).min(1).default(['reel']),
  deliverables: z.array(DeliverableSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  // ponytail: Phase 8 decides where a supplied avatar clip's path lives; only the portrait is modelled now.
  avatar: z
    .object({
      source: z.enum(['adapter', 'supplied']),
      adapter: z.string().optional(),
      portrait: z.string().optional(),
    })
    .optional(),
  look_hint: z.string().optional(),
  brand: z
    .object({
      logo: z.string().optional(),
      colors: z
        .array(
          z.object({
            hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            role: z.enum(['bg', 'fg', 'accent', 'muted']).optional(),
          }),
        )
        .optional(),
      fonts: z
        .array(z.object({ family: z.string(), path: z.string().optional(), license: z.string().min(1) }))
        .optional(),
    })
    .optional(),
  cta: z.object({ text: z.string(), url_or_handle: z.string().optional() }).optional(),
  must_include: z.array(z.string()).optional(),
  must_avoid: z.array(z.string()).optional(),
  budget_usd: z.number().min(0).default(0),
});
export type Brief = z.infer<typeof BriefSchema>;

// ------------------------------------------------------------------ script
export const ScriptSchema = z.object({
  run_id: z.string(),
  version: z.number().int().min(1),
  lines: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1), // what is said (or shown, if text_only)
        spoken: z.string().optional(), // how TTS/aligner should read it ("5.5" → "five point five")
        on_screen: z.string().optional(),
        delivery: z.enum(['voiceover', 'avatar']).default('voiceover'),
        section: z.string().min(1).optional(),
        cite: z.array(httpUrl).min(1).optional(),
      }),
    )
    .min(1),
});
export type Script = z.infer<typeof ScriptSchema>;

// ------------------------------------------------------------------ look
export const LookSchema = z.object({
  id: z.string(),
  based_on: z.array(z.string()),
  idea: z.string(),
  palette: z
    .array(
      z.object({
        name: z.string(),
        hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        role: z.enum(['bg', 'fg', 'accent', 'muted']),
      }),
    )
    .min(1),
  type: z
    .array(
      z.object({
        role: z.enum(['display', 'body', 'mono', 'label']),
        family: z.string(),
        weights: z.array(z.number()),
        license: z.string().min(1),
      }),
    )
    .min(1),
  motion: z.object({
    character: z.string(),
    easings: z.array(z.string()),
    typical_beat_s: z.tuple([z.number(), z.number()]),
    camera: z.string(),
  }),
  motifs: z.array(z.object({ id: z.string(), meaning: z.string(), code: z.string().optional() })),
  post: z.record(z.string(), z.number()),
  layout_rules: z.object({ landscape: z.string(), vertical: z.string(), square: z.string() }),
});
export type Look = z.infer<typeof LookSchema>;

// ------------------------------------------------------------------ plan
export const ScenePlanSchema = z.object({
  scene_id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  section: z.string().optional(),
  lines: z.array(z.string()).min(1),
  cut_in: z.object({ anchor: z.string(), rule: z.enum(['pause_before', 'on_word', 'on_beat']) }),
  intent: z.string(),
  beats: z.array(
    z.object({
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
  .object({
    run_id: z.string(),
    version: z.number().int().min(1),
    look_id: z.string(),
    // Long-form (Phase 9) fills sections; reels leave them out.
    sections: z
      .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]*$/), title: z.string().min(1) }))
      .min(1)
      .optional(),
    visuals_plan: z.object({ scenes: z.array(ScenePlanSchema).min(1) }),
    asset_ids: z.array(z.string()),
    formats: z.array(FormatIdSchema).min(1),
  })
  .superRefine((plan, ctx) => {
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

// ------------------------------------------------------------------ assets
export const AssetRefSchema = z.object({
  asset_id: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'font', 'svg', 'data']),
  path: z.string(),
  source: z.string(),
  license: z.string(),
  usage: z.enum(['render', 'reference_only']),
  origin: z.enum(['supplied', 'nav_video', 'captured', 'web', 'found', 'drawn']),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

// ------------------------------------------------------------------ timing
// data/timing.json: the engine's word-timed format (what align_vo.py writes as lyrics.json).
const WordTimingSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
  syl: z.array(z.tuple([z.number(), z.number()])).optional(),
  conf: z.number().optional(),
});
export const TimingSchema = z.object({
  source: z.string().optional(),
  lines: z.array(z.object({ text: z.string(), start: z.number(), end: z.number(), words: z.array(WordTimingSchema) })),
  beats: z.array(z.number()).optional(),
});
export type Timing = z.infer<typeof TimingSchema>;

// ------------------------------------------------------------------ capture
// capture/steps.json: the replay script for the product walk-through.
const StepSchema = z
  .object({
    i: z.number().int().min(0),
    url: httpUrl, // the replay opens it
    action: z.enum(['click', 'type', 'scroll', 'wait']),
    target: z.string(),
    value: z.string().optional(),
    expect: z.string(),
  })
  .refine((s) => s.action !== 'type' || s.value !== undefined, {
    message: 'a type step needs a value',
    path: ['value'],
  });
export const StepsSchema = z
  .array(StepSchema)
  .refine((steps) => steps.every((s, k) => k === 0 || s.i > (steps[k - 1]?.i ?? -1)), 'step numbers must go up');
export type Steps = z.infer<typeof StepsSchema>;

// capture/log.json: what the replay did for each step, with times on the nav-video timeline.
export const CaptureLogSchema = z.array(
  z
    .object({
      i: z.number().int().min(0),
      t0: z.number().min(0),
      t1: z.number().min(0),
      box: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(),
      url: z.string(),
      failed: z.string().optional(), // why the step failed, in words
      fallback: z.string().optional(), // run-relative path of the nav-video frame used instead
    })
    .refine((e) => e.t1 >= e.t0, { message: 't1 is before t0', path: ['t1'] }),
);
export type CaptureLog = z.infer<typeof CaptureLogSchema>;

// ~/.video-machine/doctor.json (VM_HOME, never in a run folder): tool versions and smoke-render timings.
export const DoctorSchema = z.object({
  checked_at: z.iso.datetime(),
  tools: z.record(
    z.string(),
    z.object({
      ok: z.boolean(),
      version: z.string().optional(),
      path: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
  smoke_s: z.record(z.string(), z.number().min(0)),
});
export type Doctor = z.infer<typeof DoctorSchema>;

// ------------------------------------------------------------------ test results
export const TestResultsSchema = z.object({
  run_id: z.string(),
  plan_version: z.number().int(),
  output_paths: z.object({
    stills: formatRecord(z.array(z.string())),
    contact_sheets: formatRecord(z.string()),
    drafts: formatRecord(z.string()),
    deliverables: z.array(z.object({ deliverable: DeliverableSchema, path: z.string() })),
    report: z.string(),
  }),
  checks: z.array(
    z.object({
      id: z.string(),
      format: FormatIdSchema.optional(),
      blocking: z.boolean(),
      status: z.enum(['pass', 'fail', 'skip']),
      detail: z.string(),
      annotations: z.array(
        z.object({
          scene_id: z.string().optional(),
          t: z.number().optional(),
          problem: z.string(),
          suggested_fix: z.string(),
        }),
      ),
    }),
  ),
  summary: z.object({ blocking_failed: z.number().int(), warnings: z.number().int() }),
});
export type TestResults = z.infer<typeof TestResultsSchema>;

// ------------------------------------------------------------------ adapter contracts (§4)
export type Issue = { severity: 'error' | 'warning'; scene_id?: string; message: string };
export type LayerPass = 'bg' | 'graphics' | 'type' | 'captions' | 'fx';

export interface RenderAdapter {
  name: string;
  supports(format: FormatId): { ok: boolean; reason?: string };
  scaffold(runDir: string, plan: Plan, look: Look): void;
  plateApi(): string;
  lint(runDir: string): Issue[];
  still(runDir: string, format: FormatId, t: number[], only?: string[]): string[];
  contactSheet(runDir: string, format: FormatId, perPlate: number): string;
  render(runDir: string, format: FormatId, quality: 'draft' | 'final', passes?: LayerPass[]): string;
}
export interface VoiceAdapter {
  synth(lines: Script['lines'], voice_id: string): string;
  costEstimate(lines: Script['lines']): number;
}
export interface MusicAdapter {
  get(query: string, duration_s: number): AssetRef;
  costEstimate?(query: string): number;
}
export interface AlignAdapter {
  align(audioPath: string, lines?: Script['lines']): string /* timing.json path */;
}
export interface AssetAdapter {
  find(query: string, kind: AssetRef['kind']): AssetRef[];
  make?(spec: string): AssetRef;
  costEstimate?(spec: string): number;
}
export interface ExportAdapter {
  kind: Deliverable['kind'];
  export(runDir: string, d: Deliverable): string;
}
