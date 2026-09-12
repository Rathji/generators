// ============================================================================
// quote-u — distributor pricing: search → compare → add-to-quote (tasks 42–44)
// ----------------------------------------------------------------------------
// This module is the bridge between the read-only distributor layer
// (QU_DISTRIBUTORS) and the quote itself. It answers three questions and
// nothing else:
//
//   1. Which source is cheapest / in stock, side by side?  → `compareOffers`
//      lives in QU_DISTRIBUTORS and the pricing panel renders it.
//   2. What will this part SELL for?  → `buildLineInput`: cost + markup, exact
//      integer cents (never a float).
//   3. Add it to the quote as a line item AND seal its cost as an immutable
//      price_snapshot, in one action: `addToQuote`.
//
// The important property is the one in (3): a line that came from a distributor
// is never priced against a live endpoint at display time. The price is captured
// ONCE (via QU_DISTRIBUTORS.capture → QU_PRICESNAPSHOTS) and the line points at
// that immutable snapshot, so a sent quote is reproducible forever — even after
// the distributor's page has changed or the connector is offline.
//
// `staleness()` reports how old a captured cost is against the configured
// threshold, which the builder turns into the stale-cost badge.
// ============================================================================
window.QU_PRICING = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u pricing requires window.QU_MONEY (load src/money.js first)");
  const D = window.QU_DISTRIBUTORS;
  if (!D) throw new Error("quote-u pricing requires window.QU_DISTRIBUTORS (load src/distributors.js first)");

  const VERSION = "1.0.0";

  // The pricing policy: the default markup applied over a captured cost, the
  // default line kind, and the age (in days) past which a captured cost is
  // shown with a staleness badge.
  const DEFAULT_POLICY = Object.freeze({
    default_markup_bp: 2400,
    default_kind: "one_time",
    stale_cost_days: 7
  });

  class PricingError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "PricingError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new PricingError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function intOr(value, def) {
    return Number.isInteger(value) && value >= 0 ? value : def;
  }

  const KINDS = ["one_time", "mrr"];

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    const kind = KINDS.indexOf(String(p.default_kind)) !== -1 ? String(p.default_kind) : DEFAULT_POLICY.default_kind;
    return {
      default_markup_bp: intOr(p.default_markup_bp, DEFAULT_POLICY.default_markup_bp),
      default_kind: kind,
      stale_cost_days: intOr(p.stale_cost_days, DEFAULT_POLICY.stale_cost_days)
    };
  }

  // cost + markup → exact integer cents. `default_markup_bp` is basis points
  // (2400 = 24%) applied over the cost, rounded to the cent by QU_MONEY.
  function sellCents(costCents, markupBp) {
    M.assertCents(costCents, "distributor unit cost");
    M.assertBp(markupBp, "markup");
    return M.add(costCents, M.applyBp(costCents, markupBp));
  }

  function snapshotRefOf(snapshotOrId) {
    if (typeof snapshotOrId === "string") return snapshotOrId;
    if (snapshotOrId && snapshotOrId.id) return String(snapshotOrId.id);
    return null;
  }

  function descriptionOf(record) {
    return record.description || record.manufacturer_part_number || record.distributor_sku || "Distributor part";
  }

  // Build the line-item INPUT for a distributor offer, priced off an immutable
  // snapshot. Throwing/pure — the record must be the canonical shape and the
  // snapshot must carry integer cents. The line is snapshot-priced (its cost is
  // the captured cost, never re-read later).
  function buildLineInput(record, snapshot, opts) {
    opts = opts || {};
    const check = D.validateRecord(record);
    if (!check.ok) {
      fail(check.violations[0].code, "Not a canonical distributor record: " + check.violations[0].detail, { violations: check.violations });
    }
    if (!snapshot) fail("snapshot_required", "Adding a distributor part to a quote requires a captured price snapshot.");
    const ref = snapshotRefOf(snapshot);
    if (!ref) fail("snapshot_required", "The price snapshot needs an id.");
    const cost = snapshot.unit_cost_cents;
    M.assertCents(cost, "snapshot unit cost");
    const policy = normalizePolicy(opts.policy);
    const markupBp = opts.markup_bp !== undefined ? opts.markup_bp : policy.default_markup_bp;
    const sell = opts.unit_sell_cents !== undefined ? opts.unit_sell_cents : sellCents(cost, markupBp);
    const input = {
      kind: opts.kind !== undefined ? opts.kind : policy.default_kind,
      description: opts.description || descriptionOf(record),
      manufacturer_part_number: record.manufacturer_part_number || "",
      sku: opts.sku !== undefined ? opts.sku : (record.distributor_sku || ""),
      quantity: opts.quantity === undefined ? 1 : opts.quantity,
      unit_cost_cents: cost,
      unit_sell_cents: sell,
      optional: opts.optional === true,
      option_group_id: opts.option_group_id === undefined ? null : opts.option_group_id,
      selected_by_default: opts.selected_by_default === true,
      price_snapshot_ref: ref,
      pricing_mode: "snapshot",
      currency: record.currency || M.DEFAULT_CURRENCY
    };
    if (opts.section !== undefined) input.section = opts.section;
    if (opts.snapshot_source !== undefined) input.snapshot_source = opts.snapshot_source;
    else if (snapshot.source) input.snapshot_source = snapshot.source;
    return input;
  }

  function tryBuildLineInput(record, snapshot, opts) {
    try {
      return { ok: true, input: buildLineInput(record, snapshot, opts) };
    } catch (e) {
      return { ok: false, code: e.code || "bad_pricing", detail: e.message, violations: e.meta && e.meta.violations };
    }
  }

  // ---- age / staleness ------------------------------------------------------

  function capturedAtOf(x) {
    if (!x) return null;
    if (typeof x === "string") return x;
    if (typeof x.captured_at === "string") return x.captured_at;
    if (typeof x.capturedAt === "string") return x.capturedAt;
    return null;
  }

  function ageDays(x, now) {
    const iso = capturedAtOf(x);
    if (!iso) return null;
    const then = Date.parse(iso);
    if (isNaN(then)) return null;
    const at = now === undefined || now === null ? Date.now() : (typeof now === "number" ? now : Date.parse(now));
    if (isNaN(at)) return null;
    return (at - then) / 86400000;
  }

  // Is this captured cost older than the configured threshold? Returns the age
  // and the verdict so the builder can render "captured 12d ago — stale".
  function staleness(x, opts) {
    opts = opts || {};
    const threshold = opts.stale_cost_days === undefined
      ? (opts.policy ? normalizePolicy(opts.policy).stale_cost_days : DEFAULT_POLICY.stale_cost_days)
      : Number(opts.stale_cost_days);
    const age = ageDays(x, opts.now);
    if (age === null) return { ok: false, code: "no_captured_at", detail: "This offer carries no capture timestamp.", age_days: null, stale: null, threshold_days: threshold };
    return {
      ok: true,
      captured_at: capturedAtOf(x),
      age_days: Math.round(age * 10) / 10,
      stale: age > threshold,
      threshold_days: threshold
    };
  }

  // ---- the service ----------------------------------------------------------

  // Wire pricing to the version service (to add the line) and the distributor
  // service (to capture the snapshot). Both are optional at construction so the
  // pure helpers can be used on their own.
  function createService(opts) {
    opts = opts || {};
    const versions = opts.versions || null;
    const distributors = opts.distributors || null;
    const policyInput = opts.policy || null;

    function policy() { return normalizePolicy(policyInput); }

    function keyOf(record) {
      return record.manufacturer_part_number || record.distributor_sku || record.upc || record.description || "";
    }

    // Add a distributor offer (or a canonical record) to a quote version as a
    // snapshot-priced line: validate → capture the price as an immutable
    // snapshot → build the line → versionService.addLine. One action, and the
    // captured cost is sealed before the line ever exists.
    async function addToQuote(versionId, offer, o) {
      o = o || {};
      if (!versions || typeof versions.addLine !== "function") {
        return { ok: false, code: "no_versions", detail: "QU_PRICING needs the version service to add a line." };
      }
      const record = (offer && offer.record) || offer;
      const check = D.validateRecord(record);
      if (!check.ok) {
        return { ok: false, code: check.violations[0].code, detail: "Not a canonical distributor record: " + check.violations[0].detail, violations: check.violations };
      }
      const source = o.source || (offer && offer.source) || record.source;

      let snapshot = o.snapshot || null;
      let deduped = false;
      let errors = [];
      if (!snapshot) {
        if (!distributors || typeof distributors.capture !== "function") {
          return { ok: false, code: "no_distributors", detail: "QU_PRICING needs the distributor service to capture a price, or an explicit snapshot." };
        }
        const cap = await distributors.capture(keyOf(record), { record: record, source: source, captured_at: o.captured_at });
        if (!cap.ok) return cap;
        snapshot = cap.snapshot;
        deduped = !!cap.deduped;
        errors = cap.errors || [];
      }

      let input;
      try {
        input = buildLineInput(record, snapshot, {
          policy: policyInput,
          markup_bp: o.markup_bp,
          unit_sell_cents: o.unit_sell_cents,
          kind: o.kind,
          quantity: o.quantity,
          description: o.description,
          section: o.section,
          option_group_id: o.option_group_id,
          optional: o.optional,
          snapshot_source: source
        });
      } catch (e) {
        return { ok: false, code: e.code || "bad_pricing", detail: e.message, violations: e.meta && e.meta.violations };
      }

      const added = await versions.addLine(versionId, input);
      if (!added.ok) return added;

      const age = staleness(snapshot, { policy: policyInput, now: o.now });
      return {
        ok: true,
        line: added.line,
        snapshot: snapshot,
        source: snapshot.source || source,
        deduped: deduped,
        stale: age.ok ? age.stale : null,
        age_days: age.ok ? age.age_days : null,
        version_id: versionId,
        errors: errors
      };
    }

    // Preview a line (no persist, no capture-from-network): build the line input
    // for an already-captured snapshot, with the policy's default markup applied.
    function previewLine(record, snapshot, o) {
      return tryBuildLineInput(record, snapshot, Object.assign({ policy: policyInput }, o || {}));
    }

    function ready() {
      return Promise.resolve({ ok: true, has_versions: !!versions, has_distributors: !!distributors, policy: policy() });
    }

    return {
      policy,
      previewLine,
      buildLineInput: (record, snapshot, o) => buildLineInput(record, snapshot, Object.assign({ policy: policyInput }, o || {})),
      staleness,
      addToQuote,
      ready
    };
  }

  return {
    VERSION,
    DEFAULT_POLICY,
    KINDS,
    PricingError,
    normalizePolicy,
    sellCents,
    descriptionOf,
    snapshotRefOf,
    buildLineInput,
    tryBuildLineInput,
    ageDays,
    staleness,
    createService
  };
})();
