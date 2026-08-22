// Validation tests for Task #48: Game-Over & Reset State.

import { GameOverSystem } from "../engine/gameover.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { GameState } from "../engine/state.js";
import { SaveManager } from "../engine/save.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const party = new PartyManager({ gold: 100 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  party.add(hero);
  party.add(mage);
  const state = new GameState();
  state.setLocation("cornelia_inn", 4, 4, "N");
  const saves = new SaveManager();

  const g = new GameOverSystem({ party, state, saves });

  check("no checkpoint yet", g.hasCheckpoint === false);
  g.savepoint("cornelia", 6, 7, "S", "Cornelia Gate");
  check("checkpoint stored", g.hasCheckpoint === true && g.checkpointInfo.name === "Cornelia Gate");

  hero.damage(999);
  mage.damage(999);
  check("party wipe detected", g.allDown() === true);

  const res = g.check();
  check("game over handled", res.status === "revived" && res.reason === "party_wipe");
  check("revived at half HP", hero.hp === Math.floor(hero.getStats().maxHp * 0.5) && mage.hp === Math.floor(mage.getStats().maxHp * 0.5));
  check("gold penalty applied", party.gold === 50);
  check("location restored to checkpoint", state.getLocation().mapId === "cornelia" && state.getLocation().x === 6 && state.getLocation().y === 7);
  check("game over counted", g.gameOverCount === 1);

  g.clearCheckpoint();
  hero.damage(999);
  mage.damage(999);
  const reset = g.handleGameOver();
  check("no checkpoint -> title reset", reset.title === true && reset.reset === true);

  const fresh = new PartyManager({ gold: 0 });
  const a = new Character({ id: "a", name: "A", classId: "warrior" });
  fresh.add(a);
  const go = new GameOverSystem({ party: fresh });
  check("healthy party is ok", go.check().status === "ok");
  a.damage(999);
  const zero = go.handleGameOver();
  check("zero gold party avoids penalty", zero.status === "game_over" && fresh.gold === 0);

  const g2 = new GameOverSystem({ party: fresh, state, reviveFrac: 1, goldPenalty: 0.1 });
  g2.savepoint("overworld", 3, 3);
  fresh.gold = 100;
  g2.handleGameOver();
  check("custom revive fraction", a.hp === a.getStats().maxHp);
  check("custom gold penalty", fresh.gold === 90);

  const events = [];
  const g3 = new GameOverSystem({ party: fresh, state, onGameOver: (r) => events.push(r.status), onRevive: (r) => events.push("revived:" + r.location.mapId) });
  g3.savepoint("overworld", 1, 1);
  fresh.gold = 10;
  g3.handleGameOver();
  check("hooks fired in order", events[0] === "game_over" && events[1] === "revived:overworld");

  const t = g3.toTitle();
  check("toTitle resets", t.status === "title" && g3.hasCheckpoint === false && state.getLocation().mapId === "title");

  check("revive clears statuses", (() => {
    const p2 = new PartyManager();
    const c = new Character({ id: "c", name: "C", classId: "monk" });
    c.addStatus("poison");
    c.damage(999);
    p2.add(c);
    const gg = new GameOverSystem({ party: p2 });
    gg.savepoint("overworld", 0, 0);
    gg.handleGameOver();
    return c.statuses.length === 0 && c.hp > 0;
  })());

  return out;
}
