/* ============================================================
   PSA-U — client portal & self-service (Phase 10 · Task 49)

   The client's own window into the practice. A contact signs in to
   their company's portal and can:

     • raise a support request and follow its progress,
     • read the articles published to clients,
     • see and download their posted invoices,
     • approve or decline the quotes / change requests awaiting them.

   Scoping is the whole point: a portal session is pinned to one
   company and one contact, and every query is filtered by that
   company — the portal never sees another client's tickets, invoices
   or approvals, and only ever sees customer-visible notes and
   published public articles. `requireSession` is the single guard
   every portal function passes through.

   Sign-in. There is no external identity provider here, so `enter`
   is the access gate: it is available to `portal.manage` (owner /
   manager) so an operator can enter as a client for support and
   demonstration; every subsequent call is scoped by the session.

   Client approvals are handed to the Phase-10 approval engine
   (ERP.approvals) and decided with `byType:"client"`, so the same
   request, audit trail and release action serve both internal and
   client sign-off.

   Storage: no records of its own — the portal reads and writes
   tickets, articles, invoices and approvals. No code here is
   required at runtime.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const PT = (ERP.portal = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("portal requires the tenancy service");
    return ERP.tenancy;
  }
  const LS_KEY = "psa.portal.session";
  let session = null;

  function loadSession() {
    try { session = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { session = null; }
    return session;
  }
  function saveSession(s) {
    session = s || null;
    try { if (s) localStorage.setItem(LS_KEY, JSON.stringify(s)); else localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  /* ─────────────────────────── session ─────────────────────────── */

  PT.session = function () { return session || loadSession(); };

  PT.enter = async function (pid, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("portal.manage")) return { error: "forbidden" };
    if (opts.companyId == null) return { error: "company_required", message: "Choose a client to sign in as." };
    const company = await ERP.companies.get(opts.companyId);
    if (!company) return { error: "company_not_found" };
    const contacts = await ERP.companies.contacts(opts.companyId);
    const contact = contacts.find((c) => String(c.id) === String(opts.contactId)) || null;
    if (!contact) return { error: "contact_required", message: "Choose a contact for the portal." };
    const s = {
      providerId: pid, companyId: opts.companyId, companyName: company.name,
      contactId: contact.id, contactName: contact.name, startedAt: new Date().toISOString(),
    };
    saveSession(s);
    return { session: s };
  };
  PT.leave = function () { saveSession(null); return { ok: true }; };
  PT.requireSession = function () {
    const s = PT.session();
    if (!s || s.companyId == null || s.contactId == null) return null;
    return s;
  };
  PT.contactsFor = async function (companyId) {
    const contacts = await ERP.companies.contacts(companyId);
    return contacts; // a portal contact is any active contact of the company
  };

  /* ─────────────────────────── tickets ─────────────────────────── */

  PT.tickets = async function (pid, query) {
    const s = PT.requireSession();
    if (!s) return [];
    const list = await ERP.tickets.list(s.companyId, query || {});
    return list;
  };
  PT.ticket = async function (pid, id) {
    const s = PT.requireSession();
    if (!s) return null;
    const t = await ERP.tickets.get(s.companyId, id);
    if (!t) return null;
    const notes = (await ERP.tickets.notes(s.companyId, id)).filter((n) => !n.internal);
    return { ticket: t, notes: notes };
  };
  PT.submitTicket = async function (pid, rec) {
    const s = PT.requireSession();
    if (!s) return { error: "no_session" };
    rec = rec || {};
    if (!rec.summary || !String(rec.summary).trim()) return { error: "summary_required", message: "Describe the issue briefly." };
    const res = await ERP.tickets.save(s.companyId, {
      summary: String(rec.summary).trim(), detail: rec.detail || "",
      priority: rec.priority || "p3", source: "portal", contactId: s.contactId, status: "new",
    }, { system: true });
    if (res.error) return res;
    await ERP.tickets.addNote(s.companyId, res.record.id, {
      body: "Raised by " + s.contactName + " through the client portal.", internal: false, system: true, author: s.contactName,
    });
    PT.emit(pid, "portal.ticket_submitted", { ticket: res.record, companyId: s.companyId, contactId: s.contactId });
    return { record: res.record, created: true };
  };
  PT.addComment = async function (pid, ticketId, body) {
    const s = PT.requireSession();
    if (!s) return { error: "no_session" };
    if (!body || !String(body).trim()) return { error: "body_required", message: "Write something first." };
    const res = await ERP.tickets.addNote(s.companyId, ticketId, { body: String(body).trim(), internal: false, system: true, author: s.contactName });
    if (res.error) return res;
    PT.emit(pid, "portal.comment_added", { ticketId: ticketId, companyId: s.companyId });
    return { record: res.record };
  };

  /* ─────────────────────────── articles ─────────────────────────── */

  PT.articles = async function (pid, query) {
    const s = PT.requireSession();
    return ERP.kb.publicArticles(pid, query || {});
  };
  PT.article = async function (pid, id) {
    const a = await ERP.kb.article(pid, id);
    if (!a || a.status !== "published" || a.visibility !== "public") return null;
    return a;
  };

  /* ─────────────────────────── invoices ─────────────────────────── */

  PT.invoices = async function (pid) {
    const s = PT.requireSession();
    if (!s) return [];
    const list = await ERP.billing.forCompany(s.companyId);
    return list.filter((i) => i.status === "posted").sort((a, b) => String(b.issueDate || b.createdAt || "").localeCompare(String(a.issueDate || a.createdAt || "")));
  };
  PT.invoice = async function (pid, id) {
    const s = PT.requireSession();
    if (!s) return null;
    const list = await PT.invoices(pid);
    return list.find((i) => String(i.id) === String(id)) || null;
  };

  /* ─────────────────────────── approvals ─────────────────────────── */

  PT.approvals = async function (pid) {
    const s = PT.requireSession();
    if (!s) return [];
    return ERP.approvals.requests(pid, { companyId: s.companyId, approverType: "client", status: "pending" });
  };
  PT.approvalHistory = async function (pid) {
    const s = PT.requireSession();
    if (!s) return [];
    return ERP.approvals.requests(pid, { companyId: s.companyId, approverType: "client" });
  };
  PT.decide = async function (pid, id, decision, note) {
    const s = PT.requireSession();
    if (!s) return { error: "no_session" };
    const req = await ERP.approvals.get(pid, id);
    if (!req || String(req.companyId) !== String(s.companyId)) return { error: "not_found" };
    const res = await ERP.approvals.decide(pid, id, { decision: decision, note: note || "", byType: "client", by: s.contactName });
    if (!res.error) PT.emit(pid, "portal.approval_decided", { approval: res.record, companyId: s.companyId, decision: decision });
    return res;
  };

  PT.stats = async function (pid) {
    const s = PT.requireSession();
    if (!s) return null;
    const [tickets, invoices, approvals] = await Promise.all([PT.tickets(pid), PT.invoices(pid), PT.approvals(pid)]);
    const open = tickets.filter((t) => !t.closedAt);
    return {
      openTickets: open.length, totalTickets: tickets.length,
      invoices: invoices.length, outstanding: invoices.reduce((n, i) => n + Math.max(0, Number(i.balance) || 0), 0),
      approvals: approvals.length,
    };
  };

  function emit(pid, event, ctx) {
    if (!ERP.workflow) return;
    try { ERP.workflow.emit(event, Object.assign({ providerId: pid }, ctx || {})); } catch (e) {}
  }
  PT.emit = emit;

  /* ═══════════════════════════ station ═══════════════════════════ */

  function esc(s) { return ui.esc(s); }

  PT.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, { icon: "globe", title: "Client portal", phase: "Phase 10 · Client portal", message: "Create a service provider and a client company first." });
      return;
    }
    const s = PT.requireSession();
    if (!s || String(s.providerId || pid) !== String(pid)) { await renderSignIn(host, pid); return; }
    await renderPortal(ctx, host, pid, s);
  };

  async function renderSignIn(host, pid) {
    const companies = await ERP.companies.optionList();
    const canEnter = ERP.security.enforce("portal.manage");
    host.innerHTML =
      ui.pageHead("Client Portal", "Sign in as a client contact to use self-service.", "") +
      ui.card("Client sign-in",
        (companies.length
          ? ui.form(
              ui.select("companyId", "Client", companies, "") +
              '<div class="field"><label>Contact</label><select name="contactId" data-contact-select><option value="">— choose a client first —</option></select></div>' +
              (canEnter ? "" : ui.alert("Your role cannot sign in to the client portal.", "warn")),
              canEnter ? ui.btn("Enter portal", { primary: true, act: "pt-enter" }) : ""
            )
          : ui.alert("Add a client company with a contact to use the portal.", "warn"))
      );
    const companySel = host.querySelector("[name=companyId]");
    const contactSel = host.querySelector("[data-contact-select]");
    async function fillContacts() {
      const cid = companySel.value;
      if (!cid) { contactSel.innerHTML = '<option value="">— choose a client first —</option>'; return; }
      const contacts = await ERP.companies.contacts(cid);
      contactSel.innerHTML = '<option value="">— choose a contact —</option>' + contacts.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("");
    }
    if (companySel) companySel.addEventListener("change", fillContacts);
    const btn = host.querySelector("[data-act=pt-enter]");
    if (btn) btn.onclick = async () => {
      const r = await PT.enter(pid, { companyId: companySel.value, contactId: contactSel.value });
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.navigate("portal");
    };
  }

  async function renderPortal(ctx, host, pid, s) {
    host.__portal = host.__portal || { tab: "support" };
    const defs = [
      { id: "support", label: "Support" },
      { id: "knowledge", label: "Knowledge" },
      { id: "invoices", label: "Invoices" },
      { id: "approvals", label: "Approvals" },
    ];
    const pend = await PT.approvals(pid);
    const active = defs.find((d) => d.id === host.__portal.tab) ? host.__portal.tab : "support";
    host.innerHTML =
      ui.pageHead(s.companyName, "Signed in as " + s.contactName + " · client self-service", ui.btn("Leave portal", { small: true, act: "pt-leave" })) +
      ui.tabs(defs.map((d) => (d.id === "approvals" && pend.length ? Object.assign({}, d, { badge: String(pend.length) }) : d)), active).html;
    host.querySelector("[data-act=pt-leave]").onclick = () => { PT.leave(); ERP.navigate("portal"); };
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__portal.tab = b.getAttribute("data-tab");
      await renderTab(host, pid, s, host.__portal.tab);
    }));
    await renderTab(host, pid, s, active);
  }

  async function renderTab(host, pid, s, id) {
    const panel = host.querySelector('[data-panel="' + id + '"]');
    if (!panel) return;
    panel.__portal = { companyId: s.companyId, contactId: s.contactId };
    try {
      if (id === "support") await renderSupport(panel, pid, s);
      else if (id === "knowledge") await renderKnowledge(panel, pid, s);
      else if (id === "invoices") await renderInvoices(panel, pid, s);
      else if (id === "approvals") await renderApprovals(panel, pid, s);
    } catch (e) {
      console.error("portal tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }

  function statusBadge(t, statuses) {
    return ui.badge((statuses || []).find((x) => String(x.code) === String(t.status)) ? (statuses.find((x) => String(x.code) === String(t.status))).label : t.status, t.closedAt ? "muted" : "info");
  }

  async function renderSupport(panel, pid, s) {
    const pid2 = await ten().providerId();
    const [tickets, statuses] = await Promise.all([PT.tickets(pid2), ERP.tickets.statusMeta(pid2).catch(() => [])]);
    const rows = tickets.map((t) => ({
      number: "#" + esc(t.number || t.id),
      summary: esc(t.summary || "(no summary)"),
      status: statusBadge(t, statuses),
      updated: esc(ui.dateTime(t.updatedAt)),
      actions: ui.btn("Open", { small: true, act: "pt-open", arg: t.id }),
    }));
    panel.innerHTML =
      ui.card("Raise a support request",
        ui.form(
          ui.text("summary", "Summary", "", "What do you need help with?") +
          ui.textarea("detail", "Detail", "", 3) +
          ui.select("priority", "Priority", [{ value: "p1", label: "Urgent" }, { value: "p2", label: "High" }, { value: "p3", label: "Normal" }, { value: "p4", label: "Low" }], "p3"),
          ui.btn("Submit request", { primary: true, act: "pt-submit" })
        )) +
      ui.card("Your requests", ui.table([
        { key: "number", label: "Ref", width: "90px" }, { key: "summary", label: "Summary" },
        { key: "status", label: "Status" }, { key: "updated", label: "Updated" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "You have not raised any requests yet." }));

    const submit = panel.querySelector("[data-act=pt-submit]");
    if (submit) submit.onclick = async () => {
      const f = panel.querySelector("[data-ui-form]");
      const v = ui.collect(f, ["summary", "detail", "priority"]);
      const r = await PT.submitTicket(pid2, v);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Request " + (r.record.number || "") + " submitted.", "success");
      await renderSupport(panel, pid2, s);
    };
    ui.bind(panel, "click", "[data-act=pt-open]", async (el, e, act, arg) => {
      const data = await PT.ticket(pid2, arg);
      if (!data) return;
      openTicketModal(pid2, s, data);
    });
  }

  function openTicketModal(pid, s, data) {
    const t = data.ticket;
    const notes = data.notes || [];
    const m = ui.modal({
      title: "Ticket #" + (t.number || t.id) + " · " + (t.summary || ""),
      size: "lg",
      body:
        '<div class="erp-defs"><dt>Status</dt><dd>' + esc(t.status) + "</dd><dt>Priority</dt><dd>" + esc(t.priority) + "</dd><dt>Updated</dt><dd>" + esc(ui.dateTime(t.updatedAt)) + "</dd></div>" +
        (t.detail ? '<p class="erp-note-body">' + esc(t.detail).replace(/\n/g, "<br>") + "</p>" : "") +
        '<div class="erp-sep"></div><h4>Updates</h4>' +
        (notes.length
          ? '<div class="erp-notes">' + notes.map((n) => '<div class="erp-note customer"><div class="erp-note-head"><b>' + esc(n.author) + "</b> <span class='erp-sub'>" + esc(ui.dateTime(n.createdAt)) + "</span></div><div class='erp-note-body'>" + esc(n.body).replace(/\n/g, "<br>") + "</div></div>").join("") + "</div>"
          : '<p class="erp-sub">No updates yet.</p>') +
        '<div class="erp-note-add"><textarea data-pt-comment rows="3" placeholder="Add an update…"></textarea>' +
        '<div class="erp-btn-row"><button class="btn btn-primary btn-sm" data-act="pt-comment">Post update</button></div></div>',
      foot: ui.btn("Close", { small: true, act: "pt-close" }),
    });
    m.querySelector("[data-act=pt-close]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=pt-comment]").onclick = async () => {
      const body = m.querySelector("[data-pt-comment]").value;
      const r = await PT.addComment(pid, t.id, body);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ui.closeModal(); ERP.toast("Update posted.", "success");
      const data2 = await PT.ticket(pid, t.id);
      if (data2) openTicketModal(pid, s, data2);
    };
  }

  async function renderKnowledge(panel, pid, s) {
    const [articles, cats] = await Promise.all([PT.articles(pid, {}), ERP.kb.categories(pid)]);
    const catName = ERP.kb.categoryNameMap(cats);
    const rows = articles.map((a) => ({
      title: esc(a.title),
      category: esc(a.categoryId != null ? (catName[String(a.categoryId)] || "—") : "—"),
      updated: esc(ui.date(a.updatedAt)),
      actions: ui.btn("Read", { small: true, act: "pt-read", arg: a.id }),
    }));
    panel.innerHTML =
      ui.alert("Articles marked for clients. Anything the practice keeps internal is never shown here.", "info") +
      ui.table([{ key: "title", label: "Article" }, { key: "category", label: "Category" }, { key: "updated", label: "Updated" }, { key: "actions", label: "", align: "right" }], rows, { emptyText: "No published articles yet." });
    ui.bind(panel, "click", "[data-act=pt-read]", async (el, e, act, arg) => {
      const a = await PT.article(pid, arg);
      if (!a) return ERP.toast("That article is not available.", "error");
      ERP.kb.markViewed(pid, a.id);
      ui.modal({
        title: a.title, size: "lg",
        body: (a.summary ? '<p class="erp-kb-summary">' + esc(a.summary) + "</p>" : "") + '<div class="erp-kb-body">' + esc(a.body || "").replace(/\n/g, "<br>") + "</div>",
        foot: ui.btn("Close", { small: true, act: "ptr-close" }),
      }).querySelector("[data-act=ptr-close]").onclick = () => ui.closeModal();
    });
  }

  async function renderInvoices(panel, pid, s) {
    const invoices = await PT.invoices(pid);
    const rows = invoices.map((i) => ({
      number: esc(i.number || i.id),
      period: esc(i.periodKey || (i.period && i.period.start) || "—"),
      issued: esc(i.issueDate ? ui.date(i.issueDate) : "—"),
      total: esc(ui.money(i.total, i.currency)),
      balance: esc(ui.money(i.balance == null ? i.total : i.balance, i.currency)),
      actions: ui.btn("View", { small: true, act: "pt-inv", arg: i.id }),
    }));
    panel.innerHTML = ui.table([
      { key: "number", label: "Invoice" }, { key: "period", label: "Period" }, { key: "issued", label: "Issued" },
      { key: "total", label: "Total", align: "right" }, { key: "balance", label: "Balance", align: "right" }, { key: "actions", label: "", align: "right" },
    ], rows, { emptyText: "No invoices have been posted yet." });
    ui.bind(panel, "click", "[data-act=pt-inv]", async (el, e, act, arg) => {
      const inv = await PT.invoice(pid, arg);
      if (!inv) return;
      openInvoiceModal(inv);
    });
  }

  function openInvoiceModal(inv) {
    const lines = inv.lines || [];
    const lineRows = lines.map((l) => ({
      desc: esc(l.description || ""),
      qty: esc(ui.qty(l.qty)),
      price: esc(ui.money(l.unitPrice, inv.currency)),
      total: esc(ui.money(l.amount == null ? (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) : l.amount, inv.currency)),
    }));
    const m = ui.modal({
      title: "Invoice " + (inv.number || inv.id),
      size: "lg",
      body:
        '<div class="erp-defs"><dt>Issued</dt><dd>' + esc(inv.issueDate ? ui.date(inv.issueDate) : "—") + "</dd><dt>Due</dt><dd>" + esc(inv.dueDate ? ui.date(inv.dueDate) : "—") + "</dd><dt>Status</dt><dd>" + esc(inv.status) + "</dd></div>" +
        ui.table([{ key: "desc", label: "Description" }, { key: "qty", label: "Qty", align: "right" }, { key: "price", label: "Price", align: "right" }, { key: "total", label: "Amount", align: "right" }], lineRows, { emptyText: "No lines." }) +
        '<div class="erp-summary"><div class="erp-summary-item"><span>Subtotal</span><b>' + esc(ui.money(inv.subtotal, inv.currency)) + '</b></div>' +
        '<div class="erp-summary-item"><span>Tax</span><b>' + esc(ui.money(inv.tax, inv.currency)) + '</b></div>' +
        '<div class="erp-summary-item"><span>Total</span><b>' + esc(ui.money(inv.total, inv.currency)) + '</b></div>' +
        '<div class="erp-summary-item"><span>Balance</span><b>' + esc(ui.money(inv.balance == null ? inv.total : inv.balance, inv.currency)) + "</b></div></div>",
      foot: ui.btn("Close", { small: true, act: "pti-close" }) + " " + ui.btn("Download / print", { small: true, act: "pti-print" }),
    });
    m.querySelector("[data-act=pti-close]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=pti-print]").onclick = () => {
      if (ERP.ar && ERP.ar.printHtml) ERP.ar.printHtml("Invoice " + (inv.number || inv.id), '<h1>Invoice ' + esc(inv.number || inv.id) + "</h1>" + ui.table([{ key: "desc", label: "Description" }, { key: "qty", label: "Qty", align: "right" }, { key: "price", label: "Price", align: "right" }, { key: "total", label: "Amount", align: "right" }], lineRows, {}));
      else ERP.toast("Printing is unavailable.", "warn");
    };
  }

  async function renderApprovals(panel, pid, s) {
    const pending = await PT.approvals(pid);
    const history = (await PT.approvalHistory(pid)).filter((r) => r.status !== "pending");
    const rows = pending.map((r) => ({
      ref: ui.badge(ERP.approvals.refLabel(r.refType), "muted") + " " + esc(r.refNumber || ""),
      title: esc(r.title),
      amount: r.amount != null ? esc(ui.money(r.amount, r.currency)) : "—",
      due: esc(r.dueAt ? ui.date(r.dueAt) : "—"),
      actions: ui.btn("Approve", { small: true, primary: true, act: "pt-approve", arg: r.id }) + " " + ui.btn("Decline", { small: true, danger: true, act: "pt-decline", arg: r.id }),
    }));
    const histRows = history.map((r) => ({
      ref: esc(ERP.approvals.refLabel(r.refType) + " " + (r.refNumber || "")),
      title: esc(r.title),
      status: ui.badge(ERP.approvals.statusLabel(r.status), ERP.approvals.statusTone(r.status)),
      decided: esc(r.decidedAt ? ui.dateTime(r.decidedAt) : "—"),
      by: esc(r.decidedBy || "—"),
    }));
    panel.innerHTML =
      (pending.length ? "" : ui.alert("Nothing is waiting for your approval right now.", "info")) +
      ui.card("Awaiting your decision", ui.table([
        { key: "ref", label: "For" }, { key: "title", label: "Title" }, { key: "amount", label: "Amount", align: "right" }, { key: "due", label: "Due" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No pending approvals." })) +
      ui.card("Your decisions", ui.table([
        { key: "ref", label: "For" }, { key: "title", label: "Title" }, { key: "status", label: "Decision" }, { key: "decided", label: "When" }, { key: "by", label: "By" },
      ], histRows, { emptyText: "No decisions yet." }));
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "pt-approve" || act === "pt-decline") {
        const decision = act === "pt-approve" ? "approved" : "rejected";
        const m = ui.modal({
          title: (decision === "approved" ? "Approve " : "Decline ") + "request",
          body: ui.form(ui.textarea("note", decision === "approved" ? "Note (optional)" : "Reason", "", 3)),
          foot: ui.btn("Cancel", { small: true, act: "pta-cancel" }) + " " + ui.btn(decision === "approved" ? "Approve" : "Decline", { small: true, primary: decision === "approved", danger: decision !== "approved", act: "pta-save" }),
        });
        m.querySelector("[data-act=pta-cancel]").onclick = () => ui.closeModal();
        m.querySelector("[data-act=pta-save]").onclick = async () => {
          const v = ui.collect(m.querySelector("[data-ui-form]"), ["note"]);
          const r = await PT.decide(pid, arg, decision, v.note);
          if (r.error) return ERP.toast(r.message || r.error, "error");
          ui.closeModal(); ERP.toast(decision === "approved" ? "Approved." : "Declined.", "success");
          ERP.navigate("portal");
        };
      }
    });
  }
})();
