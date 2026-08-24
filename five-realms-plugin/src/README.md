# five-realms-plugin

A Perchance plugin (`five-realms-plugin`): an MTG-compatible card-game **rules
engine** plus an **inline-SVG card renderer**, exposed behind one `$output` with a
13-op dispatch. none of the ops throw.

- `main.pjs` — everything: deterministic RNG, card database (12 fixture cards), mana
  grammar, zones, game state, turn structure + priority, the never-mutating
  `applyAction` reducer, stack resolution, combat damage, and the 52-asset art
  payload + renderer. All top-level names are `fr`-prefixed so they can't clash
  with a consuming generator.
- `index.html` — the plugin's docs page, which doubles as a live test harness.

## Stage history / status
- **Phase 1 (done):** state model, zones, game objects, turn structure, priority,
  mana, seeded shuffling, the `applyAction` reducer, 12-card fixture DB, 52-asset
  renderer.
- **Phase 2 (in progress / this bucket):** stack resolution now actually resolves each
  fixture spell/ability (ETB triggers, auras, buff/damage/destroy spells, the
  ember-core damage ability), spells/abilities take and validate targets, and combat
  assigns damage (blocked vs unblocked) with lethal-damage death and life-loss.
- **Still deferred (Phase 3+), with a clean seam left for each:** the full
  state-based-actions loop (rule 704), the layer system (613), continuous and
  replacement effects (614/615), a keyword-ability library beyond the fixture set, and a
  full legality solver for `frLegalActions` (currently best-effort).

## Design references
See `REFERENCES.md` for the evaluated external projects (phase.rs, MTGJSON, Card
Forge, Cockatrice) and the relevant Comprehensive-Rules sections. These are concept
references only — none are integrated.

## Rebuild note (art payload)
The 52-asset art payload in `main.pjs` under `frInitPayload` is copied
byte-for-byte from the `game-assets` repo's `build/perchance/five-realms-payload.js`
(documented in that file's own banner comment). Regenerate there, don't hand-edit the
literal.

## Engine architecture
- **Pure reducer:** `frApplyAction(state, action)` clones state then applies one tagged
  action. Actions: `concede`, `passPriority`, `playLand`, `castSpell`,
  `activateAbility`, `tapPermanent`, `declareAttackers`, `declareBlockers`.
- **State** is plain JSON-serializable (seed → `seed`), so games clone/save/load
  cleanly and the seeded xorshift PRNG keeps shuffles reproducible.
- **Combat flow:** declare_attackers → declare_blockers → combat_damage (deals
  damage automatically at step entry, then a priority round) → end_combat.
