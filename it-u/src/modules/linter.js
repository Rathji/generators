// src/modules/linter.js — the Linter station (completeness & quality auditing;
// roadmap tasks 46–48).
//
// The Linter runs the pure audit in framework/linter.js over every client's
// documentation set and reports each finding with the record it concerns: a
// configuration missing a required field, an asset linked to nothing, a
// document that repeats structured data in prose, a known service with no
// coverage, an item that is expired or expiring, or a record gone stale.
//
// The audit is grouped by check and by severity, filterable by client and by
// check. Each row carries the suggested fix as text and a one-click Fix button
// that applies it (fill the missing field, create the proposed link, extract
// prose into a document, or convert a note into a structured asset) and re-runs
// the audit. The whole audit can be saved to the browser and exported as a
// Markdown or CSV report, grouped by severity.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, promptPanel, confirmDialog, openModal, downloadCsv, downloadText, relTime } from "./shared.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";
import { assetTypeIndex } from "../framework/flexible.js";
import { LINT_CHECKS, lintAllSets, severityDef } from "../framework/linter.js";
import { fixPlan, applyLintFix } from "../framework/linterFixes.js";
import { buildLintReport, reportToMarkdown, reportToCsv, reportFilename, reportSummaryLine } from "../framework/linterReport.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const SAVED_REPORTS_KEY = "itu:linter-reports";
const SAVED_REPORTS_MAX = 10;

const DESC =
  "Audit every client's documentation for missing required fields, assets with no relationships, structured data buried in prose, uncovered services, expired items and stale records — each finding naming the record it concerns.";

const SEVERITY_TONE = { error: "danger", warning: "warn", info: "info" };
const typeIcon = (t) => icons[(RECORD_TYPE_META[t] || {}).icon] || icons.box;
const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).singular || t;

export default {
  id: "linter",
  label: "Linter",
  desc: DESC,
  icon: icons.clipboard,
  render(ctx) {
    renderLinter(ctx);
  },
};

