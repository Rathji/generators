/* ============================================================================
   THE LEDGER — ledger.js
   General Ledger module (Phase 1, tasks 1–6):
     1. Chart of Accounts (CoA) structure — hierarchical accounts by type
        (asset/liability/equity/revenue/expense), unique codes, parent-child.
     2. Double-entry journal entry system — every entry must balance
        (total debits == total credits) before it can be posted.
     3. Posting logic — posted entries update each account's real-time balance.
     4. Period closing — date ranges (month/quarter/year) are locked once
        closed; net income is carried to retained earnings via auto journal
        entries (closing + reversal on reopen).
     5. Audit trail — an append-only log of every mutation (timestamp, user,
        before/after snapshots) on accounts, journal entries and periods.
     6. Trial balance — account balances aggregated as of a chosen date,
        verifying total debits == total credits.
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "coa"      → array of account objects
     key "journal"  → array of journal entry objects
     key "closings" → array of closed-period records
     key "audit"    → array of audit records (append-only)
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;

  const TYPES = [
    { key: "asset",     label: "Assets",     normal: "debit",  defaultPrefix: "1" },
    { key: "liability", label: "Liabilities", normal: "credit", defaultPrefix: "2" },
    { key: "equity",    label: "Equity",     normal: "credit", defaultPrefix: "3" },
    { key: "revenue",   label: "Revenue",    normal: "credit", defaultPrefix: "4" },
    { key: "expense",   label: "Expenses",   normal: "debit",  defaultPrefix: "5" },
  ];
  const typeOf = k => TYPES.find(t => t.key === k) || TYPES[0];
  const K = { coa: "coa", journal: "journal", closings: "closings", audit: "audit" };

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ── default chart of accounts ────────────────────────────────────────── */
  function defaultChart() {
    const A = (code, name, type, parent, normal, description) => ({
      id: "a" + code, code, name, type,
      parent: parent ? "a" + parent : null,
      normal: normal || typeOf(type).normal,
      description: description || "",
      active: true, createdAt: null,
    });
    return [
      A("1000", "Cash and Bank", "asset", null, null, "Bank and cash accounts"),
      A("1010", "Checking Account", "asset", "1000"),
      A("1020", "Savings Account", "asset", "1000"),
      A("1030", "Petty Cash", "asset", "1000"),
      A("1100", "Accounts Receivable", "asset"),
      A("1200", "Inventory", "asset"),
      A("1300", "Prepaid Expenses", "asset"),
      A("1400", "Fixed Assets", "asset", null, null, "Long-lived assets (net of depreciation)"),
      A("1410", "Office Equipment", "asset", "1400"),
      A("1420", "Computer Equipment", "asset", "1400"),
      A("1490", "Accumulated Depreciation", "asset", "1400", "credit", "Contra-asset — offsets fixed assets"),
      A("1500", "Other Assets", "asset"),
      A("2000", "Accounts Payable", "liability"),
      A("2100", "Sales Tax Payable", "liability"),
      A("2200", "Payroll Liabilities", "liability"),
      A("2210", "Federal Withholding Payable", "liability", "2200"),
      A("2220", "State Withholding Payable", "liability", "2200"),
      A("2300", "Loans Payable", "liability"),
      A("2310", "Bank Loan Payable", "liability", "2300"),
      A("3000", "Owner's Equity", "equity"),
      A("3100", "Owner's Draw", "equity"),
      A("3200", "Retained Earnings", "equity"),
      A("4000", "Sales Revenue", "revenue"),
      A("4100", "Service Revenue", "revenue"),
      A("4200", "Interest Income", "revenue"),
      A("4300", "Other Income", "revenue"),
      A("5000", "Cost of Goods Sold", "expense"),
      A("5100", "Rent Expense", "expense"),
      A("5200", "Utilities Expense", "expense"),
      A("5300", "Office Supplies Expense", "expense"),
      A("5400", "Marketing & Advertising", "expense"),
      A("5500", "Insurance Expense", "expense"),
      A("5600", "Payroll Expense", "expense"),
      A("5700", "Professional Fees", "expense"),
      A("5800", "Travel Expense", "expense"),
      A("5900", "Depreciation Expense", "expense"),
      A("5950", "Miscellaneous Expense", "expense"),
    ];
  }

  /* ── persistence ──────────────────────────────────────────────────────── */
  async function loadAccounts() {
    const v = await FW.store.get(K.coa, null);
    if (Array.isArray(v) && v.length) return v;
    const d = defaultChart();
    await FW.store.set(K.coa, d);
    return d;
  }
  async function saveAccounts(list) { await FW.store.set(K.coa, list); }
  async function loadEntries() {
    const v = await FW.store.get(K.journal, null);
    return Array.isArray(v) ? v : [];
  }
  async function saveEntries(list) { await FW.store.set(K.journal, list); }

  async function nextEntryNo(entries) {
    let max = 0;
    for (const e of entries) { const m = /^JE-(\d+)$/.exec(e.no || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return "JE-" + String(max + 1).padStart(4, "0");
  }

  /* ── engine ───────────────────────────────────────────────────────────── */
  function computeBalances(entries, accounts) {
    const map = {};
    for (const a of accounts) map[a.id] = { id: a.id, debit: 0, credit: 0, balance: 0 };
    for (const e of entries) {
      if (e.status !== "posted") continue;
      for (const l of e.lines) {
        const row = map[l.account] || (map[l.account] = { id: l.account, debit: 0, credit: 0, balance: 0 });
        row.debit = round2(row.debit + amt(l.debit));
        row.credit = round2(row.credit + amt(l.credit));
      }
    }
    const byId = {};
    for (const a of accounts) byId[a.id] = a;
    for (const id in map) {
      const r = map[id];
      const a = byId[id];
      r.balance = round2(a && a.normal === "credit" ? r.credit - r.debit : r.debit - r.credit);
    }
    return map;
  }
  function entryTotals(entry) {
    let dr = 0, cr = 0;
    for (const l of (entry.lines || [])) { dr = round2(dr + amt(l.debit)); cr = round2(cr + amt(l.credit)); }
    return { dr, cr, diff: round2(dr - cr) };
  }
  function isBalanced(entry) { return Math.abs(entryTotals(entry).diff) < 0.005; }
  function codeExists(accounts, code, exceptId) {
    const c = String(code || "").trim();
    return accounts.some(a => a.code === c && a.id !== exceptId);
  }
  function isDescendant(accounts, id, possibleParent) {
    let cur = accounts.find(a => a.id === id);
    const seen = new Set();
    while (cur && cur.parent) {
      if (seen.has(cur.parent)) return false;
      seen.add(cur.parent);
      if (cur.parent === possibleParent) return true;
      cur = accounts.find(a => a.id === cur.parent);
    }
    return false;
  }
  function accountInUse(accounts, entries, id) {
    const child = accounts.some(a => a.parent === id);
    const inLines = entries.some(e => e.lines.some(l => l.account === id));
    return { child, inLines };
  }

  async function saveAccount(account, accounts) {
    const a = Object.assign({}, account);
    if (!a.id) a.id = uid("a");
    if (!a.createdAt) a.createdAt = new Date().toISOString();
    const prev = accounts.find(x => x.id === a.id) || null;
    const i = accounts.findIndex(x => x.id === a.id);
    if (i >= 0) accounts[i] = a; else accounts.push(a);
    await saveAccounts(accounts);
    const label = a.code + " · " + a.name;
    if (prev) await auditLog("account.update", {
      entity: "account", entityId: a.id, entityLabel: label,
      summary: "Edited account " + a.code + " " + a.name,
      prev: cloneObj(prev), next: cloneObj(a),
    });
    else await auditLog("account.create", {
      entity: "account", entityId: a.id, entityLabel: label,
      summary: "Created account " + a.code + " " + a.name,
      prev: null, next: cloneObj(a),
    });
    return a;
  }
  async function deleteAccount(id) {
    const accounts = await loadAccounts();
    const entries = await loadEntries();
    const use = accountInUse(accounts, entries, id);
    if (use.child) return { error: "Account has child accounts — move or delete them first." };
    if (use.inLines) return { error: "Account is used by journal entries — mark it inactive instead." };
    const i = accounts.findIndex(a => a.id === id);
    if (i >= 0) {
      const gone = accounts[i];
      accounts.splice(i, 1);
      await saveAccounts(accounts);
      await auditLog("account.delete", {
        entity: "account", entityId: id, entityLabel: gone.code + " · " + gone.name,
        summary: "Deleted account " + gone.code + " " + gone.name,
        prev: cloneObj(gone), next: null,
      });
    }
    return { ok: true };
  }
  async function setAccountActive(id, active) {
    const accounts = await loadAccounts();
    const a = accounts.find(x => x.id === id);
    if (!a) return { error: "Account not found" };
    const prev = cloneObj(a);
    a.active = !!active;
    await saveAccounts(accounts);
    await auditLog("account.update", {
      entity: "account", entityId: a.id, entityLabel: a.code + " · " + a.name,
      summary: (a.active ? "Activated" : "Deactivated") + " account " + a.code + " " + a.name,
      prev, next: cloneObj(a),
    });
    return { ok: true };
  }
  async function saveEntry(entry, accounts) {
    const e = Object.assign({}, entry);
    if (!e.id) e.id = uid("je");
    e.lines = (e.lines || []).map(l => ({
      account: l.account, desc: String(l.desc || "").trim(),
      debit: round2(amt(l.debit)), credit: round2(amt(l.credit)),
    }));
    if (!e.date) e.date = today();
    const lock = closedRangeFor(await loadClosings(), e.date);
    if (lock) return { error: "Cannot save an entry dated " + e.date + " — that date falls inside closed period “" + lock.label + "” (" + lock.start + " → " + lock.end + "). Reopen the period or change the date." };
    const entries = await loadEntries();
    const prev = entries.find(x => x.id === e.id) || null;
    const i = entries.findIndex(x => x.id === e.id);
    if (i >= 0) entries[i] = e; else entries.push(e);
    await saveEntries(entries);
    const label = (e.no || "JE") + " · " + e.date;
    if (prev) await auditLog("entry.update", {
      entity: "journal", entityId: e.id, entityLabel: label,
      summary: "Edited " + (e.no || "journal entry") + " (" + e.date + ")",
      prev: cloneObj(prev), next: cloneObj(e),
    });
    else await auditLog("entry.create", {
      entity: "journal", entityId: e.id, entityLabel: label,
      summary: "Created " + (e.no || "journal entry") + " (" + e.date + ")",
      prev: null, next: cloneObj(e),
    });
    return e;
  }
  async function postEntry(id) {
    const entries = await loadEntries();
    const accounts = await loadAccounts();
    const e = entries.find(x => x.id === id);
    if (!e) return { error: "Entry not found." };
    if (e.status === "posted") return { error: "Entry is already posted." };
    if (!(e.lines && e.lines.length)) return { error: "Entry has no lines." };
    const t = entryTotals(e);
    if (Math.abs(t.diff) >= 0.005) return { error: "Cannot post — out of balance by " + FW.money(t.diff) + "." };
    for (const l of e.lines) {
      if (!accounts.find(a => a.id === l.account)) return { error: "Line references an unknown account." };
      if (amt(l.debit) <= 0 && amt(l.credit) <= 0) return { error: "Every line needs a debit or credit amount." };
    }
    const lock = closedRangeFor(await loadClosings(), e.date);
    if (lock) return { error: "Cannot post — " + e.date + " lies inside closed period “" + lock.label + "” (" + lock.start + " → " + lock.end + "). Reopen that period or change the entry date." };
    const prev = cloneObj(e);
    e.status = "posted";
    e.postedAt = new Date().toISOString();
    await saveEntries(entries);
    await auditLog("entry.post", {
      entity: "journal", entityId: e.id, entityLabel: (e.no || "JE") + " · " + e.date,
      summary: "Posted " + (e.no || "journal entry") + " — " + FW.money(t.dr) + " ↔ " + FW.money(t.cr),
      prev, next: cloneObj(e),
    });
    return { ok: true };
  }
  async function deleteEntry(id) {
    const entries = await loadEntries();
    const e = entries.find(x => x.id === id);
    if (!e) return { error: "Entry not found." };
    if (e.status === "posted") return { error: "Posted entries are immutable — they can't be deleted. See the Audit tab for their full history." };
    const i = entries.indexOf(e);
    entries.splice(i, 1);
    await saveEntries(entries);
    await auditLog("entry.delete", {
      entity: "journal", entityId: e.id, entityLabel: (e.no || "draft") + " · " + e.date,
      summary: "Deleted draft entry " + (e.no || "") + " (" + e.date + ")",
      prev: cloneObj(e), next: null,
    });
    return { ok: true };
  }
  async function getBalance(id) {
    const [entries, accounts] = await Promise.all([loadEntries(), loadAccounts()]);
    const b = computeBalances(entries, accounts);
    return b[id] || { id, debit: 0, credit: 0, balance: 0 };
  }

  /* ── small UI helpers ─────────────────────────────────────────────────── */
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── module renderer ──────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 1 — General Ledger & Chart of Accounts"));
    head.appendChild(FW.el("h1", null, null, { text: "General Ledger" }));
    head.appendChild(FW.el("p", "lede", "The double-entry core: a hierarchical chart of accounts, balanced journal entries, and posting that updates account balances in real time."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="accounts">Accounts</button>' +
      '<button class="ledger-tab" data-tab="journal">Journal</button>' +
      '<button class="ledger-tab" data-tab="balances">Balances</button>' +
      '<button class="ledger-tab" data-tab="periods">Periods</button>' +
      '<button class="ledger-tab" data-tab="trial">Trial balance</button>' +
      '<button class="ledger-tab" data-tab="audit">Audit</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "journal") renderJournal(ctn);
      else if (name === "balances") renderBalances(ctn);
      else if (name === "periods") renderPeriods(ctn);
      else if (name === "trial") renderTrial(ctn);
      else if (name === "audit") renderAudit(ctn);
      else renderAccounts(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("accounts");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 1 is complete</strong> — all six tasks are <strong>done</strong>: chart of accounts, double-entry journal, posting logic, period closing (lock ranges, carry net income to retained earnings), the append-only audit trail, and the as-of trial balance. Phase 2 (Accounts Payable) is now in progress — open the Accounts Payable module for purchase orders, vendor bills and recurring expenses.";
    m.appendChild(note);
  }

  /* ── Accounts tab ─────────────────────────────────────────────────────── */
  async function renderAccounts(ctn) {
    const [accounts, entries] = await Promise.all([loadAccounts(), loadEntries()]);
    const bal = computeBalances(entries, accounts);
    let html = '<div class="card"><div class="card-head"><h3>Chart of Accounts</h3>' +
      '<button class="btn btn-primary btn-sm" id="acctAddBtn">+ Add account</button></div>';
    for (const t of TYPES) {
      const list = accounts.filter(a => a.type === t.key);
      if (!list.length) continue;
      html += '<div class="type-head"><span>' + esc(t.label) + '</span><span class="count">' + list.length + " accounts</span></div>";
      html += '<table class="tbl">';
      html += "<thead><tr><th>Code</th><th>Name</th><th class='col-desc'>Description</th><th class='tr'>Balance</th><th></th></tr></thead><tbody>";
      for (const a of list) {
        const r = bal[a.id] || { balance: 0 };
        const kids = accounts.filter(x => x.parent === a.id);
        html += '<tr' + (a.active ? "" : ' class="row-inactive"') + '>' +
          '<td><span class="acct-code' + (kids.length ? " acct-group" : "") + '">' + esc(a.code) + "</span></td>" +
          "<td><div class='acct-name'>" + esc(a.name) + "</div>" +
          (a.normal === "credit" && (a.type === "asset" || a.type === "expense") ? '<div class="tag tag-contra">contra</div>' : "") +
          "</td>" +
          '<td class="muted small col-desc">' + esc(a.description || "") + "</td>" +
          '<td class="tr num">' + (r.balance ? FW.money(r.balance) : '<span class="muted">—</span>') + "</td>" +
          "<td><div class='row-actions'>" +
          '<button class="icon-mini" data-acct-edit="' + esc(a.id) + '" title="Edit">' + ICON.pencil + "</button>" +
          '<button class="icon-mini" data-acct-tog="' + esc(a.id) + '" title="' + (a.active ? "Deactivate" : "Activate") + '">' + (a.active ? ICON.eyeOff : ICON.eye) + "</button>" +
          '<button class="icon-mini danger" data-acct-del="' + esc(a.id) + '" title="Delete">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#acctAddBtn").addEventListener("click", () => accountModal(null, accounts, () => renderAccounts(ctn)));
    ctn.onclick = e => {

      const ed = e.target.closest("[data-acct-edit]");
      const tg = e.target.closest("[data-acct-tog]");
      const dl = e.target.closest("[data-acct-del]");
      if (ed) {
        const a = accounts.find(x => x.id === ed.getAttribute("data-acct-edit"));
        if (a) accountModal(a, accounts, () => renderAccounts(ctn));
      } else if (tg) {
        const a = accounts.find(x => x.id === tg.getAttribute("data-acct-tog"));
        if (a) setAccountActive(a.id, !a.active).then(() => renderAccounts(ctn));
      } else if (dl) {
        const id = dl.getAttribute("data-acct-del");
        confirmDialog("Delete account?", "This permanently removes the account. Accounts with journal activity or children can't be deleted — deactivate them instead.", async () => {
          const r = await deleteAccount(id);
          if (r.error) FW.toast(r.error, "err"); else { FW.toast("Account deleted"); renderAccounts(ctn); }
        }, "Delete account");
      }
    };
  }

  function accountModal(account, accounts, onSaved) {
    const isNew = !account;
    const a = account || { code: "", name: "", type: "asset", parent: null, normal: null, description: "", active: true };
    const typeOptions = TYPES.map(t => '<option value="' + t.key + '"' + (t.key === a.type ? " selected" : "") + ">" + esc(t.label) + "</option>").join("");
    const parentOpts = accounts
      .filter(x => x.type === a.type && x.id !== a.id && !isDescendant(accounts, x.id, a.id))
      .map(x => '<option value="' + x.id + '"' + (x.id === a.parent ? " selected" : "") + ">" + esc(x.code) + " · " + esc(x.name) + "</option>").join("");
    const autoNormal = typeOf(a.type).normal;
    const normalVal = a.normal || autoNormal;

    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (isNew ? "Add account" : "Edit account") + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body"><form id="acctForm">' +
      '<div class="row-flex" style="align-items:flex-start">' +
      '<div class="field" style="flex:1 1 120px"><label>Account code</label><input name="code" value="' + esc(a.code) + '" placeholder="e.g. 1010" required><div class="hint">Unique number, e.g. 1010</div></div>' +
      '<div class="field" style="flex:2 1 220px"><label>Account name</label><input name="name" value="' + esc(a.name) + '" placeholder="e.g. Checking Account" required></div>' +
      "</div>" +
      '<div class="row-flex" style="align-items:flex-start">' +
      '<div class="field" style="flex:1 1 180px"><label>Type</label><select name="type">' + typeOptions + "</select></div>" +
      '<div class="field" style="flex:1 1 180px"><label>Parent (optional)</label><select name="parent"><option value="">— none —</option>' + parentOpts + "</select></div>" +
      '<div class="field" style="flex:1 1 140px"><label>Normal balance</label><select name="normal"><option value="debit"' + (normalVal === "debit" ? " selected" : "") + '>Debit</option><option value="credit"' + (normalVal === "credit" ? " selected" : "") + '>Credit</option></select><div class="hint">auto: ' + autoNormal + '</div></div>' +
      "</div>" +
      '<div class="field"><label>Description</label><input name="description" value="' + esc(a.description || "") + '" placeholder="Optional"></div>' +
      '<label class="check-inline"><input type="checkbox" name="active"' + (a.active ? " checked" : "") + '> <span>Account is active</span></label>' +
      '<div class="row-flex" style="margin-top:16px"><button class="btn btn-primary" type="submit">' + (isNew ? "Create account" : "Save changes") + '</button>' +
      '<button class="btn btn-ghost" type="button" data-close>Cancel</button></div>' +
      "</form></div>");

    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector('select[name="type"]').addEventListener("change", () => {
      const t = modal.querySelector('select[name="type"]').value;
      const auto = typeOf(t).normal;
      modal.querySelector('select[name="normal"]').value = auto;
      modal.querySelector(".hint").textContent = "auto: " + auto;
    });

    modal.querySelector("#acctForm").addEventListener("submit", e => {
      e.preventDefault();
      const f = modal.querySelector("#acctForm");
      const code = String(f.code.value || "").trim();
      const name = String(f.name.value || "").trim();
      const type = f.type.value;
      const parent = f.parent.value || null;
      const normal = f.normal.value;
      if (!/^\d{2,6}$/.test(code)) { FW.toast("Code must be 2–6 digits.", "err"); return; }
      if (codeExists(accounts, code, a.id)) { FW.toast("That account code is already in use.", "err"); return; }
      if (!name) { FW.toast("Account name is required.", "err"); return; }
      if (parent === a.id) { FW.toast("An account can't be its own parent.", "err"); return; }
      if (isDescendant(accounts, a.id, parent)) { FW.toast("That would create a circular hierarchy.", "err"); return; }
      const acc = {
        id: a.id, code, name, type, parent, normal,
        description: String(f.description.value || "").trim(),
        active: f.active.checked,
        createdAt: a.createdAt || new Date().toISOString(),
      };
      saveAccount(acc, accounts).then(() => {
        modal.closest(".modal-back").remove();
        FW.toast(isNew ? "Account created" : "Account updated");
        onSaved();
      });
    });
  }

  /* ── Journal tab ──────────────────────────────────────────────────────── */
  async function renderJournal(ctn) {
    const [entries, accounts, closings] = await Promise.all([loadEntries(), loadAccounts(), loadClosings()]);
    const byId = {};
    accounts.forEach(x => byId[x.id] = x);
    const sorted = [...entries].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.no || "").localeCompare(String(b.no || "")));

    let html = '<div class="card"><div class="card-head"><h3>Journal entries</h3>' +
      '<button class="btn btn-primary btn-sm" id="jeNewBtn">+ New entry</button></div><div class="card-body" style="padding-top:4px">';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:20px 0 14px">No journal entries yet. Record a transaction to see it here — drafts can be edited, posting locks it and updates account balances.</p>';
    }
    for (const e of sorted) {
      const t = entryTotals(e);
      const posted = e.status === "posted";
      const lk = posted ? closedRangeFor(closings, e.date) : null;
      html += '<div class="je-card' + (posted ? " posted" : "") + '">' +
        '<div class="je-head">' +
        '<span class="je-no">' + esc(e.no || "—") + "</span>" +
        '<span class="je-meta">' + esc(e.date || "") + (e.reference ? " · " + esc(e.reference) : "") + "</span>" +
        '<span class="chip ' + (posted ? "chip-done" : "chip-pending") + '">' + (posted ? "posted" : "draft") + "</span>" +
        (e.type === "closing" || e.type === "closing-reversal"
          ? '<span class="chip chip-phase">' + (e.type === "closing" ? "closing" : "reversal") + "</span>" : "") +
        (lk ? '<span class="chip chip-pending">locked</span>' : "") +
        '<span class="je-meta num">' + FW.money(t.dr) + " ↔ " + FW.money(t.cr) + "</span>" +
        '<div class="je-actions">' +
        (posted
          ? '<button class="btn btn-ghost btn-sm" data-je-act="view" data-je-id="' + esc(e.id) + '">View</button>'
          : '<button class="btn btn-primary btn-sm" data-je-act="post" data-je-id="' + esc(e.id) + '">Post</button>' +
            '<button class="btn btn-ghost btn-sm" data-je-act="edit" data-je-id="' + esc(e.id) + '">Edit</button>' +
            '<button class="icon-mini danger" data-je-act="del" data-je-id="' + esc(e.id) + '" title="Delete">' + ICON.trash + "</button>") +
        "</div></div>" +
        '<div class="je-body">' +
        (e.memo ? '<div class="je-memo">' + esc(e.memo) + "</div>" : "");
      for (const l of e.lines) {
        const a = byId[l.account];
        html += '<div class="je-line"><span class="je-dot ' + (l.debit ? "dr" : "cr") + '"></span>' +
          '<span class="je-acct">' + esc(a ? a.code + " · " + a.name : "unknown") + "</span>" +
          '<span class="je-desc">' + esc(l.desc || "") + "</span>" +
          '<span class="je-amt">' + (l.debit ? "DR " + FW.money(l.debit) : "CR " + FW.money(l.credit)) + "</span></div>";
      }
      html += "</div></div>";
    }
    html += "</div></div>";
    ctn.innerHTML = html;

    ctn.querySelector("#jeNewBtn").addEventListener("click", () => entryModal(null, accounts, () => renderJournal(ctn), false));
    ctn.onclick = e => {
      const btn = e.target.closest("[data-je-act]");
      if (!btn) return;
      const id = btn.getAttribute("data-je-id");
      const act = btn.getAttribute("data-je-act");
      const entry = entries.find(x => x.id === id);
      if (!entry) return;
      if (act === "view") entryModal(entry, accounts, null, true);
      else if (act === "edit") entryModal(entry, accounts, () => renderJournal(ctn), false);
      else if (act === "post") {
        postEntry(id).then(r => {
          if (r.error) FW.toast(r.error, "err"); else { FW.toast("Entry posted — balances updated"); renderJournal(ctn); }
        });
      } else if (act === "del") {
        confirmDialog("Delete entry?", "Only draft entries can be deleted. This cannot be undone.", async () => {
          const r = await deleteEntry(id);
          if (r.error) FW.toast(r.error, "err"); else { FW.toast("Entry deleted"); renderJournal(ctn); }
        }, "Delete entry");
      }
    };
  }

  function entryModal(entry, accounts, onSaved, readOnly) {
    const isNew = !entry;
    const lines = isNew
      ? [{ account: "", desc: "", debit: "", credit: "" }]
      : entry.lines.map(l => ({ account: l.account, desc: l.desc || "", debit: l.debit, credit: l.credit }));
    const byId = {};
    accounts.forEach(x => byId[x.id] = x);

    const modal = FW.modal(
      '<div class="modal-head"><h3>' + (readOnly ? "Journal entry — " + esc(entry.no || "") : isNew ? "New journal entry" : "Edit journal entry — " + esc(entry.no || "")) + '</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="modal-body">' +
      '<div class="row-flex">' +
      '<div class="field" style="flex:1 1 150px"><label>Date</label><input type="date" id="jeDate" value="' + esc(isNew ? today() : entry.date || today()) + '"' + (readOnly ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:1 1 150px"><label>Reference</label><input id="jeRef" type="text" placeholder="e.g. INV-1042" value="' + esc(isNew ? "" : entry.reference || "") + '"' + (readOnly ? " disabled" : "") + "></div>" +
      '<div class="field" style="flex:2 1 220px"><label>Memo</label><input id="jeMemo" type="text" placeholder="What is this for?" value="' + esc(isNew ? "" : entry.memo || "") + '"' + (readOnly ? " disabled" : "") + "></div>" +
      "</div>" +
      '<div class="je-ed-label">Lines <span class="muted small">— debits must equal credits to post</span></div>' +
      '<div id="jeLines" class="je-ed-lines"></div>' +
      '<div class="je-ed-totals"><span id="jeTotDr">DR 0.00</span><span id="jeTotCr">CR 0.00</span><span id="jeStatus" class="chip chip-pending">draft</span></div>' +
      (readOnly ? "" : '<div class="row-flex" style="margin-top:14px">' +
        '<button class="btn btn-primary" id="jePostBtn">Post entry</button>' +
        '<button class="btn btn-ghost" id="jeSaveBtn">Save draft</button>' +
        '<button class="btn btn-ghost-subtle" data-close>Cancel</button></div>') +
      "</div>");
    modal.style.width = "min(860px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));

    const linesEl = modal.querySelector("#jeLines");
    const totDrEl = modal.querySelector("#jeTotDr");
    const totCrEl = modal.querySelector("#jeTotCr");
    const statusEl = modal.querySelector("#jeStatus");
    const postBtn = modal.querySelector("#jePostBtn");

    const optHtml = cur => accounts
      .filter(a => a.active || a.id === cur || (entry || {}).lines.some(l => l.account === a.id))
      .map(a => '<option value="' + a.id + '"' + (a.id === cur ? " selected" : "") + ">" + esc(a.code) + " · " + esc(a.name) + (a.active ? "" : " (inactive)") + "</option>").join("");

    function readLines() {
      const out = [];
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        const l = lines[i];
        const account = row.querySelector(".je-ed-acct").value;
        const desc = row.querySelector(".je-ed-desc").value;
        const debit = row.querySelector(".je-ed-dr").value;
        const credit = row.querySelector(".je-ed-cr").value;
        if (!account && !desc && !debit && !credit) return;
        out.push({ account, desc, debit: amt(debit), credit: amt(credit) });
      });
      return out;
    }

    function updateTotals() {
      const t = entryTotals({ lines: readLines() });
      totDrEl.textContent = "DR " + FW.money(t.dr);
      totCrEl.textContent = "CR " + FW.money(t.cr);
      const diff = round2(Math.abs(t.diff));
      if (diff < 0.005) {
        statusEl.textContent = "balanced";
        statusEl.className = "chip chip-done";
        if (postBtn) postBtn.disabled = false;
      } else {
        statusEl.textContent = "out of balance by " + FW.money(diff);
        statusEl.className = "chip chip-pending";
        if (postBtn) postBtn.disabled = true;
      }
    }

    function syncToArray() {
      FW.$$(".je-ed-line", linesEl).forEach(row => {
        const i = Number(row.getAttribute("data-i"));
        if (i >= 0 && i < lines.length) {
          lines[i] = {
            account: row.querySelector(".je-ed-acct").value,
            desc: row.querySelector(".je-ed-desc").value,
            debit: row.querySelector(".je-ed-dr").value,
            credit: row.querySelector(".je-ed-cr").value,
          };
        }
      });
    }

    function renderLines() {
      let rows = "";
      lines.forEach((l, i) => {
        rows += '<div class="je-ed-line" data-i="' + i + '">' +
          '<select class="je-ed-acct"' + (readOnly ? " disabled" : "") + ">" + optHtml(l.account) + "</select>" +
          '<input class="je-ed-desc" type="text" placeholder="Line description" value="' + esc(l.desc) + '"' + (readOnly ? " disabled" : "") + ">" +
          '<input class="je-ed-dr" type="number" min="0" step="0.01" placeholder="0.00" value="' + esc(l.debit) + '"' + (readOnly ? " disabled" : "") + ">" +
          '<input class="je-ed-cr" type="number" min="0" step="0.01" placeholder="0.00" value="' + esc(l.credit) + '"' + (readOnly ? " disabled" : "") + ">" +
          (readOnly ? "" : '<button class="icon-mini danger" data-rm="' + i + '" title="Remove line">' + ICON.x + "</button>") +
          "</div>";
      });
      rows += readOnly ? "" : '<button class="btn btn-ghost btn-sm" id="jeAddLine">+ Add line</button>';
      linesEl.innerHTML = rows;
      const addBtn = linesEl.querySelector("#jeAddLine");
      if (addBtn) addBtn.addEventListener("click", () => { syncToArray(); lines.push({ account: "", desc: "", debit: "", credit: "" }); renderLines(); updateTotals(); });
      FW.$$("[data-rm]", linesEl).forEach(b => b.addEventListener("click", () => {
        syncToArray();
        const i = Number(b.getAttribute("data-rm"));
        lines.splice(i, 1);
        if (!lines.length) lines.push({ account: "", desc: "", debit: "", credit: "" });
        renderLines(); updateTotals();
      }));
      if (!readOnly) linesEl.addEventListener("input", () => updateTotals());
    }

    renderLines();
    updateTotals();

    if (readOnly) return;

    const collect = () => {
      const out = readLines().filter(l => l.account && (amt(l.debit) > 0 || amt(l.credit) > 0));
      if (!out.length) { FW.toast("Add at least one line with an account and amount.", "err"); return null; }
      for (const l of out) {
        if (!l.account) { FW.toast("Every line needs an account.", "err"); return null; }
        if (amt(l.debit) > 0 && amt(l.credit) > 0) { FW.toast("A line can't have both a debit and a credit.", "err"); return null; }
        if (amt(l.debit) <= 0 && amt(l.credit) <= 0) { FW.toast("Every line needs a debit or credit amount.", "err"); return null; }
      }
      return out;
    };

    const build = linesOut => ({
      id: entry ? entry.id : null,
      no: entry ? entry.no : null,
      date: modal.querySelector("#jeDate").value || today(),
      reference: modal.querySelector("#jeRef").value.trim(),
      memo: modal.querySelector("#jeMemo").value.trim(),
      status: entry ? entry.status : "draft",
      lines: linesOut,
      createdAt: entry ? entry.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      postedAt: entry ? entry.postedAt : null,
    });

    modal.querySelector("#jeSaveBtn").addEventListener("click", async () => {
      const out = collect();
      if (!out) return;
      let e = build(out);
      const entries = await loadEntries();
      if (isNew) e.no = await nextEntryNo(entries);
      const res = await saveEntry(e, accounts);
      if (res && res.error) { FW.toast(res.error, "err"); return; }
      e = res;
      modal.closest(".modal-back").remove();
      FW.toast(e.status === "posted" ? "Entry saved & posted" : "Draft saved");
      onSaved && onSaved();
    });

    modal.querySelector("#jePostBtn").addEventListener("click", async () => {
      const out = collect();
      if (!out) return;
      let e = build(out);
      const entries = await loadEntries();
      if (isNew) e.no = await nextEntryNo(entries);
      const res = await saveEntry(e, accounts);
      if (res && res.error) { FW.toast(res.error, "err"); return; }
      e = res;
      const r = await postEntry(e.id);
      if (r.error) { FW.toast(r.error, "err"); onSaved && onSaved(); return; }
      modal.closest(".modal-back").remove();
      FW.toast("Entry posted — balances updated");
      onSaved && onSaved();
    });
  }

  /* ── Balances tab ─────────────────────────────────────────────────────── */
  async function renderBalances(ctn) {
    const [accounts, entries] = await Promise.all([loadAccounts(), loadEntries()]);
    const bal = computeBalances(entries, accounts);
    let totalDr = 0, totalCr = 0;
    for (const id in bal) { totalDr = round2(totalDr + bal[id].debit); totalCr = round2(totalCr + bal[id].credit); }
    const balanced = Math.abs(totalDr - totalCr) < 0.005;

    let html = '<div class="stat-grid" style="margin-bottom:16px">' +
      '<div class="stat-card card"><div class="stat-value">' + FW.money(totalDr) + '</div><div class="stat-label">Total debits (posted)</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + FW.money(totalCr) + '</div><div class="stat-label">Total credits (posted)</div></div>' +
      '<div class="stat-card card"><div class="stat-value"><span class="' + (balanced ? "ok-text" : "") + '">' + (balanced ? "Balanced" : "Out of balance") + '</span></div><div class="stat-label">Books are</div><div class="stat-sub">every posted entry was balanced on entry</div></div>' +
      "</div>";

    html += '<div class="card"><div class="card-head"><h3>Account balances</h3></div>' +
      '<p class="note small" style="margin:12px 16px 4px">Real-time balances recomputed from <strong>posted</strong> journal entries. Positive balance = the account’s normal side.</p>';
    for (const t of TYPES) {
      const list = accounts.filter(a => a.type === t.key);
      if (!list.length) continue;
      html += '<div class="type-head"><span>' + esc(t.label) + '</span><span class="count">' + list.length + " accounts</span></div>";
      html += '<table class="tbl"><thead><tr><th>Code</th><th>Account</th><th class="tr">Debits</th><th class="tr">Credits</th><th class="tr">Net balance</th></tr></thead><tbody>';
      for (const a of list) {
        const r = bal[a.id] || { debit: 0, credit: 0, balance: 0 };
        html += '<tr' + (a.active ? "" : ' class="row-inactive"') + ">" +
          '<td><span class="acct-code">' + esc(a.code) + "</span></td>" +
          "<td>" + esc(a.name) + (a.active ? "" : ' <span class="tag tag-inactive">inactive</span>') + "</td>" +
          '<td class="tr num">' + (r.debit ? FW.money(r.debit) : '<span class="muted">—</span>') + "</td>" +
          '<td class="tr num">' + (r.credit ? FW.money(r.credit) : '<span class="muted">—</span>') + "</td>" +
          '<td class="tr num"><strong>' + (r.balance ? FW.money(r.balance) : '<span class="muted">0.00</span>') + "</strong></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;
  }

  /* ── Period closing (Phase 1 · task 4) ───────────────────────────────── */
  const pad2 = n => String(n).padStart(2, "0");
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const XS_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); } // month is 1–12
  function periodLabel(type, year, unit) {
    if (type === "month") return MONTH_NAMES[(unit || 1) - 1] + " " + year;
    if (type === "quarter") return "Q" + unit + " " + year;
    return "Full year " + year;
  }
  function periodRange(type, year, unit) {
    let start, end;
    if (type === "month") {
      start = year + "-" + pad2(unit) + "-01";
      end = year + "-" + pad2(unit) + "-" + pad2(daysInMonth(year, unit));
    } else if (type === "quarter") {
      const sm = (unit - 1) * 3 + 1;
      start = year + "-" + pad2(sm) + "-01";
      end = year + "-" + pad2(sm + 2) + "-" + pad2(daysInMonth(year, sm + 2));
    } else {
      start = year + "-01-01";
      end = year + "-12-31";
    }
    return { start, end, label: periodLabel(type, year, unit) };
  }
  function closedRangeFor(closings, date) {
    return (closings || []).find(c => date && c.start <= date && date <= c.end) || null;
  }
  function overlappingClose(closings, start, end) {
    return (closings || []).find(c => c.start <= end && start <= c.end) || null;
  }

  /* Net balances of the temporary accounts over a range → closing lines.
     Closing entries from earlier (sub-period) closes dated inside the range
     are included, so their amounts offset and nothing is double-counted. */
  function closingPlan(accounts, entries, start, end) {
    const inRange = entries.filter(e => e.status === "posted" && e.date && e.date >= start && e.date <= end);
    const drLines = [], crLines = [];
    for (const a of accounts) {
      if (a.type !== "revenue" && a.type !== "expense") continue;
      let dr = 0, cr = 0;
      for (const e of inRange) for (const l of e.lines) {
        if (l.account === a.id) { dr = round2(dr + amt(l.debit)); cr = round2(cr + amt(l.credit)); }
      }
      const bal = round2(a.normal === "credit" ? cr - dr : dr - cr);
      if (Math.abs(bal) < 0.005) continue;
      const desc = "Close " + a.code;
      if (a.normal === "credit") drLines.push({ account: a.id, desc, debit: bal });
      else crLines.push({ account: a.id, desc, credit: bal });
    }
    const debitTotal = round2(drLines.reduce((s, l) => s + l.debit, 0));
    const creditTotal = round2(crLines.reduce((s, l) => s + l.credit, 0));
    return { lines: [...drLines, ...crLines], debitTotal, creditTotal, netIncome: round2(debitTotal - creditTotal), entryCount: inRange.length };
  }
  /* Add the retained-earnings line so the closing plan balances exactly. */
  function balancePlan(plan, retainedId) {
    const lines = plan.lines.slice();
    const diff = round2(plan.debitTotal - plan.creditTotal);
    if (Math.abs(diff) >= 0.005) {
      if (diff > 0) lines.push({ account: retainedId, credit: round2(diff), desc: "Carry net income to retained earnings" });
      else lines.push({ account: retainedId, debit: round2(-diff), desc: "Carry net loss out of retained earnings" });
    }
    const t = entryTotals({ lines });
    return { lines, balanced: Math.abs(t.diff) < 0.005, debitTotal: t.dr, creditTotal: t.cr };
  }
  function retainedAccountId(accounts) {
    let a = accounts.find(x => x.code === "3200" && x.type === "equity");
    if (!a) a = accounts.find(x => x.type === "equity" && x.normal === "credit" && /retained|owner|capital|equity/i.test(x.name || ""));
    if (!a) a = accounts.find(x => x.type === "equity" && x.normal === "credit");
    return a ? a.id : null;
  }

  async function loadClosings() {
    const v = await FW.store.get(K.closings, null);
    return Array.isArray(v) ? v : [];
  }
  async function saveClosings(list) { await FW.store.set(K.closings, list); }

  async function closePeriod({ type, year, month, quarter }) {
    const range = periodRange(type, year, type === "month" ? month : type === "quarter" ? quarter : null);
    if (!range.start || !range.end || range.start > range.end) return { error: "Invalid period range." };
    const accounts = await loadAccounts();
    const entries = await loadEntries();
    const dup = overlappingClose(await loadClosings(), range.start, range.end);
    if (dup) return { error: "This range overlaps the closed period “" + dup.label + "” (" + dup.start + " → " + dup.end + "). Reopen it first or pick another period." };
    const draft = entries.find(e => e.status !== "posted" && e.date && e.date >= range.start && e.date <= range.end);
    if (draft) return { error: "Draft entry " + (draft.no || "—") + " (" + draft.date + ") lies inside this period — post or delete it before closing." };
    const re = retainedAccountId(accounts);
    if (!re) return { error: "No retained-earnings / equity account found to carry net income to. Add an equity account first." };
    const plan = closingPlan(accounts, entries, range.start, range.end);
    const b = balancePlan(plan, re);
    if (!b.balanced) return { error: "Closing entry would not balance — please review the ledger for this range." };
    const jeIds = [], jeNos = [];
    if (b.lines.length) {
      const e = {
        id: uid("je"), no: null, date: range.end, reference: "PERIOD CLOSE",
        memo: "Closing entries — " + range.label, status: "draft", type: "closing",
        lines: b.lines, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), postedAt: null,
      };
      e.no = await nextEntryNo(await loadEntries());
      const saved = await saveEntry(e, accounts);
      if (saved && saved.error) return saved;
      const pr = await postEntry(saved.id);
      if (pr && pr.error) return pr;
      jeIds.push(saved.id); jeNos.push(saved.no);
    }
    const rec = {
      id: uid("cl"), label: range.label, type, year,
      unit: type === "month" ? month : type === "quarter" ? quarter : null,
      start: range.start, end: range.end,
      netIncome: round2(plan.netIncome), entryCount: plan.entryCount,
      jeIds, jeNos, closedAt: new Date().toISOString(), by: "owner",
    };
    const closings = await loadClosings();
    closings.push(rec);
    await saveClosings(closings);
    await auditLog("period.close", {
      entity: "period", entityId: rec.id, entityLabel: range.label,
      summary: "Closed " + range.label + " — carried " + FW.money(rec.netIncome) + " of net income to retained earnings (" + (jeNos.length ? "closing " + jeNos.join(", ") : "no entries needed") + ")",
      prev: null, next: cloneObj(rec),
    });
    return { ok: true, record: rec };
  }

  async function reopenPeriod(id) {
    let closings = await loadClosings();
    const rec = closings.find(c => c.id === id);
    if (!rec) return { error: "Closed period not found." };
    closings = closings.filter(c => c.id !== id);
    await saveClosings(closings);
    if (rec.jeIds && rec.jeIds.length) {
      const accounts = await loadAccounts();
      const entries = await loadEntries();
      for (const jeId of rec.jeIds) {
        const je = entries.find(x => x.id === jeId);
        if (!je) continue;
        const rv = {
          id: uid("je"), no: null, date: je.date || rec.end, reference: "REOPEN",
          memo: "Reversal — reopened “" + rec.label + "” (reverses " + je.no + ")",
          status: "draft", type: "closing-reversal",
          lines: je.lines.map(l => ({ account: l.account, desc: l.desc || "", debit: l.credit, credit: l.debit })),
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), postedAt: null,
        };
        rv.no = await nextEntryNo(await loadEntries());
        const saved = await saveEntry(rv, accounts);
        if (saved && saved.error) return saved;
        const pr = await postEntry(saved.id);
        if (pr && pr.error) return pr;
      }
    }
    await auditLog("period.reopen", {
      entity: "period", entityId: rec.id, entityLabel: rec.label,
      summary: "Reopened " + rec.label + " — date range unlocked" + (rec.jeNos && rec.jeNos.length ? " and " + rec.jeNos.length + " reversal entry(ies) posted" : ""),
      prev: cloneObj(rec), next: null,
    });
    return { ok: true, record: rec };
  }

  /* ── Audit trail (Phase 1 · task 5) ──────────────────────────────────── */
  async function loadAudit() {
    const v = await FW.store.get(K.audit, null);
    return Array.isArray(v) ? v : [];
  }
  async function saveAudit(list) { await FW.store.set(K.audit, list); }
  function cloneObj(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
  function diffFields(prev, next) {
    const keys = new Set();
    if (prev) Object.keys(prev).forEach(k => keys.add(k));
    if (next) Object.keys(next).forEach(k => keys.add(k));
    const out = [];
    for (const k of keys) {
      const p = prev ? JSON.stringify(prev[k]) : undefined;
      const n = next ? JSON.stringify(next[k]) : undefined;
      if (p !== n) out.push({ field: k, prev: prev ? cloneObj(prev[k]) : null, next: next ? cloneObj(next[k]) : null });
    }
    return out;
  }
  async function auditLog(action, o) {
    const list = await loadAudit();
    list.push({
      id: uid("au"), ts: new Date().toISOString(), user: o.user || "owner",
      action, entity: o.entity || "journal", entityId: o.entityId || "",
      entityLabel: o.entityLabel || "", summary: o.summary || "",
      prev: o.prev ?? null, next: o.next ?? null,
    });
    await saveAudit(list);
  }

  /* ── Trial balance (Phase 1 · task 6) ────────────────────────────────── */
  function trialBalance(accounts, entries, asOf) {
    const posted = entries.filter(e => e.status === "posted" && (!asOf || (e.date && e.date <= asOf)));
    const acc = {};
    for (const e of posted) for (const l of e.lines) {
      const r = acc[l.account] || (acc[l.account] = { dr: 0, cr: 0 });
      r.dr = round2(r.dr + amt(l.debit)); r.cr = round2(r.cr + amt(l.credit));
    }
    const typeOrder = {};
    TYPES.forEach((t, i) => typeOrder[t.key] = i);
    const rows = [];
    for (const a of accounts) {
      const r = acc[a.id];
      if (!r || (Math.abs(r.dr) < 0.005 && Math.abs(r.cr) < 0.005)) continue;
      const bal = round2(a.normal === "credit" ? r.cr - r.dr : r.dr - r.cr);
      if (Math.abs(bal) < 0.005) continue;
      const debit = a.normal === "credit" ? (bal < 0 ? round2(-bal) : 0) : (bal > 0 ? bal : 0);
      const credit = a.normal === "credit" ? (bal > 0 ? bal : 0) : (bal < 0 ? round2(-bal) : 0);
      rows.push({ id: a.id, code: a.code, name: a.name, type: a.type, typeLabel: typeOf(a.type).label, debit, credit });
    }
    rows.sort((x, y) => (typeOrder[x.type] - typeOrder[y.type]) || String(x.code).localeCompare(String(y.code)));
    const totals = {
      debit: round2(rows.reduce((s, r) => s + r.debit, 0)),
      credit: round2(rows.reduce((s, r) => s + r.credit, 0)),
    };
    return { asOf: asOf || null, rows, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.005, postedCount: posted.length };
  }

  /* ── Periods tab UI ──────────────────────────────────────────────────── */
  async function renderPeriods(ctn) {
    const [closings, entries, accounts] = await Promise.all([loadClosings(), loadEntries(), loadAccounts()]);
    const lockedEntries = entries.filter(e => e.status === "posted" && closedRangeFor(closings, e.date));
    let carried = 0;
    closings.forEach(c => carried = round2(carried + (c.netIncome || 0)));
    let html = '<div class="stat-grid" style="margin-bottom:16px">' +
      '<div class="stat-card card"><div class="stat-value">' + closings.length + '</div><div class="stat-label">Periods closed</div><div class="stat-sub">new entries dated inside them are blocked</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + FW.money(carried) + '</div><div class="stat-label">Net income carried to equity</div><div class="stat-sub">across all closes</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + lockedEntries.length + '</div><div class="stat-label">Locked posted entries</div><div class="stat-sub">inside closed date ranges</div></div>' +
      "</div>";
    html += '<div class="card"><div class="card-head"><h3>Closed periods</h3>' +
      '<button class="btn btn-primary btn-sm" id="closeNewBtn">+ Close a period</button></div>';
    if (!closings.length) {
      html += '<p class="muted small" style="text-align:center;padding:18px 14px">No periods closed yet. Closing locks a date range (no new or edited entries dated inside it) and carries that range’s net income into retained earnings with an automatic, audited closing entry.</p>';
    } else {
      html += '<div class="stack" style="padding:14px 16px 16px">';
      for (const c of closings.slice().sort((a, b) => String(b.end).localeCompare(String(a.end)))) {
        const jes = (c.jeIds || []).map(id => entries.find(x => x.id === id)).filter(Boolean);
        html += '<div class="je-card">' +
          '<div class="je-head">' +
          '<span class="je-no">' + esc(c.label) + "</span>" +
          '<span class="je-meta">' + esc(c.start) + " → " + esc(c.end) + "</span>" +
          '<span class="chip chip-done">closed</span>' +
          '<span class="je-meta num">' + FW.money(c.netIncome || 0) + (c.netIncome < 0 ? " <span class=\"muted small\">loss</span>" : "") + "</span>" +
          '<div class="je-actions">' +
          jes.map(je => '<button class="btn btn-ghost btn-sm" data-cl-je="' + esc(je.id) + '">' + esc(je.no) + "</button>").join("") +
          '<button class="btn btn-ghost btn-sm" data-cl-reopen="' + esc(c.id) + '">Reopen</button>' +
          "</div></div>" +
          '<div class="je-body muted small" style="padding:6px 14px">closed ' + esc(String(c.closedAt || "").replace("T", " ").slice(0, 16)) +
          " · " + (c.entryCount || 0) + " posted entries in range · " +
          (jes.length ? "closing " + (jes.length === 1 ? "entry" : "entries") + " posted " + esc(c.end) : "no entries needed") +
          "</div></div>";
      }
      html += "</div>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#closeNewBtn").addEventListener("click", () => closePeriodModal(accounts, entries, closings, () => renderPeriods(ctn)));
    ctn.onclick = e => {
      const je = e.target.closest("[data-cl-je]");
      const ro = e.target.closest("[data-cl-reopen]");
      if (je) {
        const entry = entries.find(x => x.id === je.getAttribute("data-cl-je"));
        if (entry) entryModal(entry, accounts, null, true);
      } else if (ro) {
        const rec = closings.find(c => c.id === ro.getAttribute("data-cl-reopen"));
        confirmDialog("Reopen “" + (rec ? rec.label : "this period") + "”?",
          "Reopening unlocks the date range and posts reversing entries that undo the earlier closing entries, restoring the revenue & expense balances. Both actions are recorded in the audit trail.",
          async () => {
            const r = await reopenPeriod(ro.getAttribute("data-cl-reopen"));
            if (r.error) FW.toast(r.error, "err"); else { FW.toast("Period reopened — reversal entries posted"); renderPeriods(ctn); }
          }, "Reopen period");
      }
    };
  }

  function closePeriodModal(accounts, entries, closings, onDone) {
    const now = new Date();
    const byId = {};
    accounts.forEach(a => byId[a.id] = a);
    const modal = FW.modal(
      '<div class="modal-head"><h3>Close a period</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body">' +
      '<p class="note small" style="margin-top:0">Closing locks every transaction dated inside the range and posts one automatic journal entry on the period’s last day: revenue & expense accounts are zeroed and the net result is carried to retained earnings. Every posted entry inside the range must already be posted.</p>' +
      '<div class="row-flex" style="align-items:flex-end">' +
      '<div class="field" style="margin-bottom:10px"><label>Period type</label><select id="cpType"><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></div>' +
      '<div class="field" style="margin-bottom:10px"><label>Year</label><input type="number" id="cpYear" min="2000" max="2100" value="' + now.getFullYear() + '" style="width:110px"></div>' +
      '<div class="field" id="cpMonthField" style="margin-bottom:10px"><label>Month</label><select id="cpMonth">' +
      MONTH_NAMES.map((mn, i) => '<option value="' + (i + 1) + '"' + (now.getMonth() === i ? " selected" : "") + ">" + mn + "</option>").join("") +
      "</select></div>" +
      '<div class="field" id="cpQuarterField" style="margin-bottom:10px" hidden><label>Quarter</label><select id="cpQuarter">' +
      [1, 2, 3, 4].map(q => '<option value="' + q + '">Q' + q + " (" + ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][q - 1] + ")</option>").join("") +
      "</select></div></div>" +
      '<div class="softbox" id="cpSummary" style="margin-bottom:14px"></div>' +
      '<div class="row-flex"><button class="btn btn-primary" id="cpGoBtn">Close period</button>' +
      '<button class="btn btn-ghost" data-close>Cancel</button></div></div>');
    modal.style.width = "min(760px, 100%)";
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));

    const sumEl = modal.querySelector("#cpSummary");
    const goBtn = modal.querySelector("#cpGoBtn");
    const qv = sel => modal.querySelector(sel).value;
    const readSel = () => {
      const type = qv("#cpType");
      const year = parseInt(qv("#cpYear"), 10) || now.getFullYear();
      const unit = parseInt(type === "quarter" ? qv("#cpQuarter") : qv("#cpMonth"), 10);
      return { type, year, unit };
    };

    function refresh() {
      const { type, year, unit } = readSel();
      modal.querySelector("#cpMonthField").hidden = type !== "month";
      modal.querySelector("#cpQuarterField").hidden = type !== "quarter";
      const r = periodRange(type, year, unit);
      const dup = overlappingClose(closings, r.start, r.end);
      const draft = entries.find(e => e.status !== "posted" && e.date && e.date >= r.start && e.date <= r.end);
      const re = retainedAccountId(accounts);
      const plan = closingPlan(accounts, entries, r.start, r.end);
      const b = re ? balancePlan(plan, re) : { lines: [], balanced: false };
      let html = '<div class="row-flex"><span class="chip chip-phase">' + esc(r.label) + '</span>' +
        '<span class="muted small mono">' + esc(r.start) + " → " + esc(r.end) + "</span></div>";
      const warn = msg => html += '<p class="small" style="margin:8px 0 0;color:var(--danger)">' + msg + "</p>";
      if (dup) {
        warn("Overlaps the already-closed period “" + esc(dup.label) + "”. Reopen it first or choose another period.");
        goBtn.disabled = true;
      } else if (draft) {
        warn("Draft entry " + esc(draft.no || "—") + " (" + esc(draft.date) + ") is inside this range — post or delete it before closing.");
        goBtn.disabled = true;
      } else if (!re) {
        warn("No retained-earnings / equity account exists to carry net income to. Add an equity account first.");
        goBtn.disabled = true;
      } else {
        goBtn.disabled = false;
        if (!b.lines.length) {
          html += '<p class="small muted" style="margin:8px 0 0">No posted revenue or expense activity in this range — closing will just lock it.</p>';
        } else {
          const shown = b.lines.slice(0, 14);
          html += '<table class="tbl" style="margin-top:8px"><thead><tr><th>Account</th><th class="tr">Debit</th><th class="tr">Credit</th></tr></thead><tbody>';
          for (const l of shown) {
            const a = byId[l.account];
            html += "<tr><td>" + esc(a ? a.code + " · " + a.name : "?") +
              (l.desc ? ' <span class="muted small">' + esc(l.desc) + "</span>" : "") + "</td>" +
              '<td class="tr num">' + (l.debit ? FW.money(l.debit) : "") + "</td>" +
              '<td class="tr num">' + (l.credit ? FW.money(l.credit) : "") + "</td></tr>";
          }
          html += "</tbody></table>";
          if (b.lines.length > shown.length) html += '<div class="muted small" style="margin-top:6px">… and ' + (b.lines.length - shown.length) + " more line(s)</div>";
        }
        html += '<div class="row-flex" style="margin-top:10px"><span class="stat-value" style="font-size:18px">' + FW.money(plan.netIncome) + "</span>" +
          '<span class="muted small">net income carried ' + (plan.netIncome >= 0 ? "to" : "out of") + " retained earnings</span></div>";
      }
      sumEl.innerHTML = html;
    }
    modal.querySelectorAll("#cpType, #cpYear, #cpMonth, #cpQuarter").forEach(el => el.addEventListener("change", refresh));
    refresh();

    goBtn.addEventListener("click", () => {
      const { type, year, unit } = readSel();
      goBtn.disabled = true;
      closePeriod({ type, year, month: type === "month" ? unit : null, quarter: type === "quarter" ? unit : null }).then(r => {
        if (r.error) { goBtn.disabled = false; FW.toast(r.error, "err"); return; }
        FW.toast("Closed " + r.record.label + " — " + (r.record.jeNos.length ? r.record.jeNos.join(", ") : "range locked"));
        modal.closest(".modal-back").remove();
        onDone && onDone();
      });
    });
  }

  /* ── Trial balance tab UI ────────────────────────────────────────────── */
  async function renderTrial(ctn) {
    const [entries, accounts] = await Promise.all([loadEntries(), loadAccounts()]);
    const run = asOf => {
      const tb = trialBalance(accounts, entries, asOf);
      let html = '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>Trial balance</h3></div>' +
        '<div class="card-body" style="padding-top:0"><div class="row-flex" style="padding-top:14px">' +
        '<div class="field" style="margin:0"><label>As of date</label><input type="date" id="tbDate" value="' + esc(asOf || today()) + '"></div>' +
        '<button class="btn btn-primary btn-sm" id="tbRunBtn" style="margin-top:22px">Run trial balance</button>' +
        '<div class="grow"></div>' +
        '<span class="chip ' + (tb.balanced ? "chip-done" : "chip-pending") + '">' + (tb.balanced ? "balanced" : "out of balance") + "</span>" +
        "</div></div></div>";
      html += '<div class="card"><div class="card-head"><h3>Balances ' + (asOf ? "as of " + esc(asOf) : "— all posted entries") + "</h3>" +
        '<span class="small muted">' + tb.postedCount + " posted entr" + (tb.postedCount === 1 ? "y" : "ies") + " considered</span></div>";
      if (!tb.rows.length) {
        html += '<p class="muted small" style="text-align:center;padding:18px 14px">No posted activity as of this date.</p>';
      } else {
        html += '<table class="tbl"><thead><tr><th>Code</th><th>Account</th><th class="tr">Debit</th><th class="tr">Credit</th></tr></thead><tbody>';
        let lastType = null;
        for (const r of tb.rows) {
          if (r.typeLabel !== lastType) {
            lastType = r.typeLabel;
            html += '<tr class="tb-type-row"><td colspan="4">' + esc(r.typeLabel) + "</td></tr>";
          }
          html += "<tr><td><span class='acct-code'>" + esc(r.code) + "</span></td><td>" + esc(r.name) + "</td>" +
            '<td class="tr num">' + (r.debit ? FW.money(r.debit) : "") + "</td>" +
            '<td class="tr num">' + (r.credit ? FW.money(r.credit) : "") + "</td></tr>";
        }
        html += '<tr class="tb-total-row"><td colspan="2">Totals</td>' +
          '<td class="tr num">' + FW.money(tb.totals.debit) + "</td>" +
          '<td class="tr num">' + FW.money(tb.totals.credit) + "</td></tr></tbody></table>";
      }
      html += "</div>";
      ctn.innerHTML = html;
      const dt = ctn.querySelector("#tbDate");
      if (!dt) return;
      ctn.querySelector("#tbRunBtn").addEventListener("click", () => run(dt.value || ""));
    };
    run(today());
  }

  /* ── Audit tab UI ────────────────────────────────────────────────────── */
  const AU_ENTITIES = ["all", "journal", "account", "period", "purchase_order", "bill", "payment", "recurring", "customer", "quote", "invoice", "ar_payment", "reminder", "currency", "tax_rate", "ocr_doc", "employee", "timesheet", "payrun", "item", "inv_move", "project"];
  const AU_ACTIONS = ["all", "entry.create", "entry.update", "entry.post", "entry.delete", "account.create", "account.update", "account.delete", "period.close", "period.reopen", "po.create", "po.update", "po.status", "po.bill", "po.delete", "bill.create", "bill.update", "bill.post", "bill.delete", "bill.pay", "recurring.create", "recurring.update", "recurring.pause", "recurring.resume", "recurring.advance", "recurring.generate", "recurring.delete", "customer.create", "customer.update", "customer.delete", "quote.create", "quote.update", "quote.convert", "quote.delete", "invoice.create", "invoice.update", "invoice.post", "invoice.pay", "invoice.void", "invoice.delete", "invoice.generate", "ar_payment.confirm", "reminder.send", "currency.create", "currency.update", "currency.delete", "tax_rate.create", "tax_rate.update", "tax_rate.delete", "ocr_doc.ingest", "ocr_doc.extract", "ocr_doc.review", "ocr_doc.commit", "ocr_doc.delete", "employee.create", "employee.update", "employee.delete", "timesheet.create", "timesheet.update", "timesheet.submit", "timesheet.approve", "timesheet.delete", "payrun.create", "payrun.update", "payrun.post", "payrun.delete", "item.create", "item.update", "item.delete", "inv_move.create", "project.create", "project.update", "project.delete"];
  const AU_LABEL = {
    "entry.create": "Entry created", "entry.update": "Entry edited", "entry.post": "Entry posted", "entry.delete": "Entry deleted",
    "account.create": "Account created", "account.update": "Account updated", "account.delete": "Account deleted",
    "period.close": "Period closed", "period.reopen": "Period reopened",
    "po.create": "PO created", "po.update": "PO edited", "po.status": "PO status changed", "po.bill": "PO billed", "po.delete": "PO deleted",
    "bill.create": "Bill created", "bill.update": "Bill edited", "bill.post": "Bill posted", "bill.delete": "Bill deleted", "bill.pay": "Bill paid",
    "recurring.create": "Rule created", "recurring.update": "Rule edited", "recurring.pause": "Rule paused", "recurring.resume": "Rule resumed",
    "recurring.advance": "Rule advanced", "recurring.generate": "Draft generated", "recurring.delete": "Rule deleted",
    "customer.create": "Customer created", "customer.update": "Customer updated", "customer.delete": "Customer deleted",
    "quote.create": "Quote created", "quote.update": "Quote edited", "quote.convert": "Quote converted", "quote.delete": "Quote deleted",
    "invoice.create": "Invoice created", "invoice.update": "Invoice edited", "invoice.post": "Invoice posted", "invoice.pay": "Invoice paid", "invoice.void": "Invoice voided", "invoice.delete": "Invoice deleted", "invoice.generate": "Invoice generated",
    "ar_payment.confirm": "Payment confirmed", "reminder.send": "Reminder sent",
    "currency.create": "Currency added", "currency.update": "Currency updated", "currency.delete": "Currency removed",
    "tax_rate.create": "Tax rate added", "tax_rate.update": "Tax rate updated", "tax_rate.delete": "Tax rate removed",
    "ocr_doc.ingest": "Doc ingested", "ocr_doc.extract": "Doc extracted", "ocr_doc.review": "Doc reviewed", "ocr_doc.commit": "Doc committed", "ocr_doc.delete": "Doc deleted",
    "employee.create": "Employee created", "employee.update": "Employee updated", "employee.delete": "Employee deleted",
    "timesheet.create": "Timesheet created", "timesheet.update": "Timesheet edited", "timesheet.submit": "Timesheet submitted", "timesheet.approve": "Timesheet approved", "timesheet.delete": "Timesheet deleted",
    "payrun.create": "Pay run created", "payrun.update": "Pay run edited", "payrun.post": "Pay run posted", "payrun.delete": "Pay run deleted",
    "item.create": "Item created", "item.update": "Item updated", "item.delete": "Item deleted", "inv_move.create": "Stock movement",
    "project.create": "Project created", "project.update": "Project updated", "project.delete": "Project deleted",
  };
  const AU_ENTITY_LABEL = { journal: "Journal entries", account: "Accounts", period: "Periods", purchase_order: "Purchase orders", bill: "Vendor bills", payment: "Payments", recurring: "Recurring expenses", customer: "Customers", quote: "Quotes", invoice: "Invoices", ar_payment: "Receipts", reminder: "Reminders", currency: "Currencies", tax_rate: "Tax rates", ocr_doc: "OCR documents", employee: "Employees", timesheet: "Timesheets", payrun: "Pay runs", item: "Inventory items", inv_move: "Stock movements", project: "Projects" };

  async function renderAudit(ctn) {
    let ent = "all", act = "all", q = "";
    const all = (await loadAudit()).slice().reverse();

    function prettyVal(v) {
      if (v === null || v === undefined) return '<span class="muted small">— (none)</span>';
      return "<pre>" + esc(typeof v === "object" ? JSON.stringify(v, null, 1) : String(v)) + "</pre>";
    }
    function auditModal(rec) {
      const diffs = diffFields(rec.prev, rec.next);
      let body = '<div class="row-flex" style="gap:6px">' +
        '<span class="chip chip-phase">' + esc(AU_LABEL[rec.action] || rec.action) + "</span>" +
        '<span class="chip chip-done">' + esc(rec.user) + "</span>" +
        '<span class="muted small mono">' + esc(rec.ts || "") + "</span></div>" +
        (rec.entityLabel ? '<p class="small" style="margin:10px 0 0"><strong>' + esc(rec.entityLabel) + "</strong></p>" : "") +
        (rec.summary ? '<p class="muted small" style="margin:4px 0 0">' + esc(rec.summary) + "</p>" : "");
      if (!diffs.length) {
        body += '<p class="note small" style="margin-top:14px">Payload added or removed (no field-level diff to show).</p>';
      } else {
        body += '<div class="je-ed-label" style="margin:14px 0 6px">Changed fields</div><div class="au-list">';
        for (const d of diffs) {
          body += '<div class="softbox au-diff"><div class="au-field">' + esc(d.field) + "</div>" +
            '<div class="diff-cols">' +
            '<div class="diff-col before"><div class="au-side">before</div>' + prettyVal(d.prev) + "</div>" +
            '<div class="diff-col after"><div class="au-side">after</div>' + prettyVal(d.next) + "</div>" +
            "</div></div>";
        }
        body += "</div>";
      }
      const modal = FW.modal('<div class="modal-head"><h3>Audit record</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body">' + body + "</div>");
      modal.style.width = "min(720px, 100%)";
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    }

    function draw() {
      const rows = all.filter(r =>
        (ent === "all" || r.entity === ent) &&
        (act === "all" || r.action === act) &&
        (!q || (r.entityId + " " + r.entityLabel + " " + (r.summary || "") + " " + (r.user || "")).toLowerCase().includes(q)));
      let html = '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Audit trail</h3></div>' +
        '<div class="card-body" style="padding-top:2px">' +
        '<p class="note small" style="margin-top:0">Every mutation of accounts, journal entries and closed periods is appended here automatically — timestamp, actor, and before/after snapshots. Records are <strong>append-only</strong>: there is no edit or delete.</p>' +
        '<div class="row-flex" style="margin-top:12px">' +
        '<div class="field" style="margin:0;min-width:150px"><label>Entity</label><select id="auEntity">' +
        AU_ENTITIES.map(x => '<option value="' + x + '"' + (x === ent ? " selected" : "") + ">" + (x === "all" ? "All entities" : esc(AU_ENTITY_LABEL[x])) + "</option>").join("") +
        "</select></div>" +
        '<div class="field" style="margin:0;min-width:180px"><label>Action</label><select id="auAction">' +
        AU_ACTIONS.map(x => '<option value="' + x + '"' + (x === act ? " selected" : "") + ">" + (x === "all" ? "All actions" : esc(AU_LABEL[x])) + "</option>").join("") +
        "</select></div>" +
        '<div class="field" style="margin:0;flex:1;min-width:160px"><label>Search</label><input id="auQ" type="search" placeholder="Entry no, account, period…" value="' + esc(q) + '"></div>' +
        "</div></div></div>";
      html += '<div class="card"><div class="card-head"><h3>' + rows.length + " record" + (rows.length === 1 ? "" : "s") + "</h3></div>";
      if (!rows.length) {
        html += '<p class="muted small" style="text-align:center;padding:18px 14px">No audit records match.</p>';
      } else {
        html += '<table class="tbl"><thead><tr><th>When</th><th>Entity</th><th>Action</th><th>Summary</th><th></th></tr></thead><tbody>';
        for (const r of rows) {
          const time = String(r.ts || "").replace("T", " ").replace(/\.\d+Z?$/, "");
          html += "<tr>" +
            '<td class="mono small au-when">' + esc(time) + "</td>" +
            '<td class="au-ent">' + esc(r.entityLabel || r.entityId || r.entity) + "</td>" +
            '<td class="au-act"><span class="chip chip-phase" style="font-size:10.5px">' + esc(AU_LABEL[r.action] || r.action) + "</span></td>" +
            '<td class="small muted au-sum">' + esc(r.summary || "") + "</td>" +
            '<td class="tr au-eye"><button class="icon-mini" data-au="' + esc(r.id) + '" title="View details">' + ICON.eye + "</button></td></tr>";
        }
        html += "</tbody></table>";
      }
      html += "</div>";
      ctn.innerHTML = html;
      const recOf = id => all.find(r => r.id === id);
      ctn.querySelector("#auEntity").addEventListener("change", e => { ent = e.target.value; draw(); });
      ctn.querySelector("#auAction").addEventListener("change", e => { act = e.target.value; draw(); });
      ctn.querySelector("#auQ").addEventListener("input", e => { q = e.target.value; draw(); });
      ctn.onclick = e => {
        const b = e.target.closest("[data-au]");
        if (b) { const rec = recOf(b.getAttribute("data-au")); if (rec) auditModal(rec); }
      };
    }
    draw();
  }

  /* ── icons ────────────────────────────────────────────────────────────── */
  const ICON = {
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9.9 9.9a3 3 0 0 0 4.24 4.24"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };

  /* ── self-test (validation for tasks 1–6) ────────────────────────────── */
  function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });
    const chart = defaultChart();
    ok("CoA: 5 account types present", ["asset", "liability", "equity", "revenue", "expense"].every(t => chart.some(a => a.type === t)));
    ok("CoA: unique account codes", new Set(chart.map(a => a.code)).size === chart.length);
    ok("CoA: all parent refs resolve", chart.every(a => !a.parent || chart.some(p => p.id === a.parent)));
    ok("CoA: no parent cycles", chart.every(a => !isDescendant(chart, a.id, a.id)));
    const kids = chart.filter(a => a.parent);
    ok("CoA: hierarchy present (child accounts)", kids.length > 0, kids.length + " children");
    ok("CoA: normal side derives from type", chart.every(a => a.normal === (typeOf(a.type).normal) || a.id === "a1490"));
    ok("CoA: contra account (accum. depreciation) is credit-normal asset", chart.find(a => a.id === "a1490").normal === "credit");

    const eBal = { lines: [{ account: "a", debit: 100 }, { account: "l", credit: 100 }] };
    ok("JE: balanced entry detected", isBalanced(eBal));
    const eUnbal = { lines: [{ account: "a", debit: 100 }, { account: "l", credit: 99.5 }] };
    ok("JE: unbalanced entry rejected", !isBalanced(eUnbal), "diff " + entryTotals(eUnbal).diff);
    ok("JE: totals computed", entryTotals(eBal).dr === 100 && entryTotals(eBal).cr === 100);

    const accs = [{ id: "a", normal: "debit" }, { id: "l", normal: "credit" }, { id: "x", normal: "debit" }];
    const entries = [
      { status: "posted", lines: [{ account: "a", debit: 100, credit: 0 }, { account: "l", debit: 0, credit: 100 }] },
      { status: "draft", lines: [{ account: "a", debit: 500, credit: 0 }, { account: "l", debit: 0, credit: 500 }] },
      { status: "posted", lines: [{ account: "a", debit: 12.34, credit: 0 }, { account: "l", debit: 0, credit: 12.34 }] },
    ];
    const bal = computeBalances(entries, accs);
    ok("Posting: only posted entries affect balances", bal.a.debit === 112.34 && bal.a.credit === 0);
    ok("Posting: debit-normal net balance", bal.a.balance === 112.34);
    ok("Posting: credit-normal net balance", bal.l.balance === 112.34);
    ok("Posting: untouched account is zero", bal.x.balance === 0 && bal.x.debit === 0);
    ok("Posting: floating-point-safe totals", bal.a.debit === round2(100 + 12.34));

    /* ── period closing (task 4) ── */
    const accP = [
      { id: "cash", code: "1000", type: "asset", normal: "debit", name: "Cash" },
      { id: "rev", code: "4000", type: "revenue", normal: "credit", name: "Sales" },
      { id: "exp", code: "5100", type: "expense", normal: "debit", name: "Rent" },
      { id: "re", code: "3200", type: "equity", normal: "credit", name: "Retained Earnings" },
    ];
    const postedIn = (lines, date) => ({ status: "posted", date, lines });
    const R = { start: "2026-01-01", end: "2026-03-31" };
    const e1 = postedIn([{ account: "cash", debit: 4000 }, { account: "rev", credit: 4000 }], "2026-01-15");
    const e2 = postedIn([{ account: "exp", debit: 2500 }, { account: "cash", credit: 2500 }], "2026-02-10");
    const eOut = postedIn([{ account: "rev", credit: 900 }, { account: "cash", debit: 900 }], "2025-12-20");
    let plan = closingPlan(accP, [e1, e2, eOut], R.start, R.end);
    ok("Closing: entries outside range ignored", plan.entryCount === 2, plan.entryCount + " in range");
    ok("Closing: net income = revenue − expenses", plan.netIncome === 1500, "got " + plan.netIncome);
    const bp = balancePlan(plan, "re");
    ok("Closing: plan balances after retained-earnings carry", bp.balanced);
    ok("Closing: income credited to retained earnings", bp.lines.some(l => l.account === "re" && l.credit === 1500));

    const janClose = postedIn([{ account: "rev", debit: 4000 }, { account: "re", credit: 4000 }], "2026-01-31");
    const e3 = postedIn([{ account: "rev", credit: 1000 }, { account: "cash", debit: 1000 }], "2026-03-05");
    const planQ = closingPlan(accP, [e1, e2, e3, janClose], R.start, R.end);
    ok("Closing: sub-period close offsets (no double count)", planQ.netIncome === -1500, "got " + planQ.netIncome);
    ok("Closing: quarter close balances", balancePlan(planQ, "re").balanced);

    const loss = closingPlan(accP, [e1, postedIn([{ account: "exp", debit: 6000 }, { account: "cash", credit: 6000 }], "2026-02-10")], R.start, R.end);
    ok("Closing: net loss detected", loss.netIncome === -2000, "got " + loss.netIncome);
    ok("Closing: loss debited from retained earnings", balancePlan(loss, "re").lines.some(l => l.account === "re" && l.debit === 2000));

    const cls = [{ id: "c1", start: "2026-01-01", end: "2026-01-31", label: "January 2026" }];
    ok("Closing: date inside closed range flagged", (closedRangeFor(cls, "2026-01-15") || {}).label === "January 2026");
    ok("Closing: open date not flagged", !closedRangeFor(cls, "2026-02-01"));
    ok("Closing: overlapping close detected", !!overlappingClose(cls, "2026-01-20", "2026-02-20"));
    ok("Closing: non-overlapping close allowed", !overlappingClose(cls, "2026-03-01", "2026-03-31"));
    const rFeb = periodRange("month", 2024, 2);
    ok("Closing: month range handles leap February", rFeb.start === "2024-02-01" && rFeb.end === "2024-02-29", rFeb.end);
    ok("Closing: quarter range computed", periodRange("quarter", 2026, 4).end === "2026-12-31");
    ok("Closing: year range computed", periodRange("year", 2026, null).start === "2026-01-01");
    ok("Closing: retained-earnings account located", retainedAccountId(accP) === "re");

    /* ── audit trail (task 5) ── */
    const av = { id: "je1", no: "JE-0001", date: "2026-01-15", status: "draft", lines: [{ account: "cash", debit: 100 }] };
    const av2 = JSON.parse(JSON.stringify(av));
    av2.status = "posted"; av2.postedAt = "2026-01-16T00:00:00.000Z";
    const diffs = diffFields(av, av2);
    ok("Audit: diff isolates changed fields", diffs.some(d => d.field === "status") && diffs.some(d => d.field === "postedAt") && !diffs.some(d => d.field === "id" || d.field === "lines"));
    ok("Audit: before/after values captured", diffs.find(d => d.field === "status").prev === "draft" && diffs.find(d => d.field === "status").next === "posted");
    ok("Audit: create diff = all fields", diffFields(null, av).length === Object.keys(av).length);
    ok("Audit: delete diff = all fields", diffFields(av, null).length === Object.keys(av).length);
    const snap = cloneObj(av);
    ok("Audit: snapshot is a deep copy", snap !== av && snap.lines !== av.lines && snap.lines[0] !== av.lines[0]);

    /* ── trial balance (task 6) ── */
    const entriesTb = [
      { status: "posted", date: "2026-01-15", lines: [{ account: "cash", debit: 4000 }, { account: "rev", credit: 4000 }] },
      { status: "posted", date: "2026-02-10", lines: [{ account: "exp", debit: 2500 }, { account: "cash", credit: 2500 }] },
      { status: "posted", date: "2026-03-01", lines: [{ account: "rev", credit: 500 }, { account: "cash", debit: 500 }] },
      { status: "draft", date: "2026-03-02", lines: [{ account: "exp", debit: 999 }, { account: "cash", credit: 999 }] },
    ];
    const tbAll = trialBalance(accP, entriesTb, "2026-12-31");
    ok("TB: totals balance over full period", tbAll.balanced, tbAll.totals.debit + "/" + tbAll.totals.credit);
    ok("TB: total debits correct", tbAll.totals.debit === 4500);
    const tbJan = trialBalance(accP, entriesTb, "2026-01-31");
    ok("TB: as-of date excludes later entries", tbJan.totals.debit === 4000 && tbJan.postedCount === 1);
    ok("TB: revenue sits in the credit column", tbJan.rows.find(r => r.code === "4000").credit === 4000);
    const tbDraft = trialBalance(accP, entriesTb, "2026-12-31");
    ok("TB: drafts never counted", tbDraft.postedCount === 3);

    return results;
  }

  /* ── public API ───────────────────────────────────────────────────────── */
  window.Ledger = {
    defaultChart, computeBalances, entryTotals, isBalanced, TYPES, typeOf,
    loadAccounts, saveAccounts, loadEntries, saveEntries,
    saveAccount, deleteAccount, setAccountActive, saveEntry, postEntry, deleteEntry,
    getBalance, nextEntryNo, codeExists, isDescendant,
    loadClosings, saveClosings, closePeriod, reopenPeriod, periodRange,
    closingPlan, balancePlan, retainedAccountId, closedRangeFor, overlappingClose,
    loadAudit, auditLog, cloneObj, diffFields, trialBalance,
    render, selfTest,
  };
})();
