# Theme Vault

Captures the "theme" of any Perchance generator — its mood, aesthetic, color palette and vibe — and stores it in a personal, persistent reference library.

## How it works

- User enters a Perchance generator name or URL.
- App fetches its source via `https://perchance.org/api/getGeneratorsAndDependencies?generatorNames=<name>` (main.pjs).
- Fetches its HTML panel via `https://perchance.org/api/getGeneratorHtml?generatorName=<name>` — this endpoint is CORS-blocked to browser fetch, so it goes through `super-fetch-plugin`.
- Parses the generator's `$meta` block (title / description / image / tags) from its main.pjs.
- Deterministically extracts **fonts** and **CSS tokens** from main.pjs + HTML: distinct `font-family` stacks + Google Fonts `family=` params, `@import`/`<link>` font URLs, `:root` custom properties, and key `body`/`html` styles (background, color, font-family, size, radius, shadow, etc.).
- Sends truncated snippets (5000 chars each of main.pjs + HTML) + metadata to `generateText` (ai-text-plugin) which returns a structured theme reference:
  `GENRE / MOOD/VIBE / VISUAL AESTHETIC / COLOR PALETTE / CORE SUBJECT / THEME IN ONE LINE / TAGS`.
- Optionally generates a mood image (text-to-image-plugin) from the theme lines.
- Saves the card to the user's personal library.

## Storage

`kv-plugin`, folder `themeVault`:
- key `order` — array of card ids (newest first)
- key `card_<id>` — card object `{id, name, title, description, tags[], theme, image, notes, fonts[], fontLinks[], cssVars{}, keyStyles{}, createdAt}`

`image` is either the generator's own `$meta.image` URL or a `data:` URL from a generated mood image (stored locally, never uploaded).

The CSS snippet shown on a card is derived at render time from `fontLinks` + `cssVars` + `keyStyles` via `buildCssCode()` (resolves `var(--x)` references against the captured vars) — it isn't stored separately.

## Features

- Capture a generator theme by name/URL
- Font chips (the exact `font-family` stacks + Google Fonts families the generator uses)
- "Recreate CSS" snippet per card: `@import` font links + `:root` custom properties + key `body` styles, copyable — enough to restyle a project to match the captured theme
- Optional mood image at capture time (checkbox), or per-card "Mood image" button
- Search across title/name/theme/fonts/CSS values/tags/notes
- Editable notes per card (debounced autosave)
- Copy theme text to clipboard (reuse it as a design reference)
- **Export / Import** — back up or move your vault:
  - *Export JSON* — lossless full backup (all fields, incl. embedded mood images)
  - *Export Markdown* — a readable reference document (one section per theme: fields, theme lines, notes, fonts, CSS, mood image) that can be imported back
  - *Import* — accepts either format; JSON restores original cards (existing ids are skipped), Markdown is parsed into new cards
- Two-step delete (click → "Confirm?" → click)

## Code layout

- `index.html` — entire app (styles + markup + one script). All logic lives here.
- `main.pjs` — `$meta` (title "Extrax", description, 1:1 display-card image) + plugin imports (`ai-text-plugin`, `text-to-image-plugin`, `kv-plugin`, `super-fetch-plugin`).

## Notes / gotchas

- Generators that don't exist or aren't public return "Couldn't find a generator".
- `getGeneratorHtml` fails for generators that aren't public/editable; when it does, the card is still captured from main.pjs alone (fonts/CSS sections will be sparse).
- The theme prompt slices main.pjs and HTML to 5000 chars each and escapes `${` so it can't be evaluated as a JS template literal.
- AI + image generation each take up to a minute; the progress bar shows the current step.
- The `Mood image` buttons and capture checkbox both call `makeMoodImage()` (no throttle — quota/queueing is handled by the plugin).
