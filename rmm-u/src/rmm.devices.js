/* ============================================================
   RMM-U — device hierarchy & inventory record (Phase 1 · Task 3)

   The managed fleet, modelled inside each provider aggregate
   (rmm-v1-provider-<id>, see src/rmm.tenancy.js):

       provider
         └─ site(s)
              └─ device-group(s)          (static groups live here;
                                           dynamic groups arrive Task 18)
                   └─ device(s)
         └─ provider-wide group(s)        (group with no site)
         └─ unassigned device(s)          (device with no site)

   A device is the anchor every other station attaches to: it carries
   the rich inventory record — identity, OS, hardware, disks, network,
   logged-in users, tags, warranty/support dates, the agent version &
   last-seen, and a link to its configuration record in the
   documentation tool. Monitors, alerts, patches, software, security
   and jobs all reference a device id.

   window.ERP.devices is the service + the Devices station controller.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = (ERP.devices = {});

  /* ─────────────────────── taxonomies ─────────────────────── */

  const STATUSES = ["online", "offline", "stale", "unknown", "maintenance", "retired"];
  const ROLES = ["workstation", "laptop", "server", "network", "mobile", "printer", "virtual", "other"];
  const FORM_FACTORS = ["desktop", "laptop", "tower", "rack", "blade", "vm", "tablet", "phone", "appliance", "other"];
  const DISK_KINDS = ["ssd", "nvme", "hdd", "optical", "virtual", "other"];
  const OS_FAMILIES = ["Windows", "Linux", "macOS", "Unix", "ChromeOS", "iOS", "Android", "Network", "Other"];
  const AGENT_CHANNELS = ["stable", "beta", "lts"];

  D.STATUSES = STATUSES.slice();
  D.ROLES = ROLES.slice();
  D.FORM_FACTORS = FORM_FACTORS.slice();
  D.DISK_KINDS = DISK_KINDS.slice();
  D.OS_FAMILIES = OS_FAMILIES.slice();
  D.AGENT_CHANNELS = AGENT_CHANNELS.slice();

  const STATUS_TONE = { online: "success", offline: "danger", stale: "warn", unknown: "muted", maintenance: "info", retired: "muted" };
  const ROLE_ICON = { server: "devices", network: "integrations", virtual: "devices", mobile: "devices" };

  D.statusMeta = (s) => ({ label: String(s || "unknown").charAt(0).toUpperCase() + String(s || "unknown").slice(1), tone: STATUS_TONE[s] || "muted" });

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d || 0); };
  const now = () => new Date().toISOString();
  const iso = (ms) => new Date(ms).toISOString();
  const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rand = (n) => { let s = ""; for (let i = 0; i < n; i++) s += CHARS[(Math.random() * CHARS.length) | 0]; return s; };
  const rid = (prefix) => prefix + "-" + rand(6);

  const GiB = 1024 * 1024 * 1024;
  const MiB = 1024 * 1024;

  const staleMs = () => { const m = num(cfg("rmm.staleAfterMinutes", 15), 15); return (m > 0 ? m : 15) * 60000; };

  function guessFamily(name) {
    const s = String(name || "").toLowerCase();
    if (/windows/.test(s)) return "Windows";
    if (/mac ?os|os ?x|darwin/.test(s)) return "macOS";
    if (/ubuntu|debian|centos|red hat|rhel|fedora|suse|linux/.test(s)) return "Linux";
    if (/chrome ?os/.test(s)) return "ChromeOS";
    if (/ios|ipad/.test(s)) return "iOS";
    if (/android/.test(s)) return "Android";
    if (/unix|freebsd|solaris/.test(s)) return "Unix";
    return "";
  }

  function pick(value, allowed, fallback) { return allowed.indexOf(value) !== -1 ? value : fallback; }

  /* ─────────────────────── the rich device record ─────────────────────── */

  function newDisk(d) {
    d = asObj(d);
    return {
      id: d.id || rid("disk"),
      label: String(d.label || d.name || ""),
      model: String(d.model || ""),
      kind: pick(d.kind, DISK_KINDS, "other"),
      sizeBytes: num(d.sizeBytes, 0),
      freeBytes: num(d.freeBytes, 0),
      filesystem: String(d.filesystem || ""),
      volume: String(d.volume || ""),
    };
  }

  function newInterface(i) {
    i = asObj(i);
    return {
      id: i.id || rid("nic"),
      name: String(i.name || ""),
      mac: String(i.mac || "").toLowerCase(),
      ip4: asArr(i.ip4).map(String),
      ip6: asArr(i.ip6).map(String),
      subnet: String(i.subnet || ""),
      gateway: String(i.gateway || ""),
      dns: asArr(i.dns).map(String),
      dhcp: !!i.dhcp,
      speedMbps: num(i.speedMbps, 0),
      virtual: !!i.virtual,
    };
  }

  function newUser(u) {
    u = asObj(u);
    return {
      name: String(u.name || ""),
      domain: String(u.domain || ""),
      session: String(u.session || "console"),
      since: u.since || "",
    };
  }

  /* The canonical device record. Missing fields are normalised to safe
     defaults so partial/older documents still open (see normalizeDevice). */
  function newDevice(data) {
    data = data || {};
    const os = asObj(data.os);
    const cpu = asObj(data.cpu);
    const agent = asObj(data.agent);
    const doc = asObj(data.documentation);
    return {
      kind: "device",
      id: data.id || T.newItemId("devices"),
      providerId: String(data.providerId || ""),
      siteId: data.siteId != null && data.siteId !== "" ? String(data.siteId) : null,
      groupIds: asArr(data.groupIds).map(String),
      status: pick(data.status, STATUSES, "unknown"),
      role: pick(data.role, ROLES, "workstation"),
      hostname: String(data.hostname || ""),
      displayName: String(data.displayName || data.hostname || ""),
      description: String(data.description || ""),
      os: {
        family: os.family ? String(os.family) : guessFamily(os.name),
        name: String(os.name || ""),
        version: String(os.version || ""),
        build: String(os.build || ""),
        edition: String(os.edition || ""),
        arch: String(os.arch || "x64"),
        installDate: os.installDate || "",
      },
      manufacturer: String(data.manufacturer || ""),
      model: String(data.model || ""),
      serial: String(data.serial || ""),
      formFactor: pick(data.formFactor, FORM_FACTORS, "desktop"),
      domain: String(data.domain || ""),
      domainRole: pick(data.domainRole, ["member", "dc", "workgroup", "standalone"], "member"),
      cpu: {
        model: String(cpu.model || ""),
        cores: num(cpu.cores, 0),
        threads: num(cpu.threads, 0),
        speedMhz: num(cpu.speedMhz, 0),
      },
      ramBytes: num(data.ramBytes, 0),
      disks: asArr(data.disks).map(newDisk),
      gpus: asArr(data.gpus).map((g) => ({ model: String(asObj(g).model || ""), memoryBytes: num(asObj(g).memoryBytes, 0) })),
      interfaces: asArr(data.interfaces).map(newInterface),
      loggedInUsers: asArr(data.loggedInUsers).map(newUser),
      tags: asArr(data.tags).map(String),
      purchaseDate: data.purchaseDate || "",
      warrantyExpiresAt: data.warrantyExpiresAt || "",
      supportExpiresAt: data.supportExpiresAt || "",
      agentVersion: String(data.agentVersion || agent.version || ""),
      agent: Object.assign({}, agent, {
        version: String(agent.version || data.agentVersion || ""),
        channel: pick(agent.channel, AGENT_CHANNELS, "stable"),
        installedAt: agent.installedAt || "",
        capabilities: asArr(agent.capabilities).map(String),
        updatePending: !!agent.updatePending,
      }),
      firstSeenAt: data.firstSeenAt || "",
      lastSeenAt: data.lastSeenAt || "",
      enrolledAt: data.enrolledAt || "",
      documentation: {
        refId: String(doc.refId || ""),
        refUrl: String(doc.refUrl || ""),
        systemId: String(doc.systemId || ""),
        syncedAt: doc.syncedAt || "",
      },
      notes: String(data.notes || ""),
      custom: asObj(data.custom),
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };
  }
  D.newDevice = newDevice;

  /* Bring any stored record up to the current schema without losing data. */
  function normalizeDevice(dev) {
    if (!dev || typeof dev !== "object") return null;
    const base = newDevice(dev);
    return Object.assign({}, dev, base, {
      id: dev.id || base.id,
      providerId: dev.providerId || base.providerId,
      siteId: dev.siteId != null && dev.siteId !== "" ? String(dev.siteId) : null,
      groupIds: asArr(dev.groupIds).map(String),
      os: Object.assign({}, base.os, asObj(dev.os)),
      cpu: Object.assign({}, base.cpu, asObj(dev.cpu)),
      agent: Object.assign({}, base.agent, asObj(dev.agent)),
      documentation: Object.assign({}, base.documentation, asObj(dev.documentation)),
      disks: asArr(dev.disks).map(newDisk),
      gpus: asArr(dev.gpus).map((g) => ({ model: String(asObj(g).model || ""), memoryBytes: num(asObj(g).memoryBytes, 0) })),
      interfaces: asArr(dev.interfaces).map(newInterface),
      loggedInUsers: asArr(dev.loggedInUsers).map(newUser),
      tags: asArr(dev.tags).map(String),
      custom: asObj(dev.custom),
    });
  }
  D.normalizeDevice = normalizeDevice;

  D.deviceFields = () => Object.keys(newDevice());

  function validateDevice(dev) {
    const errors = [];
    if (!dev || typeof dev !== "object") return { valid: false, errors: ["device is not an object"] };
    if (!dev.id) errors.push("missing id");
    if (!dev.hostname && !dev.displayName) errors.push("missing hostname/displayName");
    if (STATUSES.indexOf(dev.status) === -1) errors.push("invalid status: " + dev.status);
    if (ROLES.indexOf(dev.role) === -1) errors.push("invalid role: " + dev.role);
    if (!dev.os || typeof dev.os !== "object") errors.push("missing os");
    if (!Array.isArray(dev.disks)) errors.push("disks is not an array");
    if (!Array.isArray(dev.interfaces)) errors.push("interfaces is not an array");
    if (!Array.isArray(dev.groupIds)) errors.push("groupIds is not an array");
    if (!Array.isArray(dev.tags)) errors.push("tags is not an array");
    if (num(dev.ramBytes, -1) < 0) errors.push("ramBytes must be >= 0");
    if (dev.lastSeenAt && isNaN(Date.parse(dev.lastSeenAt))) errors.push("lastSeenAt is not a valid date");
    if (dev.warrantyExpiresAt && isNaN(Date.parse(dev.warrantyExpiresAt))) errors.push("warrantyExpiresAt is not a valid date");
    if (dev.supportExpiresAt && isNaN(Date.parse(dev.supportExpiresAt))) errors.push("supportExpiresAt is not a valid date");
    return { valid: errors.length === 0, errors };
  }
  D.validateDevice = validateDevice;

  /* ─────────────────────── derived attributes ─────────────────────── */

  D.bytesHuman = function (n) {
    n = num(n, 0);
    if (n >= 1024 * GiB) return (n / (1024 * GiB)).toFixed(1) + " TiB";
    if (n >= GiB) return (n / GiB).toFixed(1) + " GiB";
    if (n >= MiB) return (n / MiB).toFixed(1) + " MiB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KiB";
    return n + " B";
  };
  D.ramHuman = (dev) => D.bytesHuman(dev && dev.ramBytes);

  D.primaryInterface = function (dev) {
    const list = asArr(dev && dev.interfaces);
    return list.find((i) => i.gateway && i.gateway !== "0.0.0.0") ||
      list.find((i) => (i.ip4 || []).some((ip) => !/^169\.254\./.test(ip) && !/^127\./.test(ip))) ||
      list[0] || null;
  };
  D.primaryIp = (dev) => { const i = D.primaryInterface(dev); return i && i.ip4 && i.ip4[0] ? i.ip4[0] : ""; };
  D.primaryMac = (dev) => { const i = D.primaryInterface(dev); return i ? i.mac || "" : ""; };
  D.allIps = (dev) => asArr(dev && dev.interfaces).reduce((a, i) => a.concat(asArr(i.ip4)), []);
  D.allMacs = (dev) => asArr(dev && dev.interfaces).map((i) => i.mac).filter(Boolean);
  D.allUsers = (dev) => asArr(dev && dev.loggedInUsers);

  D.totalDiskBytes = (dev) => asArr(dev && dev.disks).reduce((a, d) => a + num(d.sizeBytes, 0), 0);
  D.freeDiskBytes = (dev) => asArr(dev && dev.disks).reduce((a, d) => a + num(d.freeBytes, 0), 0);
  D.diskUsedPct = function (dev) {
    const total = D.totalDiskBytes(dev);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - D.freeDiskBytes(dev) / total) * 100)));
  };

  /* Liveness is derived from last-seen (the stored `status` is a manual
     override for maintenance/retired). Heartbeat & presence land Task 8. */
  D.liveness = function (dev, opts) {
    opts = opts || {};
    if (!dev) return "unknown";
    if (dev.status === "retired") return "retired";
    if (dev.status === "maintenance") return "maintenance";
    const last = dev.lastSeenAt ? Date.parse(dev.lastSeenAt) : NaN;
    if (!isFinite(last)) return dev.status === "offline" ? "offline" : "unknown";
    const age = (opts.now || Date.now()) - last;
    const t = opts.staleMs || staleMs();
    if (age <= t) return "online";
    if (age <= t * 4 || dev.status === "stale") return "stale";
    return "offline";
  };
  D.effectiveStatus = function (dev, opts) {
    if (!dev) return "unknown";
    if (dev.status === "retired" || dev.status === "maintenance") return dev.status;
    return D.liveness(dev, opts);
  };
  D.isOnline = (dev, opts) => D.liveness(dev, opts) === "online";

  /* ─────────────────────── filtering ─────────────────────── */

  D.matches = function (dev, f) {
    if (!dev) return false;
    if (!f) return true;
    if (f.siteId && String(dev.siteId) !== String(f.siteId)) return false;
    if (f.groupId && !asArr(dev.groupIds).some((g) => String(g) === String(f.groupId))) return false;
    if (f.role && dev.role !== f.role) return false;
    if (f.osFamily && dev.os.family !== f.osFamily) return false;
    if (f.tag && !asArr(dev.tags).some((t) => String(t).toLowerCase() === String(f.tag).toLowerCase())) return false;
    if (f.status && D.effectiveStatus(dev) !== f.status && dev.status !== f.status) return false;
    if (f.search) {
      const q = String(f.search).toLowerCase();
      const hay = [dev.hostname, dev.displayName, dev.serial, dev.model, dev.manufacturer, dev.domain,
        (dev.tags || []).join(" "), D.allIps(dev).join(" "), D.allMacs(dev).join(" "),
        D.allUsers(dev).map((u) => u.name).join(" ")].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  };

  /* ─────────────────────── reads ─────────────────────── */

  D.get = async function (providerId, deviceId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const it = g.provider.devices.find((d) => String(d.id) === String(deviceId));
    if (!it) return { error: "not_found", deviceId };
    return { device: normalizeDevice(it), provider: g.provider, rev: g.rev };
  };

  D.list = async function (providerId, filter) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return g.provider.devices.map(normalizeDevice).filter((d) => D.matches(d, filter));
  };

  D.listAll = async function (filter) {
    const providers = await T.list();
    const out = [];
    for (const p of providers) {
      const g = await T.get(p.id);
      if (g.error) continue;
      g.provider.devices.map(normalizeDevice).forEach((d) => { if (D.matches(d, filter)) out.push(d); });
    }
    return out;
  };

  D.forSite = (providerId, siteId) => D.list(providerId, { siteId });
  D.forGroup = (providerId, groupId) => D.list(providerId, { groupId });

  D.groupsOf = function (provider, dev) {
    if (!provider || !dev) return [];
    const ids = asArr(dev.groupIds).map(String);
    return asArr(provider.deviceGroups).filter((g) => ids.indexOf(String(g.id)) !== -1);
  };

  /* Every group a device is in, static plus rule-based (Task 18). Falls
     back to explicit membership when the groups module is absent. */
  D.allGroupsOf = function (provider, dev, ctx) {
    if (window.ERP.groups && typeof window.ERP.groups.groupsForDevice === "function") return window.ERP.groups.groupsForDevice(provider, dev, ctx);
    return D.groupsOf(provider, dev);
  };

  /* Resolve a group's members — explicit for a static group, rule-evaluated
     for a dynamic one (Task 18). Used by the hierarchy and targeting. */
  D.groupMembers = function (provider, group, opts) {
    const devices = (opts && opts.devices) ? opts.devices : asArr(provider.devices).map(normalizeDevice);
    if (group && group.kind === "dynamic" && window.ERP.groups && typeof window.ERP.groups.devicesInGroup === "function") {
      return window.ERP.groups.devicesInGroup(provider, group, Object.assign({ devices }, opts || {}));
    }
    return devices.filter((d) => asArr(d.groupIds).some((x) => String(x) === String(group.id)));
  };

  /* True when a device belongs to a group, honouring dynamic rules. */
  D.matchesGroup = function (provider, dev, groupId) {
    if (!groupId) return true;
    if (asArr(dev.groupIds).some((x) => String(x) === String(groupId))) return true;
    const grp = asArr(provider && provider.deviceGroups).find((g) => String(g.id) === String(groupId));
    if (!grp || grp.kind !== "dynamic") return false;
    if (window.ERP.groups && typeof window.ERP.groups.evaluateRule === "function") return window.ERP.groups.evaluateRule(grp, dev, { provider, soft: {}, svc: {} });
    return false;
  };
  D.siteOf = function (provider, dev) {
    if (!provider || !dev) return null;
    return asArr(provider.sites).find((s) => String(s.id) === String(dev.siteId)) || null;
  };

  /* The full hierarchy for a tenant: sites → groups → devices, plus the
     provider-wide groups and unassigned devices. */
  D.tree = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return D.treeOf(g.provider);
  };

  D.treeOf = function (prov) {
    const devices = asArr(prov.devices).map(normalizeDevice);
    const sites = asArr(prov.sites).map((s) => {
      const siteDevices = devices.filter((d) => String(d.siteId) === String(s.id));
      const groups = asArr(prov.deviceGroups)
        .filter((gr) => gr.siteId != null && String(gr.siteId) === String(s.id))
        .map((gr) => { const set = new Set(D.groupMembers(prov, gr, { devices }).map((d) => String(d.id))); return { group: gr, devices: siteDevices.filter((d) => set.has(String(d.id))) }; });
      const grouped = new Set();
      groups.forEach((gr) => gr.devices.forEach((d) => grouped.add(String(d.id))));
      return { site: s, groups, ungrouped: siteDevices.filter((d) => !grouped.has(String(d.id))), count: siteDevices.length };
    });
    const providerGroups = asArr(prov.deviceGroups)
      .filter((gr) => gr.siteId == null)
      .map((gr) => ({ group: gr, devices: D.groupMembers(prov, gr, { devices }) }));
    const siteIds = asArr(prov.sites).map((s) => String(s.id));
    const orphanGroups = asArr(prov.deviceGroups).filter((gr) => gr.siteId != null && siteIds.indexOf(String(gr.siteId)) === -1);
    return {
      provider: { id: prov.id, name: prov.name },
      sites,
      providerGroups,
      orphanGroups,
      unassigned: devices.filter((d) => d.siteId == null),
      deviceCount: devices.length,
    };
  };

  /* The device's place in the hierarchy — the "anchor" other stations use. */
  D.ancestry = async function (providerId, deviceId) {
    const r = await D.get(providerId, deviceId);
    if (r.error) return r;
    return {
      provider: { id: r.provider.id, name: r.provider.name },
      site: D.siteOf(r.provider, r.device),
      groups: D.groupsOf(r.provider, r.device),
      device: r.device,
    };
  };

  /* ─────────────────────── stats ─────────────────────── */

  D.statsOf = function (prov) {
    const devices = asArr(prov.devices).map(normalizeDevice);
    const byStatus = {}, byRole = {}, byOsFamily = {}, bySite = {};
    let lastSeenAt = "";
    for (const d of devices) {
      const s = D.effectiveStatus(d);
      byStatus[s] = (byStatus[s] || 0) + 1;
      byRole[d.role] = (byRole[d.role] || 0) + 1;
      const fam = d.os.family || "Other";
      byOsFamily[fam] = (byOsFamily[fam] || 0) + 1;
      const sid = d.siteId || "unassigned";
      bySite[sid] = (bySite[sid] || 0) + 1;
      if (d.lastSeenAt && d.lastSeenAt > lastSeenAt) lastSeenAt = d.lastSeenAt;
    }
    return {
      total: devices.length,
      online: byStatus.online || 0,
      offline: byStatus.offline || 0,
      stale: byStatus.stale || 0,
      unknown: (byStatus.unknown || 0) + (byStatus.maintenance || 0) + (byStatus.retired || 0),
      byStatus, byRole, byOsFamily, bySite,
      tags: [...new Set(devices.reduce((a, d) => a.concat(d.tags), []))].sort(),
      lastSeenAt,
    };
  };

  D.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return D.statsOf(g.provider);
  };

  D.fleetStats = async function () {
    const providers = await T.list();
    const out = { providers: providers.length, total: 0, online: 0, offline: 0, stale: 0, unknown: 0, byProvider: {} };
    for (const p of providers) {
      const g = await T.get(p.id);
      if (g.error) continue;
      const s = D.statsOf(g.provider);
      out.total += s.total; out.online += s.online; out.offline += s.offline; out.stale += s.stale; out.unknown += s.unknown;
      out.byProvider[p.id] = { name: p.name, total: s.total, online: s.online, offline: s.offline, stale: s.stale };
    }
    return out;
  };

  /* ─────────────────────── mutations ─────────────────────── */

  function siteExists(prov, siteId) { return !siteId || asArr(prov.sites).some((s) => String(s.id) === String(siteId)); }
  function groupExists(prov, groupId) { return asArr(prov.deviceGroups).some((g) => String(g.id) === String(groupId)); }

  D.add = async function (providerId, data) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = newDevice(Object.assign({}, data, { providerId }));
    if (!siteExists(g.provider, dev.siteId)) return { error: "unknown_site", siteId: dev.siteId };
    dev.groupIds = dev.groupIds.filter((gid) => groupExists(g.provider, gid));
    const r = await T.addItem(providerId, "devices", dev);
    if (r.error) return r;
    notify("add", r.item);
    return { device: normalizeDevice(r.item), rev: r.rev };
  };

  D.update = async function (providerId, deviceId, patch) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const prov = g.provider;
    if (patch && patch.siteId != null && patch.siteId !== "" && !siteExists(prov, patch.siteId)) return { error: "unknown_site", siteId: patch.siteId };
    let out = null;
    const r = await T.updateItem(providerId, "devices", deviceId, (it) => {
      const patchObj = asObj(patch);
      const merged = newDevice(Object.assign({}, it, patch, {
        id: it.id, providerId: it.providerId, createdAt: it.createdAt,
        os: Object.assign({}, it.os, asObj(patchObj.os)),
        cpu: Object.assign({}, it.cpu, asObj(patchObj.cpu)),
        agent: Object.assign({}, it.agent, asObj(patchObj.agent)),
        documentation: Object.assign({}, it.documentation, asObj(patchObj.documentation)),
      }));
      if (patch && patch.siteId !== undefined) merged.siteId = patch.siteId ? String(patch.siteId) : null;
      if (patch && patch.groupIds !== undefined) merged.groupIds = asArr(patch.groupIds).filter((gid) => groupExists(prov, gid));
      Object.assign(it, merged);
      out = it;
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", deviceId };
    notify("update", out);
    return { device: normalizeDevice(out), rev: r.rev };
  };

  D.remove = async function (providerId, deviceId) {
    const r = await T.removeItem(providerId, "devices", deviceId);
    if (r.error) return r;
    notify("remove", { id: deviceId });
    return { removed: deviceId };
  };

  D.setSite = (providerId, deviceId, siteId) => D.update(providerId, deviceId, { siteId: siteId || null });

  D.assignGroup = async function (providerId, deviceId, groupId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    if (!groupExists(g.provider, groupId)) return { error: "unknown_group", groupId };
    const dev = g.provider.devices.find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "not_found", deviceId };
    if (asArr(dev.groupIds).some((x) => String(x) === String(groupId))) return { device: normalizeDevice(dev), noop: true };
    return D.update(providerId, deviceId, { groupIds: asArr(dev.groupIds).concat([String(groupId)]) });
  };

  D.unassignGroup = async function (providerId, deviceId, groupId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = g.provider.devices.find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "not_found", deviceId };
    return D.update(providerId, deviceId, { groupIds: asArr(dev.groupIds).filter((x) => String(x) !== String(groupId)) });
  };

  D.setStatus = async function (providerId, deviceId, status) {
    if (STATUSES.indexOf(status) === -1) return { error: "invalid_status", status };
    return D.update(providerId, deviceId, { status });
  };

  /* Agent check-in: stamps last-seen, marks the device online and records
     the first-seen/enrolment date the first time we ever hear from it. */
  D.markSeen = async function (providerId, deviceId, info) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = g.provider.devices.find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "not_found", deviceId };
    const at = now();
    const patch = { lastSeenAt: at, status: "online" };
    if (info && info.agentVersion) { patch.agentVersion = String(info.agentVersion); patch.agent = Object.assign({}, asObj(dev.agent), { version: String(info.agentVersion) }); }
    if (!dev.firstSeenAt) patch.firstSeenAt = at;
    if (!dev.enrolledAt) patch.enrolledAt = at;
    return D.update(providerId, deviceId, patch);
  };

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  D.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  /* ─────────────────────── demo fleet seed ─────────────────────── */

  function demoDevices(prov) {
    const site = (n) => (asArr(prov.sites).find((s) => String(s.name).toLowerCase() === n) || {}).id || null;
    const grp = (n) => (asArr(prov.deviceGroups).find((g) => String(g.name).toLowerCase() === n) || {}).id || null;
    const hq = site("head office"), br = site("branch office");
    const servers = grp("servers"), workstations = grp("workstations");
    const mins = (n) => iso(Date.now() - n * 60000);
    const nic = (name, mac, ip, gw) => ({ name, mac, ip4: [ip], subnet: "255.255.255.0", gateway: gw, dhcp: false, speedMbps: 1000 });
    return [
      {
        hostname: "SRV-DC-01", displayName: "Head Office domain controller", role: "server", formFactor: "rack",
        siteId: hq, groupIds: [servers].filter(Boolean), status: "online", lastSeenAt: mins(1), tags: ["server", "domain"],
        os: { name: "Windows Server 2022 Standard", version: "10.0.20348", arch: "x64" },
        manufacturer: "Dell", model: "PowerEdge R650", serial: "PE-R650-0042", domain: "ad.acme.example", domainRole: "dc",
        cpu: { model: "Intel Xeon Silver 4310", cores: 12, threads: 24, speedMhz: 2100 }, ramBytes: 64 * GiB,
        disks: [{ label: "C:", kind: "nvme", sizeBytes: 480 * GiB, freeBytes: 210 * GiB, filesystem: "NTFS" }, { label: "D:", kind: "ssd", sizeBytes: 1920 * GiB, freeBytes: 1400 * GiB, filesystem: "NTFS" }],
        interfaces: [nic("Ethernet", "00:15:5D:8A:01:10", "10.0.0.10", "10.0.0.1")],
        agentVersion: "1.4.2", agent: { channel: "stable", capabilities: ["inventory", "metrics", "jobs", "patches"] },
        warrantyExpiresAt: "2027-06-30", supportExpiresAt: "2027-06-30",
        documentation: { refId: "doc-dc-01", systemId: "Head Office / Domain controller" },
      },
      {
        hostname: "SRV-FILE-01", displayName: "File & print server", role: "server", formFactor: "tower",
        siteId: hq, groupIds: [servers].filter(Boolean), status: "online", lastSeenAt: mins(2), tags: ["server", "files"],
        os: { name: "Windows Server 2019 Standard", version: "10.0.17763", arch: "x64" },
        manufacturer: "HPE", model: "ProLiant ML350 Gen10", serial: "HPE-ML350-1188", domain: "ad.acme.example", domainRole: "member",
        cpu: { model: "Intel Xeon Bronze 3204", cores: 6, threads: 6, speedMhz: 1900 }, ramBytes: 32 * GiB,
        disks: [{ label: "C:", kind: "ssd", sizeBytes: 240 * GiB, freeBytes: 61 * GiB, filesystem: "NTFS" }, { label: "Data", kind: "hdd", sizeBytes: 8 * 1024 * GiB, freeBytes: 2100 * GiB, filesystem: "NTFS" }],
        interfaces: [nic("Ethernet", "00:15:5D:8A:01:11", "10.0.0.11", "10.0.0.1")],
        agentVersion: "1.4.2", agent: { channel: "stable", capabilities: ["inventory", "metrics", "jobs"] },
        warrantyExpiresAt: "2025-12-31", documentation: { refId: "doc-file-01" },
      },
      {
        hostname: "WS-ACME-01", displayName: "Reception workstation", role: "workstation", formFactor: "desktop",
        siteId: hq, groupIds: [workstations].filter(Boolean), status: "online", lastSeenAt: mins(1), tags: ["workstation"],
        os: { name: "Windows 11 Pro", version: "23H2", build: "22631.3155", arch: "x64" },
        manufacturer: "Lenovo", model: "ThinkCentre M70q", serial: "LEN-M70Q-3301", domain: "ad.acme.example", domainRole: "member",
        cpu: { model: "Intel Core i5-12400T", cores: 6, threads: 12, speedMhz: 1800 }, ramBytes: 16 * GiB,
        disks: [{ label: "C:", kind: "nvme", sizeBytes: 512 * GiB, freeBytes: 300 * GiB, filesystem: "NTFS" }],
        interfaces: [nic("Ethernet", "d8:bb:c1:44:22:aa", "10.0.0.101", "10.0.0.1")],
        loggedInUsers: [{ name: "reception", domain: "ACME", session: "console" }],
        agentVersion: "1.4.1", agent: { channel: "stable", capabilities: ["inventory", "metrics", "jobs"] },
        warrantyExpiresAt: "2026-08-15", documentation: { refId: "doc-ws-01" },
      },
      {
        hostname: "WS-ACME-02", displayName: "Branch workstation", role: "workstation", formFactor: "desktop",
        siteId: br, groupIds: [workstations].filter(Boolean), status: "stale", lastSeenAt: mins(48), tags: ["workstation"],
        os: { name: "Windows 10 Pro", version: "22H2", build: "19045.4046", arch: "x64" },
        manufacturer: "Dell", model: "OptiPlex 5080", serial: "DELL-OP5080-7781", domain: "ad.acme.example", domainRole: "member",
        cpu: { model: "Intel Core i5-10500", cores: 6, threads: 12, speedMhz: 3100 }, ramBytes: 16 * GiB,
        disks: [{ label: "C:", kind: "ssd", sizeBytes: 256 * GiB, freeBytes: 22 * GiB, filesystem: "NTFS" }],
        interfaces: [nic("Ethernet", "d8:bb:c1:44:22:bb", "10.10.0.52", "10.10.0.1")],
        agentVersion: "1.3.9", agent: { channel: "stable", capabilities: ["inventory", "metrics"] },
        warrantyExpiresAt: "2024-11-01", supportExpiresAt: "2024-11-01", documentation: { refId: "doc-ws-02" },
      },
      {
        hostname: "MAC-DESIGN-01", displayName: "Design studio Mac", role: "workstation", formFactor: "desktop",
        siteId: hq, groupIds: [workstations].filter(Boolean), status: "offline", lastSeenAt: mins(60 * 26), tags: ["workstation", "mac"],
        os: { family: "macOS", name: "macOS Sonoma", version: "14.4", arch: "arm64" },
        manufacturer: "Apple", model: "Mac mini (M2, 2023)", serial: "C02X-M2MM-0021", domainRole: "standalone",
        cpu: { model: "Apple M2", cores: 8, threads: 8, speedMhz: 0 }, ramBytes: 24 * GiB,
        disks: [{ label: "Macintosh HD", kind: "nvme", sizeBytes: 512 * GiB, freeBytes: 180 * GiB, filesystem: "APFS" }],
        interfaces: [nic("en0", "a4:83:e7:12:9c:04", "10.0.0.140", "10.0.0.1")],
        loggedInUsers: [{ name: "designer", session: "console" }],
        agentVersion: "1.4.0", agent: { channel: "stable", capabilities: ["inventory", "metrics"] }, documentation: { refId: "doc-mac-01" },
      },
      {
        hostname: "LNX-WEB-01", displayName: "Branch web server", role: "server", formFactor: "vm",
        siteId: br, groupIds: [servers].filter(Boolean), status: "online", lastSeenAt: mins(1), tags: ["server", "linux", "web"],
        os: { name: "Ubuntu 22.04.4 LTS", version: "22.04", arch: "x64" },
        manufacturer: "VMware", model: "Virtual Machine", serial: "VMware-56 4d 8a", domainRole: "standalone",
        cpu: { model: "Virtual CPU", cores: 4, threads: 4, speedMhz: 2400 }, ramBytes: 8 * GiB,
        disks: [{ label: "/", kind: "virtual", sizeBytes: 100 * GiB, freeBytes: 44 * GiB, filesystem: "ext4" }],
        interfaces: [nic("ens192", "00:50:56:9a:44:01", "10.10.0.20", "10.10.0.1")],
        agentVersion: "1.4.2", agent: { channel: "stable", capabilities: ["inventory", "metrics", "jobs", "patches"], updatePending: true },
        documentation: { refId: "doc-lnx-01" },
      },
    ];
  }

  D.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.seedDemoDevices", true) === false) return { skipped: true, reason: "seed_disabled" };
    const providers = await T.list();
    const demo = providers.find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    if (g.provider.devices.length && !opts.force) return { skipped: true, reason: "devices_present", count: g.provider.devices.length };
    const created = [];
    for (const data of demoDevices(g.provider)) {
      const r = await D.add(demo.id, data);
      if (r.error) return { created, error: r.error, message: r.message };
      created.push(r.device.id);
    }
    return { providerId: demo.id, created };
  };

  /* ─────────────────────── Devices station UI ─────────────────────── */

  D.currentProviderId = null;

  D.render = async function (ctx) {
    const ui = ERP.ui, esc = ui.esc;
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { ctx.empty(); return; }

    const TABS = ["fleet", "structure", "deploy", "simulator", "inventory", "metrics", "jobs", "updates", "diagnostics", "retention", "remote"];
    const state = {
      pid: (D.currentProviderId && providers.some((p) => p.id === D.currentProviderId)) ? D.currentProviderId : providers[0].id,
      tab: TABS.indexOf(el.__tab) !== -1 ? el.__tab : "fleet",
      filters: { siteId: "", groupId: "", status: "", role: "", search: "" },
      jobs: { filter: "all", search: "" },
      remote: { tab: "shell", shellId: null },
    };
    D.currentProviderId = state.pid;

    const root = document.createElement("div");
    root.className = "rmm-devices";
    el.innerHTML = "";
    el.appendChild(root);

    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    function statusBadge(s) { const m = D.statusMeta(s); return ui.badge(m.label, m.tone); }

    function deviceRowHtml(d) {
      const p = cache.provider;
      const site = D.siteOf(p, d);
      const groups = D.allGroupsOf(p, d);
      return {
        host: "<b>" + esc(d.hostname || d.displayName || "—") + "</b>" + (d.displayName && d.displayName !== d.hostname ? '<div class="erp-sub">' + esc(d.displayName) + "</div>" : ""),
        os: esc(d.os.name || d.os.family || "—") + (d.os.version ? '<div class="erp-sub">' + esc(d.os.version) + " · " + esc(d.os.arch) + "</div>" : ""),
        site: esc(site ? site.name : "—"),
        groups: groups.length ? groups.map((g) => ui.badge(g.name, g.kind === "dynamic" ? "info" : "muted")).join(" ") : '<span class="erp-sub">ungrouped</span>',
        status: statusBadge(D.effectiveStatus(d)),
        seen: d.lastSeenAt ? ui.dateTime(d.lastSeenAt) : "never",
        agent: esc(d.agentVersion || "—") + (d.agent && d.agent.updatePending ? " " + ui.badge("update", "warn") : ""),
        ip: esc(D.primaryIp(d) || "—"),
        actions: ui.btn("Open", { small: true, act: "dev-open", arg: d.id }) + " " + ui.btn("Edit", { small: true, act: "dev-edit", arg: d.id }) + " " + ui.btn("Remove", { small: true, danger: true, act: "dev-del", arg: d.id }),
      };
    }

    function tableHtml(devices) {
      const cols = [
        { key: "host", label: "Device", render: (r) => deviceRowHtml(r).host },
        { key: "os", label: "Operating system", render: (r) => deviceRowHtml(r).os },
        { key: "site", label: "Site", render: (r) => deviceRowHtml(r).site },
        { key: "groups", label: "Groups", render: (r) => deviceRowHtml(r).groups },
        { key: "status", label: "Status", render: (r) => deviceRowHtml(r).status },
        { key: "seen", label: "Last seen", render: (r) => deviceRowHtml(r).seen },
        { key: "agent", label: "Agent", render: (r) => deviceRowHtml(r).agent },
        { key: "ip", label: "Primary IP", render: (r) => deviceRowHtml(r).ip },
        { key: "actions", label: "", render: (r) => deviceRowHtml(r).actions },
      ];
      return ui.table(cols, devices, { scroll: true, emptyText: "No devices match this filter." });
    }

    function fleetPanelHtml(p, devices, st) {
      const siteOpts = [{ value: "", label: "All sites" }].concat(asArr(p.sites).map((s) => ({ value: s.id, label: s.name })));
      const groupOpts = [{ value: "", label: "All groups" }].concat(asArr(p.deviceGroups).map((g) => ({ value: g.id, label: g.name + (g.siteId ? "" : " (provider)") })));
      const statusOpts = [{ value: "", label: "Any status" }].concat(STATUSES.map((s) => ({ value: s, label: D.statusMeta(s).label })));
      const roleOpts = [{ value: "", label: "Any role" }].concat(ROLES.map((r) => ({ value: r, label: r })));
      const filters =
        '<div class="erp-inline-form">' +
        '<div class="field"><label>Site</label><select name="siteId">' + siteOpts.map((o) => '<option value="' + esc(o.value) + '"' + (state.filters.siteId === o.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Group</label><select name="groupId">' + groupOpts.map((o) => '<option value="' + esc(o.value) + '"' + (state.filters.groupId === o.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Status</label><select name="status">' + statusOpts.map((o) => '<option value="' + esc(o.value) + '"' + (state.filters.status === o.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Role</label><select name="role">' + roleOpts.map((o) => '<option value="' + esc(o.value) + '"' + (state.filters.role === o.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field" style="flex:1 1 200px"><label>Search</label><input type="search" name="search" placeholder="hostname, serial, tag, IP, user…" value="' + esc(state.filters.search) + '"></div>' +
        "</div>";
      return filters +
        ui.summary([
          { label: "Devices", value: String(st.total) },
          { label: "Online", value: String(st.online) },
          { label: "Stale", value: String(st.stale) },
          { label: "Offline", value: String(st.offline) },
          { label: "Sites", value: String(asArr(p.sites).length) },
          { label: "Groups", value: String(asArr(p.deviceGroups).length) },
        ]) +
        '<div data-table>' + tableHtml(devices) + "</div>";
    }

    function deviceChip(d) {
      return '<button class="rmm-dev-chip" data-act="dev-open" data-arg="' + esc(d.id) + '">' +
        '<span class="rmm-dot tone-' + D.statusMeta(D.effectiveStatus(d)).tone + '"></span>' +
        '<span class="rmm-dev-chip-name">' + esc(d.hostname || d.displayName) + "</span>" +
        (d.os.name ? '<span class="erp-sub">' + esc(d.os.family || d.os.name) + "</span>" : "") +
        "</button>";
    }

    function structurePanelHtml(p, tree) {
      const siteBlocks = tree.sites.map((sb) => {
        const groups = sb.groups.map((gb) =>
          '<div class="rmm-tree-node">' + ERP.icon("groups", 15) + " <b>" + esc(gb.group.name) + "</b> <span class=\"erp-sub\">" + gb.devices.length + " device(s)</span>" +
          '<div class="rmm-tree-chips">' + (gb.devices.length ? gb.devices.map(deviceChip).join("") : '<span class="erp-sub">empty group</span>') + "</div></div>").join("");
        return '<div class="rmm-tree-site">' +
          '<div class="rmm-tree-head">' + ERP.icon("groups", 16) + " <b>" + esc(sb.site.name) + "</b> <span class=\"erp-sub\">" + sb.count + " device(s)" + (sb.site.timezone ? " · " + esc(sb.site.timezone) : "") + "</span></div>" +
          groups +
          '<div class="rmm-tree-node"><span class="erp-sub">Ungrouped at this site</span><div class="rmm-tree-chips">' + (sb.ungrouped.length ? sb.ungrouped.map(deviceChip).join("") : '<span class="erp-sub">none</span>') + "</div></div>" +
          "</div>";
      }).join("");

      const providerGroups = tree.providerGroups.map((gb) =>
        '<div class="rmm-tree-node">' + ERP.icon("groups", 15) + " <b>" + esc(gb.group.name) + "</b> " + ui.badge("provider-wide", "muted") +
        '<div class="rmm-tree-chips">' + (gb.devices.length ? gb.devices.map(deviceChip).join("") : '<span class="erp-sub">empty group</span>') + "</div></div>").join("");

      const orphans = tree.orphanGroups.length
        ? '<div class="rmm-tree-node">' + ui.badge("orphan groups", "warn") + " " + tree.orphanGroups.map((g) => esc(g.name)).join(", ") + "</div>" : "";

      const unassigned = '<div class="rmm-tree-site"><div class="rmm-tree-head">' + ERP.icon("devices", 16) + ' <b>Unassigned devices</b> <span class="erp-sub">no site</span></div>' +
        '<div class="rmm-tree-chips">' + (tree.unassigned.length ? tree.unassigned.map(deviceChip).join("") : '<span class="erp-sub">none</span>') + "</div></div>";

      return '<div class="erp-btn-row">' + ui.btn("New site", { small: true, act: "site-add" }) + ui.btn("New group", { small: true, act: "group-add" }) + "</div>" +
        (siteBlocks || '<p class="erp-sub">No sites yet — add one to start structuring the fleet.</p>') +
        (providerGroups ? "<h4 class=\"rmm-section-title\">Provider-wide groups</h4>" + providerGroups : "") +
        orphans + unassigned;
    }

    const cache = { provider: null };
    const rendered = {};

    /* The fleet filter, with dynamic-group membership resolved (Task 18):
       `groupId` is handled by the groups module, the rest by D.matches. */
    function filteredDevices(p) {
      const f = Object.assign({}, state.filters);
      const gid = f.groupId;
      delete f.groupId;
      const devices = asArr(p.devices).map(normalizeDevice);
      if (!gid) return devices.filter((d) => D.matches(d, f));
      return devices.filter((d) => D.matches(d, f) && D.matchesGroup(p, d, gid));
    }

    async function renderTable(devices) { root.querySelector("[data-table]").innerHTML = tableHtml(devices); }

    function tabBadgePill(n) { return n ? '<span class="erp-tab-pill">' + n + "</span>" : ""; }

    async function paint() {
      const p = await prov();
      if (!p) { ctx.error({ title: "Provider not found", message: "This tenant's document could not be loaded." }); return; }
      cache.provider = p;
      Object.keys(rendered).forEach((k) => delete rendered[k]);
      const devices = filteredDevices(p);
      const st = D.statsOf(p);
      const tree = D.treeOf(p);
      const invCount = p.devices.map(normalizeDevice).filter((d) => (d.custom && d.custom.inventory && d.custom.inventory.collectedAt) || (d.agent && d.agent.reportedAt) || d.lastSeenAt).length;
      const metCount = p.devices.map(normalizeDevice).filter((d) => (d.custom && d.custom.metrics && d.custom.metrics.latestAt) || (d.agent && d.agent.reportedAt) || d.lastSeenAt).length;
      const rstate = asObj(p.remoteState);
      const remActive = asArr(rstate.shells).filter((s) => s.status === "active").length +
        asArr(rstate.sessions).filter((s) => s.status === "active").length +
        asArr(rstate.transfers).filter((t) => ["queued", "in-progress", "quarantined"].indexOf(t.state) !== -1).length;
      const tabs = ui.tabs([
        { id: "fleet", label: "Fleet", badge: String(p.devices.length) },
        { id: "structure", label: "Structure", badge: String(tree.sites.length) },
        { id: "deploy", label: "Deploy", badge: String(p.devices.filter((x) => (x.agent && x.agent.reportedAt) || x.lastSeenAt).length) },
        { id: "simulator", label: "Simulator", badge: "" },
        { id: "inventory", label: "Inventory", badge: String(invCount) },
        { id: "metrics", label: "Metrics", badge: String(metCount) },
        { id: "jobs", label: "Jobs", badge: "" },
        { id: "updates", label: "Updates", badge: "" },
        { id: "diagnostics", label: "Diagnostics", badge: "" },
        { id: "retention", label: "Retention", badge: "" },
        { id: "remote", label: "Remote", badge: remActive ? String(remActive) : "" },
      ], state.tab);
      const head = ui.pageHead("Devices",
        providers.length > 1 ? "Choose a tenant, then drill into its sites, groups and devices." : "The provider → site → device-group → device hierarchy and every device's inventory record.",
        ui.btn("Add device", { primary: true, act: "dev-add" }));
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + " (" + (x.deviceCount || 0) + ")</option>").join("") +
          "</select></div></div>"
        : "";
      root.innerHTML = head + picker + tabs.html;
      root.querySelector('[data-panel="fleet"]').innerHTML = fleetPanelHtml(p, devices, st);
      root.querySelector('[data-panel="structure"]').innerHTML = structurePanelHtml(p, tree);
      root.querySelector('[data-panel="deploy"]').innerHTML = '<p class="erp-sub">Loading the deploy console…</p>';
      root.querySelector('[data-panel="simulator"]').innerHTML = '<p class="erp-sub">Loading the agent simulator…</p>';
      root.querySelector('[data-panel="inventory"]').innerHTML = '<p class="erp-sub">Loading inventory…</p>';
      root.querySelector('[data-panel="metrics"]').innerHTML = '<p class="erp-sub">Loading performance metrics…</p>';
      root.querySelector('[data-panel="jobs"]').innerHTML = '<p class="erp-sub">Loading jobs…</p>';
      root.querySelector('[data-panel="updates"]').innerHTML = '<p class="erp-sub">Loading agent updates…</p>';
      root.querySelector('[data-panel="diagnostics"]').innerHTML = '<p class="erp-sub">Loading agent diagnostics…</p>';
      root.querySelector('[data-panel="retention"]').innerHTML = '<p class="erp-sub">Loading retention &amp; scale…</p>';
      root.querySelector('[data-panel="remote"]').innerHTML = '<p class="erp-sub">Loading remote access…</p>';
      ui.showTab(root, state.tab);
      await renderPanel(state.tab);
      if (ERP.jobs && typeof ERP.jobs.stats === "function") {
        ERP.jobs.stats(state.pid).then((s) => {
          const el = root.querySelector('[data-tab="jobs"]');
          if (el && !el.querySelector(".erp-tab-pill")) el.insertAdjacentHTML("beforeend", tabBadgePill(s.jobs));
        }).catch(() => {});
      }
    }

    /* Panels are built lazily the first time they are shown, so switching
       to Devices does not load the inventory, metrics and job documents
       (and draw every chart) unless the user actually looks at them. */
    async function renderPanel(id) {
      if (rendered[id]) return;
      const panelEl = root.querySelector('[data-panel="' + id + '"]');
      if (!panelEl) return;
      rendered[id] = true;
      try {
        if (id === "deploy" && ERP.agent && ERP.agent.renderDeploy) {
          await ERP.agent.renderDeploy(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "simulator" && ERP.simulator && ERP.simulator.renderPanel) {
          await ERP.simulator.renderPanel(panelEl, { providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "inventory" && ERP.rmmInventory && ERP.rmmInventory.renderInventory) {
          await ERP.rmmInventory.renderInventory(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "metrics" && ERP.metrics && ERP.metrics.renderMetrics) {
          await ERP.metrics.renderMetrics(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "jobs" && ERP.dispatch && ERP.dispatch.renderJobs) {
          await ERP.dispatch.renderJobs(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint, state: state.jobs });
        } else if (id === "jobs" && ERP.jobs && ERP.jobs.renderJobs) {
          await ERP.jobs.renderJobs(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint, state: state.jobs });
        } else if (id === "updates" && ERP.resilience && ERP.resilience.renderUpdates) {
          await ERP.resilience.renderUpdates(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "diagnostics" && ERP.diagnostics && ERP.diagnostics.renderDiagnostics) {
          await ERP.diagnostics.renderDiagnostics(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "retention" && ERP.retention && ERP.retention.renderRetention) {
          await ERP.retention.renderRetention(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint });
        } else if (id === "remote" && ERP.remote && ERP.remote.renderRemote) {
          await ERP.remote.renderRemote(panelEl, { provider: cache.provider, providerId: state.pid, toast: ctx.toast, refresh: paint, state: state.remote });
        }
      } catch (e) {
        rendered[id] = false;
        panelEl.innerHTML = '<div class="erp-alert tone-danger">Could not load this panel: ' + esc(e && e.message) + "</div>";
      }
    }

    /* Jump to the Devices → Remote tab (optionally a specific sub-tab),
       forcing a fresh render so the panel's own sub-tab state is honoured. */
    function openRemoteTab(sub, shellId) {
      state.tab = "remote";
      state.remote = state.remote || { tab: "shell", shellId: null };
      if (sub) state.remote.tab = sub;
      if (shellId) state.remote.shellId = shellId;
      rendered.remote = false;
      ui.showTab(root, state.tab);
      return renderPanel("remote");
    }

    /* delegated handlers — bound to this render's root, so they vanish on the next navigation */
    ui.bind(root, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "dev-add") return openDeviceForm(null);
      if (act === "dev-open") return openDevice(arg, false);
      if (act === "dev-edit") return openDevice(arg, true);
      if (act === "dev-del") {
        const d = (await D.get(state.pid, arg)).device;
        const ok = await ui.confirm({ title: "Remove device", message: "Remove " + (d ? d.hostname : arg) + " from this tenant? Its record will be deleted.", okLabel: "Remove", danger: true });
        if (!ok) return;
        await D.remove(state.pid, arg);
        ctx.toast("Device removed");
        return paint();
      }
      if (act === "site-add") return openSiteForm();
      if (act === "group-add") return openGroupForm();
      if (act === "form-save") return;
    });
    ui.bind(root, "click", "[data-tab]", (t) => {
      /* Ignore sub-tabs nested inside a panel (e.g. Devices → Remote) — those
         panels own their own [data-tab] delegation. */
      if (t.closest("[data-panel]")) return;
      state.tab = t.getAttribute("data-tab"); ui.showTab(root, state.tab); renderPanel(state.tab);
    });
    root.addEventListener("change", async (e) => {
      const n = e.target && e.target.name;
      if (!n) return;
      if (n === "pid") { state.pid = e.target.value; D.currentProviderId = state.pid; state.filters.siteId = ""; state.filters.groupId = ""; return paint(); }
      if (n in state.filters) { state.filters[n] = e.target.value; const p = cache.provider; return renderTable(filteredDevices(p)); }
    });
    root.addEventListener("input", (e) => {
      const n = e.target && e.target.name;
      if (n === "search") { state.filters.search = e.target.value; const p = cache.provider; renderTable(filteredDevices(p)); }
    });

    async function openDevice(deviceId, edit) {
      const r = await D.get(state.pid, deviceId);
      if (r.error) { ctx.toast("Device not found", "error"); return; }
      const p = r.provider, d = r.device;
      if (edit) return openDeviceForm(d);
      const agentHtml = (ERP.agent && typeof ERP.agent.deviceAgentHtml === "function") ? await ERP.agent.deviceAgentHtml(d, p.id) : "";
      const invHtml = (ERP.rmmInventory && typeof ERP.rmmInventory.deviceSection === "function") ? await ERP.rmmInventory.deviceSection(d, p.id) : "";
      const metHtml = (ERP.metrics && typeof ERP.metrics.deviceSection === "function") ? await ERP.metrics.deviceSection(d, p.id) : "";
      const jobHtml = (ERP.jobs && typeof ERP.jobs.deviceSection === "function") ? await ERP.jobs.deviceSection(d, p.id) : "";
      const rslHtml = (ERP.resilience && typeof ERP.resilience.deviceSection === "function") ? ERP.resilience.deviceSection(d, p.id) : "";
      const diagHtml = (ERP.diagnostics && typeof ERP.diagnostics.deviceSection === "function") ? await ERP.diagnostics.deviceSection(d, p.id) : "";
      const swHtml = (ERP.software && typeof ERP.software.deviceSection === "function") ? await ERP.software.deviceSection(d, p.id) : "";
      const securHtml = (ERP.security && typeof ERP.security.deviceSection === "function") ? await ERP.security.deviceSection(d, p.id) : "";
      const remHtml = (ERP.remote && typeof ERP.remote.deviceSection === "function") ? await ERP.remote.deviceSection(d, p.id) : "";
      const site = D.siteOf(p, d), groups = D.allGroupsOf(p, d);
      const kv = (rows) => '<div class="rmm-kv">' + rows.filter((x) => x[1] !== "" && x[1] != null).map((x) => '<div class="rmm-kv-row"><span>' + esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>";
      const disks = asArr(d.disks).map((dk) => ui.table([
        { key: "label", label: "Volume", render: (x) => "<b>" + esc(x.label || "—") + "</b>" },
        { key: "kind", label: "Type", render: (x) => ui.badge(x.kind, "muted") },
        { key: "size", label: "Size", align: "right", render: (x) => D.bytesHuman(x.sizeBytes) },
        { key: "free", label: "Free", align: "right", render: (x) => D.bytesHuman(x.freeBytes) + (x.sizeBytes ? ' <span class="erp-sub">' + Math.round((x.freeBytes / x.sizeBytes) * 100) + "%</span>" : "") },
        { key: "fs", label: "Filesystem", render: (x) => esc(x.filesystem || "—") },
      ], [dk])).join("");
      const nics = ui.table([
        { key: "name", label: "Interface", render: (x) => "<b>" + esc(x.name || "—") + "</b>" },
        { key: "mac", label: "MAC", render: (x) => "<code>" + esc(x.mac || "—") + "</code>" },
        { key: "ip", label: "IPv4", render: (x) => (x.ip4 || []).map(esc).join(", ") || "—" },
        { key: "gw", label: "Gateway", render: (x) => esc(x.gateway || "—") },
        { key: "speed", label: "Speed", align: "right", render: (x) => (x.speedMbps ? x.speedMbps + " Mbps" : "—") },
      ], asArr(d.interfaces));
      const users = asArr(d.loggedInUsers).length
        ? ui.table([{ key: "name", label: "User", render: (x) => "<b>" + esc(x.name) + "</b>" }, { key: "domain", label: "Domain", render: (x) => esc(x.domain || "—") }, { key: "session", label: "Session", render: (x) => esc(x.session || "—") }], d.loggedInUsers)
        : '<p class="erp-sub">No logged-in users reported.</p>';
      const body =
        '<div class="rmm-device-presence" data-dev-presence></div>' +
        '<div class="rmm-status-line">' + statusBadge(D.effectiveStatus(d)) + " " + (d.role ? ui.badge(d.role, "muted") : "") + (d.warrantyExpiresAt ? " " + ui.badge("warranty " + ui.date(d.warrantyExpiresAt), new Date(d.warrantyExpiresAt) < new Date() ? "danger" : "muted") : "") + "</div>" +
        "<h4 class=\"rmm-section-title\">Identity</h4>" + kv([
          ["Hostname", esc(d.hostname)], ["Display name", esc(d.displayName)], ["Manufacturer", esc(d.manufacturer)], ["Model", esc(d.model)],
          ["Serial", "<code>" + esc(d.serial || "—") + "</code>"], ["Form factor", esc(d.formFactor)], ["Domain / workgroup", esc(d.domain || "—")], ["Domain role", esc(d.domainRole || "—")],
          ["Site", esc(site ? site.name : "—")], ["Groups", groups.length ? groups.map((g) => ui.badge(g.name, g.kind === "dynamic" ? "info" : "muted")).join(" ") : "—"],
        ]) +
        "<h4 class=\"rmm-section-title\">Operating system &amp; hardware</h4>" + kv([
          ["OS", esc(d.os.name || "—")], ["Version / build", esc(d.os.version || "—") + (d.os.build ? " (" + esc(d.os.build) + ")" : "")],
          ["Edition", esc(d.os.edition || "—")], ["Architecture", esc(d.os.arch)], ["Installed", d.os.installDate ? ui.date(d.os.installDate) : "—"],
          ["CPU", esc(d.cpu.model || "—")], ["Cores / threads", (d.cpu.cores || "—") + " / " + (d.cpu.threads || "—")], ["RAM", D.ramHuman(d)],
        ]) +
        "<h4 class=\"rmm-section-title\">Storage</h4>" + (disks || '<p class="erp-sub">No disks reported.</p>') +
        "<h4 class=\"rmm-section-title\">Network</h4>" + nics +
        "<h4 class=\"rmm-section-title\">Logged-in users</h4>" + users +
        "<h4 class=\"rmm-section-title\">Agent &amp; lifecycle</h4>" + kv([
          ["Agent version", esc(d.agentVersion || "—") + (d.agent && d.agent.updatePending ? " " + ui.badge("update pending", "warn") : "")],
          ["Channel", esc(d.agent.channel)], ["Capabilities", (d.agent.capabilities || []).map((c) => ui.badge(c, "muted")).join(" ") || "—"],
          ["Last seen", d.lastSeenAt ? ui.dateTime(d.lastSeenAt) : "never"], ["First seen", d.firstSeenAt ? ui.dateTime(d.firstSeenAt) : "—"],
          ["Enrolled", d.enrolledAt ? ui.dateTime(d.enrolledAt) : "—"], ["Warranty expires", d.warrantyExpiresAt ? ui.date(d.warrantyExpiresAt) : "—"],
          ["Support expires", d.supportExpiresAt ? ui.date(d.supportExpiresAt) : "—"],
        ]) +
        "<h4 class=\"rmm-section-title\">Documentation link</h4>" + kv([
          ["Configuration record", esc(d.documentation.systemId || d.documentation.refId || "—")],
          ["Reference", d.documentation.refUrl ? '<a href="' + esc(d.documentation.refUrl) + '" target="_blank" rel="noopener">' + esc(d.documentation.refUrl) + "</a>" : esc(d.documentation.refId || "—")],
        ]) +
        (d.tags.length ? "<h4 class=\"rmm-section-title\">Tags</h4><p>" + d.tags.map((t) => ui.badge(t, "info")).join(" ") + "</p>" : "") +
        agentHtml +
        invHtml +
        metHtml +
        jobHtml +
        rslHtml +
        diagHtml +
        swHtml +
        securHtml +
        remHtml +
        (d.notes ? "<h4 class=\"rmm-section-title\">Notes</h4><p class=\"erp-modal-note\">" + esc(d.notes) + "</p>" : "");
      const m = ui.modal({ title: d.hostname || d.displayName || "Device", size: "lg", body, foot: ui.btn("Edit", { small: true, primary: true, act: "dev-edit", arg: d.id }) + " " + ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }) });
      const editBtn = m.querySelector("[data-act=dev-edit]");
      if (editBtn) editBtn.onclick = () => openDeviceForm(d);
      if (ERP.rmmInventory && ERP.rmmInventory.wireDeviceSection) ERP.rmmInventory.wireDeviceSection(m, { deviceId: d.id, providerId: p.id, toast: ctx.toast });
      if (ERP.jobs && ERP.jobs.wireDeviceSection) ERP.jobs.wireDeviceSection(m, { deviceId: d.id, providerId: p.id, toast: ctx.toast, onDone: () => { ui.closeModal(); openDevice(deviceId, false); } });
      if (ERP.remote && ERP.remote.wireDeviceSection) ERP.remote.wireDeviceSection(m, { deviceId: d.id, providerId: p.id, toast: ctx.toast, onOpenShell: (sid) => openRemoteTab("shell", sid), onOpenFiles: () => openRemoteTab("files") });

      /* Task 49 — announce that this session is now on the device, and show
         which other technicians are already here. Presence is best-effort:
         it degrades silently when the team hub is offline. */
      if (ERP.live) {
        const slot = m.querySelector("[data-dev-presence]");
        const paintPresence = () => {
          if (!slot) return;
          const others = ERP.live.others(d.id);
          slot.innerHTML = others.length
            ? '<span class="erp-badge tone-info">' + others.length + " other technician" + (others.length === 1 ? "" : "s") + " here</span> " +
              others.map((v) => ui.badge(v.displayName || v.userId, v.admin ? "danger" : "muted")).join(" ")
            : ERP.live.presenceAvailable()
              ? '<span class="erp-sub">You are the only technician viewing this device.</span>'
              : '<span class="erp-sub">Realtime presence unavailable — the team hub is offline.</span>';
        };
        let off = null;
        off = ERP.live.onViewers((deviceId) => {
          if (!slot || !document.contains(slot)) { if (off) off(); return; }
          if (!deviceId || deviceId === d.id) paintPresence();
        });
        Promise.resolve(ERP.live.focus(d.id, p.id)).then(paintPresence).catch(() => {});
        paintPresence();
      }
    }

    function openDeviceForm(d) {
      const isEdit = !!d;
      const p = cache.provider;
      const siteOpts = [{ value: "", label: "— unassigned —" }].concat(asArr(p.sites).map((s) => ({ value: s.id, label: s.name })));
      const body = ui.form(
        ui.text("hostname", "Hostname", d ? d.hostname : "") +
        ui.text("displayName", "Display name", d ? d.displayName : "") +
        ui.select("role", "Role", ROLES, d ? d.role : "workstation") +
        ui.select("siteId", "Site", siteOpts, d && d.siteId ? d.siteId : "") +
        ui.text("osName", "Operating system", d ? d.os.name : "") +
        ui.text("osVersion", "OS version", d ? d.os.version : "") +
        ui.text("manufacturer", "Manufacturer", d ? d.manufacturer : "") +
        ui.text("model", "Model", d ? d.model : "") +
        ui.text("serial", "Serial", d ? d.serial : "") +
        ui.text("domain", "Domain / workgroup", d ? d.domain : "") +
        ui.text("cpuModel", "CPU", d ? d.cpu.model : "") +
        ui.number("ramGB", "RAM (GB)", d ? Math.round(d.ramBytes / GiB) : 0) +
        ui.text("agentVersion", "Agent version", d ? d.agentVersion : "") +
        ui.select("status", "Status", STATUSES, d ? d.status : "unknown") +
        ui.dateInput("warrantyExpiresAt", "Warranty expires", d ? d.warrantyExpiresAt : "") +
        ui.dateInput("supportExpiresAt", "Support expires", d ? d.supportExpiresAt : "") +
        ui.text("docRef", "Documentation record", d ? (d.documentation.refId || "") : "") +
        ui.text("tags", "Tags (comma-separated)", d ? d.tags.join(", ") : "") +
        '<div class="field"><label>Static groups</label><div class="rmm-check-list">' +
        (asArr(p.deviceGroups).filter((g) => g.kind !== "dynamic").map((g) => '<label class="erp-check"><input type="checkbox" data-dev-group="' + esc(g.id) + '"' + (d && asArr(d.groupIds).indexOf(String(g.id)) !== -1 ? " checked" : "") + "> " + esc(g.name) + (g.siteId ? ' <span class="erp-sub">' + esc((asArr(p.sites).find((s) => String(s.id) === String(g.siteId)) || {}).name || "") + "</span>" : "") + "</label>").join("") || '<span class="erp-sub">No static groups yet — create one on the Groups station.</span>') +
        "</div></div>",
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isEdit ? "Save changes" : "Add device", { small: true, primary: true, act: "device-save" })
      );
      const m = ui.modal({ title: isEdit ? "Edit device" : "Add device", size: "lg", body });
      m.querySelector("[data-act=device-save]").onclick = async () => {
        const v = ui.collect(m, ["hostname", "displayName", "role", "siteId", "osName", "osVersion", "manufacturer", "model", "serial", "domain", "cpuModel", "ramGB", "agentVersion", "status", "warrantyExpiresAt", "supportExpiresAt", "docRef", "tags"]);
        if (!String(v.hostname || "").trim()) { ctx.toast("Hostname is required", "error"); return; }
        const patch = {
          hostname: v.hostname.trim(), displayName: (v.displayName || v.hostname).trim(), role: v.role, siteId: v.siteId || null,
          os: { name: v.osName, version: v.osVersion }, manufacturer: v.manufacturer, model: v.model, serial: v.serial,
          domain: v.domain, agentVersion: v.agentVersion, status: v.status,
          warrantyExpiresAt: v.warrantyExpiresAt || "", supportExpiresAt: v.supportExpiresAt || "",
          documentation: { refId: v.docRef || "" },
          tags: String(v.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
          ramBytes: num(v.ramGB, 0) * GiB,
        };
        if (d) patch.cpu = Object.assign({}, d.cpu, { model: v.cpuModel });
        else patch.cpu = { model: v.cpuModel };
        patch.groupIds = [...m.querySelectorAll("[data-dev-group]")].filter((i) => i.checked).map((i) => i.getAttribute("data-dev-group"));
        const r = isEdit ? await D.update(state.pid, d.id, patch) : await D.add(state.pid, patch);
        if (r.error) { ctx.toast("Save failed: " + r.error, "error"); return; }
        ui.closeModal();
        ctx.toast(isEdit ? "Device updated" : "Device added");
        paint();
      };
    }

    function openSiteForm() {
      const body = ui.form(ui.text("name", "Site name", "") + ui.text("timezone", "Timezone", "UTC") + ui.text("address", "Address", ""),
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Add site", { small: true, primary: true, act: "site-save" }));
      const m = ui.modal({ title: "New site", body });
      m.querySelector("[data-act=site-save]").onclick = async () => {
        const v = ui.collect(m, ["name", "timezone", "address"]);
        if (!String(v.name || "").trim()) { ctx.toast("Site name is required", "error"); return; }
        const r = await T.addItem(state.pid, "sites", { name: v.name.trim(), timezone: v.timezone || "UTC", address: v.address || "" });
        if (r.error) { ctx.toast("Save failed: " + r.error, "error"); return; }
        ui.closeModal(); ctx.toast("Site added"); paint();
      };
    }

    function openGroupForm() {
      const p = cache.provider;
      const siteOpts = [{ value: "", label: "— provider-wide —" }].concat(asArr(p.sites).map((s) => ({ value: s.id, label: s.name })));
      const body = ui.form(ui.text("name", "Group name", "") + ui.select("siteId", "Site", siteOpts, ""),
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Add group", { small: true, primary: true, act: "group-save" }));
      const m = ui.modal({ title: "New device group", body });
      m.querySelector("[data-act=group-save]").onclick = async () => {
        const v = ui.collect(m, ["name", "siteId"]);
        if (!String(v.name || "").trim()) { ctx.toast("Group name is required", "error"); return; }
        const r = await T.addItem(state.pid, "deviceGroups", { name: v.name.trim(), kind: "static", siteId: v.siteId || null, tags: [] });
        if (r.error) { ctx.toast("Save failed: " + r.error, "error"); return; }
        ui.closeModal(); ctx.toast("Group added"); paint();
      };
    }

    await paint();
  };

  /* ─────────────────────── boot ─────────────────────── */

  D.init = async function () { try { await T.ready; await D.seedDemo(); } catch (e) { console.error("devices seed failed", e); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", D.init);
  else D.init();
})();
