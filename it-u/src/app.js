// src/app.js — boots the IT-U app shell.
//
// Builds the frame around the station set: fills the header, renders the
// station navigation, starts the hash router, and boots the framework services
// the stations build on (the versioned document store, the sync/conflict
// engine, and the realtime hub). It exposes a debug/test handle on
// window.__kb (the `kb` name is the retained framework identifier).
//
// The station content model is built task by task on top of this shell (see
// roadmap.pjs / src/ROADMAP.md).

import { createRouter } from "./framework/modules.js";
import { renderModuleNav, openDrawer, closeDrawer } from "./framework/nav.js";
import { loadingState, emptyState, errorState } from "./framework/states.js";
import { toast } from "./framework/toast.js";
import { getKbConfig } from "./kb-config.js";
import modules from "./modules/index.js";
import { createDocumentStore } from "./framework/store/index.js";
import { createSyncEngine } from "./framework/store/sync.js";
import { createDocSetService } from "./framework/docsets.js";
import { createAccessService } from "./framework/access.js";
import { createBackupService } from "./framework/store/backup.js";
import { createArchiveService } from "./framework/archive.js";
import { createTemplateService } from "./framework/templates.js";
import { createFlexibleTypeService } from "./framework/flexibleTypes.js";
import { createPublicationService } from "./framework/publication.js";
import { createPacketService } from "./framework/packet.js";
import { createUploadChannel, createKvCache, createMemoryChannel, createMemoryCache } from "./framework/store/backends.js";
import { createHub } from "./framework/hub.js";
import { createSsoService } from "./framework/sso.js";
import { clientScope } from "./framework/roles.js";
import { renderAccountButton, openAccountModal } from "./framework/account.js";
import { createConnectivity, pendingDraftsSummary } from "./framework/field.js";
import { openQuickFind, invalidateQuickFindCache } from "./modules/quickfind.js";
import { icons } from "./framework/icons.js";
import { initTheme, toggleMode, resolveMode, onThemeChange, getTheme, setMode, setThemeId, resetTheme, PRESETS } from "./framework/theme.js";

const kb = getKbConfig();
const mainEl = document.getElementById("kbMain");
const DEFAULT_STATION = (modules[0] && modules[0].id) || "organizations";

// Holds the realtime hub once created (set after the store); the store's
// keyStore falls back to it so shared edit keys work across sessions.
const hubRef = { hub: null };

// --- document store ----------------------------------------------------------
// Canonical documents live in the cloud (upload-plugin editable files under
// IT-U's storage namespace) with a fast local cache + cached edit keys in
// kv-plugin. If the plugins aren't available (isolated tests), fall back to
// in-memory backends so the app still boots. The client-documentation-set
// documents themselves are defined by roadmap Phase 1 task 2.
function createStore() {
  const kv = window.root && window.root.kv;
  const uploadPlugin = window.root && window.root.uploadPlugin;
  if (kv && uploadPlugin) {
    const cache = createKvCache(kv, kb.storageNamespace);
    const keyStore = {
      get: async (k) => {
        const local = await cache.get("editkey::" + k).catch(() => null);
        if (local) return local;
        const h = hubRef.hub;
        if (h && h.connected && h.canWrite) {
          const shared = await h.getEditKey(k).catch(() => null);
          if (shared) cache.set("editkey::" + k, shared).catch(() => {});
          return shared;
        }
        return null;
      },
      set: (k, v) => {
        const p = cache.set("editkey::" + k, v);
        const h = hubRef.hub;
        if (h && h.connected && h.canWrite) h.storeEditKey(k, v);
        return p;
      },
      del: (k) => cache.del("editkey::" + k),
    };
    const channel = createUploadChannel({ uploadPlugin, keyStore });
    const store = createDocumentStore({ namespace: kb.storageNamespace, channel, cache });
    return { store, cache, channel, cloudEnabled: true };
  }
  const cache = createMemoryCache();
  const channel = createMemoryChannel();
  const store = createDocumentStore({ namespace: kb.storageNamespace + "-mem", channel, cache });
  return { store, cache, channel, cloudEnabled: false };
}

const { store, cache, channel, cloudEnabled } = createStore();
const sync = createSyncEngine({ store, cache });
sync.attach(store); // keep the sync base coherent as writes land

// ---- connectivity (roadmap task 51) ----------------------------------------
// Tracks online/offline and the reconcile lifecycle. The live picture is shown
// on the Status station (roadmap task 57) rather than in the header, so the
// chrome stays uncluttered; this service is the single source the station reads.
const connectivity = createConnectivity();
connectivity.start();

