// ============================================================================
//  Project U — standardized input suite (Phase 2, task 6)
//  Accessible, reusable form controls following the Project U design language.
//  Every factory returns a `field` object: { el, input, value, setValue(),
//  setError(), clearError(), setDisabled(), focus() }.
// ============================================================================

import { h, svgIcon } from "../framework/dom.js";
import { slugify, uid, cx } from "../framework/utils.js";

function controlId(kind, name) {
  return `pu-${kind}-${slugify(name) || "field"}-${uid("x")}`;
}

function asOptions(options = []) {
  return options.map((option) =>
    typeof option === "object" && option !== null
      ? { value: String(option.value), label: option.label ?? String(option.value), disabled: !!option.disabled }
      : { value: String(option), label: String(option), disabled: false }
  );
}

function normalizeValueOf(input) {
  return input.type === "number" && input.value !== "" ? Number(input.value) : input.value;
}

function baseField(config) {
  const { kind, name, label, hint, required = false, input, control, inline = false } = config;
  if (!input.id) input.id = controlId(kind, name);
  const id = input.id;
  const hintEl = hint ? h("p", { class: "pu-field-hint", id: `${id}-hint` }, hint) : null;
  const errorEl = h("p", { class: "pu-field-error", id: `${id}-error`, hidden: true, role: "alert" });
  if (hintEl) input.setAttribute("aria-describedby", hintEl.id);

  const labelEl = h(
    "label",
    { class: "pu-field-label", for: id },
    label || name,
    required ? h("span", { class: "pu-required", "aria-hidden": "true" }, "*") : null
  );

  const root = h(
    "div",
    { class: cx("pu-field", `pu-field--${kind}`, inline && "pu-field--inline") },
    labelEl,
    hintEl,
    control,
    errorEl
  );

  const field = {
    el: root,
    input,
    name,
    kind,
    get value() {
      return config.getValue ? config.getValue(input) : normalizeValueOf(input);
    },
    set value(next) {
      if (typeof config.setValue === "function") config.setValue(next, input);
      else input.value = next == null ? "" : String(next);
    },
    setError(message) {
      errorEl.textContent = message || "";
      errorEl.hidden = !message;
      input.setAttribute("aria-invalid", message ? "true" : "false");
      root.classList.toggle("is-invalid", Boolean(message));
      return field;
    },
    clearError() {
      return field.setError("");
    },
    setDisabled(flag) {
      input.disabled = Boolean(flag);
      root.classList.toggle("is-disabled", Boolean(flag));
      return field;
    },
    focus() {
      input.focus();
      return field;
    },
  };
  return field;
}

export function textField(options = {}) {
  const {
    name = "text",
    label = "",
    hint = "",
    placeholder = "",
    value = "",
    type = "text",
    required = false,
    autocomplete = "off",
    prefix = null,
    suffix = null,
    inputMode,
    min,
    max,
    step,
    maxlength,
  } = options;

  const input = h("input", {
    class: "pu-input",
    type,
    name,
    placeholder,
    value: value == null ? "" : String(value),
    autocomplete,
    required: required || undefined,
    inputmode: inputMode,
    min,
    max,
    step,
    maxlength,
  });

  const control = prefix || suffix
    ? h(
        "div",
        { class: "pu-input-wrap" },
        prefix ? h("span", { class: "pu-input-affix" }, prefix) : null,
        input,
        suffix ? h("span", { class: "pu-input-affix" }, suffix) : null
      )
    : input;

  return baseField({ kind: "text", name, label, hint, required, input, control });
}

export function textareaField(options = {}) {
  const {
    name = "textarea",
    label = "",
    hint = "",
    placeholder = "",
    value = "",
    rows = 4,
    required = false,
    maxlength,
  } = options;
  const input = h("textarea", {
    class: "pu-input pu-textarea",
    name,
    rows,
    placeholder,
    required: required || undefined,
    maxlength,
  });
  input.value = value == null ? "" : String(value);
  return baseField({ kind: "textarea", name, label, hint, required, input, control: input });
}

