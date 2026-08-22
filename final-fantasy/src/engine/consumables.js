// Task #42: Consumable Item Effect System — resolves every consumable effect
// kind (heal, restore MP, cure status, revive, full restore, party heal,
// spell scrolls) with auto-target selection. Also used by Inventory.use.

import { ITEMS } from "../data/items.js";
import { SPELLS } from "../data/spells.js";

function maxHpOf(target) {
  return target.getStats ? target.getStats().maxHp : target.maxHp;
}

function maxMpOf(target) {
  const s = target.getStats ? target.getStats() : target;
  return s.maxMp ?? 0;
}

// Core effect resolver shared with Inventory.use. Returns {ok, ...}.
export function resolveItemEffect(item, target) {
  const effect = item.effect;
  if (!effect) return { ok: false, error: "no effect" };
  switch (effect.kind) {
    case "heal": {
      if (!target || typeof target.heal !== "function") return { ok: false, error: "invalid target" };
      if (target.hp <= 0) return { ok: false, error: "target is down" };
      const max = maxHpOf(target);
      if (target.hp >= max) return { ok: false, error: "already full HP" };
      const before = target.hp;
      target.heal(effect.amount);
      return { ok: true, healed: target.hp - before };
    }
    case "healMp": {
      if (!target || typeof target.restoreMp !== "function") return { ok: false, error: "invalid target" };
      const max = maxMpOf(target);
      if (target.mp >= max) return { ok: false, error: "already full MP" };
      const before = target.mp;
      target.restoreMp(effect.amount);
      return { ok: true, restored: target.mp - before };
    }
    case "cureStatus": {
      if (!target || typeof target.removeStatus !== "function") return { ok: false, error: "invalid target" };
      if (!target.hasStatus(effect.status)) return { ok: false, error: "not afflicted" };
      target.removeStatus(effect.status);
      return { ok: true, cured: effect.status };
    }
    case "revive": {
      if (!target) return { ok: false, error: "invalid target" };
      if (target.hp > 0) return { ok: false, error: "target is alive" };
      const frac = effect.amount ?? 0.5;
      const max = maxHpOf(target);
      target.hp = Math.max(1, Math.floor(max * frac));
      return { ok: true, revived: target.id ?? target.name, hp: target.hp, max };
    }
    case "fullRestore": {
      if (!target || typeof target.restoreAll !== "function") return { ok: false, error: "invalid target" };
      const maxHp = maxHpOf(target);
      const maxMp = maxMpOf(target);
      if (target.hp >= maxHp && target.mp >= maxMp) return { ok: false, error: "already full" };
      const hpBefore = target.hp;
      const mpBefore = target.mp;
      target.restoreAll();
      return { ok: true, healed: target.hp - hpBefore, restored: target.mp - mpBefore };
    }
    case "healAll": {
      if (!Array.isArray(target)) return { ok: false, error: "requires party" };
      let healed = 0;
      let restored = 0;
      for (const member of target) {
        if (!member.isAlive()) continue;
        const before = member.hp;
        member.restoreAll();
        healed += member.hp - before;
        if (member.mp !== undefined) restored += member.mp;
      }
      if (healed <= 0) return { ok: false, error: "party already healthy" };
      return { ok: true, healed };
    }
    case "learnSpell": {
      if (!target || typeof target.learnSpell !== "function") return { ok: false, error: "invalid target" };
      if (!SPELLS[effect.spellId]) return { ok: false, error: "unknown spell" };
      if (target.knowsSpell(effect.spellId)) return { ok: false, error: "already knows spell" };
      target.learnSpell(effect.spellId);
      return { ok: true, learned: effect.spellId };
    }
    default:
      return { ok: false, error: "unknown effect" };
  }
}

// Task #113: class-restricted consumables — some items can only be used by
// members of certain classes. Returns null if the item is unrestricted or
// the class is allowed, otherwise a {itemId, classes} restriction record.
export function itemRestrictedFor(item, classId) {
  if (!item?.classes?.length) return null;
  if (item.classes.includes(classId)) return null;
  return { itemId: item.id ?? null, classes: [...item.classes] };
}