// The control surface the Status station drives. `wireConnectivity` fills in the
// real implementations below; it is created up-front so the router can hand a
// stable reference to the station's ctx at construction time.
const statusControl = {
  pending: 0,
  cloudEnabled: false,
  storageStatus: null,
  listeners: new Set(),
  subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    statusControl.listeners.add(fn);
    return () => statusControl.listeners.delete(fn);
  },
  emit() {
    for (const fn of [...statusControl.listeners]) {
      try {
        fn(statusControl.pending);
      } catch {}
    }
  },
  refreshPending: async () => 0,
  reconcile: async () => null,
};

// ---- groups & access (Phase 4 task 20) -------------------------------------
// The group library lives in the same versioned store as everything else. Its
// role lookup reads the realtime hub: absent/offline it is the single-user
// owner (full access); connected, it maps the signed-in identity's hub role
// onto a group, and treats every other identified user as a viewer until an
// administrator assigns them groups.
const access = createAccessService({
  store,
  cache,
  getRole: (username) => {
    const h = hubRef.hub;
    if (!h || !h.connected) return "owner";
    const who = String(username || "").toLowerCase();
    if (!who || who !== String(h.username || "").toLowerCase()) return "viewer";
    if (h.isAdmin) return "admin";
    return h.canWrite ? "technician" : "viewer";
  },
  // Roadmap task 54: the signed-in identity's server-assigned, SCOPED roles, so
  // access decisions resolve per client and per service rather than globally.
  getAssignments: (username) => {
    const h = hubRef.hub;
    if (!h || !h.connected || !h.authenticated) return null;
    const who = String(username || "").toLowerCase();
    if (!who || who !== String(h.username || "").toLowerCase()) return null;
    return h.assignments();
  },
});
access.load().catch(() => {});

// ---- documentation sets (Phase 1 tasks 2–4) --------------------------------
// One versioned JSON document per client, holding every record type; records
// carry a classification and relationships are first-class typed links.
const docs = createDocSetService({ store, cache, access });

// ---- backup / restore (task 5), capacity / archival (task 6), templates ----
// backup.publish uploads the full documentation backup through upload-plugin
// when the generator is saved; download/restore work either way.
const backup = createBackupService({
  store,
  cache,
  generatorName: (typeof window !== "undefined" && window.generatorName) || null,
  upload: (text, opts) => {
    const up = window.root && window.root.uploadPlugin;
    if (!up) return Promise.resolve({ error: "upload plugin unavailable — save the generator first" });
    return up(text, opts);
  },
});
const archive = createArchiveService({ store, docs, ceiling: kb.storageCeiling });
const templates = createTemplateService({ store, docs });

// ---- publication to the shared bus / knowledge base (task 49) --------------
// Builds documentation & deployment bundles in the shared envelope format with
// a default-deny redaction posture, publishes them through upload-plugin and
// keeps an export log of what was published when.
const publication = createPublicationService({
  store,
  cache,
  generatorName: (typeof window !== "undefined" && window.generatorName) || null,
  upload: (text, opts) => {
    const up = window.root && window.root.uploadPlugin;
    if (!up) return Promise.resolve({ error: "upload plugin unavailable — save the generator first" });
    return up(text, opts);
  },
});

// ---- the global Flexible Asset template library (tasks 12–13) --------------
// One library document holds every asset type; it is shared across all clients.
const assetTypes = createFlexibleTypeService({ store, cache });
assetTypes.load().catch(() => {});

// ---- printable & hostable packets (task 50) --------------------------------
// Builds a documentation or deployment packet as markdown / printable HTML,
// hosts the standalone HTML through upload-plugin, and keeps a packet log.
const packets = createPacketService({
  store,
  cache,
  generatorName: (typeof window !== "undefined" && window.generatorName) || null,
  upload: (text, opts) => {
    const up = window.root && window.root.uploadPlugin;
    if (!up) return Promise.resolve({ error: "upload plugin unavailable — save the generator first" });
    return up(text, opts);
  },
  getAssetTypes: () => assetTypes.list(),
});

// ---- realtime hub (Phase 13): roles, live changes, presence, shared edit keys
const hub = createHub({
  kv: window.root && window.root.kv,
  toast,
  listEditKeys: async () => {
    try {
      const entries = await cache.entries();
      return (entries || []).filter(([k]) => k.startsWith("editkey::")).map(([k, v]) => [k.slice(9), v]);
    } catch {
      return [];
    }
  },
});
hubRef.hub = hub;

