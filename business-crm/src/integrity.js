window.CRM_HEALTH = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const esc = R.esc;

  const MODS = ["companies", "contacts", "leads", "deals", "activities"];
  const DETAIL = {
    companies: { label: "company", href: m => "#/companies" },
    contacts: { label: "contact", href: m => "#/contacts" },
    leads: { label: "lead", href: m => "#/leads" },
    deals: { label: "deal", href: m => "#/deals" },
    activities: { label: "activity", href: m => "#/activities" }
  };
  const ROUTE = { companies: "companies", contacts: "contacts", leads: "leads", deals: "deals", activities: "activities" };

  function byId(list) {
    const m = new Map();
    (list || []).forEach(r => { if (r && r.id !== undefined && r.id !== null) m.set(String(r.id), r); });
    return m;
  }

  function pairDismissed(a, b) {
    const da = Array.isArray(a && a.dupDismissed) ? a.dupDismissed : [];
    const db = Array.isArray(b && b.dupDismissed) ? b.dupDismissed : [];
    return da.indexOf(b.id) !== -1 || db.indexOf(a.id) !== -1;
  }

  function problemsFor(docs) {
    docs = docs || {};
    const companies = docs.companies || [];
    const contacts = docs.contacts || [];
    const leads = docs.leads || [];
    const deals = docs.deals || [];
    const activities = docs.activities || [];
    const problems = [];
    const cmap = byId(companies);
    const ctmap = byId(contacts);
    const lmap = byId(leads);
    const dmap = byId(deals);

    const p = (code, sev, module, opts) => {
      opts = opts || {};
      const base = DETAIL[module] || { label: module, href: () => "#/" + module };
      const rec = opts.rec;
      const recId = opts.recId || (rec && rec.id !== undefined && rec.id !== null ? String(rec.id) : undefined);
      const name = opts.name || (rec ? R.recordName(rec) : "") || (recId ? "record " + recId : "");
      const href = opts.href || (recId ? "#/" + ROUTE[module] + "/" + encodeURIComponent(recId) : base.href());
      problems.push({ code, sev, module, recId, name, title: opts.title || code, detail: opts.detail || "", href, action: opts.action || "", hrefText: opts.hrefText || name || ("Open " + base.label + "s") });
    };

    if (window.CRM_DUP) {
      window.CRM_DUP.candidatePairs("companies", companies).forEach(pair => {
        if (pairDismissed(pair.a, pair.b)) return;
        p("dup_companies", "warn", "companies", {
          rec: pair.a, name: R.recordName(pair.a) + " and " + R.recordName(pair.b),
          title: "Possible duplicate companies",
          detail: "\u201C" + R.recordName(pair.a) + "\u201D and \u201C" + R.recordName(pair.b) + "\u201D look like the same account (" + pair.reasons.join(", ") + ").",
          href: "#/companies", hrefText: "Open Companies",
          action: "Review and merge them on the Companies page, or dismiss the pair."
        });
      });
      window.CRM_DUP.candidatePairs("contacts", contacts).forEach(pair => {
        if (pairDismissed(pair.a, pair.b)) return;
        p("dup_contacts", "warn", "contacts", {
          rec: pair.a, name: R.recordName(pair.a) + " and " + R.recordName(pair.b),
          title: "Possible duplicate contacts",
          detail: "\u201C" + R.recordName(pair.a) + "\u201D and \u201C" + R.recordName(pair.b) + "\u201D look like the same person (" + pair.reasons.join(", ") + ").",
          href: "#/contacts", hrefText: "Open Contacts",
          action: "Review and merge them on the Contacts page, or dismiss the pair."
        });
      });
    }

    contacts.forEach(c => {
      if (!c || !c.companyId) return;
      if (!cmap.has(String(c.companyId))) {
        p("orphan_contact", "err", "contacts", {
          rec: c,
          title: "Contact points at a missing company",
          detail: "This contact links to \u201C" + c.companyId + "\u201D, which no longer exists.",
          action: "Open the contact and re-link it to a company, or clear the link to make it standalone."
        });
      }
    });

    leads.forEach(l => {
      if (!l) return;
      if (l.status === "converted") {
        if (!l.convertedToDealId) {
          p("lead_converted_no_deal", "err", "leads", {
            rec: l, title: "Converted lead has no deal",
            detail: "The lead is marked converted but no deal was created from it.",
            action: "Convert it again from the lead page, or reopen the lead."
          });
        } else if (!dmap.has(String(l.convertedToDealId))) {
          p("lead_converted_dangling", "warn", "leads", {
            rec: l, title: "Converted lead points at a missing deal",
            detail: "The lead points at deal \u201C" + l.convertedToDealId + "\u201D, which no longer exists.",
            action: "Reopen the lead or point it at the real deal."
          });
        }
        if (!l.convertedAt) {
          p("lead_converted_no_date", "warn", "leads", {
            rec: l, title: "Converted lead has no timestamp",
            detail: "Conversion dates feed the cycle-time reports; this lead has none recorded.",
            action: "Reopen and reconvert the lead to stamp the date."
          });
        }
      }
      if (l.status === "disqualified" && !l.disqualifyReason && !l.disqualifiedAt) {
        p("lead_disqualified_bare", "warn", "leads", {
          rec: l, title: "Disqualified lead without a reason or date",
          detail: "Disqualification normally records a reason and timestamp.",
          action: "Disqualify it again with a reason, or reopen it."
        });
      }
    });

    deals.forEach(d => {
      if (!d) return;
      const won = d.stage === "won";
      const lost = d.stage === "lost";
      if (d.companyId && !cmap.has(String(d.companyId))) {
        p("deal_no_company", "err", "deals", {
          rec: d, title: "Deal links to a missing company",
          detail: "This deal links to \u201C" + d.companyId + "\u201D, which no longer exists.",
          action: "Open the deal and re-link it to a company."
        });
      }
      if (d.contactId && !ctmap.has(String(d.contactId))) {
        p("deal_no_contact", "err", "deals", {
          rec: d, title: "Deal links to a missing contact",
          detail: "This deal links to contact \u201C" + d.contactId + "\u201D, which no longer exists.",
          action: "Open the deal and re-link or clear the contact."
        });
      }
      if (won && !d.wonAt) {
        p("deal_won_no_date", "warn", "deals", {
          rec: d, title: "Won deal has no won date",
          detail: "The deal is closed as won but has no won date, so win-rate and cycle-time figures will miss it.",
          action: "Reopen the deal and win it again to stamp the date."
        });
      }
      if (lost && !d.lostAt) {
        p("deal_lost_no_date", "warn", "deals", {
          rec: d, title: "Lost deal has no lost date",
          detail: "The deal is closed as lost but has no lost date, so win-rate figures will miss it.",
          action: "Reopen the deal and close it as lost again."
        });
      }
      if (d.wonAt && d.lostAt) {
        p("deal_terminal_conflict", "warn", "deals", {
          rec: d, title: "Deal has both won and lost dates",
          detail: "A deal can only be won or lost — having both makes reports unreliable.",
          action: "Open the deal and correct its stage."
        });
      }
      if (d.convertedToCustomerAt && !won) {
        p("deal_converted_not_won", "warn", "deals", {
          rec: d, title: "Deal records a customer conversion but is not won",
          detail: "Only won deals convert to customers.",
          action: "Reopen and re-win the deal, or clear the stray conversion date."
        });
      }
      if (d.convertedToCustomerAt) {
        const co = d.companyId ? cmap.get(String(d.companyId)) : null;
        if (!co) {
          p("deal_converted_no_company", "warn", "deals", {
            rec: d, title: "Customer conversion with no linked company",
            detail: "The deal converted to a customer, but it has no company to flag.",
            action: "Link the deal to its company and mark the company as a customer."
          });
        } else if (co.isCustomer !== true) {
          p("deal_converted_customer_mismatch", "warn", "deals", {
            rec: d, title: "Deal converted but company is not a customer",
            detail: "The deal says it converted \u201C" + R.recordName(co) + "\u201D to a customer, but the company is not flagged as one.",
            action: "Open the company and tick \u201CCustomer\u201D, or clear the deal's conversion date."
          });
        }
      }
    });

    companies.forEach(c => {
      if (!c) return;
      if (c.customerSince && c.isCustomer !== true) {
        p("company_customer_flag_missing", "warn", "companies", {
          rec: c, title: "Customer since date without the customer flag",
          detail: "This company has a \u201Ccustomer since\u201D date but is not flagged as a customer.",
          action: "Open the company and tick \u201CCustomer\u201D, or clear the date."
        });
      }
    });

    activities.forEach(a => {
      if (!a) return;
      const missing = [];
      if (a.companyId && !cmap.has(String(a.companyId))) missing.push("company \u201C" + a.companyId + "\u201D");
      if (a.contactId && !ctmap.has(String(a.contactId))) missing.push("contact \u201C" + a.contactId + "\u201D");
      if (a.dealId && !dmap.has(String(a.dealId))) missing.push("deal \u201C" + a.dealId + "\u201D");
      if (a.leadId && !lmap.has(String(a.leadId))) missing.push("lead \u201C" + a.leadId + "\u201D");
      if (missing.length) {
        p("activity_orphan_ref", "err", "activities", {
          rec: a, name: R.recordName(a) + " (" + a.id + ")",
          title: "Activity links to missing records",
          detail: "This activity references " + missing.join(", ") + ".",
          href: "#/activities", hrefText: "Open Activities",
          action: "Review the activity on the Activities page and re-link its records."
        });
      }
    });

    problems.sort((x, y) => (x.sev === y.sev ? 0 : x.sev === "err" ? -1 : 1));
    const truncated = problems.length > 80;
    const shown = truncated ? problems.slice(0, 80) : problems;
    const errs = problems.filter(x => x.sev === "err").length;
    const warns = problems.filter(x => x.sev === "warn").length;
    return { problems: shown, truncated, counts: { err: errs, warn: warns }, ok: errs === 0 && warns === 0 };
  }

  let last = null;
  let changedSinceCheck = false;
  let timer = null;
  let attached = false;

  async function fetchDocs(store) {
    const docs = {};
    const unavailable = [];
    for (const mod of MODS) {
      try {
        const doc = await store.loadDoc(mod);
        if (!doc || doc.ok === false) {
          docs[mod] = [];
          unavailable.push(mod);
        } else {
          docs[mod] = (doc.content && Array.isArray(doc.content.records)) ? doc.content.records : [];
        }
      } catch (e) {
        docs[mod] = [];
        unavailable.push(mod);
      }
    }
    return { docs, unavailable };
  }

  async function check(store) {
    const t0 = Date.now();
    const { docs, unavailable } = await fetchDocs(store);
    const res = problemsFor(docs);
    last = {
      ok: res.ok,
      problems: res.problems,
      truncated: res.truncated,
      counts: res.counts,
      unavailable,
      total: res.counts.err + res.counts.warn,
      ranAt: new Date().toISOString(),
      tookMs: Date.now() - t0
    };
    changedSinceCheck = false;
    return last;
  }

  function schedule(store, ms) {
    changedSinceCheck = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      check(store).catch(() => {}).then(() => refreshViews());
    }, ms === undefined ? 1200 : ms);
  }

  const views = new Set();

  function refreshViews() {
    views.forEach(fn => {
      try { fn(); } catch (e) { console.error("CRM_HEALTH view refresh failed:", e); }
    });
  }

  function statusChip(state) {
    if (!state) return '<span class="chip pending">checking…</span>';
    if (state.unavailable && state.unavailable.length === MODS.length && state.total === 0) {
      return '<span class="chip pending">unavailable</span>';
    }
    if (state.total === 0) return '<span class="chip ok">all clear</span>';
    const bits = [];
    if (state.counts.err) bits.push(state.counts.err + " error" + (state.counts.err === 1 ? "" : "s"));
    if (state.counts.warn) bits.push(state.counts.warn + " warning" + (state.counts.warn === 1 ? "" : "s"));
    return '<span class="chip fail">' + bits.join(" · ") + "</span>";
  }

  async function zone(store) {
    const card = el("section", "card dash-health");
    card.setAttribute("data-health", "1");
    const refresher = () => { if (card.isConnected) render(card, store); else views.delete(refresher); };
    views.add(refresher);
    try { await check(store); } catch (e) {}
    render(card, store);
    return card;
  }

  function render(card, store) {
    const state = last;
    const busy = !state;
    const head = el("div", "card-title-row");
    const titleBox = el("div");
    const h = el("h2", null, "Data integrity");
    const sub = el("p", "hint");
    sub.style.margin = "2px 0 0";
    sub.textContent = busy
      ? "Checking every record for broken links and inconsistencies…"
      : "Automated checks run after every change — broken links, duplicates and inconsistent dates surface here.";
    titleBox.appendChild(h);
    titleBox.appendChild(sub);
    head.appendChild(titleBox);
    const chipWrap = el("div");
    chipWrap.style.display = "flex";
    chipWrap.style.flexDirection = "column";
    chipWrap.style.alignItems = "flex-end";
    chipWrap.style.gap = "6px";
    chipWrap.innerHTML = statusChip(state);
    head.appendChild(chipWrap);
    card.replaceChildren(head);

    if (busy) {
      const row = el("p", "hint", "Scanning the document store…");
      row.style.marginTop = "12px";
      card.appendChild(row);
      return;
    }

    if (state.unavailable.length) {
      const u = el("p", "hint");
      u.style.marginTop = "10px";
      u.textContent = "Couldn't read the " + state.unavailable.join(", ") + " document" + (state.unavailable.length === 1 ? "" : "s") + " yet — records created on this device will be checked once they sync.";
      card.appendChild(u);
    }

    const list = el("div", "health-list");
    if (state.problems.length === 0 && state.unavailable.length === 0) {
      const row = el("div", "health-none");
      row.innerHTML = '<span class="health-dot" style="background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)"></span><span><strong>No issues found.</strong> Every record links to something that exists, nothing looks duplicated, and dates line up.</span>';
      list.appendChild(row);
    } else if (state.problems.length === 0) {
      const row = el("p", "hint", "No issues found in the documents that could be read.");
      row.style.margin = "10px 0 0";
      list.appendChild(row);
    }

    state.problems.forEach(pr => {
      const row = el("div", "health-row " + (pr.sev === "err" ? "health-err" : "health-warn"));
      const dot = el("span", "health-mark", pr.sev === "err" ? "!" : "?");
      const body = el("div", "health-body");
      const t = el("div", "health-title", pr.title);
      body.appendChild(t);
      const d = el("div", "health-detail", pr.detail);
      body.appendChild(d);
      const acts = el("div", "health-acts");
      const link = document.createElement("a");
      link.className = "btn btn-ghost btn-sm";
      link.href = pr.href;
      link.textContent = pr.hrefText || "Open";
      acts.appendChild(link);
      if (pr.action) {
        const hint = el("span", "hint", pr.action);
        acts.appendChild(hint);
      }
      body.appendChild(acts);
      row.appendChild(dot);
      row.appendChild(body);
      list.appendChild(row);
    });

    if (state.truncated) {
      list.appendChild(el("p", "hint", "…and more issues. Fix the ones above first — the list updates as you go."));
    }

    card.appendChild(list);

    const foot = el("div", "health-foot");
    const when = el("span", "hint", "Last checked " + R.timeAgo(state.ranAt) + " · over " + MODS.length + " documents in " + state.tookMs + " ms");
    foot.appendChild(when);
    const right = el("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";
    if (changedSinceCheck) {
      const stale = el("span", "chip pending", "data changed");
      right.appendChild(stale);
    }
    const btn = el("button", "btn btn-ghost btn-sm", "Re-check now");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Checking…";
      try {
        await check(store);
      } catch (e) {
        window.CRM && window.CRM.toast ? window.CRM.toast("Health check failed: " + ((e && e.message) || e)) : null;
      }
      if (card.isConnected) render(card, store);
    });
    right.appendChild(btn);
    foot.appendChild(right);
    card.appendChild(foot);
  }

  function attach(store) {
    if (attached) return;
    attached = true;
    window.CRM_EVENTS.on("moduleWrite", data => {
      if (data && data.store && data.store !== store) return;
      schedule(store);
    });
  }

  return {
    problemsFor,
    check,
    last: () => last,
    schedule,
    attach,
    changedSinceCheck: () => changedSinceCheck,
    zone
  };
})();

window.CRM_BOOT_HOOKS = window.CRM_BOOT_HOOKS || [];
window.CRM_BOOT_HOOKS.push(async store => {
  try {
    window.CRM_HEALTH.attach(store);
    await window.CRM_HEALTH.check(store);
  } catch (e) {
    console.error("CRM_HEALTH boot check failed:", e);
  }
});
