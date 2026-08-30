# Five Realms — src/

Local engine/validator modules for **Five Realms** (a 295-card Alpha-era trading-card
game recreation on Perchance). The authoritative rules engine lives in the
`five-realms-plugin` generator (imported in main.pjs as `fr`); the modules here are the
ergonomic local layer the AI and UI build on, plus the full Alpha card-data foundation.

## How tests run

Every `*.test.js` registers cases on `window.Test` (from `src/test.js`, loaded by
index.html) and imports modules that need `window.root.fr` (the plugin). Run the suite in
the live page:

```js
window.Test.reset();
for (const p of ["./src/cards/integrity.test.js","./src/cards/schema.test.js",
  "./src/cards/plugin.test.js","./src/cards/data/alpha.test.js","./src/game/engine.test.js",
  "./src/game/turn.test.js","./src/game/mana.test.js","./src/game/cost.test.js",
  "./src/game/cast.test.js","./src/game/stack.test.js","./src/game/target.test.js",
  "./src/game/resolve.test.js","./src/game/triggers.test.js","./src/game/continuous.test.js",
  "./src/game/abilities.test.js"])
  await import(p);
await window.Test.run();   // -> { passed, failed }
```

Current status: **239 tests, all green** (engine 16 / turn 28 / mana 14 / cost 20 /
cast 24 / stack 11 / target 23 / resolve 15 / triggers 11 / continuous 17 / abilities 26 / integrity ~15 / alpha ~19 / schema+plugin rest).
`page_eval`/`page_refresh` are how you run them; see AGENTS.md recipes.

## Layout

- `cards/schema.js` — Alpha card record schema + validator (`validateCard`).
- `cards/data/alpha.js` — all 295 Alpha (LEA) cards as structured records
  (`ALPHA_CARDS`, `ALPHA_COUNT`).
- `cards/plugin.js` — projects the 295 Alpha records into the five-realms-plugin card
  shape (`ALPHA_TO_PLUGIN`, `PLUGIN_CARD_MAP`, `extractProducesMana`); the paste-ready
  `frCardDb()` body for the plugin's DB lives here. Also attaches each record's
  `targeting`/`modes`, `abilityTargeting`, and innate `protections` (task 21).
- `cards/effects.js` — Alpha spell effects declared in the plugin's effect-template
  language (roadmap task 22): `SPELL_EFFECTS` for a representative set of instants/
  sorceries, `MODE_EFFECTS` for the modal "Choose one" cards, `AURA_BUFFS` for enchant-
  creature auras; `attachEffects` splices them onto a cloned projection record.
- `cards/triggers.js` — Alpha triggered-ability declarations (roadmap task 23):
  `ALPHA_TRIGGERS` (Copper Tablet upkeep, Sengir Vampire creatureDies, Dingus Egg
  landDies) + `attachTriggers`, in the plugin's `card.triggers` data model (the engine
  fires "enter"/"attack"/"combatDamageToPlayer" natively; the local runtime below fires
  the rest).
- `cards/continuous.js` — Alpha continuous/static-ability declarations (roadmap task 24):
  `CONTINUOUS_EFFECTS` (Crusade / Bad Moon global +1/+1 by color, Lord of Atlantis &
  Goblin King pump-other + keyword grants, Castle's untapped-only +0/+2, Mana Flare's
  "mana" layer) + `alphaContinuous`/`attachContinuous`. The plugin has no global static
  effects, so these drive the local runtime below.
- `cards/abilities.js` — Alpha activated-ability declarations (roadmap task 25):
  `ALPHA_ABILITIES` (Samite Healer guard, Northern Paladin smite, Prodigal Sorcerer &
  Rod of Ruin zap, Drudge Skeletons regenerate, Royal Assassin murder, Demonic Hordes
  ravage, Granite Gargoyle fortify, Orcish Artillery bombard, Ley Druid untap,
  Disrupting Scepter coerce, Icy Manipulator freeze, Pirate Ship broadside, Dwarven
  Demolition Team demolish) in the plugin's `card.abilities` model, with the plugin
  targeting SUBSET on `ability.targeting` and the rich Alpha filters on
  `card.abilityTargeting`; `attachAbilities`/`alphaAbilities`. Projection records in
  plugin.js now carry `.abilities` too (so `cardDefFor` sees them).
