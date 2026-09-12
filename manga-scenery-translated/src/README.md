# Manga Scenery (B&W) — generator notes

An AI image generator for **traditional black-and-white manga backgrounds/scenery** (no
characters, no text). Hosted on Perchance; the public page is `https://perchance.org/<generatorName>`.

## Files

- `main.pjs` — Perchance-js: `$meta`, the `text-to-image-plugin` import, the option lists
  (`mangaOptions()`), the prompt builders (`mangaBase()`, `mangaNegative()`,
  `buildMangaPrompt()`), and the localization tables (`mangaI18n()`).
- `index.html` — the whole UI (styles + markup + one `<script type="module">`). Reads the option
  lists and translation tables from `root` and renders the control panel, stage, history strip
  and public gallery.

There is no other `src/` payload; see `src/TODO.md` for the language queue.

## How generation works

`buildMangaPrompt(opts)` joins the chosen scene + period + weather + angle + style + density +
detail + extras, then appends the fixed `mangaBase()` style string. `mangaNegative()` is passed as
the `negativePrompt` — this is what forces pure monochrome and excludes people/text. The UI calls
`root.generateImage({...})` once per tile (one plugin iframe per image), polls each iframe's
`textToImagePluginOutput.dataUrl`, and shows loaders + a session history.

**Prompt fragments (`v` values) are always English** — image models render best from English.
Only the *display labels* are localized.

## Localization architecture

Everything translatable lives in `mangaI18n()` in `main.pjs`:

```
mangaI18n() => {
  languages:     [ { code, label }, ... ]     // populates the #langSelect dropdown
  defaultLanguage: "en"                        // also the fallback for missing keys
  strings:  { en: {...}, pt: {...}, ja: {...}, fr: {...}, es: {...} }   // 48 UI strings per language
  labels:   { en: { scenes:{id:label}, periods:{}, ... }, ... } // display labels for option items
}
```

Option items in `mangaOptions()` carry a stable `id` (e.g. `"tokyo-street"`) next to the English
prompt fragment `v`. The UI resolves display text via:

- `t(key)` in `index.html` → `strings[lang][key]`, falling back to `defaultLanguage` (English),
  then to the raw key.
- `lbl(group, id)` → `labels[lang][group][id]`, same fallback chain.

The active language is persisted in `localStorage` under the key `manga-scenery-lang`. Because a
missing key falls back to English (never crashes), a partial translation degrades gracefully.

Direction is set on `<html>` from the active language (`document.documentElement.lang`). RTL
languages are not supported yet — see `src/TODO.md`.

## Adding a language

1. Append `{ code: "xx", label: "Native name" }` to `languages` in `mangaI18n()`.
2. Add a `strings.xx` block: copy the `en` block and translate all 48 values.
   - `appTitle` + `appTitleAccent` are concatenated with no space between them, so include a
     trailing space in `appTitle` for space-separated scripts (e.g. `"Manga "`), and omit it for
     CJK (e.g. `"漫画"`).
3. Add a `labels.xx` block: translate every item in every group
   (scenes 37, periods 8, weathers 7, angles 7, styles 8, densities 3, details 3, extras 11).
   Keys must match the `id`s in `mangaOptions()` exactly.
4. Verify (no tooling needed beyond the live preview):
   - reload, switch via `#langSelect`, and confirm every heading/button/label is translated;
   - a missing label renders as its raw id (e.g. `tokyo-street`), so scan for those;
   - there are 97 chips in the control panel (including 3 clearable `—` chips);
   - confirm `document.documentElement.scrollWidth === window.innerWidth` at 1280 px and 390 px
     (no horizontal overflow from longer text).
5. Update `$meta.description` and `$meta.tags` to list the shipped languages.

## Gotchas

- `emptyState` strings already contain the `<b>{button}</b>` markup, so `applyStaticText()` replaces
  `{button}` with the plain button label (not another `<b>…</b>`). Keep it that way or you get
  nested `<b>` tags.
- `applyStaticText()` targets elements by id, but `#emptyState`/`#emptyTextEl` are removed once the
  first generation clears `#grid`, and `#nothingYetEl` is removed when history starts. Those
  lookups are guarded on purpose — keep them guarded.
- On switching language mid-session, `refreshTiles()` and `refreshHistory()` re-localize already
  generated tiles/captions, so tiles store `_sceneV`/`_custom`/`_realSeed` rather than a baked
  caption string.
