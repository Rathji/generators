// ============================================================================
// quote-u — quote builder (roadmap task 15)
// ----------------------------------------------------------------------------
// The internal authoring surface. A rep opens a quote, builds its current draft
// version (a title, one-time and MRR line items, option groups), watches the
// totals recompute live from the shared QU_TOTALS engine, links the quote to a
// PSA opportunity, and previews/prints the client-safe web view produced by
// QU_PORTALVIEW. Every write goes through QU_VERSIONS, so a frozen (sent)
// version is refused here exactly as it is at every other layer.
//
// The DOM renderer (`renderBuilderStation`) is registered as
// `window.QU_RENDERERS.builder`; the pure half (`window.QU_BUILDER`) holds the
// form parsing, selection maths and summarising so it can be unit-tested
// without a DOM.
// ============================================================================
window.QU_BUILDER = (function () {
  "use strict";

  const KINDS = ["one_time", "mrr"];
  const KIND_LABEL = { one_time: "One-time", mrr: "Recurring (MRR)" };

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  // "1,234.5" | "$1234.56" | "5" → integer cents, or null if unparseable.
  function moneyToCents(text) {
    if (typeof text === "number") return Number.isInteger(text) ? text : Math.round(text * 100);
    let s = String(text === undefined || text === null ? "" : text).trim().replace(/\s/g, "");
    if (s.charAt(0) === "$") s = s.slice(1);
    if (!s) return null;
    let neg = false;
    if (s.charAt(0) === "-") { neg = true; s = s.slice(1); }
    else if (s.charAt(0) === "+") { s = s.slice(1); }
    if (!/^\d[\d,]*(\.\d{1,2})?$/.test(s)) return null;
    const dot = s.indexOf(".");
    let intPart = dot === -1 ? s : s.slice(0, dot);
    const fracPart = dot === -1 ? "" : s.slice(dot + 1);
    if (intPart.indexOf(",") !== -1) {
      if (!/^\d{1,3}(,\d{3})+$/.test(intPart)) return null;
      intPart = intPart.replace(/,/g, "");
    }
    const whole = parseInt(intPart, 10);
    const frac = fracPart ? parseInt((fracPart + "00").slice(0, 2), 10) : 0;
    return (neg ? -1 : 1) * (whole * 100 + frac);
  }

  // Integer cents → a plain major-unit string ("1234.56"), never a float.
  function centsToMoney(cents) {
    const n = Math.round(Number(cents) || 0);
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(n);
    return sign + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
  }

  function parseQuantity(text, def) {
    if (text === undefined || text === null || String(text).trim() === "") return def === undefined ? 1 : def;
    const s = String(text).trim();
    if (!/^\d+$/.test(s)) return null;
    return parseInt(s, 10);
  }

  // Parse a line-item form into a validated QU_LINEITEMS input.
  // → { ok, input, violations:[{field,code,detail}] }
  function lineFromForm(form) {
    form = form || {};
    const violations = [];
    const LI = window.QU_LINEITEMS;
    const description = String(form.description === undefined || form.description === null ? "" : form.description).trim();
    if (!description) violations.push({ field: "description", code: "bad_description", detail: "A line item needs a description." });
    const kind = form.kind === "mrr" ? "mrr" : "one_time";
    const quantity = parseQuantity(form.quantity, 1);
    if (quantity === null || quantity < 0) violations.push({ field: "quantity", code: "bad_quantity", detail: "Quantity must be a whole number of zero or more." });
    let unitSell = null;
    if (form.unit_sell_cents !== undefined && form.unit_sell_cents !== null && String(form.unit_sell_cents).trim() !== "") {
      unitSell = moneyToCents(form.unit_sell_cents);
      if (unitSell === null) violations.push({ field: "unit_sell_cents", code: "bad_unit_sell_cents", detail: "Unit price must be a number like 1250.00." });
      else if (unitSell < 0) violations.push({ field: "unit_sell_cents", code: "bad_unit_sell_cents", detail: "Unit price cannot be negative." });
    } else {
      violations.push({ field: "unit_sell_cents", code: "bad_unit_sell_cents", detail: "A line item needs a unit sell price." });
    }
    let unitCost = 0;
    if (form.unit_cost_cents !== undefined && form.unit_cost_cents !== null && String(form.unit_cost_cents).trim() !== "") {
      unitCost = moneyToCents(form.unit_cost_cents);
      if (unitCost === null) violations.push({ field: "unit_cost_cents", code: "bad_unit_cost_cents", detail: "Unit cost must be a number like 400.00." });
      else if (unitCost < 0) violations.push({ field: "unit_cost_cents", code: "bad_unit_cost_cents", detail: "Unit cost cannot be negative." });
    }
    const optional = form.optional === true;
    let optionGroupId = form.option_group_id ? String(form.option_group_id) : null;
    if (!optional && optionGroupId) optionGroupId = null;
    if (optional && !optionGroupId) violations.push({ field: "option_group_id", code: "group_required", detail: "An optional line must belong to an option group." });
    const input = {
      kind,
      description,
      section: form.section ? String(form.section) : "",
      manufacturer_part_number: form.manufacturer_part_number ? String(form.manufacturer_part_number) : "",
      sku: form.sku ? String(form.sku) : "",
      quantity: quantity === null ? 1 : quantity,
      unit_cost_cents: unitCost === null ? 0 : unitCost,
      unit_sell_cents: unitSell === null ? 0 : unitSell,
      optional,
      option_group_id: optionGroupId,
      selected_by_default: optional ? form.selected_by_default === true : false
    };
    if (input.option_group_id && input.selected_by_default === undefined) input.selected_by_default = false;
    if (violations.length) return { ok: false, input, violations };
    if (LI && typeof LI.validate === "function") {
      const v = LI.validate(input);
      if (!v.ok) return { ok: false, input, violations: v.violations };
    }
    return { ok: true, input, violations: [] };
  }

  function groupFromForm(form) {
    form = form || {};
    const violations = [];
    const OG = window.QU_OPTIONGROUPS;
    const name = String(form.name === undefined || form.name === null ? "" : form.name).trim();
    if (!name) violations.push({ field: "name", code: "bad_group_name", detail: "An option group needs a name." });
    const types = (OG && OG.SELECTION_TYPES) || ["single", "bundle", "multi", "optional"];
    const selectionType = form.selection_type === undefined || form.selection_type === null || form.selection_type === "" ? "multi" : String(form.selection_type);
    if (types.indexOf(selectionType) === -1) violations.push({ field: "selection_type", code: "bad_selection_type", detail: "Selection type must be bundle, multi or optional." });
    const input = { name, selection_type: selectionType, description: form.description ? String(form.description) : "" };
    if (violations.length) return { ok: false, input, violations };
    if (OG && typeof OG.validate === "function") {
      const v = OG.validate(input);
      if (!v.ok) return { ok: false, input, violations: v.violations };
    }
    return { ok: true, input, violations: [] };
  }

  function groupMemberIds(lines, groupId) {
    return (lines || []).filter(l => l && l.option_group_id && String(l.option_group_id) === String(groupId)).map(l => String(l.id));
  }

  // `bundle` is the canonical mutually-exclusive group type; `single` is its
  // deprecated alias (QU_MIGRATE rewrites it). Both mean "choose one", so every
  // UI decision keys off this one predicate rather than the raw string.
  function isExclusiveGroup(group) {
    const t = group && group.selection_type;
    return t === "bundle" || t === "single";
  }

  function groupTypeText(type) {
    if (type === undefined || type === null || type === "") return "multi";
    return String(type) === "single" ? "bundle" : String(type);
  }

  // Lines that belong to a group, in display order.
  function linesFor(lines, kind, options) {
    options = options || {};
    let list = (lines || []).filter(l => l && (kind === undefined || kind === null || l.kind === kind));
    if (options.grouped === false) list = list.filter(l => !l.option_group_id);
    if (options.grouped === true) list = list.filter(l => !!l.option_group_id);
    if (options.groupId !== undefined && options.groupId !== null) list = list.filter(l => String(l.option_group_id) === String(options.groupId));
    const LI = window.QU_LINEITEMS;
    if (LI && LI.sortLines) return LI.sortLines(list);
    return list.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  // The client selection implied by the builder: required lines always on,
  // optional lines on when selected by default unless overridden.
  function computeSelection(lines, overrides) {
    const out = {};
    (lines || []).forEach(l => {
      if (!l) return;
      const id = String(l.id);
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, id)) out[id] = overrides[id] === true;
      else out[id] = l.optional ? l.selected_by_default === true : true;
    });
    return out;
  }

  // Flip a line's selection, honouring a single-select group (at most one on).
  function toggleSelected(overrides, line, lines, groups) {
    const next = Object.assign({}, overrides || {});
    const id = String(line.id);
    const on = !(next[id] === undefined ? (line.optional && line.selected_by_default === true) : next[id] === true);
    next[id] = on;
    if (on && line.option_group_id) {
      const group = (groups || []).find(g => String(g.id) === String(line.option_group_id));
      if (group && isExclusiveGroup(group)) {
        (lines || []).forEach(l => {
          if (l && String(l.option_group_id) === String(line.option_group_id) && String(l.id) !== id) next[String(l.id)] = false;
        });
      }
    }
    return next;
  }

  // The whole authoring snapshot for a version: lines, groups, the client
  // selection, the shared totals and the client-safe view.
  function summarize(input) {
    input = input || {};
    const lines = input.lines || [];
    const groups = input.groups || [];
    const overrides = input.overrides || {};
    const selection = computeSelection(lines, overrides);
    const TOT = window.QU_TOTALS;
    if (!TOT) return { ok: false, code: "no_totals", detail: "QU_TOTALS is not loaded." };
    const totals = TOT.computeTotals({ line_items: lines, option_groups: groups, selection, term_months: input.term_months });
    let view = null;
    const PV = window.QU_PORTALVIEW;
    if (PV && typeof PV.serialize === "function") {
      try {
        view = PV.serialize({ quote: input.quote || null, version: input.version || null, line_items: lines, option_groups: groups, selection, term_months: input.term_months });
      } catch (e) {
        view = null;
      }
    }
    return { ok: true, selection, totals, display: TOT.describeTotals(totals), view, lines, groups };
  }

  function canEditVersion(version) {
    const V = window.QU_VERSIONS;
    if (!V) return true;
    return !V.isFrozen(version);
  }

  function freezeNotice(version) {
    if (!version || !version.frozen_at) return null;
    return "Frozen " + String(version.frozen_at).slice(0, 10) + (version.frozen_by ? " by " + version.frozen_by : "") + " — this version can never be changed. Revise it to create a new draft.";
  }

  return {
    KINDS,
    KIND_LABEL,
    moneyToCents,
    centsToMoney,
    parseQuantity,
    lineFromForm,
    groupFromForm,
    groupMemberIds,
    isExclusiveGroup,
    groupTypeText,
    linesFor,
    computeSelection,
    toggleSelected,
    summarize,
    canEditVersion,
    freezeNotice
  };
})();