- `cards/db.js` — `alphaDb()`: the full 295-card Alpha projection (effects + triggers +
  continuous attached) passed as `config.cards` to `engine.newGame`, so the plugin engine
  resolves Alpha spells natively (this removed the old "plugin-unknown Alpha card"
  reducer caveat).
- `cards/targeting.js` — Alpha targeting declarations (roadmap task 21):
  `SPELL_TARGETING` (~95 spells/Auras incl. all 42 Enchant auras, any-target,
  creature/player/spell/land/artifact/artifact-or-enchantment/graveyard/X-targets,
  modal per-mode), `ABILITY_TARGETING` (24 creature/artifact abilities), innate
  `protections`, plus `describeSlot`/`describeTargeting` for readable text.
- `cards/integrity.js` — QA checks vs the real Alpha set (counts, rarities, colors,
  types, basics/duals, forbidden cards) + human-readable report.
- `game/engine.js` — wrapper over `fr("newGame"/"act"/"state"/"legalActions"/...)`:
  player views, zone moves (`moveCard`), card instances, `snapshot`/`restore`, history.
- `game/turn.js` — turn/phase/priority: `STEP_ORDER`, `initTurnTracker`/`onStep`,
  `doAction` (reducer + trigger observe + mana observe + SBA reconcile + step log, and
  the stack-mode trigger pass interception), `pass`/`walk*`, `runSba`, `autopass`, turn
  indicator helpers.
- `game/triggers.js` — triggered-abilities runtime (roadmap task 23): `observe` (hooked
  into `turn.doAction`) detects the upkeep-step entry, battlefield→graveyard deaths and
  hand-size growth and fires matching `card.triggers`; `fireUpkeep`/`fireDeath`/`fireDraw`
  with the immediate-vs-stack toggle (`triggersImmediate`, default true = classic Alpha),
  the local effect applier (`applyEffects` — damage/destroy/sacrifice/pump/counter/tap/
  untap/addMana/draw/discard/life/scry/shield — with its own SBA loop and death cascade),
  and stack-mode queue/resolve (`queueTrigger`/`resolveTriggerTop`/`isTriggerOnTop`).
- `game/mana.js` — mana pool + mana burn + mana abilities: `addMana`/`spendMana`
  (tracker-aware), `activateManaAbility` (multi-colour dual lands, Mana Flare bonus on
  local-path taps), per-turn produced/spent tracking, `applyManaBurn` at the cleanup
  transition.
- `game/continuous.js` — continuous/static-effects runtime (roadmap task 24):
  `syncContinuousEffects` clears prior synced entries and re-pushes per-target layer-7
  `state.effects` entries for every active "powerToughness" declaration each action, so
  the plugin's own frPower/frToughness — combat math and the SBA loop — see global pumps
  (Crusade, Bad Moon, Lord of Atlantis, Goblin King, Castle); `derivedPower`/
  `derivedToughness` mirror the plugin formula for local queries; `grantedKeywords` folds
  base keywords + the `_keywordOverlay` (granted keywords, carried through snapshot/
  restore); `bonusForLandTap`/`observeManaFlare`/`postAction` implement Mana Flare's
  "+1 mana per land tap" through both the plugin activateAbility path and the local mana
  path. Wired into `turn.doAction` (pre-action sync → reducer → post-action flare+sync).
- `game/abilities.js` — activated-ability local layer (roadmap task 25): the plugin
  natively validates/resolves `card.abilities` (priority, {T} + summoning sickness, mana/
  life costs, targeting subset), so this module layers what it can't: `timingLegal`
  (yourTurn/upkeep/combat/sorcery windows) and rich Alpha target-set validation via
  `target.abilityTargetingFor` + `target.targetSetLegal`, hooked into `turn.doAction`
  (every activation is gated like validateCast); `activateAbility` = validate-then-run.
- `game/regenerate.js` — 1993 regeneration runtime (roadmap task 25; the plugin has no
  "regenerate" op): shields granted on ability resolution, `saveCreature` (tapped +
  damage/combat state cleared) on lethal damage or destroy, `reconcileDeaths` resurrects
  any shielded creature that died in an action (restoring auras), shields expire at the
  end of turn, `_regenerating` wrapper state survives snapshot/restore. Wired into
  `turn.doAction` (grant on resolve, reconcile before postAction/triggers) and
  `triggers.localSba`/`applyOneEffect` (shield-or-die for lethal damage + destroy).
