# Reel layouts, safe zones, hooks and genres

Researched 2026-10-20. Labels: [primary] = platform or first-party page; [secondary] = third-party blog, creator-education or tool vendor (lower confidence); [design] = our own judgment, no source claims it.
Primary sources are thin on layouts and genres. Where they are silent, this file says so rather than filling in numbers.

## Summary
- Only one primary source gives safe-zone numbers: Meta's Reels *ads* guide says leave roughly 14% top, 35% bottom, 6% each side free of text/logos/key elements [primary] (https://www.facebook.com/business/ads-guide/update/image/instagram-reels).
- Our `reel` safe values are top 0.14, bottom 0.20, sides 0.06. Top and sides match Meta. Bottom (0.20) is 15 points short of Meta's 35%. Recommend raising bottom to 0.35 for text/captions (see Safe zones).
- YouTube Shorts and TikTok: no primary pixel values found. YouTube says only "keep key content away from the right edge" (Shorts ads) [primary]; TikTok says "stay within the UI safe zone per ad specifications" and the spec page failed to load [primary]. Third-party numbers conflict.
- No primary source defines presenter layouts (corner, split, cut-out). Layout proportions below are [design] unless stated.
- Hook timing, by platform: Instagram "grab attention in the first 3 seconds" (secondhand report of an in-app tip) [secondary-of-primary]; TikTok Ads: proposition in first 3 s, hook within first 6 s [primary]; TikTok Creator Academy: attention-grabbing element ideally within first 5 s [secondary snippet, page not readable]; YouTube blog: Shorts creator Jenny Hoyos says "one second to hook someone" [primary, a creator quote, not a YouTube rule].
- Structure recommended by TikTok Ads: hook, then selling points, then clear CTA at the end [primary]. Meta says use the safe zone for the opening hook and the closing CTA [primary].
- Text pacing: TikTok Ads says 5-10 words per second when using text [primary]. Captions: Creator Academy says over 30% of surveyed users watch on mute [secondary snippet]; Meta says over 75% of Reels views are sound-on, so use audio [primary]. Design both: captions and audio.
- Length: Instagram tip reported as 30-60 s performs better (Social Media Today quoting the in-app Professional Dashboard) [secondary]; YouTube Shorts ads under 60 s, 10-30 s for action-oriented [primary]; TikTok ads page gives no length. Our 15-30 s range is inside all of these; none of them say 15-30 s is optimal.
- Presenter/creator content is recommended for ads by all three: TikTok ("feature creators, employees, customers"), Meta (creator partnership ads), YouTube (authentic creator content) [primary]. None specify a screen layout.
- Genres: TikTok publishes a "Storytelling Formats" one-pager, but the PDF could not be read here; genre-to-layout mapping below is [design] plus [secondary].

## Layouts
Proportions are [design] unless noted. No primary source specifies presenter layouts. Frame is 1080x1920.

| Layout | When it works | Typical proportions | Captions / on-screen text |
|---|---|---|---|
| Corner overlay (today: corner-br, corner-bl) | Content is the star (charts, UI, diagrams); presenter adds trust. Avoid br when right-side button column is busy | Presenter circle/rounded box ~25-35% of width | Captions centered in the content area; keep out of the avatar box and bottom reserve |
| Top/bottom split 70/30 (today: `bottom` is close) | Dense visual content with short narration; presenter is secondary | Content 70% top, presenter 30% bottom (~576 px). Bottom 30% overlaps the UI reserve, so presenter face must sit above the lowest 35% line, which a 30% strip cannot do | Captions on the seam or inside the content zone, not in the presenter strip |
| Top/bottom split 60/40 | Presenter-led explainer with supporting visual | Content 60% (1152 px), presenter 40% (768 px); face in the upper part of the presenter band | Captions on the seam, just below the content band; avoid bottom 35% |
| Full-frame presenter + motion-graphic cutaways (today: `full`) | Personality-led, opinion, story; graphics support key points | Presenter full frame; cutaways full frame for 1-3 s | Captions lower-middle, above bottom reserve; keyword text during cutaways |
| Cut-out presenter over content, no box | Premium look; content is the backdrop and the presenter overlaps it | Presenter ~45-60% of height, anchored low, content visible behind and above | Headline/keywords at top-middle; captions above the bottom reserve; keep text from crossing the face |
| Picture-in-picture (small inset) | Showing a screen recording or product while the speaker comments | Inset ~20-30% width, top-left or top-right under the top reserve | Captions center |
| Side-by-side / reaction (stacked in vertical) | Reacting to a clip, stitch/duet-like | Two halves 50/50 stacked; reactor on bottom half | Captions on the seam |
| Green-screen style (presenter in front of full-bleed image/screenshot) | News, commentary, "look at this" | Presenter cut-out 40-55% of height over a full-frame image | Source label small near top; captions mid-lower |
| No presenter (motion graphics only) | Listicles, stats, product demo, silent-first | Full-frame scenes | Everything inside safe area |

