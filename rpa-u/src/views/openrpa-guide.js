import { el } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { OPENRPA_HELP } from "./guides.js";

function chip(text, tone) {
  return el("span.pu-chip", { class: tone || "", text });
}

function checklistCard(or) {
  const status = or && typeof or.status === "function" ? or.status() : null;
  const card = el("section.pu-card");
  card.appendChild(el("h2", { text: "Connection checklist" }));
  card.appendChild(
    el("p.pu-small", {
      text: "Work down this list once per endpoint. The hub stores connection profiles — never credentials — so a password or token is only ever held for the life of the session.",
    })
  );
  const row = el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } });
  if (status) {
    row.appendChild(chip(`Mode ${status.mode === "live" ? "live endpoint" : "offline emulator"}`, ""));
    row.appendChild(chip(`State ${status.state}`, status.connected ? "ok" : "warn"));
    row.appendChild(chip(status.connected ? "Connected" : "Not connected", status.connected ? "ok" : "warn"));
    row.appendChild(chip(`${(status.profiles && status.profiles.total) || 0} profile(s)`, ""));
    row.appendChild(chip(status.session && status.session.signedIn ? "Signed in" : "Signed out", status.session && status.session.signedIn ? "ok" : ""));
  }
  card.appendChild(row);
  const list = el("ol.pu-help-steps", { style: { "margin-top": "0.5rem" } });
  for (const step of [
    "Create a connection profile: a name plus a ws:// or wss:// URL (or a scheme, host, port and path), and press Validate before you add it.",
    "Choose the offline emulator or the live endpoint, press Connect, then Ping to prove a round trip before you depend on it.",
    "Sign in with a username and password or a pasted JWT, and read the token user, its OpenFlow roles and the mapped canonical roles.",
    "If a feature is refused, check the granted capabilities and the effective rights before assuming the endpoint is broken.",
  ]) {
    list.appendChild(el("li", { text: step }));
  }
  card.appendChild(list);
  return card;
}

function helpCard(entry) {
  const card = el("section.pu-card");
  const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
  head.appendChild(el("h2", { text: entry.title }));
  head.appendChild(el("a.pu-btn.secondary", { href: `#/${entry.route}`, text: "Open this screen", style: { "margin-left": "auto" } }));
  card.appendChild(head);
  card.appendChild(el("p", { text: entry.summary }));
  const steps = el("ol.pu-help-steps");
  for (const step of entry.steps) steps.appendChild(el("li", { text: step }));
  card.appendChild(steps);
  return card;
}

function topicIndex(or) {
  const card = el("section.pu-card");
  card.appendChild(el("h2", { text: "What this guide covers" }));
  card.appendChild(el("p.pu-small", { text: "Every topic below links straight to the screen that implements it. Start with the connection checklist, then follow whichever topic you need." }));
  const list = el("ul.pu-help-index");
  for (const entry of OPENRPA_HELP) {
    const item = el("li");
    item.appendChild(el("a.pu-help-index-link", { href: `#/${entry.route}`, text: entry.title }));
    item.appendChild(el("span.pu-small.pu-muted", { text: entry.summary }));
    list.appendChild(item);
  }
  card.appendChild(list);
  return card;
}

export const openrpaGuideView = {
  id: "openrpa-guide",
  title: "OpenRPA guide",
  group: "OpenRPA",
  icon: "doc",
  nav: true,
  render({ hub }) {
    const root = el("div");
    root.appendChild(
      pageHead({
        eyebrow: "OpenRPA / OpenFlow",
        title: "OpenRPA guide",
        subtitle: "Everything a first-time user needs to connect OpenRPA to the hub and use it: connecting, choosing collections, running queues, invoking workflows, reading events, reconciling drift and troubleshooting a failed connection.",
      })
    );
    root.appendChild(checklistCard(hub.openrpa));
    root.appendChild(topicIndex(hub.openrpa));
    for (const entry of OPENRPA_HELP) root.appendChild(helpCard(entry));
    return root;
  },
};
