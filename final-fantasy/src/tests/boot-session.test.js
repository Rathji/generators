// Validation tests for Task #205: boot session management — saving to the
// current slot, autosave on rest, and quitting back to the title screen.

import { GameBootSystem } from "../engine/boot.js";
import { SaveSlotSystem } from "../engine/save-slots.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const party = new PartyManager({ gold: 150 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  const inv = new Inventory();
  inv.add("potion", 5);
  state.setParty(party);
  state.setInventory(inv);
  state.setLocation("cornelia", 7, 5, "S");

  const gameOver = new (class {
    constructor() { this.checkpoint = null; }
    savepoint(m, x, y, f, n) { this.checkpoint = { m, x, y, f, n }; }
    autoCheckpoint() { const l = state.getLocation(); this.savepoint(l.mapId, l.x, l.y, l.facing, "Last Location"); }
    toTitle() { this.checkpoint = null; }
  })();

  const slots = new SaveSlotSystem();
  const boot = new GameBootSystem({ state, party, inventory: inv, slots, gameOver });
  boot.newGame();

  // autosave with no active slot is refused.
  const pre = boot.autosave();
  check("autosave refused without active slot", pre.ok === false && pre.reason === "no_active_slot");

  // Save to a slot explicitly -> becomes active.
  const sv = boot.saveCurrent("C");
  check("saveCurrent ok", sv.ok === true && boot.activeSlot === "C");
  check("slot has data", slots.has("C") === true);

  // Mutate, then autosave refreshes the same slot.
  party.gold = 900;
  state.setFlag("king_met", true);
  const au = boot.autosave();
  check("autosave ok", au.ok === true);
  check("autosave kept active slot", boot.activeSlot === "C");
  check("autosave wrote current state", slots.meta("C").gold === 900 && slots.meta("C").mapId === "cornelia");

  // toTitle clears the session and the checkpoint.
  const tt = boot.toTitle();
  check("toTitle ok", tt.ok === true && tt.status === "title");
  check("booted cleared", boot.booted === false);
  check("active slot cleared", boot.activeSlot === null);
  check("location to title", state.location.mapId === "title");
  check("checkpoint cleared", gameOver.checkpoint === null);
  check("autosave after title refused", boot.autosave().reason === "no_active_slot");

  // Continue re-activates a slot.
  const cr = boot.continue("C");
  check("continue re-activates", cr.ok === true && boot.activeSlot === "C");
  check("continue restored checkpoint", gameOver.checkpoint?.m === "cornelia");

  return out;
}
