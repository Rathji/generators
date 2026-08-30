# File Format Converter

A Rathji-branded text/structure converter, styled after the
[rathji-template](https://perchance.org/rathji-template) aesthetic (dark/light
theme, accent color, settings panel, "Rathji's Projects" nav pill, footer).

## What it does
Input (pasted text, attached file, or URL via Jina Reader `https://r.jina.ai/<url>`)
is converted from a chosen **From** format to a chosen **To** format. Only
sensible pairs are enabled; nonsense pairs show a helpful explanation instead.

### Conversion library (all live)
- JSON ⇄ YAML
- CSV → JSON, JSON → CSV (flat data only)
- CSV → Markdown table, Markdown table → CSV
- CSV → HTML table
- XML ⇄ JSON
- XML → CSV, CSV → XML
- Markdown ⇄ HTML (marked / turndown)
- HTML → JSON (title + headings + links)
- text → Markdown / JSON (wrapper) / HTML (escaped pre)

Library dependencies loaded at runtime from esm.sh:
`js-yaml`, `fast-xml-parser`, `marked`, `turndown` (all pinned in the module
script in index.html).

## Files
- `main.pjs` — `$meta` (title/description/tags, minimal header).
- `index.html` — all markup, styles, and the conversion module.
- `src/README.md` — this file.

## Settings
Persisted in `localStorage` under `ffConverterSettings`; supports URL overrides
`?theme=light&accent=%23ec4899&size=18&motion=true`. Accent/theme/text-size
apply via CSS variables (`--accent`, `--accent2`) set on `<html>`.
