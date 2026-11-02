# Concept template

Fill in what you know. Delete or leave blank anything you don't. Only CONCEPT is required.
Plain free text works too; Claude will ask for anything it needs.

```text
CONCEPT (required)
What is the video about, in 1–5 sentences? What should the viewer think, feel, or do after watching?

AUDIENCE
Who is watching, and what do they already know?

GOAL / CALL TO ACTION
What should the viewer do at the end? (follow, visit URL, sign up, nothing)
End-card text, handle, or URL:

LENGTH
e.g. 30 s, 45–60 s

FORMATS
[ ] 1920×1080 (YouTube / landscape)
[ ] 1080×1920 (Instagram reel / TikTok / Shorts)
[ ] 1080×1080 (square)
[ ] 1080×1350 (Instagram feed 4:5)

LAYOUT (reels with a presenter; optional)
[ ] Graphics on top, presenter below (split: 55/45)
[ ] Presenter in a corner / over the graphics
[ ] Graphics only

TIMING / AUDIO
Voiceover: [ ] I'll supply a file: ____  [ ] Use TTS (voice: ____)  [ ] None
Music:     [ ] I'll supply a file: ____  [ ] Find one (mood: ____)  [ ] None
Text only: [ ] Yes, no voice; on-screen text carries the story

TONE
e.g. playful, premium, technical, urgent, calm

LOOK (optional; leave blank and Claude proposes two directions)
Words that describe the look, or what to avoid:
Reference videos or links I like (studied only, never copied in):

BRAND KIT (must be used as-is)
Logo file:
Colours (hex):
Fonts:

ASSETS TO SHOW
Screenshots, photos, clips, data that must appear (paths):

FACTS THAT MUST BE RIGHT
Numbers, names, product details, or a source doc to work from:

MUST INCLUDE / MUST AVOID
e.g. "mention the free tier", "no stock photos of people"

BUDGET FOR PAID SERVICES
e.g. $0 (free tools only), $5
```

## Example

```text
CONCEPT
Explain why async standups beat daily meetings for remote teams. Viewer should feel
"we waste 15 minutes a day" and want to try it.
AUDIENCE: engineering managers, remote teams
GOAL: visit standup.example.com — end card "Try async standups free"
LENGTH: 30–40 s
FORMATS: 1920×1080, 1080×1920
LAYOUT: graphics only
TIMING: TTS voiceover (calm voice), music: find one, mood "light, focused"
TONE: calm, a bit witty
LOOK: clean, lots of white space, no 3D
BRAND KIT: logo ./brand/logo.svg, colours #0F172A #22C55E, font Inter
FACTS: "average standup is 15 min" from ./notes/research.pdf
MUST AVOID: clock clichés
BUDGET: $3
```

API keys for paid services go in the workspace `.env` file. Never paste them into the chat.
