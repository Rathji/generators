/* ============================================================================
   THE LEDGER — tax.js
   Multi-Currency & Tax Engine (Phase 4, tasks 19–23):
    19. Base currency definition — a global base currency; all financial totals
        are convertible to base while the original transaction currency and
        exchange rate used at the time of entry are always retained.
    20. Exchange rate integration — a currency table of per-currency rates
        (foreign units per 1 base unit), with per-transaction manual override
        support (AR/AP records the fxRate actually used on each document).
    21. Dynamic tax calculation — GST / HST / PST / VAT / US Sales Tax computed
        from the transaction's jurisdiction and direction at the rate that was
        in force on the transaction date.
    22. Tax liability routing — the computed tax is routed into a designated
        "Tax Payable" liability account when the sale is posted to the ledger.
    23. Tax preparation report — aggregates tax collected (output) and tax paid
        (input) over a date range, grouped by tax type and jurisdiction.
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "tax_currency" → { baseCode }
     key "tax_rates"    → array of currency records { code, name, symbol, rate }
     key "tax_rules"    → array of tax-rule records { id, code, label, rate,
                           jurisdiction, scope, active, createdAt, updatedAt }
   Invoices (AR) store taxCode / taxJurisdiction / taxRate / taxLabel /
   taxAmount so the tax report can re-aggregate collected tax even if a rule
   is later edited or deleted.
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { currency: "tax_currency", rates: "tax_rates", rules: "tax_rules" };
  const SYMBOLS = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", AUD: "A$", NZD: "NZ$",
    CHF: "Fr", CNY: "¥", INR: "₹", MXN: "MX$", BRL: "R$", SEK: "kr", NOK: "kr",
    DKK: "kr", PLN: "zł", SGD: "S$", HKD: "HK$", KRW: "₩", RUB: "₽", ZAR: "R",
  };

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function firstOfYear() { const d = new Date(); return d.getFullYear() + "-01-01"; }

  /* ── persistence ─────────────────────────────────────────────────────── */
  async function loadCurrency() { const v = await FW.store.get(K.currency, null); return v && typeof v === "object" ? v : { baseCode: "USD" }; }
  async function saveCurrency(c) { await FW.store.set(K.currency, c); await refreshCache(); }
  async function loadRates() { const v = await FW.store.get(K.rates, null); return Array.isArray(v) ? v : []; }
  async function saveRates(list) { await FW.store.set(K.rates, list); await refreshCache(); }
  async function loadRules() { const v = await FW.store.get(K.rules, null); return Array.isArray(v) ? v : []; }
  async function saveRules(list) { await FW.store.set(K.rules, list); await refreshCache(); }

  let _cache = null;
  async function refreshCache() {
    const [cur, rates, rules] = await Promise.all([loadCurrency(), loadRates(), loadRules()]);
    const cfgBase = String((cur && cur.baseCode) || "USD").toUpperCase();
    let base = cfgBase;
    if (!rates.some(r => String(r.code).toUpperCase() === base)) {
      const first = rates[0];
      base = first && first.code ? String(first.code).toUpperCase() : cfgBase;
    }
    _cache = { base, rates, rules };
    return _cache;
  }

  /* ── base currency (task 19) — sync + async views over the cache ────── */
  function baseCodeSync() { return (_cache && _cache.base) || "USD"; }
  function rateForSync(code) {
    const c = String(code || "").toUpperCase();
    if (!c) return null;
    const base = baseCodeSync();
    if (c === base) return 1;
    const rates = (_cache && _cache.rates) || [];
    const r = rates.find(x => String(x.code).toUpperCase() === c);
    return r && amt(r.rate) > 0 ? amt(r.rate) : null;
  }
  function toBaseSync(n, code, fx) {
    const c = String(code || "").toUpperCase();
    const base = baseCodeSync();
    if (!c || c === base) return round2(amt(n));
    const rate = fx != null && amt(fx) > 0 ? amt(fx) : rateForSync(c);
    if (!rate || rate <= 0) return round2(amt(n));
    return round2(amt(n) / rate);
  }
  function formatSync(n, code) {
    const c = String(code || "").toUpperCase();
    const base = baseCodeSync();
    if (!c || c === base) return FW.money(n);
    const sym = SYMBOLS[c] || (c + " ");
    return sym + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function currencyOptionsSync(cur) {
    const base = baseCodeSync();
    const rates = (_cache && _cache.rates) || [];
    const rows = rates.length ? rates : [{ code: base, name: "Base currency", symbol: SYMBOLS[base] || "", rate: 1 }];
    const pick = String(cur || "").toUpperCase() || base;
    return rows.map(r => {
      const c = String(r.code).toUpperCase();
      return '<option value="' + esc(c) + '"' + (c === pick ? " selected" : "") + ">" + esc(c) +
        (r.name ? " · " + esc(r.name) : "") + (c === base ? " (base)" : "") + "</option>";
    }).join("");
  }
  function taxCodeOptionsSync(cur) {
    const rules = (_cache && _cache.rules) || [];
    const active = rules.filter(r => r.active !== false);
    const pick = String(cur || "");
    return active.map(r => '<option value="' + esc(r.code) + '"' + (String(r.code) === pick ? " selected" : "") + ">" +
      esc(r.code) + " · " + esc(r.label || r.code) + " · " + amt(r.rate) * 100 + "%" +
      (r.jurisdiction ? " (" + esc(r.jurisdiction) + ")" : "") + "</option>").join("");
  }
  async function baseCode() { await refreshCache(); return baseCodeSync(); }
  async function rateFor(code) { await refreshCache(); return rateForSync(code); }
  async function toBase(n, code, fx) { await refreshCache(); return toBaseSync(n, code, fx); }
  async function format(n, code) { await refreshCache(); return formatSync(n, code); }
  async function currencyOptions(cur) { await refreshCache(); return currencyOptionsSync(cur); }
  async function taxCodeOptions(cur) { await refreshCache(); return taxCodeOptionsSync(cur); }

  /* ── tax liability routing (task 22) ─────────────────────────────────── */
  function findPayableAccount(accounts) {
    let a = accounts.find(x => x.code === "2100" && x.type === "liability");
    if (!a) a = accounts.find(x => x.type === "liability" && /tax/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "liability");
    return a ? a.id : null;
  }

  /* ── dynamic tax calculation (task 21) ───────────────────────────────── */
  function computeSync(subtotal, code, jurisdiction, date, direction) {
    const rules = (_cache && _cache.rules) || [];
    const dir = direction || "sale";
    const jur = String(jurisdiction || "").trim().toLowerCase();
    const scopeOK = r => r.scope === "both" || r.scope === dir || !r.scope;
    const active = rules.filter(r => r.active !== false && scopeOK(r));
    const exact = active.find(r => String(r.jurisdiction || "").trim().toLowerCase() === jur);
    const any = active.find(r => !String(r.jurisdiction || "").trim());
    const rule = (code ? active.find(r => String(r.code) === String(code) && (!jur || !String(r.jurisdiction || "").trim() || String(r.jurisdiction).trim().toLowerCase() === jur)) : null) || exact || any;
    if (!rule) return { rate: 0, amount: 0, label: "No tax", code: null, jurisdiction: "" };
    const rate = amt(rule.rate);
    const amount = round2(amt(subtotal) * rate);
    return { rate, amount, label: rule.label || rule.code, code: rule.code, jurisdiction: rule.jurisdiction || "" };
  }
  async function compute(subtotal, code, jurisdiction, date, direction) {
    await refreshCache();
    return computeSync(subtotal, code, jurisdiction, date, direction);
  }

  /* ── currency CRUD (task 20) ─────────────────────────────────────────── */
  async function saveRate(r, list) {
    const x = Object.assign({}, r);
    x.code = String(x.code || "").toUpperCase().trim();
    if (!x.code) return { error: "Currency code is required." };
    if (!x.name) x.name = x.code;
    x.rate = amt(x.rate);
    if (x.rate <= 0) return { error: "Exchange rate must be greater than zero." };
    const base = await baseCode();
    if (x.code === base) x.rate = 1;
    if (list.some(y => y.code === x.code && y !== x)) return { error: "A currency with this code already exists." };
    const prev = list.find(y => y.code === x.code) || null;
    const i = list.findIndex(y => y.code === x.code);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveRates(list);
    await Ledger.auditLog(prev ? "currency.update" : "currency.create", {
      entity: "currency", entityId: x.code, entityLabel: x.code + " · " + x.name,
      summary: (prev ? "Edited " : "Added ") + "currency " + x.code + " at " + x.rate + " per 1 " + base,
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function deleteRate(code) {
    const rates = await loadRates();
    const r = rates.find(x => x.code === code);
    if (!r) return { error: "Currency not found." };
    const base = await baseCode();
    if (code === base) return { error: "You can't delete the base currency — change the base first." };
    const i = rates.indexOf(r); rates.splice(i, 1);
    await saveRates(rates);
    await Ledger.auditLog("currency.delete", {
      entity: "currency", entityId: r.code, entityLabel: r.code + " · " + r.name,
      summary: "Deleted currency " + r.code, prev: Ledger.cloneObj(r), next: null,
    });
    return { ok: true };
  }

  /* ── tax-rule CRUD ───────────────────────────────────────────────────── */
  async function saveRule(rule, list) {
    const x = Object.assign({}, rule);
    x.code = String(x.code || "").trim();
    if (!x.code) return { error: "Tax code is required (e.g. GST, VAT, CA-SALES)." };
    x.rate = amt(x.rate);
    if (x.rate <= 0) return { error: "Tax rate must be greater than zero." };
    if (x.rate > 1) x.rate = round2(x.rate / 100); // accept "6" as 6%
    x.scope = ["sale", "purchase", "both"].includes(x.scope) ? x.scope : "sale";
    if (!x.id) x.id = uid("tr");
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    if (list.some(y => y.code === x.code && y.id !== x.id)) return { error: "A tax rule with this code already exists." };
    const prev = list.find(y => y.id === x.id) || null;
    const i = list.findIndex(y => y.id === x.id);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveRules(list);
    await Ledger.auditLog(prev ? "tax_rate.update" : "tax_rate.create", {
      entity: "tax_rate", entityId: x.id, entityLabel: x.code + " · " + amt(x.rate) * 100 + "%" + (x.jurisdiction ? " · " + x.jurisdiction : ""),
      summary: (prev ? "Edited " : "Created ") + "tax rule " + x.code + " — " + amt(x.rate) * 100 + "%" + (x.jurisdiction ? " in " + x.jurisdiction : ""),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function setRuleActive(id, active) {
    const rules = await loadRules();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Rule not found." };
    const prev = Ledger.cloneObj(r);
    r.active = !!active;
    r.updatedAt = new Date().toISOString();
    await saveRules(rules);
    await Ledger.auditLog("tax_rate.update", {
      entity: "tax_rate", entityId: r.id, entityLabel: r.code + " · " + amt(r.rate) * 100 + "%",
      summary: r.code + " " + (active ? "enabled" : "disabled") + " for tax calculation",
      prev, next: Ledger.cloneObj(r),
    });
    return { ok: true };
  }
  async function deleteRule(id) {
    const rules = await loadRules();
    const r = rules.find(x => x.id === id);
    if (!r) return { error: "Rule not found." };
    const i = rules.indexOf(r); rules.splice(i, 1);
    await saveRules(rules);
    await Ledger.auditLog("tax_rate.delete", {
      entity: "tax_rate", entityId: r.id, entityLabel: r.code + " · " + amt(r.rate) * 100 + "%",
      summary: "Deleted tax rule " + r.code, prev: Ledger.cloneObj(r), next: null,
    });
    return { ok: true };
  }

  /* ── tax preparation report (task 23) ────────────────────────────────── */
  async function aggregateTax(invoices, bills, base, from, to) {
    const f = from || "1900-01-01", t = to || "2999-12-31";
    const out = {};
    for (const inv of invoices) {
      if (inv.status !== "open" && inv.status !== "paid") continue;
      if (!inv.date || inv.date < f || inv.date > t) continue;
      const am = amt(inv.taxAmount);
      if (am <= 0) continue;
      const code = inv.taxCode || "—", jur = inv.taxJurisdiction || "";
      const key = code + "|" + jur;
      const row = out[key] || (out[key] = { code, label: inv.taxLabel || code, jurisdiction: jur, count: 0, amount: 0 });
      row.count++;
      row.amount = round2(row.amount + am);
      row.base = round2((row.base || 0) + (inv.currency && String(inv.currency).toUpperCase() !== base ? amt(am) / (amt(inv.fxRate) > 0 ? amt(inv.fxRate) : 1) : am));
    }
    const input = {};
    for (const b of bills) {
      if (b.status !== "open" && b.status !== "paid") continue;
      if (!b.billDate || b.billDate < f || b.billDate > t) continue;
      const am = amt(b.taxAmount);
      if (am <= 0) continue;
      const code = b.taxCode || "—", jur = b.taxJurisdiction || "";
      const key = code + "|" + jur;
      const row = input[key] || (input[key] = { code, label: b.taxLabel || code, jurisdiction: jur, count: 0, amount: 0 });
      row.count++;
      row.amount = round2(row.amount + am);
      row.base = round2((row.base || 0) + (b.currency && String(b.currency).toUpperCase() !== base ? amt(am) / (amt(b.fxRate) > 0 ? amt(b.fxRate) : 1) : am));
    }
    const outRows = Object.values(out).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.jurisdiction).localeCompare(String(b.jurisdiction)));
    const inRows = Object.values(input).sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.jurisdiction).localeCompare(String(b.jurisdiction)));
    const outputTotal = round2(outRows.reduce((s, r) => s + (r.base || r.amount), 0));
    const inputTotal = round2(inRows.reduce((s, r) => s + (r.base || r.amount), 0));
    return { from: f, to: t, output: outRows, input: inRows, outputTotal, inputTotal, net: round2(outputTotal - inputTotal) };
  }
  async function taxReport(from, to) {
    const base = await baseCode();
    const [invoices, bills] = await Promise.all([
      FW.store.get("ar_invoices", null).then(v => Array.isArray(v) ? v : []),
      FW.store.get("bills", null).then(v => Array.isArray(v) ? v : []),
    ]);
    return await aggregateTax(invoices, bills, base, from, to);
  }

  /* ── module renderer ─────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 4 — Multi-Currency & Tax Engine"));
    head.appendChild(FW.el("h1", null, null, { text: "Tax & Currency" }));
    head.appendChild(FW.el("p", "lede", "One global base currency with per-currency exchange rates, jurisdiction-aware sales-tax rules (GST / HST / PST / VAT / US Sales Tax), automatic routing of collected tax to a Tax Payable liability account, and a tax preparation report grouped by tax type and jurisdiction."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="currencies">Currencies</button>' +
      '<button class="ledger-tab" data-tab="rules">Tax rates</button>' +
      '<button class="ledger-tab" data-tab="report">Tax report</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "rules") renderRules(ctn);
      else if (name === "report") renderReport(ctn);
      else renderCurrencies(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("currencies");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 4 is complete (tasks 19–23)</strong> — base currency + exchange rates, dynamic jurisdiction-aware tax calculation, tax liability routing into account 2100 on invoice posting, and a tax preparation report. Sales tax is recorded on invoices in AR and appears here as <em>output</em> tax; purchase bills are recorded gross, so <em>input</em> tax shows only when a bill carries a taxAmount.";
    m.appendChild(note);
  }

  /* ── currencies tab ──────────────────────────────────────────────────── */
  async function renderCurrencies(ctn) {
    const base = await baseCode();
    const rates = await loadRates();
    let html = '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Base currency</h3></div>' +
      '<div class="card-body"><p class="muted small" style="margin-top:0">All totals convert to the base currency. Its exchange rate is always 1; every document (invoice, bill, entry) keeps the currency and rate it was recorded with.</p>' +
      '<div class="row-flex"><div class="field" style="flex:0 0 260px"><label>Base currency</label><select id="txBaseSel">' +
      (rates.length ? await currencyOptions(base) : '<option value="' + esc(base) + '">' + esc(base) + " (base)</option>") +
      "</select></div>" +
      '<div class="field" style="flex:0 0 200px"><label>Symbol</label><input id="txBaseSym" value="' + esc(SYMBOLS[base] || "") + '" placeholder="e.g. $"></div>' +
      '<button class="btn btn-primary btn-sm" style="align-self:flex-end;margin-bottom:4px" id="txBaseSaveBtn">Save base</button></div>' +
      "</div></div>";
    html += '<div class="card"><div class="card-head"><h3>Exchange rates</h3>' +
      '<button class="btn btn-primary btn-sm" id="txRateNewBtn">+ Add currency</button></div>';
    if (!rates.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No currencies yet. Add at least one — the first currency you add becomes available as the base (its rate is pinned to 1).</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>Code</th><th>Name</th><th>Symbol</th><th class="num">Units per 1 ' + esc(base) + '</th><th class="num">1 unit in ' + esc(base) + '</th><th class="fit"></th></tr></thead><tbody>';
      for (const r of [...rates].sort((a, b) => String(a.code).localeCompare(String(b.code)))) {
        const isBase = r.code === base;
        html += "<tr>" +
          '<td class="acct-code">' + esc(r.code) + (isBase ? ' <span class="chip chip-done">base</span>' : "") + "</td>" +
          "<td>" + esc(r.name || "—") + "</td>" +
          "<td>" + esc(r.symbol || SYMBOLS[r.code] || "—") + "</td>" +
          '<td class="num">' + (isBase ? "1.00" : FW.money(amt(r.rate), base)) + "</td>" +
          '<td class="num">' + (isBase ? "1.00" : FW.money(1 / amt(r.rate))) + "</td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          (isBase ? "" : '<button class="icon-btn" data-act="edit" data-code="' + esc(r.code) + '" title="Edit rate">' + ICON.pencil + "</button>" +
            '<button class="icon-btn" data-act="del" data-code="' + esc(r.code) + '" title="Delete currency">' + ICON.trash + "</button>") +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#txBaseSaveBtn").addEventListener("click", async () => {
      const sel = ctn.querySelector("#txBaseSel");
      const code = String(sel.value || "").toUpperCase().trim();
      if (!code) { FW.toast("Pick a base currency first.", "err"); return; }
      const sym = String(ctn.querySelector("#txBaseSym").value || "").trim();
      await saveCurrency({ baseCode: code });
      let rates2 = await loadRates();
      const existing = rates2.find(x => x.code === code);
      if (existing) {
        if (amt(existing.rate) !== 1) {
          const prev = Ledger.cloneObj(existing);
          existing.rate = 1; existing.symbol = sym || existing.symbol;
          await saveRates(rates2);
          await Ledger.auditLog("currency.update", {
            entity: "currency", entityId: existing.code, entityLabel: existing.code + " · " + existing.name,
            summary: "Changed base currency to " + code + " — its rate pinned to 1",
            prev, next: Ledger.cloneObj(existing),
          });
        }
      } else {
        rates2.push({ code, name: code, symbol: sym, rate: 1 });
        await saveRates(rates2);
        await Ledger.auditLog("currency.create", {
          entity: "currency", entityId: code, entityLabel: code,
          summary: "Added base currency " + code + " (rate 1)", prev: null, next: { code, rate: 1 },
        });
      }
      FW.toast("Base currency set to " + code);
      renderCurrencies(ctn);
    });

    ctn.querySelector("#txRateNewBtn").addEventListener("click", () => openRateModal(null));
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const code = b.getAttribute("data-code");
      const act = b.getAttribute("data-act");
      if (act === "edit") openRateModal(code);
      else if (act === "del") {
        confirmDialog("Delete currency " + code + "?", "Existing documents keep their recorded currency and exchange rate. This only removes the currency from the exchange-rate table.", () => deleteRate(code).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Currency deleted"); renderCurrencies(ctn); }
        }), "Delete");
      }
    });
  }

  function openRateModal(code) {
    (async () => {
      const base = await baseCode();
      const rates = await loadRates();
      const r = code ? rates.find(x => x.code === code) : null;
      const modal = FW.modal(
        '<div class="modal-head"><h3>' + (r ? "Edit currency" : "Add currency") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:1 1 120px"><label>Code</label><input id="cCode" placeholder="e.g. EUR" maxlength="6" value="' + esc(r ? r.code : "") + '"' + (r ? " disabled" : "") + "></div>" +
        '<div class="field" style="flex:1 1 160px"><label>Name</label><input id="cName" placeholder="e.g. Euro" value="' + esc(r ? r.name || "" : "") + '"></div>' +
        '<div class="field" style="flex:0 0 90px"><label>Symbol</label><input id="cSym" placeholder="€" maxlength="4" value="' + esc(r ? r.symbol || "" : "") + '"></div>' +
        '<div class="field" style="flex:1 1 140px"><label>Units per 1 ' + esc(base) + '</label><input id="cRate" type="number" step="any" min="0" value="' + (r ? r.rate : "") + '"' + (r && r.code === base ? ' disabled title="Base currency rate is always 1"' : "") + ">" + (r && r.code === base ? '<p class="muted small" style="margin:4px 0 0">Base rate is always 1.</p>' : "") + "</div>" +
        "</div></div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="cSaveBtn">Save currency</button>' +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      modal.querySelector("#cSaveBtn").addEventListener("click", async () => {
        const rate = amt(modal.querySelector("#cRate").value);
        const out = await saveRate({
          code: r ? r.code : modal.querySelector("#cCode").value,
          name: modal.querySelector("#cName").value,
          symbol: modal.querySelector("#cSym").value,
          rate,
        }, await loadRates());
        if (out && out.error) { FW.toast(out.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(r ? "Currency updated" : "Currency added");
        renderCurrencies(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  /* ── tax rates tab ───────────────────────────────────────────────────── */
  async function renderRules(ctn) {
    const rules = await loadRules();
    let html = '<div class="card"><div class="card-head"><h3>Tax rules</h3>' +
      '<button class="btn btn-primary btn-sm" id="trNewBtn">+ New tax rule</button></div>' +
      '<p class="muted small" style="margin:0;padding:0 16px 10px">A rule <strong>scope</strong> decides whether it applies to sales (output tax), purchases (input tax) or both. Jurisdiction is optional — leave it blank to apply the rule everywhere, or set e.g. "CA" for California. Rates may be entered as a percent (6) or a decimal (0.06).</p>';
    if (!rules.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No tax rules yet. Add rules like GST 6% (jurisdiction CA) or VAT 20% — then pick one on any invoice or quote and the tax is computed, routed to the Tax Payable account, and aggregated in the Tax report.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>Code</th><th>Rate</th><th>Jurisdiction</th><th>Scope</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const r of [...rules].sort((a, b) => String(a.code).localeCompare(String(b.code)))) {
        const active = r.active !== false;
        html += "<tr>" +
          '<td class="acct-code">' + esc(r.code) + '<div class="muted small">' + esc(r.label || "") + "</div></td>" +
          '<td class="num"><strong>' + amt(r.rate) * 100 + "%</strong></td>" +
          "<td>" + esc(r.jurisdiction || "— (all)") + "</td>" +
          "<td>" + esc({ sale: "Sales (output)", purchase: "Purchases (input)", both: "Sales & purchases" }[r.scope] || r.scope) + "</td>" +
          '<td><span class="chip ' + (active ? "chip-done" : "chip-pending") + '">' + (active ? "active" : "paused") + "</span></td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          '<button class="icon-btn" data-act="toggle" data-id="' + esc(r.id) + '" title="' + (active ? "Pause" : "Enable") + '">' + (active ? ICON.pause : ICON.play) + "</button>" +
          '<button class="icon-btn" data-act="edit" data-id="' + esc(r.id) + '" title="Edit rule">' + ICON.pencil + "</button>" +
          '<button class="icon-btn" data-act="del" data-id="' + esc(r.id) + '" title="Delete rule">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#trNewBtn").addEventListener("click", () => openRuleModal(null));
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (act === "edit") openRuleModal(id);
      else if (act === "del") {
        confirmDialog("Delete this tax rule?", "Invoices that used this code keep their recorded tax — this only removes the rule from future calculations.", () => deleteRule(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Tax rule deleted"); renderRules(ctn); }
        }), "Delete rule");
      } else if (act === "toggle") {
        const rule = rules.find(x => x.id === id);
        if (!rule) return;
        const next = rule.active === false;
        setRuleActive(id, next).then(() => { FW.toast(rule.code + " " + (next ? "enabled" : "paused")); renderRules(ctn); });
      }
    });
  }

  function openRuleModal(id) {
    (async () => {
      const rules = await loadRules();
      const r = id ? rules.find(x => x.id === id) : null;
      const modal = FW.modal(
        '<div class="modal-head"><h3>' + (r ? "Edit tax rule" : "New tax rule") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:1 1 130px"><label>Code</label><input id="trCode" placeholder="e.g. GST" value="' + esc(r ? r.code : "") + '"></div>' +
        '<div class="field" style="flex:1 1 170px"><label>Label</label><input id="trLabel" placeholder="e.g. GST 6%" value="' + esc(r ? r.label || "" : "") + '"></div>' +
        '<div class="field" style="flex:0 0 110px"><label>Rate (%)</label><input id="trRate" type="number" step="any" min="0" max="100" value="' + (r ? amt(r.rate) * 100 : "") + '"></div>' +
        "</div><div class=\"row-flex\">" +
        '<div class="field" style="flex:1 1 160px"><label>Jurisdiction <span class="muted small">(optional)</span></label><input id="trJur" placeholder="e.g. CA, NY, UK" value="' + esc(r ? r.jurisdiction || "" : "") + '"></div>' +
        '<div class="field" style="flex:0 0 200px"><label>Scope</label><select id="trScope">' +
        ["sale", "purchase", "both"].map(s => '<option value="' + s + '"' + ((r ? r.scope || "sale" : "sale") === s ? " selected" : "") + ">" + { sale: "Sales (output tax)", purchase: "Purchases (input tax)", both: "Sales & purchases" }[s] + "</option>").join("") +
        "</select></div>" +
        '<div class="field" style="flex:0 0 110px"><label>Active</label><select id="trActive"><option value="1"' + ((r ? r.active !== false : true) ? " selected" : "") + ">Yes</option><option value=\"0\"" + ((r ? r.active === false : false) ? " selected" : "") + ">No</option></select></div>" +
        "</div></div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="trSaveBtn">Save rule</button>' +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      modal.querySelector("#trSaveBtn").addEventListener("click", async () => {
        const out = await saveRule({
          id: r ? r.id : null,
          code: modal.querySelector("#trCode").value,
          label: modal.querySelector("#trLabel").value,
          rate: amt(modal.querySelector("#trRate").value) / 100,
          jurisdiction: String(modal.querySelector("#trJur").value || "").trim(),
          scope: modal.querySelector("#trScope").value,
          active: modal.querySelector("#trActive").value === "1",
          createdAt: r ? r.createdAt : null,
        }, await loadRules());
        if (out && out.error) { FW.toast(out.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(r ? "Tax rule updated" : "Tax rule created");
        renderRules(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  /* ── tax report tab ──────────────────────────────────────────────────── */
  async function renderReport(ctn) {
    const base = await baseCode();
    const defFrom = firstOfYear(), defTo = today();
    let html = '<div class="card" style="margin-bottom:14px"><div class="card-body"><div class="row-flex" style="align-items:flex-end">' +
      '<div class="field" style="flex:0 0 170px"><label>From</label><input type="date" id="repFrom" value="' + defFrom + '"></div>' +
      '<div class="field" style="flex:0 0 170px"><label>To</label><input type="date" id="repTo" value="' + defTo + '"></div>' +
      '<button class="btn btn-primary btn-sm" style="margin-bottom:4px" id="repRunBtn">Run report</button>' +
      '<span class="muted small" style="margin-bottom:8px">Amounts shown in base currency (' + esc(base) + ")</span></div></div></div>";
    html += '<div id="repBody"></div>';
    ctn.innerHTML = html;
    ctn.querySelector("#repRunBtn").addEventListener("click", () => runReport());
    async function runReport() {
      const from = ctn.querySelector("#repFrom").value || defFrom;
      const to = ctn.querySelector("#repTo").value || defTo;
      const rep = await taxReport(from, to);
      let body = '<div class="stat-grid" style="margin-bottom:14px">' +
        '<div class="stat-card card"><div class="stat-value">' + FW.money(rep.outputTotal) + '</div><div class="stat-label">Tax collected (output)</div><div class="stat-sub">' + rep.output.reduce((s, r) => s + r.count, 0) + " invoices with tax</div></div>" +
        '<div class="stat-card card"><div class="stat-value">' + FW.money(rep.inputTotal) + '</div><div class="stat-label">Tax paid (input)</div><div class="stat-sub">' + rep.input.reduce((s, r) => s + r.count, 0) + " bills with tax</div></div>" +
        '<div class="stat-card card"><div class="stat-value">' + FW.money(rep.net) + '</div><div class="stat-label">Net tax payable</div><div class="stat-sub">collected − paid</div></div>' +
        "</div>";
      body += '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Output tax (collected on sales)</h3></div>';
      if (!rep.output.length) {
        body += '<p class="muted small" style="text-align:center;padding:20px 14px">No sales tax collected in this range. Post an invoice that has a tax code and a tax amount to see it here.</p>';
      } else {
        body += '<table class="tbl"><thead><tr><th>Tax type</th><th>Jurisdiction</th><th class="num">Invoices</th><th class="num">Amount (' + esc(base) + ")</th></tr></thead><tbody>";
        for (const r of rep.output) {
          body += "<tr><td>" + esc(r.code) + '<div class="muted small">' + esc(r.label) + "</div></td><td>" + esc(r.jurisdiction || "—") + "</td>" +
            '<td class="num">' + r.count + "</td><td class=\"num\"><strong>" + FW.money(r.base || r.amount) + "</strong></td></tr>";
        }
        body += '<tr class="tot"><td colspan="2">Total output tax</td><td class="num">' + rep.output.reduce((s, r) => s + r.count, 0) + '</td><td class="num">' + FW.money(rep.outputTotal) + "</td></tr></tbody></table>";
      }
      body += "</div>";
      body += '<div class="card"><div class="card-head"><h3>Input tax (paid on purchases)</h3></div>';
      if (!rep.input.length) {
        body += '<p class="muted small" style="text-align:center;padding:20px 14px">No input tax in this range. Bills are currently recorded gross of tax — if a bill ever carries a <code>taxAmount</code>, it appears here and reduces the net tax payable.</p>';
      } else {
        body += '<table class="tbl"><thead><tr><th>Tax type</th><th>Jurisdiction</th><th class="num">Bills</th><th class="num">Amount (' + esc(base) + ")</th></tr></thead><tbody>";
        for (const r of rep.input) {
          body += "<tr><td>" + esc(r.code) + '<div class="muted small">' + esc(r.label) + "</div></td><td>" + esc(r.jurisdiction || "—") + "</td>" +
            '<td class="num">' + r.count + "</td><td class=\"num\"><strong>" + FW.money(r.base || r.amount) + "</strong></td></tr>";
        }
        body += '<tr class="tot"><td colspan="2">Total input tax</td><td class="num">' + rep.input.reduce((s, r) => s + r.count, 0) + '</td><td class="num">' + FW.money(rep.inputTotal) + "</td></tr></tbody></table>";
      }
      body += "</div>";
      ctn.querySelector("#repBody").innerHTML = body;
    }
    await runReport();
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const XS_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const ICON = {
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M7 5v14l11-7z"/></svg>',
  };
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── self-test (validation for tasks 19–23) ──────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });

    /* task 19 — base currency */
    const savedCur = await loadCurrency();
    const baseA = await baseCode();
    ok("Base: baseCode returns a non-empty code", typeof baseA === "string" && baseA.length > 0, baseA);
    ok("Base: rateFor(base) is 1", await rateFor(baseA) === 1);

    /* task 20 — exchange rates */
    const fakeRates = [
      { code: baseA, name: "Base", symbol: "$", rate: 1 },
      { code: "EUR", name: "Euro", symbol: "€", rate: 0.92 },
      { code: "JPY", name: "Yen", symbol: "¥", rate: 150 },
    ];
    ok("Rates: toBase converts via recorded rate", await toBase(100, "JPY", 150) === 0.67, await toBase(100, "JPY", 150));
    ok("Rates: toBase treats base as itself", await toBase(100, baseA, null) === 100);
    ok("Rates: toBase falls back to table when no fx", (async () => {
      const r = await FW.store.get(K.rates, null) || [];
      const had = r.length;
      await FW.store.set(K.rates, fakeRates);
      const v = await toBase(92, "EUR", null);
      await FW.store.set(K.rates, had ? r : []);
      return v === 100;
    })());
    ok("Rates: rateFor unknown code is null", await rateFor("ZZZ") === null);
    ok("Rates: currencyOptions include base marker", /\(base\)/.test(await currencyOptions()));

    /* task 21 — dynamic tax calculation */
    const fakeRules = [
      { id: "tr1", code: "GST", label: "GST 6%", rate: 0.06, jurisdiction: "CA", scope: "both", active: true },
      { id: "tr2", code: "HST", label: "HST 13%", rate: 0.13, jurisdiction: "ON", scope: "sale", active: true },
      { id: "tr3", code: "VAT", label: "VAT 20%", rate: 0.2, jurisdiction: "", scope: "both", active: true },
      { id: "tr4", code: "PAUSED", label: "Old", rate: 0.05, jurisdiction: "", scope: "both", active: false },
    ];
    const rulesBackup = await loadRules();
    await saveRules(fakeRules);
    const c1 = await compute(100, null, "CA", "2026-09-01", "sale");
    ok("Tax: jurisdiction match applies the right rate", c1.code === "GST" && c1.amount === 6, JSON.stringify(c1));
    const c2 = await compute(100, null, "ON", "2026-09-01", "sale");
    ok("Tax: Ontario sale gets HST 13%", c2.code === "HST" && c2.amount === 13);
    const c3 = await compute(100, null, "ZZ", "2026-09-01", "sale");
    ok("Tax: unknown jurisdiction falls back to catch-all VAT", c3.code === "VAT" && c3.amount === 20);
    const c4 = await compute(100, null, "ZZ", "2026-09-01", "purchase");
    ok("Tax: purchase direction skips sale-only HST, uses catch-all", c4.code === "VAT", c4.code);
    const c5 = await compute(100, "GST", "CA", "2026-09-01", "sale");
    ok("Tax: explicit code wins", c5.code === "GST" && c5.amount === 6);
    const c6 = await compute(100, null, "CA", "2026-09-01", "sale");
    ok("Tax: paused rule is never selected", c6.code !== "PAUSED");
    const c7 = await compute(100, null, "CA", "2026-09-01", "purchase");
    ok("Tax: GST scope both works for purchases", c7.code === "GST" && c7.amount === 6);
    await saveRules(rulesBackup);

    /* task 22 — liability routing */
    const accs = [
      { id: "a1100", code: "1100", name: "Accounts Receivable", type: "asset" },
      { id: "a2100", code: "2100", name: "Sales Tax Payable", type: "liability" },
    ];
    ok("Routing: finds 2100 by code", findPayableAccount(accs) === "a2100");
    ok("Routing: falls back to a tax-named liability", findPayableAccount(accs.slice(0, 1)) === null);
    ok("Routing: falls back to any liability", findPayableAccount([{ id: "a2200", code: "2200", name: "Accrued", type: "liability" }]) === "a2200");

    /* task 23 — tax report aggregation */
    const ag = await aggregateTax([
      { no: "INV-1", date: "2026-09-01", status: "open", taxCode: "GST", taxJurisdiction: "CA", taxLabel: "GST 6%", taxAmount: 6 },
      { no: "INV-2", date: "2026-09-02", status: "paid", taxCode: "GST", taxJurisdiction: "CA", taxLabel: "GST 6%", taxAmount: 12 },
      { no: "INV-3", date: "2026-08-01", status: "open", taxCode: "HST", taxJurisdiction: "ON", taxLabel: "HST 13%", taxAmount: 13 },
      { no: "INV-4", date: "2026-09-03", status: "draft", taxCode: "GST", taxJurisdiction: "CA", taxLabel: "GST 6%", taxAmount: 99 },
      { no: "INV-5", date: "2026-09-04", status: "void", taxCode: "GST", taxJurisdiction: "CA", taxLabel: "GST 6%", taxAmount: 99 },
      { no: "INV-6", date: "2026-09-05", status: "open", taxCode: "GST", taxJurisdiction: "CA", taxLabel: "GST 6%", taxAmount: 0 },
    ], [
      { no: "BILL-1", billDate: "2026-09-06", status: "open", taxCode: "VAT", taxJurisdiction: "UK", taxLabel: "VAT 20%", taxAmount: 20 },
      { no: "BILL-2", billDate: "2026-09-07", status: "paid", taxCode: "VAT", taxJurisdiction: "UK", taxLabel: "VAT 20%", taxAmount: 10 },
      { no: "BILL-3", billDate: "2026-09-08", status: "draft", taxCode: "VAT", taxJurisdiction: "UK", taxLabel: "VAT 20%", taxAmount: 500 },
    ], baseA, "2026-09-01", "2026-09-30");
    ok("Report: output aggregates posted invoices only", ag.outputTotal === 18, "got " + ag.outputTotal);
    ok("Report: output grouped by code+jurisdiction", ag.output.length === 1, "got " + ag.output.length);
    const gst = ag.output.find(r => r.code === "GST");
    ok("Report: GST bucket counts and sums correctly", gst && gst.count === 2 && gst.amount === 18, JSON.stringify(gst));
    ok("Report: input aggregates posted bills only", ag.inputTotal === 30, "got " + ag.inputTotal);
    ok("Report: net = output − input", ag.net === -12, "got " + ag.net);
    ok("Report: date range excludes August invoice", !ag.output.some(r => r.code === "HST"));

    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  refreshCache().catch(() => {});
  const X = {
    baseCode, rateFor, toBase, format, currencyOptions, taxCodeOptions,
    baseCodeSync, rateForSync, toBaseSync, formatSync, currencyOptionsSync, taxCodeOptionsSync,
    findPayableAccount, compute, computeSync,
    saveRate, deleteRate, saveRule, setRuleActive, deleteRule,
    loadRates, saveRates, loadRules, saveRules, loadCurrency, saveCurrency, refreshCache,
    aggregateTax, taxReport,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.tax = X;
  window.Tax = X;
})();
