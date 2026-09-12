/* ============================================================
   PSA-U — tickets, notes, activity & attachments
   (Phase 2 · Tasks 7, 8, 9 & 14)
   The heart of the service operation. A ticket belongs to a client
   company and carries: company / site / contact, board, type /
   subtype / item, status, priority, source, summary and detail,
   owner / team, an optional schedule, a required-by date and a
   unique ticket number. Around it hang:

     • notes       — timestamped, each flagged internal or
                     customer-visible, with the distinction
                     enforced everywhere it is shown;
     • activity    — an automatic log of every field change;
     • attachments — files or links pinned to the ticket;
     • relations   — parent / child / related / duplicate /
                     knowledge links, with merge + redirect for
                     duplicates.

   Tickets live in their client company's document, so everything
   about a client travels together and syncs, backs up and versions
   as one. Board configuration, saved filters and the ticket-number
   counter live in the provider document. Every mutation is checked
   through ERP.security, stamps SLA state via ERP.sla, runs the
   workflow rules via ERP.workflow, and raises notifications via
   the engine behind it.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const T = (ERP.tickets = {});

  T.KINDS = ["ticket", "ticketNote", "ticketActivity", "ticketAttachment", "ticketRelation", "ticketMerge"];

  const TRACKED = ["summary", "detail", "status", "priority", "board", "ownerId", "teamId", "type", "subtype", "item", "source", "scheduledFor", "requiredBy", "contactId", "siteId"];

  const REL_TYPES = ["parent", "child", "related", "duplicate", "knowledge"];
  T.REL_TYPES = REL_TYPES;

  function ten() {
    if (!ERP.tenancy) throw new Error("tickets requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  const actor = () => (ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null });

  /* ─────────────────────────── generic record access ─────────────────────────── */

  async function nextDocId(companyId) { return ten().nextId(await ten().records("company", companyId)); }
  async function companyRecords(companyId) { return ten().records("company", companyId); }
  function put(companyId, rec) { return ten().upsert("company", companyId, rec); }
  function write(companyId, list) { return ten().save("company", companyId, list); }

  async function providerPut(pid, rec) {
    if (!isFinite(rec.id)) rec.id = ten().nextId(await ten().records("provider", pid));
    return ten().upsert("provider", pid, rec);
  }

  T.newTicket = function (over) {
    return Object.assign({
      kind: "ticket", id: null, number: "", companyId: null,
      board: "", status: "new", priority: "p3",
      type: "", subtype: "", item: "", source: "",
      summary: "", detail: "",
      siteId: null, contactId: null, ownerId: null, teamId: null,
      scheduledFor: null, requiredBy: null,
      createdAt: null, updatedAt: null, createdBy: null, closedAt: null,
      sla: null, mergedInto: null, parentId: null, templateId: null, recurringId: null,
      checklist: [], tags: [], requiredSkills: [],
    }, over || {});
  };

  T.get = async function (companyId, id) {
    return (await companyRecords(companyId)).find((r) => r.kind === "ticket" && String(r.id) === String(id)) || null;
  };

  T.notes = async function (companyId, ticketId) {
    return (await companyRecords(companyId)).filter((r) => r.kind === "ticketNote" && String(r.ticketId) === String(ticketId))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  };
  T.noteCount = async function (companyId, ticketId) { return (await T.notes(companyId, ticketId)).length; };

  T.activity = async function (companyId, ticketId) {
    return (await companyRecords(companyId)).filter((r) => r.kind === "ticketActivity" && String(r.ticketId) === String(ticketId))
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  };

  T.attachments = async function (companyId, ticketId) {
    return (await companyRecords(companyId)).filter((r) => r.kind === "ticketAttachment" && String(r.ticketId) === String(ticketId))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  };

  T.relations = async function (companyId, ticketId) {
    return (await companyRecords(companyId)).filter((r) => r.kind === "ticketRelation" && String(r.ticketId) === String(ticketId));
  };

  /* ─────────────────────────── ticket numbers ─────────────────────────── */

  async function nextNumber(pid) {
    const list = await ten().records("provider", pid, "ticketCounter");
    let rec = list[0];
    if (!rec) rec = { id: ten().nextId(await ten().records("provider", pid)), kind: "ticketCounter", last: 1000 };
    rec.last = Number(rec.last || 1000) + 1;
    await ten().upsert("provider", pid, rec);
    return String(rec.last);
  }

  /* ─────────────────────────── boards & routing ─────────────────────────── */

  T.newBoardConfig = (over) => Object.assign({
    kind: "boardConfig", code: "", defaultStatus: "new", statuses: null, priorities: null,
    teamId: null, autoAssign: "none", templateId: null, rrIndex: 0, active: true,
  }, over || {});

  T.boardConfigs = (pid) => ten().records("provider", pid, "boardConfig");
  T.boardConfig = async function (pid, code) {
    const found = (await T.boardConfigs(pid)).find((b) => String(b.code) === String(code));
    return Object.assign(T.newBoardConfig({ code: code || "" }), found || {});
  };
  T.saveBoardConfig = async function (pid, rec) {
    if (!ERP.security.enforce("boards.edit")) return { error: "forbidden" };
    let r = T.newBoardConfig(rec);
    if (!r.code) return { error: "code_required" };
    const existing = (await T.boardConfigs(pid)).find((b) => String(b.code) === String(r.code));
    if (existing) r = Object.assign({}, existing, r, { id: existing.id });
    else if (!isFinite(r.id)) r.id = ten().nextId(await ten().records("provider", pid));
    return ten().upsert("provider", pid, r);
  };

  /* Boards = the taxonomy's board list merged with its saved defaults. */
  T.boards = async function (pid) {
    const defs = await ERP.taxonomy.list(pid, "board");
    const cfgs = await T.boardConfigs(pid);
    return defs.filter((d) => d.active !== false).map((d) => {
      const cfg = cfgs.find((c) => String(c.code) === String(d.code)) || {};
      return Object.assign({ code: d.code, label: d.label, color: d.color }, T.newBoardConfig(cfg), { code: d.code, label: d.label, color: d.color });
    });
  };
  T.boardLabel = async function (pid, code) {
    const b = (await T.boards(pid)).find((x) => String(x.code) === String(code));
    return b ? b.label : (code || "—");
  };

  async function pickAssignee(pid, teamId, cfg) {
    let members = (await ERP.members.members()).filter((m) => m.active !== false);
    if (teamId != null && teamId !== "") {
      const tm = await ERP.members.teamMembers(teamId);
      const ids = new Set(tm.map((m) => String(m.id)));
      members = members.filter((m) => ids.has(String(m.id)));
    }
    if (!members.length) members = (await ERP.members.members()).filter((m) => m.active !== false);
    if (!members.length) return null;
    if (cfg && cfg.autoAssign === "load") {
      const open = await T.listAll({ open: true });
      const counts = {};
      open.forEach((t) => { if (t.ownerId != null) counts[String(t.ownerId)] = (counts[String(t.ownerId)] || 0) + 1; });
      members.sort((a, b) => (counts[String(a.id)] || 0) - (counts[String(b.id)] || 0));
      return members[0].id;
    }
    const idx = Number(cfg && cfg.rrIndex) || 0;
    const pick = members[idx % members.length];
    if (cfg && cfg.code) { try { await providerPut(pid, Object.assign({}, cfg, { rrIndex: (idx + 1) % members.length })); } catch (e) {} }
    return pick.id;
  }

  /* ─────────────────────────── save ─────────────────────────── */

  async function closedCodes(pid) {
    const statuses = await ERP.taxonomy.list(pid, "ticketStatus");
    return statuses.filter((s) => s.closed === true).map((s) => String(s.code));
  }
  T.closedCodes = closedCodes;

  async function logActivity(companyId, ticket, entry) {
    const rec = {
      kind: "ticketActivity", id: await nextDocId(companyId), ticketId: ticket.id, companyId: ticket.companyId != null ? ticket.companyId : companyId,
      field: entry.field || "", from: entry.from == null ? "" : String(entry.from), to: entry.to == null ? "" : String(entry.to),
      text: entry.text || "", at: nowIso(), by: entry.by || (actor().member ? actor().member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[ERP.role]) || ERP.role),
    };
    await put(companyId, rec);
    return rec;
  }
  T.logActivity = logActivity;

  async function emitFor(rec, existing, changes) {
    if (!ERP.workflow) return;
    const company = rec.companyId != null ? await ERP.companies.get(rec.companyId) : null;
    const emit = async (event) => {
      const ctx = await T.eventContext(event, rec, company, changes, null);
      try { await ERP.workflow.emit(event, ctx); } catch (e) {}
    };
    if (!existing) { await emit("ticket.created"); return; }
    if (changes.status) {
      await emit("ticket.status_changed");
      /* closed/reopened are first-class events (webhooks & rules subscribe to
         closure rather than having to interpret a status code). */
      const pid = await ten().providerId();
      const codes = pid == null ? [] : await closedCodes(pid);
      const wasClosed = codes.indexOf(String(existing.status)) !== -1;
      const nowClosed = codes.indexOf(String(rec.status)) !== -1;
      if (nowClosed && !wasClosed) await emit("ticket.closed");
      else if (!nowClosed && wasClosed) await emit("ticket.reopened");
    }
    if (changes.ownerId) await emit("ticket.assigned");
    const other = Object.keys(changes).some((k) => k !== "status" && k !== "ownerId");
    if (other) await emit("ticket.updated");
  }

  T.eventContext = async function (event, ticket, company, changes, actorObj) {
    const t = Object.assign({}, ticket);
    if (t.ownerId != null && t.ownerId !== "") t.ownerName = await ERP.members.memberName(t.ownerId);
    else t.ownerName = "";
    const comp = company || (t.companyId != null ? await ERP.companies.get(t.companyId) : null);
    const st = ERP.sla ? ERP.sla.state(ticket) : null;
    return {
      event: event, ticket: t, company: comp, changes: changes || {}, actor: actorObj || actor(),
      sla: st ? { target: st.target, due: st.dueMs ? new Date(st.dueMs).toISOString() : null, remainingMs: st.remainingMs, breached: !!st.breached, atRisk: !!st.atRisk, paused: !!st.paused } : {},
    };
  };

  T.save = async function (companyId, ticket, opts) {
    opts = opts || {};
    if (companyId == null) companyId = ticket.companyId;
    if (companyId == null) return { error: "no_company" };
    if (!opts.system && !ERP.security.enforce("tickets.edit", { companyId: companyId })) return { error: "forbidden" };
    const pid = await ten().providerId();
    if (pid == null) return { error: "no_provider" };
    companyId = isFinite(companyId) ? Number(companyId) : companyId;

    const existing = ticket.id != null ? await T.get(companyId, ticket.id) : null;
    const rec = Object.assign(T.newTicket(), existing || {}, ticket, { companyId: companyId });
    delete rec.ownerName; delete rec.companyName; delete rec.__companyName;
    const now = nowIso();
    const isNew = !existing;

    if (isNew) {
      rec.id = await nextDocId(companyId);
      rec.number = await nextNumber(pid);
      rec.createdAt = now;
      rec.createdBy = rec.createdBy != null ? rec.createdBy : (actor().memberId || null);
      rec.status = rec.status || "new";

      const company = await ERP.companies.get(companyId);
      if (ERP.workflow) {
        const route = await ERP.workflow.route(pid, { event: "ticket.created", ticket: rec, company: company });
        if (route) {
          if (!rec.board && route.board) rec.board = route.board;
          if ((rec.ownerId == null || rec.ownerId === "") && route.ownerId != null) rec.ownerId = route.ownerId;
          if ((rec.teamId == null || rec.teamId === "") && route.teamId != null) rec.teamId = route.teamId;
          if ((!rec.priority || rec.priority === "p3") && route.priority) rec.priority = route.priority;
        }
      }
      const bcfg = await T.boardConfig(pid, rec.board);
      if (bcfg) {
        if (!ticket.status || ticket.status === "new") rec.status = bcfg.defaultStatus || rec.status;
        if ((rec.teamId == null || rec.teamId === "") && bcfg.teamId != null) rec.teamId = bcfg.teamId;
      }
      if ((rec.ownerId == null || rec.ownerId === "") && bcfg && bcfg.autoAssign && bcfg.autoAssign !== "none") {
        const picked = await pickAssignee(pid, rec.teamId, bcfg);
        if (picked != null) rec.ownerId = picked;
      }
    }

    rec.updatedAt = now;
    const codes = await closedCodes(pid);
    if (codes.indexOf(String(rec.status)) !== -1) { if (!rec.closedAt) rec.closedAt = now; }
    else rec.closedAt = null;

    if (ERP.sla) { try { await ERP.sla.sync(rec, pid, Date.parse(now) || Date.now()); } catch (e) {} }

    const changes = {};
    if (existing) TRACKED.forEach((f) => { if (String(existing[f] == null ? "" : existing[f]) !== String(rec[f] == null ? "" : rec[f])) changes[f] = { from: existing[f], to: rec[f] }; });

    await put(companyId, rec);

    if (existing) {
      for (const f of TRACKED) {
        if (!changes[f]) continue;
        if (f === "detail") continue;
        await logActivity(companyId, rec, { field: f, from: changes[f].from, to: changes[f].to, text: f + " changed" });
      }
    } else {
      await logActivity(companyId, rec, { field: "created", text: "Ticket created", to: rec.number });
    }

    if (!opts.silent) await emitFor(rec, existing, changes);
    return Object.assign({ record: rec, created: isNew }, {});
  };

  T.remove = async function (companyId, id) {
    if (!ERP.security.enforce("tickets.delete", { companyId: companyId })) return { error: "forbidden" };
    const list = (await companyRecords(companyId)).filter((r) => !((r.kind === "ticket" && String(r.id) === String(id)) ||
      ((r.kind === "ticketNote" || r.kind === "ticketActivity" || r.kind === "ticketAttachment" || r.kind === "ticketRelation") && String(r.ticketId) === String(id))));
    const res = await write(companyId, list);
    return res.error ? res : { ok: true, id: id };
  };

  /* ─────────────────────────── notes, attachments, links ─────────────────────────── */

  T.addNote = async function (companyId, ticketId, note) {
    note = note || {};
    if (!note.system && !ERP.security.enforce("tickets.edit", { companyId: companyId })) return { error: "forbidden" };
    const t = await T.get(companyId, ticketId);
    if (!t) return { error: "not_found" };
    const rec = {
      kind: "ticketNote", id: await nextDocId(companyId), ticketId: t.id, companyId: t.companyId != null ? t.companyId : companyId,
      body: note.body || "", internal: note.internal !== false,
      author: note.author || (actor().member ? actor().member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[ERP.role]) || ERP.role),
      createdAt: nowIso(),
    };
    await put(companyId, rec);
    t.updatedAt = rec.createdAt;
    await put(companyId, t);
    await logActivity(companyId, t, { field: "note", text: rec.internal ? "Internal note added" : "Customer-visible update sent", by: rec.author });
    const event = rec.internal ? "ticket.note_added" : "ticket.customer_update";
    if (ERP.workflow) { const ctx = await T.eventContext(event, t, null, {}, null); try { await ERP.workflow.emit(event, ctx); } catch (e) {} }
    return { record: rec, event: event };
  };

  T.addAttachment = async function (companyId, ticketId, file) {
    if (!ERP.security.enforce("tickets.edit", { companyId: companyId })) return { error: "forbidden" };
    const t = await T.get(companyId, ticketId);
    if (!t) return { error: "not_found" };
    const rec = {
      kind: "ticketAttachment", id: await nextDocId(companyId), ticketId: t.id, companyId: t.companyId != null ? t.companyId : companyId,
      name: file.name || "attachment", url: file.url || "", size: file.size || 0, internal: file.internal !== false,
      by: actor().member ? actor().member.name : ERP.role, createdAt: nowIso(),
    };
    await put(companyId, rec);
    await logActivity(companyId, t, { field: "attachment", text: "Attachment added: " + rec.name });
    return { record: rec };
  };

  T.link = async function (companyId, ticketId, link) {
    if (!ERP.security.enforce("tickets.edit", { companyId: companyId })) return { error: "forbidden" };
    const t = await T.get(companyId, ticketId);
    if (!t) return { error: "not_found" };
    const rec = {
      kind: "ticketRelation", id: await nextDocId(companyId), ticketId: t.id, companyId: t.companyId != null ? t.companyId : companyId,
      type: REL_TYPES.indexOf(link.type) !== -1 ? link.type : "related",
      targetId: link.targetId, targetCompanyId: link.targetCompanyId != null ? link.targetCompanyId : t.companyId,
      label: link.label || "", createdAt: nowIso(),
      by: actor().member ? actor().member.name : ERP.role,
    };
    await put(companyId, rec);
    await logActivity(companyId, t, { field: "link", text: rec.type + " link added" });
    return { record: rec };
  };

  T.unlink = async function (companyId, relationId) {
    if (!ERP.security.enforce("tickets.edit", { companyId: companyId })) return { error: "forbidden" };
    return ten().remove("company", companyId, (r) => r.kind === "ticketRelation" && String(r.id) === String(relationId));
  };

  /* Follow a merged-ticket redirect chain to its live target. */
  T.resolve = async function (companyId, id) {
    let cur = await T.get(companyId, id);
    let hops = 0;
    while (cur && cur.mergedInto != null && hops++ < 10) cur = await T.get(companyId, cur.mergedInto);
    return cur;
  };

  T.merge = async function (companyId, sourceId, targetId) {
    if (!ERP.security.enforce("tickets.merge", { companyId: companyId })) return { error: "forbidden" };
    const source = await T.get(companyId, sourceId);
    const target = await T.get(companyId, targetId);
    if (!source || !target) return { error: "not_found" };
    if (String(source.id) === String(target.id)) return { error: "same_ticket" };
    const now = nowIso();
    const by = actor().member ? actor().member.name : ERP.role;
    const codes = await closedCodes((await ten().providerId()));
    const closedStatus = codes[0] || "closed";

    const list = await companyRecords(companyId);
    let maxId = ten().nextId(list);
    let notesMoved = 0;
    const updated = list.map((r) => {
      if ((r.kind === "ticketNote" || r.kind === "ticketAttachment") && String(r.ticketId) === String(source.id)) {
        if (r.kind === "ticketNote") notesMoved++;
        return Object.assign({}, r, { ticketId: target.id, movedFrom: source.id });
      }
      if (r.kind === "ticketRelation" && String(r.ticketId) === String(source.id)) return Object.assign({}, r, { ticketId: target.id });
      if (r.kind === "ticket" && String(r.id) === String(source.id)) {
        return Object.assign({}, r, { mergedInto: target.id, mergedAt: now, status: closedStatus, updatedAt: now });
      }
      return r;
    });
    updated.push({ kind: "ticketActivity", id: maxId++, ticketId: source.id, companyId: companyId, field: "merged", text: "Merged into #" + (target.number || target.id), at: now, by: by });
    updated.push({ kind: "ticketActivity", id: maxId++, ticketId: target.id, companyId: companyId, field: "merge", text: "Merged duplicate #" + (source.number || source.id), at: now, by: by });
    const merge = { kind: "ticketMerge", id: maxId++, sourceId: source.id, sourceNumber: source.number, targetId: target.id, targetNumber: target.number, companyId: companyId, notesMoved: notesMoved, at: now, by: by };
    updated.push(merge);
    const res = await write(companyId, updated);
    if (res.error) return res;
    if (ERP.workflow) {
      const fresh = await T.get(companyId, target.id);
      const ctx = await T.eventContext("ticket.merged", fresh, null, {}, null);
      ctx.mergedFrom = { id: source.id, number: source.number };
      try { await ERP.workflow.emit("ticket.merged", ctx); } catch (e) {}
    }
    return { ok: true, record: await T.get(companyId, target.id), merge: merge };
  };

  T.merges = async function (companyId) {
    return (await companyRecords(companyId)).filter((r) => r.kind === "ticketMerge").sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  };

  /* ─────────────────────────── listing & search ─────────────────────────── */

  async function memberNameMap() {
    const map = {};
    (await ERP.members.members()).forEach((m) => { map[String(m.id)] = m.name; });
    return map;
  }

  T.listAll = async function (query) {
    query = query || {};
    const pid = await ten().providerId();
    if (pid == null) return [];
    const statuses = await ERP.taxonomy.list(pid, "ticketStatus");
    const closed = new Set(statuses.filter((s) => s.closed === true).map((s) => String(s.code)));
    const names = await memberNameMap();
    const entries = await ERP.companies.list();
    const prFilter = query.priority ? String(query.priority).split(",").map((s) => s.trim()) : null;
    const tagFilter = query.tag ? String(query.tag) : null;
    const needle = query.q ? String(query.q).toLowerCase() : "";
    const out = [];
    for (const e of entries) {
      if (query.companyId != null && String(e.id) !== String(query.companyId)) continue;
      if (ERP.security && !ERP.security.canViewCompany(e.id)) continue;
      const recs = await ten().records("company", e.id);
      for (const r of recs) {
        if (r.kind !== "ticket") continue;
        if (query.open && closed.has(String(r.status))) continue;
        if (query.status && String(r.status) !== String(query.status)) continue;
        if (query.board && String(r.board) !== String(query.board)) continue;
        if (query.ownerId != null && query.ownerId !== "" && String(r.ownerId) !== String(query.ownerId)) continue;
        if (query.unassigned && r.ownerId != null && r.ownerId !== "") continue;
        if (prFilter && prFilter.indexOf(String(r.priority)) === -1) continue;
        if (tagFilter && (r.tags || []).map(String).indexOf(tagFilter) === -1) continue;
        if (needle && String(r.summary || "").toLowerCase().indexOf(needle) === -1 && String(r.number || "").indexOf(needle) === -1 && String(r.detail || "").toLowerCase().indexOf(needle) === -1 && String(e.name || "").toLowerCase().indexOf(needle) === -1) continue;
        out.push(Object.assign({}, r, { companyId: isFinite(e.id) ? Number(e.id) : e.id, __companyName: e.name, __ownerName: r.ownerId != null ? names[String(r.ownerId)] || "" : "" }));
      }
    }
    out.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return out;
  };

  T.list = function (companyId, query) { return T.listAll(Object.assign({ companyId: companyId }, query || {})); };

  T.search = function (text, query) { return T.listAll(Object.assign({ q: text }, query || {})); };

  /* ─────────────────────────── saved filters ─────────────────────────── */

  T.filters = (pid) => ten().records("provider", pid, "savedFilter");
  T.saveFilter = async function (pid, rec) {
    if (!ERP.security.enforce("tickets.view")) return { error: "forbidden" };
    const r = Object.assign({ kind: "savedFilter", name: "", query: {} }, rec || {});
    if (!r.name) return { error: "name_required" };
    return providerPut(pid, r);
  };
  T.removeFilter = (pid, id) => ten().remove("provider", pid, (r) => r.kind === "savedFilter" && String(r.id) === String(id));

  /* ─────────────────────────── seed ─────────────────────────── */

  T.ensureSeed = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const created = {};
    const defs = await ERP.taxonomy.list(pid, "board");
    const cfgs = await T.boardConfigs(pid);
    const firstStatus = (await ERP.taxonomy.list(pid, "ticketStatus"))[0];
    for (const d of defs) {
      if (cfgs.some((c) => String(c.code) === String(d.code))) continue;
      const rec = T.newBoardConfig({ code: d.code, defaultStatus: firstStatus ? firstStatus.code : "new", autoAssign: "none" });
      rec.id = ten().nextId(await ten().records("provider", pid));
      await ten().upsert("provider", pid, rec);
      created.board = true;
    }
    if (!(await T.filters(pid)).length) {
      const f = { kind: "savedFilter", name: "Open P1 & P2", query: { open: true, priority: "p1,p2" }, id: ten().nextId(await ten().records("provider", pid)) };
      await ten().upsert("provider", pid, f);
      created.filter = true;
    }
    return created;
  };

  /* ─────────────────────────── status / priority helpers ─────────────────────────── */

  T.statusMeta = async function (pid) {
    return (await ERP.taxonomy.list(pid, "ticketStatus")).sort((a, b) => (a.order || 0) - (b.order || 0));
  };
  T.statusLabel = function (statuses, code) { const s = statuses.find((x) => String(x.code) === String(code)); return s ? s.label : (code || "—"); };
  T.statusTone = function (statuses, code) {
    const s = statuses.find((x) => String(x.code) === String(code));
    if (!s) return "muted";
    if (s.closed === true) return "success";
    if (s.code === "waiting-customer") return "warn";
    if (s.code === "new") return "muted";
    return "info";
  };
  T.priorityTone = function (code) {
    if (code === "p1") return "danger";
    if (code === "p2") return "warn";
    if (code === "p3") return "info";
    return "muted";
  };
  function slaChip(pid, t, statuses) {
    if (!ERP.sla) return "";
    const st = ERP.sla.state(t);
    if (!st.applies) return ui.badge("No SLA", "muted");
    const tone = ERP.sla.stateTone(st, t);
    let label = ERP.sla.stateLabel(st);
    if (!st.met && st.remainingMs != null) {
      const mins = Math.round(st.remainingMs / 60000);
      if (st.breached) label += " " + Math.abs(mins) + "m over";
      else if (mins < 24 * 60) label += " · " + mins + "m";
      else label += " · " + Math.round(mins / 60) + "h";
    }
    return ui.badge(label, tone);
  }

  /* ─────────────────────────── new / edit ticket modal ─────────────────────────── */

  async function openNewTicket(pid, refresh, preset) {
    if (!ERP.security.enforce("tickets.edit")) return;
    const [companies, boards, statuses, priorities, types, subtypes, items, sources, members, teams, templates] = await Promise.all([
      ERP.companies.optionList(),
      ERP.taxonomy.optionList(pid, "board"),
      ERP.taxonomy.optionList(pid, "ticketStatus"),
      ERP.taxonomy.optionList(pid, "priority"),
      ERP.taxonomy.optionList(pid, "type"),
      ERP.taxonomy.optionList(pid, "subtype"),
      ERP.taxonomy.optionList(pid, "item"),
      ERP.taxonomy.optionList(pid, "source"),
      ERP.members.members(),
      ERP.members.teams(),
      ERP.templates ? ERP.templates.templates(pid) : [],
    ]);
    const t = Object.assign(T.newTicket({ priority: "p3", status: "new" }), preset || {});
    const fields =
      (companies.length ? ui.select("companyId", "Client", companies, t.companyId, "Select a client…") : ui.alert("Create a client first — every ticket belongs to a client.", "warn")) +
      ui.text("summary", "Summary", t.summary, "Short description of the issue or request") +
      ui.textarea("detail", "Detail", t.detail, 4) +
      (templates.length ? ui.select("templateId", "Start from template", [{ value: "", label: "— none —" }].concat(templates.map((x) => ({ value: x.id, label: x.name }))), t.templateId) : "") +
      '<div class="erp-form-row">' + ui.select("board", "Board", boards, t.board) + ui.select("status", "Status", statuses, t.status) + "</div>" +
      '<div class="erp-form-row">' + ui.select("priority", "Priority", priorities, t.priority) + ui.select("source", "Source", sources, t.source) + "</div>" +
      '<div class="erp-form-row">' + ui.select("type", "Type", types, t.type) + ui.select("subtype", "Subtype", subtypes, t.subtype) + "</div>" +
      '<div class="erp-form-row">' + ui.select("item", "Item", items, t.item) + ui.select("teamId", "Team", [{ value: "", label: "— unassigned —" }].concat(teams.map((x) => ({ value: x.id, label: x.name }))), t.teamId) + "</div>" +
      ui.select("ownerId", "Owner", [{ value: "", label: "— unassigned —" }].concat(members.map((m) => ({ value: m.id, label: m.name }))), t.ownerId) +
      '<div class="erp-form-row">' + ui.dateInput("scheduledFor", "Scheduled for", t.scheduledFor ? String(t.scheduledFor).slice(0, 10) : "") + ui.dateInput("requiredBy", "Required by", t.requiredBy ? String(t.requiredBy).slice(0, 10) : "") + "</div>" +
      ui.text("tags", "Tags (comma separated)", (t.tags || []).join(", ")) +
      ui.text("requiredSkills", "Required skills (comma separated)", (t.requiredSkills || []).join(", "), "windows, networking");

    const modal = ui.modal({
      title: "New ticket",
      size: "lg",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "nt-cancel" }) + " " + ui.btn("Create ticket", { small: true, primary: true, act: "nt-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const companySel = form.querySelector('[name="companyId"]');
    if (companySel && t.companyId == null) companySel.value = "";
    modal.querySelector("[data-act=nt-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=nt-save]").onclick = async (btn) => {
      const names = ["companyId", "summary", "detail", "board", "status", "priority", "source", "type", "subtype", "item", "teamId", "ownerId", "scheduledFor", "requiredBy", "tags", "requiredSkills", "templateId"];
      const v = ui.collect(form, names);
      if (!v.companyId) { ERP.toast("Choose the client this ticket belongs to.", "error"); return; }
      if (!v.summary) { ERP.toast("A summary is required.", "error"); return; }
      btn.disabled = true;
      let rec = T.newTicket({
        companyId: v.companyId, summary: v.summary, detail: v.detail,
        board: v.board, status: v.status, priority: v.priority, source: v.source,
        type: v.type, subtype: v.subtype, item: v.item,
        teamId: v.teamId === "" ? null : v.teamId, ownerId: v.ownerId === "" ? null : v.ownerId,
        scheduledFor: v.scheduledFor ? ui.iso(v.scheduledFor) : null,
        requiredBy: v.requiredBy ? ui.iso(v.requiredBy) : null,
        tags: String(v.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
        requiredSkills: String(v.requiredSkills || "").split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (v.templateId && ERP.templates) rec = Object.assign(rec, await ERP.templates.apply(pid, v.templateId, {}));
      const res = await T.save(v.companyId, rec);
      ui.closeModal();
      if (res.error) { ERP.toast("Could not create ticket: " + (res.message || res.error), "error"); return; }
      ERP.toast("Ticket #" + res.record.number + " created.", "success");
      refresh();
    };
  }

  /* ─────────────────────────── ticket detail modal ─────────────────────────── */

  async function openDetail(companyId, ticketId, refresh, tab) {
    const pid = await ten().providerId();
    const [companies, boards, statuses, priorities, types, subtypes, items, sources, members, teams] = await Promise.all([
      ERP.companies.optionList(),
      ERP.taxonomy.optionList(pid, "board"),
      ERP.taxonomy.optionList(pid, "ticketStatus"),
      ERP.taxonomy.optionList(pid, "priority"),
      ERP.taxonomy.optionList(pid, "type"),
      ERP.taxonomy.optionList(pid, "subtype"),
      ERP.taxonomy.optionList(pid, "item"),
      ERP.taxonomy.optionList(pid, "source"),
      ERP.members.members(),
      ERP.members.teams(),
    ]);
    const t = await T.get(companyId, ticketId);
    if (!t) { ERP.toast("Ticket not found.", "error"); return; }
    const canEdit = ERP.security.can("tickets.edit", { companyId: companyId });
    const canMerge = ERP.security.can("tickets.merge", { companyId: companyId });
    const company = await ERP.companies.get(companyId);
    const active = tab || "details";

    const head =
      '<div class="erp-tk-head">' +
        '<div><div class="erp-tk-num">#' + ui.esc(t.number || t.id) + "</div>" +
        "<h3>" + ui.esc(t.summary || "(no summary)") + "</h3>" +
        '<div class="erp-tk-meta">' + ui.esc(company ? company.name : "") + (t.board ? " · " + ui.esc(t.board) : "") + "</div></div>" +
        '<div class="erp-tk-badges">' + ui.badge(T.statusLabel(statuses, t.status), T.statusTone(statuses, t.status)) + " " +
          ui.badge(t.priority || "—", T.priorityTone(t.priority)) + " " + slaChip(pid, t, statuses) +
          (t.mergedInto != null ? " " + ui.badge("merged", "muted") : "") +
          (ERP.collab ? " " + ERP.collab.editorsChip("ticket", companyId + ":" + t.id) : "") + "</div>" +
      "</div>";

    if (t.mergedInto != null) {
      const live = await T.resolve(companyId, t.id);
      ui.modal({
        title: "Ticket #" + (t.number || t.id),
        body: head + ui.alert("This ticket was merged into " + (live && live.id !== t.id ? "#" + (live.number || live.id) + " — " + (live.summary || "") : "another ticket") + ". Follow the redirect to continue there.", "info"),
        foot: ui.btn("Close", { small: true, act: "td-close" }) + " " + (live && live.id !== t.id ? ui.btn("Open #" + (live.number || live.id), { small: true, primary: true, act: "td-follow" }) : ""),
      });
      const m = document.getElementById("uiModal");
      m.querySelector("[data-act=td-close]").onclick = () => ui.closeModal();
      const f = m.querySelector("[data-act=td-follow]");
      if (f) f.onclick = () => { ui.closeModal(); openDetail(live.companyId != null ? live.companyId : companyId, live.id, refresh, "details"); };
      return;
    }

    const tabs = [
      { id: "details", label: "Details" },
      { id: "notes", label: "Notes & updates" },
      { id: "activity", label: "Activity" },
      { id: "files", label: "Files" },
      { id: "knowledge", label: "Knowledge" },
      { id: "links", label: "Links & merge" },
    ];
    const tabBar = ui.tabs(tabs, active).html;

    const detailForm =
      '<form class="erp-form" data-ui-form>' +
        ui.text("summary", "Summary", t.summary) +
        ui.textarea("detail", "Detail", t.detail, 5) +
        '<div class="erp-form-row">' + ui.select("board", "Board", boards, t.board) + ui.select("status", "Status", statuses, t.status) + "</div>" +
        '<div class="erp-form-row">' + ui.select("priority", "Priority", priorities, t.priority) + ui.select("source", "Source", sources, t.source) + "</div>" +
        '<div class="erp-form-row">' + ui.select("type", "Type", types, t.type) + ui.select("subtype", "Subtype", subtypes, t.subtype) + "</div>" +
        '<div class="erp-form-row">' + ui.select("item", "Item", items, t.item) + ui.select("teamId", "Team", [{ value: "", label: "— unassigned —" }].concat(teams.map((x) => ({ value: x.id, label: x.name }))), t.teamId) + "</div>" +
        ui.select("ownerId", "Owner", [{ value: "", label: "— unassigned —" }].concat(members.map((x) => ({ value: x.id, label: x.name }))), t.ownerId) +
        '<div class="erp-form-row">' + ui.dateInput("scheduledFor", "Scheduled for", t.scheduledFor ? String(t.scheduledFor).slice(0, 10) : "") + ui.dateInput("requiredBy", "Required by", t.requiredBy ? String(t.requiredBy).slice(0, 10) : "") + "</div>" +
        ui.text("tags", "Tags", (t.tags || []).join(", ")) +
        ui.text("requiredSkills", "Required skills", (t.requiredSkills || []).join(", ")) +
        (canEdit ? '<div class="erp-form-foot">' + ui.btn("Save changes", { primary: true, act: "td-save" }) + "</div>" : "") +
      "</form>";

    const sl = ERP.sla ? ERP.sla.state(t) : null;
    const slaBox = sl && sl.applies
      ? '<div class="erp-tk-sla">' + ui.badge(ERP.sla.stateLabel(sl), ERP.sla.stateTone(sl, t)) +
        " <span class='erp-sub'>Response due " + (t.sla && t.sla.responseDueMs ? ui.dateTime(new Date(t.sla.responseDueMs).toISOString()) : "—") +
        " · Resolution due " + (t.sla && t.sla.resolutionDueMs ? ui.dateTime(new Date(t.sla.resolutionDueMs).toISOString()) : "—") + "</span></div>"
      : "";

    const cl = t.checklist || [];
    const checklist =
      '<div class="field"><label>Checklist</label><div class="erp-checklist" data-cl-list>' +
        (cl.length ? cl.map((c, i) => '<label class="erp-cl-item"><input type="checkbox" data-cl="' + i + '"' + (c.done ? " checked" : "") + "> " + ui.esc(c.label) + "</label>").join("") : '<span class="erp-sub">No checklist items.</span>') +
      "</div>" + (canEdit ? '<div class="erp-inline-form"><input type="text" data-cl-new placeholder="Add a checklist item…"><button class="btn btn-ghost btn-sm" data-act="td-cl-add">Add</button></div>' : "") + "</div>";

    const detailsPanel =
      slaBox +
      (canEdit ? detailForm : '<div class="erp-defs">' + [["Summary", t.summary], ["Detail", t.detail], ["Status", T.statusLabel(statuses, t.status)], ["Priority", t.priority], ["Owner", t.ownerName || ""]].map((kv) => "<dt>" + ui.esc(kv[0]) + "</dt><dd>" + ui.esc(kv[1] || "—") + "</dd>").join("") + "</div>") +
      checklist +
      '<div class="erp-defs" style="margin-top:12px">' +
        "<dt>Created</dt><dd>" + ui.dateTime(t.createdAt) + "</dd>" +
        "<dt>Updated</dt><dd>" + ui.dateTime(t.updatedAt) + "</dd>" +
        "<dt>Source</dt><dd>" + ui.esc(t.source || "—") + "</dd>" +
      "</div>";

    const notes = await T.notes(companyId, t.id);
    const notesPanel =
      (notes.length
        ? '<div class="erp-notes">' + notes.map((n) => '<div class="erp-note' + (n.internal ? " internal" : " customer") + '"><div class="erp-note-head">' + ui.badge(n.internal ? "internal" : "customer-visible", n.internal ? "warn" : "success") + " <b>" + ui.esc(n.author) + "</b> <span class='erp-sub'>" + ui.dateTime(n.createdAt) + "</span></div><div class='erp-note-body'>" + ui.esc(n.body).replace(/\n/g, "<br>") + "</div></div>").join("") + "</div>"
        : '<p class="erp-sub">No notes yet.</p>') +
      (canEdit
        ? '<div class="erp-note-add"><textarea data-note-body rows="3" placeholder="Write a note…"></textarea>' +
          '<div class="erp-btn-row"><label class="erp-check"><input type="checkbox" data-note-internal checked> internal only (not customer-visible)</label>' +
          '<button class="btn btn-primary btn-sm" data-act="td-note">Add note</button></div></div>'
        : "");

    const acts = await T.activity(companyId, t.id);
    const activityPanel = acts.length
      ? '<div class="erp-timeline">' + acts.map((a) => '<div class="erp-timeline-item"><span class="erp-timeline-when">' + ui.dateTime(a.at) + "</span>" + ui.esc(a.text || "") + (a.from || a.to ? " <span class='erp-sub'>" + ui.esc(a.from || "—") + " → " + ui.esc(a.to || "—") + "</span>" : "") + " <span class='erp-sub'>· " + ui.esc(a.by || "") + "</span></div>").join("") + "</div>"
      : '<p class="erp-sub">No activity recorded.</p>';

    const files = await T.attachments(companyId, t.id);
    const filesPanel =
      (files.length
        ? ui.table([
            { key: "name", label: "File", render: (r) => (r.url ? '<a href="' + ui.esc(r.url) + '" target="_blank" rel="noopener">' + ui.esc(r.name) + "</a>" : ui.esc(r.name)) },
            { key: "when", label: "Added", render: (r) => ui.dateTime(r.createdAt) },
            { key: "by", label: "By", render: (r) => ui.esc(r.by) },
            { key: "vis", label: "Visibility", render: (r) => ui.badge(r.internal ? "internal" : "customer", r.internal ? "warn" : "success") },
          ], files)
        : '<p class="erp-sub">No attachments yet.</p>') +
      (canEdit ? '<div class="erp-btn-row">' + ui.btn("Add attachment", { small: true, act: "td-file" }) + "</div>" : "");

    const rels = await T.relations(companyId, t.id);
    const relRows = rels.map((r) => ({
      type: ui.badge(r.type, "info"),
      target: "#" + ui.esc(r.targetId),
      actions: canEdit ? ui.btn("Remove", { small: true, danger: true, act: "td-unlink", arg: r.id }) : "",
    }));
    const linksPanel =
      (rels.length ? ui.table([{ key: "type", label: "Relationship" }, { key: "target", label: "Ticket" }, { key: "actions", label: "", align: "right" }], relRows) : '<p class="erp-sub">No linked tickets.</p>') +
      (canEdit ? '<div class="erp-btn-row">' + ui.btn("Link a ticket", { small: true, act: "td-link" }) + "</div>" : "") +
      (canMerge ? '<div class="erp-sep"></div>' + ui.alert("Merging marks this ticket as a duplicate, redirects it to the target and moves its notes, files and links across.", "info") + '<div class="erp-btn-row">' + ui.btn("Merge this ticket into another", { small: true, danger: true, act: "td-merge" }) + "</div>" : "");

    const kbSuggest = (ERP.kb && ERP.security.can("kb.view")) ? await ERP.kb.suggestForTicket(pid, t, { limit: 5 }) : [];
    const kbRows = kbSuggest.map((s) => ({
      title: ui.esc(s.article.title),
      visibility: ui.badge(ERP.kb.visibilityLabel(s.article.visibility), ERP.kb.visibilityTone(s.article.visibility)),
      actions: (canEdit ? ui.btn("Use in reply", { small: true, act: "td-kb-use", arg: s.article.id }) + " " : "") + ui.btn("Read", { small: true, act: "td-kb-open", arg: s.article.id }),
    }));
    const knowledgePanel =
      '<p class="erp-sub">Articles suggested for this ticket from its summary, detail and tags.</p>' +
      ui.table([{ key: "title", label: "Article" }, { key: "visibility", label: "Visibility" }, { key: "actions", label: "", align: "right" }], kbRows, { emptyText: "No matching articles yet." }) +
      (canEdit && ERP.kb ? '<div class="erp-btn-row">' + ui.btn("Draft an article from this ticket", { small: true, act: "td-kb-new" }) + "</div>" : "");

    const panels = { details: detailsPanel, notes: notesPanel, activity: activityPanel, files: filesPanel, knowledge: knowledgePanel, links: linksPanel };
    const body = head + tabBar + Object.keys(panels).map((k) => '<div class="erp-tab-panel' + (k === active ? " active" : "") + '" data-panel="' + k + '">' + panels[k] + "</div>").join("");

    const modal = ui.modal({
      title: "Ticket #" + (t.number || t.id),
      size: "lg",
      body: body,
      foot: ui.btn("Close", { small: true, act: "td-close" }),
    });
    const root = modal;
    if (ERP.collab) ERP.collab.noteEditing("ticket", companyId + ":" + t.id);
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => ui.showTab(root, b.getAttribute("data-tab"))));
    root.querySelector("[data-act=td-close]").onclick = () => ui.closeModal();

    const form = root.querySelector("[data-ui-form]");
    const saveBtn = root.querySelector("[data-act=td-save]");
    if (saveBtn) saveBtn.onclick = async () => {
      const v = ui.collect(form, ["summary", "detail", "board", "status", "priority", "source", "type", "subtype", "item", "teamId", "ownerId", "scheduledFor", "requiredBy", "tags", "requiredSkills"]);
      saveBtn.disabled = true;
      const res = await T.save(companyId, Object.assign({}, t, {
        summary: v.summary, detail: v.detail, board: v.board, status: v.status, priority: v.priority,
        source: v.source, type: v.type, subtype: v.subtype, item: v.item,
        teamId: v.teamId === "" ? null : v.teamId, ownerId: v.ownerId === "" ? null : v.ownerId,
        scheduledFor: v.scheduledFor ? ui.iso(v.scheduledFor) : null,
        requiredBy: v.requiredBy ? ui.iso(v.requiredBy) : null,
        tags: String(v.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
        requiredSkills: String(v.requiredSkills || "").split(",").map((s) => s.trim()).filter(Boolean),
      }));
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); saveBtn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Ticket updated.", "success"); refresh(); openDetail(companyId, t.id, refresh, "details");
    };

    const noteBtn = root.querySelector("[data-act=td-note]");
    if (noteBtn) noteBtn.onclick = async () => {
      const bodyEl = root.querySelector("[data-note-body]");
      const internal = root.querySelector("[data-note-internal]");
      if (!bodyEl.value.trim()) { ERP.toast("Write something first.", "error"); return; }
      noteBtn.disabled = true;
      const res = await T.addNote(companyId, t.id, { body: bodyEl.value.trim(), internal: internal ? internal.checked : true });
      if (res.error) { ERP.toast("Could not add note: " + res.error, "error"); noteBtn.disabled = false; return; }
      ui.closeModal(); refresh(); openDetail(companyId, t.id, refresh, "notes");
    };

    const kbNew = root.querySelector("[data-act=td-kb-new]");
    if (kbNew) kbNew.onclick = async () => {
      kbNew.disabled = true;
      const r = await ERP.kb.fromTicket(pid, companyId, t, {});
      if (r.error) { ERP.toast(r.message || r.error, "error"); kbNew.disabled = false; return; }
      ERP.toast("Draft article " + r.record.number + " created.", "success");
      ui.closeModal(); refresh(); ERP.kb.openArticleView(pid, r.record.id, refresh);
    };
    root.querySelectorAll("[data-act=td-kb-open]").forEach((b) => b.onclick = () => ERP.kb.openArticleView(pid, b.getAttribute("data-arg"), refresh));
    root.querySelectorAll("[data-act=td-kb-use]").forEach((b) => b.onclick = async () => {
      const art = await ERP.kb.article(pid, b.getAttribute("data-arg"));
      if (!art) return;
      const km = ui.modal({
        title: "Send an article in your reply",
        body: ui.form(ui.textarea("body", "Customer-visible reply", "This article should help:\n\n" + art.title + "\n\n" + (art.summary || ""), 6) + ui.check("customer", "Customer-visible", true)),
        foot: ui.btn("Cancel", { small: true, act: "tku-cancel" }) + " " + ui.btn("Add reply", { small: true, primary: true, act: "tku-save" }),
      });
      const kf = km.querySelector("[data-ui-form]");
      km.querySelector("[data-act=tku-cancel]").onclick = () => ui.closeModal();
      km.querySelector("[data-act=tku-save]").onclick = async () => {
        const v = ui.collect(kf, ["body", "customer"]);
        const res = await T.addNote(companyId, t.id, { body: v.body, internal: !v.customer });
        if (res.error) return ERP.toast(res.error, "error");
        ERP.kb.markViewed(pid, art.id);
        ui.closeModal(); ERP.toast("Reply added.", "success"); refresh(); openDetail(companyId, t.id, refresh, "notes");
      };
    });

    const clList = root.querySelector("[data-cl-list]");
    if (clList) clList.addEventListener("change", async (e) => {
      const cb = e.target.closest("[data-cl]");
      if (!cb) return;
      const idx = Number(cb.getAttribute("data-cl"));
      const list = (t.checklist || []).slice();
      list[idx] = Object.assign({}, list[idx], { done: cb.checked });
      await T.save(companyId, Object.assign({}, t, { checklist: list }), { system: true });
      refresh();
    });
    const clAdd = root.querySelector("[data-act=td-cl-add]");
    if (clAdd) clAdd.onclick = async () => {
      const input = root.querySelector("[data-cl-new]");
      if (!input.value.trim()) return;
      const list = (t.checklist || []).concat([{ label: input.value.trim(), done: false }]);
      await T.save(companyId, Object.assign({}, t, { checklist: list }), { system: true });
      ui.closeModal(); refresh(); openDetail(companyId, t.id, refresh, "details");
    };

    const fileBtn = root.querySelector("[data-act=td-file]");
    if (fileBtn) fileBtn.onclick = async () => {
      const fm = ui.modal({
        title: "Add attachment",
        body: ui.form(ui.text("name", "Name", "") + ui.text("url", "URL", "") + ui.check("internal", "Internal only", true)),
        foot: ui.btn("Cancel", { small: true, act: "tf-cancel" }) + " " + ui.btn("Add", { small: true, primary: true, act: "tf-save" }),
      });
      const f = fm.querySelector("[data-ui-form]");
      fm.querySelector("[data-act=tf-cancel]").onclick = () => { ui.closeModal(); openDetail(companyId, t.id, refresh, "files"); };
      fm.querySelector("[data-act=tf-save]").onclick = async () => {
        const v = ui.collect(f, ["name", "url", "internal"]);
        if (!v.name) { ERP.toast("A file name is required.", "error"); return; }
        await T.addAttachment(companyId, t.id, v);
        ui.closeModal(); ERP.toast("Attachment added.", "success"); refresh(); openDetail(companyId, t.id, refresh, "files");
      };
    };

    const unlinkBtns = root.querySelectorAll("[data-act=td-unlink]");
    unlinkBtns.forEach((b) => b.onclick = async () => {
      await T.unlink(companyId, b.getAttribute("data-arg"));
      ui.closeModal(); refresh(); openDetail(companyId, t.id, refresh, "links");
    });

    const linkBtn = root.querySelector("[data-act=td-link]");
    if (linkBtn) linkBtn.onclick = async () => {
      const all = await T.listAll({});
      const others = all.filter((x) => !(String(x.companyId) === String(companyId) && String(x.id) === String(t.id)));
      const opts = others.slice(0, 300).map((x) => ({ value: x.companyId + "|" + x.id, label: "#" + x.number + " · " + (x.summary || "").slice(0, 50) }));
      const lm = ui.modal({
        title: "Link a ticket",
        size: "lg",
        body: ui.form(ui.select("type", "Relationship", REL_TYPES, "related") + ui.select("target", "Ticket", opts, "", "Search or choose…") + ui.text("label", "Note", "")),
        foot: ui.btn("Cancel", { small: true, act: "tl-cancel" }) + " " + ui.btn("Link", { small: true, primary: true, act: "tl-save" }),
      });
      const f = lm.querySelector("[data-ui-form]");
      lm.querySelector("[data-act=tl-cancel]").onclick = () => { ui.closeModal(); openDetail(companyId, t.id, refresh, "links"); };
      lm.querySelector("[data-act=tl-save]").onclick = async () => {
        const v = ui.collect(f, ["type", "target", "label"]);
        if (!v.target) { ERP.toast("Choose a ticket to link.", "error"); return; }
        const parts = String(v.target).split("|");
        await T.link(companyId, t.id, { type: v.type, targetId: parts[1], targetCompanyId: parts[0], label: v.label });
        ui.closeModal(); ERP.toast("Ticket linked.", "success"); refresh(); openDetail(companyId, t.id, refresh, "links");
      };
    };

    const mergeBtn = root.querySelector("[data-act=td-merge]");
    if (mergeBtn) mergeBtn.onclick = async () => {
      const all = await T.list({ companyId: companyId });
      const others = all.filter((x) => String(x.id) !== String(t.id));
      const opts = others.map((x) => ({ value: x.id, label: "#" + x.number + " · " + (x.summary || "").slice(0, 60) }));
      if (!opts.length) { ERP.toast("There is no other ticket to merge into.", "error"); return; }
      const mm = ui.modal({
        title: "Merge into another ticket",
        body: ui.form(ui.select("targetId", "Merge into", opts, opts[0].value)),
        foot: ui.btn("Cancel", { small: true, act: "tm-cancel" }) + " " + ui.btn("Merge", { small: true, danger: true, act: "tm-save" }),
      });
      const f = mm.querySelector("[data-ui-form]");
      mm.querySelector("[data-act=tm-cancel]").onclick = () => { ui.closeModal(); openDetail(companyId, t.id, refresh, "links"); };
      mm.querySelector("[data-act=tm-save]").onclick = async () => {
        const v = ui.collect(f, ["targetId"]);
        const res = await T.merge(companyId, t.id, v.targetId);
        ui.closeModal();
        if (res.error) { ERP.toast("Could not merge: " + res.error, "error"); return; }
        ERP.toast("Ticket merged.", "success"); refresh();
      };
    };
  }

  /* ─────────────────────────── saved-filter modal ─────────────────────────── */

  async function openFilterModal(pid, query, refresh) {
    const ui2 = ERP.ui;
    const m = ui2.modal({
      title: "Save this filter",
      body: ui2.form(ui2.text("name", "Filter name", "")),
      foot: ui2.btn("Cancel", { small: true, act: "sf-cancel" }) + " " + ui2.btn("Save", { small: true, primary: true, act: "sf-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=sf-cancel]").onclick = () => ui2.closeModal();
    m.querySelector("[data-act=sf-save]").onclick = async () => {
      const v = ui2.collect(f, ["name"]);
      if (!v.name) { ERP.toast("A filter name is required.", "error"); return; }
      await T.saveFilter(pid, { name: v.name, query: query });
      ui2.closeModal(); ERP.toast("Filter saved.", "success"); refresh();
    };
  }

  /* ─────────────────────────── list / board controller ─────────────────────────── */

  T.renderInto = async function (panel, refresh) {
    if (!ERP.security.enforce("tickets.view")) { panel.innerHTML = ui.alert("Your role cannot view tickets.", "warn"); return; }
    const pid = await ten().providerId();
    if (pid == null) {
      panel.innerHTML = ui.pageHead("Service desk", "Tickets, boards, SLAs and routing.", "") +
        ui.alert("Create a service provider and a client company first.", "warn");
      return;
    }
    const q = panel.__tq || (panel.__tq = { view: "list", open: true });

    const [boards, statuses, priorities, members, filters, all] = await Promise.all([
      T.boards(pid), T.statusMeta(pid), ERP.taxonomy.optionList(pid, "priority"),
      ERP.members.members(), T.filters(pid), T.listAll({}),
    ]);

    const statusList = statuses.map((s) => ({ value: s.code, label: s.label }));
    const ownerList = members.map((m) => ({ value: m.id, label: m.name }));

    const filtered = all.filter((t) => {
      if (q.open && statuses.some((s) => s.closed === true && String(s.code) === String(t.status))) return false;
      if (q.board && String(t.board) !== String(q.board)) return false;
      if (q.status && String(t.status) !== String(q.status)) return false;
      if (q.owner && String(t.ownerId) !== String(q.owner)) return false;
      if (q.priority && String(q.priority).split(",").indexOf(String(t.priority)) === -1) return false;
      if (q.q) {
        const n = q.q.toLowerCase();
        if (String(t.summary || "").toLowerCase().indexOf(n) === -1 && String(t.number || "").indexOf(n) === -1 && String(t.__companyName || "").toLowerCase().indexOf(n) === -1) return false;
      }
      return true;
    });

    const openList = all.filter((t) => !statuses.some((s) => s.closed === true && String(s.code) === String(t.status)));
    const slas = ERP.sla ? openList.map((t) => ERP.sla.state(t)).filter((s) => s.applies) : [];
    const breached = slas.filter((s) => s.breached).length;
    const atRisk = slas.filter((s) => s.atRisk).length;

    const root = document.createElement("div");
    root.className = "erp-module";
    panel.innerHTML = "";
    panel.appendChild(root);

    const viewBtn = (v, label) => '<button class="btn btn-sm ' + (q.view === v ? "btn-primary" : "btn-ghost") + '" data-tk-view="' + v + '">' + label + "</button>";

    root.innerHTML =
      ui.pageHead("Service desk", "Tickets across every client, with boards, SLAs and routing.", ui.btn("New ticket", { primary: true, act: "tk-new" })) +
      ui.summary([
        { label: "Open tickets", value: String(openList.length) },
        { label: "Unassigned", value: String(openList.filter((t) => t.ownerId == null || t.ownerId === "").length) },
        { label: "Breached", value: String(breached) },
        { label: "At risk", value: String(atRisk) },
        { label: "Showing", value: String(filtered.length) },
      ]) +
      '<div class="erp-tk-toolbar">' +
        '<input type="search" data-tk-q aria-label="Search tickets" placeholder="Search tickets…" value="' + ui.esc(q.q || "") + '">' +
        '<select data-tk-board aria-label="Filter by board"><option value="">All boards</option>' + boards.map((b) => '<option value="' + ui.esc(b.code) + '"' + (String(b.code) === String(q.board) ? " selected" : "") + ">" + ui.esc(b.label) + "</option>").join("") + "</select>" +
        '<select data-tk-status aria-label="Filter by status"><option value="">Any status</option>' + statusList.map((s) => '<option value="' + ui.esc(s.value) + '"' + (String(s.value) === String(q.status) ? " selected" : "") + ">" + ui.esc(s.label) + "</option>").join("") + "</select>" +
        '<select data-tk-priority aria-label="Filter by priority"><option value="">Any priority</option>' + priorities.map((s) => '<option value="' + ui.esc(s.value) + '"' + (String(s.value) === String(q.priority) ? " selected" : "") + ">" + ui.esc(s.label) + "</option>").join("") + "</select>" +
        '<select data-tk-owner aria-label="Filter by owner"><option value="">Any owner</option>' + ownerList.map((s) => '<option value="' + ui.esc(s.value) + '"' + (String(s.value) === String(q.owner) ? " selected" : "") + ">" + ui.esc(s.label) + "</option>").join("") + "</select>" +
        (filters.length ? '<select data-tk-filter aria-label="Saved filters"><option value="">Saved filters…</option>' + filters.map((f) => '<option value="' + ui.esc(f.id) + '">' + ui.esc(f.name) + "</option>").join("") + "</select>" : "") +
        '<label class="erp-check"><input type="checkbox" data-tk-open' + (q.open ? " checked" : "") + "> open only</label>" +
        '<span class="erp-tk-viewbtns">' + viewBtn("list", "List") + viewBtn("board", "Board") + "</span>" +
        ui.btn("Save filter", { small: true, act: "tk-savefilter" }) +
      "</div>" +
      '<div data-tk-out></div>';

    const out = root.querySelector("[data-tk-out]");

    if (q.view === "board") {
      const cols = (q.board ? boards.filter((b) => String(b.code) === String(q.board)) : boards);
      const statusCols = q.board && cols[0] && cols[0].statuses && cols[0].statuses.length
        ? cols[0].statuses.map((c) => ({ code: c, label: T.statusLabel(statuses, c) }))
        : statuses.map((s) => ({ code: s.code, label: s.label }));
      out.innerHTML = '<div class="erp-pipe-board">' + statusCols.map((sc) => {
        const items = filtered.filter((t) => String(t.status) === String(sc.code));
        return '<div class="erp-pipe-col"><div class="erp-pipe-col-head"><span class="erp-pipe-col-name">' + ui.esc(sc.label) + '</span><span class="erp-pipe-col-meta">' + items.length + "</span></div>" +
          '<div class="erp-pipe-cards">' + (items.length
            ? items.map((t) => '<div class="erp-pipe-card" data-tk-open-ticket="' + ui.esc(t.companyId) + "|" + ui.esc(t.id) + '">' +
                '<div class="erp-pipe-card-name">#' + ui.esc(t.number) + " " + ui.esc(t.summary || "") + "</div>" +
                '<div class="erp-sub">' + ui.esc(t.__companyName || "") + "</div>" +
                '<div class="erp-pipe-card-foot">' + ui.badge(t.priority || "—", T.priorityTone(t.priority)) + slaChip(pid, t, statuses) + "</div></div>").join("")
            : '<div class="erp-pipe-empty">Nothing here.</div>') + "</div></div>";
      }).join("") + "</div>";
    } else {
      const rows = filtered.map((t) => ({
        num: "<b>#" + ui.esc(t.number || t.id) + "</b>",
        summary: ui.esc(t.summary || "(no summary)") + '<div class="erp-sub">' + ui.esc(t.__companyName || "") + (t.tags && t.tags.length ? " · " + ui.esc(t.tags.join(", ")) : "") + "</div>",
        board: ui.esc(t.board || "—"),
        status: ui.badge(T.statusLabel(statuses, t.status), T.statusTone(statuses, t.status)),
        priority: ui.badge(t.priority || "—", T.priorityTone(t.priority)),
        owner: ui.esc(t.__ownerName || "—"),
        sla: slaChip(pid, t, statuses),
        updated: ui.dateTime(t.updatedAt),
        actions: ui.btn("Open", { small: true, act: "tk-open", arg: t.companyId + "|" + t.id }) +
          (ERP.security.can("tickets.delete", { companyId: t.companyId }) ? " " + ui.btn("Delete", { small: true, danger: true, act: "tk-del", arg: t.companyId + "|" + t.id }) : ""),
      }));
      out.innerHTML = ui.table([
        { key: "num", label: "No." },
        { key: "summary", label: "Summary" },
        { key: "board", label: "Board" },
        { key: "status", label: "Status" },
        { key: "priority", label: "Priority" },
        { key: "owner", label: "Owner" },
        { key: "sla", label: "SLA" },
        { key: "updated", label: "Updated" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No tickets match these filters." });
    }

    /* toolbar */
    const set = (key, val) => { q[key] = val; T.renderInto(panel, refresh); };
    const search = root.querySelector("[data-tk-q]");
    if (search) {
      let timer = null;
      search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => set("q", search.value), 220); });
    }
    [["[data-tk-board]", "board"], ["[data-tk-status]", "status"], ["[data-tk-priority]", "priority"], ["[data-tk-owner]", "owner"]].forEach(([sel, key]) => {
      const el = root.querySelector(sel);
      if (el) el.addEventListener("change", () => set(key, el.value));
    });
    const openCb = root.querySelector("[data-tk-open]");
    if (openCb) openCb.addEventListener("change", () => set("open", openCb.checked));
    const filterSel = root.querySelector("[data-tk-filter]");
    if (filterSel) filterSel.addEventListener("change", async () => {
      if (!filterSel.value) return;
      const f = filters.find((x) => String(x.id) === String(filterSel.value));
      if (f) { Object.assign(q, { board: "", status: "", priority: "", owner: "", q: "" }, f.query, { filterId: f.id }); T.renderInto(panel, refresh); }
    });

    ui.bind(root, "click", "[data-tk-view]", (el) => set("view", el.getAttribute("data-tk-view")));
    ui.bind(root, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "tk-new") return openNewTicket(pid, () => { T.renderInto(panel, refresh); });
      if (act === "tk-savefilter") return openFilterModal(pid, { open: q.open, board: q.board, status: q.status, priority: q.priority, owner: q.owner, q: q.q }, refresh);
      if (act === "tk-open") { const [cid, id] = String(arg).split("|"); return openDetail(cid, id, refresh, "details"); }
      if (act === "tk-del") {
        const [cid, id] = String(arg).split("|");
        const t = await T.get(cid, id);
        if (await ui.confirm({ title: "Delete ticket?", message: "Ticket #" + ((t && t.number) || id) + " and its notes, files and links will be removed.", danger: true, okLabel: "Delete" })) {
          const res = await T.remove(cid, id);
          ERP.toast(res.error ? "Delete failed." : "Ticket deleted.", res.error ? "error" : "success");
          T.renderInto(panel, refresh);
        }
      }
    });
    ui.bind(root, "click", "[data-tk-open-ticket]", (el) => {
      const [cid, id] = String(el.getAttribute("data-tk-open-ticket")).split("|");
      openDetail(cid, id, refresh, "details");
    });
  };
})();
