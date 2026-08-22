// Task #20: Save/Load Serialization — serialize global state, party stats,
// and inventory into a versioned persistent format, with a slot manager.
// Task #203: version bumped to 2 with an optional `meta` block (slot
// metadata for the title screen) plus raw/store accessors.

import { Character } from "./character.js";
import { Inventory } from "./inventory.js";
import { PartyManager } from "./party.js";
import { GameState } from "./state.js";

export const SAVE_VERSION = 2;

export function serializeGame(game, extra = {}) {
  const revive = (m) => ({
    id: m.id,
    name: m.name,
    classId: m.classId,
    level: m.level,
    xp: m.xp,
    hp: m.hp,
    mp: m.mp,
    equipment: { ...m.equipment },
    statuses: [...m.statuses],
    extraSpells: [...(m.extraSpells ?? [])],
    // Task #145: gear wear is optional — undefined drops out of the JSON.
    gearWear: m.gearWear ? JSON.parse(JSON.stringify(m.gearWear)) : undefined,
  });
  return JSON.stringify(
    {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      meta: extra.meta ?? null,
      state: game.state ? game.state.snapshot() : null,
      gold: game.party ? game.party.gold : 0,
      party: game.party ? game.party.members.map(revive) : [],
      reserve: game.party ? game.party.reserve.map(revive) : [],
      inventory: game.inventory
        ? game.inventory.summary().map(({ id, count }) => ({ id, count }))
        : [],
    },
    null,
    2
  );
}

export function deserializeGame(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || typeof data !== "object") throw new Error("invalid save data");

  const inventory = new Inventory();
  for (const s of data.inventory ?? []) inventory.add(s.id, s.count);

  const revive = (m) => {
    const c = new Character({
      id: m.id,
      name: m.name,
      classId: m.classId,
      level: m.level,
      xp: m.xp,
      hp: m.hp,
      mp: m.mp,
    });
    c.equipment = { ...(m.equipment ?? { weapon: null, armor: null }) };
    c.statuses = [...(m.statuses ?? [])];
    c.extraSpells = [...(m.extraSpells ?? [])];
    // Task #145: gear wear round-trips (additive — old saves just lack it).
    if (m.gearWear) c.gearWear = JSON.parse(JSON.stringify(m.gearWear));
    return c;
  };

  const party = new PartyManager({ gold: data.gold ?? 0 });
  for (const m of data.party ?? []) party.add(revive(m));
  for (const m of data.reserve ?? []) party.add(revive(m), true);

  const state = new GameState();
  state.restore(data.state ?? null);
  state.setParty(party);
  state.setInventory(inventory);

  return { state, party, inventory, version: data.version ?? 0, meta: data.meta ?? null };
}

export class SaveManager {
  constructor(opts = {}) {
    this.storage = opts.storage ?? null;
    this.memory = {};
    this.prefix = opts.prefix ?? "ff_save_";
  }

  _key(slot) {
    return this.prefix + slot;
  }

  save(slot, game) {
    return this.store(slot, serializeGame(game));
  }

  store(slot, json) {
    if (this.storage) this.storage.setItem(this._key(slot), json);
    else this.memory[slot] = json;
    return json;
  }

  raw(slot) {
    if (this.storage) return this.storage.getItem(this._key(slot));
    return this.memory[slot] ?? null;
  }

  has(slot) {
    return this.raw(slot) != null;
  }

  load(slot) {
    const json = this.storage ? this.storage.getItem(this._key(slot)) : this.memory[slot];
    if (json == null) return null;
    return deserializeGame(json);
  }

  loadJson(json) {
    return deserializeGame(json);
  }

  delete(slot) {
    if (this.storage) this.storage.removeItem(this._key(slot));
    else delete this.memory[slot];
  }

  slots() {
    if (this.storage) {
      return Object.keys(this.storage)
        .filter((k) => k.startsWith(this.prefix))
        .map((k) => k.slice(this.prefix.length));
    }
    return Object.keys(this.memory);
  }
}
