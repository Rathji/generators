// ============================================================================
// quote-u — Connectors station (roadmap tasks 45–47)
// ----------------------------------------------------------------------------
// The integration-governance surface, all of it read/written through the SAME
// wrapped gateway the app calls through:
//
//   Gateway manifest  — every connector, its declared function allowlist with
//                       each function's effect (read|write), the gateway KEY
//                       NAME it uses (never a credential), its permitted roles,
//                       and an individual enable/disable switch. `verify()` proves
//                       the declarations are coherent.
//   Write policy      — the gated-writes allowlist: each external write is
//                       approved here (individually) before it may leave the
//                       app, with the confirmation requirement and the ledger.
//   Gated-write ledger— every gated attempt (performed or refused), with who,
//                       what, which scope/role and the outcome.
//   Product content   — the pluggable content providers (default none, plus the
//                       free/open sources) and the recorded escalation options.
//   Call log          — the centralized log of every outbound call.
// ============================================================================
window.QU_RENDERERS = window.QU_RENDERERS || {};

function renderConnectorsStation(ctx) {
  const wrap = document.createElement("div");
  wrap.className = "admin-stack";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function chip(text, kind) {
    return '<span class="chip' + (kind ? " chip-" + kind : "") + '">' + esc(text) + "</span>";
  }
  function timeAgo(iso) {
    if (!iso) return "—";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return "—";
    if (s < 8) return "just now";
    if (s < 60) return Math.round(s) + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return new Date(iso).toLocaleDateString();
  }

  const gateway = (window.QU && window.QU.gateway) || null;

  wrap.appendChild(manifestCard());
  wrap.appendChild(writePolicyCard());
  wrap.appendChild(ledgerCard());
  wrap.appendChild(contentCard());
  wrap.appendChild(mailCard());
  wrap.appendChild(disciplineCard());
  wrap.appendChild(busCard());
  wrap.appendChild(callLogCard());
  return wrap;

  // ---- gateway manifest ----------------------------------------------------

  function manifestCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Connector gateway</h2>' +
      '<p class="hint" style="margin:2px 0 0">Every cross-system call is allowlisted at one boundary, logged, and can be disabled individually. The gateway holds only key NAMES and role assignments — never a credential.</p></div>' +
      '<span class="chip" data-gw-chip>…</span></div>' +
      '<div data-gw-verify class="hint" style="margin:4px 0 0"></div>' +
      '<div data-gw-list style="margin-top:8px"></div>' +
      '<div class="admin-actions" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-gw-reload>Verify declarations</button></div>' +
      '<div data-gw-msg class="hint" style="margin-top:6px"></div>';

    if (!gateway || typeof gateway.manifest !== "function") {
      card.querySelector("[data-gw-list]").innerHTML = '<p class="hint">The connector gateway is not available.</p>';
      return card;
    }
    const chipEl = card.querySelector("[data-gw-chip]");
    const listEl = card.querySelector("[data-gw-list]");
    const verifyEl = card.querySelector("[data-gw-verify]");
    const msgEl = card.querySelector("[data-gw-msg]");

    function render() {
      const rows = gateway.manifest() || [];
      chipEl.textContent = rows.length + " connector" + (rows.length === 1 ? "" : "s");
      const roles = typeof gateway.roles === "function" ? gateway.roles() : {};
      const roleBits = Object.keys(roles).map(r => r + (roles[r].writes === false ? " (read-only)" : "")).join(" · ");
      listEl.innerHTML = "";

      rows.forEach(c => {
        const box = document.createElement("div");
        box.className = "card";
        box.style.margin = "0 0 8px";
        const fns = c.functions || [];
        const writes = fns.filter(f => f.effect === "write").length;
        box.innerHTML =
          '<div class="card-title-row"><div><strong>' + esc(c.label || c.name) + '</strong> ' +
          chip(c.kind || "mixed", c.kind === "read" ? "ok" : null) + (c.live ? " " + chip("live") : " " + chip("mock")) +
          '</div>' +
          '<label class="hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-gw-enable="' + esc(c.name) + '"' + (c.enabled ? " checked" : "") + '> enabled</label></div>' +
          '<div class="sys-grid">' +
          '<div class="sys-row"><span class="sys-k">Connector</span><span class="sys-v muted">' + esc(c.name) + "</span></div>" +
          '<div class="sys-row"><span class="sys-k">Gateway key</span><span class="sys-v muted">' + (c.gateway_key ? esc(c.gateway_key) : "— (no credential)") + "</span></div>" +
          '<div class="sys-row"><span class="sys-k">Roles</span><span class="sys-v muted">' + (Array.isArray(c.roles) && c.roles.length ? esc(c.roles.join(", ")) : "all roles") + "</span></div>" +
          '<div class="sys-row"><span class="sys-k">Functions</span><span class="sys-v muted">' + fns.length + " allowlisted · " + writes + " write" + (writes === 1 ? "" : "s") + "</span></div>" +
          "</div>" +
          '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">' +
          fns.map(f => chip(f.name, f.effect === "write" ? "warn" : "ok")).join("") +
          "</div>";
        box.querySelector("[data-gw-enable]").addEventListener("change", e => {
          const r = gateway.setEnabled(c.name, e.target.checked);
          msgEl.textContent = r && r.ok ? (c.name + (e.target.checked ? " enabled" : " disabled")) : "Could not change " + c.name;
          render();
        });
        listEl.appendChild(box);
      });
      if (!rows.length) listEl.innerHTML = '<p class="hint">No connectors are registered.</p>';
      verifyEl.innerHTML = '<span class="hint">Roles: ' + esc(roleBits || "—") + "</span>";
    }

    function runVerify() {
      if (typeof gateway.verify !== "function") return;
      const v = gateway.verify();
      verifyEl.innerHTML = v.ok
        ? '<span class="st-badge pass">declarations coherent</span>'
        : '<span class="st-badge fail">' + (v.violations || []).length + " violation(s)</span> " + esc((v.violations || []).map(x => x.detail).join(" | "));
    }

    card.querySelector("[data-gw-reload]").addEventListener("click", () => { render(); runVerify(); });
    render();
    runVerify();
    return card;
  }

  // ---- gated-write policy --------------------------------------------------

  function writePolicyCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Write policy</h2>' +
      '<p class="hint" style="margin:2px 0 0">No external write is enabled until it is approved here. An unlisted write is refused, and an approved write still requires an explicit confirmation from the actor performing it.</p></div>' +
      '<span class="chip" data-gp-chip>…</span></div>' +
      '<div data-gp-list></div>' +
      '<div class="admin-actions" style="margin-top:10px">' +
      '<label class="hint" style="display:flex;gap:6px;align-items:center;margin-right:auto"><input type="checkbox" data-gp-confirm> require explicit confirmation</label>' +
      '<button class="btn btn-ghost btn-sm" data-gp-verify>Verify policy</button></div>' +
      '<div data-gp-msg class="hint" style="margin-top:6px"></div>';

    const gated = (window.QU && window.QU.gated) || null;
    if (!gated || typeof gated.declaredWrites !== "function") {
      card.querySelector("[data-gp-list]").innerHTML = '<p class="hint">The gated-writes service is not available.</p>';
      return card;
    }
    const listEl = card.querySelector("[data-gp-list]");
    const chipEl = card.querySelector("[data-gp-chip]");
    const confirmEl = card.querySelector("[data-gp-confirm]");
    const msgEl = card.querySelector("[data-gp-msg]");

    function render() {
      const rows = gated.declaredWrites();
      const approved = rows.filter(r => r.approved).length;
      chipEl.textContent = approved + " / " + rows.length + " approved";
      confirmEl.checked = gated.requireConfirmation();
      listEl.innerHTML = "";
      if (!rows.length) {
        listEl.innerHTML = '<p class="hint">No connector functions are registered.</p>';
        return;
      }
      rows.forEach(w => {
        const row = document.createElement("div");
        row.className = "sys-row";
        row.style.flexWrap = "wrap";
        row.style.alignItems = "center";
        row.innerHTML =
          '<span class="sys-k">' + esc(w.key) + "</span>" +
          '<span class="sys-v" style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;overflow:visible">' +
          chip(w.approved ? "approved" : "not approved", w.approved ? "ok" : "warn") +
          '<button class="btn btn-ghost btn-sm">' + (w.approved ? "Revoke" : "Approve") + "</button>" +
          "</span>" +
          (w.approved && (w.approved_by || w.note) ? '<span class="hint" style="flex:1 1 100%;margin:2px 0 0;text-align:right">' + esc((w.approved_by || "") + (w.note ? " · " + w.note : "")) + "</span>" : "");
        row.querySelector("button").addEventListener("click", async () => {
          const r = w.approved ? await gated.revoke(w.key, { by: "admin" }) : await gated.approve(w.key, { by: "admin", note: "approved from the Connectors station" });
          msgEl.textContent = r.ok ? (w.key + (w.approved ? " revoked" : " approved")) : "Could not update: " + (r.detail || r.code);
          render();
        });
        listEl.appendChild(row);
      });
    }

    confirmEl.addEventListener("change", async e => {
      const r = await gated.setRequireConfirmation(e.target.checked);
      msgEl.textContent = r.ok ? "Confirmation requirement saved." : "Could not save: " + (r.detail || r.code);
      render();
    });
    card.querySelector("[data-gp-verify]").addEventListener("click", () => {
      const v = gated.verify();
      msgEl.textContent = v.ok ? "Policy coherent." : "Violations: " + (v.violations || []).map(x => x.detail).join(" | ");
    });

    render();
    return card;
  }

  // ---- gated-write ledger --------------------------------------------------

  function ledgerCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Gated-write ledger</h2>' +
      '<p class="hint" style="margin:2px 0 0">Every gated write attempt — performed, failed or refused — with the actor, scope, role and outcome.</p></div>' +
      '<span class="chip" data-gl-chip>…</span></div>' +
      '<div data-gl-list></div>' +
      '<div class="admin-actions" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-gl-clear>Clear ledger</button></div>' +
      '<div data-gl-msg class="hint" style="margin-top:6px"></div>';

    const gated = (window.QU && window.QU.gated) || null;
    if (!gated || typeof gated.ledger !== "function") {
      card.querySelector("[data-gl-list]").innerHTML = '<p class="hint">The gated-writes service is not available.</p>';
      return card;
    }
    const listEl = card.querySelector("[data-gl-list]");
    const chipEl = card.querySelector("[data-gl-chip]");
    const msgEl = card.querySelector("[data-gl-msg]");

    function render() {
      const rows = gated.ledger({ limit: 60 }).slice().reverse();
      const refusals = gated.ledger({ decision: "refused" }).length;
      chipEl.textContent = rows.length ? gated.ledger().length + " record(s)" + (refusals ? " · " + refusals + " refused" : "") : "empty";
      listEl.innerHTML = "";
      if (!rows.length) {
        listEl.innerHTML = '<p class="hint">No gated writes have been attempted yet.</p>';
        return;
      }
      rows.forEach(r => {
        const row = document.createElement("div");
        row.className = "sys-row";
        row.style.flexWrap = "wrap";
        row.innerHTML =
          '<span class="sys-k">' + esc(r.key || (r.connector + "." + r.fn)) + "</span>" +
          '<span class="sys-v" style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;overflow:visible">' +
          chip(r.decision, r.decision === "performed" ? "ok" : r.decision === "refused" ? "warn" : "fail") +
          '<span class="hint">' + esc((r.by ? "by " + r.by : "no actor") + (r.code ? " · " + r.code : "")) + "</span>" +
          '<span class="hint">' + esc(timeAgo(r.at)) + "</span>" +
          "</span>";
        listEl.appendChild(row);
      });
    }

    card.querySelector("[data-gl-clear]").addEventListener("click", async () => {
      await gated.clearLedger();
      msgEl.textContent = "Ledger cleared.";
      render();
    });
    render();
    return card;
  }

  // ---- product content -----------------------------------------------------

  function contentCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Product content</h2>' +
      '<p class="hint" style="margin:2px 0 0">Descriptions and imagery can be enriched from a pluggable provider. The default is <strong>none</strong> (self-contained catalog); the free/open sources need no key, so the system is never coupled to a paid provider.</p></div>' +
      '<span class="chip" data-gc-chip>…</span></div>' +
      '<div data-gc-providers></div>' +
      '<h3 style="margin:14px 0 4px;font-size:13px">Escalation options (recorded, not enabled)</h3>' +
      '<div data-gc-escalation></div>';

    const content = (window.QU && window.QU.content) || null;
    if (!content || typeof content.listProviders !== "function") {
      card.querySelector("[data-gc-providers]").innerHTML = '<p class="hint">The content service is not available.</p>';
      return card;
    }
    const providers = content.listProviders();
    card.querySelector("[data-gc-chip]").textContent = providers.length + " provider" + (providers.length === 1 ? "" : "s");
    card.querySelector("[data-gc-providers]").innerHTML = providers.map(p =>
      '<div class="sys-row" style="flex-wrap:wrap;align-items:flex-start"><span class="sys-k">' + esc(p.label || p.name) + (p.free ? " " + chip("free/open", "ok") : "") + "</span>" +
      '<span class="sys-v muted" style="overflow:visible;white-space:normal;text-align:right;flex:1 1 200px">' + esc(p.description || "") + (p.license ? " · " + esc(p.license) : "") + "</span></div>"
    ).join("");
    const esc_ = content.escalationPlan ? content.escalationPlan() : [];
    card.querySelector("[data-gc-escalation]").innerHTML = esc_.length
      ? esc_.map(e => '<div class="sys-row" style="flex-wrap:wrap;align-items:flex-start"><span class="sys-k">' + esc(e.label) + '</span><span class="sys-v muted" style="overflow:visible;white-space:normal;text-align:right;flex:1 1 200px">' + esc(e.covers) + " Trigger: " + esc(e.trigger) + "</span></div>").join("")
      : '<p class="hint">No escalation options recorded.</p>';
    return card;
  }

  // ---- call log ------------------------------------------------------------

  function callLogCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Gateway call log</h2>' +
      '<p class="hint" style="margin:2px 0 0">The centralized record of every outbound call — reads and writes, allowed or refused.</p></div>' +
      '<span class="chip" data-gcl-chip>…</span></div>' +
      '<div data-gcl-list></div>' +
      '<div class="admin-actions" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-gcl-clear>Clear call log</button></div>';

    if (!gateway || typeof gateway.callLog !== "function") {
      card.querySelector("[data-gcl-list]").innerHTML = '<p class="hint">The connector gateway is not available.</p>';
      return card;
    }
    const listEl = card.querySelector("[data-gcl-list]");
    const chipEl = card.querySelector("[data-gcl-chip]");

    function render() {
      const rows = (gateway.callLog() || []).slice(-50).reverse();
      chipEl.textContent = (gateway.callLog() || []).length + " call(s)";
      listEl.innerHTML = "";
      if (!rows.length) {
        listEl.innerHTML = '<p class="hint">No calls recorded yet.</p>';
        return;
      }
      rows.forEach(r => {
        const row = document.createElement("div");
        row.className = "sys-row";
        const label = r.event ? String(r.event) : (r.connector + (r.fn ? "." + r.fn : ""));
        const bits = [];
        if (r.effect) bits.push(r.effect);
        if (r.role) bits.push("role " + r.role);
        if (r.key) bits.push("key " + r.key);
        if (r.live) bits.push("live");
        if (r.ms !== undefined) bits.push(r.ms + "ms");
        if (r.code) bits.push(r.code);
        row.innerHTML =
          '<span class="sys-k">' + esc(label) + "</span>" +
          '<span class="sys-v" style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;overflow:visible">' +
          chip(r.ok === false ? "refused" : "ok", r.ok === false ? "warn" : "ok") +
          '<span class="hint">' + esc(bits.join(" · ")) + "</span>" +
          '<span class="hint">' + esc(timeAgo(r.at)) + "</span></span>";
        listEl.appendChild(row);
      });
    }

    card.querySelector("[data-gcl-clear]").addEventListener("click", () => {
      if (typeof gateway.clearLog === "function") gateway.clearLog();
      render();
    });
    render();
    return card;
  }
  // ---- mail send-as-rep ----------------------------------------------------

  function mailCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Mail send-as-rep</h2>' +
      '<p class="hint" style="margin:2px 0 0">Quote-link delivery is sent as the rep\'s own mailbox: one application permission, scoped to the sales group, with no shared mailbox and no additional mailbox license.</p></div>' +
      '<span class="chip" data-gm-chip>…</span></div>' +
      '<div data-gm-body></div>';

    const mail = (window.QU && window.QU.mail) || null;
    const body = card.querySelector("[data-gm-body]");
    if (!mail || typeof mail.grant !== "function") {
      body.innerHTML = '<p class="hint">The mail-permission service is not available.</p>';
      return card;
    }
    const g = mail.grant();
    card.querySelector("[data-gm-chip]").textContent = g.permission + " · " + g.scope_group;
    const rows = [
      ["Permission", g.permission + " (application)"],
      ["Scope group", g.scope_group],
      ["Send as", g.send_as === "own_mailbox" ? "the sender's own mailbox" : g.send_as],
      ["Shared mailbox", g.shared_allowed ? "allowed" : "never (refused)"]
    ];
    body.innerHTML =
      '<div class="sys-grid">' + rows.map(r => '<div class="sys-row"><span class="sys-k">' + esc(r[0]) + '</span><span class="sys-v muted">' + esc(r[1]) + "</span></div>").join("") + "</div>" +
      '<h3 style="margin:12px 0 4px;font-size:13px">Members in scope</h3>' +
      (g.members || []).map(m => '<div class="sys-row" style="flex-wrap:wrap"><span class="sys-k">' + esc(m.name || m.actor) + " " + chip("sales", "ok") + '</span><span class="sys-v muted" style="overflow:visible;white-space:normal;text-align:right">' + esc(m.mailbox) + "</span></div>").join("") +
      '<p class="hint" style="margin-top:8px">Only a member of the scope group may send, and only as their own mailbox; a shared or foreign sender is refused before delivery.</p>';
    return card;
  }

  // ---- field-map & secret discipline ---------------------------------------

  function disciplineCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Field maps &amp; secret discipline</h2>' +
      '<p class="hint" style="margin:2px 0 0">An external field mapping is never guessed: it is verified against a captured payload before its connector may be enabled. No credential ever lives in the app — only key names and identity references.</p></div>' +
      '<span class="chip" data-gd-chip>…</span></div>' +
      '<div data-gd-maps></div>' +
      '<div class="admin-actions" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-gd-scan>Scan client surfaces for credentials</button></div>' +
      '<div data-gd-msg class="hint" style="margin-top:6px"></div>';

    const maps = (window.QU && window.QU.fieldMaps) || null;
    const secrets = (window.QU && window.QU.secrets) || null;
    const listEl = card.querySelector("[data-gd-maps]");
    const chipEl = card.querySelector("[data-gd-chip]");
    const msgEl = card.querySelector("[data-gd-msg]");

    if (!maps || typeof maps.list !== "function") {
      listEl.innerHTML = '<p class="hint">The field-map registry is not available.</p>';
      return card;
    }
    const rows = maps.list();
    const en = maps.enablement();
    chipEl.textContent = en.ready + " / " + en.total + " verified";
    listEl.innerHTML = rows.length
      ? rows.map(m => '<div class="sys-row" style="flex-wrap:wrap"><span class="sys-k">' + esc(m.id) + '</span><span class="sys-v" style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;overflow:visible">' +
          chip(m.verified ? "verified by capture" : "not verified", m.verified ? "ok" : "warn") +
          '<span class="hint">' + m.fields.length + " field(s)</span></span></div>").join("")
      : '<p class="hint">No field maps declared.</p>';

    card.querySelector("[data-gd-scan]").addEventListener("click", () => {
      if (!secrets || typeof secrets.scanSurfaces !== "function") { msgEl.textContent = "The secret-discipline module is not available."; return; }
      const surfaces = [
        { name: "connector manifest", json: gateway && typeof gateway.manifest === "function" ? gateway.manifest() : {} },
        { name: "gateway call log", text: gateway && typeof gateway.callLog === "function" ? JSON.stringify(gateway.callLog()) : "" }
      ];
      const res = secrets.scanSurfaces(surfaces);
      msgEl.innerHTML = res.ok
        ? '<span class="st-badge pass">no credential on a client surface</span>'
        : '<span class="st-badge fail">' + res.findings.length + " leak(s)</span> " + esc(res.findings.map(f => f.surface + " (" + f.label + ")").join(", "));
    });
    return card;
  }

  // ---- pipeline bus --------------------------------------------------------

  function busCard() {
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Pipeline bus</h2>' +
      '<p class="hint" style="margin:2px 0 0">Quote and approval events are published in the versioned pipeline envelope to the shared stream, and the same envelopes are fanned out to the outbound webhook.</p></div>' +
      '<span class="chip" data-gb-chip>…</span></div>' +
      '<div data-gb-body></div>' +
      '<div class="admin-actions" style="margin-top:10px">' +
      '<button class="btn btn-ghost btn-sm" data-gb-flush>Publish pending</button>' +
      '<button class="btn btn-ghost btn-sm" data-gb-verify>Verify envelopes</button></div>' +
      '<div data-gb-msg class="hint" style="margin-top:6px"></div>';

    const bus = (window.QU && window.QU.bus) || null;
    const body = card.querySelector("[data-gb-body]");
    const chipEl = card.querySelector("[data-gb-chip]");
    const msgEl = card.querySelector("[data-gb-msg]");
    if (!bus || typeof bus.published !== "function") {
      body.innerHTML = '<p class="hint">The pipeline bus is not available.</p>';
      return card;
    }
    function render() {
      const pub = bus.published().length;
      const pend = bus.pending().length;
      const hooks = bus.webhooks();
      chipEl.textContent = pub + " published" + (pend ? " · " + pend + " pending" : "");
      const last = bus.records().slice(-6).reverse();
      body.innerHTML =
        '<div class="sys-grid">' +
        '<div class="sys-row"><span class="sys-k">Stream</span><span class="sys-v muted">' + esc(bus.stream()) + "</span></div>" +
        '<div class="sys-row"><span class="sys-k">Schema</span><span class="sys-v muted">' + esc(bus.SCHEMA) + " v" + esc(String(bus.SCHEMA_VERSION)) + "</span></div>" +
        '<div class="sys-row"><span class="sys-k">Event types</span><span class="sys-v muted" style="overflow:visible;white-space:normal;text-align:right">' + esc(bus.TYPES.join(", ")) + "</span></div>" +
        '<div class="sys-row"><span class="sys-k">Webhooks</span><span class="sys-v muted" style="overflow:visible;white-space:normal;text-align:right">' + (hooks.length ? esc(hooks.map(h => h.url + " [" + h.events.join(",") + "]").join(" · ")) : "none") + "</span></div>" +
        "</div>" +
        (last.length ? '<h3 style="margin:12px 0 4px;font-size:13px">Recent envelopes</h3>' + last.map(r => '<div class="sys-row" style="flex-wrap:wrap"><span class="sys-k">' + esc(r.type) + '</span><span class="sys-v" style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap;overflow:visible">' + chip(r.delivered ? "delivered" : r.published ? "published" : "pending", r.delivered ? "ok" : r.published ? null : "warn") + '<span class="hint">key ' + esc(r.key) + "</span></span></div>").join("") : '<p class="hint" style="margin-top:8px">No events published yet.</p>');
    }
    card.querySelector("[data-gb-flush]").addEventListener("click", async () => {
      const r = await bus.flush();
      msgEl.textContent = "Flushed " + r.attempted + " envelope(s), " + r.delivered + " delivered.";
      render();
    });
    card.querySelector("[data-gb-verify]").addEventListener("click", () => {
      const v = bus.verify();
      msgEl.textContent = v.ok ? "All " + v.count + " envelope(s) coherent." : "Violations: " + (v.violations || []).map(x => x.detail).join(" | ");
    });
    render();
    return card;
  }
}

window.QU_RENDERERS.connectors = renderConnectorsStation;