// ---- single sign-on (roadmap task 58) --------------------------------------
// The client half of identity-provider sign-in: it drives the OIDC popup flow
// (PKCE, no client secret) and hands the resulting ID token to the hub, whose
// server verifies it and opens the session. The service never decides who the
// user is. It is inert when no provider is configured, and can be turned off
// entirely with `kb.ssoEnabled = false`.
const sso = createSsoService({ hub, toast });
// The provider popup (src/sso-callback.html) reports back with postMessage;
// handlePopupMessage ignores anything that is not our own same-origin message.
window.addEventListener("message", (evt) => sso.handlePopupMessage(evt));

const states = { loading: loadingState, empty: emptyState, error: errorState };

const router = createRouter(mainEl, {
  kb,
  states,
  toast,
  modules,
  store,
  sync,
  hub,
  docs,
  backup,
  archive,
  templates,
  assetTypes,
  access,
  publication,
  packets,
  connectivity,
  status: statusControl,
  sso: kb.ssoEnabled === false ? null : sso,
  defaultId: DEFAULT_STATION,
  onNavigate: (mod) => {
    renderModuleNav(document.getElementById("moduleNav"), modules, mod.id, { onSelect: closeDrawer });
  },
});
for (const m of modules) router.register(m);

function wireConnectivity() {
  let pending = 0;
  let pendingTimer = null;
  let reconciling = false;

  async function refreshPending() {
    try {
      const [drafts, conflicts] = await Promise.all([sync.listDrafts(), sync.listConflicts()]);
      // Conflicted drafts aren't "waiting to sync" — they need a decision, which
      // the Settings station surfaces. Count only the drafts reconcile can push.
      pending = Math.max(0, pendingDraftsSummary(drafts).count - (conflicts ? conflicts.length : 0));
    } catch {
      pending = 0;
    }
    statusControl.pending = pending;
    statusControl.emit();
    return pending;
  }

  function schedulePendingRefresh() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(refreshPending, 400);
  }

  // Push any locally-staged changes, then report. Called on reconnect, on
  // returning to the tab, and once at boot.
  async function reconcile({ announce = false } = {}) {
    if (reconciling) return null;
    reconciling = true;
    connectivity.beginSync();
    try {
      const res = await sync.reconcile();
      connectivity.endSync(res);
      if (res && res.conflicts && res.conflicts.length) {
        const n = res.conflicts.length;
        toast(`${n} document${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} conflict resolution`, "warning", 6000);
      } else if (announce && res && res.pushed) {
        toast(`Synced ${res.pushed} offline change${res.pushed === 1 ? "" : "s"}`, "success", 4200);
      }
      invalidateQuickFindCache();
      return res;
    } catch (e) {
      connectivity.endSync({ error: String((e && e.message) || e) });
      return null;
    } finally {
      reconciling = false;
      schedulePendingRefresh();
    }
  }

  connectivity.subscribe((snap) => {
    statusControl.emit();
    if (snap.online && snap.previous === false) reconcile({ announce: true });
  });

  refreshPending();
  // Cheap liveness loop: refresh the pending count, and re-check the browser's
  // online flag while we believe we're offline.
  setInterval(() => {
    refreshPending();
    if (!connectivity.online) connectivity.check();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refreshPending().then((n) => {
      if (n > 0 && connectivity.online) reconcile({ announce: false });
    });
  });
  store.onChange(schedulePendingRefresh);

  // Hand the live implementations to the stable control object the Status
  // station holds, so a module render never races the boot order.
  statusControl.refreshPending = refreshPending;
  statusControl.reconcile = reconcile;
  return statusControl;
}

function fillHeader() {
  const title = kb.appShortTitle || kb.appTitle || "IT-U";
  const mark = document.getElementById("kbLogoMark");
  const appTitleEl = document.getElementById("kbAppTitle");
  const tag = document.getElementById("kbTagline");
  if (appTitleEl) appTitleEl.textContent = title;
  if (mark) mark.textContent = title.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() || "IT";
  if (tag) tag.textContent = kb.tagline || "";
  document.title = (kb.appTitle || title) + " — TSP Client Documentation";
}

