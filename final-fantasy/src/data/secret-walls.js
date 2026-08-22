// Secret-wall data (Task #149) — solid `#` tiles that hide a path or a
// cache. Walking INTO the wall coordinate (an attempted step that fails
// against a solid tile) reveals it once per save.

export const SECRET_WALLS = [
  {
    id: "cave_north_cache",
    mapId: "caves_of_cornelia",
    x: 8,
    y: 2,
    line: "The false wall crumbles inward — a hidden corridor behind the cave's north wall!",
    revealFlag: "secret_cave_north_cache",
    effects: [
      // The wall tile itself opens, giving access to the passable north row.
      { type: "path", tiles: [{ x: 8, y: 2 }] },
      { type: "chest", contents: { items: [{ itemId: "goblinFang", count: 2 }], gold: 30, xp: 20 } },
    ],
  },
  {
    id: "shrine_middle_pass",
    mapId: "chaos_shrine",
    x: 10,
    y: 6,
    line: "A keystone slides away — the shrine's heart opens a hidden passage, and a cache within!",
    revealFlag: "secret_shrine_middle_pass",
    effects: [
      // Opens a shortcut between the shrine's upper and lower passages.
      { type: "path", tiles: [{ x: 10, y: 6 }] },
      { type: "chest", contents: { items: [{ itemId: "ether", count: 1 }], gold: 100, xp: 40 } },
    ],
  },
];