Sources for layout claims: none primary. Meta says only to keep key messages in the safe zone [primary] (https://www.facebook.com/business/ads/facebook-instagram-reels-ads). Third-party safe-zone pages are the only layout-adjacent material [secondary].

## Safe zones
Pixels for 1080x1920. Our `reel` safe: top 0.14 (269 px), bottom 0.20 (384 px), left/right 0.06 (65 px).

| Platform | Top | Bottom | Sides | Right button column | Source |
|---|---|---|---|---|---|
| Instagram Reels (ads) | ~14% = 269 px | ~35% = 672 px | ~6% = 65 px each | Not stated | [primary] https://www.facebook.com/business/ads-guide/update/image/instagram-reels (wording: "Consider leaving roughly 14% of the top, 35% of the bottom, and 6% on each side ... free from text"). Meta's Help Center article "About text overlays and the Safe Zone" (https://www.facebook.com/business/help/980593475366490) exists but its body could not be read here. |
| Instagram Reels (organic) | Primary silent | Primary silent | Primary silent | Primary silent | Third parties give 13-15% top, 23-35% bottom: https://adkit.so/tools/safe-zones/instagram, https://www.hopperhq.com/blog/instagram-reel-size/ [secondary] |
| YouTube Shorts | Primary silent | Primary silent | Primary silent | "Keep key content away from the right edge" (like/dislike/comment/share on the right), no dimensions [primary, ads] https://support.google.com/google-ads/answer/16041697 | Organic Shorts help page has no safe-area guidance [primary silent]: https://support.google.com/youtube/answer/10059070 |
| TikTok | Primary silent in readable pages | Primary silent | Primary silent | Primary silent | TikTok says keep content within the UI safe zone "per ad specifications" [primary] https://ads.tiktok.com/help/article/creative-best-practices. The spec page returned "article no longer exists" in our fetch. Third parties disagree: top 130-240 px, bottom 350-660 px, right 120-180 px [secondary] https://www.socialync.io/tools/safe-zones/tiktok, https://www.trymypost.com/blog/tiktok-ad-specs-2026-safe-zones |

Comparison and recommendation for `FORMATS.reel.safe`:
- top 0.14: matches Meta (14%). Keep.
- left/right 0.06: matches Meta (6%). Keep. Does not clear a right-side button column (third-party 120-180 px, unverified). Handle that per element instead of widening globally: avatar presets and captions should avoid the lower-right ~35% x 20% region (design).
- bottom 0.20: too small versus Meta's 35%. Recommend 0.35 (672 px) for text, captions and presenter faces. Cost: usable height drops from 1267 px to 979 px (the same ~950x979 Meta quotes is [secondary] via https://www.socialync.io/tools/safe-zones/instagram). Background imagery may still bleed into the reserve.
- Caveat: Meta's figures are for ads, which carry an extra CTA/profile bar. Organic Reels may need less; primary silent. The conservative choice is the ads number since a reel may be boosted.
- Alternative if 0.35 is too tight: add a second token (e.g. `safe` for graphics at 0.20 and `textSafe` for captions/faces at 0.35). This is a design choice.

## Hooks and scripts
Primary claims:
- Instagram: the in-app Professional Dashboard tips are reported as "Grab attention in the first 3 seconds" and 30-60 s Reels performing better; this is a news article quoting the tips, not the Instagram page [secondary] https://www.socialmediatoday.com/news/instagram-shares-tips-reels-creators/721054/. Instagram's creators site pages we could read have no hook/length/text numbers [primary silent] https://creators.instagram.com/create-engaging-content.
- Meta ads: put the hook and CTA inside the safe zone; use audio since over 75% of Reels views are sound-on; hook seconds and length not specified [primary] https://developers.facebook.com/blog/post/2024/11/07/unlock-the-power-of-reel-ads/ and https://www.facebook.com/business/ads/facebook-instagram-reels-ads.
- TikTok ads: hook in first 6 s with suspense/surprise/emotion; proposition in first 3 s; structure hook, selling points, CTA at end; text at 5-10 words per second; transitions, stickers and graphics to retain attention; feature creators; DIY, non-polished style; use sound; no length recommended [primary] https://ads.tiktok.com/help/article/creative-best-practices.
- TikTok Creator Academy (via search snippet; page not readable): attention-grabbing element ideally in first 5 s; beginning-middle-end; over 30% watch on mute [secondary] https://www.tiktok.com/creator-academy/en/article/elements-of-tiktok-video?lang=en.
- YouTube: grab attention in the first few seconds [primary, blog] https://blog.youtube/creator-and-artist-stories/your-guide-to-getting-started-with-youtube-shorts/ (search snippet); Hoyos "one second to hook someone", shock-intrigue-satisfy formula; each Short built from small "bits" each with a mini-story [primary, creator quote] https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/. YouTube Studio offers "Get feedback" analysing hook and pacing [primary] https://support.google.com/youtube/answer/10059070.
- YouTube Shorts ads: under 60 s; 10-30 s for action; CTA button appears at 3 s or 10 s depending on campaign type; music/voiceover linked to >20% conversion lift (Google's claim); text overlays suggested [primary] https://support.google.com/google-ads/answer/16041697.
- YouTube end of Short: build verbal and visual cues in the final 5 seconds toward the next video [primary, search snippet] https://blog.youtube/creator-and-artist-stories/youtube-related-videos-traffic-guide/.

Primary sources are silent on: cut frequency, specific retention-vs-length curves, with-vs-without presenter hook rules, exact text size. No numbers invented here.

Secondary, lower confidence (creator-education/vendor blogs): first frame must work without sound; hook text 5-10 words, high contrast; opening on a text overlay of the problem can beat opening on a talking head (one creator's test, not generalizable); pattern interrupts and open loops; hook-value-CTA structure. Examples: https://www.truefuturemedia.com/articles/instagram-reels-hooks-two-step-test, https://www.lilachbullock.com/?p=111912, https://klap.app/blog/youtube-shorts-best-practices.

Practical script shape that combines the primary claims [design]:
- 0-1 s: first frame legible muted; one visual or one line stating the payoff/problem. 
- 1-3 s: hook text on screen and spoken proposition (TikTok 3 s). 
- 3-6 s: finish the hook promise setup (TikTok 6 s).
- Middle: one idea per beat; text at <= 5-10 words per second.
- Last 3-5 s: CTA, inside safe zone; for YouTube, cue the next piece in the final 5 s.
- Without presenter: hook is on-screen text plus motion; with presenter: hook line spoken to camera plus the same text as caption.

## Genres
Layout and hook columns are [design] informed by the primary claims above; no primary source maps genres to layouts. TikTok's Storytelling Formats one-pager (https://ads.tiktok.com/business/library/Storytelling_Formats_One_Pager_SMB.pdf) is the likely primary source but was unreadable in this run.

| Genre | Layout | Hook pattern | Graphics vs presenter |
|---|---|---|---|
| Educational explainer | 60/40 split, corner overlay, or cut-out | Question or surprising fact, text on screen | Either; graphics carry the explanation |
| Product demo | Full-frame screen/product with corner or PIP presenter | Show the outcome first, then how | Graphics-led; presenter optional (TikTok/Meta/YouTube all favor creator-style ads [primary]) |
| Story / case study | Full-frame presenter with cutaways | Start at the conflict or result | Presenter-led; graphics as cutaways/stats |
| Listicle / tips | Motion-graphics full frame, numbered cards | "N things..." number in first frame | Graphics alone works; presenter optional |
| News / commentary | Green-screen style or 70/30 split | The claim or headline, with source label | Presenter plus graphics |
| Before / after | Full-frame wipe or stacked halves | Show "after" first or the contrast frame | Graphics/footage alone |
| Myth vs fact | Full-frame text cards or split | State the myth as the hook | Graphics alone or either |
| Stat / data reveal | Full-frame chart | Surprising number first | Graphics alone |
| Reaction / stitch | Stacked halves | React in first second | Presenter-led |
| Tutorial / how-to steps | Content top, presenter small, or PIP | Final result first | Graphics-led with voiceover |

## Implications for Video Machine
Layout presets to add to `AVATAR_PRESETS` (today `corner-br`, `corner-bl`, `bottom`, `full`):
- `split-70-30` and `split-60-40` (replace or refine `bottom`; define content and avatar rectangles and clamp the avatar face above the text-safe bottom line).
- `cutout` (background removed, no box, anchored low), the one that uses the existing background removal best.
- `pip-top` (small inset in a top corner), optional.
- `none` (graphics only) as an explicit choice so the pipeline does not assume an avatar.
- Defer green-screen and reaction until there is a source-clip feature.

Where the creator picks it: Gate 2, next to the look, as one choice "Layout" with a thumbnail per preset and a recommended default derived from genre (table above). The choice should be recorded once and not re-asked.

What each stage needs:
- `layout.safe_area` / `FORMATS.reel.safe`: raise bottom to 0.35 or introduce a second token (graphics-safe 0.20, text-safe 0.35). Add a per-preset content rectangle so scenes lay out inside the content region, not the full frame. Add a reserved lower-right region for the button column (unverified size).
- M7 look: each look needs caption position and size per layout (captions on the seam for splits, above the bottom reserve for full/cut-out); look boards should render each preset.
- M6 script: carry a `genre` and hook-type field; require a hook line plus on-screen hook text for 0-3 s; word budget with text at <= 5-10 words per second; CTA beat inside the last 3-5 s; length target default 15-30 s (inside every cited range; none say it is optimal).
- Scene intents should know the layout so content scenes do not place key elements under the avatar or in the bottom reserve.

## Reference example 1: stacked split, graphics over presenter (creator pick, 2026-10-20)
Screenshot `1000197039.jpg` (Instagram Reel, @denis.panjuta, LinkedIn tips). Measured on the screenshot's video area.
- **Split ~55/45**: graphics panel on top (0-54%), filmed presenter below (54-100%). Not 70/30.
- **Seam**: a thin accent line across the full width, with a topic chip ("LINKEDIN", green, bold caps) centred on it.
- **Top panel**: plain white ground; the hook as kinetic type, mixed faces (black bold grotesk "who actually" + large
  italic serif in the accent colour "Strong Presence?") around a tilted 3D logo with a soft coloured shadow. Text
  starts ~15% from the top, just under the top reserve.
- **Presenter band**: real footage with its own room background (not cut out), head-and-shoulders, face centred in
  the band (~62-75% of frame height), so Instagram's name/caption/buttons cover only shoulders and the mic.
- **Safe-area effect**: all on-screen text lives in the top panel, so the bottom 35% UI reserve never hides text.
- **Hook**: a question in the first frame; CTA is a comment keyword in the post caption ("Comment 90DAYS"), not in
  the video.
- **Content, not format**: the LinkedIn logo, the question and the white ground are this video's content and
  look. Only the split, the presenter band and the seam position are the layout.
- **Implications**: a `stack-top` preset with an adjustable ratio (default 55/45); the presenter is on screen for the
  whole reel; background kept and the clip cropped to fill the band (no `remove-background`); scenes lay out in the
  top content rect only; the seam line + chip belong to the look.
- **Creator rulings (2026-10-20)**: keep the presenter's real background (crop to fill, no background removal).
  The presenter is on screen for most of the reel, but a scene may go full-frame graphics and hide the presenter
  band when the graphic needs the whole screen; the voice keeps playing.

## Open gaps (primary silent)
- Organic Reels, Shorts and TikTok safe-zone pixel values; right-side button column dimensions.
- Cut frequency / pacing numbers.
- Retention versus length data.
- Hook rules specific to presenter vs no presenter.
- Genre-to-layout mapping; TikTok Storytelling Formats and Creator Academy pages and the Meta Help Center safe-zone article were not readable in this run (PDF/page extraction failed).

## Sources
Primary
- https://www.facebook.com/business/ads-guide/update/image/instagram-reels
- https://www.facebook.com/business/help/980593475366490 (title only readable)
- https://www.facebook.com/business/ads/facebook-instagram-reels-ads
- https://developers.facebook.com/blog/post/2024/11/07/unlock-the-power-of-reel-ads/
- https://creators.instagram.com/create-engaging-content (no relevant numbers)
- https://ads.tiktok.com/help/article/creative-best-practices
- https://support.google.com/youtube/answer/10059070
- https://support.google.com/google-ads/answer/16041697
- https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/
- https://blog.youtube/creator-and-artist-stories/your-guide-to-getting-started-with-youtube-shorts/ (snippet only)
- https://blog.youtube/creator-and-artist-stories/youtube-related-videos-traffic-guide/ (snippet only)
- https://www.tiktok.com/creator-academy/en/article/elements-of-tiktok-video?lang=en (snippet only)

Secondary
- https://www.socialmediatoday.com/news/instagram-shares-tips-reels-creators/721054/
- https://www.socialync.io/tools/safe-zones/instagram and /tiktok
- https://adkit.so/tools/safe-zones/instagram
- https://www.hopperhq.com/blog/instagram-reel-size/
- https://www.trymypost.com/blog/tiktok-ad-specs-2026-safe-zones
- https://www.truefuturemedia.com/articles/instagram-reels-hooks-two-step-test
- https://www.lilachbullock.com/?p=111912
- https://klap.app/blog/youtube-shorts-best-practices
