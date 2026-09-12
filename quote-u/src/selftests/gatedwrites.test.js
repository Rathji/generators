(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const C = window.QU_CONNECTORS;
  const G = window.QU_GATED;
  if (!T || !QS || !C || !G) return;

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
    return QS.create({ ns: "gated" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function makeGateway(counter) {
    return C.createGateway({
      connectors: {
        svc: {
          name: "svc",
          functions: {
            getThing() { return { thing: 1 }; },
            updateOpportunity(p) { counter.n++; return { id: p.id, write_count: counter.n }; },
            writeNote(p) { counter.n++; return { id: p.id, note_id: "n1" }; }
          }
        }
      },
      manifest: { svc: { functions: { getThing: { effect: "read" }, updateOpportunity: { effect: "write" }, writeNote: { effect: "write" } } } }
    });
  }

  T.register("gated: the pure policy approves nothing by default, refuses an unapproved write, and requires an explicit confirmation from a named actor", () => {
    const bad = [];
    const pol = G.normalizePolicy({ functions: { "psa.updateOpportunity": { approved: true, approved_by: "reviewer", note: "ok" } } });
    if (!G.isApproved(pol, "psa.updateOpportunity")) bad.push("approved key should be approved");
    if (G.isApproved(pol, "psa.writeNote")) bad.push("an unlisted key must NOT be approved");
    const base = G.normalizePolicy(null);
    if (base.require_confirmation !== true) bad.push("confirmation should default on");
    if (Object.keys(base.functions).length !== 0) bad.push("the default policy approves nothing");

    const notApproved = G.checkWrite(pol, "psa.writeNote", { confirm: { by: "alice" } });
    if (notApproved.ok || notApproved.code !== "write_not_approved" || notApproved.policy !== true) bad.push("unapproved write: " + JSON.stringify(notApproved));
    const noConfirm = G.checkWrite(pol, "psa.updateOpportunity", {});
    if (noConfirm.ok || noConfirm.code !== "confirmation_required" || noConfirm.policy !== true) bad.push("missing confirmation: " + JSON.stringify(noConfirm));
    const bare = G.checkWrite(pol, "psa.updateOpportunity", { confirm: true });
    if (bare.ok || bare.code !== "confirmation_required") bad.push("a bare true is not a confirmation: " + JSON.stringify(bare));
    const ok = G.checkWrite(pol, "psa.updateOpportunity", { confirm: { by: "alice", note: "won" } });
    if (!ok.ok || ok.confirmation.by !== "alice") bad.push("approved + confirmed: " + JSON.stringify(ok));
    const relaxed = G.checkWrite({ require_confirmation: false, functions: { "x.y": { approved: true } } }, "x.y", {});
    if (!relaxed.ok) bad.push("confirmation disabled should allow: " + JSON.stringify(relaxed));
    const badKey = G.checkWrite(pol, "not a key", {});
    if (badKey.ok || badKey.code !== "bad_function_key") bad.push("bad key: " + JSON.stringify(badKey));

    if (G.confirmationOf({ confirm: { by: " " } }) !== null) bad.push("a blank actor is not a confirmation");
    if (G.confirmationOf({ confirm: true }) !== null) bad.push("a boolean is not a confirmation");
    if (!G.confirmationOf({ confirm: { by: "bob" } })) bad.push("a named confirmation should parse");
    if (G.functionKey("psa", "x") !== "psa.x") bad.push("functionKey");
    if (G.parseKey("psa.x").connector !== "psa" || G.parseKey("psa.x").fn !== "x") bad.push("parseKey");
    if (G.ACTION_FUNCTION.opp_update !== "psa.updateOpportunity") bad.push("action map");
    if (!G.isRefusal("write_not_approved") || !G.isRefusal("confirmation_required") || G.isRefusal("connector_error")) bad.push("isRefusal");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the policy approves nothing until a function is listed, an unapproved write is refused policy:true, and an approved write still needs a named confirmation (a bare true or blank actor does not count)" };
  });

  T.register("gated: the gate wrapper lets reads through, refuses an unapproved write without reaching the connector, and performs an approved+confirmed write with a ledger record", () => {
    const bad = [];
    const counter = { n: 0 };
    const gw = makeGateway(counter);
    const gate = G.createService({ gateway: gw, policy: { functions: { "svc.updateOpportunity": { approved: true, approved_by: "reviewer" } } }, actor: "tester" });
    const wrapped = gate.wrap(gw);

    const read = wrapped.call("svc", "getThing", {}, { scope: "*" });
    if (!read.ok || read.result.thing !== 1) bad.push("a read should pass straight through: " + JSON.stringify(read));
    if (counter.n !== 0) bad.push("a read must not touch the connector's write");

    const unapproved = wrapped.call("svc", "writeNote", { id: "o1" }, { scope: "*" });
    if (unapproved.ok || unapproved.code !== "write_not_approved" || unapproved.policy !== true) bad.push("unapproved write: " + JSON.stringify(unapproved));
    if (counter.n !== 0) bad.push("a refused write must NOT reach the connector");

    const noConfirm = wrapped.call("svc", "updateOpportunity", { id: "o1" }, { scope: "*" });
    if (noConfirm.ok || noConfirm.code !== "confirmation_required") bad.push("unconfirmed write: " + JSON.stringify(noConfirm));
    if (counter.n !== 0) bad.push("an unconfirmed write must NOT reach the connector");

    const performed = wrapped.call("svc", "updateOpportunity", { id: "o1" }, { scope: "*", confirm: { by: "alice", note: "won" } });
    if (!performed.ok || counter.n !== 1) bad.push("approved + confirmed write should perform once: " + JSON.stringify(performed));

    const led = gate.ledger();
    if (led.length !== 3) bad.push("ledger should record all three write attempts: " + led.length);
    if (!led.some(r => r.decision === "refused" && r.code === "write_not_approved")) bad.push("refusal not in ledger");
    const done = led.find(r => r.decision === "performed");
    if (!done || done.key !== "svc.updateOpportunity" || done.by !== "alice") bad.push("performed ledger record: " + JSON.stringify(done));
    if (gate.ledger({ decision: "refused" }).length !== 2) bad.push("refusal filter");

    const declared = gate.declaredWrites();
    if (declared.length !== 2) bad.push("declaredWrites should list the two write functions: " + declared.length);
    const pend = gate.pending().map(w => w.key);
    if (pend.join(",") !== "svc.writeNote") bad.push("pending should be the unapproved write: " + pend);
    if (!gate.verify().ok) bad.push("verify should pass: " + JSON.stringify(gate.verify().violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "reads pass unchecked, an unapproved write is refused before the connector is touched, an approved-but-unconfirmed write is refused, and an approved+confirmed write performs once and appears in the ledger with its actor" };
  });

  T.register("gated: the approval policy and the ledger persist in documents, a fresh service reads them back, and revoking blocks the write", async () => {
    const bad = [];
    const counter = { n: 0 };
    const gw = makeGateway(counter);
    const store = makeStore();
    const svc = G.createService({ store, gateway: gw, policy: { functions: {} }, actor: "tester" });
    const ready = await svc.ready();
    if (!ready.ok) return { pass: false, detail: "ready: " + JSON.stringify(ready) };
    if (svc.isApproved("svc.updateOpportunity")) bad.push("nothing should be approved at boot");
    if (svc.requireConfirmation() !== true) bad.push("confirmation should default on");

    const appr = await svc.approve("svc.updateOpportunity", { by: "reviewer", note: "reviewed" });
    if (!appr.ok || !svc.isApproved("svc.updateOpportunity")) bad.push("approve did not persist: " + JSON.stringify(appr));
    const wrapped = svc.wrap(gw);
    const res = wrapped.call("svc", "updateOpportunity", { id: "o1" }, { scope: "*", confirm: { by: "alice" } });
    if (!res.ok || counter.n !== 1) bad.push("write after approve: " + JSON.stringify(res));
    await svc.flush();

    const svc2 = G.createService({ store, gateway: gw, policy: { functions: {} } });
    const r2 = await svc2.ready();
    if (!r2.ok) bad.push("second ready: " + JSON.stringify(r2));
    if (!svc2.isApproved("svc.updateOpportunity")) bad.push("the approved policy should persist");
    if (svc2.requireConfirmation() !== true) bad.push("the confirmation requirement should persist");
    if (!svc2.ledger().some(r => r.decision === "performed" && r.key === "svc.updateOpportunity" && r.by === "alice")) bad.push("the ledger should persist the performed write");

    const rev = await svc2.revoke("svc.updateOpportunity", { by: "reviewer" });
    if (!rev.ok || svc2.isApproved("svc.updateOpportunity")) bad.push("revoke did not take: " + JSON.stringify(rev));
    const after = svc2.wrap(gw).call("svc", "updateOpportunity", { id: "o2" }, { scope: "*", confirm: { by: "alice" } });
    if (after.ok || after.code !== "write_not_approved") bad.push("a revoked write must be refused: " + JSON.stringify(after));
    if (counter.n !== 1) bad.push("the revoked write must not reach the connector");

    const v = svc2.verify();
    if (!v.ok) bad.push("verify: " + JSON.stringify(v.violations));
    if (v.pending.indexOf("svc.updateOpportunity") === -1) bad.push("a revoked write should be pending: " + JSON.stringify(v.pending));

    const doc = await store.loadDoc("gated_writes");
    if (!doc.ok || !doc.content || !Array.isArray(doc.content.records)) bad.push("gated_writes document missing: " + JSON.stringify(doc && doc.code));
    const pol = await store.loadDoc("write_policy");
    if (!pol.ok || !pol.content || !pol.content.config) bad.push("write_policy document missing");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approvals and the ledger persist in the write_policy / gated_writes documents, a fresh service reads them back, a revoked write is refused and never reaches the connector, and verify tracks the pending write" };
  });
})();
