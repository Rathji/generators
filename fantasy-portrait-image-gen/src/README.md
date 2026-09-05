# Fantasy Portrait — Image Generation

A fantasy character portrait generator built on **Nucleus v2.0** (a modern,
full-featured base framework for image generators on Perchance, updated from the
original "Nucleus" v1.7 by merging the quality bar of **voxelcraft**
(perchance.org/voxelcraft) with the structure/conventions of the
**imageref-v1** source generator (perchance.org/imageref-v1)) plus the full
fantasy-race content ported from **fantasy-race-image-gen**
(perchance.org/fantasy-race-image-gen).

The **Character Builder** is the heart of the generator: 300+ races (D&D core,
mythology, monstergirls, beastfolk, sci-fi, mythical creatures A–Z), 30+ art
style layers, 100+ hair colors/styles, 100+ armor/weapon choices, 300+
locations and a realism slider — all stacked onto a free-form prompt with
Dice (🎲) random prompts and an AI Enhance (✨) wand.

## Files

- `main.pjs` — Perchance lists & functions (everything the user tweaks lives here):
  - `$meta` — title/description/image/tags for the listing page
  - `nSubject`, `nSetting`, `nAtmosphere`, `nCameo`, `nRandomPrompt` — the Dice (🎲) word lists
  - `nStyles` — the Prism style lenses (label + prompt suffix + thumbnail image), rendered into cards by index.html
  - `chatSystemPrompt` — default system prompt fallback
  - `chatPersonas` — the persona library (roadmap #2/#18): each entry has `id`, `name`, `emoji`, `tagline`, `systemPrompt`
  - `chatStarters` — one-tap starter prompts shown above the chat input for fresh chats (roadmap #17)
  - `frStyle1`/`frStyle2` — Art Style 1 & 2 dropdowns (t2i-styles import + 18 custom styles / 30 layered styles)
  - `frRace`, `frHairColor`, `frHairStyle`, `frArmor`, `frWeapon`, `frLocation` — character option lists
  - `frRealism` — None/Balanced/Photoreal/Extra photorealism keywords
  - `frRoyalty`, `frRandomDescription`, `frRandomAppend(Raw)` — the Dice (🎲) lists (phase 2)
  - `pickFromOptions()` / `pickLocation()` — helpers for the lists' 🎲 Random options
  - `rathjiTemplate()` / `rathjiCard()` — vendored copyable components (badges + cards)
- `index.html` — the whole UI + logic: render grid, lens/aspect, prism/style cards,
  detail slider (guidanceScale), prompt + dice + wand (AI enhance), negative prompt,
  **Character Builder** dropdowns (phase 2), vault (kv-plugin persistence), public gallery,
  lightbox, sound, toasts, settings panel
  (theme grid: 18 themes = 9 families (Default + 8 SlRvb-adapted) × dark/light,
   each family also switches its font stack to the theme's typeface (Google-Font
   equivalents, e.g. Pirata One for D&D WOTC, Cinzel Decorative for DnD, Recursive
   for the ITS-based families), a ☀/☾ light-dark toggle in the nav,
   accent/text-size/reduced-motion), keyboard shortcuts, URL override state.
  Default theme: D&D WOTC (light).
  The Chat tab (second `<script>` block) is the chat engine: personas, sessions,
  rolling memory, streaming, persistence, message actions, markdown rendering,
  chat-AI settings, image attachments (vision) and in-chat image generation (see below).

## Plugins used

- `generateText` (ai-text-plugin) — the Wand ✨ prompt enhancer + the entire chat engine
- `generateImage` (text-to-image-plugin) — core rendering + gallery
- `kv` (kv-plugin) — the Vault (local, persistent render history) + chat persistence
  (folder `nucleusChat`: `sessions` map, `active` session id, `customPersonas` array)

## Conventions (borrowed from imageref-v1)

- Config lives in `main.pjs` lists — users edit words/data, not JS.
- Helper functions never throw; they return readable placeholders.
- `index.html` reads everything through `root.*` (e.g. `root.nStyles.selectAll`, `root.nRandomPrompt.evaluateItem`).
- Settings persist to localStorage under `nucleusSettings`; URL overrides `?theme=&accent=&size=&motion=` win.

## Gotchas learned while building

- The text-to-image-plugin requires `guidanceScale` to be a **whole number** (a 7.5 makes the call fail/return an error string).
- Perchance list-node names are read via the string property `n.getName` (NOT a function `n.getName()`).
- Vault/render seeds: the plugin returns the actually-used seed in `result.inputs.seed`.

## Chat-template roadmap

The full 20-item checklist lives at the top of `main.pjs` (the "CHAT-TEMPLATE ROADMAP"
section) — tick items `[ ]`→`[x]` there as they're built.

Status:
- **#1 [x]** Chat transcript UI — Render/Chat mode toggle, user/assistant bubbles,
  streaming via `generateText` `onChunk`, multi-turn context, Enter-to-send.
- **#9 [x]** Stop button — `stopChat()` calls the generateText promise's `.stop()`.
- **#2 [x]** Persona system — chips (preset `chatPersonas` library + user-custom personas
  saved to kv) that inject a system prompt per conversation. Selecting a chip re-writes
  the session's `systemPrompt`.
