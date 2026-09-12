// src/modules/std-fields.js — the shared standardized-field form builder.
//
// The Organizations station renders the standardized fields (organization kind,
// location type, contact role, configuration type, site type, diagram type, …)
// in its add/edit dialogs. The rich editor modules for the later phases — the
// site summary, the diagram editor, the domain and certificate trackers — need
// EXACTLY the same form, built from the same RECORD_FIELD_SCHEMAS, so this tiny
// module is the single place that turns a field schema into inputs.
//
// It was extracted from organizations.js (which now imports it back) to avoid a
// circular import: the editor modules are reached from the Organizations
// station, so they cannot import from it.

import { h } from "../framework/dom.js";
import { RECORD_FIELD_SCHEMAS } from "../framework/standardized.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";

// Build the standardized-field block for a record type. `initial` prefills the
// inputs with an existing record's values. Returns { node, collect, empty } —
// `collect()` reads the live controls and returns a plain patch object.
export function buildStandardizedFields(set, type, initial = {}) {
  const schema = RECORD_FIELD_SCHEMAS[type] || [];
  if (!schema.length) {
    return { node: h("div", { class: "kb-std-section", hidden: true }), collect: () => ({}), empty: true };
  }
  const row = h("div", { class: "kb-field-row" });
  const collectors = [];
  for (const f of schema) {
    const value = initial[f.key];
    let input;
    let control;
    if (f.type === "select") {
      input = h("select", { class: "kb-input", dataset: { std: f.key } });
      for (const o of f.options) input.append(h("option", { value: o.id }, o.label));
      input.value = value != null && value !== "" ? value : f.default || (f.options[0] && f.options[0].id) || "";
      collectors.push(() => ({ [f.key]: input.value }));
      control = input;
    } else if (f.type === "record") {
      const multi = Array.isArray(f.of);
      const ofs = multi ? f.of : [f.of];
      input = h("select", { class: "kb-input", dataset: { std: f.key } });
      input.append(h("option", { value: "" }, f.placeholder || "— none —"));
      for (const coll of ofs) {
        for (const r of set.records[coll] || []) {
          if (initial.id && coll === type && r.id === initial.id) continue; // never make a record its own parent
          const label = multi ? (RECORD_TYPE_META[coll] ? RECORD_TYPE_META[coll].singular : coll) + " — " + r.name : r.name;
          input.append(h("option", { value: coll + ":" + r.id }, label));
        }
      }
      const cur = value && value.type && value.id ? value.type + ":" + value.id : multi ? "" : value || "";
      input.value = cur;
      collectors.push(() => ({ [f.key]: multi ? parseRefValue(input.value) : input.value }));
      control = input;
    } else if (f.type === "multiselect") {
      const chosen = new Set(Array.isArray(value) ? value : String(value || "").split(",").map((s) => s.trim()).filter(Boolean));
      const wrap = h("div", { class: "kb-multiselect" });
      const boxes = [];
      for (const o of f.options || []) {
        const cb = h("input", { type: "checkbox", class: "kb-check", dataset: { std: f.key, opt: o.id }, title: o.description || "" });
        cb.checked = chosen.has(o.id);
        boxes.push({ id: o.id, cb });
        wrap.append(h("label", { class: "kb-multiselect-opt" }, cb, h("span", null, o.label)));
      }
      collectors.push(() => ({ [f.key]: boxes.filter((b) => b.cb.checked).map((b) => b.id) }));
      control = wrap;
    } else if (f.type === "checkbox") {
      const cb = h("input", { type: "checkbox", class: "kb-check kb-check-lg", dataset: { std: f.key } });
      cb.checked = value === true;
      collectors.push(() => ({ [f.key]: cb.checked }));
      control = h("label", { class: "kb-asset-checkbox" }, cb, h("span", null, " Yes"));
    } else if (f.type === "password") {
      input = h("input", { class: "kb-input", type: "password", placeholder: f.placeholder || "", dataset: { std: f.key } });
      input.value = value || "";
      collectors.push(() => ({ [f.key]: input.value }));
      control = input;
    } else if (f.type === "number") {
      input = h("input", { class: "kb-input", type: "number", step: "any", placeholder: f.placeholder || "", dataset: { std: f.key } });
      input.value = value == null || value === "" ? "" : String(value);
      collectors.push(() => ({ [f.key]: input.value.trim() }));
      control = input;
    } else if (f.type === "textarea") {
      input = h("textarea", { class: "kb-input", rows: 2, placeholder: f.placeholder || "", dataset: { std: f.key } });
      input.value = value || "";
      collectors.push(() => ({ [f.key]: input.value.trim() }));
      control = input;
    } else if (f.type === "date") {
      input = h("input", { class: "kb-input", type: "date", dataset: { std: f.key } });
      input.value = value || "";
      collectors.push(() => ({ [f.key]: input.value }));
      control = input;
    } else {
      input = h("input", { class: "kb-input", type: "text", placeholder: f.placeholder || "", dataset: { std: f.key } });
      input.value = value || "";
      collectors.push(() => ({ [f.key]: input.value.trim() }));
      control = input;
    }
    row.append(
      h(
        "div",
        { class: "kb-field" },
        h("span", { class: "kb-field-label", title: f.help || "" }, f.label + (f.required ? " *" : "")),
        control,
        f.help ? h("span", { class: "kb-field-help" }, f.help) : null,
      ),
    );
  }
  return {
    node: h("div", { class: "kb-std-section" }, h("div", { class: "kb-subhead" }, "Standardized fields"), row),
    collect: () => Object.assign({}, ...collectors.map((c) => c())),
    empty: false,
  };
}

// A `type:id` select value → a record reference ({type,id}) or null.
export function parseRefValue(v) {
  const s = String(v || "");
  const i = s.indexOf(":");
  if (i <= 0) return null;
  return { type: s.slice(0, i), id: s.slice(i + 1) };
}
