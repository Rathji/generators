/* ============================================================
   PSA-U — Knowledge station (Phase 10 · Tasks 46–48 & 50)

   The operations console for everything a practice knows and
   everything it owns. It composes five tabs, each backed by a
   module that can also be driven programmatically:

     Articles      → ERP.kb            knowledge base (Task 46)
     Categories    → ERP.kb            article filing
     Assets        → ERP.configurations configuration records (Task 47)
     Monitoring    → ERP.rmm           RMM ingestion & alerts (Task 48)
     Approvals     → ERP.approvals     approval requests (Task 50)

   The first visit idempotently seeds a starter set (a few
   categories and articles, monitoring switches and rules, approval
   settings) so the tabs are usable immediately. The active tab
   hangs off the station element so it survives a tab's re-render.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const K = (ERP.knowledge = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("knowledge requires the tenancy service");
    return ERP.tenancy;
  }

  function blankState() { return { tab: "articles" }; }
  let currentHost = null;

  async function renderTab(id) {
    const host = currentHost;
    if (!host) return;
    const old = host.querySelector('[data-panel="' + id + '"]');
    if (!old) return;
    const panel = document.createElement("div");
    panel.className = old.className;
    panel.setAttribute("data-panel", id);
    panel.__host = host;
    old.replaceWith(panel);
    ERP.states.loading(panel, "Loading");
    try {
      const pid = await ten().providerId();
      if (id === "articles") await ERP.kb.renderArticles(panel, pid, () => renderTab("articles"));
      else if (id === "categories") await ERP.kb.renderCategories(panel, pid, () => renderTab("categories"));
      else if (id === "assets") await ERP.configurations.renderAssets(panel, pid, () => renderTab("assets"));
      else if (id === "monitoring") await ERP.rmm.renderMonitoring(panel, pid, () => renderTab("monitoring"));
      else if (id === "approvals") await ERP.approvals.renderApprovals(panel, pid, () => renderTab("approvals"));
    } catch (e) {
      console.error("knowledge tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }

  K.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "book", title: "Knowledge & configuration", phase: "Phase 10 · Knowledge, configuration & portal",
        message: "Create a service provider first — then keep articles, assets and monitoring here.",
      });
      return;
    }
    await Promise.all([
      ERP.kb.ensure(pid),
      ERP.rmm.ensure(pid),
      ERP.approvals.ensure(pid),
    ]);
    host.__knowledge = host.__knowledge || blankState();
    currentHost = host;
    const pending = await ERP.approvals.pending(pid);
    const defs = [
      { id: "articles", label: "Articles" },
      { id: "categories", label: "Categories" },
      { id: "assets", label: "Assets & configurations" },
      { id: "monitoring", label: "Monitoring" },
      { id: "approvals", label: "Approvals", badge: pending.length ? String(pending.length) : "" },
    ];
    const active = defs.find((d) => d.id === host.__knowledge.tab) ? host.__knowledge.tab : "articles";
    host.innerHTML = ui.pageHead("Knowledge & assets", "Articles, client configuration records and monitoring.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__knowledge.tab = b.getAttribute("data-tab");
      await renderTab(host.__knowledge.tab);
    }));
    await renderTab(active);
  };
})();
