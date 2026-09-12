(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const O = window.CRM_TICKETS;
  const D = window.CRM_DOMAIN;
  if (!T || !BS || !R || !O || !D) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "services", "sites", "assets", "tickets", "emails", "segments", "rules", "bus", "reports"];

  function mockEnv(opts) {
    opts = opts || {};
    const kvStore = new Map();
    const files = new Map();
    const kv = {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
    const editable = {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.text = text;
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true, unchanged: false, superseded: false };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, created: false, unchanged: true, superseded: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false, unchanged: false, superseded: false };
      },
      files
    };
    const ns = "tk" + BS.randHex(6);
    const store = BS.create(Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts));
    return { store };
  }

  T.register("tickets: validate + apply build a journaled ticket with an SLA clock", () => {
    const v = O.validate({
      subject: "  Fibre circuit down — Grindelwald  ",
      companyId: "c-1",
      serviceId: "svc-1",
      priority: "urgent",
      category: "incident",
      source: "monitoring",
      assignee: " Dana ",
      openedAt: "2025-03-01T09:00",
      description: "  No light on the ONT.  ",
      tags: "outage, fibre, outage"
    });
    if (!v.ok) return { pass: false, detail: JSON.stringify(v.errors) };
    const rec = O.applyForm(null, v.values);
    const checks = [];
    if (rec.subject !== "Fibre circuit down — Grindelwald") checks.push("subject not trimmed");
    if (rec.id !== undefined && !/^tk-[0-9a-f]{6}$/.test(rec.id)) checks.push("id format wrong: " + rec.id);
    if (rec.companyId !== "c-1" || rec.serviceId !== "svc-1") checks.push("references lost");
    if (rec.priority !== "urgent") checks.push("priority lost");
    if (rec.status !== "new") checks.push("new ticket should start as New: " + rec.status);
    if (rec.assignee !== "Dana") checks.push("assignee not trimmed");
    if (rec.description !== "No light on the ONT.") checks.push("description not trimmed");
    if (rec.tags.length !== 2) checks.push("tags not deduped");
    if (!Array.isArray(rec.journal) || rec.journal.length !== 1 || rec.journal[0].kind !== "created") checks.push("journal not seeded");
    if (!rec.openedAt) checks.push("openedAt missing");
    if (!rec.createdAt || !rec.updatedAt) checks.push("timestamps missing");
    const sla = D.ticketSla(rec);
    if (sla.responseTargetMin !== 15 || sla.resolveTargetMin !== 240) checks.push("urgent SLA targets wrong: " + JSON.stringify(sla));
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.id + " · P1 SLA " + sla.responseTargetMin + "m/" + sla.resolveTargetMin + "m" };
  });

  T.register("tickets: validation rejects blank subject, missing account and bad dates", () => {
    const a = O.validate({ subject: "  ", companyId: "c-1" });
    const b = O.validate({ subject: "Down", companyId: "" });
    const c = O.validate({ subject: "Down", companyId: "c-1", openedAt: "not-a-date" });
    const d = O.validate({ subject: "Down", companyId: "c-1", dueAt: "nope" });
    const e = O.validate({ subject: "Down", companyId: "c-1", priority: "bogus", category: "bogus", status: "bogus" });
    if (!a.errors.subject) return { pass: false, detail: "blank subject accepted" };
    if (!b.errors.companyId) return { pass: false, detail: "missing account accepted" };
    if (!c.errors.openedAt) return { pass: false, detail: "bad openedAt accepted" };
    if (!d.errors.dueAt) return { pass: false, detail: "bad dueAt accepted" };
    if (!e.ok) return { pass: false, detail: "valid record rejected" };
    if (e.values.priority !== "medium" || e.values.category !== "incident" || e.values.status !== "new") return { pass: false, detail: "unknown enum not defaulted" };
    return { pass: true, detail: "subject/account/date validation + enum defaults work" };
  });

  T.register("tickets: SLA derives response/resolve deadlines and overdue state from priority", () => {
    const base = { priority: "high", openedAt: "2025-01-01T00:00:00.000Z", status: "open" };
    const sla = D.ticketSla(base);
    if (sla.responseDueAt !== "2025-01-01T01:00:00.000Z") return { pass: false, detail: "response due wrong: " + sla.responseDueAt };
    if (sla.resolveDueAt !== "2025-01-01T08:00:00.000Z") return { pass: false, detail: "resolve due wrong: " + sla.resolveDueAt };
    const respOver = D.ticketSlaState(base, Date.parse("2025-01-01T01:30:00.000Z"));
    if (respOver.state !== "response-overdue") return { pass: false, detail: "expected response-overdue, got " + respOver.state };
    const dueSoon = D.ticketSlaState(Object.assign({}, base, { firstResponseAt: "2025-01-01T00:30:00.000Z" }), Date.parse("2025-01-01T07:30:00.000Z"));
    if (dueSoon.state !== "due-soon") return { pass: false, detail: "expected due-soon, got " + dueSoon.state };
    const over = D.ticketSlaState(Object.assign({}, base, { firstResponseAt: "2025-01-01T00:30:00.000Z" }), Date.parse("2025-01-01T09:00:00.000Z"));
    if (over.state !== "overdue") return { pass: false, detail: "expected overdue, got " + over.state };
    const met = D.ticketSlaState({ priority: "high", openedAt: "2025-01-01T00:00:00.000Z", status: "resolved", resolvedAt: "2025-01-01T06:00:00.000Z" });
    if (met.resolveMet !== true || met.state !== "closed") return { pass: false, detail: "expected SLA met/closed, got " + JSON.stringify(met) };
    const breached = D.ticketSlaState({ priority: "high", openedAt: "2025-01-01T00:00:00.000Z", status: "resolved", resolvedAt: "2025-01-01T20:00:00.000Z" });
    if (breached.resolveMet !== false || breached.state !== "breached") return { pass: false, detail: "expected breached, got " + JSON.stringify(breached) };
    const manual = D.ticketSla({ priority: "low", openedAt: "2025-01-01T00:00:00.000Z", dueAt: "2025-01-02T00:00:00.000Z" });
    if (manual.resolveDueAt !== "2025-01-02T00:00:00.000Z") return { pass: false, detail: "explicit dueAt override ignored" };
    return { pass: true, detail: "SLA deadlines + response/due-soon/overdue/met/breached states correct" };
  });

  T.register("tickets: status, priority, assignment and comments journal their changes", () => {
    const rec = { id: "tk-1", status: "new", priority: "high", openedAt: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z", journal: [] };
    const checks = [];
    const s1 = O.setStatus(rec, "open");
    if (!s1.ok || rec.status !== "open") checks.push("status not changed");
    if (!rec.firstResponseAt) checks.push("first response not stamped on status change");
    const c1 = O.addComment(rec, "  Looking into it.  ");
    if (!c1.ok || rec.journal[rec.journal.length - 1].text !== "Looking into it.") checks.push("comment not trimmed/journalled");
    const p1 = O.setPriority(rec, "urgent");
    if (!p1.ok || rec.priority !== "urgent") checks.push("priority not changed");
    const a1 = O.assign(rec, " Dana ");
    if (!a1.ok || rec.assignee !== "Dana") checks.push("assignee not set/trimmed");
    const empty = O.addComment(rec, "   ");
    if (empty.ok) checks.push("empty comment accepted");
    const noop = O.setStatus(rec, "open");
    if (noop.code !== "noop") checks.push("same-status change not a noop");
    const r1 = O.setStatus(rec, "resolved");
    if (!r1.ok || !rec.resolvedAt) checks.push("resolvedAt not stamped");
    O.setStatus(rec, "closed");
    if (!rec.closedAt) checks.push("closedAt not stamped");
    O.setStatus(rec, "open");
    if (rec.resolvedAt || rec.closedAt) checks.push("reopen did not clear resolved/closed dates");
    const kinds = rec.journal.map(j => j.kind);
    ["status", "comment", "priority", "assign"].forEach(k => { if (kinds.indexOf(k) === -1) checks.push("missing journal kind " + k); });
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: rec.journal.length + " journal entries across " + new Set(kinds).size + " kinds" };
  });

  T.register("tickets: summarize counts open, overdue, unassigned and closed correctly", () => {
    const now = Date.parse("2025-01-02T00:00:00.000Z");
    const recs = [
      { id: "t1", status: "open", priority: "urgent", openedAt: "2025-01-01T00:00:00.000Z" },
      { id: "t2", status: "pending", priority: "low", assignee: "Dana", openedAt: "2025-01-01T00:00:00.000Z", firstResponseAt: "2025-01-01T00:30:00.000Z" },
      { id: "t3", status: "resolved", priority: "medium", openedAt: "2025-01-01T00:00:00.000Z", resolvedAt: "2025-01-01T02:00:00.000Z" },
      { id: "t4", status: "closed", priority: "medium", openedAt: "2024-12-01T00:00:00.000Z", resolvedAt: "2024-12-01T02:00:00.000Z", closedAt: "2024-12-02T00:00:00.000Z" }
    ];
    const s = D.summarizeTickets(recs, now);
    const checks = [];
    if (s.count !== 4) checks.push("count " + s.count);
    if (s.open !== 2) checks.push("open " + s.open);
    if (s.resolved !== 1 || s.closed !== 1) checks.push("resolved/closed " + s.resolved + "/" + s.closed);
    if (s.unassigned !== 1) checks.push("unassigned " + s.unassigned);
    if (s.overdue !== 1) checks.push("overdue " + s.overdue);
    if (s.byPriority.urgent !== 1) checks.push("byPriority.urgent " + s.byPriority.urgent);
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "open " + s.open + " · unassigned " + s.unassigned + " · overdue " + s.overdue };
  });

  T.register("tickets: deletion is refused while a record references the ticket (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const v = O.validate({ subject: "Fibre down", companyId: "c-1", priority: "urgent", openedAt: "2025-01-01T00:00:00.000Z" });
    if (!v.ok) return { pass: false, detail: "ticket validation failed" };
    const tkt = O.applyForm(null, v.values);
    const r0 = await s.saveChecked("tickets", { records: [tkt] }, { expectedBase: 0 });
    if (!r0.ok) return { pass: false, detail: "ticket create failed: " + JSON.stringify(r0) };
    const ref = { id: "a-1", type: "note", subject: "Escalated", ticketId: tkt.id, at: new Date().toISOString() };
    const r1 = await s.saveChecked("activities", { records: [ref] }, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: "activity create failed: " + JSON.stringify(r1) };
    const guarded = await O.canDelete(s, tkt.id);
    if (guarded.allowed || guarded.refs.length !== 1 || guarded.refs[0].module !== "activities") {
      return { pass: false, detail: "delete should be blocked by the activity: " + JSON.stringify(guarded) };
    }
    const aDoc = await s.loadDoc("activities");
    const rm = R.removeRecord(JSON.parse(JSON.stringify(aDoc.content)), ref.id);
    await s.saveChecked("activities", rm.content, { expectedBase: aDoc.revision });
    const open = await O.canDelete(s, tkt.id);
    if (!open.allowed) return { pass: false, detail: "delete still blocked after unlink" };
    return { pass: true, detail: "delete blocked by activity reference; open after unlink" };
  });

  T.register("tickets: the service-desk list and the new-ticket form render", async () => {
    window.CRM.go("tickets");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const wrap = view.querySelector(".tkt-view");
    if (!wrap) return { pass: false, detail: "no tickets view rendered" };
    const rows = wrap.querySelectorAll("[data-tktid]").length;
    const empty = wrap.querySelector(".rec-empty");
    if (!rows && !empty) return { pass: false, detail: "list shows neither rows nor empty state" };
    if (!wrap.querySelector("[data-tkt-q]") || !wrap.querySelector("[data-tkt-add]")) return { pass: false, detail: "toolbar missing search or add" };
    window.CRM.go("tickets", ["new"]);
    await window.CRM.ready();
    const view2 = document.getElementById("viewRoot");
    if (view2.dataset.state !== "ready") return { pass: false, detail: "form state=" + view2.dataset.state };
    const form = view2.querySelector("[data-tkt-form]");
    if (!form) return { pass: false, detail: "no ticket form rendered" };
    if (!form.querySelector('[data-f="subject"]') || !form.querySelector('[data-f="companyId"]') || !form.querySelector('[data-f="priority"]')) return { pass: false, detail: "form fields incomplete" };
    if (!form.querySelector("[data-tkt-save]")) return { pass: false, detail: "no save button" };
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: (rows ? rows + " rows" : "empty state") + "; new-ticket form rendered" };
  });
})();
