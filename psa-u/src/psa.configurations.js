/* ============================================================
   PSA-U — configuration & asset records (Phase 10 · Task 47)

   The devices and services a client actually has. An asset record
   is what an agreement covers, what a ticket is about, and what an
   RMM alert points at. This module keeps those records and — the
   point of the task — keeps them honest against the MSP
   documentation system.

     • configuration — a client-owned record (device, software,
                       network gear, service) with type, make/model,
                       serial/asset tag, location/site/contact,
                       network identity, warranty & support dates,
                       status, relationships and a free-text note.

   Field ownership. Each field has an owner — PSA-U ("psa") or the
   documentation system ("docs"). When the two systems are synced,
   a field the docs system owns is updated from the feed; a field
   PSA-U owns is never silently overwritten — a difference is filed
   as DRIFT and surfaced (per field, with both values) for a human
   to resolve. Nothing is lost and nothing changes behind anyone's
   back. `syncFromDocs` returns a full report of what was created,
   updated, drifted and left unchanged.

   Storage: `configuration` records in the CLIENT company document,
   so the agreement coverage check can see them (Task 24 reads the
   same kind). This makes `ERP.agreements.coverageWarnings` light up
   the moment assets exist. No record here is required at runtime.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const C = (ERP.configurations = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("configurations requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  C.KIND = "configuration";

  /* ─────────────────────────── vocabulary ─────────────────────────── */

  C.TYPES = [
    { id: "hardware", label: "Hardware", tone: "info" },
    { id: "software", label: "Software", tone: "muted" },
    { id: "network", label: "Network", tone: "warn" },
    { id: "mobile", label: "Mobile", tone: "success" },
    { id: "service", label: "Service", tone: "muted" },
    { id: "other", label: "Other", tone: "muted" },
  ];
  C.STATUSES = [
    { id: "active", label: "Active", tone: "success" },
    { id: "in_repair", label: "In repair", tone: "warn" },
    { id: "loaned", label: "Loaned", tone: "info" },
    { id: "retired", label: "Retired", tone: "muted" },
    { id: "disposed", label: "Disposed", tone: "muted" },
  ];
  C.REL_TYPES = [
    { id: "depends_on", label: "Depends on" },
    { id: "connects_to", label: "Connects to" },
    { id: "part_of", label: "Part of" },
    { id: "related", label: "Related" },
  ];
  C.typeLabel = (id) => (C.TYPES.find((t) => t.id === id) || {}).label || id || "—";
  C.typeTone = (id) => (C.TYPES.find((t) => t.id === id) || {}).tone || "muted";
  C.statusLabel = (id) => (C.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  C.statusTone = (id) => (C.STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  /* ─────────────────────────── field ownership ─────────────────────────── */

  /* Which system is authoritative for each field when the two are synced. */
  C.DEFAULT_OWNERSHIP = {
    name: "docs", type: "docs", classId: "docs",
    make: "docs", model: "docs", serialNumber: "docs", assetTag: "docs",
    hostname: "docs", ipAddress: "docs", macAddress: "docs", os: "docs",
    purchaseDate: "docs", warrantyStart: "docs", warrantyEnd: "docs",
    supportStart: "docs", supportEnd: "docs", location: "docs",
    status: "psa", notes: "psa", siteId: "psa", contactId: "psa",
    relationships: "psa", categoryId: "psa",
  };
  C.SYNCABLE_FIELDS = Object.keys(C.DEFAULT_OWNERSHIP);
  C.ownership = function (record) {
    return Object.assign({}, C.DEFAULT_OWNERSHIP, (record && record.fieldOwners) || {});
  };
  C.ownerOf = function (record, field) { return C.ownership(record)[field] || "psa"; };

  C.setOwnership = async function (pid, companyId, id, field, owner) {
    if (!ERP.security.enforce("configuration.edit")) return { error: "forbidden" };
    const rec = await C.item(pid, companyId, id);
    if (!rec) return { error: "not_found" };
    if (owner !== "psa" && owner !== "docs") return { error: "bad_owner" };
    rec.fieldOwners = Object.assign({}, rec.fieldOwners || {}, { [field]: owner });
    rec.updatedAt = nowIso(); rec.updatedBy = actorName();
    await ten().upsert("company", companyId, rec);
    return { record: rec };
  };

  /* ─────────────────────────── factories & access ─────────────────────────── */

  C.new = (over) => Object.assign({
    kind: C.KIND, id: null, companyId: null,
    name: "", type: "hardware", classId: null, categoryId: null,
    make: "", model: "", serialNumber: "", assetTag: "", externalId: "",
    hostname: "", ipAddress: "", macAddress: "", os: "",
    location: "", siteId: null, contactId: null,
    purchaseDate: "", warrantyStart: "", warrantyEnd: "", supportStart: "", supportEnd: "",
    status: "active", notes: "", relationships: [],
    source: "psa", fieldOwners: {}, drift: [], lastSyncedAt: null,
    createdBy: "", updatedBy: "", createdAt: null, updatedAt: null,
  }, over || {});

  function companyRecords(companyId) { return ten().records("company", companyId, C.KIND); }

  C.items = async function (pid, companyId, query) {
    query = query || {};
    let list = (await companyRecords(companyId)).slice();
    if (query.type) list = list.filter((r) => r.type === query.type);
    if (query.status) list = list.filter((r) => r.status === query.status);
    if (query.siteId) list = list.filter((r) => String(r.siteId) === String(query.siteId));
    if (query.q) {
      const q = String(query.q).toLowerCase();
      list = list.filter((r) => [r.name, r.make, r.model, r.serialNumber, r.assetTag, r.hostname].join(" ").toLowerCase().indexOf(q) !== -1);
    }
    if (query.driftOnly) list = list.filter((r) => (r.drift || []).length);
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return list;
  };

  C.item = async function (pid, companyId, id) {
    if (companyId == null || id == null) return null;
    return (await companyRecords(companyId)).find((r) => String(r.id) === String(id)) || null;
  };

  C.forCompany = (companyId) => companyRecords(companyId);

  C.allItems = async function (pid, query) {
    const out = [];
    const companies = await ERP.companies.list(pid);
    for (const e of companies) {
      for (const r of await companyRecords(e.id)) out.push(Object.assign({}, r, { companyName: e.name }));
    }
    out.sort((a, b) => String(a.companyName || "").localeCompare(String(b.companyName || "")) || String(a.name || "").localeCompare(String(b.name || "")));
    return out;
  };

  /* Does this company have a configuration record with this id? (coverage check) */
  C.has = async function (companyId, refId) {
    if (companyId == null || refId == null) return false;
    return (await companyRecords(companyId)).some((r) => String(r.id) === String(refId));
  };

  C.save = async function (pid, companyId, rec) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return { error: "forbidden" };
    if (companyId == null) return { error: "no_company" };
    const list = await companyRecords(companyId);
    const existing = rec.id != null ? list.find((r) => String(r.id) === String(rec.id)) : null;
    const out = Object.assign(C.new(), existing || {}, rec, { companyId: companyId });
    if (!out.name || !String(out.name).trim()) return { error: "name_required", message: "Give the asset a name." };
    out.name = String(out.name).trim();
    const now = nowIso();
    const isNew = !existing;
    if (isNew) {
      out.id = ten().nextId(list);
      out.createdAt = now; out.createdBy = actorName();
      out.source = out.source || "psa";
    }
    out.updatedAt = now; out.updatedBy = actorName();
    out.relationships = out.relationships || [];
    out.drift = out.drift || [];
    await ten().upsert("company", companyId, out);
    if (ERP.workflow) {
      const ev = isNew ? "configuration.created" : "configuration.updated";
      try { await ERP.workflow.emit(ev, { providerId: pid, configuration: out, companyId: companyId }); } catch (e) {}
    }
    return { record: out, created: isNew };
  };

  C.remove = async function (pid, companyId, id) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return { error: "forbidden" };
    await ten().remove("company", companyId, (r) => r.kind === C.KIND && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  C.setRelationship = async function (pid, companyId, id, rel) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return { error: "forbidden" };
    const rec = await C.item(pid, companyId, id);
    if (!rec) return { error: "not_found" };
    const list = (rec.relationships || []).slice();
    const nextId = list.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    list.push({ id: nextId, type: rel.type || "related", targetId: rel.targetId, label: rel.label || "" });
    rec.relationships = list; rec.updatedAt = nowIso(); rec.updatedBy = actorName();
    await ten().upsert("company", companyId, rec);
    return { record: rec, relationship: list[list.length - 1] };
  };

  C.removeRelationship = async function (pid, companyId, id, relId) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return { error: "forbidden" };
    const rec = await C.item(pid, companyId, id);
    if (!rec) return { error: "not_found" };
    rec.relationships = (rec.relationships || []).filter((r) => String(r.id) !== String(relId));
    rec.updatedAt = nowIso(); rec.updatedBy = actorName();
    await ten().upsert("company", companyId, rec);
    return { record: rec };
  };

  /* ─────────────────────────── documentation sync ─────────────────────────── */

  function findMatch(local, ext) {
    const extId = ext.id != null ? String(ext.id) : (ext.externalId != null ? String(ext.externalId) : "");
    const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
    return local.find((r) => {
      if (extId && (String(r.externalId) === extId || String(r.id) === extId)) return true;
      if (ext.serialNumber && r.serialNumber && norm(r.serialNumber) === norm(ext.serialNumber)) return true;
      if (ext.assetTag && r.assetTag && norm(r.assetTag) === norm(ext.assetTag)) return true;
      if (ext.name && r.name && norm(r.name) === norm(ext.name)) return true;
      return false;
    }) || null;
  }

  function applyExternal(rec, ext) {
    const owners = C.ownership(rec);
    const applied = [], drift = [];
    for (const field of C.SYNCABLE_FIELDS) {
      if (ext[field] === undefined) continue;
      const localVal = rec[field] == null ? "" : rec[field];
      const extVal = ext[field] == null ? "" : ext[field];
      if (JSON.stringify(localVal) === JSON.stringify(extVal)) continue;
      if ((owners[field] || "psa") === "docs") { rec[field] = ext[field]; applied.push(field); }
      else if (extVal !== "") drift.push({ field: field, local: rec[field] == null ? null : rec[field], external: ext[field], at: nowIso() });
    }
    return { applied: applied, drift: drift };
  }

  C.syncFromDocs = async function (pid, companyId, externalRecords, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return { error: "forbidden" };
    const ext = Array.isArray(externalRecords) ? externalRecords : (externalRecords && externalRecords.records) || [];
    const report = { created: [], updated: [], drifted: [], unchanged: [], total: ext.length, at: nowIso() };
    const now = nowIso();
    for (const e of ext) {
      const existRec = findMatch(await companyRecords(companyId), e);
      if (!existRec) {
        const rec = Object.assign(C.new(), e, {
          id: null, companyId: companyId, externalId: e.id != null ? String(e.id) : (e.externalId || ""),
          source: "docs", lastSyncedAt: now, drift: [], fieldOwners: {},
        });
        delete rec.id;
        delete rec.kind;
        const list = await companyRecords(companyId);
        const out = Object.assign(C.new(), rec, { id: ten().nextId(list), createdAt: now, createdBy: "docs-sync", updatedAt: now, updatedBy: "docs-sync" });
        out.name = out.name || "(unnamed asset)";
        await ten().upsert("company", companyId, out);
        report.created.push(out);
        if (ERP.workflow) { try { await ERP.workflow.emit("configuration.created", { providerId: pid, configuration: out, companyId: companyId, source: "docs" }); } catch (err) {} }
        continue;
      }
      const touched = applyExternal(existRec, e);
      existRec.drift = touched.drift;
      existRec.lastSyncedAt = now;
      existRec.externalId = existRec.externalId || (e.id != null ? String(e.id) : (e.externalId || ""));
      existRec.source = existRec.source || "docs";
      if (touched.applied.length || touched.drift.length) {
        existRec.updatedAt = now; existRec.updatedBy = "docs-sync";
        await ten().upsert("company", companyId, existRec);
        report.updated.push({ id: existRec.id, fields: touched.applied });
        if (touched.drift.length) {
          report.drifted.push({ id: existRec.id, name: existRec.name, drift: touched.drift });
          if (ERP.workflow) { try { await ERP.workflow.emit("configuration.drift", { providerId: pid, configuration: existRec, companyId: companyId, drift: touched.drift }); } catch (err) {} }
        }
      } else {
        report.unchanged.push(existRec.id);
      }
    }
    return { report: report };
  };
  C.importFromDocs = C.syncFromDocs;

  C.drift = async function (pid, companyId) {
    const out = [];
    const companies = companyId != null ? [{ id: companyId }] : await ERP.companies.list(pid);
    for (const e of companies) {
      for (const r of await companyRecords(e.id)) {
        (r.drift || []).forEach((d) => out.push({ companyId: e.id, assetId: r.id, assetName: r.name, field: d.field, local: d.local, external: d.external, at: d.at }));
      }
    }
    return out;
  };

  C.resolveDrift = async function (pid, companyId, id, field, decision) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return { error: "forbidden" };
    const rec = await C.item(pid, companyId, id);
    if (!rec) return { error: "not_found" };
    const entry = (rec.drift || []).find((d) => d.field === field);
    if (!entry) return { error: "no_drift" };
    if (decision === "external") rec[field] = entry.external;
    else if (decision !== "local") return { error: "bad_decision" };
    rec.drift = (rec.drift || []).filter((d) => d.field !== field);
    rec.updatedAt = nowIso(); rec.updatedBy = actorName();
    await ten().upsert("company", companyId, rec);
    return { record: rec, field: field, decision: decision };
  };

  /* A stand-in documentation feed: the current assets with one field changed,
     so the drift path is demonstrable without a live connector. */
  C.sampleFeed = async function (pid, companyId) {
    const list = await companyRecords(companyId);
    return list.slice(0, 10).map((r, i) => ({
      id: r.externalId || String(r.id),
      name: r.name,
      type: r.type,
      make: r.make,
      model: r.model,
      serialNumber: r.serialNumber,
      assetTag: r.assetTag,
      hostname: r.hostname,
      ipAddress: i === 0 ? (r.ipAddress || "10.0.0.1") : r.ipAddress,
      os: i === 0 ? (r.os || "Windows 11 Pro 23H2") : r.os,
      warrantyEnd: r.warrantyEnd,
      location: r.location,
      status: i === 0 ? "retired" : r.status,
    }));
  };

  C.expiringWarranties = async function (pid, companyId, days) {
    const limit = ui.addDays(ui.today(), days == null ? 60 : days);
    const list = await companyRecords(companyId);
    return list.filter((r) => r.warrantyEnd && r.warrantyEnd <= limit && r.status !== "retired" && r.status !== "disposed")
      .sort((a, b) => String(a.warrantyEnd).localeCompare(String(b.warrantyEnd)));
  };

  /* ═══════════════════════════ station tab ═══════════════════════════ */

  function esc(s) { return ui.esc(s); }

  C.renderAssets = async function (panel, pid, refresh, presetCompanyId) {
    if (!ERP.security.enforce("configuration.view")) { panel.innerHTML = ui.alert("Your role cannot view configuration records.", "warn"); return; }
    const companies = await ERP.companies.optionList();
    const state = panel.__cfgState || (panel.__cfgState = { companyId: presetCompanyId != null ? presetCompanyId : "", q: "", type: "", status: "", driftOnly: false });
    if (!state.companyId && companies.length) state.companyId = companies[0].value;
    const canEdit = ERP.security.can("configuration.edit");
    const driftAll = await C.drift(pid, state.companyId != null && state.companyId !== "" ? state.companyId : null);

    if (!state.companyId) {
      panel.innerHTML = ui.alert("Add a client company first — assets belong to a client.", "warn") + (canEdit ? "" : "");
      return;
    }

    const [items, sites] = await Promise.all([C.items(pid, state.companyId, state), ERP.companies.sites(state.companyId)]);
    const siteName = {};
    sites.forEach((s) => { siteName[String(s.id)] = s.name; });
    const drifty = items.filter((r) => (r.drift || []).length).length;
    const expiring = items.filter((r) => r.warrantyEnd && r.warrantyEnd <= ui.addDays(ui.today(), 60) && r.status === "active").length;

    const rows = items.map((r) => ({
      name: esc(r.name) + (r.hostname ? ' <span class="erp-sub">' + esc(r.hostname) + "</span>" : ""),
      type: ui.badge(C.typeLabel(r.type), C.typeTone(r.type)),
      make: esc([r.make, r.model].filter(Boolean).join(" ") || "—"),
      serial: esc(r.serialNumber || r.assetTag || "—"),
      site: esc(r.siteId != null ? (siteName[String(r.siteId)] || "—") : "—"),
      status: ui.badge(C.statusLabel(r.status), C.statusTone(r.status)),
      warranty: r.warrantyEnd ? esc(ui.date(r.warrantyEnd)) : "—",
      drift: (r.drift || []).length ? ui.badge(String(r.drift.length) + " drift", "warn") : "",
      actions: ui.btn("Open", { small: true, act: "cf-open", arg: r.id }) + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "cf-del", arg: r.id }) : ""),
    }));

    const driftRows = driftAll.map((d) => ({
      asset: esc(d.assetName || ("#" + d.assetId)),
      field: esc(d.field),
      local: esc(d.local == null ? "—" : String(d.local)),
      external: esc(d.external == null ? "—" : String(d.external)),
      actions: canEdit ? ui.btn("Keep ours", { small: true, act: "cf-keeplocal", arg: d.assetId + "|" + d.field }) + " " + ui.btn("Take theirs", { small: true, primary: true, act: "cf-takethere", arg: d.assetId + "|" + d.field }) : "",
    }));

    panel.innerHTML =
      '<div class="erp-summary">' +
        '<div class="erp-summary-item"><span>Assets</span><b>' + items.length + "</b></div>" +
        '<div class="erp-summary-item"><span>Active</span><b>' + items.filter((r) => r.status === "active").length + "</b></div>" +
        '<div class="erp-summary-item"><span>Warranty ≤ 60d</span><b>' + expiring + "</b></div>" +
        '<div class="erp-summary-item"><span>Outstanding drift</span><b>' + driftAll.length + "</b></div>" +
      "</div>" +
      (companies.length > 1
        ? '<div class="erp-toolbar">' + ui.select("cf-company", "", [{ value: "", label: "— all clients —" }].concat(companies), state.companyId, null, "Filter by client") + "</div>"
        : "") +
      '<div class="erp-toolbar">' +
        '<input type="search" data-cf-q placeholder="Search assets…" value="' + esc(state.q) + '">' +
        ui.select("cf-type", "", [{ value: "", label: "Any type" }].concat(C.TYPES.map((t) => ({ value: t.id, label: t.label }))), state.type, null, "Filter by asset type") +
        ui.select("cf-status", "", [{ value: "", label: "Any status" }].concat(C.STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status, null, "Filter by status") +
        ui.btn("Sync from documentation", { small: true, act: "cf-sync" }) +
        (canEdit ? ui.btn("New asset", { primary: true, act: "cf-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "name", label: "Asset" },
        { key: "type", label: "Type" },
        { key: "make", label: "Make / model" },
        { key: "serial", label: "Serial / tag" },
        { key: "site", label: "Site" },
        { key: "status", label: "Status" },
        { key: "warranty", label: "Warranty" },
        { key: "drift", label: "" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No assets for this client yet." }) +
      '<div class="erp-sep"></div>' +
      ui.card("Documentation drift", ui.table([
        { key: "asset", label: "Asset" }, { key: "field", label: "Field" }, { key: "local", label: "PSA-U" },
        { key: "external", label: "Documentation" }, { key: "actions", label: "", align: "right" },
      ], driftRows, { emptyText: "No conflicts — PSA-U and the documentation system agree." }));

    const q = panel.querySelector("[data-cf-q]");
    if (q) q.addEventListener("input", () => { state.q = q.value; clearTimeout(panel.__cfT); panel.__cfT = setTimeout(() => refresh(), 250); });
    const sel = (s, k) => { const el = panel.querySelector(s); if (el) el.addEventListener("change", () => { state[k] = el.value; refresh(); }); };
    sel("[name=cf-company]", "companyId"); sel("[name=cf-type]", "type"); sel("[name=cf-status]", "status");

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "cf-new") return openAssetModal(pid, state.companyId, null, refresh);
      if (act === "cf-open") return openAsset(pid, state.companyId, arg, refresh);
      if (act === "cf-del") {
        const ok = await ui.confirm({ title: "Delete asset", message: "Delete this configuration record?", danger: true });
        if (!ok) return;
        const r = await C.remove(pid, state.companyId, arg);
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ERP.toast("Asset deleted.", "success"); refresh();
      }
      if (act === "cf-sync") return openSyncModal(pid, state.companyId, refresh);
      if (act === "cf-keeplocal" || act === "cf-takethere") {
        const parts = String(arg).split("|");
        const r = await C.resolveDrift(pid, state.companyId, parts[0], parts[1], act === "cf-takethere" ? "external" : "local");
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ERP.toast("Conflict resolved.", "success"); refresh();
      }
    });
  };

  /* ─────────────────────────── modals ─────────────────────────── */

  async function openAssetModal(pid, companyId, rec, refresh) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return;
    const r = rec || C.new({ companyId: companyId });
    const [sites, contacts, classes] = await Promise.all([
      ERP.companies.sites(companyId), ERP.companies.contacts(companyId), ERP.taxonomy.optionList(pid, "productClass"),
    ]);
    const m = ui.modal({
      title: rec ? "Edit asset" : "New asset",
      size: "lg",
      body: ui.form(
        '<div class="erp-form-row">' + ui.text("name", "Name", r.name) + ui.select("type", "Type", C.TYPES.map((t) => ({ value: t.id, label: t.label })), r.type) + "</div>" +
        '<div class="erp-form-row">' + ui.text("make", "Make", r.make) + ui.text("model", "Model", r.model) + "</div>" +
        '<div class="erp-form-row">' + ui.text("serialNumber", "Serial number", r.serialNumber) + ui.text("assetTag", "Asset tag", r.assetTag) + "</div>" +
        '<div class="erp-form-row">' + ui.select("siteId", "Site", [{ value: "", label: "— none —" }].concat(sites.map((s) => ({ value: s.id, label: s.name }))), r.siteId) +
          ui.select("contactId", "Contact", [{ value: "", label: "— none —" }].concat(contacts.map((c) => ({ value: c.id, label: c.name }))), r.contactId) + "</div>" +
        '<div class="erp-form-row">' + ui.text("hostname", "Hostname", r.hostname) + ui.text("ipAddress", "IP address", r.ipAddress) + "</div>" +
        '<div class="erp-form-row">' + ui.text("macAddress", "MAC address", r.macAddress) + ui.text("os", "OS / version", r.os) + "</div>" +
        '<div class="erp-form-row">' + ui.dateInput("purchaseDate", "Purchased", r.purchaseDate) + ui.text("location", "Location", r.location) + "</div>" +
        '<div class="erp-form-row">' + ui.dateInput("warrantyStart", "Warranty start", r.warrantyStart) + ui.dateInput("warrantyEnd", "Warranty end", r.warrantyEnd) + "</div>" +
        '<div class="erp-form-row">' + ui.dateInput("supportStart", "Support start", r.supportStart) + ui.dateInput("supportEnd", "Support end", r.supportEnd) + "</div>" +
        '<div class="erp-form-row">' + ui.select("status", "Status", C.STATUSES.map((s) => ({ value: s.id, label: s.label })), r.status) +
          ui.select("classId", "Product class", [{ value: "", label: "— none —" }].concat(classes), r.classId) + "</div>" +
        ui.textarea("notes", "Notes", r.notes, 3)
      ),
      foot: ui.btn("Cancel", { small: true, act: "cfm-cancel" }) + " " + ui.btn("Save", { small: true, primary: true, act: "cfm-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=cfm-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=cfm-save]").onclick = async () => {
      const v = ui.collect(f, ["name", "type", "make", "model", "serialNumber", "assetTag", "siteId", "contactId", "hostname", "ipAddress", "macAddress", "os", "purchaseDate", "location", "warrantyStart", "warrantyEnd", "supportStart", "supportEnd", "status", "classId", "notes"]);
      ["siteId", "contactId", "classId"].forEach((k) => { if (v[k] === "") v[k] = null; });
      const res = await C.save(pid, companyId, Object.assign({}, r, v));
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal(); ERP.toast("Asset saved.", "success"); refresh();
    };
  }

  async function openAsset(pid, companyId, id, refresh) {
    const r = await C.item(pid, companyId, id);
    if (!r) { ERP.toast("Asset not found.", "error"); return; }
    const [items, sites] = await Promise.all([C.items(pid, companyId, {}), ERP.companies.sites(companyId)]);
    const siteName = {}; sites.forEach((s) => { siteName[String(s.id)] = s.name; });
    const canEdit = ERP.security.can("configuration.edit", { companyId: companyId });
    const ownership = C.ownership(r);
    const owners = C.SYNCABLE_FIELDS.map((field) => ({ field: field, owner: ownership[field] || "psa" }));
    const relRows = (r.relationships || []).map((rel) => {
      const target = items.find((x) => String(x.id) === String(rel.targetId));
      return {
        type: esc((C.REL_TYPES.find((t) => t.id === rel.type) || {}).label || rel.type),
        target: esc(target ? target.name : ("#" + rel.targetId)),
        actions: canEdit ? ui.btn("Remove", { small: true, danger: true, act: "cfa-unrel", arg: rel.id }) : "",
      };
    });
    const driftRows = (r.drift || []).map((d) => ({
      field: esc(d.field), local: esc(d.local == null ? "—" : String(d.local)), external: esc(d.external == null ? "—" : String(d.external)),
      actions: canEdit ? ui.btn("Keep ours", { small: true, act: "cfa-local", arg: d.field }) + " " + ui.btn("Take theirs", { small: true, primary: true, act: "cfa-there", arg: d.field }) : "",
    }));
    const kv = [
      ["Type", C.typeLabel(r.type)], ["Make / model", [r.make, r.model].filter(Boolean).join(" ")],
      ["Serial", r.serialNumber], ["Asset tag", r.assetTag], ["Hostname", r.hostname],
      ["IP", r.ipAddress], ["MAC", r.macAddress], ["OS", r.os],
      ["Site", r.siteId != null ? siteName[String(r.siteId)] || "" : ""], ["Location", r.location],
      ["Purchased", r.purchaseDate], ["Warranty", [r.warrantyStart, r.warrantyEnd].filter(Boolean).join(" → ")],
      ["Support", [r.supportStart, r.supportEnd].filter(Boolean).join(" → ")],
      ["Status", C.statusLabel(r.status)], ["Source", r.source], ["Last synced", r.lastSyncedAt ? ui.dateTime(r.lastSyncedAt) : "—"],
    ];
    const m = ui.modal({
      title: r.name,
      size: "lg",
      body:
        (r.drift || []).length ? ui.alert("This record has " + r.drift.length + " field(s) where PSA-U and the documentation system disagree.", "warn") : "" +
        '<div class="erp-defs">' + kv.map((x) => "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1] || "—") + "</dd>").join("") + "</div>" +
        (r.notes ? '<p class="erp-note-body">' + esc(r.notes) + "</p>" : "") +
        '<div class="erp-sep"></div><h4>Documentation drift</h4>' +
        ui.table([{ key: "field", label: "Field" }, { key: "local", label: "PSA-U" }, { key: "external", label: "Documentation" }, { key: "actions", label: "", align: "right" }], driftRows, { emptyText: "No conflicts." }) +
        '<div class="erp-sep"></div><h4>Relationships</h4>' +
        ui.table([{ key: "type", label: "Relationship" }, { key: "target", label: "Asset" }, { key: "actions", label: "", align: "right" }], relRows, { emptyText: "No relationships." }) +
        (canEdit ? '<div class="erp-btn-row">' + ui.btn("Add relationship", { small: true, act: "cfa-rel" }) + " " + ui.btn("Edit", { small: true, act: "cfa-edit" }) + "</div>" : "") +
        '<div class="erp-sep"></div><h4>Field ownership</h4>' +
        '<p class="erp-sub">Who is authoritative for each field when the two systems sync.</p>' +
        ui.table([{ key: "field", label: "Field" }, { key: "owner", label: "Owner", render: (x) => ui.badge(x.owner === "docs" ? "Documentation" : "PSA-U", x.owner === "docs" ? "info" : "muted") }], owners),
      foot: ui.btn("Close", { small: true, act: "cfa-close" }),
    });
    m.querySelector("[data-act=cfa-close]").onclick = () => ui.closeModal();
    const edit = m.querySelector("[data-act=cfa-edit]");
    if (edit) edit.onclick = () => openAssetModal(pid, companyId, r, refresh);
    const relBtn = m.querySelector("[data-act=cfa-rel]");
    if (relBtn) relBtn.onclick = () => openRelModal(pid, companyId, r, items, refresh);
    const resolve = (field, decision) => C.resolveDrift(pid, companyId, id, field, decision).then((res) => {
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ERP.toast("Conflict resolved.", "success"); refresh(); openAsset(pid, companyId, id, refresh);
    });
    m.querySelectorAll("[data-act=cfa-local]").forEach((b) => b.onclick = () => resolve(b.getAttribute("data-arg"), "local"));
    m.querySelectorAll("[data-act=cfa-there]").forEach((b) => b.onclick = () => resolve(b.getAttribute("data-arg"), "external"));
    m.querySelectorAll("[data-act=cfa-unrel]").forEach((b) => b.onclick = async () => {
      await C.removeRelationship(pid, companyId, id, b.getAttribute("data-arg"));
      refresh(); openAsset(pid, companyId, id, refresh);
    });
  }

  async function openRelModal(pid, companyId, r, items, refresh) {
    const opts = items.filter((x) => String(x.id) !== String(r.id)).map((x) => ({ value: x.id, label: x.name }));
    if (!opts.length) { ERP.toast("There is no other asset to relate to.", "error"); return; }
    const m = ui.modal({
      title: "Add relationship",
      body: ui.form(ui.select("type", "Relationship", C.REL_TYPES.map((t) => ({ value: t.id, label: t.label })), "connects_to") + ui.select("targetId", "Asset", opts, opts[0].value)),
      foot: ui.btn("Cancel", { small: true, act: "cfr-cancel" }) + " " + ui.btn("Add", { small: true, primary: true, act: "cfr-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=cfr-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=cfr-save]").onclick = async () => {
      const v = ui.collect(f, ["type", "targetId"]);
      const res = await C.setRelationship(pid, companyId, r.id, v);
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal(); ERP.toast("Relationship added.", "success"); refresh(); openAsset(pid, companyId, r.id, refresh);
    };
  }

  async function openSyncModal(pid, companyId, refresh) {
    if (!ERP.security.enforce("configuration.edit", { companyId: companyId })) return;
    const sample = await C.sampleFeed(pid, companyId);
    const m = ui.modal({
      title: "Sync from the documentation system",
      size: "lg",
      body: ui.form(
        ui.alert("Fields the documentation system owns are updated from the feed. Fields PSA-U owns are never overwritten — a difference is filed as drift for you to resolve.", "info") +
        '<div class="field"><label>Documentation feed (JSON array)</label><textarea name="feed" rows="10">' + esc(JSON.stringify(sample, null, 2)) + "</textarea></div>"
      ),
      foot: ui.btn("Cancel", { small: true, act: "cfs-cancel" }) + " " + ui.btn("Apply sync", { small: true, primary: true, act: "cfs-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=cfs-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=cfs-save]").onclick = async () => {
      let records;
      try { records = JSON.parse(f.querySelector("[name=feed]").value || "[]"); }
      catch (e) { return ERP.toast("That feed is not valid JSON.", "error"); }
      const res = await C.syncFromDocs(pid, companyId, records);
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal();
      const rep = res.report;
      ERP.toast("Synced · " + rep.created.length + " new, " + rep.updated.length + " updated, " + rep.drifted.length + " drifted.", rep.drifted.length ? "warn" : "success");
      refresh();
    };
  }
})();
