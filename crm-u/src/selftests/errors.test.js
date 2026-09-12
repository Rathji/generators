(function () {
  const T = window.SELFTEST;
  const U = window.RECORDUI;
  const BUS = window.CRM_BUS;
  if (!T || !U || !BUS) return;

  const GENERIC = "The change could not be saved.";

  const REQUIRED = {
    doc_too_large: ["capacity", "archive", "dashboard"],
    file_too_big: ["capacity", "archive", "dashboard"],
    over_daily_allowance: ["allowance", "capacity", "archive", "tomorrow", "free space"],
    no_edit_key: ["backup", "restore", "dashboard"],
    conflict: ["dashboard", "resolve", "conflict"],
    conflict_stale: ["reload", "again", "nothing was overwritten"],
    schema_mismatch: ["version", "backup", "reload", "dashboard"],
    corrupt_head: ["backup", "restore", "recover", "dashboard"],
    corrupt_part: ["backup", "restore", "recover", "dashboard"],
    corrupt_sha: ["backup", "restore", "recover", "dashboard"],
    merge_failed: ["merge", "again", "conflict", "dashboard"],
    server_lag: ["wait", "again", "moment"],
    doc_missing: ["reload", "recreate"],
    requires_saved_generator: ["save this generator", "editor"],
    editable_error: ["try again", "backup", "connection"],
    unreadable_modules: ["backup", "restore", "retry", "dashboard"],
    pending_changes: ["dashboard", "sync"],
    update_failed: ["try again"],
    save_failed: ["try again"],
    load_failed: ["connection", "try again"],
    read_only: ["read-only", "owner", "manager"]
  };

  function hasToken(msg, tokens) {
    const low = msg.toLowerCase();
    return tokens.some(t => low.indexOf(t) !== -1);
  }

  T.register("describe: every required record failure mode has plain-language actionable copy", () => {
    const missing = [];
    for (const code of Object.keys(REQUIRED)) {
      const msg = U.describeError({ ok: false, code, detail: "raw internal detail " + code }, "Deals");
      if (!msg || msg === GENERIC || msg.indexOf("raw internal detail") !== -1) { missing.push(code + "=falls-through"); continue; }
      if (msg.length < 40) { missing.push(code + "=too-short"); continue; }
      if (msg.indexOf("_") !== -1 || /[a-z][A-Z]/.test(msg)) { missing.push(code + "=leaks-code-identifiers"); continue; }
      if (!hasToken(msg, REQUIRED[code])) { missing.push(code + "=no-next-step"); continue; }
    }
    if (missing.length) return { pass: false, detail: missing.join("; ") };
    return { pass: true, detail: Object.keys(REQUIRED).length + " codes map to actionable copy" };
  });

  T.register("describe: generic fallbacks stay friendly for unknown codes and empty details", () => {
    const w = U.describeError({ ok: false, code: "some_unknown_code", detail: "The widget glitched at 3:14 pm." });
    if (w !== "The widget glitched at 3:14 pm.") return { pass: false, detail: "detail should surface for unknown codes: " + w };
    const g = U.describeError({ ok: false, code: "some_unknown_code" });
    if (g !== GENERIC) return { pass: false, detail: "expected generic fallback, got: " + g };
    const none = U.describeError(null);
    if (none !== GENERIC) return { pass: false, detail: "null result should be generic: " + none };
    return { pass: true, detail: "fallbacks verified" };
  });

  const REQUIRED_BUS = {
    not_configured: ["peer", "connections", "configured", "set it"],
    not_found: ["peer", "publish", "stream", "nothing"],
    timeout: ["did not respond", "try again", "time"],
    net_error: ["reach", "connection", "name"],
    bad_json: ["json", "try again"],
    bad_envelope: ["stream", "peer", "name"],
    stream_mismatch: ["stream", "peer", "name"],
    bad_manifest: ["manifest", "file name"],
    no_edit_key: ["write key", "device", "publish"],
    requires_saved_generator: ["save this generator", "editor"],
    file_too_big: ["too large", "archive"],
    over_daily_allowance: ["allowance", "queued", "resets"],
    superseded: ["retried", "queued"],
    editable_error: ["queued", "retry", "integrations"],
    busy: ["already running"],
    no_transport: ["transport", "import", "main.pjs"],
    read_failed: ["could not be read", "retry", "connections"],
    bad_bundle: ["malformed", "skipped"],
    already_imported: ["already", "imported"],
    lead_save_failed: ["save", "conflict", "dashboard", "retry"],
    not_out_stream: ["outbound", "stream"],
    not_won: ["won", "first"],
    not_customer: ["customer", "first"],
    cas_failed: ["retry", "nothing was lost", "saving"]
  };

  T.register("describe: every bus failure code has plain-language actionable copy", () => {
    const missing = [];
    for (const code of Object.keys(REQUIRED_BUS)) {
      const msg = BUS.describe(code);
      if (!msg) { missing.push(code + "=missing"); continue; }
      if (msg.length < 40) { missing.push(code + "=too-short"); continue; }
      if (msg.indexOf("_") !== -1 || /[a-z][A-Z]/.test(msg)) { missing.push(code + "=leaks-code-identifiers"); continue; }
      if (!hasToken(msg, REQUIRED_BUS[code])) { missing.push(code + "=no-next-step"); continue; }
    }
    if (missing.length) return { pass: false, detail: missing.join("; ") };
    return { pass: true, detail: Object.keys(REQUIRED_BUS).length + " bus codes map to actionable copy" };
  });

  T.register("describe: store-level codes reach the same actionable map end to end", async () => {
    const BS = window.BcrmStore;
    if (!BS) return { pass: true, skip: true, detail: "store not loaded" };
    const envFiles = new Map();
    const kvStore = new Map();
    const kv = {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
    const editable = {
      get: async name => { const f = envFiles.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = envFiles.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          envFiles.set(name, f);
          f.text = text;
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true, unchanged: false, superseded: false };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, created: false, unchanged: true, superseded: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false, unchanged: false, superseded: false };
      },
      files: envFiles
    };
    const store = BS.create({ ns: "er" + BS.randHex(6), kv, editable, modules: ["companies"] });
    const d1 = await store.saveDoc("companies", { records: [{ id: "c-1", name: "Acme" }] });
    const file = envFiles.get(store.fileName("companies"));
    await editable.set(store.fileName("companies"), "### corrupt ###", { editKey: file.key });
    const r = await store.saveDoc("companies", { records: [{ id: "c-1" }, { id: "c-2" }] });
    if (!r || r.ok || (r.code !== "corrupt_head" && r.code !== "schema_mismatch")) return { pass: false, detail: "expected corrupt refusal, got " + JSON.stringify(r) };
    const msg = U.describeError(r, "companies");
    if (!msg || msg === GENERIC || msg.length < 40 || !hasToken(msg, ["backup", "restore", "recover", "dashboard"])) return { pass: false, detail: "corrupt refusal does not map to recovery copy: " + msg };
    return { pass: true, detail: "store corruption surfaces through describeError with recovery steps" };
  });
})();
