// A Bard's Tale — core engine: game state, grid movement, collision, map
// generation, and dungeon objects (doors, chests, traps, valves, riddle
// gates, pitch-black rooms, and exits).
//
// Map tiers: Low (floors 1-3), Mid (4-6), Deep (7+). Deeper tiers use
// larger mazes, shorter light radius, and richer hazards.

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_DOOR = 2;
export const TILE_DOOR_LOCKED = 3;
export const TILE_CHEST = 4;
export const TILE_TRAP = 5;
export const TILE_EXIT = 6;
export const TILE_DARK = 7;   // pitch-black room
export const TILE_PIT = 8;    // pit trap: damage + displacement
export const TILE_VALVE = 9;  // one-way door
export const TILE_GATE = 10;  // riddle gate

// Facing: 0 = north, 1 = east, 2 = south, 3 = west
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

const MAP_TIERS = [
  {
    min: 1, factor: 1.0, size: 21, name: "Low",
    names: ["The Wine Cellars", "The Warrens Beneath", "The Hollow Quarry"],
  },
  {
    min: 4, factor: 0.78, size: 25, name: "Mid",
    names: ["The Bone Galleries", "The Sunken Vaults", "The Grim Foundry"],
  },
  {
    min: 7, factor: 0.55, size: 29, name: "Deep",
    names: ["The Shadow Choir", "The Lower Labyrinth", "The Abyssal Spire", "The Heart of Stone"],
  },
];

function tierForFloor(floor) {
  let tier = MAP_TIERS[0];
  for (const t of MAP_TIERS) {
    if (floor >= t.min) tier = t;
  }
  return tier;
}

export function createGameState() {
  return {
    party: [],
    currentMap: null,
    mapName: "",
    floor: 1,
    baseLight: 9,
    player: { x: 0, y: 0, facing: 0 },
    lastPos: { x: 0, y: 0 },
    visited: new Set(),
    revealed: new Set(),
    running: false,
    lightRadius: 9,
    encounterChance: 0.14,
    keys: 0,
    gold: 0,
    messages: [],
    combat: null,
    stats: { kills: 0, chestsOpened: 0, keysFound: 0, goldEarned: 0, floorsCleared: 0, bossDefeated: 0, secondsPlayed: 0 },
    quests: { done: {} },
    inventory: [],
    town: { location: "plaza" },
    bossFloor: 10,      // deepest floor — the Nameless Dirge waits on its exit
    bossDefeated: false,
    victory: false,
    secondsPlayed: 0,
  };
}

export function addMessage(state, text) {
  state.messages.push(text);
  if (state.messages.length > 8) state.messages.shift();
}

// Standability is directional: a valve door only admits you from one side.
// `dir` is the direction of travel (the facing used for the move).
export function canStand(state, x, y, dir) {
  const m = state.currentMap;
  if (!m || !m.grid || !m.grid.length) return false;
  const grid = m.grid;
  if (x < 0 || y < 0 || y >= grid.length || x >= grid[0].length) return false;
  const t = grid[y][x];
  if (t === TILE_VALVE) {
    if (m.valveDir && dir !== undefined) {
      return m.valveDir.get(x + "," + y) === dir;
    }
    return false;
  }
  return t !== TILE_WALL && t !== TILE_DOOR && t !== TILE_DOOR_LOCKED && t !== TILE_GATE;
}

export function revealAround(state, x, y) {
  state.visited.add(x + "," + y);
  for (let d = 0; d < 4; d++) {
    state.revealed.add((x + DX[d]) + "," + (y + DY[d]));
  }
}

export function tryMove(state, mode) {
  const f = state.player.facing;
  const p = state.player;
  const modeDir = { forward: f, back: (f + 2) % 4, left: (f + 3) % 4, right: (f + 1) % 4 };
  const dir = modeDir[mode];
  let tx = p.x, ty = p.y;
  if (mode === "forward") { tx += DX[f]; ty += DY[f]; }
  else if (mode === "back") { tx -= DX[f]; ty -= DY[f]; }
  else if (mode === "left") { tx += DX[(f + 3) % 4]; ty += DY[(f + 3) % 4]; }
  else if (mode === "right") { tx += DX[(f + 1) % 4]; ty += DY[(f + 1) % 4]; }
  if (!canStand(state, tx, ty, dir)) return false;
  state.lastPos = { x: p.x, y: p.y };
  p.x = tx;
  p.y = ty;
  revealAround(state, tx, ty);
  stepOnTile(state);
  if (typeof state.onMove === "function") state.onMove(state);
  return true;
}

export function turn(state, dir) {
  state.player.facing = (state.player.facing + dir + 4) % 4;
}

