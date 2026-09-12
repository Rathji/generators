// src/pm/migrate.js — importing project-master data into pm-u (Phase 6).
//
// `pm-u` is the successor to `project-master`, so the two share the same
// backup envelope (`{ app, schemaVersion, settings, entities }`). Migration is
// therefore not a format rewrite — it is a VERSION UPGRADE plus an integrity
// pass: coerce a v1 payload into the v2 schema, repair dangling references,
// drop junk, and hand back a normalised payload + a human-readable report.
//
// The pipeline is deliberately split into pure stages so it can be tested
// without a store and previewed before it touches any data:
//
//   detectBackup(payload)              → { source, fromSchema, ... } | null
//   planMigration(payload, opts)       → { payload, report }   (pure, no writes)
//   validateMigratedPayload(payload)   → { ok, errors, warnings }
//   applyMigration(store, payload, {mode}) → { added, updated, removed }
//
// `planMigration` never throws on fixable problems — it repairs them and
// records what it did in `report.repairs`, so the preview can show the user
// exactly what will happen. It DOES throw for payloads that aren't a
// recognisable backup or that come from a newer schema than this app.

import { ENTITY_TYPES, SCHEMA_VERSION, DEFAULT_SETTINGS, BACKUP_APPS, uid } from "./store.js";
import { normalizeRef } from "./integrate.js";
import { esc, toast, openModal } from "./ui.js";
import { ICONS } from "./icons.js";

// Bumped when `planMigration`'s repair rules change, so a report records which
// ruleset produced it.
export const MIGRATION_VERSION = 1;