function renderLinter(ctx) {
  const state = { sets: [], typeIndex: new Map(), result: null, clientId: "", check: "" };

  const summaryEl = h("div", { class: "kb-lint-summary", id: "kbLintSummary" });
  const checksEl = h("div", { class: "kb-lint-checks", id: "kbLintChecks" });
  const findingsEl = h("div", { class: "kb-lint-body", id: "kbLintBody" }, loadingState({ label: "Auditing the documentation…" }));

  const clientSel = h("select", { class: "kb-input kb-input-sm kb-lint-client", "aria-label": "Client" });
  clientSel.append(h("option", { value: "" }, "All clients"));
  clientSel.addEventListener("change", () => {
    state.clientId = clientSel.value;
    renderAll();
  });

  const rerunBtn = h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbLintRerun" }, "Re-run audit");
  rerunBtn.addEventListener("click", () => load());

  const reportBtn = h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbLintReport" }, "Report");
  reportBtn.addEventListener("click", () => openReport());

  const savedLine = h("span", { class: "kb-lint-saved", id: "kbLintSaved" });

  const toolbar = h(
    "div",
    { class: "kb-lint-toolbar" },
    h("label", { class: "kb-lint-client-wrap" }, h("span", { class: "kb-search-filter-label" }, "Client"), clientSel),
    savedLine,
    h("div", { class: "kb-lint-toolbar-actions" }, rerunBtn, reportBtn),
  );
  const body = h("div", { class: "kb-lint" }, toolbar, summaryEl, checksEl, findingsEl);
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Linter", desc: DESC, actions: null, body }));

  renderSavedLine();
  load();

  async function load() {
    clear(findingsEl);
    findingsEl.append(loadingState({ label: "Auditing the documentation…" }));
    try {
      const summaries = await ctx.docs.summaries({ includeArchived: false });
      const sets = [];
      for (const s of summaries) {
        let set = await ctx.docs.get(s.id).catch(() => null);
        if (!set) {
          // A cold store read can fail transiently; give it one more chance.
          await new Promise((r) => setTimeout(r, 180));
          set = await ctx.docs.get(s.id).catch(() => null);
        }
        if (set) sets.push(set);
      }
      const types = await ctx.assetTypes.list().catch(() => []);
      state.typeIndex = assetTypeIndex(types);
      state.sets = sets;
      state.result = lintAllSets(sets, { typeOf: (r) => state.typeIndex.get(r.assetTypeId) || null });
      clientSel.replaceChildren(h("option", { value: "" }, "All clients"));
      for (const s of sets) clientSel.append(h("option", { value: s.id }, s.name || s.id));
      clientSel.value = state.clientId;
      renderAll();
    } catch (e) {
      clear(findingsEl);
      findingsEl.append(errorState({ title: "Couldn’t run the audit", description: String((e && e.message) || e), onRetry: () => load() }));
    }
  }

  const setByName = (setId) => state.sets.find((s) => s.id === setId) || null;

  // ---- saved reports --------------------------------------------------------
  function readSavedReports() {
    try {
      const raw = localStorage.getItem(SAVED_REPORTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function renderSavedLine() {
    clear(savedLine);
    const saved = readSavedReports();
    if (!saved.length) return;
    savedLine.append(h("span", { class: "kb-muted" }, "Last report saved " + relTime(saved[0].at)));
  }

  function saveReport(report, markdown, savedEl) {
    try {
      const saved = readSavedReports();
      saved.unshift({ at: report.generatedAt || Date.now(), title: report.title, totals: report.totals, markdown });
      localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(saved.slice(0, SAVED_REPORTS_MAX)));
      savedEl.textContent = "Saved ✓";
      renderSavedLine();
    } catch {
      savedEl.textContent = "Couldn’t save";
    }
  }

  function openReport() {
    if (!state.result) return;
    const report = buildLintReport(state.result, { sets: state.sets, generatedAt: Date.now() });
    const md = reportToMarkdown(report);
    const m = openModal({
      title: "Linter report",
      description: reportSummaryLine(report),
      children: [h("pre", { class: "kb-lint-report-pre" }, md)],
      wide: true,
    });
    const savedEl = h("span", { class: "kb-lint-saved" });
    m.actions.append(
      savedEl,
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => downloadText(reportFilename(report, "md"), md, "text/markdown;charset=utf-8") }, "Download Markdown"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => downloadCsv(reportFilename(report, "csv"), reportToCsv(report)) }, "Download CSV"),
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => saveReport(report, md, savedEl) }, "Save report"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => m.close() }, "Close"),
    );
  }

  // ---- one-click fixes ------------------------------------------------------
  async function applyFix(f, plan, opts = {}) {
    const res = await applyLintFix(
      { docs: ctx.docs, setId: f.setId, actor: whoami(ctx), typeOf: (r) => state.typeIndex.get(r.assetTypeId) || null },
      f,
      opts,
    );
    if (res.ok) {
      ctx.toast(res.detail || "Fix applied", "success");
      load();
      return;
    }
    if (res.needs && res.needs.includes("value")) {
      const value = await promptPanel({ title: plan.label || "Provide a value", placeholder: "Enter the value to set…", confirmLabel: "Apply fix" });
      if (value == null) return;
      if (!value.trim()) {
        ctx.toast("A value is required.", "warning");
        return;
      }
      await applyFix(f, plan, { ...opts, value });
      return;
    }
    if (res.needs && res.needs.includes("target")) {
      const target = await pickTarget(f, res.targetType || plan.targetType, plan.label);
      if (!target) return;
      await applyFix(f, plan, { ...opts, target });
      return;
    }
    ctx.toast(res.error || "Couldn’t apply the fix", "error", 5200);
  }

  function pickTarget(f, targetType, title) {
    const set = setByName(f.setId);
    return new Promise((resolve) => {
      const sel = h("select", { class: "kb-input", "aria-label": "Target record" });
      sel.append(h("option", { value: "" }, "Choose a record…"));
      if (set) {
        const types = targetType ? [targetType] : Object.keys(set.records || {});
        for (const t of types) {
          const rows = (set.records[t] || []).filter((r) => !(f.ref && r.id === f.ref.id));
          if (!rows.length) continue;
          const group = h("optgroup", { label: typeLabel(t) });
          for (const r of rows) group.append(h("option", { value: t + "::" + r.id }, r.name || r.id));
          sel.append(group);
        }
      }
      let settled = false;
      let m = null;
      const done = (v) => {
        if (settled) return;
        settled = true;
        if (m) m.close();
        resolve(v);
      };
      m = openModal({
        title: title || "Link to a record",
        description: "Choose the record this finding should link to.",
        children: [sel],
      });
      m.actions.append(
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => done(null) }, "Cancel"),
        h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => {
          if (!sel.value) {
            m.showError("Choose a record first.");
            return;
          }
          const [type, id] = sel.value.split("::");
          done({ type, id });
        } }, "Link"),
      );
    });
  }

  function fixButton(f, plan) {
    const label = plan.label || "Fix";
    const btn = h("button", { class: "kb-btn kb-btn-sm " + (plan.auto ? "kb-btn-primary" : "kb-btn-ghost"), type: "button" }, label);
    btn.addEventListener("click", async () => {
      if (plan.destructive) {
        const ok = await confirmDialog({ title: "Apply this fix?", message: "This replaces the existing record with a structured asset. Continue?", confirmLabel: "Apply fix", danger: true });
        if (!ok) return;
      }
      btn.disabled = true;
      btn.textContent = "Applying…";
      try {
        await applyFix(f, plan);
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = label;
        }
      }
    });
    return btn;
  }

  function visibleFindings() {
    if (!state.result) return [];
    let list = state.result.findings;
    if (state.clientId) list = list.filter((f) => f.setId === state.clientId);
    if (state.check) list = list.filter((f) => f.check === state.check);
    return list;
  }

  function renderAll() {
    renderSummary();
    renderChecks();
    renderFindings();
  }

  function scopedCounts() {
    const base = { error: 0, warning: 0, info: 0, total: 0 };
    if (!state.result) return base;
    const list = state.clientId ? state.result.findings.filter((f) => f.setId === state.clientId) : state.result.findings;
    for (const f of list) {
      base[f.severity] += 1;
      base.total += 1;
    }
    return base;
  }

  function renderSummary() {
    clear(summaryEl);
    const c = scopedCounts();
    const card = (tone, key, label) =>
      h(
        "div",
        { class: "kb-lint-sum kb-lint-sum--" + tone },
        h("span", { class: "kb-lint-sum-n" }, String(c[key] || 0)),
        h("span", { class: "kb-lint-sum-label" }, label),
      );
    summaryEl.append(card("danger", "error", c.error === 1 ? "Error" : "Errors"), card("warn", "warning", c.warning === 1 ? "Warning" : "Warnings"), card("info", "info", c.info === 1 ? "Notice" : "Notices"), card("muted", "total", "Findings"));
    summaryEl.append(
      h(
        "div",
        { class: "kb-lint-sum-state" + (c.total ? "" : " kb-lint-sum-state--clean") },
        c.total ? h("span", null, c.total === 1 ? "1 finding needs attention" : c.total + " findings need attention") : h("span", null, "No findings — the documentation is clean"),
      ),
    );
  }

  // Check filter chips: always show every check, with the count in scope.
  function renderChecks() {
    clear(checksEl);
    if (!state.result) return;
    const inScope = state.clientId ? state.result.findings.filter((f) => f.setId === state.clientId) : state.result.findings;
    const counts = {};
    for (const f of inScope) counts[f.check] = (counts[f.check] || 0) + 1;
    const chip = (id, label, count, iconHtml) =>
      h(
        "button",
        { class: "kb-lint-check" + (state.check === id ? " kb-lint-check--active" : ""), type: "button", dataset: { check: id }, onClick: () => { state.check = id; renderChecks(); renderFindings(); } },
        iconHtml ? h("span", { class: "kb-lint-check-icon", html: iconHtml }) : null,
        h("span", { class: "kb-lint-check-label" }, label),
        h("span", { class: "kb-count-pill" }, String(count || 0)),
      );
    checksEl.append(chip("", "All checks", inScope.length, icons.clipboard));
    for (const c of LINT_CHECKS) checksEl.append(chip(c.id, c.label, counts[c.id] || 0, icons[c.icon]));
  }

  function renderFindings() {
    clear(findingsEl);
    if (!state.result) return;
    if (!state.sets.length) {
      findingsEl.append(
        emptyState({
          icon: icons.clipboard,
          title: "No documentation to audit",
          description: "Create a client documentation set in Organizations, then the Linter audits its completeness and quality.",
          action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => ctx.navigate("organizations") }, "Go to Organizations"),
        }),
      );
      return;
    }
    const list = visibleFindings();
    if (!list.length) {
      findingsEl.append(
        emptyState({
          icon: icons.check,
          title: state.check ? "No findings for this check" : "Nothing to report",
          description: state.check
            ? "Every record passes this check. Clear the filter to see the other checks."
            : state.clientId
              ? "This client's documentation passes every check. Keep it that way."
              : "Every client's documentation passes every check. Keep it that way.",
          action: state.check ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => { state.check = ""; renderChecks(); renderFindings(); } }, "Show all checks") : null,
        }),
      );
      return;
    }

    // Group by check, in catalog order, then render each group.
    const byCheck = new Map();
    for (const f of list) {
      if (!byCheck.has(f.check)) byCheck.set(f.check, []);
      byCheck.get(f.check).push(f);
    }
    const CHECK_ORDER = LINT_CHECKS.map((c) => c.id);
    const groups = [...byCheck.entries()].sort((a, b) => CHECK_ORDER.indexOf(a[0]) - CHECK_ORDER.indexOf(b[0]));
    for (const [checkId, findings] of groups) {
      const def = LINT_CHECKS.find((c) => c.id === checkId) || { label: checkId, description: "", icon: "clipboard" };
      const section = h(
        "section",
        { class: "kb-card kb-lint-section" },
        h(
          "div",
          { class: "kb-section-head" },
          h("span", { class: "kb-section-icon", html: icons[def.icon] }),
          h("h2", { class: "kb-section-name" }, def.label),
          h("span", { class: "kb-count-pill" }, String(findings.length)),
        ),
        def.description ? h("p", { class: "kb-lint-section-desc" }, def.description) : null,
      );
      const rows = h("div", { class: "kb-lint-findings" });
      const shown = findings.slice(0, 200);
      for (const f of shown) rows.append(findingRow(f));
      section.append(rows);
      if (findings.length > shown.length) section.append(h("p", { class: "kb-muted kb-lint-more" }, "Showing the first " + shown.length + " of " + findings.length + " findings — narrow by client to see more."));
      findingsEl.append(section);
    }
  }

  function findingRow(f) {
    const set = setByName(f.setId);
    const sev = severityDef(f.severity) || { label: f.severity, tone: "muted" };
    const recordName = f.recordName || (f.ref && f.ref.name) || "—";
    const plan = fixPlan(f);
    return h(
      "div",
      { class: "kb-lint-finding kb-lint-finding--" + f.severity },
      h("span", { class: "kb-badge kb-lifecycle-badge--" + (SEVERITY_TONE[f.severity] || "muted") + " kb-lint-sev" }, sev.label),
      h("span", { class: "kb-lint-finding-icon", html: typeIcon(f.recordType) }),
      h(
        "div",
        { class: "kb-lint-finding-main" },
        h(
          "div",
          { class: "kb-lint-finding-head" },
          h("span", { class: "kb-lint-finding-name" }, recordName),
          h("span", { class: "kb-lint-finding-meta" }, typeLabel(f.recordType) + " · " + (set ? set.name : f.setId || "—")),
        ),
        h("p", { class: "kb-lint-finding-msg" }, f.message),
        f.suggestion ? h("p", { class: "kb-lint-finding-fix" }, h("span", { class: "kb-lint-fix-label" }, "Suggested fix"), f.suggestion) : null,
      ),
      h(
        "div",
        { class: "kb-lint-finding-actions" },
        plan && !plan.navigational ? fixButton(f, plan) : null,
        set
          ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => ctx.go("#/organizations/" + set.id) }, "Open in client")
          : null,
        h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => { if (window.__kb) window.__kb.pendingSearch = recordName; ctx.navigate("search"); } }, "Find in search"),
      ),
    );
  }
}
