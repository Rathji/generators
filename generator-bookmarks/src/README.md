# Generator Bookmarks (slug: generator-bookmarks)

A personal bookmark manager built on the design of the `rathji-template`. Users store,
tag, search, edit and delete bookmarks; everything persists per-user via the **kv-plugin**
(IndexedDB) and survives reloads. Full JSON **import/export** is included.

## Layout
- `main.pjs` — `$meta`, the `kv = {import:kv-plugin}` import, and the vendored
  rathji badge/card helper functions (`rathjiTemplate`, `rathjiCard`, …).
- `index.html` — the whole app. Kept (and inherited from the template):
  - fixed nav bar with a settings panel (dark/light theme, accent colour, text size,
    reduce-motion) persisted in `localStorage`, URL overrides via `?theme=&accent=…`.
  - toast system with a special **undo** toast used by delete.
  - accessible modal helpers.
- Added for the bookmark app:
  - `root.kv.bookmarks` folder, single key `"items"` → array of bookmark objects.
  - Add/Edit modal with an **Image URL** field — when left empty, the app fetches the
    target page's `og:image`/`twitter:image` meta tag via `superFetch` at add-time and
    uses that as the bookmark's avatar. If none is found (or the fetch fails) the
    colored letter/emoji avatar is used.
  - Search box, clickable **tag filter** chips.
  - Delete-with-undo, download JSON export, and an import modal (paste JSON *or*
    pick a file; **Add to my board** / **Replace all**).

## Bookmark object shape
```json
{ "id", "title", "url", "desc", "tags": [], "emoji", "color", "created", "image" }
```

## Notes
- Each visitor's bookmarks are private to their own device (kv is per-user); no server.
- **⚠️ kv data can be lost** — it lives in the browser's IndexedDB for that device/profile
  and disappears if the user clears site data, uses a different browser, or visits on a new device.
  The UI shows a persistent warning banner nudging users to **⇩ Export** regularly and re-import
  elsewhere; the JSON export is the recommended backup.
- Be careful adding square brackets in any `placeholder`/attribute — the Perchance engine
  evaluates them (a `[{"a":1}]` placeholder broke parsing once).
- `image` (the field the user set or the meta image) is what the card renders; the older
  `metaImage` key is also read for backward-compatibility with older exports.