- `game/cost.js` — cost payment engine: `parseCost`, `canPayPool`, `manaSources`,
  `buildPayment` (pool-first / sources-first, X incl. `"max"`), `payCost`.
- `game/cast.js` — casting pipeline (roadmap task 19): `timingLegality`,
  `castableFromHand`, `validateCast` (authoritative clone dry-run), `castSpell`
  (validate → plan → tap → reducer cast → announce). Note: `castSpell` validates BEFORE
  checking affordability so priority/timing/target/mode reasons report first.
- `game/stack.js` — stack layer (roadmap task 20): `stackEntries`/`stackTop` (ordered
  LIFO view with targets/mode/x metadata), `allPassRound` (pass once per player →
  resolve-top / empty-stack-advance), and `describeEntry` for the game log. The resolve
  primitives moved to `resolve.js` in task 22.
- `game/resolve.js` — spell resolution & fizzle (roadmap task 22): `resolveTop`/
  `resolveAll` (the plugin resolves the top object on an all-pass round; this layer
  reports what resolved, permanents entered, enter-triggers fired, counter-removals),
  and the fizzle enforcement — `enforceFizzle`/`checkTargetsAtResolve` re-check a
  resolving object's chosen targets against the current board with the same slot
  legality casting used, trimming to the legal subset (empty = fizzle: no effect, object
  still to graveyard) and reporting `fizzled`/`chosenTargets`/`targets`/`illegalTargets`.
- `game/target.js` — targeting query layer (roadmap task 21): `cardDefFor` (Alpha
  projection then plugin fixture DB), `targetingForId`/`cardTargeting`/
  `abilityTargetingFor`, `slotTargetLegal` (hexproof vs. opponents, protection-from-
  color, zone/types/notTypes/subtypes/colors/tapped/owner/count, full reasons),
  `legalTargetsForSlot`, `targetSetLegal`, bounded `legalTargetSets`, plus
  `targetName`/`describeTarget` for the game log.
- `realms.js` — the five realm identities (names, domains, MTG color mapping, emblems);
  loaded as a plain script by index.html (`window.REALMS`, `window.realmForColor`, …).
- `test.js` — tiny test harness + on-screen game log (`window.Test`, `window.gameLog`).

## Caveats

- `src/` scripts (other than `test.js`/`realms.js`) are NOT loaded by index.html — the
  live game UI inlines its own renderer (`window.FRGame` in index.html) and calls the
  plugin directly via `root.fr(...)`. The modules here are the engine/validator layer for
  AI, tests, and future integration; don't duplicate their logic into the UI.
- The plugin's reducer wipes mana pools at every step advance; `mana.js` burns from a
  pre-advance snapshot. The plugin reducer can't produce multi-colour mana — dual lands
  go through `mana.activateManaAbility`'s clone-and-mutate path (every Alpha card id is
  now plugin-known via the task-22 DB injection, so no reducer round chokes on them).
- `castSpell` announces via `game.history` entries (`announceCast`); the DOM game log is
  the UI's job.
- The platform's src/ file server has been observed to flakily return **502 "failed to
  fetch from file storage after retries"** for arbitrary individual src/ files (it hops
  between files; storage content stays intact — the workspace copy reads fine). The
  workaround that reliably clears it is touching the affected file (rewrite identical
  content via the fs API) then `page_refresh`. If a test module 502s on `import`, check
  `fetch("src/<file>")` status and touch as needed; the whole suite was run this way.

## Roadmap

The task tracker lives in main.pjs (Phases 1–14). Next uncompleted: **task 26 —
Damage prevention & regeneration effects** (Phase 8). The regeneration PROCESS is already
in place from task 25 (src/game/regenerate.js: shields, save on lethal/destroy, expiry);
what remains is the standalone prevention-shield template op ("prevent all damage that
would be dealt to/by X this turn / next time") — Samite Healer's {T} prevention is
declared via the plugin's native "shield" op already, so the gap is the "next time /
this turn" shield variants with the one-shield-at-a-time overlapping rule.