// Things that happen when the player steps onto a special tile.
// Things that happen when the player steps onto a special tile.
function sound(state, label) {
  if (typeof state.onSound === "function") state.onSound(state, label);
}

export function stepOnTile(state) {
  const grid = state.currentMap.grid;
  const t = grid[state.player.y][state.player.x];
  if (t === TILE_TRAP) {
    grid[state.player.y][state.player.x] = TILE_FLOOR;
    addMessage(state, "Spikes lash out of the floor! Something in the party is wounded.");
    sound(state, "trap");
    const alive = state.party.filter(m => m.hp > 0);
    if (alive.length) {
      const victim = alive[Math.floor(Math.random() * alive.length)];
      const dmg = 2 + Math.floor(Math.random() * 5);
      victim.hp = Math.max(1, victim.hp - dmg);
      addMessage(state, victim.name + " takes " + dmg + " damage from the spikes.");
    }
  } else if (t === TILE_PIT) {
    grid[state.player.y][state.player.x] = TILE_FLOOR;
    addMessage(state, "The floor gives way! Someone drops into a pit.");
    sound(state, "pit");
    const alive = state.party.filter(m => m.hp > 0);
    if (alive.length) {
      const victim = alive[Math.floor(Math.random() * alive.length)];
      const dmg = 1 + Math.floor(Math.random() * 4);
      victim.hp = Math.max(1, victim.hp - dmg);
      addMessage(state, victim.name + " takes " + dmg + " damage from the fall.");
    }
    const lp = state.lastPos;
    if (lp && canStand(state, lp.x, lp.y)) {
      state.player.x = lp.x;
      state.player.y = lp.y;
      addMessage(state, "You scramble back the way you came.");
    } else {
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const nx = state.player.x + DX[d], ny = state.player.y + DY[d];
        if (canStand(state, nx, ny)) opts.push([nx, ny]);
      }
      if (opts.length) {
        const pick = opts[Math.floor(Math.random() * opts.length)];
        state.player.x = pick[0];
        state.player.y = pick[1];
      }
    }
  } else if (t === TILE_DARK) {
    addMessage(state, "Pitch black! The light is swallowed whole.");
    sound(state, "dark");
  } else if (t === TILE_CHEST) {
    addMessage(state, "A wooden chest lies here. Press E to open it.");
  } else if (t === TILE_VALVE) {
    addMessage(state, "You slip through a one-way valve. It clicks shut behind you.");
    sound(state, "valve");
  } else if (t === TILE_EXIT) {
    addMessage(state, "A stairway spirals down into deeper dark.");
    sound(state, "descend");
    // The deepest floor's exit is the final boss's chamber — let the app
    // decide (it may trigger the Dirge fight instead of descending).
    if (typeof state.onExit === "function" && state.onExit(state) === "handled") return;
    descend(state);
  }
}

// Descend to the next floor — a fresh map (drawn from the depth tier),
// a tighter light radius, and tougher monsters.
export function descend(state) {
  state.floor++;
  state.currentMap = generateMap(state.floor, state.baseLight);
  state.mapName = state.currentMap.name;
  state.lightRadius = state.currentMap.light;
  placePlayerAtStart(state);
  state.stats.floorsCleared++;
  addMessage(state, "You descend into " + state.mapName + " — floor " + state.floor + ".");
}

export function tileAhead(state) {
  const f = state.player.facing;
  const x = state.player.x + DX[f];
  const y = state.player.y + DY[f];
  const m = state.currentMap && state.currentMap.grid;
  if (!m) return null;
  if (y < 0 || y >= m.length || x < 0 || x >= m[0].length) return null;
  return m[y][x];
}

// Interact with doors / chests. Returns true if something happened.
export function interact(state) {
  const grid = state.currentMap.grid;
  const f = state.player.facing;
  const ax = state.player.x + DX[f];
  const ay = state.player.y + DY[f];
  const ahead = tileAhead(state);

  if (ahead === TILE_DOOR) {
    grid[ay][ax] = TILE_FLOOR;
    revealAround(state, ax, ay);
    addMessage(state, "You push the door open.");
    sound(state, "door");
    return true;
  }
  if (ahead === TILE_DOOR_LOCKED) {
    if (state.keys > 0) {
      state.keys--;
      grid[ay][ax] = TILE_FLOOR;
      revealAround(state, ax, ay);
      addMessage(state, "The lock clicks — you use an iron key.");
      sound(state, "lock");
      return true;
    }
    addMessage(state, "The door is locked fast. You need a key.");
    sound(state, "lock");
    return false;
  }
  if (ahead === TILE_CHEST) {
    return openChest(state, ax, ay);
  }

  const t = grid[state.player.y][state.player.x];
  if (t === TILE_CHEST) {
    return openChest(state, state.player.x, state.player.y);
  }

  addMessage(state, "There is nothing here to interact with.");
  return false;
}

