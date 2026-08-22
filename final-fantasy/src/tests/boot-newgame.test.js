// Validation tests for Task #202: GameBootSystem.newGame — a fresh adventure
// is rebuilt IN PLACE onto the live game objects, so every system holding a
// reference to state/party/inventory keeps working.

import { GameBootSystem } from "../engine/boot.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

function buildMutatedWorld() {
  const state = new GameState();
  const party = new PartyManager({ gold: 9999 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  hero.level = 12;
  hero.damage(30);
  hero.addStatus("poison");
  party.add(hero);
  party.add(new Character({ id: "ranger", name: "Ranger", classId: "thief" }));
  party.add(new Character({ id: "beast", name: "Beast", classId: "monk" }));
  party.add(new Character({ id: "extra", name: "Extra", classId: "redMage" }));
  const inv = new Inventory();
  inv.add("masamune", 1);
  inv.add("elixir", 4);
  inv.add("shatteredBlade", 1);
  state.setParty(party);
  state.setInventory(inv);
  state.setLocation("glacierport", 5, 5, "N");
  state.setStoryPhase(9);
  state.playTimeSec = 9999;
  state.setFlag("story_chrono_defeated", true);
  state.setFlag("waystone_cornelia", true);
  state.setFlag("ngplus_cycle", 3);
  return { state, party, inventory: inv };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const world = buildMutatedWorld();
  const boot = new GameBootSystem({ state: world.state, party: world.party, inventory: world.inventory });
  const res = boot.newGame();

  check("returns ok + fresh", res.ok === true && res.fresh === true);
  check("state object identity preserved", boot.state === world.state);
  check("party object identity preserved", boot.party === world.party);
  check("inventory object identity preserved", boot.inventory === world.inventory);

  check("location reset to cornelia", world.state.location.mapId === "cornelia" && world.state.location.x === 7 && world.state.location.y === 5);
  check("story phase reset", world.state.getStoryPhase() === 0);
  check("play time reset", world.state.playTimeSec === 0);
  check("flags wiped", world.state.getFlag("story_chrono_defeated") === false && world.state.getFlag("waystone_cornelia") === false);
  check("intro flag set", world.state.getFlag("intro_seen") === true);
  check("ngplus cycle cleared", (world.state.flags["ngplus_cycle"] ?? 1) === 1);

  check("party count reset to 3", world.party.members.length === 3);
  check("reserve emptied", world.party.reserve.length === 0);
  check("gold reset", world.party.gold === 150);
  check("extra member gone", !world.party.members.some((m) => m.id === "extra"));
  check("hero is fresh level 1", world.party.members[0].level === 1);
  check("hero fully healed", world.party.members[0].hp === world.party.members[0].getStats().maxHp);
  check("hero poison cleared", world.party.members[0].hasStatus("poison") === false);
  check("classes correct", world.party.members.map((m) => m.classId).join(",") === "warrior,blackMage,whiteMage");

  check("inventory stacks cleared", world.inventory.usedSlots() === 2);
  check("potion x5", world.inventory.count("potion") === 5);
  check("crystal key x1", world.inventory.count("crystalKey") === 1);
  check("endgame gear gone", world.inventory.count("masamune") === 0 && world.inventory.count("shatteredBlade") === 0);

  check("booted flag set", boot.booted === true);
  check("no active slot on new game", boot.activeSlot === null);

  // Idempotence: running newGame twice after more mutation resets again.
  world.party.gold = 5000;
  world.inventory.add("phoenixDown", 2);
  world.state.setFlag("king_met", true);
  world.state.setLocation("chaos_shrine", 1, 1, "W");
  boot.newGame();
  check("second newGame is idempotent", world.party.gold === 150 && world.inventory.usedSlots() === 2 && world.state.location.mapId === "cornelia" && world.state.getFlag("king_met") === false);

  // GameOver checkpoint wired when provided.
  let cp = null;
  const fakeGameOver = { savepoint: (m, x, y, f, n) => { cp = { m, x, y, f, n }; } };
  const boot2 = new GameBootSystem({ state: world.state, party: world.party, inventory: world.inventory, gameOver: fakeGameOver });
  boot2.newGame();
  check("checkpoint set on new game", cp?.m === "cornelia" && cp?.x === 7 && cp?.y === 5 && cp?.n === "Cornelia");

  return out;
}
