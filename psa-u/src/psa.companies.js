/* ============================================================
   PSA-U — companies, sites & contacts (Phase 1 · Task 3)
   The client hierarchy that roots every other record. A company
   record (status, type, billing & site addresses, billing terms,
   tax, account manager) lives in its own company document; its
   sites (billing / shipping / service locations) and contacts
   (with roles, phone/email, site and portal access) live in the
   same document, so one tenant document holds everything about a
   client — its tickets, time, agreements and invoices included.

   The provider's document keeps a lightweight company-directory
   index so the register lists without reading every company doc.
   Every mutation is permission-checked through ERP.security.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const C = (ERP.companies = {});

  const STATUSES = [
    { id: "prospect", label: "Prospect", tone: "info" },
    { id: "active", label: "Active", tone: "success" },
    { id: "on-hold", label: "On hold", tone: "warn" },
    { id: "churned", label: "Churned", tone: "danger" },
  ];
  const TYPES = ["client", "prospect", "partner", "vendor"];
  const SITE_TYPES = ["service", "billing", "shipping", "office"];
  const CONTACT_ROLES = ["primary", "technical", "billing", "decision maker", "after hours"];

  C.STATUSES = STATUSES;
  C.TYPES = TYPES;
  C.SITE_TYPES = SITE_TYPES;
  C.CONTACT_ROLES = CONTACT_ROLES;

  C.statusLabel = (id) => (STATUSES.find((s) => s.id === id) || {}).label || "Active";
  C.statusTone = (id) => (STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  function ten() {
    if (!ERP.tenancy) throw new Error("companies requires the tenancy service");
    return ERP.tenancy;
  }

  function nowIso() { return new Date().toISOString(); }

  /* ─────────────────────────── reads ─────────────────────────── */

  C.list = async function (providerId) {
    const entries = await ten().companyIndex(providerId);
    return entries.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  };

  C.docs = async function (companyId) {
    const r = await ten().load("company", companyId);
    const records = r.records || [];
    return {
      company: records.find((x) => x.kind === "company") || null,
      sites: records.filter((x) => x.kind === "site"),
      contacts: records.filter((x) => x.kind === "contact"),
      raw: records,
    };
  };

  C.get = async function (companyId) { return (await C.docs(companyId)).company; };
  C.sites = async function (companyId) { return (await C.docs(companyId)).sites; };
  C.contacts = async function (companyId) { return (await C.docs(companyId)).contacts; };
  C.site = async (companyId, id) => (await C.sites(companyId)).find((s) => String(s.id) === String(id)) || null;
  C.contact = async (companyId, id) => (await C.contacts(companyId)).find((s) => String(s.id) === String(id)) || null;

  C.counts = async function (companyId) {
    const d = await C.docs(companyId);
    return { sites: d.sites.length, contacts: d.contacts.length };
  };

  C.current = async function () { return ten().company(); };

  C.optionList = async function () {
    const entries = await C.list();
    const visible = ERP.security ? ERP.security.visibleCompanies(entries) : entries;
    return visible.map((e) => ({ value: e.id, label: e.name }));
  };

  C.newCompany = function (over) {
    return Object.assign({
      kind: "company",
      name: "",
      legalName: "",
      status: "prospect",
      type: "client",
      phone: "",
      email: "",
      website: "",
      taxId: "",
      currency: "",
      billingTerm: "",
      accountManager: null,
      address1: "",
      city: "",
      region: "",
      postal: "",
      country: "",
      notes: "",
    }, over || {});
  };

  C.newSite = function (companyId, over) {
    return Object.assign({
      kind: "site", companyId: companyId, name: "", type: "service",
      address1: "", city: "", region: "", postal: "", country: "",
      phone: "", isPrimary: false, notes: "",
    }, over || {});
  };

  C.newContact = function (companyId, over) {
    return Object.assign({
      kind: "contact", companyId: companyId, siteId: null, name: "", title: "",
      email: "", phone: "", roles: [], portalAccess: false, isPrimary: false, notes: "",
    }, over || {});
  };

  async function nextCompanyId(providerId) {
    const entries = await C.list(providerId);
    let max = 0;
    entries.forEach((e) => { if (isFinite(e.id)) max = Math.max(max, Number(e.id)); });
    return max + 1;
  }

  async function writeCompanyDoc(companyId, records) {
    return ten().save("company", companyId, records);
  }

  /* ─────────────────────────── writes ─────────────────────────── */

  C.saveCompany = async function (company) {
    if (!ERP.security.enforce("companies.edit")) return { error: "forbidden" };
    const p = await ten().provider();
    if (!p) return { error: "no_provider" };
    let id = company.id;
    let created = false;
    if (id == null) {
      id = await nextCompanyId(p.id);
      created = true;
    }
    const rec = Object.assign(C.newCompany(), company, {
      id: id, kind: "company", providerId: p.id, updatedAt: nowIso(),
      createdAt: company.createdAt || nowIso(),
    });
    const d = await C.docs(id);
    const records = d.raw.filter((x) => x.kind !== "company").concat([rec]);
    const res = await writeCompanyDoc(id, records);
    if (res.error) return res;
    await ten().upsertCompanyIndex(p.id, rec, { sites: d.sites.length, contacts: d.contacts.length });
    if (created && !ten().activeCompanyId()) ten().setActiveCompany(id);
    C.syncSelect();
    return Object.assign({ record: rec, created: created }, res);
  };

  C.deleteCompany = async function (companyId) {
    if (!ERP.security.enforce("companies.delete")) return { error: "forbidden" };
    const p = await ten().provider();
    await writeCompanyDoc(companyId, []);
    if (p) await ten().removeCompanyIndex(p.id, companyId);
    if (String(ten().activeCompanyId()) === String(companyId)) ten().setActiveCompany(null);
    C.syncSelect();
    return { ok: true, id: companyId };
  };

  C.saveSite = async function (companyId, site) {
    if (!ERP.security.enforce("sites.edit", { companyId: companyId })) return { error: "forbidden" };
    const d = await C.docs(companyId);
    const list = d.raw.slice();
    let rec = Object.assign(C.newSite(companyId), site, { companyId: companyId, kind: "site" });
    if (rec.id == null) rec.id = ten().nextId(list.filter((x) => x.kind === "site"));
    const i = list.findIndex((x) => x.kind === "site" && String(x.id) === String(rec.id));
    if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
    if (rec.isPrimary) list.forEach((x) => { if (x.kind === "site" && String(x.id) !== String(rec.id)) x.isPrimary = false; });
    const res = await writeCompanyDoc(companyId, list);
    if (!res.error && d.company) await ten().upsertCompanyIndex((await ten().provider()).id, d.company, { sites: list.filter((x) => x.kind === "site").length, contacts: list.filter((x) => x.kind === "contact").length });
    return Object.assign({ record: rec }, res);
  };

  C.deleteSite = async function (companyId, siteId) {
    if (!ERP.security.enforce("sites.edit", { companyId: companyId })) return { error: "forbidden" };
    const d = await C.docs(companyId);
    const list = d.raw.filter((x) => !(x.kind === "site" && String(x.id) === String(siteId)));
    const res = await writeCompanyDoc(companyId, list);
    if (!res.error && d.company) await ten().upsertCompanyIndex((await ten().provider()).id, d.company, { sites: list.filter((x) => x.kind === "site").length, contacts: list.filter((x) => x.kind === "contact").length });
    return res;
  };

  C.saveContact = async function (companyId, contact) {
    if (!ERP.security.enforce("contacts.edit", { companyId: companyId })) return { error: "forbidden" };
    const d = await C.docs(companyId);
    const list = d.raw.slice();
    let rec = Object.assign(C.newContact(companyId), contact, { companyId: companyId, kind: "contact" });
    if (rec.id == null) rec.id = ten().nextId(list.filter((x) => x.kind === "contact"));
    const i = list.findIndex((x) => x.kind === "contact" && String(x.id) === String(rec.id));
    if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
    if (rec.isPrimary) list.forEach((x) => { if (x.kind === "contact" && String(x.id) !== String(rec.id)) x.isPrimary = false; });
    const res = await writeCompanyDoc(companyId, list);
    if (!res.error && d.company) await ten().upsertCompanyIndex((await ten().provider()).id, d.company, { sites: list.filter((x) => x.kind === "site").length, contacts: list.filter((x) => x.kind === "contact").length });
    return Object.assign({ record: rec }, res);
  };

  C.deleteContact = async function (companyId, contactId) {
    if (!ERP.security.enforce("contacts.edit", { companyId: companyId })) return { error: "forbidden" };
    const d = await C.docs(companyId);
    const list = d.raw.filter((x) => !(x.kind === "contact" && String(x.id) === String(contactId)));
    const res = await writeCompanyDoc(companyId, list);
    if (!res.error && d.company) await ten().upsertCompanyIndex((await ten().provider()).id, d.company, { sites: list.filter((x) => x.kind === "site").length, contacts: list.filter((x) => x.kind === "contact").length });
    return res;
  };

  /* ─────────────────────────── topbar client selector ─────────────────────────── */

  C.syncSelect = async function () {
    const sel = document.getElementById("companySelect");
    if (!sel) return;
    const opts = await C.optionList();
    const active = ten().activeCompanyId();
    let html = '<option value="">— No client selected —</option>' +
      opts.map((o) => '<option value="' + ERP.escapeHtml(o.value) + '"' + (String(o.value) === String(active) ? " selected" : "") + ">" + ERP.escapeHtml(o.label) + "</option>").join("");
    sel.innerHTML = html;
    const wrap = document.getElementById("companySelectWrap");
    if (wrap) wrap.hidden = opts.length === 0;
  };

  function wireSelect() {
    const sel = document.getElementById("companySelect");
    if (sel && !sel.__psaWired) {
      sel.__psaWired = true;
      sel.addEventListener("change", () => {
        ten().setActiveCompany(sel.value || null);
        ERP.toast(sel.value ? "Active client changed." : "No client selected.", "success");
      });
    }
    C.syncSelect();
  }

  /* ─────────────────────────── register UI (controller) ─────────────────────────── */

  function snapToOptions(list, labeler) {
    return (list || []).map((r) => ({ value: r.id, label: labeler(r) }));
  }

  async function openCompanyModal(company, refresh) {
    if (!ERP.security.enforce("companies.edit")) return;
    const p = await ten().provider();
    const [managers, terms, currencies] = await Promise.all([
      ERP.members.members(),
      ERP.taxonomy.optionList(p.id, "billingTerm"),
      Promise.resolve(Object.keys(ERP.ui.CURRENCIES)),
    ]);
    const c = company || C.newCompany();
    const fields =
      ui.text("name", "Company name", c.name) +
      ui.text("legalName", "Legal name", c.legalName) +
      '<div class="erp-form-row">' +
        ui.select("status", "Status", STATUSES.map((s) => ({ value: s.id, label: s.label })), c.status) +
        ui.select("type", "Type", TYPES, c.type) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("phone", "Phone", c.phone) +
        ui.text("email", "Email", c.email) +
      "</div>" +
      ui.text("website", "Website", c.website) +
      '<div class="erp-form-row">' +
        ui.text("taxId", "Tax / VAT id", c.taxId) +
        ui.select("currency", "Currency", currencies, c.currency || (p && p.currency) || "USD") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("billingTerm", "Billing terms", terms, c.billingTerm) +
        ui.select("accountManager", "Account manager", snapToOptions(managers, (m) => m.name), c.accountManager) +
      "</div>" +
      ui.text("address1", "Address", c.address1) +
      '<div class="erp-form-row">' +
        ui.text("city", "City", c.city) +
        ui.text("region", "State / region", c.region) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("postal", "Postal code", c.postal) +
        ui.text("country", "Country", c.country) +
      "</div>" +
      ui.textarea("notes", "Notes", c.notes, 3);
    const m = ui.modal({
      title: company ? "Edit client" : "New client",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "c-cancel" }) + " " + ui.btn(company ? "Save client" : "Create client", { small: true, primary: true, act: "c-save" }),
    });
    const form = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=c-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=c-save]").onclick = async (t) => {
      const v = ui.collect(form, ["name", "legalName", "status", "type", "phone", "email", "website", "taxId", "currency", "billingTerm", "accountManager", "address1", "city", "region", "postal", "country", "notes"]);
      if (!v.name) { ERP.toast("A company name is required.", "error"); return; }
      t.disabled = true;
      const rec = Object.assign({}, c, v, { id: c.id, createdAt: c.createdAt });
      const res = await C.saveCompany(rec);
      ui.closeModal();
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      ERP.toast(company ? "Client updated." : "Client created.", "success");
      refresh();
    };
  }

  async function openSiteModal(sites, site, defaultCompanyId, refresh) {
    if (!ERP.security.enforce("sites.edit", { companyId: (site && site.companyId) || defaultCompanyId })) return;
    const companies = await C.optionList();
    const s = site || C.newSite(defaultCompanyId || "", {});
    const fields =
      ui.select("companyId", "Client", companies, s.companyId, "Select a client…") +
      ui.text("name", "Site name", s.name) +
      ui.select("type", "Site type", SITE_TYPES, s.type) +
      ui.text("address1", "Address", s.address1) +
      '<div class="erp-form-row">' +
        ui.text("city", "City", s.city) +
        ui.text("region", "State / region", s.region) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("postal", "Postal code", s.postal) +
        ui.text("country", "Country", s.country) +
      "</div>" +
      ui.text("phone", "Phone", s.phone) +
      ui.check("isPrimary", "Primary site", s.isPrimary) +
      ui.textarea("notes", "Notes", s.notes, 3);
    const m = ui.modal({
      title: site ? "Edit site" : "New site",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "s-cancel" }) + " " + ui.btn(site ? "Save site" : "Create site", { small: true, primary: true, act: "s-save" }),
    });
    const form = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=s-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=s-save]").onclick = async (t) => {
      const v = ui.collect(form, ["companyId", "name", "type", "address1", "city", "region", "postal", "country", "phone", "isPrimary", "notes"]);
      if (!v.companyId) { ERP.toast("Choose the client this site belongs to.", "error"); return; }
      t.disabled = true;
      const res = await C.saveSite(v.companyId, Object.assign({}, s, v, { id: s.id }));
      ui.closeModal();
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      ERP.toast(site ? "Site updated." : "Site created.", "success");
      refresh();
    };
  }

  async function openContactModal(contact, defaultCompanyId, refresh) {
    if (!ERP.security.enforce("contacts.edit", { companyId: (contact && contact.companyId) || defaultCompanyId })) return;
    const companies = await C.optionList();
    const c = contact || C.newContact(defaultCompanyId || "", {});
    let siteOpts = c.companyId ? snapToOptions(await C.sites(c.companyId), (x) => x.name) : [];
    const fields =
      ui.select("companyId", "Client", companies, c.companyId, "Select a client…") +
      ui.text("name", "Full name", c.name) +
      ui.text("title", "Job title", c.title) +
      '<div class="erp-form-row">' +
        ui.text("email", "Email", c.email) +
        ui.text("phone", "Phone", c.phone) +
      "</div>" +
      '<div class="field"><label>Site</label><select name="siteId" data-site-select><option value="">—</option>' +
        siteOpts.map((o) => '<option value="' + ui.esc(o.value) + '"' + (String(o.value) === String(c.siteId) ? " selected" : "") + ">" + ui.esc(o.label) + "</option>").join("") +
      "</select></div>" +
      '<div class="field"><label>Roles</label><div class="radio-group">' +
        CONTACT_ROLES.map((r) => '<label><input type="checkbox" name="role" value="' + ui.esc(r) + '"' + ((c.roles || []).indexOf(r) >= 0 ? " checked" : "") + "> " + ui.esc(r) + "</label>").join("") +
      "</div></div>" +
      ui.check("portalAccess", "Client-portal access", c.portalAccess) +
      ui.check("isPrimary", "Primary contact", c.isPrimary) +
      ui.textarea("notes", "Notes", c.notes, 3);
    const m = ui.modal({
      title: contact ? "Edit contact" : "New contact",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "k-cancel" }) + " " + ui.btn(contact ? "Save contact" : "Create contact", { small: true, primary: true, act: "k-save" }),
    });
    const form = m.querySelector("[data-ui-form]");
    const companySel = form.querySelector('[name="companyId"]');
    companySel.addEventListener("change", async () => {
      const sites = companySel.value ? await C.sites(companySel.value) : [];
      const sel = form.querySelector("[data-site-select]");
      sel.innerHTML = '<option value="">—</option>' + snapToOptions(sites, (x) => x.name).map((o) => '<option value="' + ui.esc(o.value) + '">' + ui.esc(o.label) + "</option>").join("");
    });
    m.querySelector("[data-act=k-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=k-save]").onclick = async (t) => {
      const v = ui.collect(form, ["companyId", "name", "title", "email", "phone", "siteId", "portalAccess", "isPrimary", "notes"]);
      v.roles = Array.from(form.querySelectorAll('input[name="role"]:checked')).map((i) => i.value);
      if (!v.companyId) { ERP.toast("Choose the client this contact belongs to.", "error"); return; }
      if (!v.name) { ERP.toast("A contact name is required.", "error"); return; }
      t.disabled = true;
      const res = await C.saveContact(v.companyId, Object.assign({}, c, v, { id: c.id }));
      ui.closeModal();
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      ERP.toast(contact ? "Contact updated." : "Contact created.", "success");
      refresh();
    };
  }

  C.render = async function (ctx) {
    if (!ERP.security.enforce("companies.view")) {
      ERP.states.error(ctx.el, { title: "Not available", message: "Your role cannot view the client register." });
      return;
    }
    const host = ctx.el;
    const render = async () => {
      const prev = host.__tab;
      ERP.states.loading(host, "Loading clients");
      /* Render into a fresh inner node so delegated listeners from the previous
         render are discarded (host itself persists across re-renders). */
      const root = document.createElement("div");
      root.className = "erp-module";
      const entries = ERP.security.visibleCompanies(await C.list());
      const companies = [];
      for (const e of entries) {
        const d = await C.docs(e.id);
        const company = d.company || C.newCompany({ id: e.id, name: e.name });
        if (company.accountManager != null) company.__managerName = await ERP.members.memberName(company.accountManager);
        companies.push({ entry: e, company: company, sites: d.sites, contacts: d.contacts });
      }
      const totalSites = companies.reduce((n, c) => n + c.sites.length, 0);
      const totalContacts = companies.reduce((n, c) => n + c.contacts.length, 0);
      const canEdit = ERP.security.can("companies.edit");
      const canDelete = ERP.security.can("companies.delete");

      const tabs = [
        { id: "companies", label: "Clients", badge: companies.length || "" },
        { id: "sites", label: "Sites", badge: totalSites || "" },
        { id: "contacts", label: "Contacts", badge: totalContacts || "" },
      ];
      const active = tabs.find((t) => t.id === prev) ? prev : "companies";
      const t = ui.tabs(tabs, active);
      const q = host.__q || "";

      host.innerHTML = "";
      host.appendChild(root);
      root.innerHTML =
        ui.pageHead("Clients & directory", "Every client company, its sites and its contacts — the root of all service work.", ui.btn("Add client", { primary: true, act: "co-new" })) +
        ui.summary([
          { label: "Clients", value: String(companies.length) },
          { label: "Sites", value: String(totalSites) },
          { label: "Contacts", value: String(totalContacts) },
          { label: "Portal-enabled contacts", value: String(companies.reduce((n, c) => n + c.contacts.filter((x) => x.portalAccess).length, 0)) },
        ]) +
        '<div class="erp-toolbar"><input type="search" data-co-search placeholder="Search clients, sites & contacts…" value="' + ui.esc(q) + '"></div>' +
        t.html;

      const panel = (id) => root.querySelector('[data-panel="' + id + '"]');
      const match = (s) => !q || String(s || "").toLowerCase().indexOf(q.toLowerCase()) !== -1;

      /* companies */
      const coRows = companies
        .filter((c) => match(c.company.name) || match(c.entry.city) || c.sites.some((s) => match(s.name)) || c.contacts.some((x) => match(x.name)))
        .map((c) => ({
          name: "<b>" + ui.esc(c.company.name) + "</b>" + (c.company.legalName ? '<div class="erp-sub">' + ui.esc(c.company.legalName) + "</div>" : ""),
          status: ui.badge(C.statusLabel(c.company.status), C.statusTone(c.company.status)),
          type: ui.esc(c.company.type || "client"),
          manager: ui.esc(c.company.__managerName || "—"),
          city: ui.esc([c.company.city, c.company.region, c.company.country].filter(Boolean).join(", ") || "—"),
          sites: ui.fmt(c.sites.length, 0),
          contacts: ui.fmt(c.contacts.length, 0),
          actions: (canEdit ? ui.btn("Edit", { small: true, act: "co-edit", arg: c.company.id }) : "") +
            (canDelete ? " " + ui.btn("Delete", { small: true, danger: true, act: "co-del", arg: c.company.id }) : ""),
          _id: c.company.id,
        }));
      panel("companies").innerHTML = ui.card(null, ui.table([
        { key: "name", label: "Client" },
        { key: "status", label: "Status" },
        { key: "type", label: "Type" },
        { key: "manager", label: "Account manager" },
        { key: "city", label: "Location" },
        { key: "sites", label: "Sites", align: "right" },
        { key: "contacts", label: "Contacts", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], coRows));

      /* sites */
      const siteRows = [];
      companies.forEach((c) => c.sites.forEach((s) => {
        if (!match(s.name) && !match(c.company.name) && !match(s.city)) return;
        siteRows.push({
          site: "<b>" + ui.esc(s.name) + "</b>" + (s.isPrimary ? " " + ui.badge("primary", "info") : ""),
          company: ui.esc(c.company.name),
          type: ui.esc(s.type),
          city: ui.esc([s.city, s.region].filter(Boolean).join(", ") || "—"),
          phone: ui.esc(s.phone || "—"),
          actions: (canEdit ? ui.btn("Edit", { small: true, act: "si-edit", arg: c.company.id + "|" + s.id }) : "") +
            (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "si-del", arg: c.company.id + "|" + s.id }) : ""),
        });
      }));
      panel("sites").innerHTML = ui.card(null, ui.table([
        { key: "site", label: "Site" },
        { key: "company", label: "Client" },
        { key: "type", label: "Type" },
        { key: "city", label: "Location" },
        { key: "phone", label: "Phone" },
        { key: "actions", label: "", align: "right" },
      ], siteRows));

      /* contacts */
      const contactRows = [];
      companies.forEach((c) => c.contacts.forEach((k) => {
        if (!match(k.name) && !match(c.company.name) && !match(k.email)) return;
        contactRows.push({
          name: "<b>" + ui.esc(k.name) + "</b>" + (k.isPrimary ? " " + ui.badge("primary", "info") : "") + (k.title ? '<div class="erp-sub">' + ui.esc(k.title) + "</div>" : ""),
          company: ui.esc(c.company.name),
          email: ui.esc(k.email || "—"),
          phone: ui.esc(k.phone || "—"),
          roles: ui.esc((k.roles || []).join(", ") || "—"),
          portal: k.portalAccess ? ui.badge("portal", "success") : ui.badge("no", "muted"),
          actions: (canEdit ? ui.btn("Edit", { small: true, act: "kt-edit", arg: c.company.id + "|" + k.id }) : "") +
            (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "kt-del", arg: c.company.id + "|" + k.id }) : ""),
        });
      }));
      panel("contacts").innerHTML = ui.card(null, ui.table([
        { key: "name", label: "Contact" },
        { key: "company", label: "Client" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "roles", label: "Roles" },
        { key: "portal", label: "Portal" },
        { key: "actions", label: "", align: "right" },
      ], contactRows));

      root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => ui.showTab(root, b.getAttribute("data-tab"))));
      const search = root.querySelector("[data-co-search]");
      if (search) search.addEventListener("input", () => { host.__q = search.value; render(); });

      ui.bind(root, "click", "[data-act]", async (el, e, act, arg) => {
        if (act === "co-new") return openCompanyModal(null, render);
        if (act === "co-edit") { const comp = await C.get(arg); return openCompanyModal(comp, render); }
        if (act === "co-del") {
          const comp = await C.get(arg);
          if (!comp) return;
          if (await ui.confirm({ title: "Delete client?", message: comp.name + " and its sites and contacts will be removed. This cannot be undone.", danger: true, okLabel: "Delete client" })) {
            const res = await C.deleteCompany(arg);
            ERP.toast(res.error ? "Delete failed." : "Client deleted.", res.error ? "error" : "success");
            render();
          }
          return;
        }
        if (act === "si-edit" || act === "kt-edit") {
          const [cid, id] = String(arg).split("|");
          if (act === "si-edit") return openSiteModal(null, await C.site(cid, id), cid, render);
          return openContactModal(await C.contact(cid, id), cid, render);
        }
        if (act === "si-del" || act === "kt-del") {
          const [cid, id] = String(arg).split("|");
          if (await ui.confirm({ title: "Delete record?", message: "This record will be removed from the client.", danger: true, okLabel: "Delete" })) {
            if (act === "si-del") await C.deleteSite(cid, id); else await C.deleteContact(cid, id);
            ERP.toast("Deleted.", "success");
            render();
          }
        }
      });
    };
    await render();
  };

  /* Boot: keep the topbar client selector in step with tenant changes. */
  function boot() {
    wireSelect();
    if (ERP.tenancy && ERP.tenancy.subscribe) ERP.tenancy.subscribe(() => C.syncSelect());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
