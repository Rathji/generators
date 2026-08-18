export const N = 96;

export const T = {
  GRASS:0, GRASS2:1, PATH:2, STONE:3, WATER:4, SAND:5,
  TREE:6, ROCK:7, WALL:8, DOOR:9, BUILD:10, PLAZA:11, FOUNTAIN:12
};
export const SOLID = new Set([T.WATER, T.TREE, T.ROCK, T.WALL, T.BUILD, T.FOUNTAIN]);

export function mulberry32(seed){
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y){
  let n = (x | 0) * 374761393 + (y | 0) * 668265263;
  n = (n ^ (n >>> 13));
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export const idx = (x, y) => y * N + x;
export function inBounds(x, y){ return x >= 0 && y >= 0 && x < N && y < N; }
export function tileSolid(grid, x, y){ return !inBounds(x, y) || SOLID.has(grid[idx(x, y)]); }
export function walkable(grid, x, y){ return inBounds(x, y) && !SOLID.has(grid[idx(x, y)]); }

function smooth(t){ return t * t * (3 - 2 * t); }
function noise(x, y){
  const s = 7;
  const x0 = Math.floor(x / s), y0 = Math.floor(y / s);
  const fx = (x - x0 * s) / s, fy = (y - y0 * s) / s;
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  const u = smooth(fx), v = smooth(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const TOWN_MIN = 29, TOWN_MAX = 66;
export function isInTown(x, y){ return x >= TOWN_MIN - 2 && x <= TOWN_MAX + 2 && y >= TOWN_MIN - 2 && y <= TOWN_MAX + 2; }

export const BUILDING_TYPES = {
  inn:     { name: "Boar's Head Inn",    walls: '#8a5a2b', wallDark: '#74511f', roof: '#5f3f20', roofDark: '#4a3016', kind: 'inn' },
  healer:  { name: "Healer's Hall",      walls: '#ece5d2', wallDark: '#d5cdb4', roof: '#b03a3a', roofDark: '#8f2a2a', kind: 'healer' },
  smith:   { name: 'The Blacksmith',     walls: '#7c7f85', wallDark: '#65686e', roof: '#4f5358', roofDark: '#3c3f44', kind: 'smith' },
  bank:    { name: 'The Vault',          walls: '#c2b9a5', wallDark: '#a89f8b', roof: '#2f6f8f', roofDark: '#25576f', kind: 'bank' },
  temple:  { name: 'Temple of Light',    walls: '#eae6da', wallDark: '#cfcabc', roof: '#3a5f8a', roofDark: '#2c4a6c', kind: 'temple' },
  market:  { name: 'Market Square Stalls', walls: '#9a7a4a', wallDark: '#84663c', roof: '#7d5f38', roofDark: '#654b2b', kind: 'market' },
  house:   { name: 'House',              walls: '#a0793f', wallDark: '#8a6534', roof: '#7a5226', roofDark: '#64421e', kind: 'house' },
};

function buildTown(grid, rnd){
  const buildings = [];
  const X0 = 30, Y0 = 30, X1 = 65, Y1 = 65;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) grid[idx(x, y)] = T.PATH;
  for (let y = 44; y <= 52; y++) for (let x = 44; x <= 52; x++) grid[idx(x, y)] = T.PLAZA;
  const cx = 48, cy = 48;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++)
    if (Math.abs(x - cx) + Math.abs(y - cy) <= 2) grid[idx(x, y)] = T.FOUNTAIN;
  for (let y = Y0 + 3; y <= Y1 - 3; y++) for (let x = 47; x <= 49; x++) if (grid[idx(x, y)] !== T.FOUNTAIN) grid[idx(x, y)] = T.STONE;
  for (let x = X0 + 3; x <= X1 - 3; x++) for (let y = 47; y <= 49; y++) if (grid[idx(x, y)] !== T.FOUNTAIN) grid[idx(x, y)] = T.STONE;
  for (let x = X0 + 3; x <= X1 - 3; x++){ grid[idx(x, Y0 + 3)] = T.STONE; grid[idx(x, Y1 - 3)] = T.STONE; }
  for (let y = Y0 + 3; y <= Y1 - 3; y++){ grid[idx(X0 + 3, y)] = T.STONE; grid[idx(X1 - 3, y)] = T.STONE; }
  for (let x = X0 - 1; x <= X1 + 1; x++){ grid[idx(x, Y0 - 1)] = T.WALL; grid[idx(x, Y1 + 1)] = T.WALL; }
  for (let y = Y0 - 1; y <= Y1 + 1; y++){ grid[idx(X0 - 1, y)] = T.WALL; grid[idx(X1 + 1, y)] = T.WALL; }
  grid[idx(48, Y0 - 1)] = T.DOOR; grid[idx(48, Y1 + 1)] = T.DOOR;
  grid[idx(X0 - 1, 48)] = T.DOOR; grid[idx(X1 + 1, 48)] = T.DOOR;

  const quadrants = [
    { x0: 34, y0: 34 }, // NW
    { x0: 50, y0: 34 }, // NE
    { x0: 34, y0: 50 }, // SW
    { x0: 50, y0: 50 }, // SE
  ];
  const specials = [
    null,
    [ { i: 0, j: 1, type: 'healer' }, { i: 1, j: 0, type: 'temple' } ],
    [ { i: 1, j: 1, type: 'bank' } ],
    [ { i: 1, j: 0, type: 'smith' } ],
  ];
  const assignInn = true;
  for (let q = 0; q < 4; q++){
    const { x0, y0 } = quadrants[q];
    const spec = specials[q] || [];
    const specMap = {};
    for (const s of spec) specMap[s.i + ',' + s.j] = s.type;
    if (assignInn && q === 0) specMap['1,1'] = 'inn';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++){
      const bx = x0 + i * 4, by = y0 + j * 4;
      let type = specMap[i + ',' + j];
      if (!type){
        const r = rnd();
        type = r < 0.5 ? 'house' : (r < 0.72 ? 'house' : (r < 0.86 ? 'market' : 'house'));
      }
      for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) grid[idx(x, y)] = T.BUILD;
      const dx = bx + 4, dy = by + 4;
      if (grid[idx(dx, dy)] === T.PATH || grid[idx(dx, dy)] === T.PLAZA) grid[idx(dx, dy)] = T.STONE;
      buildings.push({ x: bx, y: by, w: 4, h: 4, type, door: { x: dx, y: dy } });
    }
  }
  return buildings;
}

