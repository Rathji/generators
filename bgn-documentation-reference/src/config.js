/* ════════════════════════════════════════════════════════════════
   BGN DOCUMENTATION REFERENCE — src/config.js
   ─────────────────────────────────────────────────────────────────
   THIS IS THE FILE YOU EDIT TO MAKE A FORK.

   The app engine (src/app.js) is fully generic: it only knows how
   to *search, browse, render, favorite, copy and share* references.
   Everything that makes a reference a *specific game* lives here:

     · the game's categories ("groups") and their icons
     · the game's "sources" — where its data comes from (bundled
       JSON files, live APIs, etc.)
     · edition/preset chips, popular lookups, GM-tool defaults
     · dice, homebrew label, theming colors, share-link behaviour

   Bundled genre presets (switch with ?game=<id> at runtime, or
   change `defaultGame` below):
     dnd            → D&D 5e (2014 + 2024) — the reference implementation
     pathfinder     → Pathfinder 2E (real sample data from Pf2eTools)
     warhammer      → Warhammer 40k-style wargame (illustrative sample)
     crisis-protocol→ Marvel Crisis Protocol-style skirmish wargame (sample)
     classic-board  → Classic board games (Chess, Monopoly, Risk…)
     modern-board   → Modern board games (Wingspan, Azul, TtR…)

   HOW TO FORK:
     1. Pick a preset you like (e.g. warhammer) and copy its `game`
        object into a fresh `myGame` entry — or edit it in place.
     2. Point its sources at your own JSON data files in src/data/
        (see the "bundled local data" note under fileSource below).
     3. Change defaultGame to your game id and remove the others.
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ═══════════ generic helpers (shared with the app engine) ═══════════ */
  const helpers = {
    esc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    // Perchance-style inline markdown → plain text (for copy + search)
    inlineText: (t) => String(t)
      .replace(/\*\*/g, "").replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/−/g, "-")
      .replace(/\n/g, " ").replace(/\s+/g, " ").trim(),
    // Perchance-style inline markdown → HTML
    inlineHTML: (t) => {
      const text = String(t);
      const toks = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`|\[[^\]]*\]\([^)]*\))/g);
      let out = "";
      for (let tok of toks) {
        if (!tok) continue;
        if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) out += "<b>" + helpers.esc(tok.slice(2, -2)) + "</b>";
        else if (tok.startsWith("_") && tok.endsWith("_") && tok.length > 2) out += "<i>" + helpers.esc(tok.slice(1, -1)) + "</i>";
        else if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) out += "<code>" + helpers.esc(tok.slice(1, -1)) + "</code>";
        else {
          const link = tok.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
          if (link) out += '<a href="' + helpers.esc(link[2]) + '" target="_blank" rel="noopener">' + helpers.esc(link[1]) + "</a>";
          else out += helpers.esc(tok);
        }
      }
      return out;
    },
    // Pf2eTools-style {@token ...} inline syntax → readable text
    cleanInline: (t) => {
      if (t == null) return "";
      t = String(t);
      t = t.replace(/@UUID\[([^\]]*)\]\{([^}]*)\}/g, (m, inner, text) => text);
      t = t.replace(/@UUID\[([^\]]*)\]/g, (m, inner) => { const p = inner.split("|"); return p[p.length - 1] || ""; });
      t = t.replace(/\{@([a-zA-Z0-9]+)\s+([^}]*)\}/g, (m, tag, inner) => {
        const parts = inner.split("|");
        const body = parts[0];
        const low = tag.toLowerCase();
        if (low === "b" || low === "bold") return "**" + body + "**";
        if (low === "i" || low === "italic") return "_" + body + "_";
        if (low === "as") return body;
        if (low === "dc" || low === "flatdc") return "DC " + body;
        if (low === "note") return "";
        return body;
      });
      t = t.replace(/~([A-Z])/g, "$1");
      t = t.replace(/\s+/g, " ").trim();
      return t;
    },
    // Build the lowercase searchable text for an entry (uses e.text if present)
    buildSearchText: (e) => {
      if (e.text) return e.text;
      const inline = helpers.inlineText;
      let t = (e.name || "") + " " + (e.subtitle || "") + " " + (e.category || "");
      for (const b of e.blocks || []) {
        if (typeof b.t === "string") t += " " + inline(b.t);
        if (b.k) t += " " + inline(b.k) + " " + inline(b.v);
        if (b.name) t += " " + inline(b.name);
        if (Array.isArray(b.items)) for (const it of b.items) t += " " + inline(it);
        if (Array.isArray(b.pairs)) for (const p of b.pairs) t += " " + inline(p.k) + " " + inline(p.v);
        if (Array.isArray(b.rows)) for (const r of b.rows) for (const c of r) t += " " + inline(c);
        if (b.abilities) for (const k of Object.keys(b.abilities)) { const a = b.abilities[k]; if (a) t += " " + (a.score || "") + " " + (a.mod || "") + (a.save ? " save " + a.save : ""); }
      }
      return t.toLowerCase();
    },
    // Standard group/query filtering shared by every local-data source.
    // group is one of: "All" | a game group id | "Favorites" | the custom-content pseudo-group
    matchLocal: (db, q, group, ctx, limit, kind) => {
      const out = [];
      for (const e of db) {
        if (group === "Favorites") { if (!ctx.isFav(kind, e)) continue; }
        else if (group === ctx.customId) continue; // custom pseudo-group is engine-handled
        else if (group !== "All" && e.group !== group) continue;
        if (q && (e._s || (e._s = helpers.buildSearchText(e))).indexOf(q) === -1) continue;
        out.push(e);
      }
      if (q) {
        const score = (e) => e.name.toLowerCase().startsWith(q) ? 0 : e.name.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
        out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
      }
      return limit ? out.slice(0, limit) : out;
    },
  };

  /* ═══════════ source factory: bundled local JSON files ═══════════
     Each file is an ARRAY of entries, or an object like
       { "_meta": { ...any note... }, "entries": [ ... ] }
     Entries look like:
       { id, name, subtitle?, category?, group, edition?, tags[],
         meta{}, blocks[], refs[], text? }
     blocks[] is the renderable body — see the block types in app.js:
       p, sec, kv, kvrow, list, table, feat, quote, abil, hr
     refs = [{ book, chapter, page?, license? }]
  ──────────────────────────────────────────────────────────────── */
  function fileSource(cfg) {
    const S = {
      id: cfg.id, label: cfg.label, desc: cfg.desc,
      badge: cfg.badge || { cls: "ed-expanded", text: cfg.badgeText || cfg.id },
      edition: cfg.edition || (cfg.badge && cfg.badge.text) || cfg.id,
      tabLabel: cfg.tabLabel || (cfg.badge && cfg.badge.text) || cfg.id,
      rank: cfg.rank != null ? cfg.rank : 0,
      defaultOn: cfg.defaultOn !== false,
      license: cfg.license || "",
      favKey: (e) => e.id || e.name,
      _db: null,
    };
    S.files = cfg.files;
    S.ensure = async () => {
      if (S._db) return;
      const out = [];
      for (const f of S.files) {
        try {
          const r = await fetch(f);
          if (!r.ok) continue;
          const data = await r.json();
          const arr = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : []);
          for (const e of arr) if (e && e.name) out.push(e);
        } catch (e) { /* file unavailable — skip */ }
      }
      out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      S._db = out;
    };
    S.match = (q, group, ctx, limit) => helpers.matchLocal(S._db || [], q, group, ctx, limit, S.id);
    S.count = () => (S._db ? S._db.length : 0);
    return S;
  }

  /* ═══════════ live JSON fetcher with retry (used by the D&D sources) ═══════════ */
  async function fetchJson(url, timeoutMs) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const to = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 9000) : null;
      try {
        const r = await fetch(url, ctl ? { signal: ctl.signal } : {});
        if (!r.ok) throw new Error("http " + r.status);
        return await r.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
      } finally { if (to) clearTimeout(to); }
    }
    throw lastErr || new Error("fetch failed");
  }

  /* ════════════════════════════════════════════════════════════════
     D&D 5E — 2024 (bundled SRD 5.2 JSON)
  ════════════════════════════════════════════════════════════════ */
  const dnd2024 = fileSource({
    id: "24", label: "2024 — SRD 5.2", badge: { cls: "ed-2024", text: "2024" },
    desc: "Official 2024 rules, bundled with this site", rank: 0,
    license: "Free SRD content © Wizards of the Coast · CC-BY-4.0",
    files: ["src/data/spells.json", "src/data/monsters.json", "src/data/rules.json",
      "src/data/feats.json", "src/data/origins.json", "src/data/classes.json",
      "src/data/equipment.json", "src/data/magic-items.json"],
  });

  /* ════════════════════════════════════════════════════════════════
     D&D 5E — 2014 (live from dnd5eapi.co, SRD 5.1)
     Demonstrates a "lazy live API" source: an index of names is
     searched, and the full entry is fetched only when opened.
  ════════════════════════════════════════════════════════════════ */
  const API = "https://www.dnd5eapi.co";
  const BOOKS = {
    phb: "Player's Handbook", mm: "Monster Manual", dmg: "Dungeon Master's Guide",
    xge: "Xanathar's Guide to Everything", scag: "Sword Coast Adventurer's Guide",
    srd: "System Reference Document", "srd-5.1": "System Reference Document 5.1",
    "phb-errata": "PHB Errata", "mm-errata": "MM Errata", "dmg-errata": "DMG Errata",
    tce: "Tasha's Cauldron of Everything", ftod: "Fizban's Treasury of Dragons",
    mordkainen: "Mordenkainen's Tome of Foes",
  };
  const API_CATS = [
    ["spells", "Spells"], ["monsters", "Monsters"], ["rule-sections", "Rules"], ["conditions", "Rules"],
    ["skills", "Rules"], ["languages", "Rules"], ["alignments", "Rules"], ["ability-scores", "Rules"],
    ["damage-types", "Rules"], ["magic-schools", "Rules"], ["backgrounds", "Characters"],
    ["races", "Characters"], ["classes", "Characters"], ["subclasses", "Characters"],
    ["features", "Characters"], ["traits", "Characters"], ["equipment", "Equipment"],
    ["magic-items", "Equipment"], ["weapons", "Equipment"], ["armor", "Equipment"],
  ];
  const KIND_MAP = {
    spells: "spell", monsters: "monster", "rule-sections": "rule-section", conditions: "condition",
    skills: "skill", languages: "language", alignments: "alignment", "ability-scores": "ability-score",
    "damage-types": "damage-type", "magic-schools": "school", backgrounds: "background", races: "race",
    classes: "class", subclasses: "subclass", features: "feature", traits: "trait",
    equipment: "equipment", "magic-items": "magic-item", weapons: "weapon", armor: "armor",
  };
  function refLine(entry) {
    const src = (entry.source || "").toLowerCase();
    const book = BOOKS[src] || (src ? src.toUpperCase() : "System Reference Document");
    const page = entry.page ? " p." + entry.page : "";
    return (book + page + " (D&D 5e 2014 · SRD 5.1 · dnd5eapi.co)").replace(/^undefined/, "SRD");
  }
  function adapt2014(raw, idx) {
    const group = idx.group, kind = idx.kind;
    const cat = KIND_MAP[kind] || kind;
    const entry = {
      id: "2014-" + (idx.index || "").replace(/\W+/g, "-"),
      url: idx.url,
      name: raw.name || idx.name, category: cat, group, edition: "2014",
      chapter: "SRD 5.1 (2014)", subtitle: "", tags: [], meta: {},
      blocks: [], refs: [{ book: refLine(raw) }], text: (raw.name || "").toLowerCase(),
      source: raw.source, page: raw.page,
    };
    const paras = (v) => Array.isArray(v) ? v.join("\n\n") : String(v || "");
    const addKv = (k, v) => { if (String(v).trim()) entry.blocks.push({ type: "kv", k, v }); };
    const addP = (t) => { if (String(t).trim()) entry.blocks.push({ type: "p", t }); };
    const addFeats = (arr, secName) => {
      if (!Array.isArray(arr) || !arr.length) return;
      entry.blocks.push({ type: "sec", t: secName });
      for (const f of arr) entry.blocks.push({ type: "feat", name: f.name || "", t: Array.isArray(f.desc) ? f.desc.join(" ") : String(f.desc || "") });
    };
    if (cat === "spell") {
      const cls = (raw.classes || []).map((c) => c.name).join(", ");
      entry.subtitle = (raw.level === 0 ? "Cantrip" : "Level " + raw.level + " " + (raw.school && raw.school.name)) + (cls ? " (" + cls + ")" : "");
      entry.tags = [raw.level === 0 ? "Cantrip" : "Level " + raw.level, raw.school && raw.school.name, ...(raw.classes || []).map((c) => c.name)].filter(Boolean);
      addKv("Casting Time", (raw.ritual ? "1 action or ritual" : raw.casting_time) || "—");
      addKv("Range", raw.range || "—");
      addKv("Components", [raw.components || [], raw.material ? "(" + raw.material + ")" : ""].filter(Boolean).join(" ") || "—");
      addKv("Duration", (raw.concentration ? "Concentration, " : "") + (raw.duration || "—"));
      if (Array.isArray(raw.desc)) raw.desc.forEach((d) => addP(d));
      if (Array.isArray(raw.higher_level) && raw.higher_level.length) entry.blocks.push({ type: "p", t: "_At Higher Levels._ " + raw.higher_level.join(" ") });
      return entry;
    }
    if (cat === "monster") {
      const speed = raw.speed || {};
      const speedStr = (v) => {
        const parts = [];
        if (v.walk) parts.push(v.walk);
        for (const k of ["fly", "swim", "climb", "burrow", "hover"]) if (v[k]) parts.push(k[0].toUpperCase() + k.slice(1) + " " + v[k]);
        return parts.length ? parts.join(", ") : "";
      };
      entry.subtitle = [raw.size, raw.type + (raw.subtype ? " (" + raw.subtype + ")" : ""), raw.alignment].filter(Boolean).join(", ");
      entry.tags = [raw.size, raw.type, raw.alignment, "CR " + (raw.challenge_rating != null ? raw.challenge_rating : "")].filter(Boolean);
      const acStr = (a) => {
        if (a == null) return "—";
        if (Array.isArray(a)) return a.map((x) => x.value + (x.type ? " (" + x.type + ")" : "")).join(", ");
        if (typeof a === "object") return a.value + (a.type ? " (" + a.type + ")" : "");
        return String(a);
      };
      [["AC", acStr(raw.armor_class)], ["HP", raw.hit_points + " (" + raw.hit_dice + ")"], ["Speed", speedStr(speed) || "—"]]
        .forEach((p) => entry.blocks.push({ type: "kvrow", pairs: [{ k: p[0], v: p[1] }] }));
      const abil = {};
      for (const a of ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]) {
        const s = raw[a]; if (s == null) continue;
        const mod = Math.floor((s - 10) / 2);
        abil[a.slice(0, 3)] = { score: String(s), mod: (mod >= 0 ? "+" : "") + mod, save: "" };
      }
      if (Object.keys(abil).length) entry.blocks.push({ type: "abil", abilities: abil });
      const profs = (raw.proficiencies || []).filter((p) => /saving/i.test(p.proficiency && p.proficiency.name || ""));
      if (profs.length) addKv("Saving Throws", profs.map((p) => p.proficiency.name + " +" + p.value).join(", "));
      const sk = raw.skills;
      if (sk) addKv("Skills", Object.entries(sk).map(([k, v]) => k.replace(/-/g, " ") + " +" + v).join(", "));
      for (const k of ["damage_vulnerabilities", "damage_resistances", "damage_immunities", "condition_immunities"]) {
        if (Array.isArray(raw[k]) && raw[k].length) addKv(k.replace(/_/g, " "), raw[k].join(", "));
      }
      const sensesStr = (s) => {
        if (!s) return "";
        if (typeof s === "string") return s;
        const parts = [];
        for (const [k, v] of Object.entries(s)) {
          if (k === "passive_perception") parts.push("Passive Perception " + v);
          else parts.push(k.replace(/_/g, " ") + " " + v);
        }
        return parts.join("; ");
      };
      addKv("Senses", sensesStr(raw.senses) || "—");
      addKv("Languages", raw.languages || "—");
      addKv("CR", raw.challenge_rating != null ? raw.challenge_rating + " (XP " + (raw.xp || "?") + ")" : "");
      addFeats(raw.special_abilities, "Traits");
      addFeats(raw.actions, "Actions");
      addFeats(raw.reactions, "Reactions");
      addFeats(raw.bonus_actions, "Bonus Actions");
      addFeats(raw.legendary_actions, "Legendary Actions");
      return entry;
    }
    addP(paras(raw.desc));
    if (cat === "condition") for (const s of (raw.special_conditions || [])) addP(paras(s.desc));
    if (cat === "equipment" || cat === "weapon" || cat === "armor") {
      if (raw.category) addKv("Category", raw.category);
      if (raw.cost) addKv("Cost", raw.cost.quantity + " " + raw.cost.unit.toUpperCase());
      if (raw.weight) addKv("Weight", raw.weight + " lb.");
      if (raw.armor_class) addKv("Armor Class (AC)", raw.armor_class.base + (raw.armor_class.dex_bonus ? " + Dex modifier" : "") + (raw.armor_class.max_bonus ? " (max " + raw.armor_class.max_bonus + ")" : ""));
      if (raw.stealth_disadvantage) addKv("Stealth", "Disadvantage");
      if (raw.special) raw.special.forEach((s) => addP(s.name + ". " + s.desc));
      if (raw.properties && raw.properties.length) addKv("Properties", raw.properties.map((p) => p.name).join(", "));
    }
    if (cat === "magic-item") {
      if (raw.rarity) addKv("Rarity", raw.rarity.name);
      if (raw.requires_attunement) addKv("Attunement", "Required");
    }
    if (cat === "background" && raw.starting_proficiencies && raw.starting_proficiencies.length)
      addKv("Starting Proficiencies", raw.starting_proficiencies.map((p) => p.name).join(", "));
    if (cat === "race") {
      if (raw.speed) addKv("Speed", String(raw.speed));
      addKv("Size", raw.size_description || raw.size || "");
      addFeats(raw.traits, "Traits");
    }
    if (cat === "class") {
      addKv("Hit Die", "d" + (raw.hit_die || ""));
      if (raw.proficiencies && raw.proficiencies.length) addKv("Proficiencies", raw.proficiencies.map((p) => p.name).join(", "));
      if (raw.saving_throws && raw.saving_throws.length) addKv("Saving Throws", raw.saving_throws.map((p) => p.name).join(", "));
    }
    if (cat === "feature" || cat === "trait" || cat === "subclass") entry.subtitle = raw.level ? "Level " + raw.level : "";
    if (!entry.blocks.length) addP(paras(raw.desc));
    return entry;
  }
  const dnd2014 = {
    id: "14", label: "2014 — SRD 5.1", badge: { cls: "ed-2014", text: "2014" },
    desc: "Official 2014 rules, live from dnd5eapi.co", rank: 1, defaultOn: false,
    tabLabel: "2014",
    ensureNote: "Indexing the 2014 rules (first search may be a touch slower)…",
    license: "Free SRD 5.1 content © Wizards of the Coast · OGL 1.0a / CC-BY-4.0 · via dnd5eapi.co",
    favKey: (e) => e.url || e.name,
    _idx: null, _idxPromise: null, _cache: new Map(),
    ensure: async () => {
      if (dnd2014._idx || dnd2014._idxPromise) return;
      dnd2014._idxPromise = (async () => {
        const idx = [];
        for (const [kind, group] of API_CATS) {
          try {
            const data = await fetchJson(API + "/api/" + kind + "?limit=2000");
            if (!data || !Array.isArray(data.results)) continue;
            for (const it of data.results) idx.push({ name: it.name || "", index: it.index, url: it.url, group, kind });
          } catch (e) { /* category unavailable — skip */ }
        }
        idx.sort((a, b) => a.name.localeCompare(b.name));
        dnd2014._idx = idx;
      })().finally(() => { dnd2014._idxPromise = null; }).catch(() => {});
      return dnd2014._idxPromise;
    },
    match: (q, group, ctx, limit) => {
      if (!dnd2014._idx) return [];
      return helpers.matchLocal(dnd2014._idx, q, group, ctx, limit, dnd2014.id);
    },
    fetchDetail: async (idx) => {
      if (dnd2014._cache.has(idx.url)) return dnd2014._cache.get(idx.url);
      const raw = await fetchJson(API + idx.url, 15000);
      const entry = adapt2014(raw, idx);
      dnd2014._cache.set(idx.url, entry);
      return entry;
    },
    refFor: (entry) => (entry.refs && entry.refs[0] && entry.refs[0].book) || "",
    count: () => (dnd2014._idx ? dnd2014._idx.length : 0),
    describe: () => "2014 index " + (dnd2014._idx ? dnd2014._idx.length.toLocaleString() + " entries" : "still indexing…"),
  };

  /* ════════════════════════════════════════════════════════════════
     D&D 5E — Expanded (Open5e, OGL/ORC 3rd-party books)
     Demonstrates a "book-based" source: players enable whole books
     from a list, and each book's content is fetched + cached.
  ════════════════════════════════════════════════════════════════ */
  const O5E = "https://api.open5e.com";
  const O5E_CATS = {
    spells: ["Spells", "spell"], monsters: ["Monsters", "monster"], feats: ["Feats", "feat"],
    magicitems: ["Equipment", "magic-item"], weapons: ["Equipment", "weapon"], armor: ["Equipment", "armor"],
    races: ["Characters", "race"], subraces: ["Characters", "subrace"],
    backgrounds: ["Characters", "background"], classes: ["Characters", "class"],
  };
  const speedStr = (s) => {
    if (!s) return "";
    if (typeof s === "string") return s;
    const parts = [];
    const order = [["walk", "walk"], ["fly", "fly"], ["swim", "swim"], ["burrow", "burrow"], ["climb", "climb"]];
    for (const [k, label] of order) {
      const v = s[k];
      if (v) parts.push(label + " " + v + " ft." + (k === "fly" && s.hover ? " (hover)" : ""));
    }
    return parts.join(", ");
  };
  const exKV = (blocks, k, v) => { const s = String(v ?? "").trim(); if (s) blocks.push({ type: "kv", k, v: s }); };
  const exParas = (s) => String(s || "").split(/\n{2,}/).map((x) => x.replace(/\n/g, " ").trim()).filter(Boolean).map((t) => ({ type: "p", t }));
  const exFeats = (list) => {
    const out = [];
    for (const a of (list || [])) if (a && a.name && (a.desc || a.text)) out.push({ type: "feat", name: a.name, t: String(a.desc || a.text).trim() });
    return out;
  };
  const adaptSpell = (raw) => {
    const blocks = [];
    const comps = String(raw.components || "") + (raw.material ? " (" + raw.material + ")" : "");
    exKV(blocks, "Casting Time", raw.casting_time);
    exKV(blocks, "Range", raw.range);
    exKV(blocks, "Components", comps);
    exKV(blocks, "Duration", (raw.duration || "") + (raw.concentration === "yes" || raw.requires_concentration ? " · concentration" : "") + (raw.ritual === "yes" || raw.can_be_cast_as_ritual ? " · ritual" : ""));
    exKV(blocks, "Classes", raw.dnd_class);
    blocks.push(...exParas(raw.desc));
    if (raw.higher_level) blocks.push({ type: "p", t: "_At Higher Levels._ " + raw.higher_level.trim() });
    const school = String(raw.school || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { name: raw.name, subtitle: [raw.level, school].filter(Boolean).join(" "), category: "spell", blocks };
  };
  const AB_NAMES = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
  const AB_KEYS = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
  const adaptMonster = (raw) => {
    const blocks = [];
    exKV(blocks, "Armor Class", (raw.armor_class ?? "") + (raw.armor_desc ? " (" + raw.armor_desc + ")" : ""));
    exKV(blocks, "Hit Points", (raw.hit_points ?? "") + (raw.hit_dice ? " (" + raw.hit_dice + ")" : ""));
    exKV(blocks, "Speed", speedStr(raw.speed));
    const abs = ["str", "dex", "con", "int", "wis", "cha"];
    const abilities = {};
    for (const k of abs) {
      const score = raw[AB_KEYS[k]];
      if (score == null) continue;
      abilities[k] = { score, mod: Math.floor((Number(score) - 10) / 2), save: raw[AB_KEYS[k] + "_save"] ?? null };
    }
    if (Object.keys(abilities).length) blocks.push({ type: "abil", abilities });
    const saves = abs.filter((k) => raw[AB_KEYS[k] + "_save"] != null).map((k) => ({ k: AB_NAMES[k], v: String(raw[AB_KEYS[k] + "_save"]) }));
    if (saves.length) blocks.push({ type: "kvrow", pairs: saves });
    const skills = raw.skills || {};
    const skillPairs = Object.entries(skills).map(([k, v]) => ({ k: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), v: String(v) }));
    if (skillPairs.length) blocks.push({ type: "kvrow", pairs: skillPairs });
    exKV(blocks, "Damage Vulnerabilities", raw.damage_vulnerabilities);
    exKV(blocks, "Damage Resistances", raw.damage_resistances);
    exKV(blocks, "Damage Immunities", raw.damage_immunities);
    exKV(blocks, "Condition Immunities", raw.condition_immunities);
    exKV(blocks, "Senses", raw.senses);
    exKV(blocks, "Languages", raw.languages);
    exKV(blocks, "Challenge", raw.challenge_rating);
    blocks.push(...exParas(raw.desc));
    blocks.push(...exFeats(raw.actions));
    const sub = [raw.size, raw.type, raw.alignment].filter(Boolean).join(", ");
    return { name: raw.name, subtitle: sub, category: "monster", blocks };
  };
  const adaptMagicItem = (raw) => {
    const blocks = [];
    exKV(blocks, "Type", raw.type);
    exKV(blocks, "Rarity", raw.rarity);
    if (raw.requires_attunement && String(raw.requires_attunement).toLowerCase() !== "no" && raw.requires_attunement !== false) exKV(blocks, "Attunement", "Required");
    blocks.push(...exParas(raw.desc));
    return { name: raw.name, subtitle: [raw.rarity, raw.type].filter(Boolean).join(" · "), category: "magic-item", blocks };
  };
  const adaptWeapon = (raw) => {
    const blocks = [];
    exKV(blocks, "Category", raw.category);
    exKV(blocks, "Cost", raw.cost);
    exKV(blocks, "Damage", (raw.damage_dice || "") + (raw.damage_type ? " " + raw.damage_type : ""));
    exKV(blocks, "Range", raw.range);
    exKV(blocks, "Weight", raw.weight ? raw.weight + " lb." : "");
    exKV(blocks, "Properties", Array.isArray(raw.properties) ? raw.properties.join(", ") : raw.properties);
    blocks.push(...exParas(raw.desc));
    return { name: raw.name, subtitle: raw.category, category: "weapon", blocks };
  };
  const adaptArmor = (raw) => {
    const blocks = [];
    exKV(blocks, "Category", raw.category);
    exKV(blocks, "Armor Class", raw.armor_class);
    exKV(blocks, "Cost", raw.cost);
    exKV(blocks, "Strength", raw.strength_requirement);
    exKV(blocks, "Stealth", raw.stealth_disadvantage === true ? "Disadvantage" : raw.stealth_disadvantage);
    exKV(blocks, "Weight", raw.weight ? raw.weight + " lb." : "");
    blocks.push(...exParas(raw.desc));
    return { name: raw.name, subtitle: raw.category, category: raw.category || "armor", blocks };
  };
  const adaptGeneric = (raw, catname) => {
    const blocks = [];
    exKV(blocks, "Ability Scores", raw.asi_desc || (Array.isArray(raw.ability_bonuses) ? raw.ability_bonuses.map((a) => a.ability + " +" + a.bonus).join(", ") : raw.ability));
    exKV(blocks, "Size", raw.size);
    exKV(blocks, "Speed", typeof raw.speed === "string" ? raw.speed : speedStr(raw.speed));
    exKV(blocks, "Languages", raw.languages);
    exKV(blocks, "Prerequisite", raw.prerequisite);
    exKV(blocks, "Hit Die", raw.hit_dice);
    exKV(blocks, "Type", raw.type);
    exKV(blocks, "Requires Attunement", raw.requires_attunement === true ? "yes" : raw.requires_attunement === "no" ? "" : raw.requires_attunement);
    blocks.push(...exParas(Array.isArray(raw.desc) ? raw.desc.join("\n\n") : raw.desc));
    blocks.push(...exFeats(raw.features));
    return { name: raw.name, subtitle: "", category: catname, blocks };
  };
  const adaptO5e = (raw, cat, catname, group) => {
    if (!raw || !raw.name) return null;
    let e;
    if (cat === "spells") e = adaptSpell(raw);
    else if (cat === "monsters") e = adaptMonster(raw);
    else if (cat === "magicitems") e = adaptMagicItem(raw);
    else if (cat === "weapons") e = adaptWeapon(raw);
    else if (cat === "armor" || cat === "shields") e = adaptArmor(raw);
    else e = adaptGeneric(raw, catname);
    e.group = group;
    e.id = "ex-" + e.name + "-" + e.category;
    e.edition = "Expanded";
    e.tags = [];
    e.meta = {};
    e.homebrew = false;
    e.text = helpers.buildSearchText(e);
    return e;
  };
  const open5e = {
    id: "ex", label: "5e Expanded", badge: { cls: "ed-expanded", text: "Expanded" },
    desc: "Community & 3rd-party books (Open5e)", rank: 2, defaultOn: false,
    tabLabel: "Expanded",
    license: "Open5e · OGL/ORC-licensed 3rd-party content © its publishers · open5e.com/legal",
    favKey: (e) => e.book + "|" + e.category + "|" + e.name,
    _items: [], _books: new Map(), _docsPromise: null, _bookStates: new Map(), _loading: new Map(),
    ensure: async (ctx) => {
      // (re)load books that are enabled in prefs
      for (const slug of ctx.state.books) {
        if (!open5e._bookStates.has(slug) && open5e._books.has(slug)) await open5e.books.load(slug, ctx);
      }
    },
    match: (q, group, ctx, limit) => {
      const db = [];
      for (const e of open5e._items) {
        if (ctx.state.books.size && !ctx.state.books.has(e.book)) continue;
        db.push(e);
      }
      return helpers.matchLocal(db, q, group, ctx, limit, open5e.id);
    },
    count: () => open5e._items.length,
    books: {
      title: "Community & 3rd-party books (Open5e)",
      hint: "OGL/ORC-licensed content — choose specific books below",
      cacheKey: "expanded", cacheV: 2,
      list: async () => {
        if (open5e._books.size) return open5e._books;
        if (open5e._docsPromise) return open5e._docsPromise;
        open5e._docsPromise = (async () => {
          const data = await fetchJson(O5E + "/v1/documents/?format=json", 15000);
          const map = new Map();
          for (const d of (data.results || [])) {
            if (d.slug === "wotc-srd" || d.slug === "o5e" || d.slug === "a5e") continue;
            map.set(d.slug, { slug: d.slug, title: d.title, org: d.organization || "" });
          }
          open5e._books = map;
          return map;
        })().catch((e) => { open5e._docsPromise = null; throw e; });
        return open5e._docsPromise;
      },
      state: (slug) => open5e._bookStates.get(slug) || { state: "idle", n: 0 },
      load: async (slug, ctx) => {
        if (open5e._loading.has(slug)) return open5e._loading.get(slug);
        const meta = open5e._books.get(slug);
        if (!meta) return 0;
        open5e._bookStates.set(slug, { state: "loading", n: 0 });
        const p = (async () => {
          const kv = ctx.kv();
          try {
            if (kv) {
              const cached = await kv.expanded.get(slug);
              if (cached && cached.v === 2 && Array.isArray(cached.items) && cached.items.length) {
                for (const e of cached.items) { e.book = slug; e.refs = e.refs || [{ book: meta.title }]; open5e._items.push(e); }
                open5e._bookStates.set(slug, { state: "ready", n: cached.items.length });
                return cached.items.length;
              }
            }
          } catch (e) { /* cache miss → fetch */ }
          const found = [];
          for (const [cat, [group, catname]] of Object.entries(O5E_CATS)) {
            try {
              let url = O5E + "/v1/" + cat + "/?document__slug=" + slug + "&limit=100&format=json";
              while (url) {
                const data = await fetchJson(url, 20000);
                for (const raw of (data.results || [])) {
                  const entry = adaptO5e(raw, cat, catname, group);
                  if (entry) { entry.book = slug; entry.refs = [{ book: meta.title }]; entry.chapter = meta.title; found.push(entry); }
                }
                url = data.next || null;
              }
            } catch (e) { /* category unavailable — skip */ }
          }
          try { if (kv && found.length) await kv.expanded.set(slug, { v: 2, items: found }); } catch (e) { /* non-fatal */ }
          for (const e of found) open5e._items.push(e);
          open5e._bookStates.set(slug, { state: "ready", n: found.length });
          return found.length;
        })();
        open5e._loading.set(slug, p);
        p.finally(() => open5e._loading.delete(slug)).catch(() => { open5e._bookStates.set(slug, { state: "error", n: 0 }); });
        return p;
      },
    },
    rowExtra: (entry) => entry.book ? '<span class="r-cat">' + helpers.esc(entry.refs && entry.refs[0] ? entry.refs[0].book : entry.book) + "</span>" : "",
  };

  /* ════════════════════════════════════════════════════════════════
     THE PRESETS
  ════════════════════════════════════════════════════════════════ */

  const HERO_GEN = "https://user.uploads.dev/file/8630ae1ac1df6491b862ac120c6afa08.jpg";

  /* ── Tabletop RPG (default) ── */
  const dnd = {
    id: "dnd",
    name: "BGN Documentation Reference",
    tagline: "Search the free rules and stats across all your sources — then copy the answer and its reference straight to your table.",
    kicker: "Rules · Stats · Copy",
    genre: "Reference · Documentation",
    players: "All editions",
    accent: { a: "#d4af37", a2: "#f2dc8b", a3: "#8f721d" },
    heroImage: HERO_GEN,
    copyright: "D&D 5E is © Wizards of the Coast. Content is the free System Reference Document — SRD 5.2 (2024) under CC-BY-4.0 and SRD 5.1 (2014) via dnd5eapi.co. Fan reference tool, not affiliated with WotC.",
    groups: ["Spells", "Monsters", "Rules", "Feats", "Characters", "Equipment"],
    groupIcons: { Spells: "✦", Monsters: "☠", Rules: "⚖", Feats: "♟", Characters: "⚔", Equipment: "🛡" },
    sources: [dnd2024, dnd2014, open5e],
    chipsLabel: "Edition",
    chips: [
      { id: "2024", label: "2024", set: { "24": true, "14": false } },
      { id: "2014", label: "2014", set: { "24": false, "14": true } },
      { id: "both", label: "Both", set: { "24": true, "14": true } },
    ],
    custom: {
      id: "hb", label: "House rules & homebrew", chipLabel: "Homebrew", chipIcon: "🏠",
      desc: "Everything you've imported with 📥 Import",
      badge: { cls: "ed-custom", text: "Custom" },
      license: "Added by you — not official material. Stored in your browser only.",
      defaultOn: true,
    },
    popular: ["Fireball", "Bless", "Grappled", "Grappler", "Longsword", "Bag of Holding", "Dwarf", "Rage", "Lich", "Magic Missile"],
    placeholder: "Search spells, monsters, rules, feats, species, equipment…",
    detailEmpty: '<div style="font-size:2.6rem;margin-bottom:6px">⚔</div>Pick a result to read it here — spells, stat blocks, rules and more, with a copy button that takes the reference along.',
    noResults: (q) => 'Nothing matched <b style="color:var(--bgn-accent2)">' + helpers.esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "grapple", "rage", "shield").',
    favEmpty: 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.',
    gm: {
      dice: [
        { label: "d4", sides: 4 }, { label: "d6", sides: 6 }, { label: "d8", sides: 8 },
        { label: "d10", sides: 10 }, { label: "d12", sides: 12 }, { label: "d20", sides: 20 }, { label: "d100", sides: 100 },
      ],
      lookups: [
        { label: "✦ Spell", group: "Spells", src: "all" },
        { label: "☠ Monster", group: "Monsters", src: "all" },
        { label: "⚖ Rule", group: "Rules", src: "all" },
        { label: "♟ Feat", group: "Feats", src: "all" },
        { label: "🛡 Item", group: "Equipment", src: "all" },
        { label: "⚔ Character", group: "Characters", src: "all" },
        { label: "🔀 Anything", group: "All", src: "all" },
      ],
    },
    sample: {
      text: "Long Rest House Rule — it takes a full day\n\nIn this campaign a long rest takes 24 hours of downtime, and can only be taken in a safe haven (a town, camp, or ally's stronghold).\n\n## What counts as a safe haven\n- Any settlement with a friendly ruler or inn\n- A camp you've fortified for at least 4 hours\n\nWilderness travel never counts, no matter how comfortable.",
      json: {
        entries: [
          { name: "Arcane Overload", subtitle: "House rule", group: "Spells",
            blocks: [
              { type: "p", t: "When you cast a **spell of 3rd level or higher**, you may trade one spell slot to overload it." },
              { type: "list", items: ["Roll a d6. On a 1–2 the spell fizzles and the slot is lost.", "On a 3–6 the spell is cast **one level higher** than the slot you spent."] },
              { type: "quote", t: "Rule of thumb: big gambles, big explosions." },
            ] },
          { name: "Shared Concentration", subtitle: "House rule", group: "Rules",
            blocks: [
              { type: "p", t: "Two allies who are adjacent may agree to **share concentration** on one spell. Either can end the spell as a free action; both take damage normally when the caster would." },
            ] },
        ],
      },
    },
    exportName: "bgn-dnd-custom",
    shareQuery: (ctx) => {
      const p = new URLSearchParams();
      if (stateQuery(ctx)) p.set("q", stateQuery(ctx));
      const both = ctx.state.sources["24"] && ctx.state.sources["14"];
      const ed = both ? "both" : ctx.state.sources["24"] ? "2024" : ctx.state.sources["14"] ? "2014" : "";
      if (ed) p.set("ed", ed);
      return p;
    },
    urlState: (params, ctx) => {
      const ed = (params.get("ed") || "").toLowerCase();
      if (ed === "2024" || ed === "2014" || ed === "both") {
        ctx.state.sources["24"] = ed !== "2014";
        ctx.state.sources["14"] = ed !== "2024";
      }
    },
  };
  function stateQuery(ctx) { return (ctx.state.query || "").trim(); }

  /* ── Pathfinder 2E ── */
  const pathfinder = {
    id: "pathfinder",
    name: "Pathfinder 2E Reference",
    tagline: "Search the remastered PF2e core rules, feats, spells, conditions and creatures — then copy the answer and its book reference straight to your table.",
    kicker: "Core Rules · Feats · Spells",
    genre: "Reference · RPG",
    players: "Sample data · Paizo ORC",
    accent: { a: "#c96b3f", a2: "#ffd0a8", a3: "#7c3a1c" },
    heroImage: HERO_GEN,
    copyright: "Sample rules data sourced from Pf2eTools (pf2etools.com), generated from Paizo's freely licensed Pathfinder content under the Paizo ORC License. Pathfinder © Paizo Inc. Fan reference tool.",
    groups: ["Spells", "Feats", "Creatures", "Conditions", "Rules"],
    groupIcons: { Spells: "✦", Feats: "♟", Creatures: "☠", Conditions: "💫", Rules: "⚖" },
    sources: [
      fileSource({
        id: "core", label: "Pathfinder Core (sample)", badge: { cls: "ed-pf2e", text: "PF2e" },
        desc: "Bundled sample data from the remastered Player Core & Bestiary 1 — replace with your full dataset when forking.",
        rank: 0, license: "Sample data · Paizo ORC · via Pf2eTools",
        files: ["src/data/samples/pathfinder/spells.json", "src/data/samples/pathfinder/feats.json",
          "src/data/samples/pathfinder/creatures.json", "src/data/samples/pathfinder/conditions.json",
          "src/data/samples/pathfinder/rules.json"],
      }),
    ],
    custom: {
      id: "hb", label: "House rules & homebrew", chipLabel: "Homebrew", chipIcon: "🏠",
      desc: "Everything you've imported with 📥 Import",
      badge: { cls: "ed-custom", text: "Custom" },
      license: "Added by you — not official material. Stored in your browser only.",
      defaultOn: true,
    },
    popular: ["Fireball", "Shield Block", "Stride", "Darkvision", "Grabbed", "Heal", "Rage", "Goblin Warrior"],
    placeholder: "Search spells, feats, creatures, conditions, rules…",
    detailEmpty: '<div style="font-size:2.6rem;margin-bottom:6px">🎲</div>Pick a result to read it here — feats, spells, stat blocks and rules, with a copy button that takes the reference along.',
    noResults: (q) => 'Nothing matched <b style="color:var(--bgn-accent2)">' + helpers.esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "rage", "shield", "goblin").',
    favEmpty: 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.',
    gm: {
      dice: [
        { label: "d4", sides: 4 }, { label: "d6", sides: 6 }, { label: "d8", sides: 8 },
        { label: "d10", sides: 10 }, { label: "d12", sides: 12 }, { label: "d20", sides: 20 },
      ],
      lookups: [
        { label: "✦ Spell", group: "Spells", src: "all" },
        { label: "♟ Feat", group: "Feats", src: "all" },
        { label: "☠ Creature", group: "Creatures", src: "all" },
        { label: "💫 Condition", group: "Conditions", src: "all" },
        { label: "🔀 Anything", group: "All", src: "all" },
      ],
    },
    sample: {
      text: "House Rule — Hero Points at Every Table\n\nAt the start of every session each player gains 2 Hero Points instead of 1, and can hold up to 5.\n\n## What you can spend them on\n- Rerolling any d20 you just rolled\n- Stabilizing at 1 HP when you would fall to 0\n- Converting a critical failure into a normal failure\n\nThey still reset to the new start-of-session number each session.",
      json: {
        entries: [
          { name: "Bastion of Shared Focus", subtitle: "House rule", group: "Rules",
            blocks: [
              { type: "p", t: "A character with at least one focus point may spend a **focus point** as a reaction when an adjacent ally is hit: the ally gains a **+2 circumstance bonus to AC** against that attack." },
              { type: "list", items: ["This does not restore focus points — you still recover them with Refocus.", "A character can only use this once per round."] },
            ] },
        ],
      },
    },
    exportName: "bgn-pf2e-custom",
  };

  /* ── Warhammer 40k-style wargame ── */
  const warhammer = {
    id: "warhammer",
    name: "Warhammer 40K Reference",
    tagline: "Stat lines, weapons, stratagems and core rules in 10th-edition format — search, read, and copy the reference to your list or table.",
    kicker: "Statlines · Stratagems · Core",
    genre: "Reference · Wargame",
    players: "Sample dataset",
    accent: { a: "#3f7dc9", a2: "#a8d0ff", a3: "#1c4f7c" },
    heroImage: HERO_GEN,
    copyright: "ILLUSTRATIVE sample data — not official Games Workshop content. Warhammer 40,000 © Games Workshop Ltd. Verify all stats against your Codex before play.",
    groups: ["Core Rules", "Units", "Weapons", "Stratagems"],
    groupIcons: { "Core Rules": "📜", Units: "🪖", Weapons: "🔫", Stratagems: "♟" },
    sources: [
      fileSource({
        id: "core", label: "Core Rules (sample)", badge: { cls: "ed-wh40k", text: "Core" },
        desc: "The battle round, phases, cover and battle-shock — bundled sample.",
        rank: 0, license: "Illustrative sample · © Games Workshop",
        files: ["src/data/samples/warhammer/core.json"],
      }),
      fileSource({
        id: "codex", label: "Codex: Space Marines (sample)", badge: { cls: "ed-wh40k", text: "Codex" },
        desc: "Unit stat lines, weapons and stratagems for an example army — bundled sample.",
        rank: 1, license: "Illustrative sample · © Games Workshop",
        files: ["src/data/samples/warhammer/units.json"],
      }),
    ],
    custom: {
      id: "hb", label: "House rules & homebrew", chipLabel: "Custom rules", chipIcon: "📜",
      desc: "Everything you've imported with 📥 Import",
      badge: { cls: "ed-custom", text: "Custom" },
      license: "Added by you — not official material. Stored in your browser only.",
      defaultOn: true,
    },
    popular: ["Intercessor", "Charge", "Shooting Phase", "Battle-shock", "Armour of Contempt", "Bolt Rifle", "Cover"],
    placeholder: "Search units, weapons, stratagems, core rules…",
    detailEmpty: '<div style="font-size:2.6rem;margin-bottom:6px">🎖</div>Pick a result to read it here — datasheets, weapon profiles and rules, with a copy button that takes the reference along.',
    noResults: (q) => 'Nothing matched <b style="color:var(--bgn-accent2)">' + helpers.esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "charge", "intercessor", "cover").',
    favEmpty: 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.',
    gm: {
      dice: [
        { label: "d3", sides: 3 }, { label: "d6", sides: 6 }, { label: "2d6", sides: 6, count: 2 },
        { label: "3d6", sides: 6, count: 3 }, { label: "d10", sides: 10 }, { label: "d20", sides: 20 },
      ],
      lookups: [
        { label: "🪖 Random Unit", group: "Units", src: "all" },
        { label: "🔫 Random Weapon", group: "Weapons", src: "all" },
        { label: "♟ Random Stratagem", group: "Stratagems", src: "all" },
        { label: "📜 Core Rule", group: "Core Rules", src: "all" },
        { label: "🔀 Anything", group: "All", src: "all" },
      ],
    },
    sample: {
      text: "House Rule — Vehicle Reinforcements\n\nVehicles may arrive as reinforcements from any board edge on turn 2+, but must pay 1 Command Point and deploy more than 6\" from enemy models.\n\n## When it applies\n- Any Vehicle or Monster with a transport capacity\n- Not usable by units that arrived this turn already",
      json: {
        entries: [
          { name: "Overwatch Token", subtitle: "House rule", group: "Core Rules",
            blocks: [
              { type: "p", t: "Once per turn, a player may spend **1 Command Point** to place an Overwatch token on a unit that has not moved. Until your next Command phase, that unit may fire Overwatch for free against a charging enemy." },
            ] },
        ],
      },
    },
    exportName: "bgn-wh40k-custom",
  };

  /* ── Crisis Protocol-style skirmish wargame ── */
  const crisisProtocol = {
    id: "crisis-protocol",
    name: "Crisis Protocol Reference",
    tagline: "Characters, tactics and core rules in Marvel Crisis Protocol format — search the roster and copy the reference to your table.",
    kicker: "Characters · Tactics · Core",
    genre: "Reference · Skirmish",
    players: "Sample dataset",
    accent: { a: "#c93f4a", a2: "#ffa8ad", a3: "#7c1c24" },
    heroImage: HERO_GEN,
    copyright: "ILLUSTRATIVE sample data — not official Atomic Mass Games content. Marvel Crisis Protocol © Marvel / Atomic Mass Games. Verify all stats against current cards before play.",
    groups: ["Core Rules", "Characters", "Tactics"],
    groupIcons: { "Core Rules": "📜", Characters: "🦸", Tactics: "🃏" },
    sources: [
      fileSource({
        id: "core", label: "Core Rules (sample)", badge: { cls: "ed-mcp", text: "Core" },
        desc: "Activation, power, attacks, throws and conditions — bundled sample.",
        rank: 0, license: "Illustrative sample · © Marvel / AMG",
        files: ["src/data/samples/crisis-protocol/core.json"],
      }),
      fileSource({
        id: "chars", label: "Characters & Tactics (sample)", badge: { cls: "ed-mcp", text: "Roster" },
        desc: "Example roster cards and tactics cards — bundled sample.",
        rank: 1, license: "Illustrative sample · © Marvel / AMG",
        files: ["src/data/samples/crisis-protocol/characters.json"],
      }),
    ],
    custom: {
      id: "hb", label: "House rules & homebrew", chipLabel: "Custom rules", chipIcon: "📜",
      desc: "Everything you've imported with 📥 Import",
      badge: { cls: "ed-custom", text: "Custom" },
      license: "Added by you — not official material. Stored in your browser only.",
      defaultOn: true,
    },
    popular: ["Captain America", "Power", "Throw", "Staggered", "Activation", "Shield Slam", "Ultron"],
    placeholder: "Search characters, tactics, core rules…",
    detailEmpty: '<div style="font-size:2.6rem;margin-bottom:6px">🛡</div>Pick a result to read it here — roster cards, tactics and rules, with a copy button that takes the reference along.',
    noResults: (q) => 'Nothing matched <b style="color:var(--bgn-accent2)">' + helpers.esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "power", "throw", "cap").',
    favEmpty: 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.',
    gm: {
      dice: [
        { label: "d4", sides: 4 }, { label: "d6", sides: 6 }, { label: "d8", sides: 8 },
        { label: "d10", sides: 10 }, { label: "d12", sides: 12 }, { label: "d20", sides: 20 },
      ],
      lookups: [
        { label: "🦸 Random Character", group: "Characters", src: "all" },
        { label: "🃏 Random Tactic", group: "Tactics", src: "all" },
        { label: "📜 Core Rule", group: "Core Rules", src: "all" },
        { label: "🔀 Anything", group: "All", src: "all" },
      ],
    },
    sample: {
      text: "House Rule — Power on Turn One\n\nOn the first activation of the game, the second player's first character begins with 2 extra power.\n\n## Why\n- Reduces the first-player advantage slightly\n- Applies to all games, even casual ones",
      json: {
        entries: [
          { name: "Clean Board, Big Hits", subtitle: "House rule", group: "Core Rules",
            blocks: [
              { type: "p", t: "While fewer than **3 characters remain on the table**, attacks gain +1 attack die on their primary stat." },
            ] },
        ],
      },
    },
    exportName: "bgn-mcp-custom",
  };

  /* ── Classic board games ── */
  const classicBoard = {
    id: "classic-board",
    name: "Classic Board Game Rules",
    tagline: "Rules references for the classics — Chess, Monopoly, Scrabble, Risk, Cluedo and Backgammon. Look up the rule and copy it to your table in one tap.",
    kicker: "Rules · Setup · Winning",
    genre: "Reference · Classics",
    players: "1–8 players",
    accent: { a: "#b38a3f", a2: "#e7d0a8", a3: "#6f5520" },
    heroImage: HERO_GEN,
    copyright: "Sample rules references for public-domain classics and widely documented games. Always defer to your physical rulebook for tournament rulings.",
    groups: ["Chess", "Monopoly", "Scrabble", "Risk", "Cluedo", "Backgammon"],
    groupIcons: { Chess: "♞", Monopoly: "🏢", Scrabble: "🔤", Risk: "🌍", Cluedo: "🔍", Backgammon: "⚀" },
    sources: [
      fileSource({
        id: "classic", label: "Classic rulebooks", badge: { cls: "ed-classic", text: "Classic" },
        desc: "Rules for Chess, Monopoly, Scrabble, Risk, Cluedo and Backgammon — bundled sample.",
        rank: 0, license: "Public domain / widely documented rules — sample data",
        files: ["src/data/samples/classic-board/classic.json"],
      }),
    ],
    custom: {
      id: "hb", label: "House rules", chipLabel: "House rules", chipIcon: "🏠",
      desc: "Everything you've imported with 📥 Import",
      badge: { cls: "ed-custom", text: "Custom" },
      license: "Added by you — not official material. Stored in your browser only.",
      defaultOn: true,
    },
    popular: ["Castling", "En Passant", "Free Parking", "GO", "Bingo", "Checkmate", "Jail", "Doubling Cube"],
    placeholder: "Search a rule, e.g. “castling” or “rent”…",
    detailEmpty: '<div style="font-size:2.6rem;margin-bottom:6px">🎲</div>Pick a result to read it here — setup, turns, scoring and winning, with a copy button that takes the reference along.',
    noResults: (q) => 'Nothing matched <b style="color:var(--bgn-accent2)">' + helpers.esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "castling", "rent", "bingo").',
    favEmpty: 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.',
    gm: {
      dice: [
        { label: "d6", sides: 6 }, { label: "2d6", sides: 6, count: 2 }, { label: "3d6", sides: 6, count: 3 },
        { label: "d10", sides: 10 }, { label: "d20", sides: 20 },
      ],
      lookups: [
        { label: "♞ Chess rule", group: "Chess", src: "all" },
        { label: "🏢 Monopoly rule", group: "Monopoly", src: "all" },
        { label: "🔤 Scrabble rule", group: "Scrabble", src: "all" },
        { label: "🔀 Anything", group: "All", src: "all" },
      ],
    },
    sample: {
      text: "House Rule — Fast Monopoly\n\nPlay to $3,000 net worth instead of last-player-standing.\n\n## Rules\n- The game ends immediately when a player reaches $3,000 total assets (cash + property at face value)\n- Highest net worth at that moment wins\n- No auctions — properties bought from the bank at full price only",
      json: {
        entries: [
          { name: "Speed Chess Timer", subtitle: "House rule", group: "Chess",
            blocks: [
              { type: "p", t: "Each player has **5 minutes** on a shared clock. When a player's clock expires they lose on time. No increment." },
            ] },
        ],
      },
    },
    exportName: "bgn-classic-custom",
  };

  /* ── Modern board games ── */
  const modernBoard = {
    id: "modern-board",
    name: "Modern Board Game Rules",
    tagline: "Rules references for modern hobby games — Wingspan, Azul, Ticket to Ride, Cascadia and Everdell. Look up the rule and copy it to your table in one tap.",
    kicker: "Setup · Turns · Scoring",
    genre: "Reference · Modern",
    players: "1–5 players",
    accent: { a: "#2fa58c", a2: "#a8e7d8", a3: "#116050" },
    heroImage: HERO_GEN,
    copyright: "Sample rules references for publicly documented modern games. Game names © their respective publishers (Stonemaier, Plan B, Days of Wonder, AEG, Starling). Defer to each game's rulebook.",
    groups: ["Wingspan", "Azul", "Ticket to Ride", "Cascadia", "Everdell"],
    groupIcons: { Wingspan: "🦜", Azul: "🀄", "Ticket to Ride": "🚂", Cascadia: "🌲", Everdell: "🦊" },
    sources: [
      fileSource({
        id: "modern", label: "Modern rulebooks", badge: { cls: "ed-modern", text: "Modern" },
        desc: "Rules for Wingspan, Azul, Ticket to Ride, Cascadia and Everdell — bundled sample.",
        rank: 0, license: "Widely documented rules — sample data",
        files: ["src/data/samples/modern-board/modern.json"],
      }),
    ],
    custom: {
      id: "hb", label: "House rules", chipLabel: "House rules", chipIcon: "🏠",
      desc: "Everything you've imported with 📥 Import",
      badge: { cls: "ed-custom", text: "Custom" },
      license: "Added by you — not official material. Stored in your browser only.",
      defaultOn: true,
    },
    popular: ["End of Round Scoring", "Play a Bird", "Claim a Route", "Habitat", "Tuck", "Bingo", "City Hall"],
    placeholder: "Search a rule, e.g. “tuck” or “claim a route”…",
    detailEmpty: '<div style="font-size:2.6rem;margin-bottom:6px">🃏</div>Pick a result to read it here — setup, turns, scoring and winning, with a copy button that takes the reference along.',
    noResults: (q) => 'Nothing matched <b style="color:var(--bgn-accent2)">' + helpers.esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "tuck", "route", "eggs").',
    favEmpty: 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.',
    gm: {
      dice: [
        { label: "d6", sides: 6 }, { label: "2d6", sides: 6, count: 2 }, { label: "d10", sides: 10 },
        { label: "d20", sides: 20 }, { label: "d100", sides: 100 },
      ],
      lookups: [
        { label: "🦜 Wingspan rule", group: "Wingspan", src: "all" },
        { label: "🀄 Azul rule", group: "Azul", src: "all" },
        { label: "🚂 TtR rule", group: "Ticket to Ride", src: "all" },
        { label: "🔀 Anything", group: "All", src: "all" },
      ],
    },
    sample: {
      text: "House Rule — Wingspan Draft\n\nDeal 10 birds to each player, who keep 6 instead of the usual 5.\n\n## Rules\n- Everyone drafts from a face-down pool of 10 and keeps 6\n- Food and egg costs are unchanged\n- Still draw birds normally during the game",
      json: {
        entries: [
          { name: "Draft the Meadow", subtitle: "House rule", group: "Wingspan",
            blocks: [
              { type: "p", t: "Before the first round, deal **10 bird cards** to each player instead of 8, and each player keeps **6**." },
            ] },
        ],
      },
    },
    exportName: "bgn-modern-custom",
  };

  const games = { dnd, pathfinder, warhammer, "crisis-protocol": crisisProtocol, "classic-board": classicBoard, "modern-board": modernBoard };
  const defaultGame = "dnd";

  window.BGN_REF = {
    games,
    defaultGame,
    helpers,
    resolve: (params) => {
      const g = params && params.get ? params.get("game") : null;
      return (g && games[g]) ? g : defaultGame;
    },
  };
})();
