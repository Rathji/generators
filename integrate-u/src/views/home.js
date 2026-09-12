import { el } from "../framework/dom.js";
import { getConfig } from "../framework/config.js";

const CAPABILITIES = [
  { title: "Canonical identity", body: "Every company and customer resolves to one shared identifier, so a client means the same thing in every Project U tool.", route: "identity" },
  { title: "Integration registry", body: "Field-level ownership, authoritative sources and sync directions declared once per connector.", route: "registry" },
  { title: "Permission mapping", body: "Connector-specific roles resolve to one canonical permission model across the family.", route: "permissions" },
  { title: "Event bus", body: "A versioned envelope bus with validated publish/subscribe so tools react to each other without point-to-point glue.", route: "events" },
  { title: "Entity linking & sync", body: "Link a device in RMM-U to a ticket in PSA-U, reference data instead of copying it, and detect drift.", route: "links" },
  { title: "Sync, integrity & alerting", body: "Idempotent sync jobs, ownership-driven conflict resolution, drift detection and an administrator alert inbox.", route: "sync" },
  { title: "Data bundles & audit", body: "Publish linked snapshots as JSON or CSV for AI assistants and knowledge bases, and trace every cross-tool movement on a hash-chained audit ledger.", route: "bundles" },
  { title: "Connector monitoring", body: "A live health dashboard for every Project U connector, with latency, error and heartbeat tracking.", route: "monitor" },
];

const FAMILY = [
  { code: "IT-U", role: "IT documentation & asset inventory" },
  { code: "CRM-U", role: "Customer relationship management" },
  { code: "PSA-U", role: "Professional services & ticketing" },
  { code: "RMM-U", role: "Remote monitoring & management" },
];

const GETTING_STARTED = [
  "Open Canonical identity and merge any possible duplicates so each real company has one record.",
  "Work through Reconciliation and Drift & alerts — every finding offers a one-click fix.",
  "Publish a Data bundle when the directory is clean, and watch Connector monitor for outages.",
];

export const homeView = {
  id: "home",
  title: "Overview",
  group: "Hub",
  icon: "home",
  nav: true,
  render({ router, hub }) {
    const config = getConfig();
    const root = el("div");

    const hero = el("section.pu-hero");
    hero.appendChild(el("div.pu-eyebrow", { text: config.companyName + " integration hub" }));
    hero.appendChild(el("h1", { text: config.appTitle }));
    hero.appendChild(el("p.pu-tagline", { text: `${config.tagline}. ${config.appTitle} is the connective tissue between the Project U tools — one identity, one registry, and one trustworthy history of how customer data moves.` }));
    hero.appendChild(
      el(
        "div",
        { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "1rem" } },
        el("span.pu-chip", { text: `v${config.version}` }),
        el("span.pu-chip.ok", { text: "All 8 phases complete" }),
        el("span.pu-chip", { text: `${FAMILY.length} member tools` })
      )
    );
    hero.appendChild(
      el(
        "div",
        { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "1.1rem" } },
        el("button.pu-btn", { type: "button", text: "Open the directory", on: { click: () => router.go("identity") } }),
        el("a.pu-btn.secondary", { href: "#/help", text: "Read the guide" }),
        el("a.pu-btn.secondary", { href: "#/tests", text: "Run validation tests" })
      )
    );
    root.appendChild(hero);

    if (hub) {
      const s = hub.identity.stats();
      const r = hub.registry.stats();
      const p = hub.permissions.stats();
      const b = hub.bus.stats();
      const grid = el("div.pu-grid.cols-4", { style: { "margin-top": "1rem" } });
      const stat = (label, value, hint) => {
        const card = el("article.pu-card.pu-stat");
        card.appendChild(el("span.pu-stat-label", { text: label }));
        card.appendChild(el("span.pu-stat-value", { text: String(value) }));
        if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
        return card;
      };
      grid.appendChild(stat("Directory records", s.total, `${hub.linker.summary().edges} links · ${s.refs} references`));
      grid.appendChild(stat("Events logged", hub.log.size(), `${b.published} published`));
      grid.appendChild(stat("Subscribers", hub.subscriptions.stats().subscriptions, `${r.connectorCount} connectors`));
      grid.appendChild(stat("Canonical roles", p.roleCount, `${p.mappingCount} tool role mappings`));
      root.appendChild(grid);
    }

    const grid = el("div.pu-grid.cols-3", { style: { "margin-top": "1rem" } });
    for (const cap of CAPABILITIES) {
      const card = el("article.pu-card");
      card.appendChild(el("h3", { text: cap.title }));
      card.appendChild(el("p.pu-small", { text: cap.body }));
      if (cap.route) card.appendChild(el("a.pu-small", { href: `#/${cap.route}`, text: "Open →" }));
      else card.appendChild(el("span.pu-small.pu-muted", { text: "Planned" }));
      grid.appendChild(card);
    }
    root.appendChild(grid);

    const familyCard = el("section.pu-card", { style: { "margin-top": "1rem" } });
    familyCard.appendChild(el("h2", { text: "The Project U family" }));
    familyCard.appendChild(el("p.pu-small", { text: "Members are built from the shared template-u framework and plug into this hub through the integration registry." }));
    const familyList = el("ul.pu-list", { style: { "margin-top": "0.6rem" } });
    for (const member of FAMILY) {
      const li = el("li");
      li.appendChild(el("span.pu-chip", { text: member.code }));
      li.appendChild(el("span.pu-small", { text: member.role }));
      familyList.appendChild(li);
    }
    familyCard.appendChild(familyList);
    root.appendChild(familyCard);

    const startCard = el("section.pu-card", { style: { "margin-top": "1rem" } });
    startCard.appendChild(el("h2", { text: "Getting started" }));
    startCard.appendChild(el("p.pu-small", { text: "Integrate-U ships with a realistic demo directory, so you can try every screen immediately. A good first pass:" }));
    const startList = el("ol.pu-help-steps", { style: { "margin-top": "0.5rem" } });
    for (const step of GETTING_STARTED) startList.appendChild(el("li", { text: step }));
    startCard.appendChild(startList);
    startCard.appendChild(el("p", { style: { "margin-top": "0.6rem" } }, el("a.pu-small", { href: "#/help", text: "See the full guide, per-screen instructions and glossary →" })));
    root.appendChild(startCard);

    return root;
  },
};