- **#3 [x]** System-prompt editor — the ✏️ Edit button opens a modal (name/emoji/prompt)
  that edits the current conversation's prompt (saved with the session) and can also
  save it as a reusable custom persona.
- **#4 [x]** Rolling memory — long chats fold their oldest turns into a `memory` block
  (shown via the 🧠 chip) and drop them from the stored transcript. Folding is driven by
  the **token budget** (roadmap #13): it only triggers once the prompt estimate crosses
  ~90% of `idealMaxContextTokens` (min 12 messages, keeps the newest `MEMORY_KEEP`=8),
  so short chats stay fully verbatim and the prefix cache stays hot for as long as possible.
- **#5 [x]** Conversation persistence — every session is kv-backed (`nucleusChat/sessions`)
  and the active one resumes on reload; the active session id is stored too.
- **#6 [x]** Session manager — the ☰ Chats modal lists sessions (title, message count,
  age, persona, 🧠 marker), with click-to-switch, inline rename, and inline-confirm delete.
  New chats start from the default persona.
- **#18 [x]** Persona preset library — the `chatPersonas` config list in main.pjs
  (Helper, Writer, Poet, Sage, Coder, Dungeon Master).
- **#7 [x]** Message actions — hovering a bubble reveals copy / edit-and-resend (user) /
  regenerate (assistant) / delete. Regenerate drops the reply + everything after it and
  re-streams; edit loads the user text back into the input (restoring any image).
- **#8 [x]** Markdown rendering — a small safe renderer (`renderMarkdown`/`inlineMd`) for
  assistant replies: fenced code blocks, `#`-headings, `-`/`1.` lists, `>` blockquotes,
  `hr`, paragraphs, plus inline `code` / `**bold**` / `*italic*` / sanitized http(s)
  links. HTML is escaped FIRST, then tokens applied — user text stays `textContent`.
- **#10 [x]** Creativity controls — the Settings panel now has a **Chat AI** section:
  a Temperature slider (0 precise → 1 balanced → 2 wild) and a Style selector
  (Balanced/Concise/Detailed/Creative/Expert). Persisted to localStorage
  (`nucleusChatAI`) and injected as a "Writing style for this reply:" directive at the
  END of the prompt (keeps the cached prefix intact). NOTE: the ai-text-plugin's model
  doesn't accept a temperature parameter, so the control works via prompt directives.
- **#11 [x]** Image attachments / vision — the 📎 button attaches an image (png/jpeg/webp);
  a preview chip shows it above the input. On send the prompt becomes an ARRAY instruction
  `[…text parts, Blob]` (vision). The image is stored on the message as a data URL
  (kv-persistable), shown as a clickable thumbnail in the bubble, and re-sent on
  regenerate/edit-resend (data URL → Blob).
- **#12 [x]** In-chat image generation — messages starting `imagine:` / `image:` /
  `draw:` / `render:` generate via `root.generateImage(prompt, {resolution:"768x768"})`
  and insert the render as an assistant message (kind `image`, caption = prompt) with a
  loader while rendering. Reuses the existing lightbox for zoom/save.
