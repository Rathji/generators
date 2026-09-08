window.CRM_EMAILS = (function () {
  const R = window.CRM_RECORDS;
  const U = window.RECORDUI;
  const A = window.CRM_ACTIVITIES;
  if (!R || !U || !A) return null;
  const MOD = "emails";

  const MERGE_DOC = [
    "{{company.name}}", "{{company.industry}}", "{{contact.full_name}}", "{{contact.first_name}}",
    "{{contact.last_name}}", "{{contact.email}}", "{{contact.role}}", "{{deal.name}}",
    "{{deal.expected_value}}", "{{deal.close_date}}", "{{today}}"
  ];

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function validateTemplate(raw) {
    const errors = {};
    const name = String(raw.name || "").trim();
    if (!name) errors.name = "Give the template a name.";
    else if (name.length > 80) errors.name = "Keep the name under 80 characters.";
    const subject = String(raw.subject || "").trim();
    const body = String(raw.body || "");
    if (!subject && !body) errors.subject = "A template needs at least a subject or a body.";
    if (body.length > 12000) errors.body = "Keep the body under 12000 characters.";
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, values: { name, subject, body } };
  }

  function tplId() {
    return "t-" + window.BcrmStore.randHex(6);
  }

  function applyTemplate(base, values) {
    const now = R.nowISO();
    const t = Object.assign({}, base || {});
    const isNew = !t.id;
    if (isNew) t.id = tplId();
    t.name = values.name;
    t.subject = values.subject;
    t.body = values.body;
    if (!isNew) t.updatedAt = now;
    else t.createdAt = now;
    return t;
  }

  async function listTemplates(store) {
    const doc = await store.loadDoc(MOD);
    const content = (doc && doc.content) || {};
    return Array.isArray(content.templates) ? content.templates.slice() : [];
  }

  async function upsertTemplate(store, tpl) {
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return doc || { ok: false, code: "load_failed", detail: "the emails document could not be read" };
    const content = JSON.parse(JSON.stringify(doc.content || { templates: [] }));
    if (!Array.isArray(content.templates)) content.templates = [];
    const idx = content.templates.findIndex(t => t.id === tpl.id);
    if (idx === -1) content.templates.push(tpl);
    else content.templates[idx] = tpl;
    const res = await store.saveChecked(MOD, content, { expectedBase: doc.revision });
    if (res && res.ok && !res.noop && window.CRM_EVENTS) window.CRM_EVENTS.fire("moduleWrite", { module: MOD, res, changes: [] });
    return res;
  }

  async function deleteTemplate(store, id) {
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return doc || { ok: false, code: "load_failed", detail: "the emails document could not be read" };
    const content = JSON.parse(JSON.stringify(doc.content || { templates: [] }));
    content.templates = (content.templates || []).filter(t => t.id !== id);
    const res = await store.saveChecked(MOD, content, { expectedBase: doc.revision });
    if (res && res.ok && !res.noop && window.CRM_EVENTS) window.CRM_EVENTS.fire("moduleWrite", { module: MOD, res, changes: [] });
    return res;
  }

  function scopeValue(scope, path) {
    const parts = String(path).split(".");
    let node = scope;
    for (const p of parts) {
      if (node === null || node === undefined) return undefined;
      node = node[p];
    }
    return node;
  }

  function renderMerge(text, scope) {
    scope = scope || {};
    const today = fmtToday();
    const s = Object.assign({ today }, scope);
    return String(text).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (full, key) => {
      const v = scopeValue(s, key);
      if (v === undefined || v === null) return full;
      return String(v);
    });
  }

  function fmtToday() {
    const d = new Date();
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  async function buildScope(store, ids) {
    ids = ids || {};
    const out = {};
    if (ids.companyId) {
      const doc = await store.loadDoc("companies");
      const c = doc && doc.content ? R.getRecord(doc.content, ids.companyId) : null;
      if (c) out.company = { name: c.name, industry: c.industry || "" };
    }
    if (ids.contactId) {
      const doc = await store.loadDoc("contacts");
      const c = doc && doc.content ? R.getRecord(doc.content, ids.contactId) : null;
      if (c) {
        const bits = String(c.name || "").split(/\s+/).filter(Boolean);
        out.contact = {
          full_name: c.name || "",
          first_name: bits[0] || "",
          last_name: bits.slice(1).join(" ") || "",
          email: c.email || "",
          role: c.role || ""
        };
        if (!out.company && c.companyId) {
          const cdoc = await store.loadDoc("companies");
          const co = cdoc && cdoc.content ? R.getRecord(cdoc.content, c.companyId) : null;
          if (co) out.company = { name: co.name, industry: co.industry || "" };
        }
      }
    }
    if (ids.dealId) {
      const doc = await store.loadDoc("deals");
      const d = doc && doc.content ? R.getRecord(doc.content, ids.dealId) : null;
      if (d) {
        out.deal = { name: d.name || "", expected_value: d.expectedValue ? U.fmtMoney(d.expectedValue) : "", close_date: d.closeDate ? R.fmtDate(d.closeDate) : "" };
        if (!ids.companyId && d.companyId) {
          const cdoc = await store.loadDoc("companies");
          const co = cdoc && cdoc.content ? R.getRecord(cdoc.content, d.companyId) : null;
          if (co && !out.company) out.company = { name: co.name, industry: co.industry || "" };
        }
      }
    }
    return out;
  }

  async function logEmail(store, values) {
    values = Object.assign({}, values, { type: "email" });
    if (!values.outcome) values.outcome = "sent";
    const v = A.validate(values);
    if (!v.ok) return { ok: false, code: "validation", errors: v.errors };
    return R.persistUpdate(store, "activities", content => {
      if (!Array.isArray(content.records)) content.records = [];
      const rec = A.applyForm(null, v.values);
      rec.outcome = values.outcome;
      if (values.outcome === "replied") rec.repliedAt = v.values.at || R.nowISO();
      content.records.push(rec);
      return { changed: true, content };
    });
  }

  function opt(v, text) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    return o;
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function cardTitle(title, sub) {
    const row = el("div", "card-title-row");
    const left = el("div");
    left.appendChild(el("h2", null, title));
    if (sub) { const p = el("p", "hint", sub); p.style.marginTop = "3px"; left.appendChild(p); }
    row.appendChild(left);
    return row;
  }

  async function renderLibrary(ctx) {
    const store = ctx.store;
    const wrap = el("div");
    const card = el("section", "card");
    card.dataset.emPage = "1";
    wrap.appendChild(card);
    const titleRow = cardTitle("Email templates", "Saved subject/body pairs with merge fields. Compose from a template, merge it against a record, and log the send.");
    const right = el("div", "detail-acts");
    const chip = U.chip(0, "template", "templates");
    chip.dataset.emCount = "1";
    right.appendChild(chip);
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    add.href = "#/emails/templates/new";
    add.textContent = "＋ New template";
    add.dataset.emAdd = "1";
    right.appendChild(add);
    titleRow.appendChild(right);
    card.appendChild(titleRow);

    const tokens = document.createElement("p");
    tokens.className = "hint em-tokens";
    tokens.style.marginTop = "4px";
    tokens.innerHTML = "Merge tokens: " + MERGE_DOC.map(t => "<code>" + esc(t) + "</code>").join(" ");
    card.appendChild(tokens);

    const list = el("div", "rel-list");
    list.dataset.emList = "1";
    card.appendChild(list);
    const tpls = await listTemplates(store);
    chip.textContent = tpls.length + " " + (tpls.length === 1 ? "template" : "templates");
    if (!tpls.length) {
      list.appendChild(el("p", "hint muted-line", "No templates yet. Create one for your intro, follow-up, handover or meeting-request emails."));
    }
    tpls.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(t => {
      const line = el("div", "rel-line em-tpl");
      line.dataset.emTpl = "1";
      const main = el("div", "tl-main");
      const nm = el("span", "rel-name", t.name);
      const sub = el("div", "tl-sub", (t.subject || "(no subject)") + (t.body ? " · " + (t.body.length > 70 ? t.body.slice(0, 70).replace(/\s+/g, " ") + "…" : t.body.replace(/\s+/g, " ")) : ""));
      main.appendChild(nm);
      main.appendChild(sub);
      line.appendChild(main);
      const acts = el("span", "rel-side");
      const compose = document.createElement("a");
      compose.className = "btn btn-ghost btn-sm";
      compose.href = "#/emails/compose";
      compose.textContent = "Compose";
      compose.dataset.emCompose = "1";
      const edit = document.createElement("a");
      edit.className = "btn btn-ghost btn-sm";
      edit.href = "#/emails/templates/" + encodeURIComponent(t.id) + "/edit";
      edit.textContent = "Edit";
      edit.dataset.emEdit = "1";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-ghost btn-sm";
      del.textContent = "Delete";
      del.dataset.emDel = "1";
      del.addEventListener("click", async () => {
        if (!window.confirm("Delete the “" + t.name + "” template?")) return;
        const res = await deleteTemplate(store, t.id);
        if (res && res.ok) { window.CRM.toast("Template deleted."); window.CRM.rerender(); }
        else window.CRM.toast("Could not delete the template.");
      });
      acts.appendChild(compose);
      acts.appendChild(edit);
      acts.appendChild(del);
      line.appendChild(acts);
      list.appendChild(line);
    });
    return wrap;
  }

  async function renderTemplateForm(ctx) {
    const store = ctx.store;
    const p = ctx.params || [];
    const editingId = p[1] === "new" ? null : p[1];
    let tpl = null;
    if (editingId) {
      const tpls = await listTemplates(store);
      tpl = tpls.find(t => t.id === editingId) || null;
      if (!tpl) return U.notFoundCard({ icon: "", title: "Template not found", what: "That template no longer exists.", backHref: "#/emails", backLabel: "Back to templates" });
    }
    const wrap = el("div");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/emails";
    back.textContent = "← All templates";
    wrap.appendChild(back);
    const card = el("section", "card");
    card.dataset.emForm = "1";
    wrap.appendChild(card);
    card.appendChild(cardTitle(editingId ? "Edit template" : "New template", "Merge tokens are filled in at compose time from the record you are emailing."));
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);
    const form = el("form");
    const nameIn = document.createElement("input");
    nameIn.className = "inp";
    nameIn.placeholder = "e.g. Follow-up after discovery call";
    nameIn.value = tpl ? tpl.name : "";
    nameIn.dataset.f = "name";
    const subIn = document.createElement("input");
    subIn.className = "inp";
    subIn.placeholder = "Subject — e.g. “Re: {{company.name}} — next steps”";
    subIn.value = tpl ? tpl.subject : "";
    subIn.dataset.f = "subject";
    const bodyIn = document.createElement("textarea");
    bodyIn.className = "inp";
    bodyIn.rows = 9;
    bodyIn.placeholder = "Body — plain text with {{merge.tokens}}";
    bodyIn.value = tpl ? tpl.body : "";
    bodyIn.dataset.f = "body";
    form.appendChild(U.fld("text", "Name", nameIn, { id: "emName", required: true }));
    form.appendChild(U.fld("text", "Subject", subIn, { id: "emSubject", hint: "Merge fields allowed, e.g. {{contact.first_name}}" }));
    form.appendChild(U.fld("textarea", "Body", bodyIn, { id: "emBody" }));
    const acts = el("div", "form-acts");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary";
    save.textContent = editingId ? "Save changes" : "Create template";
    save.dataset.emSave = "1";
    const cancel = document.createElement("a");
    cancel.className = "btn btn-ghost";
    cancel.href = "#/emails";
    cancel.textContent = "Cancel";
    acts.appendChild(save);
    acts.appendChild(cancel);
    form.appendChild(acts);
    card.appendChild(form);
    form.addEventListener("submit", e => e.preventDefault());
    save.addEventListener("click", async () => {
      const v = validateTemplate({ name: nameIn.value, subject: subIn.value, body: bodyIn.value });
      if (!v.ok) {
        form.querySelectorAll(".bad").forEach(n => n.classList.remove("bad"));
        form.querySelectorAll(".fld-err").forEach(n => { n.hidden = true; });
        Object.keys(v.errors).forEach(f => {
          const ctl = form.querySelector('[data-f="' + f + '"]');
          if (!ctl) return;
          const fld = ctl.closest(".fld");
          if (!fld) return;
          fld.classList.add("bad");
          const box = fld.querySelector(".fld-err");
          if (box) { box.textContent = v.errors[f]; box.hidden = false; }
        });
        return;
      }
      const rec = applyTemplate(tpl, v.values);
      const res = await upsertTemplate(store, rec);
      if (res && res.ok) {
        window.CRM.toast(editingId ? "Template saved." : "Template created.");
        window.CRM.go("emails", []);
      } else {
        msg.className = "bkp-msg err";
        msg.textContent = "Could not save the template. " + (U.describeError(res, "emails") || "");
        msg.hidden = false;
      }
    });
    return wrap;
  }

  async function renderCompose(ctx) {
    const store = ctx.store;
    const p = ctx.params || [];
    const scopeModule = p[1];
    const scopeId = p[2];
    const ids = {};
    if (scopeModule === "company") ids.companyId = scopeId;
    else if (scopeModule === "contact") ids.contactId = scopeId;
    else if (scopeModule === "deal") ids.dealId = scopeId;

    const wrap = el("div");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/emails";
    back.textContent = "← Templates";
    wrap.appendChild(back);
    const card = el("section", "card");
    card.dataset.emCompose = "1";
    wrap.appendChild(card);
    card.appendChild(cardTitle("Compose email", "Merged from the template below. When it is sent, log it — the send appears on the company, contact and deal timelines."));

    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);

    const contextRow = el("div", "em-ctx");
    let companySel = null, contactSel = null, dealSel = null;
    const docs = await Promise.all([
      store.loadDoc("companies"), store.loadDoc("contacts"), store.loadDoc("deals")
    ]);
    const companies = ((docs[0] && docs[0].content && docs[0].content.records) || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const contacts = ((docs[1] && docs[1].content && docs[1].content.records) || []).slice();
    const deals = ((docs[2] && docs[2].content && docs[2].content.records) || []).slice().sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const cm = new Map(companies.map(c => [c.id, c]));
    const dm = new Map(deals.map(d => [d.id, d]));

    function ctxSummary() {
      const parts = [];
      if (companySel && companySel.value) parts.push("company " + cm.get(companySel.value).name);
      if (contactSel && contactSel.value) parts.push("contact " + contacts.find(c => c.id === contactSel.value).name);
      if (dealSel && dealSel.value) parts.push("deal " + dm.get(dealSel.value).name);
      return parts.length ? parts.join(" · ") : "no record linked";
    }

    async function currentScope() {
      const cids = { companyId: companySel ? companySel.value : "", contactId: contactSel ? contactSel.value : "", dealId: dealSel ? dealSel.value : "" };
      return buildScope(store, cids);
    }

    function fillContactsByCompany(companyId, keep) {
      if (!contactSel) return;
      contactSel.innerHTML = "";
      contactSel.appendChild(opt("", "No contact"));
      contacts.filter(c => !companyId || c.companyId === companyId).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => contactSel.appendChild(opt(c.id, c.name)));
      if (keep && contacts.some(c => c.id === keep)) contactSel.value = keep;
    }

    const form = el("form");
    const grid = el("div", "ac-links em-links");
    companySel = document.createElement("select");
    companySel.className = "sel";
    companySel.dataset.emCtxCompany = "1";
    companySel.appendChild(opt("", "No company"));
    companies.forEach(c => companySel.appendChild(opt(c.id, c.name)));
    contactSel = document.createElement("select");
    contactSel.className = "sel";
    contactSel.dataset.emCtxContact = "1";
    dealSel = document.createElement("select");
    dealSel.className = "sel";
    dealSel.dataset.emCtxDeal = "1";
    dealSel.appendChild(opt("", "No deal"));
    deals.forEach(d => dealSel.appendChild(opt(d.id, d.name + " · " + (cm.get(d.companyId) ? cm.get(d.companyId).name : "no company"))));
    const c1 = el("div", "ac-link"); c1.appendChild(el("small", null, "Company")); c1.appendChild(companySel);
    const c2 = el("div", "ac-link"); c2.appendChild(el("small", null, "Contact")); c2.appendChild(contactSel);
    const c3 = el("div", "ac-link"); c3.appendChild(el("small", null, "Deal")); c3.appendChild(dealSel);
    grid.appendChild(c1); grid.appendChild(c2); grid.appendChild(c3);
    contextRow.appendChild(el("span", "em-ctxlab", "Emailing about"));
    contextRow.appendChild(grid);
    card.appendChild(contextRow);
    fillContactsByCompany("");

    if (ids.companyId) { companySel.value = ids.companyId; fillContactsByCompany(ids.companyId, ids.contactId); }
    if (ids.contactId) {
      const ct = contacts.find(c => c.id === ids.contactId);
      if (ct && ct.companyId && !ids.companyId) { companySel.value = ct.companyId; fillContactsByCompany(ct.companyId, ids.contactId); }
      else fillContactsByCompany(companySel.value, ids.contactId);
    }
    if (ids.dealId) dealSel.value = ids.dealId;

    const toIn = document.createElement("input");
    toIn.type = "email";
    toIn.className = "inp";
    toIn.placeholder = "To — e.g. pat@acme.example";
    const tplSel = document.createElement("select");
    tplSel.className = "sel";
    tplSel.dataset.emTplPick = "1";
    tplSel.appendChild(opt("", "Pick a template…"));
    const tpls = await listTemplates(store);
    const tplMap = new Map();
    tpls.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(t => { tplMap.set(t.id, t); tplSel.appendChild(opt(t.id, t.name)); });
    const subIn = document.createElement("input");
    subIn.className = "inp";
    subIn.placeholder = "Subject";
    const bodyIn = document.createElement("textarea");
    bodyIn.className = "inp";
    bodyIn.rows = 8;
    bodyIn.placeholder = "Body…";
    form.appendChild(U.fld("email", "To", toIn, { id: "emTo", hint: "Prefilled from the selected contact." }));
    form.appendChild(U.fld("select", "Template", tplSel, { id: "emPick" }));
    form.appendChild(U.fld("text", "Subject", subIn, { id: "emSub" }));
    form.appendChild(U.fld("textarea", "Body", bodyIn, { id: "emBody" }));
    card.appendChild(form);

    function setFromContact() {
      const ct = contactSel.value ? contacts.find(c => c.id === contactSel.value) : null;
      if (ct && ct.email) toIn.value = ct.email;
      else if (toIn.value && !toIn.dataset.manual) toIn.value = "";
    }
    toIn.addEventListener("input", () => { toIn.dataset.manual = "1"; });
    contactSel.addEventListener("change", () => { setFromContact(); rerenderPreviewMeta(); });
    companySel.addEventListener("change", () => { fillContactsByCompany(companySel.value, ""); setFromContact(); rerenderPreviewMeta(); });
    dealSel.addEventListener("change", () => { rerenderPreviewMeta(); });

    const preview = el("div", "em-preview");
    preview.hidden = true;
    preview.appendChild(el("p", "em-pvctx"));
    card.appendChild(preview);

    async function rerenderPreviewMeta() {
      const scope = await currentScope();
      if (scope.contact && scope.contact.email && !toIn.dataset.manual) toIn.value = scope.contact.email;
      if (tplSel.value) {
        const t = tplMap.get(tplSel.value);
        subIn.value = renderMerge(t.subject, scope);
        bodyIn.value = renderMerge(t.body, scope);
        preview.hidden = false;
      }
      preview.querySelector(".em-pvctx").textContent = ctxSummary() || "no record linked — merge tokens will stay literal";
      refreshMailto();
      return scope;
    }

    async function applyTemplatePick() {
      if (!tplSel.value) return;
      const scope = await currentScope();
      const t = tplMap.get(tplSel.value);
      subIn.value = renderMerge(t.subject, scope);
      bodyIn.value = renderMerge(t.body, scope);
      preview.hidden = false;
    }
    tplSel.addEventListener("change", applyTemplatePick);

    const acts = el("div", "form-acts");
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-ghost";
    copyBtn.textContent = "Copy subject & body";
    copyBtn.dataset.emCopy = "1";
    const mailBtn = document.createElement("a");
    mailBtn.className = "btn btn-ghost";
    mailBtn.target = "_blank";
    mailBtn.rel = "noopener";
    mailBtn.textContent = "Open in mail app";
    mailBtn.dataset.emMailto = "1";
    const outcomeSel = document.createElement("select");
    outcomeSel.className = "sel";
    outcomeSel.dataset.emOutcome = "1";
    [["sent", "Sent — awaiting reply"], ["replied", "Got a reply"], ["needs follow-up", "No reply — needs follow-up"], ["bounced", "Bounced"]].forEach(pair => outcomeSel.appendChild(opt(pair[0], pair[1])));
    const logBtn = document.createElement("button");
    logBtn.type = "button";
    logBtn.className = "btn btn-primary";
    logBtn.textContent = "Log send";
    logBtn.dataset.emLog = "1";
    acts.appendChild(copyBtn);
    acts.appendChild(mailBtn);
    acts.appendChild(outcomeSel);
    acts.appendChild(logBtn);
    form.appendChild(acts);

    function refreshMailto() {
      const subject = encodeURIComponent(subIn.value);
      const body = encodeURIComponent(bodyIn.value);
      mailBtn.href = "mailto:" + encodeURIComponent(toIn.value || "") + "?subject=" + subject + "&body=" + body;
    }
    subIn.addEventListener("input", refreshMailto);
    bodyIn.addEventListener("input", refreshMailto);
    toIn.addEventListener("input", refreshMailto);
    refreshMailto();

    copyBtn.addEventListener("click", async () => {
      const text = "Subject: " + subIn.value + "\n\n" + bodyIn.value;
      try {
        await navigator.clipboard.writeText(text);
        window.CRM.toast("Copied to clipboard.");
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); window.CRM.toast("Copied to clipboard."); } catch (e2) { window.CRM.toast("Could not copy — select the text manually."); }
        ta.remove();
      }
    });

    logBtn.addEventListener("click", async () => {
      const scope = await currentScope();
      const to = toIn.value.trim();
      if (!to) { msg.className = "bkp-msg warn"; msg.textContent = "Set a recipient address before logging the send."; msg.hidden = false; return; }
      const res = await logEmail(store, {
        subject: subIn.value,
        at: new Date().toISOString(),
        to,
        notes: bodyIn.value,
        outcome: outcomeSel.value,
        companyId: companySel.value,
        contactId: contactSel.value,
        dealId: dealSel.value
      });
      if (res && res.ok) {
        window.CRM.toast("Email logged to the timeline.");
        window.CRM.go("activities", []);
      } else {
        msg.className = "bkp-msg err";
        msg.textContent = "Could not log the email. " + (U.describeError(res, "activities") || "");
        msg.hidden = false;
      }
    });

    if (!tpls.length) {
      const hint = el("p", "hint", "No templates yet — pick one after creating it in the template library, or type a subject and body below.");
      hint.style.marginTop = "8px";
      card.appendChild(hint);
    }

    await rerenderPreviewMeta();
    return wrap;
  }

  async function view(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard(MOD, { detail: "The document store isn't ready yet." });
    const p = ctx.params || [];
    if (p[0] === "templates") return renderTemplateForm(ctx);
    if (p[0] === "compose") return renderCompose(ctx);
    return renderLibrary(ctx);
  }

  return {
    MOD,
    MERGE_DOC,
    validateTemplate,
    applyTemplate,
    listTemplates,
    upsertTemplate,
    deleteTemplate,
    renderMerge,
    buildScope,
    logEmail,
    view
  };
})();
