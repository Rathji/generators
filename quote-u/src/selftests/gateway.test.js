(function () {
  const T = window.QU_SELFTEST;
  const C = window.QU_CONNECTORS;
  if (!T || !C) return;

  T.register("gateway: the manifest is an allowlist (an undeclared function is refused), carries key names and roles, and verify proves the declarations", () => {
    const bad = [];
    const connector = {
      name: "c1", readOnly: true,
      functions: {
        read() { return { v: "read" }; },
        write() { return { v: "write" }; },
        hidden() { return { v: "hidden" }; }
      }
    };
    const manifest = {
      c1: {
        label: "Connector One", kind: "mixed", gateway_key: "c1_key", roles: ["owner", "manager"],
        functions: { read: { effect: "read" }, write: { effect: "write" } }
      }
    };
    const gw = C.createGateway({ connectors: { c1: connector }, manifest });

    const allowed = gw.allowedFunctions("c1").sort().join(",");
    if (allowed !== "read,write") bad.push("allowlist: " + allowed);
    const rd = gw.call("c1", "read", {}, { scope: "*" });
    if (!rd.ok || rd.result.v !== "read") bad.push("declared read should pass: " + JSON.stringify(rd));
    const hid = gw.call("c1", "hidden", {}, { scope: "*" });
    if (hid.ok || hid.code !== "function_not_allowed") bad.push("an undeclared function must be refused: " + JSON.stringify(hid));

    const m = gw.manifest().find(x => x.name === "c1");
    if (!m) bad.push("manifest should list c1");
    else {
      if (m.gateway_key !== "c1_key") bad.push("gateway key name: " + m.gateway_key);
      if (!Array.isArray(m.roles) || m.roles.join(",") !== "owner,manager") bad.push("roles: " + JSON.stringify(m.roles));
      if (m.enabled !== true) bad.push("should start enabled");
      if ((m.functions || []).length !== 2) bad.push("manifest function count: " + (m.functions || []).length);
    }
    const v = gw.verify();
    if (!v.ok) bad.push("verify should pass: " + JSON.stringify(v.violations));
    if (gw.effectOf("c1", "read") !== "read" || gw.effectOf("c1", "write") !== "write") bad.push("effectOf mismatch");

    // The log records the key NAME, never a secret value.
    const entry = gw.callLog().find(e => e.fn === "read");
    if (!entry || entry.key !== "c1_key") bad.push("the call log should carry the key name: " + JSON.stringify(entry));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the declared manifest is the allowlist (an undeclared function is refused), the manifest view exposes key names/roles/effects, verify passes, and the log carries the key name only" };
  });

  T.register("gateway: a connector can be disabled individually, a role is denied by effect, and a live credential is resolved by name from the keystore (never held by the app)", async () => {
    const bad = [];
    const connector = {
      name: "c1", readOnly: true,
      functions: { read() { return { v: 1 }; }, write() { return { v: 2 }; } }
    };
    const manifest = { c1: { gateway_key: "c1_key", functions: { read: { effect: "read" }, write: { effect: "write" } } } };

    // Disable individually.
    const gw = C.createGateway({ connectors: { c1: connector }, manifest });
    const dis = gw.disable("c1");
    if (!dis.ok || dis.enabled !== false) bad.push("disable: " + JSON.stringify(dis));
    const blocked = gw.call("c1", "read", {}, { scope: "*" });
    if (blocked.ok || blocked.code !== "connector_disabled" || blocked.policy !== true) bad.push("a disabled connector must refuse: " + JSON.stringify(blocked));
    if (gw.manifest().find(x => x.name === "c1").enabled !== false) bad.push("manifest should show disabled");
    if (!gw.callLog().some(e => e.code === "connector_disabled")) bad.push("the refusal should be logged");
    gw.enable("c1");
    if (!gw.call("c1", "read", {}, { scope: "*" }).ok) bad.push("re-enabled call should pass");

    // Role denial by effect.
    const gw2 = C.createGateway({
      connectors: { c1: connector },
      manifest: { c1: { functions: { read: { effect: "read" }, write: { effect: "write" } } } },
      roles: { viewer: { connectors: ["*"], writes: false } }
    });
    const w = gw2.call("c1", "write", {}, { scope: "*", role: "viewer" });
    if (w.ok || w.code !== "role_denied" || w.policy !== true) bad.push("viewer must not write: " + JSON.stringify(w));
    if (!gw2.call("c1", "read", {}, { scope: "*", role: "viewer" }).ok) bad.push("viewer may read");
    const ghost = gw2.call("c1", "read", {}, { scope: "*", role: "ghost" });
    if (ghost.ok || ghost.code !== "role_denied") bad.push("an unknown role must fail closed: " + JSON.stringify(ghost));

    // Credential indirection.
    let captured = null;
    const live = {
      name: "live", live: true,
      functions: { ping(payload, ctx) { captured = ctx.credential; return { pong: true }; } }
    };
    const gw3 = C.createGateway({
      connectors: { live },
      manifest: { live: { gateway_key: "live_api", functions: { ping: { effect: "read" } } } },
      keystore: null
    });
    const noKey = await gw3.callAsync("live", "ping", {}, { scope: "*" });
    if (noKey.ok || noKey.code !== "credential_unavailable") bad.push("an unresolvable gateway key must refuse a live call: " + JSON.stringify(noKey));
    if (captured) bad.push("the connector must not be reached without its credential");
    const secretRef = "fleet://secret/live-credential";
    gw3.setKeystore({ resolve: n => (n === "live_api" ? { ref: secretRef } : null) });
    const ok = await gw3.callAsync("live", "ping", {}, { scope: "*" });
    if (!ok.ok || !captured) bad.push("with a keystore the live call should pass: " + JSON.stringify(ok));
    else if (captured.key !== "live_api" || captured.ref !== secretRef) bad.push("the connector should receive the resolved credential by name: " + JSON.stringify(captured));
    if (JSON.stringify(gw3.callLog()).indexOf(secretRef) !== -1) bad.push("the credential ref must never appear in the call log");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a connector is disableable and its refusal logged, roles are enforced by effect (unknown roles fail closed), and a live credential is resolved from the keystore by key name and never reaches the app or the log" };
  });

  T.register("gateway: the pure governance helpers classify effects, detect secret-shaped keys, and verify flags a bad declaration", () => {
    const bad = [];
    if (!C.isSecretShaped("sk-live-deadbeef")) bad.push("a sk- value is secret-shaped");
    if (C.isSecretShaped("distributor_a_api")) bad.push("a plain key name is not secret-shaped");
    if (!C.isSecretShaped("AbCdEf0123456789AbCdEf0123456789AbCdEf012345678")) bad.push("a long high-entropy blob is secret-shaped");
    if (C.isSecretShaped("")) bad.push("empty is not secret-shaped");

    const roles = C.normalizeRoles(null);
    if (!roles.owner || !roles.manager || !roles.viewer) bad.push("default roles: " + Object.keys(roles).join(","));
    if (C.roleAllows(roles, "owner", "psa", "write", null) !== true) bad.push("owner may write");
    if (C.roleAllows(roles, "viewer", "psa", "write", null) !== false) bad.push("viewer may not write");
    if (C.roleAllows(roles, "viewer", "psa", "read", null) !== true) bad.push("viewer may read");
    if (C.roleAllows(roles, "viewer", "psa", "read", ["owner", "manager"]) !== false) bad.push("a connector role restriction must deny viewer");
    if (C.deriveEffect("psa", "updateOpportunity") !== "write") bad.push("updateOpportunity should derive write");
    if (C.deriveEffect("psa", "getCompany") !== "read") bad.push("getCompany should derive read");
    if (C.deriveEffect("mystery", "whatever") !== "write") bad.push("an unknown function must fail closed as a write");

    const connector = { name: "c1", functions: { read() { return 1; } } };
    const gw = C.createGateway({
      connectors: { c1: connector },
      manifest: { c1: { gateway_key: "sk-live-oops", functions: { read: { effect: "read" }, missing: { effect: "read" } } } }
    });
    const v = gw.verify();
    if (v.ok) bad.push("verify should fail for a bad declaration");
    else {
      if (!v.violations.some(x => x.code === "secret_shaped_key")) bad.push("should flag a secret-shaped key");
      if (!v.violations.some(x => x.code === "unknown_function")) bad.push("should flag an unknown function");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "effects classify correctly (unknown → write), secret-shaped key values are detected, role restrictions are enforced, and verify flags a secret-shaped key and a function the connector does not expose" };
  });
})();