export function selectField(options = {}) {
  const {
    name = "select",
    label = "",
    hint = "",
    options: rawOptions = [],
    value = "",
    placeholder = null,
    required = false,
  } = options;
  const opts = asOptions(rawOptions);
  const input = h(
    "select",
    { class: "pu-input pu-select", name, required: required || undefined },
    placeholder != null ? h("option", { value: "" }, placeholder) : null,
    opts.map((opt) =>
      h("option", { value: opt.value, disabled: opt.disabled || undefined, selected: opt.value === String(value) || undefined }, opt.label)
    )
  );
  if (value != null && value !== "") input.value = String(value);
  const control = h(
    "div",
    { class: "pu-select-wrap" },
    input,
    h("span", { class: "pu-select-chevron", "aria-hidden": "true" }, svgIcon("chevronDown", { size: 16 }))
  );
  return baseField({ kind: "select", name, label, hint, required, input, control });
}

export function toggleField(options = {}) {
  const { name = "toggle", label = "", hint = "", checked = false } = options;
  const input = h("input", { class: "pu-toggle-input", type: "checkbox", name, role: "switch" });
  input.checked = Boolean(checked);
  // The row is a <label> wrapping the (visually hidden) input so the whole
  // switch — track and text — toggles it. The input must sit directly before
  // .pu-toggle-track for the :checked + sibling styles to apply.
  const control = h(
    "label",
    { class: "pu-toggle-row" },
    input,
    h("span", { class: "pu-toggle-track", "aria-hidden": "true" }, h("span", { class: "pu-toggle-thumb" })),
    label ? h("span", { class: "pu-toggle-label" }, label) : null
  );
  const field = baseField({
    kind: "toggle",
    name,
    label: null,
    hint,
    input,
    control,
    inline: true,
    getValue: (el) => el.checked,
    setValue: (next, el) => {
      el.checked = Boolean(next);
    },
  });
  field.el.classList.add("pu-field--switch");
  field.el.querySelector(".pu-field-label")?.remove();
  return field;
}

export function checkboxField(options = {}) {
  const { name = "checkbox", label = "", hint = "", checked = false } = options;
  const input = h("input", { class: "pu-check-input", type: "checkbox", name });
  input.checked = Boolean(checked);
  const control = h(
    "label",
    { class: "pu-check-row", for: input.id || undefined },
    input,
    h("span", { class: "pu-check-box" }, svgIcon("check", { size: 13 })),
    h("span", { class: "pu-check-label" }, label)
  );
  const field = baseField({
    kind: "checkbox",
    name,
    label: null,
    hint,
    input,
    control,
    getValue: (el) => el.checked,
    setValue: (next, el) => {
      el.checked = Boolean(next);
    },
  });
  field.el.querySelector(".pu-field-label")?.remove();
  control.setAttribute("for", input.id);
  return field;
}

export function radioField(options = {}) {
  const { name = "radio", label = "", hint = "", options: rawOptions = [], value = "", inline = false } = options;
  const opts = asOptions(rawOptions);
  const radios = opts.map((opt) => {
    const id = `${controlId("radio", name)}-${slugify(opt.value)}`;
    const input = h("input", { class: "pu-radio-input", type: "radio", name, value: opt.value, id });
    input.checked = opt.value === String(value);
    return { input, node: h("label", { class: "pu-radio-row", for: id }, input, h("span", { class: "pu-radio-dot" }), h("span", {}, opt.label)) };
  });
  const control = h("div", { class: cx("pu-radio-group", inline && "pu-radio-group--inline") }, radios.map((r) => r.node));
  const first = radios[0]?.input || h("input", { type: "radio", name, hidden: true });
  const field = baseField({
    kind: "radio",
    name,
    label,
    hint,
    input: first,
    control,
    getValue: () => control.querySelector("input:checked")?.value ?? "",
    setValue: (next) => {
      for (const { input } of radios) input.checked = input.value === String(next);
    },
  });
  field.radios = radios.map((r) => r.input);
  field.el.querySelector(".pu-field-label")?.setAttribute("for", radios[0]?.input.id || "");
  return field;
}

export function button(options = {}) {
  const { label = "", variant = "primary", size = "md", type = "button", icon = null, onClick = null, block = false, disabled = false, title } = options;
  const btn = h(
    "button",
    {
      class: cx("pu-btn", `pu-btn--${variant}`, `pu-btn--${size}`, block && "pu-btn--block"),
      type,
      title,
      disabled: disabled || undefined,
      onclick: onClick || undefined,
    },
    icon ? svgIcon(icon, { size: size === "sm" ? 14 : 16 }) : null,
    label ? h("span", {}, label) : null
  );
  return btn;
}
