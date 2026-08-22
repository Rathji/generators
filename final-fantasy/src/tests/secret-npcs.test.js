// Validation tests for Task #108: secret NPC discovery.

import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";
import { GameState } from "../engine/state.js";

function registry() {
  const m = new MapManager();
  for (const def of MAPS) m.register(def);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const placements = JSON.parse(JSON.stringify(NPC_PLACEMENTS));
  const state = new GameState();
  const sys = new NpcPlacementSystem(placements, registry(), { state });

  const traveler = sys.npcById("cornelia_traveler");
  check("traveler def present", !!traveler);
  check("traveler has secret data", sys.secretDef(traveler)?.flag === "secret_traveler_found");
  check("traveler hidden before discovery", sys.isRevealed(traveler) === false);

  check("activeNpcsFor excludes hidden", sys.activeNpcsFor("cornelia").every((n) => n.id !== "cornelia_traveler"));
  check("activeNpcAt returns null on hidden tile", sys.activeNpcAt("cornelia", 12, 2) === null);
  check("secretAt finds discovery tile", sys.secretAt("cornelia", 11, 6)?.flag === "secret_traveler_found");
  check("secretAt unknown tile null", sys.secretAt("cornelia", 1, 1) === null);

  const wrong = sys.tryDiscover("cornelia", 3, 3);
  check("tryDiscover wrong tile fails cleanly", wrong.ok === false);

  const found = sys.tryDiscover("cornelia", 11, 6);
  check("tryDiscover on secret tile reveals", found.ok === true && found.npc.name === "Mysterious Traveler");
  check("discovery flag set", state.getFlag("secret_traveler_found") === true);
  check("traveler now revealed", sys.isRevealed(traveler) === true);
  check("activeNpcAt now returns traveler", sys.activeNpcAt("cornelia", 12, 2)?.id === "cornelia_traveler");
  check("activeNpcsFor now includes traveler", sys.activeNpcsFor("cornelia").some((n) => n.id === "cornelia_traveler"));

  const again = sys.tryDiscover("cornelia", 11, 6);
  check("second tryDiscover reports already revealed", again.ok === false && again.error === "already revealed");

  const base = sys.npcById("cornelia_traveler");
  check("secret tile valid (placement passes validation)", sys.isValid() === true);

  return out;
}
