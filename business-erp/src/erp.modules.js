/* ============================================================
   BUSINESS ERP — module definitions
   Registers every ERP module into the shell framework
   (src/erp.js). The 8 visible modules each delegate their render
   to a controller object (ERP.dashboard/crm/sales/purchasing/
   inventory/projects/finance/reports) implemented in the module
   files. Hidden modules carry master-data / system documents
   (parties, catalog, chart, taxes, defaults, settings, audit,
   archive) — they own store documents but never appear in nav.
   ============================================================ */

(function () {
  "use strict";

  function controller(name) {
    return function render(ctx) {
      const C = window.ERP[name];
      if (C && typeof C.render === "function") return C.render(ctx);
      ctx.empty();
    };
  }

  const M = {
    dashboard: {
      id: "dashboard",
      label: "Dashboard",
      group: null,
      icon: "dashboard",
      roles: [],
      desc: "Your business at a glance",
      render: controller("dashboard"),
    },

    crm: {
      id: "crm",
      label: "CRM",
      group: "ops",
      icon: "crm",
      roles: [],
      desc: "Parties, activities & opportunity pipeline",
      doc: { name: "crm", splitByYear: false },
      render: controller("crm"),
    },

    sales: {
      id: "sales",
      label: "Sales",
      group: "ops",
      icon: "sales",
      roles: [],
      desc: "Quotes, orders & invoices",
      doc: { name: "sales", splitByYear: false },
      render: controller("sales"),
    },

    purchasing: {
      id: "purchasing",
      label: "Purchasing",
      group: "ops",
      icon: "purchasing",
      roles: [],
      desc: "Purchase orders, receipts & supplier bills",
      doc: { name: "purchasing", splitByYear: false },
      render: controller("purchasing"),
    },

    inventory: {
      id: "inventory",
      label: "Inventory",
      group: "ops",
      icon: "inventory",
      roles: [],
      desc: "Stock movements & valuation",
      doc: { name: "inventory", splitByYear: true },
      render: controller("inventory"),
    },

    projects: {
      id: "projects",
      label: "Projects",
      group: "ops",
      icon: "projects",
      roles: [],
      desc: "Projects, tasks & timesheets",
      doc: { name: "projects", splitByYear: false },
      render: controller("projects"),
    },

    finance: {
      id: "finance",
      label: "Finance",
      group: "fin",
      icon: "finance",
      roles: ["owner", "manager"],
      desc: "Ledger, receivables, payables & period close",
      doc: { name: "finance", splitByYear: true },
      render: controller("finance"),
    },

    reports: {
      id: "reports",
      label: "Reports",
      group: "fin",
      icon: "reports",
      roles: ["owner", "manager"],
      desc: "Saved reports, exports & data utilities",
      doc: { name: "reports", splitByYear: false },
      render: controller("reports"),
    },

    /* ── hidden master-data / system documents (never in nav) ── */
    parties: { id: "parties", label: "Parties", group: null, icon: "crm", roles: [], hidden: true, doc: { name: "parties", splitByYear: false } },
    catalog: { id: "catalog", label: "Catalog", group: null, icon: "inventory", roles: [], hidden: true, doc: { name: "catalog", splitByYear: false } },
    chart: { id: "chart", label: "Chart of accounts", group: null, icon: "finance", roles: [], hidden: true, doc: { name: "chart", splitByYear: false } },
    taxes: { id: "taxes", label: "Tax rates", group: null, icon: "finance", roles: [], hidden: true, doc: { name: "taxes", splitByYear: false } },
    defaults: { id: "defaults", label: "Posting defaults", group: null, icon: "finance", roles: [], hidden: true, doc: { name: "defaults", splitByYear: false } },
    settings: { id: "settings", label: "Settings", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "settings", splitByYear: false } },
    audit: { id: "audit", label: "Audit log", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "audit", splitByYear: true } },
    archive: { id: "archive", label: "Archive", group: null, icon: "inventory", roles: [], hidden: true, doc: { name: "archive", splitByYear: true } },
  };

  Object.keys(M).forEach((id) => window.ERP.registerModule(M[id]));
})();
