// src/backup.js — Recurring backup with versioning (Phase 11, task 88).
//
// Every auto-save also keeps an occasional full-workspace snapshot in a
// separate kv folder (pm_backups), keeping only the most recent N. Any
// snapshot can be restored. Snapshot data is a normal exportAll() payload,
// so restore goes through the store's validated restoreFromBackup.

import { $, esc, toast, confirmDialog } from "./ui.js";
import { ICONS } from "./icons.js";

const MAX_SNAPSHOTS = 30;
const MIN_INTERVAL_MS = 5 * 60 * 1000; // at most one auto-snapshot per 5 minutes

export async function backupFolder(store) {
  if (!store || !store.kv) return null;
  const name = store.folder && store.folder !== "pm" ? "pm_backups__" + store.folder : "pm_backups";
  return store.kv[name];
}

export function snapshotKey(ms = Date.now()) {
  return "snap-" + new Date(ms).toISOString().replace(/[:.]/g, "-");
}

// [{key, ms, count, size}] newest first. count = records in the snapshot.
export async function listSnapshots(store) {
  const k = await backupFolder(store);
  if (!k) return [];
  const entries = (await k.entries()) || [];
  const out = [];
  for (const [key, val] of entries) {
    if (!String(key).startsWith("snap-")) continue;
    const payload = typeof val === "string" ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
    const count = payload && payload.entities
      ? Object.values(payload.entities).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
    const ms = payload && payload.exportedAt ? payload.exportedAt : 0;
    out.push({ key, ms, count, size: (typeof val === "string" ? val : JSON.stringify(val)).length });
  }
  return out.sort((a, b) => b.ms - a.ms);
}

// Snapshot the store now; prunes to MAX_SNAPSHOTS. Returns {key, count} or null.
export async function takeSnapshot(store) {
  const k = await backupFolder(store);
  if (!k) return null;
  const payload = store.exportAll();
  const key = snapshotKey();
  await k.set(key, payload);
  const snaps = await listSnapshots(store);
  for (const s of snaps.slice(MAX_SNAPSHOTS)) await k.delete(s.key);
  const count = Object.values(payload.entities || {}).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0);
  return { key, count };
}

export async function restoreSnapshot(store, key) {
  const k = await backupFolder(store);
  if (!k) return false;
  const val = await k.get(key);
  if (!val) return false;
  store.restoreFromBackup(typeof val === "string" ? JSON.parse(val) : val);
  return true;
}

export async function deleteSnapshot(store, key) {
  const k = await backupFolder(store);
  if (!k) return false;
  await k.delete(key);
  return true;
}

// Auto-snapshot hook — call on every "saved" store event. Persists the last
// snapshot time in localStorage so the throttle survives reloads.
export function maybeAutoSnapshot(store) {
  const lsKey = "pm_last_snapshot_" + (store.folder || "pm");
  const last = Number(localStorage.getItem(lsKey)) || 0;
  const now = Date.now();
  if (now - last < MIN_INTERVAL_MS) return;
  localStorage.setItem(lsKey, String(now));
  takeSnapshot(store).then((s) => {
    if (s) console.log("[pm] auto-snapshot saved:", s.key, "(" + s.count + " records)");
  }).catch((e) => console.error("[pm] auto-snapshot failed", e));
}

// ── settings-view history list ───────────────────────────────────
export function backupHistoryHTML(snaps) {
  if (!snaps.length) return `<div class="at-empty">No snapshots yet — they're taken automatically as you work (a fresh one at most every 5 minutes), or click “Snapshot now”.</div>`;
  return snaps.slice(0, 12).map((s) => `
    <div class="bh-row" data-bh="${esc(s.key)}">
      <span class="bh-time">${new Date(s.ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      <span class="bh-count">${s.count} records</span>
      <button class="btn ghost" data-bh-restore="${esc(s.key)}">Restore</button>
      <button class="mini-btn danger" data-bh-del="${esc(s.key)}" title="Delete snapshot">${ICONS.trash}</button>
    </div>`).join("");
}

export function wireBackupHistory(ctn, store, render) {
  ctn.querySelectorAll("[data-bh-restore]").forEach((b) => b.addEventListener("click", async () => {
    const key = b.dataset.bhRestore;
    const sure = await confirmDialog({
      title: "Restore this snapshot?",
      message: "This will REPLACE all current records with the snapshot from the selected time. Consider taking a fresh snapshot first.",
      confirmText: "Restore snapshot", danger: true,
    });
    if (!sure) return;
    try {
      await restoreSnapshot(store, key);
      toast("Snapshot restored", "success");
      if (render) render();
    } catch (e) { toast("Restore failed: " + e.message, "error"); }
  }));
  ctn.querySelectorAll("[data-bh-del]").forEach((b) => b.addEventListener("click", async () => {
    await deleteSnapshot(store, b.dataset.bhDel);
    if (render) render();
  }));
}

