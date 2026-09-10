/* The Elder Archive — application core.
   Loads the canonical schema + game registry, ingests every game's category
   files, and renders browse / detail / roadmap views. */

import { validateArchive, resolveRef as resolveRefCore } from './validate-core.js';

const GLYPHS = {
  tower:  '<path d="M4 20 h12 v-2 l-2 -2 v-6 l2 -2 v-2 h-8 v2 l2 2 v6 l-2 2 z M8 8 l1 -3 h6 l1 3 z M10 20 v-2 h4 v2"/>',
  bust:   '<path d="M8 20 v-3 a6 6 0 0 1 4 -5.5 v-1.5 a2.5 2.5 0 0 0 5 0 v1.5 a6 6 0 0 1 4 5.5 v3 z M12 6 a2.5 2.5 0 1 1 0 5 a2.5 2.5 0 0 1 0 -5 z"/>',
  banner: '<path d="M5 3 h14 v3 l-3 2 3 2 v3 l-3 2 3 2 v3 h-14 v-3 l3 -2 -3 -2 v-3 l3 -2 -3 -2 z"/>',
  star:   '<path d="M12 3 l2.2 5.6 6 .5 -4.5 4 1.4 5.9 -5.1 -3.1 -5.1 3.1 1.4 -5.9 -4.5 -4 6 -.5 z"/>',
  sword:  '<path d="M14.5 3 L21 9.5 L19.5 11 L18.5 10 L15 13.5 L12 16.5 L9 19.5 L7.5 18 L11 14.5 L12.5 13 L15.5 10 L14 8.5 L15.5 7 L18 9.5 L19 8.5 L12.5 2 z M4.5 19.5 l2.5 -2.5"/>',
  sigil:  '<path d="M12 3 c5 4 6 8 4 12 c3 1 4 4 4 6 l-3 1 c0 -2 -1 -3 -3 -3 c0 3 -1 4 -2 4 c-1 0 -2 -1 -2 -4 c-2 0 -3 1 -3 3 l-3 -1 c0 -2 1 -5 4 -6 c-2 -4 -1 -8 4 -12 z M12 9 a2 2 0 1 1 0 4 a2 2 0 0 1 0 -4 z"/>',
  claw:   '<path d="M7 4 l1 6 -1 10 h3 v-8 l1 -8 z M12 6 l-1 9 2 5 h3 l-1 -6 -2 -8 z M16 8 l-1 6 1 6 h3 l-1 -7 -1 -5 z"/>',
  book:   '<path d="M12 5 c-2.5 -1.5 -6 -2 -9 -1.5 v15 c3 -.5 6.5 0 9 1.5 c2.5 -1.5 6 -2 9 -1.5 v-15 c-3 -.5 -6.5 0 -9 1.5 z M12 5 v16"/>',
  rune:   '<path d="M5 4 v16 M8 4 v16 M5 12 h3 M14 4 v7 l5 9 h-3.5 l-3 -6 -3 6 h-3.5 l5 -9 v-7 z"/>',
  search: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><line x1="15" y1="15" x2="20" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  seal:   '<path d="M12 3 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5 -2.6 -5 2.6 1 -5.5 -4 -3.9 5.5 -.8 z"/>'
};

const SUBTITLE_FIELD = {
  locations: 'region', npcs: 'title', factions: 'motto', quests: 'type',
  items: 'subtype', spells: 'school', creatures: 'type', books: 'author', races: 'province'
};

