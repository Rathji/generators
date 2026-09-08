# SillyTavern Interop — plugin

A Perchance plugin that parses and serializes SillyTavern's actual file formats into Perchance-usable structures and back, byte-faithfully where the spec requires.

## Import

```pjs
stInterop = {import:sillytavern-interop}   // top of the importing generator's lists editor
```

`root.stInterop` is the plugin namespace object — every method below is callable from a `<script>` tag via `root.stInterop.method(...)`, or from lists via `root.`:

```js
let card = await root.stInterop.parseCharacter(file);            // File | Blob | ArrayBuffer | string
let v2   = root.stInterop.toV2(card);                            // {spec:"chara_card_v2", spec_version:"2.0", data:{...}}
let json = root.stInterop.cardToJSON(card, "v2");                // pretty JSON string
let png  = await root.stInterop.cardToPNG(card, {image: card.portrait}); // PNG buffer with chara + ccv3 chunks
let book = await root.stInterop.parseLorebook(loreFile);
let chat = await root.stInterop.parseChat(chatFile);             // {metadata, messages}
```

`parseCharacter` returns `{ spec, canonical, original, portrait, source, fileName }`:
- `spec` — `"v1"` | `"v2"` | `"v3"` (auto-detected)
- `canonical` — normalized card: always-present strings `name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions`, arrays `alternate_greetings, tags`, strings `creator, character_version`, object `extensions` (preserved verbatim), `character_book` (lorebook or `null`), `talkativeness`, `fav`, and a `legacy` bucket holding every key that doesn't fit the canonical shape.
- `portrait` — data URL of the PNG image (when importing a PNG card), pass it back to `cardToPNG` to keep the portrait.

## Supported formats

| Format | Read | Write |
|---|---|---|
| Character card v1 (`tavern_v1`, flat) | ✔ | ✔ |
| Character card v2 (`chara_card_v2`) | ✔ | ✔ |
| Character card v3 (`chara_card_v3`) | ✔ | ✔ |
| PNG card (`chara` + `ccv3` tEXt chunks) | ✔ | ✔ |
| Lorebook / world info `.json` (modern + legacy entry shapes) | ✔ | ✔ |
| Character book embedded in a card | ✔ | ✔ |
| Chat log `.jsonl` (messages, swipes, metadata line) | ✔ | ✔ |

## Public API

| Method | Returns | Notes |
|---|---|---|
| `parseCharacter(input)` | parsed card | async; JSON text or PNG bytes |
| `detectSpec(obj)` | `"v1"\|"v2"\|"v3"` | throws `E_CARD_SPEC`/`E_CARD_SHAPE` |
| `toCanonical(obj)` | canonical card | normalize any raw card |
| `toV1(card)` / `toV2(card)` / `toV3(card)` | card object | accept canonical or raw |
| `cardToJSON(card, spec)` | string | `"v1"\|"v2"\|"v3"` |
| `cardToPNG(card, {image})` | Uint8Array (PNG) | async; writes `chara`+`ccv3`; non-PNG `image` (e.g. JPEG) is re-encoded to PNG (throws `E_IMAGE` if undecodable) |
| `parseLorebook(input)` | lorebook object | async |
| `lorebookToJSON(book)` | string | serialize back to ST JSON |
| `characterBookFromCard(card)` | lorebook or `null` | |
| `attachCharacterBook(card, book)` | canonical card | |
| `parseChat(input)` | `{metadata, messages, count}` | async; metadata line kept separate |
| `chatToJSONL(chat)` | string | one compact JSON object per line |
| `chatToPrompt(chat)` | `{system[], messages[]}` | `{speaker, text}` pairs for prompts |
| `toPjs(card)` / `toPjsLorebook(book)` / `toPjsChat(chat)` | string | render as Perchance list text (see §toPjs) |
| `fromPjs(text)` | pjs tree | builds a native tree via `createPerchanceTree` |
| `b64encode(s)` / `b64decode(s)` | string | Unicode-safe UTF-8 base64 |
| `extractPNGText(input)` | `[{keyword, text}]` | all tEXt/iTXt chunks |

Every method that can fail throws an `Error` with a stable `code` (list at `st.errors.codes`) and a human-readable message — e.g. `E_PNG_MAGIC` (bad signature), `E_NO_CARD_CHUNK` (no `chara`/`ccv3`), `E_BASE64`, `E_NO_ENTRIES` (missing lorebook `entries` array), `E_JSONL_LINE` (with exact line number).

## Spec notes (why these decisions)

