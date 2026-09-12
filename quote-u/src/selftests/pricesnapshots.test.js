(function () {
  const T = window.QU_SELFTEST;
  const PS = window.QU_PRICESNAPSHOTS;
  const LI = window.QU_LINEITEMS;
  const M = window.QU_MONEY;
  const QS = window.QU_STORE;
  if (!T || !PS || !LI || !M || !QS) return;

  const CAPTURED = "2026-08-01T10:00:00.000Z";

  function input(overrides) {
    return Object.assign({
      source: "acme-distributor",
      distributor_sku: "ACM-100",
      manufacturer_part_number: "MR46",
      unit_cost_cents: 10000,
      list_price_cents: 13000,
      quantity_available: 12,
      warehouse: "YVR",
      captured_at: CAPTURED,
      raw_response: { sku: "ACM-100", price: "100.00", currency: "CAD" }
    }, overrides || {});
  }

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function line(overrides) {
    return LI.normalize(Object.assign({
      kind: "one_time",
      description: "line",
      unit_cost_cents: 0,
      unit_sell_cents: 5000
    }, overrides || {}));
  }

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => {
        const f = files.get(name);
        return f ? f.text : null;
      },
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

  function makeEnv() {
    const kvStore = new Map();
    const files = new Map();
    const store = QS.create({ ns: "snap" + QS.randHex(6), kv: makeKv(kvStore), editable: makeEditable(files), modules: ["price_snapshots"] });
    const svc = PS.createService({ store });
    return { store, files, svc };
  }

  T.register("price snapshots: the model declares its fields and fills defaults", () => {
    const bad = [];
    ["id", "source", "distributor_sku", "manufacturer_part_number", "unit_cost_cents", "list_price_cents", "quantity_available", "warehouse", "currency", "captured_at", "raw_response", "hash"].forEach(f => {
      if (PS.MODEL_FIELD_NAMES.indexOf(f) === -1) bad.push("missing field " + f);
    });
    const snap = PS.normalize(input({ captured_at: undefined, raw_response: undefined }), { id: "snap-1", clock: () => CAPTURED });
    if (snap.id !== "snap-1") bad.push("id");
    if (snap.currency !== "CAD") bad.push("currency default: " + snap.currency);
    if (snap.captured_at !== CAPTURED) bad.push("captured_at not stamped by clock: " + snap.captured_at);
    if (snap.raw_response !== null) bad.push("raw_response default");
    const min = PS.normalize({ source: "manual", unit_cost_cents: 500 }, { id: "snap-2", clock: () => CAPTURED });
    if (min.list_price_cents !== 0 || min.quantity_available !== 0 || min.warehouse !== "" || min.distributor_sku !== "") bad.push("sparse defaults: " + JSON.stringify(min));
    if (min.hash !== undefined) bad.push("normalize sealed a snapshot (capture should)");
    const e1 = throws(() => PS.normalize(input({ source: "" })), "bad_source");
    if (e1) bad.push("missing source: " + e1);
    const e2 = throws(() => PS.normalize(input({ unit_cost_cents: undefined })), "bad_unit_cost_cents");
    if (e2) bad.push("missing cost: " + e2);
    const e3 = throws(() => PS.normalize(input({ unit_cost_cents: -1 })), "negative_cost");
    if (e3) bad.push("negative cost: " + e3);
    const e4 = throws(() => PS.normalize(input({ unit_cost_cents: 1.5 })), "fractional_cents");
    if (e4) bad.push("fractional cost: " + e4);
    const e5 = throws(() => PS.normalize(input({ quantity_available: -3 })), "bad_quantity_available");
    if (e5) bad.push("negative quantity: " + e5);
    const e6 = throws(() => PS.normalize(input({ captured_at: "not-a-date" })), "bad_captured_at");
    if (e6) bad.push("bad timestamp: " + e6);
    const e7 = throws(() => PS.normalize(null), "bad_snapshot");
    if (e7) bad.push("null: " + e7);
    const v = PS.validate(input({ list_price_cents: -5 }));
    if (v.ok) bad.push("validate accepted a negative list price");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "full field set declared; defaults + captured_at filled; bad source/cost/quantity/timestamp refused" };
  });

  T.register("price snapshots: the seal covers every field, order-independently", () => {
    const bad = [];
    const sealed = PS.capture(input(), { id: "snap-1" });
    if (typeof sealed.hash !== "string" || sealed.hash.length < 16) bad.push("no hash");
    const ok = PS.verify(sealed);
    if (!ok.ok || ok.code !== null) bad.push("fresh snapshot failed verification: " + JSON.stringify(ok));
    const again = PS.capture(input(), { id: "snap-1" });
    if (again.hash !== sealed.hash) bad.push("hash is not deterministic");
    const reordered = {};
    Object.keys(input()).reverse().forEach(k => { reordered[k] = input()[k]; });
    if (PS.hashOf(PS.normalize(reordered, { id: "snap-1" })) !== sealed.hash) bad.push("key order changed the hash");
    const tampered = Object.assign({}, sealed, { unit_cost_cents: 9999 });
    const t = PS.verify(tampered);
    if (t.ok || t.code !== "snapshot_tampered") bad.push("tampering not caught: " + JSON.stringify(t));
    const added = Object.assign({}, sealed, { sneaky: true });
    if (PS.verify(added).ok) bad.push("an added field was not detected");
    const noHash = PS.verify(Object.assign({}, sealed, { hash: undefined }));
    if (noHash.ok || noHash.code !== "unsealed") bad.push("unsealed snapshot accepted");
    if (PS.verify(null).code !== "bad_snapshot") bad.push("null verification");
    const other = PS.capture(input(), { id: "snap-other" });
    if (other.hash === sealed.hash) bad.push("the seal does not cover the id");
    if (PS.contentHashOf(other) !== PS.contentHashOf(sealed)) bad.push("content hash depends on the generated id");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "deterministic, order-independent seal; tampering (value change or added field) and unsealed snapshots detected" };
  });

  T.register("price snapshots: capture preserves the raw source payload for audit", () => {
    const bad = [];
    const raw = { page: 1, offers: [{ sku: "ACM-100", net: 100 }], fetched_via: "feed" };
    const sealed = PS.capture(input({ raw_response: raw }), { id: "snap-raw" });
    if (sealed.raw_response !== raw) bad.push("raw_response not preserved by reference");
    if (JSON.stringify(sealed.raw_response) !== JSON.stringify(raw)) bad.push("raw_response altered");
    if (!PS.verify(sealed).ok) bad.push("sealed snapshot with raw payload failed verification");
    const changed = Object.assign({}, sealed, { raw_response: { other: true } });
    if (PS.verify(changed).ok) bad.push("changing the raw payload did not break the seal");
    const t = PS.tryCapture(input({ source: "" }));
    if (t.ok || t.code !== "bad_source") bad.push("tryCapture accepted a bad snapshot: " + JSON.stringify(t));
    const good = PS.tryCapture(input(), { id: "snap-2" });
    if (!good.ok || !good.snapshot.hash) bad.push("tryCapture refused a good snapshot");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "raw payload preserved verbatim and sealed; tryCapture never throws" };
  });

  T.register("price snapshots: bind and applyCost stamp a snapshot-priced line without mutating it", () => {
    const bad = [];
    const base = line();
    const bound = PS.bind(base, "snap-1");
    if (bound.pricing_mode !== "snapshot" || bound.price_snapshot_ref !== "snap-1") bad.push("bind: " + JSON.stringify(bound));
    if (base.pricing_mode !== "manual" || base.price_snapshot_ref !== null) bad.push("bind mutated its input");
    const byObject = PS.bind(line(), PS.capture(input(), { id: "snap-9" }));
    if (byObject.price_snapshot_ref !== "snap-9") bad.push("bind by snapshot object");
    const e1 = throws(() => PS.bind(base, null), "snapshot_required");
    if (e1) bad.push("bind without a snapshot: " + e1);
    const snap = PS.capture(input({ unit_cost_cents: 10000 }), { id: "snap-3" });
    const applied = PS.applyCost(base, snap, { markup_bp: 2500 });
    if (applied.unit_cost_cents !== 10000) bad.push("cost not stamped");
    if (applied.unit_sell_cents !== 12500) bad.push("markup sell: " + applied.unit_sell_cents);
    if (applied.pricing_mode !== "snapshot" || applied.price_snapshot_ref !== "snap-3") bad.push("applyCost binding");
    if (base.unit_cost_cents !== 0) bad.push("applyCost mutated its input");
    const explicit = PS.applyCost(base, snap, { unit_sell_cents: 14999 });
    if (explicit.unit_sell_cents !== 14999) bad.push("explicit sell ignored");
    const validated = LI.validate(applied);
    if (!validated.ok) bad.push("bound line failed line-item validation: " + JSON.stringify(validated.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "bind sets snapshot pricing; applyCost stamps cost + derived/explicit sell; inputs never mutated; result validates" };
  });

  T.register("price snapshots: provenance reconstructs where a price came from", () => {
    const bad = [];
    if (PS.provenance(null) !== null) bad.push("null provenance");
    const sealed = PS.capture(input(), { id: "snap-1" });
    const p = PS.provenance(sealed);
    ["id", "source", "distributor_sku", "manufacturer_part_number", "unit_cost_cents", "list_price_cents", "quantity_available", "warehouse", "currency", "captured_at", "hash", "raw_response"].forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(p, k)) bad.push("provenance missing " + k);
    });
    if (p.id !== "snap-1" || p.source !== "acme-distributor" || p.unit_cost_cents !== 10000) bad.push("provenance values");
    if (p.hash !== sealed.hash) bad.push("provenance does not cite the seal");
    if (JSON.stringify(p.raw_response) !== JSON.stringify(sealed.raw_response)) bad.push("provenance dropped the raw payload");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "provenance exposes every source field, the seal and the raw payload" };
  });

  T.register("price snapshots: age and staleness are computed from captured_at", () => {
    const bad = [];
    const snap = PS.capture(input(), { id: "snap-1" });
    const now = Date.parse(CAPTURED) + 3 * 86400000;
    if (PS.ageDays(snap, now) !== 3) bad.push("age: " + PS.ageDays(snap, now));
    if (PS.ageDays(snap, CAPTURED) !== 0) bad.push("same-instant age");
    if (PS.ageDays({ captured_at: "nope" }, now) !== null) bad.push("bad date age");
    if (PS.ageDays(null, now) !== null) bad.push("null age");
    if (PS.isStale(snap, { now, maxAgeDays: 7 }) !== false) bad.push("fresh flagged stale");
    if (PS.isStale(snap, { now: Date.parse(CAPTURED) + 10 * 86400000, maxAgeDays: 7 }) !== true) bad.push("stale not flagged");
    if (PS.isStale(snap, { now, maxAgeDays: 3 }) !== false) bad.push("boundary at exactly maxAge should be fresh");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "age in days and staleness against a configurable window; boundary is inclusive" };
  });

  T.register("price snapshots: the service captures, dedupes and never edits a stored snapshot", async () => {
    const env = makeEnv();
    const bad = [];
    const first = await env.svc.capture(input());
    if (!first.ok || !first.created || !first.snapshot) return { pass: false, detail: "capture: " + JSON.stringify(first) };
    const second = await env.svc.capture(input({ raw_response: { sku: "ACM-100", price: "100.00", currency: "CAD" } }));
    if (!second.ok || !second.deduped || second.created) bad.push("identical capture not deduped: " + JSON.stringify(second));
    if (second.snapshot.id !== first.snapshot.id) bad.push("dedupe returned a different snapshot");
    const different = await env.svc.capture(input({ unit_cost_cents: 10500 }));
    if (!different.ok || !different.created) bad.push("changed capture not stored");
    const all = await env.svc.list();
    if (!all.ok || all.snapshots.length !== 2) bad.push("list: " + JSON.stringify(all.snapshots && all.snapshots.length));
    const filtered = await env.svc.list({ source: "acme-distributor" });
    if (!filtered.ok || filtered.snapshots.length !== 2) bad.push("filtered list");
    const none = await env.svc.list({ source: "ghost" });
    if (!none.ok || none.snapshots.length !== 0) bad.push("filter mismatch");
    const got = await env.svc.get(first.snapshot.id);
    if (!got.ok || !got.snapshot || got.snapshot.hash !== first.snapshot.hash) bad.push("get");
    const verify = await env.svc.verifyAll();
    if (!verify.ok || verify.count !== 2 || verify.breaks.length !== 0) bad.push("verifyAll: " + JSON.stringify(verify));
    const up = await env.svc.update(first.snapshot.id, { unit_cost_cents: 1 });
    if (up.ok || up.code !== "immutable") bad.push("update did not refuse: " + JSON.stringify(up));
    const rm = await env.svc.remove(first.snapshot.id);
    if (rm.ok || rm.code !== "immutable") bad.push("remove did not refuse: " + JSON.stringify(rm));
    const still = await env.svc.get(first.snapshot.id);
    if (!still.ok || !still.snapshot) bad.push("snapshot vanished after refused delete");
    const badCapture = await env.svc.capture({ source: "", unit_cost_cents: 10 });
    if (badCapture.ok || badCapture.code !== "bad_source") bad.push("bad capture accepted: " + JSON.stringify(badCapture));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "capture + dedupe by seal, list/get/filter, verifyAll, update/remove refused as immutable, invalid capture rejected" };
  });

  T.register("price snapshots: a stored snapshot binds to a line and reports its age", async () => {
    const env = makeEnv();
    const bad = [];
    const cap = await env.svc.capture(input());
    if (!cap.ok) return { pass: false, detail: "capture: " + JSON.stringify(cap) };
    const id = cap.snapshot.id;
    const bound = await env.svc.bind(line(), id);
    if (!bound.ok || bound.line.pricing_mode !== "snapshot" || bound.line.price_snapshot_ref !== id) bad.push("service bind: " + JSON.stringify(bound));
    if (bound.snapshot.unit_cost_cents !== 10000) bad.push("service bind snapshot");
    const missing = await env.svc.bind(line(), "snap-ghost");
    if (missing.ok || missing.code !== "snapshot_not_found") bad.push("missing bind: " + JSON.stringify(missing));
    const now = Date.parse(CAPTURED) + 5 * 86400000;
    const age = await env.svc.ageDays(id, now);
    if (!age.ok || age.age_days !== 5) bad.push("service age: " + JSON.stringify(age));
    const fresh = await env.svc.isStale(id, { now, maxAgeDays: 7 });
    if (!fresh.ok || fresh.stale !== false) bad.push("service isStale fresh: " + JSON.stringify(fresh));
    const old = await env.svc.isStale(id, { now: Date.parse(CAPTURED) + 9 * 86400000, maxAgeDays: 7 });
    if (!old.ok || old.stale !== true) bad.push("service isStale old: " + JSON.stringify(old));
    const ghost = await env.svc.ageDays("snap-ghost", now);
    if (ghost.ok || ghost.code !== "snapshot_not_found") bad.push("ghost age: " + JSON.stringify(ghost));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "stored snapshot binds through the service; missing ids refused; age/staleness reported from the record" };
  });

  T.register("price snapshots: capture → read back through the real workspace store (live)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "snap" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.createDefault({ ns, modules: ["price_snapshots"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const svc = PS.createService({ store });
    const res = await svc.capture(input({ source: "live-distributor" }));
    if (res.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (res.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live price-snapshot check skipped" };
    if (!res.ok) return { pass: false, detail: "capture failed: " + JSON.stringify(res) };
    const back = await svc.get(res.snapshot.id);
    const verify = await svc.verifyAll();
    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    if (!back.ok || !back.snapshot || back.snapshot.source !== "live-distributor") return { pass: false, detail: "snapshot not readable back" };
    if (!verify.ok) return { pass: false, detail: "stored snapshot failed verification: " + JSON.stringify(verify.breaks) };
    return { pass: true, detail: "captured a sealed snapshot on the canonical store, read it back and re-verified its seal" };
  });
})();
