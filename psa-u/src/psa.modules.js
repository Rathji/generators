/* ============================================================
   PSA-U — module definitions (Phase 1 · Task 1)
   Registers every station of the application with the shell
   framework (src/erp.js) and declares the hidden documents the
   platform layer owns.

   The fourteen stations mirror the PSA-U roadmap. Those whose
   phase has not been built yet render a roadmap-pending state via
   `planned(...)`, so the navigation, layout, empty/loading/error
   states and responsive behaviour can be verified today (Task 1)
   while the module itself arrives in its own phase.

   Hidden documents:
     tenancy    — the service-provider registry (see psa.tenancy.js)
     versions   — the restorable version history log
     backup     — the published backup bundle
     parties / catalog / chart / taxes / defaults / settings /
     audit / archive — inherited master-data documents, kept
     registered so the store, backup and audit layers resolve them.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;

  ERP.groups = [
    { key: null, label: null },
    { key: "service", label: "Service desk" },
    { key: "delivery", label: "Delivery" },
    { key: "revenue", label: "Revenue" },
    { key: "work", label: "Projects" },
    { key: "growth", label: "Sales" },
    { key: "supply", label: "Supply" },
    { key: "knowledge", label: "Knowledge" },
    { key: "directory", label: "Directory" },
    { key: "insight", label: "Insight & admin" },
  ];

  function controller(name) {
    return function render(ctx) {
      const C = window.ERP[name];
      if (C && typeof C.render === "function") return C.render(ctx);
      ctx.empty();
    };
  }

  function planned(spec) {
    return function render(ctx) {
      ERP.states.empty(ctx.el, spec);
    };
  }

  const M = {
    dashboard: {
      id: "dashboard", label: "Dashboard", group: null, icon: "dashboard", roles: [],
      desc: "Your practice at a glance",
      render: controller("dashboard"),
    },

    servicedesk: {
      id: "servicedesk", label: "Service Desk", group: "service", icon: "ticket", roles: [],
      desc: "Tickets, boards, SLAs & routing",
      render: controller("servicedesk"),
    },

    dispatch: {
      id: "dispatch", label: "Dispatch", group: "delivery", icon: "calendar", roles: [],
      desc: "Dispatch board, appointments & availability",
      render: controller("dispatch"),
    },

    time: {
      id: "time", label: "Time & Expense", group: "delivery", icon: "clock", roles: [],
      desc: "Time capture, timesheets & expenses",
      render: controller("time"),
    },

    agreements: {
      id: "agreements", label: "Agreements", group: "revenue", icon: "agreement", roles: [],
      desc: "Recurring service agreements",
      render: controller("agreements"),
    },

    billing: {
      id: "billing", label: "Billing", group: "revenue", icon: "finance", roles: [],
      desc: "Invoicing, payments & financial reporting",
      render: controller("billing"),
    },

    projects: {
      id: "projects", label: "Projects", group: "work", icon: "projects", roles: [],
      desc: "Project templates, tasks, budgets & milestones",
      render: controller("projects"),
    },

    sales: {
      id: "sales", label: "Sales", group: "growth", icon: "sales", roles: [],
      desc: "Opportunities, quotes & forecasting",
      render: controller("sales"),
    },

    procurement: {
      id: "procurement", label: "Procurement", group: "supply", icon: "purchasing", roles: [],
      desc: "Purchase orders, vendors, receiving & inventory",
      render: controller("procurement"),
    },

    products: {
      id: "products", label: "Products", group: "supply", icon: "inventory", roles: [],
      desc: "Product & service catalog, pricing rules & margin floors",
      render: controller("catalog"),
    },

    knowledge: {
      id: "knowledge", label: "Knowledge", group: "knowledge", icon: "book", roles: [],
      desc: "Articles, assets, monitoring & approvals",
      render: controller("knowledge"),
    },

    companies: {
      id: "companies", label: "Companies", group: "directory", icon: "building", roles: [],
      desc: "Clients, sites & contacts",
      render: controller("companies"),
    },

    portal: {
      id: "portal", label: "Client Portal", group: "directory", icon: "globe", roles: [],
      desc: "Client self-service, invoices & approvals",
      render: controller("portal"),
    },

    reports: {
      id: "reports", label: "Reports", group: "insight", icon: "reports", roles: [],
      desc: "Dashboards, report builder & exports",
      render: controller("reports"),
    },

    admin: {
      id: "admin", label: "Admin", group: "insight", icon: "gear", roles: [],
      desc: "Configuration, people, security & data tools",
      render: controller("admin"),
    },

    /* ── hidden documents (never in nav) ── */
    tenancy: { id: "tenancy", label: "Tenancy", group: null, icon: "building", roles: [], hidden: true, doc: { name: "tenancy", splitByYear: false } },
    versions: { id: "versions", label: "Version history", group: null, icon: "clock", roles: [], hidden: true, doc: { name: "versions", splitByYear: false } },
    backup: { id: "backup", label: "Backup", group: null, icon: "agreement", roles: [], hidden: true, doc: { name: "backup", splitByYear: false } },
    parties: { id: "parties", label: "Parties", group: null, icon: "crm", roles: [], hidden: true, doc: { name: "parties", splitByYear: false } },
    catalog: { id: "catalog", label: "Catalog", group: null, icon: "inventory", roles: [], hidden: true, doc: { name: "catalog", splitByYear: false } },
    chart: { id: "chart", label: "Chart of accounts", group: null, icon: "finance", roles: [], hidden: true, doc: { name: "chart", splitByYear: false } },
    taxes: { id: "taxes", label: "Tax rates", group: null, icon: "finance", roles: [], hidden: true, doc: { name: "taxes", splitByYear: false } },
    defaults: { id: "defaults", label: "Posting defaults", group: null, icon: "finance", roles: [], hidden: true, doc: { name: "defaults", splitByYear: false } },
    settings: { id: "settings", label: "Settings", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "settings", splitByYear: false } },
    audit: { id: "audit", label: "Audit log", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "audit", splitByYear: true } },
    archive: { id: "archive", label: "Archive", group: null, icon: "inventory", roles: [], hidden: true, doc: { name: "archive", splitByYear: true } },
  };

  Object.keys(M).forEach((id) => ERP.registerModule(M[id]));
})();