function openChest(state, x, y) {
  state.currentMap.grid[y][x] = TILE_FLOOR;
  const gold = 5 + Math.floor(Math.random() * 30);
  state.gold += gold;
  state.stats.goldEarned += gold;
  state.stats.chestsOpened++;
  addMessage(state, "You open the chest and find " + gold + " gold.");
  sound(state, "chest");
  if (Math.random() < 0.3) {
    state.keys++;
    state.stats.keysFound++;
    addMessage(state, "Inside you find an iron key!");
    sound(state, "key");
  }
  return true;
}

function bfsFarthestFloor(grid, sx, sy) {
  const h = grid.length, w = grid[0].length;
  const dist = Array.from({ length: h }, () => Array(w).fill(-1));
  const queue = [[sx, sy]];
  dist[sy][sx] = 0;
  let best = { x: sx, y: sy, d: 0 };
  while (queue.length) {
    const [x, y] = queue.shift();
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || ny >= h || nx >= w) continue;
      if (grid[ny][nx] === TILE_WALL || dist[ny][nx] !== -1) continue;
      dist[ny][nx] = dist[y][x] + 1;
      if (dist[ny][nx] > best.d) best = { x: nx, y: ny, d: dist[ny][nx] };
      queue.push([nx, ny]);
    }
  }
  return best;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

