// src/modules/status.js — the Status station (roadmap task 57).
//
// The live health of every service IT-U runs on, in one unhurried place. The
// header used to carry two crowded pills — "Online" and "Cloud" — which told you
// almost nothing and stole width from the search box. They are gone; this
// station is where connection, cloud store, realtime hub and synchronization
// state is read, along with the actions that act on each.
//
// It reads only from the services the app already builds (framework/field.js's
// connectivity snapshot + pending count, the store's status, the hub's auth /
// presence reads, and the sync engine's overview) and never caches state of its
// own: every card re-reads its source on a short timer and on the events those
// services already emit, so what is on screen is always what the app believes.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { viewPanel, relTime, fmtBytes } from "./shared.js";
import { connectivitySummary } from "../framework/field.js";
import { openAccountModal } from "../framework/account.js";
import { ROLE_LABELS, scopeLabel } from "../framework/roles.js";

const DESC =
  "Connection, cloud store, realtime hub and synchronization — every live service IT-U depends on, and the state it's in right now.";

// How often the hub's presence count is re-read (the only card whose source is
// a network round-trip, so it is throttled independently of the DOM refresh).
const PRESENCE_INTERVAL = 5000;

export default {
  id: "status",
  label: "Status",
  desc: DESC,
  icon: icons.pulse,
  render(ctx) {
    renderStatus(ctx);
  },
};

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------
function renderStatus(ctx) {
  const heroMount = h("div", { class: "kb-status-hero-mount" });
  const grid = h("div", { class: "kb-status-grid" });
  const body = h("div", { class: "kb-status-body" }, heroMount, grid);
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Status", desc: DESC, body }));

  const connection = connectionCard(ctx);
  heroMount.append(connection.el);

  const cloud = cloudCard(ctx);
  const hubPanel = hubCard(ctx);
  const sync = syncCard(ctx);
  grid.append(cloud.el, hubPanel.el, sync.el);

  const cards = [connection, cloud, hubPanel, sync];

  // One refresh pass over every card. Cards never throw into the router, so a
  // single unavailable service degrades one card instead of blanking the page.
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await Promise.all(cards.map((c) => Promise.resolve().then(() => c.refresh && c.refresh()).catch(() => {})));
    } finally {
      refreshing = false;
    }
  }

  // Live wiring: re-read whenever anything the page reports on changes.
  const unsubs = [];
  const sub = (fn) => {
    if (typeof fn === "function") unsubs.push(fn);
  };
  try {
    sub(ctx.connectivity && ctx.connectivity.subscribe(() => refresh()));
  } catch {}
  try {
    sub(ctx.status && ctx.status.subscribe(() => refresh()));
  } catch {}
  try {
    sub(ctx.hub && ctx.hub.onAuthChanged(() => refresh()));
  } catch {}
  try {
    sub(ctx.store && ctx.store.onChange(() => refresh()));
  } catch {}
  const timer = setInterval(refresh, PRESENCE_INTERVAL);

  ctx.onUnmount(() => {
    clearInterval(timer);
    for (const fn of unsubs) {
      try {
        fn();
      } catch {}
    }
  });

  refresh();
}

