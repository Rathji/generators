# src/framework — reusable game framework

This folder holds the game-agnostic core of the BrowserQuest-2 project: a top-down,
tile-based, authoritative-server multiplayer ARPG client engine. Everything here was
ported from Mozilla's classic BrowserQuest (2012) and cleaned into vanilla ES modules.
It is intentionally decoupled from the game's theme — reskinning means replacing the
files listed in "Reskin checklist" below, NOT touching anything in this folder.

## Modules

| File | Responsibility |
|---|---|
| `engine.js` | Sprite/animation system, Timer/Transition, `Entity`/`Character`/`Player`/`Mob`/`Npc`/`Item`/`Chest` classes, `createEntity(kind,id,name)`, `Camera`, `BubbleManager`, plus the asset URLs (`TILESET_URL`, `MAP_URL`, `SERVER_MAP_URL`, `ATLAS_URL`). |
| `pathfinder.js` | `findPath(grid,start,end)` (A*) and `Pathfinder` class with ignored-entity support and incomplete-path fallback. |
| `infomanager.js` | Floating damage-number overlay (`InfoManager`, `DamageInfo`). |
| `audio.js` | `AudioManager` — WebAudio sound effects + looping area music with crossfade-ish transitions. |
| `voice.js` | DECtalk voice synthesis for NPC speech (WebAudio, offline-generated). |

Note: `framework/engine.js` imports `../types.js` — `types.js` lives at `src/` because
it mixes the shared wire protocol (framework concern) with per-game entity/stat tables
(game concern). A reskin edits the game half of `types.js` and must keep the protocol
enums in sync with the server script in `index.html`.

## How the client talks to the server

The server is an authoritative Perchance `server-plugin` script embedded in
`index.html` (`<script type="text/x-server-plugin" id="bq-server">`). The client
(`src/game.js`) connects with `root.createServerSocket()` and exchanges JSON arrays
whose first element is a message id. Both sides MUST agree on the enum, so every
reskin change to `Types.Messages` in `src/types.js` must be mirrored in the server's
`M` table (and vice versa).

Message ids (client → server / server → client):

| id | Name | Direction | Payload |
|---|---|---|---|
| 0 | HELLO | C→S | name, armorKind, weaponKind |
| 1 | WELCOME | S→C | id, name, x, y, hp |
| 2 | SPAWN | S→C | id, kind, x, y, [orientation, [target]] |
| 3 | DESPAWN | S→C | id |
| 4 | MOVE | C→S | x, y |
| 5 | LOOTMOVE | C→S | x, y, itemId |
| 6 | AGGRO | C→S | mobId (adds hate) |
| 7 | ATTACK | both | attackerId, targetId |
| 8 | HIT | C→S | mobId (player damage roll) |
| 9 | HURT | C→S | mobId (mob damage roll vs player) |
| 10 | HEALTH | S→C | hp |
| 11 | CHAT | both | text (S→C adds id) |
| 12 | LOOT | C→S | itemId |
| 13 | EQUIP | S→C | playerId, armorOrWeaponKind |
| 14 | DROP | S→C | deadMobId, itemId, itemKind, hatelist[] |
| 15 | TELEPORT | C→S | x, y (checked against map doors) |
| 16 | DAMAGE | S→C | mobId, dmg |
| 17 | POPULATION | S→C | total, inArea |
| 18 | KILL | S→C | killedKind |
| 19 | LIST | S→C | entityIds[] (batch spawn request) |
| 20 | WHO | C→S | entityIds[] (request SPAWN for each) |
| 21 | ZONE | C→S | (client moved between zones) |
| 22 | DESTROY | S→C | itemId (item removed, e.g. despawn) |
| 23 | HP | S→C | maxHp |
| 24 | BLINK | S→C | itemId (start blinking before despawn) |
| 25 | OPEN | C→S | chestId |
| 26 | CHECK | C→S | checkpointId |

Entity kinds (`Types.Entities` / server `E`) use a loose namespace: 1 player, 2–14 mobs,
20–26 armors, 35–39 objects (healing items, chests, firepotion), 40–55 NPCs, 60–66
weapons. The server's `KM` table maps kind-name → [id, type]; `P` maps kind-name →
stats/drops; `RW`/`RA` define weapon/armor tier order.