const ROADMAP = [
  {
    id: 'P0', name: 'Charter', desc: 'Charter the game in the registry before any content is touched.',
    steps: [
      { kind: 'auto', label: 'Register the game in games.json (id, title, subtitle, year, era, province, engine)', done: (g) => !!(g.id && g.title && g.subtitle && g.year && g.era && g.province && g.engine) },
      { kind: 'auto', label: 'Record descriptive metadata and an accent colour', done: (g) => !!(g.description && g.accent) },
      { kind: 'auto', label: 'Set an ingestion status flag (not-started / sample / in-progress / complete)', done: (g) => g.status !== 'not-started' }
    ]
  },
  {
    id: 'P1', name: 'Source Acquisition', desc: 'Identify and lock in canonical sources of truth for the game.',
    steps: [
      { kind: 'auto', label: 'Enumerate canonical sources (UESP, Imperial Library, in-game data dumps)', done: (g) => (g.sources || []).length > 0 },
      { kind: 'manual', label: 'Record retrieval metadata (date, license, scope) for each source', key: 'p1-retrieval' },
      { kind: 'manual', label: 'Choose extraction method per category: manual · scripted · API dump', key: 'p1-method' }
    ]
  },
  {
    id: 'P2', name: 'Schema Alignment', desc: 'Map the game\u2019s own terminology onto the canonical entity types.',
    steps: [
      { kind: 'manual', label: 'Map game-specific terms to canonical types (e.g. \u2018interior cell\u2019 \u2192 locations)', key: 'p2-map' },
      { kind: 'manual', label: 'Record a field glossary and game-specific notes', key: 'p2-glossary' },
      { kind: 'manual', label: 'Identify extension fields the game needs beyond the canonical schema', key: 'p2-ext' }
    ]
  },
  {
    id: 'P3', name: 'Atomic Ingestion', desc: 'Extract, normalize, validate, commit, and verify one category at a time.',
    steps: [
      { kind: 'auto', label: 'Extract & normalize every category (all 9 files present)', done: (g, c) => allCategories(c) },
      { kind: 'auto', label: 'Validate every record against the canonical schema (required fields, legal enums, unique ids)', done: (g, c) => allCategories(c) && c.requiredMissing === 0 && c.enumInvalid === 0 && c.duplicateIds === 0 },
      { kind: 'auto', label: 'Commit every category to src/data/\u003cgame\u003e/\u003ccategory\u003e.json', done: (g, c) => allCategories(c) },
      { kind: 'auto', label: 'Verify every category renders and is searchable in-app', done: (g, c) => allCategories(c) && c.total > 0 }
    ]
  },
  {
    id: 'P4', name: 'Cross-linking', desc: 'Bind the categories together so the archive behaves as one living graph.',
    steps: [
      { kind: 'auto', label: 'Link records across entity types by id (NPC \u2194 faction \u2194 location \u2194 quest)', done: (g, c) => allCategories(c) && c.linksTotal > 0 },
      { kind: 'auto', label: 'Resolve every reference \u2014 no orphan ids left dangling', done: (g, c) => allCategories(c) && c.linksTotal > 0 && c.linksResolved === c.linksTotal },
      { kind: 'auto', label: 'Confirm search covers the game\u2019s whole dataset', done: (g, c) => allCategories(c) && c.total > 0 }
    ]
  },
  {
    id: 'P5', name: 'Quality & Lore', desc: 'Make every record worth reading and trustworthy.',
    steps: [
      { kind: 'auto', label: 'Write lore/description text for the majority of records', done: (g, c) => allCategories(c) && c.total > 0 && c.withLore / c.total >= 0.6 },
      { kind: 'manual', label: 'Fact-check records against the recorded sources', key: 'p5-factcheck' },
      { kind: 'auto', label: 'Mark every record verified in its status field', done: (g, c) => allCategories(c) && c.total > 0 && c.verifiedRatio === 1 },
      { kind: 'manual', label: 'Editorial pass: titles, subtitles, cross-reference depth', key: 'p5-editorial' }
    ]
  },
  {
    id: 'P6', name: 'Release', desc: 'Declare the game\u2019s dataset done and freeze a version.',
    steps: [
      { kind: 'auto', label: 'Set game status to \u2018complete\u2019 in the registry', done: (g, c) => g.status === 'complete' && gameComplete(c) },
      { kind: 'auto', label: 'Bump the dataset version', done: (g, c) => !!g.version && gameComplete(c) },
      { kind: 'auto', label: 'Snapshot & ship (the data is part of the generator)', done: (g, c) => g.status === 'complete' && gameComplete(c) }
    ]
  }
];

/* Cross-cutting, app-level work — tracked like the per-game phases, but it applies to
   the whole archive. Flags below flip to true as each capability is implemented. */
const CAPABILITIES = {
  enumValidation: true,    // P7 — validate enum values + unique ids
  integrityPanel: true,    // P7 — surface the Integrity report
  strictRoadmap: true,     // P7 — tighten derived roadmap steps
  validationScript: true,  // P7 — standalone validation script over src/data
  deepLinking: true,       // P8 — hash routing + back/forward
  searchUpgrade: true,     // P8 — debounce, ranking, match highlighting
  accessibleUI: true,      // P8 — dialog roles, focus trap, keyboard-activatable cards
  shareExport: true        // P8 — copy share link + JSON export
};

const ARCHIVE_ROADMAP = [
  {
    id: 'P7', name: 'Archive Integrity',
    desc: 'Make the stored data provably conform to the schema, across every game.',
    steps: [
      { kind: 'auto', label: 'Validate enum values and unique ids against schema.json', done: () => CAPABILITIES.enumValidation },
      { kind: 'auto', label: 'Surface an Integrity report (missing required, illegal enum, duplicate id, orphan link)', done: () => CAPABILITIES.integrityPanel },
      { kind: 'auto', label: 'Tighten derived roadmap steps so completion cannot be overstated', done: () => CAPABILITIES.strictRoadmap },
      { kind: 'auto', label: 'Standalone validation script over src/data', done: () => CAPABILITIES.validationScript },
      { kind: 'auto', label: 'Every ingested record verified', done: () => state.games.every((g) => { const c = computeContext(g); return c.total === 0 || c.verifiedRatio === 1; }) }
    ]
  },
  {
    id: 'P8', name: 'Archive Experience',
    desc: 'The reading, sharing and accessibility experience of the archive as a whole.',
    steps: [
      { kind: 'auto', label: 'Deep-linkable state: game, category and open record in the URL (back/forward)', done: () => CAPABILITIES.deepLinking },
      { kind: 'auto', label: 'Search upgrade: debounce, name ranking, match highlighting, \u201c/\u201d shortcut, result count', done: () => CAPABILITIES.searchUpgrade },
      { kind: 'auto', label: 'Accessibility: dialog roles, focus trap/restore, keyboard-activatable cards, labelled search', done: () => CAPABILITIES.accessibleUI },
      { kind: 'auto', label: 'Share & export: copy share link, download a record or the whole archive as JSON', done: () => CAPABILITIES.shareExport }
    ]
  }
];

const CATEGORY_STATUS = { pending: 0, draft: 1, ready: 2 };

const state = {
  games: [], schema: { entityTypes: [] }, data: {}, // data[gameId][catKey] = records
  activeGame: 'morrowind', activeCat: 'locations', query: '',
  tab: 'db', detail: null,
  integrity: [] // validation issues across the whole archive
};

let lastFocused = null;

const $ = (id) => document.getElementById(id);

/* Strict, shared definitions of "done" — a step cannot read done unless its whole
   definition of done holds, so the roadmap can never overstate progress. */