- **ccv3 precedence** — when a PNG carries both chunks, `ccv3` wins on import, matching SillyTavern's `character-card-parser.js`. Exports always write both `chara` (v2) and `ccv3` (v3).
- **tEXt-chunk-only writing** — card data is stored in `tEXt` chunks as base64 of UTF-8 JSON (ST removes `ccv3` iTXt on write; we match). `iTXt` is tolerated on read (including zlib-compressed text via `DecompressionStream`).
- **talkativeness/fav** — v2/v3 place them in `data.extensions.talkativeness` / `.fav` (defaults `0.5` / `false`), exactly where SillyTavern reads and writes them.
- **Legacy world info** — legacy entry keys (`key`, `keysecondary`, `order`, `disable`, `position`, …) are mapped to the modern entry shape following ST's `convertWorldInfoToCharacterBook` (e.g. `order` → `insertion_order`, `disable` → `enabled: !disable`, `position` → `extensions.position`, legacy extras like `excludeRecursion`, `probability`, `sticky`, `triggers` moved into `extensions`).
- **No data loss** — unknown card/extension/entry/message fields survive in `legacy` buckets and are re-emitted on serialization.
- **PNG integrity** — chunk CRCs are verified on read and recomputed on write (table-based CRC-32). The parser stops at `IEND` and ignores any trailing data (lenient, matches ST).

## §toPjs — Perchance list rendering

`toPjs(card)` / `toPjsLorebook(book)` / `toPjsChat(chat)` render the data as Perchance list text you can paste into a lists editor and read back with `fromPjs(text)`.

- **Lossy by design** — `toPjs(card)` emits only the primary fields (`name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `creator`, `character_version`, `tags`, `alternate_greetings`, `talkativeness`) plus, for a v2/v3 card, an embedded character book. Everything else lives in `extensions`/`legacy` and is NOT emitted (pjs has no lossless object model). `toPjsLorebook` emits the full entry list; `toPjsChat` emits messages (roles + text, swipe arrays joined with `\n===`).\n- **Escaping** — each field is emitted as a sublist containing a single escaped plain item (`key` newline indent `\[` `\{` …). Backslashes and `[ ] { }` are escaped, `\\r` is dropped, and literal `\\n` in text becomes a real newline. This is because Perchance (a) ignores backslash-escapes in `key = value` lines and (b) evaluates `[`/`{` inside JS blocks regardless of quotes — the sublist-item form is the only reliable way to carry these characters.\n- **Empty values** are emitted as `[""]` block items — a truly blank item would make the list empty and break round-tripping.\n\n## Error codes

`E_EMPTY`, `E_INPUT`, `E_JSON`, `E_JSONL_LINE`, `E_BASE64`, `E_PNG_MAGIC`, `E_PNG_TRUNCATED`, `E_PNG_CRC`, `E_PNG_IEND`, `E_NO_CARD_CHUNK`, `E_CARD_SHAPE`, `E_CARD_SPEC`, `E_CARD`, `E_SPEC`, `E_IMAGE`, `E_LOREBOOK_SHAPE`, `E_NO_ENTRIES`, `E_LOREBOOK`, `E_WRONG_TYPE`, `E_CHAT`, `E_ITXT_INFLATE`, `E_PJS`.

## Layout

- `main.pjs` — the whole plugin (single file, no runtime deps beyond standard browser APIs). Structure follows the Rathji plugin template; the entry point returns a namespace object (kv-plugin style).
- `index.html` — docs + live demo/test harness page (Rathji theme). Has a **"Run self-tests"** button that executes `src/tests.js` and reports pass/fail counts.
- `src/README.md` — this file.
- `src/TODO.md` — roadmap status (each item from the original spec, marked done).
- `src/tests.js` — self-contained regression suite (`runTests(ns, root)` → `{passed, failed, results}`), 48 checks covering every parser/serializer, PNG chunk handling, error paths, and pjs round-trips. All fixtures are reconstructed inline in the script, so it runs anywhere without external files.
- `scratch/st-fixtures/` — sample v1/v2/v3 cards, a PNG with both chunks, a lorebook, a legacy-lorebook, and a multi-swipe `.jsonl` for manual testing (ephemeral; regenerate from the test scripts if needed).

## Fixtures

`scratch/st-fixtures/` contains hand-authored fixtures: `v1.json`, `v2.json`, `v3.json`, `card-v2.png` (portrait PNG carrying both `chara` and `ccv3`), `lorebook.json`, `lorebook-legacy.json`, `chat.jsonl`. Drop them into the demo page to verify import/export round trips. The authoritative (and durable) fixture data lives in `src/tests.js` — prefer adding new cases there over `scratch/`.
