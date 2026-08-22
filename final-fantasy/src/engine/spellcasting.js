// Task #26: Spell Casting Logic — validates knowledge/MP, resolves targets
// (Task #29), consumes MP, and applies damage/healing with elemental
// affinity modifiers (Task #27).

import { SPELLS } from "../data/spells.js";
import { TargetResolver, isAlive } from "./targets.js";
import { applyElemental } from "./affinity.js";

export class SpellCastingSystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.targetResolver = opts.targetResolver ?? new TargetResolver({ random: this.rng });
    this.status = opts.statusSystem ?? null;
    this.synergy = opts.synergy ?? null;
    this.levelSystem = opts.levelSystem ?? null;
    this.effects = opts.effects ?? null;
    this.visuals = opts.visuals ?? null;
    // Task #133: optional MagicStatusInflictionSystem — the spell's status
    // mapping (id, chance, turns) is resolved through this system.
    this.magicStatus = opts.magicStatus ?? null;
    // Task #144: optional UseCaseValidator — single-target heal/cureStatus
    // spells refuse useless targets (Cure on a full-HP ally, Esuna on a
    // healthy ally). Consumables already self-validate.
    this.useCaseValidator = opts.useCaseValidator ?? null;
  }

  knownSpells(caster) {
    return typeof caster.getSpells === "function" ? caster.getSpells() : [];
  }

  knows(caster, spellId) {
    return this.knownSpells(caster).includes(spellId);
  }

  canCast(caster, spellId) {
    return this.validate(caster, spellId).ok;
  }

  // Task #131: MP cost scaling + validation. `costScale` is the hook point
  // for any future cost-scaling rule; `effectiveCost` is what casters must
  // actually pay. A caster can never act on a spell they cannot afford.
  costScale(caster, spellId) {
    return 1;
  }

  effectiveCost(caster, spellId) {
    const spell = SPELLS[spellId];
    if (!spell) return Infinity;
    return Math.max(1, Math.round(spell.mp * this.costScale(caster, spellId)));
  }

  // Full validation: knowledge, level gate, and MP sufficiency. Returns the
  // cost that WOULD be charged so callers can budget ahead of casting.
  validate(caster, spellId) {
    const spell = SPELLS[spellId];
    if (!spell) return { ok: false, error: "unknown spell", cost: 0, shortfall: Infinity };
    const learned = this.knows(caster, spellId);
    const cost = this.effectiveCost(caster, spellId);
    const shortfall = Math.max(0, cost - (caster.mp ?? 0));
    if (!learned) return { ok: false, error: "spell not learned", cost, shortfall };
    if (this.levelSystem && !this.levelSystem.canUse(caster, spellId)) {
      return {
        ok: false,
        error: "level too low",
        cost,
        shortfall,
        requiredLevel: this.levelSystem.requiredLevel(caster, spellId),
      };
    }
    if ((caster.mp ?? 0) < cost) return { ok: false, error: "insufficient MP", cost, shortfall };
    return { ok: true, cost, shortfall: 0 };
  }

  mpShortfall(caster, spellId) {
    const spell = SPELLS[spellId];
    if (!spell) return Infinity;
    return Math.max(0, this.effectiveCost(caster, spellId) - (caster.mp ?? 0));
  }

  statsOf(c) {
    return typeof c.getStats === "function" ? c.getStats() : c;
  }

  maxHpOf(c) {
    return this.statsOf(c).maxHp;
  }

  cast(caster, spellId, party = [], enemies = [], chosen = null) {
    const spell = SPELLS[spellId];
    if (!spell) return { ok: false, error: "unknown spell" };
    if (!this.knows(caster, spellId)) return { ok: false, error: "spell not learned" };
    if (this.levelSystem && !this.levelSystem.canUse(caster, spellId)) {
      return {
        ok: false,
        error: "level too low",
        requiredLevel: this.levelSystem.requiredLevel(caster, spellId),
      };
    }
    // Task #131: charge the effective cost, never the raw base MP.
    const cost = this.effectiveCost(caster, spellId);
    if ((caster.mp ?? 0) < cost) {
      return { ok: false, error: "insufficient MP", shortfall: this.mpShortfall(caster, spellId), cost };
    }

    const { scope, targets: resolvedTargets } = this.targetResolver.resolveTargets(spell, caster, party, enemies, chosen);
    let targets = resolvedTargets;
    if (!targets.length) return { ok: false, error: "no valid targets", scope };
    // Task #144: drop targets that cannot benefit (full-HP heals, healthy
    // cures, etc.). If every resolved target is unusable the cast is refused
    // BEFORE any MP is spent.
    if (this.useCaseValidator) {
      const uc = this.useCaseValidator.validateSpellCast(spell, targets);
      if (uc.blocked.length) {
        if (!uc.valid.length) {
          return { ok: false, error: uc.reason ?? "no valid targets", scope, targets, blocked: uc.blocked };
        }
        targets = uc.valid;
      }
    }

    caster.spendMp ? caster.spendMp(cost) : (caster.mp -= cost);
    const int = this.statsOf(caster).int;

    const results = [];
    for (const target of targets) {
      if (spell.kind === "heal") {
        const amount = Math.max(1, spell.power + Math.floor(int / 2));
        const before = target.hp;
        if (typeof target.heal === "function") target.heal(amount);
        else target.hp = Math.min(this.maxHpOf(target), target.hp + amount);
        results.push({ target, type: "heal", amount: target.hp - before });
      } else if (spell.kind === "cureStatus") {
        const cured = this.status
          ? spell.cureStatus === "all"
            ? this.status.cureAll(target).cured
            : this.status.cure(target, spell.cureStatus).cured
          : [];
        results.push({ target, type: "cureStatus", cured });
      } else if (spell.kind === "utility") {
        // Task #148: utility spells (Light) cast no damage — they report an
        // effect that the world systems (e.g. LightingSystem) read.
        results.push({ target, type: "utility", utility: spell.utility ?? "light" });
      } else {
        const tstats = this.statsOf(target);
        const base = Math.max(1, spell.power + int - (tstats.mdef ?? 0));
        const variance = 0.8 + this.rng() * 0.4;
        const raw = Math.max(1, Math.round(base * variance));
        const affinity = applyElemental(raw, spell.element ?? null, target);
        let damage = affinity.damage;
        const multiplier = affinity.multiplier;
        let synergyMult = 1;
        if (this.synergy && spell.element) {
          synergyMult = this.synergy.boostFor(target, spell.element);
          damage = Math.max(1, Math.round(damage * synergyMult));
        }
        const before = target.hp;
        if (typeof target.damage === "function") target.damage(damage);
        else target.hp = Math.max(0, target.hp - damage);
        const dealt = before - target.hp;
        let inflicted = null;
        if (spell.inflict && this.status && target.hp > 0) {
          // Task #133: apply through the magic-status system when wired in
          // (spell's own duration: Sleep 2 turns, Poison 4, Hold 2, Water 2);
          // otherwise fall back to the raw inflict block.
          let r;
          if (this.magicStatus) {
            r = this.magicStatus.apply(spellId, target, { status: this.status });
          } else {
            r = this.status.apply(target, spell.inflict.status, {
              chance: spell.inflict.chance ?? 1,
              turns: spell.inflict.turns ?? undefined,
            });
          }
          if (r.ok) inflicted = r.status;
        }
        results.push({
          target,
          type: "damage",
          damage: dealt,
          raw,
          multiplier,
          synergy: synergyMult,
          element: spell.element ?? null,
          weak: multiplier > 1,
          resisted: multiplier < 1 && multiplier > 0,
          immune: multiplier === 0,
          inflicted,
        });
      }
    }

    return {
      ok: true,
      spell,
      spellId,
      mpCost: cost,
      scope,
      results,
      targets,
      visual: this.visuals ? this.visuals.cueFor(spellId) : null,
    };
  }
}

export { isAlive };
