// src/app.js — boots the knowledge base app.
//
// Wires the static shell in index.html to the framework: fills the header,
// renders the module navigation + category tree, starts the hash router,
// creates the content service (articles, review workflow, search, …), keeps
// the retrieval-ready bundles and data-integrity checks current, and exposes
// a debug/test handle on window.__kb.

import { createRouter } from "./framework/modules.js";
import { renderModuleNav, renderCategoryNav, openDrawer, closeDrawer } from "./framework/nav.js";
import { createCategoriesProvider } from "./framework/categories.js";
import { loadingState, emptyState, errorState } from "./framework/states.js";
import { toast } from "./framework/toast.js";
import { getKbConfig } from "./kb-config.js";
import modules from "./modules/index.js";
import { createDocumentStore } from "./framework/store/index.js";
import { createSyncEngine } from "./framework/store/sync.js";
import { createUploadChannel, createKvCache, createMemoryChannel, createMemoryCache } from "./framework/store/backends.js";
import { DOCUMENTS } from "./framework/store/documents.js";
import { createContentService } from "./framework/content.js";
import { createHub } from "./framework/hub.js";
import { renderAccountButton, openAccountModal } from "./framework/account.js";

const kb = getKbConfig();
const mainEl = document.getElementById("kbMain");

// --- document store ----------------------------------------------------------
// Canonical documents live in the cloud (upload-plugin editable files under
// the KB's storage namespace) with a fast local cache + cached edit keys in
// kv-plugin. If the plugins aren't available (isolated tests), fall back to
// in-memory backends so the app still boots.

// Holds the realtime hub once created (set after content service); the store's
// keyStore falls back to it so shared edit keys work across sessions.
const hubRef = { hub: null };

function createStore() {
  const kv = window.root && window.root.kv;
  const uploadPlugin = window.root && window.root.uploadPlugin;
  if (kv && uploadPlugin) {
    const cache = createKvCache(kv, kb.storageNamespace);
    const activity = kv["kb-activity"];
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
    return { store, cache, channel, activity, uploadPlugin };
  }
  const cache = createMemoryCache();
  const channel = createMemoryChannel();
  const store = createDocumentStore({
    namespace: kb.storageNamespace + "-mem",
    channel,
    cache,
  });
  return { store, cache, channel, activity: null, uploadPlugin: null };
}

// Seed every module's document on first boot (never overwrites existing
// documents). `categories` is seeded from the kb config's tree.
function seedStore(store) {
  const defs = { categories: () => kb.categories };
  for (const [id, d] of Object.entries(DOCUMENTS)) {
    if (id === "categories") continue;
    defs[id] = () => d.seed;
  }
  return store.ensureMany(defs);
}

const { store, cache, channel, activity, uploadPlugin } = createStore();
const sync = createSyncEngine({ store, cache });
sync.attach(store); // keep sync-base coherent as writes/edits land

// Per-device id used for feedback votes, checklists, follows and "seen" state.
async function ensureDeviceId() {
  let id = await cache.get("deviceId").catch(() => null);
  if (!id) {
    id = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    cache.set("deviceId", id).catch(() => {});
  }
  cache._deviceId = id;
}
ensureDeviceId();

const content = createContentService({
  store,
  cache,
  activity,
  uploadPlugin,
  generatorName: window.generatorName,
  announce: (evt) => {
    const h = hubRef.hub;
    if (h) h.announce(evt.articleId, evt.categoryId, evt.version, evt.updatedAt);
  },
});

// ---- realtime hub (Phase 9): roles, live changes, presence, shared edit keys ----
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

// Prefer the signed-in hub identity as the authorship name when available.
const originalIdentity = content.getIdentity.bind(content);
content.getIdentity = async () => (hub.authenticated && hub.username) || (await originalIdentity());

const providers = {
  categories: createCategoriesProvider(async () => {
    const doc = await store.readDocument("categories");
    return doc && Array.isArray(doc.data) && doc.data.length ? doc.data : kb.categories;
  }),
};

const states = { loading: loadingState, empty: emptyState, error: errorState };

let lastIntegrity = null;
async function refreshIntegrity() {
  try {
    lastIntegrity = await content.runIntegrityChecks();
  } catch {
    lastIntegrity = { ok: false, issues: [{ level: "error", message: "Could not run integrity checks." }] };
  }
  return lastIntegrity;
}

// Keep the health check + bundles current after any write that can affect them
// (debounced — writes often land in batches).
let integrityTimer = null;
let bundleTimer = null;
store.onChange((evt) => {
  if (evt.type !== "write") return;
  if (evt.id === "articles" || evt.id === "categories") {
    clearTimeout(integrityTimer);
    integrityTimer = setTimeout(refreshIntegrity, 600);
  }
  if (evt.id === "articles") {
    clearTimeout(bundleTimer);
    bundleTimer = setTimeout(() => content.refreshBundles().catch(() => {}), 900);
  }
  if (evt.id === "categories") {
    providers.categories.invalidate();
    refreshCategories();
  }
});

function fillHeader() {
  const title = kb.appShortTitle || kb.appTitle || "Knowledge Base";
  document.getElementById("kbAppTitle").textContent = title;
  document.getElementById("kbLogoMark").textContent = title.slice(0, 2).toUpperCase();
  const tag = document.getElementById("kbTagline");
  if (tag) tag.textContent = kb.tagline || "";
  document.title = (kb.appTitle || title) + " — Knowledge Base";
}

const router = createRouter(mainEl, {
  kb,
  providers,
  states,
  toast,
  modules,
  store,
  sync,
  content,
  hub,
  get integrity() {
    return lastIntegrity;
  },
  onNavigate: (mod) => {
    renderModuleNav(document.getElementById("moduleNav"), modules, mod.id, { onSelect: closeDrawer });
  },
});
for (const m of modules) router.register(m);

