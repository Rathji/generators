/* ============================================================
   BUSINESS ERP — CRM module (Tasks 10–13)
   - Parties tab (Task 6 UI): master party directory — typed
     customer/supplier/both, contacts, addresses, tax id, payment
     terms, credit limit, active flag; add/edit/merge/deactivate.
     Backed by ERP.master (single rename/merge updates the whole
     system).
   - Records tab (Task 10): per-party CRM records with source,
     owner, status, tags, activity timeline, and dated reminders.
   - Pipeline tab (Tasks 11–12): opportunity pipeline with stages
     lead → qualified → proposal → won / lost, a board view (cards
     with totals per stage), a list view, filters, per-party
     history, and "create project" for won opportunities.
   - Ports tab (Task 13): paste-import idea-incubator bundles
     (incubated ideas become qualified leads) and export won
     opportunities as project seeds.
   Data lives in the crm document (splitByYear: false). The
   controller renders into the module view via ERP.ui.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const store = ERP.store;
  const master = ERP.master;
  const C = (ERP.crm = {});

  const esc = ui.esc;

  const STAGES = [
    { id: "lead", label: "Lead", tone: "muted" },
    { id: "qualified", label: "Qualified", tone: "info" },
    { id: "proposal", label: "Proposal", tone: "warn" },
    { id: "won", label: "Won", tone: "success" },
    { id: "lost", label: "Lost", tone: "danger" },
  ];
  const STAGE_MAP = {};
  STAGES.forEach((s) => (STAGE_MAP[s.id] = s));
  const FLOW = ["lead", "qualified", "proposal", "won", "lost"];

  const REC_STATUS = [
    { id: "new", label: "New", tone: "info" },
    { id: "contacted", label: "Contacted", tone: "muted" },
    { id: "active", label: "Active", tone: "success" },
    { id: "inactive", label: "Inactive", tone: "danger" },
  ];
  const REC_MAP = {};
  REC_STATUS.forEach((s) => (REC_MAP[s.id] = s));

  const REC_SOURCES = ["website", "referral", "event", "cold call", "ad", "partner", "other"];

  /* ─────────────────────────── data helpers ─────────────────────────── */

  let cache = null;
  async function records() {
    if (cache) return cache;
    const r = await store.loadDoc("crm");
    cache = (r.records || []).slice();
    return cache;
  }
  C.records = records;
  C.invalidate = () => { cache = null; };

  async function save(list) {
    const r = await store.saveDoc("crm", list || []);
    cache = (list || []).slice();
    return r;
  }

  async function parties() { return master.parties(); }

  function nextId(list) { return master.nextId(list); }

  function byKind(list, kind) { return (list || []).filter((r) => (r.kind || "record") === kind); }
  C.byKind = byKind;

  async function partyName(id) {
    if (id == null || id === "") return "";
    return master.partyName(id);
  }

  function activityRec(rec, type, summary) {
    const act = rec.activity || (rec.activity = []);
    act.push({ id: Date.now(), ts: new Date().toISOString(), type: type || "note", summary: summary || "", by: ERP.role || "owner" });
  }

  /* ─────────────────────────── modal forms ─────────────────────────── */

  function partyFields(p) {
    p = p || {};
    const contacts = (p.contacts || []).map((c) => c.name + (c.email ? " <" + c.email + ">" : "")).join("\n");
    const addresses = (p.addresses || []).map((a) => (a.label ? a.label + ": " : "") + (a.city || "")).join("\n");
    return (
      ui.text("name", "Name *", p.name, "Acme Trading Co") +
      ui.select("type", "Type", ["customer", "supplier", "both"], p.type || "customer") +
      ui.text("taxId", "Tax ID", p.taxId) +
      ui.select("paymentTerms", "Payment terms", ["immediate", "net15", "net30", "net60", "net90"], p.paymentTerms || "net30") +
      ui.number("creditLimit", "Credit limit", p.creditLimit == null ? "" : p.creditLimit, { min: 0 }) +
      ui.textarea("contacts", "Contacts (one per line: Name <email>)", contacts, 2) +
      ui.textarea("addresses", "Addresses (one per line: Label: City)", addresses, 2) +
      ui.check("active", "Active", p.active !== false)
    );
  }

  function parseParty(fields) {
    const contacts = String(fields.contacts || "").split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const m = l.match(/^(.*?)\s*<([^>]+)>\s*$/);
        return m ? { name: m[1].trim(), email: m[2].trim(), primary: false } : { name: l, email: "", primary: false };
      });
    const addresses = String(fields.addresses || "").split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const m = l.match(/^([^:]+):\s*(.*)$/);
        return m ? { label: m[1].trim(), city: m[2].trim() } : { label: "", city: l };
      });
    return {
      name: (fields.name || "").trim(),
      type: fields.type || "customer",
      taxId: (fields.taxId || "").trim(),
      paymentTerms: fields.paymentTerms || "net30",
      creditLimit: fields.creditLimit == null ? 0 : Number(fields.creditLimit),
      active: fields.active !== false,
      contacts, addresses,
    };
  }

  function partyModal(p, partiesAll, onSave) {
    const isNew = !p;
    const m = ui.modal({
      title: isNew ? "Add party" : "Edit " + (p.name || "party"),
      size: "lg",
      body: ui.form(partyFields(p)),
      foot: ui.btn("Cancel", { small: true, act: "p-cancel" }) + " " + ui.btn(isNew ? "Add party" : "Save changes", { small: true, primary: true, act: "p-save" }),
    });
    m.querySelector("[data-act=p-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=p-save]").onclick = async (t) => {
      const fields = ui.collect(m, ["name", "type", "taxId", "paymentTerms", "creditLimit", "active", "contacts", "addresses"]);
      if (!fields.name) { ERP.toast("Name is required.", "error"); return; }
      const merged = Object.assign({}, p || {}, parseParty(fields), { updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner" });
      if (isNew) merged.id = nextId(partiesAll); merged.createdAt = new Date().toISOString();
      t.disabled = true;
      try {
        await onSave(merged, isNew);
        ui.closeModal();
      } catch (e) {
        t.disabled = false;
        ERP.toast("Could not save: " + ((e && e.message) || e), "error");
      }
    };
  }

  function recordFields(rec, partiesAll, forOpp) {
    rec = rec || {};
    const partyOpts = partiesAll.map((p) => ({ value: p.id, label: p.name }));
    const srcOpts = forOpp ? [] : REC_SOURCES;
    return (
      ui.select("partyId", "Party", partyOpts, rec.partyId, "Choose a party…") +
      (forOpp ? "" :
        ui.select("source", "Source", srcOpts, rec.source, "website") +
        ui.text("owner", "Owner", rec.owner) +
        ui.select("status", "Status", REC_STATUS.map((s) => s.id), rec.status || "new")) +
      ui.text("tags", "Tags (comma separated)", (rec.tags || []).join(", ")) +
      ui.dateInput("firstContact", "First contact", rec.firstContact) +
      ui.textarea("notes", "Notes", rec.notes, 3)
    );
  }

  function recordModal(rec, partiesAll, onSave, opts) {
    const isNew = !rec;
    const forOpp = opts && opts.opportunity;
    const title = forOpp ? (isNew ? "New opportunity" : "Edit opportunity") : (isNew ? "New CRM record" : "Edit CRM record");
    const m = ui.modal({
      title,
      size: "lg",
      body: ui.form(recordFields(rec, partiesAll, forOpp)),
      foot: ui.btn("Cancel", { small: true, act: "r-cancel" }) + " " + ui.btn(isNew ? "Create" : "Save changes", { small: true, primary: true, act: "r-save" }),
    });
    m.querySelector("[data-act=r-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=r-save]").onclick = async (t) => {
      const names = forOpp ? ["partyId", "tags", "firstContact", "notes"] : ["partyId", "source", "owner", "status", "tags", "firstContact", "notes"];
      const fields = ui.collect(m, names);
      const merged = Object.assign({}, rec || {}, {
        partyId: fields.partyId == null || fields.partyId === "" ? null : Number(fields.partyId),
        tags: String(fields.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
        firstContact: fields.firstContact || null,
        notes: fields.notes || "",
      }, forOpp ? {} : {
        source: fields.source || "website",
        owner: fields.owner || "",
        status: fields.status || "new",
      }, { updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner" });
      if (forOpp && !rec) merged.stage = "lead"; merged.value = rec && rec.value != null ? rec.value : 0; merged.expectedClose = (rec && rec.expectedClose) || null;
      if (!merged.partyId) { ERP.toast("Choose a party.", "error"); return; }
      t.disabled = true;
      try {
        await onSave(merged, isNew);
        ui.closeModal();
      } catch (e) { t.disabled = false; ERP.toast("Could not save: " + ((e && e.message) || e), "error"); }
    };
  }

  /* ─────────────────────────── Parties tab ─────────────────────────── */

  async function renderParties(panel, partiesAll, recordsAll, onChanged) {
    const searchVal = panel.__search || "";
    const typeVal = panel.__type || "all";
    const q = searchVal.toLowerCase();
    const rows = partiesAll
      .filter((p) => (typeVal === "all" || p.type === typeVal) && (!q || (p.name || "").toLowerCase().indexOf(q) !== -1 || (p.taxId || "").toLowerCase().indexOf(q) !== -1))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const customers = partiesAll.filter((p) => p.type === "customer" || p.type === "both").length;
    const suppliers = partiesAll.filter((p) => p.type === "supplier" || p.type === "both").length;
    const inactive = partiesAll.filter((p) => p.active === false).length;

    panel.innerHTML =
      ui.summary([
        { label: "Parties", value: String(partiesAll.length) },
        { label: "Customers", value: String(customers) },
        { label: "Suppliers", value: String(suppliers) },
        { label: "Inactive", value: String(inactive) },
      ]) +
      '<div class="erp-toolbar">' +
      '<input type="search" placeholder="Search parties…" value="' + esc(searchVal) + '" data-p-search>' +
      ui.select("ptype", "", [{ value: "all", label: "All types" }, { value: "customer", label: "Customers" }, { value: "supplier", label: "Suppliers" }, { value: "both", label: "Both" }], typeVal) +
      ui.btn("Add party", { primary: true, act: "party-new" }) +
      "</div>" +
      ui.table([
        { key: "name", label: "Party", render: (r) => "<b>" + esc(r.name || "—") + "</b>" + (r.taxId ? "<div class=\"erp-sub\">" + esc(r.taxId) + "</div>" : "") },
        { key: "type", label: "Type", render: (r) => ui.badge(r.type || "—", r.type === "customer" ? "info" : r.type === "supplier" ? "warn" : "muted") },
        { key: "ct", label: "Contacts", align: "right", render: (r) => ui.fmt((r.contacts || []).length, 0) },
        { key: "terms", label: "Terms", render: (r) => esc(r.paymentTerms || "—") },
        { key: "credit", label: "Credit limit", align: "right", render: (r) => ui.money(r.creditLimit || 0) },
        { key: "active", label: "Status", render: (r) => ui.badge(r.active === false ? "Inactive" : "Active", r.active === false ? "danger" : "success") },
        { key: "actions", label: "", render: (r) =>
          ui.btn("Edit", { small: true, act: "party-edit", arg: r.id }) + " " +
          ui.btn("Merge…", { small: true, act: "party-merge", arg: r.id }) + " " +
          ui.btn(r.active === false ? "Activate" : "Deactivate", { small: true, act: "party-toggle", arg: r.id }) },
      ], rows, { emptyText: "No parties yet. Add your first customer or supplier." });

    panel.querySelector("[data-p-search]").addEventListener("input", (e) => { panel.__search = e.target.value; renderParties(panel, partiesAll, recordsAll, onChanged); });
    panel.querySelector("select[name=ptype]").addEventListener("change", (e) => { panel.__type = e.target.value; renderParties(panel, partiesAll, recordsAll, onChanged); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "party-new") partyModal(null, partiesAll, async (p, isNew) => { await master.saveParties(partiesAll.concat([p])); ERP.toast("Party added.", "success"); onChanged(); });
      else if (act === "party-edit") {
        const p = partiesAll.find((x) => String(x.id) === arg);
        if (p) partyModal(p, partiesAll, async (upd) => { await master.saveParties(partiesAll.map((x) => (String(x.id) === arg ? upd : x))); ERP.toast("Party updated.", "success"); onChanged(); });
      } else if (act === "party-toggle") {
        const p = partiesAll.find((x) => String(x.id) === arg);
        if (!p) return;
        await master.saveParties(partiesAll.map((x) => (String(x.id) === arg ? Object.assign({}, x, { active: x.active === false }) : x)));
        ERP.toast(p.active === false ? "Party activated." : "Party deactivated.", "success");
        onChanged();
      } else if (act === "party-merge") {
        const from = partiesAll.find((x) => String(x.id) === arg);
        if (!from) return;
        const others = partiesAll.filter((x) => String(x.id) !== arg);
        const m = ui.modal({
          title: "Merge party into another",
          body: '<p class="erp-modal-note">Merging <b>' + esc(from.name) + "</b> into another party rewrites every reference across the system and removes this party. Choose the surviving party:</p>" +
            '<div class="field"><label>Into</label><select data-merge-into>' + others.map((x) => '<option value="' + x.id + '">' + esc(x.name) + "</option>").join("") + "</select></div>",
          foot: ui.btn("Cancel", { small: true, act: "m-cancel" }) + " " + ui.btn("Merge", { small: true, danger: true, act: "m-go" }),
        });
        m.querySelector("[data-act=m-cancel]").onclick = () => ui.closeModal();
        m.querySelector("[data-act=m-go]").onclick = async (bt) => {
          const into = Number(m.querySelector("[data-merge-into]").value);
          bt.disabled = true;
          const res = await master.mergeParties(from.id, into);
          ui.closeModal();
          ERP.toast("Merged — updated " + res.docsTouched + " document(s).", "success");
          onChanged();
        };
      }
    });
  }

  /* ─────────────────────────── Records tab ─────────────────────────── */

  function reminderDue(rec) {
    const now = Date.now();
    const due = (rec.reminders || []).filter((r) => !r.done && new Date(r.due + "T23:59:59").getTime() <= now);
    return due;
  }

  async function renderRecords(panel, recordsAll, partiesAll, onChanged) {
    const recs = byKind(recordsAll, "record").sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const q = (panel.__q || "").toLowerCase();
    const fSource = panel.__source || "all";
    const fStatus = panel.__status || "all";
    const fOwner = panel.__owner || "all";
    const owners = Array.from(new Set(recs.map((r) => r.owner || "").filter(Boolean)));

    const rows = recs.filter((r) =>
      (fSource === "all" || r.source === fSource) &&
      (fStatus === "all" || r.status === fStatus) &&
      (fOwner === "all" || r.owner === fOwner) &&
      (!q || (r.tags || []).join(" ").toLowerCase().indexOf(q) !== -1 || (r.notes || "").toLowerCase().indexOf(q) !== -1));

    const dueAll = recordsAll.flatMap((r) => reminderDue(r).map((rem) => ({ rec: r, rem })));

    panel.innerHTML =
      ui.summary([
        { label: "CRM records", value: String(recs.length) },
        { label: "Active", value: String(recs.filter((r) => r.status === "active").length) },
        { label: "Reminders due", value: String(dueAll.length) },
      ]) +
      '<div class="erp-toolbar">' +
      '<input type="search" placeholder="Search tags, notes…" value="' + esc(panel.__q || "") + '" data-r-q>' +
      ui.select("rsrc", "", [{ value: "all", label: "All sources" }].concat(REC_SOURCES.map((s) => ({ value: s, label: s }))), fSource) +
      ui.select("rstat", "", [{ value: "all", label: "All statuses" }].concat(REC_STATUS.map((s) => ({ value: s.id, label: s.label }))), fStatus) +
      ui.select("rowner", "", [{ value: "all", label: "All owners" }].concat(owners.map((o) => ({ value: o, label: o }))), fOwner) +
      ui.btn("New record", { primary: true, act: "rec-new" }) +
      "</div>" +
      ui.table([
        { key: "party", label: "Party", render: (r) => { const p = partiesAll.find((x) => String(x.id) === String(r.partyId)); return "<b>" + esc(p ? p.name : "—") + "</b>"; } },
        { key: "source", label: "Source", render: (r) => ui.badge(r.source || "—", "muted") },
        { key: "owner", label: "Owner", render: (r) => esc(r.owner || "—") },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, REC_MAP) },
        { key: "tags", label: "Tags", render: (r) => (r.tags || []).slice(0, 3).map((t) => ui.badge(t, "info")).join(" ") },
        { key: "actions", label: "", render: (r) => ui.btn("Open", { small: true, act: "rec-open", arg: r.id }) + " " + ui.btn("Edit", { small: true, act: "rec-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rec-del", arg: r.id }) },
      ], rows, { emptyText: "No CRM records yet." });

    if (dueAll.length) {
      panel.querySelector(".erp-summary").insertAdjacentHTML("afterend",
        '<div class="erp-alert tone-warn">' + dueAll.map((x) => "<b>" + esc(partyNameSafe(partiesAll, x.rec.partyId)) + "</b>: " + esc(x.rem.note) + " (due " + esc(x.rem.due) + ")</div>"));
    }

    panel.querySelector("[data-r-q]").addEventListener("input", (e) => { panel.__q = e.target.value; renderRecords(panel, recordsAll, partiesAll, onChanged); });
    panel.querySelector("select[name=rsrc]").addEventListener("change", (e) => { panel.__source = e.target.value; renderRecords(panel, recordsAll, partiesAll, onChanged); });
    panel.querySelector("select[name=rstat]").addEventListener("change", (e) => { panel.__status = e.target.value; renderRecords(panel, recordsAll, partiesAll, onChanged); });
    panel.querySelector("select[name=rowner]").addEventListener("change", (e) => { panel.__owner = e.target.value; renderRecords(panel, recordsAll, partiesAll, onChanged); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      const rec = recs.find((x) => String(x.id) === arg);
      if (act === "rec-new") recordModal(null, partiesAll, async (r, isNew) => { r.id = nextId(recordsAll); r.createdAt = new Date().toISOString(); await save(recordsAll.concat([r])); ERP.toast("CRM record created.", "success"); onChanged(); });
      else if (act === "rec-edit") { if (rec) recordModal(rec, partiesAll, async (upd) => { await save(recordsAll.map((x) => (String(x.id) === arg ? upd : x))); ERP.toast("Record updated.", "success"); onChanged(); }); }
      else if (act === "rec-del") {
        if (rec && await ui.confirm({ title: "Delete CRM record?", message: "The record and its activity history will be removed. Party data is untouched.", danger: true })) {
          await save(recordsAll.filter((x) => String(x.id) !== arg));
          ERP.toast("Record deleted.", "success");
          onChanged();
        }
      } else if (act === "rec-open") { if (rec) recordDetail(rec, recordsAll, partiesAll, onChanged); }
    });
  }

  function partyNameSafe(partiesAll, id) {
    const p = partiesAll.find((x) => String(x.id) === String(id));
    return p ? p.name : "Unknown party";
  }

  function recordDetail(rec, recordsAll, partiesAll, onChanged) {
    const acts = (rec.activity || []).slice().sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    const rems = (rec.reminders || []).slice().sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    const opps = byKind(recordsAll, "opportunity").filter((o) => String(o.partyId) === String(rec.partyId));
    const m = ui.modal({
      title: partyNameSafe(partiesAll, rec.partyId),
      size: "lg",
      body:
        ui.summary([
          { label: "Source", value: esc(rec.source || "—") },
          { label: "Owner", value: esc(rec.owner || "—") },
          { label: "Status", value: ui.statusBadge(rec.status, REC_MAP) },
        ]) +
        (rec.tags && rec.tags.length ? "<p>" + rec.tags.map((t) => ui.badge(t, "info")).join(" ") + "</p>" : "") +
        (rec.notes ? "<p>" + esc(rec.notes) + "</p>" : "") +
        ui.card("Opportunities", opps.length ? ui.table([
          { key: "name", label: "Opportunity" },
          { key: "stage", label: "Stage", render: (o) => ui.statusBadge(o.stage, STAGE_MAP) },
          { key: "value", label: "Value", align: "right", render: (o) => ui.money(o.value || 0) },
        ], opps) : '<p class="erp-alert">No opportunities for this party yet.</p>') +
        ui.card("Activity", '<div class="erp-timeline">' +
          (acts.length ? acts.map((a) => '<div class="erp-timeline-item"><span class="erp-timeline-when">' + ui.dateTime(a.ts) + "</span><b>" + esc(a.type || "note") + "</b> — " + esc(a.summary) + (a.by ? " <span class=\"erp-sub\">by " + esc(a.by) + "</span>" : "") + "</div>").join("") : '<p class="erp-alert">No activity yet.</p>') +
          "</div>" +
          '<div class="erp-inline-form"><input type="text" placeholder="Add a note / activity summary…" data-act-input><button class="btn btn-primary btn-sm" data-act-add>Add</button></div>') +
        ui.card("Reminders", (rems.length ? rems.map((r) => '<div class="erp-timeline-item"><label class="erp-check"><input type="checkbox" data-rem-done="' + r.id + '"' + (r.done ? " checked" : "") + "> " + esc(r.note) + "</label><span class=\"erp-sub\">due " + esc(r.due) + "</span></div>").join("") : '<p class="erp-alert">No reminders.</p>') +
          '<div class="erp-inline-form"><input type="date" data-rem-date><input type="text" placeholder="Reminder note…" data-rem-note><button class="btn btn-primary btn-sm" data-rem-add>Add</button></div>'),
      foot: ui.btn("Close", { small: true, act: "d-close" }) + " " + ui.btn("Edit", { small: true, act: "d-edit" }),
    });
    const modalEl = document.querySelector("#uiModal");
    const innerEl = modalEl.querySelector("#uiModalBody");
    modalEl.querySelector("[data-act=d-close]").onclick = () => ui.closeModal();
    modalEl.querySelector("[data-act=d-edit]").onclick = () => {
      ui.closeModal();
      recordModal(rec, partiesAll, async (upd) => { await save(recordsAll.map((x) => (String(x.id) === String(rec.id) ? upd : x))); ERP.toast("Record updated.", "success"); onChanged(); });
    };
    innerEl.querySelector("[data-act-add]").onclick = async () => {
      const inp = innerEl.querySelector("[data-act-input]");
      const v = inp.value.trim();
      if (!v) return;
      activityRec(rec, "note", v);
      await save(recordsAll);
      ERP.toast("Activity added.", "success");
      onChanged();
      recordDetail(rec, recordsAll, partiesAll, onChanged);
    };
    innerEl.querySelector("[data-rem-add]").onclick = async () => {
      const d = innerEl.querySelector("[data-rem-date]").value;
      const n = innerEl.querySelector("[data-rem-note]").value.trim();
      if (!d || !n) { ERP.toast("Date and note are required for a reminder.", "error"); return; }
      (rec.reminders = rec.reminders || []).push({ id: Date.now(), due: d, note: n, done: false });
      await save(recordsAll);
      ERP.toast("Reminder added.", "success");
      onChanged();
      recordDetail(rec, recordsAll, partiesAll, onChanged);
    };
    innerEl.addEventListener("change", async (e) => {
      if (e.target.matches("[data-rem-done]")) {
        const rem = (rec.reminders || []).find((r) => String(r.id) === e.target.getAttribute("data-rem-done"));
        if (rem) { rem.done = e.target.checked; await save(recordsAll); onChanged(); }
      }
    });
  }

  /* ─────────────────────────── Pipeline tab ─────────────────────────── */

  function valueOf(opp, cur) { return { v: Number(opp.value) || 0, c: opp.currency || cur }; }
  function totalFor(list, cur) { return list.reduce((s, o) => s + (Number(o.value) || 0), 0); }

  async function renderPipeline(panel, recordsAll, partiesAll, onChanged) {
    const opps = byKind(recordsAll, "opportunity");
    const view = panel.__view || "board";
    const fOwner = panel.__owner || "all";
    const fParty = panel.__party || "all";
    const q = (panel.__q || "").toLowerCase();
    const owners = Array.from(new Set(opps.map((o) => o.owner || "").filter(Boolean)));

    const filtered = opps.filter((o) =>
      (fOwner === "all" || o.owner === fOwner) &&
      (fParty === "all" || String(o.partyId) === fParty) &&
      (!q || (o.name || "").toLowerCase().indexOf(q) !== -1 || (o.tags || []).join(" ").toLowerCase().indexOf(q) !== -1));

    const openTotal = totalFor(filtered.filter((o) => o.stage !== "won" && o.stage !== "lost"));
    const wonTotal = totalFor(filtered.filter((o) => o.stage === "won"));

    panel.innerHTML =
      ui.summary([
        { label: "Open pipeline", value: ui.money(openTotal) },
        { label: "Won", value: ui.money(wonTotal) },
        { label: "Opportunities", value: String(filtered.length) },
      ]) +
      '<div class="erp-toolbar">' +
      '<input type="search" placeholder="Search opportunities…" value="' + esc(panel.__q || "") + '" data-o-q>' +
      ui.select("oowner", "", [{ value: "all", label: "All owners" }].concat(owners.map((o) => ({ value: o, label: o }))), fOwner) +
      ui.select("oparty", "", [{ value: "all", label: "All parties" }].concat(partiesAll.map((p) => ({ value: String(p.id), label: p.name }))), fParty) +
      '<div class="erp-btn-group">' +
      ui.btn("Board", { small: true, act: "view-board", attrs: { "data-view": "board" } }) +
      ui.btn("List", { small: true, act: "view-list", attrs: { "data-view": "list" } }) +
      "</div>" +
      ui.btn("New opportunity", { primary: true, act: "opp-new" }) +
      "</div>" +
      '<div class="erp-pipe" data-pipe>' + (view === "board" ? renderBoard(filtered, partiesAll) : renderOppList(filtered, partiesAll)) + "</div>";

    const hl = (v) => panel.querySelectorAll(".erp-btn-group [data-act]").forEach((b) => b.classList.toggle("btn-primary", b.getAttribute("data-act") === ("view-" + v)));
    hl(view);

    panel.querySelector("[data-o-q]").addEventListener("input", (e) => { panel.__q = e.target.value; renderPipeline(panel, recordsAll, partiesAll, onChanged); });
    panel.querySelector("select[name=oowner]").addEventListener("change", (e) => { panel.__owner = e.target.value; renderPipeline(panel, recordsAll, partiesAll, onChanged); });
    panel.querySelector("select[name=oparty]").addEventListener("change", (e) => { panel.__party = e.target.value; renderPipeline(panel, recordsAll, partiesAll, onChanged); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "view-board") { panel.__view = "board"; renderPipeline(panel, recordsAll, partiesAll, onChanged); }
      else if (act === "view-list") { panel.__view = "list"; renderPipeline(panel, recordsAll, partiesAll, onChanged); }
      else if (act === "opp-new") {
        recordModal(null, partiesAll, async (o, isNew) => {
          o.id = nextId(recordsAll);
          o.kind = "opportunity";
          o.createdAt = new Date().toISOString();
          o.value = o.value || 0;
          await save(recordsAll.concat([o]));
          ERP.toast("Opportunity added to the pipeline.", "success");
          onChanged();
        }, { opportunity: true });
      } else if (act === "opp-open") {
        const o = opps.find((x) => String(x.id) === arg);
        if (o) oppDetail(o, recordsAll, partiesAll, onChanged);
      } else if (act === "opp-move") {
        const o = opps.find((x) => String(x.id) === arg);
        if (!o) return;
        const target = t.getAttribute("data-arg2");
        o.stage = target;
        if (target === "won") { o.wonAt = new Date().toISOString(); }
        if (target === "lost") { o.lostAt = new Date().toISOString(); o.wonAt = null; }
        await save(recordsAll);
        ERP.toast("Moved to " + (STAGE_MAP[target] || target) + ".", "success");
        onChanged();
      }
    });
  }

  function renderBoard(opps, partiesAll) {
    const cols = STAGES.map((s) => {
      const list = opps.filter((o) => (o.stage || "lead") === s.id);
      const total = totalFor(list);
      return '<div class="erp-pipe-col tone-' + s.tone + '">' +
        '<header class="erp-pipe-col-head"><span class="erp-pipe-col-name">' + esc(s.label) + '</span><span class="erp-pipe-col-meta">' + list.length + " · " + ui.money(total) + "</span></header>" +
        '<div class="erp-pipe-cards">' +
        (list.length ? list.map((o) => oppCard(o, partiesAll)).join("") : '<p class="erp-pipe-empty">No opportunities</p>') +
        "</div></div>";
    }).join("");
    return '<div class="erp-pipe-board">' + cols + "</div>";
  }

  function oppCard(o, partiesAll) {
    const name = partyNameSafe(partiesAll, o.partyId);
    const ix = FLOW.indexOf(o.stage || "lead");
    const prev = ix > 0 ? FLOW[ix - 1] : null;
    const next = ix >= 0 && ix < FLOW.length - 1 ? FLOW[ix + 1] : null;
    const c = STAGE_MAP[o.stage || "lead"] || { tone: "muted" };
    return '<div class="erp-pipe-card" data-act="opp-open" data-arg="' + o.id + '">' +
      '<div class="erp-pipe-card-name">' + esc(o.name || "Untitled") + "</div>" +
      '<div class="erp-sub">' + esc(name) + (o.owner ? " · " + esc(o.owner) : "") + "</div>" +
      '<div class="erp-pipe-card-foot"><b>' + ui.money(o.value || 0) + "</b>" +
      (o.expectedClose ? "<span class=\"erp-sub\">" + esc(o.expectedClose) + "</span>" : "") +
      '<span class="erp-pipe-card-moves">' +
      (prev ? '<button class="icon-btn" data-act="opp-move" data-arg="' + o.id + '" data-arg2="' + prev + '" title="Move to ' + esc(STAGE_MAP[prev].label) + '">‹</button>' : "") +
      (next ? '<button class="icon-btn" data-act="opp-move" data-arg="' + o.id + '" data-arg2="' + next + '" title="Move to ' + esc(STAGE_MAP[next].label) + '">›</button>' : "") +
      "</span></div></div>";
  }

  function renderOppList(opps, partiesAll) {
    return ui.table([
      { key: "name", label: "Opportunity", render: (r) => "<b>" + esc(r.name || "—") + "</b>" },
      { key: "party", label: "Party", render: (r) => esc(partyNameSafe(partiesAll, r.partyId)) },
      { key: "stage", label: "Stage", render: (r) => ui.statusBadge(r.stage, STAGE_MAP) },
      { key: "owner", label: "Owner", render: (r) => esc(r.owner || "—") },
      { key: "value", label: "Value", align: "right", render: (r) => ui.money(r.value || 0) },
      { key: "close", label: "Expected close", render: (r) => esc(r.expectedClose || "—") },
      { key: "actions", label: "", render: (r) => ui.btn("Open", { small: true, act: "opp-open", arg: r.id }) },
    ], opps, { emptyText: "No opportunities match the filters." });
  }

  function oppDetail(o, recordsAll, partiesAll, onChanged) {
    const canWon = o.stage !== "won" && o.stage !== "lost";
    const m = ui.modal({
      title: o.name || "Opportunity",
      size: "lg",
      body:
        ui.summary([
          { label: "Stage", value: ui.statusBadge(o.stage, STAGE_MAP) },
          { label: "Party", value: esc(partyNameSafe(partiesAll, o.partyId)) },
          { label: "Value", value: ui.money(o.value || 0) },
          { label: "Owner", value: esc(o.owner || "—") },
        ]) +
        (o.expectedClose ? "<p>Expected close: <b>" + esc(o.expectedClose) + "</b></p>" : "") +
        (o.tags && o.tags.length ? "<p>" + o.tags.map((t) => ui.badge(t, "info")).join(" ") + "</p>" : "") +
        (o.notes ? "<p>" + esc(o.notes) + "</p>" : "") +
        (o.wonAt ? '<p class="erp-alert tone-success">Won on ' + esc(ui.dateTime(o.wonAt)) + "</p>" : "") +
        (o.lostReason ? '<p class="erp-alert tone-danger">Lost: ' + esc(o.lostReason) + "</p>" : "") +
        '<div class="erp-inline-form"><input type="text" placeholder="Add a note…" data-o-note><button class="btn btn-primary btn-sm" data-o-add>Add</button></div>',
      foot: ui.btn("Close", { small: true, act: "o-close" }) + " " +
        ui.btn("Edit", { small: true, act: "o-edit" }) + " " +
        (canWon ? ui.btn("Mark won", { small: true, primary: true, act: "o-won" }) : "") + " " +
        (canWon ? ui.btn("Mark lost", { small: true, danger: true, act: "o-lost" }) : "") + " " +
        (o.stage === "won" ? ui.btn("Create project", { small: true, act: "o-project" }) : ""),
    });
    const modalEl = document.querySelector("#uiModal");
    const innerEl = modalEl.querySelector("#uiModalBody");
    modalEl.querySelector("[data-act=o-close]").onclick = () => ui.closeModal();
    modalEl.querySelector("[data-act=o-edit]").onclick = () => {
      ui.closeModal();
      recordModal(o, partiesAll, async (upd) => {
        upd.kind = "opportunity";
        await save(recordsAll.map((x) => (String(x.id) === String(o.id) ? upd : x)));
        ERP.toast("Opportunity updated.", "success");
        onChanged();
      }, { opportunity: true });
    };
    const doStage = async (stage) => {
      o.stage = stage;
      if (stage === "won") { o.wonAt = new Date().toISOString(); o.lostAt = null; }
      if (stage === "lost") { o.lostAt = new Date().toISOString(); o.lostReason = o.lostReason || "Not disclosed"; o.wonAt = null; }
      await save(recordsAll);
      ERP.toast(stage === "won" ? "Opportunity won — " + ui.money(o.value || 0) + "." : "Opportunity marked lost.", stage === "won" ? "success" : "error");
      ui.closeModal();
      onChanged();
    };
    modalEl.querySelector("[data-act=o-won]").onclick = () => doStage("won");
    modalEl.querySelector("[data-act=o-lost]").onclick = () => doStage("lost");
    modalEl.querySelector("[data-act=o-project]").onclick = async (t) => {
      t.disabled = true;
      const res = await C.wonToProject(o, recordsAll);
      ui.closeModal();
      ERP.toast(res.created ? "Project created from this opportunity." : "Project already exists for this opportunity.", "success");
      onChanged();
    };
    innerEl.querySelector("[data-o-add]").onclick = async () => {
      const inp = innerEl.querySelector("[data-o-note]");
      const v = inp.value.trim();
      if (!v) return;
      activityRec(o, "note", v);
      await save(recordsAll);
      onChanged();
      oppDetail(o, recordsAll, partiesAll, onChanged);
    };
  }

  /* Turn a won opportunity into a project (wired to the Projects module doc). */
  C.wonToProject = async function (o, recordsAll) {
    const cur = await store.loadDoc("projects");
    const existing = (cur.records || []).find((p) => p.source === "opportunity:" + String(o.id));
    if (existing) return { created: false, project: existing };
    const project = {
      id: master.nextId(cur.records || []),
      kind: "project",
      title: (o.name || "Project") + (o.name ? "" : " from won opportunity"),
      partyId: o.partyId != null ? Number(o.partyId) : null,
      status: "planned",
      budget: Number(o.value) || 0,
      currency: o.currency || "USD",
      startDate: ui.today(),
      description: (o.notes || "") + (o.notes ? "\n" : "") + "Won " + (o.wonAt ? ui.date(o.wonAt) : "—"),
      source: "opportunity:" + String(o.id),
      tags: (o.tags || []).slice(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: ERP.role || "owner",
    };
    await store.saveDoc("projects", (cur.records || []).concat([project]));
    await master.audit({ action: "create_project", targetType: "project", targetId: project.id, summary: "Created project \"" + project.title + "\" from won opportunity." });
    return { created: true, project };
  };

  /* ─────────────────────────── Ports tab (Task 13) ─────────────────────────── */

  function renderPorts(panel, recordsAll, partiesAll, onChanged) {
    const won = byKind(recordsAll, "opportunity").filter((o) => o.stage === "won");
    const seeds = won.map((o) => ({
      title: o.name, partyId: o.partyId, partyName: partyNameSafe(partiesAll, o.partyId),
      value: o.value || 0, currency: o.currency || "USD", tags: o.tags || [],
      source: "opportunity:" + String(o.id),
    }));
    const seedsJson = JSON.stringify({ schema: "erp-project-seeds", version: 1, exportedAt: new Date().toISOString(), projects: seeds }, null, 2);

    panel.innerHTML =
      ui.pageHead("Pipeline ports", "Move ideas and outcomes between generators — import incubated ideas as qualified leads, export won opportunities as project seeds.", "") +
      ui.grid([
        ui.card("Import idea-incubator bundle", 
          '<p class="erp-alert">Paste the JSON you exported from the idea incubator. Each idea becomes a CRM record plus a <b>qualified</b> lead in the pipeline. Ideas that name a known party are linked to it; otherwise a party is created.</p>' +
          '<textarea class="erp-code-input" data-import-json rows="8" placeholder=\'{ "ideas": [ { "title": "My idea", "summary": "…", "tags": ["x"] } ] }\'></textarea>' +
          '<div class="erp-btn-row">' + ui.btn("Preview import", { act: "port-preview" }) + ui.btn("Import ideas", { primary: true, act: "port-import" }) + "</div>" +
          '<div data-port-result></div>'),
        ui.card("Export won opportunities", 
          '<p class="erp-alert">Download the project-seeds bundle from the <b>' + won.length + "</b> won opportunity(ies), or copy it for pasting into the project module.</p>" +
          '<div class="erp-btn-row">' + ui.btn("Download seeds.json", { act: "port-download" }) + ui.btn("Copy to clipboard", { act: "port-copy" }) + "</div>" +
          "<details class=\"erp-details\"><summary>Preview bundle</summary><pre class=\"erp-pre\">" + esc(seedsJson.slice(0, 1600)) + "</pre></details>"),
      ]);
    panel.__seedsJson = seedsJson;

    ui.bind(panel, "click", "[data-act]", async (t, e, act) => {
      const resultCtn = panel.querySelector("[data-port-result]");
      if (act === "port-preview") {
        const raw = panel.querySelector("[data-import-json]").value.trim();
        const ideas = C.parseIdeas(raw);
        if (!ideas) { resultCtn.innerHTML = ui.alert("Could not parse that JSON.", "error"); return; }
        resultCtn.innerHTML = ui.alert("Ready to import " + ideas.length + " idea(s): " + ideas.map((i) => i.title).slice(0, 5).join(", ") + (ideas.length > 5 ? "…" : "") + ".", "info");
      } else if (act === "port-import") {
        const raw = panel.querySelector("[data-import-json]").value.trim();
        const ideas = C.parseIdeas(raw);
        if (!ideas) { resultCtn.innerHTML = ui.alert("Could not parse that JSON.", "error"); return; }
        t.disabled = true; t.textContent = "Importing…";
        const res = await C.importIdeas(ideas, recordsAll, partiesAll);
        t.disabled = false; t.textContent = "Import ideas";
        resultCtn.innerHTML = ui.alert("Imported " + res.ideas + " idea(s) — " + res.records + " record(s), " + res.opportunities + " qualified lead(s), " + res.parties + " party(ies) created.", "success");
        onChanged();
      } else if (act === "port-download") {
        const blob = new Blob([seedsJson], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "erp-project-seeds.json";
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      } else if (act === "port-copy") {
        try { await navigator.clipboard.writeText(seedsJson); ERP.toast("Copied to clipboard.", "success"); }
        catch (e) { ERP.toast("Clipboard unavailable — copy from the preview instead.", "error"); }
      }
    });
  }

  /* Parse a flexible idea-incubator bundle into idea objects. */
  C.parseIdeas = function (raw) {
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return null; }
    let arr = obj;
    if (obj && !Array.isArray(obj)) {
      arr = obj.ideas || obj.items || obj.bundle || null;
    }
    if (!Array.isArray(arr)) return null;
    return arr.map((it, i) => ({
      id: it.id != null ? it.id : i,
      title: it.title || it.name || it.headline || ("Idea " + (i + 1)),
      summary: it.summary || it.description || it.desc || "",
      tags: Array.isArray(it.tags) ? it.tags : String(it.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
      category: it.category || "",
      partyName: it.partyName || it.customerName || it.company || "",
      value: Number(it.value || it.estimate || it.opportunitySize || 0) || 0,
    }));
  };

  /* Import ideas: each becomes a CRM record + a qualified-lead opportunity. */
  C.importIdeas = async function (ideas, recordsAll, partiesAll) {
    const newRecords = recordsAll.slice();
    const newParties = partiesAll.slice();
    const stats = { ideas: ideas.length, records: 0, opportunities: 0, parties: 0 };
    const seenNames = {};
    for (const idea of ideas) {
      let partyId = null;
      const wantName = (idea.partyName || "").trim();
      if (wantName) {
        const key = wantName.toLowerCase();
        if (seenNames[key]) partyId = seenNames[key];
        else {
          let p = newParties.find((x) => (x.name || "").toLowerCase() === key);
          if (!p) {
            p = { id: master.nextId(newParties), name: wantName, type: "both", paymentTerms: "net30", creditLimit: 0, active: true, contacts: [], addresses: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            newParties.push(p);
            stats.parties++;
          }
          partyId = p.id;
          seenNames[key] = p.id;
        }
      }
      const rec = {
        id: master.nextId(newRecords), kind: "record", partyId, source: "idea-incubator",
        owner: "", status: "new", tags: idea.tags.slice(), firstContact: ui.today(),
        notes: (idea.category ? "Category: " + idea.category + "\n" : "") + idea.summary,
        activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "import", summary: "Imported from idea incubator: " + idea.title, by: ERP.role || "owner" }],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
      };
      newRecords.push(rec);
      stats.records++;
      const opp = {
        id: master.nextId(newRecords), kind: "opportunity", name: idea.title, partyId,
        owner: "", stage: "qualified", value: idea.value, currency: "USD",
        expectedClose: null, probability: null, source: "idea-incubator", tags: idea.tags.slice(),
        notes: idea.summary, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
      };
      newRecords.push(opp);
      stats.opportunities++;
    }
    if (stats.records + stats.opportunities) await save(newRecords);
    if (stats.parties) await master.saveParties(newParties);
    await master.audit({ action: "import_ideas", targetType: "crm", targetId: "idea-incubator", summary: "Imported " + stats.ideas + " idea(s) as qualified leads from an idea-incubator bundle." });
    return stats;
  };

  /* ─────────────────────────── controller ─────────────────────────── */

  C.render = async function (ctx) {
    const el = ctx.el;
    ui.loading(el, "Loading CRM");
    let recordsAll, partiesAll;
    try {
      recordsAll = await records();
      partiesAll = await parties();
    } catch (e) {
      ctx.error({ title: "Could not load CRM data", message: (e && e.message) || String(e) });
      return;
    }

    const tabDefs = [
      { id: "parties", label: "Parties", badge: String(partiesAll.length) },
      { id: "records", label: "CRM records", badge: String(byKind(recordsAll, "record").length) },
      { id: "pipeline", label: "Pipeline", badge: String(byKind(recordsAll, "opportunity").length) },
      { id: "ports", label: "Ports" },
    ];
    const active = el.__tab || "parties";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML =
      ui.pageHead("CRM", "Parties, contacts, activities and your opportunity pipeline.", "") +
      t.html;

    const tabMap = {};
    el.querySelectorAll("[data-tab]").forEach((b) => tabMap[b.getAttribute("data-tab")] = b);
    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => panels[p.getAttribute("data-panel")] = p);
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));

    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });

    const refresh = async () => {
      C.invalidate();
      recordsAll = await records();
      partiesAll = await parties();
      await renderPanel(el.__tab || "parties");
    };

    const renderPanel = async (id) => {
      const p = panels[id];
      if (!p) return;
      if (id === "parties") await renderParties(p, partiesAll, recordsAll, refresh);
      else if (id === "records") await renderRecords(p, recordsAll, partiesAll, refresh);
      else if (id === "pipeline") await renderPipeline(p, recordsAll, partiesAll, refresh);
      else if (id === "ports") renderPorts(p, recordsAll, partiesAll, refresh);
    };

    await renderPanel(active);
  };
})();
