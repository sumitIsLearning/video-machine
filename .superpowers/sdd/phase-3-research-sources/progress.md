# SDD ledger — plan: docs/superpowers/plans/phase-3-research-sources.md
Spec: docs/BLUEPRINT.md (Phase 3 rulings R1-R4 applied, 87c3a8a). Branch phase-3-research-sources from master 642730c.
Process: builder ("Read docs/AGENT_PROMPT.md, then implement Task N from <plan>") -> spec-reviewer -> code-reviewer -> bun test + lint -> orchestrator commits.

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 -> T2..T8 | AssetsSchema, status/attribution, Step.frame, NavFrames, PageCapture, CaptureAdapter, AssetAdapter(find runDir), DOCTOR_TOOLS+capture_browser | consistent |
| T1 DOCTOR_TOOLS vs setup tests | capture_browser missing until T7 | Ruling below |
| T3 -> T8 | found/index.json AssetRef[]; assetIdOf in lib/core/asset-id.ts | consistent |
| T5 -> T6 -> T8 | frames.json paths; step.frame -> log fallback -> render flip | consistent |
| T6 -> T7 | Launch/ReplayPage, browserChannel, profileDirOf | consistent |
| T7 setup INSTALL_STEPS +capture_browser | phase2.ts check 5 uses INSTALL_STEPS.length | consistent |
| T4/T5/T7/T8 self | tests partly specified as assertions, not full code | builder writes them; reviewers check against the listed assertions |
| T10 | needs network + system Chrome | stated in plan |

