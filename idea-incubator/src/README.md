# Idea Incubator

An "idea incubation studio" — paste a rough idea and run it through deep
research, a live interviewer panel, competitive analysis, and a final refined
blueprint. Built as a Perchance generator (name: `idea-refiner`).

## Architecture

- `main.pjs` — the `config` list: all static copy, branding, theme, colors,
  research areas, and the interviewer panel roster. Imports the
  `super-fetch-plugin` (used by the website color scanner), the
  `ai-text-plugin` (used by every AI step), and the `upload-plugin` (used by
  the share-link feature).
- `index.html` — full page markup. Static structure only; every text node is
  filled from `config` at load time via `data-field` attributes.
- `src/app.js` — all application logic (IIFE): renders the page from config,
  drives the 5-step workbench, the settings/theme panel, the website color
  scanner, and the "Ask AI" chat.
- `src/app.css` — the theme. Colors/fonts/radius/motion are CSS variables set
  from `config` by `app.js`. Light/dark via `[data-theme="dark"]`.

## Data & persistence

- User work (idea text, research brief, interview transcript + debrief,
  compare analysis, blueprint) is stored in `localStorage` under
  `if_project_v1` and restored on load. Exported from Step 5 as full JSON or
  markdown.
- Config (branding/theme/colors/copy) is stored under `if_config_v1` and can
  be edited via the ⚙ panel, imported/exported as JSON, or shared via a
  `#cfg=...` URL hash. Config changes only persist once "Save configuration"
  is pressed. Configs whose `schemaVersion` doesn't match the current
  `main.pjs` default are ignored on load (so stale saved configs can't
  override a rebrand).
- Share links: the Share button (header or Step 5) uploads the whole project
  (idea + research + interview + compare + blueprint) to an editable file via
  `root.uploadPlugin.editable.set` under a random name and builds a
  `https://perchance.org/<generatorName>#share=u<encoded-file-url>` link. If
  upload isn't available (e.g. unsaved generator), it falls back to
  `#share=d<encoded-payload>` — the project embedded directly in the hash.
  On load, `loadShared()` decodes `#share=` and loads the project.
  It calls `restoreProject(false)` — the `false` is important: `restoreProject`
  normally re-reads localStorage (the saved project), which would otherwise
  overwrite the just-loaded shared project.

## The five steps

1. **Idea** — raw idea text + optional problem/audience/working name.
2. **Research** — `RESEARCHER_PERSONA` writes a brief covering
   `config.researchAreas`, then supports follow-up "dig" questions that
   append to the same document.
3. **Interview** — a panel (default: investor, customer, expert, critic; can
   be toggled in the UI) asks one question at a time in round-robin (fewest
   asked first). Founder answers; "Wrap up & debrief" produces a summary.
4. **Compare** — `STRATEGIST_PERSONA` produces `### Competitor: <name>`
   sections with `**Positioning:**` / `**Strengths:**` / `**Weaknesses:**` /
   `**Where we can win:**`, which `parseCompare()` turns into the card grid.
5. **Blueprint** — `PRODUCT_PERSONA` distills idea + research + debrief +
   compare into a polished spec with a 30-day plan.

## Notable implementation details

- `genText()` wraps `root.generateText` with streaming + a 120s safety
  timeout and a stop signal; `runStreamingModule()` renders markdown
  incrementally (throttled) so long outputs stream in.
- `md()` is a small self-contained markdown renderer (headings, lists, bold,
  code, links, blockquotes, hr, fenced code). Kept in-house — no dependency.
- The color scanner fetches a site + up to 3 stylesheets via
  `root.superFetch`, extracts hex colors, buckets them, and builds light/dark
  schemes.
- Confirm dialogs are used by "Start fresh" and "Reset configuration" — both
  guarded with `confirm()`.
- Mobile: the 5-node stepper becomes horizontally scrollable below 640px
  (labels would otherwise crush into ~54px each).
