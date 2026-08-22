// Validation tests for Task #65: Spell Effect Mapping.

import { SpellEffectSystem } from "../engine/spell-effects.js";
import { StatusEffectSystem } from "../engine/status.js";
import { SPELLS } from "../data/spells.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const fx = new SpellEffectSystem();

  check("fire classified damage", fx.classify(SPELLS.fire) === "damage");
  check("cure classified heal", fx.classify(SPELLS.cure) === "heal");
  check("sleep classified status", fx.classify(SPELLS.sleep) === "status");
  check("esuna classified cureStatus", fx.classify(SPELLS.esuna) === "cureStatus");

  const pf = fx.profile("fire");
  check("fire profile", pf && pf.kind === "damage" && pf.element === "fire" && pf.target === "single-enemy");
  const pe = fx.profile("esuna");
  check("esuna profile", pe && pe.kind === "cureStatus" && pe.cureStatus === "all");
  check("unknown spell profile null", fx.profile("bogus") === null);

  // Every spell in the database has a functional description.
  const all = Object.keys(SPELLS).every((id) => typeof fx.describe(id) === "string" && fx.describe(id).length > 0);
  check("all spells described", all);

  // Status spell resolution via the status system.
  const status = new StatusEffectSystem({ random: () => 0 });
  const target = { id: "e", name: "Enemy", hp: 30, maxHp: 30 };
  const sleepRes = fx.resolve("sleep", target, { status });
  check("sleep resolves status", sleepRes.ok === true && status.has(target, "sleep"));

  const esunaRes = fx.resolve("esuna", target, { status });
  check("esuna cures all", esunaRes.ok === true && target.statuses.length === 0);

  check("resolve needs status system", fx.resolve("sleep", target, {}).ok === false);

  return out;
}
