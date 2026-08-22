// Validation tests for Task #111: armor tier progression.

import { GearTierSystem } from "../engine/gear-tiers.js";
import { ARMOR_TIERS } from "../data/gear-tiers.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const gear = new GearTierSystem();

  const cloth = gear.tierOf("cloth");
  check("cloth is heavy tier 1", cloth.kind === "armor" && cloth.chainName === "heavy" && cloth.index === 0 && cloth.size === 6);
  check("cloth next is leather", cloth.next === "leather");

  const top = gear.tierOf("chronoMail");
  check("chronoMail at chain top", top.index === top.size - 1 && top.next === null);

  check("isUpgrade cloth->runePlate", gear.isUpgrade("cloth", "runePlate") === true);
  check("isUpgrade reverse false", gear.isUpgrade("runePlate", "cloth") === false);
  check("isUpgrade chain false (plate is heavy, rimeMail forged)", gear.isUpgrade("plate", "rimeMail") === false);
  check("isUpgrade mage line true", gear.isUpgrade("robe", "frostCloak") === true);

  const path = gear.upgradePath("cloth");
  check("upgradePath cloth length 5", path.length === 5);
  check("upgradePath ends chronoMail", path[path.length - 1] === "chronoMail");
  check("upgradePath matches heavy chain", path.join(",") === ARMOR_TIERS.heavy.slice(1).join(","));

  check("tierOf robe is mage", gear.tierOf("robe").chainName === "mage");
  check("tierOf unknown null", gear.tierOf("nope") === null);

  const desc = gear.describe("plate");
  check("describe has name + tier", desc.name === "Plate Armor" && desc.tier === 4 && desc.summary.includes("tier 4/6"));

  for (const [chain, ids] of Object.entries(ARMOR_TIERS)) {
    for (const id of ids) {
      const item = ITEMS[id];
      check("chain " + chain + " item " + id + " exists as armor", item && item.type === "armor");
    }
  }

  const audit = gear.audit();
  check("armor audit ok", audit.ok === true);

  const report = gear.report();
  check("report lists weapon + armor chains", report.weapon.length > 0 && report.armor.length > 0);

  return out;
}
