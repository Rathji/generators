// Validation tests for Task #146: Trap Trigger System — hidden tiles that
// spring negative effects (damage, poison, gold loss) when stepped on.

import { TrapSystem } from "../engine/traps.js";
import { TRAPS } from "../data/traps.js";
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

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const party = new PartyManager({ gold: 150 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  party.add(hero);
  party.add(mage);
  const status = new StatusEffectSystem({ random: () => 0.2 });
  const traps = new TrapSystem(TRAPS, { state, party, status, random: () => 0.2 });

  check("trap data has several traps", TRAPS.length >= 3);
  check("trapAt finds the spike pit", traps.trapAt("caves_of_cornelia", 4, 1)?.id === "cave_spike_pit");
  check("no trap on a plain tile", traps.check("caves_of_cornelia", 10, 9).error === "no trap");

  const before = hero.hp;
  const r = traps.check("caves_of_cornelia", 4, 1, 1);
  check("spike pit springs", r.ok === true && r.trap.id === "cave_spike_pit" && r.line.length > 0);
  check("whole party takes the damage", hero.hp === before - 6 && mage.hp === mage.getStats().maxHp - 6);
  check("once trap recorded by flag", state.getFlag("trap_cave_spike_pit_sprung") === true);
  check("once trap never re-springs", traps.check("caves_of_cornelia", 4, 1, 2).error === "already sprung");

  check("poison dart trap present", !!traps.trapAt("caves_of_cornelia", 11, 8));
  const p = traps.check("caves_of_cornelia", 11, 8, 1);
  check("poison dart afflicts the party", p.ok === true && hero.hasStatus("poison") && mage.hasStatus("poison"));
  check("cooldown suppresses a re-trigger", traps.check("caves_of_cornelia", 11, 8, 3).error === "rearming");
  const rearmed = traps.check("caves_of_cornelia", 11, 8, 8);
  check("cooldown trap rearms in time", rearmed.ok === true);

  const g = traps.check("overworld", 4, 3, 1);
  check("snare drains gold", g.ok === true && party.gold === 150 - 25);

  check("every trap sits on a walkable tile", traps.audit(registry()).length === 0);

  traps.reset();
  check("reset clears once flags", traps.check("caves_of_cornelia", 4, 1, 1).ok === true);

  return out;
}
