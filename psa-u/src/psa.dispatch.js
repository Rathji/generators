/* ============================================================
   PSA-U — Dispatch station
   (Phase 3 · Tasks 15, 16, 17 & 18)
   The delivery workspace. One station hosts the four pieces Phase 3
   delivers:

     Dispatch board          technician rows against time columns, an
                             unassigned queue, drag-and-drop
                             scheduling / rescheduling, capacity /
                             overload indicators and conflict flags
                             (double-booking, outside hours, time off,
                             skill mismatch), with keyboard fallbacks
                             for every drag action (Task 16);
     Appointments            the visit register — book, edit, complete
                             with on-site notes and sign-off, cancel
                             (Task 17, in psa.appointments.js);
     Calendars & availability each technician's shifts, skills, territory
                             and time off, and a two-week availability
                             view computed from them (Task 15);
     Scheduling assistant    ranked, explained recommendations of who
                             should take a ticket and when, which a
                             dispatcher can accept or override (Task 18).

   The reasoning lives in psa.scheduling.js; this file is the UI and
   the drag/keyboard interactions on top of it. Board state (date,
   team, selected member/ticket) hangs off the station element so it
   survives the tab's re-renders.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const D = (ERP.dispatch = {});

  const HOUR_START = 6;   // board shows 06:00 …
  const HOUR_END = 20;    // … to 20:00
  const SLOT_MIN = 60;

  function ten() {
    if (!ERP.tenancy) throw new Error("dispatch requires the tenancy service");
    return ERP.tenancy;
  }
  const S = () => ERP.scheduling;
  const A = () => ERP.appointments;

  function stateOf(host) {
    if (!host.__db) {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      host.__db = { dateMs: d.getTime(), teamId: "", availMember: null, assistTicket: null };
    }
    return host.__db;
  }

  const fmtHM = (min) => { const m = ((min % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const hoursText = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return ((h ? h + "h" : "") + (m ? " " + m + "m" : "")).trim() || "0m"; };
  const fmtShort = (ms) => { const d = new Date(ms); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + fmtHM(d.getHours() * 60 + d.getMinutes()); };
  const toDateValue = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  function dayLabel(ms) {
    const d = new Date(ms);
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] + " " + d.getDate() + " " + d.toLocaleString("en-US", { month: "short" });
  }

  /* ═══════════════════════════ DISPATCH BOARD (Task 16) ═══════════════════════════ */

  async function buildBlocks(pid, dateMs) {
    const dayStart = S().dayStartMs(dateMs);
    const dayEnd = dayStart + 86400000;
    const appts = await A().between(pid, dayStart, dayEnd - 1, {});
    const openTickets = await ERP.tickets.listAll({ open: true });
    const apptKeys = new Set(appts.map((a) => a.companyId + "|" + a.ticketId));

    const blocks = [];
    for (const a of appts) {
      if (a.status === "cancelled") continue;
      blocks.push({
        kind: "appointment", id: a.id, ref: a, companyId: a.companyId,
        ticketId: a.ticketId, memberId: a.memberId,
        startMs: Number(a.startMs), endMs: Number(a.endMs),
        title: a.title || "Appointment", company: a.__companyName || "",
        type: a.type, status: a.status,
      });
    }
    for (const t of openTickets) {
      if (!t.scheduledFor) continue;
      if (apptKeys.has(t.companyId + "|" + t.id)) continue;
      const startMs = Date.parse(t.scheduledFor);
      if (!isFinite(startMs) || startMs < dayStart || startMs >= dayEnd) continue;
      blocks.push({
        kind: "ticket", id: t.id, ref: t, companyId: t.companyId,
        ticketId: t.id, memberId: t.ownerId,
        startMs: startMs, endMs: startMs + 3600000,
        title: t.summary || ("Ticket #" + t.number), company: t.__companyName || "",
        type: "onsite", status: "scheduled",
      });
    }
    blocks.sort((a, b) => a.startMs - b.startMs);

    for (const b of blocks) {
      if (b.memberId == null || b.memberId === "") { b.conflicts = [{ type: "no_member", message: "Unassigned" }]; continue; }
      const exclude = b.kind === "appointment" ? { kind: "appointment", id: b.id } : { kind: "ticket", id: b.id };
      try {
        b.conflicts = await S().conflicts(pid, {
          memberId: b.memberId, startMs: b.startMs, endMs: b.endMs,
          companyId: b.companyId, ticketId: b.ticketId,
        }, { exclude: exclude });
      } catch (e) { b.conflicts = []; }
    }
    return blocks;
  }

  function blockHTML(b) {
    const startSlot = Math.max(0, Math.floor((S().minutesIntoDay(b.startMs) - HOUR_START * 60) / SLOT_MIN));
    const durMin = Math.max(15, Math.round((b.endMs - b.startMs) / 60000));
    const endOffset = S().minutesIntoDay(b.startMs) - HOUR_START * 60 + durMin;
    const span = Math.max(1, Math.ceil(endOffset / SLOT_MIN) - startSlot);
    const types = (b.conflicts || []).map((c) => c.type);
    const cls = ["erp-db-block", b.kind,
      types.indexOf("double_book") !== -1 ? "conflict" : "",
      types.indexOf("outside_hours") !== -1 || types.indexOf("time_off") !== -1 ? "offhours" : "",
      types.indexOf("skill_mismatch") !== -1 ? "skillgap" : ""].filter(Boolean).join(" ");
    const time = fmtHM(S().minutesIntoDay(b.startMs)) + "–" + fmtHM(S().minutesIntoDay(b.endMs));
    const badges = [];
    badges.push(b.kind === "appointment" ? ui.badge(A().statusLabel(b.status), A().statusTone(b.status)) : ui.badge("ticket", "muted"));
    if (types.indexOf("double_book") !== -1) badges.push(ui.badge("double-booked", "danger"));
    if (types.indexOf("outside_hours") !== -1) badges.push(ui.badge("outside hours", "warn"));
    if (types.indexOf("time_off") !== -1) badges.push(ui.badge("time off", "warn"));
    if (types.indexOf("skill_mismatch") !== -1) badges.push(ui.badge("skill gap", "danger"));
    const title = b.company + " · " + b.title + " (" + time + ")" + ((b.conflicts || []).length ? " — " + b.conflicts.map((c) => c.message).join(" ") : "");
    return '<div class="' + cls + '" style="grid-column:' + (startSlot + 1) + " / span " + span + '"' +
      ' draggable="true" tabindex="0" role="button"' +
      ' data-block-kind="' + ui.esc(b.kind) + '" data-block-company="' + ui.esc(b.companyId) + '" data-block-id="' + ui.esc(b.id) + '"' +
      ' data-block-member="' + ui.esc(b.memberId == null ? "" : b.memberId) + '" data-block-start="' + b.startMs + '" data-block-dur="' + durMin + '"' +
      ' title="' + ui.esc(title) + '">' +
      '<span class="erp-db-block-time">' + time + "</span>" +
      '<span class="erp-db-block-title">' + ui.esc(b.title) + "</span>" +
      (b.company ? '<span class="erp-db-block-client">' + ui.esc(b.company) + "</span>" : "") +
      '<span class="erp-db-block-tags">' + badges.join("") + "</span>" +
      "</div>";
  }

  async function renderBoard(panel, pid, host, refresh) {
    const st = stateOf(host);
    const dayStart = S().dayStartMs(st.dateMs);

    const [allMembers, teams, blocks, capacity, openTickets] = await Promise.all([
      ERP.members.members(),
      ERP.members.teams(),
      buildBlocks(pid, st.dateMs),
      S().capacity(pid, st.dateMs),
      ERP.tickets.listAll({ open: true }),
    ]);
    let members = allMembers.filter((m) => m.active !== false && m.dispatchable !== false);
    if (st.teamId) {
      const tm = await ERP.members.teamMembers(st.teamId);
      const ids = new Set(tm.map((m) => String(m.id)));
      members = members.filter((m) => ids.has(String(m.id)));
    }
    const capBy = {};
    capacity.forEach((c) => { capBy[String(c.memberId)] = c; });

    const apptKeys = new Set(blocks.filter((b) => b.kind === "appointment").map((b) => b.companyId + "|" + b.ticketId));
    const queue = openTickets.filter((t) => !t.scheduledFor && !apptKeys.has(t.companyId + "|" + t.id)).slice(0, 60);

    const cols = [];
    for (let m = HOUR_START * 60; m < HOUR_END * 60; m += SLOT_MIN) cols.push(m);

    const totalAvail = capacity.reduce((n, c) => n + c.availableMinutes, 0);
    const totalBooked = capacity.reduce((n, c) => n + c.bookedMinutes, 0);
    const conflictCount = blocks.reduce((n, b) => n + ((b.conflicts || []).filter((c) => c.type !== "no_member").length ? 1 : 0), 0);

    const boardRows = [];
    for (const m of members) {
      const work = await S().memberWindows(m, st.dateMs);
      const cap = capBy[String(m.id)] || { bookedMinutes: 0, workMinutes: 0, availableMinutes: 0, overbooked: false, loadPct: 0 };
      const memberBlocks = blocks.filter((b) => String(b.memberId) === String(m.id) &&
        S().minutesIntoDay(b.startMs) < HOUR_END * 60 && S().minutesIntoDay(b.endMs) > HOUR_START * 60);
      const cells = cols.map((min) => {
        const off = work.length && !work.some((w) => min >= w[0] && min < w[1]);
        return '<div class="erp-db-cell' + (off ? " off" : "") + '" data-drop-member="' + ui.esc(m.id) + '" data-drop-min="' + min + '"></div>';
      }).join("");
      const pct = cap.workMinutes ? Math.round((cap.bookedMinutes / cap.workMinutes) * 100) : (cap.bookedMinutes ? 999 : 0);
      const capCls = cap.overbooked ? "over" : pct >= 85 ? "tight" : "ok";
      boardRows.push(
        '<div class="erp-db-row">' +
          '<div class="erp-db-tech">' +
            '<div class="erp-db-tech-name"><span class="erp-dot" style="background:' + ui.esc(m.color || "var(--primary)") + '"></span> ' + ui.esc(m.name) + "</div>" +
            '<div class="erp-sub">' + ui.esc(String(m.functionalRole || "technician").replace("_", " ")) + (m.skills && m.skills.length ? " · " + ui.esc(m.skills.join(", ")) : "") + "</div>" +
          "</div>" +
          '<div class="erp-db-track" style="--slots:' + cols.length + '">' + cells + memberBlocks.map(blockHTML).join("") + "</div>" +
          '<div class="erp-db-cap ' + capCls + '"><div class="erp-db-cap-bar"><span style="width:' + Math.min(100, Math.max(2, pct)) + '%"></span></div>' +
            '<div class="erp-db-cap-text">' + hoursText(cap.bookedMinutes) + " / " + hoursText(cap.workMinutes) + (cap.overbooked ? " " + ui.badge("over", "danger") : "") + "</div>" +
          "</div>" +
        "</div>"
      );
    }

    const hourHead = cols.map((m) => '<span class="erp-db-time">' + fmtHM(m) + "</span>").join("");

    panel.innerHTML =
      ui.pageHead("Dispatch board", "Schedule technicians against time — drag a job onto the board, or use the keyboard.",
        ui.btn("New appointment", { primary: true, act: "db-new" }) + " " + ui.btn("Refresh", { small: true, act: "db-refresh" })) +
      ui.summary([
        { label: "Technicians", value: String(members.length) },
        { label: "Scheduled", value: String(blocks.length) },
        { label: "Unassigned", value: String(queue.length) },
        { label: "Conflicts", value: String(conflictCount) },
        { label: "Free today", value: hoursText(totalAvail) },
        { label: "Booked today", value: hoursText(totalBooked) },
      ]) +
      '<div class="erp-db-toolbar">' +
        '<button class="btn btn-ghost btn-sm" data-db-nav="-1">‹ Prev</button>' +
        '<button class="btn btn-ghost btn-sm" data-db-nav="0">Today</button>' +
        '<button class="btn btn-ghost btn-sm" data-db-nav="1">Next ›</button>' +
        '<input type="date" data-db-date aria-label="Dispatch date" value="' + ui.esc(toDateValue(st.dateMs)) + '">' +
        '<b class="erp-db-daylabel">' + ui.esc(dayLabel(st.dateMs)) + "</b>" +
        '<select data-db-team aria-label="Filter by team"><option value="">All teams</option>' + teams.map((t) => '<option value="' + ui.esc(t.id) + '"' + (String(t.id) === String(st.teamId) ? " selected" : "") + ">" + ui.esc(t.name) + "</option>").join("") + "</select>" +
        (ERP.collab ? ERP.collab.editorsChip("dispatch", toDateValue(st.dateMs)) : "") +
        '<span class="erp-db-hint">Drag a job onto a cell · keyboard: Tab to a job, arrows move it, Enter edits, Delete unschedules</span>' +
      "</div>" +
      '<div class="erp-db-layout">' +
        '<aside class="erp-db-queue">' +
          '<div class="erp-db-queue-head">Needs scheduling <span class="erp-badge tone-info">' + queue.length + "</span></div>" +
          (queue.length ? queue.map((t) => '<div class="erp-db-qitem" draggable="true" tabindex="0" role="button" data-q-company="' + ui.esc(t.companyId) + '" data-q-id="' + ui.esc(t.id) + '" title="' + ui.esc((t.__companyName || "") + " · " + t.summary) + '">' +
              '<div class="erp-db-q-title">#' + ui.esc(t.number || t.id) + " " + ui.esc(String(t.summary || "").slice(0, 46)) + "</div>" +
              '<div class="erp-sub">' + ui.esc(t.__companyName || "") + (t.priority ? " · " + ui.esc(t.priority) : "") + "</div>" +
            "</div>").join("") : '<div class="erp-db-queue-empty">Nothing waiting.</div>') +
        "</aside>" +
        '<div class="erp-db-main">' +
          '<div class="erp-db-head"><div class="erp-db-corner">Technician</div><div class="erp-db-times" style="--slots:' + cols.length + '">' + hourHead + '</div><div class="erp-db-cap-head">Load</div></div>' +
          (members.length ? boardRows.join("") : '<div class="erp-db-queue-empty">No dispatchable members. Add technicians in Admin → Members.</div>') +
        "</div>" +
      "</div>";

    panel.querySelectorAll("[data-db-nav]").forEach((b) => b.addEventListener("click", () => {
      const n = Number(b.getAttribute("data-db-nav"));
      st.dateMs = n === 0 ? S().dayStartMs(Date.now()) : S().addDays(st.dateMs, n);
      refresh();
    }));
    const dateEl = panel.querySelector("[data-db-date]");
    if (dateEl) dateEl.addEventListener("change", () => { const ms = Date.parse(dateEl.value + "T00:00:00"); if (isFinite(ms)) { st.dateMs = ms; refresh(); } });
    const teamEl = panel.querySelector("[data-db-team]");
    if (teamEl) teamEl.addEventListener("change", () => { st.teamId = teamEl.value; refresh(); });

    wireDrag(panel, st, refresh);

    if (ERP.collab) ERP.collab.noteEditing("dispatch", toDateValue(st.dateMs));

    ui.bind(panel, "click", "[data-act]", async (el, e, act) => {
      if (act === "db-new") return A().openApptModal(pid, null, refresh, { startMs: st.dateMs + 9 * 3600000 });
      if (act === "db-refresh") return refresh();
    });
    panel.querySelectorAll("[data-block-kind]").forEach((el) => {
      el.addEventListener("keydown", (e) => onBlockKey(e, el, pid, refresh));
      el.addEventListener("click", () => openBlock(el, pid, refresh));
    });
    panel.querySelectorAll("[data-q-id]").forEach((el) => {
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); openQueue(el, st, pid, refresh); } });
      el.addEventListener("click", () => openQueue(el, st, pid, refresh));
    });
  }

  function blockPayload(el) {
    return {
      kind: el.getAttribute("data-block-kind"),
      companyId: el.getAttribute("data-block-company"),
      id: el.getAttribute("data-block-id"),
      memberId: el.getAttribute("data-block-member"),
      startMs: Number(el.getAttribute("data-block-start")),
      durMin: Number(el.getAttribute("data-block-dur")) || 60,
    };
  }

  function wireDrag(panel, st, refresh) {
    let payload = null;
    panel.addEventListener("dragstart", (e) => {
      const b = e.target.closest("[data-block-kind]");
      const q = e.target.closest("[data-q-id]");
      if (b) { payload = blockPayload(b); b.classList.add("dragging"); }
      else if (q) { payload = { kind: "queue", companyId: q.getAttribute("data-q-company"), id: q.getAttribute("data-q-id") }; q.classList.add("dragging"); }
      else return;
      try { e.dataTransfer.setData("text/plain", JSON.stringify(payload)); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
    });
    panel.addEventListener("dragend", () => {
      payload = null;
      panel.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging"));
      panel.querySelectorAll(".erp-db-cell.over").forEach((x) => x.classList.remove("over"));
    });
    panel.addEventListener("dragover", (e) => {
      const cell = e.target.closest("[data-drop-member]");
      if (!cell) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      panel.querySelectorAll(".erp-db-cell.over").forEach((x) => { if (x !== cell) x.classList.remove("over"); });
      cell.classList.add("over");
    });
    panel.addEventListener("dragleave", (e) => {
      const cell = e.target.closest("[data-drop-member]");
      if (cell) cell.classList.remove("over");
    });
    panel.addEventListener("drop", async (e) => {
      const cell = e.target.closest("[data-drop-member]");
      if (!cell) return;
      e.preventDefault();
      let data = payload;
      try { const raw = e.dataTransfer.getData("text/plain"); if (raw) data = JSON.parse(raw); } catch (err) {}
      if (!data) return;
      const memberId = cell.getAttribute("data-drop-member");
      const min = Number(cell.getAttribute("data-drop-min"));
      const startMs = S().dayStartMs(st.dateMs) + min * 60000;
      await D.applyMove(data, memberId, startMs, refresh);
    });
  }

  /* One place for every scheduling change, so the drag, the keyboard fallback
     and the assistant all behave identically. */
  D.applyMove = async function (payload, memberId, startMs, refresh) {
    if (payload.kind === "appointment") {
      const a = await A().get(payload.companyId, payload.id);
      if (!a) return;
      const dur = Math.max(15, Number(payload.durMin) || Math.round((a.endMs - a.startMs) / 60000) || 60);
      const res = await A().reschedule(payload.companyId, payload.id, { memberId: memberId, startMs: startMs, endMs: startMs + dur * 60000 });
      if (res.error) ERP.toast("Could not move: " + (res.message || res.error), "error");
      else ERP.toast("Rescheduled to " + fmtShort(startMs) + ".", "success");
    } else if (payload.kind === "ticket") {
      const t = await ERP.tickets.get(payload.companyId, payload.id);
      if (!t) return;
      const res = await ERP.tickets.save(payload.companyId, Object.assign({}, t, { ownerId: memberId, scheduledFor: new Date(startMs).toISOString() }));
      if (res.error) ERP.toast("Could not reschedule: " + (res.message || res.error), "error");
      else ERP.toast("Ticket rescheduled to " + fmtShort(startMs) + ".", "success");
    } else {
      const t = await ERP.tickets.get(payload.companyId, payload.id);
      if (!t) return;
      const res = await A().schedule(t, { memberId: memberId, startMs: startMs, durationMinutes: Number(payload.durMin) || 60 });
      if (res.error) ERP.toast("Could not schedule: " + (res.message || res.error), "error");
      else ERP.toast("Scheduled " + fmtShort(startMs) + ".", "success");
    }
    if (typeof refresh === "function") refresh();
  };

  function onBlockKey(e, el, pid, refresh) {
    const payload = blockPayload(el);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBlock(el, pid, refresh); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      D.applyMove(payload, payload.memberId, payload.startMs + (e.key === "ArrowRight" ? SLOT_MIN : -SLOT_MIN) * 60000, refresh);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const main = el.closest(".erp-db-main");
      if (!main) return;
      const rows = Array.from(main.querySelectorAll(".erp-db-row"));
      const idx = rows.indexOf(el.closest(".erp-db-row"));
      const next = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        const cell = next.querySelector("[data-drop-member]");
        if (cell) D.applyMove(payload, cell.getAttribute("data-drop-member"), payload.startMs, refresh);
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (payload.kind === "appointment") {
        A().get(payload.companyId, payload.id).then(async (a) => {
          if (!a) return;
          if (await ui.confirm({ title: "Cancel this appointment?", danger: true, okLabel: "Cancel it" })) {
            await A().cancel(payload.companyId, payload.id, "cancelled from the dispatch board");
            ERP.toast("Appointment cancelled.", "success"); refresh();
          }
        });
      } else {
        ERP.tickets.get(payload.companyId, payload.id).then(async (t) => {
          if (!t) return;
          if (await ui.confirm({ title: "Unschedule this ticket?", danger: true, okLabel: "Unschedule" })) {
            await ERP.tickets.save(payload.companyId, Object.assign({}, t, { scheduledFor: null }), { system: true });
            ERP.toast("Ticket unscheduled.", "success"); refresh();
          }
        });
      }
    }
  }

  async function openBlock(el, pid, refresh) {
    const payload = blockPayload(el);
    if (payload.kind === "appointment") {
      const a = await A().get(payload.companyId, payload.id);
      A().openApptModal(pid, a, refresh);
    } else {
      const t = await ERP.tickets.get(payload.companyId, payload.id);
      if (!t) return;
      A().openApptModal(pid, null, refresh, { companyId: t.companyId, ticketId: t.id, title: t.summary, memberId: t.ownerId, startMs: payload.startMs });
    }
  }

  async function openQueue(el, st, pid, refresh) {
    const t = await ERP.tickets.get(el.getAttribute("data-q-company"), el.getAttribute("data-q-id"));
    if (!t) return;
    A().openApptModal(pid, null, refresh, { companyId: t.companyId, ticketId: t.id, title: t.summary, memberId: t.ownerId, startMs: S().dayStartMs(st.dateMs) + 9 * 3600000 });
  }

  /* ═══════════════════════════ CALENDARS & AVAILABILITY (Task 15) ═══════════════════════════ */

  async function renderAvailability(panel, pid, host, refresh) {
    const st = stateOf(host);
    const members = (await ERP.members.members()).filter((m) => m.active !== false);
    if (!members.length) { panel.innerHTML = ui.alert("Add members in Admin → Members first.", "warn"); return; }
    const member = members.find((m) => String(m.id) === String(st.availMember)) || members[0];
    st.availMember = member.id;
    const hours = await S().workHoursFor(member);
    const timeOff = await S().timeOffForMember(pid, member.id, null, null);
    const canEditSchedule = ERP.security.can("schedule.edit");
    const canEditOff = ERP.security.can("timeoff.edit");

    const dayEditor = S().DAY_KEYS.map((k) => {
      const wins = (hours[k] || []);
      return '<div class="erp-hours-row"><div class="erp-hours-day">' + ui.esc(S().DAY_LABELS[k] || k) + '</div><div class="erp-hours-wins">' +
        (wins.length ? wins.map((w, i) => '<span class="erp-hours-win"><input type="time" data-db-hour="' + k + '" data-idx="' + i + '" data-which="from" value="' + ui.esc(w.from || "") + '"' + (canEditSchedule ? "" : " disabled") + "> – " +
          '<input type="time" data-db-hour="' + k + '" data-idx="' + i + '" data-which="to" value="' + ui.esc(w.to || "") + '"' + (canEditSchedule ? "" : " disabled") + ">" +
          (canEditSchedule ? '<button class="icon-btn" data-db-hour-del="' + k + ":" + i + '" title="Remove">×</button>' : "") + "</span>").join("") : '<span class="erp-sub">Closed</span>') +
        (canEditSchedule ? '<button class="btn btn-ghost btn-sm" data-db-hour-add="' + k + '">+ window</button>' : "") +
      "</div></div>";
    }).join("");

    const strip = [];
    for (let i = 0; i < 14; i++) {
      const dayMs = S().addDays(S().dayStartMs(Date.now()), i);
      const av = await S().availability(pid, member.id, dayMs);
      const pct = av && av.workMinutes ? Math.round((av.availableMinutes / av.workMinutes) * 100) : 0;
      const wd = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(dayMs).getDay()];
      strip.push({ dayMs: dayMs, av: av, pct: pct, wd: wd });
    }
    const stripHTML = strip.map((s) => '<div class="erp-avail-day" title="' + ui.esc(dayLabel(s.dayMs) + " · " + (s.av ? hoursText(s.av.availableMinutes) + " free of " + hoursText(s.av.workMinutes) : "")) + '">' +
      '<span class="erp-avail-wd">' + s.wd + " " + new Date(s.dayMs).getDate() + "</span>" +
      '<span class="erp-avail-bar"><i style="height:' + Math.max(3, Math.min(100, s.pct)) + '%"></i></span>' +
      '<span class="erp-avail-meta">' + (s.av && s.av.overbooked ? ui.badge("over", "danger") : ui.esc(hoursText(s.av ? s.av.availableMinutes : 0))) + "</span></div>").join('<span class="erp-avail-arrow">›</span>');

    const offRows = timeOff.map((o) => ({
      when: "<b>" + ui.dateTime(o.fromMs) + "</b>" + (o.toMs && o.toMs !== o.fromMs ? " → " + ui.dateTime(o.toMs) : "") + (o.allDay ? " " + ui.badge("all day", "muted") : ""),
      reason: ui.esc(o.reason || "—"),
      actions: canEditOff ? ui.btn("Remove", { small: true, danger: true, act: "db-off-del", arg: o.id }) : "",
    }));

    panel.innerHTML =
      '<div class="erp-split">' +
        '<div class="erp-cat-list">' + members.map((m) => '<button class="erp-cat-btn' + (String(m.id) === String(member.id) ? " active" : "") + '" data-db-member="' + ui.esc(m.id) + '">' + ui.esc(m.name) + '<div class="erp-sub">' + ui.esc((m.skills || []).join(", ") || "no skills") + "</div></button>").join("") + "</div>" +
        '<div class="erp-split-main">' +
          ui.card("Availability — next two weeks", '<div class="erp-avail-strip">' + stripHTML + "</div>") +
          ui.card("Working hours · " + member.name,
            '<p class="erp-sub">Shifts for this technician. Reset to fall back to their assigned business-hours calendar.</p>' +
            '<div class="erp-cal-days">' + dayEditor + "</div>" +
            (canEditSchedule ? '<div class="erp-btn-row">' + ui.btn("Save hours", { primary: true, act: "db-hours-save", arg: member.id }) + ui.btn("Reset to calendar", { small: true, act: "db-hours-reset", arg: member.id }) + "</div>" : "")) +
          ui.card("Skills & territory",
            '<div class="erp-form"><div class="erp-form-row">' + ui.text("db-territory", "Territory", member.territory || "", "e.g. North") + "</div>" +
            ui.text("db-skills", "Skills (comma separated)", (member.skills || []).join(", "), "windows, networking, m365") + "</div>" +
            (canEditSchedule ? '<div class="erp-btn-row">' + ui.btn("Save skills & territory", { primary: true, act: "db-skills-save", arg: member.id }) + "</div>" : "")) +
          ui.card("Time off",
            (canEditOff ? '<div class="erp-btn-row">' + ui.btn("Add time off", { primary: true, act: "db-off-add", arg: member.id }) + "</div>" : "") +
            ui.table([{ key: "when", label: "When" }, { key: "reason", label: "Reason" }, { key: "actions", label: "", align: "right" }], offRows, { emptyText: "No time off booked." })) +
        "</div>" +
      "</div>";

    ui.bind(panel, "click", "[data-db-member]", (el) => { st.availMember = el.getAttribute("data-db-member"); refresh(); });
    ui.bind(panel, "click", "[data-db-hour-add]", (el) => {
      const k = el.getAttribute("data-db-hour-add");
      const h = JSON.parse(JSON.stringify(hours));
      (h[k] = h[k] || []).push({ from: "09:00", to: "12:00" });
      saveHours(member, h, refresh);
    });
    ui.bind(panel, "click", "[data-db-hour-del]", (el) => {
      const parts = el.getAttribute("data-db-hour-del").split(":");
      const h = JSON.parse(JSON.stringify(hours));
      if (h[parts[0]]) h[parts[0]].splice(Number(parts[1]), 1);
      saveHours(member, h, refresh);
    });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "db-hours-save") {
        const h = {};
        S().DAY_KEYS.forEach((k) => { h[k] = []; });
        panel.querySelectorAll("[data-db-hour]").forEach((inp) => {
          const k = inp.getAttribute("data-db-hour"), i = Number(inp.getAttribute("data-idx")), which = inp.getAttribute("data-which");
          h[k][i] = h[k][i] || { from: "", to: "" };
          h[k][i][which] = inp.value;
        });
        saveHours(member, h, refresh); return;
      }
      if (act === "db-hours-reset") {
        const res = await ERP.members.save("member", Object.assign({}, member, { workHours: null }));
        ERP.toast(res.error ? "Could not reset." : "Falling back to the assigned calendar.", res.error ? "error" : "success");
        refresh(); return;
      }
      if (act === "db-skills-save") {
        const terr = panel.querySelector('[name="db-territory"]');
        const sk = panel.querySelector('[name="db-skills"]');
        const res = await ERP.members.save("member", Object.assign({}, member, {
          territory: terr ? terr.value.trim() : "",
          skills: String(sk ? sk.value : "").split(",").map((s) => s.trim()).filter(Boolean),
        }));
        ERP.toast(res.error ? "Could not save." : "Saved.", res.error ? "error" : "success"); refresh(); return;
      }
      if (act === "db-off-add") return openTimeOffModal(pid, arg, refresh);
      if (act === "db-off-del") {
        if (await ui.confirm({ title: "Remove this time off?", danger: true, okLabel: "Remove" })) {
          await S().removeTimeOff(pid, arg); ERP.toast("Removed.", "success"); refresh();
        }
        return;
      }
    });
  }

  async function saveHours(member, hours, refresh) {
    if (!ERP.security.enforce("schedule.edit")) return;
    const clean = {};
    S().DAY_KEYS.forEach((k) => { clean[k] = (hours[k] || []).filter((w) => w && w.from && w.to); });
    const res = await ERP.members.save("member", Object.assign({}, member, { workHours: clean }));
    ERP.toast(res.error ? "Could not save hours." : "Working hours saved.", res.error ? "error" : "success");
    refresh();
  }

  async function openTimeOffModal(pid, memberId, refresh) {
    if (!ERP.security.enforce("timeoff.edit")) return;
    const m = ui.modal({
      title: "Add time off",
      body: ui.form(
        ui.dateInput("fromDate", "From date", ui.today()) +
        ui.dateInput("toDate", "To date (optional)", "") +
        ui.check("allDay", "All day", true) +
        ui.text("reason", "Reason", "", "Holiday, training, sickness…")
      ),
      foot: ui.btn("Cancel", { small: true, act: "db-off-cancel" }) + " " + ui.btn("Add", { small: true, primary: true, act: "db-off-save" }),
    });
    const form = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=db-off-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=db-off-save]").onclick = async () => {
      const v = ui.collect(form, ["fromDate", "toDate", "allDay", "reason"]);
      if (!v.fromDate) { ERP.toast("Choose a date.", "error"); return; }
      const fromMs = new Date(v.fromDate + "T00:00:00").getTime();
      const toMs = v.toDate ? new Date(v.toDate + "T23:59:00").getTime() : (v.allDay ? fromMs + 86399000 : fromMs);
      const res = await S().saveTimeOff(pid, { memberId: memberId, fromMs: fromMs, toMs: toMs, allDay: v.allDay !== false, reason: v.reason });
      if (res.error) { ERP.toast("Could not save: " + res.error, "error"); return; }
      ui.closeModal(); ERP.toast("Time off added.", "success"); refresh();
    };
  }

  /* ═══════════════════════════ SCHEDULING ASSISTANT (Task 18) ═══════════════════════════ */

  async function renderAssistant(panel, pid, host, refresh) {
    const st = stateOf(host);
    const open = await ERP.tickets.listAll({ open: true });
    const selected = open.find((t) => String(t.companyId) + "|" + String(t.id) === String(st.assistTicket)) || open[0] || null;
    if (selected) st.assistTicket = String(selected.companyId) + "|" + String(selected.id);

    const options = open.slice(0, 200).map((t) => ({ value: t.companyId + "|" + t.id, label: "#" + t.number + " · " + String(t.summary || "").slice(0, 48) + " · " + (t.__companyName || "") }));

    if (!selected) {
      panel.innerHTML = ui.pageHead("Scheduling assistant", "Recommend who should take a ticket and when.", "") + ui.alert("There are no open tickets to schedule.", "warn");
      return;
    }

    const rec = await S().recommend(pid, selected, {});
    const statuses = await ERP.taxonomy.list(pid, "ticketStatus");
    const sla = ERP.sla ? ERP.sla.state(selected) : null;
    const ticket = await ERP.tickets.get(selected.companyId, selected.id);

    const cards = rec.suggestions.slice(0, 8).map((s, i) => {
      return '<div class="erp-suggest' + (i === 0 ? " best" : "") + '">' +
        '<div class="erp-suggest-head">' +
          "<div><b>" + ui.esc(s.name) + "</b>" + (i === 0 ? " " + ui.badge("best match", "success") : "") + (s.territory ? ' <span class="erp-sub">· ' + ui.esc(s.territory) + "</span>" : "") + "</div>" +
          '<div class="erp-suggest-score" title="Recommendation score">' + s.score + "</div>" +
        "</div>" +
        '<ul class="erp-reasons">' + s.reasons.map((r) => "<li>" + ui.esc(r) + "</li>").join("") + "</ul>" +
        '<div class="erp-suggest-foot">' +
          (s.slot
            ? '<span class="erp-sub">Next free: <b>' + ui.esc(fmtShort(s.slot.startMs)) + "</b></span> " +
              ui.btn("Schedule " + fmtShort(s.slot.startMs), { small: true, primary: i === 0, act: "db-assign", arg: s.memberId + "|" + s.slot.startMs + "|" + rec.durationMinutes })
            : '<span class="erp-sub">No free slot within two weeks</span>') +
          " " + ui.btn("Override time…", { small: true, act: "db-assign-custom", arg: s.memberId }) +
        "</div>" +
      "</div>";
    }).join("");

    panel.innerHTML =
      ui.pageHead("Scheduling assistant", "Ranked, explained suggestions — accept one or override it.", ui.btn("Refresh", { small: true, act: "db-assist-refresh" })) +
      '<div class="erp-tk-toolbar">' +
        "<label class='erp-sub'>Ticket</label>" +
        '<select data-db-assist-ticket>' + (options.length ? options.map((o) => '<option value="' + ui.esc(o.value) + '"' + (o.value === st.assistTicket ? " selected" : "") + ">" + ui.esc(o.label) + "</option>").join("") : '<option value="">No open tickets</option>') + "</select>" +
      "</div>" +
      ui.card("Ticket", '<div class="erp-defs">' +
        "<dt>Summary</dt><dd>" + ui.esc(selected.summary || "") + "</dd>" +
        "<dt>Client</dt><dd>" + ui.esc(selected.__companyName || "—") + "</dd>" +
        "<dt>Status</dt><dd>" + ui.esc(ERP.tickets.statusLabel ? ERP.tickets.statusLabel(statuses, selected.status) : selected.status) + "</dd>" +
        "<dt>Priority</dt><dd>" + ui.esc(selected.priority || "—") + "</dd>" +
        "<dt>Required skills</dt><dd>" + ui.esc(rec.requiredSkills.length ? rec.requiredSkills.join(", ") : "none specified") + "</dd>" +
        "<dt>SLA</dt><dd>" + (sla && sla.applies ? ui.esc(ERP.sla.stateLabel(sla)) : "—") + "</dd>" +
      "</div>") +
      '<h3 class="erp-assist-title">Recommended technicians</h3>' +
      (cards || '<p class="erp-sub">No dispatchable members to recommend.</p>');

    const sel = panel.querySelector("[data-db-assist-ticket]");
    if (sel) sel.addEventListener("change", () => { st.assistTicket = sel.value; refresh(); });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "db-assist-refresh") return refresh();
      if (act === "db-assign") {
        const parts = String(arg).split("|");
        const res = await A().schedule(ticket, { memberId: parts[0], startMs: Number(parts[1]), durationMinutes: Number(parts[2]) || 60 });
        if (res.error) { ERP.toast("Could not schedule: " + (res.message || res.error), "error"); return; }
        ERP.toast("Scheduled with " + fmtShort(Number(parts[1])) + ".", "success"); refresh(); return;
      }
      if (act === "db-assign-custom") {
        A().openApptModal(pid, null, refresh, { companyId: ticket.companyId, ticketId: ticket.id, title: ticket.summary, memberId: arg, startMs: Date.now() + 3600000 });
        return;
      }
    });
  }

  /* ═══════════════════════════ controller ═══════════════════════════ */

  D.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "calendar", title: "Dispatch & scheduling", phase: "Phase 3 · Dispatch & scheduling",
        message: "Create a service provider and a client company first — then schedule technicians here.",
      });
      return;
    }
    try { await ERP.scheduling.ensureSeed(pid); } catch (e) {}
    stateOf(host);

    const defs = [
      { id: "board", label: "Dispatch board" },
      { id: "appointments", label: "Appointments" },
      { id: "availability", label: "Calendars & availability" },
      { id: "assistant", label: "Scheduling assistant" },
    ];
    const active = defs.find((d) => d.id === host.__tab) ? host.__tab : "board";

    const renderTab = async (id) => {
      const old = host.querySelector('[data-panel="' + id + '"]');
      if (!old) return;
      const panel = document.createElement("div");
      panel.className = old.className;
      panel.setAttribute("data-panel", id);
      old.replaceWith(panel);
      ERP.states.loading(panel, "Loading " + (defs.find((d) => d.id === id) || {}).label);
      try {
        if (id === "board") await renderBoard(panel, pid, host, () => renderTab(id));
        else if (id === "appointments") await ERP.appointments.renderInto(panel, () => renderTab(id));
        else if (id === "availability") await renderAvailability(panel, pid, host, () => renderTab(id));
        else if (id === "assistant") await renderAssistant(panel, pid, host, () => renderTab(id));
      } catch (e) {
        console.error("dispatch tab failed", id, e);
        ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
      }
    };

    host.innerHTML = ui.pageHead("Dispatch", "Schedule technicians, book on-site visits and see who is free.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__tab = b.getAttribute("data-tab");
      await renderTab(host.__tab);
    }));
    await renderTab(active);
  };
})();
