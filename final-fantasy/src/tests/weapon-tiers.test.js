// Validation tests for Task #110: weapon tier progression.

import { GearTierSystem } from "../engine/gear-tiers.js";
import { WEAPON_TIERS } from "../data/gear-tiers.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const gear = new GearTierSystem();

  const dag = gear.tierOf("dagger");
  check("dagger is sword tier 1", dag.kind === "weapon" && dag.chainName === "sword" && dag.index === 0 && dag.size === 11);
  check("dagger next is ironSword", dag.next === "ironSword");
  check("dagger has no prev", dag.prev === null);

  const top = gear.tierOf("shatteredBlade");
  check("shatteredBlade at chain top", top.index === top.size - 1 && top.next === null);

  check("isUpgrade dagger->mythrilSword", gear.isUpgrade("dagger", "mythrilSword") === true);
  check("isUpgrade reverse false", gear.isUpgrade("mythrilSword", "dagger") === false);
  check("isUpgrade same item false", gear.isUpgrade("dagger", "dagger") === false);
  check("isUpgrade cross-chain false", gear.isUpgrade("dagger", "staff") === false);
  check("isUpgrade unknown false", gear.isUpgrade("dagger", "nope") === false);

  const path = gear.upgradePath("dagger");
  check("upgradePath length 10", path.length === 10);
  check("upgradePath ends at shatteredBlade", path[path.length - 1] === "shatteredBlade");
  check("upgradePath monotonic", path.join(",") === WEAPON_TIERS.sword.slice(1).join(","));
  check("top item empty path", gear.upgradePath("shatteredBlade").length === 0);

  check("nextTier dagger -> ironSword", gear.nextTier("dagger") === "ironSword");
  check("prevTier ironSword -> dagger", gear.prevTier("ironSword") === "dagger");
  check("tierOf unknown null", gear.tierOf("nope") === null);

  const desc = gear.describe("ironSword");
  check("describe has name + tier", desc.name === "Iron Sword" && desc.tier === 2 && desc.summary.includes("tier 2/11"));

  for (const [chain, ids] of Object.entries(WEAPON_TIERS)) {
    for (const id of ids) {
      const item = ITEMS[id];
      check("chain " + chain + " item " + id + " exists as weapon", item && item.type === "weapon");
    }
  }

  const audit = gear.audit();
  check("weapon audit ok", audit.ok === true);
  check("weapon audit clean issues", audit.issues.length === 0);

  return out;
}
