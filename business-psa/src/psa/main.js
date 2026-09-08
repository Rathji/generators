import { MODULES, icon, startRouter } from "./core.js";
import store, { refresh, getIndexInfo, onChange } from "./store.js";
import { registerAllCollections } from "./collections.js";
import { loadSettings } from "./settings.js";
import { runChecksAndCache } from "./integrity.js";
import hub from "./hub.js";
import "./modules/dashboard.js";
import "./modules/clients.js";
import "./modules/projects.js";
import "./modules/resources.js";
import "./modules/timesheets.js";
import "./modules/expenses.js";
import "./modules/billing.js";
import "./modules/reports.js";
import "./modules/settings.js";

const cfg = (window.root && window.root.psa) ? window.root.psa : {};
const firmName = (cfg.firmName || "PSA Workspace");
const firmShort = String(firmName).trim().charAt(0).toUpperCase() || "P";

document.getElementById("psaBrandName").textContent = firmName;
document.getElementById("psaBrandMark").textContent = firmShort;
document.getElementById("psaTopbarTitle").textContent = firmName;
document.title = firmName + " · PSA";

const navList = document.getElementById("psaNav");
const view = document.getElementById("psaView");

for (const m of MODULES) {
  const item = document.createElement("a");
  item.className = "psa-nav-item";
  item.dataset.module = m.id;
  item.href = "#/" + m.id;
  item.innerHTML = icon(m.icon) + "<span>" + m.label + "</span>";
  item.setAttribute("aria-label", m.label);
  navList.appendChild(item);
}

function setActiveNav(mod) {
  for (const n of navList.querySelectorAll(".psa-nav-item")) {
    n.classList.toggle("active", n.dataset.module === mod.id);
  }
}

function closeDrawer() {
  document.body.classList.remove("psa-drawer-open");
}

document.getElementById("psaMenuBtn").addEventListener("click", () => document.body.classList.add("psa-drawer-open"));
document.getElementById("psaBackdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
navList.addEventListener("click", closeDrawer);

const dispatch = startRouter({ view, onNavigate: setActiveNav });

async function bootStore() {
  await store.ready();
  registerAllCollections();
  await loadSettings();
  const info = getIndexInfo();
  const chip = document.getElementById("psaStatusChip");
  const foot = document.getElementById("psaStorageMode");
  const cloud = info.mode === "cloud";
  if (chip) {
    chip.innerHTML = '<span class="status-dot"></span>' + (cloud ? "Cloud storage" : "Local-only storage");
    chip.classList.toggle("psa-chip-cloud", cloud);
  }
  if (foot) foot.textContent = cloud ? "Cloud storage · synced" : "Local-only storage";
  onChange(() => { runChecksAndCache().catch(() => {}); });
  onChange((e) => { hub.publishChange(e.colId, e.id, e.op); });
  hub.init();
  runChecksAndCache().catch(() => {});
  refresh().catch(() => {});
}

window.runPsaTests = () => import("./tests.js").then((m) => m.runPsaTests());
window.runPsaStoreTests = () => import("./tests-store.js").then((m) => m.runPsaStoreTests());
window.runPsaFeatureTests = () => import("./tests-features.js").then((m) => m.runFeatureTests());
window.runPsaHubTests = () => import("./tests-hub.js").then((m) => m.runHubTests());
window.__psaRouter = { dispatch };
window.__psa = { MODULES, firmName };
window.__psaStore = store;

dispatch();
bootStore();
