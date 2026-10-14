# Phase 5 — Voice and timing (ledger)

Plan: docs/superpowers/plans/phase-5-voice-timing.md (6 tasks, rulings R1–R9). Branch phase-5-voice-timing from master 7256ecb.
Spec: docs/BLUEPRINT.md (R1/R2 in 2.5, R5 in 2.7 applied in the pre-step).
Probes (2026-10-14): hf tts 0.8.143 → 24 kHz mono, ~5 s/line, error JSON on stdout exit 1, positional INPUT may be read as a .txt path (use --text-file); ffmpeg apad+concat+aresample=48000 ok; CTC conf: matching line mean ≈ 0.9, wrong text ≈ 0.23 → threshold 0.6.

## Tasks
Task 1: done cbb585d (haiku build, spec PASS, code APPROVE w/ 🔵 NaN cost passed the guard — orchestrator fixed + test, 2 lines)
Task 2: done 7e1494e (haiku build, spec PASS, code APPROVE; builder added confs = {} the brief omitted; 🔵 vendored conf comprehension repeats parts, skipped)
Finding: tests/phase0.ts fails on this Mac on the base too (cbb585d): check 1 max deviation 80 ms at "shapes," (word 94) vs 10 ms; check 2 ENOENT C:/Work-data/video-testing (Windows path). Pre-existing, not Phase 5 — raise with user.
Task 3: done c354ab8 (haiku build, spec PASS, code 🟠 tts temp dir in os.tmpdir → EXDEV on rename + 🟡 ok:true with no wav → raw ENOENT; one haiku fix round, both fixed with tests; supplied keeps its own SAMPLE_RATE, adapters don't import each other)
Task 4: done 1e656ae (haiku build, spec PASS, code APPROVE; builder added: spoken words with empty text → InputError, fits uses 1e-6 tolerance and no no-target branch since duration_target_s is required, io.voice overrides adapter name)
Task 5: done faaa965 (haiku build, spec FAIL on intro "(M11)" (M11 is avatar), code APPROVE w/ 🟡 supplied synth result fields + 🔵 TTS-only re-voice; one haiku fix round for all three, verified by grep; kept builder extras: supplied re-record sentence, no-voiceover → where)
Task 6: done 703f43d (haiku build, spec PASS, code 🟠×2 cwd writes when check 1 fails → guards in one haiku fix round; 5/5 PASS ~25 s)
Rulings: R10 check 5 writes stand-in look/look.json + plan.json (where checks existence only); R11 check 6 (video-testing listing) dropped — no Phase 4 check, Phase 0 path is Windows.
Next: phase-end opus review of the branch, one fix brief, scoped re-review; ask before merge.
Fix-branch: done ce2f764 (opus review 🟠 spoken map global vs plain uses + 🟡×2 🔵×2; haiku lib+plugin builders, spec PASS, 644 pass, phase5 5/5). Next: ask user to merge.
