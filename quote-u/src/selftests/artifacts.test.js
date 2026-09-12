(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const A = window.QU_ARTIFACTS;
  if (!T || !QS || !A) return;

  const REP_MAILBOX = "alex.rivera@example.com";

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

  function makeStore(prefix) {
    return QS.create({ ns: prefix + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function sampleInput(overrides) {
    const version = { id: "v1", frozen_seal: "seal-1", quote_id: "q1" };
    const quote = { id: "q1", quote_number: "QU-2026-0001", company_name: "Acme Ltd", contact_name: "Dana", title: "Network refresh" };
    const totals = { one_time_cents: 30000, mrr_cents: 20000, twelve_month_value_cents: 270000, deal_value_cents: 270000, currency: "CAD" };
    const approval = Object.assign({ approver_name: "Dana Whitfield", approved_at: "2026-01-01T00:00:00Z", selection: ["l1"], signature: window.QU_ESIGN ? window.QU_ESIGN.build({ name: "Dana Whitfield", version: version, consent: "I accept." }).signature : null }, totals);
    const view = { lines: [{ description: "Router", kind: "one_time", quantity: 1, unit_sell_cents: 30000, amount_cents: 30000, optional: false }] };
    return Object.assign({ version: version, quote: quote, approval: approval, totals: totals, selection: ["l1"], view: view, approved_at: approval.approved_at }, overrides || {});
  }

  T.register("acceptance artifact: build seals the client-safe acceptance and never carries cost or margin", () => {
    const bad = [];
    const built = A.build(sampleInput(), {});
    if (!built.ok) return { pass: false, detail: "build failed: " + JSON.stringify(built) };
    const art = built.artifact;
    if (art.kind !== "acceptance") bad.push("kind: " + art.kind);
    if (art.version_id !== "v1") bad.push("version_id");
    if (art.content_seal !== "seal-1") bad.push("content_seal");
    if (!art.content_hash) bad.push("no content hash");
    if (!art.html || !art.text || !art.json) bad.push("a rendering is missing");
    if (!art.signature || art.signature.name !== "Dana Whitfield") bad.push("signature not carried");
    if (art.approver_name !== "Dana Whitfield") bad.push("approver_name");
    const v = A.verify(art);
    if (!v.ok) bad.push("verify: " + JSON.stringify(v.violations));

    // I4: no cost/margin fragment may appear in ANY rendering.
    const scan = JSON.stringify(art).toLowerCase();
    ["unit_cost", "cost_cents", "margin", "snapshot_cost"].forEach(f => { if (scan.indexOf(f) !== -1) bad.push("artifact carries " + f); });

    // A doctored artifact is caught by the content hash and the I4 re-scan.
    const tampered = Object.assign({}, art, { json: '{"one_time_cents":1,"unit_cost_cents":5}' });
    const tv = A.verify(tampered);
    if (tv.ok) bad.push("a cost-leaking artifact passed verify");
    else if (tv.code !== "cost_leak" && tv.code !== "tampered") bad.push("unexpected verify code: " + tv.code);

    // An artifact with no version is refused.
    const noV = A.build({ quote: { id: "q" } });
    if (noV.ok || noV.code !== "version_required") bad.push("a versionless artifact was accepted");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the acceptance artifact seals the version's frozen content with the client-safe view + signature and carries no cost/margin fragment in any rendering" };
  });

  T.register("acceptance artifact: one immutable artifact per version, stored and verified", async () => {
    const store = makeStore("art");
    const svc = A.createService({ store });
    const bad = [];
    const r1 = await svc.record(sampleInput());
    if (!r1.ok) return { pass: false, detail: "record failed: " + JSON.stringify(r1) };
    if (!r1.artifact || !r1.artifact.id) bad.push("no artifact id");
    const r2 = await svc.record(sampleInput());
    if (r2.ok || r2.code !== "already_recorded") bad.push("a second artifact for the same version was accepted: " + JSON.stringify(r2));
    const cnt = await svc.count();
    if (!cnt.ok || cnt.count !== 1) bad.push("count: " + JSON.stringify(cnt));
    const g = await svc.getForVersion("v1");
    if (!g.ok || !g.artifact) bad.push("getForVersion returned nothing");
    else if (g.artifact.content_hash !== r1.artifact.content_hash) bad.push("stored hash differs");
    const upd = await svc.update("v1", {});
    if (upd.ok || upd.code !== "immutable") bad.push("update was allowed");
    const rem = await svc.remove("v1");
    if (rem.ok || rem.code !== "immutable") bad.push("remove was allowed");
    const ver = await svc.verify();
    if (!ver.ok) bad.push("verifyAll: " + JSON.stringify(ver.violations));
    const list = await svc.list({ quote_id: "q1" });
    if (!list.ok || list.artifacts.length !== 1) bad.push("list: " + JSON.stringify(list && list.artifacts && list.artifacts.length));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "exactly one immutable artifact per version; update/remove are refused; verifyAll is clean" };
  });

  T.register("acceptance artifact: an approval records the signature and the acceptance artifact (live)", async () => {
    const ns = "artint" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const events = window.QU_PORTALEVENTS.createService({ audit });
    const approvals = window.QU_APPROVALS.createService({ store });
    const esign = window.QU_ESIGN.createService({ store, policy: { enabled: true, require_signature: true } });
    const artifacts = A.createService({ store });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, esign, artifacts, taxPolicy: (window.root && window.root.quoteTaxPolicy) || null });
    const bad = [];

    await esign.signOff({ by: "A. Manager", reference: "SOC2-2026" });

    const created = await quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Network refresh", scope: "*" });
    const v = await versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    await versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 1, unit_cost_cents: 9000, unit_sell_cents: 30000 });
    const sent = await send.send(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    if (!sent.ok) return { pass: false, detail: "seed send failed: " + JSON.stringify(sent) };
    const secret = (function (link) { const i = String(link).indexOf("#/q/"); return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4)); })(sent.link);

    const res = await actions.approve(secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9", user_agent: "UA/1" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.signed) bad.push("approve did not capture a signature");
    if (!res.artifact_id) bad.push("approve returned no artifact_id");
    if (!res.approval || !res.approval.signature) bad.push("the approval row carries no signature");
    else if (!window.QU_ESIGN.verify(res.approval.signature, v.version).ok) bad.push("the stored signature does not verify");

    const art = await artifacts.getForVersion(v.version.id);
    if (!art.ok || !art.artifact) bad.push("no artifact was stored");
    else {
      if (art.artifact.id !== res.artifact_id) bad.push("artifact id disagreement");
      if (!art.artifact.signature || art.artifact.signature.name !== "Dana Whitfield") bad.push("the artifact carries no signature");
      if (!A.verify(art.artifact).ok) bad.push("the stored artifact failed verify");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a signed approval stores the sealed signature on the approval row AND the immutable acceptance artifact (with the signature)" };
  });

  T.register("acceptance artifact: the canvas renderer draws the acceptance document", () => {
    if (typeof document === "undefined") return { pass: true, skip: true, detail: "no DOM" };
    const bad = [];
    const built = A.build(sampleInput(), {});
    if (!built.ok) return { pass: false, detail: "build failed" };
    const canvas = A.renderToCanvas(built.artifact, { width: 760, dpr: 1 });
    if (!canvas) return { pass: false, detail: "renderToCanvas returned null" };
    if (!canvas.width || canvas.width < 700) bad.push("canvas width: " + canvas.width);
    if (!canvas.height || canvas.height < 500) bad.push("canvas height: " + canvas.height);
    const ctx = canvas.getContext("2d");
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255) nonWhite++; }
    if (nonWhite < 500) bad.push("the canvas is essentially blank (" + nonWhite + " non-white pixels)");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the acceptance document renders to a " + canvas.width + "×" + canvas.height + " canvas with visible content" };
  });
})();
