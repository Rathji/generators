// ============================================================================
// quote-u — deprecations & migration cleanup (roadmap task 56)
// ----------------------------------------------------------------------------
// Two concepts were superseded during Phase 9 and must not linger in the live
// data set OR in the documentation:
//
//   1. `single` option-group selection type — the old "good/better/best"
//      spelling. The canonical type is now `bundle` (still mutually exclusive);
//      `single` remains a READ-TIME ALIAS so old data keeps working, and this
//      migration rewrites stored `single` groups to `bundle`.
//   2. `internal_review` — the optional lifecycle state. The ratified flow is
//      the direct draft → sent path, so any mutable version parked in
//      `internal_review` is returned to `draft`.
//
// Two hard rules the migration obeys:
//   • It NEVER touches a frozen version or a member of one (invariant I1). A
//     `single` group belonging to a frozen version is left as-is and reported
//     `skip: frozen_version` — the read-time alias covers it forever.
//   • It is revision-guarded and idempotent. `plan()` is pure and reports what
//     WOULD change; `apply()` is a pure transform; the service writes each
//     document through the version-checked store and re-plans afterwards to
//     prove no actionable change remains.
// ============================================================================
window.QU_MIGRATE = (function () {
  "use strict";

  const VERSION = "1.0.0";

  const DEPRECATIONS = Object.freeze([
    Object.freeze({
      id: "selection_type.single",
      domain: "option_groups",
      field: "selection_type",
      from: "single",
      to: "bundle",
      since: "task 56",
      note: "The mutually-exclusive 'single' type is now spelled 'bundle'. 'single' remains a read-time alias."
    }),
    Object.freeze({
      id: "lifecycle.internal_review",
      domain: "quote_versions",
      field: "state",
      from: "internal_review",
      to: "draft",
      since: "task 56",
      note: "The optional internal_review state is superseded; the ratified flow is draft → sent."
    })
  ]);

  const DOCS = Object.freeze({ groups: "option_groups", versions: "quote_versions", quotes: "quotes" });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function isFrozenVersion(v) {
    return !!(v && typeof v.frozen_at === "string" && v.frozen_at.length > 0);
  }

  function vid(v) {
    const x = v && v.quote_version_id;
    return x === undefined || x === null ? null : String(x);
  }

  function tally(changes) {
    let convert = 0;
    let skip = 0;
    changes.forEach(c => { if (c.action === "convert") convert++; else skip++; });
    return { convert, skip, total: changes.length };
  }

  // Pure: what WOULD the migration change? Never mutates its input.
  function plan(input) {
    input = input || {};
    const groups = Array.isArray(input.option_groups) ? input.option_groups : [];
    const versions = Array.isArray(input.quote_versions) ? input.quote_versions : [];
    const quotes = Array.isArray(input.quotes) ? input.quotes : [];
    const frozen = new Set(versions.filter(isFrozenVersion).map(v => String(v.id)));

    const groupChanges = [];
    groups.forEach(g => {
      if (!g || g.selection_type !== "single") return;
      const owner = vid(g);
      if (owner && frozen.has(owner)) {
        groupChanges.push({ id: g.id, domain: "option_groups", action: "skip", from: "single", to: "single", version_id: owner, reason: "frozen_version" });
        return;
      }
      groupChanges.push({ id: g.id, domain: "option_groups", action: "convert", from: "single", to: "bundle", version_id: owner });
    });

    const versionChanges = [];
    versions.forEach(v => {
      if (!v || v.state !== "internal_review") return;
      if (isFrozenVersion(v)) {
        versionChanges.push({ id: v.id, domain: "quote_versions", action: "skip", from: "internal_review", to: "internal_review", reason: "frozen_version" });
        return;
      }
      versionChanges.push({ id: v.id, domain: "quote_versions", action: "convert", from: "internal_review", to: "draft", quote_id: v.quote_id === undefined ? null : v.quote_id });
    });

    const quoteChanges = [];
    quotes.forEach(q => {
      if (!q || q.status !== "internal_review") return;
      quoteChanges.push({ id: q.id, domain: "quotes", action: "convert", from: "internal_review", to: "draft" });
    });

    const counts = { option_groups: tally(groupChanges), quote_versions: tally(versionChanges), quotes: tally(quoteChanges) };
    const total = counts.option_groups.convert + counts.quote_versions.convert + counts.quotes.convert;
    const skipped = counts.option_groups.skip + counts.quote_versions.skip + counts.quotes.skip;
    return {
      ok: true,
      deprecations: DEPRECATIONS,
      group_changes: groupChanges,
      version_changes: versionChanges,
      quote_changes: quoteChanges,
      counts,
      total_converted: total,
      total_skipped: skipped,
      has_changes: total > 0
    };
  }

  // Pure transform: returns NEW arrays with the deprecations applied. A frozen
  // member is always left byte-identical.
  function apply(input) {
    input = input || {};
    const p = plan(input);
    const frozen = new Set((Array.isArray(input.quote_versions) ? input.quote_versions : []).filter(isFrozenVersion).map(v => String(v.id)));

    const optionGroups = (Array.isArray(input.option_groups) ? input.option_groups : []).map(g => {
      if (!g || g.selection_type !== "single") return g;
      const owner = vid(g);
      if (owner && frozen.has(owner)) return g; // never touch a frozen member (I1)
      return Object.assign({}, g, { selection_type: "bundle" });
    });

    const quoteVersions = (Array.isArray(input.quote_versions) ? input.quote_versions : []).map(v => {
      if (!v || v.state !== "internal_review" || isFrozenVersion(v)) return v;
      return Object.assign({}, v, { state: "draft" });
    });

    const quotes = (Array.isArray(input.quotes) ? input.quotes : []).map(q => {
      if (!q || q.status !== "internal_review") return q;
      return Object.assign({}, q, { status: "draft" });
    });

    return {
      ok: true,
      plan: p,
      option_groups: optionGroups,
      quote_versions: quoteVersions,
      quotes,
      applied: {
        option_groups: p.counts.option_groups.convert,
        quote_versions: p.counts.quote_versions.convert,
        quotes: p.counts.quotes.convert
      }
    };
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      const e = new Error("QU_MIGRATE needs a document store with loadDoc/saveChecked.");
      e.code = "no_store";
      throw e;
    }
    const audit = opts.audit || null;
    const clock = opts.clock || null;
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;

    function nowIso() { return typeof clock === "function" ? String(clock()) : new Date().toISOString(); }

    async function readDoc(doc) {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function loadAll() {
      const groups = await readDoc(DOCS.groups);
      if (!groups.ok) return groups;
      const versions = await readDoc(DOCS.versions);
      if (!versions.ok) return versions;
      const quotes = await readDoc(DOCS.quotes);
      if (!quotes.ok) return quotes;
      return { ok: true, groups, versions, quotes };
    }

    // Inspect the live data set without writing anything.
    async function inspect() {
      const l = await loadAll();
      if (!l.ok) return l;
      const p = plan({ option_groups: l.groups.records, quote_versions: l.versions.records, quotes: l.quotes.records });
      return Object.assign({ ok: true }, p, { documents: { option_groups: l.groups.records.length, quote_versions: l.versions.records.length, quotes: l.quotes.records.length } });
    }

    // Write one document's records back, revision-guarded. `transform(records)`
    // returns the new records array (or null for a no-op).
    async function writeRecords(doc, transform) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await readDoc(doc);
        if (!l.ok) return l;
        const next = transform(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision, records: l.records };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "migration_conflict", detail: `Could not write ${doc} after ${maxRetries + 1} attempts.` };
    }

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      try { return await audit.append(input); } catch (e) { return { ok: false, code: "audit_failed", detail: (e && e.message) || String(e) }; }
    }

    // Apply the migration to the live data set. Skip-frozen entries are never
    // written; after writing, `reconcile` re-plans to prove nothing actionable
    // remains (skips aside).
    async function run(ctx) {
      ctx = ctx || {};
      const before = await inspect();
      if (!before.ok) return before;
      if (!before.has_changes) {
        return { ok: true, noop: true, converted: 0, skipped: before.total_skipped, plan: before, detail: "No deprecated values remain in the live data set." };
      }

      const frozenSet = new Set();
      const l = await loadAll();
      if (!l.ok) return l;
      l.versions.records.forEach(v => { if (isFrozenVersion(v)) frozenSet.add(String(v.id)); });

      const results = {};

      // 1. option_groups: single → bundle (frozen members untouched).
      const gRes = await writeRecords(DOCS.groups, records => {
        let changed = false;
        const next = records.map(g => {
          if (!g || g.selection_type !== "single") return g;
          const owner = vid(g);
          if (owner && frozenSet.has(owner)) return g;
          changed = true;
          return Object.assign({}, g, { selection_type: "bundle" });
        });
        return changed ? next : null;
      });
      if (!gRes.ok) return gRes;
      results.option_groups = gRes.noop ? { converted: 0 } : { converted: before.counts.option_groups.convert };

      // 2. quote_versions: internal_review → draft (frozen versions untouched).
      const vRes = await writeRecords(DOCS.versions, records => {
        let changed = false;
        const next = records.map(v => {
          if (!v || v.state !== "internal_review" || isFrozenVersion(v)) return v;
          changed = true;
          return Object.assign({}, v, { state: "draft" });
        });
        return changed ? next : null;
      });
      if (!vRes.ok) return vRes;
      results.quote_versions = vRes.noop ? { converted: 0 } : { converted: before.counts.quote_versions.convert };

      // 3. quotes: a status parked at internal_review returns to draft.
      const qRes = await writeRecords(DOCS.quotes, records => {
        let changed = false;
        const next = records.map(q => {
          if (!q || q.status !== "internal_review") return q;
          changed = true;
          return Object.assign({}, q, { status: "draft" });
        });
        return changed ? next : null;
      });
      if (!qRes.ok) return qRes;
      results.quotes = qRes.noop ? { converted: 0 } : { converted: before.counts.quotes.convert };

      const after = await inspect();
      const converted = (results.option_groups.converted || 0) + (results.quote_versions.converted || 0) + (results.quotes.converted || 0);
      await auditAppend({
        event: "error", // recorded under the generic system bucket: a one-off migration notice
        actor_type: "system",
        actor: (ctx.actor || "system"),
        detail: {
          action: "migration_applied",
          migration: "task-56-deprecations",
          at: nowIso(),
          converted,
          counts: results,
          remaining: after.ok ? after.total_converted : null,
          skipped: before.total_skipped
        }
      });

      return {
        ok: true,
        converted,
        skipped: before.total_skipped,
        results,
        before,
        after,
        reconciled: after.ok ? after.total_converted === 0 : false
      };
    }

    // Re-plan against the live data: a clean result has no actionable change.
    async function reconcile() {
      const p = await inspect();
      if (!p.ok) return p;
      return { ok: p.total_converted === 0, remaining: p.total_converted, skipped: p.total_skipped, plan: p };
    }

    function ready() {
      const r = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return r.then(() => ({ ok: true }));
    }

    return { ready, inspect, run, reconcile, plan, apply, DEPRECATIONS, DOCS };
  }

  return {
    VERSION,
    DEPRECATIONS,
    DOCS,
    isFrozenVersion,
    plan,
    apply,
    createService
  };
})();
