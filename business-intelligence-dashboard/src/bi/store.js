/* ============================================================
   BI canonical document store — versioned JSON documents under
   the BI's own storage namespace, with locally cached edit keys
   and a fast local cache.

   Model: every document is a versioned envelope
     { schema:"bi/doc/v1", id, kind, label, meta, data,
       version, editCount, createdAt, updatedAt, updatedByDevice }
   persisted as one editable text file named  <nsPrefix><id>  in
   the generator's editable namespace (upload-plugin). Edit keys
   are cached in localStorage and never leave the device except
   via exportEditKeys() / importEditKeys().

   Modes
     remote    — editable host available; writes go to the cloud.
     localOnly — generator unsaved / editable unavailable; writes
                 hit the local cache and sync once the generator
                 is saved (a later write promotes the doc).

   Guarantees (roadmap task 2)
     - Versioned: every committed change bumps `version`; the
       version travels inside the document so it survives reads.
     - Fast local cache: list()/get() read localStorage synchronously.
     - Survives across devices and reloads (canonical copy on the
       editable host, edit keys cached per device).
     - No write ever exceeds the storage ceiling (default 1 MiB,
       configurable via biConfig.store.ceilingBytes).
     - Idempotent: writing unchanged data is a free no-op.
     - Never silently clobbers: refuses when the remote document
       is newer than the local cache (remote_newer) and parks the
       local edit as pending.

   Sync & conflict handling (roadmap task 3)
     - Boot reconciles the cache vs the canonical docs (reconcileAll).
     - Two-device edits surface as resolvable conflicts; nothing is
       overwritten or discarded without an explicit keep-mine /
       keep-theirs / field-merge decision (resolve()).
     - Every decision is recorded in a capped audit trail.
     - Cross-device discovery via an internal _registry document that
       lists every canonical doc (best-effort; never blocks writes).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const store = (BI.store = {});

  const SCHEMA = "bi/doc/v1";
  const KEYS_SCHEMA = "bi/editkeys/v1";
  const KINDS = ["report", "dashboard", "metricCatalog", "settings", "backup", "archive", "view", "schedule"];
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
  const DEFAULT_CEILING = 1048576;
  const REGISTRY_ID = "_registry"; /* internal doc listing every canonical doc, for cross-device discovery */

  const cfg = {
    ceilingBytes: DEFAULT_CEILING,
    mode: "unknown",          // "unknown" | "remote" | "localOnly"
    nsPrefix: "bi1-",
    lsPrefix: "bi.store.",    // tests isolate under their own prefix
  };
  let backend = null;

  /* ---------- localStorage helpers (namespace-scoped) ---------- */
  const K = {
    cfg: () => cfg.lsPrefix + "cfg",
    idx: () => cfg.lsPrefix + "idx",
    device: () => cfg.lsPrefix + "device",
    audit: () => cfg.lsPrefix + "audit",
    doc: (id) => cfg.lsPrefix + "doc." + id,
    key: (id) => cfg.lsPrefix + "key." + id,
  };
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  function lsRaw(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSetRaw(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch { /* noop */ } }

  /* ---------- small utils ---------- */
  function utf8(s) { try { return new TextEncoder().encode(s).length; } catch { return s.length; } }
  function jsonEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function nowISO() { return new Date().toISOString(); }
  function randHex(n) { const c = "0123456789abcdef"; let s = ""; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * 16)]; return s; }
  function safeParse(text) { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; } }
  function fmtBytes(n) { if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; return (n / 1048576).toFixed(2) + " MB"; }
  function err(code, message) { return { ok: false, error: { code, message } }; }
  function humanize(code) {
    switch (code) {
      case "editable_requires_saved_generator":
        return "The generator isn't saved yet, so documents stay local. Save the generator to publish them to the cloud store.";
      case "over_daily_allowance":
        return "The upload quota for today is used up. Try again later, or archive old documents.";
      case "file_too_big":
        return "This document is too large for the storage service. Split it up or archive content.";
      case "invalid_filetype":
        return "The storage service rejected this document's content.";
      case "upload_plugin_missing":
        return "The upload plugin isn't available on this page.";
      default:
        return code;
    }
  }

  function deviceId() {
    let d = lsRaw(K.device());
    if (!d) { d = "dev-" + randHex(16); lsSetRaw(K.device(), d); }
    return d;
  }

  function defaultNs() {
    const g = window.generatorPublicId || "";
    const seed = /^[0-9a-f]{6,}$/.test(g) ? g.slice(0, 8) : "local";
    return "bi1-" + seed + "-";
  }

  /* ---------- index (fast local catalogue) ---------- */
  function loadIndex() {
    const idx = lsGet(K.idx(), null);
    return Array.isArray(idx) ? idx : [];
  }
  function saveIndex(idx) { lsSet(K.idx(), idx); }
  function indexEntry(doc, bytes) {
    const st = doc.deleted ? "tombstoned" : doc._local && doc._local.synced === false ? "localOnly" : "synced";
    return {
      id: doc.id,
      kind: doc.kind || "",
      label: doc.label || doc.id,
      version: doc.version || 0,
      editCount: doc.editCount || 0,
      updatedAt: doc.updatedAt || "",
      bytes: bytes || 0,
      status: st,
    };
  }

  /* ---------- per-document local cache ---------- */
  function cachedDoc(id) {
    const raw = lsRaw(K.doc(id));
    if (raw == null) return null;
    const doc = safeParse(raw);
    if (!doc || doc.schema !== SCHEMA || doc.id !== id) { lsDel(K.doc(id)); return null; }
    return doc;
  }
  function saveDoc(doc, bytes) {
    lsSet(K.doc(doc.id), doc);
    const idx = loadIndex().filter((e) => e.id !== doc.id);
    idx.push(indexEntry(doc, bytes == null ? utf8(JSON.stringify(doc)) : bytes));
    saveIndex(idx);
  }
  function dropDoc(id) {
    lsDel(K.doc(id));
    saveIndex(loadIndex().filter((e) => e.id !== id));
  }
  function editKeyOf(id) { return lsRaw(K.key(id)); }
  function saveEditKey(id, k) { if (k) lsSetRaw(K.key(id), k); }
  function dropEditKey(id) { lsDel(K.key(id)); }

  /* ---------- envelope building ---------- */
  function stripLocal(doc) { const c = Object.assign({}, doc); delete c._local; return c; }
  function serialize(doc) { return JSON.stringify(stripLocal(doc)); }
  function envelope(id, opts, prev) {
    const now = nowISO();
    return {
      schema: SCHEMA,
      id,
      kind: opts.kind,
      label: opts.label != null ? String(opts.label) : id,
      meta: opts.meta || {},
      data: opts.data,
      version: (prev && prev.version ? prev.version : 0) + 1,
      editCount: prev ? prev.editCount || 0 : 0,
      createdAt: prev && prev.createdAt ? prev.createdAt : now,
      updatedAt: now,
      updatedByDevice: deviceId(),
    };
  }

  function validateCreateOpts(opts) {
    if (!opts || typeof opts !== "object") return err("invalid_args", "create() needs {id, kind, data, ...}.");
    if (!ID_RE.test(String(opts.id || ""))) return err("invalid_id", "Document id must be 1-60 chars of lowercase letters, digits and hyphens, starting with a letter or digit.");
    if (!KINDS.includes(opts.kind)) return err("invalid_kind", "kind must be one of: " + KINDS.join(", "));
    return null;
  }

  /* ---------- backend (real + injected for tests) ---------- */
  function realBackend() {
    const up = () => window.root && root.uploadPlugin;
    return {
      name: "editable",
      async create(name, text) {
        const p = up();
        if (!p || !p.editable) return { error: "upload_plugin_missing" };
        const r = await p.editable.set(name, text);
        return { error: r.error || null, editKey: r.editKey, editCount: r.editCount };
      },
      async update(name, text, editKey) {
        const p = up();
        if (!p || !p.editable) return { error: "upload_plugin_missing" };
        const r = await p.editable.set(name, text, { editKey });
        return { error: r.error || null, editCount: r.editCount, superseded: !!r.superseded };
      },
      async read(name) {
        const p = up();
        if (!p || !p.editable) return { error: "upload_plugin_missing" };
        try {
          const text = await p.editable.get(name);
          return { text };
        } catch (e) {
          const msg = String((e && e.message) || "");
          if (/saved generator/i.test(msg)) return { error: "editable_requires_saved_generator" };
          return { error: "read_failed" };
        }
      },
    };
  }

  async function readRemoteRaw(name) {
    if (!backend) return { error: "backend_missing" };
    return backend.read(name);
  }

  function storageMode() { return cfg.mode; }
  function setMode(m) { cfg.mode = m; }

  function docName(id) { return cfg.nsPrefix + (id === REGISTRY_ID ? "registry" : id); }
  function isInternalDoc(id) { return id === REGISTRY_ID; }

  /* Authoritative remote read of one document.
     Returns {ok:true, doc:envelope|null} or {ok:false, error}. */
  async function readRemote(id) {
    if (cfg.mode === "localOnly") return { ok: true, doc: null };
    const r = await readRemoteRaw(docName(id));
    if (r && r.error) {
      if (r.error === "editable_requires_saved_generator") { setMode("localOnly"); return { ok: true, doc: null }; }
      return { ok: false, error: { code: r.error, message: humanize(r.error) } };
    }
    if (r.text == null) return { ok: true, doc: null };
    const doc = safeParse(r.text);
    if (!doc || doc.schema !== SCHEMA || doc.id !== id) {
      return { ok: false, error: { code: "malformed_document", message: "The remote document '" + id + "' is not a valid BI document envelope." } };
    }
    return { ok: true, doc };
  }

  /* ============ sync, conflict & concurrency helpers (task 3) ============ */

  /* Append to the store-level audit trail (capped). Nothing is ever resolved
     without a recorded decision. */
  function audit(entry) {
    const a = lsGet(K.audit(), []);
    a.push(Object.assign({ at: nowISO(), by: deviceId() }, entry));
    if (a.length > 50) a.splice(0, a.length - 50);
    lsSet(K.audit(), a);
  }

  /* Park a refused write as a pending edit on the cached doc, so a local
     change that couldn't be pushed is never silently discarded. */
  function parkPending(id, cur, newEnv) {
    cur._local = cur._local || {};
    cur._local.pending = {
      at: nowISO(),
      by: deviceId(),
      version: newEnv.version,
      data: newEnv.data,
      label: newEnv.label,
      meta: newEnv.meta,
    };
    saveDoc(cur, cur._local.bytes || utf8(JSON.stringify(cur)));
    audit({ action: "parked_edit", id, kind: cur.kind, proposedVersion: newEnv.version });
  }

  function pendingOf(cur) { return cur && cur._local && cur._local.pending ? cur._local.pending : null; }

  function clearPending(id) {
    const cur = cachedDoc(id);
    if (cur && cur._local && cur._local.pending) {
      delete cur._local.pending;
      saveDoc(cur, cur._local.bytes || utf8(JSON.stringify(cur)));
    }
  }

  /* Replace the local cache with the remote envelope (adopt the other side). */
  function adoptRemote(id, remote) {
    const bytes = utf8(serialize(remote));
    remote._local = { bytes, synced: true };
    saveDoc(remote, bytes);
  }

  function isPlainObj(v) { return v != null && typeof v === "object" && !Array.isArray(v); }
  function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* Three-way merge of document data: ancestor = last-synced state,
     mine = parked local edit, theirs = current remote. Per-field:
     a field changed by one side wins; a field changed by both sides keeps
     mine and is reported in `conflicts` so nothing is silently dropped. */
  function threeWayMerge(ancestor, mine, theirs) {
    if (!isPlainObj(ancestor) || !isPlainObj(mine) || !isPlainObj(theirs)) {
      if (deepEqual(mine, theirs)) return { data: theirs, conflicts: [] };
      return { data: mine, conflicts: ["*"] };
    }
    const keys = new Set([...Object.keys(ancestor), ...Object.keys(mine), ...Object.keys(theirs)]);
    const out = {};
    const conflicts = [];
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    for (const k of keys) {
      const inA = has(ancestor, k), inM = has(mine, k), inT = has(theirs, k);
      if (inM && inT) {
        if (deepEqual(mine[k], theirs[k])) { out[k] = mine[k]; continue; }
        const mChanged = !inA || !deepEqual(mine[k], ancestor[k]);
        const tChanged = !inA || !deepEqual(theirs[k], ancestor[k]);
        if (mChanged && !tChanged) out[k] = mine[k];
        else if (tChanged && !mChanged) out[k] = theirs[k];
        else { out[k] = mine[k]; conflicts.push(k); }
      } else if (inM) {
        if (inA) { /* they deleted it; I kept or modified it */
          if (!deepEqual(mine[k], ancestor[k])) { out[k] = mine[k]; conflicts.push(k); }
        } else out[k] = mine[k];
      } else if (inT) {
        if (inA) { /* I deleted it; they kept or modified it */
          if (!deepEqual(theirs[k], ancestor[k])) { out[k] = theirs[k]; conflicts.push(k); }
        } else out[k] = theirs[k];
      }
    }
    return { data: out, conflicts };
  }

  /* Best-effort cross-device discovery: keep a well-known registry doc listing
     every canonical document. Failures are swallowed — a device without the
     registry's edit key simply can't update it (it can still read and write
     its own docs). Never called for the registry itself (no recursion). */
  async function updateRegistry(id, info) {
    if (id === REGISTRY_ID) return;
    try {
      const curReg = cachedDoc(REGISTRY_ID);
      const data = curReg && curReg.data && isPlainObj(curReg.data) ? JSON.parse(JSON.stringify(curReg.data)) : { docs: {} };
      data.docs = data.docs || {};
      if (info) data.docs[id] = { kind: info.kind, version: info.version, updatedAt: info.updatedAt };
      else delete data.docs[id];
      data.updatedAt = nowISO();
      if (cfg.mode === "localOnly") {
        const env = envelope(REGISTRY_ID, { kind: "settings", label: "_registry", data }, curReg);
        env._local = { bytes: utf8(serialize(env)), synced: false };
        saveDoc(env, env._local.bytes);
        return;
      }
      const rr = await readRemote(REGISTRY_ID);
      const base = rr.ok && rr.doc && !rr.doc.deleted ? rr.doc : null;
      const rdata = base && base.data && isPlainObj(base.data) ? JSON.parse(JSON.stringify(base.data)) : { docs: {} };
      rdata.docs = rdata.docs || {};
      if (info) rdata.docs[id] = { kind: info.kind, version: info.version, updatedAt: info.updatedAt };
      else delete rdata.docs[id];
      rdata.updatedAt = nowISO();
      const env = envelope(REGISTRY_ID, { kind: "settings", label: "_registry", data: rdata }, base);
      const text = serialize(env);
      const key = editKeyOf(REGISTRY_ID);
      if (!key) {
        const c = await backend.create(docName(REGISTRY_ID), text);
        if (c.error) return;
        if (c.editKey) saveEditKey(REGISTRY_ID, c.editKey);
      } else {
        const u = await backend.update(docName(REGISTRY_ID), text, key);
        if (u.error) return;
      }
      env._local = { bytes: utf8(text), synced: true };
      saveDoc(env, utf8(text));
    } catch (e) { /* best-effort only */ }
  }

  /* Shared write path for create + update. Never exceeds the ceiling,
     never clobbers a remote-newer document (unless opts.force — used only
     by deliberate restore-from-backup), writes are idempotent. */
  async function commit(id, newEnv, isCreate, force) {
    const cur = cachedDoc(id);
    const text = serialize(newEnv);
    const bytes = utf8(text);

    /* idempotent no-op: nothing semantically changed AND the doc is already
       synced (an unsynced local-only doc always needs pushing even if its
       content is unchanged) */
    if (cur && !isCreate && cur._local && cur._local.synced !== false && jsonEq(cur.data, newEnv.data) && cur.kind === newEnv.kind && cur.label === newEnv.label && jsonEq(cur.meta || {}, newEnv.meta || {})) {
      return { ok: true, changed: false, envelope: stripLocal(cur) };
    }

    /* storage ceiling — never exceeded */
    const cap = store.capacity();
    const oldBytes = cur && cur._local ? cur._local.bytes : 0;
    const newTotal = cap.usedBytes - oldBytes + bytes;
    if (newTotal > cfg.ceilingBytes) {
      return err("quota_exceeded", "This write (" + fmtBytes(newTotal) + ") would exceed the canonical store ceiling of " + fmtBytes(cfg.ceilingBytes) + ". Remove or archive documents, or raise store.ceilingBytes in biConfig.");
    }

    if (cfg.mode !== "localOnly") {
      const remote = await readRemoteRaw(docName(id));
      if (remote && remote.error) {
        if (remote.error === "editable_requires_saved_generator") { setMode("localOnly"); }
        else return { ok: false, error: { code: remote.error, message: humanize(remote.error) } };
      }
      if (cfg.mode !== "localOnly") {
        const remoteEnv = remote && remote.text != null ? safeParse(remote.text) : null;
        const validRemote = !!(remoteEnv && remoteEnv.schema === SCHEMA && remoteEnv.id === id);
        if (isCreate) {
          if (validRemote) return err("exists", "A document '" + id + "' already exists. Use update() to change it.");
        } else {
          if (remote.text != null && !validRemote) return { ok: false, error: { code: "malformed_document", message: "The remote document '" + id + "' is not a valid BI document envelope." } };
          if (remote.text == null && !(cur && cur._local && cur._local.synced === false)) {
            return err("not_found", "No remote document '" + id + "' exists. It may have been deleted on another device.");
          }
          if (validRemote && !remoteEnv.deleted && cur && remoteEnv.version > (cur.version || 0) && !force) {
            parkPending(id, cur, newEnv);
            return {
              ok: false,
              error: {
                code: "remote_newer",
                conflict: true,
                message: "Document '" + id + "' was changed on another device (remote version " + remoteEnv.version + " vs local " + (cur.version || 0) + "). Your change is kept as a pending edit — resolve with BI.store.resolve(id, 'mine' | 'theirs' | 'field').",
              },
            };
          }
        }

        const key = editKeyOf(id);
        const needCreate = isCreate || remote.text == null;
        let r;
        if (needCreate) {
          r = await backend.create(docName(id), text);
          if (r.error) {
            if (r.error === "editable_requires_saved_generator") { setMode("localOnly"); }
            else return { ok: false, error: { code: r.error, message: humanize(r.error) } };
          } else {
            if (r.editKey) saveEditKey(id, r.editKey);
            if (r.editCount != null) newEnv.editCount = r.editCount;
          }
        } else {
          if (!key) return err("need_edit_key", "No edit key for '" + id + "' on this device. Export edit keys from the device that created this document, then import them here.");
          r = await backend.update(docName(id), text, key);
          if (r.error) {
            if (r.error === "editable_requires_saved_generator") { setMode("localOnly"); }
            else if (r.error === "invalid_edit_key") return err("invalid_edit_key", "Edit key mismatch for '" + id + "'. Import the correct key from the creating device.");
            else if (r.error === "not_found") return err("not_found", "Remote document '" + id + "' no longer exists.");
            else return { ok: false, error: { code: r.error, message: humanize(r.error) } };
          }
          if (r.editCount != null) newEnv.editCount = r.editCount;
        }
        if (cfg.mode !== "localOnly") {
          setMode("remote");
          await updateRegistry(id, { kind: newEnv.kind, version: newEnv.version, updatedAt: newEnv.updatedAt });
        }
      }
    }

    newEnv._local = { bytes, synced: cfg.mode !== "localOnly" };
    saveDoc(newEnv, bytes);
    return { ok: true, changed: true, envelope: stripLocal(newEnv) };
  }

  /* ============================ public API ============================ */

  store.deviceId = deviceId;
  store.storageMode = storageMode;
  store.docName = docName;

  store.init = function (opts) {
    opts = opts || {};
    cfg.lsPrefix = "bi.store.";
    const saved = lsGet(K.cfg(), null);
    cfg.ceilingBytes = (opts.ceilingBytes > 0 && opts.ceilingBytes) || (saved && saved.ceilingBytes) || DEFAULT_CEILING;
    cfg.nsPrefix = opts.nsPrefix || (saved && saved.nsPrefix) || defaultNs();
    cfg.mode = window.generatorIsUnsaved === true ? "localOnly" : "unknown";
    backend = realBackend();
    deviceId();
    lsSet(K.cfg(), { ceilingBytes: cfg.ceilingBytes, nsPrefix: cfg.nsPrefix });
    return store.status();
  };

  store.list = function () {
    return loadIndex().slice().filter((e) => e.id !== REGISTRY_ID).sort((a, b) => a.id.localeCompare(b.id));
  };

  store.get = function (id) {
    const d = cachedDoc(id);
    return d ? stripLocal(d) : null;
  };

  store.exists = function (id) { return !!cachedDoc(id); };

  store.capacity = function () {
    const idx = loadIndex().filter((e) => e.id !== REGISTRY_ID);
    const live = idx.filter((e) => e.status !== "tombstoned");
    const usedBytes = live.reduce((s, e) => s + (e.bytes || 0), 0);
    return {
      usedBytes,
      docCount: live.length,
      ceilingBytes: cfg.ceilingBytes,
      pct: cfg.ceilingBytes ? usedBytes / cfg.ceilingBytes : 0,
      docs: idx.map((e) => ({ id: e.id, kind: e.kind, bytes: e.bytes, status: e.status })),
    };
  };

  store.status = function () {
    const cap = store.capacity();
    return {
      mode: cfg.mode,
      deviceId: deviceId(),
      namespace: cfg.nsPrefix,
      ceilingBytes: cfg.ceilingBytes,
      usedBytes: cap.usedBytes,
      docCount: cap.docCount,
      pct: cap.pct,
      backend: backend ? backend.name : null,
    };
  };

  store.create = async function (opts) {
    const v = validateCreateOpts(opts);
    if (v) return v;
    if (store.exists(opts.id)) return err("exists", "A document '" + opts.id + "' already exists. Use update() to change it.");
    return commit(opts.id, envelope(opts.id, opts, null), true);
  };

  store.update = async function (id, data, opts) {
    opts = opts || {};
    const cur = cachedDoc(id);
    if (!cur) return err("not_found", "No document '" + id + "' in the local store. Refresh or create it first.");
    if (opts.baseVersion != null && cur.version !== opts.baseVersion) {
      return err("version_conflict", "Document '" + id + "' is version " + cur.version + " but you expected " + opts.baseVersion + ". It changed since you loaded it — refresh and resolve.");
    }
    const prev = stripLocal(cur);
    const env = envelope(id, { kind: cur.kind, label: opts.label != null ? opts.label : cur.label, data, meta: opts.meta !== undefined ? opts.meta : cur.meta }, prev);
    return commit(id, env, false, opts.force === true);
  };

  /* Change a document's kind (used by Capacity archival: report/dashboard →
     archive, and back again). The previous kind is recorded in meta.originalKind
     so unarchive can restore it. Version chain and edit count are preserved. */
  store.changeKind = async function (id, newKind) {
    if (!KINDS.includes(newKind)) return err("invalid_kind", "kind must be one of: " + KINDS.join(", "));
    const cur = cachedDoc(id);
    if (!cur) return err("not_found", "No document '" + id + "' to re-classify.");
    const meta = Object.assign({}, cur.meta || {});
    if (newKind === "archive") meta.originalKind = cur.kind;
    else delete meta.originalKind;
    const prev = stripLocal(cur);
    const env = envelope(id, { kind: newKind, label: cur.label, data: cur.data, meta }, prev);
    return commit(id, env, false, false);
  };

  store.remove = async function (id) {
    const cur = cachedDoc(id);
    if (!cur) return err("not_found", "No document '" + id + "' to remove.");
    const tomb = {
      schema: SCHEMA,
      id,
      deleted: true,
      kind: cur.kind,
      label: cur.label,
      version: cur.version || 0,
      deletedAt: nowISO(),
      deletedByDevice: deviceId(),
    };
    if (cfg.mode !== "localOnly") {
      const key = editKeyOf(id);
      if (key) {
        const r = await backend.update(docName(id), serialize(tomb), key);
        if (r.error && r.error !== "editable_requires_saved_generator" && r.error !== "not_found") {
          return { ok: false, error: { code: r.error, message: humanize(r.error) } };
        }
        if (r.error === "editable_requires_saved_generator") setMode("localOnly");
        else await updateRegistry(id, null);
      }
    }
    clearPending(id);
    dropDoc(id);
    audit({ action: "removed", id, kind: cur.kind, version: cur.version });
    return { ok: true, removed: true, id };
  };

  /* authoritative remote read + cache reconciliation */
  store.readRemote = readRemote;

  store.refresh = async function (id) {
    const r = await readRemote(id);
    if (!r.ok) return r;
    if (r.doc) {
      if (r.doc.deleted) {
        const old = cachedDoc(id);
        if (old && old._local && old._local.pending) {
          /* a parked local edit exists — don't drop it; reconcile() will surface it */
          return { ok: true, doc: stripLocal(old), remoteDeleted: true };
        }
        dropDoc(id);
        return { ok: true, doc: null, deleted: true };
      }
      const old = cachedDoc(id);
      const pending = pendingOf(old);
      const bytes = utf8(serialize(r.doc));
      r.doc._local = { bytes, synced: true };
      if (pending) {
        r.doc._local.pending = pending;
        audit({ action: "preserved_pending_on_refresh", id });
      }
      saveDoc(r.doc, bytes);
      return { ok: true, doc: stripLocal(r.doc) };
    }
    const local = cachedDoc(id);
    if (local) return { ok: true, doc: stripLocal(local), remoteAbsent: true };
    return { ok: true, doc: null };
  };

  store.refreshAll = async function () {
    const ids = loadIndex().map((e) => e.id).filter((id) => id !== REGISTRY_ID);
    const out = [];
    for (const id of ids) out.push({ id, ...(await store.refresh(id)) });
    return out;
  };

  /* ============ sync / conflict resolution API (task 3) ============ */

  store.audit = function () { return lsGet(K.audit(), []); };

  /* Reconcile one document against its canonical (remote) copy. Never
     overwrites either side without a decision; parks nothing silently. */
  store.reconcile = async function (id) {
    if (cfg.mode === "localOnly") return { ok: true, id, state: "localOnly" };
    const cur = cachedDoc(id);
    const rr = await readRemote(id);
    if (!rr.ok) return rr;
    const remote = rr.doc;
    const pending = pendingOf(cur);

    if (!remote || remote.deleted) {
      if (!cur) return { ok: true, id, state: "none" };
      if (pending) {
        audit({ action: "conflict", id, kind: cur.kind, reason: "local_edit_vs_remote_deletion", local: cur.version, remote: null });
        return { ok: true, id, state: "conflict", reason: "local_edit_vs_remote_deletion", local: cur.version, remote: null };
      }
      if (cur._local && cur._local.synced === false) {
        /* an offline-created doc that was never pushed — publish it now that
           the remote store is reachable (the remote copy is absent) */ 
        if (!remote) {
          const env = envelope(id, { kind: cur.kind, label: cur.label, data: cur.data, meta: cur.meta || {} }, cur);
          const w = await commit(id, env, false);
          if (w.ok) { audit({ action: "promoted", id, version: env.version }); return { ok: true, id, state: "pushed", promoted: true }; }
          return { ok: true, id, state: "error", error: w.error };
        }
        /* remote tombstoned while this local copy never synced — keep it, never
           silently discard a real local document */
        return { ok: true, id, state: "localOnly_doc" };
      }
      dropDoc(id);
      audit({ action: "adopted_deletion", id });
      return { ok: true, id, state: "adopted_deletion" };
    }

    if (!cur) {
      adoptRemote(id, remote);
      audit({ action: "discovered", id, kind: remote.kind, version: remote.version });
      return { ok: true, id, state: "adopted" };
    }

    if (remote.version === cur.version) {
      if (pending) {
        const env = envelope(id, { kind: cur.kind, label: pending.label != null ? pending.label : cur.label, data: pending.data, meta: pending.meta !== undefined ? pending.meta : cur.meta }, cur);
        const w = await commit(id, env, false);
        clearPending(id);
        audit({ action: "pushed_pending", id, version: w.ok ? env.version : null });
        return { ok: true, id, state: w.ok ? "pushed" : "error", error: w.error };
      }
      return { ok: true, id, state: "in_sync" };
    }

    if (remote.version > cur.version) {
      if (pending) {
        audit({ action: "conflict", id, kind: cur.kind, reason: "both_sides_changed", local: cur.version, remote: remote.version });
        return { ok: true, id, state: "conflict", reason: "both_sides_changed", local: cur.version, remote: remote.version };
      }
      adoptRemote(id, remote);
      audit({ action: "fast_forward", id, from: cur.version, to: remote.version });
      return { ok: true, id, state: "fast_forward" };
    }

    /* remote rolled back / tampered with a lower version */
    if (pending) {
      audit({ action: "conflict", id, reason: "remote_rolled_back", local: cur.version, remote: remote.version });
      return { ok: true, id, state: "conflict", reason: "remote_rolled_back", local: cur.version, remote: remote.version };
    }
    adoptRemote(id, remote);
    audit({ action: "adopted_rollback", id, from: cur.version, to: remote.version });
    return { ok: true, id, state: "adopted_rollback" };
  };

  /* Reconcile every known doc, plus any doc discovered via the registry.
     Returns a summary of states and the list of unresolved conflicts. */
  store.reconcileAll = async function () {
    if (cfg.mode === "localOnly") {
      const ids = loadIndex().map((e) => e.id);
      const out = [];
      for (const id of ids) out.push(await store.reconcile(id));
      return { ok: true, scanned: out, conflicts: [], summary: { localOnly: out.length } };
    }
    const ids = new Set(loadIndex().map((e) => e.id).filter((id) => id !== REGISTRY_ID));
    const rreg = await readRemote(REGISTRY_ID);
    if (rreg.ok && rreg.doc && !rreg.doc.deleted && rreg.doc.data && rreg.doc.data.docs) {
      for (const d of Object.keys(rreg.doc.data.docs)) ids.add(d);
    }
    const out = [];
    for (const id of ids) out.push(await store.reconcile(id));
    const conflicts = out.filter((o) => o.state === "conflict");
    const summary = out.reduce((m, o) => { m[o.state] = (m[o.state] || 0) + 1; return m; }, {});
    audit({ action: "reconcile", scanned: out.length, conflicts: conflicts.length, summary });
    return { ok: true, scanned: out, conflicts, summary };
  };

  /* Currently unresolved conflicts (docs with a parked edit whose remote is
     newer) — the list the UI renders resolution options from. */
  store.pendingConflicts = function () {
    return loadIndex()
      .filter((e) => e.id !== REGISTRY_ID && e.status !== "tombstoned")
      .map((e) => cachedDoc(e.id))
      .filter((d) => d && pendingOf(d))
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        localVersion: d.version,
        pendingAt: d._local.pending.at,
        pendingData: d._local.pending.data,
      }));
  };

  /* Per-document sync state (for the Data Sources view / future UI). */
  store.syncStatus = function () {
    return loadIndex()
      .filter((e) => e.id !== REGISTRY_ID)
      .map((e) => {
        const d = cachedDoc(e.id);
        return { id: e.id, kind: e.kind, label: e.label, version: e.version, status: e.status, pending: !!pendingOf(d), updatedAt: e.updatedAt };
      });
  };

  /* Resolve a conflict. strategy: "mine" (push the parked edit on top of the
     latest remote), "theirs" (adopt the remote, drop the parked edit), or
     "field" (three-way merge, reporting per-field conflicts). Every decision
     is recorded in the audit trail; the losing side is never dropped without
     the caller choosing to. */
  store.resolve = async function (id, strategy) {
    strategy = strategy || "mine";
    const cur = cachedDoc(id);
    const pend = pendingOf(cur);
    if (!cur || !pend) return err("no_conflict", "No pending edit for '" + id + "' to resolve.");
    const pendData = pend.data, pendLabel = pend.label, pendMeta = pend.meta;

    if (cfg.mode === "localOnly") {
      const env = envelope(id, { kind: cur.kind, label: pendLabel != null ? pendLabel : cur.label, data: pendData, meta: pendMeta !== undefined ? pendMeta : cur.meta }, cur);
      clearPending(id);
      env._local = { bytes: utf8(serialize(env)), synced: false };
      saveDoc(env, env._local.bytes);
      audit({ action: "resolved", id, strategy, applied: "local" });
      return { ok: true, strategy, applied: "local", envelope: stripLocal(env) };
    }

    const rr = await readRemote(id);
    if (!rr.ok) return rr;
    const remote = rr.doc;
    const remoteLive = !!(remote && !remote.deleted);

    if (strategy === "theirs") {
      if (remoteLive) adoptRemote(id, remote);
      else dropDoc(id);
      clearPending(id);
      audit({ action: "resolved", id, strategy, applied: remoteLive ? "adopted_remote" : "deleted", supersededVersion: remoteLive ? remote.version : null });
      return { ok: true, strategy, applied: remoteLive ? "adopted_remote" : "deleted", envelope: store.get(id) };
    }

    let data = pendData;
    const fieldConflicts = [];
    if (strategy === "field" && remoteLive) {
      const m = threeWayMerge(cur.data, pendData, remote.data);
      data = m.data;
      fieldConflicts.push(...m.conflicts);
    }
    if (remoteLive) {
      adoptRemote(id, remote);
      const adopted = cachedDoc(id);
      const env = envelope(id, { kind: adopted.kind, label: pendLabel != null ? pendLabel : adopted.label, data, meta: pendMeta !== undefined ? pendMeta : adopted.meta }, adopted);
      const w = await commit(id, env, false);
      if (!w.ok) return w;
      clearPending(id);
      audit({ action: "resolved", id, strategy, applied: "pushed", supersededVersion: remote.version, fieldConflicts });
      return { ok: true, strategy, applied: "pushed", conflicts: fieldConflicts, envelope: w.envelope };
    }
    /* remote deleted/absent — write the resolution on top of whatever remains;
       version must exceed anything the deleted remote had (tombstone.version)
       so other devices fast-forward instead of mistaking it for their copy */
    const prev = Object.assign({}, cur, { version: Math.max(cur.version || 0, (remote && remote.version) || 0) });
    const env = envelope(id, { kind: cur.kind, label: pendLabel != null ? pendLabel : cur.label, data, meta: pendMeta !== undefined ? pendMeta : cur.meta }, prev);
    const w = await commit(id, env, false);
    if (!w.ok) return w;
    clearPending(id);
    audit({ action: "resolved", id, strategy, applied: "restored", fieldConflicts });
    return { ok: true, strategy, applied: "restored", envelope: w.envelope };
  };

  /* Conflict-resolution UI widget: renders a card per unresolved conflict with
     Keep mine / Keep theirs / Field-merge actions. Reusable by any module. */
  store.ui = {
    renderConflictPanel(ctn, opts) {
      opts = opts || {};
      const conflicts = store.pendingConflicts();
      if (!conflicts.length) {
        ctn.innerHTML = "";
        return { count: 0 };
      }
      const wrap = document.createElement("div");
      wrap.className = "bi-conflicts";
      const head = document.createElement("div");
      head.className = "bi-conflicts-head";
      head.innerHTML = BI.icon("alert", 18) + "<span>Document conflicts need resolving</span>";
      wrap.appendChild(head);
      for (const c of conflicts) {
        const card = document.createElement("div");
        card.className = "bi-conflict";
        const info = document.createElement("div");
        info.className = "bi-conflict-info";
        info.innerHTML = "<strong>" + BI.esc(c.label || c.id) + "</strong><span class=\"bi-conflict-meta\">" + BI.esc(c.kind) + " · local v" + c.localVersion + " vs remote newer · pending edit from " + BI.esc(new Date(c.pendingAt).toLocaleString()) + "</span>";
        card.appendChild(info);
        const acts = document.createElement("div");
        acts.className = "bi-conflict-actions";
        const mk = (label, kind, strat) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "bi-btn " + kind;
          b.textContent = label;
          b.addEventListener("click", async () => {
            const res = await store.resolve(c.id, strat);
            if (res.ok) {
              BI.ui.toast("Resolved '" + (c.label || c.id) + "' (" + strat + ")", "success");
              if (opts.onResolved) opts.onResolved(res);
              store.ui.renderConflictPanel(ctn, opts);
            } else {
              BI.ui.toast((res.error && res.error.message) || "Could not resolve", "error");
            }
          });
          return b;
        };
        acts.appendChild(mk("Keep mine", "bi-btn-primary", "mine"));
        acts.appendChild(mk("Keep theirs", "bi-btn-ghost", "theirs"));
        acts.appendChild(mk("Field-merge", "bi-btn-ghost", "field"));
        card.appendChild(acts);
        wrap.appendChild(card);
      }
      ctn.innerHTML = "";
      ctn.appendChild(wrap);
      return { count: conflicts.length };
    },
  };

  /* edit-key transfer between devices (used by backup & restore) */
  store.exportEditKeys = function () {
    const keys = {};
    try {
      const pfx = cfg.lsPrefix + "key.";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(pfx) === 0) keys[k.slice(pfx.length)] = localStorage.getItem(k);
      }
    } catch { /* noop */ }
    return { schema: KEYS_SCHEMA, deviceId: deviceId(), exportedAt: nowISO(), keys };
  };

  store.importEditKeys = function (obj) {
    if (!obj || obj.schema !== KEYS_SCHEMA || !obj.keys || typeof obj.keys !== "object") {
      return { ok: false, error: { code: "invalid_keys", message: "Not a valid BI edit-keys export." } };
    }
    let n = 0;
    for (const id of Object.keys(obj.keys)) {
      const k = obj.keys[id];
      if (typeof k === "string" && k) { saveEditKey(id, k); n++; }
    }
    return { ok: true, imported: n };
  };

  /* test / debug hooks — used by src/bi/tests/store.js */
  store.debugBackend = function (b) { backend = b || realBackend(); return store.status(); };
  store.debugReset = function (opts) {
    opts = opts || {};
    cfg.lsPrefix = opts.lsPrefix || "bi.store.";
    const doomed = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(cfg.lsPrefix) === 0) doomed.push(k); } } catch { /* noop */ }
    if (opts.wipe !== false) for (const k of doomed) lsDel(k);
    cfg.ceilingBytes = opts.ceilingBytes || DEFAULT_CEILING;
    cfg.nsPrefix = opts.nsPrefix || defaultNs();
    cfg.mode = opts.mode === "localOnly" ? "localOnly" : "unknown";
    backend = opts.backend || backend || realBackend();
    if (opts.deviceId) lsSetRaw(K.device(), opts.deviceId);
    lsSet(K.cfg(), { ceilingBytes: cfg.ceilingBytes, nsPrefix: cfg.nsPrefix });
    return store.status();
  };
})();
