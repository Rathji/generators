# display-card-standards

The house standard for the project cards on **https://perchance.org/rathjis-generators**.
This page defines what a "beautiful display card" is, gives the rathjis-generators
AI helper a copyable template, a reproducible detection method for finding
icon-only cards, and a **live audit** that tracks the upgrade.

## What ships

- `main.pjs` — `$meta`, the `superFetch` import, and the copyable `displayCard`
  component (resolve helper + CSS injection + stamp + entry point, same shape
  as the rathji-template components), plus `displayCardPresets`/`displayCardOpts`
  and the `displayCardStandard` spec list.
- `index.html` — the docs page: Standard → Template (live before/after demo) →
  Method → Live Audit → Instructions-for-the-AI-helper. The three copyable code
  blocks (`COMPONENT_CODE`, `METHOD_CODE`, `SOP_CODE`) mirror `main.pjs` — keep
  them in sync if you edit the component.

## The audit (how icon-only cards are detected)

1. `getGeneratorHtml?generatorName=rathjis-generators` (via `root.superFetch` —
   direct `fetch` to perchance.org APIs is CORS-blocked from the preview iframe).
2. Extract the `PROJECTS` object literal: match `const PROJECTS` up to
   `const CAT_META`, `new Function("return " + src)()`.
3. A card is **icon-only** when its entry has no non-empty `image`/`img` field.
4. For planning: batch `getGeneratorStats?names=<slugs>` (15 at a time) to see
   which linked generators already have a `$meta.image` to reuse.

Run it live: the **Scan rathjis-generators** button (`window.runAudit`).

## Upgrade SOP (what the AI helper does)

The full instructions are copyable on the page (`#instructions`). In short:
reuse each linked generator's `$meta.image` when one exists, otherwise generate
a fitting banner (text-to-image-plugin + upload-plugin), add only the `image`
field to the project entry, render cards via `displayCard()`, and re-run the
audit until it reports 0 icon-only cards.

## Generated demo assets

- Fantasy banner: `https://user.uploads.dev/file/304c0949839eae0777aafcd53ffa897e.jpg`
- Arcade banner: `https://user.uploads.dev/file/1002bad7c4b339fae4ab00b664c4167f.jpg`
