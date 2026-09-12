// src/pm/formkit.js — bridge between PM-U's modal editors and the template-u
// shared component suite (src/components/inputs.js).
//
// Phase 2 (tasks 6–9): every view-level form is built from the standardized
// template-u fields — textInput/textareaInput/selectInput/checkboxField — and the
// template-u `button()` factory, so all controls share ONE accessible, themed
// implementation instead of hand-rolled markup. A few PM-specific controls that
// the suite doesn't ship (colour/icon swatches, the 2-up field grid, modal
// scaffolding) are provided here on top of the same tokens.
//
// Usage:
//   const name = textInput({ name: "name", label: "Name", required: true });
//   const { el, close } = formModal({
//     title: "New thing",
//     body: [fieldStack(name)],
//     acceptLabel: "Create",
//     onAccept: () => { ... create ... },
//   });

import { h } from "../framework/dom.js";
import {
  textField,
  textareaField,
  selectField,
  checkboxField,
  button,
} from "../components/inputs.js";
import { openModal } from "./ui.js";
import { ICONS } from "./icons.js";

export { checkboxField };

// Short aliases used by the view modules.
export const textInput = textField;
export const textareaInput = textareaField;
export const selectInput = selectField;

// The template-u button factory resolves icon names against the framework icon
// set; PM-U ships a richer set (trash/pencil/flag/…). `pmIcon` builds a node the
// factory passes straight through.
export function pmIcon(name, size = 15) {
  const span = document.createElement("span");
  span.className = "ico";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = ICONS[name] || "";
  const svg = span.firstElementChild;
  if (svg) {
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.style.display = "block";
  }
  return span;
}

function nodeOf(value) {
  if (value == null || value === false) return null;
  return value.el instanceof Node ? value.el : value;
}

// A vertical stack of fields / blocks.
export function fieldStack(...fields) {
  return h("div", { class: "fk-stack" }, ...fields.map(nodeOf).filter(Boolean));
}

// A responsive 2-up grid of fields (collapses to one column on phones).
export function fieldGrid(...fields) {
  return h("div", { class: "fk-grid" }, ...fields.map(nodeOf).filter(Boolean));
}

// A labelled block for custom controls (swatches, subtask managers, …).
export function blockField(label, ...children) {
  return h("div", { class: "field" }, label ? h("label", {}, label) : null, ...children.filter(Boolean));
}

// Colour / icon swatch picker returning a field-like object ({ el, value }).
export function swatchField({ label = "Color", options = [], value = null, icons = false, name = "color" } = {}) {
  const first = options[0];
  const initial = value != null ? value : first && (first.value !== undefined ? first.value : first);
  let current = initial;
  const buttons = options.map((raw) => {
    const opt = typeof raw === "object" && raw !== null ? raw : { value: raw };
    const iconNode = icons && opt.icon ? pmIcon(opt.icon, 15) : null;
    const btn = h(
      "button",
      {
        class: "swatch" + (String(opt.value) === String(current) ? " sel" : ""),
        type: "button",
        "data-value": String(opt.value),
        title: opt.title != null ? String(opt.title) : String(opt.value),
        "aria-label": String(opt.label != null ? opt.label : opt.value),
        "aria-pressed": String(opt.value) === String(current) ? "true" : "false",
        onclick: () => {
          current = opt.value;
          sync();
        },
      },
      iconNode
    );
    if (!iconNode) btn.style.background = String(opt.value);
    return btn;
  });
  const wrap = h("div", { class: "swatches" }, buttons);
  function sync() {
    for (const b of buttons) {
      const on = b.dataset.value === String(current);
      b.classList.toggle("sel", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
  const el = h("div", { class: "field fk-swatch" }, h("label", {}, label), wrap);
  return {
    el,
    name,
    kind: "swatch",
    get value() {
      return current;
    },
    set value(next) {
      current = next;
      sync();
    },
  };
}

// A template-u `pu-btn` wired for modal footers. `icon` is a PM icon name.
export function actionButton({
  label = "",
  variant = "secondary",
  icon = null,
  id = null,
  title = null,
  className = "",
  type = "button",
  onClick = null,
  closeOnClick = false,
  close = null,
  block = false,
} = {}) {
  const btn = button({
    label,
    variant,
    type,
    block,
    title: title == null ? undefined : title,
    icon: icon ? pmIcon(icon, 15) : null,
    onClick: (event) => {
      if (onClick) onClick(event);
      if (closeOnClick && close) close();
    },
  });
  if (id) btn.id = id;
  if (className) for (const cls of className.split(/\s+/).filter(Boolean)) btn.classList.add(cls);
  return btn;
}

// Build + open a modal-card from DOM nodes. Returns { el, card, close }. `el` is
// the click-catching backdrop (so el.querySelector works as before), `card` is
// the dialog itself, and `close` fires on every close path.
function modal({ title, subtitle = "", ariaLabel = "", className = "", body = [], buttons = [], onClose = null } = {}) {
  const card = h(
    "div",
    {
      class: `modal-card ${className}`.trim(),
      role: "dialog",
      "aria-modal": "true",
      "aria-label": ariaLabel || title,
    },
    h("button", { class: "modal-x", "data-x": true, type: "button", title: "Close", "aria-label": "Close", html: ICONS.x }),
    h("h3", {}, title),
    subtitle ? h("p", { class: "modal-sub" }, subtitle) : null,
    ...(Array.isArray(body) ? body : [body]).map(nodeOf).filter(Boolean),
    buttons.length ? h("div", { class: "modal-btns" }, ...buttons.map(nodeOf).filter(Boolean)) : null
  );
  const { el, close } = openModal(card, { onClose });
  return { el, card, close };
}

// Focus the first non-button control inside a freshly-opened modal.
export function focusFirst(el, selector = "input, select, textarea") {
  setTimeout(() => {
    const target = el && el.querySelector(selector);
    if (target) target.focus();
  }, 30);
}

// Pressing Enter in a single-line input submits the modal (clicks the primary
// footer button). Textareas keep Enter for newlines.
export function submitOnEnter(el, input) {
  if (!input) return;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (input.tagName === "TEXTAREA") return;
    event.preventDefault();
    const btn = el.querySelector(".modal-btns .pu-btn--primary");
    if (btn) btn.click();
  });
}

// Standard create/edit modal: Cancel + a primary accept button. `onAccept` may
// return false to keep the dialog open (e.g. failed validation). `leftButtons`
// render before Cancel (e.g. a Delete button).
export function formModal({
  title,
  subtitle = "",
  ariaLabel = "",
  className = "",
  body = [],
  onAccept = null,
  onCancel = null,
  acceptLabel = "Save",
  acceptVariant = "primary",
  acceptIcon = null,
  cancelLabel = "Cancel",
  leftButtons = [],
  onClose = null,
} = {}) {
  const ref = { close: () => {} };
  const buttons = [
    ...leftButtons,
    actionButton({
      label: cancelLabel,
      variant: "secondary",
      onClick: () => {
        if (onCancel) onCancel();
        ref.close();
      },
    }),
    actionButton({
      label: acceptLabel,
      variant: acceptVariant,
      icon: acceptIcon,
      onClick: () => {
        if (!onAccept || onAccept() !== false) ref.close();
      },
    }),
  ];
  const m = modal({ title, subtitle, ariaLabel, className, body, buttons, onClose });
  ref.close = m.close;
  return m;
}
