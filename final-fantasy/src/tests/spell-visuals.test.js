// Validation tests for Task #67: Spell Casting Visual Cues.

import { SpellVisualCueSystem, SPELL_VISUALS } from "../engine/spell-visuals.js";
import { SPELLS } from "../data/spells.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const v = new SpellVisualCueSystem();

  const fire = v.cueFor("fire");
  check("fire cue", fire && fire.effect === "fireball" && /^#[0-9a-f]{6}$/i.test(fire.color) && fire.particles > 0);
  check("fire cue named", fire.name === "Fire");

  const cure = v.cueFor("cure");
  check("heal cue", cure && cure.effect === "healGlow");

  const esuna = v.cueFor("esuna");
  check("cureStatus cue", esuna && esuna.effect === "purify");

  const water = v.cueFor("water");
  check("water cue", water && water.effect === "waterSplash");

  check("unknown spell null", v.cueFor("bogus") === null);

  const el = v.cueForElement("lightning");
  check("element cue", el && el.effect === "lightningBolt");

  const colors = v.elementColors();
  check("element colors map", colors.fire && colors.ice && colors.water);

  check("all spells have cues", v.all().length === Object.keys(SPELLS).length);

  // Overrides take priority.
  const withOverride = new SpellVisualCueSystem({ overrides: { nuke: { effect: "nova", color: "#ff0000", particles: 99, duration: 900 } } });
  const nuke = withOverride.cueFor("nuke");
  check("override wins", nuke.effect === "nova" && nuke.color === "#ff0000" && nuke.particles === 99);

  check("override db exposed", typeof SPELL_VISUALS === "object");

  return out;
}
