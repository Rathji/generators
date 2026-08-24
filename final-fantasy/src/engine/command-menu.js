// Tasks #212-#217: The Command Menu — the classic Items / Magic / Equip /
// Status / Formation screens, built on MenuSystem's navigation stack and
// driving the live game systems (ConsumableSystem, SpellCastingSystem,
// EquipSystem, PartyManager). Pure logic, no DOM.

import { MenuSystem } from "./menus.js";
import { EquipSystem, SLOTS } from "./equipment.js";
import { ITEMS } from "../data/items.js";
import { SPELLS } from "../data/spells.js";
import { COMMAND_MENU } from "../data/menu-config.js";
import { CODEX_SECTIONS } from "../data/codex.js";

const ALLY_SCOPES = new Set(["single-ally", "all-allies", "self"]);

const STAT_LABELS = {
  atk: "Atk",
  def: "Def",
  int: "Int",
  agi: "Agi",
  mdef: "MDef",
  str: "Str",
  maxHp: "HP",
  maxMp: "MP",
};

export class CommandMenuSystem {
  constructor(opts = {}) {
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.consumables = opts.consumables ?? null;
    this.spells = opts.spells ?? null;
    this.state = opts.state ?? null;
    this.codex = opts.codex ?? null;
    this.worldMap = opts.worldMap ?? null;
    this.config = opts.config ?? COMMAND_MENU;
    this.sections = opts.sections ?? CODEX_SECTIONS;
    this.equip = opts.equip ?? new EquipSystem(this.inventory);
    this.menu = opts.menu ?? new MenuSystem();
    this.log = opts.log ?? null;
    this.lastResult = null;
    this.lastMessage = null;
    this._builders = [];
  }

  get isOpen() {
    return this.menu.isOpen;
  }

  // Open the root Command screen.
  open() {
    this.lastResult = null;
    this.lastMessage = null;
    this._push("root", this._buildRoot, null);
    return this.render();
  }

  close() {
    this.menu.reset();
    this._builders = [];
    this.lastResult = null;
    return this.render();
  }

  render() {
    return this.menu.render();
  }

  view() {
    const top = this._builders[this._builders.length - 1] ?? null;
    return {
      view: this.menu.render(),
      context: top ? { kind: top.kind, ctx: top.ctx } : null,
      message: this.lastMessage,
    };
  }

  // Drive the menu with a physical key. Returns "closed" when the whole menu
  // is dismissed, "back" on a submenu pop, otherwise whatever MenuSystem did.
  handleKey(key) {
    if (!this.menu.isOpen) return null;
    if (key === "Escape" || key === "x" || key === "X" || key === "Backspace") {
      if (this.menu.depth <= 1) {
        this.close();
        return "closed";
      }
      this.menu.close();
      this._builders.pop();
      this._rebuildCurrent();
      return "back";
    }
    return this.menu.handleKey(key);
  }

  // ----- navigation plumbing ------------------------------------------------

  _push(kind, builder, ctx, selectId = null) {
    this._builders.push({ kind, builder, ctx });
    const screen = builder(ctx);
    const opened = this.menu.open(screen);
    if (selectId) this.menu.select(selectId);
    return opened;
  }

  _replace(kind, builder, ctx, selectId = null) {
    this._builders.pop();
    this.menu.close();
    this._push(kind, builder, ctx, selectId);
  }

  _rebuildCurrent(selectId = null) {
    const top = this._builders[this._builders.length - 1];
    if (!top) return;
    this.menu.close();
    const screen = top.builder(top.ctx);
    this.menu.open(screen);
    if (selectId) this.menu.select(selectId);
  }

  _member(id) {
    return (this.party?.members ?? []).find((m) => m.id === id) ?? null;
  }

  _log(msg) {
    if (this.log) this.log(msg);
  }

  _setResult(res, okMsg) {
    this.lastResult = res;
    this.lastMessage = res && res.ok === false ? res.error ?? "Cannot do that." : okMsg;
    this._log(this.lastMessage);
  }

  // ----- shared helpers ------------------------------------------------------

  _allySpells(member) {
    if (!member || typeof member.getSpells !== "function") return [];
    return member.getSpells().filter((id) => ALLY_SCOPES.has(SPELLS[id]?.target));
  }

