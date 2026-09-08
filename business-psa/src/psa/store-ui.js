// src/psa/store-ui.js — small storage status UI shared by module views.
import { ready, getDocInfo, getIndexInfo } from "./store.js";
import { el, h } from "./core.js";

export async function collectionStatusEl(colId) {
  await ready();
  const info = getDocInfo(colId);
  const idx = getIndexInfo();
  const n = info.recordCount;
  const wrap = el("div", "psa-store-line");
  wrap.innerHTML =
    '<span class="psa-store-line-dot"></span>' +
    h(
      (idx.mode === "cloud" ? "Cloud storage" : "Local storage") +
      " · " + n + " record" + (n === 1 ? "" : "s") +
      " · " + (info.shards.length === 1 ? "1 document" : info.shards.length + " documents") +
      (idx.mode === "cloud" ? " · synced across devices" : " · save the generator to enable cross-device sync")
    );
  return wrap;
}

export async function storageOverviewEl() {
  await ready();
  const idx = getIndexInfo();
  const card = el("div", "dash-card dash-card-wide");
  const rows = idx.mode === "cloud" ? "synced across devices" : "local-only (save the generator to sync)";
  let html =
    '<div class="dash-card-head">' +
    '<span class="dash-card-icon">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>' +
    "</span>" +
    '<span class="dash-card-label">Document store</span>' +
    '<span class="psa-store-chip">' + (idx.mode === "cloud" ? "Cloud" : "Local") + "</span>" +
    "</div>";
  const labels = { clients: "Clients", projects: "Projects", resources: "Resources", timesheets: "Timesheets", expenses: "Expenses", billing: "Billing" };
  let totalRecords = 0;
  let totalBytes = 0;
  let totalShards = 0;
  for (const colId of Object.keys(labels)) {
    const info = getDocInfo(colId);
    totalRecords += info.recordCount;
    totalBytes += info.totalBytes;
    totalShards += info.shards.length;
    html +=
      '<div class="psa-store-row">' +
      "<span>" + h(labels[colId]) + "</span>" +
      "<span>" + info.recordCount + " · " + (info.shards.length === 1 ? "1 doc" : info.shards.length + " docs") + "</span>" +
      "</div>";
  }
  html +=
    '<div class="psa-store-row psa-store-row-total">' +
    "<span>Totals</span><span>" + totalRecords + " records · " + totalShards + " documents · " + (totalBytes / 1024).toFixed(1) + " KB</span>" +
    "</div>";
  html += '<div class="psa-store-foot">' + h(rows) + " · versioned (rev-tracked) · idempotent writes · auto-split past " + (getIndexInfo() && "the per-document ceiling") + "</div>";
  card.innerHTML = html;
  return card;
}
