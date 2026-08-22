// Validation tests for Task #68: Mana Regeneration Logic.

import { ManaRegenSystem } from "../engine/mana-regen.js";
import { Character } from "../engine/character.js";
import { InnSystem } from "../engine/inn.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const regen = new ManaRegenSystem();

  const blackMage = new Character({ id: "bm", name: "Black Mage", classId: "blackMage" });
  const whiteMage = new Character({ id: "wm", name: "White Mage", classId: "whiteMage" });
  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });

  check("casters regen", regen.regenRate(blackMage) > 0 && regen.regenRate(whiteMage) > 0);
  check("warrior no regen", regen.regenRate(warrior) === 0);
  check("black mage rate", regen.regenRate(blackMage) === 1 + Math.floor(6 / 3)); // 3

  blackMage.spendMp(10);
  const r = regen.regen(blackMage);
  check("regen restores", r.ok === true && r.restored === 3 && blackMage.mp === blackMage.getStats().maxMp - 10 + 3);

  blackMage.mp = blackMage.getStats().maxMp - 1;
  const capped = regen.regen(blackMage);
  check("regen caps at max", capped.ok === true && blackMage.mp === blackMage.getStats().maxMp);

  const noRegen = regen.regen(warrior);
  check("warrior regen noop", noRegen.ok === false);

  const party = [blackMage, whiteMage, warrior];
  blackMage.mp = 1;
  whiteMage.mp = 1;
  const ticks = regen.tick(party);
  check("tick returns entries for casters only", ticks.length === 2 && ticks.every((t) => t.restored > 0));
  check("warrior untouched", warrior.mp === warrior.getStats().maxMp);

  check("ether amount", regen.itemAmount("ether") === 10);
  check("potion not mp", regen.itemAmount("potion") === null);

  const inn = new InnSystem({ party: { members: party } });
  blackMage.mp = 5;
  const rec = regen.innRecovery(party);
  check("inn restores all mp", rec.ok === true && blackMage.mp === blackMage.getStats().maxMp && rec.restored > 0);
  check("inn helper integrated", typeof inn.canRest === "function");

  return out;
}
