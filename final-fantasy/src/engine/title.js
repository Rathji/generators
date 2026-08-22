// Task #206: Title-screen state machine — New Game / Continue / Delete Save.
// Kept DOM-free so it can be unit-tested; the UI layer renders its state.

import { SAVE_SLOT_IDS } from "./save-slots.js";

export const TITLE_ACTIONS = Object.freeze({
  NEW: "new",
  CONTINUE: "continue",
  DELETE: "delete",
});

export class TitleController {
  constructor(opts = {}) {
    this.slots = opts.slots ?? null;
    this.onSelect = opts.onSelect ?? null; // (action, slotId) => void
    this.mode = "menu"; // "menu" | "slots"
    this.cursor = 0;
    this.armed = false; // slots mode entered via Delete
  }

  menuItems() {
    const any = this.slots?.any() ?? false;
    return [
      { action: TITLE_ACTIONS.NEW, label: "New Game", key: "N", enabled: true },
      { action: TITLE_ACTIONS.CONTINUE, label: "Continue", key: "C", enabled: any },
      { action: TITLE_ACTIONS.DELETE, label: "Delete Save", key: "D", enabled: any },
    ];
  }

  get currentMenu() {
    const items = this.menuItems();
    return items[Math.max(0, Math.min(this.cursor, items.length - 1))] ?? null;
  }

  slotItems() {
    return SAVE_SLOT_IDS.map((id) => ({
      slot: id,
      has: this.slots?.has(id) ?? false,
      meta: this.slots?.meta(id) ?? null,
    }));
  }

  get currentSlot() {
    const items = this.slotItems();
    return items[Math.max(0, Math.min(this.cursor, items.length - 1))] ?? null;
  }

  items() {
    return this.mode === "menu" ? this.menuItems() : this.slotItems();
  }

  move(dir) {
    const n = this.items().length;
    if (!n) return 0;
    this.cursor = (this.cursor + dir + n) % n;
    return this.cursor;
  }

  setMode(mode) {
    this.mode = mode === "slots" ? "slots" : "menu";
    this.cursor = 0;
    this.armed = false;
    return this.mode;
  }

  openSlots(armed = false) {
    this.mode = "slots";
    this.cursor = 0;
    this.armed = !!armed;
    return this.slotItems();
  }

  back() {
    if (this.mode === "slots") {
      this.setMode("menu");
      return true;
    }
    return false;
  }

  confirm() {
    if (this.mode === "menu") {
      const item = this.currentMenu;
      if (!item) return false;
      if (item.action === TITLE_ACTIONS.NEW) {
        this.onSelect?.(TITLE_ACTIONS.NEW, null);
        return true;
      }
      if (item.action === TITLE_ACTIONS.CONTINUE && item.enabled) {
        this.openSlots(false);
        return true;
      }
      if (item.action === TITLE_ACTIONS.DELETE && item.enabled) {
        this.openSlots(true);
        return true;
      }
      return false;
    }
    const item = this.currentSlot;
    if (!item) return false;
    if (this.armed) {
      if (item.has) this.slots?.erase(item.slot);
      return true;
    }
    if (!item.has) return false;
    this.onSelect?.(TITLE_ACTIONS.CONTINUE, item.slot);
    return true;
  }
}
