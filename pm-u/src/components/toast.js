// ============================================================================
//  Project U — toast / notification system (Phase 2, task 7)
//  A single global, accessible feedback channel: success / error / warning /
//  info. Toasts stack, auto-dismiss with a visible timer, and can be hovered
//  (or focused) to pause dismissal — important for reading long messages.
// ============================================================================

import { h, svgIcon, clear } from "../framework/dom.js";
import { uid } from "../framework/utils.js";

const ICON_BY_TYPE = { success: "check", error: "error", warning: "warning", info: "info" };
const ROLE_BY_TYPE = { error: "alert", warning: "alert", success: "status", info: "status" };

export function createToaster(options = {}) {
  const { container = null, duration = 4200, max = 4 } = options;
  let host = container;
  const active = new Map();

  function mount(target) {
    if (target) host = target;
    if (!host) host = document.getElementById("puToastCtn");
    if (!host) {
      host = h("div", { class: "pu-toast-ctn", role: "region", "aria-label": "Notifications" });
      document.body.appendChild(host);
    }
    return host;
  }

  function dismiss(id) {
    const entry = active.get(id);
    if (!entry) return false;
    active.delete(id);
    clearTimeout(entry.timer);
    entry.el.classList.add("is-leaving");
    const remove = () => entry.el.remove();
    entry.el.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, 400);
    return true;
  }

  function schedule(entry, ms) {
    if (entry.paused || !ms) return;
    entry.timer = setTimeout(() => dismiss(entry.id), ms);
  }

  function show(message, opts = {}) {
    const {
      type = "info",
      title = "",
      duration: customDuration,
      dismissible = true,
      action = null,
    } = opts;
    host = mount(host);

    while (active.size >= max) {
      const oldest = active.keys().next().value;
      dismiss(oldest);
    }

    const id = uid("toast");
    const ms = customDuration === undefined ? duration : customDuration;
    const typeName = ICON_BY_TYPE[type] ? type : "info";

    const timerBar = h("span", { class: "pu-toast-timer" });
    const closeBtn = dismissible
      ? h(
          "button",
          {
            class: "pu-toast-close",
            type: "button",
            "aria-label": "Dismiss notification",
            onclick: () => dismiss(id),
          },
          svgIcon("close", { size: 14 })
        )
      : null;

    const actionBtn = action
      ? h(
          "button",
          {
            class: "pu-toast-action",
            type: "button",
            onclick: () => {
              try {
                action.onClick && action.onClick();
              } finally {
                dismiss(id);
              }
            },
          },
          action.label || "View"
        )
      : null;

    const el = h(
      "div",
      {
        class: `pu-toast pu-toast--${typeName}`,
        role: ROLE_BY_TYPE[typeName],
        "aria-live": typeName === "error" || typeName === "warning" ? "assertive" : "polite",
        dataset: { toastId: id },
      },
      h("span", { class: "pu-toast-icon" }, svgIcon(ICON_BY_TYPE[typeName], { size: 18 })),
      h(
        "div",
        { class: "pu-toast-body" },
        title ? h("div", { class: "pu-toast-title" }, title) : null,
        h("div", { class: "pu-toast-msg" }, message)
      ),
      actionBtn,
      closeBtn,
      ms ? timerBar : null
    );

    const entry = { id, el, timer: null, paused: false };
    if (ms) timerBar.style.animationDuration = `${ms}ms`;

    el.addEventListener("mouseenter", () => {
      entry.paused = true;
      clearTimeout(entry.timer);
      el.classList.add("is-paused");
    });
    el.addEventListener("mouseleave", () => {
      entry.paused = false;
      el.classList.remove("is-paused");
      schedule(entry, 1200);
    });
    el.addEventListener("focusin", () => {
      entry.paused = true;
      clearTimeout(entry.timer);
    });

    host.appendChild(el);
    active.set(id, entry);
    schedule(entry, ms);
    return { id, el, dismiss: () => dismiss(id) };
  }

  const helpers = {
    show,
    dismiss,
    clear() {
      for (const id of [...active.keys()]) dismiss(id);
      if (host) clear(host);
    },
    get count() {
      return active.size;
    },
    mount,
  };
  for (const type of Object.keys(ICON_BY_TYPE)) {
    helpers[type] = (message, opts = {}) => show(message, { ...opts, type });
  }
  return helpers;
}
