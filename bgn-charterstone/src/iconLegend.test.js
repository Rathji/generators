// src/iconLegend.test.js — Phase 15 icon legend validation (Task 71).
// Run in-page via ?test=iconlegend, or via window.__loadIconLegendTests().
// Task 71: every rendered icon tooltip resolves to a legend entry — the
// guide covers resources, influence, VP, quota, reputation, income, crate,
// objective and campaign icons, and each rendered chip's tooltip resolves.

import { RESOURCE_TYPES } from "./economy.js";
import { RESOURCE_ICONS } from "./gameUI.js";
import {
  ICON_LEGEND_VERSION, ICON_LEGEND, legendFor, tooltipFor, legendIds,
  renderLegendChips, createIconLegendModal,
} from "./iconLegend.js";

export function runIconLegendTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  ok("legend exposes version + entries", ICON_LEGEND_VERSION === 1 && legendIds().length >= 14);

  // required coverage per the roadmap
  const required = ["coins", "metal", "coal", "pumpkin", "grain", "clay", "wood", "influence", "vp", "quota", "reputation", "income", "crate", "objective", "campaign"];
  ok("legend covers every roadmap icon (resources, influence, VP, quota, reputation, income, crate, objective, campaign)",
    required.every(id => !!legendFor(id)), "missing: " + required.filter(id => !legendFor(id)).join(","));

  // every resource type has a legend entry and matches the game UI's icons
  ok("every RESOURCE_TYPES entry resolves in the legend", RESOURCE_TYPES.every(r => !!legendFor(r)));
  ok("resource legend icons match the game UI's RESOURCE_ICONS",
    RESOURCE_TYPES.every(r => legendFor(r).icon === RESOURCE_ICONS[r]));

  // tooltips round-trip: every entry produces a tooltip that resolves back
  for (const id of legendIds()) {
    const e = legendFor(id);
    const tip = tooltipFor(id);
    ok("icon '" + id + "' tooltip is non-empty and resolves back to its entry",
      !!e && typeof tip === "string" && tip.length > 0 && tip.startsWith(e.name + " — "));
  }
  ok("unknown icon ids resolve to null", legendFor("nope") === null && tooltipFor("nope") === null);

  // ── every RENDERED icon tooltip resolves to a legend entry ──
  const div = document.createElement("div");
  div.id = "legendTestHost";
  document.body.appendChild(div);
  renderLegendChips(div);
  const chips = div.querySelectorAll(".cs-legend-chip");
  ok("a chip was rendered for every legend icon", chips.length === legendIds().length);
  let allResolve = true;
  let missing = [];
  for (const chip of chips) {
    const id = chip.dataset.legend;
    if (!legendFor(id) || !chip.title || chip.title !== tooltipFor(id)) { allResolve = false; missing.push(id); }
  }
  ok("every rendered icon tooltip resolves to a legend entry", allResolve, missing.join(","));
  ok("chips are accessible (aria-label per icon)", [...chips].every(c => c.getAttribute("aria-label") === legendFor(c.dataset.legend).name));

  const modal = createIconLegendModal({ container: div });
  ok("legend modal renders a row per legend entry", div.querySelectorAll(".cs-legend-row").length === legendIds().length);
  ok("modal rows carry resolvable data-legend ids", [...div.querySelectorAll(".cs-legend-row")].every(r => !!legendFor(r.dataset.legend)));
  modal.close();
  ok("legend modal closes cleanly", !div.querySelector(".cs-legend"));
  div.remove();

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "iconlegend", pass, fail, results };
}
