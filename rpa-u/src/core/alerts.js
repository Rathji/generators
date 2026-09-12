export const ALERT_SEVERITIES = ["info", "warning", "error", "critical"];

export const SEVERITY_RANK = { info: 0, warning: 1, error: 2, critical: 3 };

export function maxSeverity(a, b) {
  return (SEVERITY_RANK[b] ?? -1) > (SEVERITY_RANK[a] ?? -1) ? b : a;
}

export function createAlertManager({ db = null, collection = "alerts", emit = null, clock = () => Date.now(), limit = 200 } = {}) {
  const alerts = new Map();

  function iso(at = clock()) {
    return new Date(at).toISOString();
  }

  async function hydrate() {
    if (!db) return alerts.size;
    for (const stored of db.all(collection)) {
      if (!stored || !stored.key) continue;
      alerts.set(stored.key, stored);
    }
    return alerts.size;
  }

  function persist(alert) {
    if (!db) return Promise.resolve(alert);
    return db.put(collection, alert.key, alert);
  }

  function mergeItems(existing, incoming) {
    const map = new Map((existing || []).map((item) => [`${item.kind || ""}:${item.field || ""}`, item]));
    for (const item of incoming || []) map.set(`${item.kind || ""}:${item.field || ""}`, item);
    return Array.from(map.values());
  }

  async function raise({
    key = null,
    category = "integrity",
    severity = "warning",
    title,
    detail = "",
    entity = null,
    source = "drift",
    items = [],
    at = null,
  } = {}) {
    if (!title) return { ok: false, error: "An alert needs a title.", alert: null };
    const id = key || `${category}:${title}`;
    const now = iso(at);
    let alert = alerts.get(id);

    if (alert) {
      const wasCleared = alert.status === "cleared";
      if (wasCleared) {
        alert.status = "open";
        alert.count = 1;
        alert.firstSeenAt = now;
        alert.clearedAt = null;
        alert.clearedReason = null;
        alert.acknowledgedAt = null;
        alert.acknowledgedBy = null;
        alert.items = mergeItems([], items);
        alert.reopens = (alert.reopens || 0) + 1;
      } else {
        alert.count = (alert.count || 0) + 1;
        alert.items = mergeItems(alert.items, items);
        alert.lastSeenAt = now;
      }
      alert.severity = maxSeverity(alert.severity, severity);
      alert.category = category || alert.category;
      alert.title = title;
      alert.detail = detail || alert.detail;
      alert.entity = entity || alert.entity;
      alert.source = source || alert.source;
      alert.updatedAt = now;
      await persist(alert);
      return { ok: true, alert, deduped: true, reopened: wasCleared };
    }

    alert = {
      id,
      key: id,
      category,
      severity,
      title,
      detail,
      entity: entity || null,
      source,
      status: "open",
      count: 1,
      items: mergeItems([], items),
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
      acknowledgedAt: null,
      acknowledgedBy: null,
      clearedAt: null,
      clearedReason: null,
      reopens: 0,
    };
    alerts.set(id, alert);
    if (alerts.size > limit) {
      const oldest = Array.from(alerts.values())
        .filter((entry) => entry.status === "cleared")
        .sort((a, b) => String(a.clearedAt || a.updatedAt).localeCompare(String(b.clearedAt || b.updatedAt)))[0];
      if (oldest) alerts.delete(oldest.key);
    }
    await persist(alert);
    if (emit) {
      await emit(
        "alert.raised",
        { alertId: alert.key, severity: alert.severity, category: alert.category, title: alert.title, key: `${alert.category}:${alert.entity?.id || alert.title}` },
        { source: "ru", subject: alert.entity ? { entityType: alert.entity.typeId, entityId: alert.entity.id } : null }
      );
    }
    return { ok: true, alert, deduped: false, reopened: false };
  }

  async function acknowledge(id, { actor = "operator" } = {}) {
    const alert = alerts.get(id);
    if (!alert) return { ok: false, error: `Unknown alert "${id}".`, alert: null };
    if (alert.status === "acknowledged") return { ok: true, alert, reused: true };
    if (alert.status === "cleared") return { ok: false, error: "A cleared alert cannot be acknowledged.", alert };
    alert.status = "acknowledged";
    alert.acknowledgedAt = iso();
    alert.acknowledgedBy = actor;
    alert.updatedAt = alert.acknowledgedAt;
    await persist(alert);
    if (emit) await emit("alert.acknowledged", { alertId: alert.key, actor }, { source: "ru", subject: alert.entity ? { entityType: alert.entity.typeId, entityId: alert.entity.id } : null });
    return { ok: true, alert, reused: false };
  }

  async function clear(id, { reason = "" } = {}) {
    const alert = alerts.get(id);
    if (!alert) return { ok: false, error: `Unknown alert "${id}".`, alert: null };
    if (alert.status === "cleared") return { ok: true, alert, reused: true };
    alert.status = "cleared";
    alert.clearedAt = iso();
    alert.clearedReason = reason;
    alert.updatedAt = alert.clearedAt;
    await persist(alert);
    if (emit) await emit("alert.cleared", { alertId: alert.key, reason }, { source: "ru", subject: alert.entity ? { entityType: alert.entity.typeId, entityId: alert.entity.id } : null });
    return { ok: true, alert, reused: false };
  }

  async function clearMatches(predicate, { reason = "" } = {}) {
    let cleared = 0;
    for (const alert of list()) {
      if (alert.status === "cleared") continue;
      if (predicate(alert)) {
        await clear(alert.key, { reason });
        cleared += 1;
      }
    }
    return cleared;
  }

  function list({ status = null, category = null, severity = null, minSeverity = null, openOnly = false } = {}) {
    const floor = minSeverity ? SEVERITY_RANK[minSeverity] : null;
    return Array.from(alerts.values())
      .filter((alert) => {
        if (openOnly && alert.status === "cleared") return false;
        if (status && alert.status !== status) return false;
        if (category && alert.category !== category) return false;
        if (severity && alert.severity !== severity) return false;
        if (floor != null && (SEVERITY_RANK[alert.severity] ?? -1) < floor) return false;
        return true;
      })
      .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)) || a.title.localeCompare(b.title));
  }

  function open() {
    return list({ openOnly: true });
  }

  function openCount() {
    return open().length;
  }

  function get(id) {
    return alerts.get(id) || null;
  }

  function forEntity(typeId, entityId) {
    return list().filter((alert) => alert.entity && alert.entity.typeId === typeId && alert.entity.id === entityId);
  }

  function counts() {
    const bySeverity = {};
    const byStatus = {};
    const byCategory = {};
    for (const alert of alerts.values()) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
      byStatus[alert.status] = (byStatus[alert.status] || 0) + 1;
      byCategory[alert.category] = (byCategory[alert.category] || 0) + 1;
    }
    return { bySeverity, byStatus, byCategory };
  }

  function stats() {
    const grouped = counts();
    return {
      total: alerts.size,
      open: grouped.byStatus.open || 0,
      acknowledged: grouped.byStatus.acknowledged || 0,
      cleared: grouped.byStatus.cleared || 0,
      bySeverity: grouped.bySeverity,
      byCategory: grouped.byCategory,
      critical: grouped.bySeverity.critical || 0,
    };
  }

  async function reset() {
    alerts.clear();
    if (db) await db.clear(collection);
  }

  return {
    collection,
    severities: ALERT_SEVERITIES,
    hydrate,
    raise,
    acknowledge,
    clear,
    clearMatches,
    get,
    list,
    open,
    openCount,
    forEntity,
    counts,
    stats,
    reset,
  };
}
