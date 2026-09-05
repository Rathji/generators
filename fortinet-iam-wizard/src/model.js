// FortiCloud IAM Planner - state model, persistence, validation, effective access.
// Depends on window.IAMCatalog (src/catalog.js).

window.IAMModel = (() => {
  const C = window.IAMCatalog;

  const state = {
    profiles: [],
    users: [],
    groups: [],
    revision: 0
  };
  const listeners = new Set();
  let kvFolder = null;
  let useLocal = false;
  let loaded = false;
  let saveTimer = null;

  const uid = (prefix) => prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---- persistence ----
  async function init() {
    loaded = false;
    try {
      if (window.root && root.kv) {
        kvFolder = root.kv.iamPlanner;
        const saved = await kvFolder.get("state");
        if (saved && Array.isArray(saved.profiles)) {
          state.profiles = saved.profiles;
          state.users = saved.users || [];
          state.groups = saved.groups || [];
          state.revision = saved.revision || 0;
        }
      }
    } catch (e) {
      kvFolder = null;
    }
    if (!kvFolder) {
      useLocal = true;
      try {
        const raw = localStorage.getItem("fortinet-iam-planner-state");
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && Array.isArray(saved.profiles)) Object.assign(state, saved);
        }
      } catch (e) { /* ignore */ }
    }
    ensureSysAdmin();
    loaded = true;
    emit();
    return { persistent: !useLocal };
  }

  function ensureSysAdmin() {
    if (!state.profiles.some(p => p.id === C.SYSADMIN.id)) {
      state.profiles.unshift(JSON.parse(JSON.stringify(C.SYSADMIN)));
    }
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const payload = JSON.stringify(state);
      if (kvFolder) {
        kvFolder.set("state", JSON.parse(payload)).catch(() => {});
      } else if (useLocal) {
        try { localStorage.setItem("fortinet-iam-planner-state", payload); } catch (e) {}
      }
    }, 120);
  }

  function mutate(fn) {
    fn();
    state.revision++;
    emit();
    persist();
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { const snap = getState(); for (const l of listeners) l(snap); }
  function getState() {
    return {
      profiles: state.profiles.map(clone),
      users: state.users.map(clone),
      groups: state.groups.map(clone),
      revision: state.revision
    };
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---- profiles ----
  function findProfile(id) { return state.profiles.find(p => p.id === id); }

  function addProfile(data) {
    const p = Object.assign({
      id: uid("p"), name: "New Profile", type: "local", status: "active",
      description: "", portals: []
    }, data, { id: data.id || uid("p") });
    state.profiles.push(p);
    mutate(() => {});
    return p.id;
  }

  function updateProfile(id, patch) {
    const p = findProfile(id);
    if (!p || p.builtin) return { ok: false, error: "SysAdmin cannot be edited." };
    Object.assign(p, patch);
    mutate(() => {});
    return { ok: true };
  }

  function cloneProfile(id) {
    const p = findProfile(id);
    if (!p) return null;
    const copy = clone(p);
    copy.id = uid("p");
    copy.builtin = false;
    copy.sysadmin = false;
    copy.name = p.name + " (copy)";
    copy.status = "inactive";
    state.profiles.push(copy);
    mutate(() => {});
    return copy.id;
  }

  function setProfileStatus(id, status) {
    const p = findProfile(id);
    if (!p) return { ok: false, error: "Profile not found." };
    if (p.builtin) return { ok: false, error: C.rule("sysadmin_immutable").text };
    if (status === "inactive") {
      const n = countActiveUsers(id);
      if (n > 0) return { ok: false, error: C.rule("profile_in_use_disable").text + " (" + n + " active user(s) assigned)." };
    }
    p.status = status;
    mutate(() => {});
    return { ok: true };
  }

  function deleteProfile(id) {
    const p = findProfile(id);
    if (!p) return { ok: false, error: "Profile not found." };
    if (p.builtin) return { ok: false, error: C.rule("sysadmin_immutable").text };
    const n = countActiveUsers(id);
    if (n > 0) return { ok: false, error: C.rule("profile_in_use_delete").text + " (" + n + " active user(s) assigned)." };
    state.profiles = state.profiles.filter(x => x.id !== id);
    // unlink users/groups that referenced it
    for (const u of state.users) if (u.profileId === id) u.profileId = null;
    for (const g of state.groups) if (g.profileId === id) g.profileId = null;
    mutate(() => {});
    return { ok: true };
  }

  // ---- users & groups ----
  function addUser(data) {
    const u = Object.assign({
      id: uid("u"), username: "", fullName: "", email: "", type: "iam",
      groupId: null, profileId: null, scope: "Root", status: "active", twoFA: "enforced", notes: ""
    }, data, { id: data.id || uid("u") });
    state.users.push(u);
    mutate(() => {});
    return u.id;
  }

  function updateUser(id, patch) {
    const u = state.users.find(x => x.id === id);
    if (!u) return { ok: false, error: "User not found." };
    // one group rule
    if (patch.groupId && u.groupId !== patch.groupId) {
      const dup = state.users.find(x => x.groupId === patch.groupId && x.id !== id);
      if (dup) return { ok: false, error: C.rule("group_single_membership").text + " '" + dup.fullName || dup.username + "' already belongs to that group." };
    }
    Object.assign(u, patch);
    if (!u.groupId && !u.profileId) u.profileId = u.profileId; // no-op
    mutate(() => {});
    return { ok: true };
  }

  function deleteUser(id) {
    state.users = state.users.filter(x => x.id !== id);
    mutate(() => {});
    return { ok: true };
  }

  function addGroup(data) {
    const g = Object.assign({
      id: uid("g"), name: "New Group", profileId: null, scope: "Root", status: "active", description: ""
    }, data, { id: data.id || uid("g") });
    state.groups.push(g);
    mutate(() => {});
    return g.id;
  }

  function updateGroup(id, patch) {
    const g = state.groups.find(x => x.id === id);
    if (!g) return { ok: false, error: "Group not found." };
    Object.assign(g, patch);
    mutate(() => {});
    return { ok: true };
  }

  function deleteGroup(id) {
    state.groups = state.groups.filter(x => x.id !== id);
    for (const u of state.users) if (u.groupId === id) u.groupId = null;
    mutate(() => {});
    return { ok: true };
  }

  // ---- relationships ----
  function countActiveUsers(profileId) {
    return state.users.filter(u => {
      if (u.status !== "active") return false;
      if (u.profileId === profileId) return true;
      if (u.groupId) {
        const g = state.groups.find(x => x.id === u.groupId);
        if (g && g.profileId === profileId) return true;
      }
      return false;
    }).length;
  }

  function usersForProfile(profileId) {
    return state.users.filter(u => {
      if (u.profileId === profileId) return true;
      if (u.groupId) {
        const g = state.groups.find(x => x.id === u.groupId);
        if (g && g.profileId === profileId) return true;
      }
      return false;
    });
  }

  function groupOf(u) { return u.groupId ? state.groups.find(g => g.id === u.groupId) : null; }

  function profileOf(u) {
    if (u.profileId) return findProfile(u.profileId);
    const g = groupOf(u);
    return g ? findProfile(g.profileId) : null;
  }

  function profileLabel(u) {
    const p = profileOf(u);
    if (p) return p.name;
    const g = groupOf(u);
    if (g) return "(group " + g.name + ": no profile)";
    return "Unassigned";
  }

  function effectiveProfileId(u) {
    if (u.profileId) return u.profileId;
    const g = groupOf(u);
    return g ? g.profileId : null;
  }

  // ---- validation ----
  function validateProfile(p) {
    const findings = [];
    const seen = {};
    const add = (severity, code, text, portalId, resourceId) => {
      const r = C.rule(code);
      findings.push({ severity, code, text: text || r.text, ref: r.ref, portalId, resourceId });
    };

    if (p.id !== C.SYSADMIN.id && p.name.trim().toLowerCase() === "sysadmin") {
      add("warning", "sysadmin_reserved_name", null, null, null);
    }
    if (p.builtin) {
      add("error", "sysadmin_immutable", null, null, null);
      add("info", "sysadmin_coverage", null, null, null);
      return findings;
    }

    if (p.type === "org") add("info", "org_scope_note", null, null, null);
    add("info", "profile_type_immutable", null, null, null);

    const catalogIds = new Set(C.allPortals().map(x => x.id));
    const includedIds = new Set(p.portals.map(x => x.id));

    // undefined portals
    for (const c of C.allPortals()) {
      if (!includedIds.has(c.id)) {
        add("info", "undefined_portal", "Excluded portal: " + c.name + " is undefined (not denied).", c.id, null);
      }
    }

    for (const portal of p.portals) {
      const cat = C.findPortal(portal.id);
      seen[portal.id] = true;
      if (!cat) {
        add("warning", "unknown_portal", "Custom portal '" + (portal.name || portal.id) + "' - verify its access model.", portal.id, null);
        continue;
      }
      if (cat.model === "role") {
        const on = !!portal.accessEnabled;
        const t = portal.accessType;
        if (!on || t === "none") {
          add("info", "deny_role", "Denied: Access is not enabled for " + cat.name + ".", portal.id, null);
        } else if (t === "custom") {
          add("info", "custom_access", "Custom access on " + cat.name + ".", portal.id, null);
        } else if (t === "admin") {
          add("warning", "high_privilege", "Admin (full) access on " + cat.name + " - confirm this is required.", portal.id, null);
        }
      } else { // resource
        const res = portal.resources || {};
        const catRes = cat.resources;
        const any = catRes.some(r => res[r.id] && res[r.id] !== "none");
        if (!any) {
          add("info", "deny_resource", "Denied: no resource access enabled for " + cat.name + ".", portal.id, null);
        }
        const maxLevel = (a, b) => {
          const rank = { none: 0, read: 1, write: 2 };
          return rank[a] >= rank[b] ? a : b;
        };
        let highest = "none";
        for (const r of catRes) {
          const lvl = res[r.id] || "none";
          highest = maxLevel(highest, lvl);
          if (lvl !== "none" && r.note && (r.id === "renewal-notice" || r.id === "advanced-service-requests" || r.id === "incident-response-ticket")) {
            add("info", r.id === "renewal-notice" ? "scope_root_folder" : "forticare_entitlement",
              cat.name + " > " + r.name + ": " + r.note, portal.id, r.id);
          }
        }
        if (highest === "write") {
          add("info", "full_resource", "Full Read & Write across " + cat.name + " resources.", portal.id, null);
        }
      }
    }

    // least-privilege heuristics (guidance, not doc rules)
    const roleAdmins = p.portals.filter(pt => {
      const cat = C.findPortal(pt.id);
      return cat && cat.model === "role" && pt.accessEnabled && pt.accessType === "admin";
    }).length;
    const writeRes = p.portals.filter(pt => {
      const cat = C.findPortal(pt.id);
      if (!cat || cat.model !== "resource") return false;
      const res = pt.resources || {};
      return cat.resources.some(r => res[r.id] === "write");
    }).length;
    if (roleAdmins >= 5) {
      add("warning", "broad_admin", roleAdmins + " portals at Admin level - this approaches account-wide control.", null, null);
    }
    const iamPortal = p.portals.find(pt => pt.id === "iam");
    if (iamPortal) {
      const res = iamPortal.resources || {};
      if (res["credentials"] === "write" && res["user-permissions"] === "write") {
        add("warning", "iam_self_admin", "Read & Write on IAM Credentials + User/Permissions grants the ability to manage accounts and other users - review carefully.", "iam", null);
      }
    }

    return findings;
  }

  // Effective access summary for a profile.
  function effectiveAccess(p) {
    const out = { portals: [], isSysAdmin: !!p.sysadmin };
    for (const portal of p.portals) {
      const cat = C.findPortal(portal.id);
      if (!cat) {
        out.portals.push({ id: portal.id, name: portal.name || portal.id, model: "custom", level: "undefined", detail: "Custom portal" });
        continue;
      }
      if (cat.model === "role") {
        const on = !!portal.accessEnabled;
        const t = portal.accessType;
        out.portals.push({
          id: cat.id, name: cat.name, model: "role",
          level: (!on || t === "none") ? "denied" : (t === "custom" ? "custom" : t),
          detail: (!on || t === "none") ? "No Access" : (t === "custom" ? "Custom access" : accessLabel(t)),
          raw: (!on || t === "none") ? "none" : t
        });
      } else {
        const res = portal.resources || {};
        const rank = { none: 0, read: 1, write: 2 };
        let highest = "none";
        const rows = cat.resources.map(r => {
          const lvl = res[r.id] || "none";
          if (rank[lvl] > rank[highest]) highest = lvl;
          return { id: r.id, name: r.name, level: lvl, note: r.note };
        });
        out.portals.push({
          id: cat.id, name: cat.name, model: "resource",
          level: highest === "none" ? "denied" : highest,
          detail: highest === "none" ? "No Access" : "Highest: " + accessLabel(highest),
          raw: highest === "none" ? "none" : highest,
          resources: rows
        });
      }
    }
    // undefined portals
    const included = new Set(p.portals.map(x => x.id));
    for (const c of C.allPortals()) {
      if (!included.has(c.id)) {
        out.portals.push({ id: c.id, name: c.name, model: c.model, level: "undefined", detail: "Undefined (not denied)", raw: "undefined" });
      }
    }
    return out;
  }

  function accessLabel(l) {
    return { none: "No Access", read: "Read Only", write: "Read & Write", admin: "Admin", custom: "Custom" }[l] || l;
  }

  // ---- audit ----
  function auditAll() {
    const results = state.profiles.map(p => {
      const findings = validateProfile(p);
      const activeUsers = countActiveUsers(p.id);
      return { profile: clone(p), findings, activeUsers };
    });
    const totals = { error: 0, warning: 0, info: 0 };
    for (const r of results) for (const f of r.findings) totals[f.severity] = (totals[f.severity] || 0) + 1;
    return { results, totals };
  }

  // ---- export / import ----
  function exportJson() {
    return JSON.stringify({ app: "forticloud-iam-planner", version: 1, savedAt: new Date().toISOString(), ...getState() }, null, 2);
  }

  function importJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "Invalid JSON." }; }
    if (!Array.isArray(data.profiles) && !data.state) return { ok: false, error: "Not a planner export file." };
    const src = data.state || data;
    if (!Array.isArray(src.profiles)) return { ok: false, error: "Export contains no profiles." };
    mutate(() => {
      state.profiles = (src.profiles || []).map(p => Object.assign({ id: uid("p"), name: "Imported", type: "local", status: "active", description: "", portals: [] }, p, { builtin: false, sysadmin: false }));
      state.users = (src.users || []).map(u => Object.assign({ id: uid("u"), type: "iam", status: "active" }, u));
      state.groups = (src.groups || []).map(g => Object.assign({ id: uid("g"), status: "active" }, g));
      ensureSysAdmin();
    });
    return { ok: true, count: state.profiles.length };
  }

  function resetAll() {
    mutate(() => {
      state.profiles = [];
      state.users = [];
      state.groups = [];
      ensureSysAdmin();
    });
    return { ok: true };
  }

  return {
    init, subscribe, getState,
    addProfile, updateProfile, cloneProfile, setProfileStatus, deleteProfile,
    addUser, updateUser, deleteUser, addGroup, updateGroup, deleteGroup,
    findProfile, countActiveUsers, usersForProfile, groupOf, profileOf, profileLabel, effectiveProfileId,
    validateProfile, effectiveAccess, accessLabel, auditAll,
    exportJson, importJson, resetAll
  };
})();
