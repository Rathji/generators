/* ============================================================
   PSA-U — notification & escalation engine (Phase 2 · Task 11)
   A template-driven notification engine for the events the service
   desk raises (created, assigned, status change, note/update,
   breach, at-risk, ageing, merge).

   For each matching notification rule the engine:
     • evaluates the rule's conditions against the event context,
     • resolves the rule's recipients (ticket owner, team members,
       account manager, creator, the client contact, or specific
       people) to member identities + e-mail addresses,
     • renders the rule's template,
     • applies the recipient's preferences (channel choice, mute
       list, digest-only) and the rule's suppression/dedup window
       so one ticket cannot spam a recipient,
     • writes an in-app notification and/or an outbound e-mail, and
     • records every attempt (sent / suppressed / digested) in an
       auditable notification log.

   Digest rules queue notifications and flush them as a single
   summary once the window elapses.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const N = (ERP.notify = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("notify requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();

  N.EVENTS = [
    "ticket.created", "ticket.updated", "ticket.status_changed", "ticket.assigned",
    "ticket.note_added", "ticket.customer_update", "ticket.breached", "ticket.at_risk",
    "ticket.ageing", "ticket.merged",
  ];
  N.RECIPIENT_TOKENS = [
    { id: "owner", label: "Ticket owner" },
    { id: "team", label: "Assigned team" },
    { id: "account_manager", label: "Client account manager" },
    { id: "created_by", label: "Ticket creator" },
    { id: "contact", label: "Client contact (e-mail)" },
  ];

  /* ─────────────────────────── record access ─────────────────────────── */

  async function nextId(pid) {
    return ten().nextId(await ten().records("provider", pid));
  }
  async function recs(pid, kind) { return ten().records("provider", pid, kind); }
  async function put(pid, rec) {
    if (!isFinite(rec.id)) rec.id = await nextId(pid);
    return ten().upsert("provider", pid, rec);
  }
  async function del(pid, kind, id) {
    return ten().remove("provider", pid, (r) => r.kind === kind && String(r.id) === String(id));
  }

  N.newTemplate = (over) => Object.assign({
    kind: "notificationTemplate", name: "", channel: "both", subject: "", body: "", active: true,
  }, over || {});
  N.newRule = (over) => Object.assign({
    kind: "notificationRule", name: "", event: "ticket.assigned",
    conditions: [], recipients: ["owner"], channel: "inapp",
    templateId: null, digest: false, digestWindowMinutes: 240,
    dedupeMinutes: 30, active: true, order: 100,
  }, over || {});

  N.templates = (pid) => recs(pid, "notificationTemplate");
  N.rules = async (pid) => (await recs(pid, "notificationRule")).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  N.log = async (pid) => (await recs(pid, "notificationLog")).slice().reverse();
  N.digests = (pid) => recs(pid, "notificationDigest");
  N.outbox = async (pid) => (await recs(pid, "outboundEmail")).slice().reverse();
  N.prefs = (pid) => recs(pid, "memberPref");
  N.saveTemplate = (pid, rec) => put(pid, Object.assign(N.newTemplate(), rec));
  N.saveRule = (pid, rec) => put(pid, Object.assign(N.newRule(), rec));
  N.removeTemplate = (pid, id) => del(pid, "notificationTemplate", id);
  N.removeRule = (pid, id) => del(pid, "notificationRule", id);

  N.DEFAULT_PREF = { channels: { inapp: true, email: true }, digestOnly: false, muted: [] };
  N.pref = async function (pid, memberId) {
    if (memberId == null || memberId === "") return JSON.parse(JSON.stringify(N.DEFAULT_PREF));
    const list = await N.prefs(pid);
    const found = list.find((p) => String(p.memberId) === String(memberId));
    return found ? Object.assign(JSON.parse(JSON.stringify(N.DEFAULT_PREF)), found) : JSON.parse(JSON.stringify(N.DEFAULT_PREF));
  };
  N.savePref = async function (pid, memberId, pref) {
    const list = await N.prefs(pid);
    const cur = list.find((p) => String(p.memberId) === String(memberId)) || { kind: "memberPref", memberId: memberId };
    return put(pid, Object.assign({}, cur, pref, { kind: "memberPref", memberId: memberId }));
  };

  N.notifications = async function (opts) {
    opts = opts || {};
    const pid = opts.pid != null ? opts.pid : await ten().providerId();
    let list = await recs(pid, "notification");
    if (opts.memberId != null) list = list.filter((n) => String(n.recipientMemberId) === String(opts.memberId));
    if (opts.unread) list = list.filter((n) => !n.read);
    list = list.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    if (opts.limit) list = list.slice(0, opts.limit);
    return list;
  };
  N.unreadCount = async function (memberId) { return (await N.notifications({ memberId: memberId, unread: true })).length; };
  N.markRead = async function (id, pid) {
    const list = await recs(pid != null ? pid : await ten().providerId(), "notification");
    const r = list.find((n) => String(n.id) === String(id));
    if (!r) return { error: "not_found" };
    r.read = true;
    return put(pid != null ? pid : await ten().providerId(), r);
  };

  /* ─────────────────────────── templates ─────────────────────────── */

  N.render = function (text, ctx) {
    return String(text == null ? "" : text).replace(/\{([a-z0-9_.]+)\}/gi, (m, path) => {
      const parts = path.split(".");
      let o = ctx;
      for (const p of parts) { if (o == null) return ""; o = o[p]; }
      if (o == null) return "";
      if (o instanceof Date) return o.toISOString();
      return String(o);
    });
  };

  function defaultTemplateFor(event) {
    const titles = {
      "ticket.created": "New ticket: {ticket.number} — {ticket.summary}",
      "ticket.assigned": "Ticket {ticket.number} assigned to you",
      "ticket.status_changed": "Ticket {ticket.number} is now {ticket.status}",
      "ticket.note_added": "New internal note on {ticket.number}",
      "ticket.customer_update": "Update on ticket {ticket.number}",
      "ticket.breached": "SLA breached: {ticket.number}",
      "ticket.at_risk": "SLA at risk: {ticket.number}",
      "ticket.ageing": "Ticket {ticket.number} is ageing",
      "ticket.merged": "Ticket {ticket.number} was merged",
      "ticket.updated": "Ticket {ticket.number} updated",
    };
    return {
      subject: titles[event] || "Ticket {ticket.number} — " + event,
      body: "{company.name}\n{ticket.number} · {ticket.board} · {ticket.status} · {ticket.priority}\n\n{ticket.summary}\n\nOwner: {ticket.ownerName}\nDue: {sla.due}\n\n{actor.name}",
    };
  }

  /* ─────────────────────────── recipients ─────────────────────────── */

  async function memberRef(id) {
    if (id == null || id === "") return null;
    const m = await ERP.members.member(id);
    return { key: "member:" + id, memberId: id, name: m ? m.name : "Member " + id, email: m ? m.email : "" };
  }

  async function resolveRecipients(pid, rule, ctx) {
    const ticket = ctx.ticket || {};
    const company = ctx.company || null;
    const out = [];
    const seen = {};
    const add = (r) => { if (r && r.key && !seen[r.key]) { seen[r.key] = true; out.push(r); } };
    for (const token of rule.recipients || []) {
      if (token === "owner") add(await memberRef(ticket.ownerId));
      else if (token === "created_by") add(await memberRef(ticket.createdBy));
      else if (token === "account_manager") add(await memberRef(company && company.accountManager));
      else if (token === "team") {
        if (ticket.teamId != null) {
          const members = await ERP.members.teamMembers(ticket.teamId);
          for (const m of members) add(await memberRef(m.id));
        }
      } else if (token === "contact") {
        const cid = ticket.companyId != null ? ticket.companyId : (company && company.id);
        if (ticket.contactId != null && cid != null) {
          const c = await ERP.companies.contact(cid, ticket.contactId);
          if (c && c.email) add({ key: "email:" + c.email, memberId: null, name: c.name || c.email, email: c.email });
        }
      } else if (/^member:/.test(token)) add(await memberRef(token.slice(7)));
      else if (/^email:/.test(token)) add({ key: "email:" + token.slice(6), memberId: null, name: token.slice(6), email: token.slice(6) });
      else if (isFinite(token)) add(await memberRef(token));
    }
    return out;
  }

  N.resolveRecipients = resolveRecipients;

  /* ─────────────────────────── dispatch ─────────────────────────── */

  function matchEvent(pattern, event) {
    if (!pattern || pattern === "*") return true;
    if (pattern === event) return true;
    if (pattern.slice(-2) === ".*" && event.indexOf(pattern.slice(0, -1)) === 0) return true;
    return false;
  }
  N.matchEvent = matchEvent;

  function ticketKey(ctx) {
    const t = ctx.ticket;
    return t ? String(t.companyId != null ? t.companyId : "") + ":" + String(t.id != null ? t.id : "") : "ctx";
  }

  /* Deliver one notification for one recipient, honouring mute / channel /
     dedup / digest rules. Returns {status, id}. */
  async function deliver(pid, rule, templ, recipient, ctx, event) {
    const at = Date.now();
    const pref = await N.pref(pid, recipient.memberId);
    const key = rule.id + "|" + recipient.key + "|" + ticketKey(ctx);

    const muted = (pref.muted || []).some((m) => m === event || m === "*" || m === "all");
    if (muted) return N.recordLog(pid, { ruleId: rule.id, key: key, recipient: recipient, ctx: ctx, status: "suppressed", reason: "recipient muted " + event });

    const windowMin = Number(rule.dedupeMinutes) || 0;
    if (windowMin > 0) {
      const logs = await N.log(pid);
      const recent = logs.find((l) => l.key === key && l.status !== "suppressed" && (at - Date.parse(l.at)) < windowMin * 60000);
      if (recent) return N.recordLog(pid, { ruleId: rule.id, key: key, recipient: recipient, ctx: ctx, status: "suppressed", reason: "dedup window (" + windowMin + "m)" });
    }

    const want = rule.channel || "inapp";
    let channels = [];
    if (want === "both") channels = ["inapp", "email"];
    else channels = [want];
    channels = channels.filter((c) => (pref.channels || {})[c] !== false);
    if (!channels.length) return N.recordLog(pid, { ruleId: rule.id, key: key, recipient: recipient, ctx: ctx, status: "suppressed", reason: "recipient turned this channel off" });
    if (channels.indexOf("email") >= 0 && !recipient.email) channels = channels.filter((c) => c !== "email");
    if (!channels.length) return N.recordLog(pid, { ruleId: rule.id, key: key, recipient: recipient, ctx: ctx, status: "suppressed", reason: "no e-mail address" });

    const tpl = templ || defaultTemplateFor(event);
    const title = N.render(tpl.subject, ctx) || N.render(defaultTemplateFor(event).subject, ctx);
    const body = N.render(tpl.body || defaultTemplateFor(event).body, ctx);
    const digest = !!rule.digest || !!pref.digestOnly;

    const notif = Object.assign({
      kind: "notification", ruleId: rule.id, event: event,
      recipientMemberId: recipient.memberId != null ? recipient.memberId : null,
      recipientEmail: recipient.memberId == null ? recipient.email : "",
      recipientName: recipient.name,
      title: title, body: body,
      channel: channels.join("+"),
      ticketId: ctx.ticket ? ctx.ticket.id : null,
      ticketNumber: ctx.ticket ? ctx.ticket.number : null,
      companyId: ctx.ticket ? ctx.ticket.companyId : null,
      companyName: ctx.company ? ctx.company.name : "",
      status: digest ? "digested" : "sent",
      read: false, createdAt: nowIso(),
    });
    const saved = await put(pid, notif);

    if (digest) {
      await addToDigest(pid, rule, recipient, saved, channels);
      return N.recordLog(pid, { ruleId: rule.id, key: key, recipient: recipient, ctx: ctx, status: "digested", reason: "queued for digest", notificationId: saved.id });
    }
    if (channels.indexOf("email") >= 0) await sendEmail(pid, rule, recipient, title, body, ctx);
    return N.recordLog(pid, { ruleId: rule.id, key: key, recipient: recipient, ctx: ctx, status: "sent", reason: channels.join("+"), notificationId: saved.id });
  }

  async function sendEmail(pid, rule, recipient, subject, body, ctx) {
    return put(pid, {
      kind: "outboundEmail", ruleId: rule.id, to: recipient.email, toName: recipient.name,
      subject: subject, body: body, event: ctx.event || "",
      ticketId: ctx.ticket ? ctx.ticket.id : null, at: nowIso(),
    });
  }

  async function addToDigest(pid, rule, recipient, notif, channels) {
    const at = Date.now();
    const list = await N.digests(pid);
    const windowMin = rule.digestWindowMinutes == null ? 240 : Number(rule.digestWindowMinutes);
    const windowMs = windowMin * 60000;
    let d = list.find((x) => !x.sentAt && x.recipientKey === recipient.key && String(x.ruleId) === String(rule.id) && at - Date.parse(x.openedAt) < windowMs);
    if (!d) {
      d = await put(pid, {
        kind: "notificationDigest", ruleId: rule.id, recipientKey: recipient.key,
        recipientMemberId: recipient.memberId != null ? recipient.memberId : null,
        recipientEmail: recipient.email || "", recipientName: recipient.name,
        channels: channels, items: [], openedAt: nowIso(), windowMinutes: windowMin, sentAt: null,
      });
      d = d.record || d;
    }
    const rec = (await N.digests(pid)).find((x) => String(x.id) === String(d.id)) || d;
    rec.items = (rec.items || []).concat([{ id: notif.id, title: notif.title, ticketNumber: notif.ticketNumber }]);
    await put(pid, rec);
    return rec;
  }

  N.recordLog = async function (pid, o) {
    const rec = await put(pid, {
      kind: "notificationLog", ruleId: o.ruleId, key: o.key,
      recipientKey: o.recipient ? o.recipient.key : "",
      recipientName: o.recipient ? o.recipient.name : "",
      ticketId: o.ctx && o.ctx.ticket ? o.ctx.ticket.id : null,
      ticketKey: o.ctx ? ticketKey(o.ctx) : "",
      event: o.ctx ? o.ctx.event : "",
      status: o.status, reason: o.reason || "", notificationId: o.notificationId || null, at: nowIso(),
    });
    return { status: o.status, reason: o.reason, log: rec.record || rec };
  };

  /* Flush digests whose window has elapsed into one summary notification. */
  N.flushDigests = async function (pid, nowMs) {
    const at = nowMs || Date.now();
    const list = await N.digests(pid);
    const due = list.filter((d) => !d.sentAt && at - Date.parse(d.openedAt) >= (d.windowMinutes == null ? 240 : Number(d.windowMinutes)) * 60000);
    const out = [];
    for (const d of due) {
      const items = d.items || [];
      if (!items.length) { d.sentAt = nowIso(); await put(pid, d); continue; }
      const summary = items.map((i) => "· " + (i.ticketNumber ? "#" + i.ticketNumber + " — " : "") + i.title).join("\n");
      const notif = await put(pid, {
        kind: "notification", ruleId: d.ruleId, event: "digest",
        recipientMemberId: d.recipientMemberId, recipientEmail: d.recipientEmail || "", recipientName: d.recipientName,
        title: "Digest — " + items.length + " update" + (items.length === 1 ? "" : "s"),
        body: summary, channel: (d.channels || ["inapp"]).join("+"),
        ticketId: null, companyId: null, status: "sent", read: false, createdAt: nowIso(),
      });
      if ((d.channels || []).indexOf("email") >= 0 && d.recipientEmail) {
        await put(pid, { kind: "outboundEmail", ruleId: d.ruleId, to: d.recipientEmail, toName: d.recipientName, subject: "Digest — " + items.length + " update(s)", body: summary, event: "digest", ticketId: null, at: nowIso() });
      }
      d.sentAt = nowIso();
      await put(pid, d);
      out.push(notif.record || notif);
    }
    return out;
  };

  /* Main entry: dispatch every active rule matching an event. */
  N.emit = async function (event, ctx) {
    ctx = Object.assign({}, ctx || {}, { event: event });
    const pid = await ten().providerId();
    if (pid == null) return { sent: 0, suppressed: 0, digested: 0 };
    const rules = (await N.rules(pid)).filter((r) => r.active !== false && matchEvent(r.event, event));
    const templates = await N.templates(pid);
    const stats = { sent: 0, suppressed: 0, digested: 0, details: [] };
    for (const rule of rules) {
      if (ERP.workflow && typeof ERP.workflow.matchConditions === "function" && !ERP.workflow.matchConditions(rule.conditions || [], ctx)) continue;
      const templ = rule.templateId != null ? templates.find((t) => String(t.id) === String(rule.templateId)) || null : null;
      const recips = await resolveRecipients(pid, rule, ctx);
      for (const r of recips) {
        const res = await deliver(pid, rule, templ, r, ctx, event);
        if (stats[res.status] != null) stats[res.status]++;
        stats.details.push({ rule: rule.name, to: r.name, status: res.status, reason: res.reason });
      }
    }
    return stats;
  };

  /* Direct send used by the workflow engine's `notify` action. */
  N.dispatchNow = async function (ctx, o) {
    const pid = await ten().providerId();
    const rule = Object.assign(N.newRule({ name: o.name || "Workflow notification", event: ctx.event || "ticket.updated" }), {
      recipients: o.recipients || ["owner"], channel: o.channel || "inapp",
      digest: !!o.digest, dedupeMinutes: o.dedupeMinutes == null ? 0 : o.dedupeMinutes,
      conditions: [],
    });
    const templ = o.subject || o.body ? { subject: o.subject || "", body: o.body || "" } : null;
    const recips = await resolveRecipients(pid, rule, ctx);
    const stats = { sent: 0, suppressed: 0, digested: 0 };
    for (const r of recips) {
      const res = await deliver(pid, rule, templ, r, ctx, ctx.event || "ticket.updated");
      if (stats[res.status] != null) stats[res.status]++;
    }
    return stats;
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  N.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    if ((await N.rules(pid)).length || (await N.templates(pid)).length) return { skipped: "already_seeded" };
    const created = await N.saveTemplate(pid, N.newTemplate({
      name: "Standard ticket notification",
      channel: "both",
      subject: "{ticket.number} · {ticket.summary}",
      body: "{company.name}\n{ticket.number} · {ticket.board} · {ticket.status} · {ticket.priority}\n\n{ticket.summary}\n\nOwner: {ticket.ownerName}\nSLA due: {sla.due}",
    }));
    const tplId = created.record ? created.record.id : (created.id || null);
    await N.saveRule(pid, N.newRule({ name: "Tell the owner when work is assigned", event: "ticket.assigned", recipients: ["owner"], channel: "both", templateId: tplId, dedupeMinutes: 30, order: 10 }));
    await N.saveRule(pid, N.newRule({ name: "Notify the client of a customer update", event: "ticket.customer_update", recipients: ["contact"], channel: "email", templateId: tplId, dedupeMinutes: 5, order: 20 }));
    await N.saveRule(pid, N.newRule({ name: "Escalate a breach to the account manager", event: "ticket.breached", recipients: ["owner", "account_manager"], channel: "both", templateId: tplId, dedupeMinutes: 60, order: 30 }));
    await N.saveRule(pid, N.newRule({ name: "Daily digest of ticket changes", event: "ticket.status_changed", recipients: ["account_manager"], channel: "inapp", templateId: tplId, digest: true, digestWindowMinutes: 240, dedupeMinutes: 0, order: 40 }));
    return { seeded: true };
  };

  /* ─────────────────────────── configuration UI (Task 11) ─────────────────────────── */

  async function openTemplateModal(pid, rec, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("notifications.edit")) return;
    const t = rec || N.newTemplate();
    const fields =
      ui.text("name", "Template name", t.name) +
      ui.select("channel", "Channel", [{ value: "inapp", label: "In-app" }, { value: "email", label: "E-mail" }, { value: "both", label: "In-app + e-mail" }], t.channel) +
      ui.text("subject", "Subject / title", t.subject, "{ticket.number} · {ticket.summary}") +
      ui.textarea("body", "Body", t.body, 6) +
      ui.check("active", "Active", t.active !== false);
    const modal = ui.modal({
      title: rec ? "Edit template" : "New notification template",
      size: "lg",
      body: ui.form(fields) +
        ui.alert("Tokens: {ticket.number} {ticket.summary} {ticket.status} {ticket.priority} {ticket.board} {ticket.ownerName} {company.name} {event} {actor.name} {sla.due}", "info"),
      foot: ui.btn("Cancel", { small: true, act: "nt-cancel" }) + " " + ui.btn(rec ? "Save" : "Create", { small: true, primary: true, act: "nt-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=nt-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=nt-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "channel", "subject", "body", "active"]);
      if (!v.name) { ERP.toast("A template name is required.", "error"); return; }
      btn.disabled = true;
      const res = await N.saveTemplate(pid, Object.assign({}, t, v));
      ui.closeModal();
      ERP.toast(res.error ? "Could not save." : "Template saved.", res.error ? "error" : "success");
      refresh();
    };
  }

  async function openRuleModal(pid, rec, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("notifications.edit")) return;
    const [members, teams, templates] = await Promise.all([ERP.members.members(), ERP.members.teams(), N.templates(pid)]);
    const r = rec || N.newRule();
    const W = ERP.workflow;
    const fields =
      ui.text("name", "Rule name", r.name) +
      ui.select("event", "Event", ["*"].concat(N.EVENTS).map((e) => ({ value: e, label: e })), r.event) +
      ui.select("channel", "Channel", [{ value: "inapp", label: "In-app" }, { value: "email", label: "E-mail" }, { value: "both", label: "In-app + e-mail" }], r.channel) +
      ui.select("templateId", "Template", [{ value: "", label: "— default —" }].concat(templates.map((t) => ({ value: t.id, label: t.name }))), r.templateId) +
      '<div class="field"><label>Recipients</label><div class="radio-group">' +
        N.RECIPIENT_TOKENS.map((tok) => '<label><input type="checkbox" data-rcpt value="' + ui.esc(tok.id) + '"' + ((r.recipients || []).indexOf(tok.id) >= 0 ? " checked" : "") + "> " + ui.esc(tok.label) + "</label>").join("") +
        members.map((m) => '<label><input type="checkbox" data-rcpt value="member:' + ui.esc(m.id) + '"' + ((r.recipients || []).indexOf("member:" + m.id) >= 0 ? " checked" : "") + "> " + ui.esc(m.name) + "</label>").join("") +
      "</div></div>" +
      (W && W.conditionsHtml ? W.conditionsHtml(r.conditions || []) : "") +
      '<div class="erp-form-row">' +
        ui.check("digest", "Batch into a digest", r.digest) +
        ui.number("digestWindowMinutes", "Digest window (min)", r.digestWindowMinutes) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("dedupeMinutes", "Suppress repeats within (min)", r.dedupeMinutes) +
        ui.number("order", "Order", r.order) +
      "</div>" +
      ui.check("active", "Active", r.active !== false);
    const modal = ui.modal({
      title: rec ? "Edit notification rule" : "New notification rule",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "nr-cancel" }) + " " + ui.btn(rec ? "Save rule" : "Create rule", { small: true, primary: true, act: "nr-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=nr-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=nr-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "event", "channel", "templateId", "digest", "digestWindowMinutes", "dedupeMinutes", "order", "active"]);
      if (!v.name) { ERP.toast("A rule name is required.", "error"); return; }
      btn.disabled = true;
      const conditions = W && W.readConditions ? W.readConditions(form) : [];
      const res = await N.saveRule(pid, Object.assign({}, r, v, {
        templateId: v.templateId === "" ? null : v.templateId,
        recipients: Array.from(form.querySelectorAll("[data-rcpt]:checked")).map((i) => i.value),
        conditions: conditions,
      }));
      ui.closeModal();
      ERP.toast(res.error ? "Could not save." : "Rule saved.", res.error ? "error" : "success");
      refresh();
    };
  }

  async function openPrefModal(pid, member, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("notifications.edit")) return;
    const pref = await N.pref(pid, member.id);
    const events = N.EVENTS.filter((e) => !/^ticket\.(created|updated)$/.test(e));
    const fields =
      ui.check("inapp", "In-app notifications", pref.channels.inapp !== false) +
      ui.check("email", "E-mail notifications", pref.channels.email !== false) +
      ui.check("digestOnly", "Digest only (batch everything)", pref.digestOnly) +
      '<div class="field"><label>Muted events</label><div class="radio-group">' +
        events.map((e) => '<label><input type="checkbox" data-mute value="' + ui.esc(e) + '"' + ((pref.muted || []).indexOf(e) >= 0 ? " checked" : "") + "> " + ui.esc(e) + "</label>").join("") +
      "</div></div>";
    const modal = ui.modal({
      title: "Notification preferences · " + member.name,
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "np-cancel" }) + " " + ui.btn("Save", { small: true, primary: true, act: "np-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=np-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=np-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["inapp", "email", "digestOnly"]);
      btn.disabled = true;
      await N.savePref(pid, member.id, {
        channels: { inapp: !!v.inapp, email: !!v.email },
        digestOnly: !!v.digestOnly,
        muted: Array.from(form.querySelectorAll("[data-mute]:checked")).map((i) => i.value),
      });
      ui.closeModal();
      ERP.toast("Preferences saved.", "success");
      refresh();
    };
  }

  async function renderRules(panel, pid, refresh) {
    const ui = ERP.ui;
    const rules = await N.rules(pid);
    const canEdit = ERP.security.can("notifications.edit");
    const rows = rules.map((r) => ({
      order: ui.esc(r.order),
      name: "<b>" + ui.esc(r.name) + "</b>" + (r.active === false ? " " + ui.badge("inactive", "muted") : ""),
      event: ui.badge(r.event, "info"),
      when: ui.esc(summarizeConditions(r.conditions)),
      to: ui.esc((r.recipients || []).join(", ")),
      channel: ui.esc(r.channel) + (r.digest ? " " + ui.badge("digest", "warn") : ""),
      dedupe: Number(r.dedupeMinutes) ? ui.fmt(r.dedupeMinutes, 0) + "m" : "—",
      actions: canEdit ? ui.btn("Edit", { small: true, act: "nr-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "nr-del", arg: r.id }) : "",
    }));
    panel.innerHTML = ui.table([
      { key: "order", label: "Order" },
      { key: "name", label: "Rule" },
      { key: "event", label: "Event" },
      { key: "when", label: "Conditions" },
      { key: "to", label: "Recipients" },
      { key: "channel", label: "Channel" },
      { key: "dedupe", label: "Dedup", align: "right" },
      { key: "actions", label: "", align: "right" },
    ], rows, { emptyText: "No notification rules yet." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "nr-edit") return openRuleModal(pid, rules.find((r) => String(r.id) === String(arg)), refresh);
      if (act === "nr-del" && await ui.confirm({ title: "Delete rule?", message: "Notifications will stop for this event.", danger: true, okLabel: "Delete" })) {
        await N.removeRule(pid, arg); ERP.toast("Rule deleted.", "success"); refresh();
      }
    });
  }

  function summarizeConditions(conditions) {
    if (!conditions || !conditions.length) return "always";
    return conditions.map((c) => (c.field || "?") + " " + (c.op || "eq") + " " + (c.value == null ? "" : c.value)).join(" AND ");
  }

  async function renderTemplates(panel, pid, refresh) {
    const ui = ERP.ui;
    const list = await N.templates(pid);
    const canEdit = ERP.security.can("notifications.edit");
    const rows = list.map((t) => ({
      name: "<b>" + ui.esc(t.name) + "</b>" + (t.active === false ? " " + ui.badge("inactive", "muted") : ""),
      channel: ui.esc(t.channel),
      subject: ui.esc(t.subject || "—"),
      actions: canEdit ? ui.btn("Edit", { small: true, act: "nt-edit", arg: t.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "nt-del", arg: t.id }) : "",
    }));
    panel.innerHTML = ui.table([
      { key: "name", label: "Template" },
      { key: "channel", label: "Channel" },
      { key: "subject", label: "Subject" },
      { key: "actions", label: "", align: "right" },
    ], rows, { emptyText: "No templates yet." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "nt-edit") return openTemplateModal(pid, list.find((t) => String(t.id) === String(arg)), refresh);
      if (act === "nt-del" && await ui.confirm({ title: "Delete template?", message: "Rules using it fall back to the default text.", danger: true, okLabel: "Delete" })) {
        await N.removeTemplate(pid, arg); ERP.toast("Template deleted.", "success"); refresh();
      }
    });
  }

  async function renderPrefs(panel, pid, refresh) {
    const ui = ERP.ui;
    const members = await ERP.members.members();
    const prefs = await N.prefs(pid);
    const rows = members.map((m) => {
      const p = prefs.find((x) => String(x.memberId) === String(m.id));
      const eff = Object.assign(JSON.parse(JSON.stringify(N.DEFAULT_PREF)), p || {});
      return {
        name: "<b>" + ui.esc(m.name) + "</b>",
        inapp: eff.channels.inapp !== false ? ui.badge("on", "success") : ui.badge("off", "muted"),
        email: (eff.channels.email !== false && m.email) ? ui.badge("on", "success") : ui.badge(m.email ? "off" : "no address", "muted"),
        digest: eff.digestOnly ? ui.badge("digest only", "warn") : ui.badge("immediate", "info"),
        muted: ui.esc((eff.muted || []).join(", ") || "—"),
        actions: ERP.security.can("notifications.edit") ? ui.btn("Preferences", { small: true, act: "np-edit", arg: m.id }) : "",
      };
    });
    panel.innerHTML = ui.table([
      { key: "name", label: "Member" },
      { key: "inapp", label: "In-app" },
      { key: "email", label: "E-mail" },
      { key: "digest", label: "Delivery" },
      { key: "muted", label: "Muted" },
      { key: "actions", label: "", align: "right" },
    ], rows, { emptyText: "No members yet." });
    ui.bind(panel, "click", "[data-act=np-edit]", async (el, e, act, arg) => {
      const m = members.find((x) => String(x.id) === String(arg));
      if (m) openPrefModal(pid, m, refresh);
    });
  }

  async function renderActivity(panel, pid, refresh) {
    const ui = ERP.ui;
    const [notifs, log, digests, outbox] = await Promise.all([N.notifications({ pid: pid, limit: 25 }), N.log(pid), N.digests(pid), N.outbox(pid)]);
    const openDigests = digests.filter((d) => !d.sentAt);
    const nRows = notifs.map((n) => ({
      when: ui.dateTime(n.createdAt),
      to: "<b>" + ui.esc(n.recipientName || n.recipientEmail || "—") + "</b>",
      title: ui.esc(n.title),
      channel: ui.esc(n.channel),
      status: n.status === "digested" ? ui.badge("digested", "warn") : ui.badge("sent", "success"),
    }));
    const logRows = log.slice(0, 30).map((l) => ({
      when: ui.dateTime(l.at),
      to: ui.esc(l.recipientName || l.recipientKey || "—"),
      event: ui.esc(l.event),
      status: l.status === "sent" ? ui.badge("sent", "success") : l.status === "digested" ? ui.badge("digested", "warn") : ui.badge("suppressed", "muted"),
      reason: ui.esc(l.reason || ""),
    }));
    panel.innerHTML =
      ui.summary([
        { label: "Notifications", value: String(notifs.length) },
        { label: "Suppressed", value: String(log.filter((l) => l.status === "suppressed").length) },
        { label: "Open digests", value: String(openDigests.length) },
        { label: "E-mails queued", value: String(outbox.length) },
      ]) +
      '<div class="erp-btn-row" style="margin:10px 0">' + ui.btn("Send due digests", { primary: true, act: "na-flush" }) + "</div>" +
      ui.card("Recent notifications", ui.table([
        { key: "when", label: "When" }, { key: "to", label: "To" }, { key: "title", label: "Title" },
        { key: "channel", label: "Channel" }, { key: "status", label: "Status" },
      ], nRows, { emptyText: "No notifications yet." })) +
      ui.card("Delivery / suppression log", ui.table([
        { key: "when", label: "When" }, { key: "to", label: "To" }, { key: "event", label: "Event" },
        { key: "status", label: "Outcome" }, { key: "reason", label: "Detail" },
      ], logRows, { emptyText: "Nothing logged yet." })) +
      ui.card("Outbound e-mail queue", ui.table([
        { key: "when", label: "Queued", render: (r) => ui.dateTime(r.at) },
        { key: "to", label: "To", render: (r) => ui.esc(r.to) },
        { key: "subject", label: "Subject", render: (r) => ui.esc(r.subject) },
      ], outbox.slice(0, 15), { emptyText: "No e-mail queued." }));
    ui.bind(panel, "click", "[data-act=na-flush]", async (btn) => {
      btn.disabled = true;
      const sent = await N.flushDigests(pid);
      ERP.toast(sent.length ? sent.length + " digest(s) sent." : "No digests due yet.", "success");
      refresh();
    });
  }

  N.renderConfig = async function (panel, refresh, view) {
    const ui = ERP.ui;
    const pid = await ten().providerId();
    const v = view || panel.__notifyView || "rules";
    panel.__notifyView = v;
    const defs = [
      { id: "rules", label: "Rules" },
      { id: "templates", label: "Templates" },
      { id: "preferences", label: "Preferences" },
      { id: "activity", label: "Activity" },
    ];
    const addBtn =
      v === "rules" ? ui.btn("Add rule", { primary: true, act: "nr-new" }) :
      v === "templates" ? ui.btn("Add template", { primary: true, act: "nt-new" }) : "";
    panel.innerHTML =
      '<div class="tabs erp-tabs" role="tablist">' +
        defs.map((d) => '<button class="tab' + (d.id === v ? " active" : "") + '" data-notify-view="' + d.id + '">' + ui.esc(d.label) + "</button>").join("") +
      '</div>' + (addBtn ? '<div class="erp-btn-row" style="margin:12px 0">' + addBtn + "</div>" : "") +
      '<div data-notify-panel></div>';
    ui.bind(panel, "click", "[data-notify-view]", (el) => {
      panel.__notifyView = el.getAttribute("data-notify-view");
      N.renderConfig(panel, refresh, panel.__notifyView);
    });
    ui.bind(panel, "click", "[data-act=nr-new]", () => openRuleModal(pid, null, refresh));
    ui.bind(panel, "click", "[data-act=nt-new]", () => openTemplateModal(pid, null, refresh));
    const host = panel.querySelector("[data-notify-panel]");
    if (v === "rules") await renderRules(host, pid, refresh);
    else if (v === "templates") await renderTemplates(host, pid, refresh);
    else if (v === "preferences") await renderPrefs(host, pid, refresh);
    else await renderActivity(host, pid, refresh);
  };
})();
