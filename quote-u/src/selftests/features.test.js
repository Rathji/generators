(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const F = window.QU_FEATURES;
  const C = window.QU_CONNECTORS;
  if (!T || !QS || !F || !C) return;

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeStore() {
    return QS.create({ ns: "feat" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  T.register("features: the config defaults every write feature on and data mode live, and the pure guard enforces mock/lockdown/kill-switch/flags", () => {
    const bad = [];
    const base = F.normalizeConfig(null);
    if (base.data_mode !== "live") bad.push("default data_mode: " + base.data_mode);
    if (base.kill_switch !== false) bad.push("default kill_switch");
    if (base.require_internal_review !== false) bad.push("default require_internal_review");
    F.FEATURE_KEYS.forEach(k => { if (base.write_flags[k] !== true) bad.push("feature should default on: " + k); });

    const flag = F.normalizeConfig({ write_flags: { invoice_psa: false } });
    if (flag.write_flags.invoice_psa !== false) bad.push("write_flags override ignored");
    if (flag.write_flags.invoice_direct !== true) bad.push("a single override should not clear the others");
    const inv = F.normalizeConfig({ disabled_features: ["email_send"] });
    if (inv.write_flags.email_send !== false) bad.push("disabled_features ignored");
    if (F.normalizeConfig({ data_mode: "bogus" }).data_mode !== "live") bad.push("an unknown data mode should fall back to live");

    const mockLive = F.guardCall({ data_mode: "mock" }, { connector: "psa", fn: "updateOpportunity", live: true });
    if (mockLive.ok || mockLive.code !== "mock_mode_live_blocked" || mockLive.policy !== true) bad.push("mock should block live: " + JSON.stringify(mockLive));
    const mockNonLive = F.guardCall({ data_mode: "mock" }, { connector: "psa", fn: "updateOpportunity", live: false });
    if (!mockNonLive.ok) bad.push("mock should allow a (non-live) mock adapter: " + JSON.stringify(mockNonLive));
    const lockWrite = F.guardCall({ data_mode: "lockdown" }, { connector: "psa", fn: "updateOpportunity" });
    if (lockWrite.ok || lockWrite.code !== "lockdown") bad.push("lockdown should block a write: " + JSON.stringify(lockWrite));
    const lockRead = F.guardCall({ data_mode: "lockdown" }, { connector: "psa", fn: "getCompany" });
    if (!lockRead.ok) bad.push("lockdown must not block a read: " + JSON.stringify(lockRead));
    const killWrite = F.guardCall({ kill_switch: true }, { connector: "accounting", fn: "createInvoice" });
    if (killWrite.ok || killWrite.code !== "kill_switch") bad.push("kill switch should block a write: " + JSON.stringify(killWrite));
    const killRead = F.guardCall({ kill_switch: true }, { connector: "accounting", fn: "invoiceCount" });
    if (!killRead.ok) bad.push("kill switch must not block a read: " + JSON.stringify(killRead));
    const flagOff = F.guardCall({ write_flags: { invoice_psa: false } }, { connector: "psa", fn: "requestInvoice" });
    if (flagOff.ok || flagOff.code !== "feature_disabled") bad.push("a disabled feature should refuse: " + JSON.stringify(flagOff));
    const unknown = F.guardCall({ kill_switch: true }, { connector: "psa", fn: "mysteryWrite" });
    if (unknown.ok || unknown.code !== "kill_switch") bad.push("an unknown function must fail closed as a write: " + JSON.stringify(unknown));
    if (!F.isPolicyRefusal("kill_switch") || F.isPolicyRefusal("connector_error")) bad.push("isPolicyRefusal misclassifies");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "defaults are all-on/live; mock blocks live calls, lockdown blocks writes (not reads), the kill switch blocks writes, disabled flags refuse, and an unknown function fails closed" };
  });

  T.register("features: the wrapped gateway blocks a write at the boundary while reads pass, logs the refusal, and the send gate enforces internal review", async () => {
    const bad = [];
    const base = C.createDefault();
    const killed = F.wrapGateway(base, { kill_switch: true });
    const op = killed.call("psa", "updateOpportunity", { id: "op1", stage: "won", idempotency_key: "k1" }, { scope: "*" });
    if (op.ok || op.code !== "kill_switch" || op.policy !== true) bad.push("the wrapper should refuse the write: " + JSON.stringify(op));
    if (killed.blockedLog().length !== 1 || killed.blockedLog()[0].connector !== "psa") bad.push("the refusal should be logged: " + JSON.stringify(killed.blockedLog()));
    if (killed.callLog().length !== 0) bad.push("a blocked call must not reach the real gateway: " + killed.callLog().length);
    const read = killed.call("psa", "getCompany", { id: "c1" }, { scope: "*" });
    if (!read.ok || !read.result) bad.push("a read should pass through: " + JSON.stringify(read));
    killed.clearBlockedLog();
    if (killed.blockedLog().length !== 0) bad.push("clearBlockedLog did not clear");

    const flagged = F.wrapGateway(base, { write_flags: { invoice_psa: false } });
    const blocked = flagged.call("psa", "requestInvoice", { id: "op1", lines: [{ description: "x", amount_cents: 1 }] }, { scope: "*" });
    if (blocked.ok || blocked.code !== "feature_disabled") bad.push("a disabled feature should be refused: " + JSON.stringify(blocked));
    const allowed = flagged.call("psa", "updateOpportunity", { id: "op1", stage: "won", idempotency_key: "k2" }, { scope: "*" });
    if (!allowed.ok) bad.push("an enabled write should pass: " + JSON.stringify(allowed));

    if (!F.sendGate({}, { version: { state: "draft" } }).ok) bad.push("sends are not gated unless required");
    const gate = F.sendGate({ require_internal_review: true }, { version: { state: "draft" } });
    if (gate.ok || gate.code !== "internal_review_required") bad.push("internal review should block a draft: " + JSON.stringify(gate));
    if (!F.sendGate({ require_internal_review: true }, { version: { state: "internal_review" } }).ok) bad.push("internal review state should pass the gate");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the wrapped gateway refuses a blocked write before it reaches the adapter, passes reads, records the refusal, and the send gate refuses an unreviewed draft" };
  });

  T.register("features: flags, mode and kill switch persist in the feature_flags document and verify", async () => {
    const bad = [];
    const store = makeStore();
    const svc = F.createService({ store, actor: "admin" });
    const ready = await svc.ready();
    if (!ready.ok) return { pass: false, detail: "ready: " + JSON.stringify(ready) };
    if (svc.config().data_mode !== "live") bad.push("initial mode: " + svc.config().data_mode);

    const off = await svc.setFeature("invoice_psa", false);
    if (!off.ok || svc.config().write_flags.invoice_psa !== false) bad.push("setFeature did not persist: " + JSON.stringify(off));
    const unknown = await svc.setFeature("nope", false);
    if (unknown.ok || unknown.code !== "unknown_feature") bad.push("an unknown feature should be refused: " + JSON.stringify(unknown));
    const mode = await svc.setMode("lockdown");
    if (!mode.ok || svc.config().data_mode !== "lockdown") bad.push("setMode did not persist: " + JSON.stringify(mode));
    const badMode = await svc.setMode("sideways");
    if (badMode.ok || badMode.code !== "bad_mode") bad.push("an unknown mode should be refused: " + JSON.stringify(badMode));
    const kill = await svc.setKillSwitch(true);
    if (!kill.ok || svc.config().kill_switch !== true) bad.push("setKillSwitch did not persist: " + JSON.stringify(kill));

    const g = svc.guard({ connector: "psa", fn: "requestInvoice" });
    if (g.ok || g.code !== "lockdown") bad.push("the live config should refuse writes in lockdown: " + JSON.stringify(g));

    const v = await svc.verify();
    if (!v.ok) bad.push("verify: " + JSON.stringify(v.violations));

    // A second service on the same store reads the persisted config back.
    const svc2 = F.createService({ store });
    const r2 = await svc2.ready();
    if (!r2.ok) bad.push("second ready: " + JSON.stringify(r2));
    else {
      if (svc2.config().data_mode !== "lockdown") bad.push("persisted mode: " + svc2.config().data_mode);
      if (svc2.config().kill_switch !== true) bad.push("persisted kill switch");
      if (svc2.config().write_flags.invoice_psa !== false) bad.push("persisted feature flag");
    }
    const doc = await store.loadDoc("feature_flags");
    if (!doc.ok || !doc.content || !doc.content.config) bad.push("feature_flags document not stored: " + JSON.stringify(doc && doc.code));
    else if (doc.content.config.data_mode !== "lockdown") bad.push("stored config mode mismatch");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "per-feature flags, the data mode and the kill switch persist in the feature_flags document, a fresh service reads them back, and verify passes" };
  });
})();
