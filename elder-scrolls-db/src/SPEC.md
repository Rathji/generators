# The Elder Archive — Schema Specification (v1.0.0)

All ingested content is normalized into the canonical entity types below. Every record
is a JSON object with an `id` (unique slug within its game+category), a `name`, and a
`status` of `draft` or `verified`. Field types:

- `text` / `textarea` — strings
- `number` — numeric
- `enum` — one of the listed options
- `strings` — array of plain strings
- `links` — array of **ids** of records of the named `target` type (resolved at render time)
- `bool` — boolean

The authoritative field list (labels, types, required flags, options, descriptions) lives
in `src/data/schema.json` — the app renders every detail scroll and validates from it, so
**schema.json is the single source of truth**. This document summarises it.

## Entity types (9)

### locations
`name`, `aliases`, `province` (enum), `region`, `type` (city/town/village/fort/ruin/cave/
mine/dungeon/temple/shrine/tower/farm/camp/landmark/quarter/plane), `description`, `lore`,
`factions` (→factions), `notableCharacters` (→npcs), `quests` (→quests),
`connectedTo` (→locations), `coordinates`, `status`.

### npcs
`name`, `title`, `race` (enum), `gender`, `class`, `level`, `factions` (→factions),
`factionRank`, `location` (→locations), `relatedQuests` (→quests), `description`, `lore`,
`death`, `status`.

### factions
`name`, `motto`, `type` (great house/guild/cult/military/criminal/political/religious/
daedric/racial/arcane), `headquarters` (→locations), `members` (→npcs), `ranks`,
`relations`, `relatedQuests` (→quests), `description`, `lore`, `status`.

### quests
`name`, `type` (main/faction/guild/daedric/side/misc/pilgrimage/tribunal), `givenBy` (→npcs),
`location` (→locations), `faction` (→factions), `prerequisites`, `objectives`, `reward`,
`description`, `status`.

### items
`name`, `type` (weapon/armor/apparel/ingredient/potion/scroll/artifact/key/misc/clothing/
jewelry), `subtype`, `material`, `value`, `weight`, `enchantment`, `effects`, `location`
(→locations), `questRelated`, `description`, `lore`, `status`.

### spells
`name`, `school` (alteration/conjuration/destruction/illusion/mysticism/restoration),
`cost`, `effects`, `duration`, `skill`, `description`, `status`.

### creatures
`name`, `type` (beast/daedra/undead/insect/fish/bird/construct/atronach/spirit/chitin),
`level`, `abilities`, `habitat` (→locations), `loot`, `description`, `lore`, `status`.

### books
`name`, `author`, `volume`, `skill`, `content`, `description`, `status`.

### races
`name`, `province`, `abilities`, `bonuses`, `description`, `lore`, `status`.

## Cross-referencing rules

- Links are **ids**, never display names: `"factions": ["house-hlaalu", "blades"]`.
- An id must resolve within the same game first; if absent there, the app searches all
  other games (for cross-game references like the Nerevarine or Dagoth Ur).
- A link to an unresolvable id is flagged as an orphan in the app and counted as
  unresolved in the Roadmap — the definition of done for Phase 4 is **zero orphans**.

## Validation rules (used by the Roadmap)

1. Every record has a non-empty `name` (only required field in v1).
2. Every `links` value resolves (see above).
3. `status` is exactly `draft` or `verified`; a category counts as *complete* only when
   all its records are `verified`.