function totalCategories() { return state.schema.entityTypes.length; }
function allCategories(ctx) { return ctx.categoriesIngested === totalCategories(); }
function gameComplete(ctx) {
  return allCategories(ctx) && ctx.total > 0 &&
    ctx.requiredMissing === 0 && ctx.enumInvalid === 0 && ctx.duplicateIds === 0 &&
    ctx.linksResolved === ctx.linksTotal && ctx.verifiedRatio === 1;
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Escape, then wrap every occurrence of `q` in <mark> so search hits stand out. */
function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const needle = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!needle) return safe;
  return safe.replace(new RegExp(`(${needle})`, 'gi'), '<mark>$1</mark>');
}

const MODULE_BASE = new URL('./', import.meta.url);
const assetURL = (name) => new URL(name, MODULE_BASE).href;

/* ---------------- share & export ---------------- */

function shareURL() {
  return `https://perchance.org/${window.generatorName}${location.hash || ''}`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through to execCommand */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function downloadJSON(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function flashButton(btn, label) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
}

async function shareCurrent(btn) {
  const url = shareURL();
  const ok = await copyText(url);
  if (ok) { flashButton(btn, 'Link copied \u2713'); return; }
  flashButton(btn, 'Select the link below');
  const wrap = btn.closest('.detail-actions') || btn.parentElement;
  let box = wrap.querySelector('.share-fallback');
  if (!box) {
    box = document.createElement('input');
    box.className = 'share-fallback';
    box.readOnly = true;
    box.setAttribute('aria-label', 'Share link');
    wrap.appendChild(box);
  }
  box.value = url;
  box.focus();
  box.select();
}

/* ---------------- routing (deep links + history) ----------------

   The whole view state — tab, game, category and the open record — lives in the
   URL hash, so every screen is shareable and the browser's back/forward buttons
   walk the archive. Format:
     #/db/<game>/<cat>                                   a category listing
     #/db/<game>/<cat>/<recGame>/<type>/<recordId>      a listing with a record open
     #/road/<game>                                       a game's roadmap
     #/integrity                                         the archive integrity report   */

let _applyingRoute = false;

function parseHash() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  return { tab: parts[0] || 'db', game: parts[1] || null, cat: parts[2] || null,
    recGame: parts[3] || null, type: parts[4] || null, rec: parts[5] || null };
}
function hashFor() {
  const parts = [state.tab];
  if (state.tab === 'db') {
    parts.push(state.activeGame, state.activeCat);
    if (state.detail) parts.push(state.detail.gameId, state.detail.typeKey, state.detail.id);
  } else if (state.tab === 'road') {
    parts.push(state.activeGame);
  }
  return '#/' + parts.filter((p) => p != null && p !== '').join('/');
}
function syncHash(mode = 'push') {
  if (_applyingRoute) return;
  const h = hashFor();
  if (location.hash === h) return;
  if (mode === 'replace') history.replaceState(null, '', h);
  else location.hash = h;
}
function applyRoute() {
  const r = parseHash();
  const gameIds = state.games.map((g) => g.id);
  const rTab = ['db', 'road', 'integrity'].includes(r.tab) ? r.tab : 'db';
  const targetGame = (r.game && gameIds.includes(r.game)) ? r.game : state.activeGame;
  let changed = false;
  _applyingRoute = true;

  if (targetGame !== state.activeGame) {
    state.activeGame = targetGame;
    state.activeCat = 'locations';
    state.query = '';
    if ($('searchInput')) $('searchInput').value = '';
    changed = true;
  }
  if (r.cat && typeByKey(r.cat) && r.cat !== state.activeCat) { state.activeCat = r.cat; changed = true; }
  if (rTab !== state.tab) { state.tab = rTab; changed = true; }

  const recGameId = (r.recGame && gameIds.includes(r.recGame)) ? r.recGame : targetGame;
  const want = (rTab === 'db' && r.rec && r.type && typeByKey(r.type))
    ? { id: r.rec, typeKey: r.type, gameId: recGameId } : null;
  const cur = state.detail;
  const sameDetail = (!want && !cur) || (want && cur && cur.id === want.id && cur.typeKey === want.typeKey && cur.gameId === want.gameId);

  if (changed) {
    renderGameBar();
    renderTabs();
    $('dbView').hidden = rTab !== 'db';
    $('roadView').hidden = rTab !== 'road';
    $('integrityView').hidden = rTab !== 'integrity';
    renderAll();
  }
  if (!sameDetail) {
    if (want) openDetail(want.id, want.typeKey, want.gameId);
    else closeDetail();
  }
  _applyingRoute = false;
}

