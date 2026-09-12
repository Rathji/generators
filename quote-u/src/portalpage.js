// ============================================================================
// quote-u — client-facing portal page (roadmap task 25)
// ----------------------------------------------------------------------------
// The page a client sees at #/q/<secret>. It is the ONLY client surface that
// can act, and every action it takes goes back through the portal API
// (window.QU.portal.handle) so the server-side validation and rate limiting in
// src/portal.js / src/portalactions.js is always exercised — the page is a
// client of the API, exactly as a real browser would be.
//
// What it does:
//   • reads the frozen, client-safe view (QU_PORTALREAD) — description,
//     quantity, unit sell, totals, option groups; never cost or margin;
//   • renders option groups as radio (single) / checkbox (multi, optional)
//     controls, letting the client choose only within valid group rules;
//   • asks the API to recompute the DISPLAY-ONLY totals on every change
//     (POST /select), so the numbers the client sees are produced by the same
//     rules the approval will use;
//   • approves (typed name) or declines, both through the API and both
//     server-validated;
//   • renders a clear terminal state once the quote has been decided, and a
//     friendly "this link is no longer available" state for 404/410/429.
// ============================================================================
window.QU_PORTALPAGE = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const KIND_LABEL = { one_time: "One-time", mrr: "Monthly" };

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function money(cents, currency) {
    const M = window.QU_MONEY;
    if (M && typeof M.format === "function") return M.format(cents, { currency });
    return "$" + (Number(cents || 0) / 100).toFixed(2);
  }

  // The ids currently "on" in a client view.
  function selectedIdsFromView(view) {
    const out = [];
    ((view && view.lines) || []).forEach(l => { if (l.selected === true) out.push(String(l.id)); });
    return out;
  }

  function optionalLines(view) {
    return ((view && view.lines) || []).filter(l => l.optional === true);
  }

  // [{ group, lines }] for every option group, in view order.
  function groupsWithMembers(view) {
    const lines = (view && view.lines) || [];
    return ((view && view.option_groups) || []).map(g => ({
      group: g,
      lines: lines.filter(l => l.option_group_id !== null && l.option_group_id !== undefined && String(l.option_group_id) === String(g.id))
    }));
  }

  // Optional lines that belong to no group render as their own checkbox group.
  function ungroupedOptional(view) {
    return optionalLines(view).filter(l => l.option_group_id === null || l.option_group_id === undefined);
  }

  // `bundle` is the canonical mutually-exclusive type; `single` is its
  // deprecated alias. Both render as a "choose one" radio set (with a trailing
  // "None of these" so the client can decline the whole group).
  function controlFor(group) {
    const t = group && group.selection_type;
    return (t === "bundle" || t === "single") ? "radio" : "checkbox";
  }

  function groupTypeLabel(group) {
    if (!group) return "";
    const t = group.selection_type;
    if (t === "bundle" || t === "single") return "Choose one";
    if (t === "multi") return "Choose any";
    return "Optional";
  }

  function terminalStatus(view) {
    const q = (view && view.quote) || {};
    const s = q.status;
    return s === "approved" || s === "declined" || s === "expired" ? s : null;
  }

  function stateCard(kind, title, message, opts) {
    opts = opts || {};
    const el = document.createElement("div");
    el.className = "portal-state portal-state-" + kind;
    el.innerHTML =
      '<div class="portal-state-card">' +
      '<div class="portal-state-icon">' + (kind === "ok" ? "&#10003;" : "&#9888;") + "</div>" +
      '<h1 class="portal-state-title">' + esc(title) + "</h1>" +
      '<p class="portal-state-msg">' + esc(message) + "</p>" +
      (opts.hint ? '<p class="portal-state-hint">' + esc(opts.hint) + "</p>" : "") +
      "</div>";
    return el;
  }

  function isPast(iso, now) {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (isNaN(t)) return false;
    return now > t;
  }

  function canExpire(view, now) {
    return isPast(view && view.version && view.version.expires_at, now);
  }

  async function render(opts) {
    opts = opts || {};
    const secret = opts.secret === undefined || opts.secret === null ? "" : String(opts.secret);
    const api = opts.api || (window.QU && window.QU.portal) || null;
    const meta = opts.meta || {
      headers: {},
      ip: "unknown",
      user_agent: (typeof navigator !== "undefined" && navigator.userAgent) || null
    };

    const root = document.createElement("div");
    root.className = "portal-wrap";

    if (!api || typeof api.handle !== "function") {
      root.appendChild(stateCard("warn", "Portal unavailable", "This portal could not connect to its API."));
      return root;
    }

    root.appendChild(loadingCard());

    async function call(method, path, body) {
      return api.handle({ method, path, secret, body: body || {}, meta, at: new Date().toISOString() });
    }

    function loadingCard() {
      const el = document.createElement("div");
      el.className = "portal-state portal-state-loading";
      el.innerHTML = '<div class="portal-state-card"><div class="spinner"></div><p class="portal-state-msg">Opening your quote&hellip;</p></div>';
      return el;
    }

    function replace(node) {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(node);
    }

    // ---- initial read ----------------------------------------------------
    let res;
    try { res = await call("GET", "/view"); }
    catch (e) { res = { status: 500, body: { detail: (e && e.message) || "Network error." } }; }

    if (!res || res.status !== 200) {
      replace(deadState(res));
      return root;
    }

    paintReady(res.body);
    return root;

    // ---- the ready page --------------------------------------------------

    function paintReady(body) {
      let view = body.view;
      let selection = new Set(selectedIdsFromView(view));
      const token = body.token || {};
      const version = body.version || {};
      // The "valid until" date lives on the portal token (send mints it from
      // the expiry policy); fall back to a version-level expiry if present.
      const expiryAt = version.expires_at || token.expires_at || null;
      let terminal = terminalStatus(view);

      const page = document.createElement("div");
      page.className = "portal-page";

      // header
      const head = document.createElement("header");
      head.className = "portal-head";
      const q = view.quote || {};
      head.innerHTML =
        '<div class="portal-brand">' + esc(q.company_name || q.title || "Your quote") + "</div>" +
        '<h1 class="portal-title">' + esc(q.title || "Quote") + "</h1>" +
        '<p class="portal-sub">' + (q.quote_number ? "Quote " + esc(q.quote_number) + " · " : "") + "Version " + esc(version.version_number) + "</p>" +
        (expiryAt ? '<p class="portal-expiry">' + (isPast(expiryAt, Date.now()) ? "Expired " : "Valid until ") + esc(String(expiryAt).slice(0, 10)) + "</p>" : "");
      page.appendChild(head);

      // lines (read-only, reflecting the current selection)
      const linesSec = document.createElement("section");
      linesSec.className = "portal-card";
      page.appendChild(linesSec);

      // options
      const groupsSec = document.createElement("section");
      groupsSec.className = "portal-card portal-options";
      page.appendChild(groupsSec);

      // totals
      const totalsSec = document.createElement("section");
      totalsSec.className = "portal-card portal-totals-card";
      page.appendChild(totalsSec);

      // decision
      const decisionSec = document.createElement("section");
      decisionSec.className = "portal-card portal-decision-card";
      page.appendChild(decisionSec);

      const note = document.createElement("p");
      note.className = "portal-note";
      note.hidden = true;
      page.appendChild(note);

      const foot = document.createElement("footer");
      foot.className = "portal-foot";
      foot.textContent = "Powered by quote-u";
      page.appendChild(foot);

      function showNote(msg, kind) {
        note.textContent = msg || "";
        note.hidden = !msg;
        note.className = "portal-note" + (kind ? " " + kind : "");
      }

      // A decision is terminal — flip the local view and repaint the whole page
      // (the client-safe DTO has no status field, so it is stamped here). The
      // selected-on-screen view is written back to `body.view` first, because a
      // prior POST /select may have replaced `view` with a fresh object.
      function markTerminal(status) {
        view = Object.assign({}, view, { quote: Object.assign({}, view.quote, { status }) });
        body.view = view;
        terminal = status;
        paintReady(body);
      }

      function refreshControls() {
        groupsSec.querySelectorAll("input[data-line-id]").forEach(inp => {
          const id = inp.getAttribute("data-line-id");
          if (id === "") {
            const members = groupMemberIds(inp.getAttribute("data-group"));
            inp.checked = members.every(m => !selection.has(m));
          } else {
            inp.checked = selection.has(id);
          }
          const label = inp.closest ? inp.closest(".portal-opt") : null;
          if (label) label.classList.toggle("on", inp.checked);
        });
      }

      function groupMemberIds(groupId) {
        return Array.from(groupsSec.querySelectorAll('input[data-group="' + cssEscape(groupId) + '"]')).map(i => i.getAttribute("data-line-id"));
      }

      function renderLines() {
        const lineById = new Map((view.lines || []).map(l => [String(l.id), l]));
        const html = [];
        html.push('<h2 class="portal-sec-title">Your quote</h2>');
        for (const section of view.sections || []) {
          html.push('<div class="portal-section">');
          html.push('<h3 class="portal-sect-label">' + esc(section.label) + "</h3>");
          html.push('<table class="pqv-table"><thead><tr><th>Description</th><th>Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>');
          for (const id of section.lines) {
            const line = lineById.get(String(id));
            if (!line) continue;
            const on = selection.has(String(line.id));
            html.push("<tr" + (on ? "" : ' class="pqv-off"') + ">");
            html.push("<td>" + esc(line.description) + (line.sku ? ' <span class="pqv-sku">' + esc(line.sku) + "</span>" : "") + "</td>");
            html.push("<td>" + esc(line.quantity) + "</td>");
            html.push('<td class="num">' + esc(money(line.unit_sell_cents, view.currency)) + "</td>");
            html.push('<td class="num">' + esc(money(line.amount_cents, view.currency)) + "</td>");
            html.push("</tr>");
          }
          html.push("</tbody></table></div>");
        }
        linesSec.innerHTML = html.join("");
      }

      function optionControl(group, line, type, name) {
        const on = selection.has(String(line.id));
        const input = document.createElement("input");
        input.type = type;
        if (type === "radio") input.name = name;
        input.setAttribute("data-line-id", String(line.id));
        input.setAttribute("data-group", group ? String(group.id) : "");
        input.checked = on;
        input.addEventListener("change", () => onToggle(group, line, type, input.checked));

        const label = document.createElement("label");
        label.className = "portal-opt" + (on ? " on" : "");
        label.appendChild(input);
        const body = document.createElement("span");
        body.className = "portal-opt-body";
        body.innerHTML = "<span class=\"portal-opt-desc\">" + esc(line.description) +
          (line.sku ? ' <span class="pqv-sku">' + esc(line.sku) + "</span>" : "") + "</span>" +
          '<span class="portal-opt-price">' + esc(money(line.unit_sell_cents, view.currency)) + (line.quantity !== 1 ? " × " + esc(line.quantity) : "") + "</span>";
        label.appendChild(body);
        return label;
      }

      function renderGroups() {
        groupsSec.innerHTML = "";
        const title = document.createElement("h2");
        title.className = "portal-sec-title";
        title.textContent = "Your options";
        groupsSec.appendChild(title);

        const groups = groupsWithMembers(view);
        const extra = ungroupedOptional(view);
        if (!groups.length && !extra.length) {
          groupsSec.hidden = true;
          return;
        }

        groups.forEach(entry => {
          if (!entry.lines.length) return;
          const type = controlFor(entry.group);
          const wrap = document.createElement("div");
          wrap.className = "portal-group";
          const h = document.createElement("div");
          h.className = "portal-group-head";
          h.innerHTML = '<h3 class="portal-group-name">' + esc(entry.group.name) + "</h3>" +
            '<span class="portal-group-type">' + esc(groupTypeLabel(entry.group)) + "</span>";
          wrap.appendChild(h);
          entry.lines.forEach(line => wrap.appendChild(optionControl(entry.group, line, type, "grp-" + entry.group.id)));
          if (type === "radio") {
            const none = document.createElement("label");
            none.className = "portal-opt portal-opt-none";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "grp-" + entry.group.id;
            input.setAttribute("data-line-id", "");
            input.setAttribute("data-group", String(entry.group.id));
            input.checked = entry.lines.every(l => !selection.has(String(l.id)));
            input.addEventListener("change", () => {
              entry.lines.forEach(l => selection.delete(String(l.id)));
              refreshControls();
              renderLines();
              refreshTotals();
            });
            none.appendChild(input);
            const s = document.createElement("span");
            s.className = "portal-opt-body";
            s.innerHTML = '<span class="portal-opt-desc">None of these</span>';
            none.appendChild(s);
            wrap.appendChild(none);
          }
          groupsSec.appendChild(wrap);
        });

        if (extra.length) {
          const wrap = document.createElement("div");
          wrap.className = "portal-group";
          const h = document.createElement("div");
          h.className = "portal-group-head";
          h.innerHTML = '<h3 class="portal-group-name">Additional options</h3><span class="portal-group-type">Optional</span>';
          wrap.appendChild(h);
          extra.forEach(line => wrap.appendChild(optionControl(null, line, "checkbox", null)));
          groupsSec.appendChild(wrap);
        }
      }

      function renderTotals() {
        const t = view.totals || {};
        const cur = view.currency;
        const rows = [];
        rows.push('<div class="pqv-total-row"><span>One-time</span><b>' + esc(money(t.one_time_cents, cur)) + "</b></div>");
        rows.push('<div class="pqv-total-row"><span>Monthly (MRR)</span><b>' + esc(money(t.mrr_cents, cur)) + "</b></div>");
        rows.push('<div class="pqv-total-row"><span>Annual (12 × MRR)</span><b>' + esc(money(t.annual_mrr_cents, cur)) + "</b></div>");
        rows.push('<div class="pqv-total-row pqv-grand"><span>12-month value (pre-tax)</span><b>' + esc(money(t.twelve_month_value_cents, cur)) + "</b></div>");
        if (view.tax) {
          rows.push('<div class="pqv-total-row pqv-taxrow"><span>' + esc(view.tax.line_label) + ' on one-time</span><b>' + esc(money(view.tax.one_time_cents, cur)) + "</b></div>");
          rows.push('<div class="pqv-total-row pqv-taxrow"><span>' + esc(view.tax.line_label) + ' on 12-month value</span><b>' + esc(money(view.tax.twelve_month_value_cents, cur)) + "</b></div>");
          rows.push('<p class="pqv-tax-note">' + esc(view.tax.disclaimer) + "</p>");
        }
        totalsSec.innerHTML = '<h2 class="portal-sec-title">Totals</h2><div class="pqv-totals">' + rows.join("") + "</div>";
      }

      function renderDecision() {
        if (terminal) {
          const label = terminal === "approved" ? "Approved" : terminal === "declined" ? "Declined" : "Expired";
          decisionSec.innerHTML = '<div class="portal-decision-banner ' + terminal + '">' +
            '<h2>' + esc(label) + "</h2>" +
            "<p>" + (terminal === "approved" ? "Thank you — your acceptance has been recorded." : terminal === "declined" ? "This quote was declined." : "This quote has expired.") + "</p>" +
            "</div>";
          return;
        }
        decisionSec.innerHTML =
          '<h2 class="portal-sec-title">Ready to proceed?</h2>' +
          '<div class="portal-field"><label for="portalNameInp">Type your full name to accept</label>' +
          '<input id="portalNameInp" class="inp portal-name-inp" autocomplete="name" placeholder="Your full name"></div>' +
          '<div class="portal-decision-acts">' +
          '<button type="button" class="btn btn-primary portal-approve">Approve this quote</button>' +
          '<button type="button" class="btn btn-ghost portal-decline">Decline</button>' +
          "</div>" +
          '<div class="portal-field portal-field-reason" hidden><label for="portalReasonInp">Reason (optional)</label>' +
          '<input id="portalReasonInp" class="inp portal-reason-inp" placeholder="Why are you declining?"></div>';

        const nameInp = decisionSec.querySelector(".portal-name-inp");
        const approveBtn = decisionSec.querySelector(".portal-approve");
        const declineBtn = decisionSec.querySelector(".portal-decline");
        const reasonWrap = decisionSec.querySelector(".portal-field-reason");
        const reasonInp = decisionSec.querySelector(".portal-reason-inp");
        let busy = false;

        approveBtn.addEventListener("click", async () => {
          const name = nameInp.value.trim();
          if (!name) { showNote("Please type your full name to approve.", "warn"); nameInp.focus(); return; }
          if (busy) return;
          busy = true;
          approveBtn.disabled = true; declineBtn.disabled = true;
          showNote("Recording your acceptance…");
          const r = await call("POST", "/approve", { selection: Array.from(selection), approver_name: name });
          busy = false;
          approveBtn.disabled = false; declineBtn.disabled = false;
          if (r.status === 200) {
            markTerminal("approved");
          } else {
            showNote((r.body && r.body.detail) || "That approval could not be completed.", "warn");
          }
        });

        declineBtn.addEventListener("click", async () => {
          if (!reasonWrap.hidden) {
            if (busy) return;
            busy = true;
            approveBtn.disabled = true; declineBtn.disabled = true;
            const r = await call("POST", "/decline", { selection: Array.from(selection), reason: reasonInp.value.trim() });
            busy = false;
            approveBtn.disabled = false; declineBtn.disabled = false;
            if (r.status === 200) {
              markTerminal("declined");
            } else {
              showNote((r.body && r.body.detail) || "That decline could not be completed.", "warn");
            }
          } else {
            reasonWrap.hidden = false;
            reasonInp.focus();
            declineBtn.textContent = "Confirm decline";
          }
        });
      }

      async function refreshTotals() {
        const r = await call("POST", "/select", { selection: Array.from(selection) });
        if (r.status === 200 && r.body && r.body.view) {
          view = r.body.view;
          renderLines();
          renderTotals();
          showNote("");
        } else if (r.status === 429) {
          showNote((r.body && r.body.detail) || "Too many changes — please slow down.", "warn");
        } else {
          showNote((r.body && r.body.detail) || "That selection is not allowed.", "warn");
        }
      }

      async function onToggle(group, line, type, on) {
        const id = String(line.id);
        if (type === "radio" && on) {
          (group ? groupMemberIds(group.id) : []).forEach(other => selection.delete(other));
          selection.add(id);
        } else if (on) {
          selection.add(id);
        } else {
          selection.delete(id);
        }
        refreshControls();
        renderLines();
        await refreshTotals();
      }

      // Attach and paint in order.
      const swap = () => { replace(page); };
      // Paint into `page` while it is detached (queries still work on detached
      // nodes), then swap it in.
      renderLines();
      renderGroups();
      renderTotals();
      renderDecision();
      swap();
      // Re-query nothing here: the listeners above close over the detached
      // nodes, which are now the live nodes after the swap.
    }

    // ---- non-200 states --------------------------------------------------

    function deadState(res) {
      const status = res ? res.status : 500;
      const body = (res && res.body) || {};
      const code = body.code;
      if (status === 404) {
        return stateCard("warn", "This link isn’t valid",
          "We couldn’t find a quote for this link. It may have been mistyped, or the link was replaced by a newer one.",
          { hint: "Ask the sender to share the latest link." });
      }
      if (status === 410) {
        const title = code === "expired" ? "This link has expired" : code === "used" ? "This link has already been used" : "This link is no longer active";
        const msg = code === "revoked"
          ? "The sender has revoked this link. If a newer quote was issued, please use the latest link."
          : code === "expired"
            ? "This quote is past its expiry date. Ask the sender to re-issue it."
            : code === "used"
              ? "This was a single-use link and it has already been opened."
              : "This portal link is no longer available.";
        return stateCard("warn", title, msg);
      }
      if (status === 429) {
        return stateCard("warn", "Too many requests", (body && body.detail) || "Please wait a moment and try again.");
      }
      return stateCard("warn", "Something went wrong", (body && body.detail) || "The quote could not be opened.");
    }
  }

  // Attribute-selector escaping for the few characters our ids can contain.
  function cssEscape(v) {
    return String(v == null ? "" : v).replace(/["\\]/g, "\\$&");
  }

  return {
    VERSION,
    render,
    esc,
    selectedIdsFromView,
    groupsWithMembers,
    ungroupedOptional,
    optionalLines,
    controlFor,
    groupTypeLabel,
    terminalStatus,
    isPast,
    canExpire,
    cssEscape
  };
})();
