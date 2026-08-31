# rathji's Projects hub

A projects directory page: a hero, filter/search bar, and collapsible category
sections rendered from the `PROJECTS` object defined in `index.html` (search for
`EDIT YOUR PROJECTS BELOW`). Each project is `{ icon, title, desc, url, tags, badge? }`.

## Structure
- `main.pjs` — plugin imports only: `zelda-audio-plugin` (bg music) and `ai-text-plugin` (the AI assistant).
- `index.html` — all markup, styling, and logic (classic scripts, not modules).
- `src/README.md` — this file.

## Key features
- **Project cards** — rendered client-side by `render()`/`cardHTML()`; card banner
  images come from `CARD_IMAGES[url]` (per-project hosted URLs).
- **"Newly updated" section** — polls `perchance.org/api/getGeneratorStats` for
  projects edited in the last 24h.
- **Music pill** — bottom-left, streams Zelda tracks via `root.zeldaAudio`.
- **AI assistant** — the purple "Ask AI" button in the nav opens a chat drawer
  (bottom-right). It answers questions about the projects using `root.generateText`
  (ai-text-plugin), grounded in a catalog auto-built from `PROJECTS`. Recommended
  project titles are auto-linked in replies (`renderLinks`). Conversation follows
  the prefix-cache-friendly pattern: static persona + catalog, then an append-only
  chat log, with background compaction via `maybeCompact()` when the prompt nears
  the token budget.

## To add/modify projects
Edit the `PROJECTS` object in `index.html`. The AI catalog, filters, search, and
counts all derive from it automatically.
