# Video Machine

A Claude Code plugin that turns a **concept** (a one-line idea up to a full script) and any source material you have
(navigation videos, a product URL, files, reference links, or nothing) into a **motion-graphics reel**, with an
optional talking presenter.

Claude researches on the web, gathers and makes its own assets, writes a cited script, proposes two looks, storyboards
every scene from real frames, voices and times the script, renders with [HyperFrames](https://www.npmjs.com/package/hyperframes),
checks the result and delivers MP4 + SRT (+ an After Effects handoff). You approve at four gates: script (G1),
storyboard (G2), scenes (G3) and delivery (G4).

**v0.1 makes reels:** 1080×1920, 15–60 s, for Instagram Reels, TikTok and YouTube Shorts. Long-form 16:9 with chapters
is planned.

## Install

In Terminal:

```
claude plugin marketplace add sumitIsLearning/video-machine
claude plugin install vm@video-machine
```

The repository is private for now: you need read access to it on GitHub, and git on your machine signed in to an
account that has it.

Then open the folder you want your videos in and type `/vm:setup` (or say **"set up the Video Machine"**). Setup tells you what it will
download (about 1 GB in total: Python venv, voice and alignment models, Chrome for rendering), asks once, then installs
and checks everything.

### Requirements

| Tool | macOS | Windows | Linux |
|---|---|---|---|
| Node.js 22+ | `brew install node` | `winget install --id OpenJS.NodeJS.LTS -e` | your distro's Node 22+ |
| ffmpeg + ffprobe | `brew install ffmpeg` | `winget install --id Gyan.FFmpeg -e` | `sudo apt install ffmpeg` |
| uv | `brew install uv` | `winget install --id astral-sh.uv -e` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

Setup finds missing tools and shows these commands for your OS. Everything else (bun, Python packages, models,
Chrome) is installed by setup inside the plugin and your workspace.

## Commands

Type `/vm` to see them:

| Command | What it does |
|---|---|
| `/vm:setup` | install and check the tools |
| `/vm:new <idea or concept>` | start a new video |
| `/vm:status` | setup health and where each run stands |
| `/vm:feedback <what to change>` | change the video at whatever gate it is waiting at |

## Make a video

1. Type `/vm:new <idea>` (or just say **"make a video about …"**). For more detail, copy `CONCEPT-TEMPLATE.md`
   from the plugin, fill in what you know (one line is enough), and paste it to Claude.
2. Answer at most three questions. Claude writes the brief and shows it as a table.
3. Approve the script (G1), pick one of two looks, approve the storyboard boards (G2), check the scenes (G3) and the
   final cut (G4). Give feedback in plain words, or with `/vm:feedback`, at any gate.
4. Find the MP4, SRT and After Effects package in `runs/<run_id>/out/`.

Ask **"how are my videos doing?"** (or `/vm:status`) at any time to see where each run stands.

### Layouts with a presenter

Add a presenter clip of yourself reading the script (or a HeyGen avatar from a portrait) and choose a layout in the
concept's `LAYOUT` block:

- **Graphics on top, presenter below** (default with a presenter; split 55/45 up to 75/25). Scenes voiced as
  voiceover hide the presenter and use the full frame.
- **Presenter in a corner / over the graphics.**
- **Graphics only** (default without a presenter).

## Costs and keys

Everything runs locally and free by default: Kokoro voice, local alignment and transcription, HyperFrames rendering.
Paid services (HeyGen avatars) use **your own key** in the workspace `.env` (`HEYGEN_API_KEY`), and every paid call
stops first to show the estimated price and ask. Never paste a key into the chat.

## Skills

| Skill | Part |
|---|---|
| `new` | intake and the whole pipeline |
| `setup` | install and check tools |
| `status` | setup health and run progress |
| `feedback` | route feedback to words, plan or scenes, at any gate |

Internal steps (Claude calls these; they are not in the `/vm` menu):

| Skill | Part |
|---|---|
| `research`, `capture` | web research, page captures, product replays |
| `storyboard` | script (G1), looks, storyboard (G2) |
| `voice` | voiceover and word timing |
| `avatar` | presenter segments and placement |
| `scenes` | scene writing, render and checks (G3) |
| `deliver` | audio mix, exports, final check (G4) |

## Licence

MIT, see [LICENSE](LICENSE).

Third-party components keep their own licences: HyperFrames (Apache-2.0), GSAP (GSAP Standard "no charge" licence),
Playwright (Apache-2.0), zod (MIT), bun (MIT), Kokoro TTS model (Apache-2.0), wav2vec2-base-960h ONNX (Apache-2.0),
NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), and the vendored aligner analysis scripts in
`lib/adapters/align/ctc-onnx/analysis/` (MIT, © Giacomo Magnanini). Media you supply or Claude gathers keeps its own
licence; the asset panel records each one, and reference-only material is never put in a video.
