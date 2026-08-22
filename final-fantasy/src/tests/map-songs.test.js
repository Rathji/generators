// Validation tests for Task #119: map-specific BGM triggers.

import { MusicController } from "../engine/music-controller.js";
import { MAP_SONGS } from "../data/map-songs.js";
import { classifyMap } from "../data/music-regions.js";

function fakeEngine() {
  return {
    songId: null,
    playing: false,
    register() {},
    unlock() { return this; },
    play(id) { this.songId = id; this.playing = true; return this; },
    stop() { this.playing = false; return this; },
    setVolume() { return this; },
    setMuted() { return this; },
    songDef: () => null,
    onEnd: null,
  };
}

function make() {
  const engine = fakeEngine();
  const songs = {
    menu: { name: "Menu" },
    town: { name: "Town" },
    overworld: { name: "Overworld" },
    dungeon: { name: "Dungeon" },
    battle: { name: "Battle" },
    boss: { name: "Boss" },
    victory: { name: "Victory" },
    gameover: { name: "Game Over" },
  };
  const mc = new MusicController({
    engine,
    songs,
    regionSongs: { overworld: "overworld", town: "town", dungeon: "dungeon" },
    classify: classifyMap,
    mapSongs: MAP_SONGS,
    startInTitle: false,
  });
  return { engine, mc };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("every map song id is a known song", Object.values(MAP_SONGS).every((s) => ["menu", "town", "overworld", "dungeon", "battle", "boss", "victory", "gameover"].includes(s)));

  const { engine, mc } = make();
  mc.setLocation("cornelia");
  check("cornelia plays town (map override)", engine.songId === "town");
  check("state region town", mc.state.region === "town");

  mc.setLocation("chaos_shrine_b2");
  check("chaos_shrine_b2 plays boss (map override beats dungeon region)", engine.songId === "boss");

  mc.setLocation("caves_of_cornelia");
  check("caves no override -> region dungeon", engine.songId === "dungeon");

  mc.setLocation("overworld");
  check("overworld explicit override", engine.songId === "overworld");

  mc.setBattle({ active: true });
  check("battle beats map override", engine.songId === "battle");
  mc.setBattle({ active: true, boss: true });
  check("boss battle theme", engine.songId === "boss");

  mc.setBattle({ active: false });
  mc.setLocation("chaos_shrine_b2");
  mc.setBattle({ active: true });
  check("battle over boss-map override", engine.songId === "battle");

  const { mc: mc2 } = make();
  mc2.setLocation("chrono_throne");
  check("chrono_throne boss override", mc2.state.songId === "boss");

  check("map without override falls back to region", (() => {
    const { engine: e3, mc: mc3 } = make();
    mc3.setLocation("pravog_house");
    return e3.songId === "town";
  })());

  return out;
}
