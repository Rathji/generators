// src/psa/modules/dashboard.js — live KPIs from the master core: utilization,
// project health, budget burn, unbilled, open SOWs and upcoming milestone
// invoices, each clickable through to its source. Also surfaces the system
// health indicator and any pending sync conflicts.

import { registerModule, MODULES, icon, h, el, pageHeader, moduleShell, moneyFmt, pctFmt, numFmt, dateShort } from "../core.js";
import { storageOverviewEl } from "../store-ui.js";
import store from "../store.js";
import { snapshot, dashboardKpis } from "../derive.js";

function healthBadges(k) {
  const map = { "on-track": ["badge-ok", "On track"], "at-risk": ["badge-warn", "At risk"], "over-budget": ["badge-err", "Over budget"], closed: ["badge-muted", "Closed"] };
  return Object.keys(map).map((key) => {
    const n = k[key] || 0;
    if (!n) return "";
    return '<span class="badge ' + map[key][0] + '">' + map[key][1] + " · " + n + "</span>";
  }).join(" ");
}

function kpiCard(label, value, sub, href, tone) {
  const a = document.createElement("a");
  a.className = "kpi-card" + (tone ? " kpi-" + tone : "");
  a.href = href;
  a.innerHTML = '<span class="kpi-label">' + h(label) + '</span><span class="kpi-value">' + value + "</span>" + (sub ? '<span class="kpi-sub">' + h(sub) + "</span>" : "");
  return a;
}

function kpisHtml(k) {
  const html = [];
  html.push(kpiCard("Billable utilization · this week", k.utilization == null ? "—" : pctFmt(k.utilization), (k.billableHours ? numFmt(k.billableHours) + "h of " + numFmt(k.targetHours) + "h target" : "log billable time to see utilization"), "#/resources/capacity", k.utilization != null && k.utilization >= 0.8 ? "ok" : k.utilization != null && k.utilization >= 0.6 ? "warn" : ""));
  html.push(kpiCard("Project health", "<span class='kpi-inline'>" + healthBadges(k.healthCounts) + "</span>", k.activeCount + " active of " + k.projectCount + " project(s)", "#/projects", k.healthCounts["over-budget"] > 0 ? "err" : k.healthCounts["at-risk"] > 0 ? "warn" : "ok"));
  html.push(kpiCard("Budget burn · active projects", k.budgetTotal > 0 ? pctFmt(k.burn) : "—", k.budgetTotal > 0 ? moneyFmt(k.costTotal) + " of " + moneyFmt(k.budgetTotal) + " spent" : "set project budgets to track burn", "#/projects", k.burn != null && k.burn >= 1.05 ? "err" : k.burn != null && k.burn >= 0.85 ? "warn" : "ok"));
  html.push(kpiCard("Unbilled work", numFmt(k.unbilledHours) + "h", moneyFmt(k.unbilledValue), "#/billing/unbilled", k.unbilledValue > 0 ? "warn" : "ok"));
  html.push(kpiCard("Open statements of work", k.openSowCount, k.openSowCount ? "awaiting approval" : "none in flight", "#/clients/sows", k.openSowCount ? "warn" : "ok"));
  html.push(kpiCard("Upcoming milestone invoices", k.upcomingInvoices.length, k.upcomingInvoices.length ? k.upcomingInvoices.slice(0, 3).map((x) => x.milestone.title + " · " + dateShort(x.milestone.dueDate) + " · " + moneyFmt(x.milestone.value)).join(" · ") : "none in the next 30 days", "#/billing"));
  return html.map((n) => n.outerHTML).join("");
}

registerModule({
  id: "dashboard",
  label: "Dashboard",
  icon: "dashboard",
  async render({ view }) {
    const sec = moduleShell("dashboard");
    sec.appendChild(pageHeader("Dashboard", "Your practice at a glance — utilization, project health, budget burn, unbilled work and the pipeline. Every number is derived live from your records.", []));

    const k = dashboardKpis(snapshot());
    const kpiWrap = el("div", "kpi-grid");
    kpiWrap.innerHTML = kpisHtml(k);
    sec.appendChild(kpiWrap);

    const alerts = el("div", "dash-alerts");
    const hh = window.__psaHealth && window.__psaHealth.summary;
    if (hh) {
      const a = el("a", "dash-alert" + (hh.errors ? " dash-alert-err" : hh.warnings ? " dash-alert-warn" : " dash-alert-ok"));
      a.href = "#/settings/integrity";
      a.innerHTML = '<span class="dash-alert-ic">' + icon(hh.errors ? "alert" : "check", 18) + "</span><span>" +
        (hh.errors ? hh.errors + " data-integrity error(s) need attention" : hh.warnings ? hh.warnings + " data-integrity warning(s)" : "Data integrity all-clear — checks re-run after every write") +
        "</span><span class='dash-alert-go'>" + icon("arrow", 15) + "</span>";
      alerts.appendChild(a);
    }
    const conflicts = store.pendingConflicts();
    if (conflicts.length) {
      const a = el("a", "dash-alert dash-alert-warn");
      a.href = "#/settings";
      a.innerHTML = '<span class="dash-alert-ic">' + icon("alert", 18) + "</span><span>" + conflicts.length + " sync conflict" + (conflicts.length === 1 ? "" : "s") + " waiting to be resolved — nothing is overwritten until you choose</span><span class='dash-alert-go'>" + icon("arrow", 15) + "</span>";
      alerts.appendChild(a);
    }
    if (alerts.children.length) sec.appendChild(alerts);

    const welcome = el("div", "dash-welcome");
    welcome.innerHTML =
      '<span class="dash-welcome-icon">' + icon("box", 22) + "</span>" +
      "<div><h2>Welcome to your PSA workspace</h2>" +
      "<p>One place for clients, statements of work, projects, resources, time, expenses and billing — all sharing a single source of truth. Click any KPI above to drill into its module.</p></div>";
    sec.appendChild(welcome);

    const cards = el("div", "dash-cards");
    for (const m of MODULES) {
      if (m.id === "dashboard") continue;
      const card = document.createElement("a");
      card.className = "dash-card";
      card.href = "#/" + m.id;
      card.innerHTML =
        '<span class="dash-card-icon">' + icon(m.icon, 20) + "</span>" +
        '<span class="dash-card-label">' + h(m.label) + "</span>" +
        '<span class="dash-card-go">' + icon("arrow", 16) + "</span>";
      cards.appendChild(card);
    }
    sec.appendChild(cards);

    const storageCard = await storageOverviewEl();
    sec.appendChild(storageCard);

    view.innerHTML = "";
    view.appendChild(sec);
  }
});
