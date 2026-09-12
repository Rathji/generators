/* ============================================================
   RMM-U — agent simulator & end-to-end fixture  (Phase 11 · Task 44)

   A real RMM is judged by the loop an endpoint drives: a machine
   installs an agent, enrols with a one-time token, heartbeats, sends
   inventory & metrics, receives work, answers it, and everything
   downstream — monitoring, alerting, routing, automation, the psa-u
   bridge — reacts. This module manufactures that loop on demand so
   it can be exercised without a fleet of real machines.

   `window.ERP.simulator` (aliased `SIM`) is a **host** that runs
   simulated agents. Each agent is a plain object carrying an
   identity, a hardware profile, a temperament (its metric
   distribution) and, once enrolled, a per-device credential. The
   host drives the platform's own agent-facing services — it does not
   re-implement them:

     SIM.enrollAgent(agent)   → ERP.enrollment.enroll      (token → credential)
     SIM.heartbeat(agent)     → ERP.heartbeat.heartbeat    (presence + command channel)
     SIM.sendInventory(agent) → ERP.rmmInventory.submit    (full then deltas)
     SIM.sendMetrics(agent)   → ERP.metrics.submit         (sampled series)
     SIM.answerJob(agent, j)  → ERP.jobs.result            (job completion)

   So every byte an agent would post travels the same authenticated
   path a real agent uses, and blocking a simulated agent's credential
   blocks it exactly as it would a real one.

   `SIM.fixtures(opts)` builds a whole tenant — a provider with sites,
   device groups and an enrolled fleet distributed across them. `SIM.
   cycle`/`SIM.run` advance an agent (or a fleet) through check-ins,
   and `SIM.fullLoop(opts)` runs the canonical end-to-end scenario:
   enrol → heartbeat → metrics → monitor → alert → route → automate →
   psa-u ticket → recover → auto-clear → ticket resolved.

   Everything is deterministic given a seed, so a scenario that
   passes once passes every time.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy || !ERP.devices || !ERP.enrollment) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const H = ERP.heartbeat;
  const INV = ERP.rmmInventory;
  const MET = ERP.metrics;
  const J = ERP.jobs;

  const SIM = (ERP.simulator = {});

  /* ─────────────────────── small helpers ─────────────────────── */

  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const now = () => new Date().toISOString();
  const isFn = (f) => typeof f === "function";
  const pad = (n, w) => { const s = String(num(n, 0)); return s.length >= w ? s : "0".repeat(w - s.length) + s; };

  SIM.VERSION = 1;

  /* ─────────────────────── deterministic RNG ─────────────────────── */

  let seedCounter = 1;
  SIM.newSeed = () => ((Date.now() ^ Math.imul(seedCounter++, 2654435761)) >>> 0);
  /* mulberry32 — tiny, fast, and stable across engines. */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  SIM.rng = rng;

  /* ─────────────────────── device archetypes ─────────────────────── */

  SIM.PROFILES = [
    {
      id: "win-server", label: "Windows Server", platform: "windows", language: "powershell", role: "server",
      hostPrefix: "SRV", os: { family: "Windows", name: "Windows Server 2022", version: "10.0.20348", edition: "Standard", arch: "x64" },
      manufacturer: "Dell Inc.", model: "PowerEdge R650", formFactor: "rack",
      cpu: { model: "Intel Xeon Silver 4310", cores: 12, threads: 24 }, ramBytes: 64 * 1024 * 1024 * 1024,
      capabilities: ["inventory", "metrics", "jobs", "remote-shell", "file-transfer", "software-deploy", "patch-scan"],
    },
    {
      id: "win-ws", label: "Windows workstation", platform: "windows", language: "powershell", role: "workstation",
      hostPrefix: "WS", os: { family: "Windows", name: "Windows 11 Pro", version: "10.0.22631", edition: "Professional", arch: "x64" },
      manufacturer: "HP", model: "EliteBook 840 G9", formFactor: "laptop",
      cpu: { model: "Intel Core i7-1265U", cores: 10, threads: 12 }, ramBytes: 16 * 1024 * 1024 * 1024,
      capabilities: ["inventory", "metrics", "jobs", "remote-shell", "file-transfer"],
    },
    {
      id: "linux-server", label: "Linux server", platform: "linux", language: "sh", role: "server",
      hostPrefix: "LNX", os: { family: "Linux", name: "Ubuntu 22.04.4 LTS", version: "22.04", edition: "", arch: "x64" },
      manufacturer: "Supermicro", model: "SYS-520P-WTR", formFactor: "rack",
      cpu: { model: "AMD EPYC 7313", cores: 16, threads: 32 }, ramBytes: 128 * 1024 * 1024 * 1024,
      capabilities: ["inventory", "metrics", "jobs", "remote-shell", "file-transfer", "software-deploy", "patch-scan"],
    },
    {
      id: "mac-laptop", label: "macOS laptop", platform: "macos", language: "sh", role: "workstation",
      hostPrefix: "MAC", os: { family: "macOS", name: "macOS Sonoma 14.4", version: "14.4", edition: "", arch: "arm64" },
      manufacturer: "Apple Inc.", model: "MacBook Pro (14-inch, 2023)", formFactor: "laptop",
      cpu: { model: "Apple M3 Pro", cores: 12, threads: 12 }, ramBytes: 18 * 1024 * 1024 * 1024,
      capabilities: ["inventory", "metrics", "jobs", "file-transfer"],
    },
  ];
  SIM.profile = (id) => SIM.PROFILES.find((p) => p.id === id) || null;
  SIM.profileIds = SIM.PROFILES.map((p) => p.id);

  /* A temperament is the distribution an agent's samples are drawn
     from. "hot", "leak" and "full" deliberately cross common monitor
     thresholds so alerting can be exercised on purpose. */
  SIM.TEMPERAMENTS = [
    { id: "idle", label: "Idle", cpu: [2, 12], mem: [28, 45], disk: [38, 58] },
    { id: "normal", label: "Normal", cpu: [15, 45], mem: [42, 64], disk: [52, 70] },
    { id: "busy", label: "Busy", cpu: [55, 82], mem: [58, 80], disk: [64, 84] },
    { id: "hot", label: "CPU saturated", cpu: [92, 99], mem: [68, 86], disk: [66, 84] },
    { id: "leak", label: "Memory pressure", cpu: [18, 42], mem: [90, 97], disk: [58, 74] },
    { id: "full", label: "Disk nearly full", cpu: [8, 30], mem: [40, 62], disk: [96, 99] },
  ];
  SIM.temperament = (id) => SIM.TEMPERAMENTS.find((t) => t.id === id) || SIM.TEMPERAMENTS[1];
  SIM.temperamentIds = SIM.TEMPERAMENTS.map((t) => t.id);

  SIM.DEFAULT_SITES = [
    { id: "site-hq", key: "hq", name: "Head Office", code: "HQ" },
    { id: "site-dc", key: "dc", name: "Data Centre", code: "DC" },
    { id: "site-branch", key: "branch", name: "Branch Office", code: "BR" },
  ];
  SIM.DEFAULT_GROUPS = [
    { id: "grp-servers", key: "servers", name: "Servers", kind: "static" },
    { id: "grp-workstations", key: "workstations", name: "Workstations", kind: "static" },
  ];

  /* A wall-clock instant that no seeded maintenance window covers: a
     Wednesday at noon. The default windows are nightly 01:00–05:00, all
     weekend, and month-end 22:00–23:59, so a weekday midday is always
     clear — which is what an end-to-end run wants. */
  SIM.cleanTime = function () {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
    return d.toISOString();
  };

  /* ─────────────────────── agent identity ─────────────────────── */

  function interfaceFor(index, rngFn) {
    const octet = 20 + (index % 200);
    const mac = ["02", "00", "5e", pad(index % 256, 2, 16), pad((index * 7) % 256, 2, 16), pad((index * 13) % 256, 2, 16)].join(":").toLowerCase();
    return {
      name: index % 3 === 0 ? "Wi-Fi" : "Ethernet",
      mac: mac,
      ip4: ["10." + octet + "." + (index % 250) + "." + (10 + (index % 200))],
      gateway: "10." + octet + "." + (index % 250) + ".1",
      speedMbps: index % 3 === 0 ? 866 : 1000,
    };
  }

  /* Create an in-memory agent. Nothing is written until `enrollAgent`. */
  SIM.createAgent = function (opts) {
    opts = opts || {};
    const profile = SIM.profile(opts.profileId) || SIM.PROFILES[num(opts.index, 0) % SIM.PROFILES.length];
    const index = num(opts.index, 0);
    const seed = opts.seed != null ? num(opts.seed, 0) : SIM.newSeed();
    const rf = rng(seed ^ 0x9e3779b9);
    const hostname = S(opts.hostname, 200) || (profile.hostPrefix + "-" + pad(index + 1, 3));
    const temperament = SIM.temperament(opts.temperamentId);
    const label = S(opts.label, 40) || ("agent-" + index);
    const sites = asArr(opts.sites).length ? opts.sites : SIM.DEFAULT_SITES;
    const groups = asArr(opts.groups).length ? opts.groups : SIM.DEFAULT_GROUPS;
    const site = opts.siteId ? sites.find((s) => String(s.id) === String(opts.siteId)) : sites[index % sites.length];
    const groupIds = asArr(opts.groupIds).length
      ? asArr(opts.groupIds).map(String)
      : [profile.role === "server" ? (groups.find((g) => g.key === "servers") || groups[0]).id : (groups.find((g) => g.key === "workstations") || groups[groups.length - 1]).id];
    const diskTotal = (profile.role === "server" ? (index % 2 ? 2000 : 480) : (index % 2 ? 512 : 1024)) * 1024 * 1024 * 1024;
    const disks = [{
      label: profile.platform === "windows" ? "C:" : "/",
      sizeBytes: diskTotal,
      freeBytes: Math.round(diskTotal * (1 - (temperament.disk[0] + rf() * (temperament.disk[1] - temperament.disk[0])) / 100)),
      pct: Math.round(temperament.disk[0] + rf() * (temperament.disk[1] - temperament.disk[0])),
    }];
    return {
      kind: "simAgent",
      id: "agt-" + seed.toString(36) + "-" + pad(index, 3),
      index, label, seed, hostname,
      profileId: profile.id, platform: profile.platform, role: profile.role,
      language: profile.language,
      os: clone(profile.os),
      manufacturer: profile.manufacturer, model: profile.model, formFactor: profile.formFactor,
      cpu: clone(profile.cpu), ramBytes: profile.ramBytes,
      capabilities: asArr(opts.capabilities).length ? asArr(opts.capabilities) : profile.capabilities.slice(),
      agentVersion: S(opts.agentVersion, 40) || "2.4.0",
      providerId: S(opts.providerId, 60) || "",
      siteId: site ? String(site.id) : "",
      siteName: site ? site.name : "",
      groupIds: groupIds,
      groupNames: groupIds.map((g) => ((groups.find((x) => String(x.id) === String(g)) || {}).name) || g),
      tags: asArr(opts.tags).length ? asArr(opts.tags).map(String) : (profile.role === "server" ? ["prod"] : []),
      temperamentId: temperament.id,
      interfaces: [interfaceFor(index, rf)],
      disks: disks,
      software: asArr(opts.software),
      spoolPending: num(opts.spoolPending, 0),
      jobPolicy: opts.jobPolicy || null,
      jobAnswers: asObj(opts.jobAnswers),
      deviceId: "", credential: "", token: "",
      cycles: 0, inventories: 0, samples: 0, jobsAnswered: 0,
      enrolledAt: "", lastError: "",
    };
  };

  /* ─────────────────────── agent-side payload builders ─────────────────────── */

  SIM.buildHeartbeat = function (agent, opts) {
    opts = opts || {};
    const at = opts.at || now();
    return {
      agentVersion: agent.agentVersion,
      capabilities: asArr(agent.capabilities),
      intervalSeconds: num(opts.intervalSeconds, 60),
      clientTime: at,
      hostname: agent.hostname,
      interfaces: clone(agent.interfaces),
      spool: { pending: num(agent.spoolPending, 0), bytes: num(agent.spoolPending, 0) * 2048, oldestAt: num(agent.spoolPending, 0) ? at : "" },
    };
  };

  /* The raw inventory an agent collects. Builds on the platform's own
     demo inventory so the simulator's payloads match what the console
     expects, then lets an agent carry extra software. */
  SIM.buildInventory = function (agent, device, opts) {
    opts = opts || {};
    let raw = null;
    try { if (INV && isFn(INV.demoInventory)) raw = INV.demoInventory(device ? D.normalizeDevice(device) : {}); } catch (e) { raw = null; }
    if (!raw) raw = { os: clone(agent.os), hardware: { manufacturer: agent.manufacturer, model: agent.model, cpu: agent.cpu, ramBytes: agent.ramBytes }, software: [], services: [], disks: clone(agent.disks), interfaces: clone(agent.interfaces) };
    if (asArr(agent.software).length) raw.software = asArr(raw.software).concat(clone(agent.software));
    if (asObj(opts.inventory).os || asObj(opts.inventory).hardware) raw = Object.assign({}, raw, opts.inventory);
    return raw;
  };

  function pick(rf, range) { return range[0] + rf() * (range[1] - range[0]); }

  SIM.buildSample = function (agent, at, opts) {
    opts = opts || {};
    const t = SIM.temperament(opts.temperamentId || agent.temperamentId);
    const rf = rng((agent.seed ^ num(opts.salt, 0)) >>> 0);
    const cpu = Math.round(pick(rf, t.cpu));
    const mem = Math.round(pick(rf, t.mem));
    const disk = Math.round(pick(rf, t.disk));
    const ramBytes = num(agent.ramBytes, 16 * 1024 * 1024 * 1024);
    const diskTotal = num((agent.disks[0] || {}).sizeBytes, 512 * 1024 * 1024 * 1024);
    return {
      at: at || now(),
      cpuPct: Math.min(100, Math.max(0, cpu)),
      memPct: Math.min(100, Math.max(0, mem)),
      memUsedBytes: Math.round(ramBytes * mem / 100),
      memTotalBytes: ramBytes,
      diskPct: Math.min(100, Math.max(0, disk)),
      diskFreeBytes: Math.round(diskTotal * (100 - disk) / 100),
      diskTotalBytes: diskTotal,
      diskReadBps: Math.round(pick(rf, [20000, 4000000])),
      diskWriteBps: Math.round(pick(rf, [10000, 2000000])),
      netRxBps: Math.round(pick(rf, [5000, 8000000])),
      netTxBps: Math.round(pick(rf, [4000, 6000000])),
      latencyMs: Math.round(pick(rf, [1, 40])),
      load1: Math.round((cpu / 100 * num((agent.cpu || {}).cores, 4)) * 100) / 100,
      uptimeSeconds: Math.round(3600 * (12 + (agent.index % 40))),
    };
  };

  /* ─────────────────────── enrolment ─────────────────────── */

  SIM.enrollAgent = async function (agent, opts) {
    opts = opts || {};
    if (!agent) return { ok: false, error: "no_agent" };
    if (agent.deviceId) return { ok: true, deviceId: agent.deviceId, already: true };
    const providerId = opts.providerId || agent.providerId;
    if (!providerId) return { ok: false, error: "no_provider", message: "An agent needs a provider to enrol under." };
    const issued = await E.issueToken({
      providerId, siteId: agent.siteId || null, groupIds: agent.groupIds,
      label: opts.label || (agent.hostname + " (" + agent.profileId + ")"),
      token: opts.token || undefined,
      maxUses: 1,
      expiresInMinutes: opts.expiresInMinutes,
    });
    if (issued.error) { agent.lastError = issued.error; return { ok: false, error: issued.error, message: issued.message }; }
    agent.token = issued.token;
    const device = {
      role: agent.role,
      tags: agent.tags,
      os: clone(agent.os),
      manufacturer: agent.manufacturer,
      model: agent.model,
      formFactor: agent.formFactor,
      cpu: clone(agent.cpu),
      ramBytes: agent.ramBytes,
      disks: clone(agent.disks),
      interfaces: clone(agent.interfaces),
      domain: agent.platform === "windows" ? "CORP" : "",
    };
    const en = await E.enroll({
      token: issued.token,
      providerId,
      hostname: agent.hostname,
      displayName: agent.hostname,
      agentVersion: agent.agentVersion,
      capabilities: agent.capabilities,
      device,
    });
    if (en.error) { agent.lastError = en.error; return { ok: false, error: en.error, message: en.message }; }
    agent.deviceId = en.deviceId;
    agent.credential = en.credential;
    agent.providerId = en.providerId;
    agent.siteId = en.siteId || agent.siteId;
    agent.groupIds = asArr(en.groupIds).length ? asArr(en.groupIds) : agent.groupIds;
    agent.enrolledAt = now();
    /* Tag the device with collector linkage so dispatch agrees on the id. */
    try {
      const g = await D.get(agent.providerId, agent.deviceId);
      if (!g.error) {
        const custom = Object.assign({}, asObj(g.device.custom), { collectorDeviceId: agent.deviceId, simulated: true });
        await D.update(agent.providerId, agent.deviceId, { custom });
      }
    } catch (e) {}
    return { ok: true, deviceId: en.deviceId, credential: en.credential, tokenId: en.tokenId, siteId: agent.siteId };
  };

  /* ─────────────────────── agent operations ─────────────────────── */

  SIM.heartbeat = async function (agent, opts) {
    opts = opts || {};
    if (!agent.deviceId) return { ok: false, error: "not_enrolled" };
    const res = await H.heartbeat({ deviceId: agent.deviceId, credential: agent.credential, payload: SIM.buildHeartbeat(agent, opts) });
    if (!res.ok) agent.lastError = res.error;
    return res;
  };

  SIM.sendInventory = async function (agent, opts) {
    opts = opts || {};
    if (!agent.deviceId) return { ok: false, error: "not_enrolled" };
    const g = await D.get(agent.providerId, agent.deviceId);
    if (g.error) return { ok: false, error: g.error };
    const raw = opts.raw || SIM.buildInventory(agent, g.device, opts);
    let prevSections = null;
    try { const snap = await INV.snapshot(agent.deviceId); prevSections = snap && snap.sections ? snap.sections : null; } catch (e) {}
    const payload = isFn(INV.agentPayload) ? INV.agentPayload(prevSections, raw, opts.at || now()) : { mode: "full", inventory: raw, collectedAt: opts.at || now() };
    const res = await INV.submit({ deviceId: agent.deviceId, credential: agent.credential, payload });
    if (res && res.ok) { agent.inventories = num(agent.inventories, 0) + 1; agent.inventoryRevision = res.revision; }
    else if (res) agent.lastError = res.error;
    return res;
  };

  SIM.sendMetrics = async function (agent, opts) {
    opts = opts || {};
    if (!agent.deviceId) return { ok: false, error: "not_enrolled" };
    let samples = asArr(opts.samples);
    if (!samples.length) {
      const count = Math.max(1, num(opts.sampleCount, 1));
      const baseMs = Date.parse(opts.at || now());
      const interval = num(opts.intervalSeconds, 60) * 1000;
      for (let i = count - 1; i >= 0; i--) samples.push(SIM.buildSample(agent, new Date(baseMs - i * interval).toISOString(), { salt: num(agent.samples, 0) + i }));
    }
    const payload = { samples, intervalSeconds: num(opts.intervalSeconds, 60) };
    const res = await MET.submit({ deviceId: agent.deviceId, credential: agent.credential, payload });
    if (res && res.ok) agent.samples = num(agent.samples, 0) + res.accepted;
    else if (res) agent.lastError = res.error;
    return res;
  };

  /* Answer one delivered job. `opts.result` / `agent.jobPolicy` may be a
     plain object or a function (job, agent) → { ok, exitCode, stdout, ... }. */
  SIM.answerJob = async function (agent, job, opts) {
    opts = opts || {};
    if (!agent.deviceId) return { ok: false, error: "not_enrolled" };
    let spec = null;
    const policy = opts.result || (agent.jobAnswers && agent.jobAnswers[job.jobId]) || agent.jobPolicy;
    if (isFn(policy)) { try { spec = policy(job, agent) || {}; } catch (e) { spec = { ok: false, error: (e && e.message) || "policy threw" }; } }
    else if (policy && typeof policy === "object") spec = policy;
    spec = asObj(spec);
    const startedAt = new Date().toISOString();
    const endedAt = new Date(Date.parse(startedAt) + num(spec.durationMs, 420)).toISOString();
    const ok = spec.ok === true || (spec.ok === undefined && spec.state !== "failed" && spec.state !== "timed-out");
    const res = await J.result({
      deviceId: agent.deviceId,
      credential: agent.credential,
      jobId: job.jobId,
      ok,
      state: spec.state,
      exitCode: spec.exitCode != null ? spec.exitCode : (ok ? 0 : 1),
      stdout: spec.stdout != null ? spec.stdout : ("$ " + (job.name || job.jobId) + "\n" + (ok ? "ok" : "failed") + "\n"),
      stderr: spec.stderr || "",
      error: spec.error || "",
      startedAt, endedAt,
    });
    if (res && res.ok) agent.jobsAnswered = num(agent.jobsAnswered, 0) + 1;
    return res;
  };

  /* One check-in: heartbeat, then whatever the response asked for
     (inventory/metrics/jobs), plus the periodic schedule. */
  SIM.cycle = async function (agent, opts) {
    opts = opts || {};
    const out = { agentId: agent.id, hostname: agent.hostname, deviceId: agent.deviceId, heartbeat: null, inventory: null, metrics: null, jobs: [], error: "" };
    const hb = await SIM.heartbeat(agent, opts);
    out.heartbeat = hb;
    if (!hb || hb.ok === false) { out.error = (hb && hb.error) || "heartbeat_failed"; return out; }
    agent.cycles = num(agent.cycles, 0) + 1;
    const metricsEvery = Math.max(1, num(opts.metricsEvery, 1));
    const inventoryEvery = Math.max(0, num(opts.inventoryEvery, 4));
    if (opts.metrics !== false && agent.cycles % metricsEvery === 0) out.metrics = await SIM.sendMetrics(agent, opts);
    if (opts.inventory === true || hb.collectInventory || (inventoryEvery > 0 && agent.cycles % inventoryEvery === 0)) {
      out.inventory = await SIM.sendInventory(agent, opts);
    }
    for (const job of asArr(hb.jobs)) out.jobs.push(await SIM.answerJob(agent, job, opts));
    return out;
  };

  SIM.run = async function (agent, cycles, opts) {
    const out = [];
    for (let i = 0; i < Math.max(1, num(cycles, 1)); i++) out.push(await SIM.cycle(agent, opts));
    return out;
  };

  SIM.runAll = async function (agents, cycles, opts) {
    const out = [];
    for (const agent of asArr(agents)) out.push(await SIM.run(agent, cycles, opts));
    return out;
  };

  /* ─────────────────────── fixture tenant ─────────────────────── */

  /* A default fleet: one of every profile, then round-robin. Servers
     land in the servers group, workstations in workstations, and each
     site gets a mix. */
  SIM.defaultFleet = function (count, opts) {
    opts = opts || {};
    const sites = asArr(opts.sites).length ? opts.sites : SIM.DEFAULT_SITES;
    const groups = asArr(opts.groups).length ? opts.groups : SIM.DEFAULT_GROUPS;
    const n = Math.max(1, num(count, 6));
    const specs = [];
    for (let i = 0; i < n; i++) {
      const profile = SIM.PROFILES[i % SIM.PROFILES.length];
      const site = sites[i % sites.length];
      const group = profile.role === "server" ? groups.find((g) => g.key === "servers") : groups.find((g) => g.key === "workstations");
      specs.push({
        index: i,
        profileId: profile.id,
        siteId: site ? site.id : undefined,
        groupIds: group ? [group.id] : [],
        temperamentId: opts.temperamentId || "normal",
        seed: opts.seed != null ? num(opts.seed, 0) + i * 7919 : undefined,
        sites, groups,
      });
    }
    return specs;
  };

  /* Build a provider with sites, groups and an enrolled fleet. Returns
     everything a caller needs to keep driving it. */
  SIM.fixtures = async function (opts) {
    opts = opts || {};
    const sites = (asArr(opts.sites).length ? opts.sites : SIM.DEFAULT_SITES).map((s) => ({ id: String(s.id), name: S(s.name, 120), code: S(s.code || s.key || "", 12) }));
    const groups = (asArr(opts.groups).length ? opts.groups : SIM.DEFAULT_GROUPS).map((g) => ({ id: String(g.id), name: S(g.name, 120), kind: g.kind || "static" }));
    const name = S(opts.name, 120) || ("Simulated Fleet " + new Date().toISOString().slice(0, 10));
    const created = await T.create({ name, sites, deviceGroups: groups });
    if (created.error) return { error: created.error, message: created.message };
    const providerId = created.provider.id;

    const specs = asArr(opts.agents).length
      ? asArr(opts.agents)
      : SIM.defaultFleet(opts.fleet == null ? 6 : opts.fleet, { sites, groups, seed: opts.seed, temperamentId: opts.temperamentId });
    const agents = [];
    const errors = [];
    for (const spec of specs) {
      const agent = SIM.createAgent(Object.assign({}, spec, { providerId, sites, groups }));
      const en = await SIM.enrollAgent(agent);
      if (en.ok === false) errors.push({ hostname: agent.hostname, error: en.error });
      agents.push(agent);
    }
    return { ok: true, providerId, providerName: name, sites, groups, agents, errors };
  };

  /* ─────────────────────── end-to-end loop ─────────────────────── */

  /* opts: { name, fleet, seed, temperament, monitorThresholds,
            autoTicket, withAutomation, jobs }
     Runs: enrol → heartbeat → inventory → metrics → monitor breach →
     alert → route → automation → psa-u ticket → recover → auto-clear →
     ticket resolved. Returns a structured trace. */
  SIM.fullLoop = async function (opts) {
    opts = opts || {};
    const steps = [];
    const step = (label, detail) => { steps.push({ label, detail: detail || "" }); };
    const MONs = ERP.monitors, ALs = ERP.alerts, AUTOs = ERP.automations, PSAs = ERP.psa, RTs = ERP.routing;
    if (!MONs || !ALs) return { ok: false, error: "engines_unavailable" };

    /* A wall-clock instant outside every maintenance window, so the sweep
       treats the breach as genuine rather than a suppressed weekend event.
       Recovery is scanned a minute later. */
    const at = opts.at || SIM.cleanTime();
    const at2 = new Date(Date.parse(at) + 60000).toISOString();

    const f = await SIM.fixtures({
      name: opts.name || "Simulated Loop",
      fleet: opts.fleet == null ? 4 : opts.fleet,
      seed: opts.seed,
      temperamentId: "normal",
    });
    if (f.error) return { ok: false, error: f.error, message: f.message, steps };
    const pid = f.providerId;
    step("fixture", f.agents.length + " agent(s) enrolled across " + f.sites.length + " sites");

    /* 1 · every agent checks in once (online, inventory, first metrics) */
    for (const agent of f.agents) await SIM.cycle(agent, { inventory: true, metricsEvery: 1 });
    step("heartbeat", f.agents.length + " agent(s) reporting");

    /* 2 · a CPU monitor that fires immediately, targeting the whole fleet */
    const mon = await MONs.add(pid, Object.assign({
      name: "CPU saturation", type: "cpu", forMinutes: 0, severity: "sev-critical",
      thresholds: { warning: 85, critical: 95 }, targets: {},
    }, asObj(opts.monitor)));
    if (mon.error) return { ok: false, error: "monitor_add_failed", detail: mon, steps };
    const monitorId = (mon.monitor || {}).id;
    step("monitor", "CPU monitor armed (warn 85 / crit 95, fires immediately)");

    /* 3 · an automation that reacts to the alert: notify, ticket, remediate */
    let ruleId = null, runResult = null;
    if (opts.withAutomation !== false && AUTOs) {
      const target = f.agents[0];
      const rule = await AUTOs.add(pid, {
        name: "Critical alert response",
        description: "Notify, open a ticket, and run a remediation script when a critical alert fires.",
        enabled: true,
        trigger: { type: "alert.fired" },
        target: {},
        allowDuringMaintenance: true,
        actions: [
          { type: "send-notification", params: { severityId: "sev-critical", subject: "Critical alert", message: "{{rule}} fired on {{device}}." } },
          { type: "create-ticket", params: { subject: "Critical alert on {{device}}" } },
          { type: "run-script", params: { language: target.language, script: "echo remediating {{device}}", timeoutSeconds: 60 } },
        ],
      });
      if (rule.error) return { ok: false, error: "automation_add_failed", detail: rule, steps };
      ruleId = (rule.rule || {}).id;
      step("automation", "rule armed (notify + ticket + remediation job)");
    }

    /* 4 · one agent's metrics cross the critical threshold */
    const hot = f.agents[0];
    hot.temperamentId = opts.temperament || "hot";
    const hotMetric = await SIM.sendMetrics(hot, { intervalSeconds: 60 });
    step("metrics", hot.hostname + " reports CPU " + ((hotMetric && hotMetric.latest && hotMetric.latest.cpuPct) || "?") + "%");

    /* 5 · the monitor sweep turns the breach into an alert */
    const scan1 = await ALs.scan(pid, { at });
    const active = await ALs.active(pid);
    const alert = active[0] || null;
    step("alert", alert ? (alert.severityLabel + " alert on " + alert.hostname + " (" + alert.state + ")") : "no alert fired");
    if (!alert) return { ok: false, error: "alert_not_fired", scan: scan1, steps };

    /* 6 · the fleet checks in again, answering the automation's job */
    let jobTrace = null;
    for (const agent of f.agents) {
      const outs = await SIM.run(agent, 1, { metricsEvery: 1 });
      for (const o of asArr(outs[0] && outs[0].jobs)) {
        if (!jobTrace) jobTrace = { deviceId: agent.deviceId, state: o.state || o.deviceState, jobId: (o.job || {}).id };
      }
    }
    if (jobTrace) step("job", "remediation job " + (jobTrace.state || "answered"));

    let run = null;
    if (ruleId && AUTOs) {
      const rules = await AUTOs.list(pid);
      const rec = asArr(rules).find((r) => String(r.id) === String(ruleId));
      run = rec && asArr(rec.runs)[0] ? asArr(rec.runs)[0] : null;
      if (run) runResult = { status: run.status, counts: run.counts, summary: run.summary };
      step("automation run", run ? (run.status + " — " + run.summary) : "no run recorded");
    }

    /* 7 · recovery: metrics return to normal and the monitor auto-clears */
    hot.temperamentId = "normal";
    await SIM.sendMetrics(hot, { intervalSeconds: 60 });
    const scan2 = await ALs.scan(pid, { at: at2 });
    const resolved = asArr(await ALs.list(pid, { state: "resolved" }))[0] || null;
    step("recovery", resolved ? "alert auto-cleared" : "alert still active");

    let ticket = null;
    if (PSAs) {
      const open = await PSAs.forAlert(pid, alert.id);
      ticket = open || null;
    }
    if (alert.ticketId && PSAs) { try { ticket = (await PSAs.ticket(alert.ticketId)) || ticket; } catch (e) {} }
    step("ticket", ticket ? ("psa-u " + ticket.externalId + " → " + ticket.status) : "no ticket");

    let notifications = 0;
    try { if (ERP.notify) notifications = asArr(await ERP.notify.list(pid, {})).length; } catch (e) {}
    let routes = 0;
    try { if (RTs) routes = asArr((await T.get(pid)).provider.alerts).reduce((a, x) => a + asArr(x.routing).length, 0); } catch (e) {}

    const provider = (await T.get(pid)).provider;
    return {
      ok: true,
      providerId: pid, providerName: f.providerName,
      agents: f.agents, sites: f.sites, groups: f.groups,
      monitorId, ruleId,
      alert: alert ? { id: alert.id, state: alert.state, severityId: alert.severityId, severityLabel: alert.severityLabel, subject: alert.subject, hostname: alert.hostname } : null,
      scanFired: scan1, automation: runResult, job: jobTrace,
      recovery: { scan: scan2, cleared: !!resolved, alertState: resolved ? resolved.state : (alert ? alert.state : null) },
      ticket: ticket ? { id: ticket.id, externalId: ticket.externalId, status: ticket.status, alertId: ticket.alertId } : null,
      notifications, routeDeliveries: routes,
      devices: asArr(provider.devices).length,
      alerts: asArr(provider.alerts).length,
      steps,
    };
  };

  /* ─────────────────────── reads ─────────────────────── */

  SIM.stats = async function (providerId) {
    const out = { providerId, devices: 0, online: 0, stale: 0, offline: 0, alerts: 0, activeAlerts: 0, tickets: 0, jobs: 0, monitored: 0 };
    if (!providerId) return out;
    const g = await T.get(providerId);
    if (g.error) return out;
    const devices = asArr(g.provider.devices).map(D.normalizeDevice);
    out.devices = devices.length;
    devices.forEach((d) => {
      const s = D.effectiveStatus(d);
      if (s === "online") out.online++;
      else if (s === "stale") out.stale++;
      else if (s === "offline") out.offline++;
    });
    out.alerts = asArr(g.provider.alerts).length;
    if (ERP.alerts) { try { out.activeAlerts = asArr(await ERP.alerts.active(providerId)).length; } catch (e) {} }
    if (ERP.psa) { try { out.tickets = asArr(await ERP.psa.tickets(providerId, {})).length; } catch (e) {} }
    if (J) { try { const s = await J.stats(providerId); out.jobs = num(s && s.jobs, 0); } catch (e) {} }
    if (ERP.monitors) { try { const s = ERP.monitors.statsOf(g.provider); out.monitored = num(s && s.covered, 0); } catch (e) {} }
    return out;
  };

  /* ─────────────────────── console panel ─────────────────────── */

  SIM.renderPanel = async function (panel, opts) {
    if (!panel) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (function () {});
    const state = {
      fleet: Math.max(1, num(opts.fleet, 6)),
      seed: num(opts.seed, SIM.newSeed()),
      providerId: opts.providerId || null,
      agents: [],
      stats: null,
      result: null,
      busy: false,
      log: [],
    };
    const stamp = () => new Date().toISOString().slice(11, 19);
    function pushLog(kind, text) { state.log.unshift({ at: stamp(), kind, text: S(text, 300) }); state.log = state.log.slice(0, 80); }

    function summaryHtml() {
      const s = state.stats || {};
      return ui.grid([
        ui.statCard({ label: "Simulated agents", value: String(state.agents.length), sub: state.providerId ? "fixture tenant" : "none yet" }),
        ui.statCard({ label: "Online", value: String(num(s.online, 0)), tone: s.online ? "success" : null, sub: num(s.devices, 0) + " devices" }),
        ui.statCard({ label: "Active alerts", value: String(num(s.activeAlerts, 0)), tone: s.activeAlerts ? "warn" : null, sub: num(s.alerts, 0) + " total" }),
        ui.statCard({ label: "psa-u tickets", value: String(num(s.tickets, 0)), sub: "from alerts & automations" }),
        ui.statCard({ label: "Jobs", value: String(num(s.jobs, 0)), sub: "queued & run" }),
      ], "erp-kpi-grid");
    }

    function controlsHtml() {
      const profiles = SIM.PROFILES.map((p) => esc(p.label)).join(" · ");
      return ui.card("Build a simulated fleet",
        '<p class="erp-sub">Each agent follows the real enrolment → heartbeat → collect → act path: a one-time token is issued, exchanged for a per-device credential, and every later post is authenticated with it. Profiles: ' + profiles + '.</p>' +
        '<div class="erp-inline-form">' +
          '<div class="field"><label>Fleet size</label><input type="number" min="1" max="40" name="simFleet" value="' + esc(state.fleet) + '"></div>' +
          '<div class="field"><label>Seed</label><input type="number" name="simSeed" value="' + esc(state.seed) + '"></div>' +
          '<div class="erp-btn-row">' +
            ui.btn("Seed fleet", { primary: true, act: "sim-seed" }) +
            ui.btn("Run 1 cycle", { act: "sim-cycle", arg: "1" }) +
            ui.btn("Run 5 cycles", { act: "sim-cycle", arg: "5" }) +
            ui.btn("Run end-to-end loop", { act: "sim-loop" }) +
          "</div>" +
        "</div>" +
        '<p class="erp-sub">“Run end-to-end loop” builds a fresh tenant and drives enrol → monitor → alert → automation → psa-u ticket → auto-clear.</p>');
    }

    function agentTableHtml() {
      const rows = state.agents.map((a, i) => ({
        host: "<b>" + esc(a.hostname) + '</b><div class="erp-sub">' + esc(a.profileId) + " · " + esc(a.os.name) + "</div>",
        site: esc(a.siteName || "—"),
        group: esc(asArr(a.groupNames).join(", ") || "—"),
        temp: ui.badge(SIM.temperament(a.temperamentId).label, a.temperamentId === "normal" ? "muted" : "warn"),
        device: a.deviceId ? "<code>" + esc(a.deviceId) + "</code>" : '<span class="erp-sub">not enrolled</span>',
        done: esc(a.cycles + " cycles · " + a.samples + " samples · " + a.jobsAnswered + " jobs"),
        act: ui.btn("Advance", { small: true, act: "sim-advance", arg: String(i) }),
      }));
      return ui.card("Agents (" + rows.length + ")",
        ui.table([
          { key: "host", label: "Host", width: "200px", render: (r) => r.host },
          { key: "site", label: "Site", width: "120px", render: (r) => r.site },
          { key: "group", label: "Group", width: "130px", render: (r) => r.group },
          { key: "temp", label: "Temperament", width: "120px", render: (r) => r.temp },
          { key: "device", label: "Device id", width: "170px", render: (r) => r.device },
          { key: "done", label: "Activity", render: (r) => r.done },
          { key: "act", label: "", width: "90px", render: (r) => r.act },
        ], rows, { scroll: true, emptyText: "No agents yet — seed a fleet above." }));
    }

    function resultHtml() {
      const r = state.result;
      if (!r) return "";
      if (r.ok === false) return ui.card("End-to-end result", ui.alert("The loop did not complete: " + (r.error || "unknown") + (r.detail ? " — " + JSON.stringify(r.detail).slice(0, 300) : ""), "danger"));
      const rows = asArr(r.steps).map((s) => ({ step: "<b>" + esc(s.label) + "</b>", detail: esc(s.detail) }));
      return ui.card("End-to-end result · " + esc(r.providerName),
        ui.summary([
          { label: "Devices", value: String(r.devices) },
          { label: "Alerts", value: String(r.alerts) },
          { label: "Rule run", value: r.automation ? String(r.automation.status) : "—" },
          { label: "Ticket", value: r.ticket ? String(r.ticket.status) : "—" },
          { label: "Notifications", value: String(r.notifications) },
        ]) +
        ui.table([
          { key: "step", label: "Stage", width: "150px", render: (x) => x.step },
          { key: "detail", label: "Outcome", render: (x) => x.detail },
        ], rows, { scroll: true }));
    }

    function logHtml() {
      if (!state.log.length) return "";
      const rows = state.log.map((l) => ({ at: esc(l.at), kind: ui.badge(l.kind, l.kind === "error" ? "danger" : l.kind === "seed" ? "info" : "muted"), text: esc(l.text) }));
      return ui.card("Simulator log", ui.table([
        { key: "at", label: "Time", width: "90px", render: (r) => r.at },
        { key: "kind", label: "Event", width: "120px", render: (r) => r.kind },
        { key: "text", label: "Detail", render: (r) => r.text },
      ], rows, { scroll: true }));
    }

    function paint() {
      panel.innerHTML =
        ui.pageHead("Agent simulator", "Manufacture the full agent lifecycle — enrol, heartbeat, collect, act — and watch monitoring, alerting, automation and the psa-u bridge react to it.") +
        (state.busy ? ui.alert("Working… the simulated fleet is checking in.", "info") : "") +
        summaryHtml() + controlsHtml() +
        (state.result ? resultHtml() : "") +
        (state.agents.length ? agentTableHtml() : "") +
        logHtml();
      bind();
    }

    function readInputs() {
      const f = panel.querySelector('[name="simFleet"]');
      const s = panel.querySelector('[name="simSeed"]');
      if (f) state.fleet = Math.max(1, Math.min(40, num(f.value, 6)));
      if (s) state.seed = num(s.value, state.seed);
    }

    async function seedFleet() {
      readInputs();
      state.busy = true; state.result = null; paint();
      const f = await SIM.fixtures({ name: "Simulated Fleet", fleet: state.fleet, seed: state.seed });
      state.busy = false;
      if (f.error) { pushLog("error", "fixture failed: " + f.error); toast("Could not build the fleet.", "error"); }
      else {
        state.providerId = f.providerId;
        state.agents = f.agents;
        pushLog("seed", f.agents.length + " agent(s) enrolled under " + f.providerName);
        if (asArr(f.errors).length) pushLog("error", asArr(f.errors).length + " agent(s) failed to enrol");
      }
      state.stats = await SIM.stats(state.providerId);
      paint();
    }

    async function runCycles(n) {
      if (!state.agents.length) { toast("Seed a fleet first."); return; }
      state.busy = true; paint();
      let hb = 0, jobs = 0;
      for (const agent of state.agents) {
        const outs = await SIM.run(agent, n, { inventoryEvery: 0 });
        outs.forEach((o) => { if (o.heartbeat && o.heartbeat.ok) hb++; jobs += asArr(o.jobs).length; });
      }
      state.busy = false;
      pushLog("cycle", n + " cycle(s) × " + state.agents.length + " agents → " + hb + " heartbeats, " + jobs + " job(s) answered");
      state.stats = await SIM.stats(state.providerId);
      paint();
    }

    async function advance(i) {
      const agent = state.agents[i];
      if (!agent) return;
      state.busy = true; paint();
      const out = await SIM.cycle(agent, { inventoryEvery: 0 });
      state.busy = false;
      pushLog(out.error ? "error" : "cycle", agent.hostname + (out.error ? " — " + out.error : " checked in" + (asArr(out.jobs).length ? ", answered " + asArr(out.jobs).length + " job(s)" : "")));
      state.stats = await SIM.stats(state.providerId);
      paint();
    }

    async function runLoop() {
      readInputs();
      state.busy = true; state.result = null; paint();
      const r = await SIM.fullLoop({ name: "Simulated Loop", fleet: state.fleet, seed: state.seed });
      state.busy = false;
      state.result = r;
      if (r.ok) {
        state.providerId = r.providerId;
        state.agents = r.agents;
        pushLog("loop", "end-to-end loop complete: " + (r.recovery && r.recovery.cleared ? "alert cleared" : "alert still open") + ", ticket " + (r.ticket ? r.ticket.status : "none"));
        toast(r.ticket ? ("Loop complete — psa-u ticket " + r.ticket.externalId) : "Loop complete.");
      } else {
        pushLog("error", "loop failed: " + (r.error || "unknown"));
        toast("End-to-end loop failed.", "error");
      }
      state.stats = await SIM.stats(state.providerId);
      paint();
    }

    function bind() {
      panel.onclick = (e) => {
        const a = e.target.closest && e.target.closest("[data-act]");
        if (!a || !panel.contains(a)) return;
        e.preventDefault();
        const act = a.getAttribute("data-act");
        if (state.busy) return;
        if (act === "sim-seed") return seedFleet();
        if (act === "sim-cycle") return runCycles(Math.max(1, num(a.getAttribute("data-arg"), 1)));
        if (act === "sim-advance") return advance(num(a.getAttribute("data-arg"), 0));
        if (act === "sim-loop") return runLoop();
      };
    }

    if (state.providerId) {
      const existing = await SIM.stats(state.providerId);
      state.stats = existing;
    }
    paint();
    return { state, paint, seedFleet, runCycles, runLoop };
  };

  SIM.renderInto = async function (host, opts) {
    if (!host) return null;
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-simulator";
    host.appendChild(wrap);
    return SIM.renderPanel(wrap, opts);
  };

  /* ─────────────────────── boot ─────────────────────── */

  let readyResolve;
  SIM.ready = new Promise((res) => { readyResolve = res; });
  SIM.init = function () { try { readyResolve(); } catch (e) {} return SIM; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", SIM.init);
  else SIM.init();
})();
