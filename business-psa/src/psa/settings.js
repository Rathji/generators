// src/psa/settings.js — app settings (over-allocation tolerance, target
// utilization, currency) stored in kv, exposed on window.__psaSettings.
// These feed the derivation layer so capacity checks and utilization are
// configurable, not hard-coded.

const KEY = "psa/appsettings";

export async function loadSettings() {
  let s = null;
  try { s = await window.root.kv.psaStore.get(KEY); } catch (e) {}
  const cur = (window.root && window.root.psa && window.root.psa.defaultCurrency) || "USD";
  const base = {
    overAllocTolerance: 0,
    targetUtilization: 0.8,
    weekHours: 40,
    currency: cur,
  };
  const merged = Object.assign({}, base, s || {});
  window.__psaSettings = merged;
  return merged;
}

export async function saveSettings(patch) {
  const cur = (await loadSettings());
  const next = Object.assign({}, cur, patch);
  await window.root.kv.psaStore.set(KEY, next);
  window.__psaSettings = next;
  return next;
}
