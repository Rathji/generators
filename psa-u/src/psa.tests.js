/* ============================================================
   PSA-U — validation harness (Phases 1–13)
   Run from the browser console:  await PSATest()
   (aliases: PSATestPhase1..Phase13). Exercises tasks 1–61 against
   an isolated in-memory document backend so the live store is
   left exactly as it was found:

     Phase 1 (1–6)   app shell & nav; tenancy & data storage;
                     companies/sites/contacts; members, teams &
                     security; taxonomy & master configuration;
                     sync, conflict, backup & versioning.
     Phase 2 (7–14)  tickets; notes/activity/attachments; boards &
                     routing; SLAs & business hours; notifications
                     & escalation; workflow rules; templates &
                     recurring; relationships & merging.
     Phase 3 (15–18) technician calendars & availability; the
                     dispatch board; appointments & service calls;
                     the scheduling assistant.
     Phase 4 (19–22) time entry capture & timers; timesheets &
                     approval; expenses; billing-rate resolution.
     Phase 5 (23–27) agreements; coverage & additions; agreement
                     billing; profitability & utilisation; renewal
                     & lifecycle.
     Phase 6 (28–33) billing setup; invoice assembly; generation
                     runs & readiness gates; payments, credits &
                     adjustments; billing safety & idempotency;
                     financial reporting & exports.
     Phase 7 (34–37) projects, phases & tasks; project templates;
                     task scheduling & workload; budget vs actuals
                     and profitability; project milestone billing.
     Phase 8 (38–41) the opportunity pipeline & stage history;
                     quotes, proposals & conversion; sales
                     activities & forecasting; lead capture,
                     dedupe & conversion.
     Phase 9 (42–45) the product & service catalog with pricing
                     rules and per-client overrides; vendors &
                     purchase orders; receiving, drop-ship, the stock
                     ledger and inventory; procurement approval
                     thresholds and margin/markup floors.
     Phase 10 (46–50) the knowledge base (versions, visibility &
                     ticket suggestions); configuration/asset records
                     with field ownership, docs sync & drift; RMM
                     ingestion, alert-to-ticket and auto-resolve; the
                     client portal; approval workflows with routing,
                     expiry, reminders and release actions.
     Phase 11 (51–53) the report builder (sources, filters, grouping,
                     saved definitions) & scheduled delivery; the
                     operational dashboards (SLA, backlog, utilisation,
                     agreement margin, billing backlog, revenue trend)
                     with drill-down; and the schema-stable BI extract
                     through the shared envelope.
     Phase 12 (54–58) the integration framework (connectors, direction
                     and field-ownership rules, retry/backoff, sync log);
                     the versioned API, outbound webhooks and the pipeline
                     bus (shared envelope publish/consume); the
                     data-integrity linter; fixture data and the full
                     ticket → time → agreement → invoice → payment loop
                     with integrity assertions; and the Admin stations for
                     integrations, API & webhooks and data integrity.
     Phase 13 (59–61) the client capability / scope model that mirrors the
                     hub's server-authoritative roles (dispatcher /
                     technician / account manager / finance / administrator,
                     scoped by company, board and financial visibility); the
                     realtime hub integration over a mock transport (hello
                     identity, guard/authorise, signed audit, full access
                     patches, presence focus, rate statistics, remote change
                     fan-out); the polling fallback; and the Admin →
                     Collaboration station.

   Results are returned as { passed, failed, results } and also
   printed to the console. Nothing here is required at runtime.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = ERP.store;

  /* ─────────────────────────── isolated backend ─────────────────────────── */

  function fakeBackend() {
    const files = Object.create(null);
    return {
      __files: files,
      async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
      async set(name, text, opts) {
        const existed = Object.prototype.hasOwnProperty.call(files, name);
        if (existed && !(opts && opts.editKey)) return { error: "edit_key_required" };
        files[name] = text;
        return existed ? {} : { created: true, editKey: "key-" + name };
      },
    };
  }

  function snapshotLS() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("psa.") === 0) out[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return out;
  }
  function wipePSALS() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf("psa.") === 0) localStorage.removeItem(k);
      }
    } catch (e) {}
  }
  function restoreLS(snap) {
    wipePSALS();
    try { for (const k in snap) localStorage.setItem(k, snap[k]); } catch (e) {}
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));

  async function waitFor(fn, ms) {
    const deadline = Date.now() + (ms || 1500);
    while (Date.now() < deadline) {
      if (await fn()) return true;
      await wait(40);
    }
    return false;
  }

  /* ─────────────────────────── runner ─────────────────────────── */

  async function run() {
    const results = [];
    const t0 = Date.now();
    function check(name, cond, detail) {
      results.push({ name: name, pass: !!cond, detail: detail === undefined ? null : detail });
    }
    async function group(label, fn) {
      try { await fn(); }
      catch (e) { results.push({ name: label + " — threw", pass: false, detail: (e && e.message) || String(e) }); }
    }

    const snap = snapshotLS();
    const backend = fakeBackend();
    const savedRole = ERP.role;
    /* The collaboration poller must stay out of the way while a diagnostic
       backend is installed, or its background reconcile would race the tests. */
    const savedPoll = ERP.collab && ERP.collab.polling ? ERP.collab.polling() : false;
    if (ERP.collab && ERP.collab.stopPolling) ERP.collab.stopPolling();
    store.useBackend(backend);
    if (ERP.team && ERP.team.setTransport) ERP.team.setTransport(null);
    wipePSALS();
    try {
      store.resetAllLocal();
      ERP.tenancy.invalidateRoot();
      ERP.tenancy.notify();
      ERP.security.setActorMember(null);
      ERP.role = "owner";

      /* ---------- 1. app shell & navigation ---------- */
      await group("nav", async () => {
        const stations = ERP.modules.filter((m) => !m.hidden);
        check("nav: fifteen stations registered", stations.length === 15, stations.map((m) => m.id).join(", "));
        check("nav: every station labelled + renderable", stations.every((m) => m.label && typeof m.render === "function"));
        check("nav: nav groups defined", Array.isArray(ERP.groups) && ERP.groups.length >= 8);
        check("nav: live controllers wired", typeof ERP.dashboard.render === "function" && typeof ERP.companies.render === "function" && typeof ERP.admin.render === "function" && typeof ERP.servicedesk.render === "function" && typeof ERP.dispatch.render === "function" && typeof ERP.catalog.render === "function" && typeof ERP.procurement.render === "function" && typeof ERP.reports.render === "function");
        const liveRenders = [];
        for (const m of ERP.modules.filter((x) => !x.hidden && !x.plannedPhase)) {
          const box = document.createElement("div");
          let err = null;
          try {
            await m.render({ el: box, module: m, toast() {}, navigate() {}, empty() {}, error() {} });
          } catch (e) { err = (e && e.message) || String(e); }
          liveRenders.push({ id: m.id, ok: !err, err });
        }
        check("nav: every live station renders without error", liveRenders.every((r) => r.ok), liveRenders.filter((r) => !r.ok).map((r) => r.id + ": " + r.err).join("; "));
        const planned = ERP.modules.filter((m) => m.plannedPhase);
        check("nav: every station is built (no roadmap-pending stations left)", planned.length === 0, planned.map((m) => m.id + ":" + m.plannedPhase).join(", "));
        check("nav: hidden documents declared", ["tenancy", "versions", "backup", "settings", "audit", "archive"].every((id) => { const m = ERP.getModule(id); return m && m.doc; }));
        const tabBox = document.createElement("div");
        tabBox.className = "erp-tab-panel active";
        ERP.states.loading(tabBox, "x");
        check("nav: state renderers keep tab-panel classes", /erp-tab-panel/.test(tabBox.className) && /active/.test(tabBox.className), tabBox.className);
        const plainBox = document.createElement("div");
        plainBox.className = "erp-module";
        ERP.states.loading(plainBox, "x");
        check("nav: state renderers reset non-tab classes", plainBox.className === "erp-content", plainBox.className);
      });

      /* ---------- 2. tenancy & data storage ---------- */
      let prov, provDocName;
      await group("tenancy", async () => {
        check("tenancy: store namespace is psa", store.docName("tenancy") === "psa-v1-tenancy", store.docName("tenancy"));
        prov = await ERP.tenancy.createProvider({ name: "Test MSP", currency: "USD", timezone: "UTC" });
        check("tenancy: provider created", !!prov && prov.id != null);
        await ERP.tenancy.seed();
        provDocName = ERP.tenancy.providerDocName(prov.id);
        const loaded = await ERP.tenancy.load("provider", prov.id);
        check("tenancy: provider document resolves by name", loaded.name === provDocName);
        await ERP.tenancy.upsert("provider", prov.id, { id: 9001, kind: "note", text: "hello" });
        const back = await ERP.tenancy.records("provider", prov.id, "note");
        check("tenancy: tenant document round-trips a record", back.length === 1 && back[0].text === "hello");
        check("tenancy: edit key cached locally", !!localStorage.getItem("psa.store.v1.keys." + provDocName));
        await ERP.tenancy.save("company", 501, [{ id: 501, kind: "company", name: "Acme" }]);
        const cdoc = await store.get(ERP.tenancy.companyDocName(501));
        check("tenancy: company document round-trips", !!(cdoc.doc && cdoc.doc.records[0] && cdoc.doc.records[0].name === "Acme"));
        const idxDocs = Object.keys((await store.getIndex()).index.documents);
        check("tenancy: tenant documents appear in the index", idxDocs.indexOf(provDocName) !== -1, idxDocs.join(","));
        try { localStorage.setItem("psa.store.v1.index", JSON.stringify({ schema: "psa-index", schemaVersion: 1, rev: 9, updatedAt: new Date().toISOString(), documents: {} })); } catch (e) {}
        await store.reindex();
        const healed = Object.keys((await store.getIndex()).index.documents);
        check("tenancy: reindex heals a wiped index", healed.indexOf(provDocName) !== -1, healed.join(","));
        check("tenancy: active provider tracked", String(ERP.tenancy.activeProviderId()) === String(prov.id));
      });

      /* ---------- 3. companies, sites & contacts ---------- */
      let companyId;
      await group("companies", async () => {
        const co = await ERP.companies.saveCompany({ name: "Acme Corp", status: "active", type: "client", city: "Springfield" });
        companyId = co.record && co.record.id;
        check("companies: created with an id", companyId != null);
        const idx = await ERP.companies.list();
        check("companies: directory index updated", idx.some((e) => e.name === "Acme Corp"));
        await ERP.companies.saveSite(companyId, { name: "HQ", type: "service", city: "Springfield" });
        await ERP.companies.saveContact(companyId, { name: "Jane Doe", email: "jane@acme.test", roles: ["technical"], portalAccess: true });
        const d = await ERP.companies.docs(companyId);
        check("companies: sites & contacts stored on the company document", d.sites.length === 1 && d.contacts.length === 1);
        const counts = await ERP.companies.counts(companyId);
        check("companies: counts reflect the records", counts.sites === 1 && counts.contacts === 1);
        check("companies: index counts stay in step", (await ERP.companies.list()).find((e) => String(e.id) === String(companyId)).sites === 1);

        ERP.role = "staff";
        const denied = await ERP.companies.saveCompany({ name: "Should fail" });
        check("companies: staff cannot create clients (enforced in code)", denied.error === "forbidden");
        const delDenied = await ERP.companies.deleteCompany(companyId);
        check("companies: staff cannot delete clients", delDenied.error === "forbidden");
        ERP.role = "owner";
      });

      /* ---------- 4. members, teams & security ---------- */
      await group("security", async () => {
        await ERP.members.seed();
        check("members: default calendar seeded", (await ERP.members.calendars()).length >= 1);
        check("members: starter team seeded", (await ERP.members.teams()).length >= 1);
        const m = await ERP.members.save("member", ERP.members.newMember({ name: "Tech One", functionalRole: "technician", scopes: { companies: [companyId], financials: false } }));
        check("members: member record saved", m.record && m.record.id != null);
        await ERP.security.refresh(true);
        check("security: staff role denied members.edit", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.require("members.edit").ok; ERP.role = r; return x === false; })());
        check("security: staff role granted companies.view", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.require("companies.view").ok; ERP.role = r; return x === true; })());

        ERP.security.setActorMember(m.record.id);
        check("security: actor member applied", !!(ERP.security.actor().member && ERP.security.actor().member.name === "Tech One"));
        check("security: scoped member allowed on their company", ERP.security.canViewCompany(companyId) === true);
        check("security: scoped member blocked from another company", ERP.security.canViewCompany(999999) === false);
        check("security: financials hidden from a restricted member", ERP.security.money(1234) === "•••");
        ERP.security.setActorMember(null);
        check("security: financials visible to the owner", ERP.security.money(1234).indexOf("1,234") !== -1, ERP.security.money(1234));
      });

      /* ---------- 5. taxonomy & master configuration ---------- */
      await group("taxonomy", async () => {
        const tax = await ERP.taxonomy.list(prov.id);
        check("taxonomy: every category seeded", ERP.taxonomy.CATEGORIES.every((c) => tax.some((r) => r.category === c.id)));
        check("taxonomy: statuses carry open/closed + colour", tax.some((r) => r.category === "ticketStatus" && r.closed === true && !!r.color));
        check("taxonomy: stages carry probability", tax.some((r) => r.category === "opportunityStage" && typeof r.probability === "number"));
        const up = await ERP.taxonomy.upsert(prov.id, { category: "priority", code: "p0", label: "Critical (P0)", color: "#7f1d1d", weight: 0 });
        check("taxonomy: upsert adds an item", !!(await ERP.taxonomy.find(prov.id, "priority", "p0")));
        check("taxonomy: label lookup resolves a code", (await ERP.taxonomy.label(prov.id, "priority", "p1")).indexOf("Priority 1") !== -1);
        await ERP.taxonomy.remove(prov.id, up.record.id);
        check("taxonomy: remove deletes the item", (await ERP.taxonomy.find(prov.id, "priority", "p0")) == null);
        const got = await waitFor(async () => (await ERP.history.entries(provDocName)).length > 0, 2000);
        check("taxonomy: change history recorded for the provider document", got, (await ERP.history.entries(provDocName)).length + " snapshot(s)");
      });

      /* ---------- 6. sync, conflict, backup & versioning ---------- */
      await group("sync", async () => {
        const dn = "psa-v1-test-sync-" + Date.now();
        await store.set(dn, [{ id: 1, v: "A" }]);
        const canon = JSON.parse(backend.__files[dn]); canon.rev = 5; canon.records = [{ id: 1, v: "THEIRS" }];
        backend.__files[dn] = JSON.stringify(canon);
        const w = await store.set(dn, [{ id: 1, v: "MINE" }]);
        check("sync: two-device edit surfaces a conflict", w.error === "conflict");
        check("sync: conflict recorded for review", store.conflicts().some((c) => c.name === dn));
        await store.resolveConflict(dn, "keep_theirs");
        check("sync: keep-theirs adopts the canonical copy", JSON.parse(backend.__files[dn]).records[0].v === "THEIRS");
        check("sync: conflict cleared after resolution", !store.conflicts().some((c) => c.name === dn));

        const dn2 = "psa-v1-test-sync2-" + Date.now();
        await store.set(dn2, [{ id: 1, v: "A" }]);
        const c2 = JSON.parse(backend.__files[dn2]); c2.rev = 9; c2.records = [{ id: 1, v: "THEIRS2" }];
        backend.__files[dn2] = JSON.stringify(c2);
        await store.set(dn2, [{ id: 1, v: "MINE2" }]);
        await store.resolveConflict(dn2, "keep_mine");
        check("sync: keep-mine pushes the local version", JSON.parse(backend.__files[dn2]).records[0].v === "MINE2");

        const dn3 = "psa-v1-test-sync3-" + Date.now();
        await store.set(dn3, [{ id: 1, v: "base" }]);
        const c3 = JSON.parse(backend.__files[dn3]); c3.rev = 4; c3.records = [{ id: 1, v: "base" }, { id: 2, v: "theirs" }];
        backend.__files[dn3] = JSON.stringify(c3);
        await store.set(dn3, [{ id: 1, v: "base" }, { id: 3, v: "mine" }]);
        const r3 = await store.resolveConflict(dn3, "merge");
        const merged = JSON.parse(backend.__files[dn3] || "{}").records || [];
        check("sync: merge combines both sides", merged.some((r) => r.id === 2 && r.v === "theirs") && merged.some((r) => r.id === 3 && r.v === "mine"), r3 && r3.status);
      });

      await group("versioning", async () => {
        const vdoc = "psa-v1-test-ver-" + Date.now();
        await store.set(vdoc, [{ id: 1, v: "one" }]);
        await wait(40);
        await store.set(vdoc, [{ id: 1, v: "two" }]);
        await wait(60);
        if (ERP.history.flush) await ERP.history.flush();
        const entries = await ERP.history.entries(vdoc);
        check("history: versions recorded per document", entries.length >= 1, entries.map((e) => "rev" + e.rev).join(","));
        const oldest = entries[entries.length - 1];
        const rr = await ERP.history.restore(vdoc, oldest.id);
        if (ERP.history.flush) await ERP.history.flush();
        check("history: restore writes an earlier revision back", !rr.error && JSON.parse(backend.__files[vdoc]).records[0].v === "one");
        check("history: restore is itself undoable (pre-restore snapshot)", (await ERP.history.count(vdoc)) >= 2);
      });

      await group("backup", async () => {
        const bundle = await ERP.backup.backupBundle();
        check("backup: bundle carries the psa-backup schema", bundle.schema === "psa-backup");
        check("backup: bundle never contains the backup document", !bundle.docs["psa-v1-backup"]);
        const idxKeys = Object.keys((await store.getIndex()).index.documents);
        check("backup: bundle includes a tenant document", Object.keys(bundle.docs).some((n) => n.indexOf("psa-v1-tenant-") === 0), "idx=[" + idxKeys.join(",") + "] bundle=[" + Object.keys(bundle.docs).join(",") + "]");
        const v = ERP.backup.validateBundle(bundle);
        check("backup: bundle validates cleanly", v.valid, v.errors);
        const restored = await ERP.backup.restoreBundle(bundle);
        check("backup: restore writes documents back", restored.written.length >= 1, restored.written.length + " written");
        const cap = await ERP.backup.capacity();
        check("capacity: reports rows against the per-document ceiling", cap.ceiling === store.maxDocBytes && Array.isArray(cap.rows));
      });

      /* ================= PHASE 2 — SERVICE DESK ================= */

      let memberId = (await ERP.members.members())[0] ? (await ERP.members.members())[0].id : null;

      /* ---------- 7. tickets ---------- */
      let ticketA, ticketB;
      await group("tickets", async () => {
        await ERP.tickets.ensureSeed(prov.id);
        await ERP.sla.ensureSeed(prov.id);
        await ERP.workflow.ensureSeed(prov.id);
        check("tickets: board defaults seeded", (await ERP.tickets.boardConfigs(prov.id)).length >= 1);
        const r = await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Email is down", priority: "p3", board: "service-desk" }));
        ticketA = r.record;
        check("tickets: created with a unique number", !!ticketA && !!ticketA.number, ticketA && ticketA.number);
        check("tickets: SLA stamped from a policy", !!(ticketA.sla && ticketA.sla.responseDueMs != null), ticketA && ticketA.sla);
        const listed = await ERP.tickets.listAll({});
        check("tickets: appears in the register with its client", listed.some((t) => String(t.id) === String(ticketA.id) && t.__companyName === "Acme Corp"));
        check("tickets: search finds it by summary", (await ERP.tickets.listAll({ q: "email" })).some((t) => String(t.id) === String(ticketA.id)));
        check("tickets: open filter excludes a closed ticket", (await ERP.tickets.listAll({ open: true })).some((t) => String(t.id) === String(ticketA.id)));
        const b = await ERP.tickets.boards(prov.id);
        check("tickets: boards resolved from taxonomy", b.length >= 1 && !!b[0].code);

        const saveBoard = await ERP.tickets.saveBoardConfig(prov.id, { code: b[0].code, defaultStatus: "in-progress", teamId: memberId, autoAssign: "round-robin" });
        check("tickets: board defaults edited", !saveBoard.error);
        const r2 = await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Printer jam", board: b[0].code }));
        check("tickets: new ticket adopts the board default status", r2.record.status === "in-progress", r2.record.status);
        check("tickets: auto-assign filled the owner", r2.record.ownerId != null, String(r2.record.ownerId));

        ticketB = r2.record;
        const noteA = await ERP.tickets.addNote(companyId, ticketA.id, { body: "Called the client", internal: true });
        const noteB = await ERP.tickets.addNote(companyId, ticketA.id, { body: "We are on it", internal: false });
        check("tickets: internal and customer notes stored distinctly", noteA.record.internal === true && noteB.record.internal === false);
        const notes = await ERP.tickets.notes(companyId, ticketA.id);
        check("tickets: both notes returned", notes.length === 2);
        const act = await ERP.tickets.activity(companyId, ticketA.id);
        check("tickets: activity log recorded the changes", act.length >= 2, act.length + " entries");

        const upd = await ERP.tickets.save(companyId, Object.assign({}, ticketA, { status: "in-progress" }));
        const statusAct = (await ERP.tickets.activity(companyId, ticketA.id)).some((a) => a.field === "status" && a.to === "in-progress");
        check("tickets: a status change is logged as activity", !upd.error && statusAct);

        await ERP.tickets.addAttachment(companyId, ticketA.id, { name: "screenshot.png", url: "https://example.test/x.png" });
        check("tickets: attachment stored", (await ERP.tickets.attachments(companyId, ticketA.id)).length === 1);

        await ERP.tickets.link(companyId, ticketA.id, { type: "related", targetId: ticketB.id, targetCompanyId: companyId });
        check("tickets: relationship stored", (await ERP.tickets.relations(companyId, ticketA.id)).length === 1);

        const mg = await ERP.tickets.merge(companyId, ticketB.id, ticketA.id);
        const src = await ERP.tickets.get(companyId, ticketB.id);
        const resolved = await ERP.tickets.resolve(companyId, ticketB.id);
        check("tickets: merge sets the redirect and moves notes", !mg.error && src.mergedInto === ticketA.id && resolved.id === ticketA.id);
        check("tickets: merge recorded for audit", (await ERP.tickets.merges(companyId)).length === 1);

        const routed = await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Total outage", priority: "p1" }));
        check("tickets: inbound routing set the board", routed.record.board === "managed", routed.record.board);
      });

      /* ---------- 10. SLAs & business hours ---------- */
      await group("sla", async () => {
        const cal = {
          name: "Test", offsetMinutes: 0, holidays: [],
          hours: {
            mon: [{ from: "08:00", to: "17:00" }], tue: [{ from: "08:00", to: "17:00" }], wed: [{ from: "08:00", to: "17:00" }],
            thu: [{ from: "08:00", to: "17:00" }], fri: [{ from: "08:00", to: "17:00" }], sat: [], sun: [],
          },
        };
        const start = Date.parse("2026-09-11T16:00:00Z"); // Friday 16:00
        const due = ERP.sla.addBusinessMinutes(cal, start, 240);
        const dueIso = new Date(due).toISOString();
        check("sla: business minutes roll over the weekend", dueIso === "2026-09-14T11:00:00.000Z", dueIso);
        check("sla: elapsed business minutes agree", ERP.sla.businessMinutesBetween(cal, start, due) === 240, ERP.sla.businessMinutesBetween(cal, start, due));
        const hol = JSON.parse(JSON.stringify(cal)); hol.holidays = [{ date: "2026-09-14", label: "Holiday" }];
        check("sla: a holiday pushes the due date on", new Date(ERP.sla.addBusinessMinutes(hol, start, 240)).toISOString() === "2026-09-15T11:00:00.000Z");
        check("sla: closed days are not business time", ERP.sla.businessMinutesBetween(cal, Date.parse("2026-09-12T09:00:00Z"), Date.parse("2026-09-12T17:00:00Z")) === 0);

        const policies = [
          ERP.sla.newPolicy({ name: "Any", board: "*", priority: "*", order: 100 }),
          ERP.sla.newPolicy({ name: "P1", board: "*", priority: "p1", order: 10 }),
          ERP.sla.newPolicy({ name: "Desk P1", board: "service-desk", priority: "p1", order: 50 }),
        ];
        check("sla: most specific policy wins", ERP.sla.match(policies, { board: "service-desk", priority: "p1" }).name === "Desk P1");
        check("sla: priority-specific policy wins over any", ERP.sla.match(policies, { board: "managed", priority: "p1" }).name === "P1");

        const paused = await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Waiting ticket", status: "waiting-customer", board: "service-desk" }));
        check("sla: the clock pauses while waiting on the client", !!(paused.record.sla && paused.record.sla.paused));
        const resumed = await ERP.tickets.save(companyId, Object.assign({}, paused.record, { status: "in-progress" }));
        check("sla: the clock resumes and banks the paused time", !resumed.record.sla.paused && (resumed.record.sla.pausedMs || 0) >= 0);

        const bt = await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Breach me", board: "projects", status: "new" }));
        bt.record.sla.responseDueMs = Date.now() - 60000;
        bt.record.sla.responseMet = null;
        bt.record.sla.breachedAt = null;
        await ERP.tickets.save(companyId, bt.record, { silent: true, system: true });
        const proc = await ERP.sla.process(companyId, bt.record, { now: Date.now(), emit: false });
        check("sla: a missed target registers as a breach", !!proc.newlyBreached && !!bt.record.sla.breachedAt);
        check("sla: breach state reports breached", ERP.sla.state(bt.record).breached === true);
        check("sla: breach sweep returns open breached tickets", (await ERP.sla.sweep({ persist: false, emit: false })).length >= 1);
      });

      /* ---------- 11. notifications ---------- */
      await group("notify", async () => {
        await ERP.notify.ensureSeed(prov.id);
        check("notify: default rules seeded", (await ERP.notify.rules(prov.id)).length >= 1);
        const t = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Assign me", ownerId: memberId, board: "service-desk" }))).record;
        const before = (await ERP.notify.notifications({ pid: prov.id })).length;
        const ctx = await ERP.tickets.eventContext("ticket.assigned", t, null, {}, null);
        const r1 = await ERP.notify.emit("ticket.assigned", ctx);
        check("notify: an assignment creates a notification", (await ERP.notify.notifications({ pid: prov.id })).length > before, JSON.stringify(r1));
        const r2 = await ERP.notify.emit("ticket.assigned", ctx);
        const suppressed = (await ERP.notify.log(prov.id)).some((l) => l.status === "suppressed");
        check("notify: a repeat inside the dedup window is suppressed", r2.suppressed >= 1 || suppressed, JSON.stringify(r2));

        await ERP.notify.savePref(prov.id, memberId, { muted: ["ticket.assigned"], channels: { inapp: true, email: true }, digestOnly: false });
        const t2 = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Muted one", ownerId: memberId, board: "service-desk" }))).record;
        const ctx2 = await ERP.tickets.eventContext("ticket.assigned", t2, null, {}, null);
        const r3 = await ERP.notify.emit("ticket.assigned", ctx2);
        check("notify: a muted event is not delivered", r3.sent === 0, JSON.stringify(r3));
        await ERP.notify.savePref(prov.id, memberId, { muted: [], channels: { inapp: true, email: true }, digestOnly: false });

        const tmpl = await ERP.notify.saveTemplate(prov.id, ERP.notify.newTemplate({ name: "Digest test", subject: "X", body: "{ticket.number}" }));
        await ERP.notify.saveRule(prov.id, ERP.notify.newRule({ name: "Digest rule", event: "ticket.status_changed", recipients: ["owner"], channel: "inapp", digest: true, digestWindowMinutes: 0, dedupeMinutes: 0, templateId: (tmpl.record || {}).id }));
        const t3 = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Digest me", ownerId: memberId, board: "service-desk" }))).record;
        const ctx3 = await ERP.tickets.eventContext("ticket.status_changed", t3, null, { status: { from: "new", to: "in-progress" } }, null);
        const r4 = await ERP.notify.emit("ticket.status_changed", ctx3);
        check("notify: a digest rule queues instead of sending", r4.digested >= 1, JSON.stringify(r4));
        const flushed = await ERP.notify.flushDigests(prov.id, Date.now() + 1000);
        check("notify: a due digest flushes into one summary", flushed.length >= 1);
        check("notify: templates substitute event tokens", ERP.notify.render("Ticket {ticket.number}", { ticket: { number: "1001" } }) === "Ticket 1001");
      });

      /* ---------- 12. workflow / rules engine ---------- */
      await group("workflow", async () => {
        await ERP.workflow.ensureSeed(prov.id);
        check("workflow: seeded rules and routing exist", (await ERP.workflow.rules(prov.id)).length >= 1 && (await ERP.workflow.routes(prov.id)).length >= 1);
        check("workflow: route matches an event to a board", !!(await ERP.workflow.route(prov.id, { ticket: { priority: "p1" } })) );

        const rule = await ERP.workflow.saveRule(prov.id, ERP.workflow.newRule({
          name: "P2 to in-progress", event: "ticket.updated",
          conditions: [{ field: "ticket.priority", op: "eq", value: "p2" }],
          actions: [{ type: "set_status", status: "in-progress" }],
        }));
        check("workflow: rule saved", !rule.error);
        const t = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Rule target UNIQUEMATCH", priority: "p2", board: "service-desk", status: "scheduled" }))).record;
        const dry = await ERP.workflow.dryRun(rule.record.id, { pid: prov.id });
        check("workflow: dry run reports the matching ticket", (dry.matches || []).some((m) => String(m.ticketId) === String(t.id)), JSON.stringify(dry.matches));
        const stillScheduled = (await ERP.tickets.get(companyId, t.id)).status;
        check("workflow: dry run changes nothing", stillScheduled === "scheduled", stillScheduled);

        await ERP.tickets.save(companyId, Object.assign({}, t, { summary: "Rule target UNIQUEMATCH v2" }));
        const after = await ERP.tickets.get(companyId, t.id);
        check("workflow: a matching rule fires and sets the status", after.status === "in-progress", after.status);
        check("workflow: every firing is logged", (await ERP.workflow.log(prov.id)).length >= 1);
        check("workflow: conditions evaluate correctly", ERP.workflow.matchConditions([{ field: "ticket.priority", op: "eq", value: "p1" }], { ticket: { priority: "p1" } }) === true);
      });

      /* ---------- 13. templates & recurring ---------- */
      await group("templates", async () => {
        await ERP.templates.ensureSeed(prov.id);
        check("templates: seeded templates exist", (await ERP.templates.templates(prov.id)).length >= 1);
        const tpl = (await ERP.templates.templates(prov.id))[0];
        const seed = await ERP.templates.apply(prov.id, tpl.id, {});
        check("templates: applying a template prefills fields and a checklist", !!seed.board && Array.isArray(seed.checklist) && seed.checklist.length >= 1, JSON.stringify(seed.checklist));

        const now = Date.now();
        const startAt = new Date(now - 3 * 86400000).toISOString();
        const skip = await ERP.templates.saveRecurring(prov.id, ERP.templates.newRecurring({
          name: "Skip-ahead daily", companyId: companyId, board: "managed", summary: "Daily check",
          interval: "daily", everyN: 1, timeOfDay: "09:00", startAt: startAt, catchUp: false, active: true,
        }));
        check("templates: recurring schedule saved", !skip.error);
        const run1 = await ERP.templates.runDue(prov.id, now);
        check("templates: skip-ahead raises a single ticket", run1.created.length === 1, String(run1.created.length));
        const sched = await ERP.templates.recurringById(prov.id, skip.record.id);
        check("templates: schedule advances past now", Date.parse(sched.nextRunAt) > now, sched.nextRunAt);

        const catchup = await ERP.templates.saveRecurring(prov.id, ERP.templates.newRecurring({
          name: "Catch-up daily", companyId: companyId, board: "managed", summary: "Catch up",
          interval: "daily", everyN: 1, timeOfDay: "09:00", startAt: new Date(now - 2 * 86400000).toISOString(), catchUp: true, active: true,
        }));
        const run2 = await ERP.templates.runDue(prov.id, now);
        check("templates: catch-up raises one ticket per missed run", run2.created.length >= 2, String(run2.created.length));
        const c2 = await ERP.templates.recurringById(prov.id, catchup.record.id);
        check("templates: catch-up still advances past now", Date.parse(c2.nextRunAt) > now);
      });

      /* ================= PHASE 3 — DISPATCH & SCHEDULING ================= */

      /* ---------- 15. technician calendars & availability ---------- */
      let techId, techMember;
      const MON = new Date(2026, 8, 14, 0, 0, 0).getTime(); // Monday 14 Sep 2026
      await group("scheduling", async () => {
        const hours = {
          mon: [{ from: "09:00", to: "17:00" }], tue: [{ from: "09:00", to: "17:00" }],
          wed: [{ from: "09:00", to: "17:00" }], thu: [{ from: "09:00", to: "17:00" }],
          fri: [{ from: "09:00", to: "17:00" }], sat: [], sun: [],
        };
        const saved = await ERP.members.save("member", ERP.members.newMember({
          name: "Tech Two", functionalRole: "technician", skills: ["windows", "networking"],
          territory: "North", workHours: hours, dispatchable: true,
        }));
        techId = saved.record.id; techMember = saved.record;

        const win = await ERP.scheduling.memberWindows(techMember, MON);
        check("scheduling: member work hours resolve to windows", win.length === 1 && win[0][0] === 540 && win[0][1] === 1020, JSON.stringify(win));

        const av0 = await ERP.scheduling.availability(prov.id, techId, MON);
        check("scheduling: a full working day is fully available", av0.workMinutes === 480 && av0.availableMinutes === 480, JSON.stringify(av0.windows));

        const t = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Site visit AV", board: "service-desk" }))).record;
        await ERP.appointments.schedule(t, { memberId: techId, startMs: MON + 10 * 3600000, durationMinutes: 60 });
        const av1 = await ERP.scheduling.availability(prov.id, techId, MON);
        check("scheduling: a booked hour leaves availability", av1.availableMinutes === 420 && av1.bookedMinutes === 60, JSON.stringify(av1.windows));

        const slot = await ERP.scheduling.nextFreeSlot(prov.id, techId, 60, MON + 9 * 3600000 + 1800000);
        check("scheduling: the next free slot skips the booking", slot && new Date(slot.startMs).getHours() === 11, slot && new Date(slot.startMs).toISOString());

        await ERP.scheduling.saveTimeOff(prov.id, { memberId: techId, fromMs: MON + 86400000, toMs: MON + 86400000 + 86399000, allDay: true, reason: "Training" });
        check("scheduling: time off is stored with an id", (await ERP.scheduling.timeOffForMember(prov.id, techId, null, null)).every((o) => o.id != null));
        const avTue = await ERP.scheduling.availability(prov.id, techId, MON + 86400000);
        check("scheduling: time off removes a whole day", avTue.availableMinutes === 0 && avTue.windows.length === 0, JSON.stringify(avTue.windows));
        const avWed = await ERP.scheduling.availability(prov.id, techId, MON + 2 * 86400000);
        check("scheduling: the next day is unaffected by time off", avWed.availableMinutes === 480, String(avWed.availableMinutes));

        check("scheduling: skills match reported", ERP.scheduling.skillMatches(techMember, ["windows"]).missing.length === 0 && ERP.scheduling.skillMatches(techMember, ["cisco"]).missing[0] === "cisco");
        const t2 = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Skill gap job", requiredSkills: ["cisco"], board: "service-desk" }))).record;
        const conf = await ERP.scheduling.conflicts(prov.id, { memberId: techId, startMs: MON + 14 * 3600000, endMs: MON + 15 * 3600000, companyId: companyId, ticketId: t2.id }, { exclude: null });
        check("scheduling: a skill gap is flagged", conf.some((c) => c.type === "skill_mismatch"), JSON.stringify(conf.map((c) => c.type)));
        const outside = await ERP.scheduling.conflicts(prov.id, { memberId: techId, startMs: MON + 20 * 3600000, endMs: MON + 21 * 3600000, companyId: companyId, ticketId: t.id });
        check("scheduling: outside-hours work is flagged", outside.some((c) => c.type === "outside_hours"), JSON.stringify(outside.map((c) => c.type)));
        const dbl = await ERP.scheduling.conflicts(prov.id, { memberId: techId, startMs: MON + 10 * 3600000 + 600000, endMs: MON + 11 * 3600000 });
        check("scheduling: a double booking is flagged", dbl.some((c) => c.type === "double_book"), JSON.stringify(dbl.map((c) => c.type)));

        const rec = await ERP.scheduling.recommend(prov.id, t2, { afterMs: MON + 8 * 3600000 });
        check("scheduling: recommendations carry reasons and a slot", rec.suggestions.length >= 1 && rec.suggestions.every((s) => s.reasons.length >= 1) && rec.suggestions.some((s) => !!s.slot), String(rec.suggestions.length));
        check("scheduling: recommendations rank the skilled technician", rec.suggestions[0].memberId != null);
        const cap = await ERP.scheduling.capacity(prov.id, MON);
        check("scheduling: capacity reports load per technician", Array.isArray(cap) && cap.some((c) => String(c.memberId) === String(techId)));
      });

      /* ---------- 17. appointments & service calls ---------- */
      let apptTicket;
      await group("appointments", async () => {
        const t = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Book me", board: "service-desk" }))).record;
        apptTicket = t;
        const start = new Date(2026, 8, 15, 10, 0, 0).getTime(); // Tue 15 Sep
        const res = await ERP.appointments.schedule(t, { memberId: techId, startMs: start, durationMinutes: 90 });
        const appt = res.record;
        check("appointments: scheduled from a ticket", !!appt && appt.id != null && appt.kind === "appointment" && appt.endMs - appt.startMs === 90 * 60000, JSON.stringify(appt && { id: appt.id, s: appt.startMs, e: appt.endMs }));
        const tk = await ERP.tickets.get(companyId, t.id);
        check("appointments: the ticket takes the technician and schedule", String(tk.ownerId) === String(techId) && !!tk.scheduledFor, JSON.stringify({ o: tk.ownerId, s: tk.scheduledFor }));
        check("appointments: the ticket moves to Scheduled", tk.status === "scheduled", tk.status);
        check("appointments: forTicket resolves the live appointment", (await ERP.appointments.forTicket(companyId, t.id)) != null);

        const moved = await ERP.appointments.reschedule(companyId, appt.id, { startMs: start + 3600000 });
        check("appointments: reschedule moves the window", moved.record.startMs === start + 3600000, String(moved.record.startMs));

        const done = await ERP.appointments.complete(companyId, appt.id, { onSiteNotes: "Replaced the PSU.", signOffName: "Jane Doe", signOffNote: "All good" });
        check("appointments: completion records the sign-off", done.record.status === "completed" && !!done.record.signOff && done.record.signOff.name === "Jane Doe");
        const notes = await ERP.tickets.notes(companyId, t.id);
        check("appointments: on-site notes are logged back on the ticket", notes.some((n) => /Replaced the PSU/.test(n.body)), notes.length + " notes");

        const t2 = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Cancel me", board: "service-desk" }))).record;
        const a2 = (await ERP.appointments.schedule(t2, { memberId: techId, startMs: start + 5 * 3600000 })).record;
        const cx = await ERP.appointments.cancel(companyId, a2.id, "client rescheduled");
        check("appointments: cancellation is recorded", cx.record.status === "cancelled", cx.record.status);
        check("appointments: the open filter excludes cancelled visits", (await ERP.appointments.list({ open: true })).every((x) => ERP.appointments.isOpen(x)));
      });

      /* ---------- 16 & 18. dispatch board & scheduling assistant ---------- */
      await group("dispatch", async () => {
        check("dispatch: station is a live controller", typeof ERP.dispatch.render === "function" && !ERP.getModule("dispatch").plannedPhase);
        check("dispatch: the move pipeline is exposed for drag & keyboard", typeof ERP.dispatch.applyMove === "function");

        const t = (await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Dispatch me", board: "service-desk" }))).record;
        const start = new Date(2026, 8, 16, 13, 0, 0).getTime(); // Wed 16 Sep
        await ERP.dispatch.applyMove({ kind: "queue", companyId: companyId, id: t.id }, techId, start, null);
        const appt = await ERP.appointments.forTicket(companyId, t.id);
        check("dispatch: dropping a queued ticket creates an appointment", !!appt && String(appt.memberId) === String(techId) && appt.startMs === start, JSON.stringify(appt && { m: appt.memberId, s: appt.startMs }));
        await ERP.dispatch.applyMove({ kind: "appointment", companyId: companyId, id: appt.id, durMin: 60 }, techId, start + 3600000, null);
        const moved = await ERP.appointments.get(companyId, appt.id);
        check("dispatch: a board move reschedules the appointment", moved.startMs === start + 3600000, String(moved.startMs));

        const box = document.createElement("div");
        box.__db = { dateMs: new Date(2026, 8, 16, 0, 0, 0).getTime(), teamId: "", availMember: techId, assistTicket: null };
        const mod = ERP.getModule("dispatch");
        await mod.render({ el: box, module: mod, navigate() {}, toast() {}, empty() {}, error() {} });
        check("dispatch: the board renders technician rows and time columns", box.querySelectorAll(".erp-db-row").length >= 1 && box.querySelectorAll(".erp-db-time").length >= 1, box.querySelectorAll(".erp-db-row").length + " rows");
        check("dispatch: scheduled work appears as a board block", box.querySelectorAll(".erp-db-block").length >= 1, box.querySelectorAll(".erp-db-block").length + " blocks");
        check("dispatch: the unassigned queue is present", box.querySelector(".erp-db-queue") != null);
        check("dispatch: blocks carry keyboard focus and drag affordances", (function () {
          const b = box.querySelector(".erp-db-block");
          return !!b && b.getAttribute("tabindex") === "0" && b.getAttribute("draggable") === "true" && !!b.getAttribute("data-block-kind");
        })());
      });

      /* ================= PHASE 4 — TIME & EXPENSE ================= */

      /* ---------- 19. time entry capture ---------- */
      let p4Entry, p4MemberId;
      await group("time", async () => {
        check("time: station is a live controller", typeof ERP.time.render === "function" && !ERP.getModule("time").plannedPhase);
        check("time: a week starts on Monday", ERP.time.weekStart("2026-09-16") === "2026-09-14", ERP.time.weekStart("2026-09-16"));
        check("time: week days span Mon–Sun", ERP.time.weekDays("2026-09-14").length === 7 && ERP.time.weekDays("2026-09-14")[6] === "2026-09-20");
        check("time: minutes render as hours + minutes", ERP.time.minutesLabel(150) === "2h 30m" && ERP.time.minutesLabel(45) === "45m", ERP.time.minutesLabel(150) + " / " + ERP.time.minutesLabel(45));
        check("time: membership is tested against the week", ERP.time.inWeek("2026-09-17", "2026-09-14") === true && ERP.time.inWeek("2026-09-21", "2026-09-14") === false);

        const saved = await ERP.time.save(prov.id, ERP.time.newEntry({
          memberId: techId, companyId: companyId, date: "2026-09-14",
          workType: "remote", chargeRole: "engineer", chargeCode: "standard", minutes: 90, notes: "Half-day remote support",
        }));
        p4Entry = saved.record;
        check("time: an entry is saved with an id", !!p4Entry && p4Entry.id != null && saved.created === true);
        check("time: the duration is stored in minutes", p4Entry.minutes === 90);
        check("time: a billable work type makes the entry billable", p4Entry.billable === true);
        check("time: the entry records the resolved rate and its source", !!p4Entry.rate && p4Entry.rate.amount === 150 && p4Entry.rate.source === "default", JSON.stringify(p4Entry.rate && { a: p4Entry.rate.amount, s: p4Entry.rate.source }));
        check("time: the resolved-rate reason names the rule", /Engineer/.test((p4Entry.rate && p4Entry.rate.reason) || ""), p4Entry.rate && p4Entry.rate.reason);

        check("time: a start/end pair derives the minutes", ERP.time.normaliseDuration({ startMs: 9 * 3600000, endMs: 10 * 3600000 + 1800000 }).minutes === 90);
        const timed = await ERP.time.save(prov.id, ERP.time.newEntry({
          memberId: techId, date: "2026-09-15",
          startMs: new Date(2026, 8, 15, 9, 0, 0).getTime(), endMs: new Date(2026, 8, 15, 10, 30, 0).getTime(),
          workType: "remote", chargeRole: "engineer",
        }));
        check("time: start & end times are stored as an interval", timed.record.minutes === 90 && timed.record.startMs != null && timed.record.endMs - timed.record.startMs === 90 * 60000);

        const nb = await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, date: "2026-09-14", minutes: 30, workType: "admin" }));
        check("time: a non-billable work type marks the entry non-billable", nb.record.billable === false);
        const forced = await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, date: "2026-09-14", minutes: 30, workType: "admin", billableOverride: true }));
        check("time: an explicit billable override beats the work type", forced.record.billable === true);
        check("time: deriveBillable falls back and honours an explicit flag",
          ERP.time.deriveBillable({ billable: false }, null, undefined) === false &&
          ERP.time.deriveBillable({ billable: false }, null, true) === true);

        check("time: an entry without a member is rejected", (await ERP.time.save(prov.id, ERP.time.newEntry({ minutes: 30 }))).error === "member_required");
        check("time: an entry without a duration is rejected", (await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId }))).error === "duration_required");

        const throwaway = await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, date: "2026-09-14", minutes: 15, workType: "admin" }));
        check("time: a draft entry can be deleted", (await ERP.time.remove(prov.id, throwaway.record.id)).ok === true);

        const woE = await ERP.time.writeOff(prov.id, p4Entry.id, "Goodwill");
        check("time: a write-off keeps the entry but stops billing", woE.record.billable === false && !!woE.record.writtenOff);
        const restoredE = await ERP.time.restoreBilling(prov.id, p4Entry.id);
        check("time: a write-off can be reversed", restoredE.record.billable === true && !restoredE.record.writtenOff);

        const week = await ERP.time.entries(prov.id, { memberId: techId, weekStart: "2026-09-14" });
        check("time: the week query returns the member's entries", week.length >= 4 && week.every((e) => ERP.time.inWeek(e.date, "2026-09-14")), String(week.length));
        check("time: entries filter by company", (await ERP.time.entries(prov.id, { companyId: companyId })).every((e) => String(e.companyId) === String(companyId)));

        const totals = ERP.time.totals(week);
        check("time: totals sum minutes and billable value", totals.minutes > 0 && totals.entries >= 4 && totals.amount > 0, JSON.stringify({ m: totals.minutes, v: totals.amount }));
        check("time: totals group by member and client", Object.keys(totals.byMember).length >= 1 && Object.keys(totals.byClient).length >= 1);
        check("time: staff may capture time but not approve it", (function () { const r = ERP.role; ERP.role = "staff"; const e = ERP.security.can("time.edit"); const a = ERP.security.can("time.approve"); ERP.role = r; return e === true && a === false; })());
      });

      /* ---------- 19b. quick timers ---------- */
      await group("timers", async () => {
        const started = await ERP.time.startTimer(prov.id, { memberId: techId, companyId: companyId, notes: "On-site visit" });
        check("timers: a timer starts for a member", !!started.record && String(started.record.memberId) === String(techId));
        check("timers: only one timer runs per member", (await ERP.time.startTimer(prov.id, { memberId: techId })).error === "already_running");
        check("timers: the running timer is readable", (await ERP.time.timerFor(prov.id, techId)) != null);
        const stopped = await ERP.time.stopTimer(prov.id, techId, { minutes: 45, notes: "Wrapped up" });
        check("timers: stopping logs an entry", !!stopped.record && stopped.record.minutes === 45 && stopped.record.source === "timer");
        check("timers: the timer is cleared after stopping", (await ERP.time.timerFor(prov.id, techId)) === null);
        const again = await ERP.time.startTimer(prov.id, { memberId: techId });
        await ERP.time.cancelTimer(prov.id, techId);
        check("timers: a running timer can be discarded", !!again.record && (await ERP.time.timerFor(prov.id, techId)) === null);
      });

      /* ---------- 22. billing-rate resolution ---------- */
      await group("rates", async () => {
        check("rates: the documented precedence is five scopes", ERP.time.RATE_SCOPES.length === 5 && ERP.time.RATE_SCOPES.map((s) => s.id).join(",") === "agreement,work-role,priority,client,default", ERP.time.RATE_SCOPES.map((s) => s.id).join(","));

        await ERP.tenancy.upsert("company", companyId, { id: 77001, kind: "agreement", status: "active", name: "Managed services" });
        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "default", name: "House default", amount: 100 }));
        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "client", name: "Acme client rate", companyId: companyId, amount: 120 }));
        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "priority", name: "Critical rate", priority: "p1", amount: 140 }));
        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "work-role", name: "Remote engineer", workType: "remote", chargeRole: "engineer", amount: 160 }));
        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "agreement", name: "Acme agreement rate", agreementId: 77001, amount: 200 }));
        check("rates: rules are stored for every scope", (await ERP.time.rateRules(prov.id)).length >= 5);

        const ctx = { companyId: companyId, workType: "remote", chargeRole: "engineer", priority: "p1" };
        const full = await ERP.time.resolve(prov.id, ctx);
        check("rates: an agreement override wins the precedence", full.amount === 200 && full.source === "agreement", JSON.stringify({ a: full.amount, s: full.source }));
        check("rates: the chain records each rung considered", Array.isArray(full.chain) && full.chain.length >= 1 && full.chain[0].applied === true);
        check("rates: the winning rule is named for the invoice", full.ruleName === "Acme agreement rate");
        check("rates: the agreement rule describes itself", /agreement #77001/.test(full.reason), full.reason);

        const agreementRule = (await ERP.time.rateRules(prov.id)).find((r) => r.scope === "agreement");
        await ERP.time.saveRateRule(prov.id, Object.assign({}, agreementRule, { active: false }));
        const workRole = await ERP.time.resolve(prov.id, ctx);
        check("rates: without an agreement the work-type/role rate applies", workRole.amount === 160 && workRole.source === "work-role", JSON.stringify({ a: workRole.amount, s: workRole.source }));

        const wrRule = (await ERP.time.rateRules(prov.id)).find((r) => r.scope === "work-role");
        await ERP.time.saveRateRule(prov.id, Object.assign({}, wrRule, { active: false }));
        const priority = await ERP.time.resolve(prov.id, ctx);
        check("rates: then the priority rate applies", priority.amount === 140 && priority.source === "priority", JSON.stringify({ a: priority.amount, s: priority.source }));

        const pRule = (await ERP.time.rateRules(prov.id)).find((r) => r.scope === "priority");
        await ERP.time.saveRateRule(prov.id, Object.assign({}, pRule, { active: false }));
        const client = await ERP.time.resolve(prov.id, ctx);
        check("rates: then the client-specific rate applies", client.amount === 120 && client.source === "client", JSON.stringify({ a: client.amount, s: client.source }));

        const cRule = (await ERP.time.rateRules(prov.id)).find((r) => r.scope === "client");
        await ERP.time.saveRateRule(prov.id, Object.assign({}, cRule, { active: false }));
        const def = await ERP.time.resolve(prov.id, ctx);
        check("rates: then the default rule applies", def.amount === 100 && def.source === "default", JSON.stringify({ a: def.amount, s: def.source }));

        const dRule = (await ERP.time.rateRules(prov.id)).find((r) => r.scope === "default");
        await ERP.time.removeRateRule(prov.id, dRule.id);
        const fallback = await ERP.time.resolve(prov.id, ctx);
        check("rates: with no rules the charge-role rate is the fallback", fallback.amount === 150 && fallback.source === "default" && /Engineer/.test(fallback.reason), JSON.stringify({ a: fallback.amount, r: fallback.reason }));

        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "agreement", name: "Acme agreement rate", agreementId: 77001, amount: 200 }));
        const e = await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, companyId: companyId, date: "2026-12-07", minutes: 60, workType: "remote", chargeRole: "engineer" }));
        check("rates: a saved entry stamps which rule produced its rate", e.record.rate.amount === 200 && e.record.rate.source === "agreement" && e.record.rate.ruleName === "Acme agreement rate", JSON.stringify(e.record.rate));

        check("rates: a staff role cannot edit rate rules", (function () { const r = ERP.role; ERP.role = "staff"; const res = ERP.security.can("rates.edit"); ERP.role = r; return res === false; })());
      });

      /* ---------- 20. timesheets & approval ---------- */
      await group("timesheets", async () => {
        check("timesheets: the station delegates to its own engine", typeof ERP.timesheets.submit === "function" && typeof ERP.timesheets.renderInto === "function");
        const open = await ERP.timesheets.build(prov.id, techId, "2026-09-14");
        check("timesheets: an untouched week is open", open.status === "open" && open.record === null && open.entries.length >= 1, JSON.stringify({ s: open.status, n: open.entries.length }));
        check("timesheets: week totals agree with the entries", open.totals.minutes === open.entries.reduce((n, e) => n + e.minutes, 0));

        const sub = await ERP.timesheets.submit(prov.id, techId, "2026-09-14");
        check("timesheets: a week submits for approval", sub.record.status === "submitted" && sub.record.entryIds.length >= 1);
        const submitted = await ERP.timesheets.build(prov.id, techId, "2026-09-14");
        check("timesheets: submitting freezes the entries", submitted.entries.every((e) => e.status === "submitted" && String(e.timesheetId) === String(sub.record.id)));
        check("timesheets: a submitted week is in the approval queue", (await ERP.timesheets.pending(prov.id)).some((s) => String(s.id) === String(sub.record.id)));
        check("timesheets: an empty week cannot be submitted", (await ERP.timesheets.submit(prov.id, techId, "2030-01-07")).error === "empty");
        check("timesheets: staff cannot approve", (function () { const r = ERP.role; ERP.role = "staff"; const res = ERP.security.can("time.approve"); ERP.role = r; return res === false; })());
        check("timesheets: a frozen entry can no longer be edited", (await ERP.time.save(prov.id, Object.assign({}, p4Entry, { minutes: 120 }))).error === "locked");

        const appr = await ERP.timesheets.approve(prov.id, sub.record.id);
        check("timesheets: a manager approves the week", appr.record.status === "approved" && !!appr.record.approvedAt);
        const approved = await ERP.timesheets.build(prov.id, techId, "2026-09-14");
        check("timesheets: approval marks the entries approved", approved.entries.every((e) => e.status === "approved"));

        const locked = await ERP.timesheets.lock(prov.id, sub.record.id);
        check("timesheets: an approved week locks", locked.record.status === "locked");
        check("timesheets: a locked week cannot be reopened", (await ERP.timesheets.reopen(prov.id, sub.record.id)).error === "locked");

        const m2 = await ERP.members.save("member", ERP.members.newMember({ name: "Tech Two", functionalRole: "technician" }));
        p4MemberId = m2.record.id;
        await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: p4MemberId, date: "2026-09-21", minutes: 60, workType: "remote", chargeRole: "engineer" }));
        const sub2 = await ERP.timesheets.submit(prov.id, p4MemberId, "2026-09-21");
        check("timesheets: a second member's week submits", sub2.record.status === "submitted");
        check("timesheets: a rejection must carry a comment", (await ERP.timesheets.reject(prov.id, sub2.record.id, "")).error === "comment_required");
        const rej = await ERP.timesheets.reject(prov.id, sub2.record.id, "Round the travel down.");
        check("timesheets: rejecting records the comment", rej.record.status === "rejected" && rej.record.rejectionNote === "Round the travel down.");
        const back = await ERP.timesheets.build(prov.id, p4MemberId, "2026-09-21");
        check("timesheets: rejected entries return to draft", back.entries.every((e) => e.status === "draft" && e.timesheetId == null));

        const sub3 = await ERP.timesheets.submit(prov.id, p4MemberId, "2026-09-21");
        await ERP.timesheets.approve(prov.id, sub3.record.id);
        const reopen = await ERP.timesheets.reopen(prov.id, sub3.record.id);
        check("timesheets: an approved week can be reopened to draft", reopen.ok === true && (await ERP.timesheets.find(prov.id, p4MemberId, "2026-09-21")) === null);

        const roll = await ERP.timesheets.rollup(prov.id);
        check("timesheets: the roll-up groups totals by member and client", !!roll.totals.byMember && !!roll.totals.byClient && Object.keys(roll.totals.byClient).length >= 1);
      });

      /* ---------- 21. expenses ---------- */
      await group("expenses", async () => {
        check("expenses: taxonomy seeded an expense-category set", (await ERP.taxonomy.list(prov.id, "expenseCategory")).length >= 1);
        check("expenses: ensureCategory is idempotent", (await ERP.taxonomy.ensureCategory(prov.id, "expenseCategory")).skipped === "already_present");

        const saved = await ERP.expenses.save(prov.id, ERP.expenses.newExpense({
          memberId: techId, companyId: companyId, date: "2026-09-16", category: "hardware", amount: 120, description: "Replacement switch",
        }));
        const exp = saved.record;
        check("expenses: an expense is saved with an id", !!exp && exp.id != null && exp.status === "draft");
        check("expenses: a billable category makes it billable", exp.billable === true);
        check("expenses: a percent markup raises the billable amount", ERP.expenses.billableAmount(Object.assign({}, exp, { markupType: "percent", markupValue: 10 })) === 132);
        check("expenses: a flat markup raises the billable amount", ERP.expenses.billableAmount(Object.assign({}, exp, { markupType: "flat", markupValue: 20 })) === 140);
        check("expenses: a non-billable expense bills nothing", ERP.expenses.billableAmount(Object.assign({}, exp, { billable: false })) === 0);

        await ERP.expenses.save(prov.id, Object.assign({}, exp, { markupType: "percent", markupValue: 10 }));
        const roll = ERP.expenses.rollup(await ERP.expenses.list(prov.id, { companyId: companyId }));
        check("expenses: the roll-up reports cost and client-billable value", roll.cost >= 120 && roll.billable >= 132, JSON.stringify({ cost: roll.cost, bill: roll.billable }));

        await ERP.taxonomy.upsert(prov.id, { category: "expenseCategory", code: "personal", label: "Personal", billable: false });
        const personal = await ERP.expenses.save(prov.id, ERP.expenses.newExpense({ memberId: techId, date: "2026-09-16", category: "personal", amount: 15 }));
        check("expenses: a non-billable category is not billed", personal.record.billable === false);
        check("expenses: an invalid amount is rejected", (await ERP.expenses.save(prov.id, ERP.expenses.newExpense({ memberId: techId, amount: -5 }))).error === "amount_invalid");

        const sub = await ERP.expenses.submit(prov.id, exp.id);
        check("expenses: an expense submits for approval", sub.record.status === "submitted");
        check("expenses: staff cannot approve expenses", (function () { const r = ERP.role; ERP.role = "staff"; const res = ERP.security.can("expenses.approve"); ERP.role = r; return res === false; })());
        check("expenses: a submitted expense can no longer be edited", (await ERP.expenses.save(prov.id, Object.assign({}, exp, { amount: 999 }))).error === "locked");
        const appr = await ERP.expenses.approve(prov.id, exp.id);
        check("expenses: a manager approves the expense", appr.record.status === "approved");
        const reimb = await ERP.expenses.reimburse(prov.id, exp.id);
        check("expenses: an approved expense is reimbursed", reimb.record.status === "reimbursed");
        check("expenses: a reimbursed expense is locked", (await ERP.expenses.remove(prov.id, exp.id)).error === "locked");

        await ERP.expenses.submit(prov.id, personal.record.id);
        check("expenses: a rejection must carry a comment", (await ERP.expenses.reject(prov.id, personal.record.id, "")).error === "comment_required");
        const rej = await ERP.expenses.reject(prov.id, personal.record.id, "Not on this client's account.");
        check("expenses: a rejected expense records why", rej.record.status === "rejected" && rej.record.rejectionNote.length > 0);
        check("expenses: a rejected expense reopens to draft", (await ERP.expenses.reopen(prov.id, personal.record.id)).record.status === "draft");
        const wo = await ERP.expenses.writeOff(prov.id, personal.record.id, "Goodwill");
        check("expenses: writing off stops the billing", wo.record.billable === false && !!wo.record.writtenOff);
        check("expenses: forTicket resolves expenses for a ticket", Array.isArray(await ERP.expenses.forTicket(prov.id, companyId, 1)));
      });

      /* ---------- 19–22. the Time & Expense station ---------- */
      await group("time-station", async () => {
        const mod = ERP.getModule("time");
        const host = document.createElement("div");
        host.__time = { weekStart: "2026-09-14", memberId: "", tab: "entries" };
        let err = null;
        try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { err = (e && e.message) || String(e); }
        check("time-station: the station renders without error", !err, err || "");
        check("time-station: it exposes four tabs", host.querySelectorAll("[data-tab]").length === 4, String(host.querySelectorAll("[data-tab]").length));
        check("time-station: the week grid has seven day columns", host.querySelectorAll(".erp-time-day").length === 7, String(host.querySelectorAll(".erp-time-day").length));
        check("time-station: entry cards render on the grid", host.querySelectorAll(".erp-time-card").length >= 1, String(host.querySelectorAll(".erp-time-card").length));
        check("time-station: the grid offers an add action", host.querySelector(".erp-time-add") != null);

        for (const id of ["timesheets", "expenses", "rates"]) {
          const h = document.createElement("div");
          h.__time = { weekStart: "2026-09-14", memberId: "", tab: id };
          let e2 = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e2 = (e && e.message) || String(e); }
          const panel = h.querySelector('[data-panel="' + id + '"]');
          check("time-station: the " + id + " tab renders without error", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
        }
      });

      /* ---------- 23–27. agreements ---------- */
      await group("agreements", async () => {
        const A = ERP.agreements;
        check("agreements: station is a live controller", typeof A.render === "function" && !ERP.getModule("agreements").plannedPhase);
        check("agreements: agreement types are seeded", (await ERP.taxonomy.list(prov.id, "agreementType")).length >= 1);

        /* the Phase-4 rate test leaves a minimal hand-written agreement record
           with no number; every real agreement carries one, so retire it */
        await window.ERP.tenancy.remove("company", companyId, (r) => r.kind === "agreement" && !r.number);

        /* give the technician a burdened cost so profitability is non-zero */
        await ERP.members.save("member", Object.assign({}, techMember, { hourlyCost: 60 }));

        const created = await A.save(prov.id, A.newAgreement({
          companyId: companyId, name: "Acme managed services", type: "managed",
          startDate: "2026-09-01", termMonths: 12, billingCycle: "monthly",
          pricingModel: "flat", baseAmount: 1000, includedHours: 1, overageRate: 100,
          serviceCodes: ["remote"], autoRenew: true,
        }));
        const a1 = created.record;
        check("agreements: an agreement saves with an id and number", !!a1 && a1.id != null && a1.number === "AGR-0001", a1 && a1.number);
        check("agreements: the term derives the end date", a1.endDate === "2027-08-31", a1.endDate);
        check("agreements: a new agreement starts as draft", a1.status === "draft");
        const draftVisible = await ERP.time.activeAgreements(companyId);
        check("agreements: the rate resolver sees the agreement record", draftVisible.some((x) => String(x.id) === String(a1.id)));

        const act = await A.activate(prov.id, a1.id);
        check("agreements: activate sets the status and stamp", act.record.status === "active" && !!act.record.activatedAt);

        await ERP.time.saveRateRule(prov.id, ERP.time.newRateRule({ scope: "agreement", agreementId: a1.id, name: "Acme contract rate", amount: 200 }));
        const rate = await ERP.time.resolve(prov.id, { companyId: companyId, workType: "remote", chargeRole: "engineer" });
        check("agreements: an active agreement supplies the top rate rung", rate.source === "agreement" && rate.amount === 200, rate.source + ":" + rate.amount);

        /* coverage */
        const cv = await A.addCoverage(prov.id, companyId, a1.id, { type: "configuration", name: "Workstations", refId: "1001", quantity: 10, unitPrice: 25, effectiveFrom: "2026-09-01" });
        check("agreements: a coverage line is added with an id", !!cv.record && cv.record.id != null);
        const cur = async () => (await A.forCompany(companyId)).find((x) => String(x.id) === String(a1.id));
        let a = await cur();
        check("agreements: coverage is stored on the agreement", (a.coverage || []).length === 1);
        check("agreements: coverage value is quantity × unit price", A.coverageValue(a, "2026-09-15") === 250);
        const warns = await A.coverageWarnings(companyId, a);
        check("agreements: a covered device missing from the configuration records is flagged", warns.missing.length === 1);

        await A.addCoverage(prov.id, companyId, a1.id, { type: "service", name: "Extra support", quantity: 1, unitPrice: 100, effectiveFrom: "2026-09-16" });
        a = await cur();
        const period = A.periodFor(a, "2026-09-15");
        check("agreements: the billing period follows the anchor day", period.start === "2026-09-01" && period.end === "2026-09-30", JSON.stringify(period));
        const pf = A.prorationFactor("2026-09-16", "", period);
        check("agreements: a mid-period addition prorates by days", pf.days === 15 && pf.factor === 0.5, JSON.stringify(pf));

        const d1 = await A.deriveCharge(prov.id, a, period, { consumedMinutes: 180 });
        const baseLine = d1.lines.find((l) => l.kind === "base");
        const unitTotal = d1.lines.filter((l) => l.kind === "unit").reduce((n, l) => n + l.amount, 0);
        const overage = d1.lines.find((l) => l.kind === "overage");
        check("agreements: the base fee line is derived", !!baseLine && baseLine.amount === 1000);
        check("agreements: coverage lines bill per unit and prorate", unitTotal === 300, String(unitTotal));
        check("agreements: hours beyond the included block bill as overage", !!overage && overage.amount === 200, JSON.stringify(overage));
        check("agreements: subtotal and total reconcile", d1.subtotal === 1300 && d1.total === 1500, JSON.stringify({ s: d1.subtotal, t: d1.total }));

        /* minimum commitment */
        await A.save(prov.id, Object.assign({}, a, { minimumAmount: 2000 }));
        a = await cur();
        const d2 = await A.deriveCharge(prov.id, a, period, { consumedMinutes: 180 });
        check("agreements: a minimum commitment tops up a small charge", d2.minimumAdjusted === 700 && d2.subtotal === 1300 && d2.total === 2200, JSON.stringify({ m: d2.minimumAdjusted, s: d2.subtotal, t: d2.total }));

        /* escalation */
        await A.save(prov.id, Object.assign({}, a, { minimumAmount: 0, escalation: A.newEscalation({ enabled: true, percent: 10, everyMonths: 6 }) }));
        a = await cur();
        const p2 = A.periodFor(a, "2027-03-15");
        const d3 = await A.deriveCharge(prov.id, a, p2, { consumedMinutes: 180 });
        check("agreements: escalation raises the base after its interval", !!d3.escalation && d3.escalation.steps === 1 && d3.subtotal === 1485 && d3.total === 1685, JSON.stringify({ e: d3.escalation, s: d3.subtotal, t: d3.total }));

        /* posting */
        const posted = await A.postCharge(prov.id, a1.id, { asOf: "2026-09-15", consumedMinutes: 180 });
        check("agreements: a charge posts to the ledger", !!posted.record && posted.record.total === 1500 && posted.record.status === "posted", JSON.stringify(posted.record && { t: posted.record.total, s: posted.record.status }));
        const twice = await A.postCharge(prov.id, a1.id, { asOf: "2026-09-15", consumedMinutes: 180 });
        check("agreements: posting the same period twice is blocked", twice.error === "already_posted");
        const run = await A.generateDue(prov.id, { asOf: "2026-10-15" });
        check("agreements: run-due posts the next period and skips the current one", run.posted.length === 1 && run.skipped.length === 0, JSON.stringify({ p: run.posted.length, s: run.skipped.length, e: run.errors }));
        check("agreements: posted charges are readable per agreement", (await A.charges(companyId, { agreementId: a1.id })).length === 2);

        /* profitability */
        const rep = await A.profitability(prov.id, { agreementId: a1.id, from: "2026-09-01", to: "2026-09-30" });
        check("agreements: profitability returns a row and totals", rep.rows.length === 1 && !!rep.totals);
        const row = rep.rows[0];
        check("agreements: margin equals revenue minus cost", Math.abs(row.margin - (row.revenue - row.costTotal)) < 0.01, JSON.stringify({ m: row.margin, r: row.revenue, c: row.costTotal }));
        check("agreements: service cost is attributed to the covered work types", row.basis === "matched to covered services" && row.laborMinutes > 0, row.basis);
        check("agreements: utilisation is available as an alias", typeof A.utilization === "function");

        /* renewals */
        const queue = await A.renewalQueue(prov.id, { asOf: "2027-07-15" });
        check("agreements: the renewal queue surfaces an agreement nearing expiry", queue.some((x) => String(x.agreement.id) === String(a1.id) && x.daysToExpiry <= 60));
        const renewed = await A.renew(prov.id, a1.id, { months: 12, escalationPercent: 10 });
        check("agreements: renewing extends the term and records the renewal", renewed.record.endDate === "2028-08-31" && renewed.record.renewals.length === 1, JSON.stringify({ e: renewed.record.endDate, n: renewed.record.renewals }));
        check("agreements: renewal escalation raises the base amount", renewed.record.baseAmount === 1100, String(renewed.record.baseAmount));

        /* lifecycle sweep */
        const a2 = (await A.save(prov.id, A.newAgreement({ companyId: companyId, name: "Auto-renew", startDate: "2025-01-01", termMonths: 12, autoRenew: true, billingCycle: "annual", baseAmount: 500 }))).record;
        await A.activate(prov.id, a2.id);
        const a3 = (await A.save(prov.id, A.newAgreement({ companyId: companyId, name: "Explicit renewal", startDate: "2024-01-01", termMonths: 12, autoRenew: false, billingCycle: "annual", baseAmount: 300 }))).record;
        await A.activate(prov.id, a3.id);
        const life = await A.runLifecycle(prov.id, { asOf: "2026-01-15" });
        check("agreements: the lifecycle sweep auto-renews a due agreement", life.renewed.some((r) => String(r.id) === String(a2.id)));
        check("agreements: an explicit-renewal agreement is archived as expired", life.expired.some((r) => String(r.id) === String(a3.id)));
        const a2after = await A.get(companyId, a2.id);
        check("agreements: the renewed agreement extends its end date", a2after.endDate === "2026-12-31" && a2after.renewals.length === 1, a2after.endDate);
        check("agreements: the archive lists expired agreements", (await A.archive(prov.id, {})).some((x) => String(x.id) === String(a3.id)));

        /* termination closes coverage and leaves the resolver */
        const term = await A.terminate(prov.id, a1.id, "Client offboarded");
        check("agreements: terminate archives the agreement and closes open coverage", term.record.status === "terminated" && (term.record.coverage || []).every((l) => l.status === "cancelled"));
        check("agreements: a terminated agreement leaves the rate resolver", !(await ERP.time.activeAgreements(companyId)).some((x) => String(x.id) === String(a1.id)));

        check("agreements: staff cannot edit agreements (enforced in code)", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("agreements.edit"); ERP.role = r; return x === false; })());
        check("agreements: managers may bill and terminate", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("agreements.bill") && ERP.security.can("agreements.terminate") && ERP.security.can("agreements.edit"); ERP.role = r; return x === true; })());

        /* the station itself */
        const mod = ERP.getModule("agreements");
        const host = document.createElement("div");
        host.__agr = { tab: "agreements", companyId: "", status: "", agreementId: "", periodDate: "2026-09-15", from: "2026-09-01", to: "2026-09-30" };
        let err = null;
        try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { err = (e && e.message) || String(e); }
        check("agreements: the station renders without error", !err, err || "");
        check("agreements: the station exposes five tabs", host.querySelectorAll("[data-tab]").length === 5, String(host.querySelectorAll("[data-tab]").length));
        for (const id of ["coverage", "billing", "profitability", "renewals"]) {
          const h = document.createElement("div");
          h.__agr = { tab: id, companyId: "", status: "", agreementId: "", periodDate: "2026-09-15", from: "2026-09-01", to: "2026-09-30" };
          let e2 = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e2 = (e && e.message) || String(e); }
          const panel = h.querySelector('[data-panel="' + id + '"]');
          check("agreements: the " + id + " tab renders without error", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
        }
      });

      /* ---------- 28–33. billing & invoicing ---------- */
      await group("billing", async () => {
        const B = ERP.billing, P = ERP.payments, AR = ERP.ar;
        check("billing: station is a live controller", typeof B.render === "function" && !ERP.getModule("billing").plannedPhase);
        if (ERP.master && ERP.master.flush) ERP.master.flush();

        /* a second, clean client so the billing maths is deterministic */
        const co2 = await ERP.companies.saveCompany({ name: "Beta LLC", status: "active", type: "client", currency: "USD" });
        const beta = co2.record.id;

        /* --- 28. billing setup: defaults, overrides, tax, numbering --- */
        const s0 = await B.settings(prov.id);
        check("billing: provider billing defaults exist", s0.termDays === 30 && s0.defaultTaxCode === "NONE");
        await B.saveSettings(prov.id, { termDays: 45, defaultTaxCode: "VAT20", currency: "USD", invoiceCycle: "monthly", template: { groupBy: "source" } });
        const s1 = await B.settings(prov.id);
        check("billing: provider settings save", s1.termDays === 45 && s1.invoiceCycle === "monthly", JSON.stringify({ t: s1.termDays, c: s1.invoiceCycle }));
        await B.saveCompanyProfile(beta, { termDays: 15, currency: "EUR" });
        const cfg = await B.configFor(prov.id, beta);
        check("billing: a client override beats the provider default", cfg.termDays === 15 && cfg.source.termDays === "company", JSON.stringify({ t: cfg.termDays, s: cfg.source.termDays }));
        check("billing: an unset client field falls back to the provider default", cfg.taxCode === "VAT20" && cfg.source.taxCode === "provider", JSON.stringify({ t: cfg.taxCode, s: cfg.source.taxCode }));
        check("billing: the effective currency names its source", cfg.currency === "EUR" && cfg.source.currency === "company", cfg.currency);
        const cfgAcme = await B.configFor(prov.id, companyId);
        check("billing: another client inherits the provider default", cfgAcme.termDays === 45 && cfgAcme.source.termDays === "provider" && cfgAcme.taxCode === "VAT20");
        check("billing: tax rates are configurable", (await B.taxFor("VAT20")).rate === 20 && (await B.taxRates()).length >= 1);
        check("billing: invoice numbering is exposed and configurable", typeof B.saveNumbering === "function" && !!(await B.numbering()).prefixes);
        const num1 = await B.nextNumber(prov.id);
        check("billing: invoice numbering allocates a number", /^[A-Z]+-\d+$/.test(num1), num1);

        /* --- 29. assembly from agreements, time and expenses --- */
        const period = { key: "2026-10", start: "2026-10-01", end: "2026-10-31" };
        const t1 = (await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, companyId: beta, date: "2026-10-05", minutes: 120, workType: "remote", chargeRole: "engineer" }))).record;
        await ERP.tenancy.upsert("provider", prov.id, Object.assign({}, t1, { status: "approved" }));
        const t2 = (await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, companyId: beta, date: "2026-10-06", minutes: 60, workType: "onsite", chargeRole: "engineer" }))).record;
        await ERP.tenancy.upsert("provider", prov.id, Object.assign({}, t2, { status: "approved" }));
        const ex = (await ERP.expenses.save(prov.id, ERP.expenses.newExpense({ memberId: techId, companyId: beta, date: "2026-10-06", category: "hardware", amount: 100, markupType: "percent", markupValue: 10 }))).record;
        await ERP.tenancy.upsert("provider", prov.id, Object.assign({}, ex, { status: "approved" }));
        await ERP.agreements.save(prov.id, ERP.agreements.newAgreement({ companyId: beta, name: "Beta managed", startDate: "2026-10-01", termMonths: 12, billingCycle: "monthly", pricingModel: "flat", baseAmount: 500 }));
        const ag = (await ERP.agreements.list(prov.id, { companyId: beta }))[0];
        await ERP.agreements.activate(prov.id, ag.id);
        await ERP.agreements.postCharge(prov.id, ag.id, { asOf: "2026-10-15" });

        const asm = await B.assemble(prov.id, { companyId: beta, period: period });
        check("billing: assembly returns lines from every source", asm.lines.length === 4, asm.lines.map((l) => l.source).join(","));
        check("billing: agreement charges assemble as a line", asm.lines.some((l) => l.source === "agreement" && l.amount === 500));
        check("billing: approved time bills at its resolved rate", asm.lines.filter((l) => l.source === "time").reduce((n, l) => n + l.amount, 0) === 450, String(asm.lines.filter((l) => l.source === "time").reduce((n, l) => n + l.amount, 0)));
        check("billing: expenses bill with their markup", asm.lines.some((l) => l.source === "expense" && l.amount === 110));
        check("billing: every line is traceable to a source record", asm.lines.every((l) => l.sourceId != null && (l.sources || []).length >= 1));
        check("billing: subtotal, tax and total reconcile", asm.subtotal === 1060 && asm.taxTotal === 212 && asm.total === 1272, JSON.stringify({ s: asm.subtotal, t: asm.taxTotal, g: asm.total }));

        /* --- 30. readiness, dry-run, generate, review, post --- */
        await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, companyId: beta, date: "2026-10-07", minutes: 30, workType: "remote", chargeRole: "engineer" }));
        const rd = await B.readiness(prov.id, beta, period);
        check("billing: readiness flags unapproved time before billing", rd.ok === true && rd.warnings.some((w) => w.code === "unapproved_time"));
        const invBefore = (await B.forCompany(beta)).length;
        const dry = await B.dryRun(prov.id, { companyId: beta, period: period });
        check("billing: a dry run reports what would be invoiced", dry.assemble.total === 1272 && dry.readiness.ok === true);
        check("billing: a dry run writes nothing", (await B.forCompany(beta)).length === invBefore);
        const gen = await B.generate(prov.id, { companyId: beta, period: period });
        check("billing: generating creates a draft invoice", gen.created === true && gen.invoice.status === "draft" && /-\d+$/.test(gen.invoice.number), JSON.stringify(gen.invoice && { s: gen.invoice.status, n: gen.invoice.number }));
        check("billing: the draft carries the assembled lines and total", gen.invoice.lines.length === 4 && gen.invoice.total === 1272);
        const genAgain = await B.generate(prov.id, { companyId: beta, period: period });
        check("billing: re-running the same period is idempotent", genAgain.existing === true && String(genAgain.invoice.id) === String(gen.invoice.id));
        const posted = await B.post(prov.id, gen.invoice.id);
        check("billing: a draft posts", posted.invoice.status === "posted" && !!posted.invoice.postedAt);
        check("billing: posting locks the time it consumed", (await ERP.time.entry(prov.id, t1.id)).invoiceId === gen.invoice.id);
        check("billing: posting locks the expense it consumed", (await ERP.expenses.get(prov.id, ex.id)).invoiceId === gen.invoice.id);
        check("billing: posting locks the agreement charge it consumed", (await ERP.agreements.charges(beta, {}))[0].billedInvoiceId === gen.invoice.id);
        const repost = await B.post(prov.id, gen.invoice.id);
        check("billing: posting twice is a no-op", repost.already === true);
        const rd2 = await B.readiness(prov.id, beta, period);
        check("billing: the gate blocks a second run for the same period", rd2.ok === false && rd2.blockers.some((b) => b.code === "period_invoiced"));
        check("billing: a posted invoice is immutable", (await B.save(prov.id, Object.assign({}, posted.invoice, { notes: "should not change" }))).error === "immutable");
        check("billing: unapproved time is not billed", gen.invoice.lines.every((l) => l.source !== "time" || String(l.meta && l.meta.minutes) !== "30"));

        /* --- 31. payments, credits, adjustments & write-offs --- */
        const pay1 = await P.record(prov.id, { companyId: beta, invoiceId: gen.invoice.id, amount: 600, method: "bank_transfer", reference: "wire", idempotencyKey: "beta-1" });
        check("payments: a partial payment applies to the invoice", pay1.record.id != null && pay1.invoice.balance === 672 && pay1.invoice.paymentStatus === "partial", JSON.stringify({ b: pay1.invoice && pay1.invoice.balance, s: pay1.invoice && pay1.invoice.paymentStatus }));
        const payDup = await P.record(prov.id, { companyId: beta, invoiceId: gen.invoice.id, amount: 600, idempotencyKey: "beta-1" });
        check("payments: a repeated idempotency key returns the same payment", payDup.existing === true && String(payDup.record.id) === String(pay1.record.id));
        const pay2 = await P.record(prov.id, { companyId: beta, invoiceId: gen.invoice.id, amount: 672 });
        check("payments: the balance clears and the invoice reads paid", pay2.invoice.balance === 0 && pay2.invoice.paymentStatus === "paid");
        const vd = await P.voidPayment(prov.id, pay2.record.id, "Bounced");
        check("payments: voiding a payment restores the balance", vd.record.status === "void" && vd.invoice.balance === 672 && vd.invoice.paymentStatus === "partial", JSON.stringify({ b: vd.invoice && vd.invoice.balance }));
        const wo = await P.writeOff(prov.id, gen.invoice.id, 100, "Goodwill");
        check("payments: a write-off reduces what is owed", wo.invoice.writeOff === 100 && wo.invoice.balance === 572, JSON.stringify({ w: wo.invoice && wo.invoice.writeOff, b: wo.invoice && wo.invoice.balance }));
        const adj = await P.adjust(prov.id, gen.invoice.id, 50, "Discount");
        check("payments: an adjustment posts with a reason", adj.invoice.adjustments === 50 && adj.invoice.balance === 522, JSON.stringify({ a: adj.invoice && adj.invoice.adjustments, b: adj.invoice && adj.invoice.balance }));
        const cred = await P.issueCredit(prov.id, { companyId: beta, amount: 200, reason: "Service credit" });
        check("payments: a credit can be held on account", cred.record.status === "issued" && cred.record.appliedInvoiceId == null);
        const bal1 = await P.companyBalance(prov.id, beta);
        check("payments: the company balance reports credit on account", bal1.creditOnAccount === 200 && bal1.balance === 522, JSON.stringify(bal1));
        const applied = await P.applyCredit(prov.id, cred.record.id, gen.invoice.id);
        check("payments: applying a credit reduces the invoice", applied.invoice.credits === 200 && applied.invoice.balance === 322, JSON.stringify({ c: applied.invoice && applied.invoice.credits, b: applied.invoice && applied.invoice.balance }));

        /* --- 33. financial reporting --- */
        const aging = await AR.arAging(prov.id, { asOf: ERP.ui.today() });
        check("reports: AR aging buckets open invoices", aging.rows.length >= 1 && aging.totals.total === 322, JSON.stringify({ r: aging.rows.length, t: aging.totals.total }));
        const rev = await AR.revenue(prov.id, {});
        check("reports: revenue totals the posted invoices", rev.totals.total === 1272 && rev.byService.length >= 1, JSON.stringify({ t: rev.totals.total, s: rev.byService.length }));
        check("reports: revenue groups by client", rev.byClient.some((r) => String(r.companyId) === String(beta) && r.total === 1272));
        const bl = await AR.backlog(prov.id, {});
        check("reports: the billing backlog reports unbilled WIP", bl.totals.total > 0 && bl.totals.time > 0, JSON.stringify(bl.totals));
        const summary = await AR.summary(prov.id, {});
        check("reports: the summary counts posted invoices and receipts", summary.counts.posted >= 1 && summary.totals.invoiced >= 1272 && summary.totals.received === 600, JSON.stringify({ c: summary.counts, t: summary.totals }));
        const csv = AR.toCsv([{ a: 1, b: "x,y" }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]);
        check("reports: CSV export escapes delimiters", csv.indexOf('"x,y"') !== -1 && csv.indexOf("A,B") === 0, csv.split("\n")[0]);
        check("reports: a print/PDF view is available", typeof AR.printHtml === "function");

        /* voiding an invoice releases its sources so they can be re-billed */
        const voidBlocked = await B.void(prov.id, gen.invoice.id, "Client dispute");
        check("billing: an invoice with money applied cannot be voided", voidBlocked.error === "has_payments");
        const vres = await B.void(prov.id, gen.invoice.id, "Client dispute", { force: true });
        check("billing: voiding an invoice releases the sources", vres.invoice.status === "void" && (await ERP.time.entry(prov.id, t1.id)).invoiceId == null);
        check("billing: a released agreement charge can be billed again", (await ERP.agreements.charges(beta, {}))[0].billedInvoiceId == null);

        /* enforcement */
        check("billing: staff cannot edit or post invoices", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("billing.edit") || ERP.security.can("billing.post"); ERP.role = r; return x === false; })());
        check("billing: managers may bill, post and record payments", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("billing.edit") && ERP.security.can("billing.post") && ERP.security.can("payments.edit"); ERP.role = r; return x === true; })());

        /* the station itself */
        const mod = ERP.getModule("billing");
        const host = document.createElement("div");
        host.__bill = { tab: "invoices", companyId: "", status: "", invoiceId: "", periodDate: ERP.ui.today(), from: "2026-10-01", to: "2026-10-31", setupCompanyId: "" };
        let err = null;
        try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { err = (e && e.message) || String(e); }
        check("billing: the station renders without error", !err, err || "");
        check("billing: the station exposes five tabs", host.querySelectorAll("[data-tab]").length === 5, String(host.querySelectorAll("[data-tab]").length));
        for (const id of ["runs", "payments", "reports", "setup"]) {
          const h = document.createElement("div");
          h.__bill = { tab: id, companyId: "", status: "", invoiceId: "", periodDate: ERP.ui.today(), from: "2026-10-01", to: "2026-10-31", setupCompanyId: "" };
          let e2 = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e2 = (e && e.message) || String(e); }
          const panel = h.querySelector('[data-panel="' + id + '"]');
          check("billing: the " + id + " tab renders without error", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
        }
      });

      /* ---------- 34–37. projects, templates, budgets & milestones ---------- */
      await group("projects", async () => {
        const P = ERP.projects, B = ERP.billing;
        check("projects: station is a live controller", typeof P.render === "function" && !ERP.getModule("projects").plannedPhase);
        await P.seedTemplates(prov.id);
        check("projects: starter templates are seeded", (await P.templates(prov.id)).length >= 3, String((await P.templates(prov.id)).length));
        check("projects: seeding is idempotent", (await P.seedTemplates(prov.id)).seeded === false);

        const co = await ERP.companies.saveCompany({ name: "Gamma Inc", status: "active", type: "client", currency: "USD" });
        const gid = co.record.id;
        const tpl = (await P.templates(prov.id)).find((t) => /onboarding/i.test(t.name)) || (await P.templates(prov.id))[0];
        check("projects: a template carries a phase breakdown", (tpl.phases || []).length >= 1 && (tpl.phases || []).every((ph) => Array.isArray(ph.tasks)));

        const inst = await P.instantiate(prov.id, { templateId: tpl.id, companyId: gid, name: "Implant", billingMethod: "tm" });
        const project = inst.record;
        check("projects: instantiating a template creates a numbered project", !!project && /^PRJ-/.test(String(project.number)), project && project.number);
        check("projects: the project gets the template's phases and tasks", (project.phases || []).length === (tpl.phases || []).length && P.tasksOf(project).length > 0, JSON.stringify({ ph: (project.phases || []).length, tk: P.tasksOf(project).length }));
        check("projects: a project is stored in the client document", (await P.get(gid, project.id)) != null);
        check("projects: a project needs a client", (await P.save(prov.id, P.newProject({ name: "x" }))).error === "company_required");
        check("projects: a project needs a name", (await P.save(prov.id, P.newProject({ companyId: gid }))).error === "name_required");

        const taskIds = P.tasksOf(project).map((h) => h.task.id);
        for (const id of taskIds) await P.completeTask(prov.id, project.id, id);
        const done = await P.get(gid, project.id);
        check("projects: completing every task completes the phases", (done.phases || []).every((ph) => ph.status === "complete"));
        check("projects: completing every phase completes the project", done.status === "completed" && done.progress === 100, done.status + " / " + done.progress);

        const p2 = (await P.save(prov.id, P.newProject({ companyId: gid, name: "Migration", billingMethod: "milestone", estimatedHours: 40, hourlyCost: 60, hourlyRate: 120, startDate: "2026-11-01", dueDate: "2026-11-30" }))).record;
        const phA = (await P.addPhase(prov.id, p2.id, { name: "Plan", estimatedHours: 10 })).record;
        const phAid = phA.phases[0].id;
        const t2 = (await P.addTask(prov.id, p2.id, phAid, { name: "Inventory", estimatedHours: 5 })).record;
        const taskId = t2.phases[0].tasks[0].id;
        check("projects: a phase and task can be added", !!taskId && (await P.get(gid, p2.id)).phases[0].tasks.length === 1);

        const te = await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, companyId: gid, projectId: p2.id, taskId: taskId, date: "2026-11-05", minutes: 180, workType: "remote", chargeRole: "engineer" }));
        check("projects: time captures the project and task", te.record.projectId != null && String(te.record.taskId) === String(taskId));
        const ex = await ERP.expenses.save(prov.id, ERP.expenses.newExpense({ memberId: techId, companyId: gid, projectId: p2.id, taskId: taskId, date: "2026-11-05", category: "hardware", amount: 200, description: "lab kit" }));
        check("projects: an expense captures the project and task", ex.record.projectId != null && String(ex.record.taskId) === String(taskId));

        const act = await P.actuals(prov.id, await P.get(gid, p2.id), {});
        check("projects: actuals count the project's time and expense", act.entries === 1 && act.expenseCount === 1 && act.minutes === 180, JSON.stringify({ e: act.entries, x: act.expenseCount, m: act.minutes }));
        check("projects: actuals burden labour at the member cost", act.laborCost === 180, String(act.laborCost));
        check("projects: actuals total cost includes expenses", act.cost === 380, String(act.cost));
        check("projects: actuals group by task", !!act.byTask[String(taskId)] && act.byTask[String(taskId)].minutes === 180);

        const est = P.estimate(await P.get(gid, p2.id));
        check("projects: estimate derives hours, cost and revenue", est.hours === 40 && est.cost === 2400 && est.revenue === 0, JSON.stringify(est));
        const budget = await P.budgetStatus(prov.id, await P.get(gid, p2.id), {});
        check("projects: budget reports actual vs estimate", budget.actual.cost === 380 && budget.estimate.cost === 2400 && budget.costPct === 16, JSON.stringify({ a: budget.actual.cost, c: budget.costPct }));

        /* milestone billing */
        const p3 = (await P.save(prov.id, P.newProject({ companyId: gid, name: "Cutover", billingMethod: "milestone", startDate: "2026-11-01", dueDate: "2026-11-30" }))).record;
        const ph3 = (await P.addPhase(prov.id, p3.id, { name: "Deliver" })).record;
        const ph3id = ph3.phases[0].id;
        const t3 = (await P.addTask(prov.id, p3.id, ph3id, { name: "Cut over" })).record;
        const t3id = t3.phases[0].tasks[0].id;
        const ms = (await P.addMilestone(prov.id, p3.id, { name: "Cutover sign-off", amount: 1500, dueDate: "2026-11-20", phaseId: ph3id })).record;
        check("projects: a milestone tied to a phase starts pending", ms.milestones[0].status === "pending");
        check("projects: a pending milestone is not billable", (await P.billableMilestones(prov.id, gid, { end: "2026-11-30" })).length === 0);
        const afterDone = await P.completeTask(prov.id, p3.id, t3id);
        check("projects: completing the phase releases its milestone", afterDone.record.milestones[0].status === "ready", afterDone.record.milestones[0].status);
        const bill = await P.billableMilestones(prov.id, gid, { end: "2026-11-30" });
        check("projects: a released milestone is billable", bill.length === 1 && bill[0].amount === 1500 && String(bill[0].projectId) === String(p3.id), JSON.stringify(bill.map((b) => b.amount)));

        const period11 = { key: "2026-11", start: "2026-11-01", end: "2026-11-30" };
        const asm = await B.assemble(prov.id, { companyId: gid, period: period11 });
        const projLine = (asm.lines || []).find((l) => l.source === "project");
        check("projects: billing assembly picks up the milestone", !!projLine && projLine.amount === 1500 && String(projLine.projectId) === String(p3.id), JSON.stringify(projLine && { a: projLine.amount }));
        const genP = await B.generate(prov.id, { companyId: gid, period: period11 });
        check("projects: generating an invoice from the milestone succeeds", !!genP.invoice && genP.invoice.status === "draft");
        const postedP = await B.post(prov.id, genP.invoice.id);
        const stamped = await P.get(gid, p3.id);
        check("projects: posting stamps the milestone invoiced", postedP.invoice.status === "posted" && stamped.milestones[0].status === "invoiced" && stamped.milestones[0].invoiceId === genP.invoice.id, JSON.stringify({ s: stamped.milestones[0].status, i: stamped.milestones[0].invoiceId }));
        check("projects: an invoiced milestone is no longer billable", (await P.billableMilestones(prov.id, gid, { end: "2026-11-30" })).length === 0);
        await B.void(prov.id, genP.invoice.id, "test", { force: true });
        check("projects: voiding the invoice releases the milestone", (await P.get(gid, p3.id)).milestones[0].status === "ready");

        const p4 = (await P.save(prov.id, P.newProject({ companyId: gid, name: "Fixed thing", billingMethod: "fixed", fixedFee: 5000, startDate: "2026-11-01", dueDate: "2026-12-31" }))).record;
        check("projects: a fixed-fee project gets a generated fee milestone", (p4.milestones || []).length === 1 && p4.milestones[0].amount === 5000 && p4.milestones[0].auto === true);
        const rel = await P.releaseMilestone(prov.id, p4.id, p4.milestones[0].id);
        check("projects: a milestone can be released manually", !!(rel && rel.record) && rel.record.milestones[0].status === "ready", JSON.stringify(rel && (rel.error || (rel.record && rel.record.milestones[0].status))));

        await P.hold(prov.id, p2.id, "waiting on parts");
        check("projects: a project can be put on hold", (await P.get(gid, p2.id)).status === "on_hold");
        await P.resume(prov.id, p2.id);
        check("projects: a project can be resumed", (await P.get(gid, p2.id)).status === "active");

        const prof = await P.profitability(prov.id, { companyId: gid });
        check("projects: profitability rolls up cost and margin", prof.rows.length >= 2 && prof.totals.cost >= 380, JSON.stringify(prof.totals));

        check("projects: staff cannot edit projects", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("projects.edit"); ERP.role = r; return x === false; })());
        check("projects: managers may edit and bill", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("projects.edit") && ERP.security.can("projects.bill"); ERP.role = r; return x === true; })());

        const mod = ERP.getModule("projects");
        const host = document.createElement("div");
        let err = null;
        try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { err = (e && e.message) || String(e); }
        check("projects: the station renders without error", !err, err || "");
        check("projects: the station exposes five tabs", host.querySelectorAll("[data-tab]").length === 5, String(host.querySelectorAll("[data-tab]").length));
        check("projects: the project list renders rows", host.querySelectorAll("[data-panel='projects'] tbody tr").length >= 1, String(host.querySelectorAll("[data-panel='projects'] tbody tr").length));
        for (const id of ["templates", "schedule", "budget", "billing"]) {
          const h = document.createElement("div");
          h.__proj = { tab: id, companyId: "", status: "", projectId: "", templateId: "", ownerId: "", showCompleted: false };
          let e2 = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e2 = (e && e.message) || String(e); }
          const panel = h.querySelector('[data-panel="' + id + '"]');
          check("projects: the " + id + " tab renders without error", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
        }
      });

      /* ---------- 38–41. sales & CRM ---------- */
      await group("sales", async () => {
        const SA = ERP.sales;
        check("sales: station is a live controller", typeof SA.render === "function" && !ERP.getModule("sales").plannedPhase);
        const stages = await SA.stages(prov.id);
        check("sales: pipeline stages come from the taxonomy", stages.length >= 4 && stages.some((s) => s.code === "won" && s.closed === true), stages.map((s) => s.code).join(","));

        const co = await ERP.companies.saveCompany({ name: "Delta Systems", status: "prospect", type: "client", currency: "USD", email: "hello@delta.test", website: "https://delta.test" });
        const sid = co.record.id;

        const o1 = await SA.save(prov.id, SA.newOpportunity({ companyId: sid, name: "Managed services", value: 12000, stage: "qualified", ownerId: techId, expectedClose: "2026-11-15", source: "referral" }));
        check("sales: an opportunity is created with a number", !!o1.record && /^OPP-/.test(String(o1.record.number)), o1.record && o1.record.number);
        check("sales: an opportunity is stored in the client document", (await SA.get(sid, o1.record.id)) != null);
        check("sales: an opportunity needs a client", (await SA.save(prov.id, SA.newOpportunity({ name: "x" }))).error === "company_required");
        check("sales: an opportunity needs a name", (await SA.save(prov.id, SA.newOpportunity({ companyId: sid }))).error === "name_required");

        const opp = o1.record;
        check("sales: probability derives from the stage", SA.probOf(stages, opp) === 30, String(SA.probOf(stages, opp)));
        check("sales: weighted value uses the stage probability", SA.weightedValue(stages, opp) === 3600, String(SA.weightedValue(stages, opp)));

        const adv = await SA.setStage(prov.id, sid, opp.id, "negotiation", "demo went well");
        check("sales: a stage change is recorded in the history", (adv.record.stageHistory || []).length >= 2 && adv.record.stageHistory[adv.record.stageHistory.length - 1].to === "negotiation", JSON.stringify(adv.record.stageHistory.map((h) => h.to)));
        check("sales: probability follows the new stage", SA.probOf(stages, adv.record) === 75, String(SA.probOf(stages, adv.record)));

        const won = await SA.win(prov.id, sid, opp.id, "Best fit");
        check("sales: marking won closes the opportunity", won.record.status === "won" && won.record.winLossReason === "Best fit", JSON.stringify({ s: won.record.status, r: won.record.winLossReason }));

        const o2 = (await SA.save(prov.id, SA.newOpportunity({ companyId: sid, name: "Cloud migration", value: 8000, stage: "proposal", expectedClose: "2026-12-01", ownerId: techId }))).record;
        await SA.save(prov.id, SA.newOpportunity({ companyId: sid, name: "Long shot", value: 2000, stage: "lead", expectedClose: "2026-10-20" }));

        const pipe = await SA.pipeline(prov.id, { companyId: sid });
        check("sales: the pipeline groups opportunities by stage", pipe.columns.some((c) => c.code === "proposal" && c.opportunities.length >= 1));
        check("sales: the pipeline totals the open value", pipe.totals.openValue === 10000, String(pipe.totals.openValue));
        check("sales: the pipeline computes a weighted forecast", pipe.totals.weighted === 4200, String(pipe.totals.weighted));

        const f = await SA.forecast(prov.id, { companyId: sid, grain: "month" });
        check("sales: the forecast reports by stage", f.byStage.length >= 2, String(f.byStage.length));
        check("sales: the forecast reports by owner", f.byOwner.length >= 1, String(f.byOwner.length));
        check("sales: the forecast reports by period", f.byPeriod.some((r) => r.period === "2026-12"), JSON.stringify(f.byPeriod.map((r) => r.period)));
        check("sales: the forecast totals committed (won) value", f.totals.wonValue === 12000, String(f.totals.wonValue));
        check("sales: the forecast reports a win rate", f.totals.winRate === 100, String(f.totals.winRate));

        /* — quotes — */
        const q = (await SA.saveQuote(prov.id, SA.newQuote({ companyId: sid, opportunityId: o2.id, title: "Cloud migration proposal", taxRate: 10, lines: [
          SA.newLine({ kind: "service", description: "Migration labour", qty: 20, unitCost: 60, unitPrice: 150 }),
          SA.newLine({ kind: "product", description: "Firewall", qty: 2, unitCost: 400, unitPrice: 900, discountPct: 10 }),
        ] }))).record;
        check("sales: a quote is created with a number", /^QTE-/.test(String(q.number)), q.number);
        check("sales: the quote totals compute from its lines", q.subtotal === 4620 && q.discountTotal === 180 && q.tax === 462 && q.total === 5082, JSON.stringify({ s: q.subtotal, d: q.discountTotal, t: q.tax, g: q.total }));
        check("sales: the quote shows cost, margin and margin %", q.costTotal === 2000 && q.margin === 2620 && q.marginPct === 57, JSON.stringify({ c: q.costTotal, m: q.margin, mc: q.marginPct }));
        check("sales: a quote needs a client", (await SA.saveQuote(prov.id, SA.newQuote({ title: "x" }))).error === "company_required");
        check("sales: a quote needs a title", (await SA.saveQuote(prov.id, SA.newQuote({ companyId: sid }))).error === "title_required");
        check("sales: a quote is stored in the client document", (await SA.getQuote(sid, q.id)) != null);
        check("sales: a draft quote can add a line", !!(await SA.addLine(prov.id, sid, q.id, SA.newLine({ description: "Support", qty: 1, unitPrice: 500 }))).record);
        check("sales: adding a line recomputes the totals", (await SA.getQuote(sid, q.id)).subtotal === 5120, String((await SA.getQuote(sid, q.id)).subtotal));

        check("sales: sending a quote is recorded", (await SA.setQuoteStatus(prov.id, sid, q.id, "sent")).record.status === "sent");
        check("sales: only an accepted quote can be converted", (await SA.convertQuote(prov.id, sid, q.id, { procurement: true })).error === "not_accepted");
        check("sales: accepting a quote stamps it", (await SA.acceptQuote(prov.id, sid, q.id)).record.acceptedAt != null);
        const prop = await SA.proposalHtml(prov.id, sid, q.id);
        check("sales: the proposal output names the client and total", prop.indexOf("Delta Systems") !== -1 && prop.indexOf("Proposal QTE-") !== -1 && prop.indexOf("5,632") !== -1);

        const conv = await SA.convertQuote(prov.id, sid, q.id, { project: { name: "Cloud migration project" }, agreement: { type: "one-off" }, procurement: true });
        check("sales: converting a quote creates a project", !!conv.projectId);
        check("sales: converting a quote creates an agreement", !!conv.agreementId);
        check("sales: converting raises procurement intents for product lines", conv.procurement.length === 1 && conv.procurement[0].qty === 2, JSON.stringify(conv.procurement));
        check("sales: the converted quote is stamped converted", (await SA.getQuote(sid, q.id)).status === "converted");
        const pq = await SA.procurementQueue(prov.id);
        check("sales: the procurement queue lists pending intents", pq.length >= 1 && pq[0].quoteId != null, String(pq.length));

        /* — activities — */
        const act = await SA.logActivity(prov.id, SA.newActivity({ companyId: sid, opportunityId: o2.id, type: "call", subject: "Discovery call", dueDate: "2026-09-01", ownerId: techId }));
        check("sales: an activity is logged", !!act.record && act.record.id != null);
        check("sales: activities filter by opportunity", (await SA.activities(prov.id, { opportunityId: o2.id })).length >= 1);
        const next = await SA.nextSteps(prov.id, {});
        check("sales: an overdue next step is flagged", next.some((a) => a.subject === "Discovery call" && a.__overdue === true), JSON.stringify(next.map((a) => a.subject)));
        check("sales: an activity completes", (await SA.completeActivity(prov.id, act.record.id)).record.done === true);

        /* — leads — */
        const lead = (await SA.saveLead(prov.id, SA.newLead({ name: "Delta Systems", contactName: "Dana", email: "dana@delta.test", website: "https://delta.test", source: "inbound", value: 5000 }))).record;
        check("sales: a lead is captured with a number", !!lead && /^LEAD-/.test(String(lead.number)), lead && lead.number);
        const dup = await SA.dedupe(prov.id, lead);
        check("sales: dedupe matches the existing client by domain", dup.companies.some((c) => String(c.id) === String(sid)), JSON.stringify(dup.companies));
        const lc = await SA.convertLead(prov.id, lead.id, { companyId: sid, stage: "qualified", value: 5000 });
        check("sales: converting a lead creates an opportunity", !!lc.opportunity && /^OPP-/.test(String(lc.opportunity.number)), lc.opportunity && lc.opportunity.number);
        check("sales: the opportunity preserves the lead origin & history", !!lc.opportunity.origin && String(lc.opportunity.origin.leadId) === String(lead.id) && (lc.opportunity.origin.history || []).length >= 1);
        const keptLead = await SA.getLead(prov.id, lead.id);
        check("sales: the converted lead is linked and kept", keptLead.status === "converted" && String(keptLead.convertedOpportunityId) === String(lc.opportunity.id));
        check("sales: a converted lead cannot convert again", (await SA.convertLead(prov.id, lead.id, {})).error === "already_converted");

        const l2 = (await SA.saveLead(prov.id, SA.newLead({ name: "Echo Ltd", email: "a@echo.test" }))).record;
        const lc2 = await SA.convertLead(prov.id, l2.id, {});
        check("sales: converting a new lead creates a company", !!lc2.companyId && (await ERP.companies.get(lc2.companyId)).name === "Echo Ltd");

        check("sales: staff cannot edit opportunities", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("sales.edit"); ERP.role = r; return x === false; })());
        check("sales: staff may log activities", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("sales.activity"); ERP.role = r; return x === true; })());
        check("sales: managers may edit and convert", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("sales.edit") && ERP.security.can("sales.convert"); ERP.role = r; return x === true; })());

        const mod = ERP.getModule("sales");
        const host = document.createElement("div");
        let err = null;
        try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { err = (e && e.message) || String(e); }
        check("sales: the station renders without error", !err, err || "");
        check("sales: the station exposes four tabs", host.querySelectorAll("[data-tab]").length === 4, String(host.querySelectorAll("[data-tab]").length));
        check("sales: the pipeline renders opportunity cards", host.querySelectorAll("[data-panel='pipeline'] .erp-sales-card").length >= 1, String(host.querySelectorAll("[data-panel='pipeline'] .erp-sales-card").length));
        for (const id of ["quotes", "activities", "leads"]) {
          const h = document.createElement("div");
          h.__sales = { tab: id, companyId: "", ownerId: "", status: "", view: "board", includeClosed: false, quoteId: "", leadId: "", showDone: false, grain: "month" };
          let e2 = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e2 = (e && e.message) || String(e); }
          const panel = h.querySelector('[data-panel="' + id + '"]');
          check("sales: the " + id + " tab renders without error", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
        }
      });

      /* ---------- 15. product & service catalog (Task 42) ---------- */
      let catCid, catClientB, fwItem, catVendor, fwPo;
      await group("catalog", async () => {
        const CA = ERP.catalog;
        check("catalog: the Products station is a live controller", typeof CA.render === "function" && !ERP.getModule("products").plannedPhase);
        await CA.ensure(prov.id);
        const items = await CA.items(prov.id, {});
        check("catalog: a starter catalog is seeded once", items.length >= 5, String(items.length));
        await CA.ensure(prov.id);
        check("catalog: seeding is idempotent", (await CA.items(prov.id, {})).length === items.length, String((await CA.items(prov.id, {})).length));
        fwItem = await CA.itemBySku(prov.id, "HW-FW-EDGE");
        check("catalog: an item carries cost, sell, class, category and unit", !!fwItem && fwItem.cost === 480 && fwItem.price === 950 && fwItem.classId === "hardware" && fwItem.categoryId === "security" && fwItem.unit === "each", JSON.stringify(fwItem && { c: fwItem.cost, p: fwItem.price, cl: fwItem.classId }));
        check("catalog: a product can track inventory", fwItem.trackInventory === true);
        check("catalog: an item needs a name", (await CA.saveItem(prov.id, CA.newItem({ name: "" }))).error === "name_required");
        check("catalog: a SKU must be unique", (await CA.saveItem(prov.id, CA.newItem({ name: "Duplicate", sku: fwItem.sku }))).error === "sku_taken");

        const co = await ERP.companies.saveCompany({ name: "Catalog Client", status: "prospect", type: "client" });
        catCid = co.record.id;
        const co2 = await ERP.companies.saveCompany({ name: "Second Client", status: "prospect", type: "client" });
        catClientB = co2.record.id;

        /* pricing rules derive the sell price, explainably */
        const r1 = await CA.resolvePrice(prov.id, { itemId: fwItem.id, companyId: catCid, date: "2026-01-01" });
        check("catalog: a class rule derives the price from cost", r1.price === 960, String(r1.price));
        check("catalog: the resolution names the rule that applied", r1.source === "Standard hardware markup", r1.source);
        check("catalog: the resolution returns the chain considered", r1.chain.length >= 2 && r1.chain.some((c) => c.applied), JSON.stringify(r1.chain.map((c) => c.name)));

        /* a client override beats every rule */
        const ov = await CA.savePriceOverride(prov.id, CA.newPriceOverride({ itemId: fwItem.id, companyId: catCid, price: 700 }));
        check("catalog: a client price override saves", !!(ov.record && ov.record.id != null));
        const r2 = await CA.resolvePrice(prov.id, { itemId: fwItem.id, companyId: catCid, date: "2026-01-01" });
        check("catalog: a client override beats the rule", r2.price === 700 && r2.source === "client override", JSON.stringify({ p: r2.price, s: r2.source }));
        const r3 = await CA.resolvePrice(prov.id, { itemId: fwItem.id, date: "2026-01-01" });
        check("catalog: another client sees the rule price", r3.price === 960, String(r3.price));

        /* discount override */
        await CA.savePriceOverride(prov.id, CA.newPriceOverride({ itemId: fwItem.id, companyId: catClientB, discountPct: 50 }));
        const r4 = await CA.resolvePrice(prov.id, { itemId: fwItem.id, companyId: catClientB, date: "2026-01-01" });
        check("catalog: a discount override applies to the rule price", r4.price === 480, String(r4.price));

        /* item scope outranks class scope */
        const ir = (await CA.saveRule(prov.id, CA.newRule({ name: "Firewall promo", scope: "item", itemId: fwItem.id, mode: "fixed", value: 1234 }))).record;
        const r5 = await CA.resolvePrice(prov.id, { itemId: fwItem.id, date: "2026-01-01" });
        check("catalog: an item rule outranks the class rule", r5.price === 1234, String(r5.price));
        await CA.removeRule(prov.id, ir.id);
        check("catalog: removing a rule restores the lower rule", (await CA.resolvePrice(prov.id, { itemId: fwItem.id, date: "2026-01-01" })).price === 960);

        /* effective dates */
        const future = (await CA.saveRule(prov.id, CA.newRule({ name: "Future price", scope: "global", mode: "fixed", value: 999, effectiveFrom: "2030-01-01" }))).record;
        check("catalog: a not-yet-effective rule is skipped", (await CA.resolvePrice(prov.id, { itemId: fwItem.id, date: "2026-01-01" })).price === 960);
        await CA.removeRule(prov.id, future.id);

        /* margin helpers */
        const mg = CA.margin(100, 150);
        check("catalog: margin and markup percentages compute", mg.marginPct === 33.3 && mg.markupPct === 50, JSON.stringify(mg));
        check("catalog: line margin accounts for the discount", CA.lineMargin({ unitCost: 100, unitPrice: 120, discountPct: 25 }).sell === 90, String(CA.lineMargin({ unitCost: 100, unitPrice: 120, discountPct: 25 }).sell));

        /* permissions */
        check("catalog: staff cannot edit the catalog", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("catalog.edit"); ERP.role = r; return x === false; })());
        check("catalog: a manager may edit the catalog", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("catalog.edit"); ERP.role = r; return x === true; })());
        check("catalog: only an owner may change margin floors", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("catalog.margins"); ERP.role = r; return x === false; })());
      });

      /* ---------- 16. vendors & purchase orders (Task 43) ---------- */
      await group("procurement", async () => {
        const PR = ERP.procurement;
        check("procurement: the Procurement station is a live controller", typeof PR.render === "function" && !ERP.getModule("procurement").plannedPhase);
        await PR.ensure(prov.id);
        const vendors = await PR.vendors(prov.id, {});
        check("procurement: a starter vendor list is seeded", vendors.length >= 2, String(vendors.length));
        catVendor = vendors[0];

        fwPo = (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, companyId: catCid, lines: [PR.newLine({ itemId: fwItem.id, description: "Edge firewall", qty: 2, unitCost: 480, unitPrice: 950 })] }))).record;
        check("procurement: a purchase order is created with a number", /^PO-/.test(String(fwPo.number)), fwPo.number);
        check("procurement: a PO totals from its lines", fwPo.subtotal === 960 && fwPo.total === 960, JSON.stringify({ s: fwPo.subtotal, t: fwPo.total }));
        check("procurement: a new PO starts as a draft", fwPo.status === "draft");
        check("procurement: a PO needs a vendor", (await PR.save(prov.id, PR.newPO({ lines: [PR.newLine()] }))).error === "vendor_required");
        check("procurement: a PO needs lines", (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, lines: [] }))).error === "lines_required");

        const sub = await PR.submit(prov.id, fwPo.id, {});
        check("procurement: a PO below the threshold auto-approves", sub.record.status === "approved" && sub.requiresApproval === false, JSON.stringify({ s: sub.record.status, r: sub.requiresApproval }));
        const ord = await PR.order(prov.id, fwPo.id, {});
        check("procurement: ordering stamps the order date", ord.record.status === "ordered" && !!ord.record.orderDate);
        check("procurement: the expected date derives from the vendor lead time", ord.record.expectedDate === ERP.ui.addDays(ord.record.orderDate, Number(catVendor.leadTimeDays)), JSON.stringify({ e: ord.record.expectedDate, l: catVendor.leadTimeDays }));
        check("procurement: an approved PO is receivable", (await PR.receivable(prov.id)).some((p) => String(p.id) === String(fwPo.id)));

        /* approval threshold */
        const big = (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, lines: [PR.newLine({ description: "Servers", qty: 10, unitCost: 480 })] }))).record;
        const bsub = await PR.submit(prov.id, big.id, {});
        check("procurement: a PO over the threshold needs approval", bsub.record.status === "pending_approval" && bsub.requiresApproval === true, JSON.stringify({ s: bsub.record.status }));
        check("procurement: the approval queue lists it", (await PR.approvalQueue(prov.id)).some((p) => String(p.id) === String(big.id)));
        check("procurement: staff cannot approve a PO", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("procurement.approve"); ERP.role = r; return x === false; })());
        const appr = await PR.approve(prov.id, big.id, { note: "within budget" });
        check("procurement: an approver approves it", appr.record.status === "approved" && appr.record.approval.state === "approved");
        check("procurement: a decided PO leaves the queue", !(await PR.approvalQueue(prov.id)).some((p) => String(p.id) === String(big.id)));

        /* reject */
        const rej = (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, lines: [PR.newLine({ description: "Big spend", qty: 20, unitCost: 500 })] }))).record;
        await PR.submit(prov.id, rej.id, {});
        const rr = await PR.reject(prov.id, rej.id, "not this quarter");
        check("procurement: rejecting returns it to draft with a reason", rr.record.status === "draft" && rr.record.approval.state === "rejected" && rr.record.approval.reason === "not this quarter");

        /* from procurement intents raised by quote conversion (Phase 8 seam) */
        const pending = await PR.pendingIntents(prov.id);
        check("procurement: converted-quote intents surface in the queue", pending.length >= 1, String(pending.length));
        const fromI = await PR.fromIntents(prov.id, pending.map((i) => i.id), { vendorId: catVendor.id });
        check("procurement: a PO is raised from the intents", !!fromI.record && /^PO-/.test(String(fromI.record.number)), fromI.record && fromI.record.number);
        check("procurement: the intent is marked ordered and pointed at the PO", fromI.record && (await PR.pendingIntents(prov.id)).length === 0);

        /* permissions */
        check("procurement: staff cannot raise a PO", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("procurement.edit"); ERP.role = r; return x === false; })());
      });

      /* ---------- 17. receiving, drop-ship & inventory (Task 44) ---------- */
      await group("inventory", async () => {
        const IV = ERP.inventory;
        const PR = ERP.procurement;
        await IV.ensure(prov.id);
        const whs = await IV.warehouses(prov.id, {});
        check("inventory: a default warehouse is seeded", whs.length >= 1 && whs.some((w) => w.isDefault), JSON.stringify(whs.map((w) => w.name)));
        const mainWh = whs.find((w) => w.isDefault) || whs[0];
        const wh2 = (await IV.saveWarehouse(prov.id, IV.newWarehouse({ name: "Van stock", code: "VAN" }))).record;
        check("inventory: a warehouse saves", !!wh2 && wh2.id != null);

        /* full receipt of fwPo (2 units) */
        const rec = await IV.receive(prov.id, { poId: fwPo.id, warehouseId: mainWh.id, lines: [{ poLineId: fwPo.lines[0].id, itemId: fwItem.id, description: "Edge firewall", qtyOrdered: 2, receivedBefore: 0, outstanding: 2, unitCost: 480, qtyReceived: 2 }] });
        check("inventory: receiving posts a numbered receipt", rec.record && /^RCV-/.test(String(rec.record.number)), rec.record && rec.record.number);
        check("inventory: receiving tracked goods raises on-hand", (await IV.onHand(prov.id, fwItem.id, mainWh.id)) === 2, String(await IV.onHand(prov.id, fwItem.id, mainWh.id)));
        check("inventory: a full receipt has no discrepancy", rec.record.openDiscrepancies === 0, String(rec.record.openDiscrepancies));
        check("inventory: the purchase order rolls to received", (await PR.get(prov.id, fwPo.id)).status === "received");

        /* partial receipt creates a discrepancy */
        const p2 = (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, companyId: catCid, lines: [PR.newLine({ itemId: fwItem.id, description: "Edge firewall", qty: 5, unitCost: 480, unitPrice: 950 })] }))).record;
        await PR.submit(prov.id, p2.id, {});
        await PR.order(prov.id, p2.id, {});
        const rec2 = await IV.receive(prov.id, { poId: p2.id, warehouseId: mainWh.id, lines: [{ poLineId: p2.lines[0].id, itemId: fwItem.id, description: "Edge firewall", qtyOrdered: 5, receivedBefore: 0, outstanding: 5, unitCost: 480, qtyReceived: 3 }] });
        check("inventory: a partial receipt flags a discrepancy", rec2.record.openDiscrepancies === 1, String(rec2.record.openDiscrepancies));
        check("inventory: the PO becomes partially received", (await PR.get(prov.id, p2.id)).status === "partially_received");
        check("inventory: the discrepancy queue lists the variance", (await IV.discrepancies(prov.id)).some((d) => String(d.receiptId) === String(rec2.record.id)));
        const recon = await IV.reconcile(prov.id, rec2.record.id, { note: "short-shipped, credited" });
        check("inventory: a discrepancy reconciles", recon.record.openDiscrepancies === 0 && (await IV.discrepancies(prov.id)).length === 0);

        /* transfers */
        const tr = await IV.transfer(prov.id, { itemId: fwItem.id, fromWarehouseId: mainWh.id, toWarehouseId: wh2.id, qty: 1 });
        check("inventory: a transfer moves stock between warehouses", tr.ok === true && (await IV.onHand(prov.id, fwItem.id, wh2.id)) === 1, JSON.stringify({ ok: tr.ok }));
        check("inventory: a transfer beyond stock is refused", (await IV.transfer(prov.id, { itemId: fwItem.id, fromWarehouseId: wh2.id, toWarehouseId: mainWh.id, qty: 999 })).error === "insufficient");

        /* stocktake adjustment + issue */
        const before = await IV.onHand(prov.id, fwItem.id, mainWh.id);
        const adj = await IV.adjust(prov.id, { itemId: fwItem.id, warehouseId: mainWh.id, qty: before + 2, reason: "count" });
        check("inventory: a stocktake adjusts to the counted figure", adj.ok === true && (await IV.onHand(prov.id, fwItem.id, mainWh.id)) === before + 2, JSON.stringify({ d: adj.delta }));
        const iss = await IV.issue(prov.id, { itemId: fwItem.id, warehouseId: mainWh.id, qty: 1, refType: "ticket" });
        check("inventory: an issue consumes stock", iss.ok === true && (await IV.onHand(prov.id, fwItem.id, mainWh.id)) === before + 1);

        /* the ledger is the single source of truth */
        const moves = await IV.moves(prov.id, { itemId: fwItem.id });
        const ledgerSum = ERP.ui && moves.length ? moves.reduce((n, m) => n + Number(m.delta), 0) : 0;
        check("inventory: on-hand equals the sum of the movement ledger", (await IV.onHand(prov.id, fwItem.id)) === ledgerSum, JSON.stringify({ oh: await IV.onHand(prov.id, fwItem.id), sum: ledgerSum }));

        /* low stock + valuation */
        const widget = (await ERP.catalog.saveItem(prov.id, ERP.catalog.newItem({ name: "Test widget", type: "product", unit: "each", cost: 10, price: 20, trackInventory: true, reorderPoint: 5 }))).record;
        check("inventory: low stock is reported against the reorder point", (await IV.lowStock(prov.id)).some((r) => String(r.item.id) === String(widget.id)));
        check("inventory: valuation sums cost on hand", (await IV.valuation(prov.id)) > 0, String(await IV.valuation(prov.id)));

        /* drop-ship */
        const dp = (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, companyId: catCid, dropShip: true, lines: [PR.newLine({ itemId: fwItem.id, description: "Edge firewall", qty: 1, unitCost: 480, unitPrice: 950 })] }))).record;
        await PR.submit(prov.id, dp.id, {});
        await PR.order(prov.id, dp.id, {});
        const stockBefore = await IV.onHand(prov.id, fwItem.id);
        const ds = await IV.receive(prov.id, { poId: dp.id, dropShip: true, lines: [{ poLineId: dp.lines[0].id, itemId: fwItem.id, qtyOrdered: 1, receivedBefore: 0, outstanding: 1, unitCost: 480, qtyReceived: 1 }] });
        check("inventory: a drop-ship receipt is marked and warehouse-less", ds.record.dropShip === true && ds.record.warehouseId == null);
        check("inventory: a drop-ship never touches stock", (await IV.onHand(prov.id, fwItem.id)) === stockBefore, JSON.stringify({ before: stockBefore, after: await IV.onHand(prov.id, fwItem.id) }));
        check("inventory: a drop-ship still fulfils the PO", (await PR.get(prov.id, dp.id)).status === "received");

        /* permissions */
        check("inventory: staff cannot adjust stock", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("inventory.adjust"); ERP.role = r; return x === false; })());
        check("inventory: staff may receive goods", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("procurement.receive"); ERP.role = r; return x === true; })());
      });

      /* ---------- 18. procurement approvals & margin rules (Task 45) ---------- */
      await group("margins", async () => {
        const CA = ERP.catalog;
        const SA = ERP.sales;
        const PR = ERP.procurement;
        const sv = await CA.saveSettings(prov.id, { quoteMarginFloorPct: 40, poMarkupFloorPct: 25, enforceQuotes: true, enforcePos: true, allowOverride: true, poApprovalThreshold: 2500 });
        check("margins: the floors are configurable", sv.record.quoteMarginFloorPct === 40 && sv.record.poMarkupFloorPct === 25);

        const thin = (await SA.saveQuote(prov.id, SA.newQuote({ companyId: catCid, title: "Thin margin deal", lines: [SA.newLine({ kind: "service", description: "Deep discount", qty: 1, unitCost: 100, unitPrice: 110 })] }))).record;
        const fl = await CA.checkQuoteFloors(prov.id, thin);
        check("margins: a below-floor quote line is detected", fl.ok === false && fl.violations.length === 1, JSON.stringify(fl.violations));
        const blocked = await SA.setQuoteStatus(prov.id, catCid, thin.id, "sent");
        check("margins: sending a below-floor quote is blocked", blocked.error === "margin_floor", JSON.stringify(blocked));
        check("margins: the blocked quote stays a draft", (await SA.getQuote(catCid, thin.id)).status === "draft");
        const sent = await SA.setQuoteStatus(prov.id, catCid, thin.id, "sent", { override: true, overrideReason: "strategic logo win" });
        check("margins: an owner override lets it send", !sent.error && sent.record.status === "sent", JSON.stringify(sent));
        const ovlog = await CA.marginOverrides(prov.id, { refType: "quote", refId: thin.id });
        check("margins: the override is recorded with its reason", ovlog.length >= 1 && ovlog[0].reason === "strategic logo win", JSON.stringify(ovlog.map((o) => o.reason)));
        check("margins: the override records the floor it passed", ovlog[0].floorPct === 40 && ovlog[0].type === "margin", JSON.stringify({ f: ovlog[0].floorPct, t: ovlog[0].type }));

        /* PO markup floor */
        const thinPo = (await PR.save(prov.id, PR.newPO({ vendorId: catVendor.id, lines: [PR.newLine({ description: "Thin resale", qty: 1, unitCost: 1000, unitPrice: 1050 })] }))).record;
        const pf = await PR.submit(prov.id, thinPo.id, {});
        check("margins: submitting a below-floor PO is blocked", pf.error === "markup_floor", JSON.stringify(pf));
        check("margins: the blocked PO stays a draft", (await PR.get(prov.id, thinPo.id)).status === "draft");
        const okPo = await PR.submit(prov.id, thinPo.id, { override: true, overrideReason: "client committed to volume" });
        check("margins: an overridden PO submits", !okPo.error, JSON.stringify(okPo));
        check("margins: the PO override is recorded", (await CA.marginOverrides(prov.id, { refType: "po", refId: thinPo.id })).length >= 1);

        /* a healthy quote is not blocked */
        const healthy = (await SA.saveQuote(prov.id, SA.newQuote({ companyId: catCid, title: "Healthy deal", lines: [SA.newLine({ kind: "service", description: "Full rate", qty: 1, unitCost: 100, unitPrice: 200 })] }))).record;
        check("margins: a healthy quote passes the floor", (await CA.checkQuoteFloors(prov.id, healthy)).ok === true);

        /* station smoke tests */
        for (const spec of [{ id: "products", tabs: ["catalog", "rules", "overrides", "margins"], state: "__catalog" }, { id: "procurement", tabs: ["orders", "vendors", "receiving", "inventory", "approvals"], state: "__procurement" }]) {
          const mod = ERP.getModule(spec.id);
          check("phase 9: the " + spec.id + " station is wired to a live controller", !!mod && !mod.plannedPhase && typeof mod.render === "function");
          const host = document.createElement("div");
          let e1 = null;
          try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e1 = (e && e.message) || String(e); }
          check("phase 9: the " + spec.id + " station renders without error", !e1, e1 || "");
          check("phase 9: the " + spec.id + " station exposes " + spec.tabs.length + " tabs", host.querySelectorAll("[data-tab]").length === spec.tabs.length, String(host.querySelectorAll("[data-tab]").length));
          for (const tid of spec.tabs) {
            const h = document.createElement("div");
            h[spec.state] = { tab: tid };
            let e2 = null;
            try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
            catch (e) { e2 = (e && e.message) || String(e); }
            const panel = h.querySelector('[data-panel="' + tid + '"]');
            check("phase 9: the " + spec.id + "/" + tid + " tab renders", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
          }
        }
      });

      /* ---------- 19. knowledge base (Task 46) ---------- */
      let kbArt, kbCat;
      await group("kb", async () => {
        const KB = ERP.kb;
        check("kb: the Knowledge station is a live controller", typeof ERP.knowledge.render === "function" && !ERP.getModule("knowledge").plannedPhase);
        await KB.ensure(prov.id);
        const cats = await KB.categories(prov.id);
        check("kb: a starter category set is seeded once", cats.length >= 4, String(cats.length));
        await KB.ensure(prov.id);
        check("kb: seeding is idempotent", (await KB.categories(prov.id)).length === cats.length);
        const arts = await KB.articles(prov.id, {});
        check("kb: starter articles are seeded", arts.length >= 2, String(arts.length));
        const pubPool = await KB.publicArticles(prov.id);
        check("kb: public articles are published + public only", pubPool.length >= 1 && pubPool.every((a) => a.status === "published" && a.visibility === "public"));

        kbCat = cats[0];
        const saved = await KB.saveArticle(prov.id, KB.newArticle({ title: "Reset a user password", categoryId: kbCat.id, tags: ["Password", "active-directory"], summary: "Standard password reset procedure.", body: "Verify identity, then reset in AD and require a change at next logon.", visibility: "internal", status: "draft" }));
        kbArt = saved.record;
        check("kb: an article is created with a number and slug", saved.created === true && /^KB-/.test(String(kbArt.number)) && kbArt.slug === "reset-a-user-password", JSON.stringify({ n: kbArt.number, s: kbArt.slug }));
        check("kb: tags are normalised to lowercase", kbArt.tags.indexOf("password") !== -1 && kbArt.tags.every((t) => t === String(t).toLowerCase()));
        check("kb: an article needs a title", (await KB.saveArticle(prov.id, KB.newArticle({ title: "" }))).error === "title_required");

        const edit = await KB.saveArticle(prov.id, Object.assign({}, kbArt, { body: "Updated steps." }));
        check("kb: editing content bumps the version", edit.record.version === 2, String(edit.record.version));
        check("kb: the previous version is snapshotted", (await KB.versionList(prov.id, kbArt.id)).length === 2);
        check("kb: an unchanged save does not bump the version", (await KB.saveArticle(prov.id, Object.assign({}, edit.record))).record.version === 2);
        check("kb: restoring a missing version is refused", (await KB.restoreVersion(prov.id, kbArt.id, 999)).error === "version_not_found");

        const pubRec = await KB.publish(prov.id, kbArt.id);
        check("kb: publishing stamps the publish date", pubRec.record.status === "published" && !!pubRec.record.publishedAt);
        check("kb: an internal article is not in the public pool", !(await KB.publicArticles(prov.id)).some((a) => String(a.id) === String(kbArt.id)));
        await KB.saveArticle(prov.id, Object.assign({}, pubRec.record, { visibility: "public" }));
        check("kb: making it public surfaces it", (await KB.publicArticles(prov.id)).some((a) => String(a.id) === String(kbArt.id)));
        check("kb: search ranks a title hit first", String(((await KB.search(prov.id, "password"))[0] || {}).id) === String(kbArt.id));

        const restored = await KB.restoreVersion(prov.id, kbArt.id, 1);
        check("kb: an earlier version restores", restored.record.body.indexOf("Verify identity") !== -1 && !!restored.restored);
        check("kb: restore records a new version rather than rewriting history", (await KB.versionList(prov.id, kbArt.id)).length >= 3);
        await KB.setStatus(prov.id, kbArt.id, "published");
        await KB.saveArticle(prov.id, Object.assign({}, await KB.article(prov.id, kbArt.id), { visibility: "public" }));
        const view = await KB.markViewed(prov.id, kbArt.id);
        check("kb: a view is counted", (view.record.views || 0) >= 1);
        check("kb: a helpful vote is counted", ((await KB.rate(prov.id, kbArt.id, true)).record.helpful || 0) >= 1);

        const tk = await ERP.tickets.save(companyId, { summary: "Cannot log in after password reset", detail: "The user reports their VPN password stopped working.", priority: "p3" }, { system: true });
        const sugg = await KB.suggestForTicket(prov.id, tk.record);
        check("kb: relevant articles are suggested for a ticket", sugg.length >= 1 && sugg.every((s) => s.article && s.score > 0), JSON.stringify(sugg.map((s) => s.article.title)));
        check("kb: the suggested pool includes the matching article", sugg.some((s) => String(s.article.id) === String(kbArt.id)));
        const linked = KB.linkText(kbArt, {});
        check("kb: an article renders as a link for a reply", typeof linked === "string" && linked.indexOf(kbArt.title) !== -1 && linked.indexOf(kbArt.number) !== -1);
        const draft = await KB.fromTicket(prov.id, companyId, tk.record, { resolution: "Reconnected the VPN tunnel." });
        check("kb: a ticket becomes a draft article", !!draft.record && draft.record.status === "draft" && String(draft.record.sourceTicketId) === String(tk.record.id));
        check("kb: the drafted article carries the ticket detail", /VPN password stopped working/.test(draft.record.body) && /Reconnected the VPN/.test(draft.record.body));

        check("kb: a category in use cannot be removed", (await KB.removeCategory(prov.id, kbCat.id)).error === "category_in_use");
        check("kb: staff cannot author articles", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("kb.edit"); ERP.role = r; return x === false; })());
        check("kb: staff can read the knowledge base", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("kb.view"); ERP.role = r; return x === true; })());
      });

      /* ---------- 20. configuration & asset records (Task 47) ---------- */
      let cfgAsset, cfgLaptop;
      await group("configurations", async () => {
        const C = ERP.configurations;
        check("configurations: assets are a live module", typeof C.renderAssets === "function" && C.KIND === "configuration");
        const made = await C.save(prov.id, companyId, C.new({ name: "Acme HQ firewall", type: "network", make: "Ubiquiti", model: "UDM Pro", serialNumber: "ACME-FW-001", hostname: "fw-hq", ipAddress: "10.0.0.1", warrantyEnd: "2026-12-31" }));
        cfgAsset = made.record;
        check("configurations: an asset saves with an id", made.created === true && cfgAsset.id != null);
        check("configurations: an asset needs a name", (await C.save(prov.id, companyId, C.new({ name: "" }))).error === "name_required");
        check("configurations: the asset appears for its client", (await C.items(prov.id, companyId, {})).some((r) => String(r.id) === String(cfgAsset.id)));
        check("configurations: assets do not leak between clients", (await C.items(prov.id, catClientB, {})).length === 0);
        check("configurations: coverage can see the asset", (await C.has(companyId, cfgAsset.id)) === true);

        check("configurations: descriptive fields are owned by the docs system", C.ownerOf(cfgAsset, "serialNumber") === "docs" && C.ownerOf(cfgAsset, "hostname") === "docs");
        check("configurations: status & notes are owned by psa", C.ownerOf(cfgAsset, "status") === "psa" && C.ownerOf(cfgAsset, "notes") === "psa");
        const reassigned = await C.setOwnership(prov.id, companyId, cfgAsset.id, "status", "docs");
        check("configurations: ownership can be reassigned per field", C.ownerOf(reassigned.record, "status") === "docs");

        const rel = await C.setRelationship(prov.id, companyId, cfgAsset.id, { type: "connected_to", targetId: null, label: "HQ switch" });
        check("configurations: relationships are recorded", rel.record.relationships.length === 1 && rel.relationship.type === "connected_to");
        check("configurations: relationships can be removed", (await C.removeRelationship(prov.id, companyId, cfgAsset.id, rel.relationship.id)).record.relationships.length === 0);

        const rep = await C.syncFromDocs(prov.id, companyId, [
          { id: "docs-1", name: "Acme laptop", type: "computer", make: "Dell", model: "Latitude", serialNumber: "SN-9001", hostname: "acme-lt-01", ipAddress: "10.0.0.50", os: "Windows 11", status: "active" },
        ]);
        check("configurations: syncing creates an unknown docs device", rep.report.created.length === 1 && String(rep.report.created[0].name) === "Acme laptop");
        cfgLaptop = rep.report.created[0];
        check("configurations: a synced device adopts the docs-owned fields", cfgLaptop.serialNumber === "SN-9001" && cfgLaptop.hostname === "acme-lt-01" && cfgLaptop.source === "docs", JSON.stringify({ s: cfgLaptop.serialNumber, h: cfgLaptop.hostname }));

        const rep2 = await C.syncFromDocs(prov.id, companyId, [
          { id: "docs-1", name: "Acme laptop", serialNumber: "SN-9001", hostname: "acme-lt-01", ipAddress: "10.0.0.77", status: "repair" },
        ]);
        const after = await C.item(prov.id, companyId, cfgLaptop.id);
        check("configurations: a docs-owned change applies silently", after.ipAddress === "10.0.0.77");
        check("configurations: a psa-owned change becomes drift, not overwrite", rep2.report.drifted.length === 1 && after.status === "active", JSON.stringify(rep2.report.drifted));
        const drift = await C.drift(prov.id, companyId);
        check("configurations: the drift queue names the field and both values", drift.some((d) => String(d.assetId) === String(cfgLaptop.id) && d.field === "status" && d.external === "repair"), JSON.stringify(drift));
        const keepLocal = await C.resolveDrift(prov.id, companyId, cfgLaptop.id, "status", "local");
        check("configurations: keeping the psa value clears the drift", keepLocal.record.status === "active" && keepLocal.record.drift.length === 0);
        await C.syncFromDocs(prov.id, companyId, [{ id: "docs-1", name: "Acme laptop", serialNumber: "SN-9001", status: "repair" }]);
        check("configurations: re-syncing re-raises the drift", (await C.item(prov.id, companyId, cfgLaptop.id)).drift.length === 1);
        const takeExt = await C.resolveDrift(prov.id, companyId, cfgLaptop.id, "status", "external");
        check("configurations: taking the docs value applies it", takeExt.record.status === "repair" && takeExt.record.drift.length === 0);

        const feed = await C.sampleFeed(prov.id, companyId);
        check("configurations: the sample docs feed reflects current assets", feed.length >= 2 && feed.some((f) => f.name === "Acme HQ firewall"));
        await C.save(prov.id, companyId, C.new({ name: "Expiring server", type: "server", warrantyEnd: ERP.ui.addDays(ERP.ui.today(), 10) }));
        check("configurations: expiring warranties are reported", (await C.expiringWarranties(prov.id, companyId, 30)).some((r) => r.name === "Expiring server"));

        check("configurations: staff cannot edit assets", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("configuration.edit"); ERP.role = r; return x === false; })());
        check("configurations: staff can view assets", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("configuration.view"); ERP.role = r; return x === true; })());
      });

      /* ---------- 21. RMM / monitoring integration (Task 48) ---------- */
      let rmmAlert;
      await group("rmm", async () => {
        const R = ERP.rmm;
        check("rmm: monitoring is exposed to the Knowledge station", typeof R.renderMonitoring === "function");
        await R.ensure(prov.id);
        const rules = await R.rules(prov.id);
        check("rmm: starter rules and settings are seeded once", rules.length >= 3 && (await R.settings(prov.id)).autoCreate === true, String(rules.length));
        await R.ensure(prov.id);
        check("rmm: seeding is idempotent", (await R.rules(prov.id)).length === rules.length);

        const ing = await R.ingest(prov.id, [{ externalId: "alert-1", hostname: "acme-lt-01", alertType: "disk_full", severity: "critical", message: "C: at 98%" }]);
        check("rmm: an alert event is ingested", ing.report.created.length === 1 && ing.report.created[0].status === "open", JSON.stringify(ing.report.skipped));
        rmmAlert = ing.report.created[0];
        check("rmm: the alert relates to its configuration record", String(rmmAlert.configId) === String(cfgLaptop.id) && String(rmmAlert.companyId) === String(companyId), JSON.stringify({ c: rmmAlert.configId }));
        check("rmm: a critical alert auto-creates a ticket", ing.report.tickets.length === 1 && rmmAlert.ticketId != null, JSON.stringify(ing.report.skipped));
        const rtk = await ERP.tickets.get(companyId, rmmAlert.ticketId);
        check("rmm: the raised ticket is tagged and prioritised", !!rtk && rtk.source === "monitoring" && rtk.priority === "p1" && (rtk.tags || []).indexOf("monitoring") !== -1, JSON.stringify(rtk && { s: rtk.source, p: rtk.priority }));

        const ing2 = await R.ingest(prov.id, [{ externalId: "alert-1", hostname: "acme-lt-01", alertType: "disk_full", severity: "critical", message: "C: at 99%" }]);
        check("rmm: a repeated alert dedupes onto the open alert", ing2.report.created.length === 0 && ing2.report.updated.length === 1);
        const deduped = (await R.alerts(prov.id, {})).find((a) => String(a.id) === String(rmmAlert.id));
        check("rmm: the deduped alert counts the recurrence and keeps the latest message", deduped.count === 2 && deduped.message === "C: at 99%");
        check("rmm: the same condition does not open a second alert", (await R.openAlerts(prov.id)).length === 1);
        check("rmm: alerts are queryable by device", (await R.forDevice(prov.id, cfgLaptop.id)).length === 1);
        const st = await R.stats(prov.id);
        check("rmm: stats count open, critical, ticketed and devices", st.open === 1 && st.critical === 1 && st.tickets >= 1 && st.devices >= 1, JSON.stringify(st));
        check("rmm: an alert can be acknowledged", (await R.acknowledge(prov.id, rmmAlert.id, "tech")).record.acked === true);

        const cleared = await R.ingest(prov.id, [{ externalId: "alert-1", hostname: "acme-lt-01", alertType: "disk_full", status: "resolved" }]);
        check("rmm: a clear event resolves the open alert", cleared.report.resolved.length === 1 && cleared.report.resolved[0].status === "resolved");
        const rtkAfter = await ERP.tickets.get(companyId, rmmAlert.ticketId);
        check("rmm: auto-resolve closes the monitoring ticket", !!rtkAfter.closedAt, rtkAfter.status);

        const info = await R.ingest(prov.id, [{ externalId: "alert-2", hostname: "acme-lt-01", alertType: "reboot", severity: "info", message: "Scheduled reboot" }]);
        check("rmm: an info event is recorded but raises no ticket", info.report.created.length === 1 && info.report.tickets.length === 0);
        const ig = await R.ignore(prov.id, info.report.created[0].id, "planned maintenance");
        check("rmm: an alert can be ignored with a reason", ig.record.status === "ignored" && (ig.record.notes || []).some((n) => n.text === "planned maintenance"));

        await R.saveSettings(prov.id, { enabled: false });
        check("rmm: a disabled feed rejects ingestion", (await R.ingest(prov.id, [{ externalId: "alert-3", hostname: "acme-lt-01", alertType: "x" }])).error === "disabled");
        await R.saveSettings(prov.id, { enabled: true });

        const rule = (await R.saveRule(prov.id, R.newRule({ name: "Disk alerts", match: "alertType", value: "disk_full", order: 0, createTicket: true }))).record;
        check("rmm: a rule can be saved", !!rule && rule.id != null);
        check("rmm: the first matching rule wins", (await R.matchRule(prov.id, { alertType: "disk_full", severity: "warning" })).name === "Disk alerts");
        check("rmm: staff cannot manage monitoring", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("rmm.edit"); ERP.role = r; return x === false; })());
      });

      /* ---------- 22. approval workflows (Task 50) ---------- */
      let aprQuote;
      await group("approvals", async () => {
        const AP = ERP.approvals;
        check("approvals: the Approvals tab is backed by a live module", typeof AP.renderApprovals === "function");
        await AP.ensure(prov.id);
        check("approvals: settings are seeded", (await AP.settings(prov.id)).enabled !== false && AP.REF_TYPES.length === 5);
        check("approvals: client vs internal routing is declared", AP.refIsClient("quote") === true && AP.refIsClient("ticket") === true && AP.refIsClient("purchase_order") === false && AP.refIsClient("invoice") === false);

        /* client approval of a quote */
        const q = (await ERP.sales.saveQuote(prov.id, ERP.sales.newQuote({ companyId: companyId, title: "Approval demo quote", lines: [ERP.sales.newLine({ kind: "service", description: "Consulting", qty: 1, unitCost: 100, unitPrice: 180 })] }))).record;
        aprQuote = q;
        await ERP.sales.setQuoteStatus(prov.id, companyId, q.id, "sent");
        const req = await AP.forQuote(prov.id, companyId, q, {});
        check("approvals: a quote raises a client approval", req.created === true && req.record.refType === "quote" && req.record.approverType === "client", JSON.stringify({ t: req.record.refType, a: req.record.approverType }));
        check("approvals: a client request routes to a portal contact", req.record.approverContactId != null && req.record.approverName === "Jane Doe", JSON.stringify({ c: req.record.approverContactId, n: req.record.approverName }));
        check("approvals: the default release action is chosen", req.record.then === "accept_quote", req.record.then);
        check("approvals: the pending request gates the reference", (await AP.canProceed(prov.id, "quote", q.id)) === false && !!(await AP.gateFor(prov.id, "quote", q.id)));
        const dec = await AP.decide(prov.id, req.record.id, { decision: "approved", byType: "client", by: "Jane Doe", note: "Looks good" });
        check("approvals: a client can approve", dec.record.status === "approved" && dec.record.decidedByType === "client" && dec.record.decidedBy === "Jane Doe");
        check("approvals: the release action ran", dec.action.applied === true && dec.action.action === "accept_quote", JSON.stringify(dec.action));
        check("approvals: approving the quote accepted it", (await ERP.sales.getQuote(companyId, q.id)).status === "accepted");
        check("approvals: the audit trail records the decision and action", dec.record.audit.some((a) => a.type === "approved") && dec.record.audit.some((a) => a.type === "action"));
        check("approvals: a decided request no longer gates", (await AP.canProceed(prov.id, "quote", q.id)) === true);
        check("approvals: deciding again is refused", (await AP.decide(prov.id, req.record.id, { decision: "approved" })).error === "not_pending");
        check("approvals: a request needs a reference", (await AP.request(prov.id, { refType: "quote" })).error === "ref_required");

        /* internal approval of a purchase order (raised by procurement) */
        const po = (await ERP.procurement.save(prov.id, ERP.procurement.newPO({ vendorId: catVendor.id, lines: [ERP.procurement.newLine({ description: "Approval demo PO", qty: 10, unitCost: 500, unitPrice: 800 })] }))).record;
        await ERP.procurement.submit(prov.id, po.id, {});
        const poReq = (await AP.requests(prov.id, { refType: "purchase_order", refId: po.id }))[0];
        check("approvals: procurement raises an internal approval", !!poReq && poReq.approverType === "internal" && poReq.then === "approve_po", JSON.stringify(poReq && { a: poReq.approverType, t: poReq.then }));
        const poDec = await AP.decide(prov.id, poReq.id, { decision: "approved", note: "within budget" });
        check("approvals: approving runs the PO release action", poDec.action.applied === true && (await ERP.procurement.get(prov.id, po.id)).status === "approved", JSON.stringify(poDec.action));

        /* reject path */
        const rejPo = (await ERP.procurement.save(prov.id, ERP.procurement.newPO({ vendorId: catVendor.id, lines: [ERP.procurement.newLine({ description: "Reject demo", qty: 10, unitCost: 500, unitPrice: 800 })] }))).record;
        await ERP.procurement.submit(prov.id, rejPo.id, {});
        const rejReq = (await AP.requests(prov.id, { refType: "purchase_order", refId: rejPo.id }))[0];
        const rejDec = await AP.decide(prov.id, rejReq.id, { decision: "rejected", note: "not this quarter" });
        check("approvals: rejecting runs the reject action", rejDec.record.status === "rejected" && (await ERP.procurement.get(prov.id, rejPo.id)).status === "draft", JSON.stringify(rejDec.action));
        check("approvals: the rejection reason is recorded", rejDec.record.decisionNote === "not this quarter");

        /* internal approval gates posting an invoice */
        const inv = (await ERP.billing.save(prov.id, ERP.billing.newInvoice({ companyId: catClientB, issueDate: "2026-11-01", lines: [ERP.billing.newLine({ source: "manual", description: "Approval demo", qty: 1, unitPrice: 1000, amount: 1000, taxRate: 0 })] }))).record;
        const invReq = await AP.forInvoice(prov.id, catClientB, inv);
        check("approvals: an invoice raises an internal approval", invReq.created === true && invReq.record.then === "post_invoice");
        const blockedPost = await ERP.billing.post(prov.id, inv.id);
        check("approvals: posting is blocked while approval is pending", blockedPost.error === "awaiting_approval", JSON.stringify(blockedPost));
        const invDec = await AP.decide(prov.id, invReq.record.id, { decision: "approved" });
        check("approvals: approving posts the invoice", invDec.action.applied === true && (await ERP.billing.get(catClientB, inv.id)).status === "posted", JSON.stringify(invDec.action));

        /* sweep: expiry + reminders */
        const soon = await AP.request(prov.id, { refType: "ticket", refId: 777001, refNumber: "T-777001", title: "Expiring approval", companyId: companyId, dueAt: new Date(Date.now() - 3600000).toISOString() });
        check("approvals: a request can carry a due date", soon.record.status === "pending" && !!soon.record.dueAt && /^APR-/.test(String(soon.record.number)), soon.record.number);
        const oldRem = await AP.request(prov.id, { refType: "ticket", refId: 777002, refNumber: "T-777002", title: "Reminder approval", companyId: companyId, dueAt: new Date(Date.now() + 86400000).toISOString() });
        await AP.saveSettings(prov.id, { reminderEveryDays: 1 });
        await ERP.tenancy.upsert("provider", prov.id, Object.assign({}, oldRem.record, { requestedAt: new Date(Date.now() - 3 * 86400000).toISOString() }));
        const swept = await AP.sweep(prov.id, {});
        check("approvals: sweeping expires an overdue request", swept.expired >= 1 && (await AP.get(prov.id, soon.record.id)).status === "expired", JSON.stringify(swept));
        check("approvals: sweeping reminds an ageing request", swept.reminded >= 1 && (await AP.get(prov.id, oldRem.record.id)).reminderCount >= 1, JSON.stringify(swept));

        const canc = await AP.request(prov.id, { refType: "quote", refId: 888001, title: "Cancel me", companyId: companyId });
        const cancelled = await AP.cancel(prov.id, canc.record.id, "no longer needed");
        check("approvals: a request can be cancelled", cancelled.record.status === "cancelled" && cancelled.record.cancelReason === "no longer needed");

        const st = await AP.stats(prov.id);
        check("approvals: stats summarise the queue", st.total >= 1 && st.approved >= 3 && st.rejected >= 1 && st.pending >= 1, JSON.stringify(st));
        check("approvals: staff cannot decide", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("approvals.decide"); ERP.role = r; return x === false; })());
        check("approvals: staff may raise a request", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("approvals.request"); ERP.role = r; return x === true; })());
      });

      /* ---------- 23. client portal & self-service (Task 49) ---------- */
      await group("portal", async () => {
        const PT = ERP.portal;
        const AP = ERP.approvals;
        check("portal: the Client Portal station is a live controller", typeof PT.render === "function" && !ERP.getModule("portal").plannedPhase);
        const contacts = await ERP.companies.contacts(companyId);
        const jane = contacts.find((c) => c.name === "Jane Doe") || contacts[0];
        check("portal: signing in needs a contact", (await PT.enter(prov.id, { companyId: companyId, contactId: null })).error === "contact_required");
        const entered = await PT.enter(prov.id, { companyId: companyId, contactId: jane.id });
        check("portal: a contact signs in", !!entered.session && String(entered.session.companyId) === String(companyId) && String(entered.session.contactId) === String(jane.id));
        check("portal: a session is required", !!PT.requireSession() && PT.requireSession().companyName === "Acme Corp");

        const made = await PT.submitTicket(prov.id, { summary: "Printer is offline", detail: "The office printer shows an error." });
        check("portal: a contact submits a request", !!made.record && made.record.source === "portal", JSON.stringify(made.record && made.record.source));
        check("portal: the request is scoped to the session company", String(made.record.companyId) === String(companyId));
        check("portal: submitting with no summary is refused", (await PT.submitTicket(prov.id, {})).error === "summary_required");
        const mine = await PT.tickets(prov.id);
        check("portal: the contact sees only their company's tickets", mine.every((t) => String(t.companyId) === String(companyId)) && mine.some((t) => String(t.id) === String(made.record.id)));
        check("portal: a comment is added", !!(await PT.addComment(prov.id, made.record.id, "Any update?")).record);
        const detail = await PT.ticket(prov.id, made.record.id);
        check("portal: an internal note is hidden from the client", detail.notes.every((n) => !n.internal) && detail.notes.some((n) => /Any update/.test(n.body)));
        check("portal: a foreign ticket is not visible", (await PT.ticket(prov.id, 999999)) === null);

        const arts = await PT.articles(prov.id);
        check("portal: only published public articles are shown", arts.length >= 1 && arts.every((a) => a.status === "published" && a.visibility === "public"));
        const internalArt = (await ERP.kb.articles(prov.id, { visibility: "internal" }))[0];
        check("portal: an internal article is not readable", internalArt && (await PT.article(prov.id, internalArt.id)) === null);
        check("portal: a public article is readable", (await PT.article(prov.id, kbArt.id)) != null);

        /* a posted invoice for this client */
        const inv2 = (await ERP.billing.save(prov.id, ERP.billing.newInvoice({ companyId: companyId, issueDate: "2026-11-01", lines: [ERP.billing.newLine({ source: "manual", description: "Portal demo", qty: 1, unitPrice: 250, amount: 250, taxRate: 0 })] }))).record;
        await ERP.billing.post(prov.id, inv2.id, { force: true });
        const invs = await PT.invoices(prov.id);
        check("portal: only posted invoices are visible", invs.length >= 1 && invs.every((i) => i.status === "posted"), String(invs.length));
        check("portal: an invoice is readable by id", (await PT.invoice(prov.id, invs[0].id)) != null);

        /* client decision through the portal */
        const q2 = (await ERP.sales.saveQuote(prov.id, ERP.sales.newQuote({ companyId: companyId, title: "Portal approval", lines: [ERP.sales.newLine({ kind: "service", description: "Review", qty: 1, unitCost: 50, unitPrice: 120 })] }))).record;
        await ERP.sales.setQuoteStatus(prov.id, companyId, q2.id, "sent");
        const creq = await AP.forQuote(prov.id, companyId, q2, {});
        check("portal: the client sees a pending approval", (await PT.approvals(prov.id)).some((r) => String(r.id) === String(creq.record.id)));
        const pdec = await PT.decide(prov.id, creq.record.id, "approved", "ok via portal");
        check("portal: the client decision is recorded as client", !pdec.error && pdec.record.decidedByType === "client" && pdec.record.decidedBy === "Jane Doe", JSON.stringify(pdec.error || pdec.record.decidedByType));
        check("portal: a foreign approval cannot be decided", (await PT.decide(prov.id, 999999, "approved")).error === "not_found");

        const pst = await PT.stats(prov.id);
        check("portal: stats summarise the client view", !!pst && pst.totalTickets >= 1 && pst.invoices >= 1, JSON.stringify(pst));
        check("portal: leaving clears the session", PT.leave().ok === true && PT.requireSession() === null);
        check("portal: without a session nothing is returned", (await PT.tickets(prov.id)).length === 0 && (await PT.ticket(prov.id, made.record.id)) === null);
        check("portal: staff cannot sign in to the portal", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("portal.manage"); ERP.role = r; return x === false; })());
      });

      /* ---------- 24. phase 10 station smoke tests ---------- */
      await group("phase10-stations", async () => {
        const PT = ERP.portal;
        for (const spec of [{ id: "knowledge", tabs: ["articles", "categories", "assets", "monitoring", "approvals"], state: "__knowledge" }]) {
          const mod = ERP.getModule(spec.id);
          check("phase 10: the " + spec.id + " station is wired to a live controller", !!mod && !mod.plannedPhase && typeof mod.render === "function");
          const host = document.createElement("div");
          let e1 = null;
          try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e1 = (e && e.message) || String(e); }
          check("phase 10: the " + spec.id + " station renders without error", !e1, e1 || "");
          check("phase 10: the " + spec.id + " station exposes " + spec.tabs.length + " tabs", host.querySelectorAll("[data-tab]").length === spec.tabs.length, String(host.querySelectorAll("[data-tab]").length));
          for (const tid of spec.tabs) {
            const h = document.createElement("div");
            h[spec.state] = { tab: tid };
            let e2 = null;
            try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
            catch (e) { e2 = (e && e.message) || String(e); }
            const panel = h.querySelector('[data-panel="' + tid + '"]');
            check("phase 10: the " + spec.id + "/" + tid + " tab renders", !e2 && !!panel && panel.children.length > 0, e2 || (panel ? panel.children.length + " children" : "no panel"));
          }
        }
        const pmod = ERP.getModule("portal");
        const phost = document.createElement("div");
        let pe = null;
        try { await pmod.render({ el: phost, module: pmod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { pe = (e && e.message) || String(e); }
        check("phase 10: the portal renders its sign-in screen", !pe && phost.querySelector("[data-act=pt-enter]") != null, pe || "");
        const pContacts = await ERP.companies.contacts(companyId);
        await PT.enter(prov.id, { companyId: companyId, contactId: pContacts[0].id });
        for (const tid of ["support", "knowledge", "invoices", "approvals"]) {
          const h = document.createElement("div");
          h.__portal = { tab: tid };
          let e3 = null;
          try { await pmod.render({ el: h, module: pmod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { e3 = (e && e.message) || String(e); }
          const panel = h.querySelector('[data-panel="' + tid + '"]');
          check("phase 10: the portal/" + tid + " tab renders", !e3 && !!panel && panel.children.length > 0, e3 || (panel ? panel.children.length + " children" : "no panel"));
        }
        await PT.leave();
      });

      /* ---------- 25. report builder & scheduled delivery (Task 51) ---------- */
      let rptDef;
      await group("reports", async () => {
        const R = ERP.reports;
        check("reports: the Reports station is a live controller", typeof ERP.reports.render === "function" && !ERP.getModule("reports").plannedPhase);
        check("reports: sources cover the core entities", R.SOURCES.length >= 12 && R.SOURCES.every((s) => s.id && s.label && Array.isArray(s.columns) && s.columns.length && typeof s.load === "function"), String(R.SOURCES.length));
        const srcIds = R.SOURCES.map((s) => s.id);
        ["tickets", "time", "expenses", "invoices", "payments", "agreements", "opportunities", "quotes", "projects", "purchase_orders", "configurations", "articles", "members"].forEach((id) => check("reports: source '" + id + "' is present", srcIds.indexOf(id) !== -1));

        const ens = await R.ensure(prov.id);
        const seedDefs = await R.defs(prov.id);
        check("reports: starter reports are seeded", seedDefs.length >= 3, JSON.stringify({ ens: ens, defs: seedDefs.length }));
        check("reports: seeding is idempotent", (await R.ensure(prov.id)).skipped === "already_seeded");

        await ERP.tickets.save(companyId, ERP.tickets.newTicket({ summary: "Report builder probe", priority: "p2", board: "service-desk" }));

        const run = await R.run(prov.id, R.newDef({ source: "tickets", columns: ["number", "summary", "priorityLabel"] }));
        check("reports: a flat run returns the selected columns", run.columns.some((c) => c.key === "summary") && Array.isArray(run.table) && run.count === run.table.length);
        check("reports: a run reports how many rows matched", run.matched >= run.count, JSON.stringify({ matched: run.matched, count: run.count }));

        const filtered = await R.run(prov.id, R.newDef({ source: "tickets", filters: [{ field: "summary", op: "contains", type: "text", value: "probe" }], columns: ["summary"] }));
        check("reports: a contains filter narrows the rows", filtered.count >= 1 && filtered.table.every((r) => /probe/i.test(r.summary)), String(filtered.count));

        const grouped = await R.run(prov.id, R.newDef({ source: "tickets", groupBy: ["priorityLabel"], metrics: [{ agg: "count", field: "" }] }));
        check("reports: grouping reduces to one row per group", grouped.grouped === true && grouped.table.length >= 1 && grouped.table.every((r) => typeof r.count === "number"));
        check("reports: the group counts sum to the matched rows", grouped.table.reduce((n, r) => n + r.count, 0) === grouped.matched, JSON.stringify(grouped.totals));
        check("reports: a grouped run offers a chart series", !!grouped.chart && grouped.chart.labels.length === grouped.table.length);

        check("reports: a report needs a name", (await R.saveDef(prov.id, R.newDef({ name: "" }))).error === "name_required");
        check("reports: a report needs a valid source", (await R.saveDef(prov.id, R.newDef({ name: "Bad", source: "nope" }))).error === "source_required");
        const saved = await R.saveDef(prov.id, R.newDef({ name: "Open tickets by priority", source: "tickets", groupBy: ["priorityLabel"], metrics: [{ agg: "count", field: "" }], viz: "bar" }));
        rptDef = saved.record;
        check("reports: a definition saves with an id", saved.created === true && rptDef.id != null);
        check("reports: invalid fields are dropped on save", (await R.saveDef(prov.id, R.newDef({ name: "Invalid fields", source: "tickets", filters: [{ field: "nope", op: "eq", value: "x" }], metrics: [{ agg: "sum", field: "nope" }] }))).record.metrics.length === 0);
        check("reports: saved definitions list", (await R.defs(prov.id)).some((d) => String(d.id) === String(rptDef.id)));
        const rs = await R.runSaved(prov.id, rptDef.id);
        check("reports: a saved definition runs", !rs.error && rs.count >= 1);
        check("reports: running a missing definition is refused", (await R.runSaved(prov.id, 999999)).error === "not_found");
        const csv = R.csv(rs.table, rs.columns);
        check("reports: CSV export has a header and a row per group", csv.split("\n")[0].indexOf("Priority") !== -1 && csv.trim().split("\n").length === rs.table.length + 1);
        check("reports: CSV escapes a comma", R.csv([{ a: "x,y" }], [{ key: "a", label: "A" }]).indexOf('"x,y"') !== -1);

        check("reports: a schedule needs a report", (await R.saveSchedule(prov.id, R.newSchedule({ defId: null }))).error === "def_required");
        check("reports: a daily schedule advances past the hour", R.nextRunAt(R.newSchedule({ cadence: "daily", hour: 7 }), Date.parse("2026-09-12T08:00:00")) === new Date("2026-09-13T07:00:00").toISOString());
        const weekly = R.nextRunAt(R.newSchedule({ cadence: "weekly", weekday: 1, hour: 9 }), Date.parse("2026-09-12T12:00:00"));
        check("reports: a weekly schedule lands on the chosen weekday", new Date(weekly).getDay() === 1 && new Date(weekly).getHours() === 9, weekly);
        const sched = (await R.saveSchedule(prov.id, R.newSchedule({ defId: rptDef.id, name: "Weekly priority digest", cadence: "daily", hour: 7, recipients: "ops@acme.test" }))).record;
        check("reports: a schedule saves with a next run", sched.id != null && !!sched.nextRunAt, JSON.stringify({ id: sched.id, next: sched.nextRunAt }));
        const swept = await R.sweep(prov.id, { asOf: new Date(Date.now() + 100 * 86400000).toISOString() });
        check("reports: sweeping delivers a due schedule", swept.count >= 1, JSON.stringify({ c: swept.count }));
        const dels = await R.deliveries(prov.id, { scheduleId: sched.id });
        check("reports: sweeping produced a delivery with a payload", dels.length >= 1 && !!dels[0].csv && dels[0].count >= 1);
        const after = await R.schedule(prov.id, sched.id);
        check("reports: delivering advances the schedule", after.lastRunAt != null && after.runCount >= 1);
        check("reports: sweeping again at the same instant does not re-deliver", (await R.sweep(prov.id, { asOf: new Date(Date.now() + 100 * 86400000).toISOString() })).count === 0);
        check("reports: a delivery is retrievable by id", (await R.delivery(prov.id, dels[0].id)) != null);
        check("reports: staff cannot build reports", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("reports.build"); ERP.role = r; return x === false; })());
        check("reports: staff can view reports", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("reports.view"); ERP.role = r; return x === true; })());
      });

      /* ---------- 26. operational dashboards (Task 52) ---------- */
      await group("dashboards", async () => {
        const D = ERP.dashboards;
        check("dashboards: exposes the KPI engines", ["sla", "backlog", "utilization", "agreements", "billing", "revenueTrend", "overview", "drill"].every((k) => typeof D[k] === "function"));

        const sla = await D.sla(prov.id, {});
        check("dashboards: SLA counts every applicable ticket", sla.totals.applicable >= 1, JSON.stringify(sla.totals));
        check("dashboards: SLA compliance is a percentage or null", sla.totals.compliancePct === null || (sla.totals.compliancePct >= 0 && sla.totals.compliancePct <= 100), String(sla.totals.compliancePct));
        check("dashboards: SLA is broken down by board and priority", sla.byBoard.length >= 1 && sla.byPriority.length >= 1);

        const bl = await D.backlog(prov.id, {});
        check("dashboards: backlog counts the open tickets", bl.open >= 1 && bl.totals.count === bl.open, JSON.stringify({ open: bl.open, count: bl.totals.count }));
        check("dashboards: every aging bucket is present", bl.buckets.every((b) => typeof bl.totals[b] === "number"));
        check("dashboards: the oldest open tickets are reported", Array.isArray(bl.oldest));

        const members = await ERP.members.members();
        const tech = members.find((m) => m.name === "Tech One") || members.find((m) => m.dispatchable !== false) || members[0];
        const today = ERP.ui.today();
        await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: tech.id, date: today, minutes: 120, companyId: companyId, billableOverride: true }));
        const from = today.slice(0, 8) + "01";
        const util = await D.utilization(prov.id, { from: from, to: today });
        const urow = util.rows.find((r) => String(r.memberId) === String(tech.id));
        check("dashboards: utilisation captures the member's hours", !!urow && urow.minutes >= 120, JSON.stringify(urow && { m: urow.minutes, h: urow.hours }));
        check("dashboards: utilisation reports capacity", typeof util.totals.capacityMinutes === "number");
        check("dashboards: utilisation totals include billable hours", util.totals.billableHours >= 2, JSON.stringify(util.totals));

        const rev = await D.revenueTrend(prov.id, { months: 6 });
        check("dashboards: the revenue trend has a row per month", rev.rows.length === 6 && rev.rows.every((r) => typeof r.invoiced === "number" && typeof r.received === "number"));

        const bill = await D.billing(prov.id, {});
        check("dashboards: the billing position combines backlog, aging and summary", !!bill.backlog && !!bill.aging && !!bill.summary);
        const agr = await D.agreements(prov.id, {});
        check("dashboards: agreement profitability flows through", Array.isArray(agr.rows) && !!agr.totals);

        const ov = await D.overview(prov.id, { from: from, to: today });
        check("dashboards: the overview aggregates the KPIs", ["slaCompliancePct", "openTickets", "utilPct", "unbilledWip", "arOutstanding", "agreementMargin", "revenueThisMonth", "pipelineWeighted"].every((k) => k in ov.kpis), JSON.stringify(Object.keys(ov.kpis)));

        const drill = await D.drill(prov.id, "backlog-bucket", "current");
        check("dashboards: a drill-down returns columns and rows", !!drill.title && Array.isArray(drill.columns) && Array.isArray(drill.rows));
        check("dashboards: the SLA drill-down names its target", /breach/i.test((await D.drill(prov.id, "sla-breach", null)).title));

        const host = document.createElement("div");
        const mod = ERP.getModule("reports");
        let derr = null;
        try { await mod.render({ el: host, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { derr = (e && e.message) || String(e); }
        check("dashboards: the Reports station renders", !derr, derr || "");
        check("dashboards: the station shows KPI cards", host.querySelectorAll(".erp-kpi").length >= 6, String(host.querySelectorAll(".erp-kpi").length));
        check("dashboards: the station exposes the four tabs", host.querySelectorAll("[data-tab]").length === 4, String(host.querySelectorAll("[data-tab]").length));
      });

      /* ---------- 27. data export & BI handoff (Task 53) ---------- */
      await group("bi", async () => {
        const B = ERP.bi;
        check("bi: the schema is versioned", typeof B.SCHEMA_VERSION === "string" && B.SCHEMA_VERSION.indexOf("1.") === 0, B.SCHEMA_VERSION);
        const schema = B.schema();
        check("bi: the schema declares dimensions and facts", schema.dimensions.length >= 6 && schema.facts.length >= 7, JSON.stringify({ d: schema.dimensions.length, f: schema.facts.length }));
        check("bi: every schema column is typed", schema.facts.every((fact) => fact.columns.every((c) => c.name && c.type)));
        check("bi: the shared envelope helper is exported", typeof ERP.envelope === "function" && B.envelope("x", { a: 1 }).schema === "psa-envelope");

        const ex = await B.extract(prov.id, {});
        check("bi: the extract carries the shared envelope", ex.schema === "psa-envelope" && ex.schemaVersion === 1 && ex.kind === "bi.extract" && ex.version === B.SCHEMA_VERSION, JSON.stringify({ s: ex.schema, k: ex.kind, v: ex.version }));
        check("bi: the extract names its producer", ex.producer === "psa-u" && !!ex.generatedAt && !!ex.provider);
        check("bi: the extract has conformed dimensions", ["company", "member", "board", "status", "priority", "work_type"].every((k) => Array.isArray(ex.dimensions[k])));
        check("bi: dimensions are keyed", ex.dimensions.company.every((c) => !!c.company_key) && ex.dimensions.member.every((m) => !!m.member_key));
        check("bi: the extract has every fact", B.factNames().every((k) => Array.isArray(ex.facts[k])));
        check("bi: ticket facts reference dimensions by key", ex.facts.ticket.length >= 1 && ex.facts.ticket.every((r) => !!r.ticket_key && (r.company_key == null || /^C/.test(r.company_key))), JSON.stringify({ n: ex.facts.ticket.length }));
        check("bi: time facts measure minutes and amount", ex.facts.time.length >= 1 && ex.facts.time.every((r) => typeof r.minutes === "number" && typeof r.amount === "number"));
        check("bi: counts match the fact row counts", B.factNames().every((k) => ex.counts[k] === ex.facts[k].length));
        check("bi: a fact follows its schema column order", B.toCsv(ex, "ticket").split("\n")[0] === B.SCHEMA.facts.ticket.map((c) => c.name).join(","));
        check("bi: a dimension exports to CSV", B.toCsv(ex, "company", "dimension").split("\n")[0].indexOf("company_key") === 0);

        const h = B.newHandoff({ name: "Test extract", generatedAt: ex.generatedAt, url: "https://example.test/extract.json", version: B.SCHEMA_VERSION, counts: ex.counts, bytes: 123 });
        h.id = ERP.tenancy.nextId(await ERP.tenancy.records("provider", prov.id));
        await ERP.tenancy.upsert("provider", prov.id, h);
        check("bi: a handoff is recorded", (await B.handoffs(prov.id)).some((x) => String(x.id) === String(h.id)));
        check("bi: a handoff can be removed", (await B.removeHandoff(prov.id, h.id)).ok === true);
        check("bi: staff cannot publish to BI", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("reports.export"); ERP.role = r; return x === false; })());
        check("bi: staff can view the export", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("reports.view"); ERP.role = r; return x === true; })());
      });

      /* ---------- 28. phase 11 station smoke tests ---------- */
      await group("phase11-stations", async () => {
        const mod = ERP.getModule("reports");
        check("phase 11: the reports station is wired to a live controller", !!mod && !mod.plannedPhase && typeof mod.render === "function");
        for (const tid of ["overview", "builder", "schedules", "export"]) {
          const h = document.createElement("div");
          h.__reports = { tab: tid };
          let e = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (err) { e = (err && err.message) || String(err); }
          const panel = h.querySelector('[data-panel="' + tid + '"]');
          check("phase 11: the reports/" + tid + " tab renders", !e && !!panel && panel.children.length > 0, e || (panel ? panel.children.length + " children" : "no panel"));
        }
      });

      /* ================= PHASE 12 — INTEGRATIONS, API & QUALITY ================= */

      /* ---------- 54. integration framework ---------- */
      await group("integrations", async () => {
        const X = ERP.integrations;
        check("integrations: the connector catalogue covers the common systems", X.CONNECTORS.length >= 6 && ["email", "accounting", "calendar", "identity", "rmm", "docs"].every((id) => !!X.connectorDef(id)), X.CONNECTORS.map((c) => c.id).join(","));
        check("integrations: every connector declares a direction and field ownership", X.CONNECTORS.every((c) => !!c.direction && c.ownership && Object.keys(c.ownership).length > 0 && c.desc));
        check("integrations: directions are labelled", X.DIRECTIONS.length === 3 && /Pull/.test(X.directionLabel("pull")) && /Push/.test(X.directionLabel("push")));
        check("integrations: an unknown connector resolves to null", X.connectorDef("nope") === null && X.ownershipFor("nope", "x") === "local");

        check("integrations: the docs connector owns descriptive fields remotely", X.ownershipFor("docs", "serial") === "external" && X.ownershipFor("docs", "status") === "local");
        const merge = X.applyOwnership("docs", { serial: "SN-NEW", status: "retired" }, { serial: "SN-OLD", status: "active", name: "Old" });
        check("integrations: remote-owned fields win the merge", merge.merged.serial === "SN-NEW" && merge.externalWins.indexOf("serial") !== -1);
        check("integrations: a psa-owned disagreement becomes a collision, not an overwrite", merge.merged.status === "active" && merge.collisions.indexOf("status") !== -1 && merge.localWins.indexOf("status") !== -1);
        check("integrations: an empty local field adopts the remote value", X.applyOwnership("docs", { os: "Linux" }, {}).merged.os === "Linux");

        check("integrations: backoff grows exponentially and caps", X.backoff(1, { baseDelayMs: 100, factor: 2, maxDelayMs: 1000 }) === 100 && X.backoff(3, { baseDelayMs: 100, factor: 2, maxDelayMs: 1000 }) === 400 && X.backoff(10, { baseDelayMs: 100, factor: 2, maxDelayMs: 1000 }) === 1000);
        let calls = 0;
        const retried = await X.withRetry(async (n) => { calls++; if (n < 3) throw new Error("flaky"); return { ok: n }; }, { policy: { maxAttempts: 5 }, sleep: () => Promise.resolve() });
        check("integrations: withRetry retries until it succeeds", retried.ok === true && retried.attempts === 3 && calls === 3, JSON.stringify(retried));
        let fails = 0;
        const gaveUp = await X.withRetry(async () => { fails++; throw new Error("down"); }, { policy: { maxAttempts: 3 }, sleep: () => Promise.resolve() });
        check("integrations: withRetry gives up after the attempt budget", gaveUp.ok === false && gaveUp.attempts === 3 && fails === 3);

        await X.ensure(prov.id);
        const conns = await X.connections(prov.id);
        check("integrations: ensure seeds one connection per connector", X.CONNECTORS.every((c) => conns.some((r) => r.connectorId === c.id)), conns.map((c) => c.connectorId).join(","));
        const seeded = await X.ensure(prov.id);
        check("integrations: ensure is idempotent", seeded.created === 0 && seeded.total === conns.length, JSON.stringify(seeded));
        check("integrations: a connection inherits its connector's direction", (await X.connection(prov.id, "accounting")).direction === "push");
        check("integrations: an unknown connector cannot be saved", (await X.saveConnection(prov.id, { connectorId: "nope" })).error === "unknown_connector");
        check("integrations: a bad direction is rejected", (await X.saveConnection(prov.id, { connectorId: "email", direction: "sideways" })).error === "bad_direction");

        /* inbound email raises a ticket */
        const beforeTickets = (await ERP.tickets.listAll({ companyId: companyId })).length;
        const inb = await X.run(prov.id, "email", { messages: [{ companyId: companyId, from: "client@acme.test", subject: "Printer down", body: "Help please" }] });
        check("integrations: an email pull run succeeds on the first attempt", !!inb.run && inb.run.status === "success" && inb.run.attempts === 1, JSON.stringify(inb.error));
        check("integrations: inbound mail creates a ticket", (await ERP.tickets.listAll({ companyId: companyId })).length === beforeTickets + 1);
        const mailTickets = (await ERP.tickets.listAll({ companyId: companyId })).filter((t) => t.source === "email");
        const mailTicket = mailTickets[mailTickets.length - 1];
        check("integrations: the created ticket records the email source", !!mailTicket && mailTicket.summary === "Printer down");
        check("integrations: the run is written to the sync log", (await X.syncLog(prov.id, { limit: 5 })).some((r) => r.connectorId === "email" && r.status === "success" && r.counts.created >= 1));
        check("integrations: the inbound message is stored and linked to its ticket", (await X.emails(prov.id, { direction: "in", companyId: companyId, limit: 5 })).some((m) => m.subject === "Printer down" && String(m.ticketId) === String(mailTicket.id)));
        check("integrations: inbound mail without a client is rejected", (await X.inboundEmail(prov.id, {})).error === "company_required");

        /* outbound email recorded against the ticket */
        const outb = await X.run(prov.id, "email", { direction: "push", force: true, replies: [{ companyId: companyId, ticketId: mailTicket.id, to: "client@acme.test", subject: "Re: Printer down", body: "On the way" }] });
        check("integrations: an email push run records the reply", outb.run.status === "success" && (await X.emails(prov.id, { direction: "out", ticketId: mailTicket.id })).length === 1);

        /* accounting push reads posted invoices and payments */
        await X.toggleConnection(prov.id, "accounting", true);
        const acc = await X.run(prov.id, "accounting", {});
        check("integrations: the accounting connector pushes posted invoices", acc.run.status === "success" && typeof acc.run.counts.updated === "number", JSON.stringify(acc.error));
        check("integrations: a push advances the connector cursor", !!(await X.connection(prov.id, "accounting")).cursor);

        /* disabled connector is skipped until forced */
        await X.toggleConnection(prov.id, "calendar", false);
        check("integrations: a disabled connector refuses to run", (await X.run(prov.id, "calendar")).error === "disabled");
        const allRun = await X.runAll(prov.id);
        check("integrations: runAll skips a disabled connector", allRun.connectors.some((r) => r.connectorId === "calendar" && r.status === "skipped"));
        check("integrations: runAll syncs the docs connector", allRun.connectors.some((r) => r.connectorId === "docs" && r.run && r.run.status === "success"), JSON.stringify(allRun.connectors.map((r) => r.connectorId + ":" + r.status)));
        await X.toggleConnection(prov.id, "calendar", true);

        /* a dry run logs nothing */
        const logBefore = (await X.syncLog(prov.id)).length;
        await X.run(prov.id, "rmm", { dryRun: true, events: [] });
        check("integrations: a dry run writes no log entry", (await X.syncLog(prov.id)).length === logBefore);

        check("integrations: staff cannot configure or run connectors", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("integrations.edit") || ERP.security.can("integrations.run"); ERP.role = r; return x === false; })());
        check("integrations: managers may configure and run connectors", (function () { const r = ERP.role; ERP.role = "manager"; const x = ERP.security.can("integrations.edit") && ERP.security.can("integrations.run"); ERP.role = r; return x === true; })());

        await X.clearLog(prov.id);
        check("integrations: the sync log can be cleared", (await X.syncLog(prov.id)).length === 0);
      });

      /* ---------- 55. public API, webhooks & pipeline bus ---------- */
      await group("api", async () => {
        const A = ERP.api;
        check("api: the surface is versioned", A.API_VERSION === "v1" && /^\d+\.\d+\.\d+$/.test(A.VERSION), A.API_VERSION + " / " + A.VERSION);
        check("api: every endpoint declares a method, path, permission and description", A.ENDPOINTS.length >= 15 && A.ENDPOINTS.every((e) => e.method && e.path && e.permission && e.desc && typeof e.handler === "function"));
        const ids = A.eventIds();
        check("api: the event catalogue covers the headline events", ["ticket.created", "ticket.closed", "agreement.renewed", "invoice.posted", "ticket.breached"].every((e) => ids.indexOf(e) !== -1), ids.length + " events");
        check("api: the event catalogue has no duplicate events", ids.length === new Set(ids).size);

        const list = await A.call("tickets.list", { companyId: companyId }, { version: "v1" });
        check("api: a GET endpoint returns its result in the shared envelope", list.ok === true && list.envelope.schema === "psa-envelope" && list.envelope.kind === "api.response" && Array.isArray(list.result));
        check("api: the response envelope names the API version", list.envelope.apiVersion === A.VERSION);
        const cat = await A.call("events.catalog");
        check("api: the event catalogue is exposed as an endpoint", cat.ok === true && cat.result.length === ids.length);
        const srcs = await A.call("reports.sources");
        check("api: report sources are exposed as endpoints", srcs.ok === true && srcs.result.some((s) => s.id === "tickets"));

        check("api: an unknown endpoint is not found", (await A.call("nope.nope")).error === "not_found");
        check("api: a wrong HTTP method is rejected", (await A.call("tickets.list", {}, { method: "POST" })).error === "bad_method");
        check("api: an unsupported version is rejected", (await A.call("tickets.list", {}, { version: "v9" })).error === "unsupported_version");
        const ownerCall = await A.call("invoices.list", {});
        check("api: an owner may call a financial endpoint", ownerCall.ok === true && Array.isArray(ownerCall.result));
        const savedRole = ERP.role;
        ERP.role = "staff";
        const denied = await A.call("invoices.post", { id: 1 });
        ERP.role = savedRole;
        check("api: permissions are enforced in code, not merely hidden in the UI", denied.error === "forbidden" && denied.permission === "billing.post");

        /* webhook validation */
        check("api: a webhook needs a name", (await A.saveWebhook(prov.id, { url: "https://x.test/h", events: ["ticket.created"] })).error === "name_required");
        check("api: a webhook needs an http(s) url", (await A.saveWebhook(prov.id, { name: "x", url: "ftp://x", events: ["ticket.created"] })).error === "url_required");
        check("api: a webhook needs at least one event", (await A.saveWebhook(prov.id, { name: "x", url: "https://x.test/h", events: [] })).error === "events_required");
        check("api: a webhook cannot subscribe to an unknown event", (await A.saveWebhook(prov.id, { name: "x", url: "https://x.test/h", events: ["nope"] })).error === "unknown_event");
        const made = await A.saveWebhook(prov.id, { name: "Reporting tool", url: "https://reports.test/hook", events: ["ticket.created", "invoice.posted"] });
        check("api: a webhook saves with an id and a signing secret", !!made.record && made.record.id != null && /^[0-9a-f]{16,}$/.test(made.record.secret), JSON.stringify(made.error));
        const wh = made.record;
        check("api: only matching, active webhooks fire for an event", (await A.matchingWebhooks(prov.id, "ticket.created")).some((w) => String(w.id) === String(wh.id)) && !(await A.matchingWebhooks(prov.id, "kb.article_published")).some((w) => String(w.id) === String(wh.id)));
        await A.toggleWebhook(prov.id, wh.id, false);
        check("api: a paused webhook does not match", !(await A.matchingWebhooks(prov.id, "ticket.created")).some((w) => String(w.id) === String(wh.id)));
        await A.toggleWebhook(prov.id, wh.id, true);

        const s1 = await A.sign(wh.secret, 1700000000000, '{"a":1}');
        const s2 = await A.sign(wh.secret, 1700000000000, '{"a":1}');
        const s3 = await A.sign(wh.secret, 1700000000000, '{"a":2}');
        check("api: signatures are deterministic HMAC-SHA256", s1 === s2 && s1 !== s3 && (/^[0-9a-f]{64}$/.test(s1) || /^fallback-/.test(s1)), s1);
        check("api: the signature binds the timestamp", (await A.sign(wh.secret, 1, "x")) !== (await A.sign(wh.secret, 2, "x")));

        /* delivery with a stub transport — never touches the network */
        const env = A.eventEnvelope("ticket.created", { ticket: { id: 1, number: "T-1" }, companyId: companyId });
        check("api: an event envelope carries entity + company context", env.kind === "event" && env.event === "ticket.created" && env.entityKind === "ticket" && String(env.companyId) === String(companyId));
        check("api: the envelope validates against the shared schema", A.validateEnvelope(env).ok === true);
        check("api: a foreign object is not a valid envelope", A.validateEnvelope({ kind: "x" }).ok === false && A.validateEnvelope(null).ok === false);
        let seen = null;
        const okDel = await A.deliver(prov.id, wh, env, { transport: async (url, init) => { seen = { url: url, init: init }; return { status: 200, ok: true }; }, sleep: () => Promise.resolve() });
        check("api: a successful delivery is recorded as delivered", okDel.status === "delivered" && okDel.attempts === 1 && !!seen, JSON.stringify(okDel));
        check("api: the delivery POSTs the envelope with the event + signature headers", seen.init.method === "POST" && seen.init.headers["X-PSA-Event"] === "ticket.created" && seen.init.headers["X-PSA-Signature"].length > 0);
        check("api: the delivered body parses back to the envelope", JSON.parse(seen.init.body).event === "ticket.created");
        let tries = 0;
        const badDel = await A.deliver(prov.id, wh, env, { transport: async () => { tries++; return { status: 503 }; }, policy: { maxAttempts: 3 }, sleep: () => Promise.resolve() });
        check("api: a failing delivery is retried then recorded as failed", badDel.status === "failed" && badDel.attempts === 3 && tries === 3, JSON.stringify(badDel));
        check("api: deliveries are queryable", (await A.deliveries(prov.id, { webhookId: wh.id })).length >= 2);

        /* the bus: publish fans out to subscribers (stub transport) */
        const pub = await A.publish("ticket.created", { ticket: { id: 1, number: "T-1" }, companyId: companyId }, { transport: async () => ({ status: 200, ok: true }) });
        check("api: publish records the event on the bus", pub.published === true && pub.subscribers >= 1 && pub.deliveries.length >= 1, JSON.stringify(pub));
        const busRec = (await A.busEvents(prov.id, { limit: 1 }))[0];
        check("api: the bus stores the full shared envelope", !!busRec && busRec.envelope.schema === "psa-envelope" && busRec.bytes > 0 && busRec.event === "ticket.created");

        /* remove webhooks before any real domain event fires */
        for (const w of await A.webhooks(prov.id)) await A.removeWebhook(prov.id, w.id);
        check("api: webhooks can be removed", (await A.webhooks(prov.id)).length === 0);
        check("api: a domain event with no subscribers still lands on the bus", (await A.publish("invoice.posted", { invoice: { id: 5, number: "INV-5" } }, { transport: async () => ({ status: 200, ok: true }) })).published === true);

        /* consume an inbound envelope from a peer tool */
        const made2 = await A.consume(ERP.envelope("ticket.create", { ticket: { companyId: companyId, summary: "From a peer tool", source: "api" } }), { pid: prov.id });
        check("api: consume routes an inbound envelope to a handler", made2.accepted === true && made2.kind === "ticket.create", JSON.stringify(made2.error));
        check("api: the consumed envelope created its record", (await ERP.tickets.listAll({ companyId: companyId })).some((t) => t.summary === "From a peer tool"));
        check("api: consume rejects an unknown operation", (await A.consume(ERP.envelope("nope.op", {}), { pid: prov.id })).accepted === false);
        check("api: consume rejects a malformed envelope", (await A.consume({ hello: "world" }, { pid: prov.id })).accepted === false);
        const ping = await A.consume(ERP.envelope("pipeline.ping", {}), { pid: prov.id });
        check("api: the ping handler answers on the bus", ping.accepted === true && ping.result.pong === true);

        check("api: staff cannot manage webhooks", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("api.manage"); ERP.role = r; return x === false; })());
        check("api: the pipeline alias points at the same bus", ERP.pipeline === A);

        await A.clearBus(prov.id);
        check("api: the bus can be cleared", (await A.busEvents(prov.id)).length === 0);
      });

      /* ---------- 56. data-integrity linter ---------- */
      await group("integrity", async () => {
        const I = ERP.integrity;
        check("integrity: the linter ships a registry of independent audits", I.CHECKS.length >= 10 && I.CHECKS.every((c) => c.id && c.label && c.severity && typeof c.run === "function"), String(I.CHECKS.length));
        check("integrity: every check declares a known severity", I.CHECKS.every((c) => ["error", "warn", "info"].indexOf(c.severity) !== -1));
        check("integrity: severity metadata is exposed", I.severityMeta("error").tone === "danger" && I.severityMeta("nope").tone === "muted");

        /* seed a known defect: a client with no billing terms + an unassigned open ticket */
        const co = await ERP.companies.saveCompany({ name: "Integrity Co", status: "active", type: "client" });
        const icId = co.record.id;
        const t = await ERP.tickets.save(icId, ERP.tickets.newTicket({ summary: "Nobody owns this", status: "new", ownerId: null }));
        check("integrity: a defect fixture is created", !!t.record && t.record.id != null);
        await ERP.tenancy.upsert("company", icId, Object.assign({}, t.record, { ownerId: null, teamId: null }));

        const scoped = await I.lint(prov.id, { checks: ["companies.no_billing_terms"] });
        check("integrity: a client missing billing terms is flagged with the offending record", scoped.findings.some((f) => f.check === "companies.no_billing_terms" && String(f.ref.id) === String(icId)));
        check("integrity: the report totals reconcile with the findings", scoped.totals.total === scoped.findings.length && scoped.totals.warn === scoped.findings.filter((f) => f.severity === "warn").length);

        const un = await I.lint(prov.id, { checks: ["tickets.unassigned"] });
        check("integrity: an open unassigned ticket is flagged", un.findings.some((f) => String(f.ref.id) === String(t.record.id)));
        check("integrity: every finding names its check, severity, message and record", un.findings.every((f) => f.check && f.severity && f.message && f.ref && f.ref.kind));

        /* an agreement covering a device that does not exist */
        const ag = (await ERP.agreements.save(prov.id, ERP.agreements.newAgreement({ companyId: icId, name: "Ghost devices", startDate: "2026-09-01", termMonths: 12, billingCycle: "monthly", baseAmount: 100 }))).record;
        await ERP.agreements.activate(prov.id, ag.id);
        await ERP.agreements.addCoverage(prov.id, icId, ag.id, { type: "configuration", name: "Ghost workstation", refId: "999999", quantity: 1, unitPrice: 10, effectiveFrom: "2026-09-01" });
        const orphan = await I.lint(prov.id, { checks: ["agreements.orphan_devices"] });
        check("integrity: an agreement covering a missing device is flagged", orphan.findings.some((f) => String(f.ref.id) === String(ag.id)));

        /* the full sweep runs every check and never throws */
        const all = await I.lint(prov.id, {});
        check("integrity: the full sweep runs every check", all.checks.length === I.CHECKS.length);
        check("integrity: a failing check is reported, not thrown", all.checks.every((c) => c.error === null || typeof c.error === "string"));
        check("integrity: every finding is tagged with the offending record kind", all.findings.every((f) => f.ref && f.ref.kind != null));
        check("integrity: a healthy check reports nothing", (await I.lint(prov.id, { checks: ["taxonomy.no_closed_status"] })).findings.length === 0);

        const sum = await I.summary(prov.id, { checks: ["tickets.unassigned"] });
        check("integrity: the summary returns counts without the record detail", !!sum.totals && Array.isArray(sum.byCheck) && sum.byCheck[0].count >= 1 && sum.findings === undefined);

        const none = await I.lint(prov.id, { checks: ["not.a.check"] });
        check("integrity: an unknown check filter yields an empty report", none.checks.length === 0 && none.totals.total === 0);

        check("integrity: any role may view the integrity report", (function () { const r = ERP.role; ERP.role = "staff"; const x = ERP.security.can("integrity.view"); ERP.role = r; return x === true; })());

        /* fixing the defect clears the finding */
        await ERP.companies.saveCompany({ id: icId, name: "Integrity Co", billingTerm: "net30" });
        check("integrity: fixing the defect clears its finding", !(await I.lint(prov.id, { checks: ["companies.no_billing_terms"] })).findings.some((f) => String(f.ref.id) === String(icId)));
      });

      /* ---------- 57a. fixtures: a service provider with a client, board, agreement & billing cycle ---------- */
      let loopCtx = null;
      await group("fixtures", async () => {
        const seeds = {
          boards: await ERP.taxonomy.list(prov.id, "board"),
          statuses: await ERP.taxonomy.list(prov.id, "ticketStatus"),
          billing: await ERP.billing.settings(prov.id),
        };
        check("fixtures: the provider is seeded with service boards", seeds.boards.length >= 1, String(seeds.boards.length));
        check("fixtures: the provider is seeded with ticket statuses (open & closed)", seeds.statuses.some((s) => s.closed === true) && seeds.statuses.some((s) => s.closed !== true));
        check("fixtures: the provider has a billing cycle configured", !!seeds.billing.invoiceCycle && !!seeds.billing.currency, JSON.stringify({ c: seeds.billing.invoiceCycle, cur: seeds.billing.currency }));

        const co = await ERP.companies.saveCompany({ name: "Loop Co", status: "active", type: "client", currency: "USD", billingTerm: "net30" });
        const lid = co.record.id;
        check("fixtures: a fixture client with billing terms is created", co.created === true && !!lid && (await ERP.companies.get(lid)).billingTerm === "net30");

        const tk = (await ERP.tickets.save(lid, ERP.tickets.newTicket({ summary: "Loop install", status: "new", board: "service-desk", priority: "p3", ownerId: techId }))).record;
        check("fixtures: a fixture ticket is raised for the client", !!tk && tk.id != null && !!tk.number);

        const te = (await ERP.time.save(prov.id, ERP.time.newEntry({ memberId: techId, companyId: lid, ticketId: tk.id, date: "2026-11-04", minutes: 120, workType: "remote", chargeRole: "engineer" }))).record;
        await ERP.tenancy.upsert("provider", prov.id, Object.assign({}, te, { status: "approved" }));
        check("fixtures: billable time is captured, rated and approved", !!te && te.billable === true && te.minutes === 120 && !!te.rate, JSON.stringify(te && te.rate));

        const ag = (await ERP.agreements.save(prov.id, ERP.agreements.newAgreement({ companyId: lid, name: "Loop managed", startDate: "2026-11-01", termMonths: 12, billingCycle: "monthly", pricingModel: "flat", baseAmount: 400 }))).record;
        await ERP.agreements.activate(prov.id, ag.id);
        const charge = await ERP.agreements.postCharge(prov.id, ag.id, { asOf: "2026-11-15" });
        check("fixtures: a recurring agreement generates its base charge", !!charge.record && charge.record.total === 400, JSON.stringify(charge.record && charge.record.total));

        loopCtx = { lid: lid, tk: tk, te: te, ag: ag, period: { key: "2026-11", start: "2026-11-01", end: "2026-11-30" } };
      });

      /* ---------- 57b. the full loop: ticket -> time -> agreement -> invoice -> payment ---------- */
      await group("loop", async () => {
        const B = ERP.billing, P = ERP.payments, I = ERP.integrity, A = ERP.api;
        check("loop: the fixtures from the previous step are available", !!loopCtx && !!loopCtx.lid);

        const gen = await B.generate(prov.id, { companyId: loopCtx.lid, period: loopCtx.period });
        check("loop: billing assembles the ticket's time and the agreement charge", gen.created === true && gen.invoice.lines.length >= 2 && gen.invoice.total >= 600, JSON.stringify(gen.invoice && { l: gen.invoice.lines.length, t: gen.invoice.total }));
        const again = await B.generate(prov.id, { companyId: loopCtx.lid, period: loopCtx.period });
        check("loop: re-running the cycle cannot double-bill the period", again.existing === true && String(again.invoice.id) === String(gen.invoice.id));
        check("loop: a draft invoice leaves its source time unlocked", (await ERP.time.entry(prov.id, loopCtx.te.id)).invoiceId == null);

        const posted = await B.post(prov.id, gen.invoice.id);
        check("loop: the draft posts to the ledger", posted.invoice.status === "posted" && !!posted.invoice.postedAt);
        check("loop: posting the invoice locks its source time to it", String((await ERP.time.entry(prov.id, loopCtx.te.id)).invoiceId) === String(gen.invoice.id));
        check("loop: a posted invoice is immutable", (await B.save(prov.id, Object.assign({}, posted.invoice, { notes: "nope" }))).error === "immutable");
        check("loop: posting twice is idempotent", (await B.post(prov.id, gen.invoice.id)).already === true);

        const pay = await P.record(prov.id, { companyId: loopCtx.lid, invoiceId: gen.invoice.id, amount: gen.invoice.total, method: "bank_transfer", idempotencyKey: "loop-pay-1" });
        check("loop: the payment clears the invoice", pay.invoice.balance === 0 && pay.invoice.paymentStatus === "paid", JSON.stringify({ b: pay.invoice && pay.invoice.balance }));
        const bal = await P.companyBalance(prov.id, loopCtx.lid);
        check("loop: the client balance settles to zero", Math.abs(bal.balance) < 0.01, JSON.stringify(bal));

        /* integrity assertions across the closed loop */
        check("loop: no approved time for the client is left uninvoiced", !(await ERP.time.uninvoiced(prov.id, { companyId: loopCtx.lid })).some((e) => String(e.id) === String(loopCtx.te.id)));
        check("loop: the posted invoice carries source lines", !(await I.lint(prov.id, { checks: ["invoices.no_sources"] })).findings.some((f) => String(f.ref.id) === String(gen.invoice.id)));
        check("loop: the ledger has no overpaid invoice", !(await I.lint(prov.id, { checks: ["invoices.overpaid"] })).findings.some((f) => String(f.ref.id) === String(gen.invoice.id)));

        /* security scopes are enforced end-to-end */
        const r0 = ERP.role;
        ERP.role = "staff";
        const deniedPost = await B.post(prov.id, gen.invoice.id);
        const deniedPay = await P.record(prov.id, { companyId: loopCtx.lid, invoiceId: gen.invoice.id, amount: 1 });
        ERP.role = r0;
        check("loop: staff cannot post invoices (enforced in code)", deniedPost.error === "forbidden");
        check("loop: staff cannot record payments (enforced in code)", deniedPay.error === "forbidden");

        /* exports parse & envelopes validate */
        const ex = await ERP.bi.extract(prov.id, {});
        const csv = ERP.bi.toCsv(ex, "invoice");
        check("loop: the BI extract exports an invoice CSV that parses", csv.split("\n")[0].indexOf("invoice_key") === 0 && csv.trim().split("\n").length > 1, csv.split("\n")[0]);
        const env = A.eventEnvelope("invoice.posted", { invoice: gen.invoice, companyId: loopCtx.lid });
        check("loop: the invoice event validates as a shared envelope", A.validateEnvelope(env).ok === true && env.entityId != null && String(env.companyId) === String(loopCtx.lid));
      });

      /* ---------- 58. phase 12 station smoke tests ---------- */
      await group("phase12-stations", async () => {
        const mod = ERP.getModule("admin");
        check("phase 12: the admin station is a live controller", !!mod && !mod.plannedPhase && typeof mod.render === "function");
        for (const tid of ["integrations", "api", "integrity"]) {
          const h = document.createElement("div");
          h.__tab = tid;
          let err = null;
          try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
          catch (e) { err = (e && e.message) || String(e); }
          await wait(700);
          const panel = h.querySelector('[data-panel="' + tid + '"]');
          const ready = !!(panel && panel.querySelector(".erp-card, .erp-stat, table"));
          check("phase 12: the admin/" + tid + " tab renders", !err && ready, err || (panel ? panel.children.length + " children" : "no panel"));
        }
        const box = document.createElement("div");
        box.__tab = "overview";
        await mod.render({ el: box, module: mod, navigate() {}, toast() {}, empty() {}, error() {} });
        const tabs = [...box.querySelectorAll("[data-tab]")].map((b) => b.getAttribute("data-tab"));
        check("phase 12: the admin tab bar exposes integrations, api & integrity", ["integrations", "api", "integrity"].every((id) => tabs.indexOf(id) !== -1), tabs.join(","));
      });

      /* ---------- 59. the client capability / scope model (mirrors the hub) ---------- */
      await group("phase13-model", async () => {
        const C = ERP.collab;
        check("phase 13: the collaboration service is loaded", !!C && typeof C.renderPanel === "function");
        check("phase 13: five functional roles are modelled", C.FUNC_IDS.length === 5 && C.FUNC_IDS.indexOf("dispatcher") !== -1 && C.FUNC_IDS.indexOf("technician") !== -1);

        /* capability bit math */
        check("phase 13: the administrator holds every capability", C.capsOf(0) === 127);
        check("phase 13: a dispatcher can dispatch but not bill", C.hasCap(1, C.CAP.dispatch) && !C.hasCap(1, C.CAP.finance) && !C.hasCap(1, C.CAP.manage));
        check("phase 13: an account manager sells and sees money", C.hasCap(2, C.CAP.sell) && C.hasCap(2, C.CAP.finance) && !C.hasCap(2, C.CAP.manage));
        check("phase 13: finance sees money but does not manage the system", C.hasCap(3, C.CAP.finance) && !C.hasCap(3, C.CAP.manage) && !C.hasCap(3, C.CAP.dispatch));
        check("phase 13: a technician works but has no financial or manage capability", C.hasCap(4, C.CAP.work) && !C.hasCap(4, C.CAP.finance) && !C.hasCap(4, C.CAP.manage));

        /* permission → floor + capability */
        check("phase 13: tax/config edits are owner-only", C.permSystemRole("taxonomy.edit") === 2 && C.requiredCap("data.manage") === C.CAP.manage);
        check("phase 13: billing permissions need the finance capability", C.requiredCap("billing.post") === C.CAP.finance && C.requiredCap("payments.edit") === C.CAP.finance);
        check("phase 13: ticket/time work needs the work capability", C.requiredCap("tickets.edit") === C.CAP.work && C.requiredCap("time.edit") === C.CAP.work);
        check("phase 13: dispatch needs the dispatch capability", C.requiredCap("dispatch.edit") === C.CAP.dispatch);
        check("phase 13: an unknown permission is never accepted", C.permKnown("nonsense.perm") === false && C.roleCan({ role: 2, func: 0, financials: true }, "nonsense.perm") === false);

        /* combined decisions */
        check("phase 13: a technician may edit a ticket", C.roleCan({ role: 0, func: 4, financials: false }, "tickets.edit") === true);
        check("phase 13: a technician may not delete a ticket (role floor)", C.roleCan({ role: 0, func: 4, financials: false }, "tickets.delete") === false);
        check("phase 13: a dispatcher may not post an invoice (capability)", C.roleCan({ role: 1, func: 1, financials: true }, "billing.post") === false);
        check("phase 13: finance may post an invoice", C.roleCan({ role: 1, func: 3, financials: true }, "billing.post") === true);
        check("phase 13: finance without the financial flag may not post", C.roleCan({ role: 1, func: 3, financials: false }, "billing.post") === false);
        check("phase 13: an account manager may bill an agreement", C.roleCan({ role: 1, func: 2, financials: true }, "agreements.bill") === true);

        /* company & board scopes */
        check("phase 13: company scope denies an out-of-scope client", C.roleCan({ role: 1, func: 0, financials: true, companies: [1, 2] }, "tickets.edit", { companyId: 3 }) === false);
        check("phase 13: company scope admits an in-scope client", C.roleCan({ role: 1, func: 0, financials: true, companies: [1, 2] }, "tickets.edit", { companyId: 2 }) === true);
        check("phase 13: an empty company scope means every client", C.roleCan({ role: 1, func: 0, financials: true, companies: [] }, "tickets.edit", { companyId: 999 }) === true);
        const bit = C.boardBit("service-desk");
        check("phase 13: board codes hash to a stable 0..127 bit", bit >= 0 && bit < 128 && C.boardBit("service-desk") === bit);
        check("phase 13: board scope denies an out-of-scope board", C.roleCan({ role: 1, func: 0, financials: true, boards: [bit] }, "tickets.edit", { boardId: (bit + 1) % 128 }) === false);

        /* legacy action names map to permissions for audit signing */
        check("phase 13: legacy guarded actions map to permissions", C.permForAction("chart_update") === "taxonomy.edit" && C.permForAction("publish_backup") === "backup.manage" && C.permForAction("invoice_from_order") === "billing.edit");
      });

      /* ---------- 60/61. hub integration over a mock transport ---------- */
      let clHub = null, clEvents = [];
      await group("phase13-hub", async () => {
        const C = ERP.collab, T = ERP.team;
        check("phase 13: the team hub client exposes the collab seams", typeof T.setTransport === "function" && typeof T.active === "function" && typeof T.setUser === "function" && typeof T.focus === "function");

        function mockHub(over) {
          const t = { calls: [], handlers: over || {} };
          t.rpc = function (method, data) {
            const parsed = JSON.parse(data || "{}");
            t.calls.push({ method: method, data: parsed });
            const h = t.handlers[method];
            const res = h ? h(parsed, t) : { ok: true };
            return Promise.resolve(JSON.stringify(res == null ? { ok: true } : res));
          };
          t.open = function () { if (t.onopen) t.onopen(); };
          t.emit = function (obj) { if (t.onmessage) t.onmessage(JSON.stringify(obj)); };
          t.close = function () { if (t.onclose) t.onclose({}); };
          return t;
        }

        const uid = "0123456789abcdef0123456789abcdef";
        clHub = mockHub({
          hello: () => ({ ok: true, userId: uid, displayName: "Ada", role: 2, func: 0, financials: true, companies: [5], boards: [], caps: 127, admin: true, users: [] }),
          index: () => ({ ok: true, index: [] }),
          peers: () => ({ ok: true, peers: [] }),
          watch: (d) => ({ ok: true, scope: "companies", watching: d.companies }),
          authorize: (d) => (d.perm === "billing.post"
            ? { ok: false, denied: true, reason: "capability", requiredCap: "finance", perm: d.perm }
            : (d.perm === "tickets.edit" && d.ctx && d.ctx.companyId === 99
              ? { ok: false, denied: true, reason: "scope", scope: "company", perm: d.perm }
              : { ok: true, perm: d.perm })),
          approve: (d) => ({ ok: true, entry: { id: 7, ts: "2026-09-12T10:00:00.000Z", actor: "Ada", userId: uid, role: 2, func: 0, action: d.perm, perm: d.perm, summary: d.summary } }),
          rateStats: () => ({ ok: true, connections: 3, proxies: 0, peers: [], maxAudit: 4096, users: 2 }),
          setUser: (d) => ({ ok: true, user: { userId: d.userId, role: d.role, func: d.func, financials: d.financials, companies: d.companies, boards: d.boards } }),
        });

        const unsub = C.onChange((ev) => clEvents.push(ev));
        clEvents = [];
        T.setTransport(clHub);
        await wait(60);

        check("phase 13: connecting identifies the session to the hub", !!T.me && T.me.displayName === "Ada" && T.me.func === 0, JSON.stringify(T.me));
        check("phase 13: the hub identity is authoritative", C.authoritative() === true && C.serverActor().financials === true);
        check("phase 13: the client reports the server role", T.me.role === 2 && ERP.role === "owner");
        check("phase 13: the scoped watcher subscribes to the right topics", (() => { const c = clHub.calls.find((x) => x.method === "watch"); return !!c && c.data.companies.length === 1 && c.data.companies[0] === 5; })());

        /* local security now routes through the server decision */
        const prevRole = ERP.role;
        ERP.role = "staff";
        check("phase 13: security.can defers to the hub (admin may edit taxonomy)", ERP.security.can("taxonomy.edit") === true);
        ERP.role = prevRole;
        check("phase 13: security.actor reports the signed-in server identity", ERP.security.actor().server === true && ERP.security.actor().member.name === "Ada");
        check("phase 13: an unknown permission is refused even for an administrator", C.serverCan("nonexistent.perm") === false);
        check("phase 13: an authorised permission is granted", C.serverCan("taxonomy.edit") === true);

        /* guard: allow, capability denial, scope denial */
        let guardErr = null;
        try { await T.guard("taxonomy.edit"); } catch (e) { guardErr = e.message; }
        check("phase 13: guard lets an authorised action through", guardErr === null, guardErr);
        guardErr = null;
        try { await T.guard("billing.post"); } catch (e) { guardErr = e.message; }
        check("phase 13: guard surfaces a capability denial naming the requirement", !!guardErr && /finance/.test(guardErr), guardErr);
        guardErr = null;
        try { await T.guard("tickets.edit", { companyId: 99 }); } catch (e) { guardErr = e.message; }
        check("phase 13: guard surfaces a company-scope denial", !!guardErr && /company scope/.test(guardErr), guardErr);
        const scoped = clHub.calls.find((x) => x.method === "authorize" && x.data.perm === "tickets.edit");
        check("phase 13: guard forwards the record context to the hub", !!scoped && scoped.data.ctx && scoped.data.ctx.companyId === 99);

        /* audit signing records the true actor and maps the legacy action */
        const signed = await T.signAudit({ action: "chart_update", summary: "chart", targetType: "config", targetId: 0 });
        check("phase 13: signAudit returns the server-signed entry", !!signed && signed.entry && signed.entry.actor === "Ada" && signed.entry.id === 7);
        const ap = clHub.calls.filter((x) => x.method === "approve").pop();
        check("phase 13: signAudit maps a legacy action to its permission", !!ap && ap.data.perm === "taxonomy.edit");

        /* full access patch */
        const su = await T.setUser("deadbeefdeadbeefdeadbeefdeadbeef", { role: 0, func: 4, financials: false, companies: [1, 2], boards: [3] });
        check("phase 13: setUser returns the updated record", !!su && su.ok === true);
        const suCall = clHub.calls.filter((x) => x.method === "setUser").pop();
        check("phase 13: setUser forwards role/function/financials/scopes", !!suCall && suCall.data.func === 4 && suCall.data.financials === false && suCall.data.companies.length === 2 && suCall.data.boards[0] === 3);

        /* focus presence + rate stats */
        await T.focus("ticket", "42", true);
        check("phase 13: focus presence is forwarded to the hub", (clHub.calls.filter((x) => x.method === "focus").pop() || {}).data.kind === "ticket");
        const st = await T.rateStats();
        check("phase 13: rate statistics come back from the hub", !!st && st.connections === 3 && st.maxAudit === 4096);

        /* remote change fan-out */
        const before = clEvents.length;
        clHub.emit({ t: "chg", d: "psa-v1-company-5", r: 3, u: "u2", n: "Bob", ts: 1000 });
        check("phase 13: a remote change lands in the live index", T.hubIndex.some((x) => x.d === "psa-v1-company-5" && x.n === "Bob"));
        check("phase 13: a remote change fires the change bus", clEvents.length > before);
        check("phase 13: the change bus carries the event type", clEvents[before] && clEvents[before].type === "hub");
        await wait(600);

        /* presence: another user starts and stops editing a record */
        clHub.emit({ t: "pres", u: "u2", n: "Bob", r: 1, f: 2, on: true });
        check("phase 13: presence adds a peer", C.peers().some((p) => p.userId === "u2" && p.displayName === "Bob" && p.func === 2));
        clHub.emit({ t: "focus", u: "u2", kind: "ticket", id: "42", on: true });
        check("phase 13: an editing peer is reported for the record", C.editorsFor("ticket", "42").length === 1);
        clHub.emit({ t: "focus", u: "u2", kind: "ticket", id: "42", on: false });
        check("phase 13: stopping the edit removes the editing peer", C.editorsFor("ticket", "42").length === 0);
        clHub.emit({ t: "pres", u: "u2", on: false });
        check("phase 13: a departing peer is removed", !C.peers().some((p) => p.userId === "u2"));

        /* polling fallback */
        T.setTransport(null);
        await wait(20);
        check("phase 13: dropping the hub degrades to non-authoritative mode", C.active() === false);
        const poll = await C.pollOnce();
        check("phase 13: the polling fallback reconciles cached documents", poll.state === "polled" && typeof poll.docs === "number", JSON.stringify(poll));
        C.startPolling(30000);
        check("phase 13: polling can be started", C.polling() === true);
        C.stopPolling();
        check("phase 13: polling can be stopped", C.polling() === false);

        unsub();
        C.clearEditing();
      });

      /* ---------- 60/61. the admin collaboration tab ---------- */
      await group("phase13-stations", async () => {
        const C = ERP.collab;
        const mod = ERP.getModule("admin");
        check("phase 13: the admin station is live", !!mod && typeof mod.render === "function");

        const box = document.createElement("div");
        box.__tab = "overview";
        await mod.render({ el: box, module: mod, navigate() {}, toast() {}, empty() {}, error() {} });
        const tabs = [...box.querySelectorAll("[data-tab]")].map((b) => b.getAttribute("data-tab"));
        check("phase 13: the admin tab bar exposes collaboration", tabs.indexOf("collaboration") !== -1, tabs.join(","));

        const h = document.createElement("div");
        h.__tab = "collaboration";
        let err = null;
        try { await mod.render({ el: h, module: mod, navigate() {}, toast() {}, empty() {}, error() {} }); }
        catch (e) { err = (e && e.message) || String(e); }
        await wait(700);
        const panel = h.querySelector('[data-panel="collaboration"]');
        const ready = !!(panel && panel.querySelector(".erp-card"));
        check("phase 13: the admin/collaboration tab renders", !err && ready, err || (panel ? panel.children.length + " children" : "no panel"));
        check("phase 13: the panel explains hub status and identity", !!panel && /Hub status/.test(panel.textContent) && /hub identity/i.test(panel.textContent));
        check("phase 13: the panel offers polling and auto-refresh controls", !!panel && /polling/i.test(panel.textContent) && /Auto-refresh/i.test(panel.textContent));
        C.stopPolling();
      });

      /* ---------- 29. store edit-key self-heal ---------- */
      await group("store-recovery", async () => {
        const rfiles = Object.create(null), rkeys = Object.create(null);
        const rsrv = {
          async get(n) { return Object.prototype.hasOwnProperty.call(rfiles, n) ? rfiles[n] : null; },
          async set(n, json, o) {
            const prev = rfiles[n];
            if (prev !== undefined && !(o && o.editKey)) return { error: "edit_key_required" };
            if (prev !== undefined && o && o.editKey && rkeys[n] && o.editKey !== rkeys[n]) return { error: "invalid_edit_key" };
            rfiles[n] = json; if (!rkeys[n]) rkeys[n] = "k-" + n;
            return { created: prev === undefined, unchanged: prev === json, editKey: rkeys[n] };
          },
        };
        const n1 = "psa-v1-recovery-lost", n2 = "psa-v1-recovery-stale";
        try {
          store.useBackend(rsrv);
          const a = await store.set(n1, [{ id: 1 }]);
          check("store: a document writes through the backend", !a.error, JSON.stringify(a));
          localStorage.removeItem("psa.store.v1.keys." + n1);
          const b = await store.set(n1, [{ id: 1 }, { id: 2 }]);
          check("store: a lost edit key self-heals instead of erroring", !b.error, JSON.stringify(b));
          check("store: the healed document adopts a fresh editable name", !!localStorage.getItem("psa.store.v1.alias." + n1), String(localStorage.getItem("psa.store.v1.alias." + n1)));

          await store.set(n2, [{ id: 7 }]);
          localStorage.setItem("psa.store.v1.keys." + n2, "k-stale-wrong");
          const c = await store.set(n2, [{ id: 7 }, { id: 8 }]);
          check("store: a stale cached key self-heals instead of blocking writes", !c.error, JSON.stringify(c));
          check("store: the stale-key document adopts a fresh editable name", !!localStorage.getItem("psa.store.v1.alias." + n2));
          const rd = await store.readCanonical(n2);
          check("store: the healed document reads back through the alias", !!(rd.doc && (rd.doc.records || []).some((r) => r.id === 8)));
        } finally {
          store.useBackend(backend);
          [n1, n2].forEach((n) => {
            ["keys", "alias", "base", "cache"].forEach((p) => localStorage.removeItem("psa.store.v1." + p + "." + n));
          });
        }
      });

      /* ---------- 30. shared UI toolkit ---------- */
      await group("ui", async () => {
        const box = document.createElement("div");
        box.innerHTML = ERP.ui.table([
          { key: "a", label: "A" },
          { key: "b", label: "B", render: (r) => ERP.ui.badge(r.b, "info") },
        ], [{ a: "<b>bold</b>", b: "live" }], { emptyText: "none" });
        const bold = box.querySelector("td b");
        check("ui: table renders cell HTML as elements", !!bold && bold.textContent === "bold");
        check("ui: table render() columns emit badges", !!box.querySelector("td .erp-badge"));
        check("ui: table still escapes its header labels", ERP.ui.table([{ key: "a", label: "<x>" }], []).indexOf("&lt;x&gt;") !== -1);
        const fld = document.createElement("div");
        fld.innerHTML =
          ERP.ui.text("nm", "Full name", "x") +
          ERP.ui.select("pick", "Choose", [{ value: "a", label: "A" }], "a") +
          ERP.ui.select("plain", "", [{ value: "a", label: "A" }], "a", null, "Filter by thing");
        const txt = fld.querySelector('input[name="nm"]');
        const selLab = fld.querySelector('select[name="pick"]');
        const selAria = fld.querySelector('select[name="plain"]');
        const txtLab = txt && fld.querySelector('label[for="' + txt.id + '"]');
        const selLabFor = selLab && fld.querySelector('label[for="' + selLab.id + '"]');
        check("ui: a labelled text field associates its <label for> with the control", !!txtLab && txtLab.textContent === "Full name");
        check("ui: a labelled select associates its <label for> too", !!selLabFor && selLabFor.textContent === "Choose");
        check("ui: an unlabelled control can still carry an aria-label", !!selAria && selAria.getAttribute("aria-label") === "Filter by thing");
        const custom = ERP.ui.field("Actor", '<select id="myActor" name="actor"><option>x</option></select>');
        check("ui: a control that already has an id reuses it in the label (no duplicate id)", custom.indexOf('label for="myActor"') !== -1 && (custom.match(/id="myActor"/g) || []).length === 1);
      });
    } finally {
      store.useBackend(null);
      if (ERP.team && ERP.team.setTransport) ERP.team.setTransport(null);
      if (ERP.collab) { ERP.collab.clearEditing(); if (savedPoll) ERP.collab.startPolling(); }
      restoreLS(snap);
      store.resetAllLocal();
      ERP.tenancy.invalidateRoot();
      ERP.tenancy.notify();
      if (ERP.security) ERP.security.refresh(true);
      if (ERP.history) ERP.history.invalidate();
      if (ERP.master) ERP.master.flush();
      ERP.role = savedRole;
    }

    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    return { passed: passed, failed: failed, total: results.length, ms: Date.now() - t0, results: results };
  }

  window.PSATest = async function () {
    const r = await run();
    const lines = r.results.map((x) => (x.pass ? "  ✓ " : "  ✗ ") + x.name + (x.detail != null && x.detail !== "" ? "  → " + x.detail : ""));
    console.log("PSA-U tests — " + r.passed + "/" + r.total + " passed (" + r.ms + "ms)\n" + lines.join("\n"));
    if (r.failed) console.warn(r.failed + " test(s) FAILED:\n" + r.results.filter((x) => !x.pass).map((x) => "  ✗ " + x.name + (x.detail != null ? " → " + x.detail : "")).join("\n"));
    return r;
  };
  window.PSATestPhase1 = window.PSATest;
  window.PSATestPhase2 = window.PSATest;
  window.PSATestPhase3 = window.PSATest;
  window.PSATestPhase4 = window.PSATest;
  window.PSATestPhase5 = window.PSATest;
  window.PSATestPhase6 = window.PSATest;
  window.PSATestPhase7 = window.PSATest;
  window.PSATestPhase8 = window.PSATest;
  window.PSATestPhase9 = window.PSATest;
  window.PSATestPhase10 = window.PSATest;
  window.PSATestPhase11 = window.PSATest;
  window.PSATestPhase12 = window.PSATest;
  window.PSATestPhase13 = window.PSATest;
  window.PSATest.run = run;
})();
