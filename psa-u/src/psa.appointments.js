/* ============================================================
   PSA-U — appointments & on-site service calls
   (Phase 3 · Task 17)
   An appointment is the *when and where* of a piece of work: a
   booked window on a technician's day, tied to the ticket it
   serves but modelled separately from it, so the ticket can carry
   the work and the appointment can carry the visit —

     • window      — start / end, plus a travel allowance;
     • place       — the client site and the contact on site;
     • technician  — who is assigned (owner of the ticket);
     • on-site     — notes captured during the visit and a sign-off
                     captured on completion;
     • type/status — on-site or remote; scheduled → dispatched →
                     in progress → completed / cancelled.

   Appointments live in their client company's document (so a
   client's visits travel with the client). Saving one keeps the
   ticket in step: it takes the owner and schedule, moves to
   "Scheduled", and on completion records the on-site notes and
   sign-off against the ticket.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const A = (ERP.appointments = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("appointments requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();

  A.STATUSES = [
    { id: "scheduled", label: "Scheduled", tone: "info" },
    { id: "dispatched", label: "Dispatched", tone: "warn" },
    { id: "in-progress", label: "In progress", tone: "warn" },
    { id: "completed", label: "Completed", tone: "success" },
    { id: "cancelled", label: "Cancelled", tone: "muted" },
  ];
  A.statusLabel = (id) => (A.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  A.statusTone = (id) => (A.STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  A.TYPES = [{ id: "onsite", label: "On-site" }, { id: "remote", label: "Remote" }];
  A.typeLabel = (id) => (A.TYPES.find((t) => t.id === id) || {}).label || "On-site";

  A.KINDS = ["appointment"];

  const OPEN_STATUSES = ["scheduled", "dispatched", "in-progress"];
  A.isOpen = (a) => OPEN_STATUSES.indexOf(String(a && a.status)) !== -1;

  A.newAppointment = (over) => Object.assign({
    kind: "appointment", id: null, companyId: null, ticketId: null,
    memberId: null, siteId: null, contactId: null,
    title: "", type: "onsite", startMs: null, endMs: null,
    status: "scheduled", travelMinutes: 0, notes: "", onSiteNotes: "",
    signOff: null, createdBy: null, createdAt: null, updatedAt: null,
  }, over || {});

  /* ─────────────────────────── reads ─────────────────────────── */

  async function nextDocId(companyId) { return ten().nextId(await ten().records("company", companyId)); }
  function companyRecords(companyId) { return ten().records("company", companyId); }

  A.get = async function (companyId, id) {
    return (await companyRecords(companyId)).find((r) => r.kind === "appointment" && String(r.id) === String(id)) || null;
  };

  A.forCompany = async function (companyId) {
    return (await companyRecords(companyId)).filter((r) => r.kind === "appointment")
      .sort((a, b) => Number(a.startMs || 0) - Number(b.startMs || 0));
  };

  /* The live appointment for a ticket (the most recent non-cancelled one). */
  A.forTicket = async function (companyId, ticketId) {
    const list = (await A.forCompany(companyId)).filter((r) => String(r.ticketId) === String(ticketId) && r.status !== "cancelled");
    return list.length ? list[list.length - 1] : null;
  };

  A.list = async function (query) {
    query = query || {};
    const entries = await ERP.companies.list();
    const out = [];
    for (const e of entries) {
      if (ERP.security && !ERP.security.canViewCompany(e.id)) continue;
      const recs = await companyRecords(e.id);
      for (const r of recs) {
        if (r.kind !== "appointment") continue;
        if (query.companyId != null && String(e.id) !== String(query.companyId)) continue;
        if (query.memberId != null && String(r.memberId) !== String(query.memberId)) continue;
        if (query.status && String(r.status) !== String(query.status)) continue;
        if (query.open && !A.isOpen(r)) continue;
        if (query.fromMs != null && Number(r.endMs) < query.fromMs) continue;
        if (query.toMs != null && Number(r.startMs) > query.toMs) continue;
        out.push(Object.assign({}, r, { companyId: e.id, __companyName: e.name }));
      }
    }
    out.sort((a, b) => Number(a.startMs || 0) - Number(b.startMs || 0));
    return out;
  };

  A.between = function (pid, fromMs, toMs, query) {
    return A.list(Object.assign({ fromMs: fromMs, toMs: toMs }, query || {}));
  };

  /* ─────────────────────────── events ─────────────────────────── */

  A.eventContext = async function (event, appt) {
    let ticket = null;
    if (appt && appt.ticketId != null) ticket = await ERP.tickets.get(appt.companyId, appt.ticketId);
    const company = appt && appt.companyId != null ? await ERP.companies.get(appt.companyId) : null;
    const member = appt && appt.memberId != null ? await ERP.members.member(appt.memberId) : null;
    return { event: event, appointment: appt, ticket: ticket, company: company, member: member, actor: ERP.security ? ERP.security.actor() : null };
  };

  async function emit(event, appt) {
    if (!ERP.workflow) return;
    try {
      const ctx = await A.eventContext(event, appt);
      await ERP.workflow.emit(event, ctx);
    } catch (e) {}
  }

  /* ─────────────────────────── ticket sync (Task 17) ─────────────────────────── */

  async function syncTicket(pid, appt, created) {
    if (appt.ticketId == null || appt.companyId == null) return null;
    const t = await ERP.tickets.get(appt.companyId, appt.ticketId);
    if (!t) return null;
    if (appt.status === "cancelled") return t;

    const patch = { scheduledFor: new Date(appt.startMs).toISOString() };
    if (appt.memberId != null && appt.memberId !== "") patch.ownerId = appt.memberId;

    const statuses = await ERP.taxonomy.list(pid, "ticketStatus");
    const closed = statuses.some((s) => String(s.code) === String(t.status) && s.closed === true);
    if (!closed && appt.status !== "completed" && String(t.status) !== "resolved") {
      patch.status = "scheduled";
    }
    const updated = Object.assign({}, t, patch);
    /* system:true bypasses the permission gate (the appointment controller has
       already enforced its own), and the normal ticket pipeline still runs so
       activity, SLA and workflow all see the change. */
    await ERP.tickets.save(appt.companyId, updated, { system: true });
    return updated;
  }

  /* ─────────────────────────── writes ─────────────────────────── */

  A.save = async function (companyId, rec, opts) {
    opts = opts || {};
    if (companyId == null) companyId = rec && rec.companyId;
    if (companyId == null) return { error: "no_company" };
    if (!opts.system && !ERP.security.enforce("appointments.edit", { companyId: companyId })) return { error: "forbidden" };
    const pid = await ten().providerId();
    if (pid == null) return { error: "no_provider" };
    const existing = rec && rec.id != null ? await A.get(companyId, rec.id) : null;
    const r = Object.assign(A.newAppointment(), existing || {}, rec, { companyId: companyId });
    if (!r.startMs) return { error: "start_required" };
    r.startMs = Number(r.startMs);
    if (!r.endMs) r.endMs = r.startMs + (Number(opts.durationMinutes) || 60) * 60000;
    r.endMs = Number(r.endMs);
    if (r.endMs <= r.startMs) r.endMs = r.startMs + 60 * 60000;
    if (!r.title && r.ticketId != null) {
      const t = await ERP.tickets.get(companyId, r.ticketId);
      if (t) r.title = t.summary || ("Ticket #" + t.number);
    }
    if (r.id == null || !isFinite(r.id)) { r.id = await nextDocId(companyId); r.createdAt = nowIso(); r.createdBy = r.createdBy != null ? r.createdBy : (ERP.security && ERP.security.actor().memberId) || null; }
    r.updatedAt = nowIso();
    await ten().upsert("company", companyId, r);
    await syncTicket(pid, r, !existing);
    if (!opts.silent) await emit(existing ? "appointment.updated" : "appointment.scheduled", r);
    return { record: r, created: !existing };
  };

  A.reschedule = async function (companyId, id, patch, opts) {
    const existing = await A.get(companyId, id);
    if (!existing) return { error: "not_found" };
    return A.save(companyId, Object.assign({}, existing, patch), opts);
  };

  A.remove = async function (companyId, id) {
    if (!ERP.security.enforce("appointments.edit", { companyId: companyId })) return { error: "forbidden" };
    return ten().remove("company", companyId, (r) => r.kind === "appointment" && String(r.id) === String(id));
  };

  /* Create (or move) the appointment that schedules a ticket. Used by the
     dispatch board's drag-and-drop and the scheduling assistant. */
  A.schedule = async function (ticket, opts) {
    opts = opts || {};
    if (!ticket || ticket.companyId == null) return { error: "no_company" };
    const dur = Number(opts.durationMinutes) || 60;
    const startMs = Number(opts.startMs);
    if (!startMs) return { error: "start_required" };
    const existing = await A.forTicket(ticket.companyId, ticket.id);
    const base = existing || A.newAppointment({ companyId: ticket.companyId, ticketId: ticket.id, title: ticket.summary || "" });
    return A.save(ticket.companyId, Object.assign({}, base, {
      memberId: opts.memberId != null && opts.memberId !== "" ? opts.memberId : base.memberId,
      startMs: startMs, endMs: startMs + dur * 60000,
      title: ticket.summary || base.title,
      type: opts.type || base.type,
    }), opts);
  };

  /* Record the visit's outcome: on-site notes and the client sign-off, then
     write both back to the ticket as an internal note. */
  A.complete = async function (companyId, id, payload) {
    payload = payload || {};
    if (!ERP.security.enforce("appointments.edit", { companyId: companyId })) return { error: "forbidden" };
    const appt = await A.get(companyId, id);
    if (!appt) return { error: "not_found" };
    const now = nowIso();
    const rec = Object.assign({}, appt, {
      status: "completed", onSiteNotes: payload.onSiteNotes || appt.onSiteNotes || "",
      signOff: payload.signOffName ? { name: payload.signOffName, note: payload.signOffNote || "", at: now } : (appt.signOff || null),
      updatedAt: now,
    });
    await ten().upsert("company", companyId, rec);

    if (rec.ticketId != null) {
      const t = await ERP.tickets.get(companyId, rec.ticketId);
      const body = "On-site visit completed " + ui.dateTime(now) +
        (rec.onSiteNotes ? ".\n\n" + rec.onSiteNotes : ".") +
        (rec.signOff ? "\n\nSigned off by " + rec.signOff.name + (rec.signOff.note ? " — " + rec.signOff.note : "") + "." : "");
      if (t) {
        await syncTicket(await ten().providerId(), rec, false);
        await ERP.tickets.addNote(companyId, rec.ticketId, { body: body, internal: true, author: "Dispatch" });
      }
    }
    await emit("appointment.completed", rec);
    return { record: rec };
  };

  A.cancel = async function (companyId, id, reason) {
    if (!ERP.security.enforce("appointments.edit", { companyId: companyId })) return { error: "forbidden" };
    const appt = await A.get(companyId, id);
    if (!appt) return { error: "not_found" };
    const now = nowIso();
    const rec = Object.assign({}, appt, { status: "cancelled", cancelReason: reason || "", updatedAt: now });
    await ten().upsert("company", companyId, rec);
    if (rec.ticketId != null) {
      await ERP.tickets.addNote(companyId, rec.ticketId, { body: "Appointment on " + ui.dateTime(appt.startMs) + " cancelled" + (reason ? ": " + reason : "."), internal: true, author: "Dispatch" });
    }
    await emit("appointment.cancelled", rec);
    return { record: rec };
  };

  /* ─────────────────────────── upcoming ─────────────────────────── */

  A.upcoming = async function (opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const days = Number(opts.days) || 14;
    return A.list({ open: true, fromMs: now, toMs: now + days * 86400000, memberId: opts.memberId });
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  A.ensureSeed = async function (pid) { return { skipped: "nothing_to_seed" }; };

  /* ─────────────────────────── configuration UI ─────────────────────────── */

  function parseDateTime(dateStr, timeStr) {
    const d = new Date(String(dateStr) + "T" + String(timeStr || "09:00") + ":00");
    return isFinite(d.getTime()) ? d.getTime() : null;
  }

  function dateValue(ms) {
    if (!ms) return ui.today();
    const d = new Date(Number(ms));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function timeValue(ms) {
    if (!ms) return "09:00";
    const d = new Date(Number(ms));
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  A.dateValue = dateValue;
  A.timeValue = timeValue;

  async function ticketOptions(companyId) {
    if (companyId == null || companyId === "") return [];
    const list = await ERP.tickets.list({ companyId: companyId, open: true });
    return list.map((t) => ({ value: t.id, label: "#" + (t.number || t.id) + " · " + String(t.summary || "").slice(0, 44) }));
  }

  async function openApptModal(pid, appt, refresh, defaults) {
    if (!ERP.security.enforce("appointments.edit", { companyId: appt ? appt.companyId : null })) return;
    const [companies, members] = await Promise.all([ERP.companies.optionList(), ERP.members.members()]);
    const a = appt || A.newAppointment(Object.assign({ startMs: Date.now() + 3600000 }, defaults || {}));
    const companyId = a.companyId != null ? a.companyId : (defaults && defaults.companyId);
    const [sites, contacts, tickets] = companyId != null
      ? await Promise.all([ERP.companies.sites(companyId), ERP.companies.contacts(companyId), ticketOptions(companyId)])
      : [[], [], []];
    const duration = a.startMs && a.endMs ? Math.max(15, Math.round((a.endMs - a.startMs) / 60000)) : 60;

    const fields =
      ui.select("companyId", "Client", companies, companyId) +
      ui.select("ticketId", "Ticket", [{ value: "", label: "— no linked ticket —" }].concat(tickets), a.ticketId) +
      ui.text("title", "Title", a.title || "", "What the visit is for") +
      '<div class="erp-form-row">' +
        ui.select("memberId", "Technician", [{ value: "", label: "— unassigned —" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), a.memberId) +
        ui.select("type", "Type", A.TYPES.map((t) => ({ value: t.id, label: t.label })), a.type) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.field("Date", '<input type="date" name="date" value="' + ui.esc(dateValue(a.startMs)) + '">') +
        ui.field("Start", '<input type="time" name="start" value="' + ui.esc(timeValue(a.startMs)) + '">') +
        ui.number("durationMinutes", "Duration (min)", duration, { min: 15, step: 15 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("siteId", "Site", [{ value: "", label: "— none —" }].concat(sites.map((s) => ({ value: s.id, label: s.name }))), a.siteId) +
        ui.select("contactId", "Contact", [{ value: "", label: "— none —" }].concat(contacts.map((c) => ({ value: c.id, label: c.name }))), a.contactId) +
      "</div>" +
      ui.number("travelMinutes", "Travel allowance (min)", a.travelMinutes || 0, { min: 0, step: 15 }) +
      '<div class="erp-form-row">' +
        ui.select("status", "Status", A.STATUSES.map((s) => ({ value: s.id, label: s.label })), a.status) +
      "</div>" +
      ui.textarea("notes", "Dispatch notes", a.notes, 3);

    const modal = ui.modal({
      title: appt && appt.id != null ? "Edit appointment" : "New appointment",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "ap-cancel" }) + " " +
        (appt && appt.id != null ? ui.btn("Delete", { small: true, danger: true, act: "ap-del" }) + " " : "") +
        ui.btn(appt && appt.id != null ? "Save" : "Create", { small: true, primary: true, act: "ap-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const compSel = form.querySelector('[name="companyId"]');
    const repopulate = async (cid, keepTicket) => {
      const [s2, c2, t2] = await Promise.all([ERP.companies.sites(cid), ERP.companies.contacts(cid), ticketOptions(cid)]);
      const siteSel = form.querySelector('[name="siteId"]');
      const conSel = form.querySelector('[name="contactId"]');
      const tkSel = form.querySelector('[name="ticketId"]');
      siteSel.innerHTML = '<option value="">— none —</option>' + s2.map((s) => '<option value="' + ui.esc(s.id) + '">' + ui.esc(s.name) + "</option>").join("");
      conSel.innerHTML = '<option value="">— none —</option>' + c2.map((c) => '<option value="' + ui.esc(c.id) + '">' + ui.esc(c.name) + "</option>").join("");
      tkSel.innerHTML = '<option value="">— no linked ticket —</option>' + t2.map((t) => '<option value="' + ui.esc(t.value) + '"' + (keepTicket != null && String(t.value) === String(keepTicket) ? " selected" : "") + ">" + ui.esc(t.label) + "</option>").join("");
    };
    if (compSel) compSel.addEventListener("change", () => repopulate(compSel.value, null));
    modal.querySelector("[data-act=ap-cancel]").onclick = () => ui.closeModal();
    const delBtn = modal.querySelector("[data-act=ap-del]");
    if (delBtn) delBtn.onclick = async () => {
      if (!(await ui.confirm({ title: "Delete appointment?", message: "This removes the visit from the schedule. The ticket is left in place.", danger: true, okLabel: "Delete" }))) return;
      await A.remove(a.companyId, a.id);
      ui.closeModal(); ERP.toast("Appointment deleted.", "success"); refresh();
    };
    modal.querySelector("[data-act=ap-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["companyId", "ticketId", "title", "memberId", "type", "date", "start", "durationMinutes", "siteId", "contactId", "travelMinutes", "status", "notes"]);
      if (!v.companyId) { ERP.toast("Choose a client.", "error"); return; }
      if (!v.date || !v.start) { ERP.toast("Choose a date and a start time.", "error"); return; }
      const startMs = parseDateTime(v.date, v.start);
      if (!startMs) { ERP.toast("That date and time is not valid.", "error"); return; }
      btn.disabled = true;
      const res = await A.save(v.companyId, Object.assign({}, a, {
        companyId: v.companyId, ticketId: v.ticketId === "" ? null : v.ticketId,
        title: v.title, memberId: v.memberId === "" ? null : v.memberId, type: v.type,
        startMs: startMs, endMs: startMs + (Number(v.durationMinutes) || 60) * 60000,
        siteId: v.siteId === "" ? null : v.siteId, contactId: v.contactId === "" ? null : v.contactId,
        travelMinutes: Number(v.travelMinutes) || 0, status: v.status, notes: v.notes,
      }));
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(appt && appt.id != null ? "Appointment saved." : "Appointment scheduled.", "success"); refresh();
    };
  }

  async function openCompleteModal(companyId, id, refresh) {
    const a = await A.get(companyId, id);
    if (!a) { ERP.toast("Appointment not found.", "error"); return; }
    const modal = ui.modal({
      title: "Complete on-site visit",
      size: "lg",
      body: ui.form(
        ui.textarea("onSiteNotes", "On-site notes", a.onSiteNotes || "", 5) +
        ui.text("signOffName", "Signed off by (client)", a.signOff ? a.signOff.name : "") +
        ui.text("signOffNote", "Sign-off note", a.signOff ? a.signOff.note : "")
      ),
      foot: ui.btn("Cancel", { small: true, act: "ac-cancel" }) + " " + ui.btn("Complete visit", { small: true, primary: true, act: "ac-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=ac-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=ac-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["onSiteNotes", "signOffName", "signOffNote"]);
      btn.disabled = true;
      const res = await A.complete(companyId, id, v);
      if (res.error) { ERP.toast("Could not complete: " + res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Visit completed and notes logged to the ticket.", "success"); refresh();
    };
  }

  async function openCancelModal(companyId, id, refresh) {
    const modal = ui.modal({
      title: "Cancel appointment",
      body: ui.form(ui.text("reason", "Reason", "")),
      foot: ui.btn("Keep it", { small: true, act: "ax-cancel" }) + " " + ui.btn("Cancel appointment", { small: true, danger: true, act: "ax-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=ax-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=ax-save]").onclick = async () => {
      const v = ui.collect(form, ["reason"]);
      const res = await A.cancel(companyId, id, v.reason);
      if (res.error) { ERP.toast("Could not cancel: " + res.error, "error"); return; }
      ui.closeModal(); ERP.toast("Appointment cancelled.", "success"); refresh();
    };
  }

  A.renderInto = async function (panel, refresh) {
    if (!ERP.security.enforce("appointments.view")) { panel.innerHTML = ui.alert("Your role cannot view appointments.", "warn"); return; }
    const pid = await ten().providerId();
    if (pid == null) { panel.innerHTML = ui.alert("Create a service provider and a client company first.", "warn"); return; }

    const [all, members] = await Promise.all([A.list({}), ERP.members.members()]);
    const canEdit = ERP.security.can("appointments.edit");
    const nameOf = (id) => { const m = members.find((x) => String(x.id) === String(id)); return m ? m.name : "—"; };
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const openConflicts = {};
    if (ERP.scheduling) {
      for (const a of all) {
        if (!A.isOpen(a)) continue;
        try { openConflicts[a.companyId + "|" + a.id] = (await ERP.scheduling.conflicts(pid, a)).filter((c) => c.type !== "no_member"); } catch (e) {}
      }
    }

    const rows = all.filter((a) => a.status !== "cancelled").slice(0, 200).map((a) => {
      const conf = openConflicts[a.companyId + "|" + a.id] || [];
      return {
        when: "<b>" + ui.dateTime(a.startMs) + "</b>" + '<div class="erp-sub">' + ui.esc((a.travelMinutes || 0) + " min travel · " + Math.round((a.endMs - a.startMs) / 60000) + " min") + "</div>",
        client: ui.esc(a.__companyName || ""),
        ticket: a.ticketId != null ? "#" + ui.esc(a.ticketId) : "—",
        title: ui.esc(a.title || "—"),
        tech: ui.esc(nameOf(a.memberId)),
        type: ui.badge(A.typeLabel(a.type), a.type === "remote" ? "info" : "muted"),
        status: ui.badge(A.statusLabel(a.status), A.statusTone(a.status)) + (conf.length ? " " + ui.badge(conf.length + " conflict" + (conf.length > 1 ? "s" : ""), "danger") : ""),
        actions: canEdit ? (A.isOpen(a)
          ? ui.btn("Edit", { small: true, act: "ap-edit", arg: a.companyId + "|" + a.id }) + " " + ui.btn("Complete", { small: true, act: "ap-done", arg: a.companyId + "|" + a.id }) + " " + ui.btn("Cancel", { small: true, danger: true, act: "ap-cancel-appt", arg: a.companyId + "|" + a.id })
          : ui.btn("View", { small: true, act: "ap-edit", arg: a.companyId + "|" + a.id })) : "",
      };
    });

    const upcomingCount = all.filter((a) => A.isOpen(a) && Number(a.startMs) >= now).length;
    const todayCount = all.filter((a) => Number(a.startMs) >= todayStart.getTime() && Number(a.startMs) < todayStart.getTime() + 86400000).length;
    const completed = all.filter((a) => a.status === "completed").length;

    panel.innerHTML =
      ui.summary([
        { label: "Upcoming", value: String(upcomingCount) },
        { label: "Today", value: String(todayCount) },
        { label: "Completed", value: String(completed) },
        { label: "Total", value: String(all.length) },
      ]) +
      '<div class="erp-btn-row">' + (canEdit ? ui.btn("New appointment", { primary: true, act: "ap-new" }) : "") + "</div>" +
      ui.table([
        { key: "when", label: "When" },
        { key: "client", label: "Client" },
        { key: "ticket", label: "Ticket" },
        { key: "title", label: "Title" },
        { key: "tech", label: "Technician" },
        { key: "type", label: "Type" },
        { key: "status", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No appointments scheduled yet." });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ap-new") return openApptModal(pid, null, refresh);
      const parts = String(arg || "").split("|");
      const cid = parts[0], id = parts[1];
      if (act === "ap-edit") return openApptModal(pid, await A.get(cid, id), refresh);
      if (act === "ap-done") return openCompleteModal(cid, id, refresh);
      if (act === "ap-cancel-appt") return openCancelModal(cid, id, refresh);
    });
  };

  A.openApptModal = openApptModal;
  A.openCompleteModal = openCompleteModal;
})();
