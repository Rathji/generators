window.CRM_SUGGEST = (function () {
  const R = window.CRM_RECORDS;
  const A = window.CRM_ACTIVITIES;
  const TL = window.CRM_TIMELINE;
  if (!R || !A || !TL) return null;

  const DAY = 86400000;

  async function scopeActivities(store, rec) {
    const doc = await store.loadDoc("activities");
    const recs = ((doc && doc.content && doc.content.records) || []).slice();
    const out = recs.filter(a => {
      if (rec.id && (a.leadId === rec.id || a.dealId === rec.id)) return true;
      if (a.contactId && rec.contactId && a.contactId === rec.contactId) return true;
      if (a.companyId && rec.companyId && a.companyId === rec.companyId) return true;
      return false;
    });
    out.sort((x, y) => String(y.at || y.createdAt).localeCompare(String(x.at || x.createdAt)));
    return out;
  }

  function dismissedBefore(rec, ruleId, sinceIso) {
    const list = Array.isArray(rec.dismissedNext) ? rec.dismissedNext : [];
    const hit = list.find(d => d.rule === ruleId);
    return !!(hit && hit.at && (!sinceIso || hit.at >= sinceIso));
  }

  function evalRules(rec, acts, now) {
    const latest = acts[0] || null;
    const isOpen = rec.stage !== undefined ? rec.stage !== "won" && rec.stage !== "lost" : rec.status !== "converted" && rec.status !== "disqualified";
    if (!isOpen) return null;

    if (latest && latest.type === "email") {
      const noReply = !latest.repliedAt && (!latest.outcome || latest.outcome === "sent" || latest.outcome === "awaiting");
      const age = latest.at ? now - new Date(latest.at).getTime() : Infinity;
      if (noReply && age > 5 * DAY) {
        if (dismissedBefore(rec, "remind", latest.at)) return null;
        const who = rec._contactName || (rec.name ? "the contact" : "them");
        return {
          rule: "remind",
          title: "Remind " + who + " — no reply to “" + truncate(latest.subject, 60) + "”",
          body: "The last email on this record went out " + Math.round(age / DAY) + " days ago with no reply. A short nudge keeps the thread alive.",
          dueInDays: 1,
          priority: "high",
          taskTitle: "Follow up on “" + truncate(latest.subject, 70) + "” — no reply in " + Math.round(age / DAY) + " days"
        };
      }
    }

    if (latest && (latest.type === "call" || latest.type === "meeting")) {
      if (dismissedBefore(rec, "followup", latest.at)) return null;
      return {
        rule: "followup",
        title: "Follow up after " + TL.typeLabel(latest.type),
        body: "You " + (latest.type === "call" ? "called" : "met") + " on " + R.fmtDate(latest.at) + ". A follow-up within three days keeps momentum — send the notes, pricing or next meeting invite.",
        dueInDays: 3,
        priority: "med",
        taskTitle: "Follow up after " + TL.typeLabel(latest.type) + " · " + (latest.subject || "last " + latest.type)
      };
    }

    const recCreated = rec.createdAt ? new Date(rec.createdAt).getTime() : now;
    if (!acts.length && (now - recCreated) > 7 * DAY) {
      if (dismissedBefore(rec, "touchbase", rec.stageEnteredAt || rec.updatedAt || rec.createdAt)) return null;
      return {
        rule: "touchbase",
        title: rec.stage !== undefined ? "Deal has been quiet for " + Math.round((now - recCreated) / DAY) + " days" : "Lead has been quiet for " + Math.round((now - recCreated) / DAY) + " days",
        body: "No activity has been logged on this " + (rec.stage !== undefined ? "deal" : "lead") + " yet. A quick call or note keeps the record honest and warm.",
        dueInDays: 2,
        priority: "med",
        taskTitle: "Touch base on " + (rec.name || "this record") + " — log a call or meeting"
      };
    }

    if (rec.stage !== undefined && rec.stageEnteredAt && !rec.closeDate) {
      if (dismissedBefore(rec, "setclose")) return null;
      return {
        rule: "setclose",
        title: "Set an expected close date",
        body: "This deal has no close date, so it will never surface in forecast or reminders. Estimate one to keep the pipeline accurate.",
        dueInDays: 0,
        priority: "med",
        taskTitle: "Set a close date on " + (rec.name || "this deal")
      };
    }

    return null;
  }

  function truncate(s, n) {
    const str = String(s || "");
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  }

  async function evaluate(store, rec) {
    if (!rec || !rec.id) return null;
    const rec2 = Object.assign({}, rec);
    if (rec2.contactId) {
      try {
        const doc = await store.loadDoc("contacts");
        const c = doc && doc.content ? R.getRecord(doc.content, rec2.contactId) : null;
        if (c) rec2._contactName = c.name;
      } catch (e) {}
    }
    const acts = await scopeActivities(store, rec2);
    return evalRules(rec2, acts, Date.now());
  }

  async function accept(store, rec, suggestion) {
    const module = rec.stage !== undefined ? "deals" : "leads";
    const values = {
      type: "task",
      subject: suggestion.taskTitle || suggestion.title,
      notes: suggestion.body,
      at: new Date().toISOString(),
      owner: rec.owner || "",
      priority: suggestion.priority || "med",
      companyId: rec.companyId,
      contactId: rec.contactId,
      dealId: module === "deals" ? rec.id : undefined,
      leadId: module === "leads" ? rec.id : undefined
    };
    if (suggestion.dueInDays) {
      const d = new Date(Date.now() + suggestion.dueInDays * DAY);
      const p = n => String(n).padStart(2, "0");
      values.dueDate = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    }
    return A.create(store, values);
  }

  async function dismiss(store, rec, ruleId) {
    const module = rec.stage !== undefined ? "deals" : "leads";
    return R.persistUpdate(store, module, content => {
      const r = R.getRecord(content, rec.id);
      if (!r) return { changed: false };
      if (!Array.isArray(r.dismissedNext)) r.dismissedNext = [];
      r.dismissedNext = r.dismissedNext.filter(d => d.rule !== ruleId);
      r.dismissedNext.push({ rule: ruleId, at: R.nowISO() });
      r.updatedAt = R.nowISO();
      return { changed: true, content };
    });
  }

  async function clearDismissals(store, rec, ruleId) {
    const module = rec.stage !== undefined ? "deals" : "leads";
    return R.persistUpdate(store, module, content => {
      const r = R.getRecord(content, rec.id);
      if (!r || !Array.isArray(r.dismissedNext)) return { changed: false };
      const before = r.dismissedNext.length;
      r.dismissedNext = r.dismissedNext.filter(d => d.rule !== ruleId);
      r.updatedAt = R.nowISO();
      return { changed: before !== r.dismissedNext.length, content };
    });
  }

  async function card(store, rec, opts) {
    opts = opts || {};
    const sug = await evaluate(store, rec);
    const card = R.el("section", "card sg-card");
    card.dataset.sgCard = "1";
    const row = R.el("div", "card-title-row");
    row.appendChild(R.el("h2", null, "Suggested next step"));
    card.appendChild(row);
    if (!sug) {
      const p = R.el("p", "hint muted-line", "No next step suggested right now. As the record ages or activity comes in, a suggestion will appear here.");
      p.style.marginTop = "6px";
      card.appendChild(p);
      return card;
    }
    const body = R.el("div", "sg-body");
    const ic = R.el("span", "sg-ic", "→");
    const main = R.el("div", "tl-main");
    main.appendChild(R.el("div", "tl-title", sug.title));
    main.appendChild(R.el("div", "tl-sub", sug.body));
    const line = R.el("div", "sg-line");
    line.appendChild(ic);
    line.appendChild(main);
    body.appendChild(line);
    const acts = R.el("div", "form-acts");
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "btn btn-primary btn-sm";
    accept.textContent = "Accept — create task";
    accept.dataset.sgAccept = "1";
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "btn btn-ghost btn-sm";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.dataset.sgDismiss = "1";
    acts.appendChild(accept);
    acts.appendChild(dismissBtn);
    body.appendChild(acts);
    card.appendChild(body);

    accept.addEventListener("click", async () => {
      accept.disabled = true;
      const res = await acceptSuggestion(store, rec, sug);
      if (res && res.ok) {
        window.CRM.toast("Follow-up task created.");
        if (window.CRM.rerender) window.CRM.rerender();
      } else {
        accept.disabled = false;
        window.CRM.toast("Could not create the task.");
      }
    });
    dismissBtn.addEventListener("click", async () => {
      dismissBtn.disabled = true;
      const res = await dismiss(store, rec, sug.rule);
      if (res && res.ok) {
        window.CRM.toast("Suggestion dismissed.");
        if (window.CRM.rerender) window.CRM.rerender();
      } else dismissBtn.disabled = false;
    });
    return card;
  }

  async function acceptSuggestion(store, rec, sug) {
    const res = await accept(store, rec, sug);
    return res;
  }

  return {
    DAY,
    evaluate,
    accept,
    dismiss,
    clearDismissals,
    card,
    evalRules,
    scopeActivities
  };
})();