// ── tiny coercion helpers (exported for tests) ───────────────────
export const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export const asStr = (v, d = "") => (v == null ? d : String(v));
export const asArr = (v) => (Array.isArray(v) ? v : []);
// Like asArr, but a lone non-empty string becomes a one-item list — so a
// hand-edited `"tags": "urgent"` survives instead of being silently dropped.
export const asList = (v) => (Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
export const asNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
export const asBool = (v) => v === true || v === "true" || v === 1;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const asIso = (v) => (ISO_RE.test(String(v == null ? "" : v)) ? String(v) : "");

// ── detection ────────────────────────────────────────────────────
export function detectBackup(payload) {
  if (!isObj(payload) || !BACKUP_APPS.includes(payload.app) || !isObj(payload.entities)) return null;
  const fromSchema = Number.isFinite(Number(payload.schemaVersion)) ? Number(payload.schemaVersion) : 0;
  return {
    source: payload.app,
    fromSchema,
    exportedAt: asNum(payload.exportedAt, 0),
    // A v1 payload (or any non-pm-u marker) needs the migration pass; a v2
    // pm-u payload is already current and can go straight through restore.
    needsUpgrade: payload.app !== "pm-u" || fromSchema < SCHEMA_VERSION,
    isCurrent: payload.app === "pm-u" && fromSchema >= SCHEMA_VERSION,
  };
}

// ── settings ─────────────────────────────────────────────────────
export function normalizeSettings(raw) {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  if (!isObj(raw)) return out;
  if (typeof raw.profileName === "string") out.profileName = raw.profileName.trim().slice(0, 80);
  if (typeof raw.theme === "string" && raw.theme) out.theme = raw.theme;
  const clampNum = (v, lo, hi, d) => {
    const n = Math.round(asNum(v, d));
    return Math.min(hi, Math.max(lo, n));
  };
  out.focusWork = clampNum(raw.focusWork, 1, 240, out.focusWork);
  out.focusShort = clampNum(raw.focusShort, 1, 120, out.focusShort);
  out.focusLong = clampNum(raw.focusLong, 1, 240, out.focusLong);
  return out;
}

// ── per-record normalisation ─────────────────────────────────────
// Every record keeps its unknown fields (forward-compat), but known fields are
// coerced to the shapes the pm-u modules actually read. Returns a fresh object.
export function normalizeRecord(type, rec) {
  const r = Object.assign({}, isObj(rec) ? rec : {});
  r.type = type;
  r.id = asStr(r.id).trim();
  r.v = SCHEMA_VERSION;
  const created = asNum(r.created, 0) || Date.now();
  r.created = created;
  r.updated = asNum(r.updated, 0) || created;
  if (r.tags !== undefined || type === "task" || type === "note") r.tags = asList(r.tags).map((t) => asStr(t).trim()).filter(Boolean);
  if (r.refs !== undefined) r.refs = asList(r.refs).map(normalizeRef).filter(Boolean);

  switch (type) {
    case "project":
      r.name = asStr(r.name).trim() || "Untitled project";
      r.status = asStr(r.status).trim() || "Active";
      r.targetDate = asIso(r.targetDate);
      r.milestones = asArr(r.milestones).map((m) => ({
        id: asStr(m && m.id) || uid(),
        name: asStr(m && m.name).trim() || "Milestone",
        due: asIso(m && m.due),
        taskIds: asList(m && m.taskIds).map((t) => asStr(t)).filter(Boolean),
        done: asBool(m && m.done),
      }));
      r.ideas = asArr(r.ideas).map((i) => ({
        id: asStr(i && i.id) || uid(),
        text: asStr(i && i.text).trim(),
        tags: asArr(i && i.tags).map((t) => asStr(t).trim()).filter(Boolean),
        adopted: asBool(i && i.adopted),
      })).filter((i) => i.text);
      break;
    case "task":
      r.title = asStr(r.title).trim() || "Untitled task";
      r.status = asStr(r.status).trim() || "Active";
      r.priority = asStr(r.priority).trim() || "low";
      r.due = asIso(r.due);
      r.plannedStart = asIso(r.plannedStart);
      r.projectId = r.projectId ? asStr(r.projectId) : null;
      r.milestoneId = r.milestoneId ? asStr(r.milestoneId) : null;
      // completedAt/started are timestamps, not dates
      if (r.completedAt != null) r.completedAt = asNum(r.completedAt, 0) || null;
      r.subtasks = asArr(r.subtasks).map((s) => ({ id: asStr(s && s.id) || uid(), title: asStr(s && s.title).trim() || "Subtask", done: asBool(s && s.done) }));
      // Task prerequisites live in `dependsOn` (the field the task editor,
      // dependency tools, Gantt and CSV export all read). Accept a stray
      // legacy `deps` alias too so a hand-edited payload isn't silently lost.
      r.dependsOn = asList(r.dependsOn !== undefined ? r.dependsOn : r.deps).map((d) => asStr(d)).filter(Boolean);
      delete r.deps;
      r.timeLog = asArr(r.timeLog).map((e) => ({ id: asStr(e && e.id) || uid(), start: asNum(e && e.start, 0), end: asNum(e && e.end, 0), note: asStr(e && e.note) })).filter((e) => e.start > 0);
      r.attachments = asArr(r.attachments).filter(isObj);
      r.recurrence = isObj(r.recurrence) && r.recurrence.freq ? { freq: asStr(r.recurrence.freq), interval: Math.max(1, Math.round(asNum(r.recurrence.interval, 1))), count: Math.max(1, Math.round(asNum(r.recurrence.count, 1))) } : null;
      break;
    case "event":
      r.title = asStr(r.title).trim() || "Untitled event";
      r.date = asIso(r.date);
      r.startTime = asStr(r.startTime);
      r.endTime = asStr(r.endTime);
      break;
    case "checklist":
      r.name = asStr(r.name).trim() || "Untitled checklist";
      r.items = asArr(r.items).map((i) => ({ id: asStr(i && i.id) || uid(), text: asStr(i && i.text).trim(), done: asBool(i && i.done) })).filter((i) => i.text);
      break;
    case "note":
      r.title = asStr(r.title).trim() || "Untitled note";
      r.body = asStr(r.body);
      r.pinned = asBool(r.pinned);
      r.projectId = r.projectId ? asStr(r.projectId) : null;
      r.attachments = asArr(r.attachments).filter(isObj);
      break;
    case "habit":
      r.name = asStr(r.name).trim() || "Untitled habit";
      r.icon = asStr(r.icon) || "zap";
      r.color = asStr(r.color) || "#8b5cf6";
      r.history = Object.fromEntries(Object.entries(isObj(r.history) ? r.history : {}).filter(([k, v]) => ISO_RE.test(k) && asBool(v)));
      r.target = Math.max(0, Math.round(asNum(r.target, 0)));
      r.showDashboard = asBool(r.showDashboard);
      break;
    case "board":
      r.name = asStr(r.name).trim() || "Untitled board";
      r.kind = asStr(r.kind).trim() || "mindmap";
      r.desc = asStr(r.desc);
      r.data = isObj(r.data) ? r.data : {};
      r.projectId = r.projectId ? asStr(r.projectId) : null;
      break;
    case "focuslog":
      r.started = asNum(r.started, 0) || Date.now();
      r.durationMin = Math.max(0, Math.round(asNum(r.durationMin, 0)));
      r.mode = asStr(r.mode) || "work";
      r.taskId = r.taskId ? asStr(r.taskId) : null;
      break;
    case "company":
    case "customer":
      r.name = asStr(r.name).trim() || (type === "company" ? "Linked company" : "Linked customer");
      r.sharedId = asStr(r.sharedId).trim();
      r.email = asStr(r.email).trim();
      r.domain = asStr(r.domain).trim();
      r.phone = asStr(r.phone).trim();
      r.notes = asStr(r.notes).trim();
      r.externalRef = asStr(r.externalRef).trim();
      break;
    default:
      break;
  }
  return r;
}

// ── referential integrity ────────────────────────────────────────
// Repair dangling cross-record references (the classic symptom of a payload
// assembled from more than one source, or of a task whose project was deleted).
// Mutates `byType` in place and returns the list of repairs made.
export function repairReferences(byType) {
  const repairs = [];
  const note = (type, id, field) => repairs.push({ type, id, field });
  const ids = (t) => new Set(byType[t].map((r) => r.id));
  const projIds = ids("project"), taskIds = ids("task"), companyIds = ids("company"), customerIds = ids("customer");

  const fix = (rec, field, set) => {
    if (rec[field] && !set.has(rec[field])) { note(rec.type, rec.id, field); rec[field] = null; }
  };

  for (const t of byType.task) {
    fix(t, "projectId", projIds);
    const proj = t.projectId ? byType.project.find((p) => p.id === t.projectId) : null;
    const msIds = new Set(asArr(proj && proj.milestones).map((m) => m.id));
    if (t.milestoneId && !msIds.has(t.milestoneId)) { note(t.type, t.id, "milestoneId"); t.milestoneId = null; }
    if (Array.isArray(t.dependsOn)) {
      const kept = t.dependsOn.filter((d) => taskIds.has(d));
      if (kept.length !== t.dependsOn.length) { note(t.type, t.id, "dependsOn"); t.dependsOn = kept; }
    }
  }
  for (const n of byType.note) fix(n, "projectId", projIds);
  for (const b of byType.board) fix(b, "projectId", projIds);
  for (const f of byType.focuslog) fix(f, "taskId", taskIds);
  for (const p of byType.project) {
    fix(p, "companyId", companyIds);
    fix(p, "customerId", customerIds);
    for (const m of asArr(p.milestones)) {
      const kept = m.taskIds.filter((tid) => taskIds.has(tid));
      if (kept.length !== m.taskIds.length) { note(p.type, p.id, "milestones.taskIds"); m.taskIds = kept; }
    }
  }
  return repairs;
}

// ── plan ─────────────────────────────────────────────────────────
// Pure: build a normalised, repaired pm-u payload + a report. Does not touch
// the store or any DOM.
export function planMigration(payload, opts = {}) {
  const meta = detectBackup(payload);
  if (!meta) throw new Error("This file isn't a Project Master backup (missing or unknown app marker).");
  if (meta.fromSchema > SCHEMA_VERSION) {
    throw new Error("This backup is from a newer app version (schema v" + meta.fromSchema + " > current v" + SCHEMA_VERSION + ").");
  }

  const warnings = [];
  const skipped = [];
  const seenSource = {};
  const byType = {};
  const sourceCounts = {};
  for (const type of ENTITY_TYPES) byType[type] = [];

  for (const type of Object.keys(payload.entities)) {
    const arr = payload.entities[type];
    if (!ENTITY_TYPES.includes(type)) {
      warnings.push("Ignored unknown entity type “" + type + "” (" + (Array.isArray(arr) ? arr.length : 0) + " record(s)).");
      continue;
    }
    if (!Array.isArray(arr)) { warnings.push("Ignored “" + type + "”: it isn't a list."); continue; }
    sourceCounts[type] = arr.length;
    for (const raw of arr) {
      if (!isObj(raw) || !asStr(raw.id).trim()) { skipped.push({ type, reason: "missing id" }); continue; }
      const id = asStr(raw.id).trim();
      // First occurrence wins — a repeated id is a corrupt payload, not an update.
      if (seenSource[type] && seenSource[type].has(id)) { skipped.push({ type, id, reason: "duplicate id" }); continue; }
      (seenSource[type] = seenSource[type] || new Set()).add(id);
      byType[type].push(normalizeRecord(type, raw));
    }
  }

  // Defensive dedupe in case a normaliser introduced a clash.
  for (const type of ENTITY_TYPES) {
    const map = new Map();
    for (const rec of byType[type]) map.set(rec.id, rec);
    byType[type] = [...map.values()];
  }

  const repairs = repairReferences(byType);
  const counts = {};
  let total = 0;
  for (const type of ENTITY_TYPES) {
    const n = byType[type].length;
    if (n) counts[type] = n;
    total += n;
  }

  // A v1 backup simply lacks the v2 entity collections; call that out.
  const addedTypes = ENTITY_TYPES.filter((t) => ["company", "customer"].includes(t) && !sourceCounts[t]);

  const report = {
    migrationVersion: MIGRATION_VERSION,
    source: meta.source,
    fromSchema: meta.fromSchema,
    toSchema: SCHEMA_VERSION,
    needsUpgrade: meta.needsUpgrade,
    isCurrent: meta.isCurrent,
    total,
    counts,
    addedTypes,
    settings: normalizeSettings(payload.settings),
    skipped,
    repairs,
    warnings,
    exportedAt: meta.exportedAt,
  };

  const out = {
    app: "pm-u",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    migratedAt: Date.now(),
    migratedFrom: { app: meta.source, schemaVersion: meta.fromSchema, migrationVersion: MIGRATION_VERSION },
    settings: report.settings,
    entities: byType,
  };

  const check = validateMigratedPayload(out);
  report.valid = check.ok;
  if (!check.ok) report.warnings = report.warnings.concat(check.errors.map((e) => "Internal: " + e));

  return { payload: out, report };
}

// ── validation ───────────────────────────────────────────────────
// Structural + referential checks on an already-normalised payload. `errors`
// block an apply; `warnings` are informational.
export function validateMigratedPayload(payload) {
  const errors = [];
  const warnings = [];
  if (!isObj(payload)) return { ok: false, errors: ["payload is not an object"], warnings };
  if (!BACKUP_APPS.includes(payload.app)) errors.push("missing or unknown app marker");
  if (!isObj(payload.entities)) errors.push("missing entities object");
  if (Number(payload.schemaVersion) > SCHEMA_VERSION) errors.push("schema version is newer than this app");

  const byType = {};
  for (const type of ENTITY_TYPES) byType[type] = [];
  for (const [type, arr] of Object.entries(isObj(payload.entities) ? payload.entities : {})) {
    if (!ENTITY_TYPES.includes(type)) { errors.push("unknown entity type “" + type + "”"); continue; }
    if (!Array.isArray(arr)) { errors.push("entities." + type + " must be a list"); continue; }
    const seen = new Set();
    for (const rec of arr) {
      if (!isObj(rec)) { errors.push(type + " contains a non-object record"); continue; }
      if (!asStr(rec.id).trim()) errors.push(type + " record is missing an id");
      else if (seen.has(rec.id)) errors.push("duplicate " + type + " id “" + rec.id + "”");
      else seen.add(rec.id);
      if (rec.type !== type) errors.push(type + " record “" + rec.id + "” has mismatched type “" + rec.type + "”");
      if (rec.refs !== undefined && !Array.isArray(rec.refs)) errors.push(type + " record “" + rec.id + "” has a non-list refs field");
      byType[type].push(rec);
    }
  }

  // Referential warnings (should be empty after planMigration's repair).
  const sets = {};
  for (const t of ENTITY_TYPES) sets[t] = new Set(byType[t].map((r) => r.id));
  const dangling = (type, list, field, set) => {
    for (const rec of byType[type]) if (rec[field] && !set.has(rec[field])) warnings.push(type + " “" + rec.id + "” → missing " + field + " “" + rec[field] + "”");
  };
  dangling("task", byType.task, "projectId", sets.project);
  dangling("note", byType.note, "projectId", sets.project);
  dangling("board", byType.board, "projectId", sets.project);
  dangling("focuslog", byType.focuslog, "taskId", sets.task);
  dangling("project", byType.project, "companyId", sets.company);
  dangling("project", byType.project, "customerId", sets.customer);

  return { ok: errors.length === 0, errors, warnings };
}

// ── apply ────────────────────────────────────────────────────────
// mode "merge"   — import records over the current data (same id ⇒ imported
//                  wins; everything else is left alone).
// mode "replace" — wipe the current records and load only the migrated set.
export function applyMigration(store, payload, { mode = "merge" } = {}) {
  const check = validateMigratedPayload(payload);
  if (!check.ok) throw new Error("Migration payload is invalid: " + check.errors[0]);
  if (mode === "replace") {
    const removed = store.records.size;
    const incoming = Object.values(payload.entities).reduce((n, a) => n + a.length, 0);
    store.restoreFromBackup(payload);
    return { mode, added: incoming, updated: 0, removed };
  }
  let added = 0, updated = 0;
  for (const type of ENTITY_TYPES) {
    for (const rec of asArr(payload.entities[type])) {
      const existed = store.records.has(store.key(type, rec.id));
      store.upsert(type, rec.id, rec);
      if (existed) updated++; else added++;
    }
  }
  if (isObj(payload.settings)) store.updateSettings(payload.settings);
  return { mode, added, updated, removed: 0 };
}

// ── report → markup ──────────────────────────────────────────────
export function migrationReportHTML(report) {
  if (!report) return "";
  const rows = Object.entries(report.counts).sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `<div class="mg-row"><span class="mg-type">${esc(type)}</span><span class="mg-count">${n}</span></div>`)
    .join("");
  const fromLine = report.isCurrent
    ? "This file is already a current PM-U backup (schema v" + report.toSchema + ")."
    : `Upgrading schema v${report.fromSchema} → v${report.toSchema} (${report.source}).`;
  const addedLine = report.addedTypes.length
    ? `<p class="muted small">New in version 2: ${report.addedTypes.map(esc).join(", ")} records are created empty and can be filled in later.</p>`
    : "";
  const repairLine = report.repairs.length
    ? `<p class="muted small"><b>${report.repairs.length}</b> dangling reference${report.repairs.length === 1 ? "" : "s"} repaired (e.g. a task whose project no longer exists).</p>`
    : "";
  const skippedLine = report.skipped.length
    ? `<p class="muted small"><b>${report.skipped.length}</b> record${report.skipped.length === 1 ? "" : "s"} skipped (missing or duplicate id).</p>`
    : "";
  const warnList = report.warnings.length
    ? `<ul class="mg-warn">${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  return `
    <p class="muted small">${esc(fromLine)}</p>
    <div class="mg-grid">${rows || `<div class="mg-row"><span class="mg-type">no records</span><span class="mg-count">0</span></div>`}</div>
    <p class="muted small"><b>${report.total}</b> record${report.total === 1 ? "" : "s"} ready to migrate.</p>
    ${addedLine}${repairLine}${skippedLine}${warnList}`;
}

// ── UI ───────────────────────────────────────────────────────────
// Pick a backup file, plan the migration, preview it, and apply (merge or
// replace). `render` re-renders the current view after a successful apply.
export function pickAndMigrate(store, render) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch { toast("That file isn't valid JSON", "error"); return; }
    let plan;
    try { plan = planMigration(payload); }
    catch (e) { toast("Can't migrate: " + e.message, "error", 5000); return; }
    openMigrationModal(store, plan, file.name, render);
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 2000);
}

export function openMigrationModal(store, plan, filename, render) {
  const { report } = plan;
  const existing = store.records.size;
  const { el, close } = openModal(`
    <div class="modal-card fmt-modal mg-modal" role="dialog" aria-modal="true" aria-label="Migrate from Project Master" style="max-width:560px;">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>${ICONS.upload || ""} Migrate from Project Master</h3>
      <p class="modal-sub">“${esc(filename)}”</p>
      <div class="mg-report">${migrationReportHTML(report)}</div>
      ${existing ? `
      <div class="mg-mode">
        <label class="mg-opt"><input type="radio" name="mgMode" value="merge" checked>
          <span><b>Merge</b><br><span class="muted small">Add these records to your ${existing} existing record${existing === 1 ? "" : "s"}. Same-id records are overwritten.</span></span></label>
        <label class="mg-opt"><input type="radio" name="mgMode" value="replace">
          <span><b>Replace everything</b><br><span class="muted small">Delete your ${existing} existing record${existing === 1 ? "" : "s"} and load only this backup.</span></span></label>
      </div>` : ""}
      <div class="modal-btns">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn ${report.total && existing ? "" : "btn-primary"}" id="mgApply" ${report.total ? "" : "disabled"}>${ICONS.upload || ""} ${report.total ? "Migrate " + report.total + " record" + (report.total === 1 ? "" : "s") : "Nothing to migrate"}</button>
      </div>
    </div>`);
  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#mgApply")?.addEventListener("click", () => {
    const mode = (el.querySelector('input[name="mgMode"]:checked') || { value: "merge" }).value;
    if (!report.valid) { toast("This migration has unresolved errors — nothing was changed", "error", 5000); return; }
    let res;
    try { res = applyMigration(store, plan.payload, { mode }); }
    catch (e) { toast("Migration failed: " + e.message, "error", 5000); return; }
    const verb = res.mode === "replace" ? "Replaced with" : "Merged";
    toast(`${verb} ${res.added + res.updated} record${res.added + res.updated === 1 ? "" : "s"}${res.updated ? " (" + res.updated + " updated)" : ""}`, "success", 4500);
    close();
    if (typeof render === "function") render();
  });
}
