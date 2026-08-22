// Validation tests for Task #180: The Jungle Encounter Table — the Southern
// Jungles' beasts, insects, and moss-draped dead, plus the shared ruins
// theme that deepens inside the Sunken Hall.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { ELEMENTS } from "../data/elements.js";
import { ITEMS } from "../data/items.js";
import { SPELLS } from "../data/spells.js";
import { EncounterGenerator } from "../engine/encounters.js";

const JUNGLE_MONSTERS = ["jungleBoar", "jungleViper", "venomWasp", "carrionBeetle", "vineToad", "sporeToad", "mossMummy", "mossWraith", "ruinScarab"];
const JUNGLE_GROUPS = ["jungle_beasts", "insect_swarm", "vine_drakes", "mushroom_folk", "ruin_undead", "scarab_horde", "moss_creepers"];

function allRefs(e) {
  const out = [];
  for (const k of ["weak", "resist", "immune"]) if (Array.isArray(e?.elements?.[k])) out.push(...e.elements[k]);
  return out;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  for (const id of JUNGLE_MONSTERS) {
    check("jungle monster exists: " + id, !!ENEMIES[id]);
    const m = ENEMIES[id];
    if (!m) continue;
    for (const ref of allRefs(m)) {
      if (ELEMENTS.includes(ref)) continue;
      // non-elemental refs (poison, sleep, stone, paralysis...) are statuses
      check("jungle status immunity valid: " + id, ["poison", "sleep", "stone", "paralysis"].includes(ref));
    }
    for (const l of m.loot ?? []) check("jungle monster loot exists: " + id + " -> " + l.itemId, !!ITEMS[l.itemId]);
    for (const s of m.ai?.spells ?? []) check("jungle monster spell exists: " + id + " -> " + s, !!SPELLS[s]);
  }

  for (const g of JUNGLE_GROUPS) {
    check("jungle group exists: " + g, !!ENEMY_GROUPS[g]);
    for (const member of ENEMY_GROUPS[g] ?? []) check("jungle group member exists: " + g + " -> " + member.id, !!ENEMIES[member.id]);
  }

  // The jungle table is moderate; the ruins theme runs deeper.
  const jungle = ENCOUNTERS.south_jungle;
  check("south jungle table defined", !!jungle && Array.isArray(jungle.table) && jungle.table.length >= 4);
  check("jungle rate ~0.15", jungle && typeof jungle.rate === "number" && jungle.rate > 0.1 && jungle.rate < 0.2);
  const jungleGroups = new Set((jungle?.table ?? []).map((e) => e.group));
  check("jungle table groups all exist", [...jungleGroups].every((g) => !!ENEMY_GROUPS[g]));

  const theme = ENCOUNTERS.dungeon_ruins;
  check("dungeon_ruins theme defined", !!theme && Array.isArray(theme.table) && theme.table.length >= 4);
  check("ancient_ruins_b2 uses the ruins theme", ENCOUNTERS.ancient_ruins_b2?.theme === "dungeon_ruins");
  const themeGroups = new Set((theme?.table ?? []).map((e) => e.group));
  check("ruins theme groups all exist", [...themeGroups].every((g) => !!ENEMY_GROUPS[g]));

  // The generator resolves a jungle roll to real enemies.
  const gen = new EncounterGenerator({ tables: ENCOUNTERS });
  const picked = gen.pickGroup("south_jungle");
  check("jungle roll picks a group", !!picked && JUNGLE_GROUPS.includes(picked.group));
  const forced = gen.forceEncounter("south_jungle", "ruin_undead");
  check("jungle force encounter builds enemies", !!forced && forced.enemies.length >= 2);
  const themeForced = gen.forceEncounter("ancient_ruins_b2", "scarab_horde");
  check("themed map force encounter works", !!themeForced && themeForced.enemies.length >= 2);

  // The jungle reads like the green: fire chills the boar, the toads soak
  // frost, and the moss dead fear the flame and the light.
  check("jungle boar fears frost", ENEMIES.jungleBoar.elements.weak.includes("ice"));
  check("jungle boar shrugs fire", ENEMIES.jungleBoar.elements.resist.includes("fire"));
  check("venom wasp fears wind", ENEMIES.venomWasp.elements.weak.includes("wind"));
  check("vine toad fears fire", ENEMIES.vineToad.elements.weak.includes("fire"));
  check("moss mummy fears fire", ENEMIES.mossMummy.elements.weak.includes("fire"));
  check("moss wraith fears holy", ENEMIES.mossWraith.elements.weak.includes("holy"));
  check("ruin scarab shrugs earth", ENEMIES.ruinScarab.elements.resist.includes("earth"));

  return out;
}
