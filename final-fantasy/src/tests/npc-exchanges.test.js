// Validation tests for Task #140: NPC Inventory Interaction — giving
// specific items to NPCs to trigger dialogue/rewards.

import { NpcExchangeSystem } from "../engine/npc-exchanges.js";
import { NPC_EXCHANGES } from "../data/npc-exchanges.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { GameState } from "../engine/state.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const inv = new Inventory({ maxSlots: 30, maxWeight: 200 });
  const party = new PartyManager({ gold: 50 });
  party.add(new Character({ id: "h", name: "Hero", classId: "warrior" }));
  const state = new GameState();
  const sys = new NpcExchangeSystem(NPC_EXCHANGES, { state, party, inventory: inv });

  check("exchanges defined", sys.all().length >= 3);
  check("accepts() maps npc+item", sys.accepts("cornelia_blacksmith", "goblinFang")?.id === "cornelia_fangs");
  check("accepts() null for unknown", sys.accepts("cornelia_blacksmith", "potion") === null);

  // Not enough fangs -> no offer.
  inv.add("goblinFang", 2);
  check("canOffer blocked by shortfall", sys.canOffer("cornelia_fangs").ok === false);

  // Give 3 fangs -> gold reward, fangs consumed.
  inv.add("goblinFang", 1);
  const goldBefore = party.gold;
  const r = sys.offer("cornelia_fangs");
  check("offer succeeds with enough item", r.ok === true);
  check("item consumed", inv.count("goblinFang") === 0);
  check("gold granted", party.gold === goldBefore + 120 && r.gold === 120);
  check("repeatable exchange still open", sys.isDone("cornelia_fangs") === false);

  // Once-only exchange: trade spirit essence for a thunder gem.
  inv.add("spiritEssence", 2);
  const gem = sys.offer("dwarfholm_essence");
  check("gem exchange ok", gem.ok === true && inv.has("thunderGem", 1));
  check("essence consumed", inv.count("spiritEssence") === 0);
  check("exchange marked done", sys.isDone("dwarfholm_essence") === true);
  check("cannot re-offer a done exchange", sys.offer("dwarfholm_essence").ok === false);
  check("offersFor excludes done", sys.offersFor("dwarfholm_gemcutter").length === 0);

  // describe + status.
  check("describe", typeof sys.describe("cornelia_fangs") === "string" && sys.describe("cornelia_fangs").includes("3x goblinFang"));
  check("status lists done state", sys.status().find((s) => s.id === "dwarfholm_essence")?.done === true);

  // Audit against real data.
  check("audit clean", sys.audit(NPC_PLACEMENTS, ITEMS).length === 0);

  return out;
}
