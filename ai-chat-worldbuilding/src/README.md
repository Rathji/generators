# World Forge — AI Worldbuilding & Asset Generation Engine

A Perchance tool that turns a single theme/setting into a complete worldbuilding package for **AI-chat character projects**, delivered as one copyable `.md` file.

Built on the **rathji-template** (`perchance.org/rathji-template`) conventions: dark/light theme with accent colors, settings panel in the title bar, toasts, code-block + copy/download patterns, spinner/busy helpers, URL-param sharing.

## What it generates (per the spec)

1. **Setting & Faction Design** — a contained setting, a core conflict axis, and 5 pairs of *asymmetric* rivals (friction through differing methods, not perfect mirrors).
2. **Character Profiling** — 10 characters, each with Name, Faction/Axis, Role (or True Form / Mortal Guise) and a visual/ideological Theme, with functional roles.
3. **Perchance Data Blocks** — strict nested text blocks, 2-space indentation, `name` / `faction` / `axis` / `role` / `true_form` / `mortal_guise` / `theme` variables.
4. **Flux Image Prompts** — one cinematic establishing shot + 10 individual portraits, each following the prompt rules (framing → archetype/clothing → specific prop/trait → background → lighting + style keywords).
5. Everything is wrapped in a single ` ```markdown … ``` ` block, ready to copy or download as `worldforge.md`.

## Architecture

- **main.pjs**
  - `generateText = {import:ai-text-plugin}` and `literal = {import:literal-plugin}`
  - `worldforgePrompt` — the full engine system prompt as an editable list (each line an item; blank lines are `[""]`; the theme placeholder line is escaped via `root.literal(...)`).
  - `worldforgeExamples` — sample themes rendered as clickable chips.
  - `buildWorldForgePrompt(theme)` — joins the prompt lines and swaps the `[Insert your setting, genre, or core concept here]` placeholder for the user's theme.
- **index.html**
  - `generate()` runs **two sequential `generateText` calls** (the platform caps a single response at ~1000 output tokens, so one call can't hold the whole deliverable):
    1. **Call 1** → Sections 1–3 (setting, factions, profiling, Perchance blocks). Told to leave out Flux prompts and any code fence.
    2. **Call 2** → Section 4 (Flux prompts) for the exact roster from call 1 (the call-1 output is passed in as context so names/roles/themes stay consistent).
  - Results are merged into a single ` ```markdown … ``` ` block (`stripFence()` removes any fence the model adds anyway).
  - Streams both calls into the output panel live; Copy / Download .md act on the final assembled text.
  - `?theme=...` URL param prefills the input (and is written back on generate when the environment allows it — wrapped in try/catch since the preview iframe can throw a SecurityError on `history.replaceState`).

## Editing the engine

All prompt logic lives in `worldforgePrompt` in main.pjs — tune the system prompt there. The two "THIS RESPONSE" directives (sections 1–3 vs section 4) are built in `generate()` in index.html.

## Credit

Template by **Rathji** (perchance.org/rathjis-generators).
