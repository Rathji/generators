// Task #192–#194: New Game+ — the NgPlusSystem. Owns the cycle counter,
// the world-reset (flags preserved by prefix), party/inventory carryover,
// the enemy-scaling math, and the Echo of Creation gate.
//
// Cycle lives in the game state's `ngplus_cycle` flag (a number). Cycle 1 is
// the base game; cycles 2+ grow every foe, grant a loyalty reward, strip key
// items, and re-roll the world so the story replays at greater strength.

import { Character } from "./character.js";
import { ENEMIES } from "../data/enemies.js";
import { NGPLUS } from "../data/ngplus.js";

export class NgPlusSystem {
  constructor(opts = {}) {
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.enemies = opts.enemySystem ?? null;
    this.config = opts.config ?? NGPLUS;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  bindParty(party) {
    this.party = party;
    return this;
  }

  bindInventory(inventory) {
    this.inventory = inventory;
    return this;
  }

  // The current cycle (1 = the base age).
  cycle() {
    const n = this.state?.flags?.ngplus_cycle;
    return typeof n === "number" && n >= 1 ? n : 1;
  }

  setCycle(n) {
    this.state?.setFlag("ngplus_cycle", Math.max(1, n));
    return this;
  }

  atMaxCycle() {
    return this.cycle() >= this.config.maxCycles;
  }

  // The world can turn again once the Keeper of Time falls and there is a
  // cycle left to live.
  canBeginCycle() {
    return !!(this.state?.getFlag("story_chrono_defeated")) && !this.atMaxCycle();
  }

  echoUnlocked() {
    return this.cycle() >= this.config.echo.unlockCycle;
  }

  echoDefeated() {
    return !!this.state?.getFlag("ngplus_echo_defeated");
  }

  // ---- Enemy scaling -----------------------------------------------------
  // Multiplier for a creature of a given power tier in the current cycle.
  growthFor(isBoss, cycle = this.cycle()) {
    if (cycle <= 1) return 1;
    const g = (isBoss ? this.config.bossGrowth : this.config.enemyGrowth) + 1;
    return Math.pow(g, cycle - 1);
  }

  scaleStat(v, isBoss, cycle = this.cycle()) {
    return Math.round((v ?? 0) * this.growthFor(isBoss, cycle));
  }

  // A scaled copy of an enemy definition (or already-created enemy) for the
  // current cycle: combat stats ×growth, xp/gold ×their multipliers too.
  scaleEnemy(e, cycle = this.cycle()) {
    const out = { ...e, elements: e.elements ? JSON.parse(JSON.stringify(e.elements)) : e.elements };
    const isBoss = !!e.boss;
    const g = this.growthFor(isBoss, cycle);
    for (const stat of ["hp", "maxHp", "mp", "maxMp", "str", "atk", "int", "agi", "def", "mdef"]) {
      if (typeof out[stat] === "number") out[stat] = Math.round(out[stat] * g);
    }
    if (cycle > 1) {
      if (typeof out.xp === "number") out.xp = Math.round(out.xp * g * this.config.xpMultiplier);
      if (typeof out.gold === "number") out.gold = Math.round(out.gold * g * this.config.goldMultiplier);
    }
    if (Array.isArray(out.loot)) out.loot = out.loot.map((l) => ({ ...l }));
    return out;
  }

  scaleEncounter(enemies, cycle = this.cycle()) {
    for (let i = 0; i < enemies.length; i++) enemies[i] = this.scaleEnemy(enemies[i], cycle);
    return enemies;
  }

  // The Echo of Creation as it stands in the current cycle.
  echoBoss() {
    const base = this.enemies?.template?.("echoOfCreation") ?? ENEMIES.echoOfCreation;
    return this.scaleEnemy(base, this.cycle());
  }

  // ---- Flag reset / carryover --------------------------------------------
  preserved(flag) {
    return this.config.preserveFlagPrefixes.some((p) => flag.startsWith(p));
  }

  // Reset the world: clear every flag that isn't preserved, plus gold-keeping
  // bookkeeping. `intro_seen` stays so the very first intro state is intact.
  _resetFlags() {
    if (!this.state) return this;
    for (const name of Object.keys(this.state.flags)) {
      if (this.preserved(name)) continue;
      if (name === "intro_seen" || name === "ngplus_cycle") continue;
      delete this.state.flags[name];
    }
    this.state.storyPhase = 0;
    return this;
  }

  _keyItem(itemId) {
    return this.config.stripItemTypes.some((t) => this.inventory?.item?.(itemId)?.type === t);
  }

  _memberSnapshot(m) {
    return {
      id: m.id,
      name: m.name,
      classId: m.classId,
      level: m.level,
      xp: m.xp,
      equipment: { ...(m.equipment ?? {}) },
      extraSpells: m.extraSpells ? [...m.extraSpells] : [],
    };
  }

  // What the current party/inventory will bring into the next cycle.
  carryover() {
    const members = (this.party?.members ?? []).map((m) => this._memberSnapshot(m));
    const gold = this.party?.gold ?? 0;
    const items = [];
    if (this.inventory?.stacks) {
      // Task #142: aggregated summary (stacks are per-item arrays now).
      for (const { id: itemId, count } of this.inventory.summary()) {
        if (this._keyItem(itemId)) continue;
        items.push({ itemId, count });
      }
    }
    return { members, gold, items };
  }

  // Begin the next cycle: capture carryover, rebuild the party/inventory in
  // place (same objects, so every bound system sees the new content), reset
  // the world flags, and grant the cycle's reward. Returns
  // { ok, cycle, reward, stripped } describing what happened.
  startCycle() {
    if (!this.canBeginCycle()) {
      return { ok: false, error: "the cycle cannot turn yet" };
    }
    const carry = this.carryover();
    const next = this.cycle() + 1;

    this._resetFlags();
    this.setCycle(next);

    if (this.party) {
      this.party.members.length = 0;
      this.party.reserve.length = 0;
      this.party.gold = carry.gold;
      for (const s of carry.members) {
        this.party.add(new Character({
          id: s.id,
          name: s.name,
          classId: s.classId,
          level: s.level,
          xp: s.xp,
          weapon: s.equipment.weapon,
          armor: s.equipment.armor,
          accessory: s.equipment.accessory,
          extraSpells: s.extraSpells,
        }));
      }
      if (!this.party.members.length) this.party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
    }

    if (this.inventory) {
      this.inventory.stacks.clear();
      for (const { itemId, count } of carry.items) this.inventory.add(itemId, count);
    }

    const reward = this._loyaltyReward(next);
    if (reward?.item && this.inventory) this.inventory.add(reward.item, reward.count ?? 1);
    if (typeof reward?.gold === "number") this.party?.addGold(reward.gold);
    if (typeof reward?.xp === "number") this.party?.grantXp(reward.xp);

    const start = this.config.cycleStart;
    this.state?.setLocation(start.mapId, start.x, start.y, start.facing);

    if (next >= this.config.echo.unlockCycle) this.state?.setFlag("ngplus_echo_unlocked", true);

    return { ok: true, cycle: next, reward, stripped: carry.items.filter((i) => this._keyItem(i.itemId)).length };
  }

  _loyaltyReward(cycle) {
    return this.config.loyaltyRewards.find((r) => r.cycle === cycle) ?? null;
  }

  // Record the Echo's fall and grant its hoard.
  recordEchoDefeat() {
    if (this.echoDefeated()) return { ok: false, error: "already defeated" };
    this.state?.setFlag("ngplus_echo_defeated", true);
    const r = this.config.echoReward;
    let added = false;
    if (r?.item && this.inventory) added = !!this.inventory.add(r.item, r.count ?? 1);
    if (typeof r?.gold === "number") this.party?.addGold(r.gold);
    if (typeof r?.xp === "number") this.party?.grantXp(r.xp);
    return { ok: true, item: r?.item ?? null, added, gold: r?.gold ?? 0, xp: r?.xp ?? 0 };
  }

  statusReport() {
    return {
      cycle: this.cycle(),
      atMax: this.atMaxCycle(),
      canBegin: this.canBeginCycle(),
      echoUnlocked: this.echoUnlocked(),
      echoDefeated: this.echoDefeated(),
      enemyGrowth: this.growthFor(false),
      bossGrowth: this.growthFor(true),
      carryover: this.carryover(),
    };
  }
}
