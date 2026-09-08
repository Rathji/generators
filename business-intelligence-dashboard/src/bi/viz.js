/* ============================================================
   BI chart adapter — renders any report through the right
   data-visualization-plugin call, feeding only the shapes the
   plugin accepts and dropping the returned SVG into the card.

     timeSeries → charts.timeSeries([{t,v}] or multi-series)
     bar/line  → charts.bar/line([{label,value}] or {labels,series})
     pie/donut → charts.pie/donut([{label,value}])
     histogram → charts.histogram(distribution object)
     kpi       → formatted value + period delta + sparkline (HTML)
     table     → an HTML data table (P&L summary)

   Theme is passed through the plugin options ({theme, colors,
   legend, tooltips, decimals}) so a theme switch restyles every
   chart via the plugin, not post-hoc CSS. Charts are static SVG,
   so drill-down is implemented by the BI shell re-rendering a
   scoped report (BI.viz.drillChips + breadcrumbs).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const viz = (BI.viz = {});

  function charts() { return window.root && root.charts ? root.charts : null; }

  /* ---------- chart-type recommendation (task 17) ---------- */
  viz.recommend = function (report) {
    const cat = BI.catalog;
    const measure = Array.isArray(report.measures) ? report.measures[0] : report.measure;
    const def = cat.get(measure);
    if (report.dimension && def && def.defaultChart) return def.defaultChart;
    if (Array.isArray(report.measures) && report.measures.length > 1) return "timeSeries";
    if (report.dimension) return def && def.defaultChart ? def.defaultChart : "bar";
    if (!report.dimension) return "timeSeries";
    return "bar";
  };

  /* ---------- theme pass-through (task 19) ---------- */
  viz.themeOpts = function (extra) {
    const mode = BI.theme.get();
    return Object.assign({
      theme: mode === "dark" ? "dark" : "light",
      legend: true,
      tooltips: true,
      decimals: 1,
    }, extra || {});
  };

  /* ---------- shapes ---------- */
  function toSeries(labels, values) {
    const out = [];
    for (let i = 0; i < labels.length; i++) {
      if (values[i] == null) continue;
      out.push({ label: labels[i], value: values[i] });
    }
    return out;
  }
  function toTime(series, labels) {
    /* series: [{name, data:[...]}] with data aligned to labels */
    return series.map((s) => ({
      name: s.name,
      data: s.data.map((v, i) => ({ t: Date.parse(labels[i] + (labels[i].indexOf("-") > 0 && labels[i].length === 7 ? "-01" : "")), v })).filter((p) => isFinite(p.t) && p.v != null),
    })).filter((s) => s.data.length);
  }

  /* ---------- rendering ---------- */
  viz.render = function (report, q, opts) {
    opts = opts || {};
    const ch = charts();
    const chartType = opts.chartType || report.chartType || viz.recommend(report);
    const cat = BI.catalog;
    const primary = Array.isArray(report.measures) ? report.measures[0] : report.measure;
    const metric = cat.get(primary);
    const title = opts.title || (opts.cardTitle || report.name);
    const dec = metric && metric.format ? metric.format.decimals : 0;
    const themeOpts = viz.themeOpts({ title, decimals: dec });

    if (!ch) return '<div class="bi-chart-error">Charts plugin is not available on this page.</div>';

    if (chartType === "kpi") return viz.kpiHTML(report, q, opts);
    if (chartType === "table") return viz.tableHTML(report, q, opts);

    let svg = "";
    try {
      if (chartType === "timeSeries") {
        const t = toTime(q.series.series, q.labels);
        svg = t.length ? ch.timeSeries(t, themeOpts) : chartsPlaceholder(metric, primary);
      } else if (chartType === "bar") {
        const d = q.cats ? toSeries(q.cats.map((c) => c.label), q.cats.map((c) => c.value)) : toSeries(q.labels, q.values);
        svg = q.cats ? ch.bar(d, themeOpts) : ch.bar({ labels: q.labels, series: q.series.series }, themeOpts);
      } else if (chartType === "line") {
        const d = q.cats ? toSeries(q.cats.map((c) => c.label), q.cats.map((c) => c.value)) : toSeries(q.labels, q.values);
        svg = q.cats ? ch.line(d, themeOpts) : ch.line({ labels: q.labels, series: q.series.series }, themeOpts);
      } else if (chartType === "pie" || chartType === "donut") {
        const d = (q.cats || toSeries(q.labels, q.values)).filter((c) => c.value != null);
        svg = (chartType === "donut" ? ch.donut(d, themeOpts) : ch.pie(d, themeOpts));
      } else if (chartType === "histogram") {
        const vals = (q.cats || toSeries(q.labels, q.values)).filter((c) => c.value != null).map((c) => c.value);
        const dist = { values: vals, probs: vals.map(() => 1), expr: metric ? metric.label : primary, mean: null, std: null };
        svg = vals.length ? ch.histogram(dist, themeOpts) : chartsPlaceholder(metric, primary);
      } else {
        return '<div class="bi-chart-error">Unknown chart type: ' + BI.esc(chartType) + "</div>";
      }
    } catch (e) {
      return '<div class="bi-chart-error">Could not render chart: ' + BI.esc(e && e.message ? e.message : e) + "</div>";
    }
    if (typeof svg === "string" && svg.charAt(0) === "(") return '<div class="bi-chart-empty">' + BI.esc(svg) + "</div>";
    return '<div class="bi-chart">' + svg + "</div>";
  };

  function chartsPlaceholder(metric, primary) {
    return "<span>No data for " + BI.esc(metric ? metric.label : primary) + " in this range.</span>";
  }

  /* ---------- KPI cards (task 18) ---------- */
  function sparkSVG(vals, dec) {
    if (!vals || vals.length < 2) return "";
    const W = 520, H = 48, PAD = 4;
    let mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (!(mn < mx)) { mx = mn + 1; }
    const range = mx - mn;
    const x = (i) => (vals.length === 1 ? W / 2 : PAD + (W - 2 * PAD) * i / (vals.length - 1));
    const y = (v) => PAD + (H - 2 * PAD) * (1 - (v - mn) / range);
    const pts = vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    let out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" role="img" style="width:100%;height:auto;display:block;overflow:visible;">';
    out += '<polyline points="' + pts + '" fill="none" stroke="var(--bi-primary, #7c6cff)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    for (let i = 0; i < vals.length; i++) {
      out += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(vals[i]).toFixed(1) + '" r="3" fill="var(--bi-primary, #7c6cff)"><title>' +
        BI.esc(vals[i].toLocaleString(undefined, { maximumFractionDigits: dec })) + "</title></circle>";
    }
    return out + "</svg>";
  }

  viz.kpiHTML = function (report, q, opts) {
    opts = opts || {};
    const cat = BI.catalog;
    const primary = Array.isArray(report.measures) ? report.measures[0] : report.measure;
    const metric = cat.get(primary);
    const value = q.total;
    const comp = q.comparison;
    const dec = metric && metric.format ? metric.format.decimals : 0;
    const arrow = comp && comp.pct != null ? (comp.pct > 0 ? "up" : comp.pct < 0 ? "down" : "flat") : "flat";
    const good = metric && comp && comp.pct != null ? (metric.better === "lower" ? comp.pct <= 0 : comp.pct >= 0) : null;
    const spark = q.series && q.series.series ? q.series.series[0].data.filter((v) => v != null) : [];
    const deltaHtml = comp && comp.pct != null
      ? '<span class="bi-kpi-delta ' + (good ? "good" : "bad") + '" data-arrow="' + arrow + '">' +
        (arrow === "up" ? "▲" : arrow === "down" ? "▼" : "●") + " " +
        (comp.pct > 0 ? "+" : "") + comp.pct.toFixed(1) + "%" +
        (comp.abs != null ? ' <small>' + cat.fmt(primary, Math.abs(comp.abs), dec) + "</small>" : "") + "</span>"
      : '<span class="bi-kpi-delta none">no prior period</span>';

    const sparkSvg = spark.length >= 2 ? '<div class="bi-spark">' + sparkSVG(spark, dec) + "</div>" : "";
    return '<div class="bi-kpi">' +
      '<div class="bi-kpi-value">' + cat.fmt(primary, value, dec) + "</div>" +
      deltaHtml + sparkSvg +
      "</div>";
  };

  /* ---------- table render (P&L summary) ---------- */
  viz.tableHTML = function (report, q, opts) {
    const cat = BI.catalog;
    const measures = Array.isArray(report.measures) ? report.measures : [report.measure];
    const rows = measures.map((m) => {
      const def = cat.get(m);
      return { id: m, label: def ? def.label : m, value: q.totals && q.totals[m] != null ? q.totals[m] : null, fmt: def };
    });
    let html = '<table class="bi-table"><tbody>';
    for (const r of rows) {
      html += '<tr><td>' + BI.esc(r.label) + '</td><td class="bi-table-val">' + (r.value == null ? "—" : cat.fmt(r.id, r.value)) + "</td></tr>";
    }
    return html + "</tbody></table>";
  };

  /* ---------- drill-down (task 20) ---------- */
  /* Returns chips [{label, overrides}] for scoped re-render. */
  viz.drillChips = function (report, q) {
    const out = [];
    if (q.cats) {
      for (const c of q.cats) {
        out.push({
          label: c.label,
          overrides: { filters: [...(report.filters || []), { field: "dimension", name: report.dimension, value: c.label }] },
        });
      }
      return out;
    }
    /* time series */
    const rangePer = (label) => {
      const g = report.periodGrouping || "month";
      let from = label, to = label;
      if (g === "month") { from = label + "-01"; to = label + "-28"; }
      else if (g === "quarter") { const m = Number(label.slice(6)) * 3 - 2; from = label.slice(0, 4) + "-" + String(m).padStart(2, "0") + "-01"; to = label.slice(0, 4) + "-" + String(m + 2).padStart(2, "0") + "-28"; }
      else if (g === "year") { from = label + "-01-01"; to = label + "-12-31"; }
      else if (g === "week") { from = label + "-01"; to = label + "-07"; }
      else { from = label; to = label; }
      return { type: "custom", from, to };
    };
    if (report.drill && report.drill.dimension && q.labels) {
      for (let i = 0; i < q.labels.length; i++) {
        out.push({
          label: q.labels[i] + " · by " + report.drill.dimension,
          overrides: { dimension: report.drill.dimension, dateRange: rangePer(q.labels[i]) },
        });
      }
    }
    if (q.labels) {
      for (let i = 0; i < q.labels.length; i++) {
        out.push({ label: q.labels[i], overrides: { dateRange: rangePer(q.labels[i]) } });
      }
    }
    return out;
  };

  /* breadcrumb-friendly human label for an override set */
  viz.overrideLabel = function (report, overrides) {
    if (overrides && overrides.dimension) {
      const cat = BI.catalog;
      const m = Array.isArray(report.measures) ? report.measures[0] : report.measure;
      return "by " + BI.esc(overrides.dimension);
    }
    return "";
  };
})();
