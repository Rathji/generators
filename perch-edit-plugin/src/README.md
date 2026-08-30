# PerchEdit Plugin

A full-featured browser-based IDE (file tree, terminal, AI assistance) exposed as a reusable Perchance plugin with a **DATA/EMBED** API shape.

## Files
- `main.pjs` — the plugin. Import it into any generator as `perchEdit = {import:perch-edit}`; the imported value is the API object (see `$output`).
- `index.html` — this generator's demo/preview page: API status, catalog card grid, click-to-embed preview, and usage snippet.

## API
- `api.all()` — array of catalog items `{slug, title, description, url}`
- `api.find(slug)` — one catalog item, or `null`
- `api.embed(slug, {height})` — iframe HTML string for a catalog item
- `api.card(slug)` — HTML card markup
- `api.data()` — {slug, title, hostPage, embedHost, defaultHeight}
- `api.config` — the `perchEditConfig` list
- `api.runCode(code)` — eval a snippet, returns result or error string

## Catalog
Defined in the `perchEditCatalog` list (`editor`, `terminal`, `files`, `ai`). Each item has its own `url` embed target — currently all point at the perch-edit embed host; change per-item `url` to embed different generators.

## Gotcha (IMPORTANT)
In pjs, **never write `name() => {` with the brace on the same line** — Perchance parses `{` as the start of a special curly-block and the render hangs forever (silent, no error). Always use:
```
name(args) =>
  body line;
```
Braces on body lines (object literals, `for`/`try` blocks) are fine.
