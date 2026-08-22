// Validation tests for Task #211: the Command Menu config — unique ids,
// non-empty labels, and every referenced key is real.

import { COMMAND_MENU } from "../data/menu-config.js";
import { SLOTS } from "../engine/equipment.js";
import { getEffectiveStats } from "../engine/stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("config exists", !!COMMAND_MENU && typeof COMMAND_MENU === "object");
  check("title set", typeof COMMAND_MENU.title === "string" && COMMAND_MENU.title.length > 0);

  const rootIds = new Set();
  for (const item of COMMAND_MENU.root) {
    check("root item has id+label: " + item.id, !!item.id && !!item.label);
    check("root id unique: " + item.id, !rootIds.has(item.id));
    rootIds.add(item.id);
  }
  check("five root commands", COMMAND_MENU.root.length === 5);
  check("classic command order", COMMAND_MENU.root.map((r) => r.id).join(",") === "items,magic,equip,status,formation");

  const rowIds = new Set();
  for (const row of COMMAND_MENU.statusRows) {
    check("status row has id+label: " + row.id, !!row.id && !!row.label);
    check("status row id unique: " + row.id, !rowIds.has(row.id));
    rowIds.add(row.id);
  }
  check("status has the classic stats", ["hp", "mp", "atk", "def", "int", "agi", "mdef", "str", "level"].every((k) => rowIds.has(k)));

  check("deltaKeys non-empty", Array.isArray(COMMAND_MENU.deltaKeys) && COMMAND_MENU.deltaKeys.length >= 4);
  // Every delta key must be produced by getEffectiveStats (for a 2-key-minimum
  // class) so the preview code can actually compute it.
  for (const k of COMMAND_MENU.deltaKeys) {
    const sample = getEffectiveStats({ level: 1, equipment: {} }, { id: "warrior", baseHp: 1, baseMp: 0, baseStr: 1, baseInt: 1, baseAgi: 1, baseDef: 1, baseMdef: 1, hpPerLevel: 1, mpPerLevel: 0, strPerLevel: 1, intPerLevel: 1, agiPerLevel: 1, defPerLevel: 1, mdefPerLevel: 1 }, {});
    check("delta key is a real stat: " + k, k in sample, "keys=" + Object.keys(sample).join(","));
  }

  check("slot labels cover real slots", SLOTS.every((s) => typeof COMMAND_MENU.slots[s] === "string"));
  check("keys legend present", !!COMMAND_MENU.keys.open && !!COMMAND_MENU.keys.confirm && !!COMMAND_MENU.keys.cancel);

  return out;
}
