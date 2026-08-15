# BGN Audio System

Shared sound + music for every Boardgame Network template. Added to all
five templates on the build roadmap item **"Sound & music in every template"** (now done).

## Files

| File | Purpose |
|---|---|
| `bgn-audio.js` | **Source of the shared audio library.** Re-upload with `upload_file` when changed. |
| `README.md` | This file. |

## Hosted assets (permanent URLs)

| Asset | URL |
|---|---|
| Audio library | `https://user.uploads.dev/file/346e6f5c64f15c0849bec19d5c57beb3.js` |
| Music — Blank template (calm lobby table) | `https://user.uploads.dev/file/3722354b767ff0c6c1d9b3dac1b28527.mp3` |
| Music — Standard Deck (casino lounge jazz) | `https://user.uploads.dev/file/a97b3db01d556b98aee4c8f62b3fef43.mp3` |
| Music — Non-Standard Deck (whimsical music box) | `https://user.uploads.dev/file/704005f12d53eda1f95bd43115247f4c.mp3` |
| Music — Strategy (epic cold-war orchestral) | `https://user.uploads.dev/file/d12bdc015888e3a692b5d233aadf3951.mp3` |
| Music — Pen & Paper (cozy puzzle cafe) | `https://user.uploads.dev/file/c59339d9788a635635c75c0a9d397611.mp3` |

The MP3s were generated with the `generate_music` tool (seeded variants of
each theme live in the tool's history). If you regenerate, upload and swap
the URLs in each template's `window.BGN_AUDIO` line.

## How it works

Each template's `index.html` carries two lines right after the BGN
stylesheet link:

```html
<script>window.BGN_AUDIO = { music: "https://user.uploads.dev/file/<theme>.mp3" };</script>
<script src="https://user.uploads.dev/file/346e6f5c64f15c0849bec19d5c57beb3.js"></script>
```

The library then:
- synthesizes all SFX in WebAudio (no audio files for effects),
- loops the `music` URL as background music (starts on first user gesture — autoplay rules),
- adds a fixed **🔊 mute/volume toggle** button (bottom-left; preference persisted in `localStorage`),
- auto-plays a soft click on every `<button>` press, a flip sound on `.bgn-card` clicks, and honors `data-sfx="name"` attributes.

Game code calls the API directly:

```js
BGN.sfx.play("win")   // win | lose | draw2 | turn | deal | flip | place
                      // discard | dice | draw | chip | coin | boom | warn
                      // hint | step | error | tada | click
BGN.music.play(url)   // crossfade-swap the theme mid-game
```

## Per-template wiring (what was added)

1. **bgn-blank-template** — room entry/deal, turn passes, rematch → "deal"/"turn"; win/lose/draw jingles on match end (host/guest aware).
2. **bgn-standard-deck-cards-template** — shuffle → "deal", flip → "flip" (auto via `.bgn-card`), reset → "place".
3. **bgn-non-standard-deck-template** — deal on start, card pick → "flip", stack/cover → "place"/"coin", discard → "discard", end of turn → "turn", "your turn" chime in online rooms, win/lose/draw jingles.
4. **bgn-strategy-template** — build → "place", sell/buy → "chip", move/transport → "step", combat → "dice", prospect → "deal", R&D/nukes → "warn"/"hint", nuke launch → "boom", game end → win/lose.
5. **bgn-pen-and-paper-template** — new game → "deal", erase/clear → "discard", check → "turn"/"error", hints → "hint", win → "win".

The shared game shell (`../game-index.html`) ships the same two lines plus a
dice sound, so newly forked BGN games get sound by default.

## Re-applying after the templates are edited

The upgraded template files were handed to the user as downloads. To redo
the change on any template: add the two `<script>` lines after the CSS
link, define `function sfx(n){ if(window.BGN&&BGN.sfx)BGN.sfx.play(n); }`
inside the game script, and add the hook lines listed above at the events
described. Verify with a page load (no console errors) — music will only
start after the first click/tap.
