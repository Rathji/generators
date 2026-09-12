import { el } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { getConfig } from "../framework/config.js";
import { GUIDES, CONCEPTS } from "./guides.js";

const guideIndex = new Map(GUIDES.map((guide) => [guide.id, guide]));

export function screenGuide(id) {
  const guide = guideIndex.get(id);
  if (!guide) return null;
  const card = el("details.pu-help");
  card.appendChild(el("summary", {}, el("span.pu-help-title", { text: "How to use this screen" })));
  const body = el("div.pu-help-body");
  body.appendChild(el("p.pu-help-purpose", { text: guide.purpose }));
  if (guide.steps && guide.steps.length) {
    const steps = el("ol.pu-help-steps");
    for (const step of guide.steps) steps.appendChild(el("li", { text: step }));
    body.appendChild(steps);
  }
  if (guide.tip) body.appendChild(el("p.pu-small.pu-muted", { text: guide.tip }));
  body.appendChild(el("p", {}, el("a.pu-small", { href: "#/help", text: "See the full guide and glossary →" })));
  card.appendChild(body);
  return card;
}

const QUICK_START = [
  "Start on Overview. It shows the live size of the hub and links to every capability.",
  "Open Canonical identity and merge any Possible duplicates, so each real company and customer has one record.",
  "Work through Reconciliation and Drift & alerts — each finding offers a one-click fix.",
  "Build a Data bundle and publish it to an AI assistant or knowledge base when the directory looks clean.",
  "Keep Connector monitor open to spot a connector going down before it causes drift.",
];

function quickStartCard() {
  const card = el("section.pu-card");
  card.appendChild(el("h2", { text: "New here? Start with these five steps" }));
  const list = el("ol.pu-help-steps", { style: { "margin-top": "0.5rem" } });
  for (const step of QUICK_START) list.appendChild(el("li", { text: step }));
  card.appendChild(list);
  card.appendChild(el("p.pu-small.pu-muted", { text: "Integrate-U ships with a realistic demo directory. Re-run or reset it from the Canonical identity screen at any time." }));
  return card;
}

function overviewCard() {
  const card = el("section.pu-card");
  card.appendChild(el("h2", { text: "What each screen is for" }));
  card.appendChild(el("p.pu-small", { text: "Every screen in the hub, and the job it does. Select one to jump straight there, or open the numbered steps below." }));
  const list = el("ul.pu-help-index");
  for (const guide of GUIDES) {
    const li = el("li");
    li.appendChild(el("a.pu-help-index-link", { href: `#/${guide.id}`, text: guide.title }));
    li.appendChild(el("span.pu-small.pu-muted", { text: guide.purpose }));
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

function guideCards() {
  const wrap = el("section.pu-card");
  wrap.appendChild(el("h2", { text: "Step-by-step guides" }));
  wrap.appendChild(el("p.pu-small", { text: "One guide per screen, from the first click to the last. These are the same notes shown in the collapsible panel at the bottom of every screen." }));
  for (const guide of GUIDES) {
    const card = el("details.pu-help");
    const summary = el("summary", {});
    summary.appendChild(el("span.pu-help-title", { text: guide.title }));
    summary.appendChild(el("span.pu-small.pu-muted", { text: guide.purpose }));
    card.appendChild(summary);
    const body = el("div.pu-help-body");
    const steps = el("ol.pu-help-steps");
    for (const step of guide.steps) steps.appendChild(el("li", { text: step }));
    body.appendChild(steps);
    if (guide.tip) body.appendChild(el("p.pu-small.pu-muted", { text: guide.tip }));
    const open = el("p", {}, el("a.pu-small", { href: `#/${guide.id}`, text: "Open this screen →" }));
    body.appendChild(open);
    card.appendChild(body);
    wrap.appendChild(card);
  }
  return wrap;
}

function conceptsCard() {
  const card = el("section.pu-card");
  card.appendChild(el("h2", { text: "Key concepts" }));
  card.appendChild(el("p.pu-small", { text: "The vocabulary the rest of the hub uses. Everything else is built from these ideas." }));
  const dl = el("dl.pu-kv", { style: { "margin-top": "0.6rem" } });
  for (const concept of CONCEPTS) {
    dl.appendChild(el("dt", { text: concept.term }));
    dl.appendChild(el("dd", { text: concept.detail }));
  }
  card.appendChild(dl);
  return card;
}

function aboutCard(hub) {
  const config = getConfig();
  const card = el("section.pu-card");
  card.appendChild(el("h2", { text: `About ${config.appTitle}` }));
  const dl = el("dl.pu-kv", { style: { "margin-top": "0.4rem" } });
  const row = (term, value) => {
    dl.appendChild(el("dt", { text: term }));
    dl.appendChild(el("dd", { text: value }));
  };
  row("Product", `${config.appTitle} — ${config.tagline}`);
  row("Maintainer", config.companyName);
  row("Version", `v${config.version}`);
  row("Generator", window.generatorName ? window.generatorName : config.appId);
  if (hub) row("Storage", `${hub.storageMode() === "kv" ? "Persistent (kv-plugin)" : "In-memory (kv-plugin unavailable)"}`);
  row("Members", "IT-U, CRM-U, PSA-U, RMM-U, and anything else built from template-u");
  card.appendChild(dl);
  card.appendChild(
    el("p.pu-small.pu-muted", {
      style: { "margin-top": "0.6rem" },
      text: "The hub keeps its data locally in your browser. Nothing is uploaded unless you publish a bundle to a target you choose.",
    })
  );
  const actions = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "0.8rem" } });
  actions.appendChild(el("a.pu-btn.secondary", { href: "#/tests", text: "Run validation tests" }));
  if (config.docsUrl) actions.appendChild(el("a.pu-btn.secondary", { href: config.docsUrl, target: "_blank", rel: "noopener", text: "External documentation" }));
  card.appendChild(actions);
  return card;
}

export const helpView = {
  id: "help",
  title: "Help & about",
  group: "Support",
  icon: "doc",
  nav: true,
  render({ routes, hub }) {
    const root = el("div");
    root.appendChild(
      pageHead({
        eyebrow: "Support",
        title: "Help & how to use the hub",
        subtitle: "A short orientation, an instruction guide for every screen, the key concepts, and everything you need to know about this deployment.",
      })
    );
    root.appendChild(quickStartCard());
    root.appendChild(overviewCard(routes || []));
    root.appendChild(guideCards());
    root.appendChild(conceptsCard());
    root.appendChild(aboutCard(hub));
    return root;
  },
};
