# Business Template (duplicate-me-business-starter)

This generator is a byte-exact duplicate of https://perchance.org/business-template.

- main.pjs  — $meta + plugin imports + the entire page `config` (branding, theme,
  colors, product copy, features, stats, charts data, testimonials, manual, FAQ,
  footer). Edit text/colors here, or use the on-page ⚙ settings panel (JSON
  import/export, website color scanner, live preview).
- index.html — static page markup; all text is filled in at load time.
- src/template.css — stylesheet (colors/radius driven by CSS custom props set
  from `config`).
- src/template.js — app logic: config loading (with localStorage override), page
  rendering, settings panel, color scanner, JSON import/export, share links.

Rebuild recipe if needed: re-download perchance.org/business-template (fetch its
public page HTML, read `<script id="preloaded-generator-data">` for the
srcManifest CDN keys of template.css / template.js, fetch each from
https://user.uploads.dev/file/<key>), or just ask the AI to re-copy this repo.
