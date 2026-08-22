// Validation tests for Task #46: Dynamic Menu Navigation.

import { MenuSystem, renderMenuHtml } from "../engine/menus.js";

function gameMenu() {
  return {
    title: "Command",
    items: [
      { id: "attack", label: "Attack" },
      { id: "spell", label: "Spell", action: { title: "Magic", items: [{ id: "fire", label: "Fire" }, { id: "cure", label: "Cure" }] } },
      { id: "item", label: "Item" },
      { id: "run", label: "Run", disabled: true },
    ],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const m = new MenuSystem();
  check("closed initially", m.isOpen === false && m.render() === null);
  m.open(gameMenu());
  check("opened", m.isOpen === true && m.depth === 1);
  check("first item selected", m.selectedItem().id === "attack");

  m.navigate("down");
  check("navigate down selects spell", m.selectedItem().id === "spell");
  m.navigate("up");
  check("navigate up wraps", m.selectedItem().id === "attack");

  m.navigate(3); // attack -> spell -> item -> (skip disabled run) -> attack? step 3
  const after3 = m.selectedItem().id;
  check("three down lands back on attack (skips disabled)", after3 === "attack");

  m.select("item");
  check("select by id", m.selectedItem().id === "item");

  const confirm = m.confirm();
  check("confirm non-submenu returns selection", confirm.selected === "item");

  m.select("spell");
  const sub = m.confirm();
  check("confirm pushes submenu", sub.submenu === "Magic" && m.depth === 2);
  check("submenu selected first item", m.selectedItem().id === "fire");

  const pop = m.cancel();
  check("cancel pops submenu", pop !== null && m.depth === 1);
  check("cancel at root returns null", m.cancel() === null);

  const m2 = new MenuSystem({ rememberRoot: true });
  m2.open({ title: "Root", items: [{ id: "a", label: "A", action: { title: "Sub", items: [{ id: "b", label: "B" }] } }] });
  m2.confirm();
  check("submenu depth 2", m2.depth === 2);
  m2.root();
  check("root() returns to root", m2.depth === 1 && m2.current.title === "Root");

  const m3 = new MenuSystem();
  m3.open(gameMenu());
  check("handleKey down", m3.handleKey("s")?.id === "spell");
  check("handleKey enter confirms", m3.handleKey("Enter")?.submenu === "Magic");
  check("handleKey escape cancels", m3.handleKey("Escape") !== null && m3.depth === 1);
  check("unknown key ignored", m3.handleKey("q") === null);

  const view = m3.render();
  check("render has items with selection", Array.isArray(view.items) && view.items.every((i) => typeof i.selected === "boolean"));
  check("render marks disabled", view.items.find((i) => i.id === "run").disabled === true);

  const html = renderMenuHtml(view);
  check("renderMenuHtml produces markup", html.includes('data-id="attack"') && html.includes("menu-title"));

  m3.reset();
  check("reset closes", m3.isOpen === false);

  return out;
}
