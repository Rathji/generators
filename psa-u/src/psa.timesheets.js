/* ============================================================
   PSA-U — weekly timesheets & approval (Phase 4 · Task 20)
   A timesheet is a member's week of time presented for approval.
   The week runs Monday–Sunday in the member's local calendar
   (the same days the entry grid shows), and moves through a
   deliberate lifecycle:

     open       — derived on demand; the member's draft entries,
                  never stored until something happens.
     submitted  — the member submits; the entries freeze for review.
     approved   — a manager signs the week off; entries become
                  read-only and ready to bill.
     rejected   — a manager sends it back WITH a comment; entries
                  return to draft so they can be corrected and
                  resubmitted.
     locked     — an approved week is locked (e.g. invoiced); it can
                  no longer be edited or reopened.

   Approval is an enforced permission (`time.approve`), not a
   display choice: a technician can submit their own week but cannot
   approve anyone's. The week's totals are computed from the entries
   themselves so they always agree with the entry ledger, and include
   the billable value produced by each entry's resolved rate.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const TS = (ERP.timesheets = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("timesheets requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }

  TS.STATUSES = [
    { id: "open", label: "Open", tone: "muted" },
    { id: "submitted", label: "Submitted", tone: "info" },
    { id: "approved", label: "Approved", tone: "success" },
    { id: "rejected", label: "Rejected", tone: "danger" },
    { id: "locked", label: "Locked", tone: "muted" },
  ];
  TS.statusLabel = (id) => (TS.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  TS.statusTone = (id) => (TS.STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  TS.newSheet = (over) => Object.assign({
    kind: "timesheet", id: null, memberId: null,
    weekStart: "", weekEnd: "",
    status: "submitted",
    submittedAt: null, submittedBy: null,
    approvedAt: null, approvedBy: null,
    rejectedAt: null, rejectedBy: null, rejectionNote: "",
    lockedAt: null, lockedBy: null,
    entryIds: [], totals: null,
    createdAt: null, updatedAt: null,
  }, over || {});

  const week = () => ERP.time;

  TS.sheets = async function (pid) {
    const list = await ten().records("provider", pid, "timesheet");
    return list.slice().sort((a, b) => String(b.weekStart || "").localeCompare(String(a.weekStart || "")) || (Number(b.id) - Number(a.id)));
  };

  TS.sheet = async (pid, id) => (await TS.sheets(pid)).find((s) => String(s.id) === String(id)) || null;

  TS.find = async function (pid, memberId, weekStart) {
    return (await TS.sheets(pid)).find((s) => String(s.memberId) === String(memberId) && s.weekStart === weekStart) || null;
  };

  /* The entries a member put against a week, whatever their status. */
  TS.weekEntries = function (pid, memberId, weekStart) {
    return ERP.time.entries(pid, { memberId: memberId, weekStart: weekStart });
  };

  /* The full picture of a member-week: the persisted sheet (if any), the
     entries, and the computed totals. Always safe to call — an untouched week
     comes back as an "open" sheet with no record. */
  TS.build = async function (pid, memberId, weekStart) {
    const record = await TS.find(pid, memberId, weekStart);
    const entries = await TS.weekEntries(pid, memberId, weekStart);
    return {
      memberId: memberId, weekStart: weekStart, weekEnd: ERP.time.weekEnd(weekStart),
      record: record || null, id: record ? record.id : null,
      status: record ? record.status : "open",
      entries: entries,
      totals: ERP.time.totals(entries),
    };
  };

  /* ─────────────────────────── lifecycle ─────────────────────────── */

  async function entryIdsFor(pid, memberId, weekStart) {
    return (await TS.weekEntries(pid, memberId, weekStart)).map((e) => e.id);
  }

  async function setEntries(pid, ids, patch) {
    const all = await ten().records("provider", pid);
    const byId = {};
    all.forEach((r) => { if (r.kind === "timeEntry") byId[String(r.id)] = r; });
    let changed = 0;
    for (const id of ids) {
      const e = byId[String(id)];
      if (!e) continue;
      Object.assign(e, patch, { updatedAt: nowIso() });
      changed++;
    }
    if (changed) await ten().save("provider", pid, all);
    return changed;
  }

  async function put(pid, rec) {
    if (rec.id == null || !isFinite(rec.id)) rec.id = ten().nextId(await ten().records("provider", pid));
    return ten().upsert("provider", pid, rec);
  }

  TS.submit = async function (pid, memberId, weekStart) {
    if (memberId == null || memberId === "") return { error: "member_required" };
    if (!ERP.security.enforce("time.edit")) return { error: "forbidden" };
    const file = await TS.build(pid, memberId, weekStart);
    if (!file.entries.length) return { error: "empty", message: "There is no time to submit for that week." };
    const blocked = file.entries.filter((e) => ["locked", "approved", "submitted"].indexOf(String(e.status)) !== -1);
    if (blocked.length) return { error: "locked", message: "That week is already submitted or approved." };

    const now = nowIso();
    const rec = Object.assign(TS.newSheet(), file.record || {}, {
      memberId: memberId, weekStart: weekStart, weekEnd: ERP.time.weekEnd(weekStart),
      status: "submitted", submittedAt: now, submittedBy: actorName(),
      rejectionNote: "", updatedAt: now,
      createdAt: (file.record && file.record.createdAt) || now,
      entryIds: file.entries.map((e) => e.id),
      totals: file.totals,
    });
    await put(pid, rec);
    await setEntries(pid, rec.entryIds, { status: "submitted", timesheetId: rec.id });
    await emit(pid, "timesheet.submitted", rec);
    return { record: rec, entries: file.entries.length };
  };

  TS.approve = async function (pid, id) {
    if (!ERP.security.enforce("time.approve")) return { error: "forbidden" };
    const sheet = await TS.sheet(pid, id);
    if (!sheet) return { error: "not_found" };
    if (sheet.status !== "submitted") return { error: "not_submitted", message: "Only a submitted timesheet can be approved." };
    const now = nowIso();
    const rec = Object.assign({}, sheet, {
      status: "approved", approvedAt: now, approvedBy: actorName(),
      rejectedAt: null, rejectedBy: null, rejectionNote: "", updatedAt: now,
    });
    await put(pid, rec);
    await setEntries(pid, rec.entryIds, { status: "approved" });
    await emit(pid, "timesheet.approved", rec);
    return { record: rec };
  };

  TS.reject = async function (pid, id, comment) {
    if (!ERP.security.enforce("time.approve")) return { error: "forbidden" };
    const sheet = await TS.sheet(pid, id);
    if (!sheet) return { error: "not_found" };
    if (sheet.status === "locked") return { error: "locked" };
    const note = String(comment || "").trim();
    if (!note) return { error: "comment_required", message: "A rejection must say why." };
    const now = nowIso();
    const rec = Object.assign({}, sheet, {
      status: "rejected", rejectedAt: now, rejectedBy: actorName(), rejectionNote: note,
      approvedAt: null, approvedBy: null, updatedAt: now,
    });
    await put(pid, rec);
    /* Return the entries to draft so the member can correct and resubmit them. */
    await setEntries(pid, rec.entryIds, { status: "draft", timesheetId: null });
    await emit(pid, "timesheet.rejected", rec, { comment: note });
    return { record: rec };
  };

  TS.lock = async function (pid, id) {
    if (!ERP.security.enforce("time.approve")) return { error: "forbidden" };
    const sheet = await TS.sheet(pid, id);
    if (!sheet) return { error: "not_found" };
    if (sheet.status !== "approved") return { error: "not_approved", message: "Approve the timesheet before locking it." };
    const now = nowIso();
    const rec = Object.assign({}, sheet, { status: "locked", lockedAt: now, lockedBy: actorName(), updatedAt: now });
    await put(pid, rec);
    await setEntries(pid, rec.entryIds, { status: "locked" });
    return { record: rec };
  };

  TS.reopen = async function (pid, id) {
    if (!ERP.security.enforce("time.approve")) return { error: "forbidden" };
    const sheet = await TS.sheet(pid, id);
    if (!sheet) return { error: "not_found" };
    if (sheet.status === "locked") return { error: "locked", message: "A locked timesheet cannot be reopened." };
    await setEntries(pid, sheet.entryIds, { status: "draft", timesheetId: null });
    await ten().remove("provider", pid, (r) => r.kind === "timesheet" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* The manager's queue. */
  TS.pending = async function (pid) {
    return (await TS.sheets(pid)).filter((s) => s.status === "submitted");
  };

  /* Totals per member and per client across a set of sheets (default: anything
     submitted or approved, i.e. what is real enough to bill). */
  TS.rollup = async function (pid, opts) {
    opts = opts || {};
    const statuses = opts.statuses || ["submitted", "approved", "locked"];
    const sheets = (await TS.sheets(pid)).filter((s) => statuses.indexOf(s.status) !== -1);
    const ids = opts.sheetId != null ? [opts.sheetId] : sheets.map((s) => s.id);
    const idSet = new Set(ids.map(String));
    const entries = (await ten().records("provider", pid, "timeEntry")).filter((e) => e.timesheetId != null && idSet.has(String(e.timesheetId)));
    return { entries: entries, totals: ERP.time.totals(entries) };
  };

  async function emit(pid, event, sheet, extra) {
    if (!ERP.workflow) return;
    try {
      const [member, entries] = await Promise.all([
        sheet.memberId != null ? ERP.members.member(sheet.memberId) : null,
        ERP.time.entries(pid, { memberId: sheet.memberId, weekStart: sheet.weekStart }),
      ]);
      await ERP.workflow.emit(event, Object.assign({
        event: event, timesheet: sheet, member: member, entries: entries,
        time: { memberId: sheet.memberId, minutes: sheet.totals ? sheet.totals.minutes : 0 }, actor: actor(),
      }, extra || {}));
    } catch (e) {}
  }

  /* ─────────────────────────── approval UI ─────────────────────────── */

  function blankState() { return { memberId: "", weekStart: ERP.time.weekStart(ui.today()), showAll: false }; }

  async function openRejectModal(pid, sheet, refresh) {
    const modal = ui.modal({
      title: "Reject timesheet",
      body: ui.form(ui.textarea("comment", "Reason (sent to the member)", "", 4)),
      foot: ui.btn("Keep it", { small: true, act: "tsr-cancel" }) + " " + ui.btn("Reject with comment", { small: true, danger: true, act: "tsr-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=tsr-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tsr-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["comment"]);
      btn.disabled = true;
      const res = await TS.reject(pid, sheet.id, v.comment);
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Timesheet returned to the member.", "success"); refresh();
    };
  }

  TS.renderInto = async function (panel, pid, refresh, host) {
    if (!ERP.security.enforce("time.view")) { panel.innerHTML = ui.alert("Your role cannot view timesheets.", "warn"); return; }
    const state = (host.__ts = host.__ts || blankState());
    const canApprove = ERP.security.can("time.approve");
    const members = await ERP.members.members();
    if (!state.memberId) state.memberId = actor().memberId || (members[0] ? members[0].id : "");
    const names = Object.fromEntries(members.map((m) => [String(m.id), m.name]));
    const nameOf = (id) => names[String(id)] || (id != null ? "#" + id : "—");
    const masked = (v) => (ERP.security.canSeeFinancials() ? ui.money(v) : "•••");

    const file = await TS.build(pid, state.memberId, state.weekStart);
    const pending = canApprove ? await TS.pending(pid) : [];
    const submittedByOthers = canApprove ? (await TS.sheets(pid)).filter((s) => s.status === "submitted" || s.status === "approved").slice(0, 12) : [];

    const statusBadge = ui.badge(TS.statusLabel(file.status), TS.statusTone(file.status));
    const actions = [];
    if (file.status === "open" || file.status === "rejected") actions.push(ui.btn("Submit for approval", { primary: true, act: "ts-submit" }));
    if (canApprove && file.status === "submitted") actions.push(ui.btn("Approve", { primary: true, act: "ts-approve" }) + " " + ui.btn("Reject", { danger: true, act: "ts-reject" }));
    if (canApprove && (file.status === "approved")) actions.push(ui.btn("Lock week", { act: "ts-lock" }));
    if (canApprove && (file.status === "submitted" || file.status === "rejected")) actions.push(ui.btn("Reopen", { small: true, act: "ts-reopen" }));

    const dayRows = ERP.time.weekDays(file.weekStart).map((day) => {
      const list = file.entries.filter((e) => e.date === day);
      const mins = list.reduce((n, e) => n + (Number(e.minutes) || 0), 0);
      return {
        day: "<b>" + ui.esc(ERP.time.dayLabel(day)) + "</b>",
        entries: list.length ? list.map((e) => {
          const bits = [e.companyId != null ? "client #" + e.companyId : "internal"];
          if (e.ticketId != null) bits.push("ticket #" + e.ticketId);
          bits.push(e.workType || "no work type");
          return '<div class="erp-ts-entry"><span>' + ui.esc(bits.join(" · ")) + "</span>" +
            (e.writtenOff ? ui.badge("Written off", "warn") : e.billable ? ui.badge("Billable", "success") : ui.badge("Non-billable", "muted")) +
            (canApprove && !e.writtenOff && e.status !== "locked" ? " " + ui.btn("Write off", { small: true, act: "ts-wo", arg: e.id }) : "") +
            "</div>";
        }).join("") : '<span class="erp-sub">No time</span>',
        mins: mins ? ui.esc(ERP.time.minutesLabel(mins)) : "—",
      };
    });

    const queueRows = submittedByOthers.map((s) => ({
      member: ui.esc(nameOf(s.memberId)),
      week: ui.esc(ERP.time.weekLabel(s.weekStart)),
      status: ui.badge(TS.statusLabel(s.status), TS.statusTone(s.status)),
      minutes: ui.esc(ERP.time.minutesLabel(s.totals && s.totals.minutes)),
      value: masked(s.totals ? s.totals.amount : 0),
      actions: s.status === "submitted" && canApprove
        ? ui.btn("Approve", { small: true, primary: true, act: "ts-row-approve", arg: s.id }) + " " + ui.btn("Reject", { small: true, danger: true, act: "ts-row-reject", arg: s.id })
        : "",
    }));

    const byMember = ERP.time.totals(file.entries).byMember;
    const memberTotals = Object.keys(byMember).map((k) => ({
      label: nameOf(k),
      minutes: ERP.time.minutesLabel(byMember[k].minutes),
      billable: ERP.time.minutesLabel(byMember[k].billableMinutes),
      amount: masked(byMember[k].amount),
    }));

    panel.innerHTML =
      ui.summary([
        { label: "Status", value: statusBadge },
        { label: "Week", value: ui.esc(ERP.time.weekLabel(file.weekStart)) },
        { label: "Logged", value: ui.esc(ERP.time.minutesLabel(file.totals.minutes)) },
        { label: "Billable value", value: masked(file.totals.amount) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("ts-member", "Member", members.map((m) => ({ value: m.id, label: m.name })), state.memberId) +
        ui.btn("‹ Prev", { small: true, act: "ts-prev" }) +
        '<span class="erp-db-daylabel">' + ui.esc(ERP.time.weekLabel(state.weekStart)) + "</span>" +
        ui.btn("Next ›", { small: true, act: "ts-next" }) +
        ui.btn("This week", { small: true, act: "ts-today" }) +
      "</div>" +
      ui.card("This week", '<div class="erp-btn-row">' + actions.join(" ") + "</div>" +
        (file.record && file.record.rejectionNote ? '<div class="erp-alert tone-warn">Rejected by ' + ui.esc(file.record.rejectedBy || "a manager") + ": " + ui.esc(file.record.rejectionNote) + "</div>" : "") +
        ui.table([
          { key: "day", label: "Day", width: "120px" },
          { key: "entries", label: "Entries" },
          { key: "mins", label: "Time", align: "right", width: "90px" },
        ], dayRows, { emptyText: "No time logged this week." })) +
      (canApprove
        ? ui.card("Approval queue", pending.length
          ? ui.table([
              { key: "member", label: "Member" },
              { key: "week", label: "Week" },
              { key: "status", label: "Status" },
              { key: "minutes", label: "Time", align: "right" },
              { key: "value", label: "Value", align: "right" },
              { key: "actions", label: "", align: "right" },
            ], queueRows.concat(submittedByOthers.filter((s) => s.status === "approved").map((s) => ({
              member: ui.esc(nameOf(s.memberId)), week: ui.esc(ERP.time.weekLabel(s.weekStart)),
              status: ui.badge(TS.statusLabel(s.status), TS.statusTone(s.status)),
              minutes: ui.esc(ERP.time.minutesLabel(s.totals && s.totals.minutes)),
              value: masked(s.totals ? s.totals.amount : 0), actions: "",
            }))), { emptyText: "Nothing awaiting approval." })
          : ui.alert("No timesheets are waiting for approval.", "info")) +
        ui.card("Totals by member (this week)", ui.table([
          { key: "label", label: "Member" },
          { key: "minutes", label: "Logged", align: "right" },
          { key: "billable", label: "Billable", align: "right" },
          { key: "amount", label: "Value", align: "right" },
        ], memberTotals, { emptyText: "No time logged this week." })) : "") +
      '<div class="erp-sub">Weeks run Monday to Sunday. Submitting freezes the entries for review; a manager can approve, reject with a comment, or lock an approved week.</div>';

    const memberSel = panel.querySelector('[name="ts-member"]');
    if (memberSel) memberSel.addEventListener("change", () => { state.memberId = memberSel.value; refresh(); });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ts-prev") { state.weekStart = ui.addDays(state.weekStart, -7); return refresh(); }
      if (act === "ts-next") { state.weekStart = ui.addDays(state.weekStart, 7); return refresh(); }
      if (act === "ts-today") { state.weekStart = ERP.time.weekStart(ui.today()); return refresh(); }
      if (act === "ts-submit") {
        const res = await TS.submit(pid, state.memberId, state.weekStart);
        if (res.error) { ERP.toast(res.message || ("Could not submit: " + res.error), "error"); return; }
        ERP.toast("Timesheet submitted for approval.", "success");
        return refresh();
      }
      if (act === "ts-approve") {
        const res = await TS.approve(pid, file.id);
        if (res.error) { ERP.toast(res.message || res.error, "error"); return; }
        ERP.toast("Timesheet approved.", "success");
        return refresh();
      }
      if (act === "ts-reject") return openRejectModal(pid, file.record, refresh);
      if (act === "ts-lock") {
        const res = await TS.lock(pid, file.id);
        if (res.error) { ERP.toast(res.message || res.error, "error"); return; }
        ERP.toast("Week locked.", "success");
        return refresh();
      }
      if (act === "ts-reopen") {
        if (!(await ui.confirm({ title: "Reopen this week?", message: "The timesheet is removed and its entries return to draft.", okLabel: "Reopen" }))) return;
        const res = await TS.reopen(pid, file.id);
        if (res.error) { ERP.toast(res.message || res.error, "error"); return; }
        ERP.toast("Week reopened.", "success");
        return refresh();
      }
      if (act === "ts-row-approve") {
        const res = await TS.approve(pid, arg);
        if (res.error) { ERP.toast(res.message || res.error, "error"); return; }
        ERP.toast("Timesheet approved.", "success");
        return refresh();
      }
      if (act === "ts-row-reject") return openRejectModal(pid, await TS.sheet(pid, arg), refresh);
      if (act === "ts-wo") {
        const res = await ERP.time.writeOff(pid, arg, "Written off from timesheet");
        if (res.error) { ERP.toast(res.error, "error"); return; }
        ERP.toast("Entry written off.", "success");
        return refresh();
      }
    });
  };

  TS.ensureSeed = async function () { return { skipped: "nothing_to_seed" }; };
})();
