// Validation tests for Task #233: the Codex — discovery engine + static catalog.

import { CodexSystem } from "../engine/codex.js";
import { CODEX_SECTIONS, catalogFor, enemyDetails, itemDetails, spellDetails, classDetails, locationDetails, questDetails } from "../data/codex.js";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("sections defined", CODEX_SECTIONS.length === 6 && CODEX_SECTIONS.map((s) => s.id).join(",") === "enemies,items,spells,classes,locations,quests");

  const codex = new CodexSystem({ storage: makeStorage() });

  check("empty known initially", codex.totalDiscovered() === 0 && codex.totalEntries() > 0);
  check("unknown shows locked", codex.isKnown("enemies", "goblin") === false);
  check("discover adds", codex.discover("enemies", "goblin") === true);
  check("discover dedupes", codex.discover("enemies", "goblin") === false);
  check("isKnown now true", codex.isKnown("enemies", "goblin") === true);
  check("discoverMany batch", codex.discoverMany("enemies", ["imp", "wolf", "goblin"]).length === 2);
  check("discovered count", codex.sectionInfo("enemies").known === 3);
  check("summary totals", codex.totalDiscovered() === 3);
  check("entry carries discovered flag", codex.entry("enemies", "goblin")?.discovered === true);
  check("locked excludes known", codex.sectionInfo("enemies").locked.includes("goblin") === false);
  check("entries length matches total", codex.entries("enemies").length === codex.sectionInfo("enemies").total);

  // persistence across instances via shared storage
  const store = makeStorage();
  const a = new CodexSystem({ storage: store });
  a.discover("items", "potion");
  a.discover("items", "crystalKey");
  const b = new CodexSystem({ storage: store });
  check("persists to new instance", b.isKnown("items", "potion") && b.sectionInfo("items").known === 2);

  // no storage fallback is safe
  const c0 = new CodexSystem({ storage: null });
  check("no-storage safe", c0.discover("spells", "fire") === true && c0.isKnown("spells", "fire") === true);

  // per-kind details
  const goblin = enemyDetails("goblin");
  check("enemy stats", goblin && typeof goblin.stats.HP === "number" && goblin.lore.length > 0);
  const potion = itemDetails("potion");
  check("item desc", potion && potion.description.length > 0);
  const fire = spellDetails("fire");
  check("spell mp", fire && typeof fire.mp === "number");
  const warrior = classDetails("warrior");
  check("class stats", warrior && typeof warrior.stats.HP === "number");
  const mage = classDetails("blackMage");
  check("class spells", mage && mage.spells.length > 0);
  const cornelia = locationDetails("cornelia");
  check("location lore", cornelia && cornelia.lore.length > 0);
  const herbal = questDetails("herbalists_request");
  check("side-quest detail", herbal && herbal.name.includes("Herbalist") && herbal.objectives.length >= 1);
  const prologue = questDetails("prologue");
  check("main-quest detail", prologue && prologue.objectives.length >= 1);

  // onDiscover callback
  let fired = [];
  const cd = new CodexSystem({ storage: null, onDiscover: (s, id) => fired.push(s + ":" + id) });
  cd.discover("locations", "cornelia");
  check("onDiscover fires", fired.join(",") === "locations:cornelia");

  return out;
}
