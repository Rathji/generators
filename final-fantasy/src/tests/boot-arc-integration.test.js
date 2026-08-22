// Validation tests for Task #209: the full boot arc — title screen state,
// New Game, play, save, Return to Title, Continue, Delete, corruption
// recovery, rest-autosave, and NG+ cycle carryover — wired through the real
// engine modules exactly as main.js constructs them.

import { GameBootSystem } from "../engine/boot.js";
import { SaveSlotSystem } from "../engine/save-slots.js";
import { TitleController, TITLE_ACTIONS } from "../engine/title.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { NgPlusSystem } from "../engine/ngplus.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { GameOverSystem } from "../engine/gameover.js";
import { NEW_GAME } from "../data/new-game.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const storage = (() => {
    const m = {};
    return {
      setItem(k, v) { m[k] = v; },
      getItem(k) { return k in m ? m[k] : null; },
      removeItem(k) { delete m[k]; },
      dump: () => m,
    };
  })();

  // --- Wire up the live game exactly like main.js -------------------------
  const state = new GameState();
  const party = new PartyManager({ gold: 150 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  const inv = new Inventory();
  inv.add("potion", 5);
  inv.add("crystalKey", 1);
  state.setParty(party);
  state.setInventory(inv);
  state.setLocation("cornelia", 7, 5, "S");
  state.setFlag("intro_seen", true);

  const slots = new SaveSlotSystem({ storage });
  const gameOver = new GameOverSystem({ party, state });
  const boot = new GameBootSystem({ state, party, inventory: inv, slots, gameOver });
  const title = new TitleController({ slots });

  check("config data wired", boot.config === NEW_GAME && NEW_GAME.start.mapId === "cornelia");
  check("no saves at start", slots.any() === false);
  check("continue disabled at start", title.menuItems()[1].enabled === false);

  // --- New Game via the title ----------------------------------------------
  const dispatched = [];
  title.onSelect = (a, s) => dispatched.push([a, s]);
  title.cursor = 0;
  title.confirm();
  check("new game dispatched from title", dispatched.some(([a]) => a === TITLE_ACTIONS.NEW));

  const ng = boot.newGame();
  check("newGame fresh", ng.ok === true && ng.fresh === true);
  check("fresh party", party.members.length === 3 && party.members.every((m) => m.level === 1));
  check("fresh location", state.location.mapId === "cornelia" && state.location.x === 7);
  check("fresh gold", party.gold === 150 && state.gold === 150);
  check("fresh inventory", inv.count("potion") === 5 && inv.count("crystalKey") === 1);
  check("checkpoint seeded", gameOver.hasCheckpoint === true && gameOver.checkpointInfo.name === "Cornelia");

  // --- Play: level up, gear up, wander, collect flags ----------------------
  const hero = party.members[0];
  party.grantXp(2200);
  hero.equipment.weapon = "masamune";
  hero.equipment.armor = "runePlate";
  hero.damage(35);
  const hpAtSave = hero.hp;
  party.gold = 4200;
  state.setFlag("story_garland_defeated", true);
  state.setFlag("crystal_fire_restored", true);
  state.setFlag("waystone_cornelia", true);
  state.setFlag("keeper_tokens", 5);
  state.setLocation("caves_of_cornelia", 3, 2, "W");
  state.playTimeSec = 720;
  inv.add("elixir", 2);
  const mage = party.members[1];
  mage.learnSpell("firaga");
  mage.mp = 4;

  // --- Save to a slot --------------------------------------------------------
  const sv = boot.saveCurrent("A");
  check("saveCurrent ok", sv.ok === true && boot.activeSlot === "A");
  check("meta level", sv.meta.level >= 3);
  check("meta gold", sv.meta.gold === 4200);
  check("meta location", sv.meta.mapId === "caves_of_cornelia");
  check("meta playtime", sv.meta.playTimeSec === 720);
  check("meta members", sv.meta.partyCount === 3);

  // --- Return to Title, then Continue ---------------------------------------
  const tt = boot.toTitle();
  check("toTitle clears session", tt.ok === true && boot.booted === false && boot.activeSlot === null);
  check("toTitle cleared checkpoint", gameOver.hasCheckpoint === false);
  check("toTitle moved state to title", state.location.mapId === "title");

  const cr = boot.continue("A");
  check("continue ok", cr.ok === true && cr.slot === "A" && cr.fresh === false);
  check("restored location", state.location.mapId === "caves_of_cornelia" && state.location.facing === "W");
  check("restored gold", party.gold === 4200);
  check("restored hp", hero.hp === hpAtSave, "hp=" + hero.hp);
  check("restored weapon", hero.equipment.weapon === "masamune");
  check("restored spells", mage.knowsSpell("firaga"));
  check("restored mp", mage.mp === 4);
  check("restored flags", state.getFlag("story_garland_defeated") && state.getFlag("waystone_cornelia") && state.flags.keeper_tokens === 5);
  check("restored playtime", state.playTimeSec === 720);
  check("restored inventory", inv.count("elixir") === 2);
  check("checkpoint re-seeded", gameOver.hasCheckpoint === true);

  // --- Rest-autosave (inn) ---------------------------------------------------
  const preGold = party.gold;
  const preHp = hero.hp;
  gameOver.savepoint("cornelia", 7, 5, "S", "Cornelia");
  party.gold = preGold - 40;
  hero.restoreAll();
  const au = boot.autosave();
  check("autosave after rest ok", au.ok === true && au.meta.gold === preGold - 40);
  check("autosave kept slot", boot.activeSlot === "A");
  const auMeta = slots.meta("A");
  check("autosave persisted", auMeta.gold === preGold - 40);
  hero.hp = preHp; // restore for later checks

  // --- Corruption recovery -----------------------------------------------------
  const good = slots.manager.raw("A");
  check("raw save readable", typeof good === "string");
  const rawDump = storage.dump();
  rawDump["ff_save_A"] = "totally{broken";
  const rec = slots.read("A");
  check("corrupt main recovers from backup", rec && !rec.error && rec.fromBackup === true);
  check("recovered continue works", boot.continue("A").ok === true);
  rawDump["ff_save_A"] = good;
  check("restored good save", slots.read("A").party.gold === preGold - 40);

  // --- NG+ cycle carryover ----------------------------------------------------
  const es = new EnemyTemplateSystem();
  const ngplus = new NgPlusSystem({ state, party, inventory: inv, enemySystem: es });
  state.setFlag("story_chrono_defeated", true);
  const c2 = ngplus.startCycle();
  check("cycle 2 started", c2.ok === true && c2.cycle === 2);
  check("cycle flag set", state.flags["ngplus_cycle"] === 2);
  const sv2 = boot.saveCurrent("B");
  check("cycle save ok", sv2.ok === true);
  check("meta reports cycle 2", sv2.meta.cycle === 2);
  boot.toTitle();
  const cr2 = boot.continue("B");
  check("continue keeps cycle", cr2.ok === true && (state.flags["ngplus_cycle"] ?? 1) === 2);
  check("continue keeps story reset", state.getFlag("story_chrono_defeated") === false);
  check("continue keeps preserved flags", state.getFlag("waystone_cornelia") === true);

  // --- Delete + title states --------------------------------------------------
  title.onSelect = null;
  title.openSlots(true);
  title.cursor = 0;
  title.confirm();
  check("delete mode erases", slots.has("A") === false);
  slots.erase("B");
  check("erase slot B", slots.any() === false);
  check("continue disabled again", title.menuItems()[1].enabled === false);

  return out;
}