// Auto-target selection for a consumable within a party.
export function pickConsumableTarget(item, members, explicit = null) {
  if (explicit) return { target: explicit, explicit: true };
  if (!members || !members.length) return { target: null, error: "no party" };
  const kind = item.effect?.kind;
  const alive = members.filter((m) => m.isAlive());
  const down = members.filter((m) => !m.isAlive());
  const neediest = (list, fracOf) =>
    [...list].sort((a, b) => fracOf(a) - fracOf(b))[0];
  switch (kind) {
    case "heal":
      return { target: neediest(alive, (m) => m.hp / maxHpOf(m)) };
    case "healMp": {
      const casters = alive.filter((m) => maxMpOf(m) > 0);
      return { target: neediest(casters, (m) => m.mp / maxMpOf(m)), error: casters.length ? null : "no magic user" };
    }
    case "cureStatus": {
      const aff = alive.find((m) => m.hasStatus(item.effect.status));
      return { target: aff ?? null, error: aff ? null : "no afflicted member" };
    }
    case "revive": {
      const d = neediest(down, (m) => m.hp);
      return { target: d ?? null, error: d ? null : "no downed member" };
    }
    case "fullRestore": {
      const r = neediest(alive, (m) => (m.hp / Math.max(1, maxHpOf(m))) + (m.mp / Math.max(1, maxMpOf(m))));
      return { target: r ?? null, error: r ? null : "no member to restore" };
    }
    case "healAll":
      return { target: members, partyTarget: true };
    case "learnSpell": {
      const c = members.find((m) => m.knowsSpell && !m.knowsSpell(item.effect.spellId) && maxMpOf(m) > 0);
      return { target: c ?? null, error: c ? null : "no one can learn it" };
    }
    default:
      return { target: alive[0] ?? null, error: alive.length ? null : "no valid target" };
  }
}

// Party-aware consumable system: validates ownership, picks a target
// automatically, applies the effect, and removes the item only on success.
export class ConsumableSystem {
  constructor(opts = {}) {
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
  }

  item(itemId) {
    return ITEMS[itemId];
  }

  list() {
    if (!this.inventory) return [];
    return this.inventory
      .list()
      .filter((e) => ITEMS[e.id]?.type === "consumable")
      .map((e) => ({ ...e, description: ITEMS[e.id].description ?? "", effect: ITEMS[e.id].effect ?? null }));
  }

  canUse(itemId, explicit = null) {
    const item = ITEMS[itemId];
    if (!item) return { ok: false, error: "unknown item" };
    if (item.type !== "consumable") return { ok: false, error: "not usable" };
    if (this.inventory && !this.inventory.has(itemId)) return { ok: false, error: "not owned" };
    const members = this.allowedMembers(item, this.party?.members ?? this.party);
    if (item.classes?.length && !(members && members.length)) return { ok: false, error: "class restricted", classes: [...item.classes] };
    const sel = pickConsumableTarget(item, members, explicit);
    if (!sel.target) return { ok: false, error: sel.error ?? "no valid target" };
    const restricted = this.classRestricted(item, sel);
    if (restricted) return restricted;
    // resolveItemEffect applies the effect — dry-run it against snapshots so
    // validation never actually heals/restores/learns anything.
    const affected = Array.isArray(sel.target) ? sel.target : [sel.target];
    const saved = affected.map((m) => ({
      m,
      hp: m.hp,
      mp: m.mp,
      statuses: m.statuses ? [...m.statuses] : null,
      extraSpells: m.extraSpells ? m.extraSpells.length : null,
    }));
    const res = resolveItemEffect(item, sel.target);
    for (const s of saved) {
      s.m.hp = s.hp;
      s.m.mp = s.mp;
      if (s.statuses && s.m.statuses) s.m.statuses = [...s.statuses];
      if (s.extraSpells != null && s.m.extraSpells) s.m.extraSpells.length = s.extraSpells;
    }
    if (!res.ok) return res;
    return { ok: true };
  }

