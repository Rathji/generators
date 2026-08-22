// Validation tests for Task #118: interactive environment objects.

import { EnvironmentObjectSystem } from "../engine/environment.js";
import { ENVIRONMENT_OBJECTS } from "../data/environment-objects.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

function make(extra = []) {
  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  const state = new GameState();
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const party = new PartyManager({ gold: 0 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const dialogs = [];
  const sys = new EnvironmentObjectSystem([...ENVIRONMENT_OBJECTS, ...extra], {
    state,
    inventory: inv,
    party,
    maps,
    handlers: { dialogue: (id) => dialogs.push(id) },
  });
  return { maps, state, inv, party, sys, dialogs };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const { maps, state, inv, party, sys, dialogs } = make();

  check("objects exist", sys.all().length > 0);
  check("objectAt finds road sign", sys.objectAt("cornelia", 12, 4)?.id === "cornelia_road_sign");
  check("objectAt empty null", sys.objectAt("cornelia", 5, 5) === null);
  check("objectById", sys.objectById("inn_well")?.kind === "well");
  check("objectsFor counts per map", sys.objectsFor("cornelia").length === 3);

  check("all placements valid", sys.isValid() === true);
  check("no invalid placements", sys.invalidPlacements.length === 0);

  const sign = sys.interact("cornelia", 12, 4);
  check("sign interaction ok", sign.ok === true && sign.flavor.length > 0);
  check("sign grants nothing", sign.gold === undefined && sign.granted === undefined);

  const barrel = sys.interact("cornelia", 3, 4);
  check("barrel gives gold", barrel.ok === true && barrel.gold === 10 && party.gold === 10);
  check("barrel once flag set", state.getFlag("obj_apple_barrel_used") === true);
  check("barrel used twice blocked", sys.interact("cornelia", 3, 4).ok === false);
  check("barrel remains interactable via objectAt", sys.objectAt("cornelia", 3, 4) !== null);

  check("empty tile interact fails", sys.interact("cornelia", 7, 5).ok === false);

  // Item effect + dialogue effect + require gating.
  const extra = [
    { id: "test_treasure", mapId: "cornelia_house", x: 5, y: 4, kind: "chest", label: "Test Chest", sprite: "C",
      flavor: "A locked chest.", effect: { type: "item", itemId: "potion", count: 2 }, once: true, flag: "obj_test_treasure_used" },
    { id: "test_plaque", mapId: "cornelia_inn", x: 5, y: 1, kind: "sign", label: "Plaque", sprite: "^",
      flavor: "A brass plaque.", effect: { type: "dialogue", dialogueId: "sign.inn" } },
    { id: "test_locked_door", mapId: "cornelia", x: 11, y: 5, kind: "door", label: "Locked Door", sprite: "D",
      flavor: "The door is barred.", require: { flag: "story_started" }, effect: { type: "flag", flag: "test_door_opened" } },
  ];
  const { sys: s2, state: st2, inv: inv2, dialogs: d2 } = make(extra);

  check("extra objects valid", s2.isValid() === true);
  const chest = s2.interact("cornelia_house", 5, 4);
  check("chest grants item", chest.ok === true && chest.granted?.itemId === "potion" && inv2.count("potion") === 2);
  check("chest once flag", st2.getFlag("obj_test_treasure_used") === true);
  check("chest twice blocked", s2.interact("cornelia_house", 5, 4).ok === false);

  const plaque = s2.interact("cornelia_inn", 5, 1);
  check("plaque fires dialogue", plaque.ok === true && d2.includes("sign.inn"));

  const doorLocked = s2.interact("cornelia", 11, 5);
  check("door locked before flag", doorLocked.ok === false && doorLocked.locked === true);
  st2.setFlag("story_started", true);
  const doorOpen = s2.interact("cornelia", 11, 5);
  check("door opens after flag", doorOpen.ok === true && st2.getFlag("test_door_opened") === true);

  // Validation: bad tiles / unknown items are flagged.
  const bad = make([
    { id: "bad_oom", mapId: "cornelia", x: 99, y: 99, kind: "sign", label: "X", flavor: "x" },
    { id: "bad_item", mapId: "cornelia", x: 10, y: 5, kind: "barrel", label: "Y", flavor: "y", effect: { type: "item", itemId: "nope" } },
    { id: "bad_once", mapId: "cornelia", x: 9, y: 5, kind: "sign", label: "Z", flavor: "z", once: true },
  ]);
  check("bad placements flagged", bad.sys.isValid() === false);
  check("out-of-bounds flagged", bad.sys.invalidPlacements.some((r) => r.reason === "out of bounds"));
  check("unknown item flagged", bad.sys.invalidPlacements.some((r) => r.reason.includes("unknown item")));
  check("once-without-flag flagged", bad.sys.invalidPlacements.some((r) => r.reason === "once without flag"));

  return out;
}
