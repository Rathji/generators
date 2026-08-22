// Validation tests for Task #105: GameCompletionSystem — end-of-game
// completion + Free Roam, the save-slot metadata that marks completed saves
// (★ / Free Roam on the title screen), and the serialize/load round-trip.

import { GameCompletionSystem } from "../engine/completion.js";
import { SaveSlotSystem } from "../engine/save-slots.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { serializeGame, deserializeGame } from "../engine/save.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = fakeState();
  let completed = 0;
  const comp = new GameCompletionSystem({ state, onComplete: () => completed++ });

  check("not completed initially", comp.isCompleted() === false && comp.freeRoamAvailable() === false);
  check("describe pre-completion", comp.describe().includes("not been reached"));

  const r = comp.complete();
  check("complete() ok", r.ok === true);
  check("flags set", state.getFlag("game_completed") === true && state.getFlag("free_roam") === true);
  check("isCompleted + free roam", comp.isCompleted() === true && comp.freeRoamAvailable() === true);
  check("onComplete fired", completed === 1);
  check("describe post-completion", comp.describe().includes("Free Roam"));

  // Free Roam requires a completed save AND a boot controller.
  const fresh = new GameCompletionSystem({ state: fakeState() });
  const bootCalls = [];
  const boot = { continue: (slot) => { bootCalls.push(slot); return { ok: true, slot }; } };
  const denied = fresh.freeRoam("A", boot);
  check("free roam denied when incomplete", denied.ok === false && denied.error === "not_completed");
  check("boot untouched on denial", bootCalls.length === 0);
  check("no boot refused", comp.freeRoam("A", null).ok === false);
  const ok = comp.freeRoam("B", boot);
  check("free roam continues slot", ok.ok === true && ok.freeRoam === true && bootCalls.join(",") === "B");

  // Save-slot metadata marks completed / free-roam saves.
  const real = new GameState();
  const party = new PartyManager({ gold: 0 });
  const inv = new Inventory();
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  real.setParty(party);
  real.setInventory(inv);
  real.setFlag("game_completed", true);
  real.setFlag("free_roam", true);
  const slots = new SaveSlotSystem({ storage: null });
  const meta = slots.computeMeta("A", { state: real, party });
  check("meta marks completed", meta.completed === true && meta.freeRoam === true);

  const real2 = new GameState();
  const party2 = new PartyManager({ gold: 0 });
  const inv2 = new Inventory();
  party2.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  real2.setParty(party2);
  real2.setInventory(inv2);
  const meta2 = slots.computeMeta("A", { state: real2, party: party2 });
  check("meta unset for unfinished save", meta2.completed === false && meta2.freeRoam === false);

  // The flags ride on GameState.snapshot(), so they survive save/load.
  const json = serializeGame({ state: real, party, inventory: inv });
  const parsed = JSON.parse(json);
  check("serialized snapshot carries flags", parsed.state.flags.game_completed === true && parsed.state.flags.free_roam === true);
  const back = deserializeGame(parsed);
  check("load restores completion flags", back.state.getFlag("game_completed") === true && back.state.getFlag("free_roam") === true);

  // The title screen reads meta.freeRoam / meta.completed — verified via
  // SaveSlotSystem.write+read round trip.
  const storage = { map: {}, setItem(k, v) { this.map[k] = v; }, getItem(k) { return k in this.map ? this.map[k] : null; }, removeItem(k) { delete this.map[k]; } };
  const slots2 = new SaveSlotSystem({ storage });
  slots2.write("C", { state: real, party, inventory: inv });
  const meta3 = slots2.meta("C");
  check("meta survives write/read", meta3.completed === true && meta3.freeRoam === true);

  return out;
}
