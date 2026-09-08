/* ============================================================
   BI embeddable widget (task 30) — generate a small snippet for
   any single report card that another tool can paste, so a tool
   page can show a relevant BI chart without leaving its own
   generator. The snippet is a responsive iframe pointing at the
   BI's own embed route (#/embed/<reportId>), which renders one
   clean card. The in-app embed route is handled in app.js.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const embed = (BI.embed = {});

  embed.url = function (reportId, opts) {
    opts = opts || {};
    const base = "https://perchance.org/" + (window.generatorName || "business-intelligence-dashboard");
    return base + "#/embed/" + encodeURIComponent(reportId) + (opts.theme ? "?theme=" + opts.theme : "");
  };

  /* A self-contained HTML snippet any page can paste. */
  embed.snippet = function (reportId, opts) {
    opts = opts || {};
    const report = BI.reports.get(reportId);
    const title = (report && report.name) || reportId;
    const w = opts.width || "100%";
    const h = opts.height || 340;
    const url = embed.url(reportId, opts);
    const css = opts.style === false ? "" : " style=\"border:0;border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,.12)\"";
    return [
      "<!-- BI report widget: " + title + " -->",
      '<iframe src="' + url + '"' + css + ' width="' + w + '" height="' + h + '" loading="lazy" title="' + title.replace(/"/g, "&quot;") + '" allowtransparency></iframe>',
      '<!-- embed source: ' + url + ' -->',
    ].join("\n");
  };

  /* Markdown/plain link form for docs. */
  embed.link = function (reportId) {
    const report = BI.reports.get(reportId);
    const title = (report && report.name) || reportId;
    return "[" + title + "](" + embed.url(reportId) + ")";
  };
})();
