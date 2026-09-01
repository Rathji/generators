# Keystone Chat v2 — a full-feature AI chat template

A modern roleplay-chat template for Perchance. **This is a free template — fork,
copy and remix it freely**; if you build something on it, a little credit back
to "Keystone Chat" is appreciated. Built on the rathji-template design system
(https://perchance.org/rathji-template).

The visitor-facing blurb lives in `index.html` as the dismissible
`.template-banner` at the top of the chat area (dismissal persists in
`localStorage.keystoneChatBannerDismissed`).

Fork it, edit `main.pjs` + `index.html`, and make it your own.

## What it is

- **Editable history**: the chat log is a plain `Name: text` script separated by
  blank lines (the "Keystone Protocol" format). It is the single source of truth —
  it's rendered into message bubbles, and the **✏️ Edit** button exposes the raw text
  for hand-editing. Regen deletes the last message block and regenerates it.
- **Personas & scenarios**: sidebar fields for bot/user names, scenario, character
  descriptions and style instructions. Everything autosaves to `localStorage` and is
  bundled into a JSON export/import (Save / Load).
- **One-click presets**: the `chatPresets` list in `main.pjs` holds ready-to-go
  starter scenarios (fantasy tavern, noir, cyberpunk, starship, haunted manor).
  Selecting one fills all fields and seeds the opening line.
- **URL-hash sharing (feature #1)**: the Share button packs the whole conversation
  (fields + log) into a compressed `#c=` URL fragment, so one link reloads the chat
  for anyone who opens it. Imported once per tab (`sessionStorage` guard), then the
  hash is stripped. Falls back to plain `#t=` encoding without CompressionStream.
- **Personas & multi-bot rooms (#2 + #4)**: the **Cast** textarea holds one persona
  per line — `Name | description`. Empty cast = single persona from botName/botDesc.
  Each persona gets a distinct color + emoji. A toolbar dropdown picks who replies
  next: a specific persona, the narrator, or **🎲 Auto** — the AI decides, and the
  reply streams live while its `Name: ` prefix is captured into the right bubble.
  With 2+ cast members the dropdown defaults to Auto.
- **Per-message edit / delete / pin (#3 + #6)**: every bubble has ✏️ edit (inline
  textarea replacing that log block), 🗑️ delete, and 📌 pin-to-memory (bot bubbles).
  The **Memory vault** textarea is injected into every prompt as canon.
- **Narrator line type (#5)**: `NarratorName: text` blocks (default "Story") render
  as centered, muted, dashed narration — distinct from dialogue. The narrator can
  also be picked as a speaker, and presets give them flavor names ("The fire",
  "The rain", "Mission log"...).
- **Creativity & reply-length sliders (#7)**: in Settings, **Creativity**
  (Grounded / Balanced / Wild) and **Reply length** (~10–160 words) steer the
  prompt itself — the ai-text-plugin exposes no temperature/maxTokens knobs, so
  these add `[TONE]` and `[LENGTH]` sections to the instruction.
- **Quick replies (#8)**: tap-to-send chips above the input bar, sourced from the
  sidebar "⚡ Quick replies" field (one per line; defaults: Yes / No / What
  happens next? / Tell me more). Editing the field re-renders the chips live.
- **Typewriter + sounds (#9)**: Settings toggles. The **Typewriter** buffers
  incoming chunks and reveals them at a steady pace (smoothing erratic chunk
  arrival); **Sounds** plays tiny WebAudio blips (no files) — a pop on send, a
  soft ping when a reply completes.
- **Chat branching (#10)**: the **🌿 Branch** toolbar button snapshots the current
  log into the forks bar (below the toolbar). Any snapshot can be jumped back to
  (the current chat is auto-saved as a "pre-jump" branch first, so nothing is
  lost) or deleted. Branches persist in localStorage and ride along in export,
  import and share links.
- **Search inside the chat (#15)**: the 🔍 Search toolbar button opens a search
  bar; typing filters the visible bubbles live (case-insensitive, per-message
  match), highlights every occurrence with a yellow mark, and ↑/↓ (or
  Enter/Shift+Enter) jumps between matches with a focus ring. Search survives
  re-renders (it re-applies after every message reflow) and closes with ✕ or Esc.
- **Saved profiles (#16)**: the **👤 Profiles** sidebar section saves the whole
  setup — every field + the chat log + branches — as a named snapshot via the
  kv-plugin (per user/browser). A 💾 keypair (secret-plugin) is generated in
  localStorage on first use, and the **Private notes** box is encrypted with it:
  exported profile files keep those notes locked to your key, so they can't be
  read from a shared profile. Load / rename / delete / export (.json) / import
  round-trip the snapshots. Profiles are independent of the JSON Save/Load
  (which is a plain file copy for portability).
- **Guestbook (#17)**: the **💬 Guestbook** sidebar button opens a modal embedding
  the comments-plugin on channel `keystone-chat-guestbook` — visitors can leave a
  note or say hi without any setup. Renders once, closes via ✕, the backdrop, or
  Esc, and follows the active theme.
- **In-chat art (Phase 1)**: the **🎨 Scene** toolbar button paints an image from
  the last few messages, and the **🖼️ Gallery** modal lists/zooms/deletes kept
  images. Images appear as bubbles with 🔁 redo / 💾 keep / 🗑️ delete actions;
  kept ones persist in the kv-plugin folder `keystoneimages`. A Settings toggle
  (**Auto images**) paints a scene image after each AI reply. Characters have
  their own portrait generator (style picker + **🎨 Portrait** button) that turns
  the *Look* field into an avatar.
- **Character gallery & per-character threads (Phase 2)**: the **👥 Characters**
  sidebar section manages many saved characters, each with its own chat thread
  (persisted in `localStorage.keystoneThreads`). The **🗂️ Gallery** modal
  (toolbar or sidebar) shows cards with avatar/name/tagline, category tabs from
  tags, a search box and a 🎲 Random button. The **Character editor** modal edits
  every field (name, tagline, emoji, scenario, personality, look, instructions,
  memory, tags) and can generate a portrait. Characters live in the kv-plugin
  folder `keystonechars`; switching characters swaps the persona fields and loads
  that character's thread. "Main chat" (`__main`) is the built-in anonymous room.
- **Mobile input polish — emoji picker + mic (#18)**: the input bar gains a 😊
  emoji popup (32 common emojis, inserted at the cursor) and a 🎤 mic button that
  uses the Web Speech API (`SpeechRecognition`) to dictate into the input; it
  pulses red while listening and falls back to a toast where unsupported. Mic
  language follows the UI language.
- **i18n — English / Español / Français / Deutsch (#19)**: the Settings panel has
  a Language dropdown. All UI labels, placeholders, toasts and confirm dialogs run
  through a `STRINGS` dictionary (section 1.5 of the script) via `t()` / `tf()` —
  adding a language means adding one `STRINGS.<code>` block and a `<option>`.
- **Token & cost meter (#20)**: after each turn the toolbar status shows the last
  turn's tokens and estimated cost, plus a running session total (`⚡ ↑in ↓out ·
  $cost  Σ total · $cost`). Counts come from the plugin's `countTokens` when
  available (4 chars/token fallback); pricing constants `COST_IN_PER_1M` /
  `COST_OUT_PER_1M` (GPT-4o-mini-ish) are tunable in section 9.9. Session totals
  persist in `localStorage.keystoneTokens`.
- **Slash commands & reply-as (Phase 3)**: typing `/` in the input opens a live
  suggestion menu (↑/↓ to navigate, Tab or Enter to insert, click to pick). Eleven
  commands: `/as <name|auto>` sets who speaks next, `/user` sends your line,
  `/character <text>` / `/narrator <text>` inject a line from the active
  character / narrator, `/system <text>` adds a centered system line (`__sys__:`
  log blocks, stripped before sending to the AI), `/image <prompt>` generates an
  inline scene image, `/name <name>` renames the character, `/pic` regenerates the
  character portrait, `/background <color|gradient|url>` restyles the chat area
  (persisted in `localStorage.keystoneChatBg`), `/memory <text>` appends to the
  memory vault, and `/help` opens the full command reference. The **reply-as pill**
  above the input (click to cycle auto → character → narrator → you) shows who the
  AI will write as next, and `u:` is a valid speaker choice so the AI can write
  the user's line too. `/as` accepts fuzzy character-name matches and `n:` / `u:`
  prefixes.
- **Import characters (Phase 4)**: the 🌐 **Import** button (characters sidebar + gallery
  tools) opens a two-tab modal. **From a link** fetches any character-page URL
  (Character.AI, Janitor, SpicyChat, Crushon, Sakura, Chub, wikis, …) via the
  super-fetch-plugin, then pulls the card from embedded JSON (`__NEXT_DATA__` /
  Nuxt / `application/json`), an inline JSON blob, or the page's `og:` meta tags.
  **Paste a card** accepts a Tavern v1/v2 character-card JSON or a PNG card (data:
  URL or link) — PNG tEXt/iTXt `chara` chunks are parsed in-browser. When the
  extracted data is incomplete (or an extra instruction was given) an AI pass
  turns the page text into a full card (name, tagline, emoji, scenario, persona,
  look, instructions, memory, tags, greeting). Avatars are fetched and stored as
  data URLs; imports are deduped by name or source URL (confirm to overwrite),
  saved into the same gallery/thread system, seeded with the greeting, and opened.
- **Memory summaries (Phase 5)**: long chats never forget the early parts. The log
  is split into blocks; once the conversation outgrows a per-depth window, older
  blocks are folded into AI summaries **in the background** (after each turn, ~1.6s
  debounced, never blocking generation). Ready summaries are injected into the
  prompt as `[EARLIER EVENTS — summarized background]` + a `[RECENT]` raw tail,
  replacing the raw old messages. Group summaries are cached per thread in the
  kv-plugin folder `keystonesummaries`, keyed by exact block range + content hash,
  so edits only re-summarize the affected range and steady chats never re-summarize.
  The **🧠 Summaries** sidebar button opens a viewer (list of summaries, each
  deletable, ⚡ Summarize now, 🗑️ Clear) plus **per-chat** controls — background
  summaries on/off and a **Depth** (Light / Balanced / Deep: how many recent
  messages stay raw and how big each block is) — stored on `threads[id].mem`.
  A global on/off default lives in Settings. Clear / new chat / branch jump /
  character delete wipe the thread's summaries. Runs guarded by a `summarizing`
  flag and skips chats still too short to summarize.
- **Feature roadmap**: the full build plan lives as `featureTodo` in `main.pjs`
  (45 tasks across 12 phases). Each phase is implemented, marked ✅ in the
  roadmap, then reviewed by the user before the next phase starts. The older
  20-feature checklist above it is kept for reference.
- **Design system (from rathji-template)**: dark/light themes, 5 accent colors,
  text-size control, reduce-motion, toast notifications, typing indicator, spinner
  loading states, and the vendored `rathjiTemplate()` badge + `rathjiCard()` card
  components. Settings persist per-user and accept URL overrides
  (`?theme=light&accent=%23ec4899&size=18`).

## Files

- `main.pjs` — `$meta`, imports, `chatPresets` list, and the vendored rathji
  badge/card components. Add new presets here by copying an existing entry.
- `index.html` — the whole chat app: styles, layout, and the master script
  (settings, log parsing/rendering, the AI generation engine, presets, data
  management).

## How generation works (important)

`generateResponse()` in index.html commits the user's message, then `generateTurn()`:

1. Resolve the next speaker from the toolbar dropdown: `auto` (AI chooses) or a fixed
   persona / narrator.
2. Build the prompt: `[SCENARIO]` → `[CHARACTERS]` (all personas + user) → `[NARRATOR]`
   → `[MEMORY]` (canon notes, if any) → `[STYLE]` → `[HISTORY]` (last 40 lines) →
   ends with the speaker's exact `Name:` so the model writes that line.
3. Stream via `onChunk` (ai-text-plugin), `stopSequences: ["\n\n"]` for
   multi-sentence single-turn replies.
4. **Manual mode** pre-appends `Name: ` so text lands in its block; `processChunk()`
   strips a name the model re-writes. **Auto mode** streams into a draft bubble,
   captures the leading `Name: ` as the speaker, and commits `Name: text` at the end
   (falling back to the last bot speaker if no name appeared).

To tune behavior: edit the prompt template inside `generateTurn()`.

## Notes

- Uses the `ai-text-plugin` (imported as `ai` → call it via `root.ai(...)`),
  plus `kv-plugin` (profiles), `secret-plugin` (profile keypair/encryption),
  `comments-plugin` (guestbook) and `super-fetch-plugin` (character import
  fetching) — all referenced through `root.*`.
- Accent/theme/size/motion/language live in `localStorage.keystoneChatSettings`.
- Messages are parsed from the log with `parseLog()` — any block starting with a
  known speaker name is a message; other text is a continuation of the previous
  message or a "Story" (centered, muted) system line.
- Mobile: the sidebar becomes a slide-in overlay toggled by the hamburger button.
