/* ============================================================
   PSA-U — dashboard (Phase 1 · Task 1)
   The landing station: the provider's profile, a live count of the
   directory it manages, the state of the document store (sync,
   capacity, version history) and a map of the fourteen stations
   with the build phase each is at.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const D = (ERP.dashboard = {});

  D.render = async function (ctx) {
    const ui = ERP.ui;
    const host = ctx.el;
    ERP.states.loading(host, "Loading dashboard");

    const p = ERP.tenancy ? await ERP.tenancy.provider() : null;
    const [companies, members, teams, taxCount, status, vDocs] = await Promise.all([
      ERP.tenancy.companyIndex().catch(() => []),
      ERP.members ? ERP.members.members() : [],
      ERP.members ? ERP.members.teams() : [],
      p && ERP.taxonomy ? ERP.taxonomy.count(p.id).catch(() => 0) : 0,
      ERP.store.status().catch(() => null),
      ERP.history ? ERP.history.documents().catch(() => []) : [],
    ]);
    const active = companies.filter((c) => c.status === "active").length;
    const sites = companies.reduce((n, c) => n + (c.sites || 0), 0);
    const contacts = companies.reduce((n, c) => n + (c.contacts || 0), 0);
    const conflicts = ERP.store.conflicts ? ERP.store.conflicts().length : 0;
    const tenantDocs = ERP.tenancy ? await ERP.tenancy.tenantDocs().catch(() => []) : [];
    const totalBytes = (status && status.totalBytes) || 0;

    const stations = (ERP.modules || [])
      .filter((m) => !m.hidden)
      .map((m) => {
        const planned = m.plannedPhase ? ui.badge("Phase " + m.plannedPhase, "muted") : ui.badge("built", "success");
        return (
          '<a class="erp-tile" href="#/' + ui.esc(m.id) + '">' +
            '<span class="erp-tile-icon">' + ERP.icon(m.icon || "dashboard", 20) + "</span>" +
            "<span class=\"erp-tile-body\"><b>" + ui.esc(m.label) + "</b><span>" + ui.esc(m.desc || "") + "</span></span>" +
            planned +
          "</a>"
        );
      })
      .join("");

    const storageLine =
      conflicts > 0
        ? ui.alert(conflicts + " document(s) need conflict review in Sync & conflicts.", "warn")
        : ui.alert("All documents are in sync on this device.", "success");

    host.innerHTML =
      ui.pageHead(
        p ? p.name : "PSA-U",
        p ? [p.city, p.region, p.country].filter(Boolean).join(", ") || "Service provider workspace" : "Service provider workspace",
        ui.btn("Manage provider", { primary: true, act: "go-admin", icon: null })
      ) +
      ui.grid([
        ui.statCard({ label: "Clients", value: ui.fmt(companies.length, 0), sub: active + " active", href: "#/companies" }),
        ui.statCard({ label: "Sites", value: ui.fmt(sites, 0), href: "#/companies:sites" }),
        ui.statCard({ label: "Contacts", value: ui.fmt(contacts, 0), href: "#/companies:contacts" }),
        ui.statCard({ label: "Members", value: ui.fmt(members.length, 0), sub: teams.length + " team(s)", href: "#/admin" }),
      ], "erp-grid") +
      ui.grid([
        ui.card("Service provider", p
          ? '<dl class="erp-defs">' +
              def("Name", p.name) + def("Legal name", p.legalName) + def("Email", p.email) +
              def("Phone", p.phone) + def("Currency", p.currency) + def("Timezone", p.timezone) +
              def("Fiscal year starts", monthName(p.fiscalYearStartMonth)) + def("Status", p.status) +
            "</dl>"
          : '<p class="erp-alert">No service provider yet. The tenancy service creates one on first run.</p>', {
          actions: ui.btn("Edit", { small: true, act: "go-admin" }),
        }) +
        ui.card("Document store", storageLine +
          ui.summary([
            { label: "Data stored", value: ERP.store.fmtBytes(totalBytes) },
            { label: "Tenant documents", value: String(tenantDocs.length) },
            { label: "Tracked docs", value: String(vDocs.length) },
            { label: "Config items", value: String(taxCount) },
          ]) +
          '<div class="erp-btn-row">' +
            ui.btn("Sync & conflicts", { small: true, act: "go-sync" }) +
            ui.btn("Data & backups", { small: true, act: "go-data" }) +
          "</div>"),
      ], "cols-2") +
      ui.card("Stations", '<div class="erp-tiles">' + stations + "</div>");

    if (!host.__dashBound) {
      host.__dashBound = true;
      ui.bind(host, "click", "[data-act]", (el, e, act) => {
        if (act === "go-admin") location.hash = "#/admin";
        else if (act === "go-sync" || act === "go-data") location.hash = "#/admin:data";
      });
    }
  };

  function def(label, value) {
    return "<dt>" + ERP.ui.esc(label) + "</dt><dd>" + ERP.ui.esc(value == null || value === "" ? "—" : value) + "</dd>";
  }

  function monthName(n) {
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return names[(Number(n) || 1) - 1] || "January";
  }
})();