function genMonsters(rnd, grid){
  const spawns = [];
  const c = 47.5;
  const rings = [
    { min: 14, max: 26, pool: ['rat', 'beetle', 'rat', 'beetle', 'wolf'], n: 70 },
    { min: 23, max: 29, pool: ['wolf', 'goblin', 'spider'], n: 65 },
    { min: 29, max: 34, pool: ['skeleton', 'orc', 'shadow'], n: 90 },
    { min: 33, max: 39, pool: ['orc', 'ogre', 'troll'], n: 60 },
    { min: 36, max: 41, pool: ['dragon'], n: 8 },
  ];
  for (const ring of rings){
    for (let i = 0; i < ring.n; i++){
      const a = rnd() * Math.PI * 2;
      const d = ring.min + rnd() * (ring.max - ring.min);
      const x = Math.round(c + Math.cos(a) * d);
      const y = Math.round(c + Math.sin(a) * d);
      const start = findNearWalkable(grid, x, y, 6);
      if (!start) continue;
      if (isInTown(start.x, start.y)) continue;
      spawns.push({ x: start.x, y: start.y, type: ring.pool[(rnd() * ring.pool.length) | 0] });
    }
  }
  const gates = [{ x: 48, y: 29 }, { x: 48, y: 66 }, { x: 29, y: 48 }, { x: 66, y: 48 }];
  for (const gate of gates){
    for (let i = 0; i < 7; i++){
      const a = rnd() * Math.PI * 2;
      const d = 3 + rnd() * 9;
      const x = Math.round(gate.x + Math.cos(a) * d);
      const y = Math.round(gate.y + Math.sin(a) * d);
      const start = findNearWalkable(grid, x, y, 4);
      if (!start) continue;
      if (isInTown(start.x, start.y)) continue;
      spawns.push({ x: start.x, y: start.y, type: rnd() < 0.7 ? 'rat' : 'beetle' });
    }
  }
  return spawns;
}

