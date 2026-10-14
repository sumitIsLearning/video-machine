---
name: voice
description: "Use when a run needs its voiceover (M9) or its word timing (M10): voices the script, aligns it, and reports the length."
---

# Voice (M9–M10)

Run every command with the Bash tool (Git Bash on Windows), from the creator's workspace (never `cd` into the plugin).
Every command prints one JSON line. Read its `ok` field, never the exit code. Any `ok:false` means: show the creator the
`message`. The run folder is the relative path `runs/<run_id>`. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`.

## M9. Voiceover (synth)

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/voice/cli.ts" synth runs/<run_id>
```

It returns `{vo, source}` on success, with the voice written to `audio/vo.wav`. For a TTS voice it also returns
`voice`, `lines` and `usd`.

- **Cost refusal.** When the voice costs more than the budget, the command refuses with a message that names the amount:
  `the voice costs $X and the budget is $Y; ask the creator, then re-run with --approve-spend X`. Tell the creator the
  amount and ask. Only after a yes, re-run with `--approve-spend <usd>` using that amount.
- **Tool failure naming a line.** Show the creator the line it names, with its text.
- **No voiceover in this run.** If the command says the run has no voiceover (`timing_source` is not `voiceover`),
  tell the creator this run has no voiceover, and stop the voice part. Go on to `where`.

## M10. Word timing (align)

```bash
"${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/bun" "${CLAUDE_PLUGIN_ROOT}/lib/voice/cli.ts" align runs/<run_id>
```

It returns `{timing, lines, total_s, target_s: [min, max], fits}`. Tell the creator the total length against the
target in one line, for example "The voice runs 27.4 s; the target is 15–30 s."

- **`fits` is false.** Offer to shorten or lengthen the script. On a yes, go back to the script part (`storyboard`
  skill, the script step), write the new lines, then run `synth` and `align` again. For a TTS voice only the changed
  lines are voiced again; a supplied recording is re-imported whole.
- **Align before synth.** If it says `no audio/vo.wav yet; run synth first`, run `synth` first.

## Low-confidence error

`align` can stop with this error, which names line ids:

`ctc-onnx.align: the audio does not match line(s) <id> (<conf>), ...; check their spoken text or re-voice them`

Read the error and look at the named lines. Then:

- **TTS voice** (`hf-tts`): look at those lines for numbers, symbols, acronyms or brand names the voice says
  differently. Add a `spoken` text for each one through the script part: `lib/script/cli.ts write` with a new
  version. Send the **whole** `{"lines": [...]}` list, with `spoken` added on the named lines, and not only the changed
  ones. Then run `synth` and `align` again.
- **Supplied recording** (`source: supplied`): ask the creator whether the recording or the script is right. Never
  edit their recording. If the script is right, the creator re-records; if the script is wrong, fix the script as above.
- **`"<word>" is spoken two ways in the script`** (from `synth` or `align`). The same display word is said differently
  in two lines, or has a `spoken` in one line and is plain in another. Write it the same way in every line, or rephrase
  one line, through `lib/script/cli.ts write` (whole `{"lines": [...]}` list, new version), then run `synth` and `align`
  again.

## Rules

- Never hand-edit `audio/` or `data/timing.json`. Only `synth` and `align` write them.
- After any script change, run `synth` then `align`.
- Voice and timing have no creator gate. Ask before a paid call (the cost refusal above), and nothing else.