## Server architecture (in index.html)

The whole server is synchronous (Perchance sandbox: no timers, no async, no fetch, no
crypto). Work is triggered by `tick()`, piggybacked onto every incoming message and on
connect/disconnect.

- **Zone-group broadcasting** — the map is divided into `zoneWidth x zoneHeight`
  cells; each client belongs to a group and receives only entities in adjacent groups
  (`adjGroups`, door-connected groups included). This is what keeps bandwidth low.
- **Durable state** — the world (map + serialized mobs/items) is written to the
  plugin's durable `state` Uint8Array every ~10s, with a magic version to invalidate
  stale/corrupt state. `loadFromState()` restores it on boot; a fresh world is built
  from the map config otherwise.
- **Self-healing** — static mobs/NPCs/chests are NOT persisted; after a server
  restart they are reconciled against the map config on load and on every client
  connect (`syncStaticFromConfig`, `syncStaticChests`, `syncRoamingFromConfig`), so a
  crashed world rebuilds its lost static entities.
- **Crash log** — every handler is wrapped; exceptions are recorded into a 64KB ring
  buffer at the tail of `state` and readable via the `crashLog` RPC, so a server
  crash's cause can always be recovered. Client shows it in the intro screen.
- **Admin RPCs** — `initMap`, `addStatic`, `syncWorld`, `isReady`, `crashLog`,
  `resetState`.
- **Combat** — deterministic-ish formulas live server-side (`doDmg`, `hpFor`);
  players send intent (HIT/HURT/LOOT/OPEN), the server rolls damage, applies hate
  lists, picks targets, spawns drops, and broadcasts the results.
- **Rate limiting** — `chkRate(conn,key,ms)` guards HELLO (1/s), MOVE (30ms), CHAT
  (500ms). Names/chat are HTML-escaped and length-capped.

## Map data

Two JSON files define the world (uploaded to the perchance file host, URLs in
`src/framework/engine.js`):
- `MAP_URL` (client) — full tile data: `width`, `height`, `data` (tile ids),
  `blocking`, `plateau`, `collisions`, `high`, `animated`, `musicAreas`, `doors`,
  `checkpoints`.
- `SERVER_MAP_URL` (server) — same world, plus the spawn tables: `roamingAreas`
  (`{x,y,width,height,nb,type}`), `chestAreas` (`{tx,ty,i}`), `staticChests`
  (`{x,y,i}`), `staticEntities` (`{tileId: "kindName"}`). Doors must list the
  connected tile so the server can join zone groups.

The two files must describe the same world; the client file is also what the
"lorem ipsum" placeholder world is built from, so keep them in sync when reskinning.

## Reskin checklist

To turn this framework into a new themed game, replace/edit ONLY these:

1. **New map JSONs** (client + server variants) → update the four URLs in
   `src/framework/engine.js`.
2. **New sprite atlas + tileset + sprites.json** → `src/sprites.json` (atlas layout:
   `atlas_x`/`atlas_y`, `animations`) and the atlas/tileset image URLs.
3. **`src/types.js`** — entity kind enums, `kindInfo`, ranked weapons/armors,
   `Properties` (hp/drops/levels), `Formulas`, `MobSpeeds`. Keep `Types.Messages` in
   sync with the server's `M` table.
4. **Server tables in `index.html`** — `E`, `KM`, `P`, `RW`, `RA` (and the
   message enum `M` if you extend it).
5. **Intro screen** — the entire `<div id="start-screen">` block + its CSS is
   theme-specific; replace freely.
6. **Audio/music** — `src/framework/audio.js`'s `MUSIC_URLS`/`SFX_URLS`; NPC speech
   voices in `src/framework/voice.js`.
7. **`src/game.js`** — the client monolith (render loop, message handlers, input,
   UI glue). Mostly framework-ish, but achievements/zoning/NPC talk are themed.
8. **`src/sprites.json`** — sprite animation data consumed by `engine.js`.

Everything in this folder can be treated as stable.
