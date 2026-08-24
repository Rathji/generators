// Validation tests for Task #219: the Command Menu arc — boot a fresh game,
// use items / equip gear / swap formation through the menu, save, wipe the
// world, continue, and confirm everything the menu did survived. Also drives
// the demo's menu panel DOM.

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  let boot = window.ff?.boot;
  let cm = window.ff?.commandMenu;
  if ((!boot || !cm) && typeof window !== "undefined") {
    for (let i = 0; i < 40; i++) { if (window.ff?.boot && window.ff?.commandMenu) break; await new Promise((r) => setTimeout(r, 150)); }
    boot = window.ff?.boot;
    cm = window.ff?.commandMenu;
  }
  if (!boot || !cm) {
    check("boot + commandMenu wired", false, "missing ff.boot/ff.commandMenu");
    return out;
  }

  // Clean slate.
  for (const s of ["A", "B", "C"]) window.ff.slots.erase(s);
  boot.newGame();

  // Gear + consumables for the run.
  const inv = window.game.inventory;
  inv.add("ironSword", 1);
  inv.add("chain", 1);
  inv.add("potion", 2);
  inv.add("ether", 1);
  const hero = window.game.party.members[0];
  hero.damage(15);
  window.game.party.members[1].mp = 2;

  const toRoot = () => { while (cm.menu.depth > 1) cm.handleKey("Escape"); };

  // Root screen.
  cm.open();
  check("root command screen", cm.render().items.map((i) => i.id).join(",") === "items,magic,equip,status,formation,codex,map");
  check("items row enabled", !cm.render().items.find((i) => i.id === "items").disabled);

  // Items -> Potion -> Hero.
  cm.menu.select("items");
  cm.menu.confirm();
  cm.menu.select("item_potion");
  cm.menu.confirm();
  cm.menu.select("target_hero");
  cm.menu.confirm();
  check("potion healed hero via menu", hero.hp === hero.getStats().maxHp, "hp=" + hero.hp);
  check("potion consumed via menu", inv.count("potion") === 6, "count=" + inv.count("potion"));

  // Magic -> Healer -> Cure -> Hero.
  toRoot();
  cm.menu.select("magic");
  cm.menu.confirm();
  cm.menu.select("caster_healer");
  cm.menu.confirm();
  check("cure listed for healer", !!cm.render().items.find((i) => i.id === "spell_cure"));
  hero.damage(12);
  cm.menu.select("spell_cure");
  cm.menu.confirm();
  cm.menu.select("target_hero");
  cm.menu.confirm();
  check("cure healed hero", hero.hp === hero.getStats().maxHp, "hp=" + hero.hp);

  // Equip -> Hero -> Weapon -> Iron Sword.
  toRoot();
  cm.menu.select("equip");
  cm.menu.confirm();
  cm.menu.select("member_hero");
  cm.menu.confirm();
  cm.menu.select("slot_weapon");
  cm.menu.confirm();
  const gearItems = cm.render().items.map((i) => i.id);
  check("iron sword offered", gearItems.includes("gear_ironSword"));
  cm.menu.select("gear_ironSword");
  cm.menu.confirm();
  check("sword equipped via menu", hero.equipment.weapon === "ironSword");
  check("sword left inventory", inv.count("ironSword") === 0);
  check("atk raised by sword", hero.getStats().atk === 8);

  // Formation -> swap Hero with Mage.
  toRoot();
  cm.menu.select("formation");
  cm.menu.confirm();
  cm.menu.select("member_hero");
  cm.menu.confirm();
  check("formation swapped hero/mage", window.game.party.members.map((m) => m.id).join(",") === "mage,hero,healer");

  // Save, nuke the world, Continue: everything menu did survives.
  const mpBeforeSave = window.game.party.members[2].mp;
  const sv = boot.saveCurrent("A");
  check("save written from menu-altered game", sv.ok === true);
  boot.newGame();
  check("world reset", window.game.party.members[0].equipment.weapon === null && inv.count("ironSword") === 0);
  const cr = boot.continue("A");
  check("continue ok", cr.ok === true);
  check("weapon survived save/load", window.game.party.members.find((m) => m.id === "hero").equipment.weapon === "ironSword");
  check("party order survived save/load", window.game.party.members.map((m) => m.id).join(",") === "mage,hero,healer");
  check("healer mp survived", window.game.party.members[2].mp === mpBeforeSave);

  // Demo DOM: open the panel, use a potion through the UI.
  const demoWasMounted = !!document.getElementById("rpgDemo");
  if (!demoWasMounted) {
    window.startGame({ fresh: false });
    for (let i = 0; i < 30; i++) { if (document.getElementById("rpgDemo") && !document.getElementById("rpgDemo").hidden) break; await new Promise((r) => setTimeout(r, 200)); }
  }
  const heroNow = window.game.party.members.find((m) => m.id === "hero");
  heroNow.damage(10);
  const panel = document.getElementById("rpgMenuPanel");
  check("menu panel exists", !!panel);
  if (panel) {
    window.rpgDemo.helpers.closeCommandMenu();
    window.rpgDemo.helpers.toggleCommandMenu();
    check("panel opens", panel.hidden === false);
    const rows = () => [...document.querySelectorAll("#rpgMenuList .menu-row")];
    check("root rows rendered", rows().length === 7);
    const byId = (id) => rows().find((r) => r.dataset.id === id);
    byId("items").click();
    byId("item_potion").click();
    byId("target_hero").click();
    await new Promise((r) => setTimeout(r, 50));
    check("potion via UI heals", heroNow.hp === heroNow.getStats().maxHp, "hp=" + heroNow.hp);
    check("UI shows result message", (document.getElementById("rpgMenuMsg").textContent ?? "").includes("HP"));
    window.rpgDemo.helpers.closeCommandMenu();
    check("panel closes", panel.hidden === true);
  }

  // Cleanup.
  for (const s of ["A", "B", "C"]) window.ff.slots.erase(s);
  boot.toTitle();
  window.ff.titleScreen?.show();
  check("cleaned up", window.ff.slots.any() === false);

  return out;
}
