/* ============================================================
   PSA-U — SLAs & business-hours calendars (Phase 2 · Task 10)
   Service-level agreements sit on top of two things:

     • business-hours calendars — opening hours per weekday, a
       list of holidays and a UTC offset. The calendar turns a
       "minutes of effort" target into a real wall-clock due date,
       so a 4-hour response target raised at 16:00 on a Friday
       lands mid-morning on Monday, not at 20:00 on Friday.
     • SLA policies — separate response and resolution targets,
       matched per board + priority (a `*` matches anything), with
       pause/stop-clock rules (waiting on the client, scheduled
       maintenance), an at-risk threshold, and a configurable
       breach escalation.

   A ticket's live SLA state (met / ok / at-risk / breached, and
   the paused time) is computed here and used by the service desk,
   the workflow engine and the notification engine.

   Policy and state edits are provider-document records, so they
   sync, back up and version with the rest of the tenant data.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const S = (ERP.sla = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("sla requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  const num = (v) => (isFinite(v) ? Number(v) : null);

  /* ─────────────────────────── business-hours maths ─────────────────────────── */

  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DAY_LABELS = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  S.DAY_KEYS = DAY_KEYS;
  S.DAY_LABELS = DAY_LABELS;

  function offset(cal) { return Number(cal && cal.offsetMinutes) || 0; }
  function toLocal(ms, cal) { return ms + offset(cal) * 60000; }
  function fromLocal(ms, cal) { return ms - offset(cal) * 60000; }

  function parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function fmtHM(min) {
    const m = ((min % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }
  S.parseHM = parseHM;
  S.fmtHM = fmtHM;

  function dateStrOfLocal(localMs) {
    const d = new Date(localMs);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function midnightOfLocal(localMs) {
    const d = new Date(localMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function dayKeyOfDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00Z");
    return DAY_KEYS[d.getUTCDay()];
  }

  S.isHoliday = function (cal, dateStr) {
    return ((cal && cal.holidays) || []).some((h) => String(h && h.date != null ? h.date : h) === dateStr);
  };

  /* Normalised open windows (minutes-from-midnight) for a calendar on a date. */
  function windowsFor(cal, dateStr) {
    if (!cal || S.isHoliday(cal, dateStr)) return [];
    const key = dayKeyOfDate(dateStr);
    const raw = (cal.hours && cal.hours[key]) || [];
    const out = [];
    raw.forEach((w) => {
      const a = parseHM(w && w.from), b = parseHM(w && w.to);
      if (a == null || b == null || b <= a) return;
      out.push([a, b]);
    });
    out.sort((x, y) => x[0] - y[0]);
    return out;
  }
  S.windowsFor = windowsFor;

  function hasAnyWindow(cal) {
    return DAY_KEYS.some((k) => ((cal && cal.hours && cal.hours[k]) || []).some((w) => {
      const a = parseHM(w && w.from), b = parseHM(w && w.to);
      return a != null && b != null && b > a;
    }));
  }
  S.hasAnyWindow = hasAnyWindow;

  /* Business minutes that elapse between two instants under a calendar. */
  S.businessMinutesBetween = function (cal, aMs, bMs) {
    if (!(bMs > aMs)) return 0;
    const aL = toLocal(aMs, cal), bL = toLocal(bMs, cal);
    let total = 0;
    let day = midnightOfLocal(aL);
    let guard = 0;
    while (day <= bL && guard++ < 1200) {
      const wins = windowsFor(cal, dateStrOfLocal(day));
      if (wins.length) {
        const s = Math.max(aL, day), e = Math.min(bL, day + 86400000);
        if (e > s) {
          for (const w of wins) {
            const os = Math.max(s, day + w[0] * 60000);
            const oe = Math.min(e, day + w[1] * 60000);
            if (oe > os) total += (oe - os) / 60000;
          }
        }
      }
      day += 86400000;
    }
    return Math.round(total);
  };

  /* Advance an instant by N business minutes under a calendar. Falls back to
     continuous (24/7) time when the calendar has no open window at all, so a
     due date can always be produced. */
  S.addBusinessMinutes = function (cal, startMs, minutes) {
    const mins = Number(minutes) || 0;
    if (mins <= 0) return startMs;
    if (!hasAnyWindow(cal)) return startMs + mins * 60000;
    let remaining = mins;
    let curL = toLocal(startMs, cal);
    let day = midnightOfLocal(curL);
    let guard = 0;
    while (guard++ < 2200) {
      const wins = windowsFor(cal, dateStrOfLocal(day));
      for (const w of wins) {
        const ws = day + w[0] * 60000, we = day + w[1] * 60000;
        if (we <= curL) continue;
        const from = Math.max(curL, ws);
        const avail = (we - from) / 60000;
        if (avail >= remaining) return fromLocal(from + remaining * 60000, cal);
        remaining -= avail;
        curL = we;
      }
      day += 86400000;
      if (curL < day) curL = day;
    }
    return startMs + mins * 60000;
  };

  /* A nearest default calendar (the provider's default, else the first). */
  S.calendar = async function (calendarId) {
    if (calendarId != null && calendarId !== "" && ERP.members) {
      const c = await ERP.members.calendar(calendarId);
      if (c) return c;
    }
    if (ERP.members) {
      const c = await ERP.members.defaultCalendar();
      if (c) return c;
    }
    return { id: null, name: "Continuous (24/7)", offsetMinutes: 0, hours: {} };
  };
  S.calendarName = async function (calendarId) {
    const c = await S.calendar(calendarId);
    return c ? c.name : "—";
  };

  /* ─────────────────────────── policies ─────────────────────────── */

  S.newPolicy = function (over) {
    return Object.assign({
      kind: "slaPolicy",
      name: "",
      board: "*",
      priority: "*",
      responseMinutes: 60,
      resolutionMinutes: 480,
      calendarId: null,
      pauseOnCustomerWaiting: true,
      pauseOnScheduled: false,
      atRiskPercent: 25,
      atRiskMinutes: 60,
      escalation: { enabled: false, assignTo: null, note: "", notify: true },
      active: true,
      order: 100,
    }, over || {});
  };

  S.policies = async function (pid) {
    const list = await ten().records("provider", pid, "slaPolicy");
    return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  };
  S.policy = async function (pid, id) {
    return (await S.policies(pid)).find((p) => String(p.id) === String(id)) || null;
  };

  async function nextId(pid) {
    const all = await ten().records("provider", pid);
    return ten().nextId(all);
  }

  S.savePolicy = async function (pid, rec) {
    const incoming = S.newPolicy(rec);
    if (!incoming.name) return { error: "name_required" };
    if (!isFinite(incoming.id)) incoming.id = await nextId(pid);
    return ten().upsert("provider", pid, incoming);
  };
  S.removePolicy = async function (pid, id) {
    return ten().remove("provider", pid, (r) => r.kind === "slaPolicy" && String(r.id) === String(id));
  };

  /* Most specific policy wins: board+priority > board > priority > any. Ties
     break on the lower `order`. */
  S.match = function (policies, ctx) {
    ctx = ctx || {};
    const board = ctx.board == null ? "" : String(ctx.board);
    const priority = ctx.priority == null ? "" : String(ctx.priority);
    const candidates = (policies || []).filter((p) => p.active !== false &&
      (p.board === "*" || String(p.board) === board) &&
      (p.priority === "*" || String(p.priority) === priority));
    if (!candidates.length) return null;
    const score = (p) => (String(p.board) === board ? 2 : 0) + (String(p.priority) === priority ? 1 : 0);
    candidates.sort((a, b) => score(b) - score(a) || (a.order || 0) - (b.order || 0));
    return candidates[0];
  };

  S.matchForTicket = async function (pid, ticket) {
    const policies = await S.policies(pid);
    return { policies, policy: S.match(policies, ticket) };
  };

  /* ─────────────────────────── applying & state ─────────────────────────── */

  /* Stamp a fresh SLA onto a ticket from a policy + its business calendar. */
  S.apply = async function (ticket, policy, startMs) {
    if (!policy) return ticket;
    const cal = await S.calendar(policy.calendarId);
    const resp = Number(policy.responseMinutes) > 0 ? S.addBusinessMinutes(cal, startMs, policy.responseMinutes) : null;
    const reso = Number(policy.resolutionMinutes) > 0 ? S.addBusinessMinutes(cal, startMs, policy.resolutionMinutes) : null;
    ticket.sla = {
      policyId: policy.id,
      policyName: policy.name,
      responseDueMs: resp,
      resolutionDueMs: reso,
      startedAtMs: startMs,
      responseMet: null,
      resolutionMet: null,
      paused: false,
      pausedAt: null,
      pausedMs: 0,
      atRiskPercent: Number(policy.atRiskPercent) || 0,
      atRiskMinutes: Number(policy.atRiskMinutes) || 0,
      breachedAt: null,
      atRiskNotifiedAt: null,
      escalatedAt: null,
    };
    return ticket;
  };

  const OPEN_STATUS_HINTS = { "new": true };

  /* Recompute pause/stop-clock transitions and met milestones as a ticket
     changes. Called on every ticket save; pure apart from the ticket object. */
  S.sync = async function (ticket, pid, nowMs) {
    const at = nowMs || Date.now();
    if (!ticket) return ticket;
    let { policies, policy } = ticket.sla && ticket.sla.policyId != null
      ? { policies: await S.policies(pid), policy: null }
      : await S.matchForTicket(pid, ticket);
    if (ticket.sla && ticket.sla.policyId != null) {
      policy = (policies || []).find((p) => String(p.id) === String(ticket.sla.policyId)) || null;
    }
    if (!ticket.sla || ticket.sla.policyId == null) {
      if (!policy) return ticket;
      await S.apply(ticket, policy, Date.parse(ticket.createdAt) || at);
    }
    const sla = ticket.sla;
    if (sla.responseMet == null && ticket.status && ticket.status !== "new") sla.responseMet = at;
    const statuses = await ten().records("provider", pid, "taxonomy");
    const closed = statuses.some((s) => s.category === "ticketStatus" && String(s.code) === String(ticket.status) && s.closed === true);
    if (closed && sla.resolutionMet == null) sla.resolutionMet = at;
    let shouldPause = false;
    if (policy && !closed) {
      shouldPause = (ticket.status === "waiting-customer" && policy.pauseOnCustomerWaiting) ||
        (ticket.status === "scheduled" && policy.pauseOnScheduled);
    }
    if (shouldPause && !sla.paused) { sla.paused = true; sla.pausedAt = at; }
    else if (!shouldPause && sla.paused) {
      sla.pausedMs = (Number(sla.pausedMs) || 0) + (at - (sla.pausedAt || at));
      sla.pausedAt = null;
      sla.paused = false;
    }
    return ticket;
  };

  /* The live SLA state of a ticket: which target is running, its effective
     due instant (paused time added back on), remaining time and flags. */
  S.state = function (ticket, nowMs) {
    const at = nowMs || Date.now();
    const sla = ticket && ticket.sla;
    if (!sla || (sla.responseDueMs == null && sla.resolutionDueMs == null)) {
      return { applies: false, breached: false, atRisk: false, paused: false, met: false, target: null, remainingMs: null };
    }
    const extra = sla.paused
      ? (Number(sla.pausedMs) || 0) + (at - (Number(sla.pausedAt) || at))
      : (Number(sla.pausedMs) || 0);
    let target = "resolution";
    let dueRaw = sla.resolutionDueMs;
    if (sla.responseDueMs != null && sla.responseMet == null) {
      target = "response";
      dueRaw = sla.responseDueMs;
    } else if (sla.resolutionDueMs != null && sla.resolutionMet == null) {
      target = "resolution";
      dueRaw = sla.resolutionDueMs;
    } else {
      return { applies: true, met: true, target: null, breached: false, atRisk: false, paused: !!sla.paused, remainingMs: null, dueMs: null };
    }
    if (dueRaw == null) return { applies: true, met: true, target: null, breached: false, atRisk: false, paused: !!sla.paused, remainingMs: null, dueMs: null };
    const dueMs = dueRaw + extra;
    const remainingMs = dueMs - at;
    const breached = remainingMs < 0;
    const startMs = Number(sla.startedAtMs) || Date.parse(ticket.createdAt) || at;
    const targetMs = Math.max(dueRaw - startMs, 1);
    const pctMs = Number(sla.atRiskPercent) > 0 ? targetMs * Number(sla.atRiskPercent) / 100 : Infinity;
    const minMs = Number(sla.atRiskMinutes) > 0 ? Number(sla.atRiskMinutes) * 60000 : Infinity;
    let threshold = Math.min(pctMs, minMs);
    if (!isFinite(threshold)) threshold = 0;
    return {
      applies: true,
      met: false,
      target: target,
      dueMs: dueMs,
      dueRawMs: dueRaw,
      remainingMs: remainingMs,
      breached: breached,
      atRisk: !breached && remainingMs <= threshold,
      paused: !!sla.paused,
      pausedMs: extra,
    };
  };

  S.stateLabel = function (state) {
    if (!state || !state.applies) return "No SLA";
    if (state.met) return "Met";
    if (state.paused && !state.breached) return "Paused";
    if (state.breached) return "Breached";
    if (state.atRisk) return "At risk";
    return "On track";
  };

  /* Colour tone for a state chip. */
  S.stateTone = function (state, ticket) {
    if (!state || !state.applies) return "muted";
    if (state.met) return "success";
    if (state.breached) return "danger";
    if (ticket && ticket.sla && ticket.sla.breachedAt) return "danger";
    if (state.atRisk) return "warn";
    if (state.paused) return "info";
    return "success";
  };

  /* ─────────────────────────── breach processing ─────────────────────────── */

  /* Resolve the effective policy for a ticket, sync pause/met state, and —
     when a target has just been missed — stamp the breach, run the policy's
     escalation and emit the breach event exactly once. Persists the ticket. */
  S.process = async function (companyId, ticketOrId, opts) {
    opts = opts || {};
    const at = opts.now || Date.now();
    let ticket = ticketOrId && typeof ticketOrId === "object" ? ticketOrId : await ERP.tickets.get(companyId, ticketOrId);
    if (!ticket) return null;
    const pid = await ten().providerId();
    const policies = await S.policies(pid);
    const policy = (ticket.sla && ticket.sla.policyId != null)
      ? policies.find((p) => String(p.id) === String(ticket.sla.policyId)) || null
      : S.match(policies, ticket);
    await S.sync(ticket, pid, at);
    const state = S.state(ticket, at);
    if (!state.applies || state.met) return { ticket: ticket, state: state };

    let dirty = false, newlyBreached = false, newlyAtRisk = false;
    if (state.breached && !ticket.sla.breachedAt) {
      ticket.sla.breachedAt = at;
      newlyBreached = true;
      dirty = true;
    }
    if (newlyBreached && policy && policy.escalation && policy.escalation.enabled) {
      if (policy.escalation.assignTo != null && String(policy.escalation.assignTo) !== String(ticket.ownerId)) {
        ticket.ownerId = policy.escalation.assignTo;
      }
      ticket.sla.escalatedAt = at;
      dirty = true;
    }
    if (!newlyBreached && state.atRisk && !ticket.sla.atRiskNotifiedAt) {
      ticket.sla.atRiskNotifiedAt = at;
      newlyAtRisk = true;
      dirty = true;
    }
    if (dirty && ERP.tickets && opts.persist !== false) {
      await ERP.tickets.save(companyId, ticket, { silent: true, system: true });
    }
    if ((newlyBreached || newlyAtRisk) && opts.emit !== false) {
      const event = newlyBreached ? "ticket.breached" : "ticket.at_risk";
      const company = (ERP.companies && companyId != null) ? await ERP.companies.get(companyId) : null;
      const ctx = { event: event, ticket: ticket, company: company, changes: {}, sla: state, actor: opts.actor || null };
      if (ERP.workflow) { try { await ERP.workflow.emit(event, ctx); } catch (e) {} }
      else if (ERP.notify) { try { await ERP.notify.emit(event, ctx); } catch (e) {} }
      if (newlyBreached && policy && policy.escalation && policy.escalation.enabled && policy.escalation.note && ERP.tickets) {
        try { await ERP.tickets.addNote(companyId, ticket.id, { body: policy.escalation.note, internal: true, author: "SLA escalation" }); } catch (e) {}
      }
    }
    return { ticket: ticket, state: state, newlyBreached: newlyBreached, newlyAtRisk: newlyAtRisk };
  };

  /* Sweep every open ticket (optionally one company) and return the ones that
     are breached / at risk, processing transitions as it goes. */
  S.sweep = async function (opts) {
    opts = opts || {};
    const at = opts.now || Date.now();
    const tickets = await ERP.tickets.listAll({ open: true, companyId: opts.companyId });
    const out = [];
    for (const t of tickets) {
      const r = await S.process(t.companyId, t, { now: at, persist: opts.persist !== false, emit: opts.emit !== false });
      if (r && r.state && r.state.applies && !r.state.met) {
        out.push({ ticket: r.ticket, state: r.state, newlyBreached: !!r.newlyBreached, newlyAtRisk: !!r.newlyAtRisk });
      }
    }
    out.sort((a, b) => (b.state.breached - a.state.breached) || (a.state.remainingMs - b.state.remainingMs));
    return out;
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  S.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const existing = await S.policies(pid);
    if (existing.length) return { skipped: "already_seeded" };
    const cal = await S.calendar(null);
    await S.savePolicy(pid, S.newPolicy({
      name: "Standard support",
      board: "*", priority: "*",
      responseMinutes: 120, resolutionMinutes: 480,
      calendarId: cal ? cal.id : null,
      pauseOnCustomerWaiting: true, pauseOnScheduled: false,
      atRiskPercent: 25, atRiskMinutes: 60,
      escalation: { enabled: true, assignTo: null, note: "SLA breached — escalated to the service manager for review.", notify: true },
      order: 100,
    }));
    await S.savePolicy(pid, S.newPolicy({
      name: "Critical incident",
      board: "*", priority: "p1",
      responseMinutes: 30, resolutionMinutes: 240,
      calendarId: cal ? cal.id : null,
      pauseOnCustomerWaiting: false, pauseOnScheduled: false,
      atRiskPercent: 30, atRiskMinutes: 30,
      escalation: { enabled: true, assignTo: null, note: "P1 SLA breached — immediate management escalation.", notify: true },
      order: 10,
    }));
    return { seeded: true };
  };

  /* ─────────────────────────── configuration UI (Task 10) ─────────────────────────── */

  function snapMembers(list) { return (list || []).map((m) => ({ value: m.id, label: m.name })); }

  async function openPolicyModal(pid, policy, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("sla.edit")) return;
    const [boards, priorities, calendars, members] = await Promise.all([
      ERP.taxonomy.optionList(pid, "board"),
      ERP.taxonomy.optionList(pid, "priority"),
      ERP.members.calendars(),
      ERP.members.members(),
    ]);
    const p = policy || S.newPolicy();
    const esc = p.escalation || { enabled: false, assignTo: null, note: "", notify: true };
    const fields =
      ui.text("name", "Policy name", p.name) +
      '<div class="erp-form-row">' +
        ui.select("board", "Board", [{ value: "*", label: "Any board" }].concat(boards), p.board) +
        ui.select("priority", "Priority", [{ value: "*", label: "Any priority" }].concat(priorities), p.priority) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("responseMinutes", "Response target (business minutes)", p.responseMinutes, { min: 0 }) +
        ui.number("resolutionMinutes", "Resolution target (business minutes)", p.resolutionMinutes, { min: 0 }) +
      "</div>" +
      ui.select("calendarId", "Business-hours calendar", calendars.map((c) => ({ value: c.id, label: c.name + (c.timezone ? " · " + c.timezone : "") })), p.calendarId) +
      '<div class="erp-form-row">' +
        ui.check("pauseOnCustomerWaiting", "Pause while waiting on the client", p.pauseOnCustomerWaiting) +
        ui.check("pauseOnScheduled", "Pause while scheduled", p.pauseOnScheduled) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("atRiskPercent", "At-risk at % of target", p.atRiskPercent, { min: 0, max: 100 }) +
        ui.number("atRiskMinutes", "At-risk minutes before due", p.atRiskMinutes, { min: 0 }) +
      "</div>" +
      ui.check("escEnabled", "Escalate on breach", esc.enabled) +
      '<div class="erp-form-row">' +
        ui.select("escAssignTo", "Reassign to", [{ value: "", label: "— leave owner —" }].concat(snapMembers(members)), esc.assignTo) +
      "</div>" +
      ui.check("escNotify", "Notify on breach", esc.notify !== false) +
      ui.textarea("escNote", "Escalation note", esc.note, 2) +
      ui.number("order", "Match order", p.order == null ? 100 : p.order) +
      ui.check("active", "Active", p.active !== false);
    const modal = ui.modal({
      title: policy ? "Edit SLA policy" : "New SLA policy",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "sla-cancel" }) + " " + ui.btn(policy ? "Save policy" : "Create policy", { small: true, primary: true, act: "sla-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=sla-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=sla-save]").onclick = async (t) => {
      const names = ["name", "board", "priority", "responseMinutes", "resolutionMinutes", "calendarId", "pauseOnCustomerWaiting", "pauseOnScheduled", "atRiskPercent", "atRiskMinutes", "escEnabled", "escAssignTo", "escNotify", "escNote", "order", "active"];
      const v = ui.collect(form, names);
      if (!v.name) { ERP.toast("A policy name is required.", "error"); return; }
      t.disabled = true;
      const rec = Object.assign({}, p, v, {
        kind: "slaPolicy",
        calendarId: v.calendarId === "" ? null : v.calendarId,
        escalation: {
          enabled: !!v.escEnabled,
          assignTo: v.escAssignTo === "" ? null : v.escAssignTo,
          note: v.escNote || "",
          notify: !!v.escNotify,
        },
      });
      delete rec.escEnabled; delete rec.escAssignTo; delete rec.escNotify; delete rec.escNote;
      const res = await S.savePolicy(pid, rec);
      ui.closeModal();
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      ERP.toast(policy ? "SLA policy updated." : "SLA policy created.", "success");
      refresh();
    };
  }

  async function openClockModal(pid, refresh) {
    const ui = ERP.ui;
    const calendars = await ERP.members.calendars();
    const cal = calendars.find((c) => c.isDefault) || calendars[0];
    const fields =
      ui.select("calendarId", "Calendar", calendars.map((c) => ({ value: c.id, label: c.name })), cal ? cal.id : "") +
      ui.field("Start", '<input type="datetime-local" name="start" value="' + ui.esc(ui.today() + "T16:00") + '">') +
      ui.number("minutes", "Business minutes", 240, { min: 0 });
    const modal = ui.modal({
      title: "SLA clock preview",
      body: ui.form(fields) + '<div data-clock-out class="erp-alert tone-info">Choose a calendar, a start time and a number of business minutes.</div>',
      foot: ui.btn("Close", { small: true, act: "clock-close" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const out = modal.querySelector("[data-clock-out]");
    const calc = async () => {
      const v = ui.collect(form, ["calendarId", "start", "minutes"]);
      const c = await ERP.members.calendar(v.calendarId);
      const startMs = Date.parse(v.start || "");
      if (isNaN(startMs)) { out.textContent = "Enter a valid start time."; return; }
      const due = S.addBusinessMinutes(c, startMs, Number(v.minutes) || 0);
      out.innerHTML = "<b>Due:</b> " + ui.dateTime(new Date(due).toISOString()) +
        " <span class=\"erp-sub\">(" + ERP.ui.esc(c.name || "calendar") + ", starts " + ui.dateTime(new Date(startMs).toISOString()) + ")</span>";
    };
    form.addEventListener("change", calc);
    calc();
    modal.querySelector("[data-act=clock-close]").onclick = () => ui.closeModal();
  }

  async function renderPolicies(panel, refresh) {
    const ui = ERP.ui;
    const pid = await ten().providerId();
    const policies = await S.policies(pid);
    const canEdit = ERP.security.can("sla.edit");
    const rows = policies.map((p) => ({
      name: "<b>" + ui.esc(p.name) + "</b>" + (p.active === false ? " " + ui.badge("inactive", "muted") : ""),
      applies: ui.esc((p.board === "*" ? "Any board" : p.board) + " · " + (p.priority === "*" ? "Any priority" : p.priority)),
      resp: (Number(p.responseMinutes) ? ui.fmt(p.responseMinutes, 0) + " min" : "—"),
      reso: (Number(p.resolutionMinutes) ? ui.fmt(p.resolutionMinutes, 0) + " min" : "—"),
      pauses: ui.esc([p.pauseOnCustomerWaiting ? "client waiting" : null, p.pauseOnScheduled ? "scheduled" : null].filter(Boolean).join(", ") || "none"),
      esc: p.escalation && p.escalation.enabled ? ui.badge("on breach", "warn") : ui.badge("none", "muted"),
      actions: canEdit ? ui.btn("Edit", { small: true, act: "sla-edit", arg: p.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "sla-del", arg: p.id }) : "",
    }));
    panel.innerHTML = ui.table([
      { key: "name", label: "Policy" },
      { key: "applies", label: "Applies to" },
      { key: "resp", label: "Response", align: "right" },
      { key: "reso", label: "Resolution", align: "right" },
      { key: "pauses", label: "Stop clock" },
      { key: "esc", label: "Escalation" },
      { key: "actions", label: "", align: "right" },
    ], rows, { emptyText: "No SLA policies yet." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "sla-edit") return openPolicyModal(pid, policies.find((p) => String(p.id) === String(arg)), refresh);
      if (act === "sla-del") {
        if (await ui.confirm({ title: "Delete policy?", message: "Tickets already stamped with it keep their current targets.", danger: true, okLabel: "Delete" })) {
          await S.removePolicy(pid, arg); ERP.toast("Policy deleted.", "success"); refresh();
        }
      }
    });
  }

  async function renderCalendars(panel, refresh) {
    const ui = ERP.ui;
    const calendars = await ERP.members.calendars();
    const rows = calendars.map((c) => {
      const open = DAY_KEYS.filter((d) => (c.hours && c.hours[d] || []).some((w) => w.from && w.to));
      return {
        name: "<b>" + ui.esc(c.name) + "</b>" + (c.isDefault ? " " + ui.badge("default", "info") : ""),
        tz: ui.esc(c.timezone || "UTC") + (c.offsetMinutes ? " (UTC" + (c.offsetMinutes > 0 ? "+" : "") + (c.offsetMinutes / 60) + ")" : ""),
        hours: ui.esc(open.map((d) => d.toUpperCase()).join(" ") || "closed") +
          '<div class="erp-sub">' + ui.esc(open.map((d) => { const w = (c.hours[d] || [])[0]; return w ? d.toUpperCase() + " " + w.from + "–" + w.to : ""; }).filter(Boolean).join(" · ")) + "</div>",
        holidays: ui.fmt((c.holidays || []).length, 0),
        next: ui.esc((c.holidays || []).map((h) => h.date).sort().filter((d) => d >= ui.today())[0] || "—"),
      };
    });
    panel.innerHTML =
      ui.alert("Business-hours calendars live in Admin → Members and are used by SLA targets, dispatch and scheduling. Add a UTC offset so a target raised near close-of-business rolls to the next working day.", "info") +
      ui.table([
        { key: "name", label: "Calendar" },
        { key: "tz", label: "Timezone" },
        { key: "hours", label: "Opening hours" },
        { key: "holidays", label: "Holidays", align: "right" },
        { key: "next", label: "Next holiday" },
      ], rows, { emptyText: "No calendars yet — add one in Admin → Members." }) +
      '<div class="erp-btn-row" style="margin-top:12px">' + ui.btn("Manage calendars in Admin", { act: "sla-goto-admin" }) + " " + ui.btn("SLA clock preview", { act: "sla-clock", primary: true }) + "</div>";
    ui.bind(panel, "click", "[data-act]", (el, e, act) => {
      if (act === "sla-clock") return openClockModal(null, refresh);
      if (act === "sla-goto-admin") { location.hash = "#/admin:members"; }
    });
  }

  async function renderMonitor(panel, refresh) {
    const ui = ERP.ui;
    const rows = await S.sweep({ persist: false, emit: false });
    const data = rows.map((r) => {
      const st = r.state;
      const left = st.remainingMs;
      return {
        num: "#" + ui.esc(r.ticket.number || r.ticket.id),
        summary: "<b>" + ui.esc(r.ticket.summary || "(no summary)") + "</b><div class=\"erp-sub\">" + ui.esc(r.ticket.__companyName || "") + "</div>",
        target: ui.esc(st.target === "response" ? "Response" : "Resolution"),
        due: ui.dateTime(new Date(st.dueMs).toISOString()),
        state: ui.badge(S.stateLabel(st), S.stateTone(st, r.ticket)),
        left: st.breached ? ui.badge("overdue " + Math.abs(Math.round(left / 60000)) + "m", "danger") : ui.fmt(Math.round(left / 60000), 0) + " min",
        owner: ui.esc(r.ticket.__ownerName || "—"),
      };
    });
    const breached = data.filter((r) => r.state.indexOf("Breached") >= 0).length;
    panel.innerHTML =
      ui.summary([
        { label: "Open tickets on a clock", value: String(data.length) },
        { label: "Breached", value: String(breached) },
        { label: "At risk", value: String(data.filter((r) => r.state.indexOf("At risk") >= 0).length) },
      ]) +
      '<div class="erp-btn-row" style="margin:10px 0">' + ERP.ui.btn("Run breach sweep", { primary: true, act: "sla-sweep" }) +
      '<span class="erp-sub" style="margin-left:10px">Sweeping stamps breaches, runs escalations and notifies.</span></div>' +
      ui.table([
        { key: "num", label: "Ticket" },
        { key: "summary", label: "Summary" },
        { key: "target", label: "Clock" },
        { key: "due", label: "Due" },
        { key: "left", label: "Remaining", align: "right" },
        { key: "state", label: "State" },
        { key: "owner", label: "Owner" },
      ], data, { emptyText: "No open tickets on an SLA clock." });
    ui.bind(panel, "click", "[data-act=sla-sweep]", async (t) => {
      t.disabled = true;
      const res = await S.sweep({});
      const newBreaches = res.filter((r) => r.newlyBreached).length;
      ERP.toast("Sweep complete — " + res.length + " on a clock" + (newBreaches ? ", " + newBreaches + " newly breached." : "."), newBreaches ? "error" : "success");
      refresh();
    });
  }

  S.renderConfig = async function (panel, refresh, view) {
    const ui = ERP.ui;
    const v = view || panel.__slaView || "policies";
    panel.__slaView = v;
    const defs = [
      { id: "policies", label: "Policies" },
      { id: "calendars", label: "Business hours" },
      { id: "monitor", label: "Breach monitor" },
    ];
    panel.innerHTML =
      '<div class="tabs erp-tabs" role="tablist">' +
        defs.map((d) => '<button class="tab' + (d.id === v ? " active" : "") + '" data-sla-view="' + d.id + '">' + ui.esc(d.label) + "</button>").join("") +
      '</div><div data-sla-panel></div>' +
      (v === "policies" ? '<div class="erp-btn-row" style="margin:12px 0">' + ui.btn("Add policy", { primary: true, act: "sla-new" }) + "</div>" : "");
    ui.bind(panel, "click", "[data-sla-view]", (el) => {
      panel.__slaView = el.getAttribute("data-sla-view");
      S.renderConfig(panel, refresh, panel.__slaView);
    });
    ui.bind(panel, "click", "[data-act=sla-new]", () => openPolicyModal(panel.__pid, null, refresh));
    const host = panel.querySelector("[data-sla-panel]");
    const pid = await ten().providerId();
    panel.__pid = pid;
    if (v === "policies") await renderPolicies(host, refresh);
    else if (v === "calendars") await renderCalendars(host, refresh);
    else await renderMonitor(host, refresh);
  };
})();
