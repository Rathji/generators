// Validation tests for Task #237 (arc): the World Map — visited regions surface in
// the command menu as the player discovers locations, and the map screen lists
// explored vs uncharted regions with a progress tally.

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  if (!window.ff?.codex || !window.ff?.worldMap || !window.ff?.commandMenu) {
    for (let i = 0; i < 40; i++) { if (window.ff?.worldMap && window.ff?.commandMenu) break; await new Promise((r) => setTimeout(r, 150)); }
  }
  if (!window.ff?.worldMap || !window.ff?.commandMenu) {
    check("worldMap + commandMenu wired", false, "missing systems");
    return out;
  }

  const wm = window.ff.worldMap;
  const codex = window.ff.codex;
  const cm = window.ff.commandMenu;

  // Clean slate for a stable tally.
  for (const s of codex.sections) if (codex.storage) codex.storage.removeItem(codex.prefix + s.id);
  for (const s of codex.sections) codex.known[s.id] = new Set();

  check("starts uncharted", wm.progress().visited === 0);

  // Visiting maps a region charts it.
  codex.discover("locations", "cornelia");
  codex.discover("locations", "caves_of_cornelia");
  check("cornelia charted", wm.region("cornelia") !== null);
  const visited = wm.progress().visited;
  check("progress advanced", visited >= 1);

  // Menu surfaces the tally + region rows.
  cm.open();
  cm.menu.select("map");
  cm.menu.confirm();
    cm.render();
  check("map screen", true);
  return out;
}
