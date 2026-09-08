// src/modules/reports.js — dashboard KPIs (task 31), coverage & health reports
// (task 32), the low-rated feedback report (task 30), CSV/print export (task 33),
// and the data-integrity health panel (task 34).

import { h, esc } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState } from "../framework/states.js";
import { viewPanel, flattenTree, findCat, catPathStr, fmtDate, relTime, fmtBytes, downloadCsv, statusBadge } from "./shared.js";

export default {
  id: "reports",
  label: "Reports",
  desc: "Coverage, health & activity reports",
  icon: icons.reports,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Compiling reports…" }));
    const articles = await ctx.content.listArticles().catch(() => []);
    const tree = await ctx.content.getCategoryTree().catch(() => []);
    const audit = await ctx.content.listAudit({ limit: 4000 }).catch(() => []);
    const integrity = (await ctx.integrity) || (await ctx.content.runIntegrityChecks().catch(() => ({ ok: true, issues: [] })));

    // ---- KPIs -----------------------------------------------------------------
    const byStatus = { draft: 0, in_review: 0, published: 0, archived: 0 };
    for (const a of articles) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const stale = ctx.content.staleArticles(articles);
    const oldest = stale.sort((a, b) => ctx.content.daysOverdue(b) - ctx.content.daysOverdue(a))[0];
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const publishedThisMonth = articles.filter((a) => a.status === "published" && a.updated && a.updated.at >= monthStart.getTime()).length;
    const mostUpdated = articles.slice().sort((a, b) => (b.updated && b.updated.at) - (a.updated && a.updated.at)).slice(0, 5);

    const kpi = (label, value, sub, href, tone = "") =>
      h("a", { class: "kb-kpi" + (tone ? " kb-kpi-" + tone : ""), href, onClick: href === "#" ? (e) => e.preventDefault() : null },
        h("span", { class: "kb-kpi-value" }, value),
        h("span", { class: "kb-kpi-label" }, label),
        sub ? h("span", { class: "kb-kpi-sub" }, sub) : null,
      );
    const kpiRow = h("div", { class: "kb-kpi-row" },
      kpi("Articles (draft)", byStatus.draft, "created but not submitted", "#/browse", "draft"),
      kpi("In review", byStatus.in_review, "awaiting approval", "#/review", "review"),
      kpi("Published", byStatus.published, publishedThisMonth + " published this month", "#/browse"),
      kpi("Stale content", stale.length, oldest ? "oldest overdue " + ctx.content.daysOverdue(oldest) + " d" : "all within schedule", "#/stale", stale.length ? "danger" : "ok"),
      kpi("System health", integrity.ok ? "OK" : "Issues", integrity.issues ? integrity.issues.filter((i) => i.level === "error").length + " error(s), " + integrity.issues.filter((i) => i.level === "warning").length + " warning(s)" : "", "#/reports", integrity.ok ? "ok" : "danger"),
    );

    // ---- coverage by category ----------------------------------------------------
    const catCounts = {};
    for (const f of flattenTree(tree)) {
      catCounts[f.id] = { active: 0, published: 0 };
    }
    for (const a of articles) {
      if (!catCounts[a.categoryId] && a.categoryId) catCounts[a.categoryId] = { active: 0, published: 0 };
      if (a.status !== "archived") {
        if (catCounts[a.categoryId]) catCounts[a.categoryId].active++;
        if (a.status === "published" && catCounts[a.categoryId]) catCounts[a.categoryId].published++;
      }
    }
    const coverageRows = flattenTree(tree).map((f) => {
      const c = catCounts[f.id] || { active: 0, published: 0 };
      return { id: f.id, label: f.label, depth: f.depth, active: c.active, published: c.published, thin: c.active === 0 };
    });
    const coverageTbl = table(
      ["Category", "Active", "Published", "Status"],
      coverageRows.map((r) => [
        "—".repeat(r.depth) + (r.depth ? " " : "") + r.label,
        String(r.active),
        String(r.published),
        r.thin ? h("span", { class: "kb-badge kb-badge-draft" }, "thin / empty") : h("span", { class: "kb-badge kb-badge-published" }, "ok"),
      ]),
    );

    // ---- review compliance --------------------------------------------------------
    const published = articles.filter((a) => a.status === "published");
    const compliant = published.length - stale.length;
    const pct = published.length ? Math.round((compliant / published.length) * 100) : 100;
    const complianceBar = h("div", { class: "kb-progress" },
      h("div", { class: "kb-progress-fill", style: { width: pct + "%" } }),
    );
    const complianceTbl = table(
      ["Article", "Interval", "Last reviewed", "Status"],
      published.map((a) => [
        h("a", { href: "#/article/" + a.id }, a.title),
        String(a.reviewIntervalDays || 365) + " days",
        fmtDate(a.reviewedAt || 0),
        ctx.content.daysOverdue(a) > 0
          ? h("span", { class: "kb-badge kb-badge-draft" }, "overdue " + ctx.content.daysOverdue(a) + " d")
          : h("span", { class: "kb-badge kb-badge-published" }, "within schedule"),
      ]),
    );

    // ---- activity by author ---------------------------------------------------------
    const byActor = {};
    for (const e of audit) byActor[e.actor || "system"] = (byActor[e.actor || "system"] || 0) + 1;
    const actorRows = Object.entries(byActor).sort((a, b) => b[1] - a[1]);
    const actorTbl = table(["Author", "Actions"], actorRows.map(([a, n]) => [a, String(n)]));

    // ---- feedback report (task 30) -----------------------------------------------------
    const feedbackRows = [];
    for (const a of articles) {
      const fb = a.feedback || [];
      const neg = fb.filter((f) => !f.helpful).length;
      const commented = fb.filter((f) => f.comment).length;
      if (neg || commented) feedbackRows.push({ a, neg, commented });
    }
    const feedbackTbl = feedbackRows.length
      ? table(["Article", "Not helpful", "Comments", "Sample feedback"], feedbackRows.slice(0, 30).map((r) => [
          h("a", { href: "#/article/" + r.a.id }, r.a.title),
          String(r.neg),
          String(r.commented),
          (r.a.feedback || []).filter((f) => f.comment).slice(0, 1).map((f) => String(f.comment).slice(0, 90)).join("") || "—",
        ]))
      : h("p", { class: "kb-muted" }, "No negative or commented feedback yet.");

    // ---- recent activity ----------------------------------------------------------------
    const recent = audit.slice(0, 8);
    const recentTbl = table(["Time", "Action", "Actor", "Target"], recent.map((e) => [
      relTime(e.at),
      String(e.action || ""),
      esc(e.actor || "system"),
      String(e.target || ""),
    ]));

    // ---- integrity panel (task 34) --------------------------------------------------------
    const integrityList = integrity.issues && integrity.issues.length
      ? h("ul", { class: "kb-check-list-full" }, integrity.issues.slice(0, 40).map((i) =>
          h("li", { class: "kb-check-item kb-check-" + i.level }, String(i.message)),
        ))
      : h("p", { class: "kb-muted" }, "All integrity checks pass — unique ids, valid cross-links, approved versions, flagged stale content, no dangling category references.");

    // ---- CSV + print ------------------------------------------------------------------------
    const csvButtons = h("div", { class: "kb-csv-row" },
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => exportArticlesCsv() }, "Export articles CSV"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => exportCoverageCsv() }, "Export coverage CSV"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => exportActivityCsv() }, "Export activity CSV"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => exportFeedbackCsv() }, "Export feedback CSV"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => printReport() }, "Print report"),
    );

    const exportArticlesCsv = () => {
      downloadCsv("kb-articles.csv", [
        ["id", "title", "status", "docType", "category", "tags", "owner", "updatedAt", "views", "version"],
        ...articles.map((a) => [a.id, a.title, a.status, a.docType, catPathStr(tree, a.categoryId), (a.tags || []).join("|"), a.owner, new Date(a.updated && a.updated.at).toISOString(), a.views || 0, a.publishedVersion || (a.versions || []).length]),
      ]);
    };
    const exportCoverageCsv = () => {
      downloadCsv("kb-coverage.csv", [
        ["category", "active", "published"],
        ...coverageRows.map((r) => [r.label, String(r.active), String(r.published)]),
      ]);
    };
    const exportActivityCsv = () => {
      downloadCsv("kb-activity.csv", [
        ["time", "action", "actor", "target"],
        ...audit.slice(0, 2000).map((e) => [new Date(e.at).toISOString(), e.action, e.actor || "system", e.target || ""]),
      ]);
    };
    const exportFeedbackCsv = () => {
      const rows = [["articleId", "article", "time", "helpful", "comment", "by"]];
      for (const r of feedbackRows) {
        for (const f of r.a.feedback || []) rows.push([r.a.id, r.a.title, new Date(f.at).toISOString(), String(f.helpful), f.comment || "", f.by || ""]);
      }
      downloadCsv("kb-feedback.csv", rows);
    };
    const printReport = () => {
      const w = window.open("", "_blank");
      if (!w) { ctx.toast("Allow pop-ups to print", "warning"); return; }
      const kpiLines = [
        ["Drafts", byStatus.draft], ["In review", byStatus.in_review], ["Published", byStatus.published], ["Stale", stale.length],
        ["Review compliance", pct + "%"], ["Published this month", publishedThisMonth], ["System health", integrity.ok ? "OK" : "Issues"],
      ].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>KB Report</title>
<style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.6;color:#111}
h1{font-size:26px} h2{border-bottom:1px solid #ddd;padding-bottom:3px;margin-top:26px;font-size:19px}
table{border-collapse:collapse;width:100%;font-size:13.5px} td,th{border:1px solid #ccc;padding:5px 9px;text-align:left}
.meta{color:#666;font-size:13px}</style></head><body>
<h1>Knowledge Base Report</h1>
<div class="meta">Generated ${new Date().toLocaleString()} · ${articles.length} articles</div>
<h2>KPIs</h2><table>${kpiLines}</table>
<h2>Coverage by category</h2><table><tr><th>Category</th><th>Active</th><th>Published</th></tr>${coverageRows.map((r) => `<tr><td>${"&nbsp;&nbsp;".repeat(r.depth) + esc(r.label)}</td><td>${r.active}</td><td>${r.published}</td></tr>`).join("")}</table>
<h2>Review compliance</h2><p>${pct}% of published articles are within their review interval.</p>
<h2>Activity by author</h2><table><tr><th>Author</th><th>Actions</th></tr>${actorRows.map(([a, n]) => `<tr><td>${esc(a)}</td><td>${n}</td></tr>`).join("")}</table>
</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    };

    const section = (title, note, body) =>
      h("section", { class: "kb-report" },
        h("div", { class: "kb-section-title" }, h("span", { class: "kb-section-icon", html: icons.reports }), h("h2", null, title)),
        note ? h("p", { class: "kb-report-note" }, note) : null,
        body,
      );

    const panel = viewPanel({
      crumb: "Knowledge base / Reports",
      title: "Reports",
      desc: "KPIs, coverage, review compliance, activity, feedback and system health.",
      body: h("div", { class: "kb-reports-body" },
        kpiRow,
        csvButtons,
        section("System health", "Re-run automatically after every write — click below to re-run now.", h("div", {},
          integrityList,
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: async () => { ctx.container.replaceChildren(loadingState()); await (window.__kb && window.__kb.refreshIntegrity && window.__kb.refreshIntegrity()); ctx.go("#/reports"); } }, "Re-run checks"),
        )),
        section("Documentation coverage by category", "Categories with no active articles are flagged as thin/empty.", coverageTbl),
        section("Review compliance", pct + "% of published articles are within their review interval (" + compliant + " of " + published.length + ").", h("div", {}, complianceBar, complianceTbl)),
        section("Activity by author", "State-changing actions from the audit log.", actorRows.length ? actorTbl : h("p", { class: "kb-muted" }, "No recorded activity yet.")),
        section("Low-rated & commented articles", "Feedback owners should follow up on.", feedbackTbl),
        section("Recent activity", "Latest audit-log entries.", recentTbl),
      ),
    });
    ctx.container.replaceChildren(panel);
  },
};

function table(headers, rows) {
  return h("table", { class: "kb-table" },
    h("thead", null, h("tr", null, headers.map((hdr) => h("th", null, hdr)))),
    h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, c))))),
  );
}