async function loadJSON(path) {
  try {
    const r = await fetch(new URL(path, MODULE_BASE));
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function manualDone(gameId, key) {
  return localStorage.getItem(`ea:manual:${gameId}:${key}`) === '1';
}
function setManual(gameId, key, on) {
  if (on) localStorage.setItem(`ea:manual:${gameId}:${key}`, '1');
  else localStorage.removeItem(`ea:manual:${gameId}:${key}`);
}

function typeByKey(key) { return state.schema.entityTypes.find((t) => t.key === key); }

function computeContext(game) {
  const c = {
    counts: {}, total: 0, verified: 0, withLore: 0,
    categoriesIngested: 0, requiredMissing: 0, enumInvalid: 0, duplicateIds: 0,
    linksTotal: 0, linksResolved: 0, catStatus: {}
  };
  for (const t of state.schema.entityTypes) {
    const recs = state.data[game.id]?.[t.key] || [];
    const n = recs.length;
    c.counts[t.key] = n;
    c.total += n;
    if (n > 0) c.categoriesIngested++;
    c.catStatus[t.key] = n === 0 ? CATEGORY_STATUS.pending : (recs.every((r) => r.status === 'verified') ? CATEGORY_STATUS.ready : CATEGORY_STATUS.draft);
    const seen = new Set();
    for (const r of recs) {
      if (seen.has(r.id)) c.duplicateIds++;
      seen.add(r.id);
      if (r.status === 'verified') c.verified++;
      if (r.lore || (r.description && r.description.length > 60)) c.withLore++;
      for (const f of t.fields) {
        if (f.required && !r[f.key]) c.requiredMissing++;
        if (f.type === 'enum' && r[f.key] !== undefined && r[f.key] !== null && r[f.key] !== '') {
          const opts = f.options || [];
          const vals = Array.isArray(r[f.key]) ? r[f.key] : [r[f.key]];
          for (const v of vals) if (!opts.includes(v)) c.enumInvalid++;
        }
        if (f.type === 'links') {
          const ids = Array.isArray(r[f.key]) ? r[f.key] : (r[f.key] ? [r[f.key]] : []);
          for (const id of ids) {
            c.linksTotal++;
            if (resolveRef(game.id, f.target, id)) c.linksResolved++;
          }
        }
      }
    }
  }
  c.verifiedRatio = c.total ? c.verified / c.total : 0;
  return c;
}

function resolveRef(gameId, type, id) {
  return resolveRefCore(state.games, state.data, gameId, type, id);
}

function computeIntegrity() {
  return validateArchive({ schema: state.schema, games: state.games, data: state.data });
}

/* ---------------- boot ---------------- */

async function init() {
  const [schema, games] = await Promise.all([loadJSON('./data/schema.json'), loadJSON('./data/games.json')]);
  if (!schema || !games) { $('root').innerHTML = '<div class="empty-state"><div class="big">The archive is silent</div>Could not load the data registry.</div>'; return; }
  state.schema = schema; state.games = games;

  const jobs = [];
  for (const g of games) {
    for (const t of schema.entityTypes) {
      jobs.push(loadJSON(`./data/${g.id}/${t.key}.json`).then((recs) => {
        state.data[g.id] = state.data[g.id] || {};
        state.data[g.id][t.key] = Array.isArray(recs) ? recs : [];
      }));
    }
  }
  await Promise.all(jobs);

  state.integrity = computeIntegrity();
  buildStaticShell();
  renderGameBar();
  renderTabs();
  renderAll();
  window.addEventListener('hashchange', applyRoute);
  applyRoute();
  syncHash('replace');
}

/* ---------------- static shell ---------------- */

function buildStaticShell() {
  const root = $('root');
  root.innerHTML = `
  <div class="shell">
  <header class="archive-header">
    <img class="emblem" src="${assetURL('emblem.svg')}" alt="The Elder Archive sigil">
    <div class="title-block">
      <h1>The Elder Archive</h1>
      <p class="tagline">a canonical database of Tamriel \u2014 every game, every record, one schema</p>
    </div>
    <div class="controls">
      <div class="search-wrap">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">${GLYPHS.search}</svg>
        <input id="searchInput" type="search" placeholder="Search all games\u2026  ( / )" autocomplete="off" aria-label="Search all games">
      </div>
      <div class="tabs">
        <button class="tab active" id="tabDbBtn">Database</button>
        <button class="tab" id="tabRoadBtn">Roadmap</button>
        <button class="tab" id="tabIntBtn">Integrity <span class="tab-badge" id="tabIntBadge"></span></button>
      </div>
    </div>
  </header>

  <nav class="game-bar" id="gameBar"></nav>

  <section id="dbView">
    <div class="main-grid">
      <aside class="cat-side panel">
        <h2>Lore Index</h2>
        <div class="cat-list" id="catList"></div>
        <div class="game-stats" id="gameStats"></div>
      </aside>
      <div class="content">
        <div class="content-top">
          <h2 id="contentTitle">Records</h2>
          <span class="sub" id="contentSub" aria-live="polite"></span>
        </div>
        <div class="entity-grid" id="entityGrid"></div>
      </div>
    </div>
  </section>

  <section id="roadView" hidden>
    <div class="roadmap-head">
      <h2 id="roadTitle">Ingestion Roadmap</h2>
      <p id="roadSub"></p>
    </div>
    <div class="game-progress" id="gameProgress"></div>
    <div id="phases"></div>
    <div id="archiveRoadmap"></div>
  </section>

  <section id="integrityView" hidden>
    <div class="roadmap-head">
      <h2>Archive Integrity</h2>
      <p>Every stored record checked against <code>schema.json</code> \u2014 required fields, legal enum values, unique ids and resolved cross-references.</p>
    </div>
    <div class="game-progress" id="intProgress"></div>
    <div id="integrityList"></div>
  </section>

  <footer class="footer">
    <div class="doc-links">
      <a href="${assetURL('README.md')}" target="_blank">README</a>
      <a href="${assetURL('SPEC.md')}" target="_blank">Schema Spec</a>
      <a href="${assetURL('ROADMAP.md')}" target="_blank">Atomic Roadmap</a>
      <button class="ghost-btn" id="exportAllBtn" type="button">Download archive JSON</button>
    </div>
    Structure \u00b7 theme \u00b7 process \u2014 content is ingested game by game along the roadmap.
  </footer>

  <div id="modalRoot"></div>
  </div>`;

  let searchTimer = null;
  const runSearch = () => { state.query = $('searchInput').value.trim().toLowerCase(); renderAll(); };
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 160);
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('searchInput').value = ''; clearTimeout(searchTimer); runSearch(); $('searchInput').blur(); }
  });
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if (e.key === '/' && !typing && !state.detail) { e.preventDefault(); $('searchInput').focus(); $('searchInput').select(); }
  });
  $('tabDbBtn').addEventListener('click', () => setTab('db'));
  $('tabRoadBtn').addEventListener('click', () => setTab('road'));
  $('tabIntBtn').addEventListener('click', () => setTab('integrity'));
  $('exportAllBtn').addEventListener('click', () => {
    downloadJSON(`elder-archive-${new Date().toISOString().slice(0, 10)}.json`, {
      generator: window.generatorName,
      exportedAt: new Date().toISOString(),
      games: state.games,
      schema: state.schema,
      data: state.data
    });
    flashButton($('exportAllBtn'), 'Exported \u2713');
  });
}

