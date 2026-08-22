// Validation tests for Task #166: Main Menu "Continue" Logic — the title
// screen consults the most recent save and offers it on the Continue row.

import { TitleController, TITLE_ACTIONS } from "../engine/title.js";
import { SaveSlotSystem } from "../engine/save-slots.js";
import { SaveManager } from "../engine/save.js";

function stubSlots(entries) {
  // entries: array of [slot, savedAt, metaOverrides]
  const map = new Map();
  for (const [slot, savedAt, extra] of entries) {
    map.set(slot, { slot, savedAt, name: "Slot " + slot, level: 5, gold: 150, location: "cornelia (6,6)", ...extra });
  }
  return {
    any: () => map.size > 0,
    has: (s) => map.has(s),
    meta: (s) => map.get(s) ?? null,
    mostRecent: () => {
      let best = null;
      for (const [slot, meta] of map) {
        if (!best || meta.savedAt > best.meta.savedAt) best = { slot, meta };
      }
      return best;
    },
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // Empty slots: Continue is disabled and carries no recent save.
  const empty = new TitleController({ slots: stubSlots([]) });
  const mi = empty.menuItems();
  check("continue disabled with no saves", mi[1].action === TITLE_ACTIONS.CONTINUE && mi[1].enabled === false);
  check("no recent info with no saves", (mi[1].recent ?? null) === null);
  check("mostRecent null with no saves", empty.mostRecent() === null);

  // Two saves; B was written last.
  const ctl = new TitleController({ slots: stubSlots([["A", 100], ["B", 200]]) });
  const recent = ctl.mostRecent();
  check("mostRecent picks newest save", recent?.slot === "B" && recent.meta.savedAt === 200);
  const menu = ctl.menuItems();
  check("continue enabled with saves", menu[1].enabled === true);
  check("continue carries recent meta", menu[1].recent?.slot === "B");

  // Opening the slots in Continue mode lands the cursor on the most recent.
  ctl.openSlots(false);
  check("continue mode cursor on recent slot", ctl.mode === "slots" && ctl.currentSlot.slot === "B" && ctl.cursor === 1);

  // Confirming right away continues into the most recent save.
  let picked = null;
  ctl.onSelect = (action, slot) => { picked = { action, slot }; };
  ctl.confirm();
  check("confirm resumes most recent save", picked?.action === TITLE_ACTIONS.CONTINUE && picked?.slot === "B");

  // Delete mode must NOT jump the cursor to the recent save (stays at 0).
  ctl.setMode("menu");
  ctl.openSlots(true);
  check("delete mode cursor stays first", ctl.armed === true && ctl.currentSlot.slot === "A");

  // A single save still resolves.
  const single = new TitleController({ slots: stubSlots([["C", 300]]) });
  single.openSlots(false);
  check("single save preselected", single.currentSlot.slot === "C");

  // Real SaveSlotSystem drives the same mostRecent the controller reads.
  const real = new SaveSlotSystem();
  check("real slots has no saves", real.any() === false);
  const stubManager = {
    has: () => false,
    store: () => {},
    delete: () => {},
    raw: () => null,
  };
  const fake = new SaveSlotSystem({ manager: stubManager });
  check("fake slots mostRecent null", fake.mostRecent() === null);
  check("fake slots list empty", fake.list().length === 3 && fake.list().every((s) => s.has === false));

  return out;
}
