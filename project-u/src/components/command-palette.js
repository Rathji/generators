// ============================================================================
//  Project U — command palette overlay (Phase 3, tasks 11-14)
//  A keyboard-first command surface: Ctrl/⌘+K (or the header trigger) opens an
//  accessible listbox that searches members, sections and actions in real time.
//  Enter runs the highlighted command (members deep-link straight into their
//  generator), Alt+Enter copies a member link, and Up/Down/Home/End/Esc drive
//  the whole thing without a mouse. The component owns its own focus, scroll
//  lock and teardown; callers only provide commands + an `onRun` handler.
// ============================================================================

import { h, svgIcon, mount } from "../framework/dom.js";
import { cx, truncate } from "../framework/utils.js";
import { searchCommands, groupCommands } from "../framework/commands.js";

const KIND_LABELS = {
  member: "Open",
  section: "Go",
  action: "Run",
};

export function createCommandPalette(options = {}) {
  const {
    container = typeof document !== "undefined" ? document.body : null,
    getCommands = () => [],
    onRun = null,
    placeholder = "Search generators, sections and actions…",
    emptyMessage = "No matches. Try a generator name, a section or an action.",
    label = "Command palette",
    shortcut = true,
    resetOnOpen = true,
    limit = 40,
    doc = typeof document !== "undefined" ? document : null,
  } = options;

  if (!doc) throw new Error("[pu:palette] requires a document");

  let isOpen = false;
  let results = [];
  let activeIndex = 0;
  let restoreFocus = null;
  const optionEls = [];
  let destroyed = false;

  // --------------------------------------------------------------- markup --
  const input = h("input", {
    class: "pu-palette-input",
    type: "text",
    role: "combobox",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder,
    "aria-label": label,
    "aria-expanded": "true",
    "aria-controls": "pu-palette-list",
    "aria-autocomplete": "list",
  });

  const list = h("ul", { class: "pu-palette-list", id: "pu-palette-list", role: "listbox", "aria-label": `${label} results` });
  const empty = h("p", { class: "pu-palette-empty", hidden: true });
  const closeBtn = h(
    "button",
    { class: "pu-palette-close", type: "button", "aria-label": "Close command palette", onclick: () => api.close() },
    svgIcon("close", { size: 16 })
  );

  const foot = h(
    "div",
    { class: "pu-palette-foot" },
    h("span", { class: "pu-palette-hint" }, h("kbd", {}, "↑"), h("kbd", {}, "↓"), " navigate"),
    h("span", { class: "pu-palette-hint" }, h("kbd", {}, "↵"), " run"),
    h("span", { class: "pu-palette-hint pu-palette-hint--member" }, h("kbd", {}, "Alt"), h("kbd", {}, "↵"), " copy link"),
    h("span", { class: "pu-palette-hint" }, h("kbd", {}, "Esc"), " close")
  );

  const dialog = h(
    "div",
    { class: "pu-palette", role: "dialog", "aria-modal": "true", "aria-label": label },
    h(
      "div",
      { class: "pu-palette-search" },
      svgIcon("search", { size: 18, className: "pu-palette-search-icon" }),
      input,
      h("kbd", { class: "pu-palette-esc", "aria-hidden": "true" }, "Esc"),
      closeBtn
    ),
    h("div", { class: "pu-palette-body" }, list, empty),
    foot
  );

  const root = h("div", {
    class: "pu-palette-overlay",
    hidden: true,
    onmousedown: (event) => {
      if (event.target === root) api.close();
    },
  });
  root.appendChild(dialog);

  // ---------------------------------------------------------------- render --
  function kindBadge(command) {
    return h("span", { class: "pu-palette-kind" }, KIND_LABELS[command.kind] || "Run");
  }

  function copyButton(command) {
    return h(
      "button",
      {
        class: "pu-palette-item-action",
        type: "button",
        title: `Copy a shareable link to ${command.title}`,
        "aria-label": `Copy a shareable link to ${command.title}`,
        onmousedown: (event) => event.preventDefault(),
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          const index = optionEls.findIndex((entry) => entry.command === command);
          invoke(command, { action: "copy", source: "palette" });
          if (index >= 0) setActive(index);
        },
      },
      svgIcon("copy", { size: 15 })
    );
  }

  function optionRow(command, index) {
    const selected = index === activeIndex;
    const row = h(
      "li",
      {
        class: cx("pu-palette-item", `pu-palette-item--${command.kind}`, selected && "is-active"),
        id: `pu-palette-opt-${index}`,
        role: "option",
        "aria-selected": selected ? "true" : "false",
        dataset: { index: String(index), kind: command.kind, id: command.id },
        onmousemove: () => {
          if (activeIndex !== index) setActive(index);
        },
        onclick: (event) => {
          if (event.target.closest(".pu-palette-item-action")) return;
          runActive(index);
        },
      },
      h("span", { class: "pu-palette-item-icon" }, svgIcon(command.icon, { size: 17 })),
      h(
        "span",
        { class: "pu-palette-item-text" },
        h("span", { class: "pu-palette-item-title" }, command.title),
        command.subtitle ? h("span", { class: "pu-palette-item-sub" }, command.subtitle) : null
      ),
      command.description ? h("span", { class: "pu-palette-item-desc" }, truncate(command.description, 78)) : null,
      kindBadge(command),
      command.kind === "member" ? copyButton(command) : null
    );
    if (command.accent) row.style.setProperty("--pu-palette-accent", command.accent);
    return row;
  }

  function render() {
    const commands = getCommands() || [];
    results = searchCommands(commands, input.value, { limit });
    optionEls.length = 0;

    if (!results.length) {
      mount(list);
      empty.textContent = emptyMessage;
      empty.hidden = false;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      return;
    }

    empty.hidden = true;
    input.setAttribute("aria-expanded", "true");

    const nodes = [];
    let flatIndex = 0;
    for (const bucket of groupCommands(results)) {
      nodes.push(h("li", { class: "pu-palette-group", role: "presentation" }, bucket.group));
      for (const command of bucket.commands) {
        const index = flatIndex++;
        const el = optionRow(command, index);
        optionEls.push({ el, command, index });
        nodes.push(el);
      }
    }
    mount(list, nodes);
    activeIndex = clampIndex(activeIndex);
    syncActive();
  }

  function clampIndex(index) {
    if (!results.length) return 0;
    return ((index % results.length) + results.length) % results.length;
  }

  function syncActive() {
    for (const entry of optionEls) {
      const selected = entry.index === activeIndex;
      entry.el.classList.toggle("is-active", selected);
      entry.el.setAttribute("aria-selected", selected ? "true" : "false");
    }
    const current = optionEls[activeIndex];
    if (!current) return;
    input.setAttribute("aria-activedescendant", current.el.id);
    if (typeof current.el.scrollIntoView === "function") {
      try {
        current.el.scrollIntoView({ block: "nearest" });
      } catch (_) {
        /* non-layout environment */
      }
    }
  }

  function setActive(index) {
    if (!results.length) {
      activeIndex = 0;
      return;
    }
    activeIndex = clampIndex(index);
    syncActive();
  }

  // ------------------------------------------------------------------ run --
  async function invoke(command, meta = {}) {
    if (typeof onRun !== "function") return null;
    try {
      return await onRun(command, { source: "palette", ...meta });
    } catch (error) {
      console.error("[pu:palette] command failed", error);
      return null;
    }
  }

  async function runActive(index, meta = {}) {
    const command = results[index];
    if (!command) return null;
    const result = await invoke(command, { action: meta.copy ? "copy" : "default" });
    // Copying keeps the palette open so several links can be grabbed in a row.
    if (!meta.copy) closePalette();
    return result;
  }

  // ------------------------------------------------------------- open/close --
  function openPalette() {
    if (isOpen || destroyed) return;
    isOpen = true;
    restoreFocus = doc.activeElement;
    if (resetOnOpen) input.value = "";
    activeIndex = 0;
    root.hidden = false;
    doc.body.classList.add("pu-palette-open");
    render();
    input.focus();
    if (typeof input.setSelectionRange === "function") {
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch (_) {
        /* some input types disallow selection */
      }
    }
  }

  function closePalette() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    doc.body.classList.remove("pu-palette-open");
    input.value = "";
    results = [];
    optionEls.length = 0;
    mount(list);
    if (restoreFocus && typeof restoreFocus.focus === "function" && restoreFocus.isConnected !== false) {
      try {
        restoreFocus.focus();
      } catch (_) {
        /* element may have gone away */
      }
    }
    restoreFocus = null;
  }

  function toggle() {
    if (isOpen) closePalette();
    else openPalette();
  }

  // ------------------------------------------------------------- keyboard --
  function focusables() {
    return [input, closeBtn, ...dialog.querySelectorAll(".pu-palette-item-action")].filter((el) => el && el.offsetParent !== null);
  }

  function trapFocus(event) {
    const items = focusables();
    if (!items.length) return;
    const current = items.indexOf(doc.activeElement);
    const dir = event.shiftKey ? -1 : 1;
    event.preventDefault();
    const next = items[(current + dir + items.length) % items.length] || items[0];
    next.focus();
  }

  input.addEventListener("input", () => {
    activeIndex = 0;
    render();
  });

  input.addEventListener("keydown", (event) => {
    const key = event.key;
    if (key === "ArrowDown") {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (key === "PageDown") {
      event.preventDefault();
      setActive(activeIndex + 5);
    } else if (key === "PageUp") {
      event.preventDefault();
      setActive(activeIndex - 5);
    } else if (key === "Enter") {
      event.preventDefault();
      runActive(activeIndex, { copy: event.altKey });
    } else if (key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (key === "Tab") {
      trapFocus(event);
    }
  });

  function onKeydown(event) {
    if (destroyed) return;
    const key = event.key ? event.key.toLowerCase() : "";
    const mod = event.metaKey || event.ctrlKey;
    if (shortcut && mod && key === "k") {
      event.preventDefault();
      toggle();
      return;
    }
    if (isOpen && key === "escape") {
      event.preventDefault();
      closePalette();
    }
  }

  doc.addEventListener("keydown", onKeydown);

  // ---------------------------------------------------------------- public --
  function mountPalette() {
    if (container && root && !root.isConnected) container.appendChild(root);
    return root;
  }

  const api = {
    el: root,
    input,
    list,
    dialog,
    mount: mountPalette,
    open: openPalette,
    close: closePalette,
    toggle,
    render,
    setActive,
    runActive,
    setQuery(value) {
      input.value = value == null ? "" : String(value);
      activeIndex = 0;
      render();
      return results;
    },
    get query() {
      return input.value;
    },
    get isOpen() {
      return isOpen;
    },
    get results() {
      return results;
    },
    get activeIndex() {
      return activeIndex;
    },
    get activeCommand() {
      return results[activeIndex] || null;
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener("keydown", onKeydown);
      closePalette();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  return api;
}
