# ChatNEX

A perchance AI-character chat & roleplay app. Chat with 90+ built-in characters
with real memory (summarization + optional local deep-memory embeddings), AI
image generation inside chats, a community character-sharing server, games,
music, personas, lorebooks, and a full character editor.

## Layout

- `main.pjs` — character data (`getNexCharacterData`), plugin imports, `$meta`.
- `index.html` — everything else: server-plugin script (community sharing),
  CSS, and the whole client app (a single large `<script>`).
- `src/deepmemory-worker.js` — module worker for the "deep memory" mode: runs
  a local MiniLM embedding model (transformers.js from a CDN, ~25MB, cached by
  the browser) and answers `load` / `embed` messages. **If this file is ever
  lost, recreate it** with the protocol documented at its top (rebuild recipe
  is in the file header). The client creates it via
  `new Worker("src/deepmemory-worker.js", {type:"module"})`.

## Key flows

- **Chat**: `sendAIMessage` → `buildChatInstruction` builds a prefix-cache
  friendly prompt → `root.generateText` streams the reply. `<image>desc</image>`
  tags in replies trigger `root.generateImage`.
- **Memory**: default "standard" mode uses rolling summaries +
  `localEmbed`/`cosineSim`. "deep" mode embeds every message with the worker
  and recalls relevant old moments (records live in Dexie `deepMemories`).
- **Community**: the `server-plugin` script in index.html holds durable byte
  state of published character cards; `communityShare`/`communityList`/
  `communityDelete` RPCs.

## Notes

- Storage is client-side (Dexie/IndexedDB + localStorage); nothing is uploaded
  unless the user explicitly shares/publishes.
- The `data-t*` attributes and `root.t()` are a dormant i18n scaffold —
  `t()` intentionally only maps the few keys used from JS; the rest fall back
  to the English text already in the markup.
