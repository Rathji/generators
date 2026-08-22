// Validation tests for Task #144: Item Use-Case Validation — e.g. Cure
// cannot target an already full-HP ally.

import { UseCaseValidator } from "../engine/use-case-validator.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";
import { Character } from "../engine/character.js";
import { SPELLS } from "../data/spells.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const v = new UseCaseValidator();
  const healer = new Character({ id: "h", name: "Healer", classId: "whiteMage" });
  const full = new Character({ id: "f", name: "Full", classId: "warrior" });
  const wounded = new Character({ id: "w", name: "Wounded", classId: "warrior" });
  wounded.damage(30);
  const down = new Character({ id: "d", name: "Down", classId: "warrior" });
  down.damage(9999);

  const cure = SPELLS.cure;
  check("cure valid on wounded", v.spellTargetValid(cure, wounded) === true);
  check("cure invalid on full-HP ally", v.spellTargetValid(cure, full) === false);
  check("cure reason on full HP", v.reason(cure, full) === "already full HP");
  check("cure invalid on downed ally", v.spellTargetValid(cure, down) === false && v.reason(cure, down) === "target is down");

  // Esuna only makes sense on an afflicted ally.
  const esuna = SPELLS.esuna;
  const poisoned = new Character({ id: "p", name: "Poisoned", classId: "warrior" });
  poisoned.addStatus("poison");
  check("esuna valid on poisoned", v.spellTargetValid(esuna, poisoned) === true);
  check("esuna invalid on healthy", v.spellTargetValid(esuna, full) === false && v.reason(esuna, full) === "nothing to cure");

  // Damage spells still only accept living targets.
  check("damage valid on alive enemy", v.spellTargetValid(SPELLS.fire, { hp: 5 }) === true);
  check("damage invalid on dead enemy", v.spellTargetValid(SPELLS.fire, { hp: 0 }) === false);

  // validateSpellCast filters a mixed list and reports blocked targets.
  const res = v.validateSpellCast(cure, [wounded, full, down]);
  check("mixed list keeps only valid", res.valid.length === 1 && res.valid[0] === wounded);
  check("blocked reasons reported", res.blocked.length === 2);
  check("ok true while one valid remains", res.ok === true);
  const allBad = v.validateSpellCast(cure, [full, down]);
  check("all-invalid fails", allBad.ok === false && allBad.reason === "already full HP");

  // SpellCastingSystem integration: a wired validator refuses a useless cast
  // BEFORE spending MP, and no-ops the full-HP target of a multi-heal.
  const sc = new SpellCastingSystem({ random: () => 0.5, useCaseValidator: v });
  const party = [healer, full, wounded];
  const blocked = sc.cast(healer, "cure", party, [], full);
  check("cure on full-HP ally is refused", blocked.ok === false && blocked.error === "already full HP");
  check("refused cast spends no MP", healer.mp === healer.getStats().maxMp);

  const ok = sc.cast(healer, "cure", party, [], wounded);
  check("cure on wounded ally still works", ok.ok === true && ok.results[0].target === wounded);

  // Without a validator the engine keeps its legacy behavior (no filtering).
  const bare = new SpellCastingSystem({ random: () => 0.5 });
  const h2 = new Character({ id: "h2", name: "Healer2", classId: "whiteMage" });
  const legacy = bare.cast(h2, "cure", [h2, full], [], full);
  check("legacy engine heals full-HP no-op", legacy.ok === true && legacy.results[0].amount === 0);

  return out;
}