  _spellValidTarget(caster, spellId) {
    const spell = SPELLS[spellId];
    if (!spell) return false;
    if (spell.target === "all-allies") return (this.party?.members ?? []).some((x) => x.isAlive());
    if (spell.target === "single-ally") return (this.party?.members ?? []).some((x) => x.isAlive());
    return true;
  }

  _spellHint(spell) {
    if (spell.kind === "heal") return "Restores ~" + spell.power + " HP";
    if (spell.kind === "cureStatus") return "Cures status ailments";
    return "Damage spell";
  }

  _hpLine(m) {
    const max = m.getStats?.().maxHp ?? m.hp;
    return Math.max(0, m.hp) + "/" + max + " HP";
  }

  _mpLine(m) {
    const max = m.getStats?.().maxMp ?? 0;
    return Math.max(0, m.mp) + "/" + max + " MP";
  }

  _equipSummary(m) {
    return SLOTS.map((s) => {
      const id = m.equipment[s];
      return id ? ITEMS[id]?.name ?? id : "\u2014";
    }).join(" / ");
  }

  // Simulated stat delta of equipping itemId into a slot (does not persist).
  _statDelta(member, slot, itemId) {
    const base = member.getStats();
    const prev = member.equipment[slot];
    member.equipment[slot] = itemId;
    let next;
    try {
      next = member.getStats();
    } finally {
      member.equipment[slot] = prev;
    }
    const deltas = {};
    for (const k of this.config.deltaKeys) deltas[k] = (next[k] ?? 0) - (base[k] ?? 0);
    return deltas;
  }

