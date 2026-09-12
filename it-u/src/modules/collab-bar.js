// src/modules/collab-bar.js — the shared presence strip + inline conflict
// banner for the record/runbook editors (roadmap task 55).
//
// `collabBar(ctx, {scope, recordId, label})` is dropped at the top of an editor.
// It claims an editor marker on the record, keeps it refreshed, renders the
// other people editing it, and releases the marker when the editor closes. It
// is careful about the three connection states: connected + signed in (real
// presence), connected but signed out, and offline — in the last two it says so
// rather than pretending, because a single-user local repo is not "nobody is
// editing".
//
// `conflictNotice({title, detail, fields, actions})` renders the inline banner
// an editor shows when a remote save lands on the record it has open. The
// editor decides the actions (reload / keep mine / merge) and passes them in, so
// this file stays a pure view.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { editorNames, editingSummary, editorInitials, pruneEditors } from "../framework/collab.js";

const REFRESH_MS = 20000;

export function collabBar(ctx, { scope, recordId, label = "record" } = {}) {
  const hub = ctx && ctx.hub;
  const me = (hub && hub.username) || "";
  let current = [];
  let stopFns = [];

  const dot = h("span", { class: "kb-collab-dot" });
  const text = h("span", { class: "kb-collab-text" });
  const avatars = h("div", { class: "kb-collab-avatars" });
  const el = h(
    "div",
    { class: "kb-collab-bar", dataset: { scope: scope || "", record: recordId } },
    h("span", { class: "kb-collab-glyph", html: icons.user }),
    h("div", { class: "kb-collab-live" }, dot, text),
    avatars,
  );
  el.hidden = true;

  function render(list) {
    current = pruneEditors(list || []);
    const names = editorNames(current, me);
    if (!names.length) {
      el.hidden = true;
      avatars.replaceChildren();
      return;
    }
    text.textContent = editingSummary(current, me);
    avatars.replaceChildren();
    for (const n of names) {
      avatars.append(
        h("span", { class: "kb-collab-avatar" + (n === me ? " kb-collab-avatar--me" : ""), title: n === me ? "You" : n }, editorInitials(n)),
      );
    }
    el.classList.remove("kb-collab-bar--offline");
    el.hidden = false;
  }

  function offline(message) {
    current = [];
    text.textContent = message;
    avatars.replaceChildren();
    el.classList.add("kb-collab-bar--offline");
    el.hidden = false;
  }

  async function refresh() {
    if (!hub) return offline("Offline — changes refresh when you reconnect");
    if (!hub.connected) return offline("Offline — changes refresh when you reconnect");
    if (!hub.authenticated) return offline("Sign in on the account menu to collaborate");
    try {
      const all = await hub.getEditors(scope);
      const here = (all || []).filter((e) => e.recordId === recordId);
      if (!here.length) {
        const list = await hub.claimEdit(recordId, scope, label);
        render(list);
      } else {
        render(here);
      }
    } catch {
      offline("Offline — changes refresh when you reconnect");
    }
  }

  function start() {
    if (!hub) {
      offline("Single-user repository — sign in to a hub to collaborate");
      return;
    }
    if (hub.onEditors) {
      stopFns.push(
        hub.onEditors((evt) => {
          if (evt.recordId === recordId) render(evt.editors);
        }),
      );
    }
    const timer = setInterval(() => {
      if (hub.connected && hub.authenticated) hub.claimEdit(recordId, scope, label).catch(() => {});
    }, REFRESH_MS);
    stopFns.push(() => clearInterval(timer));
    refresh();
  }

  async function stop() {
    for (const fn of stopFns) {
      try {
        fn();
      } catch {}
    }
    stopFns = [];
    if (hub && hub.releaseEdit) {
      try {
        await hub.releaseEdit(recordId);
      } catch {}
    }
  }

  return { el, start, stop, refresh, editors: () => current };
}

// The inline conflict / remote-change banner. `actions` is a list of
// `{label, tone, onClick}`; `fields` an optional list of strings to bullet.
export function conflictNotice({ title, detail, fields = [], actions = [] } = {}) {
  const body = h(
    "div",
    { class: "kb-collab-notice-body" },
    h("div", { class: "kb-collab-notice-title" }, title || "This record changed on another session"),
    detail ? h("p", { class: "kb-collab-notice-detail" }, detail) : null,
  );
  if (fields && fields.length) {
    body.append(h("ul", { class: "kb-collab-conflict-fields" }, fields.map((f) => h("li", {}, f))));
  }
  const box = h(
    "div",
    { class: "kb-collab-notice" },
    h("span", { class: "kb-collab-notice-icon", html: icons.alert }),
    body,
  );
  if (actions && actions.length) {
    const row = h("div", { class: "kb-collab-notice-actions" });
    for (const a of actions) {
      const btn = h(
        "button",
        { class: "kb-btn kb-btn-sm " + (a.tone === "primary" ? "kb-btn-primary" : "kb-btn-ghost"), type: "button" },
        a.label,
      );
      btn.addEventListener("click", () => a.onClick && a.onClick(btn));
      row.append(btn);
    }
    box.append(row);
  }
  return box;
}
