/* ════════════════════════════════════════════════════════════════
   D&D 5E RULES & STATS — app.js (Boardgame Network)
   - 2024 rules: bundled SRD 5.2 JSON under src/data/ (CC-BY-4.0)
   - 2014 rules: fetched live from https://www.dnd5eapi.co (SRD 5.1)
   - Search both, view a formatted entry, and copy the results +
     its book reference in one click.
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const API = "https://www.dnd5eapi.co";
  const DATA_FILES = ["spells", "monsters", "rules", "feats", "origins", "classes", "equipment", "magic-items"];
  const BOOKS = {
    phb: "Player's Handbook", mm: "Monster Manual", dmg: "Dungeon Master's Guide",
    xge: "Xanathar's Guide to Everything", scag: "Sword Coast Adventurer's Guide",
    srd: "System Reference Document", "srd-5.1": "System Reference Document 5.1",
    "phb-errata": "PHB Errata", "mm-errata": "MM Errata", "dmg-errata": "DMG Errata",
    tce: "Tasha's Cauldron of Everything", ftod: "Fizban's Treasury of Dragons",
    mordkainen: "Mordenkainen's Tome of Foes",
  };
  const GROUP_ICONS = { Spells: "✦", Monsters: "☠", Rules: "⚖", Feats: "♟", Characters: "⚔", Equipment: "🛡", Homebrew: "🏠" };

  const $ = (id) => document.getElementById(id);
  const searchInput = $("searchInput"), clearBtn = $("clearBtn");
  const statusEl = $("statusEl"), suggestCtn = $("suggestCtn");
  const refLayout = $("refLayout"), resultsEl = $("resultsEl"), countEl = $("countEl");
  const detailEl = $("detailEl"), detailEmpty = $("detailEmpty");
  const edChips = [...document.querySelectorAll("[data-ed]")];
  const grpChips = [...document.querySelectorAll("[data-g]")];

  let DB24 = [];
  let state = {
    sources: { "24": true, "14": false, ex: false, hb: true },
    books: new Set(),   // enabled Open5e book slugs (when sources.ex is on)
    group: "All", query: "", selId: null,
  };
  let idx2014 = null;       // [{name, index, url, group, kind}]
  let idx2014Promise = null;
  let homebrewItems = [];   // user-imported house rules / homebrew entries
  let expandedItems = [];   // adapted Open5e entries, each tagged with .book (slug)
  const expandedBooks = new Map(); // slug → {slug, title, state:"idle"|"loading"|"ready"|"error", n}
  const expandedLoading = new Map();
  let docsPromise = null;
  const detailCache = new Map();
  const HB_GROUPS = ["Spells", "Monsters", "Rules", "Feats", "Characters", "Equipment"];
  const HB_KV = () => (window.root && root.kv) || null;

  /* ═══════════ Open5e (expanded) ═══════════ */
  const O5E = "https://api.open5e.com";
  const O5E_CATS = {
    spells: ["Spells", "spell"], monsters: ["Monsters", "monster"], feats: ["Feats", "feat"],
    magicitems: ["Equipment", "magic-item"], weapons: ["Equipment", "weapon"], armor: ["Equipment", "armor"],
    races: ["Characters", "race"], subraces: ["Characters", "subrace"],
    backgrounds: ["Characters", "background"], classes: ["Characters", "class"],
  };

  /* ═══════════ loading 2024 data ═══════════ */
  async function load2024() {
    statusEl.textContent = "Loading the 2024 compendium…";
    const results = await Promise.allSettled(
      DATA_FILES.map((f) => fetch("src/data/" + f + ".json").then((r) => r.json()))
    );
    DB24 = [];
    for (const r of results) if (r.status === "fulfilled" && Array.isArray(r.value)) DB24.push(...r.value);
    DB24.sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ═══════════ loading 2014 index (dnd5eapi) ═══════════ */
  const API_CATS = [
    ["spells", "Spells"], ["monsters", "Monsters"], ["rule-sections", "Rules"], ["conditions", "Rules"],
    ["skills", "Rules"], ["languages", "Rules"], ["alignments", "Rules"], ["ability-scores", "Rules"],
    ["damage-types", "Rules"], ["magic-schools", "Rules"], ["backgrounds", "Characters"],
    ["races", "Characters"], ["classes", "Characters"], ["subclasses", "Characters"],
    ["features", "Characters"], ["traits", "Characters"], ["equipment", "Equipment"],
    ["magic-items", "Equipment"], ["weapons", "Equipment"], ["armor", "Equipment"],
  ];
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
  async function load2014Index() {
    idx2014 = [];
    for (const [kind, group] of API_CATS) {
      try {
        const data = await fetchJson(`${API}/api/${kind}?limit=2000`);
        if (!data || !Array.isArray(data.results)) continue;
        for (const it of data.results) {
          idx2014.push({ name: it.name || "", index: it.index, url: it.url, group, kind });
        }
      } catch (e) { /* category unavailable — skip */ }
    }
    idx2014.sort((a, b) => a.name.localeCompare(b.name));
  }
  function prefetch2014() {
    idx2014Promise = load2014Index().then(() => { idx2014Promise = null; });
    idx2014Promise.catch(() => { idx2014Promise = null; });
  }

  /* ═══════════ homebrew: persistence ═══════════ */
  async function loadHomebrew() {
    try {
      const kv = HB_KV();
      if (!kv) return;
      const saved = await kv.homebrew.get("entries");
      if (Array.isArray(saved)) homebrewItems = saved.filter((e) => e && e.name);
    } catch (e) { console.error("homebrew load failed", e); }
  }
  async function saveHomebrew() {
    const kv = HB_KV();
    if (!kv) return;
    try { await kv.homebrew.set("entries", homebrewItems); } catch (e) { console.error("homebrew save failed", e); }
  }

  /* ═══════════ favorites ═══════════ */
  const favSet = new Set();
  function favIdent(kind, entry) {
    if (kind === "24") return "24::" + entry.id;
    if (kind === "14") return "14::" + entry.url;
    if (kind === "ex") return "ex::" + entry.book + "|" + entry.category + "|" + entry.name;
    return "hb::" + entry.id;
  }
  function isFav(kind, entry) { return favSet.has(favIdent(kind, entry)); }
  async function loadFavs() {
    try {
      const kv = HB_KV();
      if (!kv) return;
      const saved = await kv.favorites.get("entries");
      if (Array.isArray(saved)) { favSet.clear(); for (const id of saved) favSet.add(id); }
    } catch (e) { console.error("favorites load failed", e); }
  }
  async function saveFavs() {
    const kv = HB_KV();
    if (!kv) return;
    try { await kv.favorites.set("entries", [...favSet]); } catch (e) { /* non-fatal */ }
  }
  function toggleFav(kind, entry) {
    const id = favIdent(kind, entry);
    if (favSet.has(id)) favSet.delete(id); else favSet.add(id);
    saveFavs();
    refreshStars();
    if (state.group === "Favorites") runSearch();
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item"; }
  function homebrewText(e) {
    let t = (e.name || "") + " " + (e.subtitle || "") + " " + (e.category || "");
    for (const b of e.blocks || []) {
      if (typeof b.t === "string") t += " " + inlineText(b.t);
      if (b.k) t += " " + inlineText(b.k) + " " + inlineText(b.v);
      if (b.name) t += " " + inlineText(b.name);
      if (Array.isArray(b.items)) for (const it of b.items) t += " " + inlineText(it);
      if (Array.isArray(b.rows)) for (const r of b.rows) for (const c of r) t += " " + inlineText(c);
    }
    return t.toLowerCase();
  }
  function makeHomebrewEntry(src, group) {
    const e = { ...src };
    const validGroup = HB_GROUPS.includes(e.group) ? e.group : (HB_GROUPS.includes(group) ? group : "Rules");
    return {
      id: "hb-" + slug(e.name) + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 999),
      name: String(e.name || "Untitled").trim(),
      category: e.category || "", group: validGroup, edition: "Custom",
      chapter: "Homebrew", subtitle: e.subtitle || "", tags: Array.isArray(e.tags) ? e.tags : [],
      meta: {}, blocks: Array.isArray(e.blocks) ? e.blocks : [{ type: "p", t: "" }],
      refs: [], homebrew: true,
      text: "",
    };
  }
  function finalizeHomebrewEntry(e) { e.text = homebrewText(e); return e; }

  /* ═══════════ homebrew: plain-text parser ═══════════ */
  function parseRuleText(text, group) {
    const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
    const bodyStart = lines.findIndex((l) => l.trim() !== "");
    if (bodyStart === -1) throw new Error("Nothing to import — paste some rule text first.");
    const titleLine = lines[bodyStart].trim().replace(/^[-*•]\s*/, "");
    const dash = titleLine.search(/\s+[—–-]\s+/);
    const name = (dash === -1 ? titleLine : titleLine.slice(0, dash)).trim();
    const subtitle = dash === -1 ? "" : titleLine.slice(dash + 1).replace(/^[—–-]\s*/, "").trim();

    const blocks = [];
    let para = [], list = [], listOrdered = false;
    const flushPara = () => { if (para.length) { blocks.push({ type: "p", t: para.join("\n") }); para = []; } };
    const flushList = () => { if (list.length) { blocks.push({ type: "list", ordered: listOrdered, items: list }); list = []; } };
    for (let i = bodyStart + 1; i < lines.length; i++) {
      const raw = lines[i], line = raw.trim();
      if (line === "") { flushPara(); flushList(); continue; }
      if (/^(#{1,3}\s+|=+$)/.test(line) || /^={3,}\s*$/.test(line)) {
        flushPara(); flushList();
        blocks.push({ type: "sec", t: line.replace(/^#{1,3}\s+/, "").replace(/=+$/, "").trim() });
        continue;
      }
      if (/^>\s?/.test(line)) { flushPara(); flushList(); blocks.push({ type: "quote", t: line.replace(/^>\s?/, "") }); continue; }
      const m = line.match(/^([-*•])\s+(.*)$/) || line.match(/^(\d+)[.)]\s+(.*)$/);
      if (m) {
        flushPara();
        const ordered = !!m[2] && /^\d+[.)]/.test(line) ? true : false;
        if (!list.length) { list = []; listOrdered = ordered; }
        list.push(m[2]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    if (!blocks.length) blocks.push({ type: "p", t: para.join("\n") || titleLine });
    if (!name) throw new Error("Couldn't find a title — put the rule's name on the first line.");

    const entry = makeHomebrewEntry({
      name, subtitle,
      category: group === "Spells" ? "spell" : group === "Monsters" ? "monster" : "rule",
      blocks,
    }, group);
    return finalizeHomebrewEntry(entry);
  }

  /* ═══════════ homebrew: JSON importer ═══════════ */
  function parseJsonImport(text, group) {
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error("That's not valid JSON — " + e.message); }
    const raws = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [data]);
    if (!raws.length) throw new Error("No entries found in that JSON.");
    const out = [];
    for (const raw of raws) {
      if (!raw || typeof raw !== "object") continue;
      const name = raw.name || raw.title || raw.n;
      if (!name) continue;
      const blocks = [];
      for (const b of Array.isArray(raw.blocks) ? raw.blocks : []) {
        if (!b || typeof b !== "object" || !b.type) continue;
        const type = String(b.type).replace("text", "t");
        if (type === "p" || type === "sec" || type === "seclist" || type === "quote" || type === "feat") {
          const t = b.t ?? b.text ?? b.content ?? "";
          if (t === "") continue;
          const blk = { type };
          if (type === "feat") blk.name = b.name || raw.name || "";
          blk.t = String(t);
          blocks.push(blk);
        } else if (type === "kv") {
          const k = b.k ?? b.key ?? "";
          const v = b.v ?? b.value ?? "";
          if (k === "") continue;
          blocks.push({ type: "kv", k: String(k), v: String(v) });
        } else if (type === "kvrow") {
          if (Array.isArray(b.pairs)) blocks.push({ type: "kvrow", pairs: b.pairs });
        } else if (type === "list") {
          if (Array.isArray(b.items)) blocks.push({ type: "list", ordered: !!b.ordered, items: b.items.map((x) => String(x)) });
        } else if (type === "table") {
          if (Array.isArray(b.rows)) blocks.push({ type: "table", headers: Array.isArray(b.headers) ? b.headers : [], rows: b.rows.map((r) => Array.isArray(r) ? r : [String(r)]) });
        } else if (type === "abil") {
          if (b.abilities) blocks.push({ type: "abil", abilities: b.abilities });
        } else if (type === "hr") blocks.push({ type: "hr" });
      }
      if (!blocks.length) blocks.push({ type: "p", t: raw.text || raw.desc || raw.description || "" });
      const e = makeHomebrewEntry({
        name, subtitle: raw.subtitle || "", category: raw.category || "",
        tags: raw.tags, blocks, refs: raw.refs,
      }, raw.group || group);
      out.push(finalizeHomebrewEntry(e));
    }
    if (!out.length) throw new Error("No valid entries in that JSON — each needs at least a \"name\".");
    return out;
  }
  function importEntries(entries) {
    let added = 0;
    for (const e of entries) {
      const dup = homebrewItems.some((x) => x.id === e.id);
      if (dup) continue;
      homebrewItems.push(e);
      added++;
    }
    if (added) { saveHomebrew(); }
    return added;
  }
  function deleteEntry(id) {
    const before = homebrewItems.length;
    homebrewItems = homebrewItems.filter((e) => e.id !== id);
    if (homebrewItems.length !== before) saveHomebrew();
    return homebrewItems.length !== before;
  }

  /* ═══════════ homebrew: export & share ═══════════ */
  function cleanEntry(e) {
    const o = { name: e.name };
    if (e.subtitle) o.subtitle = e.subtitle;
    o.group = e.group || "Rules";
    if (e.category) o.category = e.category;
    if (e.tags && e.tags.length) o.tags = e.tags;
    if (e.refs && e.refs.length) o.refs = e.refs.map((r) => ({ book: r.book, chapter: r.chapter || "", license: r.license || "" }));
    o.blocks = (e.blocks || []).map((b) => ({ ...b }));
    return o;
  }
  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function exportHomebrew() {
    if (!homebrewItems.length) throw new Error("Nothing to export yet — import some house rules first.");
    downloadJSON("bgn-dnd-homebrew.json", { version: 1, entries: homebrewItems.map(cleanEntry) });
  }
  async function publishEntry(entry, btn) {
    const up = (window.root && root.uploadPlugin) || null;
    if (!up) { flashBtn(btn, "⚠ Upload unavailable", 2000); return; }
    try {
      const res = await up(JSON.stringify({ version: 1, entries: [cleanEntry(entry)] }), {});
      if (res.error) {
        flashBtn(btn, res.error === "another_upload_in_progress" ? "⏳ Wait a moment, then retry" : "⚠ Upload failed", 2400);
        return;
      }
      const url = "https://perchance.org/" + (window.generatorName || "") + "?import=" + encodeURIComponent(res.url);
      copyText(btn, url, "✓ Link copied!");
    } catch (e) {
      console.error("publish failed", e);
      flashBtn(btn, "⚠ Upload failed", 2000);
    }
  }
  function flashBtn(btn, msg, ms) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = old; }, ms || 1400);
  }

  /* ═══════════ 5e expanded (Open5e) ═══════════ */
  async function loadO5eDocs() {
    if (docsPromise) return docsPromise;
    docsPromise = (async () => {
      const data = await fetchJson(O5E + "/v1/documents/?format=json", 15000);
      const map = new Map();
      for (const d of (data.results || [])) {
        if (d.slug === "wotc-srd" || d.slug === "o5e" || d.slug === "a5e") continue;
        map.set(d.slug, { slug: d.slug, title: d.title, org: d.organization || "" });
      }
      return map;
    })().catch((e) => { docsPromise = null; throw e; });
    return docsPromise;
  }
  function speedStr(s) {
    if (!s) return "";
    if (typeof s === "string") return s;
    const parts = [];
    const order = [["walk", "walk"], ["fly", "fly"], ["swim", "swim"], ["burrow", "burrow"], ["climb", "climb"]];
    for (const [k, label] of order) {
      const v = s[k];
      if (v) parts.push(label + " " + v + " ft." + (k === "fly" && s.hover ? " (hover)" : ""));
    }
    return parts.join(", ");
  }
  function exKV(blocks, k, v) {
    const s = String(v ?? "").trim();
    if (s) blocks.push({ type: "kv", k, v: s });
  }
  function exParas(s) {
    return String(s || "").split(/\n{2,}/).map((x) => x.replace(/\n/g, " ").trim()).filter(Boolean).map((t) => ({ type: "p", t }));
  }
  function exFeats(list) {
    const out = [];
    for (const a of (list || [])) {
      if (a && a.name && (a.desc || a.text)) out.push({ type: "feat", name: a.name, t: String(a.desc || a.text).trim() });
    }
    return out;
  }
  function adaptSpell(raw) {
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
  }
  const AB_NAMES = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
  const AB_KEYS = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };
  function adaptMonster(raw) {
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
  }
  function adaptMagicItem(raw) {
    const blocks = [];
    exKV(blocks, "Type", raw.type);
    exKV(blocks, "Rarity", raw.rarity);
    if (raw.requires_attunement && String(raw.requires_attunement).toLowerCase() !== "no" && raw.requires_attunement !== false) exKV(blocks, "Attunement", "Required");
    blocks.push(...exParas(raw.desc));
    return { name: raw.name, subtitle: [raw.rarity, raw.type].filter(Boolean).join(" · "), category: "magic-item", blocks };
  }
  function adaptWeapon(raw) {
    const blocks = [];
    exKV(blocks, "Category", raw.category);
    exKV(blocks, "Cost", raw.cost);
    exKV(blocks, "Damage", (raw.damage_dice || "") + (raw.damage_type ? " " + raw.damage_type : ""));
    exKV(blocks, "Range", raw.range);
    exKV(blocks, "Weight", raw.weight ? raw.weight + " lb." : "");
    exKV(blocks, "Properties", Array.isArray(raw.properties) ? raw.properties.join(", ") : raw.properties);
    blocks.push(...exParas(raw.desc));
    return { name: raw.name, subtitle: raw.category, category: "weapon", blocks };
  }
  function adaptArmor(raw) {
    const blocks = [];
    exKV(blocks, "Category", raw.category);
    exKV(blocks, "Armor Class", raw.armor_class);
    exKV(blocks, "Cost", raw.cost);
    exKV(blocks, "Strength", raw.strength_requirement);
    exKV(blocks, "Stealth", raw.stealth_disadvantage === true ? "Disadvantage" : raw.stealth_disadvantage);
    exKV(blocks, "Weight", raw.weight ? raw.weight + " lb." : "");
    blocks.push(...exParas(raw.desc));
    return { name: raw.name, subtitle: raw.category, category: raw.category || "armor", blocks };
  }
  function adaptGeneric(raw, catname) {
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
  }
  function adaptO5e(raw, cat, catname, group) {
    if (!raw || !raw.name) return null;
    let e;
    if (cat === "spells") e = adaptSpell(raw);
    else if (cat === "monsters") e = adaptMonster(raw);
    else if (cat === "magicitems") e = adaptMagicItem(raw);
    else if (cat === "weapons") e = adaptWeapon(raw);
    else if (cat === "armor" || cat === "shields") e = adaptArmor(raw);
    else e = adaptGeneric(raw, catname);
    e.group = group;
    return finalizeExpandedEntry(e);
  }
  function finalizeExpandedEntry(e) {
    e.id = "ex-" + e.name + "-" + e.category;
    e.edition = "Expanded";
    e.tags = [];
    e.meta = {};
    e.homebrew = false;
    e.text = homebrewText(e);
    return e;
  }
  async function ensureExpandedBook(slug) {
    if (expandedLoading.has(slug)) return expandedLoading.get(slug);
    const meta = expandedBooks.get(slug);
    if (!meta) return 0;
    meta.state = "loading";
    updateBookStates();
    const p = (async () => {
      const kv = HB_KV();
      try {
        if (kv) {
          const cached = await kv.expanded.get(slug);
          if (cached && cached.v === 2 && Array.isArray(cached.items) && cached.items.length) {
            for (const e of cached.items) { e.book = slug; e.refs = e.refs || [{ book: meta.title }]; expandedItems.push(e); }
            meta.state = "ready"; meta.n = cached.items.length;
            updateBookStates();
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
        } catch (e) { /* that category is unavailable — skip it, don't fail the book */ }
      }
      try { if (kv && found.length) await kv.expanded.set(slug, { v: 2, items: found }); } catch (e) { /* non-fatal */ }
      for (const e of found) expandedItems.push(e);
      meta.state = "ready"; meta.n = found.length;
      updateBookStates();
      return found.length;
    })();
    expandedLoading.set(slug, p);
    p.finally(() => expandedLoading.delete(slug)).catch(() => { meta.state = "error"; updateBookStates(); });
    return p;
  }
  function matchExpanded(q, group) {
    const out = [];
    for (const e of expandedItems) {
      if (state.books.size && !state.books.has(e.book)) continue;
      if (group === "Favorites") { if (!isFav("ex", e)) continue; }
      else if (group !== "All" && e.group !== group) continue;
      if (q && e.text.indexOf(q) === -1) continue;
      out.push(e);
    }
    if (q) {
      const score = (e) =>
        e.name.toLowerCase().startsWith(q) ? 0 :
        e.name.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
      out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    }
    return out.slice(0, 60);
  }

  /* ═══════════ search ═══════════ */
  function match2024(q, group) {
    const out = [];
    for (const e of DB24) {
      if (group === "Favorites") { if (!isFav("24", e)) continue; }
      else if (group !== "All" && e.group !== group) continue;
      if (q && e.text.indexOf(q) === -1) continue;
      out.push(e);
    }
    if (q) {
      const score = (e) =>
        e.name.toLowerCase().startsWith(q) ? 0 :
        e.name.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
      out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    }
    return out.slice(0, 60);
  }
  function match2014(q, group) {
    if (!idx2014) return [];
    const out = [];
    for (const it of idx2014) {
      if (group === "Favorites") { if (!isFav("14", it)) continue; }
      else if (group !== "All" && it.group !== group) continue;
      if (q && it.name.toLowerCase().indexOf(q) === -1) continue;
      out.push(it);
    }
    if (q) {
      const score = (e) =>
        e.name.toLowerCase().startsWith(q) ? 0 :
        e.name.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
      out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    }
    return out.slice(0, 60);
  }
  function matchHomebrew(q, group) {
    const out = [];
    for (const e of homebrewItems) {
      if (group === "Favorites") { if (!isFav("hb", e)) continue; }
      else if (group !== "All" && group !== "Homebrew" && e.group !== group) continue;
      if (q && e.text.indexOf(q) === -1) continue;
      out.push(e);
    }
    if (q) {
      const score = (e) =>
        e.name.toLowerCase().startsWith(q) ? 0 :
        e.name.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
      out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    }
    return out.slice(0, 60);
  }
  async function runSearch() {
    const q = state.query.trim().toLowerCase();
    const group = state.group;
    if (!q && group !== "Favorites") {
      suggestCtn.hidden = false;
      refLayout.hidden = true;
      fsOpenBtn.hidden = true;
      bannerEl.hidden = true;
      turnEl.textContent = "Ready to look up";
      return;
    }
    suggestCtn.hidden = true;
    refLayout.hidden = false;

    let need2014 = state.sources["14"];
    if (need2014 && !idx2014 && idx2014Promise) {
      statusEl.textContent = "Indexing the 2014 rules (first search may be a touch slower)…";
      await idx2014Promise;
      statusEl.textContent = "";
    }
    if (need2014 && !idx2014) { await load2014Index().catch(() => {}); }

    const items = [];
    if (state.sources["24"]) for (const e of match2024(q, group)) items.push({ kind: "24", entry: e, name: e.name });
    if (need2014) for (const it of match2014(q, group)) items.push({ kind: "14", entry: it, name: it.name });
    if (state.sources.hb) for (const e of matchHomebrew(q, group)) items.push({ kind: "hb", entry: e, name: e.name });
    if (state.sources.ex && state.books.size) for (const e of matchExpanded(q, group)) items.push({ kind: "ex", entry: e, name: e.name });

    const byName = new Map();
    for (const it of items) {
      const k = (it.kind === "hb" ? "hb::" : it.kind === "ex" ? "ex::" : "") + it.name.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(it);
    }
    const merged = [...byName.values()].sort((a, b) => {
      const an = a[0].name.toLowerCase(), bn = b[0].name.toLowerCase();
      const sa = an.startsWith(q) ? 0 : an.indexOf(q) !== -1 ? 1 : 2;
      const sb = bn.startsWith(q) ? 0 : bn.indexOf(q) !== -1 ? 1 : 2;
      return sa - sb || an.localeCompare(bn);
    }).map((g) => ({ key: (g[0].kind === "hb" || g[0].kind === "ex" ? g[0].kind + "::" : "") + g[0].name, name: g[0].name, items: g })).slice(0, 60);

    renderResults(merged);
    if (merged.length) select(merged[0]);
    else {
      detailEl.hidden = true; detailEmpty.hidden = false;
      if (group === "Favorites") {
        detailEmpty.innerHTML = 'No favorites yet — tap the <b style="color:#f6e6a4">★</b> on any result (or in a detail panel) to pin it here.';
      } else {
        detailEmpty.innerHTML = 'Nothing matched <b style="color:var(--bgn-accent2)">' + esc(q) + '</b>. Try a shorter word, or check the spelling (e.g. "grapple", "rage", "shield").';
      }
    }
    refreshRoomCode();
    if (merged.length) {
      turnEl.textContent = merged.length + " result" + (merged.length === 1 ? "" : "s") + " — pick one to read.";
    } else {
      fsOpenBtn.hidden = true;
      turnEl.textContent = "No results for \u201C" + q + "\u201D.";
      setBanner("Nothing matched \u201C" + q + "\u201D.");
    }
  }

  function renderResults(merged) {
    countEl.textContent = merged.length + " result" + (merged.length === 1 ? "" : "s");
    resultsEl.innerHTML = "";
    for (const g of merged) {
      const row = document.createElement("div");
      row.className = "result-row";
      row.dataset.name = g.key;
      const kinds = g.items.map((i) => i.kind);
      const first = g.items[0];
      const entry = first.entry;
      const primary = g.items.find((i) => i.kind === "24") || g.items[0];
      row.dataset.fav = favIdent(primary.kind, primary.entry);
      const sub = entry.subtitle || "";
      const grp = entry.group || "Rules";
      const isHb = kinds.includes("hb");
      const isEx = kinds.includes("ex");
      const badge = isHb ? '<span class="ed-badge ed-custom" title="Your house rule / homebrew">Custom</span>'
        : isEx ? '<span class="ed-badge ed-expanded" title="3rd-party / community OGL content">Expanded</span>'
        : kinds.includes("24") && kinds.includes("14") ? '<span class="ed-badge ed-2014" title="Available in both rule sets">2014+2024</span>'
        : kinds[0] === "24" ? '<span class="ed-badge ed-2024">2024</span>' : '<span class="ed-badge ed-2014">2014</span>';
      const main = document.createElement("button");
      main.type = "button";
      main.className = "row-main";
      main.innerHTML =
        '<div class="r-top"><span class="r-name"></span>' + badge + '</div>' +
        (sub ? '<div class="r-sub"></div>' : '') +
        '<div class="r-tags"><span class="r-cat">' + (isHb ? GROUP_ICONS.Homebrew + " Homebrew · " : "") + GROUP_ICONS[grp] + " " + grp + "</span>" + (entry.category ? '<span class="r-cat">' + entry.category + "</span>" : "") + (isEx && entry.refs && entry.refs[0] ? '<span class="r-cat">' + esc(entry.refs[0].book) + "</span>" : "") + "</div>";
      main.querySelector(".r-name").textContent = g.name;
      if (sub) main.querySelector(".r-sub").textContent = sub;
      main.addEventListener("click", () => select(g));
      const star = document.createElement("button");
      star.type = "button";
      star.className = "star-btn";
      star.title = isFav(primary.kind, primary.entry) ? "Remove from favorites" : "Save to favorites";
      star.textContent = "☆";
      star.addEventListener("click", (e) => { e.stopPropagation(); toggleFav(primary.kind, primary.entry); });
      row.appendChild(main);
      row.appendChild(star);
      resultsEl.appendChild(row);
    }
    refreshStars();
  }
  function entryKindOf(entry) {
    if (entry.homebrew) return "hb";
    if (entry.edition === "2024") return "24";
    if (entry.edition === "Expanded") return "ex";
    return "14";
  }
  function refreshStars() {
    for (const row of resultsEl.children) {
      const star = row.querySelector(".star-btn");
      if (!star) continue;
      const on = favSet.has(row.dataset.fav);
      star.textContent = on ? "★" : "☆";
      star.classList.toggle("on", on);
      star.title = on ? "Remove from favorites" : "Save to favorites";
    }
    const favBtn = document.getElementById("favBtn");
    if (favBtn && currentFavIdent) {
      const on = favSet.has(currentFavIdent);
      favBtn.textContent = on ? "★ Saved" : "☆ Save";
      favBtn.classList.toggle("on", on);
    }
  }
  let currentFavIdent = null;

  /* ═══════════ selection + detail ═══════════ */
  let lastSelectedKey = null;
  function select(group) {
    state.selId = group.key;
    for (const el of resultsEl.children) el.classList.toggle("sel", el.dataset.name === group.key);
    if (group.key !== lastSelectedKey) {
      lastSelectedKey = group.key;
      addLog("you", "Opened \u201C" + group.name + "\u201D.");
    }
    renderDetail(group);
  }
  function entryFor(group, kind) {
    return group.items.find((i) => i.kind === kind) || null;
  }
  async function renderDetail(group) {
    detailEl.hidden = false;
    detailEmpty.hidden = true;
    const sel = entryFor(group, "24") || group.items[0];
    if (sel.kind !== "14") { drawEntry(group, sel.entry, sel.kind); return; }
    detailEl.innerHTML = '<div class="detail-loading"><div class="spin"></div><div>Fetching ' + esc(group.name) + " from the 2014 compendium…</div></div>";
    try {
      const entry = await fetch2014Detail(sel.entry);
      drawEntry(group, entry, "14");
    } catch (e) {
      console.error("2014 detail fetch failed", sel.entry, e);
      detailEl.innerHTML = '<div class="detail-loading muted">Couldn\'t load <b>' + esc(group.name) + "</b> from dnd5eapi.co. Check your connection and try again.</div>";
    }
  }
  async function showEditionTab(group, kind) {
    const item = entryFor(group, kind);
    if (!item) return;
    if (item.kind === "24") { drawEntry(group, item.entry, "24"); return; }
    detailEl.innerHTML = '<div class="detail-loading"><div class="spin"></div><div>Fetching ' + esc(group.name) + " from the 2014 compendium…</div></div>";
    try {
      drawEntry(group, await fetch2014Detail(item.entry), "14");
    } catch (e) {
      detailEl.innerHTML = '<div class="detail-loading muted">Couldn\'t load <b>' + esc(group.name) + "</b> from dnd5eapi.co. Check your connection and try again.</div>";
    }
  }
  async function fetch2014Detail(idx) {
    if (detailCache.has(idx.url)) return detailCache.get(idx.url);
    const raw = await fetchJson(API + idx.url, 15000);
    const entry = adapt2014(raw, idx);
    detailCache.set(idx.url, entry);
    return entry;
  }

  /* ═══════════ 2014 → entry model ═══════════ */
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
      const rows = [];
      const acStr = (a) => {
        if (a == null) return "—";
        if (Array.isArray(a)) return a.map((x) => x.value + (x.type ? " (" + x.type + ")" : "")).join(", ");
        if (typeof a === "object") return a.value + (a.type ? " (" + a.type + ")" : "");
        return String(a);
      };
      rows.push([{ k: "AC", v: acStr(raw.armor_class) }]);
      rows.push([{ k: "HP", v: raw.hit_points + " (" + raw.hit_dice + ")" }]);
      rows.push([{ k: "Speed", v: speedStr(speed) || "—" }]);
      rows.forEach((p) => entry.blocks.push({ type: "kvrow", pairs: p }));
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
    /* generic: conditions, rules, skills, languages, backgrounds, races, classes, equipment, magic-items, traits, features, subclasses… */
    addP(paras(raw.desc));
    if (cat === "condition") {
      for (const s of (raw.special_conditions || [])) addP(paras(s.desc));
    }
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
    if (cat === "background") {
      if (raw.starting_proficiencies && raw.starting_proficiencies.length) addKv("Starting Proficiencies", raw.starting_proficiencies.map((p) => p.name).join(", "));
    }
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
    if (cat === "feature" || cat === "trait" || cat === "subclass") {
      entry.subtitle = raw.level ? "Level " + raw.level : "";
    }
    if (!entry.blocks.length) addP(paras(raw.desc));
    return entry;
  }

  /* ═══════════ rendering ═══════════ */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escapeHtml(s) {
    return esc(s);
  }
  function cleanText(s, max) {
    return String(s || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").slice(0, max || 160);
  }
  function inlineText(t) {
    return String(t)
      .replace(/\*\*/g, "").replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/−/g, "-")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function inlineHTML(t) {
    const text = String(t);
    const toks = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`|\[[^\]]*\]\([^)]*\))/g);
    let out = "";
    for (let tok of toks) {
      if (!tok) continue;
      if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) out += "<b>" + esc(tok.slice(2, -2)) + "</b>";
      else if (tok.startsWith("_") && tok.endsWith("_") && tok.length > 2) out += "<i>" + esc(tok.slice(1, -1)) + "</i>";
      else if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) out += "<code>" + esc(tok.slice(1, -1)) + "</code>";
      else {
        const link = tok.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
        if (link) out += '<a href="' + esc(link[2]) + '" target="_blank" rel="noopener">' + esc(link[1]) + "</a>";
        else out += esc(tok);
      }
    }
    return out;
  }
  function renderBlocks(container, blocks) {
    for (const b of blocks) {
      const wrap = document.createElement("div");
      wrap.className = "block";
      switch (b.type) {
        case "kv":
          wrap.className = "block block-kv";
          wrap.innerHTML = "<b>" + esc(b.k) + "</b><span>" + inlineHTML(b.v) + "</span>";
          break;
        case "kvrow": {
          wrap.className = "block kvrow";
          for (const p of b.pairs) {
            const s = document.createElement("span");
            s.className = "kv";
            s.innerHTML = "<b>" + esc(p.k) + "</b> " + inlineHTML(p.v);
            wrap.appendChild(s);
          }
          break;
        }
        case "p": {
          wrap.className = "block block-p";
          const leadM = b.t.match(/^_([^_]{2,70}?)\._ (.*)$/s);
          if (leadM) wrap.innerHTML = '<em class="lead">' + esc(inlineText(leadM[1])) + ".</em> " + inlineHTML(leadM[2]);
          else if (b.t.match(/^_([^_]+)_$/)) wrap.innerHTML = "<i>" + inlineHTML(b.t) + "</i>";
          else wrap.innerHTML = inlineHTML(b.t);
          break;
        }
        case "feat":
          wrap.className = "block block-feat";
          wrap.innerHTML = "<b><i>" + esc(inlineText(b.name)) + ".</i></b> " + inlineHTML(b.t);
          break;
        case "sec":
          wrap.className = "block block-sec";
          wrap.textContent = inlineText(b.t);
          break;
        case "seclist":
          wrap.className = "block block-sec";
          wrap.style.marginTop = "14px";
          wrap.textContent = inlineText(b.t);
          break;
        case "hr":
          wrap.className = "block";
          wrap.innerHTML = '<hr style="border:none;border-top:1px solid var(--bgn-line)">';
          break;
        case "list": {
          wrap.className = "block block-list";
          const ul = document.createElement(b.ordered ? "ol" : "ul");
          for (const it of b.items) {
            const li = document.createElement("li");
            li.innerHTML = inlineHTML(it);
            ul.appendChild(li);
          }
          wrap.appendChild(ul);
          break;
        }
        case "quote":
          wrap.className = "block block-quote";
          wrap.innerHTML = inlineHTML(b.t);
          break;
        case "table":
          wrap.className = "block block-table";
          const table = document.createElement("table");
          if (b.headers && b.headers.length) {
            const thead = document.createElement("thead");
            const tr = document.createElement("tr");
            for (const h of b.headers) { const th = document.createElement("th"); th.innerHTML = inlineHTML(h); tr.appendChild(th); }
            thead.appendChild(tr);
            table.appendChild(thead);
          }
          const tbody = document.createElement("tbody");
          for (const r of b.rows) {
            if (r.length === 1) {
              const tr = document.createElement("tr");
              const td = document.createElement("td");
              td.colSpan = Math.max(b.headers ? b.headers.length : 4, 1);
              td.className = "muted";
              td.style.fontStyle = "italic";
              td.innerHTML = inlineHTML(r[0]);
              tr.appendChild(td);
              tbody.appendChild(tr);
              continue;
            }
            const tr = document.createElement("tr");
            for (const c of r) { const td = document.createElement("td"); td.innerHTML = inlineHTML(c); tr.appendChild(td); }
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          wrap.appendChild(table);
          break;
        case "abil": {
          wrap.className = "block abil-grid";
          const order = ["str", "dex", "con", "int", "wis", "cha"];
          const names = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
          for (const key of order) {
            const a = b.abilities[key];
            if (!a) continue;
            const d = document.createElement("div");
            d.className = "abil";
            d.innerHTML = '<div class="ab">' + names[key] + "</div>" +
              '<div class="sc">' + esc(String(a.score)) + "</div>" +
              '<div class="md">' + esc(String(a.mod)) + "</div>" +
              (a.save ? '<div class="sv">save ' + esc(String(a.save)) + "</div>" : "");
            wrap.appendChild(d);
          }
          break;
        }
        default:
          break;
      }
      if (wrap.childNodes.length || wrap.textContent) container.appendChild(wrap);
    }
  }

  /* ═══════════ plain-text rendering (for copy) ═══════════ */
  function blocksToPlain(blocks) {
    const lines = [];
    for (const b of blocks) {
      switch (b.type) {
        case "kv": lines.push(inlineText(b.k) + ": " + inlineText(b.v)); break;
        case "kvrow": lines.push(b.pairs.map((p) => inlineText(p.k) + " " + inlineText(p.v)).join("  ·  ")); break;
        case "p": lines.push(inlineText(b.t)); break;
        case "feat": lines.push(inlineText(b.name) + ". " + inlineText(b.t)); break;
        case "sec": case "seclist": lines.push(""); lines.push("— " + inlineText(b.t).toUpperCase() + " —"); break;
        case "list": lines.push(b.items.map((it) => (b.ordered ? "1. " : "• ") + inlineText(it)).join("\n")); break;
        case "quote": lines.push("> " + inlineText(b.t)); break;
        case "hr": break;
        case "table": {
          if (b.headers && b.headers.length) lines.push(b.headers.map((h) => inlineText(h)).join("\t"));
          for (const r of b.rows) lines.push(r.map((c) => inlineText(c)).join("\t"));
          break;
        }
        case "abil": {
          const names = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
          const order = ["str", "dex", "con", "int", "wis", "cha"];
          lines.push(order.filter((k) => b.abilities[k]).map((k) => names[k] + " " + b.abilities[k].score + " (" + b.abilities[k].mod + (b.abilities[k].save ? ", save " + b.abilities[k].save : "") + ")").join("  "));
          break;
        }
        default: break;
      }
    }
    return lines.join("\n").replace(/−/g, "-");
  }

  /* ═══════════ detail drawing + copy ═══════════ */
  function drawEntry(group, entry, kind) {
    kind = kind || entryKindOf(entry);
    currentFavIdent = favIdent(kind, entry);
    detailEl.innerHTML = "";
    const head = document.createElement("div");
    head.className = "detail-head";

    const titleRow = document.createElement("div");
    titleRow.className = "detail-title";
    const title = document.createElement("div");
    const h = document.createElement("div");
    h.className = "detail-name";
    h.textContent = group.name;
    title.appendChild(h);
    if (entry.subtitle) {
      const s = document.createElement("div");
      s.className = "detail-sub";
      s.textContent = entry.subtitle;
      title.appendChild(s);
    }
    titleRow.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "detail-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn btn-gold btn-sm";
    copyBtn.textContent = "📋 Copy results + references";
    const refBtn = document.createElement("button");
    refBtn.className = "btn btn-ghost btn-sm";
    refBtn.textContent = "🔗 Reference only";
    const favBtn = document.createElement("button");
    favBtn.className = "btn btn-ghost btn-sm star-detail";
    favBtn.id = "favBtn";
    favBtn.title = "Save to favorites";
    actions.appendChild(copyBtn);
    actions.appendChild(refBtn);
    actions.appendChild(favBtn);
    favBtn.addEventListener("click", () => toggleFav(kind, entry));
    if (entry.homebrew) {
      const shareBtn = document.createElement("button");
      shareBtn.className = "btn btn-sm";
      shareBtn.id = "shareHbBtn";
      shareBtn.style.borderColor = "rgba(212,175,55,.4)";
      shareBtn.style.color = "var(--bgn-accent2)";
      shareBtn.textContent = "🌐 Share";
      shareBtn.title = "Upload this house rule and copy a link anyone can import";
      actions.appendChild(shareBtn);
      shareBtn.addEventListener("click", () => publishEntry(entry, shareBtn));
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm";
      delBtn.id = "deleteHbBtn";
      delBtn.style.borderColor = "rgba(220,90,90,.5)";
      delBtn.style.color = "#e08a8a";
      delBtn.textContent = "🗑 Delete";
      actions.appendChild(delBtn);
      delBtn.addEventListener("click", () => {
        if (!confirm("Delete \"" + group.name + "\"? This only removes it from your browser.")) return;
        deleteEntry(entry.id);
        runSearch();
      });
    }
    titleRow.appendChild(actions);
    head.appendChild(titleRow);

    const tags = document.createElement("div");
    tags.className = "detail-tags";
    const edBadge = document.createElement("span");
    edBadge.className = "ed-badge " + (entry.homebrew ? "ed-custom" : entry.edition === "2024" ? "ed-2024" : entry.edition === "Expanded" ? "ed-expanded" : "ed-2014");
    edBadge.textContent = entry.homebrew ? "Custom" : (entry.edition === "2024" ? "2024" : entry.edition === "Expanded" ? "Expanded" : "2014");
    tags.appendChild(edBadge);
    if (group.items && group.items.length > 1) {
      const tabCtn = document.createElement("span");
      tabCtn.className = "ed-tabs";
      for (const kind of ["24", "14"]) {
        if (!entryFor(group, kind)) continue;
        const b = document.createElement("button");
        b.className = "chip edtab" + (kind === entry.edition.slice(-2) ? " on" : "");
        b.textContent = kind === "24" ? "2024 version" : "2014 version";
        b.addEventListener("click", () => showEditionTab(group, kind));
        tabCtn.appendChild(b);
      }
      tags.appendChild(tabCtn);
    }
    if (entry.group) {
      const t1 = document.createElement("span");
      t1.className = "r-cat";
      t1.textContent = GROUP_ICONS[entry.group] + " " + entry.group;
      tags.appendChild(t1);
    }
    for (const t of (entry.tags || []).slice(0, 6)) {
      const s = document.createElement("span");
      s.className = "r-cat";
      s.textContent = t;
      tags.appendChild(s);
    }
    head.appendChild(tags);
    detailEl.appendChild(head);

    const body = document.createElement("div");
    body.className = "blocks";
    renderBlocks(body, entry.blocks || []);
    detailEl.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "ref-foot";
    const ft = document.createElement("div");
    ft.className = "ref-title";
    ft.textContent = "Reference";
    foot.appendChild(ft);
    const refStr = (entry.homebrew ? "House rule · Homebrew"
      : (entry.refs && entry.refs.length ? entry.refs.map((r) => r.book).join(" · ") : "")) || "SRD";
    const fl = document.createElement("div");
    fl.className = "ref-line";
    fl.textContent = group.name + " — " + refStr;
    foot.appendChild(fl);
    if (entry.homebrew) {
      const lic = document.createElement("div");
      lic.className = "ref-license";
      lic.textContent = "Added by you — not official WotC material. Stored in your browser only.";
      foot.appendChild(lic);
    } else if (entry.edition === "Expanded") {
      const lic = document.createElement("div");
      lic.className = "ref-license";
      lic.textContent = "Open5e · OGL/ORC-licensed 3rd-party content © its publishers · open5e.com/legal";
      foot.appendChild(lic);
    } else if (entry.edition === "2024") {
      const lic = document.createElement("div");
      lic.className = "ref-license";
      lic.textContent = "Free SRD content © Wizards of the Coast · CC-BY-4.0";
      foot.appendChild(lic);
    } else {
      const lic = document.createElement("div");
      lic.className = "ref-license";
      lic.textContent = "Free SRD 5.1 content © Wizards of the Coast · OGL 1.0a / CC-BY-4.0 · via dnd5eapi.co";
      foot.appendChild(lic);
    }
    detailEl.appendChild(foot);

    const fullRef = group.name + " — " + refStr;

    copyBtn.addEventListener("click", () => {
      const text = group.name.toUpperCase() + (entry.subtitle ? "\n" + inlineText(entry.subtitle) : "") + "\n\n" + blocksToPlain(entry.blocks || []) + "\n\n— Reference: " + fullRef;
      copyText(copyBtn, text, "✓ Copied!");
      addLog("you", "Copied \u201C" + group.name + "\u201D + references.");
      flashBanner("Copied \u201C" + group.name + "\u201D + references.");
    });
    refBtn.addEventListener("click", () => {
      copyText(refBtn, "Reference: " + fullRef, "✓ Copied!");
      addLog("you", "Copied the reference for \u201C" + group.name + "\u201D.");
    });

    fsOpenBtn.hidden = false;
    setBanner("Reading " + group.name + (entry.subtitle ? " — " + inlineText(entry.subtitle) : ""));
    turnEl.textContent = "Reading: " + group.name;
    refreshRoomCode();
    window.bgnFullscreen.register({ canvas: body, tile: actions, meeple: foot });
  }

  function copyText(btn, text, doneMsg) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = doneMsg;
      setTimeout(() => { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { alert("Couldn't copy — select the text above and copy manually."); }
  }

  /* ═══════════ wiring ═══════════ */
  let debounce = null;
  searchInput.addEventListener("input", () => {
    clearBtn.hidden = !searchInput.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.query = searchInput.value; runSearch(); }, 130);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = resultsEl.querySelector(".result-row");
      if (first) first.click();
    }
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.hidden = true;
    state.query = "";
    runSearch();
    searchInput.focus();
  });
  $("linkBtn").addEventListener("click", () => {
    copyText($("linkBtn"), shareUrl(), "✓ Link copied!");
  });
  function shareUrl() {
    const p = new URLSearchParams();
    const q = state.query.trim();
    if (q) p.set("q", q);
    const both = state.sources["24"] && state.sources["14"];
    const ed = both ? "both" : state.sources["24"] ? "2024" : state.sources["14"] ? "2014" : "";
    if (ed) p.set("ed", ed);
    const qs = p.toString();
    return "https://perchance.org/" + (window.generatorName || "") + (qs ? "?" + qs : "");
  }
  function syncEdChips() {
    edChips.forEach((c) => {
      const on = c.dataset.ed === "2024" ? (state.sources["24"] && !state.sources["14"])
        : c.dataset.ed === "2014" ? (!state.sources["24"] && state.sources["14"])
        : (state.sources["24"] && state.sources["14"]);
      c.classList.toggle("on", on);
    });
    refreshRoomCode();
  }
  async function savePrefs() {
    const kv = HB_KV();
    if (!kv) return;
    try { await kv.prefs.set("sources", { s: state.sources, b: [...state.books] }); } catch (e) { /* non-fatal */ }
  }
  async function loadPrefs() {
    const kv = HB_KV();
    if (!kv) return;
    try {
      const p = await kv.prefs.get("sources");
      if (p && p.s) {
        state.sources = { "24": true, "14": false, ex: false, hb: true, ...p.s };
        state.books = new Set(Array.isArray(p.b) ? p.b : []);
      }
    } catch (e) { /* defaults */ }
  }
  edChips.forEach((c) => c.addEventListener("click", () => {
    const v = c.dataset.ed;
    state.sources["24"] = v === "2024" || v === "both";
    state.sources["14"] = v === "2014" || v === "both";
    syncEdChips();
    savePrefs();
    if (state.query.trim()) runSearch();
    else if (state.sources["14"] && !idx2014) statusEl.textContent = "Indexing the 2014 rules…";
  }));
  grpChips.forEach((c) => c.addEventListener("click", () => {
    grpChips.forEach((x) => x.classList.remove("on"));
    c.classList.add("on");
    state.group = c.dataset.g;
    if (state.query.trim()) runSearch();
  }));
  suggestCtn.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-s]");
    if (!btn) return;
    searchInput.value = btn.dataset.s;
    clearBtn.hidden = false;
    state.query = btn.dataset.s;
    runSearch();
    searchInput.focus();
  });

  /* ═══════════ sources modal ═══════════ */
  const sourcesModal = $("sourcesModal"), sourcesStatus = $("sourcesStatus");
  const exBooksEl = $("exBooks"), exCount = $("exCount");
  const setSourcesStatus = (msg, ok) => { sourcesStatus.textContent = msg; sourcesStatus.style.color = ok ? "var(--bgn-accent2)" : "#e08a8a"; };
  function syncSourcesUI() {
    for (const c of sourcesModal.querySelectorAll("input[type=checkbox][data-src]")) c.checked = !!state.sources[c.dataset.src];
    exBooksEl.style.opacity = state.sources.ex ? "1" : ".45";
  }
  function updateBookStates() {
    for (const el of exBooksEl.querySelectorAll(".src-book")) {
      const slug = el.querySelector("input").dataset.book;
      const meta = expandedBooks.get(slug);
      const st = el.querySelector(".b-state");
      if (!meta) st.textContent = "";
      else if (meta.state === "loading") st.textContent = "… loading";
      else if (meta.state === "ready") st.textContent = "· " + meta.n.toLocaleString() + " entries ✓";
      else if (meta.state === "error") st.textContent = "⚠ failed";
      else st.textContent = "";
    }
    if (exCount) {
      const total = [...expandedBooks.values()].reduce((a, m) => a + m.n, 0);
      exCount.textContent = state.sources.ex ? "· " + total.toLocaleString() + " loaded" : "· " + total.toLocaleString() + " loaded";
    }
    const loading = [...expandedLoading.keys()].length;
    const statusMsg = [...expandedBooks.values()].filter((m) => m.state === "loading").map((m) => m.title).join(", ");
    if (loading) setSourcesStatus("Loading " + statusMsg + "… (first time only — then it's cached in your browser)", true);
    else setSourcesStatus("", true);
  }
  function renderBookList(docs) {
    exBooksEl.innerHTML = "";
    for (const [slug, meta] of docs) {
      if (!expandedBooks.has(slug)) expandedBooks.set(slug, { slug, title: meta.title, org: meta.org, state: "idle", n: 0 });
      const label = document.createElement("label");
      label.className = "src-book";
      label.innerHTML = '<input type="checkbox" data-book="' + slug + '"><span>' + esc(meta.title) + (meta.org ? ' <em class="muted">(' + esc(meta.org) + ")</em>" : "") + '</span><span class="b-state"></span>';
      label.querySelector("input").checked = state.books.has(slug);
      label.querySelector("input").addEventListener("change", () => {
        const on = label.querySelector("input").checked;
        if (on) { state.books.add(slug); ensureExpandedBook(slug); }
        else state.books.delete(slug);
        savePrefs();
        updateBookStates();
        if (state.query.trim()) runSearch();
      });
      exBooksEl.appendChild(label);
    }
    updateBookStates();
  }
  function openSources() {
    sourcesModal.hidden = false;
    sourcesStatus.textContent = "";
    syncSourcesUI();
    loadO5eDocs().then(renderBookList).catch(() => setSourcesStatus("Couldn't load the expanded book list — check your connection.", false));
  }
  $("sourcesBtn").addEventListener("click", openSources);
  $("sourcesClose").addEventListener("click", () => { sourcesModal.hidden = true; });
  sourcesModal.addEventListener("click", (e) => { if (e.target === sourcesModal) sourcesModal.hidden = true; });
  sourcesModal.querySelectorAll("input[type=checkbox][data-src]").forEach((c) => c.addEventListener("change", () => {
    state.sources[c.dataset.src] = c.checked;
    syncEdChips();
    syncSourcesUI();
    savePrefs();
    if (c.dataset.src === "ex" && state.sources.ex) loadO5eDocs().then(renderBookList).catch(() => {});
    if (state.query.trim()) runSearch();
    else updateBookStates();
  }));
  $("exAll").addEventListener("click", () => {
    for (const slug of expandedBooks.keys()) state.books.add(slug);
    savePrefs();
    renderBookList(expandedBooks);
    for (const slug of [...expandedBooks.keys()]) ensureExpandedBook(slug);
    if (state.query.trim()) runSearch();
  });
  $("exNone").addEventListener("click", () => {
    state.books.clear();
    savePrefs();
    renderBookList(expandedBooks);
    if (state.query.trim()) runSearch();
  });
  $("sourcesReset").addEventListener("click", () => {
    state.sources = { "24": true, "14": false, ex: false, hb: true };
    state.books.clear();
    savePrefs();
    syncEdChips();
    syncSourcesUI();
    renderBookList(expandedBooks);
    setSourcesStatus("Reset to defaults.", true);
    if (state.query.trim()) runSearch();
  });
  $("sourcesDone").addEventListener("click", () => { sourcesModal.hidden = true; if (state.query.trim()) runSearch(); });

  /* ═══════════ import modal ═══════════ */
  const importModal = $("importModal"), importStatus = $("importStatus");
  const importText = $("importText"), importJson = $("importJson");
  const importRun = $("importRun"), importGroup = $("importGroup");
  let importMode = "text";
  const setStatus = (msg, ok) => { importStatus.textContent = msg; importStatus.style.color = ok ? "var(--bgn-accent2)" : "#e08a8a"; };
  const syncTextareas = () => { importText.hidden = importMode !== "text"; importJson.hidden = importMode !== "json"; };
  $("importBtn").addEventListener("click", () => { importModal.hidden = false; importStatus.textContent = ""; syncTextareas(); setTimeout(() => (importMode === "text" ? importText : importJson).focus(), 50); });
  $("modalClose").addEventListener("click", () => { importModal.hidden = true; });
  importModal.addEventListener("click", (e) => { if (e.target === importModal) importModal.hidden = true; });
  document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    importMode = b.dataset.mode;
    syncTextareas();
  }));
  $("importSample").addEventListener("click", () => {
    if (importMode === "json") {
      importJson.value = JSON.stringify({
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
      }, null, 2);
    } else {
      importText.value =
        "Long Rest House Rule — it takes a full day\n" +
        "\n" +
        "In this campaign a long rest takes 24 hours of downtime, and can only be taken in a safe haven (a town, camp, or ally's stronghold).\n" +
        "\n" +
        "## What counts as a safe haven\n" +
        "- Any settlement with a friendly ruler or inn\n" +
        "- A camp you've fortified for at least 4 hours\n" +
        "\n" +
        "Wilderness travel never counts, no matter how comfortable.";
    }
    setStatus("Sample ready — hit Import to add it.", true);
  });
  importRun.addEventListener("click", () => {
    const group = importGroup.value;
    try {
      const entries = importMode === "json"
        ? parseJsonImport(importJson.value, group)
        : [parseRuleText(importText.value, group)];
      const added = importEntries(entries);
      if (!added) { setStatus("Nothing new — that entry is already imported.", true); return; }
      setStatus("✓ Imported " + added + " entr" + (added === 1 ? "y" : "ies") + " — filed under " + entries[0].group + ". Search for it below.", true);
      importModal.hidden = true;
      document.querySelector('[data-g="Homebrew"]').classList.remove("on");
      grpChips.forEach((x) => x.classList.remove("on"));
      document.querySelector('[data-g="All"]').classList.add("on");
      state.group = "All";
      state.sources = { "24": true, "14": false, ex: false, hb: true };
      syncEdChips();
      savePrefs();
      if (state.query.trim()) runSearch();
      else {
        searchInput.value = entries[0].name;
        clearBtn.hidden = false;
        state.query = entries[0].name;
        runSearch();
      }
    } catch (e) {
      setStatus(e.message, false);
    }
  });

  /* ═══════════ export ═══════════ */
  $("importExport").addEventListener("click", () => {
    try {
      exportHomebrew();
      setStatus("✓ Downloaded bgn-dnd-homebrew.json — re-import it here or share the file with your table.", true);
    } catch (e) {
      setStatus(e.message, false);
    }
  });

  /* ═══════════ GM tools ═══════════ */
  const GM_DEFAULT_DICE = [
    { label: "d4", sides: 4 }, { label: "d6", sides: 6 }, { label: "d8", sides: 8 },
    { label: "d10", sides: 10 }, { label: "d12", sides: 12 }, { label: "d20", sides: 20 }, { label: "d100", sides: 100 },
  ];
  const GM_DEFAULT_LOOKUPS = [
    { label: "✦ Spell", group: "Spells", src: "all" },
    { label: "☠ Monster", group: "Monsters", src: "all" },
    { label: "⚖ Rule", group: "Rules", src: "all" },
    { label: "♟ Feat", group: "Feats", src: "all" },
    { label: "🛡 Item", group: "Equipment", src: "all" },
    { label: "⚔ Character", group: "Characters", src: "all" },
    { label: "🔀 Anything", group: "All", src: "all" },
  ];
  const GM_GROUP_OPTIONS = ["All", "Spells", "Monsters", "Rules", "Feats", "Characters", "Equipment"];
  const GM_SRC_OPTIONS = [["all", "Any source"], ["24", "2024"], ["14", "2014"], ["ex", "Expanded"], ["hb", "Homebrew"]];
  let gmPrefs = {
    dice: GM_DEFAULT_DICE.map((d) => ({ ...d })),
    lookups: GM_DEFAULT_LOOKUPS.map((l) => ({ ...l })),
    sections: { dice: true, random: true, favs: true },
  };
  async function loadGmPrefs() {
    const kv = HB_KV();
    if (!kv) return;
    try {
      const p = await kv.prefs.get("gm");
      if (p && Array.isArray(p.dice) && p.dice.length) {
        gmPrefs.dice = p.dice.map((d) => ({ label: String(d.label || "").trim(), sides: parseInt(d.sides, 10) || 6 })).filter((d) => d.label);
        if (Array.isArray(p.lookups)) gmPrefs.lookups = p.lookups.map((l) => ({ label: String(l.label || "").trim(), group: GM_GROUP_OPTIONS.includes(l.group) ? l.group : "All", src: l.src || "all" })).filter((l) => l.label);
        if (p.sections) gmPrefs.sections = { dice: true, random: true, favs: true, ...p.sections };
      }
    } catch (e) { /* defaults */ }
  }
  function saveGmPrefs() {
    const kv = HB_KV();
    if (!kv) return;
    kv.prefs.set("gm", gmPrefs).catch(() => {});
  }
  const gmModal = $("gmModal"), gmStatus = $("gmStatus");
  const diceInput = $("diceInput"), diceResult = $("diceResult"), diceHistory = $("diceHistory");
  const gmDiceBtns = $("gmDiceBtns"), gmLookupBtns = $("gmLookupBtns");
  let diceHist = [];
  let gmCfgMode = false;
  const setGmStatus = (msg, ok) => { gmStatus.textContent = msg; gmStatus.style.color = ok ? "var(--bgn-accent2)" : "#e08a8a"; };
  function rollDice(expr) {
    const m = String(expr).trim().toLowerCase().match(/^(\d*)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?$/);
    if (!m) return null;
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    const mod = (m[3] === "-" ? -1 : 1) * (m[4] ? parseInt(m[4], 10) : 0);
    if (!count || count > 100 || sides < 2 || sides > 1000) return null;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    let detail = rolls.join(" + ");
    if (mod) detail += (mod < 0 ? " − " : " + ") + Math.abs(mod);
    return { label: String(expr).trim().toLowerCase(), rolls, sides, total, detail };
  }
  function showRoll(r) {
    if (!r) { diceResult.textContent = ""; return; }
    diceResult.innerHTML = '<span class="dice-num">' + r.total + '</span><span class="muted">' + r.label + " · " + r.detail + "</span>";
    diceHist.unshift({ label: r.label, total: r.total });
    if (diceHist.length > 8) diceHist.pop();
    diceHistory.innerHTML = diceHist.map((h) => '<div class="roll-line">' + h.label + " = <b>" + h.total + "</b></div>").join("");
  }
  function doRoll(expr) {
    if (!expr) { setGmStatus("Type a roll like 2d6+3, or tap a die.", false); return; }
    const r = rollDice(expr);
    if (!r) { setGmStatus("Couldn't read that — try 2d6+3, 1d20, or d100.", false); return; }
    setGmStatus("", true);
    showRoll(r);
  }
  function renderGmDice() {
    gmDiceBtns.innerHTML = "";
    const dice = gmPrefs.dice.filter((d) => d.label);
    if (!dice.length) {
      gmDiceBtns.innerHTML = '<span class="gm-cfg-hint">No dice yet — add some in ⚙ Customize.</span>';
      return;
    }
    for (const d of dice) {
      const b = document.createElement("button");
      b.className = "chip dice-chip";
      b.textContent = d.label;
      b.title = "Roll 1d" + d.sides;
      b.addEventListener("click", () => doRoll("1d" + d.sides));
      gmDiceBtns.appendChild(b);
    }
  }
  function randomEntry(group, src) {
    const okSrc = (s) => src === "all" || src === s;
    const pool = [];
    if (state.sources["24"] && okSrc("24")) for (const e of DB24) if (group === "All" || e.group === group) pool.push({ kind: "24", entry: e });
    if (state.sources.hb && okSrc("hb")) for (const e of homebrewItems) if (group === "All" || e.group === group) pool.push({ kind: "hb", entry: e });
    if (state.sources.ex && okSrc("ex") && state.books.size) for (const e of expandedItems) {
      if (!state.books.has(e.book)) continue;
      if (group === "All" || e.group === group) pool.push({ kind: "ex", entry: e });
    }
    if (state.sources["14"] && okSrc("14") && idx2014) for (const it of idx2014) if (group === "All" || it.group === group) pool.push({ kind: "14", entry: it });
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function renderGmLookups() {
    gmLookupBtns.innerHTML = "";
    const lookups = gmPrefs.lookups.filter((l) => l.label);
    if (!lookups.length) {
      gmLookupBtns.innerHTML = '<span class="gm-cfg-hint">No random lookups yet — add some in ⚙ Customize.</span>';
      return;
    }
    for (const l of lookups) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = l.label;
      b.title = "Random " + l.group + (l.src !== "all" ? " · " + l.src : "");
      b.addEventListener("click", () => {
        const item = randomEntry(l.group, l.src);
        if (!item) { setGmStatus("No content in that category with your current sources — check ⚙ Sources.", false); return; }
        gmModal.hidden = true;
        openEntry(item);
      });
      gmLookupBtns.appendChild(b);
    }
  }
  function renderGmSections() {
    if (gmCfgMode) return;
    $("gmSecDice").hidden = !gmPrefs.sections.dice;
    $("gmSecRandom").hidden = !gmPrefs.sections.random;
    $("gmSecFavs").hidden = !gmPrefs.sections.favs;
  }
  function renderGmCfg() {
    gmCfgDice.innerHTML = "";
    if (!gmPrefs.dice.length) gmCfgDice.innerHTML = '<p class="gm-cfg-hint">No dice — the roller still works via the expression box.</p>';
    gmPrefs.dice.forEach((d, i) => {
      const row = document.createElement("div");
      row.className = "gm-cfg-row";
      row.innerHTML = '<input class="field" data-f="label" placeholder="Label, e.g. d6"><input class="field" data-f="sides" type="number" min="2" max="1000" placeholder="Sides"><button type="button" class="gm-cfg-x" title="Remove">✕</button>';
      const lbl = row.querySelector('[data-f="label"]'), sides = row.querySelector('[data-f="sides"]');
      lbl.value = d.label;
      sides.value = d.sides;
      lbl.addEventListener("change", () => { d.label = lbl.value.trim(); saveGmPrefs(); renderGmDice(); });
      sides.addEventListener("change", () => { d.sides = Math.min(1000, Math.max(2, parseInt(sides.value, 10) || 6)); sides.value = d.sides; saveGmPrefs(); renderGmDice(); });
      row.querySelector(".gm-cfg-x").addEventListener("click", () => { gmPrefs.dice.splice(i, 1); saveGmPrefs(); renderGmCfg(); renderGmDice(); });
      gmCfgDice.appendChild(row);
    });
    gmCfgLookups.innerHTML = "";
    if (!gmPrefs.lookups.length) gmCfgLookups.innerHTML = '<p class="gm-cfg-hint">No lookups — the dice section still works.</p>';
    gmPrefs.lookups.forEach((l, i) => {
      const row = document.createElement("div");
      row.className = "gm-cfg-row";
      row.innerHTML = '<input class="field" data-f="lbl" placeholder="Label, e.g. Random Dragon">' +
        '<select class="field" data-f="grp">' + GM_GROUP_OPTIONS.map((g) => '<option value="' + g + '">' + g + "</option>").join("") + "</select>" +
        '<select class="field" data-f="src">' + GM_SRC_OPTIONS.map(([v, t]) => '<option value="' + v + '">' + t + "</option>").join("") + "</select>" +
        '<button type="button" class="gm-cfg-x" title="Remove">✕</button>';
      const lbl = row.querySelector('[data-f="lbl"]'), grp = row.querySelector('[data-f="grp"]'), src = row.querySelector('[data-f="src"]');
      lbl.value = l.label;
      grp.value = l.group;
      src.value = l.src;
      lbl.addEventListener("change", () => { l.label = lbl.value.trim(); saveGmPrefs(); renderGmLookups(); });
      grp.addEventListener("change", () => { l.group = grp.value; saveGmPrefs(); renderGmLookups(); });
      src.addEventListener("change", () => { l.src = src.value; saveGmPrefs(); renderGmLookups(); });
      row.querySelector(".gm-cfg-x").addEventListener("click", () => { gmPrefs.lookups.splice(i, 1); saveGmPrefs(); renderGmCfg(); renderGmLookups(); });
      gmCfgLookups.appendChild(row);
    });
    gmModal.querySelectorAll("[data-gmsec]").forEach((c) => { c.checked = !!gmPrefs.sections[c.dataset.gmsec]; });
  }
  function setGmCfgMode(on) {
    gmCfgMode = on;
    $("gmCustomize").hidden = !on;
    if (on) { renderGmCfg(); $("gmSecDice").hidden = $("gmSecRandom").hidden = $("gmSecFavs").hidden = true; }
    else renderGmSections();
    $("gmCfgBtn").textContent = on ? "← Back" : "⚙ Customize";
  }
  function openEntry(item) {
    suggestCtn.hidden = true;
    refLayout.hidden = false;
    detailEl.hidden = false;
    detailEmpty.hidden = true;
    state.selId = null;
    renderDetail({ key: "gm-" + (item.entry.id || Math.random()), name: item.entry.name || "Entry", items: [item] });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  function resolveFavorites() {
    const out = [];
    for (const e of DB24) if (favSet.has("24::" + e.id)) out.push({ kind: "24", entry: e, name: e.name });
    if (idx2014) for (const it of idx2014) if (favSet.has("14::" + it.url)) out.push({ kind: "14", entry: it, name: it.name });
    for (const e of homebrewItems) if (favSet.has("hb::" + e.id)) out.push({ kind: "hb", entry: e, name: e.name });
    for (const e of expandedItems) {
      if (state.books.size && !state.books.has(e.book)) continue;
      if (favSet.has("ex::" + e.book + "|" + e.category + "|" + e.name)) out.push({ kind: "ex", entry: e, name: e.name });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  function badgeForItem(item) {
    if (item.kind === "24") return '<span class="ed-badge ed-2024">2024</span>';
    if (item.kind === "14") return '<span class="ed-badge ed-2014">2014</span>';
    if (item.kind === "ex") return '<span class="ed-badge ed-expanded">Expanded</span>';
    return '<span class="ed-badge ed-custom">Custom</span>';
  }
  function renderGmFavs() {
    const favs = resolveFavorites();
    $("gmFavCount").textContent = favs.length ? "· " + favs.length + " saved" : "";
    gmFavs.innerHTML = "";
    if (!favs.length) {
      gmFavs.innerHTML = '<p class="muted small" style="margin:4px 0">Nothing pinned yet — use the ★ on results or in detail panels.</p>';
      return;
    }
    for (const item of favs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gm-fav";
      b.innerHTML = '<span class="r-name" style="font-weight:600;color:var(--bgn-cream);font-size:.85rem"></span>' + badgeForItem(item) + '<span class="muted" style="font-size:.7rem;margin-left:auto">' + (item.entry.group || "") + "</span>";
      b.querySelector(".r-name").textContent = item.name;
      b.addEventListener("click", () => { gmModal.hidden = true; openEntry(item); });
      gmFavs.appendChild(b);
    }
  }
  const gmFavs = $("gmFavs");
  const gmCfgDice = $("gmCfgDice"), gmCfgLookups = $("gmCfgLookups");
  $("gmBtn").addEventListener("click", () => {
    gmModal.hidden = false;
    setGmStatus("");
    diceResult.textContent = "";
    setGmCfgMode(false);
    renderGmDice();
    renderGmLookups();
    renderGmSections();
    renderGmFavs();
  });
  $("gmClose").addEventListener("click", () => { gmModal.hidden = true; });
  gmModal.addEventListener("click", (e) => { if (e.target === gmModal) gmModal.hidden = true; });
  $("gmDone").addEventListener("click", () => { gmModal.hidden = true; });
  $("gmCfgBtn").addEventListener("click", () => setGmCfgMode(!gmCfgMode));
  $("gmCfgAddDie").addEventListener("click", () => { gmPrefs.dice.push({ label: "", sides: 6 }); renderGmCfg(); });
  $("gmCfgAddLookup").addEventListener("click", () => { gmPrefs.lookups.push({ label: "", group: "All", src: "all" }); renderGmCfg(); });
  $("gmCfgReset").addEventListener("click", () => {
    gmPrefs.dice = GM_DEFAULT_DICE.map((d) => ({ ...d }));
    gmPrefs.lookups = GM_DEFAULT_LOOKUPS.map((l) => ({ ...l }));
    gmPrefs.sections = { dice: true, random: true, favs: true };
    saveGmPrefs();
    renderGmCfg();
    renderGmDice();
    renderGmLookups();
    setGmStatus("Restored the default GM layout.", true);
  });
  gmModal.querySelectorAll("[data-gmsec]").forEach((c) => c.addEventListener("change", () => {
    gmPrefs.sections[c.dataset.gmsec] = c.checked;
    saveGmPrefs();
    renderGmSections();
  }));
  $("diceBtn").addEventListener("click", () => doRoll(diceInput.value));
  diceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doRoll(diceInput.value); } });

  /* ═══════════ BGN table / session panel ═══════════ */
  const bannerEl = $("bannerEl"), turnEl = $("turnEl"), logEl = $("logEl");
  const roomBox = $("roomBox"), roomCodeEl = $("roomCodeEl"), connEl = $("connEl");
  const copyCodeBtn = $("copyCodeBtn"), leaveBtn = $("leaveBtn");
  const newGameBtn = $("newGameBtn"), claimBtn = $("claimBtn"), menuBtn = $("menuBtn");
  const saveBtn = $("saveBtn"), shareBtn = $("shareBtn"), helpBtn = $("helpBtn");
  const joinCodeInput = $("joinCodeInput"), joinRoomBtn = $("joinRoomBtn"), onlineMsg = $("onlineMsg");
  const chatMsgsEl = $("chatMsgsEl"), chatInput = $("chatInput"), chatSendBtn = $("chatSendBtn");
  const continuePanel = $("continuePanel"), continueInfoEl = $("continueInfoEl");
  const continueBtn = $("continueBtn"), deleteSaveBtn = $("deleteSaveBtn");
  const fsOpenBtn = $("fsOpenBtn");
  const helpOverlay = $("helpOverlay"), helpBody = $("helpBody");

  function sfx(n) { try { if (window.BGN && BGN.sfx) BGN.sfx.play(n); } catch (e) {} }

  const sessionLog = [];
  function addLog(role, msg) {
    sessionLog.push({ r: role, m: msg });
    if (sessionLog.length > 60) sessionLog.shift();
    renderLog();
  }
  function roleName(r) { return r === "you" ? "You" : "Table"; }
  function renderLog() {
    logEl.innerHTML = "";
    if (!sessionLog.length) { logEl.innerHTML = '<div class="muted small">No activity yet — searches, copies and saves land here.</div>'; return; }
    for (const e of sessionLog) {
      const d = document.createElement("div");
      d.className = "log-item";
      d.innerHTML = "<b>" + esc(roleName(e.r)) + "</b><span class='resp'>" + esc(e.m) + "</span>";
      logEl.appendChild(d);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ═══════════ fullscreen reader ═══════════
     Maximizes the current entry into a full-window overlay: the
     body, action buttons and reference footer are MOVED in live
     (never cloned) so copy/favorite keep working while maximized. */
  const fsOverlay = $("fsOverlay"), fsExitBtn = $("fsExitBtn"), fsStatusEl = $("fsStatusEl");
  const fsBoardWrap = $("fsBoardWrap"), fsTileCtn = $("fsTileCtn"), fsMeepleCtn = $("fsMeepleCtn");
  const fsGame = { canvas: null, tile: null, meeple: null, resize: null };
  const fsMoved = [];
  function fsStash(el) { if (el && !el._fsOrig) { el._fsOrig = { p: el.parentNode, n: el.nextSibling }; fsMoved.push(el); } return el; }
  function fsRestore(el) { if (!el || !el._fsOrig) return; const o = el._fsOrig; if (o.p && o.n && o.n.parentNode === o.p) o.p.insertBefore(el, o.n); else if (o.p) o.p.appendChild(el); el._fsOrig = null; }
  function fsDefaultResize() {
    if (!fsGame.canvas) return;
    const c = fsGame.canvas;
    if (typeof c.width === "number" && typeof c.height === "number") {
      const w = c.parentElement.clientWidth || 640, h = c.parentElement.clientHeight || 400, dpr = window.devicePixelRatio || 1;
      const nw = Math.round(w * dpr), nh = Math.round(h * dpr);
      if (nw !== c.width || nh !== c.height) { c.width = nw; c.height = nh; }
    }
  }
  function fsResize() { fsDefaultResize(); }
  function fsRefit() { (fsGame.resize || fsDefaultResize)(); }
  function openFullscreen() {
    if (!fsOverlay.hidden) return;
    const entryBlocks = detailEl.querySelector(".blocks");
    const entryActions = detailEl.querySelector(".detail-actions");
    const entryFoot = detailEl.querySelector(".ref-foot");
    if (entryBlocks) fsGame.canvas = entryBlocks;
    if (entryActions) fsGame.tile = entryActions;
    if (entryFoot) fsGame.meeple = entryFoot;
    fsOverlay.hidden = false;
    fsStatusEl.textContent = bannerEl.textContent || "Full screen reader";
    if (fsGame.tile) fsTileCtn.appendChild(fsStash(fsGame.tile));
    if (fsGame.meeple) fsMeepleCtn.appendChild(fsStash(fsGame.meeple));
    if (fsGame.canvas) fsBoardWrap.appendChild(fsStash(fsGame.canvas));
    document.body.style.overflow = "hidden";
    fsRefit();
    try { if (fsOverlay.requestFullscreen) fsOverlay.requestFullscreen().catch(() => {}); } catch (e) {}
  }
  function closeFullscreen() {
    if (fsOverlay.hidden) return;
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
    for (const el of fsMoved) fsRestore(el);
    fsMoved.length = 0;
    fsOverlay.hidden = true;
    document.body.style.overflow = "";
    fsRefit();
  }
  window.bgnFullscreen = {
    register(o) {
      if (!o) return;
      if (o.canvas) { fsGame.canvas = o.canvas; fsOpenBtn.hidden = false; }
      if (o.tile) fsGame.tile = o.tile;
      if (o.meeple) fsGame.meeple = o.meeple;
      if (o.resize) fsGame.resize = o.resize;
    },
    open: openFullscreen, close: closeFullscreen, isOpen: () => !fsOverlay.hidden,
  };
  window.bgnFullscreen.register({ canvas: null, tile: null, meeple: null, resize: fsResize });
  fsOpenBtn.addEventListener("click", openFullscreen);
  fsExitBtn.addEventListener("click", closeFullscreen);
  window.addEventListener("resize", () => { if (!fsOverlay.hidden) fsRefit(); });
  new MutationObserver(() => {
    if (!fsOverlay.hidden) fsStatusEl.textContent = bannerEl.textContent || "";
  }).observe(bannerEl, { childList: true, characterData: true, subtree: true });

  let detailBanner = "";
  function updateBanner() {
    const msg = detailBanner || "";
    bannerEl.hidden = !msg;
    bannerEl.textContent = msg;
    if (!fsOverlay.hidden) fsStatusEl.textContent = msg;
  }
  function setBanner(msg) {
    detailBanner = msg || "";
    updateBanner();
  }
  let bannerTimer = null;
  function flashBanner(msg) {
    bannerEl.hidden = false;
    bannerEl.textContent = msg;
    if (!fsOverlay.hidden) fsStatusEl.textContent = msg;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(updateBanner, 2600);
  }

  /* ═══════════ session: code, rejoin, save ═══════════ */
  function b64e(s) { const bytes = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64d(s) {
    let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
    b += "=".repeat((4 - (b.length % 4)) % 4);
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function sessionCode() {
    const p = { v: 1, q: state.query.trim(), g: state.group, s: [!!state.sources["24"], !!state.sources["14"], !!state.sources.ex, !!state.sources.hb], b: [...state.books] };
    let j; try { j = JSON.stringify(p); } catch (e) { return ""; }
    return "bgn:" + b64e(j);
  }
  function refreshRoomCode() { if (roomCodeEl) roomCodeEl.textContent = sessionCode() || "—"; }
  function setOnlineMsg(t) { if (onlineMsg) onlineMsg.textContent = t || ""; }
  const GROUPS_ALL = ["All", "Spells", "Monsters", "Rules", "Feats", "Characters", "Equipment", "Homebrew", "Favorites"];
  function applySessionCode(raw) {
    const c = String(raw || "").trim().replace(/^bgn:/i, "");
    let o;
    try { o = JSON.parse(b64d(c)); } catch (e) { return false; }
    if (!o || o.v !== 1) return false;
    state.query = String(o.q || "").slice(0, 120);
    if (GROUPS_ALL.indexOf(o.g) !== -1) state.group = o.g;
    if (Array.isArray(o.s)) state.sources = { "24": !!o.s[0], "14": !!o.s[1], ex: !!o.s[2], hb: !!o.s[3] };
    state.books = new Set(Array.isArray(o.b) ? o.b : []);
    syncEdChips();
    savePrefs();
    searchInput.value = state.query;
    clearBtn.hidden = !state.query;
    grpChips.forEach((x) => x.classList.toggle("on", x.dataset.g === state.group));
    if (state.query.trim()) runSearch(); else { suggestCtn.hidden = false; refLayout.hidden = true; }
    refreshRoomCode();
    addLog("table", "Session restored by code.");
    setBanner("Session restored" + (state.query.trim() ? " — \u201C" + state.query.trim() + "\u201D" : "") + ".");
    turnEl.textContent = "Session restored";
    return true;
  }

  const SAVE_KEY = "bgn_save_dndref";
  function saveSession() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, q: state.query.trim(), g: state.group, s: state.sources, b: [...state.books], log: sessionLog.slice(), savedAt: Date.now() }));
      return true;
    } catch (e) { return false; }
  }
  function hasSessionSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function deleteSessionSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function refreshContinuePanel() {
    if (!continuePanel) return;
    const s = hasSessionSave();
    continuePanel.hidden = !s;
    if (!s) return;
    let info = "A saved session was found.";
    try {
      const o = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (o && o.savedAt) info = "Saved " + new Date(o.savedAt).toLocaleTimeString() + (o.q ? " · searching \"" + String(o.q).slice(0, 40) + "\"" : "");
    } catch (e) {}
    continueInfoEl.textContent = info;
  }
  function restoreSessionState(o) {
    state.query = String(o.q || "").slice(0, 120);
    if (o.g && GROUPS_ALL.indexOf(o.g) !== -1) state.group = o.g;
    if (o.s) state.sources = { "24": !!o.s["24"], "14": !!o.s["14"], ex: !!o.s.ex, hb: !!o.s.hb };
    state.books = new Set(Array.isArray(o.b) ? o.b : []);
    syncEdChips();
    savePrefs();
    searchInput.value = state.query;
    clearBtn.hidden = !state.query;
    grpChips.forEach((x) => x.classList.toggle("on", x.dataset.g === state.group));
    if (sessionLog.length) sessionLog.length = 0;
    if (Array.isArray(o.log)) for (const e of o.log) sessionLog.push(e);
    if (state.query.trim()) runSearch(); else { suggestCtn.hidden = false; refLayout.hidden = true; }
    renderLog();
    refreshRoomCode();
  }
  function continueSession() {
    let o; try { o = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { o = null; }
    if (!o) { flashBanner("No saved session found."); return; }
    restoreSessionState(o);
    addLog("table", "Session continued from your saved table.");
    setBanner("Session continued" + (state.query.trim() ? " — \u201C" + state.query.trim() + "\u201D" : "") + ".");
    turnEl.textContent = "Session continued";
    flashBanner("Session restored.");
    sfx("deal");
  }

  /* ═══════════ help overlay ═══════════ */
  const HELP_HTML = '<h2 class="goldtext">How D&amp;D 5E Rules &amp; Stats works</h2>'
    + '<p class="muted">A quick-reference table for Dungeons &amp; Dragons 5th Edition. Search the free SRD across the <b>2024</b> and <b>2014</b> rule sets, then copy a clean, citation-ready entry straight to your notes.</p>'
    + '<h3>Lookups</h3>'
    + '<p>Type into the search box or tap a popular lookup. The <b>Edition</b> chips pick which rule set(s) to search; the <b>Type</b> chips filter by category. Matching entries from both rule sets merge into one result — flip between them with the <b>2024 version / 2014 version</b> tabs.</p>'
    + '<h3>Copying</h3>'
    + '<p>Open a result and hit <b>📋 Copy results + references</b> — the full entry plus its book reference, ready to paste. <b>🔗 Reference only</b> copies just the citation.</p>'
    + '<h3>Your table</h3>'
    + '<p><b>🎲 GM Tools</b> adds dice, random lookups and favorites. <b>📥 Import</b> mixes your house rules and homebrew into search (browser-only). <b>⚙ Sources</b> picks rule sets and 3rd-party Open5e books.</p>'
    + '<h3>Session</h3>'
    + '<p>Lookups and copies land in the <b>session log</b>. <b>Copy code</b> makes a share code for the current lookup — anyone can rejoin it by pasting the code (or a <code>?code=…</code> link). <b>💾 Save</b> keeps it in your browser so <b>Continue</b> brings it back after a reload, and <b>📤 Share</b> exports JSON or a PNG. <b>⛶ Full screen</b> opens the current entry in a distraction-free reader.</p>'
    + '<button class="btn btn-gold" id="helpDoneBtn">Got it</button>';
  function openHelp() {
    helpBody.innerHTML = HELP_HTML;
    const done = document.getElementById("helpDoneBtn");
    if (done) done.addEventListener("click", closeHelp);
    helpOverlay.hidden = false;
    sfx("deal");
  }
  function closeHelp() { helpOverlay.hidden = true; }

  /* ═══════════ table chat (comments-plugin transport) ═══════════ */
  let chatCom = null, chatReady = false;
  function renderChat(c) {
    if (!c || !chatMsgsEl) return;
    const text = cleanText(c.message, 160);
    const nick = (c.user && (c.user.nickname || c.user.visualId)) ? String(c.user.nickname || c.user.visualId) : "Player";
    const who = c.byCurrentUser ? "You" : cleanText(nick, 40);
    const last = chatMsgsEl.lastElementChild;
    if (last && last.classList.contains("mine") && last.lastChild && last.lastChild.textContent === text) return;
    const row = document.createElement("div");
    row.className = "chat-item" + (c.byCurrentUser ? " mine" : "");
    row.innerHTML = "<b>" + escapeHtml(who) + "</b>" + escapeHtml(text);
    chatMsgsEl.appendChild(row);
    chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
    if (!c.byCurrentUser) sfx("draw");
  }
  function initChat() {
    const rootRef = window.root || {};
    if (!rootRef.commentsPlugin || !chatMsgsEl) return;
    const opts = {
      channel: "dnd-src-table",
      channelLabel: "💬 D&D Reference Table",
      containerStyle: "width:1px;height:1px;opacity:0;position:fixed;top:0;left:0;",
      hideComments: true, hideSettingsButton: true, hideFullscreenButton: true,
      forceColorScheme: "dark",
      onLoad: (comments) => { chatReady = true; if (Array.isArray(comments)) for (const c of comments) renderChat(c); },
      onComment: (c) => renderChat(c),
    };
    try {
      chatCom = rootRef.commentsPlugin(opts);
      document.body.insertAdjacentHTML("beforeend", String(chatCom));
      setTimeout(() => { if (chatCom && !chatReady) chatReady = true; }, 8000);
    } catch (e) { console.error("chat init failed", e); chatCom = null; }
  }
  function sendChat() {
    const t = cleanText(chatInput.value, 160);
    if (!t) return;
    if (!chatCom) { flashBanner("Chat isn't ready yet — try again in a moment."); return; }
    if (!chatReady) { flashBanner("Chat is still loading — give it a second."); return; }
    chatInput.value = "";
    const submitP = chatCom.submit(t);
    submitP.catch(() => {}); // avoid unhandled rejection if the client-side race wins first
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 12000));
    Promise.race([submitP, timeout]).then(() => {
      addLog("you", "Chat: " + t);
      renderChat({ message: t, byCurrentUser: true });
    }).catch((e) => {
      const msg = (e && e.message ? e.message : "error");
      if (msg !== "timed out") chatInput.value = t;
      addLog("table", "Chat blocked: " + msg);
      flashBanner("Your message wasn't sent (" + msg + ").");
    });
  }

  /* ═══════════ win / claim hooks ═══════════
     A reference table has no matches to win, but the hook stays
     wired so an online table could claim a forfeit. */
  function claimWin() {
    addLog("table", "Claim win attempted — no match in progress.");
    flashBanner("Nothing to claim — this is a reference table, not a match.");
    return false;
  }
  window.__bgn_claimWin = claimWin;

  /* ═══════════ session actions ═══════════ */
  function newSession() {
    searchInput.value = "";
    clearBtn.hidden = true;
    state.query = "";
    if (sessionLog.length) sessionLog.length = 0;
    renderLog();
    suggestCtn.hidden = false;
    refLayout.hidden = true;
    fsOpenBtn.hidden = true;
    turnEl.textContent = "Ready to look up";
    setBanner("");
    refreshRoomCode();
    addLog("table", "New session started.");
    searchInput.focus();
    sfx("deal");
  }
  function menuBack() {
    newSession();
    window.scrollTo({ top: 0, behavior: "smooth" });
    addLog("table", "Back to the menu.");
  }

  copyCodeBtn.addEventListener("click", () => {
    const code = sessionCode();
    if (!code) { flashBanner("Nothing to copy yet — try a lookup first."); return; }
    copyText(copyCodeBtn, code, "✓ Copied!");
    addLog("you", "Copied the session code.");
    flashBanner("Session code copied.");
  });
  leaveBtn.addEventListener("click", () => {
    newSession();
    setBanner("Left the table.");
  });
  newGameBtn.addEventListener("click", newSession);
  menuBtn.addEventListener("click", menuBack);
  saveBtn.addEventListener("click", () => {
    if (saveSession()) { addLog("you", "Session saved."); refreshContinuePanel(); flashBanner("Session saved."); sfx("flip"); }
    else { flashBanner("Couldn't save — storage unavailable."); }
  });
  continueBtn.addEventListener("click", continueSession);
  deleteSaveBtn.addEventListener("click", () => { deleteSessionSave(); refreshContinuePanel(); flashBanner("Save deleted."); });
  claimBtn.addEventListener("click", claimWin);
  helpBtn.addEventListener("click", openHelp);
  helpOverlay.addEventListener("click", (e) => { if (e.target === helpOverlay) closeHelp(); });
  $("helpCloseBtn").addEventListener("click", closeHelp);
  joinRoomBtn.addEventListener("click", () => {
    const c = joinCodeInput.value.trim();
    if (!c) { setOnlineMsg("Paste a session code first."); return; }
    if (!applySessionCode(c)) setOnlineMsg("That code doesn't look like a valid session.");
    else { setOnlineMsg(""); joinCodeInput.value = ""; sfx("deal"); }
  });
  joinCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoomBtn.click(); });
  chatSendBtn.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!fsOverlay.hidden) { closeFullscreen(); return; }
    if (!helpOverlay.hidden) closeHelp();
  });

  /* debug/testing handle for browser_eval */
  window.__t = {
    state, applySessionCode, sessionCode, saveSession, continueSession, newSession, menuBack,
    openHelp, closeHelp, openFullscreen, closeFullscreen, claimWin, sendChat,
    refreshRoomCode, renderLog, addLog, setBanner, flashBanner, initChat,
    get chatReady() { return chatReady; }, get chatCom() { return !!chatCom; },
  };

  /* ═══════════ share / export (bgn-share.js) ═══════════ */
  (function () {
    if (!shareBtn || !window.bgnShare) return;
    function tplName() { return (window.root && root.gameTitle) ? String(root.gameTitle.evaluateItem || root.gameTitle) : "D&D 5E Rules & Stats"; }
    const panel = window.bgnShare.openPanel({
      tpl: "bgn-dnd-source-reference",
      gameName: tplName,
      exportData() {
        return { v: 1, q: state.query.trim(), g: state.group, s: state.sources, b: [...state.books], log: sessionLog.slice() };
      },
      applySave(o) {
        if (!o || o.v !== 1) return false;
        restoreSessionState(o);
        addLog("table", "Session imported from a share file.");
        setBanner("Session imported from JSON.");
        return true;
      },
      source() {
        if (refLayout && !refLayout.hidden) return refLayout;
        return document.querySelector(".bgn-lobby") || document.body;
      },
      title: "D&D 5E RULES & STATS",
      subtitle() {
        const ed = (state.sources["14"] && state.sources["24"]) ? "2014+2024 rules" : state.sources["24"] ? "2024 rules" : state.sources["14"] ? "2014 rules" : "2024 rules";
        return (state.query.trim() ? "\u201C" + state.query.trim() + "\u201D · " : "") + ed;
      },
      filenameBase: "dnd-5e-rules-stats",
    });
    shareBtn.addEventListener("click", () => panel.open());
  })();

  /* ═══════════ init ═══════════ */
  (async function init() {
    document.body.style.setProperty("--bgn-accent", "#d4af37");
    const heroImg = window.root && root.heroImage ? String(root.heroImage.evaluateItem || root.heroImage) : "";
    const hero = $("gameHero");
    if (heroImg && hero) {
      hero.classList.add("has-img");
      hero.style.setProperty("--bgn-hero-img", "url('" + heroImg + "')");
    }
    try { await load2024(); } catch (e) { console.error("2024 data load failed", e); }
    try { await loadPrefs(); syncEdChips(); } catch (e) { console.error("prefs load failed", e); }
    try { await loadHomebrew(); } catch (e) { console.error("homebrew load failed", e); }
    try { await loadFavs(); } catch (e) { console.error("favorites load failed", e); }
    try { await loadGmPrefs(); } catch (e) { console.error("gm prefs load failed", e); }
    if (state.sources.ex && state.books.size) {
      loadO5eDocs().then((docs) => {
        renderBookList(docs);
        for (const slug of state.books) ensureExpandedBook(slug);
      }).catch(() => {});
    }
    const params = new URLSearchParams(window.location.search || "");
    const q0 = (params.get("q") || "").trim().slice(0, 120);
    const ed0 = (params.get("ed") || "").toLowerCase();
    if (ed0 === "2024" || ed0 === "2014" || ed0 === "both") {
      state.sources["24"] = ed0 !== "2014";
      state.sources["14"] = ed0 !== "2024";
      syncEdChips();
      savePrefs();
    }
    if (q0) {
      searchInput.value = q0;
      clearBtn.hidden = false;
      state.query = q0;
      runSearch();
    }
    const code0 = (params.get("code") || "").trim().slice(0, 512);
    if (code0) applySessionCode(code0);
    const impUrl = params.get("import") || "";
    if (impUrl) {
      (async () => {
        try {
          statusEl.textContent = "Importing a shared house rule…";
          const r = await fetch(impUrl);
          if (!r.ok) throw new Error("http " + r.status);
          const data = await r.json();
          const entries = parseJsonImport(JSON.stringify(data), "Rules");
          const added = importEntries(entries);
          if (added) {
            searchInput.value = entries[0].name;
            clearBtn.hidden = false;
            state.query = entries[0].name;
            runSearch();
            statusEl.textContent = "✓ Imported " + added + " house rule" + (added === 1 ? "" : "s") + " from a shared link.";
          } else {
            statusEl.textContent = "That link didn't contain any new house rules.";
          }
        } catch (e) {
          console.error("import-from-url failed", e);
          statusEl.textContent = "Couldn't import from that link — it may have expired or been deleted.";
        }
      })();
    }
    if (homebrewItems.length) statusEl.textContent = "Loaded " + DB24.length.toLocaleString() + " SRD entries + " + homebrewItems.length + " of your house rules.";
    if (!DB24.length) {
      statusEl.innerHTML = "Couldn't load the 2024 compendium. Please reload.";
    } else {
      statusEl.textContent = "Loaded " + DB24.length.toLocaleString() + " entries from the 2024 SRD — indexing the 2014 rules…";
      prefetch2014();
      setTimeout(() => { if (!idx2014) statusEl.textContent = "2024 ready. The 2014 index is still loading — pick a lookup or start typing."; else statusEl.textContent = "Ready — both rule sets searchable. Try a lookup above."; }, 1200);
      setTimeout(() => { if (idx2014 && !state.query.trim()) statusEl.textContent = "Ready — both rule sets searchable. Try a lookup above."; }, 3000);
    }
    refreshRoomCode();
    refreshContinuePanel();
    renderLog();
    initChat();
  })();
})();