function wireHeader() {
  const menuBtn = document.getElementById("menuBtn");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      const sidebar = document.getElementById("kbSidebar");
      if (sidebar.classList.contains("open")) closeDrawer();
      else openDrawer();
    });
  }
  const backdrop = document.getElementById("kbBackdrop");
  if (backdrop) backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
    const inField = e.target && /^(input|textarea|select)$/i.test(e.target.tagName);
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      openQuickFind(appCtx);
      return;
    }
    if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openQuickFind(appCtx);
    }
  });

  const qs = document.getElementById("quickSearchInput");
  if (qs) {
    qs.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && qs.value.trim()) {
        window.__kb.pendingSearch = qs.value.trim();
        router.navigate("search");
      }
    });
    // Clicking the header search opens the quick-find palette (works on touch),
    // seeded with whatever was typed + Enter'd into the field.
    qs.addEventListener("click", () => {
      const seed = qs.value.trim();
      qs.value = "";
      openQuickFind(appCtx, { initialQuery: seed });
    });
  }

  const settingsBtn = document.getElementById("kbSettingsBtn");
  if (settingsBtn) settingsBtn.addEventListener("click", () => router.go("#/settings"));

  const acctBtn = document.getElementById("kbAcctBtn");
  if (acctBtn) {
    renderAccountButton(hub, acctBtn);
    acctBtn.addEventListener("click", () => openAccountModal({ hub, toast, router, sso: kb.ssoEnabled === false ? null : sso, showSimulator: kb.showSimulator !== false }));
  }

  // Refresh the account button whenever auth state changes.
  function refreshHubUi() {
    if (acctBtn) renderAccountButton(hub, acctBtn);
  }
  hub.onAuthChanged(refreshHubUi);
  refreshHubUi();
}

// The header's light/dark toggle. The icon shows the mode you would switch TO,
// so a light session shows a moon. It stays in sync with the Appearance card in
// Settings (both go through the theme engine's onThemeChange).
function wireTheme() {
  const btn = document.getElementById("kbThemeBtn");
  if (!btn) return;
  const sync = () => {
    const dark = resolveMode() === "dark";
    btn.innerHTML = dark ? icons.sun : icons.moon;
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
  };
  btn.addEventListener("click", () => {
    toggleMode();
    sync();
  });
  onThemeChange(sync);
  sync();
}

// Record the storage mode for the Status station and keep the sidebar footer in
// step. The header no longer carries a Cloud/Local indicator (roadmap task 57),
// so this data lives on `statusControl` and is rendered on the Status screen.
function updateStorageUi(ok, status) {
  statusControl.cloudEnabled = !!ok;
  statusControl.storageStatus = ok ? status : null;
  const foot = document.getElementById("sidebarFoot");
  if (foot) {
    foot.textContent = ok && status
      ? `Cloud-synced document store · ${status.namespace}`
      : "Document store · saving unavailable until the generator is saved";
  }
  statusControl.emit();
}

// The app-level context the quick-find palette and connectivity wiring use;
// station modules get an equivalent ctx from the router.
const appCtx = {
  kb,
  states,
  toast,
  modules,
  store,
  sync,
  hub,
  docs,
  backup,
  archive,
  templates,
  assetTypes,
  access,
  publication,
  packets,
  connectivity,
  status: statusControl,
  sso,
  navigate: (id) => router.navigate(id),
};

initTheme();
fillHeader();
wireHeader();
wireTheme();
wireConnectivity();
router.start();

// Realtime change broadcasting (roadmap task 55): when this session commits a
// documentation-set change, tell the hub so other sessions editing the same
// client see a live "this record changed" event — the anchor for the editor's
// inline remote-change / conflict banner. Announced per CLIENT scope so only
// the people working on that client are notified. The hub is a no-op when the
// session is offline or signed out (single-user local mode).
store.onChange((evt) => {
  if (!evt || evt.type !== "write" || !evt.id) return;
  if (!String(evt.id).startsWith("docset-")) return;
  if (evt.updatedBy === "system") return; // seeding, not a person's edit
  if (!hub.connected || !hub.authenticated) return;
  hub.announce(String(evt.id), clientScope(String(evt.id)), evt.version, evt.updatedAt);
});

hub.start();

window.__kb = {
  kb,
  states,
  router,
  toast,
  modules,
  store,
  sync,
  hub,
  docs,
  backup,
  archive,
  templates,
  assetTypes,
  access,
  publication,
  packets,
  connectivity,
  status: statusControl,
  sso,
  theme: {
    get: getTheme,
    setMode,
    setThemeId,
    toggle: toggleMode,
    reset: resetTheme,
    resolveMode,
    PRESETS,
  },
  quickFind: (opts) => openQuickFind(appCtx, opts),
  invalidateQuickFindCache,
};

// Background: reflect the storage mode, then reconcile the local cache against
// the canonical documents and surface any conflicts (roadmap task 5).
store
  .getStatus()
  .then((status) => updateStorageUi(cloudEnabled, status))
  .catch(() => updateStorageUi(false, null))
  .then(() => sync.reconcile())
  .then((res) => {
    if (res && res.conflicts && res.conflicts.length) {
      const n = res.conflicts.length;
      toast(`${n} document${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} conflict resolution`, "warning", 5200);
    }
  })
  .catch(() => {});