function setTab(tab) {
  state.tab = tab;
  renderTabs();
  $('dbView').hidden = tab !== 'db';
  $('roadView').hidden = tab !== 'road';
  $('integrityView').hidden = tab !== 'integrity';
  if (tab === 'road') renderRoadmap();
  if (tab === 'integrity') renderIntegrity();
  syncHash();
}

function renderTabs() {
  $('tabDbBtn').classList.toggle('active', state.tab === 'db');
  $('tabRoadBtn').classList.toggle('active', state.tab === 'road');
  $('tabIntBtn').classList.toggle('active', state.tab === 'integrity');
  const n = (state.integrity || []).length;
  const badge = $('tabIntBadge');
  badge.textContent = n ? String(n) : '\u2713';
  badge.className = 'tab-badge ' + (n ? 'bad' : 'good');
}

/* ---------------- game bar ---------------- */

function renderGameBar() {
  const bar = $('gameBar');
  bar.innerHTML = state.games.map((g) => `
    <button class="game-sigil ${g.id === state.activeGame ? 'active' : ''}"
            style="--game-accent:${g.accent}" data-game="${g.id}"
            title="${escapeHtml(g.subtitle)} — ${escapeHtml(g.description || '')}">
      <span class="sigil-disc"></span>
      <span class="g-title">${escapeHtml(g.title)}</span>
      <span class="status-dot ${g.status === 'sample' || g.status === 'in-progress' || g.status === 'complete' ? 'sample' : 'empty'}"></span>
    </button>`).join('');
  bar.querySelectorAll('.game-sigil').forEach((b) => b.addEventListener('click', () => {
    state.activeGame = b.dataset.game;
    state.activeCat = 'locations';
    state.query = '';
    if ($('searchInput')) $('searchInput').value = '';
    renderGameBar();
    renderAll();
    if (state.tab === 'road') renderRoadmap();
    syncHash();
  }));
}

/* ---------------- database view ---------------- */

function renderAll() {
  renderCategoryList();
  if (state.tab === 'db') renderContent();
  else if (state.tab === 'road') renderRoadmap();
  else if (state.tab === 'integrity') renderIntegrity();
}

function renderCategoryList() {
  const game = state.games.find((g) => g.id === state.activeGame);
  const ctx = computeContext(game);
  const list = $('catList');
  list.innerHTML = state.schema.entityTypes.map((t) => {
    const n = ctx.counts[t.key] || 0;
    return `<div class="cat-item ${t.key === state.activeCat ? 'active' : ''}" data-cat="${t.key}">
      <span class="glyph" style="color:var(--gold)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[t.glyph]}</svg></span>
      <span>${escapeHtml(t.label)}</span>
      <span class="count">${n}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.cat-item').forEach((el) => el.addEventListener('click', () => {
    state.activeCat = el.dataset.cat;
    renderCategoryList(); renderContent();
    syncHash();
  }));

  const pct = ctx.total ? Math.round((ctx.verified / ctx.total) * 100) : 0;
  $('gameStats').innerHTML = `
    <div class="stat-row"><span>Dataset</span><b>${ctx.total} records</b></div>
    <div class="stat-row"><span>Categories</span><b>${ctx.categoriesIngested} / ${state.schema.entityTypes.length}</b></div>
    <div class="stat-row"><span>Verified</span><b>${pct}%</b></div>
    <div class="stat-row"><span>Status</span><b style="color:${game.accent}">${escapeHtml(game.status)}</b></div>`;
}

function renderContent() {
  const game = state.games.find((g) => g.id === state.activeGame);
  const type = typeByKey(state.activeCat);
  const recs = state.data[game.id]?.[type.key] || [];
  const tTitle = escapeHtml(game.title);
  $('contentTitle').textContent = state.query ? 'Search results' : `${type.label} of ${game.title}`;

  let results;
  if (state.query) {
    const q = state.query;
    results = [];
    for (const g of state.games) {
      for (const t of state.schema.entityTypes) {
        for (const r of state.data[g.id]?.[t.key] || []) {
          const hay = [r.name, r.title, r.subtitle, r.description, r.lore, r.region, r.province, r.type, r.motto, r.author, r.school, ...(r.aliases || [])].filter(Boolean).join(' ').toLowerCase();
          if (hay.includes(q)) results.push({ game: g, type: t, rec: r });
        }
      }
    }
    const rank = (name) => { const n = String(name || '').toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
    results.sort((a, b) => rank(a.rec.name) - rank(b.rec.name) || String(a.rec.name).length - String(b.rec.name).length || String(a.rec.name).localeCompare(String(b.rec.name)));
    $('contentSub').textContent = `${results.length} result${results.length === 1 ? '' : 's'} for \u201c${state.query}\u201d across every game`;
  } else {
    $('contentSub').textContent = `${game.subtitle} \u00b7 ${game.era} \u00b7 ${recs.length} record${recs.length === 1 ? '' : 's'} \u00b7 ${type.description}`;
  }

  const grid = $('entityGrid');
  if (state.query) {
    if (!results.length) {
      grid.innerHTML = `<div class="empty-state"><div class="big">Nothing found</div>No record in any game matches \u201c${escapeHtml(state.query)}\u201d.</div>`;
      return;
    }
    grid.innerHTML = results.map(({ game: g, type: t, rec }) => cardHTML(rec, t, g, true, state.query)).join('');
    wireCards(grid);
    return;
  }

  if (!recs.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="big">This index is empty</div>
      ${escapeHtml(game.title)} has no ${type.label.toLowerCase()} ingested yet. The <em>Roadmap</em> defines exactly how this category gets filled.
    </div>`;
    return;
  }
  grid.innerHTML = recs.map((r) => cardHTML(r, type, game, false)).join('');
  wireCards(grid);
}

function wireCards(grid) {
  grid.querySelectorAll('.entity-card').forEach((card) => {
    const open = () => { const { g, t, id } = card.dataset; openDetail(id, t, g); };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(); }
    });
  });
}

