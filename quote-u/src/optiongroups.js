// ============================================================================
// quote-u — option groups (roadmap task 11)
// ----------------------------------------------------------------------------
// An option group is a named choice on a quote version. Its selection type is
// one of:
//   * bundle   — a mutually exclusive choice: at most ONE of its lines may be
//                selected in any selection state (good/better/best, path A/B…).
//                This is the canonical name since task 56.
//   * single   — DEPRECATED alias of `bundle` (task 56). Still accepted so
//                pre-migration data reads correctly; QU_MIGRATE rewrites stored
//                `single` groups to `bundle`.
//   * multi    — any subset of its lines may be selected
//   * optional — an optional set the client may take or leave (any subset)
//
// Two invariants are enforced here, and they are the reason this module exists
// beside the totals engine:
//   1. Membership — every line item that carries an `option_group_id` must
//      reference a group that exists (and, when both carry a
//      quote_version_id, belongs to the same version). A grouped line must be
//      an option (`optional: true`) — it is something the client can choose.
//   2. The exclusive-choice limit — a `bundle` (or its deprecated `single`
//      alias) group can never have two selected lines, in ANY selection state
//      (defaults, an explicit map, or a complete selected-id list).
//      QU_TOTALS.resolveSelection REPAIRS such a state down to one line; this
//      module is what REFUSES it first, so a bad selection can never reach a
//      frozen version.
//
// The module is pure: no clock, no randomness, no storage, no network. It
// composes with QU_TOTALS (the repair authority) and QU_LINEITEMS (the line
// vocabulary) rather than duplicating either.
// ============================================================================
window.QU_OPTIONGROUPS = (function () {
  "use strict";

  const TOT = window.QU_TOTALS || null;
  const VERSION = "1.0.0";
  const SELECTION_TYPES = TOT && TOT.GROUP_TYPES ? TOT.GROUP_TYPES.slice() : ["single", "bundle", "multi", "optional"];
  const DEPRECATED_TYPES = TOT && TOT.DEPRECATED_GROUP_TYPES ? Object.assign({}, TOT.DEPRECATED_GROUP_TYPES) : { single: "bundle" };
  const DEFAULT_SELECTION_TYPE = "multi";
  // At most N selected lines per group type. `bundle` (and its deprecated
  // `single` alias) is mutually exclusive; `multi` and `optional` accept any
  // subset — the same semantics QU_TOTALS.resolveSelection applies.
  const MAX_SELECTED = { bundle: 1, single: 1, multi: Infinity, optional: Infinity };

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable option-group id" },
    { name: "quote_version_id", required: false, default: null, note: "owning quote version (null = unbound)" },
    { name: "name", required: true, note: "client-facing group name (e.g. \"Internet speed\")" },
    { name: "selection_type", required: false, default: DEFAULT_SELECTION_TYPE, note: "bundle | multi | optional (single = deprecated alias of bundle)" },
    { name: "sort_order", required: false, default: 0, note: "integer display order" },
    { name: "description", required: false, default: "", note: "optional helper text for the client" }
  ];

  class OptionGroupError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "OptionGroupError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new OptionGroupError(code, message, meta);
  }

  function genId(rand) {
    return "og-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function asString(value, name, violations) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string` });
      return "";
    }
    return value;
  }

  function asNullableString(value, name, violations) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string or null` });
      return null;
    }
    return value;
  }

  function asInt(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be an integer` });
      return def;
    }
    return value;
  }

  // ---- the group record -----------------------------------------------------

  function collect(input, opts) {
    opts = opts || {};
    const violations = [];
    if (!isPlainObject(input)) {
      return { violations: [{ field: null, code: "bad_option_group", detail: "An option group must be an object" }], record: null };
    }

    let id = input.id;
    if (id === undefined || id === null || id === "") id = opts.id || genId(opts.rand);
    else if (typeof id !== "string") {
      violations.push({ field: "id", code: "bad_id", detail: "id must be a string" });
      id = String(id);
    }

    const name = asString(input.name, "name", violations);
    if (!name.trim()) violations.push({ field: "name", code: "bad_group_name", detail: "An option group needs a name." });

    let selectionType = input.selection_type;
    if (selectionType === undefined || selectionType === null || selectionType === "") selectionType = opts.selection_type || DEFAULT_SELECTION_TYPE;
    else selectionType = String(selectionType);
    if (SELECTION_TYPES.indexOf(selectionType) === -1) {
      violations.push({
        field: "selection_type",
        code: "bad_selection_type",
        detail: `selection_type "${selectionType}" is not one of ${SELECTION_TYPES.join(" | ")}`
      });
      selectionType = DEFAULT_SELECTION_TYPE;
    }

    const record = {
      id,
      quote_version_id: asNullableString(input.quote_version_id, "quote_version_id", violations),
      name,
      selection_type: selectionType,
      sort_order: asInt(input.sort_order, "sort_order", 0, violations),
      description: asString(input.description, "description", violations)
    };

    // Carry through any unknown (non-model) fields unchanged.
    Object.keys(input).forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(record, k)) record[k] = input[k];
    });

    return { violations, record };
  }

  function validate(input, opts) {
    const out = collect(input, opts);
    return { ok: out.violations.length === 0, violations: out.violations, record: out.record };
  }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (out.violations.length) {
      const v = out.violations[0];
      fail(v.code, v.detail, { violations: out.violations });
    }
    return out.record;
  }

  // Stable ordering: sort_order, then name, then id.
  function sortGroups(groups) {
    return (groups || []).slice().sort((a, b) => {
      const sa = a && a.sort_order !== undefined ? a.sort_order : 0;
      const sb = b && b.sort_order !== undefined ? b.sort_order : 0;
      if (sa !== sb) return sa - sb;
      const na = String((a && a.name) || "");
      const nb = String((b && b.name) || "");
      if (na !== nb) return na.localeCompare(nb);
      return String(a && a.id).localeCompare(String(b && b.id));
    });
  }

  function indexById(groups) {
    const map = new Map();
    (groups || []).forEach(g => {
      if (g && g.id !== undefined && g.id !== null) map.set(String(g.id), g);
    });
    return map;
  }

  function groupsForVersion(groups, versionId) {
    if (versionId === undefined || versionId === null) return (groups || []).slice();
    return (groups || []).filter(g => g && g.quote_version_id === versionId);
  }

  function groupIdOf(line) {
    const v = line && line.option_group_id;
    return v === undefined || v === null || v === "" ? null : String(v);
  }

  function isGrouped(line) {
    return groupIdOf(line) !== null;
  }

  function selectionLimit(type) {
    return Object.prototype.hasOwnProperty.call(MAX_SELECTED, type) ? MAX_SELECTED[type] : Infinity;
  }

  // ---- selection states -----------------------------------------------------

  function normalizeSelection(selection) {
    const map = new Map();
    if (selection === undefined || selection === null) return { map, complete: false };
    if (selection instanceof Map) {
      selection.forEach((v, k) => map.set(String(k), v === true));
      return { map, complete: false };
    }
    if (Array.isArray(selection)) {
      selection.forEach(k => map.set(String(k), true));
      return { map, complete: true };
    }
    if (typeof selection === "object") {
      Object.keys(selection).forEach(k => map.set(String(k), selection[k] === true));
      return { map, complete: false };
    }
    fail("bad_selection", `Selection must be a map, object or array of line ids, got ${typeof selection}.`);
  }

  function idOf(item, index) {
    const v = item && item.id;
    return v !== undefined && v !== null ? String(v) : "line@" + index;
  }

  // The selected state of every line WITHOUT repairing single-select groups.
  // This is "any selection state" — the raw state a caller supplied — which is
  // exactly what the limit must be checked against.
  function rawSelection(lineItems, selection) {
    const items = lineItems || [];
    const norm = normalizeSelection(selection);
    const map = new Map();
    const lineIds = [];
    const byGroup = new Map();
    items.forEach((item, index) => {
      const id = idOf(item, index);
      const group = groupIdOf(item);
      const optional = (item && item.optional === true) || group !== null;
      let selected;
      if (!optional) selected = true;
      else if (norm.map.has(id)) selected = norm.map.get(id) === true;
      else if (norm.complete) selected = false;
      else if (item && item.selected !== undefined && item.selected !== null) selected = item.selected === true;
      else selected = !!(item && item.selected_by_default === true);
      map.set(id, selected);
      lineIds.push(id);
      if (group !== null) {
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(id);
      }
    });
    const selectedIds = lineIds.filter(id => map.get(id) === true);
    return { map, lineIds, selectedIds, byGroup, complete: norm.complete };
  }

  // Enforce the single-select limit (and any future finite-limit type).
  // `selection` is checked exactly as supplied — defaults included — so a state
  // that would put two lines of a single group "on" is refused.
  function checkSelection(lineItems, groups, selection) {
    const raw = rawSelection(lineItems, selection);
    const byId = indexById(groups);
    const violations = [];
    raw.byGroup.forEach((members, gid) => {
      const g = byId.get(gid);
      const type = g && g.selection_type ? g.selection_type : DEFAULT_SELECTION_TYPE;
      const limit = selectionLimit(type);
      if (limit === Infinity) return;
      const selected = members.filter(id => raw.map.get(id) === true);
      if (selected.length > limit) {
        const exclusive = type === "bundle" || type === "single";
        violations.push({
          group: gid,
          selection_type: type,
          limit,
          selected,
          code: exclusive ? (type === "single" ? "single_select_conflict" : "bundle_select_conflict") : "group_selection_exceeded",
          detail: `${type} option group "${gid}" has ${selected.length} selected lines; at most ${limit} may be selected.`
        });
      }
    });
    return {
      ok: violations.length === 0,
      violations,
      selected_ids: raw.selectedIds.slice(),
      selected_count: raw.selectedIds.length,
      by_group: raw.byGroup,
      selection: raw.map
    };
  }

  // The repair authority is QU_TOTALS.resolveSelection — one implementation
  // shared with the totals engine. This is a thin, honest delegation; the
  // fallback (used only if the totals engine is absent) repairs a single group
  // to at most one line with the same explicit > default > sort-order rule.
  function resolveSelection(lineItems, groups, selection) {
    if (TOT && typeof TOT.resolveSelection === "function") {
      return TOT.resolveSelection(lineItems, selection, groups);
    }
    const raw = rawSelection(lineItems, selection);
    const byId = indexById(groups);
    const repairs = [];
    raw.byGroup.forEach((members, gid) => {
      const g = byId.get(gid);
      const type = g && g.selection_type ? g.selection_type : DEFAULT_SELECTION_TYPE;
      if (selectionLimit(type) === Infinity) return;
      const trueMembers = members.filter(id => raw.map.get(id) === true);
      if (trueMembers.length <= 1) return;
      const explicit = trueMembers.filter(id => {
        const item = (lineItems || []).find(x => idOf(x, 0) === id);
        return item && item.selected === true;
      });
      const keeper = explicit[0] || trueMembers[0];
      const dropped = trueMembers.filter(id => id !== keeper);
      dropped.forEach(id => raw.map.set(id, false));
      repairs.push({ group: gid, kept: keeper, dropped });
    });
    const selectedIds = raw.lineIds.filter(id => raw.map.get(id) === true);
    return { map: raw.map, lineIds: raw.lineIds, selectedIds, repairs, selectedCount: selectedIds.length };
  }

  // Check first, then repair: returns the repaired, valid selection or refuses.
  function enforceSelection(lineItems, groups, selection) {
    const check = checkSelection(lineItems, groups, selection);
    if (!check.ok) return { ok: false, code: check.violations[0].code, violations: check.violations, detail: check.violations[0].detail };
    const resolved = resolveSelection(lineItems, groups, selection);
    return { ok: true, selection: resolved, selected_ids: resolved.selectedIds, repairs: resolved.repairs };
  }

  // ---- membership -----------------------------------------------------------

  // Every grouped line must reference an existing group (same version when both
  // sides carry one) and be an option.
  function validateMembership(lineItems, groups, opts) {
    opts = opts || {};
    const items = lineItems || [];
    const violations = [];
    const seen = new Set();
    (groups || []).forEach((g, i) => {
      if (!g || g.id === undefined || g.id === null) {
        violations.push({ index: i, field: "id", code: "bad_option_group", detail: "an option group has no id" });
        return;
      }
      const id = String(g.id);
      if (seen.has(id)) violations.push({ index: i, field: "id", code: "duplicate_group", detail: `option group id "${id}" is defined more than once` });
      seen.add(id);
    });

    const byId = indexById(groups);
    let grouped = 0;
    items.forEach((line, i) => {
      const gid = groupIdOf(line);
      if (gid === null) return;
      grouped++;
      const g = byId.get(gid);
      if (!g) {
        violations.push({ index: i, field: "option_group_id", code: "group_not_found", detail: `line item references option group "${gid}", which does not exist` });
        return;
      }
      if (line.quote_version_id && g.quote_version_id && line.quote_version_id !== g.quote_version_id) {
        violations.push({ index: i, field: "option_group_id", code: "group_version_mismatch", detail: `line item belongs to version "${line.quote_version_id}" but option group "${gid}" belongs to "${g.quote_version_id}"` });
      }
      if (opts.requireOptional !== false && line.optional !== true) {
        violations.push({ index: i, field: "optional", code: "grouped_line_not_optional", detail: `line item in option group "${gid}" must be optional (optional: true)` });
      }
    });

    return { ok: violations.length === 0, violations, grouped, group_count: (groups || []).length };
  }

  // The complete model check: valid group records + membership + a valid
  // selection. Returns every violation rather than the first.
  function validateAll(lineItems, groups, selection, opts) {
    opts = opts || {};
    const violations = [];
    (groups || []).forEach((g, i) => {
      const v = validate(g);
      if (!v.ok) v.violations.forEach(x => violations.push(Object.assign({ index: i }, x)));
    });
    const membership = validateMembership(lineItems, groups, opts);
    membership.violations.forEach(v => violations.push(v));
    if (selection !== undefined) {
      const check = checkSelection(lineItems, groups, selection);
      check.violations.forEach(v => violations.push(v));
    }
    return { ok: violations.length === 0, violations, membership };
  }

  return {
    VERSION,
    SELECTION_TYPES,
    DEPRECATED_TYPES,
    DEFAULT_SELECTION_TYPE,
    MAX_SELECTED,
    FIELDS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    OptionGroupError,
    genId,
    validate,
    normalize,
    sortGroups,
    indexById,
    groupsForVersion,
    groupIdOf,
    isGrouped,
    selectionLimit,
    rawSelection,
    checkSelection,
    resolveSelection,
    enforceSelection,
    validateMembership,
    validateAll
  };
})();
