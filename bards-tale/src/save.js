// A Bard's Tale — save/load. The game state is a mix of plain data plus
// Sets (visited/revealed) and a Map (valve directions), so it is reduced
// to a plain JSON string for the kv-plugin and rebuilt on load.

import { createGameState } from "./engine.js";

export function serializeState(state) {
  return JSON.stringify({
    v: 1,
    party: state.party,
    currentMap: state.currentMap ? {
      grid: state.currentMap.grid,
      width: state.currentMap.width,
      height: state.currentMap.height,
      name: state.currentMap.name,
      tier: state.currentMap.tier,
      start: state.currentMap.start,
      exit: state.currentMap.exit,
      light: state.currentMap.light,
      valveDir: state.currentMap.valveDir ? Object.fromEntries(state.currentMap.valveDir) : {},
    } : null,
    mapName: state.mapName,
    floor: state.floor,
    baseLight: state.baseLight,
    player: state.player,
    lastPos: state.lastPos,
    visited: [...state.visited],
    revealed: [...state.revealed],
    running: state.running,
    lightRadius: state.lightRadius,
    encounterChance: state.encounterChance,
    keys: state.keys,
    gold: state.gold,
    messages: state.messages,
    stats: state.stats,
    quests: state.quests,
    inventory: state.inventory,
    town: state.town,
    bossFloor: state.bossFloor,
    bossDefeated: state.bossDefeated,
    victory: state.victory,
  });
}

export function deserializeState(json) {
  let d;
  try {
    d = JSON.parse(json);
  } catch (e) {
    return null;
  }
  if (!d || d.v !== 1) return null;
  const s = createGameState();
  Object.assign(s, d);
  if (s.bossFloor == null) s.bossFloor = 10;
  if (typeof s.bossDefeated !== "boolean") s.bossDefeated = false;
  if (typeof s.victory !== "boolean") s.victory = false;
  if (!Number.isFinite(s.stats.secondsPlayed)) s.stats.secondsPlayed = 0;
  s.visited = new Set(d.visited || []);
  s.revealed = new Set(d.revealed || []);
  if (d.currentMap) {
    s.currentMap.valveDir = new Map(Object.entries(d.currentMap.valveDir || {}));
  } else {
    s.currentMap = null;
  }
  s.combat = null;
  return s;
}
