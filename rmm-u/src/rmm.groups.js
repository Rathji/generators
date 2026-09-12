/* ============================================================
   RMM-U — device groups & tags  (Phase 4 · Task 18)

   Groups are stored on each provider aggregate in two flavours:

     • static  — membership is explicit: the device carries the
                 group id in `device.groupIds`, and the group is
                 just an id/name/scope. A device can belong to
                 many static groups.
     • dynamic — membership is DERIVED from a rule evaluated
                 against each device. A rule is `{match:"all"|"any",
                 conditions:[{field, op, value}]}` over the device's
                 OS, role/status, site, tags, hardware attributes
                 and (from the inventory snapshot) installed
                 software and service state. Dynamic membership is
                 never written back to the device, so it is always
                 current; `membershipIds()` merges both flavours.

   Tags are `device.tags[]` — free-form labels. The tag vocabulary is
   the provider-wide set of tags with their usage counts, and it is
   the primary thing policies and automations target: a group gives
   a fleet a human name, a tag gives a policy a cut of the fleet that
   does not depend on a group's existence.

   window.ERP.groups is the service + the Groups station controller.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const INV = ERP.rmmInventory || null;
  const G = (ERP.groups = {});

  G.MODULE = "groups";
  G.KINDS = ["static", "dynamic"];
  G.MATCH = ["all", "any"];
  G.ID_PREFIX = "grp";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const uniq = (a) => [...new Set(a)];
  const cap = () => Math.max(4, num(cfg("rmm.groupConditionCap", 24), 24));

  /* ─────────────────────── the field catalogue ───────────────────────

     Every condition targets one field. A field declares how to read it
     off a device (`get`), what kind of value it is (which decides the
     operator set and the editor control) and, for selects, its options. */

  const FIELDS = [
    { id: "os.family", label: "OS family", group: "Operating system", type: "select", options: () => D.OS_FAMILIES.slice(), get: (d) => d.os.family },
    { id: "os.name", label: "OS name", group: "Operating system", type: "text", get: (d) => d.os.name },
    { id: "os.version", label: "OS version", group: "Operating system", type: "text", get: (d) => d.os.version },
    { id: "os.arch", label: "Architecture", group: "Operating system", type: "text", get: (d) => d.os.arch },
    { id: "role", label: "Device role", group: "Identity", type: "select", options: () => D.ROLES.slice(), get: (d) => d.role },
    { id: "status", label: "Status", group: "Identity", type: "select", options: () => ["online", "offline", "stale", "unknown", "maintenance", "retired"], get: (d) => D.effectiveStatus(d) },
    { id: "hostname", label: "Hostname", group: "Identity", type: "text", get: (d) => d.hostname },
    { id: "domain", label: "Domain / workgroup", group: "Identity", type: "text", get: (d) => d.domain },
    { id: "domainRole", label: "Domain role", group: "Identity", type: "select", options: () => ["member", "dc", "workgroup", "standalone"], get: (d) => d.domainRole },
    { id: "formFactor", label: "Form factor", group: "Identity", type: "select", options: () => D.FORM_FACTORS.slice(), get: (d) => d.formFactor },
    { id: "manufacturer", label: "Manufacturer", group: "Hardware", type: "text", get: (d) => d.manufacturer },
    { id: "model", label: "Model", group: "Hardware", type: "text", get: (d) => d.model },
    { id: "ramBytes", label: "RAM (bytes)", group: "Hardware", type: "number", get: (d) => d.ramBytes },
    { id: "cpuCores", label: "CPU cores", group: "Hardware", type: "number", get: (d) => d.cpu.cores },
    { id: "diskUsedPct", label: "Disk used %", group: "Hardware", type: "number", get: (d) => D.diskUsedPct(d) },
    { id: "site", label: "Site", group: "Placement", type: "site", get: (d) => d.siteId },
    { id: "tag", label: "Tag", group: "Placement", type: "tag", get: (d) => asArr(d.tags) },
    { id: "software", label: "Installed software", group: "Software & services", type: "software", get: (d, ctx) => (ctx.soft && ctx.soft[String(d.id)]) || [] },
    { id: "service", label: "Service", group: "Software & services", type: "service", get: (d, ctx) => (ctx.svc && ctx.svc[String(d.id)]) || [] },
    { id: "agentVersion", label: "Agent version", group: "Agent", type: "text", get: (d) => d.agentVersion },
  ];

  const OPERATORS = {
    text: [["is", "is"], ["is_not", "is not"], ["contains", "contains"], ["not_contains", "does not contain"], ["starts_with", "starts with"], ["ends_with", "ends with"], ["in", "is one of"], ["not_in", "is not one of"]],
    select: [["is", "is"], ["is_not", "is not"], ["in", "is one of"], ["not_in", "is not one of"]],
    site: [["is", "is"], ["is_not", "is not"], ["in", "is one of"], ["not_in", "is not one of"]],
    number: [["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["eq", "="], ["neq", "≠"]],
    bool: [["is_true", "is true"], ["is_false", "is false"]],
    tag: [["has_tag", "has tag"], ["not_has_tag", "does not have tag"]],
    software: [["installed", "has installed"], ["not_installed", "does not have installed"]],
    service: [["running", "is running"], ["not_running", "is not running"], ["exists", "exists"], ["not_exists", "does not exist"]],
  };

  G.FIELDS = FIELDS;
  G.field = (id) => FIELDS.find((f) => f.id === id) || null;
  G.fieldLabel = (id) => (G.field(id) || {}).label || id;
  G.fields = () => FIELDS.map((f) => ({ id: f.id, label: f.label, group: f.group, type: f.type, options: f.options ? f.options() : null }));
  G.operators = (type) => (OPERATORS[type] || OPERATORS.text).map((o) => ({ id: o[0], label: o[1] }));
  G.operatorsFor = (fieldId) => G.operators((G.field(fieldId) || {}).type || "text");
  G.operatorLabel = (type, op) => { const o = (OPERATORS[type] || OPERATORS.text).find((x) => x[0] === op); return o ? o[1] : op; };

  /* ─────────────────────── normalisation ─────────────────────── */

  function normalizeCondition(c) {
    c = asObj(c);
    const field = G.field(c.field) ? c.field : "os.family";
    const type = (G.field(field) || {}).type || "text";
    const ops = (OPERATORS[type] || OPERATORS.text).map((o) => o[0]);
    const op = ops.indexOf(c.op) !== -1 ? c.op : ops[0];
    let value = c.value;
    if (type === "number") value = num(value, 0);
    else if (type === "bool") value = c.value == null ? true : !!c.value;
    else value = S(value, 240);
    return { field, op, value };
  }

  function normalizeGroup(data) {
    data = asObj(data);
    const kind = G.KINDS.indexOf(data.kind) !== -1 ? data.kind : "static";
    return {
      kind: "deviceGroup",
      id: data.id || T.newItemId("deviceGroups"),
      name: S(data.name, 120) || "Untitled group",
      description: S(data.description, 400),
      kind,
      siteId: data.siteId != null && data.siteId !== "" ? String(data.siteId) : null,
      match: G.MATCH.indexOf(data.match) !== -1 ? data.match : "all",
      conditions: asArr(data.conditions).slice(0, cap()).map(normalizeCondition),
      color: S(data.color, 24),
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };
  }
  G.normalizeCondition = normalizeCondition;
  G.normalizeGroup = normalizeGroup;

  G.validateGroup = function (group) {
    const errors = [];
    if (!group || typeof group !== "object") return { valid: false, errors: ["group is not an object"] };
    if (!String(group.name || "").trim()) errors.push("name is required");
    if (G.KINDS.indexOf(group.kind) === -1) errors.push("invalid kind: " + group.kind);
    if (group.kind === "dynamic") {
      if (G.MATCH.indexOf(group.match) === -1) errors.push("invalid match mode: " + group.match);
      asArr(group.conditions).forEach((c, i) => {
        if (!G.field(c.field)) errors.push("condition " + (i + 1) + ": unknown field " + c.field);
        else if (!G.operators((G.field(c.field) || {}).type).some((o) => o.id === c.op)) errors.push("condition " + (i + 1) + ": invalid operator " + c.op);
      });
    }
    return { valid: errors.length === 0, errors };
  };

  /* ─────────────────────── condition evaluation ─────────────────────── */

  function asList(v) { return String(v == null ? "" : v).split(",").map((s) => low(s)).filter(Boolean); }

  G.evaluateCondition = function (cond, dev, ctx) {
    ctx = ctx || {};
    const c = normalizeCondition(cond);
    const field = G.field(c.field);
    if (!field || !dev) return false;
    const raw = field.get ? field.get(dev, ctx) : dev[c.field];
    const val = c.value;
    switch (field.type) {
      case "number": {
        const n = Number(raw);
        if (!isFinite(n)) return false;
        const t = Number(val);
        if (c.op === "gt") return n > t;
        if (c.op === "gte") return n >= t;
        if (c.op === "lt") return n < t;
        if (c.op === "lte") return n <= t;
        if (c.op === "neq") return n !== t;
        return n === t;
      }
      case "bool":
        return c.op === "is_false" ? !raw : !!raw;
      case "tag": {
        const tags = asArr(raw).map(low);
        const has = tags.indexOf(low(val)) !== -1;
        return c.op === "not_has_tag" ? !has : has;
      }
      case "software": {
        const names = asArr(raw).map(low);
        const has = names.some((n) => n.indexOf(low(val)) !== -1);
        return c.op === "not_installed" ? !has : has;
      }
      case "service": {
        const list = asArr(raw);
        const hit = list.find((s) => s.name === low(val) || s.display === low(val));
        if (c.op === "exists") return !!hit;
        if (c.op === "not_exists") return !hit;
        const running = !!hit && /run/.test(String(hit.state || ""));
        return c.op === "not_running" ? !running : running;
      }
      case "site": {
        const target = low(raw);
        if (c.op === "in" || c.op === "not_in") {
          const list = asList(val);
          const inside = list.indexOf(target) !== -1;
          return c.op === "not_in" ? !inside : inside;
        }
        const eq = target === low(val);
        return c.op === "is_not" ? !eq : eq;
      }
      default: {
        const target = low(raw);
        const t = low(val);
        if (c.op === "is") return target === t;
        if (c.op === "is_not") return target !== t;
        if (c.op === "contains") return target.indexOf(t) !== -1;
        if (c.op === "not_contains") return target.indexOf(t) === -1;
        if (c.op === "starts_with") return target.indexOf(t) === 0;
        if (c.op === "ends_with") return t.length > 0 && target.slice(-t.length) === t;
        if (c.op === "in" || c.op === "not_in") {
          const inside = asList(val).indexOf(target) !== -1;
          return c.op === "not_in" ? !inside : inside;
        }
        return false;
      }
    }
  };

  /* A dynamic group with no conditions matches nothing (a guard against
     an unconfigured rule silently sweeping the whole fleet). */
  G.evaluateRule = function (group, dev, ctx) {
    const conds = asArr(group && group.conditions);
    if (!conds.length) return false;
    const results = conds.map((c) => G.evaluateCondition(c, dev, ctx));
    return group.match === "any" ? results.some(Boolean) : results.every(Boolean);
  };

  G.conditionSummary = function (cond, ctx) {
    const c = normalizeCondition(cond);
    const field = G.field(c.field);
    const type = (field || {}).type || "text";
    const op = G.operatorLabel(type, c.op);
    if (type === "tag" || type === "software" || type === "service") return (field ? field.label : c.field) + " " + op + " “" + c.value + "”";
    if (type === "bool") return (field ? field.label : c.field) + " " + op;
    if (type === "site") {
      const p = ctx && ctx.provider;
      const site = p ? asArr(p.sites).find((s) => String(s.id) === String(c.value)) : null;
      if (c.op === "in" || c.op === "not_in") return (field.label) + " " + op + " " + asList(c.value).map((id) => siteName(ctx, id)).join(", ");
      return (field.label) + " " + op + " " + (site ? site.name : c.value);
    }
    return (field ? field.label : c.field) + " " + op + " " + c.value;
  };

  function siteName(ctx, id) {
    const p = ctx && ctx.provider;
    if (!p) return id;
    const s = asArr(p.sites).find((x) => String(x.id) === String(id));
    return s ? s.name : id;
  }

  G.ruleSummary = function (group, ctx) {
    const conds = asArr(group && group.conditions);
    if (!conds.length) return "No conditions — matches nothing";
    const join = group.match === "any" ? " OR " : " AND ";
    return conds.map((c) => G.conditionSummary(c, ctx)).join(join);
  };

  /* ─────────────────────── fleet index (inventory-backed fields) ─────────────────────── */

  G.buildIndex = function (invRecords) {
    const soft = {}, svc = {}, patches = {};
    asArr(invRecords).forEach((s) => {
      const did = String(s.deviceId);
      const sec = asObj(s.sections);
      soft[did] = asArr(sec.software).map((it) => low(asObj(it).name)).filter(Boolean);
      svc[did] = asArr(sec.services).map((it) => ({ name: low(asObj(it).name), display: low(asObj(it).displayName), state: low(asObj(it).state) })).filter((s2) => s2.name || s2.display);
      patches[did] = asArr(sec.patches).map((it) => ({ id: low(asObj(it).id), title: low(asObj(it).title), classification: low(asObj(it).classification) }));
    });
    return { soft, svc, patches };
  };

  G.emptyIndex = () => ({ soft: {}, svc: {}, patches: {} });

  G.loadIndex = async function (providerId) {
    if (!INV || typeof INV.listSnapshots !== "function") return G.emptyIndex();
    try { return G.buildIndex(await INV.listSnapshots(providerId)); } catch (e) { return G.emptyIndex(); }
  };

  /* ─────────────────────── membership ─────────────────────── */

  G.devicesInGroup = function (provider, group, opts) {
    opts = opts || {};
    if (!provider || !group) return [];
    const devices = opts.devices ? asArr(opts.devices) : asArr(provider.devices).map(D.normalizeDevice);
    if (group.kind === "dynamic") {
      const list = group.siteId != null && group.siteId !== "" ? devices.filter((d) => String(d.siteId) === String(group.siteId)) : devices;
      const ctx = opts.ctx || { provider, soft: {}, svc: {} };
      return list.filter((d) => G.evaluateRule(group, d, ctx));
    }
    return devices.filter((d) => asArr(d.groupIds).some((x) => String(x) === String(group.id)));
  };

  G.membershipIds = function (provider, dev, ctx) {
    ctx = ctx || { provider, soft: {}, svc: {} };
    const out = [];
    asArr(provider && provider.deviceGroups).forEach((g) => {
      if (g.kind === "dynamic") {
        if (g.siteId != null && g.siteId !== "" && String(dev.siteId) !== String(g.siteId)) return;
        if (G.evaluateRule(g, dev, ctx)) out.push(String(g.id));
      } else if (asArr(dev.groupIds).some((x) => String(x) === String(g.id))) {
        out.push(String(g.id));
      }
    });
    return out;
  };

  G.groupsForDevice = function (provider, dev, ctx) {
    const ids = G.membershipIds(provider, dev, ctx);
    return asArr(provider && provider.deviceGroups).filter((g) => ids.indexOf(String(g.id)) !== -1);
  };

  G.staticGroupsOf = (provider, dev) => asArr(provider && provider.deviceGroups).filter((g) => g.kind !== "dynamic" && asArr(dev && dev.groupIds).some((x) => String(x) === String(g.id)));
  G.dynamicGroupsOf = function (provider, dev, ctx) {
    ctx = ctx || { provider, soft: {}, svc: {} };
    return asArr(provider && provider.deviceGroups).filter((g) => g.kind === "dynamic" && (g.siteId == null || g.siteId === "" || String(g.siteId) === String(dev.siteId)) && G.evaluateRule(g, dev, ctx));
  };

  /* Does a device match a targeting spec {groupIds, tags, deviceIds, siteIds}?
     Shared by policies (19) and monitors (20), so both resolve a target the
     same way a group does. Returns the strongest matching reason plus a
     specificity rank, so precedence can be ordered deterministically: an
     explicit device beats a tag, which beats a group, which beats a site,
     which beats a provider-wide (empty) spec. */
  G.matchTargets = function (provider, targets, dev, ctx) {
    targets = asObj(targets);
    if (!dev) return { match: false, matchedBy: null, specificity: 0 };
    const groupIds = asArr(targets.groupIds).map(String);
    const tags = asArr(targets.tags).map(low);
    const deviceIds = asArr(targets.deviceIds).map(String);
    const siteIds = asArr(targets.siteIds).map(String);
    if (deviceIds.length && deviceIds.indexOf(String(dev.id)) !== -1) return { match: true, matchedBy: "device", specificity: 4 };
    const devTags = asArr(dev.tags).map(low);
    const hitTag = tags.filter((t) => devTags.indexOf(t) !== -1)[0];
    if (tags.length && hitTag) return { match: true, matchedBy: "tag", specificity: 3, tag: hitTag };
    if (groupIds.length) {
      const ids = G.membershipIds(provider, dev, ctx || { provider });
      const hitGroup = groupIds.filter((gid) => ids.indexOf(String(gid)) !== -1)[0];
      if (hitGroup) return { match: true, matchedBy: "group", specificity: 2, groupId: hitGroup };
    }
    if (siteIds.length && dev.siteId != null && siteIds.indexOf(String(dev.siteId)) !== -1) return { match: true, matchedBy: "site", specificity: 1, siteId: String(dev.siteId) };
    const empty = !groupIds.length && !tags.length && !deviceIds.length && !siteIds.length;
    if (empty) return { match: true, matchedBy: "provider", specificity: 0 };
    return { match: false, matchedBy: null, specificity: 0 };
  };

  G.targetSummary = function (provider, targets, ctx) {
    targets = asObj(targets);
    const bits = [];
    asArr(targets.deviceIds).forEach((id) => {
      const dev = asArr(provider && provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(id));
      bits.push("device " + (dev ? (dev.hostname || dev.displayName) : id));
    });
    asArr(targets.tags).forEach((t) => bits.push("tag “" + t + "”"));
    asArr(targets.groupIds).forEach((gid) => {
      const grp = asArr(provider && provider.deviceGroups).find((g) => String(g.id) === String(gid));
      bits.push("group " + (grp ? grp.name : gid));
    });
    asArr(targets.siteIds).forEach((sid) => {
      const site = asArr(provider && provider.sites).find((s) => String(s.id) === String(sid));
      bits.push("site " + (site ? site.name : sid));
    });
    return bits.length ? bits.join(" · ") : "every device (provider-wide)";
  };

  /* ─────────────────────── group reads ─────────────────────── */

  G.get = async function (providerId, groupId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const grp = asArr(g.provider.deviceGroups).find((x) => String(x.id) === String(groupId));
    if (!grp) return { error: "not_found", groupId };
    return { group: normalizeGroup(grp), provider: g.provider, rev: g.rev };
  };

  G.list = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(g.provider.deviceGroups).map(normalizeGroup);
  };

  G.listOf = (provider) => asArr(provider && provider.deviceGroups).map(normalizeGroup);

  G.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return G.statsOf(g.provider, await G.loadIndex(providerId));
  };

  G.statsOf = function (provider, ctx) {
    ctx = ctx || { provider, soft: {}, svc: {} };
    const groups = G.listOf(provider);
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const counts = groups.map((grp) => ({ group: grp, count: G.devicesInGroup(provider, grp, { devices, ctx }).length }));
    const staticCount = groups.filter((x) => x.kind !== "dynamic").length;
    const dynamicCount = groups.length - staticCount;
    const tagged = devices.filter((d) => d.tags.length).length;
    const grouped = new Set();
    counts.forEach((c) => G.devicesInGroup(provider, c.group, { devices, ctx }).forEach((d) => grouped.add(String(d.id))));
    return {
      total: groups.length, staticCount, dynamicCount,
      tags: G.tagsOf(provider).length,
      devices: devices.length, tagged, grouped: grouped.size, ungrouped: devices.length - grouped.size,
      counts,
    };
  };

  /* ─────────────────────── groups CRUD ─────────────────────── */

  G.add = async function (providerId, data) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const grp = normalizeGroup(data);
    if (grp.siteId && !asArr(g.provider.sites).some((s) => String(s.id) === String(grp.siteId))) return { error: "unknown_site", siteId: grp.siteId };
    const v = G.validateGroup(grp);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await T.addItem(providerId, "deviceGroups", grp);
    if (r.error) return r;
    return { group: normalizeGroup(r.item), rev: r.rev };
  };

  G.update = async function (providerId, groupId, patch) {
    const g = await T.get(providerId);
    if (g.error) return g;
    if (patch && patch.siteId != null && patch.siteId !== "" && !asArr(g.provider.sites).some((s) => String(s.id) === String(patch.siteId))) return { error: "unknown_site", siteId: patch.siteId };
    let out = null;
    const r = await T.updateItem(providerId, "deviceGroups", groupId, (it) => {
      const merged = Object.assign({}, it, asObj(patch), { id: it.id, kind: "deviceGroup", createdAt: it.createdAt, updatedAt: now() });
      if (patch && patch.siteId !== undefined) merged.siteId = patch.siteId ? String(patch.siteId) : null;
      const norm = normalizeGroup(merged);
      Object.assign(it, norm, { id: it.id, kind: (it.kind === "deviceGroup" || it.kind) ? it.kind : "deviceGroup" });
      out = it;
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", groupId };
    return { group: normalizeGroup(out), rev: r.rev };
  };

  G.remove = async function (providerId, groupId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const r = await T.removeItem(providerId, "deviceGroups", groupId);
    if (r.error) return r;
    await T.update(providerId, (p) => {
      p.devices.forEach((dev) => { dev.groupIds = asArr(dev.groupIds).filter((x) => String(x) !== String(groupId)); });
    });
    return { removed: groupId };
  };

  /* Replace a static group's membership in one write. */
  G.setMembers = async function (providerId, groupId, deviceIds) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const grp = asArr(g.provider.deviceGroups).find((x) => String(x.id) === String(groupId));
    if (!grp) return { error: "not_found", groupId };
    if (grp.kind === "dynamic") return { error: "dynamic_membership", message: "Dynamic group membership is computed from its rule, not assigned." };
    const want = new Set(asArr(deviceIds).map(String));
    const r = await T.update(providerId, (p) => {
      p.devices.forEach((dev) => {
        const ids = asArr(dev.groupIds).filter((x) => String(x) !== String(groupId));
        if (want.has(String(dev.id))) ids.push(String(groupId));
        dev.groupIds = ids;
      });
    });
    if (r.error) return r;
    const fresh = await T.get(providerId);
    return { groupId, count: G.devicesInGroup(fresh.provider, normalizeGroup(grp)).length, rev: fresh.rev };
  };

  G.addMember = async function (providerId, groupId, deviceId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const grp = asArr(g.provider.deviceGroups).find((x) => String(x.id) === String(groupId));
    if (!grp) return { error: "not_found", groupId };
    if (grp.kind === "dynamic") return { error: "dynamic_membership" };
    const dev = asArr(g.provider.devices).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "device_not_found", deviceId };
    if (asArr(dev.groupIds).some((x) => String(x) === String(groupId))) return { ok: true, noop: true };
    const r = await D.update(providerId, deviceId, { groupIds: asArr(dev.groupIds).concat([String(groupId)]) });
    if (r.error) return r;
    return { ok: true, device: r.device };
  };

  G.removeMember = async function (providerId, groupId, deviceId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = asArr(g.provider.devices).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "device_not_found", deviceId };
    const r = await D.update(providerId, deviceId, { groupIds: asArr(dev.groupIds).filter((x) => String(x) !== String(groupId)) });
    if (r.error) return r;
    return { ok: true, device: r.device };
  };

  /* Re-evaluate every dynamic group against the fleet and report the
     resulting membership. Membership is derived (never stored), so this
     is a read-only reconciliation used by the console and by tests. */
  G.reconcile = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const ctx = await G.loadIndex(providerId);
    const ctx2 = { provider: g.provider, soft: ctx.soft, svc: ctx.svc, patches: ctx.patches };
    const devices = asArr(g.provider.devices).map(D.normalizeDevice);
    const rows = G.listOf(g.provider).map((grp) => {
      const members = G.devicesInGroup(g.provider, grp, { devices, ctx: ctx2 }).map((d) => String(d.id));
      return { groupId: grp.id, name: grp.name, kind: grp.kind, count: members.length, deviceIds: members };
    });
    return { ok: true, groups: rows, deviceCount: devices.length, at: now() };
  };

  /* ─────────────────────── tags ─────────────────────── */

  G.tagsOf = function (provider) {
    const map = new Map();
    asArr(provider && provider.devices).forEach((raw) => {
      const dev = D.normalizeDevice(raw);
      dev.tags.forEach((t) => {
        const name = String(t);
        if (!name) return;
        let e = map.get(name);
        if (!e) { e = { name, deviceIds: [] }; map.set(name, e); }
        if (e.deviceIds.indexOf(String(dev.id)) === -1) e.deviceIds.push(String(dev.id));
      });
    });
    return [...map.values()].map((e) => ({ name: e.name, count: e.deviceIds.length, deviceIds: e.deviceIds })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  G.tags = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return G.tagsOf(g.provider);
  };

  G.tagNames = async function (providerId) { return (await G.tags(providerId)).map((t) => t.name); };

  G.tagDevices = async function (providerId, tag) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const name = S(tag, 80).trim();
    return asArr(g.provider.devices).map(D.normalizeDevice).filter((d) => d.tags.some((t) => low(t) === low(name)));
  };

  G.applyTag = async function (providerId, tag, deviceIds) {
    const name = S(tag, 80).trim();
    if (!name) return { error: "no_tag" };
    const g = await T.get(providerId);
    if (g.error) return g;
    const want = new Set(asArr(deviceIds).map(String));
    let changed = 0;
    await T.update(providerId, (p) => {
      p.devices.forEach((dev) => {
        if (!want.has(String(dev.id))) return;
        const tags = asArr(dev.tags);
        if (!tags.some((t) => low(t) === low(name))) { tags.push(name); dev.tags = tags; changed++; }
      });
    });
    return { ok: true, tag: name, changed };
  };

  G.removeTag = async function (providerId, tag, deviceIds) {
    const name = low(tag);
    const g = await T.get(providerId);
    if (g.error) return g;
    const only = asArr(deviceIds).length ? new Set(asArr(deviceIds).map(String)) : null;
    let changed = 0;
    await T.update(providerId, (p) => {
      p.devices.forEach((dev) => {
        if (only && !only.has(String(dev.id))) return;
        const before = asArr(dev.tags);
        const after = before.filter((t) => low(t) !== name);
        if (after.length !== before.length) { dev.tags = after; changed++; }
      });
    });
    return { ok: true, tag: S(tag, 80), changed };
  };

  G.renameTag = async function (providerId, from, to) {
    const a = low(from), b = S(to, 80).trim();
    if (!b) return { error: "no_tag" };
    if (a === low(b)) return { ok: true, noop: true, changed: 0 };
    const g = await T.get(providerId);
    if (g.error) return g;
    let changed = 0;
    await T.update(providerId, (p) => {
      p.devices.forEach((dev) => {
        const tags = asArr(dev.tags);
        if (!tags.some((t) => low(t) === a)) return;
        const next = [];
        tags.forEach((t) => { if (low(t) === a) { if (next.map(low).indexOf(low(b)) === -1) next.push(b); } else if (next.map(low).indexOf(low(t)) === -1) next.push(t); });
        dev.tags = next;
        changed++;
      });
    });
    return { ok: true, from: S(from, 80), to: b, changed };
  };

  G.suggestTags = function (provider, prefix) {
    const p = low(prefix);
    return G.tagsOf(provider).map((t) => t.name).filter((t) => !p || low(t).indexOf(p) !== -1).slice(0, 20);
  };

  /* Merge a tag into another (rename handles this when the target exists). */
  G.mergeTags = (providerId, from, to) => G.renameTag(providerId, from, to);

  /* ─────────────────────── boot / seed ─────────────────────── */

  G.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.seedDemoGroups", true) === false) return { skipped: true, reason: "seed_disabled" };
    const providers = await T.list();
    const demo = providers.find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    const existing = new Set(asArr(g.provider.deviceGroups).map((x) => low(x.name)));
    const created = [];
    const additions = [
      { name: "Windows 11 fleet", kind: "dynamic", siteId: null, match: "all", conditions: [{ field: "os.family", op: "is", value: "Windows" }, { field: "os.version", op: "starts_with", value: "23H2" }] },
      { name: "Low disk space", kind: "dynamic", siteId: null, match: "all", conditions: [{ field: "diskUsedPct", op: "gte", value: 80 }] },
      { name: "Production servers", kind: "dynamic", siteId: null, match: "any", conditions: [{ field: "tag", op: "has_tag", value: "prod" }, { field: "role", op: "is", value: "server" }] },
    ];
    for (const data of additions) {
      if (!opts.force && existing.has(low(data.name))) continue;
      const r = await G.add(demo.id, data);
      if (r.error) continue;
      created.push(r.group.id);
    }
    return { providerId: demo.id, created };
  };

  G.init = async function () { try { await T.ready; await G.seedDemo(); } catch (e) { console.error("groups seed failed", e); } };

  /* ═══════════════════════ Groups station ═══════════════════════ */

  G.currentProviderId = null;

  G.render = async function (ctx) {
    const ui = ERP.ui, esc = ui.esc;
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { ctx.empty(); return; }

    const TABS = ["groups", "tags"];
    const state = {
      pid: (G.currentProviderId && providers.some((p) => p.id === G.currentProviderId)) ? G.currentProviderId : providers[0].id,
      tab: TABS.indexOf(el.__tab) !== -1 ? el.__tab : "groups",
      tagSearch: "",
    };
    G.currentProviderId = state.pid;

    const root = document.createElement("div");
    root.className = "rmm-groups";
    el.innerHTML = "";
    el.appendChild(root);

    const cache = { provider: null, ctx: null, stats: null };
    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    async function loadCtx(p) {
      const idx = await G.loadIndex(state.pid);
      return { provider: p, soft: idx.soft, svc: idx.svc, patches: idx.patches };
    }

    function groupKindBadge(g) { return g.kind === "dynamic" ? ui.badge("dynamic", "info") : ui.badge("static", "muted"); }
    function scopeLabel(p, g) { return g.siteId ? ((asArr(p.sites).find((s) => String(s.id) === String(g.siteId)) || {}).name || g.siteId) : "provider-wide"; }
    function deviceChip(d) {
      return '<button class="rmm-dev-chip" data-act="grp-dev-open" data-arg="' + esc(d.id) + '">' +
        '<span class="rmm-dot tone-' + D.statusMeta(D.effectiveStatus(d)).tone + '"></span>' +
        '<span class="rmm-dev-chip-name">' + esc(d.hostname || d.displayName) + "</span>" +
        (d.os.name ? '<span class="erp-sub">' + esc(d.os.family || d.os.name) + "</span>" : "") +
        "</button>";
    }

    async function paint() {
      const p = await prov();
      if (!p) { ctx.error({ title: "Provider not found", message: "This tenant's document could not be loaded." }); return; }
      cache.provider = p;
      const c = await loadCtx(p);
      cache.ctx = c;
      const groups = G.listOf(p);
      const stats = G.statsOf(p, c);
      cache.stats = stats;
      const tabs = ui.tabs([
        { id: "groups", label: "Groups", badge: String(groups.length) },
        { id: "tags", label: "Tags", badge: String(stats.tags) },
      ], state.tab);
      const head = ui.pageHead("Groups & tags",
        "Static groups hold explicit membership; dynamic groups are rule-based and always current. Tags are the provider-wide vocabulary policies and automations target.",
        ui.btn("New group", { primary: true, act: "grp-add" }) + " " + ui.btn("Tag devices", { act: "tag-apply" }));
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + " (" + (x.groupCount || 0) + ")</option>").join("") +
          "</select></div></div>"
        : "";
      root.innerHTML = head + picker + tabs.html;
      root.querySelector('[data-panel="groups"]').innerHTML = groupsPanelHtml(p, groups, stats);
      root.querySelector('[data-panel="tags"]').innerHTML = tagsPanelHtml(p, stats);
      ui.showTab(root, state.tab);
    }

    function groupsPanelHtml(p, groups, stats) {
      const rows = groups.map((grp) => {
        const members = G.devicesInGroup(p, grp, { ctx: cache.ctx });
        return {
          name: "<b>" + esc(grp.name) + "</b>" + (grp.description ? '<div class="erp-sub">' + esc(grp.description) + "</div>" : ""),
          kind: groupKindBadge(grp),
          scope: esc(scopeLabel(p, grp)),
          members: '<b>' + members.length + "</b>" + '<div class="erp-sub">' + members.slice(0, 3).map((d) => esc(d.hostname || d.displayName)).join(", ") + (members.length > 3 ? " …" : "") + "</div>",
          rule: grp.kind === "dynamic" ? '<span class="erp-sub">' + esc(grp.match.toUpperCase()) + " · " + esc(G.ruleSummary(grp, cache.ctx)) + "</span>" : '<span class="erp-sub">explicit membership</span>',
          actions: ui.btn("Members", { small: true, act: "grp-members", arg: grp.id }) + " " + ui.btn("Edit", { small: true, act: "grp-edit", arg: grp.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "grp-del", arg: grp.id }),
        };
      });
      return ui.summary([
        { label: "Groups", value: String(stats.total) },
        { label: "Static", value: String(stats.staticCount) },
        { label: "Dynamic", value: String(stats.dynamicCount) },
        { label: "Devices grouped", value: String(stats.grouped) + " / " + stats.devices },
        { label: "Ungrouped", value: String(stats.ungrouped) },
        { label: "Tags in use", value: String(stats.tags) },
      ]) +
        '<div>' +
        ui.table([
          { key: "name", label: "Group", render: (r) => r.name },
          { key: "kind", label: "Kind", render: (r) => r.kind },
          { key: "scope", label: "Scope", render: (r) => r.scope },
          { key: "members", label: "Members", render: (r) => r.members },
          { key: "rule", label: "Rule", render: (r) => r.rule },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No groups yet — create a static group or a rule-based dynamic group." }) +
        "</div>";
    }

    function tagsPanelHtml(p, stats) {
      const tags = G.tagsOf(p).filter((t) => !state.tagSearch || low(t.name).indexOf(low(state.tagSearch)) !== -1);
      const rows = tags.map((t) => ({
        name: ui.badge(t.name, "info"),
        count: "<b>" + t.count + "</b>",
        devices: '<span class="erp-sub">' + t.deviceIds.slice(0, 6).map((id) => esc(((asArr(p.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(id))) || {}).hostname || id)).join(", ") + (t.count > 6 ? " …" : "") + "</span>",
        actions: ui.btn("Rename", { small: true, act: "tag-rename", arg: t.name }) + " " + ui.btn("Add to devices", { small: true, act: "tag-apply-one", arg: t.name }) + " " + ui.btn("Delete", { small: true, danger: true, act: "tag-del", arg: t.name }),
      }));
      return '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Filter tags</label><input type="search" name="tagSearch" placeholder="search tags…" value="' + esc(state.tagSearch) + '"></div></div>' +
        ui.summary([{ label: "Tags in use", value: String(stats.tags) }, { label: "Tagged devices", value: String(stats.tagged) }, { label: "Untagged", value: String(stats.devices - stats.tagged) }]) +
        ui.card("Tag vocabulary (" + tags.length + ")",
          ui.table([
            { key: "name", label: "Tag", render: (r) => r.name },
            { key: "count", label: "Devices", align: "right", render: (r) => r.count },
            { key: "devices", label: "Applied to", render: (r) => r.devices },
            { key: "actions", label: "", render: (r) => r.actions },
          ], rows, { scroll: true, emptyText: "No tags yet — apply a tag to a device to start the vocabulary." })) +
        '<p class="erp-sub">A tag is a free-form label stored on each device. Policies (Task 19), automations (Task 22) and dynamic groups all target tags, so a tag outlives the group it was created for.</p>';
    }

    /* ── group form (with a dynamic rule builder) ── */

    function openGroupForm(group) {
      const p = cache.provider;
      const isEdit = !!group;
      const fs = {
        kind: isEdit ? group.kind : "static",
        siteId: isEdit ? (group.siteId || "") : "",
        match: isEdit ? group.match : "all",
        conditions: isEdit ? group.conditions.map(clone) : [{ field: "os.family", op: "is", value: "" }],
      };
      const siteOpts = [{ value: "", label: "— provider-wide —" }].concat(asArr(p.sites).map((s) => ({ value: s.id, label: s.name })));
      const deviceList = asArr(p.devices).map(D.normalizeDevice);
      const memberSet = new Set(isEdit ? G.devicesInGroup(p, group, { ctx: cache.ctx }).map((d) => String(d.id)) : []);

      function fieldOpts(sel) { return FIELDS.map((f) => '<option value="' + esc(f.id) + '"' + (f.id === sel ? " selected" : "") + ">" + esc(f.group + " · " + f.label) + "</option>").join(""); }
      function opOpts(fieldId, sel) { const f = G.field(fieldId) || {}; return G.operators(f.type || "text").map((o) => '<option value="' + esc(o.id) + '"' + (o.id === sel ? " selected" : "") + ">" + esc(o.label) + "</option>").join(""); }
      function valueControl(idx, cond) {
        const f = G.field(cond.field) || { type: "text" };
        if (f.type === "select" || f.type === "site") {
          const opts = f.type === "site" ? [{ value: "", label: "— choose site —" }].concat(asArr(p.sites).map((s) => ({ value: s.id, label: s.name }))).filter((o) => o.value !== "") : (f.options ? f.options() : []).map((v) => ({ value: v, label: v }));
          return '<select data-cond-field-val="' + idx + '"><option value="">— value —</option>' + opts.map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(cond.value) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>";
        }
        if (f.type === "bool") return '<select data-cond-field-val="' + idx + '"><option value="true"' + (cond.value === true ? " selected" : "") + ">true</option><option value=\"false\"" + (cond.value === false ? " selected" : "") + ">false</option></select>";
        if (f.type === "number") return '<input type="number" data-cond-field-val="' + idx + '" value="' + esc(cond.value) + '">';
        return '<input type="text" data-cond-field-val="' + idx + '" placeholder="value" value="' + esc(cond.value) + '">';
      }
      function conditionsHtml() {
        if (fs.kind !== "dynamic") return "";
        return fs.conditions.map((c, i) =>
          '<div class="rmm-cond-row" data-cond-row="' + i + '">' +
          '<select data-cond-field="' + i + '">' + fieldOpts(c.field) + "</select>" +
          '<select data-cond-op="' + i + '">' + opOpts(c.field, c.op) + "</select>" +
          valueControl(i, c) +
          ui.btn("✕", { small: true, danger: true, act: "grp-cond-del", arg: String(i), title: "Remove condition" }) +
          "</div>").join("") +
          '<div class="erp-btn-row">' + ui.btn("Add condition", { small: true, act: "grp-cond-add" }) +
          ' <label class="erp-check" style="margin-left:12px">Match <select data-cond-match>' + G.MATCH.map((m) => '<option value="' + m + '"' + (m === fs.match ? " selected" : "") + ">" + m.toUpperCase() + "</option>").join("") + "</select> of the conditions</label></div>" +
          '<div class="rmm-rule-preview" data-rule-preview>' + esc(G.ruleSummary({ match: fs.match, conditions: fs.conditions }, cache.ctx)) + "</div>";
      }
      function membersHtml() {
        if (fs.kind !== "static") return "";
        const rows = deviceList.map((d) => ({ on: memberSet.has(String(d.id)), d }));
        return '<div class="field"><label>Members (' + rows.filter((r) => r.on).length + ")</label><div class=\"rmm-check-list\">" +
          rows.map((r) => '<label class="erp-check"><input type="checkbox" data-member="' + esc(r.d.id) + '"' + (r.on ? " checked" : "") + "> " + esc(r.d.hostname || r.d.displayName) + ' <span class="erp-sub">' + esc(r.d.os.family || r.d.os.name || "") + "</span></label>").join("") +
          "</div></div>";
      }
      function bodyHtml() {
        return ui.form(
          ui.text("name", "Group name", isEdit ? group.name : "") +
          ui.text("description", "Description", isEdit ? group.description : "") +
          ui.select("kind", "Membership", [{ value: "static", label: "Static — assign devices by hand" }, { value: "dynamic", label: "Dynamic — rule-based" }], fs.kind) +
          ui.select("siteId", "Site scope", siteOpts, fs.siteId) +
          '<div data-kind-block>' + membersHtml() + conditionsHtml() + "</div>",
          ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isEdit ? "Save group" : "Create group", { small: true, primary: true, act: "grp-save" })
        );
      }

      const m = ui.modal({ title: isEdit ? "Edit group" : "New device group", size: "lg", body: bodyHtml() });
      const block = () => m.querySelector("[data-kind-block]");
      function reread() {
        const conds = [...m.querySelectorAll("[data-cond-row]")].map((row, i) => {
          const f = row.querySelector("[data-cond-field]").value;
          const o = row.querySelector("[data-cond-op]").value;
          const vEl = row.querySelector("[data-cond-field-val]");
          let value = vEl ? vEl.value : "";
          if ((G.field(f) || {}).type === "bool") value = value === "true";
          return { field: f, op: o, value };
        });
        if (m.querySelector("[data-cond-row]")) fs.conditions = conds;
        const matchEl = m.querySelector("[data-cond-match]");
        if (matchEl) fs.match = matchEl.value;
      }
      function rerender() { reread(); block().innerHTML = membersHtml() + conditionsHtml(); }

      block().addEventListener("change", (e) => {
        const n = e.target.getAttribute("data-cond-field");
        if (n != null) { reread(); const idx = Number(n); const f = e.target.value; const ops = G.operators((G.field(f) || {}).type); fs.conditions[idx].field = f; fs.conditions[idx].op = ops[0].id; fs.conditions[idx].value = ""; block().innerHTML = membersHtml() + conditionsHtml(); return; }
        if (e.target.hasAttribute("data-cond-match") || e.target.hasAttribute("data-cond-op") || e.target.hasAttribute("data-cond-field-val")) { reread(); const pv = m.querySelector("[data-rule-preview]"); if (pv) pv.textContent = G.ruleSummary({ match: fs.match, conditions: fs.conditions }, cache.ctx); return; }
        if (e.target.name === "kind") { reread(); fs.kind = e.target.value; block().innerHTML = membersHtml() + conditionsHtml(); return; }
      });
      block().addEventListener("input", (e) => { if (e.target.hasAttribute("data-cond-field-val")) { reread(); const pv = m.querySelector("[data-rule-preview]"); if (pv) pv.textContent = G.ruleSummary({ match: fs.match, conditions: fs.conditions }, cache.ctx); } });
      m.addEventListener("click", (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        if (act === "grp-cond-add") { reread(); if (fs.conditions.length >= cap()) { ctx.toast("Condition limit reached", "warn"); return; } fs.conditions.push({ field: "os.family", op: "is", value: "" }); block().innerHTML = membersHtml() + conditionsHtml(); }
        if (act === "grp-cond-del") { reread(); fs.conditions.splice(Number(t.getAttribute("data-arg")), 1); block().innerHTML = membersHtml() + conditionsHtml(); }
      });
      m.querySelector("[data-act=grp-save]").onclick = async () => {
        rerender();
        const v = ui.collect(m, ["name", "description", "kind", "siteId"]);
        if (!String(v.name || "").trim()) { ctx.toast("Group name is required", "error"); return; }
        const payload = {
          name: v.name.trim(), description: v.description || "", kind: v.kind, siteId: v.siteId || null,
          match: fs.match, conditions: fs.kind === "dynamic" ? fs.conditions : [],
        };
        const r = isEdit ? await G.update(state.pid, group.id, payload) : await G.add(state.pid, payload);
        if (r.error) { ctx.toast("Save failed: " + (r.error === "invalid" ? (r.errors || []).join("; ") : r.error), "error"); return; }
        const gid = isEdit ? group.id : r.group.id;
        if (payload.kind === "static") {
          const want = [...m.querySelectorAll("[data-member]")].filter((i) => i.checked).map((i) => i.getAttribute("data-member"));
          const sr = await G.setMembers(state.pid, gid, want);
          if (sr.error) { ctx.toast("Saved, but membership failed: " + sr.error, "error"); }
        }
        ui.closeModal();
        ctx.toast(isEdit ? "Group updated" : "Group created");
        paint();
      };
      return m;
    }

    function openMembers(group) {
      const p = cache.provider;
      const members = G.devicesInGroup(p, group, { ctx: cache.ctx });
      const rows = members.map((d) => ({
        host: "<b>" + esc(d.hostname || d.displayName) + "</b>" + (d.displayName && d.displayName !== d.hostname ? '<div class="erp-sub">' + esc(d.displayName) + "</div>" : ""),
        os: esc(d.os.name || d.os.family || "—"),
        site: esc((D.siteOf(p, d) || {}).name || "—"),
        status: ui.badge(D.statusMeta(D.effectiveStatus(d)).label, D.statusMeta(D.effectiveStatus(d)).tone),
        actions: group.kind === "dynamic" ? "" : ui.btn("Remove", { small: true, danger: true, act: "grp-member-del", arg: group.id + "|" + d.id }),
      }));
      const body = (group.kind === "dynamic" ? '<div class="erp-alert tone-info">' + esc("Rule: " + (group.match === "any" ? "ANY" : "ALL") + " · " + G.ruleSummary(group, cache.ctx)) + "</div>" : "") +
        ui.table([
          { key: "host", label: "Device", render: (r) => r.host },
          { key: "os", label: "Operating system", render: (r) => r.os },
          { key: "site", label: "Site", render: (r) => r.site },
          { key: "status", label: "Status", render: (r) => r.status },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: group.kind === "dynamic" ? "No devices match this rule." : "No members yet." });
      const m = ui.modal({ title: group.name + " · members", size: "lg", body, foot: ui.btn("Edit group", { small: true, primary: true, act: "grp-edit", arg: group.id }) + " " + ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }) });
      m.querySelector("[data-act=grp-edit]").onclick = () => { ui.closeModal(); openGroupForm(group); };
      ui.bind(m, "click", "[data-act=grp-member-del]", async (t) => {
        const [gid, did] = String(t.getAttribute("data-arg")).split("|");
        const r = await G.removeMember(state.pid, gid, did);
        if (r.error) { ctx.toast("Remove failed: " + r.error, "error"); return; }
        ui.closeModal(); ctx.toast("Member removed"); paint();
      });
    }

    function openTagApply(tag) {
      const p = cache.provider;
      const devices = asArr(p.devices).map(D.normalizeDevice);
      const withTag = new Set(tag ? G.tagsOf(p).find((t) => t.name === tag).deviceIds.map(String) : []);
      const body = ui.form(
        ui.text("tag", "Tag", tag || "", "e.g. prod, critical, vpn") +
        '<div class="field"><label>Devices</label><div class="rmm-check-list">' +
        devices.map((d) => '<label class="erp-check"><input type="checkbox" data-tag-dev="' + esc(d.id) + '"' + (withTag.has(String(d.id)) ? " checked" : "") + "> " + esc(d.hostname || d.displayName) + "</label>").join("") +
        "</div></div>",
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Apply tag", { small: true, primary: true, act: "tag-save" })
      );
      const m = ui.modal({ title: tag ? "Manage tag · " + tag : "Apply tag to devices", size: "lg", body });
      m.querySelector("[data-act=tag-save]").onclick = async () => {
        const name = m.querySelector('[name="tag"]').value.trim();
        if (!name) { ctx.toast("Tag name is required", "error"); return; }
        if (tag && low(tag) !== low(name)) { const rr = await G.renameTag(state.pid, tag, name); if (rr.error) { ctx.toast("Rename failed: " + rr.error, "error"); return; } }
        const want = [...m.querySelectorAll("[data-tag-dev]")].filter((i) => i.checked).map((i) => i.getAttribute("data-tag-dev"));
        const applied = await G.applyTag(state.pid, name, want);
        const allWith = (await G.tagDevices(state.pid, name)).map((d) => String(d.id));
        const drop = allWith.filter((id) => want.indexOf(id) === -1);
        if (drop.length) await G.removeTag(state.pid, name, drop);
        if (applied.error) { ctx.toast("Apply failed: " + applied.error, "error"); return; }
        ui.closeModal(); ctx.toast("Tag applied"); paint();
      };
    }

    /* ── events ── */
    ui.bind(root, "click", "[data-act]", async (t, e, act, arg) => {
      const p = cache.provider;
      if (act === "grp-add") return openGroupForm(null);
      if (act === "grp-edit") { const g = G.listOf(p).find((x) => x.id === arg); if (g) return openGroupForm(g); return; }
      if (act === "grp-members") { const g = G.listOf(p).find((x) => x.id === arg); if (g) return openMembers(g); return; }
      if (act === "grp-del") {
        const g = G.listOf(p).find((x) => x.id === arg);
        const ok = await ui.confirm({ title: "Delete group", message: "Delete “" + (g ? g.name : arg) + "”? Static membership is removed from its devices; dynamic membership disappears with the rule.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await G.remove(state.pid, arg);
        if (r.error) { ctx.toast("Delete failed: " + r.error, "error"); return; }
        ctx.toast("Group deleted"); return paint();
      }
      if (act === "grp-dev-open") { ERP.navigate("devices"); return; }
      if (act === "tag-apply") return openTagApply(null);
      if (act === "tag-apply-one") return openTagApply(arg);
      if (act === "tag-rename") return openTagApply(arg);
      if (act === "tag-del") {
        const ok = await ui.confirm({ title: "Delete tag", message: "Remove the tag “" + arg + "” from every device? This cannot be undone.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await G.removeTag(state.pid, arg);
        if (r.error) { ctx.toast("Delete failed: " + r.error, "error"); return; }
        ctx.toast("Tag removed from " + r.changed + " device(s)"); return paint();
      }
    });
    ui.bind(root, "click", "[data-tab]", (t) => { state.tab = t.getAttribute("data-tab"); ui.showTab(root, state.tab); });
    root.addEventListener("input", (e) => {
      if (e.target && e.target.name === "tagSearch") { state.tagSearch = e.target.value; root.querySelector('[data-panel="tags"]').innerHTML = tagsPanelHtml(cache.provider, cache.stats); }
    });
    root.addEventListener("change", async (e) => {
      if (e.target && e.target.name === "pid") { state.pid = e.target.value; G.currentProviderId = state.pid; return paint(); }
    });

    await paint();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", G.init);
  else G.init();
})();
