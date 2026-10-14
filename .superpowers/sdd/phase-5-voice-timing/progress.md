# Phase 5 — Voice and timing (ledger)

Plan: docs/superpowers/plans/phase-5-voice-timing.md (6 tasks, rulings R1–R9). Branch phase-5-voice-timing from master 7256ecb.
Spec: docs/BLUEPRINT.md (R1/R2 in 2.5, R5 in 2.7 applied in the pre-step).
Probes (2026-10-14): hf tts 0.8.143 → 24 kHz mono, ~5 s/line, error JSON on stdout exit 1, positional INPUT may be read as a .txt path (use --text-file); ffmpeg apad+concat+aresample=48000 ok; CTC conf: matching line mean ≈ 0.9, wrong text ≈ 0.23 → threshold 0.6.

## Tasks