function cardHTML(rec, type, game, showGame, q) {
  const desc = rec.description || rec.lore || '';
  const subtype = SUBTITLE_FIELD[type.key];
  const sub = subtype && rec[subtype] ? escapeHtml(rec[subtype]) : '';
  const gameTag = showGame ? `<span class="ec-type">${escapeHtml(game.title)} \u00b7 ${escapeHtml(type.label)}</span>` : '';
  return `<div class="entity-card" role="button" tabindex="0" aria-label="${escapeHtml(rec.name)} \u2014 ${escapeHtml(type.label)}" data-g="${game.id}" data-t="${type.key}" data-id="${escapeHtml(rec.id)}">
    <div class="ec-top">
      <span class="glyph"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[type.glyph]}</svg></span>
      <h3>${highlight(rec.name, q)}</h3>
    </div>
    ${sub ? `<div class="ec-type">${sub}</div>` : ''}
    ${gameTag}
    <p class="ec-desc">${highlight(desc, q)}</p>
    ${rec.status === 'verified' ? '<span class="ec-verified">verified</span>' : ''}
  </div>`;
}

/* ---------------- detail scroll ---------------- */

function openDetail(id, typeKey, gameId) {
  const type = typeByKey(typeKey);
  const rec = (state.data[gameId]?.[typeKey] || []).find((r) => r.id === id);
  if (!rec) return;
  if (!state.detail) lastFocused = document.activeElement;
  state.detail = { id, typeKey, gameId };
  const game = state.games.find((g) => g.id === gameId);
  const subtitleField = SUBTITLE_FIELD[type.key];
  const sub = subtitleField && rec[subtitleField] ? escapeHtml(String(rec[subtitleField])) : '';
  const fields = type.fields
    .filter((f) => f.key !== 'name' && f.key !== 'status')
    .map((f) => renderField(f, rec, gameId));

  $('modalRoot').innerHTML = `
  <div class="modal-backdrop" id="modalBackdrop">
    <div class="scroll" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <button class="close-btn" id="modalClose" title="Close" aria-label="Close">\u00d7</button>
      <div class="scroll-head">
        <div class="s-type">${escapeHtml(game.title)} \u00b7 ${escapeHtml(type.label)}</div>
        <h2 id="detailTitle">${escapeHtml(rec.name)}</h2>
        ${sub ? `<div class="s-title-line">${sub}</div>` : ''}
        <span class="s-seal ${rec.status === 'verified' ? 'verified' : ''}">${rec.status === 'verified' ? 'verified record' : 'draft'}</span>
        <div class="detail-actions">
          <button class="ghost-btn" id="shareBtn" type="button">Share link</button>
          <button class="ghost-btn" id="exportRecBtn" type="button">Download JSON</button>
        </div>
      </div>
      ${fields.join('')}
      <div class="ref">archive ref \u2014 ${escapeHtml(gameId)} : ${escapeHtml(typeKey)} : ${escapeHtml(rec.id)}</div>
    </div>
  </div>`;
  $('modalClose').addEventListener('click', closeDetail);
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeDetail(); });
  document.addEventListener('keydown', onEsc);
  document.addEventListener('keydown', trapFocus);
  $('modalRoot').querySelectorAll('.chip[data-link]').forEach((chip) => {
    const go = () => {
      const { target, id: rid } = chip.dataset;
      const resolved = resolveRef(gameId, target, rid);
      if (resolved) openDetail(rid, target, resolved.gameId);
    };
    chip.addEventListener('click', go);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); go(); }
    });
  });
  $('shareBtn').addEventListener('click', () => shareCurrent($('shareBtn')));
  $('exportRecBtn').addEventListener('click', () => {
    downloadJSON(`${gameId}-${typeKey}-${rec.id}.json`, { game: gameId, type: typeKey, record: rec });
    flashButton($('exportRecBtn'), 'Downloaded \u2713');
  });
  $('modalClose').focus();
  syncHash();
}

function onEsc(e) { if (e.key === 'Escape') closeDetail(); }

