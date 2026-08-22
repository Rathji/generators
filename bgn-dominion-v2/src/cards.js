/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/cards.js  (Task 2: schema + registry)
   Card catalog registry. Card definitions are pure data; the
   canonical text lives in src/data/<set>.json files (one per
   expansion) and is loaded via cards.init() (browser fetch) or
   cards.loadFromData() (pure path, also used by worker tests).

   Card schema:
     id         string  — unique, lower-snake, e.g. "throne_room"
     name       string  — display name
     cost       { coins: number>=0, potion: number>=0 }
     types      string[] — subset of Dominion.engine.CARD_TYPES
     treasure   number|null — coins a Treasure produces when played
     vp         number|null — base VP (0=no; dynamic VP via effect)
     text       string  — official effect text
     expansion  string  — set id, e.g. "base"
     inSupply   bool    — true if this card forms a supply pile
     pileSize   number | { "2":n,"3":n,... } — default supply count
     startDeck  number  — copies in each player's starting deck
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = (global.Dominion = global.Dominion || {});
  const cards = {};
  Dominion.cards = cards;

  const KNOWN_TYPES = (Dominion.engine && Dominion.engine.CARD_TYPES) || [
    "Action", "Treasure", "Victory", "Curse", "Reaction", "Attack",
    "Duration", "Reserve", "Night", "Fate", "Doom", "Looter", "Traveler",
    "Shelter", "Ruins", "Knight", "Prize", "Spirit", "Zombie", "Shadow",
    "Liaison", "Heirloom", "Omen", "Prophecy"
  ];

  const registry = new Map();

  /* ── Schema validation: returns array of error strings ([] = ok) ── */
  function validate(def) {
    const errs = [];
    if (!def || typeof def !== "object" || Array.isArray(def)) return ["card definition must be a plain object"];
    if (typeof def.id !== "string" || !def.id.trim()) errs.push("id must be a non-empty string");
    if (typeof def.name !== "string" || !def.name.trim()) errs.push("name must be a non-empty string");
    const cost = (def.cost && typeof def.cost === "object") ? def.cost : {};
    if (typeof cost.coins !== "number" || cost.coins < 0 || !Number.isInteger(cost.coins)) errs.push("cost.coins must be an integer >= 0");
    if (typeof cost.potion !== "number" || cost.potion < 0 || !Number.isInteger(cost.potion)) errs.push("cost.potion must be an integer >= 0");
    if (!Array.isArray(def.types) || def.types.length === 0) errs.push("types must be a non-empty array");
    else def.types.forEach((t) => { if (KNOWN_TYPES.indexOf(t) === -1) errs.push("unknown type: " + t); });
    if (def.treasure != null && (typeof def.treasure !== "number" || def.treasure < 0)) errs.push("treasure must be a number >= 0 or null");
    if (def.vp != null && typeof def.vp !== "number") errs.push("vp must be a number or null");
    if (typeof def.text !== "string") errs.push("text must be a string");
    if (typeof def.expansion !== "string" || !def.expansion.trim()) errs.push("expansion must be a non-empty string");
    if (def.inSupply != null && typeof def.inSupply !== "boolean") errs.push("inSupply must be a boolean or omitted");
    if (def.pileSize != null) {
      if (typeof def.pileSize === "number") { if (def.pileSize < 0) errs.push("pileSize must be >= 0"); }
      else if (typeof def.pileSize === "object") {
        for (const k of Object.keys(def.pileSize)) {
          if (!/^\d+$/.test(k) || typeof def.pileSize[k] !== "number" || def.pileSize[k] < 0)
            errs.push("pileSize." + k + " must be a non-negative number");
        }
      } else errs.push("pileSize must be a number or player-count map");
    }
    if (def.startDeck != null && (typeof def.startDeck !== "number" || def.startDeck < 0)) errs.push("startDeck must be a number >= 0 or omitted");
    return errs;
  }
  cards.validate = validate;

  /* ── Register one definition (throws on schema error or dup id) ── */
  function register(def) {
    const errs = validate(def);
    if (errs.length) {
      throw new Error("invalid card definition" + (def && def.name ? " '" + def.name + "'" : "") + ": " + errs.join("; "));
    }
    if (registry.has(def.id)) throw new Error("duplicate card id: " + def.id);
    const card = Object.freeze({
      id: def.id,
      name: def.name,
      cost: { coins: def.cost.coins, potion: def.cost.potion },
      types: def.types.slice().sort(),
      treasure: def.treasure == null ? null : def.treasure,
      vp: def.vp == null ? null : def.vp,
      text: def.text,
      expansion: def.expansion,
      inSupply: def.inSupply === true,
      pileSize: def.pileSize == null ? null : def.pileSize,
      startDeck: def.startDeck == null ? 0 : def.startDeck
    });
    registry.set(card.id, card);
    return card;
  }
  cards.register = register;

  function get(id) { return registry.get(id) || null; }
  cards.get = get;

  function has(id) { return registry.has(id); }
  cards.has = has;

  function all() { return Array.from(registry.values()); }
  cards.all = all;

  function count() { return registry.size; }
  cards.count = count;

  function byExpansion(exp) { return all().filter((c) => c.expansion === exp); }
  cards.byExpansion = byExpansion;

  /* ── Load parsed JSON data: { set, cards: [...] } ── */
  function loadFromData(data) {
    if (!data || !Array.isArray(data.cards)) throw new Error("loadFromData expects { set, cards: [...] }");
    const loaded = [];
    data.cards.forEach((def) => { loaded.push(register(def)); });
    return { set: data.set || "?", count: loaded.length };
  }
  cards.loadFromData = loadFromData;

  /* ── Reset + load a set list (browser path; uses fetch) ──
     init() clears the registry first, so it is safe to call
     repeatedly (tests do). Non-browser contexts should use
     fs.readTextFile + loadFromData instead. */
  function init(sets) {
    const list = (sets && sets.length) ? sets.slice() : ["base"];
    registry.clear();
    return (async function () {
      let total = 0;
      for (const s of list) {
        const resp = await fetch("src/data/" + s + ".json");
        if (!resp.ok) throw new Error("catalog fetch failed for " + s + ": HTTP " + resp.status);
        total += loadFromData(await resp.json()).count;
      }
      return { set: list.join(","), count: total };
    })();
  }
  cards.init = init;

  function reset() { registry.clear(); return registry.size; }
  cards.reset = reset;

})(typeof self !== "undefined" ? self : globalThis);
