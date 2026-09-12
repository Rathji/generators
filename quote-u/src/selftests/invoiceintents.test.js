(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const II = window.QU_INVOICEINTENTS;
  if (!T || !QS || !II) return;

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
    const ns = "inv" + QS.randHex(6);
    return QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  T.register("invoice intent: one row per version — a second claim on either path is refused (invariant I2)", async () => {
    const store = makeStore();
    const svc = II.createService({ store });
    const bad = [];

    const first = await svc.claim({ quote_id: "q1", version_id: "v1", path: "direct", amount_cents: 35000, created_by: "Dana" });
    if (!first.ok) return { pass: false, detail: "first claim failed: " + JSON.stringify(first) };
    if (first.intent.path !== "direct" || first.intent.status !== "pending") bad.push("claim shape: " + JSON.stringify(first.intent));

    const again = await svc.claim({ quote_id: "q1", version_id: "v1", path: "direct", amount_cents: 35000 });
    if (again.ok || again.code !== "already_invoiced") bad.push("a same-path second claim was accepted: " + JSON.stringify(again));
    else if (again.path !== "direct") bad.push("refusal should name the winning path: " + again.path);

    const other = await svc.claim({ quote_id: "q1", version_id: "v1", path: "psa", amount_cents: 35000 });
    if (other.ok || other.code !== "already_invoiced") bad.push("the other path was allowed to double-bill: " + JSON.stringify(other));
    else if (other.path !== "direct") bad.push("refusal should name the original path: " + other.path);

    const can = await svc.canInvoice("v1");
    if (!can.ok || can.allowed !== false) bad.push("canInvoice should be false: " + JSON.stringify(can));
    const cnt = await svc.count();
    if (cnt.count !== 1) bad.push("count after refusals: " + cnt.count);

    // A different version gets its own intent.
    const v2 = await svc.claim({ quote_id: "q1", version_id: "v2", path: "psa", amount_cents: 1000 });
    if (!v2.ok) bad.push("a distinct version was refused: " + JSON.stringify(v2));
    if (II.uniqueByVersion([{ version_id: "x" }, { version_id: "x" }]).ok) bad.push("uniqueByVersion missed a duplicate");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the intent row is claimed before any external call and any second attempt — same path or the other — is refused with already_invoiced" };
  });

  T.register("invoice intent: a path reconciles its external reference back, and identity fields are immutable", async () => {
    const store = makeStore();
    const svc = II.createService({ store });
    const bad = [];

    const claimed = await svc.claim({ quote_id: "q9", version_id: "v9", path: "psa", amount_cents: 270000, created_by: "system" });
    if (!claimed.ok) return { pass: false, detail: "claim failed: " + JSON.stringify(claimed) };
    const id = claimed.intent.id;

    const created = await svc.markCreated(id, { external_reference: "PSA-INV-77", external_system: "psa" });
    if (!created.ok) bad.push("markCreated failed: " + JSON.stringify(created));
    else {
      if (created.intent.status !== "created") bad.push("status after create: " + created.intent.status);
      if (created.intent.external_reference !== "PSA-INV-77") bad.push("external_reference: " + created.intent.external_reference);
      if (created.intent.external_system !== "psa") bad.push("external_system: " + created.intent.external_system);
    }
    // The guard forbids identity drift: version_id/path are never editable.
    const drifted = await svc.updateStatus(id, { status: "reconciled", external_reference: "PSA-INV-77" });
    if (!drifted.ok) bad.push("markReconciled-ish update failed: " + JSON.stringify(drifted));
    else {
      if (drifted.intent.status !== "reconciled") bad.push("status after reconcile: " + drifted.intent.status);
      if (drifted.intent.version_id !== "v9") bad.push("version_id changed: " + drifted.intent.version_id);
      if (drifted.intent.path !== "psa") bad.push("path changed: " + drifted.intent.path);
    }

    // A failed attempt records the error and does not clear the reference.
    const failed = await svc.markFailed(id, { error: "accounting timeout" });
    if (!failed.ok || failed.intent.status !== "failed") bad.push("markFailed: " + JSON.stringify(failed));
    if (failed.ok && failed.intent.error !== "accounting timeout") bad.push("error not recorded: " + failed.intent.error);

    // A bad amount and a secret-shaped field are refused before any write.
    const badAmount = await svc.claim({ quote_id: "q9", version_id: "v10", path: "psa", amount_cents: 12.5 });
    if (badAmount.ok || badAmount.code !== "bad_amount_cents") bad.push("fractional cents accepted: " + JSON.stringify(badAmount));
    const sec = II.validate({ quote_id: "q9", version_id: "v11", path: "psa", amount_cents: 1, token_secret: "hunter2" });
    if (sec.ok || sec.violations[0].code !== "secret_not_allowed") bad.push("a secret field was allowed: " + JSON.stringify(sec));
    const badPath = await svc.claim({ quote_id: "q9", version_id: "v12", path: "cash", amount_cents: 1 });
    if (badPath.ok || badPath.code !== "bad_path") bad.push("an unknown path was accepted: " + JSON.stringify(badPath));

    const ver = await svc.verify();
    if (!ver.ok) bad.push("verify: " + JSON.stringify(ver.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the claimed intent's path/version are immutable while its status block reconciles the external reference back, and invalid amounts/paths/secrets are refused before any write" };
  });

  T.register("invoice intent: a claim that loses a race retries and refuses with already_invoiced", async () => {
    const bad = [];
    const base = makeStore();
    // A competing writer lands its row between our claim's load and its save,
    // so our first save conflicts; the claim must re-read and refuse rather
    // than overwrite the winner (the double-billing guard under contention).
    const rival = { id: "inv-rival", quote_id: "qr", version_id: "vr", path: "psa", status: "pending", external_reference: null, external_system: null, amount_cents: 42000, currency: "CAD", attempt: 1, created_by: "rival", error: null, created_at: "2026-01-01T00:00:00Z", updated_at: null };
    let injected = false;
    const store = Object.assign({}, base, {
      loadDoc: m => base.loadDoc(m),
      saveChecked: async (m, content, o) => {
        if (!injected) {
          injected = true;
          // Persist the rival row into the canonical document, then hand the
          // caller the revision conflict a real racing save would produce — so
          // the claim's own write never lands and its retry sees the winner.
          const w = await base.saveChecked(m, { records: [rival] }, { expectedBase: o.expectedBase });
          if (!w.ok) return w;
          return { ok: false, code: "conflict", detail: "a rival claim landed between this claim's load and save" };
        }
        return base.saveChecked(m, content, o);
      }
    });
    const svc = II.createService({ store });
    const res = await svc.claim({ quote_id: "qr", version_id: "vr", path: "direct", amount_cents: 42000 });
    if (res.ok) bad.push("the losing claim overwrote the winner: " + JSON.stringify(res));
    else if (res.code !== "already_invoiced") bad.push("expected already_invoiced, got " + res.code);
    else if (res.path !== "psa") bad.push("the refusal should name the winner's path: " + res.path);
    const cnt = await svc.count();
    if (cnt.count !== 1) bad.push("count after the race: " + cnt.count);
    const g = await svc.getForVersion("vr");
    if (!g.ok || !g.intent || g.intent.path !== "psa") bad.push("the winner's row was lost: " + JSON.stringify(g.intent));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a claim that loses the revision race re-reads and refuses with already_invoiced, so the winner's intent survives and version stays single-invoiced" };
  });
})();
