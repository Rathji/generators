(function () {
  const T = window.QU_SELFTEST;
  const VF = window.QU_VERIFICATION;
  const QS = window.QU_STORE;
  if (!T || !VF || !QS) return;

  function makeKv(map) {
    return {
      get: async k => map.get(k),
      set: async (k, v) => { map.set(k, v); },
      delete: async k => { map.delete(k); }
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
    return QS.create({ ns: "vfy" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function makeGateway(map) {
    const seen = [];
    return {
      seen: seen,
      call: function (connector, fn) {
        const key = connector + ":" + fn;
        seen.push(key);
        if (!Object.prototype.hasOwnProperty.call(map, key)) return { ok: false, code: "read_not_found", detail: "no such read: " + key };
        const h = map[key];
        return typeof h === "function" ? h() : h;
      }
    };
  }

  function happyGateway() {
    const map = {};
    VF.GATES.forEach(g => { if (g.probe && g.probe.fn) map[g.connector + ":" + g.probe.fn] = { ok: true, result: { stub: g.id } }; });
    return makeGateway(map);
  }

  T.register("verification: a gate needs a live probe and recorded evidence before it is trusted", async () => {
    const bad = [];
    const store = makeStore();
    const audit = window.QU_AUDIT.createService({ store: store });
    const gateway = happyGateway();
    const svc = VF.createService({ store: store, gateway: gateway, audit: audit });
    const id = "psa_account_link";

    const noEv = await svc.verify(id, {});
    if (noEv.ok || noEv.code !== "evidence_required") bad.push("missing evidence code=" + (noEv && noEv.code));
    const st1 = await svc.status();
    const g1 = st1.ok ? st1.gates.find(g => g.id === id) : null;
    if (!g1 || g1.verified) bad.push("a gate with no evidence was recorded as verified");

    const rec = await svc.verify(id, { evidence: "quote QU-2026-0001 linked to opportunity op1", by: "ops@example.com" });
    if (!rec.ok) bad.push("verify failed: " + JSON.stringify(rec));
    const v = await svc.isVerified(id);
    if (!v.verified) bad.push("isVerified false after a verified probe");
    if (gateway.seen.indexOf("psa:getCompany") === -1) bad.push("the probe did not call the real read (psa:getCompany)");

    const log = await audit.list({});
    const events = log.ok ? log.records.map(r => r.event) : [];
    if (events.indexOf("integration_verified") === -1) bad.push("no integration_verified audit event");

    await svc.verify(id, { evidence: "confirmed again" });
    const list = await svc.list();
    if (list.records.filter(r => r.gate_id === id).length !== 1) bad.push("a gate kept more than one evidence row");

    const en = await svc.enablement();
    if (!en.ok) bad.push("enablement failed");
    else if (!en.connectors.psa || en.connectors.psa.total !== 5) bad.push("psa gate count = " + (en.connectors.psa && en.connectors.psa.total));
    else if (en.connectors.psa.verified) bad.push("psa reported fully verified with only one of its gates proven");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "evidence required, the probe hit the real read, one row recorded + audited, connector enablement stays partial" };
  });

  T.register("verification: a failed or absent probe writes nothing and assertVerified fails closed", async () => {
    const bad = [];
    const store = makeStore();
    const audit = window.QU_AUDIT.createService({ store: store });
    const svc = VF.createService({ store: store, gateway: makeGateway({}), audit: audit });

    const r = await svc.verify("mail_delivery", { evidence: "delivered" });
    if (r.ok || r.gate !== "mail_delivery") bad.push("a failing probe returned " + JSON.stringify(r));
    const list = await svc.list();
    if (list.records.length !== 0) bad.push("a failed probe wrote " + list.records.length + " row(s)");

    const av = await svc.assertVerified("mail_delivery");
    if (av.ok || av.code !== "integration_not_verified") bad.push("assertVerified = " + JSON.stringify(av));

    const unknown = await svc.verify("nope", { evidence: "x" });
    if (unknown.code !== "unknown_gate") bad.push("unknown gate code=" + unknown.code);

    const noGw = VF.createService({ store: store, gateway: null, audit: audit });
    const nr = await noGw.verify("bus_publish", { evidence: "x" });
    if (nr.ok || nr.code !== "no_gateway") bad.push("no-gateway code=" + (nr && nr.code));

    const noEvPolicy = VF.createService({ store: store, gateway: makeGateway({ "content:wikidataSearch": { ok: true, result: {} } }), policy: { require_evidence: false } });
    const plain = await noEvPolicy.verify("content_read", {});
    if (!plain.ok) bad.push("require_evidence:false still demanded evidence");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a failed/absent probe writes nothing, assertVerified fails closed, unknown/no-gateway are explicit, evidence can be waived by policy" };
  });

  T.register("verification: every integration gate is declared and evidence is normalized", () => {
    const bad = [];
    const required = ["psa_account_link", "psa_deal_value", "psa_note", "psa_revenue", "mail_delivery", "accounting_invoice", "psa_invoice", "distributor_a_read", "distributor_b_read", "content_read", "bus_publish", "quoteread_read"];
    if (VF.GATES.length < required.length) bad.push("only " + VF.GATES.length + " gates declared");
    const ids = VF.GATES.map(g => g.id);
    required.forEach(id => { if (ids.indexOf(id) === -1) bad.push("missing gate " + id); });
    VF.GATES.forEach(g => {
      if (!g.label || !g.evidence) bad.push("gate " + g.id + " lacks a label/evidence description");
      if (!g.probe || !g.probe.fn) bad.push("gate " + g.id + " has no probe read");
    });
    if (VF.evidenceText("  hi ") !== "hi") bad.push("evidenceText did not trim");
    if (VF.evidenceText("") !== "") bad.push("empty evidence is not empty");
    if (VF.evidenceText({ a: 1 }) !== '{"a":1}') bad.push("object evidence: " + VF.evidenceText({ a: 1 }));
    const byId = VF.gateById("psa_note");
    if (!byId || byId.connector !== "psa") bad.push("gateById broken");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: VF.GATES.length + " gates declared, each with a read probe + required evidence; evidence normalized" };
  });
})();
