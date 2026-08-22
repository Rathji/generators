// Validation tests for Task #158: Turn-Order Visual Queue — the upcoming
// turn order as a labeled sidebar list, with the current actor tracked and
// round re-rolls from the survivors.

import { TurnOrderQueue } from "../engine/turn-order.js";
import { TurnQueueView } from "../engine/turn-queue-view.js";

function combatant(id, agi, hp = 20) {
  return { id, name: id, agi, hp, maxHp: 30, getStats: () => ({ agi }) };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const hero = combatant("Hero", 12);
  const mage = combatant("Mage", 8);
  const imp = combatant("Imp", 15);
  const goblin = combatant("Goblin", 6);
  const party = [hero, mage];
  const enemies = [imp, goblin];

  const queue = new TurnOrderQueue({ random: () => 0.5 });
  const view = new TurnQueueView({ queue });

  const order = view.build([...party, ...enemies], party);
  check("build returns order", order.length === 4);
  check("highest agi first", order[0] === imp);

  const items = view.items();
  check("items labeled by side", items[0].side === "enemy" && items[1].side === "party");
  check("items carry hp", items[0].hp === 20);
  check("nothing active before next()", items.every((i) => i.active === false));

  const first = view.next();
  check("next returns the actor", first.actor === imp && first.side === "enemy" && first.remaining === 3);
  check("next marks it active", view.items()[0].active === true);
  view.next();
  check("second actor", view.current === hero);

  // render() marks the current actor and stars enemies.
  const rendered = view.render();
  check("render names the actors", rendered.includes("Imp") && rendered.includes("Hero"));
  check("render stars enemies", rendered.split("Imp")[1].startsWith("*"));

  // Kill a combatant -> endRound rebuilds from survivors.
  goblin.hp = 0;
  const round = view.endRound();
  check("endRound bumps round", round.round === 1);
  check("endRound drops the dead", view.items().length === 3);
  check("dead excluded", view.items().every((i) => i.actor !== goblin));
  check("current cleared", view.current === null);

  // Queue-free construction still renders sides.
  const solo = new TurnQueueView();
  solo.build([hero, imp], [hero]);
  check("queue-free render", solo.render().split("Imp")[1].startsWith("*") && solo.render().includes("Hero"));

  return out;
}
