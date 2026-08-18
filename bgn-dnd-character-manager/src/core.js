/* ════════════════════════════════════════════════════════════════
   D&D CHARACTER FORGE — core (math, persistence, AI helpers)
   ──────────────────────────────────────────────────────────── */
window.CF = (function () {
  "use strict";
  const D = window.DND;
  const C = {};

  /* ─── tiny utils ─── */
  C.uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  C.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  C.mod = (s) => D.mod(s);
  C.pb = (level) => D.profBonus(level);
  C.signed = (n) => (n >= 0 ? "+" + n : "" + n);
  C.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  C.debounce = (fn, ms) => { let t; return function () { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); }; };

  C.spellLevelsFor = (char) => {
    const info = C.castingInfo(char);
    if (!info) return [];
    const slots = C.spellSlots(char);
    const keys = Object.keys(slots).map(Number).sort((a, b) => a - b);
    return keys.length ? keys : [];
  };

  /* ─── data accessors ─── */
  C.species = (id) => D.species[id] || { name: id, icon: "❓", editions: { [C.ruleset()]: { traits: [] } } };
  C.klass = (id) => D.classes[id] || { name: id, icon: "❓", hitDie: 8, features: { "2014": {}, "2024": {} } };
  C.background = (id) => D.backgrounds[id] || { name: id, icon: "❓" };
  C.feat = (id) => D.feats[id] || { name: id, desc: "" };
  C.ruleset = () => C.cur.ruleset || "2024";

  /* ─── edition helpers ─── */
  C.speciesEd = (id, ruleset) => C.species(id).editions[ruleset] || C.species(id).editions["2014"] || { traits: [] };
  C.klassEd = (id, ruleset) => {
    const k = C.klass(id);
    return {
      armor: k.armor[ruleset] || "", weapons: k.weapons[ruleset] || "", saves: k.saves[ruleset] || [],
      skills: k.skills[ruleset] || { n: 2, options: [] }, subclassLevel: k.subclassLevel[ruleset] || 3,
      subclasses: k.subclasses[ruleset] || [], features: k.features[ruleset] || {},
    };
  };
  C.backgroundEd = (id, ruleset) => C.background(id)[ruleset] || { skills: [], gold: 10, feature: "" };

  /* ─── ability & derived math ─── */
  C.mods = (scores) => {
    const out = {};
    for (const a of D.ABILITIES) out[a] = D.mod(scores[a] || 10);
    return out;
  };

  C.castingInfo = (char) => {
    const k = C.klass(char.klass);
    let cast = k.casting;
    if (!cast) return null;
    if (char.klass === "warlock" && char.ruleset === "2024") cast = { ability: "cha", kind: "full", ritual: false };
    const castAbility = cast.ability;
    let kind = cast.kind;
    if (kind === "pact" && char.ruleset === "2024") kind = "full";
    const eff = { full: char.level, half: Math.ceil(char.level / 2), third: Math.ceil(char.level / 3), pact: char.level }[kind];
    return { ability: castAbility, kind, eff, focus: null };
  };

  C.spellSlots = (char) => {
    const info = C.castingInfo(char);
    if (!info) return {};
    if (info.kind === "pact") return D.pactSlots(char.level, char.ruleset || "2014");
    return D.slotsFor(Math.min(info.eff, 20));
  };

  C.maxSpellLevel = (char) => {
    const slots = C.spellSlots(char);
    const keys = Object.keys(slots).map(Number);
    return keys.length ? Math.max(...keys) : 0;
  };

  C.spellAttack = (char) => {
    const info = C.castingInfo(char);
    if (!info) return null;
    return C.pb(char.level) + (C.mods(char.scores)[info.ability] || 0);
  };
  C.spellDC = (char) => 8 + (C.spellAttack(char) || 0);

  C.speedFor = (char) => {
    const sp = C.speciesEd(char.species, char.ruleset);
    let speed = sp.speed != null ? sp.speed : (D.species[char.species] && D.species[char.species].editions["2014"] ? 30 : 30);
    const lvl = char.level;
    if (char.klass === "barbarian" && lvl >= 5) speed += 10;
    if (char.klass === "monk") { if (lvl >= 9) speed += 20; else if (lvl >= 6) speed += 15; else if (lvl >= 2) speed += 10; }
    if ((char.feats || []).includes("mobile")) speed += 10;
    return speed;
  };

  C.ACFor = (char) => {
    const mods = C.mods(char.scores);
    let ac = null;
    const species = D.species[char.species];
    if (species && species.name === "Tortle") ac = 17;
    if (char.klass === "barbarian") ac = 10 + mods.dex + mods.con;
    else if (char.klass === "monk") ac = 10 + mods.dex + mods.wis;
    else ac = 10 + mods.dex;
    const armor = char.armor ? D.armor[char.armor] : null;
    if (armor && armor.type !== "shield") {
      const cap = armor.maxDex === -1 ? 99 : (armor.maxDex || 0);
      ac = armor.ac + Math.min(mods.dex, cap);
    }
    if (char.shield && D.armor.shield) ac += 2;
    if ((char.feats || []).includes("dual wielder") && (char.weapons || []).length >= 2) ac += 1;
    return ac;
  };

  C.initiative = (char) => {
    let i = C.mods(char.scores).dex;
    if ((char.feats || []).includes("alert")) i += char.ruleset === "2024" ? C.pb(char.level) : 5;
    return i;
  };

  C.saves = (char) => {
    const ke = C.klassEd(char.klass, char.ruleset);
    const mods = C.mods(char.scores);
    const out = {};
    for (const a of D.ABILITIES) {
      const prof = ke.saves.includes(a) || (char.extraSaveProfs || []).includes(a);
      out[a] = { prof, bonus: mods[a] + (prof ? C.pb(char.level) : 0) };
    }
    return out;
  };

  C.skills = (char) => {
    const mods = C.mods(char.scores);
    const pb = C.pb(char.level);
    return D.SKILLS.map((s) => {
      const p = char.skills ? (char.skills[s.id] || 0) : 0;
      const bonus = mods[s.ability] + (p === 1 ? pb : p === 2 ? pb * 2 : 0);
      return { ...s, prof: p, bonus };
    });
  };

  C.passivePerception = (char) => {
    const p = C.skills(char).find((s) => s.id === "perception");
    return 10 + (p ? p.bonus : 0);
  };

  C.maxHP = (char) => {
    if (char.hp && char.hp.maxSet) return char.hp.max;
    const con = C.mods(char.scores).con;
    const die = C.klass(char.klass).hitDie || 8;
    let hp = die + con;
    for (let i = 2; i <= char.level; i++) hp += D.avgHit(die) + con;
    if ((char.feats || []).includes("tough")) hp += 2 * char.level;
    const sp = D.species[char.species];
    if (sp && char.ruleset === "2024" && sp.name === "Dwarf") hp += char.level;
    return hp;
  };

  C.features = (char) => {
    const out = [];
    const spEd = C.speciesEd(char.species, char.ruleset);
    (spEd.traits || []).forEach((t) => out.push(t));
    const ke = C.klassEd(char.klass, char.ruleset);
    if (char.subclass && char.level >= ke.subclassLevel) {
      const sc = ke.subclasses.find((s) => s.id === char.subclass);
      if (sc) out.push("Subclass: " + sc.name + " — " + sc.desc);
    }
    (ke.features[char.level] || []).forEach((t) => out.push(t));
    if (char.background) {
      const be = C.backgroundEd(char.background, char.ruleset);
      if (be.feature) out.push("Background: " + be.feature);
    }
    (char.feats || []).forEach((fid) => {
      const f = D.feats[fid];
      if (f) out.push("Feat: " + f.name + " — " + f.desc);
    });
    (char.customFeatures || []).forEach((t) => out.push(t));
    return out;
  };

  C.skillOptionsFor = (char) => {
    const ke = C.klassEd(char.klass, char.ruleset);
    const opts = ke.skills.options === "any" ? D.SKILLS.map((s) => s.id) : ke.skills.options.slice();
    const be = char.background ? C.backgroundEd(char.background, char.ruleset) : null;
    if (be && be.skills) be.skills.forEach((s) => { if (!opts.includes(s)) opts.push(s); });
    return opts;
  };

  C.automaticSkills = (char) => {
    const set = {};
    const spEd = C.speciesEd(char.species, char.ruleset);
    const traits = (spEd.traits || []).join(" ").toLowerCase();
    if (traits.includes("perception")) set["perception"] = 1;
    if (traits.includes("intimidation")) set["intimidation"] = 1;
    if (traits.includes("athletics")) set["athletics"] = 1;
    if (char.species === "human") set[char.extraSkill || "perception"] = 1;
    const be = char.background ? C.backgroundEd(char.background, char.ruleset) : null;
    if (be && be.skills) be.skills.forEach((s) => { set[s] = 1; });
    return set;
  };

  /* Spell known/prepared limits */
  C.spellKnownLimits = (char) => {
    const casting = C.castingInfo(char);
    if (!casting) return null;
    const kl = char.klass, lvl = char.level;
    const mod = C.mods(char.scores)[casting.ability] || 0;
    if (casting.kind === "full") {
      if (["wizard", "cleric", "druid"].includes(kl)) return { prepared: true, limit: lvl + mod };
      const known = {
        bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 22],
        sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22],
        warlock: char.ruleset === "2024"
          ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
          : [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
      };
      const arr = known[kl] || [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
      return { prepared: false, knownLimit: arr[lvl - 1] };
    }
    if (casting.kind === "half") {
      if (kl === "paladin") return { prepared: true, limit: Math.floor(lvl / 2) + mod };
      if (kl === "ranger") return char.ruleset === "2024"
        ? { prepared: true, limit: Math.floor(lvl / 2) + mod }
        : { prepared: false, knownLimit: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11][lvl - 1] };
      return { prepared: false, knownLimit: lvl + 1 };
    }
    return { prepared: false, knownLimit: null };
  };

  C.preparedCount = (char) => {
    const known = (char.spellsKnown || {});
    let n = 0;
    for (const lvl in known) { if (lvl !== "cantrips") n += known[lvl].length; }
    return n;
  };

  /* ─── character defaults ─── */
  C.newChar = (ruleset) => ({
    id: C.uid(),
    ruleset: ruleset || "2024",
    name: "", player: "", level: 1, xp: 0,
    species: null, klass: null, subclass: null, background: null,
    alignment: "True Neutral", size: "Medium",
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {}, languages: ["Common"], feats: [],
    hp: { max: 0, current: 0, temp: 0 },
    hitDice: { used: 0 },
    deathSaves: { s: 0, f: 0 },
    slotsUsed: {},
    appearance: { gender: "", age: "", height: "", build: "", eyes: "", hair: "", skin: "", desc: "" },
    portrait: "",
    personality: { traits: "", ideals: "", bonds: "", flaws: "", backstory: "" },
    armor: null, shield: false,
    weapons: [], equipment: [], money: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    spellsKnown: { cantrips: [] },
    customFeatures: [], notes: "",
    gameRoom: "", mapRoom: "",
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  /* ─── persistence (kv-plugin) ─── */
  C.kvReady = false;
  C.loadChars = async () => {
    try {
      if (!root.kv) return [];
      const entries = await root.kv.dndchars.entries();
      return entries.map(([k, v]) => v).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (e) { console.error("loadChars", e); return []; }
  };
  C.saveChar = async (char) => {
    char.updatedAt = Date.now();
    try { await root.kv.dndchars.set(char.id, char); } catch (e) { console.error("saveChar", e); }
  };
  C.deleteChar = async (id) => {
    try { await root.kv.dndchars.delete(id); } catch (e) { console.error("deleteChar", e); }
  };
  C.loadSettings = async () => {
    try { return (await root.kv.dndsettings.get("prefs")) || {}; } catch (e) { return {}; }
  };
  C.saveSettings = async (prefs) => {
    try { await root.kv.dndsettings.set("prefs", prefs); } catch (e) {}
  };

  /* ─── AI helpers ─── */
  C.hasAI = () => !!(root && root.generateText);
  C.hasImage = () => !!(root && root.generateImage);

  C.aiContext = (char) => {
    const r = char.ruleset || "2024";
    const lines = [];
    lines.push("D&D ruleset: " + D.ED[r].label);
    if (char.name) lines.push("Name: " + char.name);
    if (char.player) lines.push("Player: " + char.player);
    if (char.species) lines.push("Species: " + C.species(char.species).name);
    if (char.klass) {
      let c = C.klass(char.klass).name + " (level " + char.level + ")";
      if (char.subclass) c += ", " + char.subclass;
      lines.push("Class: " + c);
    }
    if (char.background) lines.push("Background: " + C.background(char.background).name);
    if (char.alignment) lines.push("Alignment: " + char.alignment);
    const scores = char.scores ? D.ABILITIES.map((a) => D.ABILITY_INFO[a].short.toLowerCase() + " " + char.scores[a]).join(", ") : "";
    if (scores) lines.push("Ability scores: " + scores);
    if (char.appearance && char.appearance.desc) lines.push("Appearance: " + char.appearance.desc);
    return lines.join("\n");
  };

  C.aiPrompt = (task, char) => {
    return `You are an expert Dungeons & Dragons 5th Edition assistant. Below is context about a character being created. Follow the TASK at the end.\n<CHARACTER>\n${C.aiContext(char)}\n</CHARACTER>\nTASK: ${task}`;
  };

  /* Generate AI text; supports streaming into an element. Returns text. */
  C.aiText = async (char, task, opts) => {
    opts = opts || {};
    return root.generateText({
      instruction: C.aiPrompt(task, char),
      ...(opts.startWith ? { startWith: opts.startWith } : {}),
      ...(opts.stopSequences ? { stopSequences: opts.stopSequences } : {}),
      ...(opts.onChunk ? { onChunk: opts.onChunk } : {}),
    }).then((r) => String(r));
  };

  /* AI-fill a single field. el: input or textarea. Keeps a spinner on btn. */
  C.aiFill = async ({ el, btn, char, task, startWith, stopSequences }) => {
    if (!C.hasAI()) { CF.flash("AI unavailable — check your connection."); return; }
    const oldLabel = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ai-spin"></span>'; }
    try {
      const result = await C.aiText(char, task, {
        startWith, stopSequences,
        onChunk: (d) => { if (el && el.value !== undefined) el.value = d.fullTextSoFar; },
      });
      if (el) el.value = result.trim();
      if (CF.sfx) CF.sfx("draw");
      return result.trim();
    } catch (e) { console.error("aiFill", e); CF.flash("AI generation failed — try again."); return null; }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = oldLabel; } }
  };

  /* Portrait via text-to-image plugin */
  C.genPortrait = async (char, canvasEl, btn) => {
    if (!C.hasImage()) { CF.flash("Image AI unavailable — check your connection."); return; }
    if (btn) btn.disabled = true;
    const app = char.appearance || {};
    const species = char.species ? C.species(char.species).name : "adventurer";
    const klass = char.klass ? C.klass(char.klass).name : "adventurer";
    const bits = [app.gender, app.age, app.build, app.eyes, app.hair, app.skin, app.desc].filter(Boolean).join(", ");
    const prompt = `D&D character portrait, ${species} ${klass} adventurer, ${bits || "young adventurer"}, fantasy oil painting in the style of classic D&D rulebooks, head and shoulders, detailed, warm lighting, character portrait`.slice(0, 600);
    try {
      const res = await root.generateImage({ prompt, resolution: "512x768", negativePrompt: "NSFW, nudity, text, watermark, cartoon" });
      char.portrait = String(res);
      if (canvasEl && canvasEl.src !== undefined) canvasEl.src = char.portrait;
      return char.portrait;
    } catch (e) { console.error("genPortrait", e); CF.flash("Portrait generation failed — try again."); return null; }
    finally { if (btn) btn.disabled = false; }
  };

  /* quick non-AI name */
  C.quickName = (speciesId) => {
    const list = D.quickNames[speciesId] || D.quickNames.human;
    return list[Math.floor(Math.random() * list.length)];
  };

  /* roll starting scores with a method */
  C.rollScores = (method) => {
    if (method === "standard") return { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
    if (method === "4d6") {
      const arr = [];
      for (let i = 0; i < 6; i++) {
        const rolls = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
        arr.push(rolls[1] + rolls[2] + rolls[3]);
      }
      arr.sort((a, b) => b - a);
      return { str: arr[0], dex: arr[1], con: arr[2], int: arr[3], wis: arr[4], cha: arr[5] };
    }
    if (method === "pointbuy") {
      const order = ["str", "dex", "con", "int", "wis", "cha"];
      const pts = [8, 9, 10, 10, 13, 15];
      const out = {};
      for (let i = 0; i < 6; i++) out[order[i]] = pts[i];
      return out;
    }
    if (method === "array-2024") return { str: 8, dex: 10, con: 12, int: 13, wis: 14, cha: 15 };
    return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  };

  return C;
})();