// ============================================================================
// The station renderer
// ============================================================================

function renderBuilderStation(ctx) {
  const wrap = document.createElement("div");
  wrap.className = "bd-view";

  const B = window.QU_BUILDER;
  const QU = window.QU || {};
  const V = QU.versions;

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(cents, currency) {
    const M = window.QU_MONEY;
    return M ? M.format(cents, { currency: currency || "CAD" }) : String(cents);
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  if (!B || !V || !QU.quotes) {
    const card = el("div", "state state-empty");
    card.innerHTML = '<div class="state-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/></svg></div><p class="state-title">Builder unavailable</p><p class="state-msg">The quote services have not finished loading. This usually resolves after the workspace finishes booting.</p>';
    wrap.appendChild(card);
    return wrap;
  }

  let state = {
    quoteId: (ctx.params && ctx.params[0]) || null,
    showClient: (ctx.params && ctx.params[1]) === "client",
    overrides: {},
    addingKind: null,
    editLineId: null,
    addingGroup: false,
    editGroupId: null,
    catalogOpen: false,
    catalogResults: null,
    catalogQuery: "",
    pricingOpen: false,
    pricingParts: null,
    pricingQuery: "",
    pricingQty: 1,
    pricingKind: null,
    pricingBusy: false,
    busy: false,
    notice: null,
    actor: (function () { try { return localStorage.getItem("qu.builder.actor") || "rep"; } catch (e) { return "rep"; } })()
  };
  if (state.quoteId && ctx.params) state.showClient = ctx.params[1] === "client";

  function toast(msg) { if (QU.toast) QU.toast(msg); }

  async function paint() {
    wrap.innerHTML = "";
    try {
      if (!state.quoteId) await paintStart();
      else await paintBuilder();
    } catch (err) {
      console.error("quote-u builder failed:", err);
      wrap.innerHTML = "";
      const card = el("div", "state state-error");
      card.innerHTML = '<p class="state-kicker">Something went wrong</p><p class="state-title">Couldn\u2019t load the builder</p><p class="state-msg">' + esc((err && err.message) || err) + '</p>';
      const retry = el("button", "btn btn-primary btn-sm", "Try again");
      retry.addEventListener("click", paint);
      const acts = el("div", "state-actions");
      acts.appendChild(retry);
      card.appendChild(acts);
      wrap.appendChild(card);
    }
  }

  // ---------------------------------------------------------------- start screen

  async function paintStart() {
    const loading = el("div", "bd-loading");
    loading.innerHTML = '<span class="spinner"></span><p>Loading quotes\u2026</p>';
    wrap.appendChild(loading);

    const listRes = await QU.quotes.listQuotes();
    const companiesRes = await QU.quotes.listCompanies();

    wrap.innerHTML = "";
    const grid = el("div", "bd-start");
    const left = el("section", "card");
    const right = el("section", "card");
    grid.appendChild(left);
    grid.appendChild(right);

    // Existing quotes
    const quotes = (listRes && listRes.ok && listRes.quotes) || [];
    left.innerHTML = '<div class="card-title-row"><div><h2>Open a quote</h2><p class="hint" style="margin:2px 0 0">Pick an existing quote to build its current version.</p></div><span class="chip">' + quotes.length + '</span></div>';
    if (!quotes.length) {
      left.appendChild(el("p", "rec-none", (listRes && !listRes.ok ? "Quotes could not be read: " + esc(listRes.detail) : "No quotes yet — create the first one on the right.")));
    } else {
      const list = el("div", "bd-quote-list");
      quotes.slice().sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).forEach(q => {
        const row = el("a", "rec-row");
        row.href = "#/builder/" + encodeURIComponent(q.id);
        row.innerHTML = '<span class="rec-av">' + esc((q.company_name || "?").slice(0, 2).toUpperCase()) + '</span>' +
          '<span class="rec-main"><span class="rec-line1"><span class="rec-name">' + esc(q.title || "Untitled quote") + '</span>' +
          (q.quote_number ? '<span class="tag-pill">' + esc(q.quote_number) + '</span>' : "") + '</span>' +
          '<span class="rec-sub">' + esc(q.company_name || "") + (q.contact_name ? " · " + esc(q.contact_name) : "") + '</span></span>' +
          '<span class="rec-side"><span class="chip">' + esc(q.status || "draft") + '</span></span>';
        row.addEventListener("click", ev => { ev.preventDefault(); QU.go("builder", [q.id]); });
        list.appendChild(row);
      });
      left.appendChild(list);
    }

    // New quote
    const companies = (companiesRes && companiesRes.ok && companiesRes.companies) || [];
    right.innerHTML = '<div class="card-title-row"><div><h2>New quote</h2><p class="hint" style="margin:2px 0 0">Choose the account and contact. The quote number is assigned by the numbering scheme.</p></div></div>';
    const form = el("form", "frm");
    form.innerHTML =
      '<div class="fld full"><label for="bdCompany">Company <span class="req">*</span></label><select class="sel" id="bdCompany">' +
      (companies.length ? companies.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join("") : '<option value="">No companies available</option>') +
      '</select></div>' +
      '<div class="fld full"><label for="bdContact">Contact <span class="req">*</span></label><select class="sel" id="bdContact"><option value="">Select a company first</option></select></div>' +
      '<div class="fld full"><label for="bdTitle">Title</label><input class="inp" id="bdTitle" placeholder="e.g. Network refresh"></div>' +
      '<div class="bd-form-err fld-err full" hidden></div>' +
      '<div class="frm-foot full"><button class="btn btn-primary" type="submit">Create quote</button></div>';
    right.appendChild(form);

    const companySel = form.querySelector("#bdCompany");
    const contactSel = form.querySelector("#bdContact");
    const errEl = form.querySelector(".bd-form-err");

    async function loadContacts() {
      contactSel.innerHTML = '<option value="">Loading\u2026</option>';
      const cid = companySel.value;
      if (!cid) { contactSel.innerHTML = '<option value="">Select a company first</option>'; return; }
      const res = await QU.quotes.listContacts(cid);
      const contacts = (res && res.ok && res.contacts) || [];
      contactSel.innerHTML = contacts.length
        ? '<option value="">Select a contact</option>' + contacts.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join("")
        : '<option value="">No contacts on this company</option>';
    }
    companySel.addEventListener("change", loadContacts);
    if (companySel.value) loadContacts();

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      errEl.hidden = true;
      if (!companySel.value) { errEl.textContent = "Choose a company."; errEl.hidden = false; return; }
      if (!contactSel.value) { errEl.textContent = "Choose a contact."; errEl.hidden = false; return; }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Creating\u2026";
      const created = await QU.quotes.createQuote({ company_id: companySel.value, contact_id: contactSel.value, title: form.querySelector("#bdTitle").value });
      if (!created.ok) {
        submit.disabled = false;
        submit.textContent = "Create quote";
        errEl.textContent = created.detail || created.code;
        errEl.hidden = false;
        return;
      }
      const ver = await QU.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title, actor: state.actor });
      if (!ver.ok) {
        submit.disabled = false;
        submit.textContent = "Create quote";
        errEl.textContent = "The quote was created but its first version failed: " + (ver.detail || ver.code) + ". Open it from the list and add a version.";
        errEl.hidden = false;
        return;
      }
      toast("Quote " + (created.quote.quote_number || "") + " created");
      QU.go("builder", [created.quote.id]);
    });

    wrap.appendChild(grid);
  }

  // ---------------------------------------------------------------- builder screen

  async function paintBuilder() {
    const quoteRes = await QU.quotes.getQuote(state.quoteId);
    if (!quoteRes.ok) { wrap.appendChild(errorCard("Couldn\u2019t load the quote", quoteRes.detail || quoteRes.code)); return; }
    const quote = quoteRes.quote;
    if (!quote) { wrap.appendChild(errorCard("Quote not found", "That quote is not available in your scope, or it no longer exists.")); return; }

    const versionsRes = await V.listVersions(state.quoteId);
    if (!versionsRes.ok) { wrap.appendChild(errorCard("Couldn\u2019t load versions", versionsRes.detail || versionsRes.code)); return; }
    const versions = versionsRes.versions || [];
    let version = null;
    if (state.versionId) version = versions.find(v => v.id === state.versionId) || null;
    if (!version) version = versions.length ? versions.slice().sort((a, b) => (b.version_number || 0) - (a.version_number || 0))[0] : null;
    if (version) state.versionId = version.id;

    if (!version) {
      wrap.appendChild(await noVersionCard(quote));
      return;
    }

    const linesRes = await V.listLines(version.id);
    const groupsRes = await V.listGroups(version.id);
    const lines = (linesRes.ok && linesRes.lines) || [];
    const groups = (groupsRes.ok && groupsRes.groups) || [];
    state._lines = lines;
    const frozen = !B.canEditVersion(version);
    const summary = B.summarize({ quote, version, lines, groups, overrides: state.overrides });

    // Task 19: surface stale cost provenance rather than sending it silently.
    state._stale = new Map();
    if (QU.send && typeof QU.send.staleness === "function") {
      const st = await QU.send.staleness(version.id);
      if (st && st.ok) st.stale.forEach(s => state._stale.set(String(s.line_id), s));
    }

    // header
    const sentVersion = quote.status === "sent" && (!quote.sent_version_id || String(quote.sent_version_id) === String(version.id));
    const headActs = [];
    headActs.push('<button class="btn btn-ghost btn-sm" data-act="client">' + (state.showClient ? "Back to builder" : "Client view") + '</button>');
    if (sentVersion) {
      headActs.push('<button class="btn btn-ghost btn-sm" data-act="revise">Revise into a new draft</button>');
      headActs.push('<button class="btn btn-primary btn-sm" data-act="resend">Resend link</button>');
    } else if (frozen) {
      headActs.push('<button class="btn btn-ghost btn-sm" data-act="revise">Revise into a new draft</button>');
      headActs.push('<button class="btn btn-primary btn-sm" data-act="send">Send to client</button>');
    } else {
      headActs.push('<button class="btn btn-ghost btn-sm" data-act="freeze">Freeze &amp; lock version</button>');
      headActs.push('<button class="btn btn-primary btn-sm" data-act="send">Send to client</button>');
    }
    const head = el("div", "bd-head");
    head.innerHTML =
      '<div class="bd-head-main">' +
        '<a class="bd-backlink" href="#/builder">&larr; All quotes</a>' +
        '<h2 class="bd-quote-title">' + esc(quote.title || "Untitled quote") + '</h2>' +
        '<div class="bd-chiprow">' +
          (quote.quote_number ? '<span class="tag-pill">' + esc(quote.quote_number) + '</span>' : "") +
          '<span class="tag-pill">v' + esc(version.version_number) + '</span>' +
          '<span class="chip ' + (frozen ? "chip-danger" : "chip-ok") + '">' + (frozen ? "frozen" : esc(version.state)) + '</span>' +
          (quote.company_name ? '<span class="bd-meta">' + esc(quote.company_name) + (quote.contact_name ? " · " + esc(quote.contact_name) : "") + '</span>' : "") +
        '</div>' +
      '</div>' +
      '<div class="bd-head-acts">' + headActs.join("") + '</div>';
    wrap.appendChild(head);

    // Task 69: publish this record as our collaborative context and render the
    // presence marker for anyone else editing the same quote right now.
    if (QU.hub && typeof QU.hub.setContext === "function") {
      QU.hub.setContext({ page: quote.quote_number || quote.title || "Quote", module: "quotes", recordId: quote.id });
      const marker = typeof QU.hub.renderPresenceMarker === "function" ? QU.hub.renderPresenceMarker("quotes", quote.id) : null;
      if (marker) wrap.appendChild(marker);
    }

    if (frozen) {
      const notice = el("div", "bd-notice");
      notice.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>' + esc(B.freezeNotice(version)) + '</span>';
      wrap.appendChild(notice);
    }
    if (state.notice) {
      const n = el("div", "bd-flash", esc(state.notice));
      wrap.appendChild(n);
      state.notice = null;
    }
    if (state.lastLink) {
      const lc = el("div", "bd-linkcard");
      lc.innerHTML = '<div class="bd-link-main"><span class="bd-link-label">Client link — shown once, then only its hash is stored</span>' +
        '<input class="inp bd-link-input" readonly value="' + esc(state.lastLink) + '"></div>' +
        '<button class="btn btn-sm" data-act="copy-link">Copy link</button>';
      lc.querySelector('[data-act="copy-link"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(state.lastLink); toast("Link copied"); }
        catch (e) { lc.querySelector(".bd-link-input").select(); toast("Press Ctrl/Cmd+C to copy the selected link"); }
      });
      wrap.appendChild(lc);
    }

    if (state.showClient) {
      wrap.appendChild(clientViewCard(summary, quote, version));
      wireHead(head, quote, version, frozen);
      return;
    }

    const grid = el("div", "bd-grid");
    const main = el("div", "bd-main");
    const side = el("div", "bd-side");

    const selectedById = new Map(((summary.totals && summary.totals.lines) || []).map(l => [String(l.id), l.selected]));
    main.appendChild(versionToolbar(quote, versions, version, frozen));
    main.appendChild(lineSection("one_time", "One-time lines", lines, groups, frozen, selectedById));
    main.appendChild(lineSection("mrr", "Recurring (MRR) lines", lines, groups, frozen, selectedById));
    main.appendChild(groupsSection(lines, groups, frozen));
    side.appendChild(totalsCard(summary, lines, groups, version));
    side.appendChild(detailsCard(quote, version, frozen));

    grid.appendChild(main);
    grid.appendChild(side);
    if (state.catalogOpen) wrap.appendChild(catalogPanel());
    if (state.pricingOpen) wrap.appendChild(pricingPanel(version, frozen));
    wrap.appendChild(grid);

    wireHead(head, quote, version, frozen);
    wireToolbar(main, quote, version, frozen);
    wireLineSections(main, version, lines, groups, frozen);
    wireGroups(main, version, groups, frozen);
    wireDetails(side, quote, version, frozen);
  }

  function errorCard(title, msg) {
    const card = el("div", "state state-error");
    card.innerHTML = '<p class="state-kicker">Something went wrong</p><p class="state-title">' + esc(title) + '</p><p class="state-msg">' + esc(msg) + '</p>';
    const acts = el("div", "state-actions");
    const back = el("button", "btn btn-primary btn-sm", "All quotes");
    back.addEventListener("click", () => QU.go("builder"));
    acts.appendChild(back);
    card.appendChild(acts);
    return card;
  }

  async function noVersionCard(quote) {
    const card = el("section", "card bd-noversion");
    card.innerHTML = '<div class="card-title-row"><div><h2>' + esc(quote.title || "Quote") + '</h2><p class="hint" style="margin:2px 0 0">This quote has no version yet. A version holds its lines, option groups and frozen history.</p></div></div>';
    const btn = el("button", "btn btn-primary", "Create the first version");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Creating\u2026";
      const res = await QU.versions.createVersion({ quote_id: quote.id, quote_number: quote.quote_number, title: quote.title, actor: state.actor });
      if (!res.ok) { btn.disabled = false; btn.textContent = "Create the first version"; toast("Could not create version: " + (res.detail || res.code)); return; }
      state.versionId = res.version.id;
      toast("Version 1 created");
      paint();
    });
    card.appendChild(btn);
    return card;
  }

  function wireHead(head, quote, version, frozen) {
    head.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        if (act === "client") { state.showClient = !state.showClient; paint(); return; }
        if (state.busy) return;
        state.busy = true;
        try {
          if (act === "freeze") {
            if (!window.confirm("Freeze version " + version.version_number + "? It becomes immutable — sent versions are never re-priced. To make further changes you revise it into a new version.")) return;
            const res = await V.freeze(version.id, { actor: state.actor });
            if (!res.ok) { toast("Freeze refused: " + (res.detail || res.code)); return; }
            state.notice = "Version " + version.version_number + " frozen and sealed (" + (res.authority === "server" ? "server-verified" : "sealed locally") + ").";
            toast("Version frozen");
            paint();
          } else if (act === "revise") {
            const res = await V.revise(version.id, { actor: state.actor });
            if (!res.ok) { toast("Revise refused: " + (res.detail || res.code)); return; }
            state.versionId = res.version.id;
            state.overrides = {};
            state.notice = quote.status === "sent"
              ? "A new draft version " + res.version.version_number + " was created from version " + version.version_number + ". Edit it, then Send to client — the client link will be re-issued and the previous link revoked. The prior version and its events stay frozen for audit."
              : "A new draft version " + res.version.version_number + " was created from version " + version.version_number + ". The sent version is untouched.";
            toast("Revision created");
            paint();
          } else if (act === "send") {
            if (!QU.send) { toast("The send pipeline is not available."); return; }
            const superseding = quote.status === "sent";
            const pre = await QU.send.preflight(quote.id, version.id, { actor: state.actor, allowSupersede: true });
            if (!pre.ok) { toast("Cannot send: " + (pre.detail || pre.code)); return; }
            let ack = false;
            if (pre.stale && pre.stale.length) {
              ack = window.confirm(pre.stale.length + " cost snapshot(s) behind this version are older than " + pre.stale_cost_days + " days:\n\n" + pre.stale.map(function (s) { return "- " + (s.description || s.line_id) + " (" + s.age_days + " days old)"; }).join("\n") + "\n\nSend anyway with stale pricing?");
              if (!ack) return;
            }
            if (pre.advisories && pre.advisories.length) {
              const advList = pre.advisories.slice(0, 12).map(function (a) { return "- " + (a.description || a.line_id || a.group_name || "quote") + ": " + (a.detail || a.code); }).join("\n");
              const more = pre.advisories.length > 12 ? "\n…and " + (pre.advisories.length - 12) + " more." : "";
              const advMsg = (pre.advisory_counts && QU.advisory && QU.advisory.summarize ? "Advisory completeness checks found: " + QU.advisory.summarize({ advisories: pre.advisories, counts: pre.advisory_counts }) : pre.advisories.length + " advisory item(s).") + "\n\n" + advList + more + "\n\nThese are advisory only. Send anyway?";
              if (!window.confirm(advMsg)) return;
            }
            const confirmMsg = superseding
              ? "Send version " + version.version_number + " to " + (quote.contact_name || "the client") + " <" + (quote.contact_email || "no email") + ">?\n\nThis re-issues the client link and revokes the previous link. The version is frozen (it can never be re-priced); the prior version stays frozen for audit."
              : "Send version " + version.version_number + " to " + (quote.contact_name || "the client") + " <" + (quote.contact_email || "no email") + ">?\n\nThis freezes the version (it can never be re-priced) and emails a secure portal link.";
            if (!window.confirm(confirmMsg)) return;
            const res = await QU.send.send(quote.id, version.id, { actor: state.actor, acknowledgeStale: ack, allowSupersede: true });
            if (!res.ok) { toast("Send failed: " + (res.detail || res.code)); return; }
            state.lastLink = res.link;
            state.notice = superseding
              ? "Sent to " + ((res.quote && res.quote.delivered_to) || quote.contact_email) + ". A fresh client link was issued and the previous link revoked; the prior version stays frozen for audit."
              : "Sent to " + ((res.quote && res.quote.delivered_to) || quote.contact_email) + ". The version is frozen and can no longer be re-priced.";
            toast("Quote sent");
            paint();
          } else if (act === "resend") {
            if (!QU.send) { toast("The send pipeline is not available."); return; }
            if (!window.confirm("Re-issue the client link?\n\nThe previous link is revoked and a fresh link is emailed.")) return;
            let res = await QU.send.resend(quote.id, { actor: state.actor });
            if (!res.ok && res.code === "stale_costs") {
              if (!window.confirm(res.detail + "\n\nResend anyway with stale pricing?")) return;
              res = await QU.send.resend(quote.id, { actor: state.actor, acknowledgeStale: true });
            }
            if (!res.ok) { toast("Resend failed: " + (res.detail || res.code)); return; }
            state.lastLink = res.link;
            state.notice = "A fresh client link was emailed; the previous link is revoked.";
            toast("Link re-issued");
            paint();
          }
        } finally {
          state.busy = false;
        }
      });
    });
  }

  function versionToolbar(quote, versions, version, frozen) {
    const bar = el("div", "bd-toolbar card");
    const opts = versions.slice().sort((a, b) => (b.version_number || 0) - (a.version_number || 0)).map(v =>
      '<option value="' + esc(v.id) + '"' + (v.id === version.id ? " selected" : "") + '>v' + esc(v.version_number) + ' \u00b7 ' + esc(B.canEditVersion(v) ? v.state : "frozen") + '</option>').join("");
    bar.innerHTML =
      '<div class="bd-toolbar-left">' +
        '<label class="bd-field"><span>Version</span><select class="sel" data-versions>' + opts + '</select></label>' +
        '<label class="bd-field"><span>Signed by</span><input class="inp" data-actor value="' + esc(state.actor) + '"></label>' +
      '</div>' +
      '<div class="bd-toolbar-right">' +
        '<button class="btn btn-ghost btn-sm" data-act="catalog"' + (frozen ? " disabled" : "") + '>Add from catalog</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="pricing"' + (frozen ? " disabled" : "") + '>Distributor pricing</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="add-group"' + (frozen ? " disabled" : "") + '>Add option group</button>' +
      '</div>';
    return bar;
  }

  function wireToolbar(main, quote, version, frozen) {
    const bar = main.querySelector(".bd-toolbar");
    const sel = bar.querySelector("[data-versions]");
    sel.addEventListener("change", () => { state.versionId = sel.value; state.editLineId = null; state.addingKind = null; state.overrides = {}; paint(); });
    const actorInput = bar.querySelector("[data-actor]");
    actorInput.addEventListener("change", () => { state.actor = actorInput.value; try { localStorage.setItem("qu.builder.actor", state.actor); } catch (e) {} });
    bar.querySelector('[data-act="catalog"]').addEventListener("click", () => { state.catalogOpen = !state.catalogOpen; state.catalogResults = null; paint(); });
    bar.querySelector('[data-act="pricing"]').addEventListener("click", () => { state.pricingOpen = !state.pricingOpen; state.pricingParts = null; paint(); });
    bar.querySelector('[data-act="add-group"]').addEventListener("click", () => { state.addingGroup = !state.addingGroup; paint(); });
  }

  // ---------------------------------------------------------------- line sections

  function lineSection(kind, title, lines, groups, frozen, selectedById) {
    const section = el("section", "card bd-section");
    const list = B.linesFor(lines, kind);
    selectedById = selectedById || new Map();
    const isSelected = l => selectedById.has(String(l.id)) ? selectedById.get(String(l.id)) === true : true;
    const total = list.reduce((acc, l) => {
      if (!isSelected(l)) return acc;
      return acc + (window.QU_MONEY ? window.QU_MONEY.lineTotal(l.unit_sell_cents, l.quantity) : l.unit_sell_cents * l.quantity);
    }, 0);
    section.innerHTML =
      '<div class="card-title-row">' +
        '<div><h2>' + esc(title) + '</h2><p class="hint" style="margin:2px 0 0">' + (kind === "mrr" ? "Recurring charges shown monthly." : "Single charges, invoiced once.") + '</p></div>' +
        '<div class="bd-sec-right"><span class="bd-sec-total" title="Subtotal of the selected lines">' + esc(money(total)) + '</span>' +
        '<button class="btn btn-ghost btn-sm" data-add="' + kind + '"' + (frozen ? " disabled" : "") + '>+ Add line</button></div>' +
      '</div>';

    if (!list.length) {
      section.appendChild(el("p", "rec-none", "No " + (kind === "mrr" ? "recurring" : "one-time") + " lines yet."));
    } else {
      const tableWrap = el("div", "rep-table-wrap");
      const rows = list.map(l => {
        if (state.editLineId === l.id) return editLineRow(l, groups);
        const LI = window.QU_LINEITEMS;
        const amount = LI ? LI.derive(l).amount_cents : l.unit_sell_cents * l.quantity;
        const group = l.option_group_id ? (groups.find(g => String(g.id) === String(l.option_group_id)) || null) : null;
        const off = !isSelected(l);
        const stale = state._stale && state._stale.get(String(l.id));
        return '<tr' + (off ? ' class="bd-off"' : "") + ' data-line="' + esc(l.id) + '">' +
          '<td class="bd-desc" data-label="Description">' + esc(l.description) +
            (l.manufacturer_part_number ? ' <span class="bd-mpn">' + esc(l.manufacturer_part_number) + '</span>' : "") +
            (l.optional ? ' <span class="tag-pill">optional' + (group ? " · " + esc(group.name) : "") + '</span>' : "") +
            (stale ? ' <span class="tag-pill bd-stale" title="Cost captured ' + esc(stale.captured_at) + '">stale cost · ' + esc(stale.age_days) + 'd</span>' : "") +
          '</td>' +
          '<td class="bd-num" data-label="Qty">' + esc(l.quantity) + '</td>' +
          '<td class="bd-num" data-label="Unit">' + esc(money(l.unit_sell_cents)) + '</td>' +
          '<td class="bd-num bd-amount" data-label="Amount">' + esc(money(amount)) + '</td>' +
          '<td class="bd-acts">' +
            '<button class="btn btn-ghost btn-sm" data-edit="' + esc(l.id) + '"' + (frozen ? " disabled" : "") + '>Edit</button>' +
            '<button class="btn btn-danger btn-sm" data-remove="' + esc(l.id) + '"' + (frozen ? " disabled" : "") + '>Remove</button>' +
          '</td></tr>';
      }).join("");
      tableWrap.innerHTML = '<table class="rep-table bd-table"><thead><tr><th>Description</th><th class="bd-num">Qty</th><th class="bd-num">Unit</th><th class="bd-num">Amount</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      section.appendChild(tableWrap);
    }

    if (state.addingKind === kind && !frozen) {
      const existing = state.editLineId ? list.find(l => l.id === state.editLineId) : null;
      section.appendChild(lineForm(kind, groups, existing));
    }
    return section;
  }

  function editLineRow(line, groups) {
    const LI = window.QU_LINEITEMS;
    const amount = LI ? LI.derive(line).amount_cents : line.unit_sell_cents * line.quantity;
    return '<tr class="bd-editing"><td colspan="5">' +
      '<div class="bd-inline-edit"><span class="bd-editing-label">Editing &ldquo;' + esc(line.description) + '&rdquo;</span>' +
      '<span class="bd-num">' + esc(money(amount)) + '</span></div></td></tr>';
  }

  function lineForm(kind, groups, existing) {
    const editing = !!existing;
    const g = existing || {};
    const form = el("form", "bd-line-form");
    const groupOpts = groups.map(gr => '<option value="' + esc(gr.id) + '"' + (String(g.option_group_id) === String(gr.id) ? " selected" : "") + '>' + esc(gr.name) + '</option>').join("");
    form.innerHTML =
      '<div class="fld full"><label>Description <span class="req">*</span></label><input class="inp" name="description" value="' + esc(g.description || "") + '" placeholder="e.g. Meraki MR46 access point"></div>' +
      '<div class="fld"><label>Quantity</label><input class="inp" name="quantity" value="' + esc(g.quantity === undefined ? 1 : g.quantity) + '"></div>' +
      '<div class="fld"><label>Unit price (' + esc((window.QU_MONEY && window.QU_MONEY.DEFAULT_CURRENCY) || "CAD") + ') <span class="req">*</span></label><input class="inp" name="unit_sell_cents" value="' + esc(g.unit_sell_cents === undefined ? "" : B.centsToMoney(g.unit_sell_cents)) + '" placeholder="0.00"></div>' +
      '<div class="fld"><label>Section</label><input class="inp" name="section" value="' + esc(g.section || "") + '" placeholder="e.g. Hardware"></div>' +
      '<div class="fld"><label>MPN</label><input class="inp" name="manufacturer_part_number" value="' + esc(g.manufacturer_part_number || "") + '"></div>' +
      '<div class="fld full"><label class="check"><input type="checkbox" name="optional"' + (g.optional ? " checked" : "") + '> <span>Optional line the client may toggle</span></label></div>' +
      '<div class="fld full bd-group-pick"><label>Option group</label><select class="sel" name="option_group_id"><option value="">\u2014 none \u2014</option>' + groupOpts + '</select><span class="fld-hint">Optional lines must belong to a group.</span></div>' +
      '<div class="fld-err full" hidden></div>' +
      '<div class="frm-foot full"><button class="btn btn-primary btn-sm" type="submit">' + (editing ? "Save line" : "Add line") + '</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button></div>';
    form.querySelector("[data-cancel]").addEventListener("click", () => { state.addingKind = null; state.editLineId = null; paint(); });
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const errEl = form.querySelector(".fld-err");
      errEl.hidden = true;
      const fd = new FormData(form);
      const parsed = B.lineFromForm({
        kind,
        description: fd.get("description"),
        quantity: fd.get("quantity"),
        unit_sell_cents: fd.get("unit_sell_cents"),
        section: fd.get("section"),
        manufacturer_part_number: fd.get("manufacturer_part_number"),
        optional: form.querySelector('[name="optional"]').checked,
        option_group_id: fd.get("option_group_id")
      });
      if (!parsed.ok) { errEl.textContent = parsed.violations[0].detail; errEl.hidden = false; return; }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const res = editing
        ? await V.updateLine(state.versionId, existing.id, parsed.input)
        : await V.addLine(state.versionId, parsed.input);
      if (!res.ok) { submit.disabled = false; errEl.textContent = res.detail || res.code; errEl.hidden = false; return; }
      state.addingKind = null;
      state.editLineId = null;
      toast(editing ? "Line updated" : "Line added");
      paint();
    });
    return form;
  }

  function wireLineSections(main, version, lines, groups, frozen) {
    main.querySelectorAll("[data-add]").forEach(btn => btn.addEventListener("click", () => {
      const kind = btn.dataset.add;
      state.editLineId = null;
      state.addingKind = state.addingKind === kind ? null : kind;
      paint();
    }));
    main.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => {
      const id = btn.dataset.edit;
      const line = lines.find(l => String(l.id) === String(id));
      state.addingKind = line ? line.kind : "one_time";
      state.editLineId = id;
      paint();
      const form = main.querySelector(".bd-line-form");
      if (form) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }));
    main.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.remove;
      const line = lines.find(l => String(l.id) === String(id));
      if (!window.confirm("Remove \"" + (line ? line.description : "this line") + "\"?")) return;
      const res = await V.removeLine(version.id, id);
      if (!res.ok) { toast("Remove refused: " + (res.detail || res.code)); return; }
      delete state.overrides[id];
      toast("Line removed");
      paint();
    }));
  }

  // ---------------------------------------------------------------- option groups

  function groupsSection(lines, groups, frozen) {
    const section = el("section", "card bd-section");
    section.innerHTML = '<div class="card-title-row"><div><h2>Option groups</h2><p class="hint" style="margin:2px 0 0">Named choices the client selects between. A single-select group allows at most one selected line.</p></div><span class="chip">' + groups.length + '</span></div>';
    if (!groups.length) section.appendChild(el("p", "rec-none", "No option groups yet."));
    groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).forEach(group => {
      const members = B.linesFor(lines, null, { groupId: group.id });
      if (state.editGroupId === group.id) { section.appendChild(groupForm(group)); return; }
      const card = el("div", "bd-group");
      card.innerHTML =
        '<div class="bd-group-head"><div><span class="bd-group-name">' + esc(group.name) + '</span> ' +
        '<span class="chip">' + esc(groupTypeText(group.selection_type)) + '</span></div>' +
        '<div class="bd-acts"><button class="btn btn-ghost btn-sm" data-gedit="' + esc(group.id) + '"' + (frozen ? " disabled" : "") + '>Edit</button>' +
        '<button class="btn btn-danger btn-sm" data-gremove="' + esc(group.id) + '"' + (frozen ? " disabled" : "") + '>Remove</button></div></div>' +
        (group.description ? '<p class="bd-group-desc">' + esc(group.description) + '</p>' : "") +
        '<div class="bd-group-members">' + (members.length
          ? members.map(m => '<span class="bd-member"><label class="check"><input type="checkbox" data-member="' + esc(m.id) + '"' + (selectedFor(m) ? " checked" : "") + (frozen ? " disabled" : "") + '><span>' + esc(m.description) + '</span></label><span class="bd-num">' + esc(money(m.unit_sell_cents)) + '</span></span>').join("")
          : '<span class="muted">No optional lines assigned to this group yet.</span>') + '</div>';
      section.appendChild(card);
    });
    if (state.addingGroup && !frozen) section.appendChild(groupForm(null));
    return section;
  }

  function selectedFor(line) {
    const id = String(line.id);
    if (Object.prototype.hasOwnProperty.call(state.overrides, id)) return state.overrides[id] === true;
    return line.optional ? line.selected_by_default === true : true;
  }

  function groupForm(existing) {
    const editing = !!existing;
    const g = existing || {};
    const form = el("form", "bd-group-form");
    form.innerHTML =
      '<div class="frm">' +
      '<div class="fld full"><label>Group name <span class="req">*</span></label><input class="inp" name="name" value="' + esc(g.name || "") + '" placeholder="e.g. Internet speed"></div>' +
      '<div class="fld"><label>Selection type</label><select class="sel" name="selection_type">' +
        ["bundle", "multi", "optional"].map(t => '<option value="' + t + '"' + (groupTypeText(g.selection_type) === t ? " selected" : "") + '>' + t + '</option>').join("") +
      '</select></div>' +
      '<div class="fld full"><label>Description</label><input class="inp" name="description" value="' + esc(g.description || "") + '" placeholder="Helper text for the client"></div>' +
      '<div class="fld-err full" hidden></div>' +
      '<div class="frm-foot full"><button class="btn btn-primary btn-sm" type="submit">' + (editing ? "Save group" : "Add group") + '</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button></div></div>';
    form.querySelector("[data-cancel]").addEventListener("click", () => { state.addingGroup = false; state.editGroupId = null; paint(); });
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const errEl = form.querySelector(".fld-err");
      errEl.hidden = true;
      const fd = new FormData(form);
      const parsed = B.groupFromForm({ name: fd.get("name"), selection_type: fd.get("selection_type"), description: fd.get("description") });
      if (!parsed.ok) { errEl.textContent = parsed.violations[0].detail; errEl.hidden = false; return; }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const res = editing ? await V.updateGroup(state.versionId, existing.id, parsed.input) : await V.addGroup(state.versionId, parsed.input);
      if (!res.ok) { submit.disabled = false; errEl.textContent = res.detail || res.code; errEl.hidden = false; return; }
      state.addingGroup = false;
      state.editGroupId = null;
      toast(editing ? "Group updated" : "Group added");
      paint();
    });
    return form;
  }

  function wireGroups(main, version, groups, frozen) {
    main.querySelectorAll("[data-gedit]").forEach(btn => btn.addEventListener("click", () => {
      state.editGroupId = btn.dataset.gedit;
      state.addingGroup = false;
      paint();
    }));
    main.querySelectorAll("[data-gremove]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.gremove;
      const group = groups.find(g => String(g.id) === String(id));
      if (!window.confirm("Remove the option group \"" + (group ? group.name : "") + "\"? Its member lines stay but become ungrouped.")) return;
      const res = await V.removeGroup(version.id, id);
      if (!res.ok) { toast("Remove refused: " + (res.detail || res.code)); return; }
      toast("Group removed");
      paint();
    }));
    main.querySelectorAll("[data-member]").forEach(cb => cb.addEventListener("change", () => {
      const id = cb.dataset.member;
      const lines = state._lines || [];
      const line = lines.find(l => String(l.id) === String(id));
      if (!line) return;
      state.overrides = B.toggleSelected(state.overrides, line, lines, groups);
      paint();
    }));
  }

  // ---------------------------------------------------------------- totals

  function totalsCard(summary, lines, groups, version) {
    const t = summary.totals;
    const d = summary.display;
    const card = el("section", "card bd-totals");
    // Indicative tax line (roadmap task 20) — never authoritative.
    let taxHtml = "";
    const TAX = window.QU_TAX;
    if (TAX && typeof TAX.summary === "function") {
      const pol = TAX.defaultPolicy();
      if (pol.show) {
        const tx = TAX.summary(t, pol);
        taxHtml =
          '<div class="bd-total-row bd-sub bd-taxrow"><span>' + esc(tx.line_label) + ' on one-time</span><b>' + esc(money(tx.one_time_cents, t.currency)) + '</b></div>' +
          '<div class="bd-total-row bd-sub bd-taxrow"><span>' + esc(tx.line_label) + ' on 12-month value</span><b>' + esc(money(tx.twelve_month_value_cents, t.currency)) + '</b></div>' +
          '<p class="hint bd-tax-note">' + esc(tx.disclaimer) + '</p>';
      }
    }
    // Internal-only cost & margin roll-up (roadmap task 54). Never shown to the
    // client — the portal view excludes cost/margin by construction (I4).
    let marginHtml = "";
    const BUNDLES = window.QU_BUNDLES;
    const selIds = summary.totals && summary.totals.selection && summary.totals.selection.selected_ids;
    if (BUNDLES && typeof BUNDLES.rollup === "function" && Array.isArray(selIds) && Array.isArray(lines)) {
      try {
        const sel = {};
        const want = new Set(selIds.map(String));
        lines.forEach(l => { if (l && want.has(String(l.id))) sel[String(l.id)] = true; });
        const roll = BUNDLES.rollup(groups || [], lines, sel);
        const o = roll.overall;
        const pct = bp => (bp === null || bp === undefined) ? "\u2014" : (bp / 100).toFixed(1) + "%";
        marginHtml =
          '<div class="bd-total-row bd-sub bd-marginrow"><span>Cost (one-time) <span class="muted">internal</span></span><b>' + esc(money(o.one_time.cost_cents, t.currency)) + '</b></div>' +
          '<div class="bd-total-row bd-sub bd-marginrow"><span>Margin (one-time) <span class="muted">internal</span></span><b>' + esc(money(o.one_time.margin_cents, t.currency)) + ' \u00b7 ' + esc(pct(o.one_time.margin_bp)) + '</b></div>' +
          '<div class="bd-total-row bd-sub bd-marginrow"><span>Cost (12-mo, incl. MRR) <span class="muted">internal</span></span><b>' + esc(money(o.twelve_month.cost_cents, t.currency)) + '</b></div>' +
          '<div class="bd-total-row bd-sub bd-marginrow"><span>Margin (12-mo) <span class="muted">internal</span></span><b>' + esc(money(o.twelve_month.margin_cents, t.currency)) + ' \u00b7 ' + esc(pct(o.twelve_month.margin_bp)) + '</b></div>' +
          (o.missing_cost_count ? '<p class="hint">' + esc(o.missing_cost_count) + ' selected line(s) have no captured cost \u2014 margin is understated.</p>' : "");
      } catch (e) { marginHtml = ""; }
    }
    card.innerHTML =
      '<div class="card-title-row"><h2>Live totals</h2><span class="tag-pill">' + esc(t.currency) + '</span></div>' +
      '<div class="bd-total-row"><span>One-time</span><b>' + esc(d.one_time) + '</b></div>' +
      '<div class="bd-total-row"><span>Monthly (MRR)</span><b>' + esc(d.mrr) + '</b></div>' +
      '<div class="bd-total-row bd-sub"><span>Annual (12 \u00d7 MRR)</span><b>' + esc(d.annual_mrr) + '</b></div>' +
      '<div class="bd-total-row bd-grand"><span>12-month value (pre-tax)</span><b>' + esc(d.twelve_month_value) + '</b></div>' +
      '<div class="bd-total-row bd-sub"><span>Deal value (' + esc(t.term_months) + ' mo)</span><b>' + esc(d.deal_value) + '</b></div>' +
      taxHtml +
      '<p class="hint">Computed by the shared totals engine \u2014 the same one the portal and the approval record use. ' + esc(t.selected_count) + ' of ' + esc(t.line_count) + ' lines selected.</p>';
    if (marginHtml) {
      const hintEl = card.querySelector(".hint");
      if (hintEl) hintEl.insertAdjacentHTML("beforebegin", marginHtml);
      else card.insertAdjacentHTML("beforeend", marginHtml);
    }
    if (t.selection && t.selection.repairs && t.selection.repairs.length) {
      card.appendChild(el("p", "bd-repair", "Selection repaired: " + esc(t.selection.repairs.length) + " invalid single-select choice(s) were corrected."));
    }
    return card;
  }

  // ---------------------------------------------------------------- details (quote meta + external linking)

  function detailsCard(quote, version, frozen) {
    const card = el("section", "card bd-details");
    const opp = quote.opportunity_name || quote.opportunity_id;
    const sent = quote.status === "sent";
    card.innerHTML =
      '<div class="card-title-row"><h2>Quote details</h2></div>' +
      '<div class="sys-row"><span class="sys-k">Company</span><span class="sys-v">' + esc(quote.company_name || "\u2014") + '</span></div>' +
      '<div class="sys-row"><span class="sys-k">Contact</span><span class="sys-v">' + esc(quote.contact_name || "\u2014") + '</span></div>' +
      '<div class="sys-row"><span class="sys-k">Opportunity</span><span class="sys-v">' + (opp ? esc(opp) : '<span class="muted">not linked</span>') + '</span></div>' +
      '<div class="sys-row"><span class="sys-k">Mode</span><span class="sys-v">' + (quote.mode === "prospect" ? 'Prospect <span class="muted">bespoke / template-bound</span>' : 'Quote') + '</span></div>' +
      (quote.contact_email ? '<div class="sys-row"><span class="sys-k">Email</span><span class="sys-v">' + esc(quote.contact_email) + '</span></div>' : "") +
      (sent
        ? '<div class="sys-row"><span class="sys-k">Sent</span><span class="sys-v">' + esc(quote.delivered_to || quote.contact_email || "") + (quote.expires_at ? ' <span class="muted">link expires ' + esc(String(quote.expires_at).slice(0, 10)) + '</span>' : "") + '</span></div>'
        : '<div class="sys-row"><span class="sys-k">Portal link</span><span class="sys-v"><span class="muted">not sent yet</span></span></div>') +
      '<div class="bd-details-acts">' +
        (quote.opportunity_id ? "" : '<button class="btn btn-ghost btn-sm" data-act="opp">Create PSA opportunity</button>') +
        (quote.mode === "prospect"
          ? '<button class="btn btn-ghost btn-sm" data-act="promote">Promote to quote</button>'
          : '<button class="btn btn-ghost btn-sm" data-act="prospect">Mark as prospect</button>') +
        (sent ? '<button class="btn btn-danger btn-sm" data-act="revoke">Revoke client link</button>' : "") +
      '</div>';
    return card;
  }

  function wireDetails(side, quote, version, frozen) {
    const btn = side.querySelector('[data-act="opp"]');
    if (btn) btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Creating\u2026";
      const res = await QU.quotes.createOpportunity(quote.id, { name: quote.title });
      if (!res.ok) { btn.disabled = false; btn.textContent = "Create PSA opportunity"; toast("Could not create opportunity: " + (res.detail || res.code)); return; }
      state.notice = "Linked to PSA opportunity \u201c" + (res.opportunity.name || res.opportunity.id) + "\u201d.";
      toast("Opportunity created");
      paint();
    });
    const revokeBtn = side.querySelector('[data-act="revoke"]');
    if (revokeBtn) revokeBtn.addEventListener("click", async () => {
      if (!QU.send) { toast("The send pipeline is not available."); return; }
      if (!window.confirm("Revoke the client link? The client can no longer open this quote; the frozen version is untouched.")) return;
      revokeBtn.disabled = true;
      const res = await QU.send.revokeLinks(quote.id, { actor: state.actor, reason: "revoked_by_rep" });
      if (!res.ok) { revokeBtn.disabled = false; toast("Revoke failed: " + (res.detail || res.code)); return; }
      toast(res.count ? "Client link revoked" : "No active link to revoke");
      paint();
    });
    const prospectBtn = side.querySelector('[data-act="prospect"]');
    if (prospectBtn) prospectBtn.addEventListener("click", async () => {
      if (!QU.quotes || typeof QU.quotes.setMode !== "function") { toast("Quote modes are not available."); return; }
      prospectBtn.disabled = true;
      const res = await QU.quotes.setMode(quote.id, "prospect", { actor: state.actor });
      if (!res.ok) { prospectBtn.disabled = false; toast("Could not switch to prospect mode: " + (res.detail || res.code)); return; }
      state.notice = "Marked as a prospect. Author bespoke lines or bind an accepted artifact as a template, then promote it to a normal quote.";
      toast("Prospect mode");
      paint();
    });
    const promoteBtn = side.querySelector('[data-act="promote"]');
    if (promoteBtn) promoteBtn.addEventListener("click", async () => {
      if (!QU.prospect || typeof QU.prospect.promote !== "function") { toast("Prospect mode is not available."); return; }
      if (!window.confirm("Promote this prospect to a normal quote? Its lines and frozen history are unchanged; only the mode flag flips.")) return;
      promoteBtn.disabled = true;
      const res = await QU.prospect.promote(quote.id, { actor: state.actor });
      if (!res.ok) { promoteBtn.disabled = false; toast("Could not promote: " + (res.detail || res.code)); return; }
      state.notice = "Promoted to a normal quote.";
      toast("Promoted to quote");
      paint();
    });
  }

  // ---------------------------------------------------------------- client view

  function clientViewCard(summary, quote, version) {
    const card = el("section", "card bd-client");
    const view = summary.view;
    if (!view) {
      card.innerHTML = '<p class="rec-none">The client view could not be built.</p>';
      return card;
    }
    const PV = window.QU_PORTALVIEW;
    const html = PV && PV.renderHtml ? PV.renderHtml(view) : "<pre>" + esc(PV && PV.toText ? PV.toText(view) : "") + "</pre>";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Client web / print view</h2><p class="hint" style="margin:2px 0 0">Exactly what the client sees \u2014 every cost, margin and snapshot field is excluded by QU_PORTALVIEW.</p></div>' +
      '<div class="bd-sec-right"><button class="btn btn-ghost btn-sm" data-act="print">Print / save as PDF</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="copy">Copy as text</button></div></div>' +
      '<div class="bd-client-sheet">' + html + '</div>';
    card.querySelector('[data-act="print"]').addEventListener("click", () => printView(view, quote));
    card.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      const text = PV && PV.toText ? PV.toText(view) : "";
      try { await navigator.clipboard.writeText(text); toast("Client view copied"); }
      catch (e) { toast("Copy failed \u2014 select the text instead"); }
    });
    return card;
  }

  function printView(view, quote) {
    let host = document.querySelector(".print-host");
    if (!host) { host = document.createElement("div"); host.className = "print-host"; document.body.appendChild(host); }
    const PV = window.QU_PORTALVIEW;
    const html = PV && PV.renderHtml ? PV.renderHtml(view, { note: "Indicative pricing. Taxes shown separately where applicable." }) : "";
    host.innerHTML = html;
    document.body.classList.add("printing");
    const cleanup = () => { document.body.classList.remove("printing"); host.innerHTML = ""; };
    window.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(() => { window.print(); }, 40);
    setTimeout(cleanup, 60000);
  }

  // ---------------------------------------------------------------- catalog picker

  function catalogPanel() {
    const card = el("section", "card bd-catalog");
    card.innerHTML =
      '<div class="card-title-row"><h2>Add from catalog</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>' +
      '<form class="bd-catalog-search"><input class="inp" name="q" placeholder="Search SKU, MPN or description\u2026" value="' + esc(state.catalogQuery || "") + '"><button class="btn btn-primary btn-sm" type="submit">Search</button></form>' +
      '<div class="bd-catalog-results"><p class="hint">Search the catalog and add a product or service as a line.</p></div>';
    card.querySelector("[data-close]").addEventListener("click", () => { state.catalogOpen = false; paint(); });
    const form = card.querySelector("form");
    const results = card.querySelector(".bd-catalog-results");
    async function run(query) {
      state.catalogQuery = query;
      results.innerHTML = '<p class="hint">Searching\u2026</p>';
      const res = await QU.catalog.search(query || "");
      const items = (res && res.ok && res.items) || [];
      if (!items.length) { results.innerHTML = '<p class="rec-none">No matching catalog items.</p>'; return; }
      results.innerHTML = "";
      items.slice(0, 30).forEach(item => {
        const row = el("div", "bd-catalog-row");
        row.innerHTML = '<span class="bd-catalog-main"><span class="rec-name">' + esc(item.description || item.sku) + '</span><span class="rec-sub">' + esc(item.sku || "") + (item.manufacturer_part_number ? " · " + esc(item.manufacturer_part_number) : "") + '</span></span>' +
          '<span class="bd-catalog-price">' + esc(money(window.QU_CATALOG ? window.QU_CATALOG.sellPriceCents(item) : item.unit_sell_cents || 0, item.currency)) + '</span>' +
          '<button class="btn btn-ghost btn-sm" data-pick="' + esc(item.id) + '">Add</button>';
        row.querySelector("[data-pick]").addEventListener("click", async () => {
          const built = window.QU_CATALOG.toLineItemInput(item, { kind: item.default_kind });
          const res2 = await V.addLine(state.versionId, built);
          if (!res2.ok) { toast("Add refused: " + (res2.detail || res2.code)); return; }
          toast("Added " + (item.description || item.sku));
          state.catalogOpen = false;
          paint();
        });
        results.appendChild(row);
      });
    }
    form.addEventListener("submit", ev => { ev.preventDefault(); run(new FormData(form).get("q")); });
    run(state.catalogQuery || "");
    return card;
  }

  // ------------------------------------------------------------- pricing panel
  // Task 42–44: search every distributor at once, show each part's offers side by
  // side (unit cost, list, quantity, warehouse, age), and add a chosen offer to
  // the quote as a snapshot-priced line in one action. Never displays a live cost
  // as the line's price — the price is captured and sealed first.

  function pricingPanel(version, frozen) {
    const card = el("section", "card bd-pricing");
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Distributor pricing</h2><p class="hint" style="margin:2px 0 0">Search every source, compare price and availability side by side, and add a part as a snapshot-priced line.</p></div><button class="btn btn-ghost btn-sm" data-close>Close</button></div>' +
      '<form class="bd-pricing-search"><input class="inp" name="q" placeholder="Search MPN, SKU, UPC or description\u2026" value="' + esc(state.pricingQuery || "") + '"><button class="btn btn-primary btn-sm" type="submit">Search</button></form>' +
      '<div class="bd-pricing-results"><p class="hint">Search the distributor catalogs.</p></div>';
    card.querySelector("[data-close]").addEventListener("click", () => { state.pricingOpen = false; paint(); });
    const form = card.querySelector("form");
    const results = card.querySelector(".bd-pricing-results");

    const policy = (QU.pricing && QU.pricing.policy) ? QU.pricing.policy() : { default_markup_bp: 2400, default_kind: "one_time", stale_cost_days: 7 };

    function sellFor(cost) {
      const M = window.QU_MONEY;
      if (!M || typeof cost !== "number") return null;
      return M.add(cost, M.applyBp(cost, policy.default_markup_bp));
    }

    function ageText(offer) {
      const P = window.QU_PRICING;
      const st = P ? P.staleness(offer, { policy: policy }) : null;
      if (!st || !st.ok) return { text: "", stale: false };
      const days = Math.round(st.age_days);
      return { text: "captured " + days + "d ago", stale: st.stale };
    }

    function offerRow(offer) {
      const row = el("div", "bd-price-offer" + (offer.cheapest ? " is-cheapest" : ""));
      const priced = typeof offer.unit_cost_cents === "number";
      const age = ageText(offer);
      const sell = priced ? sellFor(offer.unit_cost_cents) : null;
      row.innerHTML =
        '<span class="bd-price-source">' + esc(offer.source) + (offer.cheapest ? '<span class="bd-best-chip">cheapest</span>' : "") + '</span>' +
        '<span class="bd-price-cost">' + (priced ? esc(money(offer.unit_cost_cents, offer.currency)) : '<span class="hint">no price</span>') + '</span>' +
        '<span class="bd-price-list">' + (sell === null ? "" : 'sell ' + esc(money(sell, offer.currency))) + '</span>' +
        '<span class="bd-price-stock' + (offer.in_stock ? "" : " is-out") + '">' + (offer.quantity_available > 0 ? offer.quantity_available + " in stock" : "out of stock") + (offer.warehouse ? " \u00b7 " + esc(offer.warehouse) : "") + '</span>' +
        '<span class="bd-price-age' + (age.stale ? " is-stale" : "") + '">' + (age.text ? (age.stale ? "\u26a0 " + age.text + " \u2014 stale" : age.text) : "") + '</span>' +
        '<span class="bd-price-add"><input class="inp inp-qty" type="number" min="1" step="1" value="' + esc(state.pricingQty) + '" data-qty aria-label="Quantity"><button class="btn btn-primary btn-sm" data-add' + (priced ? "" : " disabled") + '>Add to quote</button></span>';
      const qtyInput = row.querySelector("[data-qty]");
      qtyInput.addEventListener("change", () => { state.pricingQty = parseQuantity(qtyInput.value, 1) || 1; });
      row.querySelector("[data-add]").addEventListener("click", async () => {
        if (state.pricingBusy || frozen) return;
        state.pricingBusy = true;
        const btn = row.querySelector("[data-add]");
        btn.disabled = true;
        btn.textContent = "Adding\u2026";
        const qty = parseQuantity(qtyInput.value, 1) || 1;
        const res = await QU.pricing.addToQuote(state.versionId, offer, { quantity: qty, kind: state.pricingKind || undefined });
        state.pricingBusy = false;
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = "Add to quote";
          toast("Add refused: " + (res.detail || res.code));
          return;
        }
        toast("Added " + (res.line && res.line.description ? res.line.description : offer.source) + (res.deduped ? " (reusing the sealed price)" : ""));
        state.pricingOpen = false;
        paint();
      });
      return row;
    }

    function partCard(part) {
      const box = el("div", "bd-price-part");
      const meta = [part.manufacturer_part_number, part.upc, part.category].filter(Boolean).map(esc).join(" \u00b7 ");
      const head = el("div", "bd-price-head");
      head.innerHTML = '<span class="bd-price-name">' + esc(part.description || part.manufacturer_part_number || part.key) + '</span>' +
        (meta ? '<span class="bd-price-meta">' + meta + '</span>' : "") +
        '<span class="tag-pill">' + part.offers.length + ' source' + (part.offers.length === 1 ? "" : "s") + '</span>';
      box.appendChild(head);
      const table = el("div", "bd-price-offers");
      part.offers.forEach(offer => table.appendChild(offerRow(offer)));
      box.appendChild(table);
      return box;
    }

    async function run(query) {
      state.pricingQuery = query;
      if (!QU.distributors || typeof QU.distributors.searchParts !== "function") {
        results.innerHTML = '<p class="rec-none">The distributor service is not available.</p>';
        return;
      }
      results.innerHTML = '<p class="hint"><span class="spinner"></span> Searching every source\u2026</p>';
      const res = await QU.distributors.searchParts(query || "");
      const parts = (res && res.parts) || [];
      if (!parts.length) {
        results.innerHTML = '<p class="rec-none">No matching parts.</p>';
        return;
      }
      results.innerHTML = "";
      parts.slice(0, 20).forEach(part => results.appendChild(partCard(part)));
      if (res.errors && res.errors.length) {
        const note = el("p", "hint");
        note.textContent = "Unavailable sources: " + res.errors.map(e => e.source).join(", ");
        results.appendChild(note);
      }
    }

    form.addEventListener("submit", ev => { ev.preventDefault(); run(new FormData(form).get("q")); });
    run(state.pricingQuery || "");
    return card;
  }

  // Task 69: when the live hub reports a change to a quote document, refresh the
  // builder so a collaborator's edit appears within seconds. Degrades silently
  // when the hub is off (no listener is even attached).
  if (QU.hub && typeof QU.hub.on === "function") {
    const RELEVANT = ["quotes", "quote_versions", "line_items", "option_groups", "price_snapshots", "approvals", "invoice_intents"];
    QU.hub.on("change", ev => {
      if (!ev || RELEVANT.indexOf(ev.module) === -1) return;
      toast(ev.actorName ? ev.actorName + " updated this quote — reloading" : "This quote was updated elsewhere — reloading");
      paint();
    });
  }

  paint();
  return wrap;
}

window.QU_RENDERERS = window.QU_RENDERERS || {};
window.QU_RENDERERS.builder = renderBuilderStation;
