# Skills reference library

Reference docs for building Perchance generators and plugins. These are copies of the agent's skill references — read the one relevant to whatever you're building before using a plugin's non-trivial features.

## Operating manual
- [`operating-manual.md`](operating-manual.md) — a copy of this workspace's AGENTS.md: the full pjs syntax reference, plugin quick-reference, page_eval recipes, execution-order gotchas, and coding conventions. The single best companion to the platform reference.

## Platform core
- [`perchance-platform.md`](perchance-platform.md) — the engine itself: execution model, evaluation/selection semantics, odds, if/else, the list-tree API, `$meta`, preprocessors, public HTTP APIs, the full plugin directory, and known gotchas. Start here.

## Official plugin references
- [`ai-text-plugin.md`](ai-text-plugin.md) — `generateText`: LLM text generation, streaming, prefix caching, token budgeting, vision (image) attachments.
- [`text-to-image-plugin.md`](text-to-image-plugin.md) — `generateImage`: image generation options, result objects, the public gallery + moderation, NSFW checks.
- [`kv-plugin.md`](kv-plugin.md) — `kv`: per-user persistent key/value storage (save/load, inventories, settings).
- [`upload-plugin.md`](upload-plugin.md) — `uploadPlugin`: programmatic file hosting, editable text files, temp files, NSFW checks.
- [`comments-plugin.md`](comments-plugin.md) — `commentsPlugin`: comments/chat widgets, custom emojis, slash commands, moderation, permissioned channels.
- [`server-plugin.md`](server-plugin.md) — `createServerSocket`: realtime multiplayer servers, RPC/pubsub, durable byte state, security (admin auth), limits.
- [`super-fetch-plugin.md`](super-fetch-plugin.md) — `superFetch`: CORS-free `fetch` for runtime generator code.
- [`secret-plugin.md`](secret-plugin.md) — `secretPlugin`: synchronous post-quantum public-key encryption, `+auth:` channel integration.

## Metadata & audio
- [`dynamic-metadata.md`](dynamic-metadata.md) — `$meta.dynamic`: query-parameter-aware titles/descriptions/social images (isolated server sandbox).
- [`music-generation.md`](music-generation.md) — composing music with `generate_music` and wiring it into generators (autoplay rules, crossfades, region-based game soundtracks).

## Real example-generator source (`examples/<name>/main.pjs` + `index.html`)
Downloaded with `fetch_generator`, kept as working reference implementations. Study the code, don't import it.

- `battle-simulator-example` — state mutation + recursion-with-odds game loop (tiny)
- `consumable-list-with-dynamic-odds-example` — distinct picks + mutual exclusion via dynamic odds
- `storing-selections-example-1` — capturing & reusing a selection
- `dynamic-sublist-referencing-example` — computing sub-list names dynamically
- `simple-if-else-example` — if/else branch syntax
- `create-instance-plugin-example` — createInstance object-building
- `goto-and-remember-plugins-example` — goto-plugin text adventure + remember-plugin persistence
- `multiline-pro-example` — multi-line block output
- `seed-from-url-example` — deterministic seeding from URL
- `p5js-basic-example` — p5.js canvas integration
- `secret` — production app: comments-plugin transport + secret-plugin encryption + upload-plugin attachments (163KB)
- `ai-character-chat` — the flagship production AI-chat app: dynamic metadata, generateText chat, huge codebase (930KB) — read selectively, don't load wholesale
