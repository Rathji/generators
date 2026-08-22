// Validation tests for Task #165: Credit Roll Sequence — the team listing
// flattens into timed rows that scroll through a viewport, completing at a
// predictable moment.

import { CreditRoll } from "../engine/credits.js";
import { TEAM_CREDITS } from "../data/credits.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("team data has sections", TEAM_CREDITS.length >= 5 && TEAM_CREDITS[0].title === "FINAL FANTASY");

  const roll = new CreditRoll(TEAM_CREDITS, { cps: 48, rowH: 26 });

  const rows = roll.rows();
  check("rows flattened", rows.length > TEAM_CREDITS.length);
  check("title row first", rows[0].kind === "title" && rows[0].text === "FINAL FANTASY");
  check("subtitle follows title", rows[1].kind === "subtitle");
  check("section + names present", rows.some((r) => r.kind === "section" && r.text === "The Warriors of Light") && rows.some((r) => r.kind === "name" && r.text === "Hero"));

  check("content height positive", roll.contentHeight() > 0);
  const dur = roll.durationMs(300);
  check("duration positive + sane", dur > 0 && dur < 120000);

  // At ~60ms the opening rows have entered the bottom of the viewport.
  const f0 = roll.frame(60, 300);
  check("frame at start has rows", f0.rows.length > 0 && f0.done === false);
  check("start scroll y is small", f0.y > 0);
  const titleRow = f0.rows.find((r) => r.kind === "title");
  check("title sits near bottom", titleRow && titleRow.top >= 290 && titleRow.top <= 305);

  // Mid-roll: block has moved up.
  const mid = roll.frame(dur / 2, 300);
  check("mid-frame scrolls up", mid.y > f0.y);

  // At/after the end everything has cleared.
  const end = roll.frame(dur, 300);
  check("done at duration", roll.isDone(dur, 300) === true);
  check("done frame marks done", end.done === true);
  check("no rows visible when done", end.rows.length === 0);
  check("past-end still done", roll.isDone(dur + 500, 300) === true);

  // Empty sections are safe.
  const empty = new CreditRoll([]);
  check("empty roll ok", empty.rows().length === 0 && empty.durationMs(300) > 0);

  return out;
}
