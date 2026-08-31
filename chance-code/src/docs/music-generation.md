# generate_music — composing music for a generator

`generate_music({prompt, path})` composes a full-length song (~2-3 minutes, with real structure — intro, verses/chorus or build-ups, an ending) server-side and saves it into the workspace as an MP3 (192kbps, 44.1kHz stereo). Generation takes ~30-60s. The user gets an inline player in the chat immediately, so they can react to the track before you wire it in.

## Prompting
Describe it like a brief to a composer: genre, mood, tempo/energy, key instruments, and (optionally) an era or setting. Good: "Slow, mysterious dungeon ambience — low strings, sparse harp, distant choir, unsettling but quiet, instrumental". Weak: "dungeon music".

- Say **"instrumental"** explicitly if you don't want vocals — otherwise the model may add them (including wordless choir).
- For vocals, include the lyrics in the prompt; the result returns a `lyricsTranscript` with timing markers showing what was actually sung.
- If the music will loop (background/area music), ask for it in the prompt: "consistent energy throughout, no big intro or outro, loops smoothly".
- It cannot imitate specific artists or copyrighted songs and may refuse such prompts — describe the *style* in your own words instead.
- `seed` gives reproducibility; different seeds give different takes on the same prompt.

## Getting the music into the generator
The MP3 lands in the workspace (use `scratch/music/...`) but does NOT ship with the generator. Wire it in like this:

1. `generate_music` → `scratch/music/village.mp3`
2. `upload_file` with `path: "scratch/music/village.mp3"` → permanent URL
3. Reference the URL in code: `let music = new Audio(url); music.loop = true; music.volume = 0.5;`

**Autoplay is blocked by browsers until the user interacts with the page** — `music.play()` before the first click/keypress rejects. Start music inside the first user gesture (a "start" button, the first move in a game), or `.play().catch(() => {})` and retry on the next click. A small mute/volume toggle is almost always appreciated.

## Music design for games — use more than one track
A single looping track gets old fast. It's often a really nice touch to give each region, state, or intensity of a game its own music, e.g.:

- calm acoustic theme in the **village**, a wider airier track out in the **wilderness**, a tense low drone in the **dungeon**, and a driving percussion-heavy piece for the **boss fight**
- a mellow menu theme vs an energetic in-game theme, or a triumphant victory track vs a somber game-over one

Generate these as separate songs with a shared palette (mention the same key instruments/mood family in each prompt so they feel like one soundtrack), then switch when the player crosses a boundary. Simple crossfade:

```js
let current = null;
function playMusic(audio) {
  if (current === audio) return;
  let old = current; current = audio;
  audio.volume = 0; audio.loop = true; audio.play().catch(() => {});
  let t = setInterval(() => {
    audio.volume = Math.min(0.5, audio.volume + 0.05);
    if (old) old.volume = Math.max(0, old.volume - 0.05);
    if (audio.volume >= 0.5) { clearInterval(t); if (old) old.pause(); }
  }, 100);
}
```

Preload region tracks up front (`new Audio(url)` early, or `audio.preload = "auto"`) so transitions don't stutter.

## Limits
Generation is limited to roughly 50 songs per hour — still, plan the soundtrack first (how many tracks, what each is for) instead of iterating blindly, and reuse tracks across similar areas. A song MP3 is ~2-4MB; the upload quota (~300MB/day) comfortably fits a full soundtrack. There is no runtime music-generation plugin — music must be generated here and shipped as fixed assets.
