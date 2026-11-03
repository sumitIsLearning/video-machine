# Phase 9b — Short Commands Implementation Plan

**Goal:** Users get a short, clear set of slash commands. The plugin is renamed `vm`, so its commands read `/vm:…`.
The slash menu shows only four: `/vm:setup`, `/vm:new <idea>`, `/vm:status`, `/vm:feedback <notes>`. The other
seven skills stay as internal steps, hidden from the menu but still run inside a video. Plain sentences ("make a
video about …", "set up the Video Machine") keep working.

**What the creator sees (mock, typed `/vm` in Claude Code):**
```
/vm:setup      Install and check every tool the Video Machine needs
/vm:new        Make a new video from an idea or concept        <idea or concept>
/vm:status     How each video stands and what is next
/vm:feedback   Change the video waiting for your OK           <what to change>
```

**Spec:** `docs/BLUEPRINT.md` Part 5 "Phase 9b — Short commands"; 2.1 skill tree.

**Probed (Claude Code 2.1.316, installed binary):** skill frontmatter keys `user-invocable` ("If false, hides the
slash command from users; only the model can invoke it via the Skill tool"), `disable-model-invocation`,
`argument-hint`. Plugin skills are named `<plugin name>:<skill name>`, so the prefix comes from `plugin.json` `name`.
`~/.video-machine` (VM_HOME) and `package.json` `name` do not depend on the plugin name and stay.

## Global Constraints
- Only skill text, frontmatter and manifests change; no `lib/` code changes.
- The model must still be able to call every skill (never set `disable-model-invocation`).
- Verify with `sh .claude/tools/check.sh`.

## Rulings made in this plan (2026-11-02)
- **R1** `plugin.json` and the marketplace's plugin entry are named `vm`; the marketplace keeps `video-machine`.
  Install: `/plugin marketplace add sumitIsLearning/video-machine`, then `/plugin install vm@video-machine`.
  An existing `video-machine` install must be removed and setup re-run (only the creator has one; v0.1.0 is private).
- **R2** Rename by moving the folder (`git mv`), not by adding wrapper skills: one name per job (ponytail).
  `make-video` → `new`, `review` → `feedback`.
- **R3** Shown in the menu: `setup`, `new`, `status`, `feedback`. Hidden (`user-invocable: false`): `research`,
  `capture`, `storyboard`, `voice`, `avatar`, `scenes`, `deliver`.
- **R4** `new` and `feedback` get an `argument-hint`; their descriptions keep the plain-sentence triggers.
- **R5** `feedback` works at any gate: at G1 or G2 it hands the notes to `vm:storyboard` at that gate; at G3 or G4
  it routes as `review` does today. No run waiting: it says so and points to `/vm:new`.
- **R6** Old acceptance tests (`tests/phase1.ts`–`phase3.ts`) follow the new names so they keep running.

---

### Task 1: Rename the plugin to `vm`
**Agent:** plugin-builder
**Read first:** `.claude-plugin/plugin.json`; `.claude-plugin/marketplace.json`; the output of
`grep -rn "video-machine:" skills agents`.
**Files:** modify `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, every skill file the grep lists.
**Changes:**
- `plugin.json` `name`: `vm`. `marketplace.json`: `plugins[0].name` `vm`; top-level `name` stays `video-machine`.
- Every `video-machine:<x>` in `skills/` and `agents/` becomes `vm:<x>` (skill refs and `subagent_type` values,
  e.g. `vm:scene-writer`, `vm:avatar-director`, `/vm:status`).
**Done when:** `grep -rn "video-machine:" skills agents .claude-plugin` prints nothing;
`claude plugin validate .claude-plugin/plugin.json --strict --json 2>&1 | tail -n 40` shows no errors.

### Task 2: Rename `make-video` → `new` and `review` → `feedback`
**Agent:** plugin-builder
**Needs:** Task 1.
**Read first:** `skills/make-video/SKILL.md:1-20`; `skills/review/SKILL.md:1-10`; the output of
`grep -rn "make-video\|review" skills agents CONCEPT-TEMPLATE.md`.
**Files:** `git mv skills/make-video skills/new`; `git mv skills/review skills/feedback`; modify the files the grep
lists where they name the skill.
**Changes:**
- Frontmatter `name: new` and `name: feedback`. Headings may stay.
- References to the skill by name: `make-video` → `new` (e.g. setup's description, storyboard's "see make-video
  Step 1"), `` `review` skill (`vm:review`) `` → `` `feedback` skill (`vm:feedback`) `` in scenes and deliver.
- Leave alone: the `review` CLI (`lib/review/cli.ts`, `review snapshot`) and the word "review" in plain prose.
**Done when:** `grep -rn "make-video\|vm:review\|\`review\` skill" skills agents CONCEPT-TEMPLATE.md` prints
nothing; `ls skills` lists `new` and `feedback`, not `make-video` or `review`.

### Task 3: The menu shows four commands
**Agent:** plugin-builder
**Needs:** Task 2.
**Read first:** lines 1-4 of each `skills/*/SKILL.md`.
**Files:** the frontmatter of all 11 `skills/*/SKILL.md`.
**Changes:**
- Add `user-invocable: false` to `research`, `capture`, `storyboard`, `voice`, `avatar`, `scenes`, `deliver` (R3).
- `new`: `argument-hint: "<idea or concept>"`; its description still names "make a video about …".
- `feedback`: `argument-hint: "<what to change>"`; description: "Use when the creator gives feedback on a video
  waiting at any gate (G1 script, G2 storyboard, G3 scenes, G4 delivery) or types /vm:feedback: …" (keep the rest).
- `status` description: `/vm:status` (done in Task 1; check it).
- No other frontmatter keys change.
**Done when:** `grep -L "user-invocable: false" skills/*/SKILL.md` lists exactly `feedback`, `new`, `setup`,
`status`; `grep -c "argument-hint" skills/new/SKILL.md skills/feedback/SKILL.md` prints 1 for each.

### Task 4: `feedback` at any gate
**Agent:** plugin-builder
**Needs:** Task 3.
**Read first:** `skills/feedback/SKILL.md` (44 lines); `skills/status/SKILL.md` (how it finds runs and the next
part); `skills/storyboard/SKILL.md:36-45,140-150` (G1 and G2).
**Files:** modify `skills/feedback/SKILL.md`.
**Pseudocode (new step 0, before "Classify the feedback"):**
1. Pick the run: the run this conversation is working on; else the newest run that waits at a gate (find it as
   status does); two or more and none in this conversation → ask which.
2. No run waits at a gate → say "No video is waiting for your OK. Start one with /vm:new <idea>." and stop.
3. The run waits at G1 or G2 → follow `vm:storyboard` at that gate with the notes as the creator's feedback; stop
   here (no snapshot, nothing routed).
4. G3 or G4 → go on to step 1 as today.
- Notes come from the command arguments or, if empty, the creator's last message; none → ask what to change.
**Done when:** the file is under 70 lines; the existing G3/G4 table is unchanged (`git diff` shows only the added
step and the title line).

### Task 5: Tests follow the new names, and acceptance `tests/phase9b.ts`
**Agent:** lib-builder
**Needs:** Tasks 1–4.
**Read first:** `tests/phase1.ts:60-82`; `tests/phase2.ts:140-170`; `tests/phase3.ts:210-230`; `tests/phase9.ts:1-60`
(check helper, `sh`).
**Files:** modify `tests/phase1.ts`, `tests/phase2.ts`, `tests/phase3.ts`; create `tests/phase9b.ts`.
**Changes (R6):** `plugin details video-machine` → `plugin details vm`; skill name `make-video` → `new` in the lists
and check titles.
**Checks in `tests/phase9b.ts` (real `claude` CLI, prints PASS/FAIL per check):**
1. `claude --plugin-dir . plugin details vm` lists 11 skills, including `new`, `feedback`, `setup`, `status`.
2. Menu: the skills without `user-invocable: false` in their frontmatter are exactly `feedback`, `new`, `setup`,
   `status`; none sets `disable-model-invocation`.
3. `new` and `feedback` each have an `argument-hint`.
4. No `video-machine:` and no `make-video` left in `skills/`, `agents/`, `.claude-plugin/`, `README.md`.
5. `claude plugin validate .claude-plugin/plugin.json --strict --json` reports no errors.
**Done when:** `node_modules/.bin/bun tests/phase9b.ts 2>&1 | tail -n 40` prints 5 PASS (check 4 needs Task 6);
`sh .claude/tools/check.sh 2>&1 | tail -n 40` passes.

### Task 6 (orchestrator): README and handoff
- README: install `/plugin install vm@video-machine`; a "Commands" table with the four commands from the mock; "Make
  a video" step 1 says `/vm:new <idea>` (or just say "make a video about …"); setup says `/vm:setup`; status
  `/vm:status`; feedback `/vm:feedback`. The Skills table lists the four commands first, the rest as "internal steps".
- Note in HANDOFF: reinstall as `vm` (remove `video-machine` first) and re-run `/vm:setup`.

### Task 7 (orchestrator + creator): proof
In a fresh Claude Code session with the plugin installed as `vm`, the creator types `/vm` and sees exactly the four
commands with their hints; `/vm:status` runs. Screenshot next to the mock above.
