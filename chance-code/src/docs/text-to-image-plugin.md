# text-to-image-plugin (`generateImage`) — image generation

```
generateImage = {import:text-to-image-plugin}
```

Call with a prompt string, `(promptString, optionsObject)`, a single options object, or a pjs list — `[root.generateImage(promptData)]`:

```pjs
promptData
  prompt = detailed painting of [character] in [place], [season]
  negativePrompt = blur, blurry image
  resolution = 512x768
  width = 400   // display size; height auto-picked from aspect ratio (and vice versa)
  seed = 123    // -1 (default) = random; same seed+prompt ≈ same image (model upgrades break this)
  style = border:4px solid blue;   // CSS on the output
```

## Options
- `resolution` — `512x512 | 512x768 | 768x512 | 768x768`. `size = 400` works for square only.
- `negativePrompt` — what you DON'T want (e.g. `blur`, or `NSFW, nudity` to reduce accidental NSFW).
- `guidanceScale` — prompt adherence vs realism; default 7, range 1–30.
- `removeBackground = true` — transparent-background output.
- `saveTitle` / `saveDescription` — metadata used if the user saves the image to the gallery (default: prompt up to first punctuation / whole prompt).
- `hideGalleryButtons = true` — hide the save-to-gallery/open-gallery hover buttons.
- Options can also be embedded at the END of a prompt string: `a cat (resolution:::512x768) (seed:::123)`.
- `[lastTextToImagePrompt]` — special global holding the most recently used prompt (also `[promptData.lastUsedPrompt]` per-list). Useful because re-evaluating the prompt list would re-randomize it.

## Result object (JS usage)
```js
let result = await root.generateImage({prompt: "a cute mouse"});
imageEl.src = result.dataUrl;   // result itself is String-like; `imageEl.src = result` also works
document.body.append(result.canvas);
console.log(result.inputs.prompt, result.inputs.seed);
```
Un-awaited, the promise stringifies to an `<iframe>` HTML string (live generation tile with a gallery 'heart' save button in the corner): `outputCtn.innerHTML = root.generateImage("cute cat")`. The iframe element itself gets `.textToImagePluginOutput` (`.canvas`, `.dataUrl`, `.inputs.*`) once generation finishes.

Custom "try again" button: give the promptData list `id = myImg`, then `<button onclick="myImg.reload()">try again</button>`.

## Gallery
Embed the public per-generator gallery by passing a list/object with `gallery = true`:

```pjs
galleryOptions
  gallery = true
  sort = top // or 'recent' or 'trending'
  contentFilter = g // or 'pg13' for looser moderation
  timeRange = 1-week // 1-day, 3-day, 1-week, 1-month, 1-year, all-time
  hideIfScoreIsBelow = -2
  adaptiveHeight = true // expand height to fit all images (no inner scrollbar)
  style = ... // optional CSS
  defaultGalleryNames = characters,memes,chat // clickable gallery names displayed by default
  customButton
    emoji = ⭐
    onClick(data) =>
      // data.imageId, data.imageUrl, data.userId, data.isNsfw, data.prompt,
      // data.negativePrompt, data.guidanceScale, data.seed, data.galleryName
      console.log(data);
  customButton2
    // second custom button, same shape
```
Then `[root.generateImage(galleryOptions)]` in the HTML (JS: `galleryCtn.innerHTML = root.generateImage({gallery:true})`).

### Gallery moderation
```pjs
galleryOptions
  gallery = true
  bannedUsers // toggle admin mode (gallery settings button → type "admin"), double-click an image for the creator's user ID
    263efb15c47c2d2f398e91bf...
  bannedPromptPhrases
    pg13:blood            // ban only in pg13 mode
    /twin.?towers?/       // regex patterns supported
    pg13:/\b(gore|blood)\b/i
  bannedNegativePromptPhrases
    pg13:wearing clothes
```
Admin mode outlines banned-phrase images in red instead of hiding them (for debugging regexes).

## NSFW check for hosted images (imageTags API)
Images hosted by this service (URLs like `https://aigc.uploads.dev/image/<64-hex>.jpg`, e.g. gallery saves) can be checked for NSFW content before displaying them somewhere public:

```js
let info = await fetch(`https://image-generation.perchance.org/api/imageTags?url=${encodeURIComponent(url)}`).then(r => r.json());
if (info.tags && info.tags.includes("nsfw")) { /* hide/blur/confirm-gate it */ }
```
Returns `{tags: ["nsfw"]}` or `{tags: []}`; on failure `{error: "invalid_image_url" | "not_found" | "server_error"}` — treat unknown/failed as potentially-NSFW if being cautious. `url` accepts the full URL or the bare 64-hex image id. (For files on the general upload host — user.uploads.dev — use upload-plugin's fileInfo API instead.)

## Gotchas
- Takes a few seconds to tens of seconds — always show a loading indicator. Prefer a large resolution and scale down with CSS. For static placeholders prefer inline SVG.
- Importing this plugin puts an ad on the generator for non-logged-in users.
- Few concurrent requests per user; many images on one page will queue.
- NSFW is possible if prompted for; treat like an image search. `negativePrompt = NSFW, nudity` and/or `fully clothed` in the prompt reduce accidents.
- Prompt wording changes quality DRAMATICALLY — style keywords ("oil painting, octane render, trending on artstation, masterpiece...") matter.