export function findNearWalkable(grid, x, y, r){
  if (inBounds(x, y) && !SOLID.has(grid[idx(x, y)])) return { x, y };
  for (let rr = 1; rr <= r; rr++){
    for (let dx = -rr; dx <= rr; dx++) for (let dy = -rr; dy <= rr; dy++){
      if (Math.abs(dx) + Math.abs(dy) !== rr) continue;
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && !SOLID.has(grid[idx(nx, ny)])) return { x: nx, y: ny };
    }
  }
  return null;
}

export function genWorld(seed){
  seed = seed || 20260810;
  const rnd = mulberry32(seed);
  const grid = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    grid[idx(x, y)] = hash2(x, y) < 0.5 ? T.GRASS : T.GRASS2;

  const c = 47.5;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const dx = x - c, dy = y - c;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 34 + noise(x, y) * 7) grid[idx(x, y)] = T.WATER;
  }
  const lakes = [[22, 36, 5.0], [71, 62, 4.4], [64, 21, 3.8]];
  for (const [lx, ly, lr] of lakes){
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      if (isInTown(x, y)) continue;
      const d = Math.sqrt((x - lx) ** 2 + (y - ly) ** 2);
      if (d < lr + noise(x, y) * 2.2) grid[idx(x, y)] = T.WATER;
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    if (grid[idx(x, y)] === T.WATER) continue;
    const dx = x - c, dy = y - c;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 27 && dist < 34 && noise(x, y) > 0.28) grid[idx(x, y)] = T.ROCK;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const t = grid[idx(x, y)];
    if ((t === T.GRASS || t === T.GRASS2) && rnd() < 0.016) grid[idx(x, y)] = T.ROCK;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    if (grid[idx(x, y)] === T.WATER) continue;
    let nearWater = false;
    for (let dy = -1; dy <= 1 && !nearWater; dy++) for (let dx = -1; dx <= 1; dx++){
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && grid[idx(nx, ny)] === T.WATER){ nearWater = true; break; }
    }
    if (nearWater) grid[idx(x, y)] = T.SAND;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const t = grid[idx(x, y)];
    if (t !== T.GRASS && t !== T.GRASS2 && t !== T.SAND) continue;
    const dx = x - c, dy = y - c;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 20) continue;
    const p = Math.min((dist - 8) / 9, 1) * 0.30;
    if (hash2(x, y) < p) grid[idx(x, y)] = T.TREE;
  }

  const buildings = buildTown(grid, rnd);
  const monsterSpawns = genMonsters(rnd, grid);
  return { grid, buildings, monsterSpawns, seed, plaza: { x: 48, y: 53 }, gates: [{ x: 48, y: 29 }, { x: 48, y: 66 }, { x: 29, y: 48 }, { x: 66, y: 48 }] };
}

export function findPath(grid, sx, sy, tx, ty){
  if (tx < 0 || ty < 0 || tx >= N || ty >= N) return null;
  if (SOLID.has(grid[idx(tx, ty)])) return null;
  const start = (sy * N + sx) | 0, goal = (ty * N + tx) | 0;
  if (start === goal) return [];
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const costs = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];
  const gScore = new Float32Array(N * N).fill(Infinity);
  const parent = new Int32Array(N * N).fill(-1);
  gScore[start] = 0;
  const heap = [];
  const heapPush = (f, id) => {
    heap.push([f, id]);
    let i = heap.length - 1;
    while (i > 0){
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const heapPop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length){
      heap[0] = last;
      let i = 0;
      for (;;){
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  const hx = (x, y) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  heapPush(hx(sx, sy), start);
  let guard = 0;
  while (heap.length && guard++ < 6000){
    const [, cur] = heapPop();
    if (cur === goal) break;
    const cx = cur % N, cy = (cur / N) | 0;
    for (let i = 0; i < 8; i++){
      const nx = cx + dirs[i][0], ny = cy + dirs[i][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (SOLID.has(grid[idx(nx, ny)])) continue;
      const nid = ny * N + nx;
      const ng = gScore[cur] + costs[i];
      if (ng < gScore[nid] - 1e-6){
        gScore[nid] = ng;
        parent[nid] = cur;
        heapPush(ng + hx(nx, ny), nid);
      }
    }
  }
  if (parent[goal] === -1) return null;
  const path = [];
  let cur = goal;
  while (cur !== start){
    path.push({ x: cur % N, y: (cur / N) | 0 });
    cur = parent[cur];
  }
  path.reverse();
  return path;
}