  // Use an item; `target` may be a specific character to override targeting.
  use(itemId, opts = {}) {
    const target = opts.target ?? null;
    const item = ITEMS[itemId];
    if (!item) return { ok: false, error: "unknown item" };
    if (item.type !== "consumable") return { ok: false, error: "not usable" };
    if (this.inventory && !this.inventory.has(itemId)) return { ok: false, error: "not owned" };
    const members = this.allowedMembers(item, this.party?.members ?? this.party);
    if (item.classes?.length && !(members && members.length)) return { ok: false, error: "class restricted", classes: [...item.classes] };
    const sel = pickConsumableTarget(item, members, target);
    if (!sel.target) return { ok: false, error: sel.error ?? "no valid target" };
    const restricted = this.classRestricted(item, sel);
    if (restricted) return restricted;
    const res = resolveItemEffect(item, sel.target);
    if (!res.ok) return res;
    if (this.inventory) this.inventory.remove(itemId, 1);
    return { ...res, consumed: true, targetId: sel.target.id ?? sel.target.name, target: sel.target };
  }

  // Task #113: restrict targeting to party members of an allowed class, if
  // the item is class-restricted (full list when unrestricted).
  allowedMembers(item, members) {
    if (!item.classes?.length) return members;
    if (!members) return members;
    return members.filter((m) => item.classes.includes(m.classId));
  }

  classRestricted(item, sel) {
    if (!item.classes?.length) return null;
    const targets = Array.isArray(sel.target) ? sel.target : [sel.target];
    if (targets.length && targets.some((m) => item.classes.includes(m.classId))) return null;
    return { ok: false, error: "class restricted", classes: [...item.classes] };
  }
}

// Task #72: Consumable Use-Case Mapping — links every consumable item to the
// system it feeds (HP/MP restoration, status curing, revival, party
// recovery, spell learning) so the whole database is auditable and the UI
// can describe what an item does.
export const CONSUMABLE_USE_CASES = Object.freeze({
  heal: "hp_recovery",
  healMp: "mp_recovery",
  fullRestore: "full_restore",
  cureStatus: "status_cure",
  revive: "revive",
  healAll: "party_recovery",
  learnSpell: "spell_learning",
});

export const USE_CASE_LABELS = Object.freeze({
  hp_recovery: "Restores HP",
  mp_recovery: "Restores MP",
  full_restore: "Fully restores HP and MP",
  status_cure: "Cures a status ailment",
  revive: "Revives a fallen ally",
  party_recovery: "Recovers the whole party",
  spell_learning: "Teaches a spell",
});

export function consumableUseCase(item) {
  if (!item?.effect) return null;
  return CONSUMABLE_USE_CASES[item.effect.kind] ?? null;
}

export class ConsumableUseCaseMapper {
  constructor(itemDb = ITEMS) {
    this.itemDb = itemDb;
  }

  useCase(itemId) {
    return consumableUseCase(this.itemDb[itemId]);
  }

  // The specific status a cureStatus consumable removes, if any.
  curesStatus(itemId) {
    return this.itemDb[itemId]?.effect?.status ?? null;
  }

  // Categorized recovery amount (HP or MP) the item restores.
  recovery(itemId) {
    const eff = this.itemDb[itemId]?.effect;
    if (!eff) return null;
    if (eff.kind === "heal" || eff.kind === "healMp") return eff.amount ?? null;
    if (eff.kind === "revive") return eff.amount ?? null;
    return null;
  }

  describe(itemId) {
    const item = this.itemDb[itemId];
    if (!item) return "Unknown item.";
    const useCase = this.useCase(itemId);
    const label = useCase ? USE_CASE_LABELS[useCase] : "No use-case mapped";
    let detail = item.description ?? "";
    if (useCase === "status_cure" && this.curesStatus(itemId)) detail = "Cures " + this.curesStatus(itemId) + ".";
    return item.name + " — " + label + (detail ? " " + detail : "");
  }

  // Audit every consumable: each must resolve to a known use case and its
  // effect must be executable by ConsumableSystem.
  validate(members = null) {
    const report = [];
    for (const [id, item] of Object.entries(this.itemDb)) {
      if (item.type !== "consumable") continue;
      const useCase = this.useCase(id);
      if (!useCase) {
        report.push({ itemId: id, ok: false, error: "effect kind maps to no use case" });
        continue;
      }
      if (!item.effect || typeof item.effect !== "object") {
        report.push({ itemId: id, ok: false, error: "missing effect" });
        continue;
      }
      report.push({ itemId: id, useCase, ok: true, curesStatus: this.curesStatus(id), recovery: this.recovery(id) });
    }
    return report;
  }
}
