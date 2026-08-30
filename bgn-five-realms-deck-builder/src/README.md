# MTG Deck Import/Export Studio

A Perchance tool that imports MTG decks from many sources and converts to the **exact
MTGJSON [Deck](https://mtgjson.com/data-models/deck/) model** (`name`, `mainBoard:
CardDeck[]`, `sideBoard: CardDeck[]`, `commander?: CardDeck[]`), then lets you
build/fine-tune the deck interactively (card search, +/− counts, auto manabase, set
autofill, live Scryfall legality, mana-curve stats).

**Card data** (mana-cost → color/dentity parsing, frames/gems/glyphs) is handled by the
shared **five-realms-plugin** card engine (`fr = {import:five-realms-plugin}`), wired in
through the `frColors()` helper used by stats + manabase. Scryfall is used only for
real set codes, legality and mana costs.

## What it does
- **Input:** paste a decklist (e.g. copied from TappedOut), or try the
  "Load from TappedOut" button which proxies a `?fmt=txt` fetch via super-fetch.
  (TappedOut is Cloudflare-protected, so pasting the deck's copied text is the
  reliable path; the fetch falls back to that.)
- **Output:** the MTGJSON `Deck` data model
  (https://mtgjson.com/data-models/deck/):
  - `name`
  - `mainBoard: CardDeck[]` and `sideBoard: CardDeck[]` (required)
  - `commander: CardDeck[]` (added when a card is marked `*CMDR*`/`(Commander)`)
  - each card → `{ count, name, setCode }` (setCode only when present)

## Layout
- `main.pjs` — just `$meta` + the `{import:super-fetch-plugin}` for URL loading.
- `index.html` — the whole UI and the `convertDeckText(text, name)` parser:
  - section detection via `Sideboard:`/`// Sideboard`/`Commander:` headers
  - card lines like `4 Black Lotus (VMA)` → `{ count, name, setCode }`
  - dedupes and sums repeats; warns about cards with no set code
  - Copy + Download `.json` buttons; responsive two-column layout (stacks on mobile).
- **Format legality check** — a `Format` dropdown (Standard, Modern, Frontier, Commander/EDH,
  Brawl) plus a live "Format Legality" panel that validates the parsed deck against that format:
  - exact structural rules (deck size, 4-copy limit, Commander's 100-card singleton,
    Brawl's 60 incl. commander) — these are exact and always correct.
- **Live card legality via Scryfall**: the "Check online (Scryfall)" button queries
    `api.scryfall.com/cards/named` (CORS-enabled, throttled ~8 req/s) for every unique
    non-basic card and reports per-format `banned` / `not_legal` status — always current,
    so no ban-list / rotation maintenance needed. Frontier isn't tracked by Scryfall, so it falls
    back to a built-in snapshot (`LEGALITY.sets.frontier`).
  - **Mana curve & deck stats** (data-visualization-plugin): "Build stats / mana curve"
    reuses the same Scryfall lookups (cached in `cardCache`) to render a mana-curve bar
    chart, a color donut and a type breakdown, plus a stat grid (total/main/unique/lands/
    spells/avg CMC).
- **Cards & Set Codes** panel: per-card list with an **Auto-fill missing (SET)** action that
  resolves missing set codes via Scryfall (basic lands skipped).
- **Arena export** — "Copy Arena" renders the deck as MTG Arena text (Commander / Deck /
  Sideboard sections).
- **Save / Load** decks in the browser via `localStorage` (`mtgd_saveddecks_v1`).
- **Share link** — encodes the raw deck text into the URL hash (`#deck=...`); a pasted
  `#deck=` hash is auto-loaded on startup.
- **Open file** — open a `.txt` deck file via the file button or drag & drop onto the textarea.
- **Commander/Brawl color identity** verified live (commander `color_identity` ⊇ deck);
  constructed formats also get a **sideboard ≤ 15** cap.
- **Debounced auto re-check**: legality re-renders ~0.7 s after you stop typing.
- Parser understands Arena / Moxfield / TappedOut / Archidekt headers (`Deck`, `Main`,
  `Sideboard`, `Commander`, `// Sideboard`, `+ 2x Card`, `2 Card (SET) n`).


## Format validation data
- `FMT_RULES` — per-format structural rules (min size, exact size, singleton, commander count)
  and the Scryfall format key (`scry`); `scry:null` for Frontier.
- `LEGALITY.sets.frontier` — Frontier-legal set codes (snapshot; Frontier isn't on Scryfall).
- `LEGALITY.basicLands` — names exempt from copy/singleton limits.


