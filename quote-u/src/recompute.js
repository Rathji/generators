// ============================================================================
// quote-u — authoritative recompute from frozen data (roadmap task 29)
// ----------------------------------------------------------------------------
// The ONE place approval totals are derived. Every client surface (the builder
// preview, the portal's live total) renders *display-only* numbers; the number
// that is actually recorded at approval is recomputed here, from the frozen
// version's immutable line items and option groups, honouring the ratified rule
// that a SENT version is never re-priced and frozen data is the only source.
//
// Two guarantees the recompute gate enforces by construction:
//
//   1. The version must be frozen (`QU_VERSIONS.isFrozen`). A draft can be
//      edited and re-priced, so no approval total may ever be computed from it.
//   2. Every line item and option group must BELONG to that version
//      (`quote_version_id === version.id`). A caller cannot smuggle in a line
//      from a cheaper/older version, nor a line that was never frozen.
//
// Any client-supplied money (e.g. `claimed`, `totals`, `one_time_cents` on the
// request body) is treated as untrusted display data: it is never added to or
// substituted for the result, and is reported back as `claimed_ignored` so the
// refusal/accept of the difference is provable. The math itself is delegated to
// QU_TOTALS so there is still exactly one totals implementation.
// ============================================================================
window.QU_RECOMPUTE = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u recompute requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const CLAIM_FIELDS = ["one_time_cents", "mrr_cents", "annual_mrr_cents", "twelve_month_value_cents", "deal_value_cents"];

  class RecomputeError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "RecomputeError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new RecomputeError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function idOf(record, index) {
    if (!record || typeof record !== "object") return "record@" + index;
    return record.id !== undefined && record.id !== null ? String(record.id) : "record@" + index;
  }

  // The immutability switch. Uses QU_VERSIONS when present so there is one
  // definition of "frozen"; falls back to the same rule otherwise.
  function isFrozen(version) {
    if (window.QU_VERSIONS && typeof window.QU_VERSIONS.isFrozen === "function") return window.QU_VERSIONS.isFrozen(version);
    return !!(version && typeof version.frozen_at === "string" && version.frozen_at.length > 0);
  }

  function versionIdOf(version) {
    return version && version.id !== undefined && version.id !== null ? String(version.id) : null;
  }

  // Pure membership check: every record must carry the version's id. Returns
  // { ok, foreign } rather than throwing so callers can report precisely.
  function membership(version, records, kind) {
    const vid = versionIdOf(version);
    const foreign = [];
    const list = Array.isArray(records) ? records : [];
    list.forEach((r, i) => {
      if (!r || typeof r !== "object") {
        foreign.push({ kind, index: i, id: null, reason: "not_an_object" });
        return;
      }
      const owner = r.quote_version_id;
      if (owner === undefined || owner === null) {
        foreign.push({ kind, index: i, id: idOf(r, i), reason: "no_version" });
        return;
      }
      if (String(owner) !== vid) {
        foreign.push({ kind, index: i, id: idOf(r, i), reason: "other_version", version_id: String(owner) });
      }
    });
    return { ok: foreign.length === 0, foreign };
  }

  // Pull any client-claimed totals out of a request, without trusting them.
  // Returns a normalized object of integer cents (or null when nothing was
  // claimed). Non-integer / malformed claims are still recorded verbatim as
  // `ignored` so the caller can prove they were disregarded.
  function claimedTotals(input) {
    if (!isPlainObject(input)) return null;
    let raw = null;
    if (isPlainObject(input.claimed)) raw = input.claimed;
    else if (isPlainObject(input.totals)) raw = input.totals;
    if (raw) {
      const out = {};
      let any = false;
      for (const k of CLAIM_FIELDS) {
        if (raw[k] !== undefined && raw[k] !== null) { out[k] = raw[k]; any = true; }
      }
      if (raw.currency !== undefined && raw.currency !== null) { out.currency = raw.currency; any = true; }
      if (any) return out;
    }
    const direct = {};
    let anyDirect = false;
    for (const k of CLAIM_FIELDS) {
      if (input[k] !== undefined && input[k] !== null) { direct[k] = input[k]; anyDirect = true; }
    }
    if (anyDirect) return direct;
    return null;
  }

  function centsOf(value) {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }

  // Compare the recomputed totals with whatever the client claimed, field by
  // field. `differs` is true when any comparable field disagrees (i.e. the
  // client's number was demonstrably ignored/wrong).
  function compareClaimed(totals, claimed) {
    if (!claimed || !totals) return { differs: false, fields: [] };
    const fields = [];
    let differs = false;
    for (const k of CLAIM_FIELDS) {
      if (claimed[k] === undefined) continue;
      const a = centsOf(totals[k]);
      const b = centsOf(claimed[k]);
      const same = a !== null && b !== null && a === b;
      if (!same) differs = true;
      fields.push({ field: k, recomputed: totals[k], claimed: claimed[k], same });
    }
    if (claimed.currency !== undefined && claimed.currency !== null) {
      const same = String(totals.currency) === String(claimed.currency);
      if (!same) differs = true;
      fields.push({ field: "currency", recomputed: totals.currency, claimed: claimed.currency, same });
    }
    return { differs, fields };
  }

  // ------------------------------------------------------------------ pure core
  // recompute({ version, line_items, option_groups, selection, term_months,
  //             claimed | totals })
  //   → { ok, version_id, totals, selected_ids, claimed, claimed_ignored,
  //       claimed_compared }
  // Throws RecomputeError on an unfrozen version, foreign members, or bad input.
  function recompute(input) {
    input = input || {};
    const T = window.QU_TOTALS;
    if (!T) fail("no_totals", "QU_TOTALS is not loaded.");
    const version = input.version;
    if (!isPlainObject(version)) fail("version_required", "Recompute needs the frozen version record.");
    if (!versionIdOf(version)) fail("version_required", "Recompute needs the frozen version's id.");
    if (!isFrozen(version)) {
      fail("not_frozen", `Version ${versionIdOf(version)} is not frozen. Approval totals can only be computed from frozen data — a sent version is never re-priced (invariant I1).`, { version_id: versionIdOf(version) });
    }
    const lines = input.line_items !== undefined ? input.line_items : input.lines;
    const groups = input.option_groups !== undefined ? input.option_groups : input.groups;
    if (lines !== undefined && !Array.isArray(lines)) fail("bad_lines", "line_items must be an array.");
    if (groups !== undefined && !Array.isArray(groups)) fail("bad_groups", "option_groups must be an array.");

    const lineCheck = membership(version, lines || [], "line");
    if (!lineCheck.ok) {
      fail("foreign_line", `A line item does not belong to frozen version ${versionIdOf(version)}; approval totals may only be computed from that version's own frozen data.`, { violations: lineCheck.foreign });
    }
    const groupCheck = membership(version, groups || [], "group");
    if (!groupCheck.ok) {
      fail("foreign_group", `An option group does not belong to frozen version ${versionIdOf(version)}; approval totals may only be computed from that version's own frozen data.`, { violations: groupCheck.foreign });
    }

    const totals = T.computeTotals({
      line_items: lines || [],
      option_groups: groups || [],
      selection: input.selection,
      term_months: input.term_months,
      currency: version.currency
    });

    const claimed = claimedTotals(input);
    const compared = compareClaimed(totals, claimed);
    return {
      ok: true,
      version_id: versionIdOf(version),
      totals,
      selected_ids: totals.selection.selected_ids,
      line_count: totals.line_count,
      claimed: claimed,
      claimed_ignored: claimed !== null,
      claimed_compared: compared
    };
  }

  // ---- the service (server-side path) ---------------------------------------

  function createService(opts) {
    opts = opts || {};
    const versions = opts.versions || null;
    const optionGroups = opts.optionGroups || window.QU_OPTIONGROUPS || null;

    async function bundle(versionId) {
      if (!versions || typeof versions.getVersion !== "function") {
        return { ok: false, code: "no_versions", detail: "QU_RECOMPUTE needs the version service to load frozen data." };
      }
      const g = await versions.getVersion(versionId);
      if (!g.ok) return g;
      if (!g.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      const lines = await versions.listLines(versionId);
      if (!lines.ok) return lines;
      const groups = await versions.listGroups(versionId);
      if (!groups.ok) return groups;
      return { ok: true, version: g.version, line_items: lines.lines, option_groups: groups.groups };
    }

    // Load the frozen bundle from the store (or accept an already-loaded one),
    // then recompute. `input.claimed`/`input.totals` are never trusted.
    async function compute(input) {
      input = input || {};
      let version = input.version || null;
      let lines = input.line_items !== undefined ? input.line_items : input.lines;
      let groups = input.option_groups !== undefined ? input.option_groups : input.groups;
      if (!version || !isPlainObject(version) || lines === undefined || groups === undefined) {
        if (!version || !versionIdOf(version)) {
          return { ok: false, code: "version_required", detail: "Recompute needs the frozen version record." };
        }
        const b = await bundle(versionIdOf(version));
        if (!b.ok) return b;
        if (!version) version = b.version;
        if (lines === undefined) lines = b.line_items;
        if (groups === undefined) groups = b.option_groups;
      }
      try {
        return recompute(Object.assign({}, input, { version, line_items: lines, option_groups: groups }));
      } catch (e) {
        return { ok: false, code: e.code || "recompute_failed", detail: e.message, violations: e.meta && e.meta.violations };
      }
    }

    async function computeForVersion(versionId, selection, opts2) {
      const b = await bundle(versionId);
      if (!b.ok) return b;
      try {
        return recompute(Object.assign({}, opts2 || {}, { version: b.version, line_items: b.line_items, option_groups: b.option_groups, selection }));
      } catch (e) {
        return { ok: false, code: e.code || "recompute_failed", detail: e.message, violations: e.meta && e.meta.violations };
      }
    }

    // The self-check: recompute a version's totals from frozen data alone and
    // report whether it holds (used by the approval path and verify suites).
    async function verify(versionId) {
      const r = await computeForVersion(versionId, null);
      if (!r.ok) return r;
      return { ok: true, version_id: r.version_id, line_count: r.line_count, totals: r.totals };
    }

    function ready() {
      return Promise.resolve({ ok: true });
    }

    return { compute, computeForVersion, bundle, verify, ready, isFrozen, claimedTotals, compareClaimed, membership };
  }

  // Map a recompute refusal onto an HTTP status for the portal API.
  function statusForCode(code) {
    if (code === "not_frozen" || code === "foreign_line" || code === "foreign_group") return 409;
    if (code === "version_not_found") return 404;
    return 400;
  }

  return {
    VERSION,
    CLAIM_FIELDS,
    RecomputeError,
    isFrozen,
    membership,
    claimedTotals,
    compareClaimed,
    recompute,
    statusForCode,
    createService
  };
})();
