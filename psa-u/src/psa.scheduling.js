/* ============================================================
   PSA-U — technician calendars, availability & scheduling maths
   (Phase 3 · Tasks 15 & 18)
   Everything the dispatch board, the appointments model and the
   routing assistant need to reason about *time* and *people*:

     • work hours   — a member's weekly shifts, either an explicit
                      override on the member record or the
                      business-hours calendar they are assigned;
     • time off     — dated exceptions (holiday, training,
                      sickness) stored in the provider document;
     • skills       — what a member can do, matched against what a
                      ticket requires (its own `requiredSkills`, or
                      the skill attached to its taxonomy item);
     • availability — the free windows on a day once work hours
                      are cut by time off and existing commitments
                      (appointments and directly-scheduled tickets);
     • conflicts    — double-booking, outside-hours, time-off and
                      skill-mismatch checks;
     • recommendation (Task 18) — rank dispatchable members for a
                      ticket from skills, territory, availability,
                      current load and SLA risk, with the reasoning
                      spelled out, plus the next free slot for each.

   All schedule edits live in the provider document (or on member
   records), so they sync, version and back up with the tenant.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const S = (ERP.scheduling = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("scheduling requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();

  const DAY_KEYS = (ERP.sla && ERP.sla.DAY_KEYS) || ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DAY_LABELS = (ERP.sla && ERP.sla.DAY_LABELS) || { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  S.DAY_KEYS = DAY_KEYS;
  S.DAY_LABELS = DAY_LABELS;

  /* The fallback week when neither the member nor their calendar defines one. */
  const DEFAULT_HOURS = {
    mon: [{ from: "08:00", to: "17:00" }], tue: [{ from: "08:00", to: "17:00" }],
    wed: [{ from: "08:00", to: "17:00" }], thu: [{ from: "08:00", to: "17:00" }],
    fri: [{ from: "08:00", to: "17:00" }], sat: [], sun: [],
  };
  S.DEFAULT_HOURS = DEFAULT_HOURS;

  /* ─────────────────────────── local-time helpers ───────────────────────────
     Scheduling is done in the device's local wall-clock time (a technician's
     "09:00" is their own 09:00), so the board and the availability maths agree
     with the wall clock a dispatcher sees. */

  function dayKeyOf(ms) { return DAY_KEYS[new Date(ms).getDay()]; }
  function dayKeyOfDate(dateStr) { return DAY_KEYS[new Date(dateStr + "T00:00:00").getDay()]; }
  S.dayKeyOf = dayKeyOf;

  function dayStartMs(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  S.dayStartMs = dayStartMs;

  function minutesIntoDay(ms) { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }
  S.minutesIntoDay = minutesIntoDay;

  function dateStrOf(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  S.dateStrOf = dateStrOf;

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

  function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
  S.addDays = addDays;

  /* Normalise a week's worth of {from,to} windows into sorted minute pairs. */
  function windowsFromRaw(raw) {
    const out = [];
    (raw || []).forEach((w) => {
      const a = parseHM(w && w.from), b = parseHM(w && w.to);
      if (a == null || b == null || b <= a) return;
      out.push([a, b]);
    });
    out.sort((x, y) => x[0] - y[0]);
    return out;
  }
  S.windowsFromRaw = windowsFromRaw;

  /* ─────────────────────────── member work hours ─────────────────────────── */

  S.hasHours = function (hours) {
    return !!hours && DAY_KEYS.some((k) => windowsFromRaw(hours[k]).length);
  };

  /* A member's effective weekly hours: their own override, else the hours of
     the business-hours calendar they are assigned, else the standard week. */
  S.workHoursFor = async function (member) {
    if (member && S.hasHours(member.workHours)) return member.workHours;
    const calId = member && member.calendarId;
    if (ERP.sla && ERP.sla.calendar) {
      try {
        const cal = await ERP.sla.calendar(calId);
        if (cal && S.hasHours(cal.hours)) return cal.hours;
      } catch (e) {}
    }
    return DEFAULT_HOURS;
  };

  /* The open windows (minutes from local midnight) for a member on a date. */
  S.memberWindows = async function (member, dateMs) {
    const hours = await S.workHoursFor(member);
    const key = typeof dateMs === "string" ? dayKeyOfDate(dateMs) : dayKeyOf(dateMs);
    return windowsFromRaw(hours[key]);
  };

  /* ─────────────────────────── time off ─────────────────────────── */

  S.newTimeOff = (over) => Object.assign({
    kind: "timeOff", memberId: null, fromMs: null, toMs: null,
    allDay: true, reason: "", approved: true, createdAt: null,
  }, over || {});

  S.timeOff = async function (pid) {
    return (await ten().records("provider", pid, "timeOff"))
      .slice().sort((a, b) => Number(a.fromMs || 0) - Number(b.fromMs || 0));
  };
  S.timeOffById = async (pid, id) => (await S.timeOff(pid)).find((r) => String(r.id) === String(id)) || null;

  S.saveTimeOff = async function (pid, rec) {
    if (!ERP.security.enforce("timeoff.edit")) return { error: "forbidden" };
    const r = S.newTimeOff(rec);
    if (r.memberId == null || r.memberId === "") return { error: "member_required" };
    if (!r.fromMs) return { error: "from_required" };
    if (!r.toMs) r.toMs = r.fromMs;
    if (Number(r.toMs) < Number(r.fromMs)) { const t = r.fromMs; r.fromMs = r.toMs; r.toMs = t; }
    if (!r.createdAt) r.createdAt = nowIso();
    if (r.id == null || !isFinite(r.id)) r.id = ten().nextId(await ten().records("provider", pid));
    return ten().upsert("provider", pid, r);
  };

  S.removeTimeOff = (pid, id) => ten().remove("provider", pid, (r) => r.kind === "timeOff" && String(r.id) === String(id));

  S.timeOffForMember = async function (pid, memberId, fromMs, toMs) {
    return (await S.timeOff(pid)).filter((r) => String(r.memberId) === String(memberId) &&
      (fromMs == null || Number(r.toMs) >= fromMs) && (toMs == null || Number(r.fromMs) <= toMs));
  };

  /* ─────────────────────────── commitments ───────────────────────────
     Blocks that already occupy a member's time. Appointments are the primary
     source; a ticket with `scheduledFor` and an owner counts too unless an
     appointment already represents it (so a ticket is never double-counted). */

  async function companyBlocks(pid, memberId, fromMs, toMs) {
    const out = [];
    const entries = await ERP.companies.list();
    for (const e of entries) {
      if (ERP.security && !ERP.security.canViewCompany(e.id)) continue;
      const recs = await ten().records("company", e.id);
      const apptTicketIds = new Set(recs.filter((r) => r.kind === "appointment").map((r) => String(r.ticketId)));
      for (const r of recs) {
        if (r.kind === "appointment") {
          if (String(r.memberId) !== String(memberId)) continue;
          const s = Number(r.startMs), en = Number(r.endMs) || (s + 3600000);
          if (en >= fromMs && s <= toMs) out.push({ source: "appointment", ref: r, companyId: e.id, ticketId: r.ticketId, startMs: s, endMs: en, title: r.title || "" });
        } else if (r.kind === "ticket" && r.scheduledFor != null && String(r.ownerId) === String(memberId) && !apptTicketIds.has(String(r.id))) {
          const s = Date.parse(r.scheduledFor);
          if (!isFinite(s)) continue;
          const en = s + 3600000;
          if (en >= fromMs && s <= toMs) out.push({ source: "ticket", ref: r, companyId: e.id, ticketId: r.id, startMs: s, endMs: en, title: r.summary || "" });
        }
      }
    }
    out.sort((a, b) => a.startMs - b.startMs);
    return out;
  }
  S.commitments = companyBlocks;
  S.commitmentsOverlapping = function (pid, memberId, fromMs, toMs, exclude) {
    return companyBlocks(pid, memberId, fromMs, toMs).then((list) => list.filter((b) => {
      if (exclude && exclude.kind && b.source === exclude.kind && String(b.ref.id) === String(exclude.id)) return false;
      if (exclude && exclude.ids && exclude.ids.map(String).indexOf(String(b.ref.id)) !== -1) return false;
      return b.startMs < toMs && b.endMs > fromMs;
    }));
  };

  /* ─────────────────────────── availability ─────────────────────────── */

  function subtractWindows(base, cuts) {
    let out = base.map((w) => w.slice());
    for (const c of cuts) {
      const next = [];
      for (const w of out) {
        if (c[1] <= w[0] || c[0] >= w[1]) { next.push(w); continue; }
        if (c[0] > w[0]) next.push([w[0], Math.min(c[0], w[1])]);
        if (c[1] < w[1]) next.push([Math.max(c[1], w[0]), w[1]]);
      }
      out = next;
    }
    return out.filter((w) => w[1] - w[0] > 0);
  }
  S.subtractWindows = subtractWindows;

  /* A member's day: their working windows, the time already committed, and the
     free windows that remain. All windows are minutes from local midnight. */
  S.availability = async function (pid, memberId, dateMs) {
    const member = await ERP.members.member(memberId);
    if (!member) return null;
    const dayStart = typeof dateMs === "number" ? dayStartMs(dateMs) : dayStartMs(Date.parse(dateMs + "T00:00:00"));
    const dayEnd = dayStart + 86400000;
    const work = await S.memberWindows(member, dateMs);

    const offs = await S.timeOffForMember(pid, memberId, dayStart, dayEnd);
    const offCuts = [];
    offs.forEach((o) => {
      const s = Number(o.fromMs), e = Number(o.toMs) || s;
      const from = Math.max(0, Math.round((s - dayStart) / 60000));
      const to = Math.min(1440, Math.round((e - dayStart) / 60000) + (o.allDay ? 1440 : 0));
      if (to > from) offCuts.push([from, to]);
    });

    const blocks = await companyBlocks(pid, memberId, dayStart, dayEnd - 1);
    const busyCuts = [];
    let bookedMinutes = 0;
    blocks.forEach((b) => {
      const from = Math.max(0, Math.round((b.startMs - dayStart) / 60000));
      const to = Math.min(1440, Math.round((b.endMs - dayStart) / 60000));
      if (to > from) busyCuts.push([from, to]);
      bookedMinutes += Math.max(0, Math.round((Math.min(b.endMs, dayEnd) - Math.max(b.startMs, dayStart)) / 60000));
    });

    const around = subtractWindows(work, offCuts.concat(busyCuts));
    const workMinutes = work.reduce((n, w) => n + (w[1] - w[0]), 0);
    const availableMinutes = around.reduce((n, w) => n + (w[1] - w[0]), 0);
    return {
      memberId: member.id, member: member, dateMs: dayStart,
      work: work, timeOff: offCuts, busy: busyCuts, windows: around,
      workMinutes: workMinutes, bookedMinutes: bookedMinutes,
      availableMinutes: availableMinutes,
      overbooked: bookedMinutes > workMinutes,
    };
  };

  /* ─────────────────────────── skills ─────────────────────────── */

  const norm = (s) => String(s || "").trim().toLowerCase();

  S.skillMatches = function (member, required) {
    const have = (member && member.skills ? member.skills : []).map(norm).filter(Boolean);
    const need = (required || []).map(norm).filter(Boolean);
    const matched = need.filter((s) => have.indexOf(s) !== -1);
    const missing = need.filter((s) => have.indexOf(s) === -1);
    return { have: have, need: need, matched: matched, missing: missing, ratio: need.length ? matched.length / need.length : 1 };
  };

  /* The skills a ticket calls for: its own list first, then any skill recorded
     on its taxonomy item / subtype / type. */
  S.requiredSkillsFor = async function (ticket) {
    if (!ticket) return [];
    const explicit = (ticket.requiredSkills || []).map(String).filter(Boolean);
    if (explicit.length) return explicit;
    const pid = await ten().providerId();
    if (pid == null || !ERP.taxonomy) return [];
    for (const [cat, code] of [["item", ticket.item], ["subtype", ticket.subtype], ["type", ticket.type]]) {
      if (!code) continue;
      const rec = await ERP.taxonomy.find(pid, cat, code);
      if (rec) {
        const s = rec.skills || (rec.skill ? [rec.skill] : null);
        if (s && s.length) return s.map(String).filter(Boolean);
      }
    }
    return [];
  };

  /* ─────────────────────────── conflicts ─────────────────────────── */

  /* Every reason the proposed appointment should be flagged. `exclude` names
     the appointment being edited so it doesn't conflict with itself. */
  S.conflicts = async function (pid, appt, opts) {
    opts = opts || {};
    const out = [];
    if (!appt || appt.memberId == null || appt.memberId === "") {
      out.push({ type: "no_member", message: "No technician assigned." });
      return out;
    }
    const member = await ERP.members.member(appt.memberId);
    if (!member) { out.push({ type: "no_member", message: "The assigned technician no longer exists." }); return out; }
    const startMs = Number(appt.startMs);
    const endMs = Number(appt.endMs) || startMs + 3600000;
    if (!isFinite(startMs)) { out.push({ type: "no_time", message: "No time set." }); return out; }
    if (endMs <= startMs) out.push({ type: "bad_range", message: "The end time is before the start." });

    const dayStart = dayStartMs(startMs);
    const startMin = minutesIntoDay(startMs);
    const endMin = startMin + Math.round((endMs - startMs) / 60000);
    const work = await S.memberWindows(member, startMs);
    if (work.length && !work.some((w) => startMin >= w[0] && endMin <= w[1])) {
      out.push({ type: "outside_hours", message: "Outside " + (member.name || "the technician") + "'s working hours." });
    }

    const offs = await S.timeOffForMember(pid, appt.memberId, startMs, endMs);
    if (offs.some((o) => Number(o.fromMs) < endMs && Number(o.toMs) + (o.allDay ? 86399000 : 0) >= startMs)) {
      out.push({ type: "time_off", message: "Overlaps booked time off." });
    }

    const excl = opts.exclude || (appt.kind === "ticket" ? { kind: "ticket", id: appt.id } : { kind: "appointment", id: appt.id });
    const overlap = await S.commitmentsOverlapping(pid, appt.memberId, startMs, endMs - 1, excl);
    const overlapping = overlap.filter((b) => b.startMs < endMs && b.endMs > startMs);
    if (overlapping.length) {
      out.push({ type: "double_book", message: "Double-booked with " + overlapping.length + " other commitment(s).", blocks: overlapping });
    }

    const ticket = appt.ticketId != null ? await ERP.tickets.get(appt.companyId, appt.ticketId) : null;
    const required = await S.requiredSkillsFor(ticket);
    if (required.length) {
      const m = S.skillMatches(member, required);
      if (m.missing.length) out.push({ type: "skill_mismatch", message: "Missing skill(s): " + m.missing.join(", ") + ".", missing: m.missing });
    }
    return out;
  };

  /* ─────────────────────────── next free slot ─────────────────────────── */

  S.nextFreeSlot = async function (pid, memberId, durationMin, afterMs, opts) {
    opts = opts || {};
    const dur = Math.max(15, Number(durationMin) || 60);
    const horizon = Number(opts.days) || 14;
    const base = dayStartMs(afterMs || Date.now());
    const afterMin = (afterMs || Date.now()) - base > 0 ? minutesIntoDay(afterMs || Date.now()) : 0;
    for (let d = 0; d < horizon; d++) {
      const dayMs = d === 0 ? base : addDays(base, d);
      const av = await S.availability(pid, memberId, dayMs);
      if (!av) continue;
      for (const w of av.windows) {
        const floor = d === 0 ? Math.max(w[0], afterMin) : w[0];
        const startMin = Math.ceil(floor / 15) * 15;
        if (startMin < w[0]) continue;
        if (w[1] - startMin >= dur) {
          return { startMs: dayMs + startMin * 60000, endMs: dayMs + (startMin + dur) * 60000, minutes: startMin };
        }
      }
    }
    return null;
  };

  /* ─────────────────────────── recommendation (Task 18) ─────────────────────────── */

  S.DEFAULT_DURATION = 60;

  /* Rank the dispatchable members for a ticket. Each suggestion carries the
     score with its working spelled out (`reasons`), the member's load and the
     next free slot, so a dispatcher can judge and override the advice. */
  S.recommend = async function (pid, ticket, opts) {
    opts = opts || {};
    const duration = Math.max(15, Number(opts.durationMinutes) || S.DEFAULT_DURATION);
    const startAfter = Number(opts.afterMs) || Date.now();
    const soonMs = (Number(opts.soonHours) || 48) * 3600000;
    const weekMs = 7 * 86400000;

    const company = ticket && ticket.companyId != null ? await ERP.companies.get(ticket.companyId) : null;
    const required = await S.requiredSkillsFor(ticket);
    const slaState = ERP.sla && ticket ? ERP.sla.state(ticket) : null;
    const members = (await ERP.members.members()).filter((m) => m.active !== false && m.dispatchable !== false);

    const suggestions = [];
    for (const m of members) {
      const reasons = [];
      let score = 0;

      const sm = S.skillMatches(m, required);
      if (required.length) {
        score += Math.round(sm.ratio * 40);
        if (sm.missing.length === 0) reasons.push("Has every required skill (" + sm.matched.length + "/" + sm.need.length + ").");
        else reasons.push("Missing " + sm.missing.join(", ") + ".");
      } else {
        score += 25;
        reasons.push(required.length === 0 ? "No specific skills required." : "");
      }

      const terr = norm(m.territory);
      if (terr) {
        const where = norm(company && (company.city || company.region));
        if (where && (where.indexOf(terr) !== -1 || terr.indexOf(where) !== -1)) { score += 15; reasons.push("Covers " + m.territory + "."); }
        else reasons.push("Based in " + m.territory + ".");
      } else { score += 5; }

      const today = await S.availability(pid, m.id, startAfter);
      const bookedH = today ? today.bookedMinutes / 60 : 0;
      const loadScore = Math.max(0, 15 - Math.round(bookedH));
      score += loadScore;
      reasons.push((today && today.bookedMinutes ? today.bookedMinutes + " min booked today" : "Nothing booked today") + ".");

      const slot = await S.nextFreeSlot(pid, m.id, duration, startAfter, { days: 14 });
      if (slot) {
        const delta = slot.startMs - startAfter;
        if (delta <= soonMs) { score += 20; reasons.push("Free " + fmtShort(slot.startMs) + "."); }
        else if (delta <= weekMs) { score += 12; reasons.push("Next free " + fmtShort(slot.startMs) + "."); }
        else { score += 3; reasons.push("First free " + fmtShort(slot.startMs) + "."); }
      } else { reasons.push("No free slot in the next two weeks."); score -= 10; }

      if (slaState && slaState.applies && !slaState.met) {
        if (slaState.breached) { score += 10; reasons.push("SLA already breached — cover it first."); }
        else if (slaState.atRisk) { score += 6; reasons.push("SLA at risk."); }
      }

      const conflicts = await S.conflicts(pid, { memberId: m.id, startMs: slot ? slot.startMs : startAfter, endMs: (slot ? slot.startMs : startAfter) + duration * 60000, companyId: ticket && ticket.companyId, ticketId: ticket && ticket.id }, { exclude: ticket && ticket.id != null ? { kind: "ticket", id: ticket.id } : null });
      conflicts.forEach((c) => {
        if (c.type === "no_member") return;
        score -= 5;
        /* Skill gaps are already spelled out above — don't repeat them as a conflict line. */
        if (c.type !== "skill_mismatch") reasons.push(c.message);
      });

      const seen = new Set();
      const distinct = reasons.filter((r) => {
        if (!r) return false;
        const k = r.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });

      suggestions.push({
        memberId: m.id, member: m, name: m.name,
        score: score, reasons: distinct,
        skills: sm, territory: m.territory || "",
        loadMinutes: today ? today.bookedMinutes : 0,
        availableMinutes: today ? today.availableMinutes : 0,
        slot: slot, conflicts: conflicts,
      });
    }
    suggestions.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
    return { ticket: ticket || null, requiredSkills: required, durationMinutes: duration, suggestions: suggestions };
  };

  function fmtShort(ms) {
    const d = new Date(ms);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getDay()] + " " + fmtHM(d.getHours() * 60 + d.getMinutes());
  }
  S.fmtShort = fmtShort;

  /* ─────────────────────────── capacity summary ─────────────────────────── */

  S.capacity = async function (pid, dateMs) {
    const members = (await ERP.members.members()).filter((m) => m.active !== false && m.dispatchable !== false);
    const rows = [];
    for (const m of members) {
      const av = await S.availability(pid, m.id, dateMs);
      if (!av) continue;
      rows.push({
        memberId: m.id, member: m, name: m.name,
        workMinutes: av.workMinutes, bookedMinutes: av.bookedMinutes,
        availableMinutes: av.availableMinutes, overbooked: av.overbooked,
        loadPct: av.workMinutes ? Math.round((av.bookedMinutes / av.workMinutes) * 100) : (av.bookedMinutes ? 999 : 0),
      });
    }
    return rows;
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  const STARTER_TIME_OFF = { allDay: true, reason: "Public holiday" };

  S.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    if ((await S.timeOff(pid)).length) return { skipped: "already_seeded" };
    const members = await ERP.members.members();
    /* give the first technician a sample skill so the board and the assistant
       have something to reason about on a fresh provider */
    if (members.length && (!members[0].skills || !members[0].skills.length)) {
      await ERP.members.save("member", Object.assign({}, members[0], { skills: ["windows", "networking"], dispatchable: true }));
    }
    return { seeded: true };
  };
  S._STARTER_TIME_OFF = STARTER_TIME_OFF;
})();
