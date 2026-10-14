# Task 1: make tests/phase0.ts pass on macOS arm64

Base: master 5b7381c, branch `phase0-test-fix`. Only file: `tests/phase0.ts`. Finish with `sh .claude/tools/check.sh` and
`node_modules/.bin/bun tests/phase0.ts` (must print 2/2 passed or 1 pass + 1 skip, exit 0).

## Why
The fixture (`tests/fixture/data/lyrics.json`) was aligned on Windows x86. On this Mac (arm64) ctc-onnx gives 476 edges:
458 identical, 17 off by exactly one 20 ms CTC frame (tie-breaks), 1 off by 80 ms ("shapes," word 94, end before a
pause). The aligner did not regress; the "every edge within 10 ms" rule is platform-exact.
Check 2 reads `C:/Work-data/video-testing`, a Windows-only folder that does not exist here.

## Changes
1. Check 1 — new rule, named `1. fixture alignment matches (95% of edges within 10 ms, all within 100 ms)`:
   keep the word-count, word-text and missing-edge errors as they are. Collect every edge deviation. Fail if fewer
   than 95% of edges are within 0.01 s, or any edge is over 0.1 s (message names the worst edge as today). Detail on
   pass: `<words> words, <n>/<edges> edges within 10 ms, max deviation <x> ms at <word>`.
   Update header comment line 3 to match.
2. Check 2 — `SOURCE = process.env.VM_VIDEO_TESTING ?? 'C:/Work-data/video-testing'`. If `!existsSync(SOURCE)`, the
   check is skipped, not failed: add `skip` support to `check` (a function may return `{ skip: string }`), print
   `SKIP  <test>\n      <reason>`, and do not count skips as failures. Final line: `<passed>/<ran> passed, <k> skipped`
   (omit `, 0 skipped`). Reason text: `<SOURCE> not found; set VM_VIDEO_TESTING to the video-testing folder`.
   Update header comment line 4 to mention the skip.

## Do not touch
Everything except `tests/phase0.ts`. Do not edit the fixture, the adapter or `tests/phase0/video-testing.before.txt`.

## Context pack
`check` is at ~line 17-29, check 1 at ~31-74, check 2 at ~76-98, summary at ~100-102. Read only those ranges.