// ---------------------------------------------------------------------------
// connection — the hero strip
// ---------------------------------------------------------------------------
// The one thing that deserves top billing: are we online, are we mid-sync, and
// how many local changes are still waiting. Tone + copy come from
// connectivitySummary() so the wording stays identical to everywhere else.
function connectionCard(ctx) {
  const dot = h("span", { class: "kb-status-dot" });
  const label = h("strong", { class: "kb-status-hero-label" }, "Checking…");
  const sub = h("span", { class: "kb-status-hero-sub" }, "Reading the connection state…");
  const since = h("span", { class: "kb-status-hero-since" });

  const checkBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbStatusCheckBtn" }, "Check connection now");
  const syncBtn = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", id: "kbStatusSyncBtn" }, "Sync now");

  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = "Checking…";
    try {
      await ctx.connectivity.check();
    } catch {}
    await refresh();
    checkBtn.disabled = false;
    checkBtn.textContent = "Check connection now";
    ctx.toast(ctx.connectivity.online ? "Connection looks good" : "Still offline — edits are saved on this device", ctx.connectivity.online ? "success" : "warning", 4200);
  });

  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing…";
    try {
      const res = await ctx.status.reconcile({ announce: true });
      if (!res) ctx.toast("Nothing to sync", "info", 3600);
      else if (res.error) ctx.toast(String(res.error), "warning", 5200);
      else if (!res.pushed && !(res.conflicts && res.conflicts.length)) ctx.toast("Everything is already up to date", "success", 3600);
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 5200);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync now";
      refresh();
    }
  });

  const el = h(
    "section",
    { class: "kb-card kb-status-hero", dataset: { card: "connection" } },
    h("div", { class: "kb-status-hero-state" }, dot, h("div", { class: "kb-status-hero-main" }, label, sub, since)),
    h("div", { class: "kb-status-hero-actions" }, checkBtn, syncBtn),
  );

  function refresh() {
    const snap = ctx.connectivity.state();
    const pending = (ctx.status && ctx.status.pending) || 0;
    const summary = connectivitySummary(snap, pending);
    dot.className = "kb-status-dot kb-status-dot--" + summary.tone;
    label.textContent = summary.label;
    sub.textContent = summary.title;
    el.dataset.tone = summary.tone;
    const bits = [];
    bits.push(snap.online === false ? "offline for " + relTime(snap.since) : "connected for " + relTime(snap.since));
    if (snap.lastCheckAt) bits.push("last checked " + relTime(snap.lastCheckAt));
    since.textContent = bits.join(" · ");
  }

  return { el, refresh };
}

// ---------------------------------------------------------------------------
// cloud store
// ---------------------------------------------------------------------------
function cloudCard(ctx) {
  const shell = cardShell({ cardId: "cloud", title: "Cloud store", icon: icons.cloud });
  const signIn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", hidden: true }, "Why local only?");
  signIn.addEventListener("click", () => ctx.toast("Save the generator (or open it from perchance.org) so the cloud storage plugin loads. Until then, records live only in this tab.", "info", 6200));
  shell.actionsEl.append(signIn);

  async function refresh() {
    const enabled = !!(ctx.status && ctx.status.cloudEnabled);
    let status = (ctx.status && ctx.status.storageStatus) || null;
    if (!status && ctx.store && ctx.store.getStatus) {
      try {
        status = await ctx.store.getStatus();
      } catch {
        status = null;
      }
    }
    shell.iconEl.innerHTML = enabled ? icons.cloud : icons.cloudOff;
    shell.el.dataset.state = enabled ? "on" : "off";
    shell.valueEl.textContent = enabled ? (status ? fmtBytes(status.totalBytes || 0) + " stored" : "Connected") : "Local only";
    shell.detailEl.textContent = enabled
      ? "Documents are versioned in the cloud with a local cache. Edits save straight through, and anything made offline is staged as a draft until the connection returns."
      : "The cloud storage plugin isn't loaded in this session, so records are held in memory and won't survive a reload. Open the saved generator to store them.";
    shell.metaEl.textContent = status
      ? (status.docCount || 0) + " document" + (status.docCount === 1 ? "" : "s") + " · namespace " + (status.namespace || "—")
      : enabled
        ? "Reading storage status…"
        : "No storage plugin";
    signIn.hidden = enabled;
  }

  return { el: shell.el, refresh };
}

