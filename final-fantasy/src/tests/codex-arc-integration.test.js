// Validation tests for Task #236: the Codex arc — boot a fresh game, discover
// locations/enemies/items/quests while playing, then browse the Codex from the
// Command Menu (section list -> entry detail) and confirm progression records.

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  if (!window.ff?.codex) {
    for (let i = 0; i < 40; i++) { if (window.ff?.codex) break; await new Promise((r) => setTimeout(r, 150)); }
  }
  if (!window.ff?.codex) {
    check("codex wired", false, "missing ff.codex");
    return out;
  }
  const codex = window.ff.codex;

  // Clean known state so totals are stable.
  const ownKnown = {};
  for (const s of codex.sections) { if (codex.storage) codex.storage.removeItem(codex.prefix + s.id); ownKnown[s.id] = new Set(); }
  Object.assign(codex.known, ownKnown);

  check("starts empty", codex.totalDiscovered() === 0);

  // Simulate discovery the way actual play records it.
  codex.discover("locations", "cornelia");
  codex.discover("locations", "caves_of_cornelia");
  codex.discoverMany("enemies", ["goblin", "caveBat"]);
  codex.discover("quests", "herbalists_request");
  codex.discover("spells", "fire");
  check("locations recorded", codex.sectionInfo("locations").known === 2);
  check("enemies recorded", codex.sectionInfo("enemies").known === 2);
  check("quest recorded", codex.isKnown("quests", "herbalists_request"));
  check("locations show in entries", codex.entry("locations", "cornelia")?.discovered === true);
  check("unknown remains locked", codex.isKnown("enemies", "goblinChief") === false);
  check("summary counts", codex.summary().discovered === 6);

  // Drive the Codex through the Command Menu by selecting the root menu item.
  const cm = window.ff?.commandMenu;
  if (cm) {
    cm.open();
    cm.menu.select("codex");
    cm.menu.confirm();
    const codexView = cm.render();
    check("codex screen has all six sections", codexView.title === "Codex" && codexView.items.length === 6);
    check("section shows progress", codexView.items[0].label.includes("/"));

    cm.menu.select("codex_locations");
    cm.menu.confirm();
    const locView = cm.render();
    check("locations section lists Cornelia", !!locView.items.find((i) => i.label.includes("Cornelia")));
    check("locations section shows unknown as ???", !!locView.items.find((i) => i.label === "?????"));

    cm.menu.select("codex_e_cornelia");
    cm.menu.confirm();
    const det = cm.render();
    check("location detail has lore", det.title === "Cornelia" && !!det.items.find((i) => i.id === "d_lore"));
    check("detail has back", !!det.items.find((i) => i.id === "back"));

    cm.menu.handleKey("Escape");
    cm.menu.handleKey("Escape");
    cm.menu.handleKey("Escape");
  } else {
    check("commandMenu wired", false, "missing ff.commandMenu");
  }

  // Restore clean slate for other tests.
  for (const s of codex.sections) if (codex.storage) codex.storage.removeItem(codex.prefix + s.id);
  Object.assign(codex.known, {});
  for (const s of codex.sections) codex.known[s.id] = new Set();

  return out;
}