- **#13 [x]** Long-context budget — a small context pill in the chat header shows the
  estimated token usage vs `idealMaxContextTokens` (via `generateText({getMetaObject:true})`),
  turning amber >80% and red >95%. `maybeSummarize()` uses the same estimate (see #4) to
  fold oldest turns; the fold uses the SHARED prompt template with a TASK line pointing at
  the fold boundary, so summarization calls hit the prefix cache.
- **#14 [x]** Shareable chats — the 🔗 Share button copies
  `https://perchance.org/<name>#chat=<payload>` where the payload is the session (title +
  persona + messages, images downscaled to 320px JPEG, first 40 only) deflate-compressed
  and base64url-encoded. On load, a `#chat=` hash is auto-imported as a new session and
  the hash is cleared. Link copied via the existing clipboard helper.
- **#15 [x]** Export/import — the ☰ Chats modal's ⬇ Export downloads all sessions +
  custom personas as a JSON file (`nucleus-chats-<date>.json`); ⬆ Import merges a file
  back in (skips identical/older sessions by `updatedAt`). Also merges imported custom
  personas.
- **#16 [x]** Chat search — the 🔍 button opens a search bar; typing filters the
  transcript to matching messages with the query highlighted in `<mark>`, shows a
  `n/N` counter, and ↑/↓ (or Enter/Shift+Enter) jump between matches with a flash.
  Search closes automatically on send/switch/clear.
- **#17 [x]** Starter chips — fresh (empty) chats show one-tap prompt chips above the
  input from the `chatStarters` config list in main.pjs; tapping one sends it instantly.
- **#19 [x]** Slash commands — `runSlashCommand()` intercepts `/…` input in `sendChat()`
  before anything is sent: `/help` (opens the guide), `/clear`, `/new`, `/persona <name>`
  (switch persona by name/emoji/id, or list them), `/save <title>`, `/imagine <prompt>`,
  `/search <query>`, `/export`, `/share`. Unknown commands toast "try /help".
- **#20 [x]** Keyboard-first + mobile polish — chat input keeps Enter-to-send (now with
  an IME `isComposing` guard) plus `↑`/`↓` recall of the last 30 sent messages when the
  box is empty (`chatHistory`/`chatHistoryIdx`); global chat-mode shortcuts `/` (focus
  the box), `Alt+R` (regenerate last reply), `Alt+F` (toggle search); `enterkeyhint`,
  `@media (pointer: coarse)` 16px input font (stops iOS focus-zoom), a narrow-screen
  wrap for the search bar, and a `safe-area-inset-bottom` footer cushion.

Chat internals (second `<script>` block in index.html):
- State: `sessionMap` (id → session), `activeSessionId`, `builtinPersonas`, `customPersonas`,
  `pendingAttachment`, `chatAI`, `searchActive`/`searchMatches`, `tokenMeta`.
- Sessions guard against switching/editing while a reply is streaming (`chatBusy`).
- Prompt shape (prefix-cache friendly, TASK at the end): `systemPrompt` → memory block →
  `<MESSAGES>` transcript → `TASK: write the next response as <persona>` → style directive →
  `Assistant:`. Summarization shares the same prefix with a different TASK (see #13). An
  image attachment turns the instruction into an ARRAY `[…text parts, Blob]`.
- Streaming bubbles are plain `textContent`; on finish the transcript re-renders and
  assistant replies get the safe-markdown renderer + action row.

Next up: the 20-item roadmap is complete (all items ticked in main.pjs), and **Phase 2
(fantasy-race port, #21)** is in: the Character Builder in the Render tab stacks the old
`fantasy-race-image-gen` dropdowns (art style 1/2, race, hair, armor, weapon, location,
realism) onto the Nucleus prompt flow. The ported prompts still speak the old framework's
`input` scope (`[input.description]` / `[input.negative || ""]`) — index.html provides it
as `window.input` before evaluating, and the Dice button now draws from
`frRandomDescription` + `frRandomAppend` (with `nRandomPrompt` as a fallback). Candidate
extensions if the user wants more: multiplayer chat via the server-plugin, image-gen
presets/negative prompts per chat, chat themes, an i18n pass, or saving chat AI settings
per-persona.