// ---------------------------------------------------------------------------
// realtime hub
// ---------------------------------------------------------------------------
function hubCard(ctx) {
  const shell = cardShell({ cardId: "hub", title: "Realtime hub", icon: icons.globe });
  const signIn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbStatusSignInBtn" }, "Sign in");
  signIn.addEventListener("click", () => openAccountModal({ hub: ctx.hub, toast: ctx.toast, router: ctx }));
  shell.actionsEl.append(signIn);

  let lastPresenceAt = 0;
  let onlineCount = null;

  async function refresh() {
    const hub = ctx.hub;
    if (!hub) {
      shell.el.dataset.state = "off";
      shell.valueEl.textContent = "Unavailable";
      shell.detailEl.textContent = "No realtime service is wired into this session.";
      shell.metaEl.textContent = "";
      signIn.hidden = true;
      return;
    }
    const available = hub.available;
    const connected = hub.connected;
    const authed = hub.authenticated;

    if (!available) {
      shell.el.dataset.state = "off";
      shell.iconEl.innerHTML = icons.cloudOff;
      shell.valueEl.textContent = "Single-device mode";
      shell.detailEl.textContent = "The realtime hub isn't available in this session. The repository still works on this device; live collaboration and shared edit keys need the hub.";
      shell.metaEl.textContent = "No server plugin loaded";
      signIn.hidden = true;
      return;
    }

    shell.iconEl.innerHTML = connected ? icons.globe : icons.cloudOff;
    shell.el.dataset.state = !connected ? "off" : authed ? "on" : "anon";

    if (!connected) {
      shell.valueEl.textContent = "Reconnecting…";
      shell.detailEl.textContent = "Not connected to the realtime hub right now. It reconnects automatically; until then the app keeps working as a single device.";
      shell.metaEl.textContent = authed ? "Signed in as " + hub.username + " · connection dropped" : "Disconnected";
      signIn.hidden = true;
      return;
    }

    if (!authed) {
      shell.valueEl.textContent = "Signed out";
      shell.detailEl.textContent = "Connected to the hub, but nobody is signed in. Sign in to collaborate live and to write with shared, scoped permissions.";
      shell.metaEl.textContent = "Hub reachable · local (single-user) access until you sign in";
      signIn.hidden = false;
      signIn.textContent = "Sign in";
      return;
    }

    // Signed in: who, what they may write, and how many sessions are present.
    const canWrite = hub.canWrite;
    const roles = (hub.assignments && hub.assignments()) || [];
    shell.valueEl.textContent = "Signed in as " + hub.username;
    shell.detailEl.textContent = hub.isAdmin
      ? "Administrator — full write access everywhere, plus repository-wide controls, roles and publication."
      : canWrite
        ? "Your scoped roles let you write wherever you are assigned; reads everywhere else."
        : "Read-only in this session — you hold roles that can view but not change records.";
    shell.metaEl.textContent = roleLine(roles) + " · can write: " + (canWrite ? "yes" : "no") + presenceSuffix();
    signIn.hidden = false;
    signIn.textContent = "Manage account";
  }

  async function refreshPresence() {
    const hub = ctx.hub;
    if (!hub || !hub.connected) {
      onlineCount = null;
      return;
    }
    const now = Date.now();
    if (now - lastPresenceAt < PRESENCE_INTERVAL - 250) return;
    lastPresenceAt = now;
    try {
      const res = await hub.presence();
      onlineCount = res && typeof res.online === "number" ? res.online : null;
    } catch {
      onlineCount = null;
    }
    refresh();
  }

  function presenceSuffix() {
    return onlineCount == null ? "" : " · " + onlineCount + " online";
  }

  // Presence is the one network read; give it its own timer so the cheap DOM
  // refresh above can stay frequent without hammering the server.
  const presenceTimer = setInterval(refreshPresence, PRESENCE_INTERVAL);
  ctx.onUnmount(() => clearInterval(presenceTimer));
  refreshPresence();

  return { el: shell.el, refresh };
}

function roleLine(roles) {
  if (!roles.length) return "No scoped role assignments";
  const parts = roles.slice(0, 3).map((a) => (ROLE_LABELS[a.role] || a.role) + " · " + scopeLabel(a.scope));
  const extra = roles.length > 3 ? " +" + (roles.length - 3) + " more" : "";
  return parts.join(", ") + extra;
}