// Randomized depth-first maze carve — guarantees every floor cell is
// reachable, so a path always exists from start to exit. Objects are then
// sprinkled in. One-way valves and riddle gates appear in passages (never
// dead-ends); locked doors only appear in dead-end alcoves so they can
// never block the only route.
export function generateMap(floor, baseLight) {
  const tier = tierForFloor(floor);
  const width = tier.size, height = tier.size;
  const w = width % 2 === 1 ? width : width + 1;
  const h = height % 2 === 1 ? height : height + 1;
  const tierIndex = MAP_TIERS.indexOf(tier);
  const isMid = tierIndex >= 1;
  const isDeep = tierIndex >= 2;

  const grid = Array.from({ length: h }, () => Array(w).fill(TILE_WALL));
  const stack = [[1, 1]];
  grid[1][1] = TILE_FLOOR;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const dirs = [[0, -2], [2, 0], [0, 2], [-2, 0]].sort(() => Math.random() - 0.5);
    let moved = false;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && grid[ny][nx] === TILE_WALL) {
        grid[y + dy / 2][x + dx / 2] = TILE_FLOOR;
        grid[ny][nx] = TILE_FLOOR;
        stack.push([nx, ny]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  const roomCount = Math.random() < 0.4 ? 1 : 0;
  for (let i = 0; i < roomCount; i++) {
    const rx = 1 + Math.floor(Math.random() * Math.max(1, w - 5));
    const ry = 1 + Math.floor(Math.random() * Math.max(1, h - 5));
    for (let yy = ry; yy < ry + 3; yy++) {
      for (let xx = rx; xx < rx + 3; xx++) {
        if (xx <= 0 || yy <= 0 || xx >= w - 1 || yy >= h - 1) continue;
        grid[yy][xx] = TILE_FLOOR;
      }
    }
  }

  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  let start = { x: cx, y: cy };
  if (grid[cy][cx] === TILE_WALL) {
    const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
    start = { x: hw, y: hh };
    if (grid[hh][hw] === TILE_WALL) start = { x: 1, y: 1 };
  }
  const exit = bfsFarthestFloor(grid, start.x, start.y);

  // ── objects ──
  const floorCells = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y][x] === TILE_FLOOR && !(x === start.x && y === start.y) && !(x === exit.x && y === exit.y)) {
        floorCells.push([x, y]);
      }
    }
  }

  // passage doors / one-way valves / riddle gates: walls with floor on two
  // opposite sides. Valves and gates are one-way-forward hazards.
  const passageWalls = [];
  const alcoveDoors = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y][x] !== TILE_WALL) continue;
      const up = grid[y - 1][x] === TILE_FLOOR;
      const down = grid[y + 1][x] === TILE_FLOOR;
      const left = grid[y][x - 1] === TILE_FLOOR;
      const right = grid[y][x + 1] === TILE_FLOOR;
      const sides = up + down + left + right;
      if ((up && down) || (left && right)) passageWalls.push([x, y]);
      else if (sides === 1) alcoveDoors.push([x, y]);
    }
  }

  const valveDir = new Map();
  shuffle(passageWalls);
  const picked = passageWalls.slice(0, Math.min(4, passageWalls.length));
  for (const [x, y] of picked) {
    const r = Math.random();
    if (r < 0.5) {
      grid[y][x] = TILE_DOOR;
    } else if (r < 0.78) {
      grid[y][x] = TILE_VALVE;
      const neighbors = [];
      if (grid[y - 1][x] === TILE_FLOOR) neighbors.push([x, y - 1]);
      if (grid[y + 1][x] === TILE_FLOOR) neighbors.push([x, y + 1]);
      if (grid[y][x - 1] === TILE_FLOOR) neighbors.push([x - 1, y]);
      if (grid[y][x + 1] === TILE_FLOOR) neighbors.push([x + 1, y]);
      if (neighbors.length === 2) {
        const ds = neighbors.map(([nx, ny]) => Math.abs(nx - start.x) + Math.abs(ny - start.y));
        // near side = closer to start; the valve passes travel from near→far
        const near = neighbors[ds[0] <= ds[1] ? 0 : 1];
        let vdir;
        if (near[0] === x) vdir = near[1] < y ? 2 : 0;
        else vdir = near[0] < x ? 1 : 3;
        valveDir.set(x + "," + y, vdir);
      }
    } else {
      grid[y][x] = TILE_GATE;
    }
  }
  shuffle(alcoveDoors);
  for (let i = 0; i < Math.min(2, alcoveDoors.length); i++) {
    grid[alcoveDoors[i][1]][alcoveDoors[i][0]] = TILE_DOOR_LOCKED;
  }

  // chests
  shuffle(floorCells);
  const chestCount = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < Math.min(chestCount, floorCells.length); i++) {
    const [x, y] = floorCells[i];
    if (grid[y][x] === TILE_FLOOR) grid[y][x] = TILE_CHEST;
  }

  // pitch-black rooms (mid/deep), kept away from the spawn point
  const darkCount = isMid ? 5 + Math.floor(Math.random() * 4) : isDeep ? 9 + Math.floor(Math.random() * 6) : 0;
  const darkCandidates = shuffle(floorCells.filter(([x, y]) => Math.abs(x - start.x) + Math.abs(y - start.y) > 4));
  let darkPlaced = 0;
  for (const [x, y] of darkCandidates) {
    if (darkPlaced >= darkCount) break;
    if (grid[y][x] !== TILE_FLOOR) continue;
    grid[y][x] = TILE_DARK;
    darkPlaced++;
  }

  // traps: spikes on all tiers, pits on mid/deep
  for (const [x, y] of floorCells) {
    if (grid[y][x] !== TILE_FLOOR) continue;
    if (Math.random() < 0.05) {
      grid[y][x] = (isMid || isDeep) && Math.random() < 0.4 ? TILE_PIT : TILE_TRAP;
    }
  }

  // exit marker
  grid[exit.y][exit.x] = TILE_EXIT;

  const light = Math.max(3, Math.round((baseLight || 9) * tier.factor));

  return {
    grid,
    width: w,
    height: h,
    start,
    exit,
    name: tier.names[Math.floor(Math.random() * tier.names.length)],
    tier: tier.name,
    light,
    valveDir,
  };
}

export function placePlayerAtStart(state) {
  state.player.x = state.currentMap.start.x;
  state.player.y = state.currentMap.start.y;
  state.player.facing = bestFacing(state.currentMap.grid, state.player.x, state.player.y);
  state.lastPos = { x: state.player.x, y: state.player.y };
  state.visited.clear();
  state.revealed.clear();
  revealAround(state, state.player.x, state.player.y);
}

// Pick the facing that looks down the longest open run of floor — so the
// first-person view opens onto a proper corridor rather than a wall.
function bestFacing(grid, x, y) {
  let bestDir = 0, bestRun = -1;
  for (let f = 0; f < 4; f++) {
    let run = 0;
    for (let d = 1; d <= 10; d++) {
      const nx = x + DX[f] * d, ny = y + DY[f] * d;
      const t = grid[ny] ? grid[ny][nx] : undefined;
      if (t === undefined || t === TILE_WALL || t === TILE_DOOR || t === TILE_DOOR_LOCKED || t === TILE_GATE || t === TILE_VALVE) break;
      run = d;
    }
    if (run > bestRun) { bestRun = run; bestDir = f; }
  }
  return bestDir;
}

export function enterDungeon(state) {
  state.floor = 1;
  state.currentMap = generateMap(state.floor, state.baseLight);
  state.mapName = state.currentMap.name;
  state.lightRadius = state.currentMap.light;
  state.running = true;
  placePlayerAtStart(state);
}
