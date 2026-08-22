// Validation tests for Task #130: Spell Casting Animation Sync.

import { SpellAnimationSyncSystem } from "../engine/spell-animation-sync.js";
import { SPELLS } from "../data/spells.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new SpellAnimationSyncSystem();

  const fire = sys.timeline("fire");
  check("fire timeline has 3 stages", fire !== null && fire.length === 3);
  check("stages ordered", sys.stages("fire").join(",") === "cast,release,impact");
  check("cast frame is 0", sys.stageFor("fire", "cast").frame === 0);
  check("fire uses element frame", sys.framesFor("fire").includes(2));
  check("release and impact share frame", sys.stageFor("fire", "release").frame === sys.stageFor("fire", "impact").frame);
  check("impact text names the spell", sys.stageFor("fire", "impact").text.includes("Fire"));
  check("durations are positive", fire.every((s) => s.durationMs > 0));
  check("total duration positive", sys.totalDuration("fire") > 0);

  check("heal uses kind frame", sys.framesFor("cure").includes(9));
  check("cureStatus uses kind frame", sys.framesFor("esuna").includes(10));
  check("blizzard ice frame", sys.framesFor("blizzard").includes(3));
  check("thunder lightning frame", sys.framesFor("thunder").includes(4));
  check("unknown spell null", sys.timeline("nope") === null);

  // Execution-text sync: lines map onto cast/release/impact frames.
  const lines = ["Mage casts Fire! (4 MP)", "Goblin takes 12 damage."];
  const mapped = sys.timelineForText("fire", lines);
  check("text maps to frames", mapped.length === 2 && mapped[0].frame === 0 && mapped[1].frame === 2);
  check("text preserved", mapped[0].text === lines[0]);

  const many = sys.timelineForText("fire", ["a", "b", "c", "d"]);
  check("overflow repeats impact frame", many[3].frame === many[2].frame && many[3].stage === "impact");

  // syncController registers one animation per stage.
  const controller = { stored: [], addAnimation(n, o) { this.stored.push({ n, o }); } };
  const t = sys.syncController("fire", controller);
  check("syncController adds 3 animations", t !== null && controller.stored.length === 3);
  check("animations named by stage", controller.stored.every((a) => a.n.startsWith("spell_")));

  check("describe summarizes", sys.describe("fire")?.stages.length === 3 && sys.describe("fire").frames[0] === 0);

  // Every spell in the DB resolves to a timeline (no gaps).
  const audit = sys.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);
  check("every spell has timeline", Object.keys(SPELLS).every((id) => sys.timeline(id) !== null));

  return out;
}
