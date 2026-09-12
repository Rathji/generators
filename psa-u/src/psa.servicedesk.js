/* ============================================================
   PSA-U — Service Desk station (Phase 2)
   The service-desk workspace: one station that hosts the tabs the
   phase delivers —

     Tickets                 the ticket register, board and detail
     Boards & routing        per-board defaults + inbound routing
     SLAs & business hours   policies, calendars and the breach monitor
     Templates & recurring   prefilled tickets and scheduled runs
     Automation              the event-driven rules engine
     Notifications           rules, templates, preferences and activity

   Each tab renders a module written in its own file; this controller
   only composes them, seeds sensible defaults on first visit and
   keeps the tab the user is on when a sub-module re-renders.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const S = (ERP.servicedesk = {});

  /* ─────────────────────────── boards & routing ─────────────────────────── */

  async function openBoardModal(pid, board, refresh) {
    if (!ERP.security.enforce("boards.edit")) return;
    const [statuses, priorities, teams] = await Promise.all([
      ERP.tickets.statusMeta(pid),
      ERP.taxonomy.optionList(pid, "priority"),
      ERP.members.teams(),
    ]);
    const b = board || ERP.tickets.newBoardConfig();
    const flows = b.statuses && b.statuses.length ? b.statuses : statuses.map((s) => s.code);
    const prio = b.priorities && b.priorities.length ? b.priorities : priorities.map((p) => p.value);
    const fields =
      (b.code ? '<div class="erp-defs"><dt>Board</dt><dd>' + ui.esc(b.label || b.code) + "</dd></div>" : "") +
      ui.select("defaultStatus", "Default status for new tickets", statuses.map((s) => ({ value: s.code, label: s.label })), b.defaultStatus) +
      '<div class="erp-form-row">' +
        ui.select("teamId", "Default team", [{ value: "", label: "— none —" }].concat(teams.map((t) => ({ value: t.id, label: t.name }))), b.teamId) +
        ui.select("autoAssign", "Auto-assign", [{ value: "none", label: "Off" }, { value: "round-robin", label: "Round robin" }, { value: "load", label: "Least loaded" }], b.autoAssign) +
      "</div>" +
      '<div class="field"><label>Status flow shown on the board</label><div class="radio-group">' +
        statuses.map((s) => '<label><input type="checkbox" data-bstatus value="' + ui.esc(s.code) + '"' + (flows.map(String).indexOf(String(s.code)) >= 0 ? " checked" : "") + "> " + ui.esc(s.label) + "</label>").join("") +
      "</div></div>" +
      '<div class="field"><label>Priorities offered on this board</label><div class="radio-group">' +
        priorities.map((p) => '<label><input type="checkbox" data-bprio value="' + ui.esc(p.value) + '"' + (prio.map(String).indexOf(String(p.value)) >= 0 ? " checked" : "") + "> " + ui.esc(p.label) + "</label>").join("") +
      "</div></div>" +
      ui.check("active", "Active", b.active !== false);
    const modal = ui.modal({
      title: "Board defaults · " + (b.label || b.code),
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "bd-cancel" }) + " " + ui.btn("Save", { small: true, primary: true, act: "bd-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=bd-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=bd-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["defaultStatus", "teamId", "autoAssign", "active"]);
      v.statuses = Array.from(form.querySelectorAll("[data-bstatus]:checked")).map((i) => i.value);
      v.priorities = Array.from(form.querySelectorAll("[data-bprio]:checked")).map((i) => i.value);
      btn.disabled = true;
      const res = await ERP.tickets.saveBoardConfig(pid, Object.assign({}, b, v, { teamId: v.teamId === "" ? null : v.teamId }));
      ui.closeModal();
      ERP.toast(res.error ? "Could not save." : "Board saved.", res.error ? "error" : "success");
      refresh();
    };
  }

  async function renderBoards(panel, pid, refresh) {
    const [boards, routes, members, teams, statuses] = await Promise.all([
      ERP.tickets.boards(pid), ERP.workflow ? ERP.workflow.routes(pid) : [], ERP.members.members(), ERP.members.teams(), ERP.tickets.statusMeta(pid),
    ]);
    const nameOf = (id, list, fallback) => { const x = (list || []).find((m) => String(m.id) === String(id)); return x ? x.name : fallback; };
    const bRows = boards.map((b) => ({
      name: '<span class="erp-dot" style="background:' + ui.esc(b.color || "#0a58ca") + '"></span> <b>' + ui.esc(b.label || b.code) + "</b>",
      dflt: ui.esc(ERP.tickets.statusLabel(statuses, b.defaultStatus)),
      team: ui.esc(b.teamId != null && b.teamId !== "" ? nameOf(b.teamId, teams, "—") : "—"),
      auto: ui.badge(b.autoAssign && b.autoAssign !== "none" ? b.autoAssign : "off", b.autoAssign && b.autoAssign !== "none" ? "info" : "muted"),
      flow: ui.esc((b.statuses && b.statuses.length ? b.statuses : []).join(" → ") || "all statuses"),
      actions: ERP.security.can("boards.edit") ? ui.btn("Edit", { small: true, act: "bd-edit", arg: b.code }) : "",
    }));
    const rRows = routes.map((r) => ({
      order: ui.esc(r.order),
      name: "<b>" + ui.esc(r.name) + "</b>",
      when: ui.esc(ERP.workflow.conditionsText(r.conditions)),
      board: ui.esc(r.board || "—"),
      owner: ui.esc(r.ownerId != null && r.ownerId !== "" ? nameOf(r.ownerId, members, "—") : "—"),
      team: ui.esc(r.teamId != null && r.teamId !== "" ? nameOf(r.teamId, teams, "—") : "—"),
    }));
    panel.innerHTML =
      ui.card("Service boards", '<p class="erp-sub">Boards are defined in Admin → Configuration; here you set each board\'s default status, team, auto-assignment and the status flow the board view uses.</p>' +
        ui.table([
          { key: "name", label: "Board" },
          { key: "dflt", label: "Default status" },
          { key: "team", label: "Default team" },
          { key: "auto", label: "Auto-assign" },
          { key: "flow", label: "Board flow" },
          { key: "actions", label: "", align: "right" },
        ], bRows, { emptyText: "No boards defined yet — add them in Admin → Configuration." })) +
      ui.card("Inbound routing", '<p class="erp-sub">The first matching rule sets a new ticket\'s board, priority, owner and team. Edit routing under Service Desk → Automation → Routing.</p>' +
        ui.table([
          { key: "order", label: "Order" },
          { key: "name", label: "Rule" },
          { key: "when", label: "When" },
          { key: "board", label: "Board" },
          { key: "owner", label: "Owner" },
          { key: "team", label: "Team" },
        ], rRows, { emptyText: "No routing rules yet." }));
    ui.bind(panel, "click", "[data-act=bd-edit]", (el, e, act, arg) => {
      openBoardModal(pid, boards.find((b) => String(b.code) === String(arg)), refresh);
    });
  }
  /* ─────────────────────────── controller ─────────────────────────── */

  S.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ERP.tenancy.providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "ticket", title: "Service desk", phase: "Phase 2 · Service desk",
        message: "Create a service provider and a client company first — then log tickets here.",
      });
      return;
    }

    /* seed sensible defaults the first time the station is opened */
    try { await ERP.tickets.ensureSeed(pid); } catch (e) {}
    try { if (ERP.sla) await ERP.sla.ensureSeed(pid); } catch (e) {}
    try { if (ERP.notify) await ERP.notify.ensureSeed(pid); } catch (e) {}
    try { if (ERP.workflow) await ERP.workflow.ensureSeed(pid); } catch (e) {}
    try { await ERP.templates.ensureSeed(pid); } catch (e) {}

    const defs = [
      { id: "tickets", label: "Tickets" },
      { id: "boards", label: "Boards & routing" },
      { id: "sla", label: "SLAs & business hours" },
      { id: "templates", label: "Templates & recurring" },
      { id: "automation", label: "Automation" },
      { id: "notifications", label: "Notifications" },
    ];
    const active = defs.find((d) => d.id === host.__tab) ? host.__tab : "tickets";

    const renderTab = async (id) => {
      const old = host.querySelector('[data-panel="' + id + '"]');
      if (!old) return;
      const panel = document.createElement("div");
      panel.className = old.className;
      panel.setAttribute("data-panel", id);
      panel.setAttribute("id", "sdTabPanel");
      old.replaceWith(panel);
      ERP.states.loading(panel, "Loading " + (defs.find((d) => d.id === id) || {}).label);
      try {
        if (id === "tickets") await ERP.tickets.renderInto(panel, () => renderTab(id));
        else if (id === "boards") await renderBoards(panel, pid, () => renderTab(id));
        else if (id === "sla") await ERP.sla.renderConfig(panel, () => renderTab(id));
        else if (id === "templates") await ERP.templates.renderInto(panel, () => renderTab(id), "templates");
        else if (id === "automation") await ERP.workflow.renderConfig(panel, () => renderTab(id));
        else if (id === "notifications") await ERP.notify.renderConfig(panel, () => renderTab(id));
      } catch (e) {
        console.error("service desk tab failed", id, e);
        ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
      }
    };

    host.innerHTML = ui.pageHead("Service desk", "Tickets, boards, SLAs, routing and automation across every client.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__tab = b.getAttribute("data-tab");
      await renderTab(host.__tab);
    }));
    await renderTab(active);
  };
})();
