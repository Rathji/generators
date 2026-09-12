# TODO

## Localization queue

The generator UI is fully translatable. Adding a language = three edits to `main.pjs` (see
`src/README.md` → "Adding a language"). UI strings and option labels are translated; the image
prompt fragments stay English on purpose.

Legend: `[x]` shipped · `[ ]` planned

### Shipped
- [x] English — `en` — English (default / fallback)
- [x] Portuguese (Brazil) — `pt` — Português (BR)
- [x] Japanese — `ja` — 日本語
- [x] French — `fr` — Français
- [x] Spanish — `es` — Español
      Notes: `guidanceHeading` = "Fidelidad al prompt"; `densityHeading` = "Trama (screentone)".

### Tier 1 — do these next (best reach/fit)
- [ ] Italian — `it` — Italiano
      Notes: one of Europe's biggest manga markets. Straightforward.
- [ ] Indonesian — `id` — Bahasa Indonesia
      Notes: very large manga/anime fandom, heavy browser-tool usage. Straightforward.

### Tier 2 — solid
- [ ] German — `de` — Deutsch
      Notes: watch long compound words in chip buttons; verify no overflow at 1280 / 390 px.
- [ ] Russian — `ru` — Русский
      Notes: Cyrillic; words often longer than PT/FR — check chip wrapping.
- [ ] Chinese (Simplified) — `zh` — 简体中文
      Notes: no spaces between words. Set `appTitle` with NO trailing space (see the `ja` block);
      CJK font fallback already proven with Japanese. Manhua is usually full-color, so the B&W
      niche is smaller.
- [ ] Korean — `ko` — 한국어
      Notes: same CJK handling as `ja`/`zh` (no trailing space in `appTitle`). Manhwa/webtoon is
      mostly color, so niche is smaller.

### Tier 3 — smaller, still cheap to add
- [ ] Vietnamese — `vi` — Tiếng Việt
      Notes: Latin with heavy diacritics; strings run longer — check chip widths.
- [ ] Thai — `th` — ไทย
      Notes: no inter-word spaces; verify buttons wrap/break cleanly. Set `appTitle` with no
      trailing space if it reads better.
- [ ] Filipino — `tl` — Filipino
      Notes: straightforward.
- [ ] Turkish — `tr` — Türkçe
      Notes: straightforward; watch longer words.

### Deferred — RTL (needs real layout work, not just strings)
The current CSS/layout is LTR-only. These require more than translation:
- [ ] Arabic — `ar` — العربية
- [ ] Hebrew — `he` — עברית
- [ ] Persian — `fa` — فارسی
- [ ] Urdu — `ur` — اردو

RTL work would include: setting `dir="rtl"` on `<html>` / `document.documentElement.dir` when the
active language is RTL, mirroring the `::before` accent bars on headings (`.group h3::before`),
mirroring the masthead order, and checking the `·` separators in `#summaryEl` and the `.lightbox`
caption. Do the string tables first, then the layout pass. Do not mark one of these "done" until
it has been visually checked (vision tool) at 1280 px and 390 px.

## Per-language checklist (copy for each new language)

- [ ] 1. Append `{ code, label }` to `languages` in `mangaI18n()`
- [ ] 2. Add `strings.<code>` — translate all 48 keys (English block is the reference)
- [ ] 3. Add `labels.<code>` — scenes 37, periods 8, weathers 7, angles 7, styles 8,
         densities 3, details 3, extras 11
- [ ] 4. `page_refresh`, switch via `#langSelect`, confirm: 97 chips + all headings/static
         strings translated, and no item falls back to English (a missing label renders as its
         raw `id`, e.g. `tokyo-street`)
- [ ] 5. Check no horizontal overflow at 1280 px and 390 px (`document.documentElement.scrollWidth`)
- [ ] 6. Update `$meta.description` + `$meta.tags` to list the shipped languages