  _deltaText(deltas) {
    const parts = Object.entries(deltas)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => (v > 0 ? "+" + v : v) + " " + (STAT_LABELS[k] ?? k));
    return parts.length ? parts.join(" \u00b7 ") : "No stat change";
  }

  // ----- root ----------------------------------------------------------------

  _buildRoot = () => {
    const members = this.party?.members ?? [];
    const consumableCount = (this.inventory?.list() ?? [])
      .filter((e) => ITEMS[e.id]?.type === "consumable")
      .reduce((s, e) => s + e.count, 0);
    const casterCount = members.filter((m) => this._allySpells(m).length).length;
    const items = [
      { id: "items", label: "Items", hint: consumableCount ? consumableCount + " usable" : "None", disabled: consumableCount <= 0, action: () => this._push("items", this._buildItems, null) },
      { id: "magic", label: "Magic", hint: casterCount ? casterCount + " caster" + (casterCount > 1 ? "s" : "") : "None", disabled: casterCount === 0, action: () => this._push("magic", this._buildMagic, null) },
      { id: "equip", label: "Equip", hint: "Change gear", action: () => this._push("equip", this._buildEquip, null) },
      { id: "status", label: "Status", hint: "View stats", action: () => this._push("status", this._buildStatus, null) },
      { id: "formation", label: "Formation", hint: "Reorder party", disabled: members.length < 2, action: () => this._push("formation", this._buildFormation, null) },
      { id: "codex", label: "Codex", hint: "Discovered lore", action: () => this._push("codex", this._buildCodex, null) },
      { id: "map", label: "Map", hint: "World overview", action: () => this._push("map", this._buildWorldMap, null) },
    ];
    return { title: this.config.title, items };
  };

  // ----- codex (Task #236) ------------------------------------------------------

  _buildCodex = () => {
    const items = [];
    for (const s of this.sections) {
      const info = this.codex?.sectionInfo(s.id);
      items.push({
        id: "codex_" + s.id,
        label: (info ? info.label : s.label) + "  " + (info ? info.known + "/" + info.total : ""),
        hint: info && info.total ? Math.round((100 * info.known) / info.total) + "% discovered" : "",
        action: () => this._push("codex_section", this._buildCodexSection, s.id),
      });
    }
    return { title: "Codex", items };
  };

  _buildCodexSection = (section) => {
    const items = [];
    const entries = this.codex?.entries(section) ?? [];
    for (const e of entries) {
      if (!e.discovered) {
        items.push({ id: "codex_e_" + e.id, label: "?????", hint: "Not yet discovered", action: () => this._push("codex_detail", this._buildCodexDetail, section + ":" + e.id) });
        continue;
      }
      items.push({
        id: "codex_e_" + e.id,
        label: e.name,
        hint: this._codexHint(e),
        action: () => this._push("codex_detail", this._buildCodexDetail, section + ":" + e.id),
      });
    }
    items.unshift({ id: "back", label: "← Back", action: () => this._replace("codex", this._buildCodex, null) });
    const def = this.sections.find((s) => s.id === section);
    return { title: "Codex — " + (def?.label ?? section), items };
  };

  _codexHint(e) {
    if (e.kind === "enemy") return [e.elements, e.drops].filter(Boolean).join(" · ") || e.stats?.HP + " HP";
    if (e.kind === "spell") return (e.kind2 ?? "") + (e.element ? " · " + e.element : "");
    if (e.kind === "item") return (e.rarity ?? "") + (e.type ? " · " + e.type : "");
    if (e.kind === "class") return "Adventuring class";
    if (e.kind === "location") return e.region;
    if (e.kind === "quest") return (e.objectives?.length ?? 0) + " objective" + (e.objectives?.length === 1 ? "" : "s");
    return "";
  }

  _buildCodexDetail = (ref) => {
    const [section, id] = ref.split(":");
    const e = this.codex?.entry(section, id);
    const rows = [];
    if (e) {
      if (e.kind === "enemy") {
        if (e.boss) rows.push({ id: "d_boss", label: "Boss", hint: "A notable foe", disabled: true });
        for (const [k, v] of Object.entries(e.stats ?? {})) rows.push({ id: "d_" + k, label: k, hint: String(v), disabled: true });
        if (e.elements) rows.push({ id: "d_elem", label: "Elements", hint: e.elements, disabled: true });
        rows.push({ id: "d_lore", label: "Lore", hint: e.lore ?? "No account.", disabled: true });
      } else if (e.kind === "spell") {
        rows.push({ id: "d_mp", label: "MP", hint: String(e.mp), disabled: true });
        rows.push({ id: "d_target", label: "Target", hint: e.target ?? "—", disabled: true });
        if (e.element) rows.push({ id: "d_elem", label: "Element", hint: e.element, disabled: true });
        rows.push({ id: "d_power", label: "Power", hint: String(e.power ?? "—"), disabled: true });
      } else if (e.kind === "item") {
        rows.push({ id: "d_type", label: "Type", hint: (e.type ?? "") + (e.rarity ? " · " + e.rarity : ""), disabled: true });
        rows.push({ id: "d_desc", label: "Description", hint: e.description ?? "", disabled: true });
      } else if (e.kind === "class") {
        for (const [k, v] of Object.entries(e.stats ?? {})) rows.push({ id: "d_" + k, label: k, hint: String(v), disabled: true });
        if (e.spells?.length) rows.push({ id: "d_spells", label: "Spells", hint: e.spells.join(" · "), disabled: true });
      } else if (e.kind === "location") {
        rows.push({ id: "d_region", label: "Region", hint: e.region ?? "", disabled: true });
        rows.push({ id: "d_lore", label: "Lore", hint: e.lore ?? "", disabled: true });
      } else if (e.kind === "quest") {
        rows.push({ id: "d_desc", label: "Goal", hint: e.description ?? "", disabled: true });
        rows.push({ id: "d_obj", label: "Objectives", hint: e.objectives?.join(" · ") ?? "", disabled: true });
      }
    }
    rows.push({ id: "back", label: "← Back", action: () => this._replace("codex_section", this._buildCodexSection, section) });
    return { title: (e?.name ?? "Codex") + (e?.discovered ? "" : " — ???"), items: rows };
  };

  // ----- map (Task #237) ------------------------------------------------------

  _buildWorldMap = () => {
    const items = [];
    if (this.worldMap) {
      const prog = this.worldMap.progress();
      const legend = this.worldMap.legend();
      items.push({
        id: "map_progress",
        label: `Regions explored  ${prog.visited}/${prog.total}`,
        hint: prog.visited + " of " + prog.total + " regions charted",
        disabled: true,
      });
      for (const r of legend) {
        items.push({
          id: "map_r_" + r.id,
          label: r.letter + "  " + r.name + (r.visited ? "  ●" : ""),
          hint: r.visited ? "Explored" : "Uncharted",
          action: () => this._push("map_detail", this._buildMapRegion, r.id),
        });
      }
    } else {
      items.push({ id: "map_none", label: "No map available", hint: "", disabled: true });
    }
    items.unshift({ id: "back", label: "← Back", action: () => this._replace("root", this._buildRoot, null) });
    return { title: "World Map", items };
  };

  _buildMapRegion = (id) => {
    const region = this.worldMap?.legend().find((r) => r.id === id);
    const rows = [];
    if (region) {
      rows.push({ id: "mr_name", label: region.name, hint: region.visited ? "Explored" : "Uncharted", disabled: true });
      if (region.visited) {
        rows.push({ id: "mr_maps", label: "Areas", hint: (this.worldMap.region(id)?.maps ?? []).join(" · "), disabled: true });
      } else {
        rows.push({ id: "mr_hint", label: "??", hint: "Travel here to record its lore.", disabled: true });
      }
    }
    rows.push({ id: "back", label: "← Back", action: () => this._replace("map", this._buildWorldMap, null) });
    return { title: "World Map", items: rows };
  };

  // ----- items (Task #213) ----------------------------------------------------

  _buildItems = () => {
    const items = [];
    const consumables = (this.inventory?.list() ?? [])
      .filter((e) => ITEMS[e.id]?.type === "consumable")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of consumables) {
      items.push({
        id: "item_" + e.id,
        label: e.name + "  x" + e.count,
        hint: ITEMS[e.id]?.description ?? "",
        disabled: e.count <= 0,
        action: () => this._openItemTarget(e.id),
      });
    }
    return { title: "Items", items };
  };

  _openItemTarget(itemId) {
    const item = ITEMS[itemId];
    if (item?.effect?.kind === "healAll") {
      this._useItem(itemId, null);
      return;
    }
    this._push("item_target", this._buildItemTarget, itemId);
  }

  _buildItemTarget = (itemId) => {
    const items = [];
    const auto = this.consumables ? this.consumables.canUse(itemId) : { ok: false };
    items.push({
      id: "auto",
      label: "Auto",
      hint: auto.ok ? "Best target" : auto.error ?? "Unusable",
      disabled: !auto.ok,
      action: () => this._useItem(itemId, null),
    });
    for (const m of this.party?.members ?? []) {
      const can = this.consumables ? this.consumables.canUse(itemId, m) : { ok: false };
      items.push({
        id: "target_" + m.id,
        label: m.name,
        hint: this._hpLine(m) + (m.getStats?.().maxMp ? " \u00b7 " + this._mpLine(m) : ""),
        disabled: !can.ok,
        action: () => this._useItem(itemId, m.id),
      });
    }
    return { title: ITEMS[itemId]?.name ?? "Use", items };
  };

  _useItem(itemId, targetId) {
    const target = targetId ? this._member(targetId) ?? null : null;
    const res = this.consumables?.use(itemId, { target }) ?? { ok: false, error: "no consumable system" };
    const item = ITEMS[itemId];
    this.lastResult = res;
    this.lastMessage = res.ok ? this._describeUse(item, res) : res.error ?? "Cannot use that now.";
    this._log(this.lastMessage);
    const backTo = item?.effect?.kind === "healAll" ? "items" : "item_target";
    const selectId = this.inventory?.count(itemId) > 0 ? "item_" + itemId : null;
    this._replace(backTo, backTo === "items" ? this._buildItems : this._buildItemTarget, itemId, selectId);
  }

  _describeUse(item, res) {
    const t = res.target?.name ?? res.targetId ?? "the party";
    const name = item?.name ?? "Item";
    if (res.healed) return name + " \u2014 " + t + " +" + res.healed + " HP.";
    if (res.restored) return name + " \u2014 " + t + " +" + res.restored + " MP.";
    if (res.cured) return name + " \u2014 " + t + " cured (" + res.cured + ").";
    if (res.revived) return name + " \u2014 " + t + " revived with " + res.hp + " HP.";
    if (res.learned) return name + " \u2014 " + t + " learned " + res.learned + ".";
    return name + " used.";
  }

  // ----- magic (Task #214) ------------------------------------------------------

  _buildMagic = () => {
    const items = [];
    for (const m of this.party?.members ?? []) {
      const spells = this._allySpells(m);
      items.push({
        id: "caster_" + m.id,
        label: m.name,
        hint: spells.length ? spells.length + " spell" + (spells.length > 1 ? "s" : "") + " \u00b7 " + this._mpLine(m) : "No spells",
        disabled: spells.length === 0,
        action: () => this._push("caster", this._buildCaster, m.id),
      });
    }
    return { title: "Magic", items };
  };

  _buildCaster = (memberId) => {
    const m = this._member(memberId);
    const items = [];
    if (m) {
      for (const id of this._allySpells(m)) {
        const spell = SPELLS[id];
        const can = this.spells ? this.spells.canCast(m, id) : false;
        items.push({
          id: "spell_" + id,
          label: spell.name + "  MP " + spell.mp,
          hint: this._spellHint(spell),
          disabled: !can || !this._spellValidTarget(m, id),
          action: () => this._openSpellTarget(memberId, id),
        });
      }
    }
    return { title: (m?.name ?? "?") + " \u2014 Magic", items };
  };

  _openSpellTarget(casterId, spellId) {
    const scope = SPELLS[spellId]?.target;
    if (scope === "single-ally") this._push("spell_target", this._buildSpellTarget, { casterId, spellId });
    else this._castSpell(casterId, spellId, null);
  }

  _buildSpellTarget = ({ casterId, spellId }) => {
    const items = [];
    const caster = this._member(casterId);
    for (const m of this.party?.members ?? []) {
      items.push({
        id: "target_" + m.id,
        label: m.name,
        hint: this._hpLine(m),
        action: () => this._castSpell(casterId, spellId, m.id),
      });
    }
    return { title: (SPELLS[spellId]?.name ?? "Spell") + " \u2014 " + (caster?.name ?? "?") + "'s MP " + (caster ? this._mpLine(caster) : ""), items };
  };

  _castSpell(casterId, spellId, targetId) {
    const caster = this._member(casterId);
    const target = targetId ? this._member(targetId) ?? null : null;
    const res = this.spells?.cast(caster, spellId, this.party?.members ?? [], [], target) ?? { ok: false, error: "no spell system" };
    this.lastResult = res;
    this.lastMessage = res.ok ? this._describeCast(res) : res.error ?? "Cannot cast that now.";
    this._log(this.lastMessage);
    this._replace("caster", this._buildCaster, casterId, "spell_" + spellId);
  }

  _describeCast(res) {
    const name = res.spell?.name ?? "Spell";
    const heals = (res.results ?? []).filter((r) => r.type === "heal");
    if (heals.length) {
      const total = heals.reduce((s, r) => s + (r.amount ?? 0), 0);
      const who = heals.length === 1 ? (heals[0].target?.name ?? "ally") : "the party";
      return name + " \u2014 " + who + " +" + total + " HP.";
    }
    if ((res.results ?? []).some((r) => r.type === "cureStatus")) return name + " \u2014 status cured.";
    return name + " cast.";
  }

  // ----- equip (Task #215) ---------------------------------------------------------

  _buildEquip = () => {
    const items = [];
    for (const m of this.party?.members ?? []) {
      items.push({
        id: "member_" + m.id,
        label: m.name,
        hint: this._equipSummary(m),
        action: () => this._push("equip_slots", this._buildEquipSlots, m.id),
      });
    }
    return { title: "Equip", items };
  };

  _buildEquipSlots = (memberId) => {
    const m = this._member(memberId);
    const items = SLOTS.map((s) => {
      const id = m?.equipment[s];
      return {
        id: "slot_" + s,
        label: this.config.slots[s] ?? s,
        hint: id ? ITEMS[id]?.name ?? id : "None",
        action: () => this._push("equip_gear", this._buildEquipGear, { memberId, slot: s }),
      };
    });
    return { title: (m?.name ?? "?") + " \u2014 Equip", items };
  };

  _buildEquipGear = ({ memberId, slot }) => {
    const m = this._member(memberId);
    const items = [];
    if (m) {
      items.push({
        id: "gear_none",
        label: "Remove",
        hint: m.equipment[slot] ? "Unequip " + (this.config.slots[slot] ?? slot) : "Slot empty",
        disabled: !m.equipment[slot],
        action: () => this._unequipSlot(memberId, slot),
      });
      const owned = (this.inventory?.list() ?? []).filter(
        (e) => e.count > 0 && ITEMS[e.id]?.slot === slot && this.equip.canEquipId(m, e.id)
      );
      for (const e of owned) {
        const deltas = this._statDelta(m, slot, e.id);
        items.push({
          id: "gear_" + e.id,
          label: e.name,
          hint: this._deltaText(deltas),
          action: () => this._equipItem(memberId, slot, e.id),
        });
      }
    }
    return { title: (this.config.slots[slot] ?? slot) + " \u2014 " + (m?.name ?? "?"), items };
  };

  _equipItem(memberId, slot, itemId) {
    const m = this._member(memberId);
    const res = this.equip.equip(m, itemId);
    this._setResult(res, res.ok ? "Equipped " + (ITEMS[itemId]?.name ?? itemId) + "." : "");
    if (res.ok) this.lastMessage = "Equipped " + (ITEMS[itemId]?.name ?? itemId) + ".";
    this._replace("equip_gear", this._buildEquipGear, { memberId, slot }, "gear_" + itemId);
  }

  _unequipSlot(memberId, slot) {
    const m = this._member(memberId);
    const res = this.equip.unequip(m, slot);
    this._setResult(res, res.ok ? "Removed " + (res.item ?? "gear") + "." : "");
    this._replace("equip_gear", this._buildEquipGear, { memberId, slot }, "gear_none");
  }

  // ----- status (Task #216) ---------------------------------------------------------

  _buildStatus = () => {
    const items = [];
    for (const m of this.party?.members ?? []) {
      const s = m.getStats();
      items.push({
        id: "member_" + m.id,
        label: m.name + "  Lv " + m.level,
        hint: s.maxHp + " HP \u00b7 " + (s.maxMp ?? 0) + " MP",
        action: () => this._push("status_detail", this._buildStatusDetail, m.id),
      });
    }
    return { title: "Status", items };
  };

  _buildStatusDetail = (memberId) => {
    const m = this._member(memberId);
    const items = [];
    if (m) {
      const s = m.getStats();
      const statuses = m.statuses?.length ? m.statuses.join(", ") : "None";
      const values = {
        level: m.level,
        xp: m.xp,
        hp: this._hpLine(m),
        mp: this._mpLine(m),
        str: s.str,
        atk: s.atk,
        def: s.def,
        int: s.int,
        agi: s.agi,
        mdef: s.mdef,
        status: statuses,
        equipment: this._equipSummary(m),
      };
      for (const row of this.config.statusRows) {
        items.push({ id: "row_" + row.id, label: row.label, hint: String(values[row.id] ?? "\u2014"), disabled: true });
      }
    }
    items.unshift({ id: "back", label: "\u2190 Back", action: () => this._replace("status", this._buildStatus, null) });
    return { title: (m?.name ?? "?") + " \u2014 Status", items };
  };

  // ----- formation (Task #217) ----------------------------------------------------------

  _buildFormation = () => {
    const members = this.party?.members ?? [];
    const items = members.map((m, i) => ({
      id: "member_" + m.id,
      label: (i + 1) + ". " + m.name,
      hint: i === members.length - 1 ? "Wrap to front" : "Swap with next",
      action: () => this._swapFormation(i),
    }));
    return { title: "Formation", items };
  };

  _swapFormation(index) {
    const members = this.party?.members ?? [];
    if (members.length < 2) return;
    const next = (index + 1) % members.length;
    const a = members[index];
    const b = members[next];
    members[index] = b;
    members[next] = a;
    this.lastMessage = "Order: " + members.map((m) => m.name).join(" \u2192 ");
    this._log(this.lastMessage);
    this._replace("formation", this._buildFormation, null, "member_" + b.id);
  }
}