function trapFocus(e) {
  if (e.key !== 'Tab' || !state.detail) return;
  const root = $('modalRoot');
  const focusables = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function closeDetail() {
  $('modalRoot').innerHTML = '';
  state.detail = null;
  document.removeEventListener('keydown', onEsc);
  document.removeEventListener('keydown', trapFocus);
  if (lastFocused && lastFocused.isConnected) lastFocused.focus();
  lastFocused = null;
  syncHash();
}

function renderField(f, rec, gameId) {
  const raw = rec[f.key];
  let inner;
  if (f.type === 'links') {
    const ids = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (!ids.length) return '';
    const chips = ids.map((id) => {
      const res = resolveRef(gameId, f.target, id);
      const name = res ? res.rec.name : id;
      return `<span class="chip ${res ? '' : 'missing'}" ${res ? `role="button" tabindex="0" aria-label="Open ${escapeHtml(name)}" data-link data-target="${f.target}" data-id="${escapeHtml(id)}"` : ''}>${escapeHtml(name)}</span>`;
    }).join('');
    inner = `<div class="chips">${chips}</div>`;
  } else if (f.type === 'strings') {
    const vals = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (!vals.length) return '';
    inner = `<div class="chips">${vals.map((v) => `<span class="chip" style="cursor:default">${escapeHtml(v)}</span>`).join('')}</div>`;
  } else if (f.type === 'bool') {
    if (raw === undefined) return '';
    inner = `<span class="f-value">${raw ? 'Yes' : 'No'}</span>`;
  } else if (f.type === 'number') {
    if (raw === undefined || raw === null || raw === '') return '';
    inner = `<span class="f-value">${escapeHtml(raw)}</span>`;
  } else if (f.type === 'textarea') {
    if (!raw) return '';
    inner = `<span class="f-value big">${escapeHtml(raw)}</span>`;
  } else {
    if (raw === undefined || raw === null || raw === '') return '';
    inner = `<span class="f-value">${escapeHtml(raw)}</span>`;
  }
  return `<div class="field"><p class="f-label">${escapeHtml(f.label)}</p>${inner}</div>`;
}

/* ---------------- roadmap view ---------------- */

function renderRoadmap() {
  const game = state.games.find((g) => g.id === state.activeGame);
  const ctx = computeContext(game);

  $('roadTitle').textContent = `Ingestion Roadmap \u2014 ${game.title}`;
  $('roadSub').textContent = game.ingestNote || 'The atomic process by which this game\u2019s dataset is ingested and stored.';

  const totalSteps = ROADMAP.reduce((n, p) => n + p.steps.length, 0);
  let doneAll = 0;
  const phaseStats = ROADMAP.map((p) => {
    let d = 0;
    for (const s of p.steps) if (stepDone(game, ctx, s)) d++;
    doneAll += d;
    return { phase: p, done: d, total: p.steps.length };
  });
  const pct = Math.round((doneAll / totalSteps) * 100);

  const verifiedPct = ctx.total ? Math.round(ctx.verifiedRatio * 100) : 0;
  $('gameProgress').innerHTML = `
    <div class="gp-cell"><div class="gp-label">Overall</div><div class="gp-num">${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="gp-cell"><div class="gp-label">Records stored</div><div class="gp-num">${ctx.total}</div><div class="gp-sub">across ${ctx.categoriesIngested}/${state.schema.entityTypes.length} categories</div></div>
    <div class="gp-cell"><div class="gp-label">Cross-links</div><div class="gp-num">${ctx.linksResolved}/${ctx.linksTotal}</div><div class="gp-sub">resolved references</div></div>
    <div class="gp-cell"><div class="gp-label">Verification</div><div class="gp-num">${verifiedPct}%</div><div class="gp-sub">records marked verified</div></div>`;

  const phasesEl = $('phases');
  phasesEl.innerHTML = phaseStats.map(({ phase: p, done, total }) => `
    <div class="phase">
      <div class="phase-head">
        <span class="phase-num">${p.id}</span>
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          <div class="p-desc">${escapeHtml(p.desc)}</div>
        </div>
        <span class="p-count">${done}/${total}</span>
        <span class="chev">\u25be</span>
      </div>
      <div class="phase-body">
        ${p.id === 'P3' ? renderCatGrid(game, ctx) : ''}
        ${p.steps.map((s) => stepRow(game, ctx, s, p)).join('')}
      </div>
    </div>`).join('');

  phasesEl.querySelectorAll('.phase-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
  phasesEl.querySelectorAll('.step input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
    setManual(game.id, cb.dataset.key, cb.checked);
    renderRoadmap();
  }));
  phasesEl.querySelectorAll('.step .check[data-key]').forEach((cb) => cb.addEventListener('click', () => {
    const on = !manualDone(game.id, cb.dataset.key);
    setManual(game.id, cb.dataset.key, on);
    cb.textContent = on ? '\u2713' : '';
    cb.closest('.step').classList.toggle('done', on);
    renderRoadmap();
  }));
  phasesEl.querySelectorAll('.cat-cell').forEach((cell) => cell.addEventListener('click', () => {
    state.activeCat = cell.dataset.cat;
    setTab('db');
  }));

  renderArchiveRoadmap();
}

function renderCatGrid(game, ctx) {
  return `<div class="cat-grid">${state.schema.entityTypes.map((t) => {
    const n = ctx.counts[t.key] || 0;
    const st = n === 0 ? 'pending' : (ctx.catStatus[t.key] === CATEGORY_STATUS.ready ? 'ready' : 'draft');
    const stLabel = st === 'ready' ? 'complete \u2713' : (st === 'draft' ? 'draft' : 'awaiting');
    return `<div class="cat-cell ${st}" data-cat="${t.key}">
      <div class="cc-name"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px">${GLYPHS[t.glyph]}</svg>${escapeHtml(t.label)}</div>
      <div class="cc-count">${n} record${n === 1 ? '' : 's'}</div>
      <div class="cc-status">${stLabel}</div>
    </div>`;
  }).join('')}</div>`;
}

