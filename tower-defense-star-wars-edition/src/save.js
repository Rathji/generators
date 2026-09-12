const KEY = "swtd.save.v1";

const DEFAULTS = () => ({
  version: 1,
  unlocked: {},
  stars: {},
  best: {},
  totals: { kills: 0, credits: 0, games: 0, wins: 0 },
  settings: {
    theme: "dark",
    accent: "#48b4ff",
    text: 16,
    motion: false,
    quality: "high",
    master: 0.8,
    music: 0.5,
    sfx: 0.9,
    muted: false,
    defaultSpeed: 1,
  },
  tutorialSeen: false,
});

let cache = null;

function read() {
  const base = DEFAULTS();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      totals: { ...base.totals, ...(parsed.totals || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
      unlocked: { ...base.unlocked, ...(parsed.unlocked || {}) },
      stars: { ...base.stars, ...(parsed.stars || {}) },
      best: { ...base.best, ...(parsed.best || {}) },
    };
  } catch (e) {
    return base;
  }
}

export function data() {
  if (!cache) cache = read();
  return cache;
}

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data()));
  } catch (e) {}
}

export function getSettings() { return data().settings; }

export function setSetting(key, value) {
  data().settings[key] = value;
  persist();
}

export function isUnlocked(planetId, planetIndex) {
  if (planetIndex === 0) return true;
  return !!data().unlocked[planetId];
}

export function unlock(planetId) {
  if (!data().unlocked[planetId]) {
    data().unlocked[planetId] = true;
    persist();
  }
}

export function recordResult(planetId, planetIndex, stars, score, wave, kills, credits, won, nextPlanetId) {
  const d = data();
  const prev = d.stars[planetId] || 0;
  if (stars > prev) d.stars[planetId] = stars;
  const b = d.best[planetId];
  if (!b || score > b.score) d.best[planetId] = { score, wave, stars, won };
  d.totals.kills += kills || 0;
  d.totals.credits += credits || 0;
  d.totals.games += 1;
  if (won) d.totals.wins += 1;
  if (won && nextPlanetId) d.unlocked[nextPlanetId] = true;
  persist();
}

export function markTutorialSeen() {
  if (!data().tutorialSeen) { data().tutorialSeen = true; persist(); }
}

export function resetProgress() {
  const s = data().settings;
  cache = DEFAULTS();
  cache.settings = s;
  persist();
}

export function resetAll() {
  cache = DEFAULTS();
  persist();
}