Ruling: Task 1 adds 'capture_browser' to DOCTOR_TOOLS but its check lands in Task 7 — between T1 and T7 the real doctor reports it failing; unit tests use fakes; acceptance only at T10 — cost if wrong: phase2.ts check 6 ("none failing") fails until T7; run phase2 only after T7
## Tasks
Task 1: dispatched lib-builder (base 87c3a8a)
Ruling: DOCTOR_TOOLS 'capture_browser' moves from Task 1 to Task 7 (plan amended) — adding the tool before its check turned bun test red (doctor keys == DOCTOR_TOOLS) — cost if wrong: none
Task 1: spec PASS (escaped-quotes test deviation judged correct)
Task 1: code review CHANGES REQUESTED (3 orange: strictness untested, run paths untested on new schemas, frame order unenforced; 2 yellow; 1 blue)
Ruling: NavFramesSchema gains superRefine (frames[k].i===k, t strictly rising, transcript only with has_audio) — tile index must line up with frames[] for the capture skill — cost if wrong: Task 5 must emit frames in this exact shape (it does by plan)
Task 3 note: Openverse adapter test must assert attribution present on CC BY results (reviewer: schema doesn't tie attribution to licence)
Task 1: fix round 1 dispatched
Task 1: fix round 1/5 (6 addressed, 0 open; mutation-checked)
Task 1: minor (deferred): no test for attribution '' (min(1)); dup-id message asserted via JSON.stringify (brittle)
Task 1: complete (commits 2d381f1..fe900b8, review clean after 1 fix round)
Task 2: dispatched lib-builder (base fe900b8)
Task 2: spec PASS (3 builder choices allowed; extra ResearchFact type export harmless)
Task 2: orchestrator real capture (docs.astral.sh/uv, 65 s): 9 shots, 1 logo, 12 fonts, palette ok — BUG: title fell back to host because hyperframes capture --json prints pretty multi-line JSON (last line is "}"); plan's "parse the last line" was wrong (spike cap.json was multi-line) — fix: parse the whole stdout
Task 2: code review CHANGES REQUESTED (1 red slug collision + orchestrator red title bug; 6 orange; 4 yellow; 1 blue)
Ruling: page slug = slugOf(host path) + '-' + sha1(url w/o fragment)[0:8] (plan's docs-astral-sh-uv expectation changes) — 5-word slugs collide across pages on one site — cost if wrong: longer folder names
Ruling: page capture refuses credentials, localhost/loopback/private/link-local literal hosts up front; DNS rebinding not covered (ponytail note) — fetched page text is untrusted (BLUEPRINT 2.6) — cost if wrong: a creator cannot capture an intranet page (acceptable for v1)
Ruling: every non-blank non-heading line under ## Facts must be a valid fact — Review Focus 1 — cost if wrong: Claude must put prose under ## Notes
Task 2: fix round 1 dispatched
Task 2: fix round 1 verified live: real capture title 'uv', dir docs-astral-sh-uv-212ad8c1, 9 shots, 1 logo, 12 fonts
Task 2: fix round 1/5 (8 addressed, 0 open)
Task 2: minor (deferred): no test cases for http://0.0.0.0/ and [::ffff:127.0.0.1]; ponytail note should also name redirects to private hosts; rmSync->renameSync window not atomic
Task 2: complete (commits fe900b8..c602f1d, review clean after 1 fix round)
Task 3: dispatched lib-builder (base c602f1d); reminder from Task 1 review: assert attribution on CC BY results
Task 3: orchestrator live run: 'laptop code' image n=2 -> 1 downloaded (CC0, attribution ok), 1 Wikimedia download HTTP 429 (warned+skipped; Wikimedia requires a User-Agent header -> fix); 'lofi' audio -> CC0 mp3 ok. Warning prefix [M4] should be [M5] (research)
Task 3: spec PASS (deviations allowed; mismatch: [M4] prefix -> [M5]); reviewer live run: 2 CC BY/BY-SA jpgs with attribution, repeat search adds nothing
Task 3: code review CHANGES REQUESTED (2 red: filetype path escape, file:/private-host downloads; 7 orange: bounds, attribution, licence allowlist, dedupe, partial failure, body type, tests; several yellow)
Ruling: private-host URL check moves from lib/research/page.ts into lib/core/url.ts (assertPublicHttpUrl, isPrivateHost) so the Openverse adapter can share it — adapters can't import part folders — cost if wrong: Task 3 touches a Task 2 file (behaviour unchanged, tests kept)
Ruling: Openverse accepts only by/by-sa/cc0/pdm, https downloads, no redirects, size caps 25 MB image / 50 MB audio, attribution required (built from title/creator/landing if absent) — untrusted remote data + legally usable media — cost if wrong: fewer results per search
Task 3: fix round 1 dispatched
Task 3: live re-run after fix: 3/3 downloaded incl. the Wikimedia SVG that 429'd before (User-Agent fix works); licences CC BY-SA 4.0, CC0 1.0, CC BY 4.0 with attribution. Note for Task 8: Openverse SVG results arrive as kind 'image' with .svg — pool should map .svg to kind svg
Task 3: fix round 1/5 (11 addressed, 0 open; opus re-review)
Task 3: minor (deferred): rmSync on a write failure can mask the original error (EFAULT when a dir sits at the path); User-Agent contact URL is a placeholder (set the real repo URL in Phase 10)
Task 3: complete (commits c602f1d..cef4dce, review clean after 1 fix round)
Task 4: dispatched lib-builder (base cef4dce)
Ruling: research page returns record as run-relative path (capture/pages/<slug>.json) — run paths are run-relative by convention — cost if wrong: none
Task 4: orchestrator live CLI run: write (1 fact) ok, '* unsourced' refused (line 2), find audio CC0 ok
Task 4: spec PASS
Task 4: code review CHANGES REQUESTED (4 orange: lossy UTF-8 decode, loose --n, no `--` usage hint, no stdin/line cap; 4 yellow test gaps; 2 blue)
Ruling: research stdin capped at 1 MB; parseResearch refuses lines over 8 KB before the fact regex (touches Task 2's research.ts) — the regex is quadratic on long non-matching lines — cost if wrong: a fact longer than 8 KB must be shortened
Task 4: minor (deferred): a UTF-8 BOM on research stdin is dropped by TextDecoder (stored text differs by the BOM)
Task 4: fix round 1 dispatched
Task 4: fix round 1 done (388 pass); builder ran a stray empty python3 heredoc that hung to background (wrote nothing). 3 python.exe processes seen (~100 MB each) — origin unclear, not killed (may be user's); mention in summary
Task 4: fix round 1/5 (6 addressed, 0 open)
Task 4: minor (deferred): 1 MB stdin cap is checked after the full read (limits parsing, not memory)
Task 4: complete (commits cef4dce..84e0a2d, review clean after 1 fix round)
Task 5: dispatched lib-builder (base 84e0a2d)
Task 5: live run on runs/spike-capture/nav.webm: 1.7 s, frames [0,2,3.52,4.56,6,8] == plan, silent -> no transcript, 1 sheet. Sheet tiles (480 px) too small to read link text -> Task 9 capture skill must say: read single frames for target names
Task 5: spec PASS (run-file.ts allowed; sheet-count risk checked live: 1 computed sheet existed on disk)
Task 5: code review CHANGES REQUESTED (5 orange: N/A duration on streamed webm, unchecked frame/sheet output, stem collisions, no junction test, threshold test can't fail; 5 yellow; 2 blue)
Ruling: nav folder = capture/nav/<slug>-<sha1(source)[0:8]> (like page captures) — 5-word stems collide for screen recordings — cost if wrong: longer paths; Task 6/8/10 must use returned paths, not capture/nav/nav
Ruling: relInside + runFileOf move to lib/core/paths.ts and intake.ts uses them (touches Phase 2 file) — one containment implementation — cost if wrong: intake error wording must stay identical (tests pin it)
Task 5: minor (deferred): merge keeps the earlier candidate, so a periodic frame can shadow a scene change 0.4 s later (plan-mandated; revisit with real nav videos)
Task 5: fix round 1 dispatched
Task 5: fix round 1 done (415 pass); live re-run ok: times unchanged, dir capture/nav/nav-caa18143. Builder emptied lib/capture/run-file.ts (rules forbid Bash deletes) — orchestrator deletes the untracked empty file at commit
Ruling: intake's missing-file wording becomes '<path> is not a file in the run folder; import it first' (was 'the brief names <p>, which is not in the run folder; import it first') — shared runFileOf — cost if wrong: wording only; tests match the path
Task 5: fix round 1/5 (11 addressed, 0 open)
Task 5: minor (deferred): mkdir of capture/nav runs before the realpath check (empty folder could be created through a capture junction); threshold rise between 0.05 and 0.0602 not caught by tests
Task 5: complete (commits 84e0a2d..f4aefb1, review clean after 1 fix round)
Task 6: dispatched lib-builder (base f4aefb1)
Task 6: live replay (docs.astral.sh, system Chrome, 15.1 s): 4 steps, step 2 failed 'click: Timeout 5000ms exceeded.' with fallback frame, step 3 ran after it; shots/text/clips for 0,1,3; clips h264 30/1; replay.webm kept. GAP: no crops at all — builder only crops when the URL is unchanged, and the box is measured pre-action while the shot is post-action -> crop should come from a pre-action screenshot
Task 6: spec PASS (8 deviations allowed). Orchestrator overrides deviation 2 on evidence: crops must come from a pre-action screenshot (live run produced zero crops) — goes in fix round
Task 6: code review CHANGES REQUESTED (1 red: crop ffmpeg failure aborts the replay; 9 orange incl. passwords unenforced, no input targets, private hosts, clips-before-log, cleanup, probe launches, lock message; yellows)
Ruling: focus crops come from a pre-action screenshot shots/<i>-before.png (scrollIntoViewIfNeeded, box, shot), crop failures only warn — live run produced zero crops
Ruling: type steps targeting password-like fields or type=password inputs are refused ("passwords are typed by hand: run capture login") — BLUEPRINT 2.6 — cost if wrong: a creator's non-secret field named e.g. "passcode hint" is refused (rename the target)
Ruling: replay allows private/loopback hosts only when equal to the product host (first step's host); link-local/metadata never; URL re-checked after each action — untrusted video-derived steps; dev products run on localhost — cost if wrong: a multi-host intranet product needs a later allow list
Ruling: replay launches chrome channel directly and falls back on error (no probe launches); navigation waits for load + 1 s settle instead of networkidle — speed and pages that never go idle — cost if wrong: a page still loading content after 1 s is captured early
Ruling: R9 timing kept; Task 10 acceptance adds a clip-alignment check on the real recording (reviewer doubts the 0.45 s offset reasoning)
Task 6: fix round 1 dispatched
Task 6: fix round 1 live-verified (14.1 s): crops 1,3 from before-shots (crop shows the clicked link), type 'Search' works, 'Password' refused, value absent from log, failed click falls back. Plan: Task 8 pool skips shots/*-before.png
Task 6: fix round 1/5 (10 addressed; opus re-review found 2 new orange: moveFile copy fallback still throws on locked source rm (log.json lost), no URL guard before the before-shot)
Task 6: minor (deferred): type-target priority holds only within one 100 ms poll (an already-visible lower-ranked match wins over a field that renders later)
Task 6: fix round 2 dispatched
Session stop (user, 2026-10-14): Task 6 fix round 2 interrupted; WIP committed; master fast-forwarded; no remote to push
