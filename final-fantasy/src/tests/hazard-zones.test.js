// Validation tests for Task #147: Environmental Damage Zones — lava/acid
// dealing damage per step unless gear-protected.

import { HazardZoneSystem } from "../engine/hazard-zones.js";
import { HAZARD_ZONES } from "../data/hazard-zones.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { StatusEffectSystem } from "../engine/status.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function registry() {
  const m = new MapManager();
  for (const d of MAPS) m.register(d);
  return m;
}

function makeParty(withMagmaHeart = false) {
  const party = new PartyManager({ gold: 100 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  if (withMagmaHeart) hero.equipment.accessory = "magmaHeart";
  party.add(hero);
  party.add(mage);
  return party;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const status = new StatusEffectSystem({ random: () => 0.2 });
  const protectionHook = (zone, party) =>
    zone.element === "fire" && party.members.some((m) => m.equipment?.accessory === "magmaHeart");
  const party = makeParty(false);
  const hazards = new HazardZoneSystem(HAZARD_ZONES, { state, party, status, random: () => 0.2, protectionHook });

  check("hazard data present", HAZARD_ZONES.length >= 2);
  check("zoneAt finds ember lava", hazards.zoneAt("ember_sanctum", 13, 2)?.id === "ember_lava");
  check("no zone elsewhere", hazards.step("ember_sanctum", 5, 5).error === "no hazard");

  const heroBefore = party.members[0].hp;
  const r = hazards.step("ember_sanctum", 13, 2);
  check("lava burns the party", r.ok === true && r.protected === false && r.damage === 9);
  check("party HP reduced", party.members[0].hp === heroBefore - 9);

  const acid = hazards.step("marsh_cave", 10, 1);
  check("acid seeps on the marsh path", acid.ok === true && acid.zone.name.includes("Acid"));
  check("acid can poison", party.members.some((m) => m.hasStatus("poison")));

  // Gear protection: the Magma Heart accessory cancels fire-zone damage.
  const safeParty = makeParty(true);
  const safe = new HazardZoneSystem(HAZARD_ZONES, { state, party: safeParty, status, random: () => 0.2, protectionHook });
  const sp = safeParty.members[0].hp;
  const rr = safe.step("ember_sanctum", 13, 2);
  check("magma heart protects from lava", rr.ok === true && rr.protected === true && rr.damage === 0);
  check("protected party takes no damage", safeParty.members[0].hp === sp);

  check("every zone tile is walkable", hazards.audit(registry()).length === 0);

  return out;
}
