// Validation tests for Task #206: the TitleController state machine —
// menu vs slots modes, cursor movement, continue/delete enablement, and
// action dispatch.

import { TitleController, TITLE_ACTIONS } from "../engine/title.js";
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

  const slots = new SaveSlotSystem();
  const actions = [];
  const ctl = new TitleController({ slots, onSelect: (a, s) => actions.push([a, s]) });

  // Empty slots: New Game enabled, Continue/Delete disabled.
  let items = ctl.menuItems();
  check("menu has three items", items.length === 3);
  check("new enabled with no saves", items[0].enabled === true && items[0].action === "new");
  check("continue disabled with no saves", items[1].enabled === false && items[1].action === "continue");
  check("delete disabled with no saves", items[2].enabled === false && items[2].action === "delete");

  // New Game dispatches immediately.
  ctl.cursor = 0;
  ctl.confirm();
  check("new dispatches", actions.some(([a]) => a === TITLE_ACTIONS.NEW));
  check("new stays in menu", ctl.mode === "menu");

  // Continue with no saves does nothing.
  ctl.cursor = 1;
  check("continue with no saves refused", ctl.confirm() === false);

  // Drop a save in, re-test.
  const state = new GameState();
  const party = new PartyManager({ gold: 200 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const inv = new Inventory();
  state.setParty(party);
  state.setInventory(inv);
  slots.write("A", { state, party, inventory: inv });

  items = ctl.menuItems();
  check("continue enabled after save", items[1].enabled === true);
  check("delete enabled after save", items[2].enabled === true);

  // Continue -> slots mode, empty slot not selectable, full slot dispatches.
  actions.length = 0;
  ctl.cursor = 1;
  check("continue opens slots", ctl.confirm() === true && ctl.mode === "slots");
  check("slots list has three entries", ctl.slotItems().length === 3);
  const full = ctl.slotItems().find((s) => s.has);
  check("full slot detected", !!full && full.slot === "A");
  check("empty slot has no meta", ctl.slotItems().find((s) => !s.has).meta === null);

  ctl.cursor = ctl.slotItems().findIndex((s) => s.has);
  const wasEmpty = ctl.cursor;
  ctl.cursor = 1; // slot B (empty)
  check("empty slot refused in continue", ctl.confirm() === false);
  ctl.cursor = 0; // slot A (full)
  ctl.confirm();
  check("continue dispatches slot", actions.some(([a, s]) => a === TITLE_ACTIONS.CONTINUE && s === "A"));

  // back() returns to menu and re-arms the cursor.
  ctl.setMode("menu");
  ctl.openSlots(true);
  check("armed slots mode", ctl.armed === true);
  ctl.back();
  check("back returns to menu", ctl.mode === "menu" && ctl.armed === false);
  check("back at root does nothing", ctl.back() === false);

  // Delete flow erases the slot via the controller.
  check("slot exists before delete", slots.has("A") === true);
  ctl.openSlots(true);
  ctl.cursor = 0;
  ctl.confirm();
  check("delete erased the slot", slots.has("A") === false);
  check("delete stays armed for more", ctl.armed === true);

  // Cursor movement wraps.
  ctl.setMode("menu");
  ctl.cursor = 0;
  ctl.move(-1);
  check("cursor wraps upward", ctl.currentMenu.action === "delete");
  ctl.move(1);
  check("cursor wraps downward to new", ctl.currentMenu.action === "new");

  return out;
}