function refreshCategories() {
  renderCategoryNav(document.getElementById("categoryNav"), {
    getTree: () => providers.categories.getTree(),
    onSelect: (node) => {
      closeDrawer();
      window.__kb.pendingCategory = node.id;
      router.navigate("browse");
    },
  });
}

function wireHeader() {
  const menuBtn = document.getElementById("menuBtn");
  menuBtn.addEventListener("click", () => {
    const sidebar = document.getElementById("kbSidebar");
    if (sidebar.classList.contains("open")) closeDrawer();
    else openDrawer();
  });
  document.getElementById("kbBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  const qs = document.getElementById("quickSearchInput");
  qs.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && qs.value.trim()) {
      window.__kb.pendingSearch = qs.value.trim();
      router.navigate("search");
      setTimeout(() => {
        const i = document.getElementById("searchInput");
        if (i) {
          i.focus();
          i.select();
        }
      }, 0);
    }
  });

  document.getElementById("catsRefreshBtn").addEventListener("click", () => {
    providers.categories.invalidate();
    refreshCategories();
  });

  const adminBtn = document.getElementById("kbAdminBtn");
  if (adminBtn) adminBtn.addEventListener("click", () => router.go("#/admin"));
  const newBtn = document.getElementById("kbNewBtn");
  if (newBtn) newBtn.addEventListener("click", () => router.go("#/editor/new"));

  const acctBtn = document.getElementById("kbAcctBtn");
  if (acctBtn) {
    renderAccountButton(hub, acctBtn);
    acctBtn.addEventListener("click", () => openAccountModal({ hub, toast, router }));
  }

  // ---- realtime / role UI (Phase 9) ---------------------------------------
  // Refresh the account button, presence pill, and role-gated header actions
  // whenever auth state changes. Offline = single-user local mode (all actions
  // available); online = server-authoritative roles.
  function refreshHubUi() {
    if (acctBtn) renderAccountButton(hub, acctBtn);
    const pill = document.getElementById("kbPresence");
    const pillText = document.getElementById("kbPresenceText");
    const online = hub.connected && hub.authenticated;
    if (pill && pillText) {
      if (hub.connected) {
        pill.hidden = false;
        pillText.textContent = hub.onlineCount != null ? `online · ${hub.onlineCount}` : "online";
        pill.classList.add("live");
      } else {
        pill.hidden = true;
        pill.classList.remove("live");
      }
    }
    const enforced = hub.connected && hub.authenticated;
    if (adminBtn) adminBtn.hidden = enforced && !hub.isAdmin;
    if (newBtn) newBtn.hidden = enforced && !hub.canWrite;
    if (typeof window.__kbRefreshRoleUi === "function") window.__kbRefreshRoleUi();
  }
  hub.onAuthChanged(refreshHubUi);
  refreshHubUi();

  // Presence count poll (every 20s while the hub is up).
  hub.onlineCount = null;
  setInterval(async () => {
    if (!hub.connected) return;
    try {
      const p = await hub.presence(["kb:all"]);
      hub.onlineCount = p.online || 0;
      const pillText = document.getElementById("kbPresenceText");
      if (pillText) pillText.textContent = p.online != null ? `online · ${p.online}` : "online";
    } catch {}
  }, 20000);
}

fillHeader();
wireHeader();
refreshCategories();

window.__kb = {
  kb, providers, states, router, toast, modules, store, sync, content, hub,
  refreshCategories,
  refreshIntegrity: async () => {
    const r = await refreshIntegrity();
    return r;
  },
  get integrity() {
    return lastIntegrity;
  },
};

// Background: make sure every module's canonical document exists (idempotent —
// existing documents are never touched), seed default templates, refresh the
// retrieval-ready bundles, reflect the storage mode, then reconcile the local
// cache against the canonical documents (roadmap task 3) and surface conflicts.
seedStore(store)
  .then(async () => {
    await content.seedDefaultTemplates().catch(() => {});
    providers.categories.invalidate();
    refreshCategories();
    await content.refreshBundles().catch(() => {});
    await refreshIntegrity();
    return store.getStatus();
  })
  .then((status) => {
    const cloudOk = status && !status.failed && status.docCount > 0;
    updateStorageUi(cloudOk, status && !status.failed ? status : null);
  })
  .catch(() => {
    updateStorageUi(false, null);
  })
  .then(() => sync.reconcile())
  .then((res) => {
    if (res && res.conflicts && res.conflicts.length) {
      const n = res.conflicts.length;
      toast(`${n} document${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} conflict resolution — see Home`, "warning", 5200);
    } else if (res && res.pushed > 0) {
      toast(`Synced ${res.pushed} offline change${res.pushed === 1 ? "" : "s"} to the cloud`, "success");
    }
  })
  .catch(() => {});

function updateStorageUi(cloudOk, status) {
  const pill = document.getElementById("kbStatusPill");
  const pillText = document.getElementById("kbStatusText");
  if (pill && pillText) {
    if (cloudOk && status) {
      pillText.textContent = "Cloud";
      pill.title =
        `${status.docCount} documents · ${(status.totalBytes / 1024).toFixed(1)} KB · ` +
        `versioned cloud store with local cache (${status.namespace})`;
    } else {
      pillText.textContent = "Local";
      pill.title = "Documents are not being saved to the cloud yet — save the generator to enable it.";
    }
  }
  const foot = document.getElementById("sidebarFoot");
  if (foot) {
    foot.textContent = cloudOk
      ? `Cloud-synced document store · ${status.docCount} documents · ${status.namespace}`
      : "Document store · saving unavailable until the generator is saved";
  }
}

router.start();
hub.start();
