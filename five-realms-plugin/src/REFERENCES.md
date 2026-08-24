# References evaluated for Five Realms (kept so they are not lost)

These are external open-source projects/resources the author asked about while planning
Phase 2. **None are integrated or vendored** — all four are *references* (design /
schema / concept sources). The plugin's own logic is our own composition.

Ranked by relevance to the engine work we actually need to build (Phase 2 = stack
resolution, combat damage, and the deferred-rule items below):

## 1. phase.rs — Rust MTG rules engine + client (MOST useful for rules/design)
- URL: https://preview.phase-rs.dev/  ·  source: https://github.com/phase-rs/phase
- What it is: a complete MTG rules engine in Rust compiling to WASM, powering a
  Tauri + PWA client and WebSocket multiplayer. Implements turns, priority, stack,
  combat, state-based actions (rule 704), layers (613), triggers, replacement
  effects, plus an AI opponent (`phase-ai` crate).
- Why it is our best rules reference: its stated design principles are *our own
  architecture* — **pure reducers** (`apply(state, action)`), **discriminated
  unions** (tagged action types), **immutable state**. The concepts it implements in
  Rust map 1:1 onto the seams we left in Phase 1.
- Use: read `crates/engine` for how it orders SBA checks + stack resolution and how
  it models combat, then port the *concepts* to our thin custom 12-card model.
  Do NOT port the Rust code.
- Pending-list match: stack/priority, combat damage, SBA 704, layers 613,
  continuous/replacement effects, and (via `phase-ai`) legal-action enumeration.

## 2. MTGJSON — real-MTG card data (useful as a SCHEMA reference only)
- URL: https://mtgjson.com/
- What it is: the full database of real MTG cards (34k+ cards, prices, rulings,
  set data) as JSON/Parquet + API. Not a rules engine.
- Use: our card-model's field grammar (`manaCost`, `cmc`, `colors` vs
  `colorIdentity`, `supertypes`/`types`/`subtypes`, `power`/`toughness`,
  rarity ordering) is modeled on this shape. It is the authoritative spec for the
  *database's field syntax* if we grow cards or want real-MTG compatibility. Its card
  *data* is irrelevant (our cards are invented); price/rulings/legality endpoints
  only matter if we later add a format/EDH-like legality layer.

## 3. Card Forge — old Java MTG clone (rules reference, heavier)
- URL: https://card-forge.github.io/forge/
- What it is: a complete unofficial MTG rules engine + deck editor / AI in Java,
  tied to real MTG card data and a handwritten rules-text interpreter for real card text.
- Use: same *concept* reference as phase.rs but an older, mutating-Java, less
  architecture-matched implementation. Read-for-concepts only, never port.

## 4. Cockatrice — VTT for multiplayer card games (client/UI, least overlap)
- URL: https://cockatrice.github.io/
- What it is: a virtual tabletop for playing card games over a server. **No rules
  engine and no rules enforcement** — players resolve the rules manually.
- Use: nothing for the *engine*. Only marginally relevant if we ever build the actual
  play *UI / tabletop layout / networking* later. Out of scope for Phase 2.

---

## Strongly recommended reference for Phase 2 mechanics
- The Comprehensive Rules (CR) sections that Five Realms' deferred items are named
  after: stack resolution (rule 608), combat damage (rule 510), state-based actions
  (704), layer system (613), continuous & replacement effects (614/615). Read these
  alongside phase.rs's `crates/engine` implementation.
