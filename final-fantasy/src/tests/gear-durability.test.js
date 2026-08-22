// Validation tests for Task #145: Gear Durability/Break System — high-tier
// gear breaks after battles and requires repair.

import { GearDurabilitySystem } from "../engine/gear-durability.js";
import { GEAR_DURABILITY } from "../data/gear-durability.js";
import { ITEMS } from "../data/items.js";
import { Character } from "../engine/character.js";
import { PartyManager } from "../engine/party.js";
import { serializeGame, deserializeGame } from "../engine/save.js";
import { setBrokenItems } from "../engine/stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const party = new PartyManager({ gold: 50000 });
  const sys = new GearDurabilitySystem(GEAR_DURABILITY, { random: () => 0.5, party });

  check("defs cover high-tier gear", GEAR_DURABILITY.luminary?.max >= 20 && GEAR_DURABILITY.masamune?.max >= 30);

  const hero = new Character({ id: "h", name: "Hero", classId: "warrior" });
  hero.equipment.weapon = "frozenBlade"; // tracked
  hero.equipment.armor = "chain"; // NOT tracked — cheap gear never wears
  party.add(hero);

  // A break roll never succeeds with rng 0.5 against breakChance 0.05.
  check("no wear when roll misses", sys.afterBattle(hero).length === 0);
  check("untracked gear has no wear record", sys.durabilityOf(hero, "chain") === null);

  // Force breaks with a tiny rng.
  const fragile = new GearDurabilitySystem(GEAR_DURABILITY, { random: () => 0, party });
  const events = fragile.afterBattle(hero);
  check("wear event on break roll", events.length === 1 && events[0].itemId === "frozenBlade" && events[0].durability === 25);
  check("durability recorded", fragile.durabilityOf(hero, "frozenBlade")?.cur === 25);

  // Fight until the blade breaks.
  let broken = false;
  let fights = 0;
  while (!broken && fights < 100) {
    const ev = fragile.afterBattle(hero);
    broken = ev.some((e) => e.broken);
    fights++;
  }
  check("blade breaks eventually", broken === true);
  check("isBroken true", fragile.isBroken(hero, "frozenBlade") === true);
  check("brokenItems lists it", fragile.brokenItems(hero).includes("frozenBlade"));
  check("brokenSet for stats", fragile.brokenSet(hero).has("frozenBlade"));

  // Broken gear stops contributing stats (stats.js hook).
  const base = new Character({ id: "b", name: "Base", classId: "warrior" });
  base.equipment.weapon = "frozenBlade";
  setBrokenItems(() => new Set());
  const workingAtk = base.getStats().atk;
  setBrokenItems(() => new Set(["frozenBlade"]));
  const brokenAtk = base.getStats().atk;
  check("broken blade grants no atk", brokenAtk === 0 && brokenAtk === workingAtk - (ITEMS.frozenBlade.mods.atk ?? 0));
  setBrokenItems(null);

  // Repair restores durability and costs gold.
  const cost = fragile.repairCost(hero, "frozenBlade");
  check("repair cost positive", cost > 0);
  const goldBefore = party.gold;
  const rep = fragile.repair(hero, "frozenBlade");
  check("repair ok", rep.ok === true && rep.itemId === "frozenBlade");
  check("gold charged", party.gold === goldBefore - cost);
  check("durability restored", fragile.durabilityOf(hero, "frozenBlade")?.cur === fragile.durabilityOf(hero, "frozenBlade")?.max);
  check("no longer broken", fragile.isBroken(hero, "frozenBlade") === false);
  check("repairing pristine rejected", fragile.repair(hero, "frozenBlade").ok === false);

  // repairAllParty only touches what is damaged.
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });
  mage.equipment.armor = "chronoMail";
  party.add(mage);
  const prist = new GearDurabilitySystem(GEAR_DURABILITY, { random: () => 0.5, party });
  check("pristine party needs no repairs", prist.repairAllParty(party.members).filter((r) => r.ok).length === 0);

  // summary + audit.
  const summ = fragile.summary(hero);
  check("summary lists wear", summ.some((s) => s.itemId === "frozenBlade" && s.max > 0));
  check("durability audit clean", new GearDurabilitySystem(GEAR_DURABILITY).audit().length === 0);

  // Save round-trip: gearWear is additive and survives serialize/deserialize.
  const game = { state: null, party, inventory: null };
  const json = serializeGame(game);
  const loaded = deserializeGame(json);
  const loadedHero = loaded.party.members.find((m) => m.id === "h");
  check("gearWear survives save", loadedHero.gearWear && loadedHero.gearWear.frozenBlade?.cur === loadedHero.gearWear.frozenBlade?.max);

  return out;
}
