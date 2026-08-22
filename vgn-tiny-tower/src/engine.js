import { BUSINESS_TYPES, RESIDENTIAL_COLORS, FAVORITE_FOODS, FIRST_NAMES, LAST_NAMES } from "./data.js";

export const CONFIG = {
  baseCost: 200,
  costGrowth: 1.45,
  capacity: 100,
  sellRate: 1.1,
  stockRegen: 0.14,
  unitValueBase: 1.0,
  unitValuePerFloor: 0.35,
  unitValuePerLevel: 0.3,
  rentBase: 0.42,
  rentHappyMult: 1.5,
  workerMult: 0.5,
  residentsPerFloor: 5,
  workersPerFloor: 3,
  lobbyMax: 6,
  elevatorSpeed: 2.6,
  deliveryBase: 10,
  deliveryPerFloor: 6,
  buxSummonCost: 2,
  upgradeBaseCost: 300,
  upgradeGrowth: 1.9,
  firstArrivalDelay: 6,
  arrivalMin: 22,
  arrivalMax: 44,
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

export function floorCost(s) {
  return Math.round(CONFIG.baseCost * Math.pow(CONFIG.costGrowth, s.floors.length));
}

export function upgradeCost(f) {
  return Math.round(CONFIG.upgradeBaseCost * Math.pow(CONFIG.upgradeGrowth, f.level - 1));
}

export function unitValue(f) {
  return CONFIG.unitValueBase + (f.index - 1) * CONFIG.unitValuePerFloor + (f.level - 1) * CONFIG.unitValuePerLevel;
}

export function byId(s, id) {
  return s.bitizens.find((b) => b.id === id);
}

export function floorById(s, id) {
  return s.floors.find((f) => f.id === id);
}

function makeBitizen(s) {
  return {
    id: s.nextId++,
    name: pick(FIRST_NAMES) + " " + pick(LAST_NAMES),
    dreamJob: pick(Object.keys(BUSINESS_TYPES)),
    favoriteFood: pick(FAVORITE_FOODS),
    favoriteColor: pick(RESIDENTIAL_COLORS),
    location: "lobby",
    homeFloorId: null,
    workFloorId: null,
    wantsFloorId: null,
    walkPhase: Math.random(),
    walkSpeed: 0.7 + Math.random() * 0.9,
    deliveries: 0,
  };
}

function makeBusinessName(type) {
  const pair = pick(BUSINESS_TYPES[type].names);
  return pair[0] + " " + pair[1];
}

function pickResidentialColor(s) {
  const prev = s.floors.length ? s.floors[s.floors.length - 1].color : null;
  const pool = prev ? RESIDENTIAL_COLORS.filter((c) => c !== prev) : RESIDENTIAL_COLORS;
  return pick(pool.length ? pool : RESIDENTIAL_COLORS);
}

function makeFloor(s, kind) {
  return {
    id: s.nextId++,
    index: s.floors.length + 1,
    type: kind,
    businessType: kind === "residential" ? null : kind,
    color: kind === "residential" ? pickResidentialColor(s) : BUSINESS_TYPES[kind].color,
    name: kind === "residential" ? null : makeBusinessName(kind),
    stock: kind === "residential" ? 0 : CONFIG.capacity,
    capacity: CONFIG.capacity,
    level: 1,
    residents: [],
    workers: [],
  };
}

function findResidenceFor(s, b) {
  const res = s.floors.filter((f) => f.type === "residential" && f.residents.length < CONFIG.residentsPerFloor);
  if (!res.length) return null;
  return res.find((f) => f.color === b.favoriteColor) || res[0];
}

export function spawnBitizen(s, force = false) {
  if (!force && (s.lobby.length >= CONFIG.lobbyMax || s.nextArrival > 0)) return null;
  const b = makeBitizen(s);
  const home = findResidenceFor(s, b);
  if (!home) return null;
  b.wantsFloorId = home.id;
  b.location = "lobby";
  s.bitizens.push(b);
  s.lobby.push(b.id);
  s.dirty = true;
  return b;
}

export function summonBitizen(s) {
  if (s.bux < CONFIG.buxSummonCost) return { ok: false, reason: "bux" };
  const b = makeBitizen(s);
  const home = findResidenceFor(s, b);
  if (!home) return { ok: false, reason: "noroom" };
  b.wantsFloorId = home.id;
  b.location = "lobby";
  s.bitizens.push(b);
  s.lobby.push(b.id);
  s.bux -= CONFIG.buxSummonCost;
  s.dirty = true;
  return { ok: true, bitizen: b };
}

export function buildFloor(s, kind) {
  const cost = floorCost(s);
  if (s.coins < cost) return { ok: false, reason: "coins" };
  const f = makeFloor(s, kind);
  s.coins -= cost;
  s.floors.push(f);
  s.stats.built++;
  s.dirty = true;
  return { ok: true, floor: f };
}

export function restock(s, floorId) {
  const f = floorById(s, floorId);
  if (!f || f.type === "residential") return;
  f.stock = f.capacity;
  s.dirty = true;
}

export function upgrade(s, floorId) {
  const f = floorById(s, floorId);
  if (!f || f.type === "residential") return { ok: false, reason: "res" };
  const cost = upgradeCost(f);
  if (s.coins < cost) return { ok: false, reason: "coins" };
  s.coins -= cost;
  f.level++;
  s.dirty = true;
  return { ok: true };
}

export function assignBestWorker(s, floorId) {
  const f = floorById(s, floorId);
  if (!f || f.type === "residential" || f.workers.length >= CONFIG.workersPerFloor) {
    return { ok: false, reason: "full" };
  }
  const pool = s.bitizens.filter((b) => b.location === "home" && b.workFloorId == null);
  if (!pool.length) return { ok: false, reason: "none" };
  const match = pool.find((b) => b.dreamJob === f.businessType);
  const chosen = match || pool[0];
  f.workers.push(chosen.id);
  chosen.workFloorId = f.id;
  s.dirty = true;
  return { ok: true, bitizen: chosen };
}

export function removeWorker(s, floorId, bitizenId) {
  const f = floorById(s, floorId);
  if (!f) return;
  f.workers = f.workers.filter((id) => id !== bitizenId);
  const b = byId(s, bitizenId);
  if (b) b.workFloorId = null;
  s.dirty = true;
}

export function boardPassenger(s, bitizenId) {
  const e = s.elevator;
  if (e.passengerId != null) return { ok: false, reason: "busy" };
  const b = byId(s, bitizenId);
  if (!b || b.location !== "lobby") return { ok: false, reason: "gone" };
  if (b.wantsFloorId == null) return { ok: false, reason: "noroom" };
  e.passengerId = b.id;
  e.boarded = false;
  e.target = 0;
  e.moving = true;
  b.riding = true;
  s.dirty = true;
  return { ok: true };
}

function deliverPassenger(s) {
  const e = s.elevator;
  const b = byId(s, e.passengerId);
  if (!b) {
    e.passengerId = null;
    e.boarded = false;
    return { ok: false };
  }
  let home = b.wantsFloorId != null ? floorById(s, b.wantsFloorId) : null;
  if (!home || home.residents.length >= CONFIG.residentsPerFloor) {
    home = findResidenceFor(s, b);
    if (!home) {
      b.riding = false;
      e.passengerId = null;
      e.boarded = false;
      return { ok: false, reason: "noroom" };
    }
  }
  b.wantsFloorId = null;
  b.location = "home";
  b.homeFloorId = home.id;
  b.riding = false;
  home.residents.push(b.id);
  s.lobby = s.lobby.filter((id) => id !== b.id);
  b.deliveries++;
  const pay = Math.round(CONFIG.deliveryBase + CONFIG.deliveryPerFloor * home.index);
  s.coins += pay;
  s.stats.deliveries++;
  s.stats.earned += pay;
  let bux = 0;
  if (s.stats.deliveries <= 15 || Math.random() < 0.25) {
    bux = 1;
    s.bux += 1;
  }
  s.events.push({
    type: "deliver",
    bitizenName: b.name,
    pay,
    bux,
    floorIndex: home.index,
    homeFloorId: home.id,
  });
  e.passengerId = null;
  e.boarded = false;
  s.dirty = true;
  return { ok: true, pay, bux };
}

function arrive(s) {
  const e = s.elevator;
  e.target = null;
  e.moving = false;
  if (e.passengerId == null) return;
  const b = byId(s, e.passengerId);
  if (!b) return;
  if (!e.boarded && Math.abs(e.floor) < 0.01) {
    e.boarded = true;
    if (b.wantsFloorId != null) {
      const home = floorById(s, b.wantsFloorId);
      if (home) {
        e.target = home.index;
        e.moving = true;
      }
    }
  } else if (e.boarded) {
    const home = b.wantsFloorId != null ? floorById(s, b.wantsFloorId) : null;
    if (home && Math.abs(e.floor - home.index) < 0.01) {
      deliverPassenger(s);
    }
  }
}

export function tick(s, dt) {
  s.coins = Math.max(0, s.coins);
  for (const f of s.floors) {
    if (f.type === "residential") continue;
    const matched = f.workers.filter((w) => {
      const b = byId(s, w);
      return b && b.dreamJob === f.businessType;
    }).length;
    const rate = CONFIG.sellRate * (1 + CONFIG.workerMult * matched);
    if (f.stock > 0) {
      const sold = Math.min(f.stock, rate * dt);
      f.stock -= sold;
      const gain = sold * unitValue(f);
      s.coins += gain;
      s.stats.earned += gain;
    }
    f.stock = Math.min(f.capacity, f.stock + CONFIG.stockRegen * dt);
  }

  let rent = 0;
  for (const f of s.floors) {
    if (f.type !== "residential") continue;
    for (const rid of f.residents) {
      const b = byId(s, rid);
      if (!b) continue;
      rent += CONFIG.rentBase * (b.favoriteColor === f.color ? CONFIG.rentHappyMult : 1);
    }
  }
  s.coins += rent * dt;
  s.stats.earned += rent * dt;

  s.nextArrival -= dt;
  if (s.nextArrival <= 0) {
    spawnBitizen(s);
    s.nextArrival = CONFIG.arrivalMin + Math.random() * (CONFIG.arrivalMax - CONFIG.arrivalMin);
  }

  const e = s.elevator;
  e.moving = e.target != null;
  if (e.moving) {
    const dir = Math.sign(e.target - e.floor);
    e.floor += dir * CONFIG.elevatorSpeed * dt;
    if (dir >= 0 && e.floor >= e.target) {
      e.floor = e.target;
      arrive(s);
    } else if (dir <= 0 && e.floor <= e.target) {
      e.floor = e.target;
      arrive(s);
    }
  }

  for (const b of s.bitizens) {
    if (b.location === "home") b.walkPhase = (b.walkPhase + dt * 0.05 * b.walkSpeed) % 1;
  }
}

export function newGame() {
  const s = {
    v: 1,
    nextId: 1,
    coins: 300,
    bux: 3,
    floors: [],
    bitizens: [],
    lobby: [],
    elevator: { floor: 0, target: 0, passengerId: null, boarded: false, moving: false },
    nextArrival: CONFIG.firstArrivalDelay,
    stats: { deliveries: 0, built: 0, earned: 0 },
    lastSeen: Date.now(),
    events: [],
    dirty: true,
  };
  s.coins = 1e9;
  buildFloor(s, "food");
  buildFloor(s, "residential");
  buildFloor(s, "residential");
  s.coins = 300;
  spawnBitizen(s, true);
  spawnBitizen(s, true);
  s.nextArrival = CONFIG.firstArrivalDelay + 15;
  return s;
}

export function serialize(s) {
  const { events, dirty, ...rest } = s;
  return { ...JSON.parse(JSON.stringify(rest)), v: 2 };
}

export function loadGame(raw) {
  const s = newGame();
  if (!raw || typeof raw !== "object" || raw.v !== 2) return s;
  s.coins = num(raw.coins, s.coins);
  s.bux = num(raw.bux, s.bux);
  s.nextId = num(raw.nextId, s.nextId);
  s.stats = {
    deliveries: num(raw.stats && raw.stats.deliveries, 0),
    built: num(raw.stats && raw.stats.built, 0),
    earned: num(raw.stats && raw.stats.earned, 0),
  };
  s.lastSeen = num(raw.lastSeen, Date.now());
  s.nextArrival = num(raw.nextArrival, 20);

  if (Array.isArray(raw.floors)) {
    const valid = raw.floors
      .map((f) => ({
        id: num(f.id, 0),
        index: num(f.index, 0),
        type: f.type === "residential" ? "residential" : BUSINESS_TYPES[f.type] ? f.type : "food",
        businessType: f.type === "residential" ? null : f.type,
        color: typeof f.color === "string" ? f.color : RESIDENTIAL_COLORS[0],
        name: typeof f.name === "string" ? f.name : null,
        stock: num(f.stock, 0),
        capacity: num(f.capacity, CONFIG.capacity),
        level: Math.max(1, num(f.level, 1)),
        residents: Array.isArray(f.residents) ? f.residents.map((id) => num(id, 0)) : [],
        workers: Array.isArray(f.workers) ? f.workers.map((id) => num(id, 0)) : [],
      }))
      .sort((a, b) => a.index - b.index);
    s.floors = valid;
    s.floors.forEach((f, i) => (f.index = i + 1));
  }

  if (Array.isArray(raw.bitizens)) {
    s.bitizens = raw.bitizens.map((b) => ({
      id: num(b.id, 0),
      name: typeof b.name === "string" ? b.name : "Lost Resident",
      dreamJob: BUSINESS_TYPES[b.dreamJob] ? b.dreamJob : pick(Object.keys(BUSINESS_TYPES)),
      favoriteFood: typeof b.favoriteFood === "string" ? b.favoriteFood : pick(FAVORITE_FOODS),
      favoriteColor: typeof b.favoriteColor === "string" ? b.favoriteColor : pick(RESIDENTIAL_COLORS),
      location: b.location === "home" ? "home" : "lobby",
      homeFloorId: num(b.homeFloorId, null),
      workFloorId: num(b.workFloorId, null),
      wantsFloorId: num(b.wantsFloorId, null),
      walkPhase: Math.random(),
      walkSpeed: 0.7 + Math.random() * 0.9,
      deliveries: num(b.deliveries, 0),
      riding: false,
    }));
  }

  s.lobby = Array.isArray(raw.lobby)
    ? raw.lobby.map((id) => num(id, 0)).filter((id) => s.bitizens.some((b) => b.id === id))
    : [];
  s.lobby = s.lobby.slice(0, CONFIG.lobbyMax);

  const validIds = new Set(s.bitizens.map((b) => b.id));
  for (const f of s.floors) {
    f.residents = f.residents.filter((id) => validIds.has(id)).slice(0, CONFIG.residentsPerFloor);
    f.workers = f.workers.filter((id) => validIds.has(id)).slice(0, CONFIG.workersPerFloor);
  }

  for (const b of s.bitizens) {
    if (b.location === "home") {
      const home = s.floors.find((f) => f.id === b.homeFloorId);
      if (!home) {
        b.location = "lobby";
        b.homeFloorId = null;
        b.wantsFloorId = null;
        if (!s.lobby.includes(b.id) && s.lobby.length < CONFIG.lobbyMax) s.lobby.push(b.id);
      }
    } else if (b.workFloorId != null && !s.floors.some((f) => f.id === b.workFloorId)) {
      b.workFloorId = null;
    }
  }

  s.elevator = { floor: 0, target: 0, passengerId: null, boarded: false, moving: false };
  s.events = [];
  s.dirty = true;
  return s;
}
