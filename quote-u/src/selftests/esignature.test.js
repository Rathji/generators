(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const E = window.QU_ESIGN;
  if (!T || !QS || !E) return;

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

  T.register("e-signature: the sealed signature binds the typed name, consent and the frozen content seal", () => {
    const version = { id: "v1", frozen_seal: "seal-abc" };
    const built = E.build({ name: "Dana Whitfield", quote_id: "q1", version: version, consent: "I accept this quote.", ip: "203.0.113.9", user_agent: "UA/1" }, {});
    const bad = [];
    if (!built.ok) return { pass: false, detail: "build refused a valid signature: " + JSON.stringify(built) };
    const sig = built.signature;
    if (sig.type !== "typed_name") bad.push("type: " + sig.type);
    if (sig.name !== "Dana Whitfield") bad.push("name: " + sig.name);
    if (sig.content_seal !== "seal-abc") bad.push("content_seal: " + sig.content_seal);
    if (!sig.hash) bad.push("no seal hash");
    const v = E.verify(sig, version);
    if (!v.ok) bad.push("verify a valid signature: " + v.code);

    const tampered = Object.assign({}, sig, { name: "Someone Else" });
    const tv = E.verify(tampered, version);
    if (tv.ok || tv.code !== "signature_tampered") bad.push("a renamed signature was not detected: " + JSON.stringify(tv));

    const wv = E.verify(sig, { id: "v2", frozen_seal: "different" });
    if (wv.ok || wv.code !== "seal_mismatch") bad.push("a signature on the wrong version was not detected");

    const noName = E.build({ version: version });
    if (noName.ok || noName.code !== "signature_name_required") bad.push("a nameless signature was accepted: " + JSON.stringify(noName));

    const sec = E.build({ name: "Dana", version: version, token_secret: "hunter2" });
    if (sec.ok || sec.code !== "secret_not_allowed") bad.push("a secret-shaped field was accepted: " + JSON.stringify(sec));

    const noVersion = E.build({ name: "Dana" });
    if (noVersion.ok || noVersion.code !== "version_required") bad.push("a signature with no version was accepted");

    const input = { name: "Dana", version: { id: "v1", frozen_seal: "s" } };
    const before = JSON.stringify(input);
    E.build(input, {});
    if (JSON.stringify(input) !== before) bad.push("build mutated its input");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a sealed typed-name signature verifies against its frozen content seal; renaming/re-sealing is detected, and a missing name/version or a secret field is refused" };
  });

  T.register("e-signature: policy normalization and the seal is order-independent", () => {
    const bad = [];
    const p = E.normalizePolicy({ enabled: false, require_signature: true, scope: "", consent_text: "  " });
    if (p.enabled !== false) bad.push("enabled");
    if (p.require_signature !== true) bad.push("require_signature");
    if (p.scope !== "sales") bad.push("scope default: " + p.scope);
    if (p.consent_text !== E.DEFAULT_CONSENT) bad.push("consent default");
    const d = E.normalizePolicy(null);
    if (d.enabled !== true || d.require_signature !== false) bad.push("defaults: " + JSON.stringify(d));

    // Two builds with keys in a different order must produce the same core seal.
    const a = E.build({ id: "s1", signed_at: "2026-01-01T00:00:00Z", name: "Dana", version: { id: "v1", frozen_seal: "s" }, consent: "c" }, {});
    const b = E.build({ consent: "c", version: { frozen_seal: "s", id: "v1" }, name: "Dana", signed_at: "2026-01-01T00:00:00Z", id: "s1" }, {});
    if (!a.ok || !b.ok) bad.push("one of the canonical builds failed");
    else if (a.signature.hash !== b.signature.hash) bad.push("the seal depends on key order");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "policy fills defaults; the seal is a deterministic canonical hash (order-independent)" };
  });

  T.register("e-signature: the capability is gated behind a recorded scope sign-off", async () => {
    const store = makeStore("esg");
    const svc = E.createService({ store, policy: { enabled: true, require_signature: false } });
    const bad = [];

    const st0 = await svc.status();
    if (!st0.ok || st0.enabled) bad.push("the capability was enabled without a sign-off");
    if (st0.code !== "signoff_required") bad.push("status code: " + st0.code);
    const build0 = await svc.build({ name: "Dana", quote_id: "q1", version: { id: "v1", frozen_seal: "s" } });
    if (build0.ok || build0.code !== "signoff_required") bad.push("build without a sign-off: " + JSON.stringify(build0));

    const byRequired = await svc.signOff({});
    if (byRequired.ok || byRequired.code !== "signoff_by_required") bad.push("a nameless sign-off was accepted");

    const off = await svc.signOff({ by: "A. Manager", scope: "sales", reference: "SOC2-2026" });
    if (!off.ok) bad.push("sign-off failed: " + JSON.stringify(off));
    const st1 = await svc.status();
    if (!st1.enabled) bad.push("the capability is not enabled after a sign-off");
    if (!st1.signoff || st1.signoff.by !== "A. Manager") bad.push("the sign-off was not recorded");

    const build1 = await svc.build({ name: "Dana", quote_id: "q1", version: { id: "v1", frozen_seal: "s" } });
    if (!build1.ok) bad.push("build after a sign-off failed: " + JSON.stringify(build1));
    else if (!E.verify(build1.signature, { id: "v1", frozen_seal: "s" }).ok) bad.push("the built signature does not verify");

    // require_signature is surfaced even when the capability is gated off.
    const strictStore = makeStore("esgx");
    const strict = E.createService({ store: strictStore, policy: { enabled: true, require_signature: true } });
    const sst = await strict.status();
    if (sst.enabled) bad.push("strict capability enabled without a sign-off");
    if (!strict.policy().require_signature) bad.push("require_signature lost");

    const rev = await svc.revokeSignOff({ by: "A. Manager" });
    if (!rev.ok || !rev.revoked) bad.push("revoke failed: " + JSON.stringify(rev));
    const st2 = await svc.status();
    if (st2.enabled) bad.push("the capability is still enabled after a revoke");
    const hist = await svc.history();
    if (!hist.ok || hist.history.length < 2) bad.push("history did not record both transitions");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "typed-name signatures are refused until an explicit scope sign-off is recorded, enabled after it, and disabled again on revoke (history retained)" };
  });
})();
