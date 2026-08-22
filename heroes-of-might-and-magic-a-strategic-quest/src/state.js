// src/state.js — Global state manager (Roadmap task 19).
// Single source of truth for the whole game: map, hero, mode, seed, battle.
// All modules and views read/write through this one object.

export const game = {
  map: null,
  hero: null,
  mode: "title",
  seed: 0,
  battle: null
};

export function initState(map, hero, seed) {
  game.map = map;
  game.hero = hero;
  game.seed = seed;
  game.mode = "map";
  game.battle = null;
  return game;
}
