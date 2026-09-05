// FortiCloud IAM Planner - UI / views / interactions.
// Depends on window.IAMCatalog (catalog.js), window.IAMModel (model.js), window.IAM_REFERENCE (reference.js).

window.IAMApp = (() => {
  const C = window.IAMCatalog;
  const M = window.IAMModel;
  const REF = window.IAM_REFERENCE;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let currentView = "profiles";
  let dirType = "iam";
  const cmp = { a: null, b: null };
  let refCat = "All";
  let refQ = "";
  let draft = null;
  let editingId = null;

  // ---------------- badges / helpers ----------------
  function accessBadge(level) {
    const map = {
      admin: ["b-admin", "Admin"], write: ["b-write", "Read &amp; Write"], read: ["b-read", "Read Only"],
      none: ["b-none", "No Access"], denied: ["b-denied", "Denied"], custom: ["b-custom", "Custom"],
      undefined: ["b-undef", "Undefined"], sysadmin: ["b-sysadmin", "SysAdmin"]
    };
    const [cls, label] = map[level] || ["b-none", esc(level)];
    return `<span class="badge ${cls}">${label}</span>`;
  }
  const sevMap = { error: ["b-sev-error", "Error"], warning: ["b-sev-warn", "Warning"], info: ["b-sev-info", "Info"] };
  function sevBadge(sev) {
    const [cls, label] = sevMap[sev] || ["b-sev-info", sev];
    return `<span class="badge ${cls}">${label}</span>`;
  }
  const lvlRank = { none: 0, read: 1, write: 2, admin: 3, custom: 4 };

  function toast(msg, type = "info") {
    const t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3200);
  }

  // ---------------- modal infra ----------------
  function openModal(title, body, footer, wide) {
    const root = $("#modalRoot");
    root.innerHTML = `
      <div class="overlay" data-action="modal:close">
        <div class="modal-card${wide ? " wide" : ""}">
          <div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-action="modal:close" aria-label="Close">&times;</button></div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
        </div>
      </div>`;
    root.classList.add("open");
  }
  function closeModal() {
    $("#modalRoot").classList.remove("open");
    $("#modalRoot").innerHTML = "";
    draft = null;
    editingId = null;
  }
  function confirmModal(title, body, onYes, yesLabel = "Confirm", danger = false) {
    openModal(title, `<div class="confirm-body">${body}</div>`,
      `<button class="btn ghost" data-action="modal:cancel">Cancel</button>
       <button class="btn ${danger ? "danger" : "primary"}" data-action="modal:yes">${yesLabel}</button>`,
      false);
    window.__confirmYes = onYes;
  }

  // ---------------- top-level render ----------------
  function render() {
    renderNav();
    const v = $("#view");
    if (currentView === "profiles") v.innerHTML = viewProfiles();
    else if (currentView === "directory") v.innerHTML = viewDirectory();
    else if (currentView === "compare") v.innerHTML = viewCompare();
    else if (currentView === "audit") v.innerHTML = viewAudit();
    else if (currentView === "reference") { v.innerHTML = viewReference(); bindRefInput(); }
    else v.innerHTML = viewProfiles();
  }
  function renderNav() {
    const tabs = [
      ["profiles", "Permission Profiles"], ["directory", "Directory"], ["compare", "Compare"],
      ["audit", "Audit"], ["reference", "Reference"]
    ];
    $("#nav").innerHTML = tabs.map(([id, label]) =>
      `<button class="nav-tab${currentView === id ? " active" : ""}" data-action="nav" data-view="${id}">${label}</button>`).join("");
  }

  // ---------------- Profiles view ----------------
  function viewProfiles() {
    const S = M.getState();
    const activeCount = S.profiles.filter(p => p.status === "active").length;
    let rows = "";
    for (const p of S.profiles) {
      const findings = M.validateProfile(p);
      const errs = findings.filter(f => f.severity === "error").length;
      const warns = findings.filter(f => f.severity === "warning").length;
      const users = M.countActiveUsers(p.id);
      const riskBadge = (errs + warns) > 0
        ? `<span class="badge ${errs ? "b-sev-error" : "b-sev-warn"}">${errs ? errs + " error" + (errs > 1 ? "s" : "") : ""}${errs && warns ? " + " : ""}${warns ? warns + " warn" + (warns > 1 ? "s" : "") : ""}</span>`
        : `<span class="badge b-ok">OK</span>`;
      rows += `
        <tr class="${p.status === "inactive" ? "row-inactive" : ""}">
          <td class="td-name">
            <div class="prof-name" data-action="profile:edit" data-id="${p.id}">${esc(p.name)}${p.builtin ? `<span class="badge b-builtin">Default</span>` : ""}${p.sysadmin ? `<span class="badge b-sysadmin">SysAdmin</span>` : ""}</div>
            <div class="muted small">${esc((p.description || "No description").slice(0, 90))}</div>
          </td>
          <td>${p.type === "org" ? `<span class="badge b-type">Organization</span>` : `<span class="badge b-type-local">Local</span>`}</td>
          <td>${p.status === "active" ? `<span class="badge b-ok">Active</span>` : `<span class="badge b-off">Inactive</span>`}</td>
          <td class="num">${p.portals.length}</td>
          <td class="num">${users}</td>
          <td>${riskBadge}</td>
          <td class="row-actions">
            ${p.builtin ? "" : `
            <button class="btn ghost sm" data-action="profile:clone" data-id="${p.id}">Clone</button>
            <button class="btn ghost sm" data-action="profile:status" data-id="${p.id}" data-next="${p.status === "active" ? "inactive" : "active"}">${p.status === "active" ? "Disable" : "Enable"}</button>
            <button class="btn danger sm" data-action="profile:delete" data-id="${p.id}">Delete</button>`}
          </td>
        </tr>`;
    }
    return `
      <div class="view-head">
        <div>
          <h2>Permission Profiles</h2>
          <p class="muted">Profiles define which portals a user can reach and at what level. Every IAM user, user group, API user and IdP role must be assigned a profile (or a group with a profile).</p>
        </div>
        <div class="head-actions">
          <button class="btn ghost" data-action="export:download">Export JSON</button>
          <button class="btn ghost" data-action="import:open">Import</button>
          <button class="btn primary" data-action="profile:new">+ New Profile</button>
        </div>
      </div>
      <div class="stat-strip">
        <div class="stat"><span class="stat-num">${S.profiles.length}</span><span class="stat-label">Profiles</span></div>
        <div class="stat"><span class="stat-num">${activeCount}</span><span class="stat-label">Active</span></div>
        <div class="stat"><span class="stat-num">${S.users.length}</span><span class="stat-label">Users</span></div>
        <div class="stat"><span class="stat-num">${S.groups.length}</span><span class="stat-label">Groups</span></div>
        <div class="stat-note"><b>SysAdmin</b> (default, immutable) grants full access to Asset Management, IAM &amp; FortiCare - but not Cloud Management or Cloud Services.</div>
      </div>
      <div class="card">
        <table class="tbl">
          <thead><tr><th>Profile</th><th>Type</th><th>Status</th><th>Portals</th><th>Assigned</th><th>Checks</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="empty">No permission profiles yet. <button class="btn primary sm" data-action="profile:new">Create one</button></td></tr>`}</tbody>
        </table>
      </div>`;
  }

  // ---------------- Profile editor ----------------
  function blankProfile() {
    return { name: "", type: "local", status: "active", description: "", portals: [] };
  }
  function openProfileEditor(id) {
    const S = M.getState();
    if (id) {
      const p = S.profiles.find(x => x.id === id);
      if (!p) return;
      draft = JSON.parse(JSON.stringify(p));
      editingId = id;
    } else {
      draft = blankProfile();
      editingId = null;
    }
    renderProfileEditor();
  }
  function renderProfileEditor() {
    const isNew = editingId === null;
    const d = draft;
    const readOnly = !!d.builtin;
    openModal(
      isNew ? "New Permission Profile" : "Edit: " + esc(d.name),
      `
      ${readOnly ? `<div class="callout warn">The SysAdmin default profile cannot be edited, disabled, or deleted.</div>` : ""}
      <div class="form-grid">
        <label>Permission Profile Name
          <input data-action="field:set" data-field="name" value="${esc(d.name)}" placeholder="e.g. Network-Operators" ${readOnly ? "disabled" : ""}></label>
        <label>Type
          <select data-action="field:set" data-field="type" ${readOnly ? "disabled" : ""}>
            <option value="local" ${d.type === "local" ? "selected" : ""}>Local (asset folders)</option>
            <option value="org" ${d.type === "org" ? "selected" : ""}>Organization (OU access)</option>
          </select>
          <span class="hint">Type cannot be changed after the profile is saved.</span></label>
        <label>Status
          <select data-action="field:set" data-field="status" ${readOnly ? "disabled" : ""}>
            <option value="active" ${d.status === "active" ? "selected" : ""}>Active</option>
            <option value="inactive" ${d.status === "inactive" ? "selected" : ""}>Inactive</option>
          </select></label>
        <label class="span2">Description
          <textarea data-action="field:set" data-field="description" rows="2" ${readOnly ? "disabled" : ""}>${esc(d.description)}</textarea></label>
      </div>

      <h4 class="section-h">Portals & permissions</h4>
      ${readOnly ? `<p class="muted small">SysAdmin covers the three resource-based portals below at full access.</p>` : `
      <p class="muted small">Add a portal to grant access; to <b>deny</b> a portal, add it but leave all access off. Portals not listed here are <b>undefined</b> (not denied) - users may still reach them via the Services menu if the portal offers open access.</p>`}
      <div id="portalCards">${d.portals.map(portalCardHTML).join("") || `<div class="empty pad">No portals added.</div>`}</div>
      ${readOnly ? "" : `<button class="btn ghost sm" data-action="portal:add">+ Add Portal</button>`}

      <div id="findingsPanel"></div>
      `,
      `${readOnly ? "" : `<button class="btn ghost" data-action="modal:cancel">Cancel</button>`}
       <button class="btn primary" data-action="profile:save" ${readOnly ? "disabled" : ""}>${isNew ? "Create Profile" : "Save Changes"}</button>`,
      true
    );
    if (readOnly) {
      $("#findingsPanel").innerHTML = findingsHTML(M.validateProfile(d));
      return;
    }
    renderPortalCards();
    renderFindings();
    bindEditorInputs();
  }

  function renderPortalCards() {
    $("#portalCards").innerHTML = draft.portals.map(portalCardHTML).join("");
  }

  function portalCardHTML(pt) {
    const cat = C.findPortal(pt.id);
    const name = cat ? cat.name : (pt.name || pt.id);
    const isRole = cat ? cat.model === "role" : (pt.model === "role");
    let body;
    if (isRole) body = roleCardBody(pt, cat);
    else body = resourceCardBody(pt, cat);
    const summary = portalSummary(pt, cat, isRole);
    return `
      <div class="portal-card" id="pc-${esc(pt.id)}">
        <div class="pc-head">
          <div class="pc-title"><b>${esc(name)}</b><span class="badge ${isRole ? "b-model-role" : "b-model-res"}">${isRole ? "Role-based" : "Resource-based"}</span><span id="pc-sum-${esc(pt.id)}" class="pc-sum">${summary}</span></div>
          <div class="pc-actions">
            ${draft.builtin ? "" : `<button class="btn ghost sm" data-action="portal:deny" data-id="${pt.id}">Deny</button>
            <button class="btn danger sm" data-action="portal:remove" data-id="${pt.id}">Remove</button>`}
          </div>
        </div>
        ${body}
      </div>`;
  }

  function roleCardBody(pt, cat) {
    const types = [["read", "Read Only"], ["write", "Read &amp; Write"], ["admin", "Admin"]];
    if (!cat || cat.hasCustom) types.push(["custom", "Custom"]);
    const enabled = !!pt.accessEnabled;
    return `
      <div class="pc-body">
        <label class="inline-check"><input type="checkbox" data-action="role:enable" data-id="${pt.id}" ${enabled ? "checked" : ""}> Access enabled</label>
        <div class="form-row">
          <label>Access Type
            <select data-action="role:type" data-id="${pt.id}" ${enabled ? "" : "disabled"}>
              ${types.map(([v, l]) => `<option value="${v}" ${pt.accessType === v ? "selected" : ""}>${l}</option>`).join("")}
            </select></label>
          <label class="grow">Additional Permissions (comma separated)
            <input data-action="role:additional" data-id="${pt.id}" value="${esc((pt.additional || []).join(", "))}" ${enabled ? "" : "disabled"}></label>
        </div>
        ${cat && cat.note ? `<p class="hint">${esc(cat.note)}</p>` : ""}
      </div>`;
  }

  function resourceCardBody(pt, cat) {
    const res = pt.resources || {};
    const rows = (cat ? cat.resources : []).map(r => {
      const lvl = res[r.id] || "none";
      const opts = r.levels.map(lv => {
        const labels = { none: "No Access", read: "Read Only", write: "Read &amp; Write" };
        return `<option value="${lv}" ${lvl === lv ? "selected" : ""}>${labels[lv] || lv}</option>`;
      }).join("");
      return `<tr>
        <td class="res-name">${esc(r.name)}${r.note ? `<div class="hint">${esc(r.note)}</div>` : ""}</td>
        <td class="res-sel"><select data-action="res:set" data-portal="${pt.id}" data-res="${r.id}">${opts}</select></td>
      </tr>`;
    }).join("");
    return `
      <div class="pc-body">
        <div class="res-toolbar">
          <span class="muted small">Access per resource</span>
          <label class="small-inline">Apply to all:
            <select data-action="res:setall" data-portal="${pt.id}">
              <option value="">-</option>
              <option value="none">No Access</option>
              <option value="read">Read Only</option>
              <option value="write">Read &amp; Write</option>
            </select></label>
        </div>
        <table class="tbl tight"><tbody>${rows}</tbody></table>
        ${cat && cat.note ? `<p class="hint">${esc(cat.note)}</p>` : ""}
      </div>`;
  }

  function portalSummary(pt, cat, isRole) {
    if (isRole) {
      if (!pt.accessEnabled || pt.accessType === "none") return accessBadge("denied");
      return accessBadge(pt.accessType);
    }
    const res = pt.resources || {};
    let highest = "none";
    for (const r of (cat ? cat.resources : [])) {
      const lvl = res[r.id] || "none";
      if (lvlRank[lvl] > lvlRank[highest]) highest = lvl;
    }
    return highest === "none" ? accessBadge("denied") : accessBadge(highest);
  }

  function updatePortalCard(pt) {
    const cat = C.findPortal(pt.id);
    const isRole = cat ? cat.model === "role" : (pt.model === "role");
    const sumEl = document.getElementById("pc-sum-" + pt.id);
    if (sumEl) sumEl.innerHTML = portalSummary(pt, cat, isRole);
  }

  function findingsHTML(findings) {
    if (!findings || !findings.length) return `<div class="findings ok"><span class="badge b-ok">All checks passed</span><span class="muted small">No issues found for this profile.</span></div>`;
    const items = findings.map(f => `
      <div class="finding f-${f.severity}">
        ${sevBadge(f.severity)}
        <span class="f-text">${esc(f.text)}</span>
        <a class="f-ref" href="${esc(f.ref)}" target="_blank" rel="noopener">docs</a>
      </div>`).join("");
    return `<div class="findings"><div class="findings-h">Validation</div>${items}</div>`;
  }
  function renderFindings() {
    const el = $("#findingsPanel");
    if (el) el.innerHTML = findingsHTML(M.validateProfile(draft));
  }

  function bindEditorInputs() {
    $("#modalRoot").querySelectorAll("[data-action=field\\:set]").forEach(el => {
      el.addEventListener("input", () => { draft[el.dataset.field] = el.value; });
    });
    $("#modalRoot").querySelectorAll("[data-action=field\\:set]").forEach(el => {
      el.addEventListener("change", () => { draft[el.dataset.field] = el.value; });
    });
    $("#modalRoot").querySelectorAll("[data-action=role\\:additional]").forEach(el => {
      el.addEventListener("input", () => {
        const pt = draft.portals.find(x => x.id === el.dataset.id);
        if (pt) pt.additional = el.value.split(",").map(s => s.trim()).filter(Boolean);
      });
    });
  }

  // ---------------- Portal picker ----------------
  function openPortalPicker() {
    const portalList = C.allPortals().map(cat => `
      <label class="picker-row">
        <input type="checkbox" class="pp" value="${cat.id}" ${draft.portals.some(p => p.id === cat.id) ? "disabled checked" : ""}>
        <span class="grow"><b>${esc(cat.name)}</b> <span class="badge ${cat.model === "role" ? "b-model-role" : "b-model-res"}">${cat.model === "role" ? "Role" : "Resource"}</span>
        ${cat.note ? `<div class="hint">${esc(cat.note.slice(0, 110))}</div>` : ""}</span>
      </label>`).join("");
    openModal("Add Portal",
      `<p class="muted small">Select portals to add to this profile. Access levels are configured next. A portal can only support one permission model at a time.</p>
       <div class="picker-list">${portalList}</div>
       <div class="picker-custom">
         <div class="section-h">Custom portal</div>
         <div class="form-row">
           <label class="grow">Name <input id="customPortalName" placeholder="e.g. FortiDeceptor Cloud"></label>
           <label>Model <select id="customPortalModel"><option value="role">Role-based</option><option value="resource">Resource-based</option></select></label>
           <button class="btn ghost sm" data-action="picker:custom">Add custom</button>
         </div>
       </div>`,
      `<button class="btn ghost" data-action="modal:cancel">Cancel</button>
       <button class="btn primary" data-action="picker:add">Add selected</button>`, true);
  }

  function addPortalToDraft(id, model) {
    const cat = C.findPortal(id);
    if (cat && cat.model === "resource") {
      draft.portals.push({ id, enabled: true, resources: {} });
    } else {
      draft.portals.push({ id, enabled: true, model: cat ? "role" : model, accessEnabled: false, accessType: "read", additional: [] });
    }
  }

  // ---------------- Directory view ----------------
  function viewDirectory() {
    const S = M.getState();
    const segs = [["iam", "IAM Users"], ["api", "API Users"], ["idp", "IdP Roles"], ["groups", "User Groups"]];
    const segHTML = `<div class="seg">
      ${segs.map(([id, label]) => `<button class="seg-btn${dirType === id ? " active" : ""}" data-action="dir" data-type="${id}">${label}</button>`).join("")}
    </div>`;
    if (dirType === "groups") {
      let rows = "";
      for (const g of S.groups) {
        const prof = M.findProfile(g.profileId);
        const members = S.users.filter(u => u.groupId === g.id);
        const memberList = members.map(u => esc(u.fullName || u.username)).join(", ") || "No members";
        rows += `<tr class="${g.status === "inactive" ? "row-inactive" : ""}">
          <td class="td-name"><div class="prof-name" data-action="group:edit" data-id="${g.id}">${esc(g.name)}</div></td>
          <td>${prof ? `<span data-action="profile:edit" data-id="${prof.id}" class="link">${esc(prof.name)}</span>` : `<span class="badge b-off">No profile</span>`}</td>
          <td>${esc(g.scope || "Root")}</td>
          <td class="num">${members.length}</td>
          <td class="muted small">${memberList}</td>
          <td>${g.status === "active" ? `<span class="badge b-ok">Active</span>` : `<span class="badge b-off">Inactive</span>`}</td>
          <td class="row-actions">
            <button class="btn ghost sm" data-action="group:edit" data-id="${g.id}">Edit</button>
            <button class="btn danger sm" data-action="group:delete" data-id="${g.id}">Delete</button>
          </td>
        </tr>`;
      }
      return `
        <div class="view-head">
          <div><h2>User Groups</h2><p class="muted">A user can only belong to one group at a time. Group permissions apply to all members and cascade automatically when changed.</p></div>
          <div class="head-actions"><button class="btn primary" data-action="group:new">+ New Group</button></div>
        </div>
        ${segHTML}
        <div class="card"><table class="tbl">
          <thead><tr><th>Group</th><th>Permission Profile</th><th>Scope</th><th>Members</th><th>Member list</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="empty">No user groups yet. <button class="btn primary sm" data-action="group:new">Create one</button></td></tr>`}</tbody>
        </table></div>`;
    }
    const typeLabel = { iam: "IAM User", api: "API User", idp: "IdP Role" }[dirType];
    let rows = "";
    for (const u of S.users.filter(x => x.type === dirType)) {
      const g = M.groupOf(u);
      const prof = M.profileOf(u);
      const eff = prof ? M.effectiveAccess(prof) : null;
      const effText = eff ? (eff.isSysAdmin ? "SysAdmin (full)" : eff.portals.filter(p => p.level !== "undefined" && p.level !== "denied").length + " portals · " + M.accessLabel(Math.max(...eff.portals.filter(p => p.level !== "undefined").map(p => p.raw === "admin" ? 3 : p.raw === "custom" ? 4 : p.raw === "write" ? 2 : p.raw === "read" ? 1 : 0))) : "No profile");
      rows += `<tr class="${u.status === "inactive" ? "row-inactive" : ""}">
        <td class="td-name"><div class="prof-name" data-action="user:edit" data-id="${u.id}">${esc(u.fullName || u.username)}</div><div class="muted small">@${esc(u.username || "-")}</div></td>
        <td>${g ? esc(g.name) : `<span class="muted">Direct</span>`}</td>
        <td>${prof ? `<span data-action="profile:edit" data-id="${prof.id}" class="link">${esc(prof.name)}</span>` : (g ? `<span class="muted small">via group</span>` : `<span class="badge b-undef">Unassigned</span>`)}</td>
        <td class="muted small">${esc(effText)}</td>
        <td>${esc(u.scope || "Root")}</td>
        <td>${u.status === "active" ? `<span class="badge b-ok">Active</span>` : `<span class="badge b-off">Disabled</span>`}</td>
        <td class="row-actions">
          <button class="btn ghost sm" data-action="user:edit" data-id="${u.id}">Edit</button>
          <button class="btn danger sm" data-action="user:delete" data-id="${u.id}">Delete</button>
        </td>
      </tr>`;
    }
    return `
      <div class="view-head">
        <div><h2>Directory</h2><p class="muted">Users and roles with their assigned permission profiles and scopes. Assign a profile directly or via a group.</p></div>
        <div class="head-actions"><button class="btn primary" data-action="user:new">+ Add ${typeLabel}</button></div>
      </div>
      ${segHTML}
      <div class="card"><table class="tbl">
        <thead><tr><th>Name</th><th>Group</th><th>Permission Profile</th><th>Effective access</th><th>Scope</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No ${typeLabel}s yet. <button class="btn primary sm" data-action="user:new">Add one</button></td></tr>`}</tbody>
      </table></div>`;
  }

  // ---------------- User / group editors ----------------
  function userEditor(u) {
    const S = M.getState();
    const profileOpts = S.profiles.filter(p => p.id !== "sysadmin" || true).map(p =>
      `<option value="${p.id}" ${u.profileId === p.id ? "selected" : ""}>${esc(p.name)}${p.builtin ? " (Default)" : ""}</option>`).join("");
    const groupOpts = S.groups.map(g => `<option value="${g.id}" ${u.groupId === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("");
    const copyOpts = S.users.filter(x => x.id !== u.id && (x.profileId || x.groupId)).map(x =>
      `<option value="${x.id}">${esc(x.fullName || x.username)}</option>`).join("");
    return `
      <div class="form-grid">
        <label>Username <input id="fUsername" value="${esc(u.username)}" placeholder="no spaces"></label>
        <label>Full Name <input id="fFullName" value="${esc(u.fullName)}"></label>
        <label>Email <input id="fEmail" type="email" value="${esc(u.email)}"></label>
        <label>Type <select id="fType">
          <option value="iam" ${u.type === "iam" ? "selected" : ""}>IAM user</option>
          <option value="api" ${u.type === "api" ? "selected" : ""}>API user</option>
          <option value="idp" ${u.type === "idp" ? "selected" : ""}>External IdP role</option>
        </select></label>
        <label>Status <select id="fStatus">
          <option value="active" ${u.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${u.status === "inactive" ? "selected" : ""}>Disabled</option>
        </select></label>
        <label>2FA <select id="f2fa">
          <option value="enforced" ${u.twoFA === "enforced" ? "selected" : ""}>Enforced</option>
          <option value="exempt" ${u.twoFA === "exempt" ? "selected" : ""}>Exempt</option>
        </select></label>
        <label class="span2">Permission Scope <input id="fScope" value="${esc(u.scope || "Root")}" placeholder="Asset folder or OU path (e.g. Root, EU/Sales)"></label>
        <label>User Group <select id="fGroup"><option value="">- Direct (no group) -</option>${groupOpts}</select>
          <span class="hint">A user can only belong to one group at a time.</span></label>
        <label>Permission Profile <select id="fProfile"><option value="">- None -</option>${profileOpts}</select></label>
        <label class="span2">Notes <textarea id="fNotes" rows="2">${esc(u.notes || "")}</textarea></label>
        ${copyOpts ? `<label class="span2">Copy permissions from existing user
          <select id="fCopy"><option value="">-</option>${copyOpts}</select>
          <span class="hint">Applies the selected user's profile, group and scope.</span></label>` : ""}
      </div>`;
  }
  function openUserEditor(id) {
    const S = M.getState();
    const u = id ? S.users.find(x => x.id === id) : { id: null, username: "", fullName: "", email: "", type: dirType === "groups" ? "iam" : dirType, groupId: null, profileId: null, scope: "Root", status: "active", twoFA: "enforced", notes: "" };
    openModal(id ? "Edit user: " + esc(u.fullName || u.username) : "Add user", userEditor(u),
      `<button class="btn ghost" data-action="modal:cancel">Cancel</button>
       <button class="btn primary" data-action="user:save" data-id="${id || ""}">Save</button>`, true);
    const copy = $("#fCopy");
    if (copy) copy.addEventListener("change", () => {
      const src = S.users.find(x => x.id === copy.value);
      if (!src) return;
      $("#fGroup").value = src.groupId || "";
      $("#fProfile").value = src.profileId || "";
      $("#fScope").value = src.scope || "Root";
    });
  }
  function groupEditor(g) {
    const S = M.getState();
    const profileOpts = S.profiles.map(p => `<option value="${p.id}" ${g.profileId === p.id ? "selected" : ""}>${esc(p.name)}${p.builtin ? " (Default)" : ""}</option>`).join("");
    const members = S.users.filter(u => u.groupId === g.id).map(u => esc(u.fullName || u.username)).join(", ");
    return `
      <div class="form-grid">
        <label class="span2">Group Name <input id="fGName" value="${esc(g.name)}"></label>
        <label>Status <select id="fGStatus">
          <option value="active" ${g.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${g.status === "inactive" ? "selected" : ""}>Inactive</option>
        </select></label>
        <label class="span2">Permission Scope <input id="fGScope" value="${esc(g.scope || "Root")}"></label>
        <label class="span2">Permission Profile <select id="fGProfile">${profileOpts}</select>
          <span class="hint">Group permissions cascade to all members. Changing this updates every member's access.</span></label>
        <label class="span2">Description <textarea id="fGDesc" rows="2">${esc(g.description || "")}</textarea></label>
        ${members ? `<label class="span2">Members <div class="muted">${members}</div></label>` : ""}
      </div>`;
  }
  function openGroupEditor(id) {
    const S = M.getState();
    const g = id ? S.groups.find(x => x.id === id) : { id: null, name: "", profileId: null, scope: "Root", status: "active", description: "" };
    openModal(id ? "Edit group: " + esc(g.name) : "Add user group", groupEditor(g),
      `<button class="btn ghost" data-action="modal:cancel">Cancel</button>
       <button class="btn primary" data-action="group:save" data-id="${id || ""}">Save</button>`, true);
  }

  // ---------------- Compare view ----------------
  function viewCompare() {
    const S = M.getState();
    const profs = S.profiles;
    const opts = profs.map(p => `<option value="${p.id}" ${p.builtin ? "data-sys" : ""}>${esc(p.name)}${p.builtin ? " (Default)" : ""}</option>`).join("");
    const a = profs.find(p => p.id === cmp.a) || null;
    const b = profs.find(p => p.id === cmp.b) || null;

    let body = `<div class="card pad"><p class="muted">Select two permission profiles to compare their effective portal access side by side.</p>
      <div class="form-row compare-selects">
        <select data-action="compare:set" data-side="a"><option value="">- Profile A -</option>${opts}</select>
        <span class="vs">vs</span>
        <select data-action="compare:set" data-side="b"><option value="">- Profile B -</option>${opts}</select>
      </div></div>`;

    if (a && b && a.id !== b.id) {
      const ea = M.effectiveAccess(a);
      const eb = M.effectiveAccess(b);
      const portalIds = [];
      for (const p of ea.portals) if (!portalIds.includes(p.id)) portalIds.push(p.id);
      for (const p of eb.portals) if (!portalIds.includes(p.id)) portalIds.push(p.id);

      const diffs = [];
      let matrix = "";
      for (const pid of portalIds) {
        const pa = ea.portals.find(p => p.id === pid);
        const pb = eb.portals.find(p => p.id === pid);
        const aLvl = pa ? pa.level : "undefined";
        const bLvl = pb ? pb.level : "undefined";
        const same = aLvl === bLvl;
        const name = (pa || pb).name;
        if (!same) diffs.push({ name, a: aLvl, b: bLvl, pa, pb });
        matrix += `<tr class="${same ? "" : "diff-row"}">
          <td class="cmp-name">${esc(name)}</td>
          <td>${pa ? accessBadge(aLvl) + `<div class="muted small">${esc(pa.detail)}</div>` : "<span class='muted'>-</span>"}</td>
          <td>${pb ? accessBadge(bLvl) + `<div class="muted small">${esc(pb.detail)}</div>` : "<span class='muted'>-</span>"}</td>
          <td class="cmp-delta">${same ? "" : "<b>DIFFERS</b>"}</td>
        </tr>`;
      }

      // resource-level differences not visible at aggregate level
      const resDiffs = [];
      for (const pid of portalIds) {
        const pa = ea.portals.find(p => p.id === pid);
        const pb = eb.portals.find(p => p.id === pid);
        if (!pa || !pb || pa.level !== pb.level) continue;
        if (!pa.resources || !pb.resources) continue;
        for (const ra of pa.resources) {
          const rb = pb.resources.find(r => r.id === ra.id);
          if (rb && ra.level !== rb.level) {
            resDiffs.push({ portal: pa.name, resource: ra.name, a: ra.level, b: rb.level });
          }
        }
      }

      const usersA = M.usersForProfile(a.id), usersB = M.usersForProfile(b.id);

      body += `
        <div class="card pad">
          <div class="cmp-head">
            <div><b>${esc(a.name)}</b> <span class="muted small">${usersA.length} user(s) assigned</span></div>
            <div><b>${esc(b.name)}</b> <span class="muted small">${usersB.length} user(s) assigned</span></div>
          </div>
          <table class="tbl compare-tbl">
            <thead><tr><th>Portal</th><th>${esc(a.name)}</th><th>${esc(b.name)}</th><th></th></tr></thead>
            <tbody>${matrix}</tbody>
          </table>
        </div>`;

      const diffList = [...diffs.map(d => ({ ...d, resource: null })), ...resDiffs];
      if (diffList.length) {
        body += `<div class="card pad">
          <div class="section-h">Differences (${diffList.length})</div>
          <ul class="diff-list">
          ${diffList.map(d => `<li><b>${esc(d.name)}${d.resource ? " > " + esc(d.resource) : ""}</b>: ${accessBadge(d.a)} → ${accessBadge(d.b)}</li>`).join("")}
          </ul>
          <p class="hint">Review before moving users between these profiles - the change applies to everyone assigned.</p>
        </div>`;
      } else {
        body += `<div class="card pad"><span class="badge b-ok">Identical effective access</span> <span class="muted small">These profiles grant the same portal access.</span></div>`;
      }
    }
    return `<div class="view-head"><div><h2>Compare Profiles</h2><p class="muted">Side-by-side diff of two permission profiles - useful before migrating a user or group, or auditing a change request.</p></div></div>${body}`;
  }

  // ---------------- Audit view ----------------
  function privilegeScore(p) {
    let s = 0;
    for (const pt of p.portals) {
      const cat = C.findPortal(pt.id);
      if (!cat) continue;
      if (cat.model === "role") { if (pt.accessEnabled && pt.accessType === "admin") s += 3; }
      else {
        const res = pt.resources || {};
        if (cat.resources.some(r => res[r.id] === "write")) s += 2;
      }
    }
    const iam = p.portals.find(x => x.id === "iam");
    if (iam) {
      const res = iam.resources || {};
      if (res.credentials === "write") s += 2;
      if (res["user-permissions"] === "write") s += 1;
    }
    return s;
  }
  function viewAudit() {
    const S = M.getState();
    const audit = M.auditAll();
    const unassigned = S.users.filter(u => !u.profileId && !u.groupId);
    const inactiveProfiles = S.profiles.filter(p => p.status === "inactive");

    let profilePanels = "";
    for (const r of audit.results) {
      const p = r.profile;
      const badge = p.status === "active" ? `<span class="badge b-ok">Active</span>` : `<span class="badge b-off">Inactive</span>`;
      profilePanels += `
        <div class="card pad audit-profile">
          <div class="audit-head">
            <div><b>${esc(p.name)}</b> ${p.builtin ? `<span class="badge b-builtin">Default</span>` : ""} ${badge} <span class="muted small">${r.activeUsers} active user(s) · score ${privilegeScore(p)}</span></div>
            <button class="btn ghost sm" data-action="profile:edit" data-id="${p.id}">Open</button>
          </div>
          ${r.findings.length ? `<div class="findings compact">${r.findings.map(f => `
            <div class="finding f-${f.severity}">${sevBadge(f.severity)}<span class="f-text">${esc(f.text)}</span><a class="f-ref" href="${esc(f.ref)}" target="_blank" rel="noopener">docs</a></div>`).join("")}</div>`
            : `<div class="findings ok"><span class="badge b-ok">All checks passed</span></div>`}
        </div>`;
    }

    const broad = S.profiles.filter(p => !p.builtin).map(p => ({ p, s: privilegeScore(p) })).sort((x, y) => y.s - x.s).slice(0, 5);

    return `
      <div class="view-head"><div><h2>Audit & Compliance</h2><p class="muted">Doc-grounded validation findings across every profile, plus least-privilege guidance.</p></div></div>
      <div class="stat-strip">
        <div class="stat"><span class="stat-num">${audit.totals.error || 0}</span><span class="stat-label">Errors</span></div>
        <div class="stat"><span class="stat-num">${audit.totals.warning || 0}</span><span class="stat-label">Warnings</span></div>
        <div class="stat"><span class="stat-num">${audit.totals.info || 0}</span><span class="stat-label">Info notes</span></div>
        <div class="stat"><span class="stat-num">${unassigned.length}</span><span class="stat-label">Unassigned users</span></div>
        <div class="stat"><span class="stat-num">${inactiveProfiles.length}</span><span class="stat-label">Inactive profiles</span></div>
      </div>

      ${unassigned.length ? `<div class="card pad warn-box">
        <div class="section-h">Users without permissions (${unassigned.length})</div>
        <p class="muted">These users have no permission profile and no group, so they cannot access portals.</p>
        <ul class="diff-list">${unassigned.map(u => `<li>${esc(u.fullName || u.username)} (${u.type}) - <button class="btn ghost sm" data-action="user:edit" data-id="${u.id}">assign</button></li>`).join("")}</ul>
      </div>` : ""}

      ${broad.length && broad[0].s > 0 ? `<div class="card pad">
        <div class="section-h">Broadest profiles (least-privilege review)</div>
        <p class="muted">Highest privilege scores. Review whether full Admin / Read &amp; Write is justified for each.</p>
        <ul class="diff-list">${broad.map(x => `<li><b>${esc(x.p.name)}</b> - score ${x.s} <button class="btn ghost sm" data-action="profile:edit" data-id="${x.p.id}">open</button></li>`).join("")}</ul>
      </div>` : ""}

      <div class="section-h">Findings by profile</div>
      ${profilePanels || `<div class="card pad empty">No profiles yet.</div>`}`;
  }

  // ---------------- Reference view ----------------
  function viewReference() {
    const cats = ["All", ...[...new Set(REF.map(r => r.category))]];
    return `
      <div class="view-head"><div><h2>Documentation Reference</h2><p class="muted">Grounded in the official Fortinet Identity &amp; Access Management (IAM) docs.</p></div></div>
      <div class="ref-toolbar">
        <input id="refQ" class="ref-search" placeholder="Search the IAM docs..." value="${esc(refQ)}">
        <div class="chips">${cats.map(c => `<button class="chip${refCat === c ? " active" : ""}" data-action="ref:cat" data-cat="${esc(c)}">${c}</button>`).join("")}</div>
      </div>
      <div id="refList">${renderRefList()}</div>`;
  }
  function renderRefList() {
    const q = refQ.toLowerCase().trim();
    const list = REF.filter(r => (refCat === "All" || r.category === refCat) &&
      (!q || (r.title + " " + r.body).toLowerCase().includes(q)));
    if (!list.length) return `<div class="card pad empty">No results.</div>`;
    return list.map(r => `
      <div class="card pad ref-card">
        <div class="ref-head">
          <div><b>${esc(r.title)}</b> <span class="badge b-type">${esc(r.category)}</span></div>
          <a class="f-ref" href="${esc(r.source)}" target="_blank" rel="noopener">Source ↗</a>
        </div>
        <pre class="ref-body" data-id="${esc(r.id)}">${esc(r.body)}</pre>
        ${r.body.length > 1400 ? `<button class="btn ghost sm" data-action="ref:toggle" data-id="${esc(r.id)}">Show more</button>` : ""}
      </div>`).join("");
  }
  function bindRefInput() {
    const q = $("#refQ");
    if (q) q.addEventListener("input", () => { refQ = q.value; const list = $("#refList"); if (list) list.innerHTML = renderRefList(); });
  }

  // ---------------- export / import ----------------
  function doExport() {
    const json = M.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "forticloud-iam-planner.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Export downloaded.");
  }
  function openImport() {
    openModal("Import", `<p class="muted">Paste a planner export (JSON), or pick a file. Imported data replaces the current workspace (except the default SysAdmin profile).</p>
      <textarea id="importText" rows="8" placeholder='Paste JSON here...'></textarea>
      <input type="file" id="importFile" accept=".json,application/json" class="file-input">`,
      `<button class="btn ghost" data-action="modal:cancel">Cancel</button>
       <button class="btn primary" data-action="import:do">Import</button>`, true);
    $("#importFile").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      $("#importText").value = await f.text();
    });
  }

  // ---------------- action handling ----------------
  function handleAction(action, el, e) {
    const id = el.dataset.id;
    switch (action) {
      case "nav": currentView = el.dataset.view; render(); break;
      case "modal:close":
        if (el.classList.contains("overlay") && e.target !== el) return;
        closeModal(); render(); break;
      case "modal:cancel": closeModal(); render(); break;
      case "modal:yes": { const fn = window.__confirmYes; window.__confirmYes = null; closeModal(); if (fn) fn(); break; }

      case "profile:new": openProfileEditor(null); break;
      case "profile:edit": closeModal(); openProfileEditor(id); break;
      case "profile:clone": {
        const nid = M.cloneProfile(id);
        toast("Cloned as inactive profile. Configure and enable it.");
        render();
        break;
      }
      case "profile:status": {
        const next = el.dataset.next;
        const r = M.setProfileStatus(id, next);
        if (!r.ok) { toast(r.error, "error"); } else { toast(next === "inactive" ? "Profile disabled." : "Profile enabled."); }
        render(); break;
      }
      case "profile:delete": {
        const p = M.findProfile(id);
        confirmModal("Delete profile", `Delete "<b>${esc(p ? p.name : "")}</b>"? This cannot be undone.`, () => {
          const r = M.deleteProfile(id);
          if (!r.ok) toast(r.error, "error"); else toast("Profile deleted.");
          render();
        }, "Delete", true);
        break;
      }
      case "profile:save": saveProfile(); break;

      case "portal:add": openPortalPicker(); break;
      case "portal:remove": draft.portals = draft.portals.filter(x => x.id !== id); renderPortalCards(); renderFindings(); break;
      case "portal:deny": {
        const pt = draft.portals.find(x => x.id === id);
        const cat = C.findPortal(id);
        if (pt) {
          if (cat && cat.model === "resource") pt.resources = {};
          else { pt.accessEnabled = false; pt.accessType = "none"; }
          renderPortalCards(); renderFindings();
        }
        break;
      }
      case "picker:add": {
        const sel = $("#modalRoot").querySelectorAll(".pp:checked");
        if (!sel.length) return;
        sel.forEach(cb => { if (!draft.portals.some(p => p.id === cb.value)) addPortalToDraft(cb.value, null); });
        closeModal(); renderProfileEditor();
        break;
      }
      case "picker:custom": {
        const name = ($("#customPortalName") || {}).value || "";
        const model = ($("#customPortalModel") || {}).value || "role";
        if (!name.trim()) { toast("Enter a name for the custom portal.", "error"); return; }
        const pid = "custom_" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (!draft.portals.some(p => p.id === pid)) draft.portals.push({ id: pid, name: name.trim(), model, enabled: true, accessEnabled: false, accessType: "read", additional: [], resources: {} });
        renderPortalCards(); renderFindings();
        break;
      }

      case "dir": dirType = el.dataset.type; render(); break;
      case "user:new": openUserEditor(null); break;
      case "user:edit": closeModal(); openUserEditor(id); break;
      case "user:delete": {
        const u = M.getState().users.find(x => x.id === id);
        confirmModal("Delete user", `Delete "<b>${esc(u ? (u.fullName || u.username) : "")}</b>"?`, () => { M.deleteUser(id); render(); toast("User deleted."); }, "Delete", true);
        break;
      }
      case "user:save": saveUser(el); break;
      case "group:new": openGroupEditor(null); break;
      case "group:edit": closeModal(); openGroupEditor(id); break;
      case "group:delete": {
        const g = M.getState().groups.find(x => x.id === id);
        confirmModal("Delete group", `Delete group "<b>${esc(g ? g.name : "")}</b>"? Members are unlinked but not deleted.`, () => { M.deleteGroup(id); render(); toast("Group deleted."); }, "Delete", true);
        break;
      }
      case "group:save": saveGroup(el); break;

      case "compare:set": break; // handled by change
      case "ref:cat": refCat = el.dataset.cat; render(); break;
      case "ref:toggle": {
        const pre = document.querySelector(`pre.ref-body[data-id="${CSS.escape(id)}"]`);
        if (pre) pre.classList.toggle("expanded");
        el.textContent = pre.classList.contains("expanded") ? "Show less" : "Show more";
        break;
      }
      case "export:download": doExport(); break;
      case "export:copy": { navigator.clipboard && navigator.clipboard.writeText(M.exportJson()).then(() => toast("Copied to clipboard."), () => toast("Copy failed.", "error")); break; }
      case "import:open": openImport(); break;
      case "import:do": {
        const text = ($("#importText") || {}).value || "";
        if (!text.trim()) { toast("Paste JSON or choose a file first.", "error"); return; }
        const r = M.importJson(text);
        if (!r.ok) { toast(r.error, "error"); return; }
        closeModal(); render(); toast("Imported " + r.count + " profiles.");
        break;
      }
      case "reset:open": {
        confirmModal("Reset workspace", "Delete ALL profiles, users and groups? The default SysAdmin profile is restored. This cannot be undone.", () => { M.resetAll(); render(); toast("Workspace reset."); }, "Reset", true);
        break;
      }
    }
  }

  function saveProfile() {
    if (!draft.name.trim()) { toast("Enter a profile name.", "error"); return; }
    if (draft.id === C.SYSADMIN.id) { toast("SysAdmin cannot be edited.", "error"); return; }
    const payload = {
      name: draft.name.trim(), type: draft.type, status: draft.status,
      description: draft.description, portals: draft.portals.map(pt => JSON.parse(JSON.stringify(pt)))
    };
    if (editingId) { M.updateProfile(editingId, payload); toast("Profile updated - applies to all assigned users."); }
    else { M.addProfile(payload); toast("Profile created. Assign it to users or groups."); }
    closeModal(); render();
  }
  function saveUser(el) {
    const id = el.dataset.id;
    const u = {
      username: ($("#fUsername") || {}).value || "", fullName: ($("#fFullName") || {}).value || "",
      email: ($("#fEmail") || {}).value || "", type: ($("#fType") || {}).value || "iam",
      status: ($("#fStatus") || {}).value || "active", twoFA: ($("#f2fa") || {}).value || "enforced",
      scope: ($("#fScope") || {}).value || "Root", groupId: ($("#fGroup") || {}).value || null,
      profileId: ($("#fProfile") || {}).value || null, notes: ($("#fNotes") || {}).value || ""
    };
    if (!u.fullName && !u.username) { toast("Enter a username or full name.", "error"); return; }
    const r = id ? M.updateUser(id, u) : (M.addUser(u), { ok: true });
    if (!r.ok) { toast(r.error, "error"); return; }
    closeModal(); render(); toast(id ? "User updated." : "User added.");
  }
  function saveGroup(el) {
    const id = el.dataset.id;
    const g = {
      name: ($("#fGName") || {}).value || "", status: ($("#fGStatus") || {}).value || "active",
      scope: ($("#fGScope") || {}).value || "Root", profileId: ($("#fGProfile") || {}).value || null,
      description: ($("#fGDesc") || {}).value || ""
    };
    if (!g.name.trim()) { toast("Enter a group name.", "error"); return; }
    if (id) M.updateGroup(id, g); else M.addGroup(g);
    closeModal(); render(); toast(id ? "Group updated." : "Group created.");
  }

  function handleChange(el) {
    const action = el.dataset.action;
    if (action === "res:set") {
      const pt = draft.portals.find(x => x.id === el.dataset.portal);
      if (pt) { pt.resources = pt.resources || {}; pt.resources[el.dataset.res] = el.value; updatePortalCard(pt); renderFindings(); }
    } else if (action === "res:setall") {
      if (!el.value) return;
      const pt = draft.portals.find(x => x.id === el.dataset.portal);
      const cat = C.findPortal(el.dataset.portal);
      if (pt) {
        pt.resources = pt.resources || {};
        for (const r of (cat ? cat.resources : [])) {
          if (r.levels.includes(el.value)) pt.resources[r.id] = el.value;
          else pt.resources[r.id] = r.levels[r.levels.length - 1];
        }
        updatePortalCard(pt); renderFindings();
      }
    } else if (action === "role:enable") {
      const pt = draft.portals.find(x => x.id === el.dataset.id);
      if (pt) {
        pt.accessEnabled = el.checked;
        if (el.checked && (!pt.accessType || pt.accessType === "none")) pt.accessType = "read";
        renderPortalCards(); renderFindings();
      }
    } else if (action === "role:type") {
      const pt = draft.portals.find(x => x.id === el.dataset.id);
      if (pt) { pt.accessType = el.value; updatePortalCard(pt); renderFindings(); }
    } else if (action === "compare:set") {
      cmp[el.dataset.side] = el.value || null;
      render();
    }
  }

  // ---------------- boot ----------------
  function bind() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      handleAction(el.dataset.action, el, e);
    });
    document.addEventListener("change", (e) => {
      if (e.target.dataset && e.target.dataset.action) handleChange(e.target);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#modalRoot").classList.contains("open")) { closeModal(); render(); }
    });
  }

  async function boot() {
    bind();
    const { persistent } = await M.init();
    const dot = $("#persistDot");
    if (dot) {
      dot.title = persistent ? "Saved to your browser (kv-plugin)" : "In-memory only (storage unavailable)";
      dot.classList.toggle("on", persistent);
    }
    const resetBtn = document.createElement("button");
    resetBtn.className = "nav-tab reset-btn";
    resetBtn.dataset.action = "reset:open";
    resetBtn.textContent = "Reset";
    $("#nav").appendChild(resetBtn);
    M.subscribe(() => { if (!$("#modalRoot").classList.contains("open")) render(); });
    render();
  }

  return { boot, render };
})();

if (document.readyState !== "loading") { window.IAMApp.boot(); }
else document.addEventListener("DOMContentLoaded", () => window.IAMApp.boot());
