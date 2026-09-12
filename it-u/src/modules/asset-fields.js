// src/modules/asset-fields.js — schema-driven rendering of a Flexible Asset's
// fields (roadmap task 12). Given an asset TYPE (from the template designer /
// shared library) it builds the matching form controls and collects their
// values — the flexible-asset counterpart of the standardized org/location/
// contact/configuration field block. Handles every field type the designer can
// define, including a record-reference picker populated from the client set.

import { h } from "../framework/dom.js";

const str = (v) => String(v == null ? "" : v);

export function renderAssetFields(type, initial = {}, set = null) {
  const fields = (type && type.fields) || [];
  if (!fields.length) {
    return {
      node: h("div", { class: "kb-asset-fields" }, h("p", { class: "kb-muted" }, "This asset type defines no fields yet.")),
      collect: () => ({}),
      empty: true,
    };
  }
  const values = initial && typeof initial === "object" ? initial : {};
  const collectors = [];
  const row = h("div", { class: "kb-field-row kb-asset-field-row" });

  for (const f of fields) {
    const value = values[f.key];
    let input;
    let control;

    if (f.type === "textarea") {
      input = h("textarea", { class: "kb-input", rows: 3, placeholder: f.placeholder || "", dataset: { af: f.key } });
      input.value = str(value);
      collectors.push(() => ({ [f.key]: input.value.trim() }));
      control = input;
    } else if (f.type === "select") {
      input = h("select", { class: "kb-input", dataset: { af: f.key } });
      if (!f.required && (value == null || value === "")) input.append(h("option", { value: "" }, "— none —"));
      for (const o of f.options || []) input.append(h("option", { value: o.id }, o.label));
      const fallback = f.default || (f.required && f.options && f.options[0] ? f.options[0].id : "");
      input.value = value != null && value !== "" ? value : fallback;
      collectors.push(() => ({ [f.key]: input.value }));
      control = input;
    } else if (f.type === "multiselect") {
      const chosen = new Set(Array.isArray(value) ? value : str(value).split(",").map((s) => s.trim()).filter(Boolean));
      const boxesWrap = h("div", { class: "kb-multiselect" });
      const boxes = [];
      for (const o of f.options || []) {
        const cb = h("input", { type: "checkbox", class: "kb-check", dataset: { af: f.key, opt: o.id } });
        cb.checked = chosen.has(o.id);
        boxes.push({ id: o.id, cb });
        boxesWrap.append(h("label", { class: "kb-multiselect-opt" }, cb, h("span", null, o.label)));
      }
      collectors.push(() => ({ [f.key]: boxes.filter((b) => b.cb.checked).map((b) => b.id) }));
      control = boxesWrap;
    } else if (f.type === "checkbox") {
      const cb = h("input", { type: "checkbox", class: "kb-check kb-check-lg", dataset: { af: f.key } });
      cb.checked = value === true;
      collectors.push(() => ({ [f.key]: cb.checked }));
      control = h("label", { class: "kb-asset-checkbox" }, cb, h("span", null, f.help ? " " : "Yes"));
    } else if (f.type === "record") {
      input = h("select", { class: "kb-input", dataset: { af: f.key } });
      input.append(h("option", { value: "" }, "— none —"));
      const list = set && set.records && set.records[f.of] ? set.records[f.of] : [];
      for (const r of list) input.append(h("option", { value: r.id }, r.name));
      if (value && !list.some((r) => r.id === value)) input.append(h("option", { value: value }, "(missing record) " + value));
      input.value = str(value);
      collectors.push(() => ({ [f.key]: input.value }));
      control = input;
    } else if (f.type === "number") {
      input = h("input", { class: "kb-input", type: "number", step: "any", placeholder: f.placeholder || "", dataset: { af: f.key } });
      input.value = value == null ? "" : str(value);
      collectors.push(() => ({ [f.key]: input.value.trim() }));
      control = input;
    } else if (f.type === "date") {
      input = h("input", { class: "kb-input", type: "date", dataset: { af: f.key } });
      input.value = str(value);
      collectors.push(() => ({ [f.key]: input.value }));
      control = input;
    } else {
      const htmlType = f.type === "email" ? "email" : f.type === "url" ? "url" : f.type === "phone" ? "tel" : "text";
      input = h("input", { class: "kb-input", type: htmlType, placeholder: f.placeholder || "", dataset: { af: f.key } });
      input.value = str(value);
      collectors.push(() => ({ [f.key]: input.value.trim() }));
      control = input;
    }

    row.append(
      h(
        "div",
        { class: "kb-field kb-asset-field" + (f.required ? " kb-asset-field--required" : "") },
        h("span", { class: "kb-field-label", title: f.help || "" }, f.label + (f.required ? " *" : "")),
        control,
        f.help ? h("span", { class: "kb-field-help" }, f.help) : null,
      ),
    );
  }

  const node = h(
    "div",
    { class: "kb-std-section kb-asset-fields" },
    h("div", { class: "kb-subhead" }, (type && type.name) || "Asset fields"),
    row,
  );
  return {
    node,
    collect: () => Object.assign({}, ...collectors.map((c) => c())),
    empty: false,
  };
}
