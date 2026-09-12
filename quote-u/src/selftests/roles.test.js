(function () {
  const T = window.QU_SELFTEST;
  const R = window.QU_ROLES;
  const QS = window.QU_STORE;
  if (!T || !R) return;

  // ---- the pure matrix -----------------------------------------------------

  T.register("roles: the matrix, the aliases and the separate portal regime", async () => {
    const bad = [];
    if (R.ROLES.join(",") !== "owner,manager,viewer") bad.push("roles = " + R.ROLES.join(","));
    if (R.normalizeRole("ADMIN") !== "owner") bad.push("admin alias");
    if (R.normalizeRole("member") !== "viewer") bad.push("member alias");
    if (R.normalizeRole("nope") !== null) bad.push("unknown role normalized");
    if (!R.can("owner", "manage_policy")) bad.push("owner cannot manage policy");
    if (R.can("manager", "manage_policy")) bad.push("manager can manage policy");
    if (R.can("manager", "manage_members")) bad.push("manager can manage members");
    if (!R.can("manager", "send")) bad.push("manager cannot send");
    if (R.can("manager", "discount")) bad.push("manager can discount below the floor");
    if (!R.can("owner", "discount")) bad.push("owner cannot discount");
    if (!R.can("viewer", "view")) bad.push("viewer cannot view");
    if (R.can("viewer", "edit_draft")) bad.push("viewer can edit");
    if (R.can("viewer", "send")) bad.push("viewer can send");
    if (R.can(null, "view")) bad.push("null role can view");
    // a portal identity is denied every internal action even if it claims owner
    if (R.can({ regime: "portal", role: "owner" }, "edit_draft")) bad.push("portal regime passed an internal check");
    if (!R.canPortal("approve") || !R.canPortal("toggle_options")) bad.push("portal actions wrong");
    if (R.canPortal("edit_draft")) bad.push("portal regime allowed an internal action");
    if (R.capabilities("viewer").join(",") !== "view") bad.push("viewer capabilities = " + R.capabilities("viewer").join(","));
    if (R.capabilities("manager").indexOf("invoice") === -1) bad.push("manager lacks invoice");

    let threw = false;
    try { R.assert({ role: "viewer" }, "revoke"); } catch (e) { threw = e.code === "forbidden"; }
    if (!threw) bad.push("assert did not refuse a viewer revoke");

    // discount authority: manager down to the floor, owner anywhere
    if (!R.canDiscount("owner", -99999, 1500)) bad.push("owner blocked by the floor");
    if (R.canDiscount("manager", 1000, 1500)) bad.push("manager allowed below the floor");
    if (!R.canDiscount("manager", 2000, 1500)) bad.push("manager blocked above the floor");
    if (R.canDiscount("viewer", 9000, 1500)) bad.push("viewer may discount");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "owner ⊃ manager ⊃ viewer; aliases normalize; the portal regime is denied every internal action; the floor splits manager from owner" };
  });

  T.register("roles: writeVerdict refuses a viewer, an un-sent send, a revoke and a below-floor discount", async () => {
    const bad = [];
    const manager = { regime: "internal", role: "manager", write: true, canCreate: true, canSend: true, canRevoke: true, discountFloorBp: 1500, canDiscount: m => m >= 1500 };
    const viewer = { regime: "internal", role: "viewer", write: false, canCreate: false, canSend: false, canRevoke: false, discountFloorBp: 1500, canDiscount: () => false };

    if (R.writeVerdict(manager, "quotes", { records: [{ id: "q1" }] }, null) !== null) bad.push("manager couldn't create a quote");
    let v = R.writeVerdict(viewer, "quotes", { records: [{ id: "q1" }] }, null);
    if (!v || v.code !== "forbidden") bad.push("viewer write allowed: " + JSON.stringify(v));
    v = R.writeVerdict({ regime: "portal", role: "owner", write: true }, "quotes", {}, null);
    if (!v || v.code !== "portal_regime") bad.push("portal regime write allowed: " + JSON.stringify(v));

    // create: a role that may edit but not create is refused on a first insert
    v = R.writeVerdict({ regime: "internal", role: "manager", write: true, canCreate: false, canSend: true, canRevoke: true }, "quotes", { records: [{ id: "q1" }] }, { records: [] });
    if (!v || v.code !== "forbidden") bad.push("create not refused: " + JSON.stringify(v));
    if (R.writeVerdict({ regime: "internal", role: "manager", write: true, canCreate: false, canSend: true, canRevoke: true }, "quotes", { records: [{ id: "q1" }] }, { records: [{ id: "q0" }] }) !== null) bad.push("an edit of an existing quote was refused as a create");

    // send: flipping a draft into a sent/viewed/approved state needs `send`
    const noSend = { regime: "internal", role: "manager", write: true, canCreate: true, canSend: false, canRevoke: true, discountFloorBp: 0 };
    v = R.writeVerdict(noSend, "quote_versions", { records: [{ id: "v1", state: "sent" }] }, { records: [{ id: "v1", state: "draft" }] });
    if (!v || v.code !== "forbidden") bad.push("send not refused: " + JSON.stringify(v));
    if (R.writeVerdict(manager, "quote_versions", { records: [{ id: "v1", state: "sent" }] }, { records: [{ id: "v1", state: "draft" }] }) !== null) bad.push("a manager's send was refused");
    if (R.writeVerdict(noSend, "quote_versions", { records: [{ id: "v1", state: "approved" }] }, { records: [{ id: "v1", state: "viewed" }] }) !== null) bad.push("an already-sent version couldn't advance its state");

    // revoke: clearing revoked_at to a timestamp needs `revoke`
    const noRevoke = { regime: "internal", role: "manager", write: true, canCreate: true, canSend: true, canRevoke: false, discountFloorBp: 0 };
    v = R.writeVerdict(noRevoke, "portal_tokens", { records: [{ id: "t1", revoked_at: "2026-05-01T00:00:00Z" }] }, { records: [{ id: "t1", revoked_at: null }] });
    if (!v || v.code !== "forbidden") bad.push("revoke not refused: " + JSON.stringify(v));
    if (R.writeVerdict(manager, "portal_tokens", { records: [{ id: "t1", revoked_at: "2026-05-01T00:00:00Z" }] }, { records: [{ id: "t1", revoked_at: null }] }) !== null) bad.push("a manager's revoke was refused");

    // discount floor: a manager below the floor is refused, an owner is not
    const line = { id: "l1", description: "Firewall", quantity: 1, unit_cost_cents: 100000, unit_sell_cents: 110000 };
    v = R.writeVerdict(manager, "line_items", { records: [line] }, null);
    if (!v || v.code !== "discount_floor") bad.push("below-floor discount allowed: " + JSON.stringify(v));
    const good = Object.assign({}, line, { unit_sell_cents: 200000 });
    if (R.writeVerdict(manager, "line_items", { records: [good] }, null) !== null) bad.push("a healthy margin was refused");
    if (R.writeVerdict(Object.assign({}, manager, { role: "owner", canDiscount: () => false }), "line_items", { records: [line] }, null) !== null) bad.push("the owner was blocked by the floor");

    // the floor governs only RE-PRICED lines: an untouched legacy below-floor line
    // must not block an unrelated edit, and a description-only change is not a discount
    const legacy = { id: "l1", description: "Legacy", quantity: 1, unit_cost_cents: 100000, unit_sell_cents: 110000 };
    const descOnly = Object.assign({}, legacy, { description: "Legacy (renamed)" });
    if (R.writeVerdict(manager, "line_items", { records: [descOnly] }, { records: [legacy] }) !== null) bad.push("a description-only edit of a legacy below-floor line was refused");
    const healthy = { id: "l2", description: "New", quantity: 1, unit_cost_cents: 100000, unit_sell_cents: 200000 };
    if (R.writeVerdict(manager, "line_items", { records: [legacy, healthy] }, { records: [legacy] }) !== null) bad.push("an unrelated change was refused because an unchanged line sits below the floor");
    v = R.writeVerdict(manager, "line_items", { records: [Object.assign({}, legacy, { unit_sell_cents: 105000 })] }, { records: [legacy] });
    if (!v || v.code !== "discount_floor") bad.push("a re-priced below-floor line was allowed: " + JSON.stringify(v));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "viewer/portal refused; create, send, revoke and the discount floor each gate their transition; the owner is never blocked" };
  });

  T.register("roles: identity resolution, per-member scope and the gateway injection", async () => {
    const bad = [];
    const policy = {
      default_role: "owner",
      discount_floor_bp: 1500,
      members: [
        { name: "Dana", role: "manager", scope: ["c1"] },
        { name: "Vic", role: "viewer" }
      ]
    };
    const pol = R.normalizePolicy(policy);
    if (pol.default_role !== "owner") bad.push("default role");
    if (pol.discount_floor_bp !== 1500) bad.push("floor");
    if (pol.members.length !== 2) bad.push("members");
    if (R.normalizePolicy({ default_role: "administrator", discount_floor_bp: -5 }).default_role !== "owner") bad.push("admin alias / negative floor");

    const unknown = R.resolveIdentity(policy, { name: "Nobody" }, "*");
    if (unknown.role !== "owner") bad.push("unknown caller not defaulted to owner");
    const dana = R.resolveIdentity(policy, { name: "dana", source: "hub" }, "*");
    if (dana.role !== "manager" || dana.source !== "hub") bad.push("member match = " + JSON.stringify(dana));
    if (dana.scope.join(",") !== "c1") bad.push("member scope = " + dana.scope.join(","));
    if (!R.scopeAllows(["c1"], "c1") || R.scopeAllows(["c1"], "c2")) bad.push("scopeAllows is wrong");
    if (!R.scopeAllows(["*"], "anything")) bad.push("wildcard scope refused");

    // build a service, set the hub identity, and prove the gateway gets the
    // AUTHENTICATED role — a caller cannot pass its own role through.
    const svc = R.createService({ policy: policy, scope: "*" });
    svc.setIdentity({ name: "Vic", role: "viewer", source: "hub" });
    if (svc.current().role !== "viewer") bad.push("viewer identity not applied");
    if (svc.can("edit_draft")) bad.push("viewer may edit");
    const calls = [];
    const fakeGateway = {
      connectors: {},
      call: (name, fn, payload, ctx) => { calls.push({ name, fn, ctx }); return { ok: true }; },
      callAsync: async () => ({ ok: true }),
      has: () => true, list: () => [], allowedFunctions: () => [], callLog: () => [], clearLog: () => {},
      manifest: () => [], isEnabled: () => true, setEnabled: () => ({}), enable: () => ({}), disable: () => ({}),
      roles: () => ({}), assignRole: () => ({}), defaultRole: () => "owner", verify: () => ({ ok: true, violations: [] })
    };
    const wrapped = svc.wrapGateway(fakeGateway);
    wrapped.call("psa", "getOpportunity", { id: "op1" }, { role: "owner", scope: "*" });
    if (calls.length !== 1) bad.push("gateway call not forwarded");
    else if (calls[0].ctx.role !== "viewer") bad.push("the caller's own role leaked into the gateway ctx: " + calls[0].ctx.role);
    if (calls[0].ctx.scope.join(",") !== "*") bad.push("scope not injected");

    // the store guard routine built from the same identity refuses a viewer write
    const g = svc.guard("catalog_items", { records: [{ id: "x" }] }, null);
    if (!g || g.code !== "forbidden") bad.push("service guard let a viewer write: " + JSON.stringify(g));

    // signing out of an ENABLED hub falls back to LEAST privilege (viewer), never
    // the policy's owner default; genuinely local-only use keeps the default.
    const cleared = svc.clearIdentity({ hubConfigured: true });
    if (cleared.role !== "viewer" || cleared.source !== "local") bad.push("signed-out hub identity = " + JSON.stringify(cleared));
    if (svc.can("edit_draft")) bad.push("a signed-out hub client may edit");
    const local = svc.clearIdentity();
    if (local.role !== "owner") bad.push("local-only clearIdentity should keep the policy default: " + JSON.stringify(local));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "unknown callers default to owner, policy members pin role+scope, the gateway receives the authenticated role, and signing out of a live hub drops to viewer" };
  });

  if (!QS) return;

  function makeKv(map) {
    return { get: async k => map.get(k), set: async (k, v) => { map.set(k, v); }, delete: async k => { map.delete(k); } };
  }
  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) { f = { text, key: "ek." + name, count: 0 }; files.set(name, f); f.count = 1; return { error: null, editKey: f.key, editCount: 1, created: true }; }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text; f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  T.register("roles: the matrix is enforced at the storage layer, not only in the UI", async () => {
    const bad = [];
    const store = QS.create({ ns: "roles" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    await store.ready();
    const svc = R.createService({ store: store, policy: { default_role: "owner", discount_floor_bp: 1500, members: [] }, scope: "*" });
    svc.registerGuards(store);

    async function saveAs(module, content) {
      const d = await store.loadDoc(module);
      const base = (d && d.ok && typeof d.revision === "number") ? d.revision : 0;
      return store.saveChecked(module, content, { expectedBase: base });
    }

    // owner: everything is allowed
    const ownerCreate = await saveAs("quotes", { records: [{ id: "q1", title: "A" }] });
    if (!ownerCreate.ok) bad.push("owner could not create a quote: " + JSON.stringify(ownerCreate));

    // viewer: every write is refused at the store boundary
    svc.setIdentity({ name: "Vic", role: "viewer", source: "hub" });
    const viewerWrite = await saveAs("catalog_items", { records: [{ id: "cat1" }] });
    if (viewerWrite.ok !== false || viewerWrite.code !== "forbidden") bad.push("viewer write was not refused by the store guard: " + JSON.stringify(viewerWrite));
    // the low-level saveDoc path runs the same guards (it cannot bypass them)
    const viewerSaveDoc = await store.saveDoc("catalog_items", { records: [{ id: "cat2" }] });
    if (viewerSaveDoc.ok !== false || viewerSaveDoc.code !== "forbidden") bad.push("saveDoc bypassed the viewer guard: " + JSON.stringify(viewerSaveDoc));

    // manager: a below-floor line is refused, a healthy one is allowed
    svc.setIdentity({ name: "Dana", role: "manager", source: "hub" });
    const below = await saveAs("line_items", { records: [{ id: "l1", description: "Firewall", quantity: 1, unit_cost_cents: 100000, unit_sell_cents: 110000 }] });
    if (below.ok !== false || below.code !== "discount_floor") bad.push("below-floor discount was not refused: " + JSON.stringify(below));
    const above = await saveAs("line_items", { records: [{ id: "l2", description: "Firewall", quantity: 1, unit_cost_cents: 100000, unit_sell_cents: 200000 }] });
    if (!above.ok) bad.push("a healthy margin was refused at the store: " + JSON.stringify(above));

    // owner: the same deep discount is fine
    svc.setIdentity({ name: "Owe", role: "owner", source: "hub" });
    const ownerDiscount = await saveAs("line_items", { records: [{ id: "l3", description: "Firewall", quantity: 1, unit_cost_cents: 100000, unit_sell_cents: 110000 }] });
    if (!ownerDiscount.ok) bad.push("owner discount was refused at the store: " + JSON.stringify(ownerDiscount));

    const v = svc.verify();
    if (!v.ok) bad.push("role service verify failed: " + JSON.stringify(v.violations));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the installed store guard refuses a viewer write and a manager's below-floor discount, and lets an owner's through" };
  });
})();
