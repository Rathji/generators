/* ============================================================
   BI fact query engine — filters, groups and aggregates the
   uniform fact records produced by the extractors.

   Report semantics:
     - A report targets one or more measures.
     - It either groups over time (periodGrouping: day/week/month/
       quarter/year) using "" dimension facts, or over one named
       dimension ("stage", "owner", "project", ...) using
       "name:value" facts. The two are never mixed, so values are
       never double-counted.
     - Aggregation per measure comes from the catalog (sum /
       average / last / ratio).
     - Ratio measures (winRate) are computed from their component
       measures per group.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const facts = (BI.facts = {
    records: [],

    clear() { this.records = []; },
    load(recs) { this.records = Array.isArray(recs) ? recs : []; },
    push(rec) { this.records.push(rec); },
    all() { return this.records.slice(); },

    /* ============ filtering ============ */
    /* filter(measures, opts) → array of fact records.
       opts: {tools:[], filters:[{field:"tool"|"dimension"|"measure", name?, value}], from, to} */
    filter(measures, opts) {
      opts = opts || {};
      const ms = new Set(Array.isArray(measures) ? measures : [measures]);
      const tools = opts.tools ? new Set(opts.tools) : null;
      const from = opts.from, to = opts.to;
      const dimFilters = (opts.filters || []).filter((f) => f.field === "dimension" && f.name);
      const toolFilters = (opts.filters || []).filter((f) => f.field === "tool" && f.value);
      return this.records.filter((r) => {
        if (!ms.has(r.measure)) return false;
        if (tools && !tools.has(r.tool)) return false;
        if (from && r.period < from) return false;
        if (to && r.period > to) return false;
        for (const f of toolFilters) if (r.tool !== f.value) return false;
        for (const f of dimFilters) {
          const pfx = f.name + ":";
          if (r.dimension.indexOf(pfx) !== 0) return false;
          if (f.value != null && r.dimension !== pfx + f.value) return false;
        }
        return true;
      });
    },

    /* ============ dimensions ============ */
    dimName(dimension) {
      if (!dimension) return "";
      const i = dimension.indexOf(":");
      return i < 0 ? dimension : dimension.slice(0, i);
    },
    dimValue(dimension) {
      if (!dimension) return "";
      const i = dimension.indexOf(":");
      return i < 0 ? "" : dimension.slice(i + 1);
    },
    /* distinct dimension names present in the fact store */
    dimensionNames() {
      const s = new Set();
      for (const r of this.records) { const n = this.dimName(r.dimension); if (n) s.add(n); }
      return Array.from(s).sort();
    },
    dimensionValues(name) {
      const pfx = name + ":";
      const s = new Set();
      for (const r of this.records) if (r.dimension.indexOf(pfx) === 0) s.add(r.dimension.slice(pfx.length));
      return Array.from(s).sort();
    },

    /* ============ period helpers ============ */
    monthKey(iso) { return iso.slice(0, 7); },
    quarterKey(iso) { return iso.slice(0, 4) + "-Q" + Math.floor((Number(iso.slice(5, 7)) - 1) / 3 + 1); },
    yearKey(iso) { return iso.slice(0, 4); },
    weekKey(iso) {
      const d = new Date(iso + "T00:00:00Z");
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day + 3);
      const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      const day2 = (firstThu.getUTCDay() + 6) % 7;
      firstThu.setUTCDate(firstThu.getUTCDate() - day2 + 3);
      const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
      return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
    },
    /* map an ISO day to its grouping key, and key → display label */
    groupKey(iso, grouping) {
      if (grouping === "month") return this.monthKey(iso);
      if (grouping === "quarter") return this.quarterKey(iso);
      if (grouping === "year") return this.yearKey(iso);
      if (grouping === "week") return this.weekKey(iso);
      return iso; /* day */
    },
    groupLabel(key, grouping) {
      if (grouping === "month") return key.slice(0, 7);
      if (grouping === "quarter") return key;
      if (grouping === "year") return key;
      if (grouping === "week") return key;
      return key;
    },
    keySort(key, grouping) {
      if (grouping === "month") return key + "-01";
      if (grouping === "quarter") return key.slice(0, 4) + "-" + String(Number(key.slice(6)) * 3 - 2).padStart(2, "0") + "-01";
      if (grouping === "year") return key + "-01-01";
      if (grouping === "week") return key; /* weeks sort lexically by year-week */
      return key;
    },

    /* ============ aggregation ============ */
    /* aggregate(values, metric) → number (sum/average/last handled here) */
    aggregate(values, metric) {
      if (!values.length) return null;
      const agg = metric && metric.agg ? metric.agg : "sum";
      if (agg === "last") return values[values.length - 1];
      if (agg === "average") return values.reduce((a, b) => a + b, 0) / values.length;
      return values.reduce((a, b) => a + b, 0);
    },

    /* Compute a ratio measure (winRate) from component measures for a group of records. */
    ratioValue(metric, records) {
      const num = metric.ratio.numerator;
      const den = metric.ratio.denominator;
      let n = 0, d = 0;
      for (const r of records) {
        if (r.measure === num) n += r.value;
        if (den.indexOf(r.measure) >= 0) d += r.value;
      }
      if (!d) return null;
      return (n / d) * 100;
    },

    /* ============ report queries ============ */

    /* Raw filtered records for a report (used by CSV export etc.). */
    recordsFor(report, overrides) {
      const cat = BI.catalog;
      const measures = this.measuresOf(report);
      const opts = this.reportFilterOpts(report, overrides);
      return this.filter(measures, opts);
    },

    measuresOf(report) {
      const cat = BI.catalog;
      const base = Array.isArray(report.measures) ? report.measures.slice() : [report.measure];
      const out = base.slice();
      for (const m of base) {
        const def = cat.get(m);
        if (def && def.agg === "ratio" && def.ratio) {
          for (const c of [def.ratio.numerator, ...def.ratio.denominator]) if (!out.includes(c)) out.push(c);
        }
      }
      return out;
    },

    /* Build {tools, filters, from, to} from a report definition (+ overrides). */
    reportFilterOpts(report, overrides) {
      overrides = overrides || {};
      const cat = BI.catalog;
      let tool = overrides.tool != null ? overrides.tool : report.sourceTool || (report.measure ? cat.get(report.measure).tool : null);
      const dr = overrides.dateRange || report.dateRange || { type: "all" };
      const range = BI.reports.dateRangeBounds(dr);
      const filters = (overrides.filters || report.filters || []).map((f) => Object.assign({}, f));
      const tools = tool ? [tool] : null;
      return { tools, filters, from: range.from, to: range.to };
    },

    /* Group filtered records for a report into chart-ready series.
       Returns { series: {labels, series:[{name,data}]} } for time grouping,
       or { cats: [{label,value}] } for dimension grouping, plus total. */
    query(report, overrides) {
      overrides = overrides || {};
      const cat = BI.catalog;
      const grouping = overrides.periodGrouping || report.periodGrouping || "month";
      const dimension = overrides.dimension != null ? overrides.dimension : report.dimension;
      const recs = this.recordsFor(report, overrides);
      const measures = this.measuresOf(report);
      const primary = Array.isArray(report.measures) ? report.measures[0] : report.measure;
      const metric = cat.get(primary);

      const result = { total: null, totals: {}, records: recs };

      if (dimension) {
        /* group by dimension value */
        const pfx = dimension + ":";
        const buckets = new Map();
        for (const r of recs) {
          if (r.dimension.indexOf(pfx) !== 0) continue;
          const label = r.dimension.slice(pfx.length);
          if (!buckets.has(label)) buckets.set(label, []);
          buckets.get(label).push(r);
        }
        const cats = Array.from(buckets.keys()).sort().map((label) => {
          const recsOf = buckets.get(label);
          const value = this.valueForGroup(recsOf, metric, primary, measures);
          return { label, value };
        });
        result.cats = cats;
        /* total = the measure over the same dimension-scoped records only,
           so breakdown rows are never counted against the headline value */
        result.total = this.valueForGroup(recs.filter((r) => r.dimension.indexOf(pfx) === 0), metric, primary, measures);
        return result;
      }

      /* time grouping */
      const grouped = this.timeBuckets(recs, measures, grouping, primary, metric);
      result.series = grouped.series;
      result.labels = grouped.labels;
      result.values = grouped.series.series[0].data;
      result.total = grouped.totals[primary];
      result.totals = grouped.totals;
      return result;
    },

    /* Group "" dimension facts over time. With one measure → a single
       series; with several measures → one series per measure. */
    timeBuckets(records, measures, grouping, primary, metric) {
      const cat = BI.catalog;
      const buckets = new Map();
      for (const r of records) {
        if (r.dimension !== "") continue;
        const k = this.groupKey(r.period, grouping);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(r);
      }
      const keys = Array.from(buckets.keys()).sort((a, b) => this.keySort(a, grouping).localeCompare(this.keySort(b, grouping)));
      const labels = keys.map((k) => this.groupLabel(k, grouping));
      const totals = {};
      for (const m of measures) {
        const mm = cat.get(m);
        /* totals come from the same ""-dimension records the series plots,
           so breakdown rows (stage:, owner:, ...) never inflate the headline */
        const vals = records.filter((r) => r.measure === m && r.dimension === "").map((r) => r.value);
        totals[m] = this.aggregate(vals, mm);
      }
      const series = measures.map((m) => {
        const mm = cat.get(m);
        const data = keys.map((k) => {
          const v = this.valueForGroup(buckets.get(k), mm, m, measures);
          return v == null ? null : v;
        });
        return { name: mm ? mm.label : m, data };
      });
      return { labels, series: { labels, series }, totals };
    },

    /* Aggregate a group of records for the primary measure (handles ratio). */
    valueForGroup(records, metric, primary, allMeasures) {
      if (metric && metric.agg === "ratio" && metric.ratio) {
        return this.ratioValue(metric, records);
      }
      const vals = records.filter((r) => r.measure === primary).map((r) => r.value);
      return this.aggregate(vals, metric);
    },
  });
})();
