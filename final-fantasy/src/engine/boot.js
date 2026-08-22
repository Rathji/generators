// Task #202/#204/#205: Game boot controller — New Game, Continue, autosave,
// and Return-to-Title all rebuild the LIVE game objects in place (same
// PartyManager / Inventory / GameState instances) so every system that
// holds a reference to them keeps working without re-wiring.

import { GameState } from "./state.js";
import { PartyManager } from "./party.js";
import { Inventory } from "./inventory.js";
import { Character } from "./character.js";
import { NEW_GAME } from "../data/new-game.js";

export class GameBootSystem {
  constructor(opts = {}) {
    this.state = opts.state ?? new GameState();
    this.party = opts.party ?? new PartyManager();
    this.inventory = opts.inventory ?? new Inventory();
    this.config = opts.config ?? NEW_GAME;
    this.slots = opts.slots ?? null;
    this.gameOver = opts.gameOver ?? null;
    this.onBeforeReset = opts.onBeforeReset ?? null;
    this.onAfterReset = opts.onAfterReset ?? null;
    this.activeSlot = null;
    this.sessionStartedAt = null;
    this.booted = false;
  }

  liveGame() {
    return { state: this.state, party: this.party, inventory: this.inventory };
  }

  _resetPartyFrom(src) {
    const members = [...(src?.members ?? [])];
    const reserve = [...(src?.reserve ?? [])];
    this.party.members.length = 0;
    this.party.reserve.length = 0;
    for (const m of members) this.party.add(m);
    for (const m of reserve) this.party.add(m, true);
    this.party.gold = src?.gold ?? 0;
  }

  _resetInventoryFrom(src) {
    this.inventory.stacks.clear();
    if (src && src.stacks instanceof Map) {
      for (const [id, count] of src.stacks) this.inventory.stacks.set(id, count);
    }
  }

  // Fresh adventure from the New Game config.
  newGame() {
    if (this.onBeforeReset) this.onBeforeReset();
    const cfg = this.config;
    const freshParty = new PartyManager({ gold: cfg.gold ?? 0 });
    for (const p of cfg.party ?? []) {
      freshParty.add(new Character({ id: p.id, name: p.name, classId: p.classId }));
    }
    const freshInv = new Inventory();
    for (const [id, n] of cfg.items ?? []) freshInv.add(id, n);
    this._resetPartyFrom(freshParty);
    this._resetInventoryFrom(freshInv);
    this.state.flags = {};
    for (const [k, v] of Object.entries(cfg.flags ?? {})) this.state.setFlag(k, v);
    this.state.gold = cfg.gold ?? 0;
    this.state.setStoryPhase(0);
    this.state.playTimeSec = 0;
    const s = cfg.start;
    this.state.setLocation(s.mapId, s.x, s.y, s.facing ?? "S");
    if (this.gameOver && cfg.checkpoint) {
      this.gameOver.savepoint(
        cfg.checkpoint.mapId,
        cfg.checkpoint.x,
        cfg.checkpoint.y,
        cfg.checkpoint.facing ?? "S",
        cfg.checkpoint.name ?? "Save Point"
      );
    }
    this.activeSlot = null;
    this._markBooted();
    if (this.onAfterReset) this.onAfterReset();
    return { ok: true, fresh: true, ...this.summary() };
  }

  // Resume a saved adventure, restoring it onto the live game objects.
  continue(slot) {
    if (!this.slots) return { ok: false, reason: "no_slots" };
    const data = this.slots.read(slot);
    if (!data) return { ok: false, reason: "empty" };
    if (data.error) return { ok: false, reason: data.error, slot };
    if (this.onBeforeReset) this.onBeforeReset();
    this._resetPartyFrom(data.party);
    this._resetInventoryFrom(data.inventory);
    this.state.restore(data.state.snapshot());
    this.state.gold = this.party.gold;
    this.state.setParty(this.party);
    this.state.setInventory(this.inventory);
    if (this.gameOver) this.gameOver.autoCheckpoint();
    this.activeSlot = slot;
    this._markBooted();
    if (this.onAfterReset) this.onAfterReset();
    return { ok: true, fresh: false, slot, recovered: !!data.fromBackup, ...this.summary() };
  }

  saveCurrent(slot) {
    if (!this.slots) return { ok: false, reason: "no_slots" };
    const res = this.slots.write(slot, this.liveGame());
    if (res.ok) this.activeSlot = slot;
    return res;
  }

  autosave() {
    if (!this.activeSlot) return { ok: false, reason: "no_active_slot" };
    return this.saveCurrent(this.activeSlot);
  }

  // Quit to the title screen: no active slot, no session.
  toTitle() {
    this.activeSlot = null;
    this.sessionStartedAt = null;
    this.booted = false;
    this.state?.setLocation("title", 0, 0, "S");
    this.state?.setStoryPhase(0);
    if (this.gameOver) this.gameOver.toTitle();
    return { status: "title", ok: true };
  }

  _markBooted() {
    this.booted = true;
    this.sessionStartedAt = Date.now();
  }

  summary() {
    const levels = this.party.members.map((m) => m.level);
    const loc = this.state.getLocation();
    return {
      location: { mapId: loc.mapId, x: loc.x, y: loc.y },
      gold: this.party.gold,
      level: levels.length ? Math.max(...levels) : 0,
      partyCount: this.party.members.length,
      playTimeSec: this.state.playTimeSec,
      cycle: this.state.flags["ngplus_cycle"] ?? 1,
      activeSlot: this.activeSlot,
    };
  }
}
