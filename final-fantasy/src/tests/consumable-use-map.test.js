// Validation tests for Task #72: Consumable Use-Case Mapping.

import { ConsumableUseCaseMapper, consumableUseCase, CONSUMABLE_USE_CASES } from "../engine/consumables.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const mapper = new ConsumableUseCaseMapper(ITEMS);
  const all = Object.values(ITEMS).filter((i) => i.type === "consumable");

  check("consumable database has items", all.length >= 8);

  // Every consumable must map to a known use case.
  const report = mapper.validate();
  const unresolved = report.filter((r) => !r.ok);
  check("every consumable resolves to a use case", unresolved.length === 0, JSON.stringify(unresolved.map((r) => r.itemId + ": " + r.error)));

  // Categories cover all effect kinds.
  const kinds = new Set(all.map((i) => i.effect.kind));
  for (const kind of kinds) {
    check("use case exists for kind " + kind, kind in CONSUMABLE_USE_CASES);
  }

  // Specific mappings.
  const potionUse = mapper.useCase("potion");
  check("potion maps to hp_recovery", potionUse === "hp_recovery");
  check("potion recovery amount", mapper.recovery("potion") === 30);
  check("ether maps to mp_recovery", mapper.useCase("ether") === "mp_recovery");
  check("ether recovery amount", mapper.recovery("ether") === 10);
  check("elixir maps to full_restore", mapper.useCase("elixir") === "full_restore");
  check("cottage maps to party_recovery", mapper.useCase("cottage") === "party_recovery");
  check("antidote maps to status_cure", mapper.useCase("antidote") === "status_cure");
  check("antidote cures poison", mapper.curesStatus("antidote") === "poison");
  check("eyeDrops cures sleep", mapper.curesStatus("eyeDrops") === "sleep");
  check("soft cures stone", mapper.curesStatus("soft") === "stone");
  check("goldNeedle cures paralysis", mapper.curesStatus("goldNeedle") === "paralysis");
  check("phoenixDown maps to revive", mapper.useCase("phoenixDown") === "revive");
  check("fireScroll maps to spell_learning", mapper.useCase("fireScroll") === "spell_learning");

  // Every status ailment in the game has a curing consumable.
  const curable = new Set(all.filter((i) => i.effect.kind === "cureStatus").map((i) => i.effect.status));
  for (const status of ["poison", "sleep", "paralysis", "stone"]) {
    check("consumable cures " + status, curable.has(status));
  }

  // Description strings are usable in UI.
  const desc = mapper.describe("potion");
  check("describe returns item + use case", typeof desc === "string" && desc.includes("Potion") && desc.includes("Restores HP"));

  // Non-consumables are excluded from validation.
  const sword = Object.values(ITEMS).find((i) => i.type === "weapon");
  const weaponReport = mapper.validate().some((r) => r.itemId === sword.id);
  check("weapons excluded from consumable audit", !weaponReport);

  return out;
}
