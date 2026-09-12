/* ============================================================
   RMM-U — system inventory collection  (Phase 2 · Task 9)

   Inventory is the "what is actually on this endpoint" half of the
   device record, and it is big: installed software, services, patches,
   volumes, network interfaces, local users and groups, security/AV
   posture and backup status. Sending the whole thing on every
   collection would flood the channel and bloat storage, so the model
   here is DELTA-FIRST:

     • A device's first collection is a full snapshot (there is no
       baseline yet). Every collection after that is reduced to a
       per-section delta — added / removed / changed — against the
       last known state, and only the delta crosses the wire.
     • The engine can do both ends: `INV.diff(prev, next)` reduces two
       full inventories to a delta (the agent side), and
       `INV.apply(prev, delta)` reconstructs the full state from a
       baseline + delta (the collector side). `INV.submit` accepts
       either a full payload or a delta payload and keeps the stored
       snapshot current either way.
     • Storage is bounded by design: one snapshot per device, plus a
       capped per-device delta log (config.rmm.inventoryDeltaLimit).
       Software arrays are capped (config.rmm.inventorySoftwareCap).

   This is the console/core implementation. The Phase-3 collector
   (Task 14) mirrors the same submit/authenticate rules server-side;
   the agent installer (src/rmm.agent.js) collects the raw inventory
   and calls `INV.agentPayload` to decide full-vs-delta.

   Records live in the hidden `inventory` document (rmm-v1-inventory):
     { kind:"snapshot", id:"snap-<deviceId>", deviceId, providerId,
       revision, at, hash, counts{}, sections{...} }
     { kind:"delta", id, deviceId, providerId, at, fromRevision,
       toRevision, changed, counts{}, sections{} }

   window.ERP.rmmInventory is the service (namespaced to avoid the ERP
   stock/inventory module which owns window.ERP.inventory).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const INV = (ERP.rmmInventory = {});

  INV.MODULE = "inventory";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d || 0); };
  const now = () => new Date().toISOString();
  const rid = (p) => p + "-" + Math.random().toString(36).slice(2, 10);
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200).trim();
  const L = (v) => S(v, 200).toLowerCase();

  function bool(v) {
    if (v === true || v === false) return v;
    if (v == null || v === "") return null;
    if (typeof v === "number") return v !== 0;
    const s = String(v).toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on" || s === "ok") return true;
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
    return null;
  }
  function dateOrEmpty(v) {
    if (!v) return "";
    const t = Date.parse(v);
    return isFinite(t) ? new Date(t).toISOString() : S(v, 40);
  }

  INV.DELTA_LIMIT = () => Math.max(1, num(cfg("rmm.inventoryDeltaLimit", 25), 25));
  INV.SOFTWARE_CAP = () => Math.max(10, num(cfg("rmm.inventorySoftwareCap", 500), 500));
  INV.CHANGE_CAP = 200;
  INV.ARRAY_CAP = 2000;

  /* ── section taxonomy ── */
  INV.SCALAR_SECTIONS = ["hardware", "os", "security", "backup"];
  INV.ARRAY_SECTIONS = ["software", "services", "patches", "disks", "interfaces", "users", "groups"];
  INV.SECTIONS = INV.SCALAR_SECTIONS.concat(INV.ARRAY_SECTIONS);
  INV.sectionLabel = function (s) {
    return {
      hardware: "Hardware", os: "Operating system", software: "Installed software", services: "Services",
      patches: "Patches & updates", disks: "Disks & volumes", interfaces: "Network interfaces",
      users: "Local users", groups: "Local groups", security: "Security & anti-malware", backup: "Backup status",
    }[s] || s;
  };

  /* ─────────────────────── normalisation ─────────────────────── */

  function normHardware(x) {
    x = asObj(x);
    const cpu = asObj(x.cpu);
    return {
      manufacturer: S(x.manufacturer, 120),
      model: S(x.model, 160),
      serial: S(x.serial, 120),
      formFactor: S(x.formFactor, 40),
      cpu: { model: S(cpu.model, 160), cores: num(cpu.cores, 0), threads: num(cpu.threads, 0), speedMhz: num(cpu.speedMhz, 0) },
      ramBytes: Math.max(0, num(x.ramBytes, 0)),
      gpus: asArr(x.gpus).slice(0, 8).map((g) => ({ model: S(asObj(g).model, 120), memoryBytes: Math.max(0, num(asObj(g).memoryBytes, 0)) })),
    };
  }
  function normOs(x) {
    x = asObj(x);
    const family = x.family ? S(x.family, 40) : "";
    return {
      family, name: S(x.name, 160), version: S(x.version, 60), build: S(x.build, 60),
      edition: S(x.edition, 80), arch: S(x.arch, 40),
      installDate: dateOrEmpty(x.installDate), lastBootAt: dateOrEmpty(x.lastBootAt),
    };
  }
  function normSoftware(x) {
    x = asObj(x);
    return {
      name: S(x.name, 200), version: S(x.version, 80), publisher: S(x.publisher, 160),
      installDate: dateOrEmpty(x.installDate), sizeBytes: Math.max(0, num(x.sizeBytes, 0)),
    };
  }
  function normService(x) {
    x = asObj(x);
    return { name: S(x.name, 160), displayName: S(x.displayName, 200), state: L(x.state) || "unknown", startType: S(x.startType, 40), account: S(x.account, 120) };
  }
  function normPatch(x) {
    x = asObj(x);
    return { id: S(x.id || x.kb, 80), title: S(x.title, 240), classification: S(x.classification, 80), installedOn: dateOrEmpty(x.installedOn) };
  }
  function normDisk(x) {
    x = asObj(x);
    return { label: S(x.label, 80), kind: S(x.kind, 40), sizeBytes: Math.max(0, num(x.sizeBytes, 0)), freeBytes: Math.max(0, num(x.freeBytes, 0)), filesystem: S(x.filesystem, 40) };
  }
  function normInterface(x) {
    x = asObj(x);
    return {
      name: S(x.name, 120), mac: S(x.mac, 60).toLowerCase(),
      ip4: asArr(x.ip4).map((v) => S(v, 60)).sort(), ip6: asArr(x.ip6).map((v) => S(v, 120)).sort(),
      subnet: S(x.subnet, 60), gateway: S(x.gateway, 60), dhcp: bool(x.dhcp), speedMbps: Math.max(0, num(x.speedMbps, 0)),
    };
  }
  function normUser(x) {
    x = asObj(x);
    return { name: S(x.name, 120), domain: S(x.domain, 120), enabled: bool(x.enabled), lastLogon: dateOrEmpty(x.lastLogon), admin: bool(x.admin) };
  }
  function normGroup(x) {
    x = asObj(x);
    return { name: S(x.name, 120), members: asArr(x.members).map((m) => S(m, 120)).sort(), admin: bool(x.admin) };
  }
  function normSecurity(x) {
    x = asObj(x);
    const fw = asObj(x.firewall), enc = asObj(x.encryption), def = asObj(x.defender), tpm = asObj(x.tpm);
    return {
      antivirus: asArr(x.antivirus).slice(0, 20).map((a) => ({ name: S(asObj(a).name, 120), enabled: bool(asObj(a).enabled), upToDate: bool(asObj(a).upToDate) })),
      firewall: { enabled: bool(fw.enabled), profiles: asArr(fw.profiles).slice(0, 8).map((p) => ({ name: S(asObj(p).name, 60), enabled: bool(asObj(p).enabled) })) },
      encryption: { systemDrive: bool(enc.systemDrive), method: S(enc.method, 60), percentEncrypted: enc.percentEncrypted == null ? null : Math.max(0, Math.min(100, num(enc.percentEncrypted, 0))) },
      defender: { realtimeEnabled: bool(def.realtimeEnabled), signatureAgeDays: def.signatureAgeDays == null ? null : Math.max(0, num(def.signatureAgeDays, 0)), tamperProtection: bool(def.tamperProtection) },
      secureBoot: bool(x.secureBoot),
      tpm: { present: bool(tpm.present), version: S(tpm.version, 20), enabled: bool(tpm.enabled) },
      pendingReboot: bool(x.pendingReboot),
    };
  }
  const BACKUP_STATES = ["ok", "warning", "failed", "running", "not-configured", "unknown"];
  function normBackup(x) {
    x = asObj(x);
    const st = L(x.status);
    return { status: BACKUP_STATES.indexOf(st) !== -1 ? st : (st ? "unknown" : "unknown"), lastRunAt: dateOrEmpty(x.lastRunAt), lastResult: S(x.lastResult, 160), provider: S(x.provider, 120), nextRunAt: dateOrEmpty(x.nextRunAt) };
  }

  INV.normalize = function (raw) {
    raw = asObj(raw);
    const next = {
      hardware: normHardware(raw.hardware),
      os: normOs(raw.os),
      software: asArr(raw.software).map(normSoftware).slice(0, INV.SOFTWARE_CAP()),
      services: asArr(raw.services).map(normService).slice(0, INV.ARRAY_CAP),
      patches: asArr(raw.patches).map(normPatch).slice(0, INV.ARRAY_CAP),
      disks: asArr(raw.disks).map(normDisk).slice(0, 64),
      interfaces: asArr(raw.interfaces).map(normInterface).slice(0, 64),
      users: asArr(raw.users).map(normUser).slice(0, 500),
      groups: asArr(raw.groups).map(normGroup).slice(0, 500),
      security: normSecurity(raw.security),
      backup: normBackup(raw.backup),
    };
    /* deterministic order so two identical inventories compare equal */
    ["software", "services", "patches", "disks", "interfaces", "users", "groups"].forEach((s) => {
      next[s].sort((a, b) => INV.keyFor(s, a).localeCompare(INV.keyFor(s, b)));
    });
    return next;
  };

  INV.keyFor = function (section, item) {
    const x = asObj(item);
    if (section === "software") return L((x.publisher || "") + "|" + (x.name || ""));
    if (section === "services") return L(x.name);
    if (section === "patches") return L(x.id || x.title);
    if (section === "disks") return L(x.label);
    if (section === "interfaces") return L(x.name || x.mac);
    if (section === "users") return L((x.domain || "") + "\\" + (x.name || ""));
    if (section === "groups") return L(x.name);
    return L(JSON.stringify(x));
  };

  INV.itemLabel = function (section, item) {
    const x = asObj(item);
    if (section === "software") return S(x.name, 200) + (x.version ? " " + x.version : "");
    if (section === "services") return S(x.displayName || x.name, 200);
    if (section === "patches") return S(x.title || x.id, 240);
    if (section === "disks") return S(x.label, 80);
    if (section === "interfaces") return S(x.name, 120);
    if (section === "users") return S((x.domain ? x.domain + "\\" : "") + x.name, 200);
    if (section === "groups") return S(x.name, 120);
    return S(JSON.stringify(x), 120);
  };

  /* ─────────────────────── hashing ─────────────────────── */

  function stableStringify(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  INV.stableStringify = stableStringify;

  INV.hashOf = function (snapshot) {
    const s = asObj(snapshot);
    const str = stableStringify({
      hardware: s.hardware, os: s.os, security: s.security, backup: s.backup,
      software: s.software, services: s.services, patches: s.patches, disks: s.disks,
      interfaces: s.interfaces, users: s.users, groups: s.groups,
    });
    /* FNV-1a 32-bit over the canonical string, hex padded */
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ("00000000" + (h >>> 0).toString(16)).slice(-8);
  };

  /* ─────────────────────── diff / apply ─────────────────────── */

  /* Reduce two full inventories to a per-section delta. Only changed
     sections/items appear. Change lists are capped at CHANGE_CAP with a
     truncation flag so a huge first-time reconcile can never blow the
     document. prev may be null (treats everything as added). */
  INV.diff = function (prev, next) {
    const before = prev ? INV.normalize(prev) : null;
    const after = INV.normalize(next);
    const sections = {};
    const counts = { added: 0, removed: 0, changed: 0 };

    INV.SCALAR_SECTIONS.forEach((sec) => {
      const b = before ? before[sec] : null;
      const a = after[sec];
      if (!b || stableStringify(b) !== stableStringify(a)) {
        const fields = [];
        Object.keys(a).forEach((k) => { if (!b || stableStringify(b[k]) !== stableStringify(a[k])) fields.push(k); });
        if (b) Object.keys(b).forEach((k) => { if (!(k in a) && fields.indexOf(k) === -1) fields.push(k); });
        sections[sec] = { fields: fields, before: b, after: a };
      }
    });

    INV.ARRAY_SECTIONS.forEach((sec) => {
      const bMap = new Map();
      (before ? before[sec] : []).forEach((it) => bMap.set(INV.keyFor(sec, it), it));
      const aMap = new Map();
      after[sec].forEach((it) => aMap.set(INV.keyFor(sec, it), it));
      const added = [], removed = [], changed = [];
      aMap.forEach((it, k) => { if (!bMap.has(k)) added.push(it); else if (stableStringify(bMap.get(k)) !== stableStringify(it)) changed.push({ key: k, label: INV.itemLabel(sec, it), before: bMap.get(k), after: it }); });
      bMap.forEach((it, k) => { if (!aMap.has(k)) removed.push(it); });
      if (!added.length && !removed.length && !changed.length) return;
      counts.added += added.length; counts.removed += removed.length; counts.changed += changed.length;
      const entry = { counts: { added: added.length, removed: removed.length, changed: changed.length } };
      const cap = INV.CHANGE_CAP;
      entry.added = added.length > cap ? added.slice(0, cap) : added;
      entry.removed = removed.length > cap ? removed.slice(0, cap) : removed;
      entry.changed = changed.length > cap ? changed.slice(0, cap) : changed;
      if (added.length > cap || removed.length > cap || changed.length > cap) entry.truncated = true;
      sections[sec] = entry;
    });

    return { changed: Object.keys(sections).length > 0, counts, sections };
  };

  /* Reconstruct a full inventory from a baseline + a delta. */
  INV.apply = function (prev, delta) {
    const base = INV.normalize(prev || {});
    const d = asObj(delta);
    const secs = asObj(d.sections);
    const out = clone(base);
    INV.SCALAR_SECTIONS.forEach((sec) => {
      const e = secs[sec];
      if (e && e.after) out[sec] = e.after;
    });
    INV.ARRAY_SECTIONS.forEach((sec) => {
      const e = secs[sec];
      if (!e) return;
      const map = new Map();
      out[sec].forEach((it) => map.set(INV.keyFor(sec, it), it));
      asArr(e.removed).forEach((it) => map.delete(INV.keyFor(sec, it)));
      asArr(e.added).forEach((it) => map.set(INV.keyFor(sec, it), it));
      asArr(e.changed).forEach((c) => { const item = asObj(c).after; if (item) map.set(INV.keyFor(sec, item), item); });
      out[sec] = [...map.values()];
    });
    return INV.normalize(out);
  };

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  INV.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "device", targetId, summary }); } catch (e) {}
  }

  /* ─────────────────────── persistence ─────────────────────── */

  async function load() {
    const r = await ERP.store.loadDoc(INV.MODULE);
    return asArr(r.error ? [] : r.records);
  }
  async function save(list) { return ERP.store.saveDoc(INV.MODULE, list); }
  INV.load = load;

  function snapFor(records, deviceId) {
    return records.find((r) => r.kind === "snapshot" && String(r.deviceId) === String(deviceId)) || null;
  }

  function countsOf(sec) {
    return {
      software: asArr(sec.software).length, services: asArr(sec.services).length, patches: asArr(sec.patches).length,
      disks: asArr(sec.disks).length, interfaces: asArr(sec.interfaces).length,
      users: asArr(sec.users).length, groups: asArr(sec.groups).length,
    };
  }

  /* A compact per-device summary carried on the device record itself, so
     the console can show AV/backup posture and counts without loading
     the (potentially large) inventory document. */
  function summaryFor(sec, revision, hash, at) {
    const sec9 = asObj(sec.security);
    const av = asArr(sec9.antivirus);
    const avEnabled = av.length ? av.some((a) => asObj(a).enabled !== false) : null;
    const avUpToDate = av.length ? av.every((a) => asObj(a).upToDate !== false) : null;
    return {
      collectedAt: at, revision, hash,
      counts: countsOf(sec),
      os: { name: asObj(sec.os).name, version: asObj(sec.os).version, family: asObj(sec.os).family },
      hardware: { manufacturer: asObj(sec.hardware).manufacturer, model: asObj(sec.hardware).model },
      security: {
        antivirusCount: av.length, avEnabled, avUpToDate,
        firewall: asObj(sec9.firewall).enabled, encryption: asObj(sec9.encryption).systemDrive,
        secureBoot: sec9.secureBoot == null ? null : sec9.secureBoot, pendingReboot: sec9.pendingReboot,
      },
      backup: { status: asObj(sec.backup).status, lastRunAt: asObj(sec.backup).lastRunAt, lastResult: asObj(sec.backup).lastResult },
      updatedAt: now(),
    };
  }
  INV.summaryFor = summaryFor;

  /* ─────────────────────── submit ─────────────────────── */

  /* req: { deviceId, credential, payload:{
            mode:"full"|"delta", inventory | delta, collectedAt, agentVersion } }
     Authenticated per device. Full payloads are normalised and reduced
     to a delta against the last known state; delta payloads are applied
     to it. Either way the stored snapshot, the delta log and the device
     record's inventory summary stay current. */
  INV.submit = async function (req) {
    req = req || {};
    const deviceId = req.deviceId;
    if (!deviceId) return { ok: false, error: "no_device", message: "No device id was supplied." };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason, message: "The device did not authenticate.", deviceId };
    const providerId = auth.providerId || req.providerId || "";
    const g = await D.get(providerId, deviceId);
    if (g.error) return { ok: false, error: "unknown_device", message: "The authenticated device no longer exists.", deviceId };

    const payload = asObj(req.payload || req.data);
    const mode = payload.mode === "delta" ? "delta" : "full";
    const records = await load();
    const prev = snapFor(records, deviceId);

    if (mode === "delta" && !prev) return { ok: false, error: "no_baseline", message: "A delta was sent before a full inventory baseline.", deviceId };
    if (mode === "delta" && !payload.delta) return { ok: false, error: "no_delta", message: "Delta mode requires a delta payload.", deviceId };

    const at = dateOrEmpty(payload.collectedAt) || now();
    let next, delta;
    if (mode === "delta") {
      delta = payload.delta;
      next = INV.apply(prev.sections, delta);
    } else {
      next = INV.normalize(payload.inventory || payload);
      delta = INV.diff(prev ? prev.sections : null, next);
    }
    const hash = INV.hashOf(next);
    const revision = (prev ? num(prev.revision, 0) : 0) + 1;

    /* A full collection that changes nothing is not a new revision; we
       only move the "last collected" stamp. */
    if (prev && !delta.changed && hash === prev.hash) {
      prev.at = at;
      const w = await save(records);
      if (w && w.error) return { ok: false, error: w.error, message: w.message };
      await patchDevice(providerId, deviceId, summaryFor(next, prev.revision, hash, at), next);
      return { ok: true, deviceId, providerId, revision: prev.revision, changed: false, noChange: true, counts: countsOf(next), hash, collectedAt: at };
    }

    const snapshot = { kind: "snapshot", id: "snap-" + deviceId, deviceId, providerId, revision, at, hash, counts: countsOf(next), sections: next };
    const deltaRec = {
      kind: "delta", id: rid("dinv"), deviceId, providerId, at,
      fromRevision: prev ? prev.revision : 0, toRevision: revision,
      changed: !!delta.changed, counts: delta.counts, sections: delta.sections,
    };

    const kept = records.filter((r) => !(r.kind === "snapshot" && String(r.deviceId) === String(deviceId)));
    kept.push(snapshot);
    kept.push(deltaRec);
    /* bound the per-device delta log */
    const limit = INV.DELTA_LIMIT();
    const mine = kept.filter((r) => r.kind === "delta" && String(r.deviceId) === String(deviceId)).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const drop = new Set(mine.slice(limit).map((r) => r.id));
    const pruned = kept.filter((r) => !drop.has(r.id));

    const w = await save(pruned);
    if (w && w.error) return { ok: false, error: w.error, message: w.message };

    await patchDevice(providerId, deviceId, summaryFor(next, revision, hash, at), next);
    notify("inventory", { deviceId, providerId, revision, counts: delta.counts, changed: !!delta.changed });
    await audit("collect_inventory", deviceId, "Inventory revision " + revision + " for " + (g.device.hostname || deviceId) + " (" + delta.counts.added + " added, " + delta.counts.removed + " removed, " + delta.counts.changed + " changed).");

    return { ok: true, deviceId, providerId, revision, changed: !!delta.changed, counts: countsOf(next), deltaCounts: delta.counts, hash, collectedAt: at, delta: deltaRec };
  };

  /* Reconcile the device record itself with the inventory, and store the
     compact summary. Inventory is authoritative for the asset fields it
     covers; site/group/status/notes stay untouched. */
  async function patchDevice(providerId, deviceId, summary, sections) {
    const g = await D.get(providerId, deviceId);
    if (g.error) return g;
    const dev = g.device;
    const custom = Object.assign({}, asObj(dev.custom), { inventory: summary });
    const snapG = { custom };
    if (summary.os && summary.os.name && summary.os.name !== dev.os.name) { snapG.os = Object.assign({}, dev.os, { name: summary.os.name, version: summary.os.version || dev.os.version, family: summary.os.family || dev.os.family }); }
    const s = sections || (await INV.snapshot(deviceId) || {}).sections;
    if (s) {
      if (s.hardware) {
        const h = s.hardware;
        if (h.manufacturer) snapG.manufacturer = h.manufacturer;
        if (h.model) snapG.model = h.model;
        if (h.serial) snapG.serial = h.serial;
        if (h.ramBytes) snapG.ramBytes = h.ramBytes;
        if (h.cpu && (h.cpu.model || h.cpu.cores)) snapG.cpu = Object.assign({}, dev.cpu, { model: h.cpu.model || dev.cpu.model, cores: h.cpu.cores || dev.cpu.cores, threads: h.cpu.threads || dev.cpu.threads, speedMhz: h.cpu.speedMhz || dev.cpu.speedMhz });
        if (asArr(h.gpus).length) snapG.gpus = h.gpus;
      }
      if (asArr(s.disks).length) snapG.disks = s.disks;
      if (asArr(s.interfaces).length) snapG.interfaces = s.interfaces;
      snapG.lastSeenAt = dev.lastSeenAt || summary.collectedAt;
    }
    return D.update(providerId, deviceId, snapG);
  }
  INV.patchDevice = patchDevice;

  /* ─────────────────────── agent-side helper ─────────────────────── */

  /* Decide what to send: the first collection is a full snapshot, every
     later one a delta against the last known state. Pure — used by the
     agent runtime and by tests. */
  INV.agentPayload = function (previous, raw, collectedAt) {
    const next = INV.normalize(raw);
    const at = collectedAt || now();
    if (!previous) return { mode: "full", inventory: next, collectedAt: at };
    const delta = INV.diff(previous, next);
    return { mode: "delta", delta: { sections: delta.sections, counts: delta.counts, changed: delta.changed }, collectedAt: at };
  };

  /* ─────────────────────── reads ─────────────────────── */

  INV.snapshot = async function (deviceId) {
    const records = await load();
    return snapFor(records, deviceId);
  };
  INV.deltas = async function (deviceId, limit) {
    const records = await load();
    const list = records.filter((r) => r.kind === "delta" && String(r.deviceId) === String(deviceId));
    list.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    return limit ? list.slice(0, limit) : list;
  };
  INV.listSnapshots = async function (providerId) {
    const records = await load();
    return records.filter((r) => r.kind === "snapshot" && (!providerId || String(r.providerId) === String(providerId)));
  };
  INV.summary = function (dev) { return asObj(asObj(dev && dev.custom).inventory); };
  INV.hasSnapshot = async function (deviceId) { return !!(await INV.snapshot(deviceId)); };

  /* Aggregate software across a tenant: one row per publisher+title with
     the device count and the versions seen. The Software station (Task 31)
     and the inventory console both build on this. */
  INV.softwareIndex = async function (providerId) {
    const snaps = await INV.listSnapshots(providerId);
    const byKey = new Map();
    snaps.forEach((s) => {
      asArr(asObj(s.sections).software).forEach((it) => {
        const k = INV.keyFor("software", it);
        let e = byKey.get(k);
        if (!e) { e = { key: k, name: it.name, publisher: it.publisher, deviceIds: [], versions: {} }; byKey.set(k, e); }
        if (e.deviceIds.indexOf(s.deviceId) === -1) e.deviceIds.push(s.deviceId);
        e.versions[it.version || "(unknown)"] = (e.versions[it.version || "(unknown)"] || 0) + 1;
      });
    });
    return [...byKey.values()].map((e) => ({ key: e.key, name: e.name, publisher: e.publisher, deviceCount: e.deviceIds.length, deviceIds: e.deviceIds, versions: Object.keys(e.versions).sort(), versionCount: Object.keys(e.versions).length }))
      .sort((a, b) => b.deviceCount - a.deviceCount || String(a.name).localeCompare(String(b.name)));
  };

  INV.patchIndex = async function (providerId) {
    const snaps = await INV.listSnapshots(providerId);
    const byKey = new Map();
    snaps.forEach((s) => {
      asArr(asObj(s.sections).patches).forEach((p) => {
        const k = INV.keyFor("patches", p);
        let e = byKey.get(k);
        if (!e) { e = { key: k, id: p.id, title: p.title, classification: p.classification, deviceIds: [], installedOn: p.installedOn }; byKey.set(k, e); }
        if (e.deviceIds.indexOf(s.deviceId) === -1) e.deviceIds.push(s.deviceId);
      });
    });
    return [...byKey.values()].map((e) => ({ key: e.key, id: e.id, title: e.title, classification: e.classification, deviceCount: e.deviceIds.length, installedOn: e.installedOn }))
      .sort((a, b) => b.deviceCount - a.deviceCount || String(a.title).localeCompare(String(b.title)));
  };

  INV.securityRollup = async function (providerId) {
    const devices = await D.list(providerId);
    const out = { devices: devices.length, withInventory: 0, avProtected: 0, avOutdated: 0, firewallOn: 0, encrypted: 0, secureBootOn: 0, pendingReboot: 0, backupsOk: 0, backupsFailed: 0, rows: [] };
    devices.forEach((d) => {
      const s = INV.summary(d);
      if (!s || !s.collectedAt) return;
      out.withInventory += 1;
      const sec = asObj(s.security), bk = asObj(s.backup);
      if (sec.avEnabled) out.avProtected += 1;
      if (sec.avEnabled && sec.avUpToDate === false) out.avOutdated += 1;
      if (sec.firewall) out.firewallOn += 1;
      if (sec.encryption) out.encrypted += 1;
      if (sec.secureBoot) out.secureBootOn += 1;
      if (sec.pendingReboot) out.pendingReboot += 1;
      if (bk.status === "ok") out.backupsOk += 1;
      if (bk.status === "failed" || bk.status === "warning") out.backupsFailed += 1;
      out.rows.push({
        deviceId: d.id, hostname: d.hostname || d.displayName, collectedAt: s.collectedAt,
        av: sec.antivirusCount ? sec.antivirusCount + (sec.avUpToDate === false ? " · outdated" : "") : "—",
        avEnabled: sec.avEnabled, firewall: sec.firewall, encryption: sec.encryption, secureBoot: sec.secureBoot,
        backup: bk.status || "unknown", backupLastRunAt: bk.lastRunAt || "",
      });
    });
    return out;
  };

  INV.stats = async function (providerId) {
    const records = await load();
    const snaps = records.filter((r) => r.kind === "snapshot" && (!providerId || String(r.providerId) === String(providerId)));
    const deltas = records.filter((r) => r.kind === "delta" && (!providerId || String(r.providerId) === String(providerId)));
    const devices = await D.list(providerId);
    let software = 0, services = 0, patches = 0;
    snaps.forEach((s) => { software += num(s.counts && s.counts.software, 0); services += num(s.counts && s.counts.services, 0); patches += num(s.counts && s.counts.patches, 0); });
    return {
      devices: devices.length, snapshots: snaps.length, deltas: deltas.length,
      withInventory: snaps.length,
      software, services, patches,
      lastCollectedAt: snaps.reduce((a, s) => (s.at > a ? s.at : a), ""),
      bytes: 0,
    };
  };

  /* ─────────────────────── collection requests ─────────────────────── */

  /* Ask the agent(s) to report inventory on their next check-in. The
     request is stored on the device and cleared by the heartbeat. */
  INV.requestCollection = async function (providerId, deviceIds) {
    const ids = asArr(deviceIds).length ? asArr(deviceIds) : (await D.list(providerId)).map((d) => d.id);
    let requested = 0, unsupported = 0;
    for (const id of ids) {
      const g = await D.get(providerId, id);
      if (g.error) continue;
      const caps = asArr(asObj(g.device.agent).capabilities);
      if (caps.length && caps.indexOf("inventory") === -1) { unsupported += 1; continue; }
      const custom = Object.assign({}, asObj(g.device.custom), { inventoryRequestedAt: now() });
      await D.update(providerId, id, { custom });
      requested += 1;
    }
    if (requested) notify("request", { providerId, requested });
    return { ok: true, requested, unsupported };
  };

  /* ─────────────────────── display ─────────────────────── */

  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

  function bytesHuman(n) { return D.bytesHuman(n); }

  function tone(v) { return v === true ? "success" : v === false ? "danger" : "muted"; }

  function kvRows(rows) {
    return '<div class="rmm-kv">' + rows.filter((x) => x[1] !== "" && x[1] != null && x[1] !== "—").map((x) => '<div class="rmm-kv-row"><span>' + ERP.ui.esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>";
  }

  function deltaSummaryText(delta) {
    const c = asObj(delta && delta.counts);
    const parts = [];
    if (c.added) parts.push("+" + c.added);
    if (c.removed) parts.push("−" + c.removed);
    if (c.changed) parts.push("~" + c.changed);
    return parts.join(" / ") || "no change";
  }

  /* The "Inventory" section appended to the device modal. Async because
     it loads the (potentially large) snapshot on demand. */
  INV.deviceSection = async function (dev, providerId) {
    const ui = ERP.ui, esc = ui.esc;
    const sum = INV.summary(dev);
    const snap = await INV.snapshot(dev.id);
    const head = '<h4 class="rmm-section-title">Inventory &amp; installed software</h4>';
    const jobsReady = ERP.jobs && typeof ERP.jobs.enqueue === "function";

    if (!snap) {
      return head +
        '<div class="erp-alert tone-info"><b>No inventory collected yet.</b> ' +
        (sum && sum.collectedAt ? "Last collection " + ui.dateTime(sum.collectedAt) + "." : "The agent has not reported an inventory snapshot.") + "</div>" +
        (jobsReady ? '<div class="erp-btn-row">' + ui.btn("Request inventory now", { small: true, act: "inv-request", arg: dev.id }) + "</div>" : "");
    }

    const sec = asObj(snap.sections);
    const counts = asObj(snap.counts);
    const deltas = await INV.deltas(dev.id, 10);

    const software = asArr(sec.software);
    const swRows = software.slice(0, 100).map((it) => ({
      name: "<b>" + esc(it.name) + "</b>" + (it.publisher ? '<div class="erp-sub">' + esc(it.publisher) + "</div>" : ""),
      version: esc(it.version || "—"),
      installed: it.installDate ? ui.date(it.installDate) : "—",
      size: it.sizeBytes ? bytesHuman(it.sizeBytes) : "—",
    }));
    const svcRows = asArr(sec.services).slice(0, 100).map((s) => ({
      name: "<b>" + esc(s.displayName || s.name) + "</b><div class=\"erp-sub\">" + esc(s.name) + "</div>",
      state: ui.badge(s.state, s.state === "running" ? "success" : s.state === "stopped" ? "danger" : "muted"),
      start: esc(s.startType || "—"),
      account: esc(s.account || "—"),
    }));
    const patchRows = asArr(sec.patches).slice(0, 100).map((p) => ({
      title: "<b>" + esc(p.title || p.id) + "</b>",
      cls: esc(p.classification || "—"),
      id: p.id ? "<code>" + esc(p.id) + "</code>" : "—",
      on: p.installedOn ? ui.date(p.installedOn) : "—",
    }));
    const userRows = asArr(sec.users).slice(0, 100).map((u) => ({
      name: "<b>" + esc(u.name) + "</b>",
      domain: esc(u.domain || "—"),
      enabled: ui.badge(u.enabled === false ? "disabled" : "enabled", u.enabled === false ? "muted" : "success"),
      admin: u.admin ? ui.badge("admin", "warn") : "—",
      last: u.lastLogon ? ui.dateTime(u.lastLogon) : "—",
    }));
    const groupRows = asArr(sec.groups).slice(0, 100).map((gr) => ({
      name: "<b>" + esc(gr.name) + "</b>" + (gr.admin ? " " + ui.badge("privileged", "warn") : ""),
      count: String(asArr(gr.members).length),
      members: asArr(gr.members).slice(0, 12).map(esc).join(", ") + (asArr(gr.members).length > 12 ? " …" : ""),
    }));
    const deltaRows = deltas.map((d) => ({
      at: ui.dateTime(d.at),
      rev: "r" + d.fromRevision + " → r" + d.toRevision,
      change: d.changed ? deltaSummaryText(d) : ui.badge("no change", "muted"),
    }));

    const secSum = asObj(sum.security);
    const hw = asObj(sec.hardware);
    const osSec = asObj(sec.os);
    const bk = asObj(sec.backup);
    const invSec = asObj(sec.security);
    const fw = asObj(invSec.firewall), enc = asObj(invSec.encryption), tpm = asObj(invSec.tpm);

    return head +
      ui.grid([
        ui.statCard({ label: "Software", value: String(num(counts.software, 0)), sub: "titles installed" }),
        ui.statCard({ label: "Services", value: String(num(counts.services, 0)), sub: "reported" }),
        ui.statCard({ label: "Patches", value: String(num(counts.patches, 0)), sub: "hotfixes / updates" }),
        ui.statCard({ label: "Revision", value: "r" + snap.revision, sub: "collected " + ui.dateTime(snap.at) }),
      ], "erp-kpi-grid") +
      kvRows([
        ["Collected", ui.dateTime(snap.at)],
        ["Hash", "<code>" + esc(snap.hash) + "</code>"],
        ["Last delta", deltas.length ? deltaSummaryText(deltas[0]) : "—"],
      ]) +
      "<h4 class=\"rmm-section-title\">Extended hardware &amp; OS</h4>" + kvRows([
        ["Manufacturer", esc(hw.manufacturer || "—")], ["Model", esc(hw.model || "—")],
        ["Serial", hw.serial ? "<code>" + esc(hw.serial) + "</code>" : "—"],
        ["Form factor", esc(hw.formFactor || "—")],
        ["CPU", esc(asObj(hw.cpu).model || "—") + (asObj(hw.cpu).cores ? " · " + asObj(hw.cpu).cores + "c/" + asObj(hw.cpu).threads + "t" : "")],
        ["RAM", hw.ramBytes ? bytesHuman(hw.ramBytes) : "—"],
        ["OS edition", esc(osSec.edition || "—")], ["Installed", osSec.installDate ? ui.date(osSec.installDate) : "—"],
        ["Last boot", osSec.lastBootAt ? ui.dateTime(osSec.lastBootAt) : "—"],
      ]) +
      "<h4 class=\"rmm-section-title\">Security &amp; anti-malware</h4>" + kvRows([
        ["Anti-malware", secSum.antivirusCount ? esc(secSum.antivirusCount + " product(s)") + " " + ui.badge(secSum.avEnabled ? "active" : "inactive", tone(secSum.avEnabled)) + (secSum.avUpToDate === false ? " " + ui.badge("signatures stale", "warn") : "") : "—"],
        ["Firewall", ui.badge(fw.enabled == null ? "unknown" : fw.enabled ? "on" : "off", tone(fw.enabled))],
        ["Disk encryption", ui.badge(enc.systemDrive == null ? "unknown" : enc.systemDrive ? "on" : "off", tone(enc.systemDrive)) + (enc.method ? " " + esc(enc.method) : "")],
        ["Secure Boot", ui.badge(secSum.secureBoot == null ? "unknown" : secSum.secureBoot ? "on" : "off", tone(secSum.secureBoot))],
        ["TPM", tpm.present ? esc("v" + (tpm.version || "?")) : "—"],
        ["Pending reboot", secSum.pendingReboot ? ui.badge("yes", "warn") : "no"],
      ]) +
      "<h4 class=\"rmm-section-title\">Backup</h4>" + kvRows([
        ["Status", ui.badge(bk.status || "unknown", bk.status === "ok" ? "success" : bk.status === "failed" ? "danger" : bk.status === "warning" ? "warn" : "muted")],
        ["Provider", esc(bk.provider || "—")], ["Last run", bk.lastRunAt ? ui.dateTime(bk.lastRunAt) : "—"],
        ["Last result", esc(bk.lastResult || "—")], ["Next run", bk.nextRunAt ? ui.dateTime(bk.nextRunAt) : "—"],
      ]) +
      "<h4 class=\"rmm-section-title\">Installed software (" + software.length + ")</h4>" +
      (software.length ? ui.table([{ key: "name", label: "Title", render: (r) => r.name }, { key: "version", label: "Version" }, { key: "installed", label: "Installed" }, { key: "size", label: "Size", align: "right" }], swRows, { scroll: true }) + (software.length > 100 ? '<p class="erp-sub">Showing the first 100 of ' + software.length + ".</p>" : "") : '<p class="erp-sub">No software reported.</p>') +
      "<h4 class=\"rmm-section-title\">Services (" + asArr(sec.services).length + ")</h4>" +
      (asArr(sec.services).length ? ui.table([{ key: "name", label: "Service", render: (r) => r.name }, { key: "state", label: "State", render: (r) => r.state }, { key: "start", label: "Start type" }, { key: "account", label: "Account" }], svcRows, { scroll: true }) : '<p class="erp-sub">No services reported.</p>') +
      "<h4 class=\"rmm-section-title\">Patches &amp; updates (" + asArr(sec.patches).length + ")</h4>" +
      (asArr(sec.patches).length ? ui.table([{ key: "title", label: "Update", render: (r) => r.title }, { key: "cls", label: "Classification" }, { key: "id", label: "ID", render: (r) => r.id }, { key: "on", label: "Installed" }], patchRows, { scroll: true }) : '<p class="erp-sub">No patch information reported.</p>') +
      "<h4 class=\"rmm-section-title\">Local users (" + asArr(sec.users).length + ") &amp; groups (" + asArr(sec.groups).length + ")</h4>" +
      (asArr(sec.users).length ? ui.table([{ key: "name", label: "User", render: (r) => r.name }, { key: "domain", label: "Domain" }, { key: "enabled", label: "State", render: (r) => r.enabled }, { key: "admin", label: "Admin", render: (r) => r.admin }, { key: "last", label: "Last logon" }], userRows, { scroll: true }) : "") +
      (asArr(sec.groups).length ? ui.table([{ key: "name", label: "Group", render: (r) => r.name }, { key: "count", label: "Members", align: "right" }, { key: "members", label: "Members" }], groupRows, { scroll: true }) : "") +
      (deltas.length ? "<h4 class=\"rmm-section-title\">Change history</h4>" + ui.table([{ key: "at", label: "When" }, { key: "rev", label: "Revision" }, { key: "change", label: "Change", render: (r) => r.change }], deltaRows) : "") +
      (ERP.jobs && typeof ERP.jobs.enqueue === "function" ? '<div class="erp-btn-row">' + ui.btn("Request inventory now", { small: true, act: "inv-request", arg: dev.id }) + "</div>" : "");
  };

  /* Wire the async device section's buttons into a modal/list root. */
  INV.wireDeviceSection = function (rootEl, opts) {
    if (!rootEl) return;
    opts = opts || {};
    ERP.ui.bind(rootEl, "click", "[data-act=inv-request]", async (t, e, act, arg) => {
      t.disabled = true;
      const r = await INV.requestCollection(opts.providerId, [arg || opts.deviceId]);
      t.disabled = false;
      if (r.error) { (opts.toast || (() => {}))("Request failed: " + r.error, "error"); return; }
      (opts.toast || (() => {}))(r.requested ? "Inventory requested — the agent will report on its next check-in." : "The agent does not support inventory collection.", r.requested ? "success" : "warn");
    });
  };

  /* ─────────────────────── Inventory console (Devices tab) ─────────────────────── */

  INV.renderInventory = async function (panel, opts) {
    if (!panel) return;
    const ui = ERP.ui, esc = ui.esc;
    const provider = opts.provider, providerId = opts.providerId;
    const toast = opts.toast || (() => {});
    const refresh = opts.refresh || (() => {});

    const stats = await INV.stats(providerId);
    const roll = await INV.securityRollup(providerId);
    const software = await INV.softwareIndex(providerId);
    const patches = await INV.patchIndex(providerId);
    const devices = await D.list(providerId);
    const jobsReady = ERP.jobs && typeof ERP.jobs.enqueue === "function";

    const covered = pct(stats.withInventory, devices.length);
    const swRows = software.slice(0, 200).map((s) => ({
      name: "<b>" + esc(s.name) + "</b>" + (s.publisher ? '<div class="erp-sub">' + esc(s.publisher) + "</div>" : ""),
      devices: String(s.deviceCount) + (devices.length ? ' <span class="erp-sub">' + pct(s.deviceCount, devices.length) + "%</span>" : ""),
      versions: esc(s.versions.join(", ") || "—"),
    }));
    const patchRows = patches.slice(0, 200).map((p) => ({
      title: "<b>" + esc(p.title || p.id) + "</b>",
      cls: esc(p.classification || "—"),
      devices: String(p.deviceCount),
    }));
    const secRows = roll.rows.map((r) => ({
      host: "<b>" + esc(r.hostname || r.deviceId) + "</b>",
      av: esc(r.av) + (r.avEnabled === true ? " " + ui.badge("on", "success") : r.avEnabled === false ? " " + ui.badge("off", "danger") : ""),
      firewall: ui.badge(r.firewall == null ? "?" : r.firewall ? "on" : "off", tone(r.firewall)),
      encryption: ui.badge(r.encryption == null ? "?" : r.encryption ? "on" : "off", tone(r.encryption)),
      backup: ui.badge(r.backup, r.backup === "ok" ? "success" : r.backup === "failed" ? "danger" : r.backup === "warning" ? "warn" : "muted"),
      collected: r.collectedAt ? ui.dateTime(r.collectedAt) : "—",
    }));

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Collected", value: covered + "%", sub: stats.withInventory + " of " + devices.length + " device(s)" }),
        ui.statCard({ label: "Software titles", value: String(stats.software), sub: software.length + " unique title(s)" }),
        ui.statCard({ label: "Patches seen", value: String(stats.patches), sub: patches.length + " unique update(s)" }),
        ui.statCard({ label: "Security coverage", value: roll.avProtected + "/" + roll.withInventory, tone: roll.avOutdated ? "warn" : "success", sub: roll.avOutdated + " with stale signatures" }),
      ], "erp-kpi-grid") +
      (jobsReady ? '<div class="erp-btn-row">' + ui.btn("Request inventory from all agents", { primary: true, act: "inv-collect-all" }) + "</div>" : "") +
      '<p class="erp-sub">Inventory is collected by the agent as a full snapshot the first time and as deltas to the last known state thereafter. ' + (stats.lastCollectedAt ? "Last collection " + ui.dateTime(stats.lastCollectedAt) + "." : "No collection yet.") + "</p>" +
      ui.card("Installed software (" + software.length + ")",
        ui.table([{ key: "name", label: "Title", render: (r) => r.name }, { key: "devices", label: "Devices", align: "right", render: (r) => r.devices }, { key: "versions", label: "Versions seen" }], swRows, { scroll: true, emptyText: "No software collected yet — request an inventory from an enrolled agent." })) +
      ui.card("Patches & updates (" + patches.length + ")",
        ui.table([{ key: "title", label: "Update", render: (r) => r.title }, { key: "cls", label: "Classification" }, { key: "devices", label: "Devices", align: "right" }], patchRows, { scroll: true, emptyText: "No patch information collected yet." })) +
      ui.card("Security & backup posture",
        ui.table([{ key: "host", label: "Device", render: (r) => r.host }, { key: "av", label: "Anti-malware", render: (r) => r.av }, { key: "firewall", label: "Firewall", render: (r) => r.firewall }, { key: "encryption", label: "Encryption", render: (r) => r.encryption }, { key: "backup", label: "Backup", render: (r) => r.backup }, { key: "collected", label: "Collected" }], secRows, { scroll: true, emptyText: "No inventory collected yet." }));

    ui.bind(panel, "click", "[data-act]", async (t, e, act) => {
      if (act !== "inv-collect-all") return;
      t.disabled = true;
      const r = await INV.requestCollection(providerId, []);
      t.disabled = false;
      if (r.error) { toast("Request failed: " + r.error, "error"); return; }
      toast(r.requested + " device(s) will report inventory on their next check-in." + (r.unsupported ? " " + r.unsupported + " agent(s) do not support it." : ""), "success");
      refresh();
    });
  };

  /* ─────────────────────── boot ─────────────────────── */

  /* Demo devices are not enrolled agents, so the demo seed writes
     snapshots through a direct path that skips authentication — it is
     console-originated, like a manual import. */
  INV.seedSnapshot = async function (providerId, deviceId, raw) {
    const next = INV.normalize(raw);
    const records = await load();
    const prev = snapFor(records, deviceId);
    const delta = INV.diff(prev ? prev.sections : null, next);
    const hash = INV.hashOf(next);
    const revision = (prev ? num(prev.revision, 0) : 0) + 1;
    const at = now();
    const snapshot = { kind: "snapshot", id: "snap-" + deviceId, deviceId, providerId, revision, at, hash, counts: countsOf(next), sections: next };
    const kept = records.filter((r) => !(r.kind === "snapshot" && String(r.deviceId) === String(deviceId)));
    kept.push(snapshot);
    kept.push({ kind: "delta", id: rid("dinv"), deviceId, providerId, at, fromRevision: prev ? prev.revision : 0, toRevision: revision, changed: true, counts: delta.counts, sections: delta.sections });
    const w = await save(kept);
    if (w && w.error) return { error: w.error };
    await patchDevice(providerId, deviceId, summaryFor(next, revision, hash, at), next);
    return { ok: true, revision };
  };

  function demoInventory(d) {
    const fam = (d.os && d.os.family) || "Windows";
    const win = fam === "Windows" || /windows/i.test((d.os && d.os.name) || "");
    const mac = fam === "macOS";
    const software = win ? [
      { name: "Microsoft Edge", version: "122.0.2365.92", publisher: "Microsoft Corporation", installDate: "2023-04-12", sizeBytes: 512 * 1024 * 1024 },
      { name: "Google Chrome", version: "122.0.6261.112", publisher: "Google LLC", installDate: "2024-01-08", sizeBytes: 480 * 1024 * 1024 },
      { name: "Microsoft 365 Apps for enterprise", version: "16.0.17328.20162", publisher: "Microsoft Corporation", installDate: "2023-09-01" },
      { name: "7-Zip 23.01 (x64)", version: "23.01", publisher: "Igor Pavlov", installDate: "2023-06-21", sizeBytes: 5 * 1024 * 1024 },
      { name: "Microsoft Visual C++ 2015-2022 Redistributable (x64)", version: "14.38.33130", publisher: "Microsoft Corporation" },
      { name: "Adobe Acrobat Reader DC", version: "24.001.20604", publisher: "Adobe Inc.", installDate: "2024-02-14" },
    ] : mac ? [
      { name: "Safari", version: "17.4", publisher: "Apple Inc." },
      { name: "Xcode Command Line Tools", version: "15.3", publisher: "Apple Inc." },
      { name: "Docker Desktop", version: "4.28.0", publisher: "Docker Inc.", installDate: "2024-02-20", sizeBytes: 1200 * 1024 * 1024 },
      { name: "Homebrew", version: "4.2.11", publisher: "Homebrew" },
    ] : [
      { name: "openssh-server", version: "8.9p1-3ubuntu0.6", publisher: "Ubuntu", installDate: "2023-11-02" },
      { name: "nginx", version: "1.18.0-6ubuntu14.4", publisher: "Ubuntu", installDate: "2023-11-02" },
      { name: "docker-ce", version: "25.0.3", publisher: "Docker Inc.", installDate: "2024-02-19", sizeBytes: 300 * 1024 * 1024 },
      { name: "python3", version: "3.10.12-1~22.04.3", publisher: "Ubuntu" },
      { name: "postgresql-14", version: "14.11-0ubuntu0.22.04.1", publisher: "Ubuntu" },
    ];
    const services = win ? [
      { name: "wuauserv", displayName: "Windows Update", state: "running", startType: "Manual", account: "LocalSystem" },
      { name: "Spooler", displayName: "Print Spooler", state: "running", startType: "Automatic", account: "LocalSystem" },
      { name: "WinDefend", displayName: "Microsoft Defender Antivirus Service", state: "running", startType: "Automatic", account: "LocalSystem" },
      { name: "SNMPTRAP", displayName: "SNMP Trap", state: "stopped", startType: "Manual", account: "LocalService" },
    ] : mac ? [
      { name: "com.apple.mDNSResponder", displayName: "mDNSResponder", state: "running", startType: "Automatic" },
      { name: "com.docker.vmnetd", displayName: "Docker VM network", state: "running", startType: "Automatic" },
    ] : [
      { name: "nginx.service", displayName: "nginx", state: "running", startType: "enabled", account: "root" },
      { name: "ssh.service", displayName: "OpenBSD Secure Shell server", state: "running", startType: "enabled", account: "root" },
      { name: "docker.service", displayName: "Docker Application Container Engine", state: "running", startType: "enabled", account: "root" },
      { name: "postgresql.service", displayName: "PostgreSQL", state: "running", startType: "enabled", account: "postgres" },
      { name: "ufw.service", displayName: "Uncomplicated firewall", state: "exited", startType: "enabled", account: "root" },
    ];
    const patches = win ? [
      { id: "KB5034765", title: "2024-02 Cumulative Update for Windows", classification: "Security Updates", installedOn: "2024-02-14" },
      { id: "KB5034441", title: "Security Update for Windows Recovery Environment", classification: "Security Updates", installedOn: "2024-01-10" },
      { id: "KB4023057", title: "Update for Windows Update Service components", classification: "Updates", installedOn: "2023-12-05" },
    ] : mac ? [
      { id: "macOS-14.4", title: "macOS Sonoma 14.4", classification: "OS Update", installedOn: "2024-03-08" },
    ] : [
      { id: "USN-6666-1", title: "linux-image-generic security update", classification: "Security", installedOn: "2024-02-22" },
      { id: "USN-6644-1", title: "libssl3 security update", classification: "Security", installedOn: "2024-02-15" },
      { id: "USN-6616-1", title: "openssh security update", classification: "Security", installedOn: "2024-01-30" },
    ];
    const users = win || mac
      ? [{ name: win ? "Administrator" : "admin", domain: d.domain || (mac ? "" : "LOCAL"), enabled: true, admin: true, lastLogon: "2024-02-25T09:14:00Z" }, { name: "svc-backup", domain: "LOCAL", enabled: true, admin: false, lastLogon: "2024-02-25T03:00:00Z" }]
      : [{ name: "root", domain: "", enabled: true, admin: true, lastLogon: "2024-02-25T03:00:00Z" }, { name: "deploy", domain: "", enabled: true, admin: true, lastLogon: "2024-02-24T18:20:00Z" }, { name: "www-data", domain: "", enabled: false, admin: false }];
    const groups = win ? [
      { name: "Administrators", members: ["Administrator", "svc-backup"], admin: true },
      { name: "Users", members: ["Administrator"], admin: false },
    ] : mac ? [{ name: "admin", members: ["admin"], admin: true }, { name: "staff", members: ["admin"], admin: false }]
      : [{ name: "sudo", members: ["root", "deploy"], admin: true }, { name: "www-data", members: [], admin: false }];
    const antivirus = win ? [{ name: "Microsoft Defender Antivirus", enabled: true, upToDate: true }] : mac ? [] : [{ name: "ClamAV", enabled: false, upToDate: false }];
    // deterministic-ish variation per device
    const seed = String(d.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const freeAdjust = (seed % 20) / 100;
    return {
      hardware: { manufacturer: d.manufacturer, model: d.model, serial: d.serial, formFactor: d.formFactor, cpu: d.cpu, ramBytes: d.ramBytes, gpus: d.gpus },
      os: { family: d.os.family, name: d.os.name, version: d.os.version, build: d.os.build, edition: d.os.edition || (win ? "Professional" : ""), arch: d.os.arch, installDate: d.os.installDate || "2023-05-01", lastBootAt: "2024-02-24T22:10:00Z" },
      software: software,
      services: services,
      patches: patches,
      disks: asArr(d.disks).map((dk) => Object.assign({}, dk, { freeBytes: Math.round(num(dk.freeBytes, 0) * (1 - freeAdjust)) })),
      interfaces: asArr(d.interfaces),
      users: users,
      groups: groups,
      security: {
        antivirus: antivirus,
        firewall: { enabled: d.role === "server" ? true : (seed % 3 !== 0), profiles: [] },
        encryption: { systemDrive: d.role !== "workstation" || seed % 2 === 0, method: win ? "BitLocker" : mac ? "FileVault" : "LUKS", percentEncrypted: 100 },
        defender: { realtimeEnabled: win, signatureAgeDays: win ? 1 : null, tamperProtection: win ? true : null },
        secureBoot: d.formFactor === "vm" ? false : true,
        tpm: { present: d.formFactor !== "vm", version: "2.0", enabled: true },
        pendingReboot: seed % 5 === 0,
      },
      backup: d.role === "server"
        ? { status: seed % 7 === 0 ? "warning" : "ok", lastRunAt: "2024-02-25T02:00:00Z", lastResult: "Success", provider: "Veeam Agent", nextRunAt: "2024-02-26T02:00:00Z" }
        : { status: d.formFactor === "vm" ? "not-configured" : (seed % 4 === 0 ? "failed" : "ok"), lastRunAt: d.formFactor === "vm" ? "" : "2024-02-24T23:00:00Z", lastResult: seed % 4 === 0 ? "Backup target offline" : "Success", provider: win ? "Windows Backup" : "restic" },
    };
  }
  INV.demoInventory = demoInventory;

  INV.init = async function () {
    try {
      const providers = await T.list();
      for (const p of providers) {
        if (!p.demo) continue;
        const g = await T.get(p.id);
        if (g.error) continue;
        const existing = await INV.listSnapshots(p.id);
        if (existing.length) return INV;
        for (const d of asArr(g.provider.devices).map(D.normalizeDevice)) {
          const caps = asArr(asObj(d.agent).capabilities);
          if (caps.length && caps.indexOf("inventory") === -1) continue;
          await INV.seedSnapshot(p.id, d.id, demoInventory(d));
        }
      }
    } catch (e) { console.error("inventory seed failed", e); }
    return INV;
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", INV.init);
  else INV.init();
})();
