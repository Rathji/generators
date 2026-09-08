window.CRM_RENDERERS = window.CRM_RENDERERS || {};
window.CRM_REMINDERS = (function () {
  const R = window.CRM_RECORDS;
  const A = window.CRM_ACTIVITIES;
  const TL = window.CRM_TIMELINE;
  const U = window.RECORDUI;
  if (!R || !A || !TL || !U) return null;

  const DAY = 86400000;
  const HORIZON_DAYS = 7;
  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  function localDateISO(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function todayISO() {
    return localDateISO(new Date());
  }
  function addDaysISO(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return localDateISO(d);
  }
  function daysBetweenISO(a, b) {
    const A = new Date(a + "T00:00:00").getTime();
    const B = new Date(b + "T00:00:00").getTime();
    return Math.round((B - A) / DAY);
  }
  function sliceDate(v) {
    return v === undefined || v === null ? "" : String(v).slice(0, 10);
  }
  function dateOnly(v) {
    const s = sliceDate(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function taskActive(a, today) {
    if (!a || a.type !== "task") return null;
    const due = dateOnly(a.dueDate);
    if (!due || a.status === "done" || (a.dismissed && a.dismissed.at)) return null;
    const snoozed = dateOnly(a.snoozedUntil);
    if (snoozed && snoozed >= today) return null;
    if (due > addDaysISO(today, HORIZON_DAYS)) return null;
    return { kind: "task", id: a.id, rec: a, due, overdue: due < today, snoozedUntil: snoozed || null };
  }

  function dealActive(d, today) {
    if (!d) return null;
    const close = dateOnly(d.closeDate);
    if (!close || d.stage === "won" || d.stage === "lost") return null;
    if (d.closeReminderDismissed && d.closeReminderDismissed.at) return null;
    const after = dateOnly(d.closeReminderAfter);
    if (after && after >= today) return null;
    if (close > addDaysISO(today, HORIZON_DAYS)) return null;
    return { kind: "deal", id: d.id, rec: d, due: close, overdue: close < today, snoozedUntil: after || null };
  }

  async function collect(store, opts) {
    opts = opts || {};
    const today = opts.today || todayISO();
    const tasks = [];
    const deals = [];
    try {
      const adoc = await store.loadDoc("activities");
      for (const a of R.recordsOf(adoc && adoc.content)) {
        const t = taskActive(a, today);
        if (t) tasks.push(t);
      }
    } catch (e) {}
    try {
      const ddoc = await store.loadDoc("deals");
      for (const d of R.recordsOf(ddoc && ddoc.content)) {
        const it = dealActive(d, today);
        if (it) deals.push(it);
      }
    } catch (e) {}
    const sortItems = arr => arr.sort((x, y) => {
      if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
      const byDate = String(x.due).localeCompare(String(y.due));
      if (byDate !== 0) return byDate;
      return String(x.title || x.id).localeCompare(String(y.title || y.id));
    });
    return sortItems(tasks.concat(deals));
  }

  function itemTitle(it) {
    if (it.kind === "deal") return it.rec.name || it.id;
    return it.rec.subject || "Follow-up task";
  }

  async function dismissedItems(store) {
    const out = [];
    try {
      const adoc = await store.loadDoc("activities");
      for (const a of R.recordsOf(adoc && adoc.content)) {
        if (a.type === "task" && a.status !== "done" && a.dismissed && a.dismissed.at) {
          out.push({ kind: "task", id: a.id, rec: a, due: dateOnly(a.dueDate), dismissed: a.dismissed });
        }
      }
    } catch (e) {}
    try {
      const ddoc = await store.loadDoc("deals");
      for (const d of R.recordsOf(ddoc && ddoc.content)) {
        if (d.stage !== "won" && d.stage !== "lost" && d.closeReminderDismissed && d.closeReminderDismissed.at) {
          out.push({ kind: "deal", id: d.id, rec: d, due: dateOnly(d.closeDate), dismissed: d.closeReminderDismissed });
        }
      }
    } catch (e) {}
    out.sort((a, b) => String(b.dismissed.at).localeCompare(String(a.dismissed.at)));
    return out;
  }

  async function logReminderNote(store, item, subject, notes, extra) {
    extra = extra || {};
    const rec = item.rec;
    const values = {
      type: "note",
      subject,
      at: new Date().toISOString(),
      notes,
      companyId: rec.companyId || undefined,
      contactId: rec.contactId || undefined,
      dealId: item.kind === "deal" ? rec.id : rec.dealId || undefined,
      leadId: rec.leadId || undefined,
      owner: extra.owner || ""
    };
    return A.create(store, values, { events: false });
  }

  async function snoozeItem(store, item, until) {
    const date = dateOnly(until);
    const today = todayISO();
    if (!date) return { ok: false, code: "validation", errors: { until: "Pick a date to be reminded again." } };
    if (date < today) return { ok: false, code: "validation", errors: { until: "The snooze date must be today or later." } };
    let res;
    if (item.kind === "task") {
      res = await R.persistUpdate(store, "activities", content => {
        const t = R.getRecord(content, item.id);
        if (!t) return { changed: false };
        t.snoozedUntil = date;
        t.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Snoozed follow-up “" + truncate(itemTitle(item), 70) + "” until " + R.fmtDate(date), "Reminder snoozed until " + R.fmtDate(date) + ". It will surface again on that day if the task is still open.");
    } else {
      res = await R.persistUpdate(store, "deals", content => {
        const d = R.getRecord(content, item.id);
        if (!d) return { changed: false };
        d.closeReminderAfter = date;
        d.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Snoozed close-date reminder on deal “" + truncate(itemTitle(item), 60) + "”", "Close reminder hidden until " + R.fmtDate(date) + ".");
    }
    return res;
  }

  async function rescheduleItem(store, item, date) {
    const d = dateOnly(date);
    if (!d) return { ok: false, code: "validation", errors: { date: "Pick a valid date." } };
    let res;
    if (item.kind === "task") {
      res = await R.persistUpdate(store, "activities", content => {
        const t = R.getRecord(content, item.id);
        if (!t) return { changed: false };
        t.dueDate = d;
        delete t.snoozedUntil;
        t.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Rescheduled follow-up “" + truncate(itemTitle(item), 70) + "” to " + R.fmtDate(d), "Due date moved to " + R.fmtDate(d) + ".");
    } else {
      res = await R.persistUpdate(store, "deals", content => {
        const dl = R.getRecord(content, item.id);
        if (!dl) return { changed: false };
        dl.closeDate = d;
        delete dl.closeReminderAfter;
        dl.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Rescheduled close date on deal “" + truncate(itemTitle(item), 60) + "” to " + R.fmtDate(d), "Expected close date moved to " + R.fmtDate(d) + ".");
    }
    return res;
  }

  async function reassignItem(store, item, owner) {
    owner = String(owner || "").trim();
    if (!owner) return { ok: false, code: "validation", errors: { owner: "Name the new owner." } };
    let res;
    if (item.kind === "task") {
      res = await R.persistUpdate(store, "activities", content => {
        const t = R.getRecord(content, item.id);
        if (!t) return { changed: false };
        t.owner = owner;
        t.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Reassigned follow-up “" + truncate(itemTitle(item), 70) + "” to " + owner, "Now owned by " + owner + ".", { owner });
    } else {
      res = await R.persistUpdate(store, "deals", content => {
        const d = R.getRecord(content, item.id);
        if (!d) return { changed: false };
        d.owner = owner;
        d.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Reassigned deal “" + truncate(itemTitle(item), 60) + "” to " + owner, "Deal now owned by " + owner + ".", { owner });
    }
    return res;
  }

  async function dismissItem(store, item, reason) {
    reason = String(reason || "").trim();
    if (!reason) return { ok: false, code: "validation", errors: { reason: "Explain why — the reason is kept on the record." } };
    const by = "me";
    let res;
    if (item.kind === "task") {
      res = await R.persistUpdate(store, "activities", content => {
        const t = R.getRecord(content, item.id);
        if (!t) return { changed: false };
        t.dismissed = { at: R.nowISO(), by, reason };
        t.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Dismissed follow-up reminder “" + truncate(itemTitle(item), 70) + "”", "Dismissed by " + by + ". Reason: " + reason + ".");
    } else {
      res = await R.persistUpdate(store, "deals", content => {
        const d = R.getRecord(content, item.id);
        if (!d) return { changed: false };
        d.closeReminderDismissed = { at: R.nowISO(), by, reason };
        d.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
      if (res.ok) await logReminderNote(store, item, "Dismissed close-date reminder on deal “" + truncate(itemTitle(item), 60) + "”", "Dismissed by " + by + ". Reason: " + reason + ".");
    }
    return res;
  }

  async function restoreItem(store, item) {
    let res;
    if (item.kind === "task") {
      res = await R.persistUpdate(store, "activities", content => {
        const t = R.getRecord(content, item.id);
        if (!t) return { changed: false };
        delete t.dismissed;
        t.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
    } else {
      res = await R.persistUpdate(store, "deals", content => {
        const d = R.getRecord(content, item.id);
        if (!d) return { changed: false };
        delete d.closeReminderDismissed;
        delete d.closeReminderAfter;
        d.updatedAt = R.nowISO();
        return { changed: true, content };
      }, { events: true });
    }
    return res;
  }

  function truncate(s, n) {
    const str = String(s || "");
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  }

  async function counts(store) {
    const items = await collect(store);
    const out = { overdue: 0, due: 0, closing: 0, total: 0 };
    for (const it of items) {
      if (it.kind === "deal") out.closing++;
      else if (it.overdue) out.overdue++;
      else out.due++;
    }
    out.total = items.length;
    return out;
  }

  async function loadMaps(store) {
    const maps = {};
    const cmp = await store.loadDoc("companies");
    maps.companies = new Map(((cmp && cmp.content && cmp.content.records) || []).map(c => [c.id, c]));
    const ct = await store.loadDoc("contacts");
    maps.contacts = new Map(((ct && ct.content && ct.content.records) || []).map(c => [c.id, c]));
    const d = await store.loadDoc("deals");
    maps.deals = new Map(((d && d.content && d.content.records) || []).map(x => [x.id, x]));
    const l = await store.loadDoc("leads");
    maps.leads = new Map(((l && l.content && l.content.records) || []).map(x => [x.id, x]));
    return maps;
  }

  function itemLinks(it, maps) {
    const r = it.rec;
    const out = [];
    const add = (m, id, name) => {
      if (id && maps[m] && maps[m].get(id)) out.push({ m, id, name: maps[m].get(id).name });
    };
    if (it.kind === "deal") add("companies", r.companyId, null);
    else {
      add("companies", r.companyId, null);
      add("contacts", r.contactId, null);
      add("deals", r.dealId, null);
      add("leads", r.leadId, null);
    }
    return out;
  }

  function ownerOptions(maps) {
    const seen = {};
    const out = [];
    for (const m of [maps.deals, maps.leads]) {
      for (const r of m.values()) {
        if (r.owner && !seen[r.owner]) {
          seen[r.owner] = 1;
          out.push(r.owner);
        }
      }
    }
    return out.sort((a, b) => String(a).localeCompare(String(b)));
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function opt(v, text) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    return o;
  }

  function fmtWhen(it) {
    if (it.kind === "deal") return "closes " + (it.overdue ? "overdue · " : "") + R.fmtDate(it.due);
    return "due " + (it.overdue ? "overdue · " : "") + R.fmtDate(it.due);
  }

  function itemRow(it, maps, store, onChanged) {
    const row = el("div", "tl-row rm-row");
    row.dataset.rmRow = "1";
    const ic = el("span", "tl-ic " + (it.kind === "deal" ? "g-meeting" : "g-task"), it.kind === "deal" ? "◎" : "✓");
    const main = el("div", "tl-main");
    const t = el("div", "tl-title");
    t.appendChild(el("span", "rm-kind", it.kind === "deal" ? "deal closure" : "follow-up"));
    t.appendChild(document.createTextNode(itemTitle(it)));
    if (it.kind === "task") {
      const pr = it.rec.priority;
      if (pr && pr !== "med") t.appendChild(el("span", "badge " + (pr === "high" ? "inactive" : "active"), pr === "high" ? "high" : "low"));
    }
    if (it.overdue) t.appendChild(el("span", "badge inactive", "overdue"));
    if (it.snoozedUntil) t.appendChild(el("span", "badge active", "snoozed until " + R.fmtDate(it.snoozedUntil)));
    main.appendChild(t);
    const bits = [];
    if (it.rec.owner) bits.push(it.rec.owner);
    if (it.kind === "deal" && it.rec.stage) bits.push("stage: " + ((window.CRM_DEALS && window.CRM_DEALS.stageLabel) ? window.CRM_DEALS.stageLabel(it.rec.stage) : it.rec.stage));
    if (it.kind === "deal" && it.rec.expectedValue) bits.push("$" + Number(it.rec.expectedValue).toLocaleString());
    const chips = itemLinks(it, maps);
    main.appendChild(el("div", "tl-sub", bits.join(" · ")));
    if (chips.length) {
      const cr = el("span", "ac-chips");
      chips.forEach(c => {
        const a = document.createElement("a");
        a.href = "#/" + c.m + "/" + encodeURIComponent(c.id);
        a.textContent = c.name;
        a.className = "tag-pill";
        a.dataset.rmLink = "1";
        cr.appendChild(a);
      });
      main.appendChild(cr);
    }
    row.appendChild(ic);
    row.appendChild(main);
    const dueEl = el("span", "rm-when" + (it.overdue ? " od" : ""), fmtWhen(it));
    row.appendChild(dueEl);

    const actsBox = el("div", "rm-acts");
    const actsBtn = document.createElement("button");
    actsBtn.type = "button";
    actsBtn.className = "btn btn-ghost btn-sm rm-toggle";
    actsBtn.textContent = "Actions ▾";
    actsBox.appendChild(actsBtn);
    row.appendChild(actsBox);

    const panel = el("div", "rm-panel");
    panel.hidden = true;
    row.appendChild(panel);
    const formArea = el("div", "rm-form");
    panel.appendChild(formArea);
    const closePanel = () => {
      panel.hidden = true;
      actsBtn.textContent = "Actions ▾";
      formArea.innerHTML = "";
    };
    actsBtn.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      actsBtn.textContent = panel.hidden ? "Actions ▾" : "Actions ▴";
      if (panel.hidden) formArea.innerHTML = "";
    });
    const actionButtons = el("div", "rm-btnrow");
    panel.appendChild(actionButtons);
    const ACTIONS = [["snooze", "Snooze"], ["reschedule", "Reschedule"], ["reassign", "Reassign"], ["dismiss", "Dismiss…"]];
    ACTIONS.forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost btn-sm";
      b.textContent = pair[1];
      b.dataset.rmAction = pair[0];
      actionButtons.appendChild(b);
      b.addEventListener("click", () => renderActionForm(pair[0]));
    });

    function editorShell(title, saveLabel, bodyNodes, onSave) {
      formArea.innerHTML = "";
      const frm = el("div", "rm-editor");
      const hd = el("div", "rm-edit-title");
      hd.appendChild(el("span", null, title));
      const msg = el("div", "rm-edit-msg");
      msg.hidden = true;
      hd.appendChild(msg);
      frm.appendChild(hd);
      const body = el("div", "rm-edit-body");
      bodyNodes.forEach(n => body.appendChild(n));
      frm.appendChild(body);
      const foot = el("div", "form-acts");
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn btn-primary btn-sm";
      save.textContent = saveLabel;
      save.dataset.rmSave = "1";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-ghost btn-sm";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => { formArea.innerHTML = ""; actionButtons.hidden = false; });
      foot.appendChild(save);
      foot.appendChild(cancel);
      frm.appendChild(foot);
      formArea.appendChild(frm);
      actionButtons.hidden = true;
      return { save, msg, frm };
    }

    function renderActionForm(action) {
      const isDeal = it.kind === "deal";
      const today = todayISO();
      if (action === "snooze") {
        const hint = el("p", "hint", "Hidden until that day; it resurfaces if the " + (isDeal ? "deal is still open" : "task is still open") + ".");
        const presets = el("div", "rm-presets");
        const dateIn = document.createElement("input");
        dateIn.type = "date";
        dateIn.className = "inp";
        dateIn.min = today;
        dateIn.value = addDaysISO(today, 3);
        const presetBtn = n => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-ghost btn-sm";
          b.textContent = n === 1 ? "+1 day" : "+" + n + " days";
          b.addEventListener("click", () => { dateIn.value = addDaysISO(today, n); });
          presets.appendChild(b);
        };
        presetBtn(1);
        presetBtn(3);
        presetBtn(7);
        const ed = editorShell(isDeal ? "Snooze deal-close reminder" : "Snooze follow-up", "Snooze", [hint, presets, dateIn], null);
        ed.save.addEventListener("click", async () => {
          ed.save.disabled = true;
          const res = await snoozeItem(store, it, dateIn.value);
          if (res.ok) {
            window.CRM.toast("Reminder snoozed until " + R.fmtDate(dateIn.value) + ".");
            onChanged();
          } else {
            ed.save.disabled = false;
            ed.msg.className = "rm-edit-msg err";
            ed.msg.textContent = (res.errors && (res.errors.until || res.errors.date)) || U.describeError(res, "activities");
            ed.msg.hidden = false;
          }
        });
        return;
      }
      if (action === "reschedule") {
        const dateIn = document.createElement("input");
        dateIn.type = "date";
        dateIn.className = "inp";
        dateIn.value = it.due >= today ? it.due : today;
        dateIn.min = "2000-01-01";
        const ed = editorShell(isDeal ? "Reschedule deal close date" : "Reschedule follow-up", "Reschedule", [dateIn], null);
        ed.save.addEventListener("click", async () => {
          ed.save.disabled = true;
          const res = await rescheduleItem(store, it, dateIn.value);
          if (res.ok) {
            window.CRM.toast(isDeal ? "Close date moved." : "Follow-up rescheduled.");
            onChanged();
          } else {
            ed.save.disabled = false;
            ed.msg.className = "rm-edit-msg err";
            ed.msg.textContent = (res.errors && res.errors.date) || U.describeError(res, "activities");
            ed.msg.hidden = false;
          }
        });
        return;
      }
      if (action === "reassign") {
        const ownerIn = document.createElement("input");
        ownerIn.className = "inp";
        ownerIn.placeholder = "New owner";
        ownerIn.value = it.rec.owner || "";
        const dl = el("datalist");
        const id = "rmOwners" + (Math.random() * 1e6 | 0);
        dl.id = id;
        ownerOptions(maps).forEach(o => dl.appendChild(opt(o, o)));
        document.body.appendChild(dl);
        ownerIn.setAttribute("list", id);
        const ed = editorShell("Reassign to", "Reassign", [ownerIn], null);
        ed.save.addEventListener("click", async () => {
          ed.save.disabled = true;
          const res = await reassignItem(store, it, ownerIn.value);
          if (res.ok) {
            window.CRM.toast("Reassigned to " + ownerIn.value.trim() + ".");
            onChanged();
          } else {
            ed.save.disabled = false;
            ed.msg.className = "rm-edit-msg err";
            ed.msg.textContent = (res.errors && res.errors.owner) || U.describeError(res, "activities");
            ed.msg.hidden = false;
          }
        });
        return;
      }
      const reasonIn = document.createElement("input");
      reasonIn.className = "inp";
      reasonIn.placeholder = "e.g. client postponed; deal now tracked in the pipeline";
      const ed = editorShell(isDeal ? "Dismiss deal-close reminder" : "Dismiss follow-up reminder", "Dismiss", [reasonIn], null);
      ed.save.addEventListener("click", async () => {
        ed.save.disabled = true;
        const res = await dismissItem(store, it, reasonIn.value);
        if (res.ok) {
          window.CRM.toast("Reminder dismissed — reason recorded.");
          onChanged();
        } else {
          ed.save.disabled = false;
          ed.msg.className = "rm-edit-msg err";
          ed.msg.textContent = (res.errors && res.errors.reason) || U.describeError(res, "activities");
          ed.msg.hidden = false;
        }
      });
    }
    return row;
  }

  async function renderMain(ctx, initialFilter) {
    const store = ctx.store;
    const wrap = el("div");
    const headCard = el("section", "card rm-head");
    headCard.dataset.rmHead = "1";
    const hr = el("div", "card-title-row");
    const hleft = el("div");
    hleft.appendChild(el("h2", null, "Reminders"));
    hleft.appendChild(el("p", "hint", "Overdue and due-soon follow-ups plus deals closing within " + HORIZON_DAYS + " days. Snooze, reschedule, reassign or dismiss — every action is written to the activity log."));
    hr.appendChild(hleft);
    const hright = el("div", "detail-acts");
    const digestBtn = document.createElement("a");
    digestBtn.className = "btn btn-ghost btn-sm";
    digestBtn.href = "#/reminders/digest";
    digestBtn.textContent = "Daily digest";
    digestBtn.dataset.rmDigest = "1";
    hright.appendChild(digestBtn);
    const rulesBtn = document.createElement("a");
    rulesBtn.className = "btn btn-ghost btn-sm";
    rulesBtn.href = "#/rules";
    rulesBtn.textContent = "Automation";
    rulesBtn.dataset.rmRules = "1";
    hright.appendChild(rulesBtn);
    const logBtn = document.createElement("a");
    logBtn.className = "btn btn-primary btn-sm";
    logBtn.href = "#/activities/log";
    logBtn.textContent = "＋ Log activity";
    logBtn.dataset.rmLog = "1";
    hright.appendChild(logBtn);
    hr.appendChild(hright);
    headCard.appendChild(hr);
    const seg = el("div", "seg rm-filt");
    seg.dataset.rmFilt = "1";
    const views = [["all", "All"], ["overdue", "Overdue"], ["due", "Due soon"], ["closing", "Deal closures"]];
    let active = initialFilter || "all";
    if (active !== "all" && !views.some(v => v[0] === active)) active = "all";
    const viewBtns = {};
    views.forEach(v => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v[1];
      b.dataset.view = v[0];
      if (v[0] === active) b.classList.add("on");
      viewBtns[v[0]] = b;
      seg.appendChild(b);
    });
    headCard.appendChild(seg);
    wrap.appendChild(headCard);

    const body = el("div");
    wrap.appendChild(body);
    const maps = await loadMaps(store);
    let state = { active };

    function matchesFilter(it) {
      if (state.active === "all") return true;
      if (state.active === "overdue") return it.kind === "task" && it.overdue;
      if (state.active === "due") return it.kind === "task" && !it.overdue;
      if (state.active === "closing") return it.kind === "deal";
      return true;
    }

    async function paint() {
      const items = await collect(store);
      const c = { overdue: items.filter(i => i.kind === "task" && i.overdue).length, due: items.filter(i => i.kind === "task" && !i.overdue).length, closing: items.filter(i => i.kind === "deal").length };
      views.forEach(v => {
        const n = v[0] === "overdue" ? c.overdue : v[0] === "due" ? c.due : v[0] === "closing" ? c.closing : items.length;
        viewBtns[v[0]].textContent = v[1] + (v[0] === "all" ? "" : " (" + n + ")");
      });
      const list = el("div", "rm-list");
      const filtered = items.filter(matchesFilter);
      const rowCounts = el("div", "rm-counts");
      rowCounts.appendChild(el("span", "chip", c.overdue + " overdue · " + c.due + " due soon · " + c.closing + " closing"));
      list.appendChild(rowCounts);
      if (!filtered.length) {
        list.appendChild(el("p", "hint muted-line", items.length ? "Nothing in this view." : "No reminders right now — open follow-up tasks due in the next " + HORIZON_DAYS + " days and open deals with a close date inside that window will appear here."));
      }
      filtered.forEach(it => list.appendChild(itemRow(it, maps, store, repaint)));
      const dism = await dismissedItems(store);
      if (dism.length) {
        const dhead = el("button", "rm-dhead");
        dhead.type = "button";
        dhead.textContent = "Dismissed (" + dism.length + ")";
        list.appendChild(dhead);
        const dlist = el("div");
        dlist.hidden = true;
        dism.forEach(it => {
          const r = el("div", "tl-row rm-row rm-dismissed");
          r.dataset.rmDismissed = "1";
          const main = el("div", "tl-main");
          const t = el("div", "tl-title");
          t.appendChild(document.createTextNode(itemTitle(it)));
          main.appendChild(t);
          const why = "dismissed " + R.timeAgo(it.dismissed.at) + " · " + it.dismissed.reason;
          main.appendChild(el("div", "tl-sub", why));
          r.appendChild(main);
          const rest = document.createElement("button");
          rest.type = "button";
          rest.className = "btn btn-ghost btn-sm";
          rest.textContent = "Restore";
          rest.dataset.rmRestore = "1";
          rest.addEventListener("click", async () => {
            rest.disabled = true;
            const res = await restoreItem(store, it);
            if (res.ok) { window.CRM.toast("Reminder restored."); repaint(); }
            else { rest.disabled = false; window.CRM.toast("Could not restore."); }
          });
          r.appendChild(rest);
          dlist.appendChild(r);
        });
        dhead.addEventListener("click", () => { dlist.hidden = !dlist.hidden; });
        list.appendChild(dlist);
      }
      body.innerHTML = "";
      body.appendChild(list);
    }
    function repaint() {
      paint();
    }
    views.forEach(v => {
      viewBtns[v[0]].addEventListener("click", () => {
        state.active = v[0];
        views.forEach(x => viewBtns[x[0]].classList.toggle("on", x[0] === v[0]));
        paint();
      });
    });
    await paint();
    return wrap;
  }

  async function digest(store) {
    const items = await collect(store);
    const today = todayISO();
    const out = {
      at: new Date().toISOString(),
      overdue: [],
      dueToday: [],
      dueSoon: [],
      closing: [],
      newLeads: [],
      followupCount: 0,
      closingCount: 0
    };
    for (const it of items) {
      if (it.kind === "deal") out.closing.push(it);
      else if (it.overdue) out.overdue.push(it);
      else if (it.due === today) out.dueToday.push(it);
      else out.dueSoon.push(it);
    }
    out.followupCount = out.overdue.length + out.dueToday.length + out.dueSoon.length;
    out.closingCount = out.closing.length;
    try {
      const doc = await store.loadDoc("leads");
      const cutoff = new Date(Date.now() - DAY).toISOString();
      const open = ["new", "contacted", "qualified"];
      const leads = R.recordsOf(doc && doc.content).filter(l => {
        if (open.indexOf(l.status) === -1) return false;
        const c = l.createdAt || l.updatedAt || "";
        return c >= cutoff;
      });
      leads.sort((a, b) => String(b.createdAt || b.updatedAt).localeCompare(String(a.createdAt || a.updatedAt)));
      out.newLeads = leads;
    } catch (e) {}
    return out;
  }

  function digestText(d, maps) {
    const L = [];
    const head = "Daily digest · " + R.fmtDate(d.at) + "\n" + "=".repeat(40);
    L.push(head);
    const sec = title => { L.push(""); L.push(title); L.push("-".repeat(title.length)); };
    const fmtItem = it => {
      const links = itemLinks(it, maps);
      const linkText = links.length ? " (" + links.map(c => c.name).join(", ") + ")" : "";
      const owner = it.rec.owner ? " · owner: " + it.rec.owner : "";
      return "  " + itemTitle(it) + " — " + fmtWhen(it) + owner + linkText;
    };
    sec("Overdue follow-ups (" + d.overdue.length + ")");
    if (d.overdue.length) d.overdue.forEach(it => L.push(fmtItem(it)));
    else L.push("  none");
    sec("Due today (" + d.dueToday.length + ")");
    if (d.dueToday.length) d.dueToday.forEach(it => L.push(fmtItem(it)));
    else L.push("  none");
    sec("Due in the next 7 days (" + d.dueSoon.length + ")");
    if (d.dueSoon.length) d.dueSoon.forEach(it => L.push(fmtItem(it)));
    else L.push("  none");
    sec("Deals closing or overdue to close (" + d.closing.length + ")");
    if (d.closing.length) d.closing.forEach(it => L.push(fmtItem(it)));
    else L.push("  none");
    sec("New leads (" + d.newLeads.length + ")");
    if (d.newLeads.length) d.newLeads.forEach(l => L.push("  " + (l.name || l.subject) + (l.owner ? " · owner: " + l.owner : "") + " · source: " + (l.source || "—")));
    else L.push("  none");
    L.push("");
    L.push("Total: " + (d.followupCount + d.closingCount + d.newLeads.length) + " items need attention today.");
    return L.join("\n");
  }

  async function renderDigest(ctx) {
    const store = ctx.store;
    const wrap = el("div");
    const maps = await loadMaps(store);
    const card = el("section", "card");
    card.dataset.rmDigestCard = "1";
    const titleRow = el("div", "card-title-row");
    titleRow.appendChild(el("h2", null, "Daily digest"));
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/reminders";
    back.textContent = "← All reminders";
    wrap.appendChild(back);
    wrap.appendChild(card);
    card.appendChild(titleRow);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);
    const body = el("div");
    card.appendChild(body);

    const d = await digest(store);
    const pre = el("pre", "digest-pre");
    pre.textContent = digestText(d, maps);
    pre.dataset.rmDigestText = "1";
    const groups = el("div", "digest-groups");
    const mkGroup = (title, arr, kind) => {
      const sec = el("div", "digest-group");
      sec.appendChild(el("h3", null, title + " (" + arr.length + ")"));
      if (!arr.length) {
        sec.appendChild(el("p", "hint muted-line", "Nothing here — good."));
        return sec;
      }
      arr.forEach(it => {
        const row = el("div", "tl-row q-row");
        const main = el("div", "tl-main");
        const t = el("div", "tl-title");
        if (kind === "lead") {
          t.appendChild(document.createTextNode(it.name || it.subject || it.id));
          if (it.owner) t.appendChild(el("span", "badge active", it.owner));
        } else {
          t.appendChild(document.createTextNode(itemTitle(it)));
          if (it.overdue) t.appendChild(el("span", "badge inactive", "overdue"));
        }
        main.appendChild(t);
        const links = kind === "lead" ? itemLinks({ kind: "lead", id: it.id, rec: it }, maps) : itemLinks(it, maps);
        const chips = el("span", "ac-chips");
        links.forEach(c => {
          const a = document.createElement("a");
          a.href = "#/" + c.m + "/" + encodeURIComponent(c.id);
          a.textContent = c.name;
          a.className = "tag-pill";
          chips.appendChild(a);
        });
        if (chips.children.length) main.appendChild(chips);
        row.appendChild(main);
        if (kind === "lead") row.appendChild(el("span", "q-due", "source: " + (it.source || "—") + " · " + R.timeAgo(it.createdAt || it.updatedAt)));
        else row.appendChild(el("span", "q-due" + (it.overdue ? " od" : ""), fmtWhen(it)));
        sec.appendChild(row);
      });
      return sec;
    };
    groups.appendChild(mkGroup("Overdue follow-ups", d.overdue, "task"));
    groups.appendChild(mkGroup("Due today", d.dueToday, "task"));
    groups.appendChild(mkGroup("Due in the next 7 days", d.dueSoon, "task"));
    groups.appendChild(mkGroup("Deals closing or overdue to close", d.closing, "deal"));
    groups.appendChild(mkGroup("New leads", d.newLeads, "lead"));
    const summary = el("div", "rm-summary");
    summary.appendChild(el("span", "chip", d.followupCount + " follow-ups"));
    summary.appendChild(el("span", "chip", d.closingCount + " closing deals"));
    summary.appendChild(el("span", "chip", d.newLeads.length + " new leads"));
    body.appendChild(summary);
    body.appendChild(groups);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-primary btn-sm";
    copyBtn.textContent = "Copy as text";
    copyBtn.dataset.rmCopy = "1";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        window.CRM.toast("Digest copied — paste it into email or chat.");
      } catch (e) {
        try {
          const ta = document.createElement("textarea");
          ta.value = pre.textContent;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          window.CRM.toast("Digest copied — paste it into email or chat.");
        } catch (e2) {
          msg.className = "bkp-msg err";
          msg.textContent = "Copy failed — select the text below and copy manually.";
          msg.hidden = false;
        }
      }
    });
    const foot = el("div", "form-acts");
    foot.appendChild(copyBtn);
    card.appendChild(foot);
    card.appendChild(el("p", "hint", "The plain-text bundle above is the whole day at a glance — due follow-ups, closing deals and new leads — ready to paste into a team channel."));
    card.appendChild(pre);
    return wrap;
  }

  async function view(ctx) {
    const p = ctx.params || [];
    if (p[0] === "digest") return renderDigest(ctx);
    const filter = ["all", "overdue", "due", "closing"].indexOf(p[0]) !== -1 ? p[0] : "all";
    return renderMain(ctx, filter);
  }

  return {
    DAY,
    HORIZON_DAYS,
    localDateISO,
    todayISO,
    addDaysISO,
    collect,
    counts,
    dismissedItems,
    snoozeItem,
    rescheduleItem,
    reassignItem,
    dismissItem,
    restoreItem,
    digest,
    view,
    itemTitle,
    digestText
  };
})();
window.CRM_RENDERERS.reminders = function (ctx) {
  return window.CRM_REMINDERS ? window.CRM_REMINDERS.view(ctx) : null;
};
