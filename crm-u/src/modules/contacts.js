window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_CONTACTS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const MOD = "contacts";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  const CHANNEL_KINDS = ["WhatsApp", "Signal", "Telegram", "Slack", "Skype", "Zoom", "WeChat", "Line", "Other"];
  const SOCIAL_FIELDS = [
    { key: "linkedin", label: "LinkedIn", url: id => "https://linkedin.com/in/" + id.replace(/^\/+/, "") },
    { key: "twitter", label: "X / Twitter", url: id => "https://x.com/" + id.replace(/^@/, "").replace(/^\/+/, "") },
    { key: "facebook", label: "Facebook", url: id => "https://facebook.com/" + id.replace(/^\/+/, "") }
  ];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    { id: "consented", label: "Consent" }
  ];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function parseChannels(text) {
    const out = [];
    String(text || "").split(/[;\n]+/).forEach(bit => {
      bit = bit.trim();
      if (!bit) return;
      const i = bit.indexOf(":");
      let kind = "";
      let value = bit;
      if (i > 0) {
        kind = bit.slice(0, i).trim();
        value = bit.slice(i + 1).trim();
      }
      if (!kind) return;
      const k = CHANNEL_KINDS.find(x => x.toLowerCase() === kind.toLowerCase());
      out.push({ kind: k || kind, value });
    });
    return out;
  }

  function serializeChannels(ch) {
    return (Array.isArray(ch) ? ch : []).map(c => (c && c.kind ? c.kind + ": " + c.value : "")).filter(Boolean).join(";\n");
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const name = String(raw && raw.name || "").trim();
    if (!name) errors.name = "Contact name is required.";
    values.name = name;
    const companyId = String(raw && raw.companyId || "").trim();
    values.companyId = companyId;
    const role = String(raw && raw.role || "").trim();
    values.role = role;
    const email = String(raw && raw.email || "").trim();
    if (email && !EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
    values.email = email;
    const phone = String(raw && raw.phone || "").trim();
    values.phone = phone;
    const channels = parseChannels(raw && raw.channels);
    values.channels = channels;
    const social = {};
    for (const sf of SOCIAL_FIELDS) {
      const v = String((raw && raw.social && raw.social[sf.key]) || "").trim();
      if (v) social[sf.key] = v;
    }
    values.social = social;
    values.consent = !!(raw && raw.consent);
    values.tags = R.parseTags(raw && raw.tags);
    values.notes = String(raw && raw.notes || "").trim();
    values.active = raw && raw.active !== undefined ? !!raw.active : true;
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function applyForm(base, values) {
    const rec = Object.assign({}, base || {});
    const now = R.nowISO();
    if (rec.id === undefined) rec.id = R.newId(MOD);
    rec.name = values.name;
    const setOrDel = (key, v) => {
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && Object.keys(v).length === 0);
      if (empty) delete rec[key];
      else rec[key] = v;
    };
    setOrDel("companyId", values.companyId);
    setOrDel("role", values.role);
    setOrDel("email", values.email);
    setOrDel("phone", values.phone);
    setOrDel("channels", values.channels);
    setOrDel("social", values.social);
    setOrDel("tags", values.tags);
    setOrDel("notes", values.notes);
    if (values.consent) rec.consent = true;
    else delete rec.consent;
    rec.active = values.active !== false;
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    return rec;
  }

  async function companyMap(store) {
    const m = new Map();
    try {
      const doc = await store.loadDoc("companies");
      if (doc && doc.content) {
        for (const c of R.recordsOf(doc.content)) m.set(c.id, c);
      }
    } catch (e) {}
    return m;
  }

  async function canDelete(store, id) {
    const refs = await R.findRefs(store, MOD, "contactId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function subtitleOf(rec, cmap) {
    const parts = [];
    if (rec && rec.role) parts.push(rec.role);
    const co = rec && cmap.get(rec.companyId);
    if (co) parts.push(co.name);
    if (!parts.length) {
      if (rec && rec.email) parts.push(rec.email);
      else if (rec && rec.phone) parts.push(rec.phone);
    }
    return parts.join(" · ");
  }

  function segPredicate(rec, seg) {
    if (seg === "active") return rec.active !== false;
    if (seg === "inactive") return rec.active === false;
    if (seg === "consented") return rec.consent === true;
    return true;
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("contacts", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("contacts", doc);
    const all = R.recordsOf(doc.content).slice();
    const cmap = await companyMap(store);
    const wrap = el("div", "cmp-view");
    const banner = await U.statusBannerCard(store, MOD, "contacts");
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "All contacts"));
    tBox.appendChild(el("p", "hint", "Contacts link to a company by its stable record id (or stand alone). Renaming or merging a company or contact updates every deal and activity that references it."));
    tBox.querySelector(".hint").style.marginTop = "3px";
    titleRow.appendChild(tBox);
    const chip = U.chip(all.length, "contact", "contacts");
    chip.dataset.ctCount = "1";
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by name, role, company, email, tag…";
    search.dataset.ctQ = "1";
    const segBox = el("div", "seg-row");
    let quickSegs = el("div", "seg");
    quickSegs.dataset.ctFilt = "1";
    const segBtns = {};
    FILTERS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.filt = f.id;
      if (f.id === "all") b.classList.add("on");
      segBtns[f.id] = b;
      quickSegs.appendChild(b);
    });
    const savedWrap = el("span");
    const segCtl = window.CRM_SEGMENTS.savedSegControl(store, MOD, { onPick: seg => { activeSaved = seg; repaint(); } });
    savedWrap.appendChild(segCtl);
    const scanZone = el("div");
    const dupScan = window.CRM_DUPUI.scanButton(store, MOD, scanZone);
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    add.href = "#/contacts/new";
    add.textContent = "＋ Add contact";
    add.dataset.ctAdd = "1";
    toolbar.appendChild(search);
    segBox.appendChild(quickSegs);
    segBox.appendChild(savedWrap);
    toolbar.appendChild(segBox);
    toolbar.appendChild(dupScan);
    toolbar.appendChild(add);
    card.appendChild(toolbar);
    card.appendChild(scanZone);
    const listBox = el("div");
    card.appendChild(listBox);
    wrap.appendChild(card);

    let q = "";
    let quickChoice = "all";
    let activeSaved = null;

    function matching() {
      let recs = R.filterRecords(all, q);
      recs = recs.filter(r => {
        if (activeSaved) return window.CRM_SEGMENTS.segMatches(activeSaved, r, null);
        return segPredicate(r, quickChoice);
      });
      return R.sortByName(recs);
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " contact" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, "No contacts yet", "Add your first contact — linked to a company or standalone — to start tracking the people you do business with.", "#/contacts/new", "＋ Add contact"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No contacts match “${q}”.` : activeSaved ? `No contacts match the “${activeSaved.name}” segment.` : "No contacts in this view."));
        return;
      }
      const cm = cmap;
      rows.forEach(rec => {
        const row = document.createElement("a");
        row.className = "rec-row" + (rec.active === false ? " inactive" : "");
        row.href = "#/contacts/" + encodeURIComponent(rec.id);
        row.dataset.cid = rec.id;
        const av = el("span", "rec-av", U.initials(rec.name));
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", rec.name || "(unnamed contact)"));
        if (rec.consent === true) line1.appendChild(el("span", "badge active", "Consent"));
        if (rec.active === false) line1.appendChild(el("span", "badge inactive", "Inactive"));
        main.appendChild(line1);
        const sub = subtitleOf(rec, cm);
        if (sub) main.appendChild(el("span", "rec-sub", sub));
        const side = el("span", "rec-side");
        side.appendChild(U.tagsChips(rec.tags, 3));
        row.appendChild(av);
        row.appendChild(main);
        row.appendChild(side);
        listBox.appendChild(row);
      });
    }

    search.addEventListener("input", () => { q = search.value; repaint(); });
    Object.values(segBtns).forEach(b => b.addEventListener("click", () => {
      Object.values(segBtns).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      quickChoice = b.dataset.filt;
      activeSaved = null;
      repaint();
    }));
    repaint();
    return wrap;
  }

  async function renderDetail(ctx) {
    const store = ctx.store;
    const id = ctx.params && ctx.params[0];
    if (!store) return U.storeCard("contacts", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("contacts", doc);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return U.notFoundCard({ icon: ICON, title: "Contact not found", what: "No contact with id “" + (id || "") + "” exists in this document.", backHref: "#/contacts", backLabel: "Back to all contacts" });
    const cmap = await companyMap(store);
    const company = rec.companyId ? cmap.get(rec.companyId) : null;
    const refs = await R.findRefs(store, MOD, "contactId", rec.id);
    const del = await canDelete(store, rec.id);

    const wrap = el("div", "cmp-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/contacts";
    back.textContent = "← All contacts";
    wrap.appendChild(back);
    const dupZone = await window.CRM_DUPUI.dupBanner(store, MOD, rec, {});
    if (dupZone) wrap.appendChild(dupZone);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", U.initials(rec.name));
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.name || "(unnamed contact)"));
    const badges = el("span", "detail-badges");
    if (company) badges.appendChild(el("span", "badge customer", "At " + (company.name || "company")));
    if (rec.consent === true) badges.appendChild(el("span", "badge active", "Consent on record"));
    if (rec.active === false) badges.appendChild(el("span", "badge inactive", "Inactive"));
    else badges.appendChild(el("span", "badge active", "Active"));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const created = rec.createdAt ? "created " + R.fmtDate(rec.createdAt) : null;
    const updated = rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : null;
    meta.textContent = [created, updated].filter(Boolean).join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    const logAct = document.createElement("a");
    logAct.className = "btn btn-ghost btn-sm";
    logAct.href = "#/activities/log/contacts/" + encodeURIComponent(rec.id);
    logAct.textContent = "＋ Log";
    logAct.title = "Record a call, meeting, email, note or task for this contact";
    logAct.dataset.ctLog = "1";
    const emailAct = document.createElement("a");
    emailAct.className = "btn btn-ghost btn-sm";
    emailAct.href = "#/emails/compose/contact/" + encodeURIComponent(rec.id);
    emailAct.textContent = "✉ Email";
    emailAct.dataset.ctEmail = "1";
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/contacts/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit contact";
    edit.dataset.ctEdit = "1";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost btn-sm";
    toggle.textContent = rec.active === false ? "Reactivate" : "Deactivate";
    toggle.dataset.ctToggle = "1";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.ctDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — deactivate instead.";
    }
    acts.appendChild(logAct);
    acts.appendChild(emailAct);
    acts.appendChild(edit);
    acts.appendChild(toggle);
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Details"));
    const items = [];
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      items.push({ label: "Company", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Company", v: String(rec.companyId) + " (missing record)" });
    } else {
      items.push({ label: "Company", v: el("span", "muted", "Standalone contact") });
    }
    if (rec.role) items.push({ label: "Role / title", v: rec.role });
    if (rec.email) {
      const a = document.createElement("a");
      a.href = "mailto:" + rec.email;
      a.textContent = rec.email;
      items.push({ label: "Email", v: a });
    }
    if (rec.phone) {
      const a = document.createElement("a");
      a.href = "tel:" + rec.phone.replace(/[^+\d]/g, "");
      a.textContent = rec.phone;
      items.push({ label: "Phone", v: a });
    }
    const socialLinks = el("span", "dup-social");
    let socialAny = false;
    for (const sf of SOCIAL_FIELDS) {
      const v = rec.social && rec.social[sf.key];
      if (!v) continue;
      socialAny = true;
      const a = document.createElement("a");
      a.href = sf.url(v);
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "tag-pill";
      a.textContent = sf.label + " ↗";
      socialLinks.appendChild(a);
    }
    if (socialAny) items.push({ label: "Social", v: socialLinks });
    const chans = Array.isArray(rec.channels) ? rec.channels : [];
    if (chans.length) {
      const chips = el("span", "dup-social");
      chans.forEach(c => chips.appendChild(el("span", "tag-pill", (c.kind || "Channel") + ": " + c.value)));
      items.push({ label: "Alternate channels", v: chips });
    }
    if (Array.isArray(rec.tags) && rec.tags.length) items.push({ label: "Tags", v: U.tagsChips(rec.tags, 10) });
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));
    wrap.appendChild(grid);

    if (rec.notes) {
      const notes = el("section", "card");
      notes.appendChild(el("h2", null, "Internal notes"));
      const box = el("div", "notes-box", rec.notes);
      notes.appendChild(box);
      wrap.appendChild(notes);
    }

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    const relNote = el("p", "hint", "Records that reference this contact by its stable id. Renaming the contact updates them automatically; deleting is blocked while references exist.");
    relNote.style.marginTop = "3px";
    rel.appendChild(relNote);
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => {
        const line = el("div", "rel-line");
        const name = el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)"));
        line.appendChild(name);
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No other records reference this contact yet."));
    }
    rel.appendChild(relBody);
    wrap.appendChild(rel);

    function showMsg(kind, text) {
      msg.className = "bkp-msg " + kind;
      msg.textContent = text;
      msg.hidden = false;
    }
    function busyAll(on) {
      toggle.disabled = on;
      delBtn.disabled = on || !del.allowed;
    }

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
      const allowed = await canDelete(store, rec.id);
      if (!allowed.allowed) {
        showMsg("err", "This contact is referenced by other records — deactivate it instead of deleting.");
        return;
      }
      if (!confirmDel) {
        confirmDel = true;
        delBtn.textContent = "Confirm delete";
        delBtn.classList.add("armed");
        setTimeout(() => {
          if (confirmDel) {
            confirmDel = false;
            delBtn.textContent = "Delete";
            delBtn.classList.remove("armed");
          }
        }, 4000);
        return;
      }
      confirmDel = false;
      busyAll(true);
      const res = await R.persistUpdate(store, MOD, content => {
        const gone = R.removeRecord(content, rec.id);
        return { changed: gone.removed, content };
      });
      if (res && res.ok) {
        window.CRM.toast("Contact deleted.");
        ctx.navigate("contacts");
      } else {
        showMsg("err", U.describeError(res, "contacts"));
        busyAll(false);
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
      }
    });

    toggle.addEventListener("click", async () => {
      busyAll(true);
      const res = await R.persistUpdate(store, MOD, content => {
        const r = R.getRecord(content, rec.id);
        if (!r) return { changed: false };
        r.active = r.active === false ? true : false;
        r.updatedAt = R.nowISO();
        return { changed: true, content };
      });
      if (res && res.ok) {
        window.CRM.toast(rec.active === false ? "Contact reactivated." : "Contact deactivated.");
        if (ctx.rerender) ctx.rerender();
      } else {
        showMsg("err", U.describeError(res, "contacts"));
        busyAll(false);
      }
    });

    wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { contactId: rec.id }, title: "Timeline", hintText: "Calls, emails, meetings, notes, tasks and pipeline events for this contact, newest first." }));

    if (window.CRM_DOCUMENTS && window.CRM_DOCUMENTS.card) {
      try {
        const dc = await window.CRM_DOCUMENTS.card(store, { ownerType: "contact", ownerId: rec.id, title: "Contact documents", emptyText: "No documents filed for this contact yet." });
        if (dc) wrap.appendChild(dc.el);
      } catch (e) {
        console.error("contact documents card failed:", e);
      }
    }

    return wrap;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(U.storeCard("contacts", { detail: "The document store isn't ready yet." }));
    return Promise.all([store.loadDoc(MOD, { refresh: true }), companyMap(store)]).then(pair => {
      const doc = pair[0];
      const cmap = pair[1];
      if (!doc || doc.ok === false) return U.storeCard("contacts", doc);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return U.notFoundCard({ icon: ICON, title: "Contact not found", what: "No contact with id “" + (id || "") + "” exists in this document.", backHref: "#/contacts", backLabel: "Back to all contacts" });

      const wrap = el("div", "cmp-view");
      const backHref = isNew ? "#/contacts" : "#/contacts/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← All contacts" : "← Back to " + (rec.name || "contact");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New contact" : "Edit contact"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);
      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);
      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.ctForm = "1";

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 160;
      nameIn.placeholder = "e.g. Pat Smith";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(U.fld("text", "Full name", nameIn, { id: "ct-name", required: true, full: true }));

      const coSel = document.createElement("select");
      coSel.className = "sel";
      coSel.dataset.f = "companyId";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "— Standalone contact —";
      coSel.appendChild(noneOpt);
      const sorted = Array.from(cmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      sorted.forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name + (c.active === false ? " (inactive)" : "");
        coSel.appendChild(o);
      });
      if (rec && rec.companyId) coSel.value = rec.companyId;
      form.appendChild(U.fld("select", "Company", coSel, { id: "ct-company", full: true }));

      const roleIn = document.createElement("input");
      roleIn.className = "inp";
      roleIn.type = "text";
      roleIn.placeholder = "e.g. Head of Procurement";
      roleIn.value = (rec && rec.role) || "";
      roleIn.dataset.f = "role";
      form.appendChild(U.fld("text", "Role / title", roleIn, { id: "ct-role" }));

      const emailIn = document.createElement("input");
      emailIn.className = "inp";
      emailIn.type = "email";
      emailIn.placeholder = "pat@acme.example";
      emailIn.value = (rec && rec.email) || "";
      emailIn.dataset.f = "email";
      form.appendChild(U.fld("email", "Email", emailIn, { id: "ct-email" }));

      const phoneIn = document.createElement("input");
      phoneIn.className = "inp";
      phoneIn.type = "tel";
      phoneIn.placeholder = "+41 79 123 45 67";
      phoneIn.value = (rec && rec.phone) || "";
      phoneIn.dataset.f = "phone";
      form.appendChild(U.fld("tel", "Phone", phoneIn, { id: "ct-phone" }));

      const chanIn = document.createElement("textarea");
      chanIn.className = "txa";
      chanIn.rows = 2;
      chanIn.placeholder = "WhatsApp: +41 79 123 45 67;\nSignal: pat.smith.01";
      chanIn.value = serializeChannels(rec && rec.channels);
      chanIn.dataset.f = "channels";
      form.appendChild(U.fld("textarea", "Alternate channels", chanIn, { id: "ct-chans", full: true }));

      const dl = el("datalist", null);
      dl.id = "ct-channel-kinds";
      CHANNEL_KINDS.forEach(k => {
        const o = document.createElement("option");
        o.value = k;
        dl.appendChild(o);
      });
      form.appendChild(dl);

      const linkedIn = document.createElement("input");
      linkedIn.className = "inp";
      linkedIn.type = "text";
      linkedIn.placeholder = "in/pat-smith";
      linkedIn.value = (rec && rec.social && rec.social.linkedin) || "";
      linkedIn.dataset.f = "s-linkedin";
      form.appendChild(U.fld("text", "LinkedIn handle", linkedIn, { id: "ct-li" }));

      const twitterIn = document.createElement("input");
      twitterIn.className = "inp";
      twitterIn.type = "text";
      twitterIn.placeholder = "@pat_smith";
      twitterIn.value = (rec && rec.social && rec.social.twitter) || "";
      twitterIn.dataset.f = "s-twitter";
      form.appendChild(U.fld("text", "X / Twitter handle", twitterIn, { id: "ct-tw" }));

      const fbIn = document.createElement("input");
      fbIn.className = "inp";
      fbIn.type = "text";
      fbIn.placeholder = "pat.smith";
      fbIn.value = (rec && rec.social && rec.social.facebook) || "";
      fbIn.dataset.f = "s-facebook";
      form.appendChild(U.fld("text", "Facebook handle", fbIn, { id: "ct-fb" }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. decision-maker, vip, partner";
      tagsIn.value = (rec && Array.isArray(rec.tags) ? rec.tags.join(", ") : "");
      tagsIn.dataset.f = "tags";
      form.appendChild(U.fld("text", "Tags", tagsIn, { id: "ct-tags", full: true }));

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "Internal notes about this person.";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Internal notes", notesIn, { id: "ct-notes", full: true }));

      const checks = el("div", "frm-checks full");
      checks.appendChild(U.checkRow("This contact has communication consent (opt-in recorded)", !!(rec && rec.consent), v => {}, "only contact them if this is checked"));
      const c2 = el("label", "check");
      const actCb = document.createElement("input");
      actCb.type = "checkbox";
      actCb.checked = !rec || rec.active !== false;
      actCb.dataset.f = "active";
      c2.appendChild(actCb);
      c2.appendChild(el("span", null, "Active (hide from lists instead of deleting)"));
      checks.appendChild(c2);
      form.appendChild(checks);

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create contact" : "Save changes";
      save.dataset.ctSave = "1";
      const cancel = document.createElement("a");
      cancel.className = "btn btn-ghost";
      cancel.href = backHref;
      cancel.textContent = "Cancel";
      foot.appendChild(save);
      foot.appendChild(cancel);
      form.appendChild(foot);
      card.appendChild(form);
      wrap.appendChild(card);

      function showErr(kind, text) {
        topMsg.className = "bkp-msg " + kind;
        topMsg.textContent = text;
        topMsg.hidden = false;
        topMsg.scrollIntoView({ block: "nearest" });
      }

      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        U.clearFieldErrs(form);
        topMsg.hidden = true;
        const consentCb = checks.querySelector('input[type="checkbox"]');
        const raw = {
          name: nameIn.value,
          companyId: coSel.value,
          role: roleIn.value,
          email: emailIn.value,
          phone: phoneIn.value,
          channels: chanIn.value,
          social: { linkedin: linkedIn.value, twitter: twitterIn.value, facebook: fbIn.value },
          tags: tagsIn.value,
          notes: notesIn.value,
          consent: consentCb.checked,
          active: actCb.checked
        };
        const v = validate(raw);
        if (!v.ok) {
          Object.keys(v.errors).forEach(k => U.fieldErr(form, k, v.errors[k]));
          return;
        }
        save.disabled = true;
        save.textContent = "Saving…";
        let savedId = null;
        const res = await R.persistUpdate(store, MOD, content => {
          let base = rec;
          if (!isNew) {
            const fresh = R.getRecord(content, id);
            if (!fresh) return { changed: false };
            base = fresh;
          }
          const built = applyForm(base, v.values);
          let attempts = 0;
          while (isNew && R.getRecord(content, built.id) && attempts < 6) {
            built.id = R.newId(MOD);
            attempts++;
          }
          if (isNew && attempts >= 6) return { changed: false };
          savedId = built.id;
          R.upsertRecord(content, built);
          return { changed: true, content };
        });
        if (res && res.ok) {
          window.CRM.toast(isNew ? "Contact created." : "Contact saved.");
          ctx.navigate("contacts", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create contact" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "contacts") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "contacts"));
        if (res && res.code === "conflict") {
          const link = document.createElement("a");
          link.href = "#/dashboard";
          link.style.marginLeft = "8px";
          link.style.fontWeight = "700";
          link.textContent = "Open Dashboard";
          topMsg.appendChild(link);
        }
      });

      return wrap;
    });
  }

  function view(ctx) {
    const params = ctx.params || [];
    if (params[0] === "new") return renderForm(ctx);
    if (params[0] && params[1] === "edit") return renderForm(ctx);
    if (params[0]) return renderDetail(ctx);
    return renderList(ctx);
  }

  return { MOD, validate, applyForm, canDelete, view, FILTERS, SOCIAL_FIELDS };
})();

window.CRM_RENDERERS.contacts = function (ctx) {
  return window.CRM_CONTACTS.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
