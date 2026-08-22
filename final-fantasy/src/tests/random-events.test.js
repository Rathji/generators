// Validation tests for Task #135: World Map Random Event System.

import { RandomEventSystem } from "../engine/random-events.js";
import { RANDOM_EVENTS } from "../data/random-events.js";
import { ITEMS } from "../data/items.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const party = new PartyManager({ gold: 50 });
  party.add(new Character({ id: "h", name: "Hero", classId: "warrior" }));
  const sys = new RandomEventSystem({ random: () => 0, events: RANDOM_EVENTS, maps: ["overworld"], chance: 1, minGap: 1, inventory: inv, party, items: ITEMS });

  check("only overworld events", sys.allows("overworld") === true && sys.allows("cornelia") === false);
  check("no roll outside configured maps", sys.roll("cornelia") === null);

  // With chance 1 and minGap 1, a step always produces an event.
  const ev = sys.roll("overworld");
  check("roll fires on overworld", ev !== null && typeof ev.id === "string");

  // Weighted pick always returns a defined event.
  const picked = sys.pick();
  check("pick returns defined event", picked !== null && RANDOM_EVENTS.some((e) => e.id === picked.id));

  // minGap prevents back-to-back events.
  const gap = new RandomEventSystem({ random: () => 0, events: RANDOM_EVENTS, maps: ["overworld"], chance: 1, minGap: 5 });
  check("minGap suppresses first steps", gap.roll("overworld") === null);

  // Item event grants the item.
  const lostPotion = RANDOM_EVENTS.find((e) => e.id === "lost_potion");
  const rItem = sys.resolve(lostPotion);
  check("item event adds to inventory", rItem.ok === true && inv.has("potion") === true);

  // Gold event adds gold.
  const beforeGold = party.gold;
  const goldEv = RANDOM_EVENTS.find((e) => e.kind === "gold");
  const rGold = sys.resolve(goldEv);
  check("gold event adds gold", rGold.ok === true && rGold.amount >= 10 && party.gold === beforeGold + rGold.amount);

  // Heal event restores HP.
  const hero = party.members[0];
  hero.damage(Math.round(hero.getStats().maxHp * 0.5));
  const hpBefore = hero.hp;
  const healEv = RANDOM_EVENTS.find((e) => e.kind === "heal");
  const rHeal = sys.resolve(healEv);
  check("heal event restores hp", rHeal.ok === true && hero.hp > hpBefore);

  // Merchant event grants its wares.
  const merchantEv = RANDOM_EVENTS.find((e) => e.kind === "merchant");
  const rMerchant = sys.resolve(merchantEv);
  check("merchant grants item", rMerchant.ok === true && rMerchant.kind === "merchant" && inv.has("hiPotion"));

  check("describe", sys.describe(lostPotion)?.id === "lost_potion");

  // Overrides via ctx.
  const sideInv = new Inventory({ maxSlots: 5, maxWeight: 10 });
  const rCtx = sys.resolve(lostPotion, { inventory: sideInv });
  check("ctx inventory override", rCtx.ok === true && sideInv.has("potion") === true);

  // Every event is valid against the item database.
  const audit = sys.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);

  // Audit catches unknown items.
  const bad = new RandomEventSystem({ events: [{ id: "x", kind: "item", weight: 1, itemId: "nope", message: "m" }], items: ITEMS });
  check("audit flags unknown item", bad.audit().ok === false);

  return out;
}