// ---------------------------------------------------------------------------
// synchronization
// ---------------------------------------------------------------------------
function syncCard(ctx) {
  const shell = cardShell({ cardId: "sync", title: "Synchronization", icon: icons.server });
  const conflicts = h("div", { class: "kb-status-conflicts" });
  shell.el.append(conflicts);

  async function refresh() {
    let overview = null;
    try {
      overview = ctx.sync ? await ctx.sync.getOverview() : null;
    } catch {
      overview = null;
    }
    const snap = ctx.connectivity ? ctx.connectivity.state() : {};
    const drafts = (overview && overview.drafts) || [];
    const openConflicts = (overview && overview.conflicts) || [];
    const pending = (ctx.status && ctx.status.pending) || 0;

    shell.el.dataset.state = openConflicts.length ? "warn" : pending ? "pending" : "on";
    shell.valueEl.textContent = openConflicts.length
      ? openConflicts.length + " conflict" + (openConflicts.length === 1 ? "" : "s") + " to resolve"
      : pending
        ? pending + " change" + (pending === 1 ? "" : "s") + " waiting to sync"
        : "Up to date";
    shell.detailEl.textContent = openConflicts.length
      ? "Two devices changed the same document. Both versions are preserved until you choose what to keep — resolve them in Settings."
      : pending
        ? "Your offline changes are staged and will push automatically when the connection returns, or use Sync now."
        : "Everything local is in the cloud. New edits are staged here the moment they are made.";
    shell.metaEl.textContent =
      "Last reconciled " + (overview && overview.lastReconciledAt ? relTime(overview.lastReconciledAt) : "never") +
      " · last result: " + lastResultText(snap.lastResult);

    clear(conflicts);
    if (openConflicts.length) {
      conflicts.append(h("div", { class: "kb-subhead" }, "Open conflicts"));
      for (const c of openConflicts.slice(0, 6)) {
        conflicts.append(
          h(
            "div",
            { class: "kb-status-conflict", dataset: { id: c.id } },
            h("span", { class: "kb-status-conflict-name" }, c.id),
            h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openConflictsInSettings(ctx) }, "Resolve"),
          ),
        );
      }
      if (openConflicts.length > 6) conflicts.append(h("p", { class: "kb-muted" }, "…and " + (openConflicts.length - 6) + " more in Settings."));
    }
  }

  async function openConflictsInSettings() {
    ctx.navigate("settings");
    // Settings renders asynchronously; poll briefly for its conflicts card, then
    // bring it into view so the click lands the user exactly where they act.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const card = document.querySelector('[data-card="conflicts"]');
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }

  return { el: shell.el, refresh };
}

function lastResultText(res) {
  if (!res) return "—";
  if (res.error) return "failed — " + String(res.error);
  const pushed = res.pushed || 0;
  const conflicts = (res.conflicts && res.conflicts.length) || 0;
  if (conflicts) return "pushed " + pushed + ", " + conflicts + " conflict" + (conflicts === 1 ? "" : "s");
  return "pushed " + pushed + " change" + (pushed === 1 ? "" : "s");
}

// ---------------------------------------------------------------------------
// card scaffolding
// ---------------------------------------------------------------------------
// A card in the status grid: a section head with an icon, a headline value,
// supporting detail, a meta line and an action row. Callers keep the element
// references and rewrite the text in place on refresh, so the DOM never churns.
function cardShell({ cardId, title, icon }) {
  const iconEl = h("span", { class: "kb-section-icon", html: icon });
  const valueEl = h("span", { class: "kb-status-value" }, "…");
  const detailEl = h("p", { class: "kb-status-card-detail" }, "");
  const metaEl = h("span", { class: "kb-status-card-meta" }, "");
  const actionsEl = h("div", { class: "kb-status-card-actions" });
  const el = h(
    "section",
    { class: "kb-card kb-status-card", dataset: { card: cardId } },
    h("div", { class: "kb-section-head" }, iconEl, h("h2", { class: "kb-section-name" }, title)),
    h("div", { class: "kb-status-card-body" }, valueEl, detailEl, metaEl),
    actionsEl,
  );
  return { el, iconEl, valueEl, detailEl, metaEl, actionsEl };
}