function stepRow(game, ctx, s, p) {
  const done = stepDone(game, ctx, s);
  const key = s.kind === 'manual' ? s.key : null;
  return `<div class="step ${done ? 'done' : ''}">
    ${s.kind === 'manual'
      ? `<span class="check" data-key="${key}" title="manual step — click to complete" style="cursor:pointer">${done ? '\u2713' : ''}</span>`
      : `<span class="check">\u2713</span>`}
    <span class="s-label">${escapeHtml(s.label)}</span>
    <span class="s-kind ${s.kind}">${s.kind}</span>
  </div>`;
}

function stepDone(game, ctx, s) {
  if (s.kind === 'manual') return manualDone(game.id, s.key);
  try { return !!s.done(game, ctx); } catch { return false; }
}

/* ---------------- cross-cutting upgrades ---------------- */

function renderArchiveRoadmap() {
  const el = $('archiveRoadmap');
  if (!el) return;
  const totalSteps = ARCHIVE_ROADMAP.reduce((n, p) => n + p.steps.length, 0);
  let doneAll = 0;
  const stats = ARCHIVE_ROADMAP.map((p) => {
    let d = 0;
    for (const s of p.steps) if (stepDone(null, null, s)) d++;
    doneAll += d;
    return { phase: p, done: d, total: p.steps.length };
  });
  const pct = Math.round((doneAll / totalSteps) * 100);
  el.innerHTML = `
    <div class="roadmap-head" style="margin-top:34px">
      <h2>Cross-cutting Upgrades</h2>
      <p>App-level work that applies to the whole archive rather than a single game.</p>
    </div>
    <div class="game-progress">
      <div class="gp-cell"><div class="gp-label">Overall</div><div class="gp-num">${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div class="gp-cell"><div class="gp-label">Steps</div><div class="gp-num">${doneAll}/${totalSteps}</div><div class="gp-sub">integrity &amp; experience</div></div>
    </div>
    ${stats.map(({ phase: p, done, total }) => `
      <div class="phase">
        <div class="phase-head">
          <span class="phase-num">${p.id}</span>
          <div><h3>${escapeHtml(p.name)}</h3><div class="p-desc">${escapeHtml(p.desc)}</div></div>
          <span class="p-count">${done}/${total}</span>
          <span class="chev">\u25be</span>
        </div>
        <div class="phase-body">${p.steps.map((s) => stepRow(null, null, s, p)).join('')}</div>
      </div>`).join('')}`;
  el.querySelectorAll('.phase-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
}

/* ---------------- integrity view ---------------- */

function renderIntegrity() {
  const issues = state.integrity || [];
  const KIND_LABEL = { required: 'required', enum: 'enum', duplicate: 'dup id', orphan: 'orphan' };
  const counts = { required: 0, enum: 0, duplicate: 0, orphan: 0 };
  for (const i of issues) counts[i.kind] = (counts[i.kind] || 0) + 1;

  $('intProgress').innerHTML = `
    <div class="gp-cell"><div class="gp-label">Issues</div><div class="gp-num" style="color:${issues.length ? 'var(--blood)' : 'var(--ok)'}">${issues.length}</div><div class="gp-sub">across the whole archive</div></div>
    <div class="gp-cell"><div class="gp-label">Missing required</div><div class="gp-num">${counts.required}</div></div>
    <div class="gp-cell"><div class="gp-label">Illegal enum</div><div class="gp-num">${counts.enum}</div></div>
    <div class="gp-cell"><div class="gp-label">Duplicate ids</div><div class="gp-num">${counts.duplicate}</div></div>
    <div class="gp-cell"><div class="gp-label">Orphan links</div><div class="gp-num">${counts.orphan}</div></div>`;

  const list = $('integrityList');
  if (!issues.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">The archive validates cleanly</div>Every stored record satisfies the canonical schema.</div>`;
    return;
  }
  const byGame = {};
  for (const i of issues) (byGame[i.gameId] = byGame[i.gameId] || []).push(i);
  list.innerHTML = state.games.filter((g) => byGame[g.id]).map((g) => {
    const items = byGame[g.id];
    return `<div class="phase">
      <div class="phase-head" style="cursor:default">
        <span class="phase-num" style="font-size:12px">${items.length}</span>
        <div><h3>${escapeHtml(g.title)}</h3><div class="p-desc">${items.length} issue${items.length === 1 ? '' : 's'} to reconcile</div></div>
      </div>
      <div class="phase-body">
        ${items.map((i) => `<div class="issue" data-g="${i.gameId}" data-t="${i.cat}" data-id="${escapeHtml(i.id)}">
          <span class="i-kind ${i.kind}">${KIND_LABEL[i.kind] || i.kind}</span>
          <span class="i-detail">${escapeHtml(i.name || i.id)} \u2014 ${escapeHtml(i.detail)}</span>
          <span class="i-ref">${escapeHtml(i.cat)}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.issue').forEach((el) => el.addEventListener('click', () => openDetail(el.dataset.id, el.dataset.t, el.dataset.g)));
}

if (document.readyState !== 'loading') init();
else window.addEventListener('DOMContentLoaded', init);
