// src/framework/nav.js — sidebar module navigation, category tree, and the
// mobile drawer. The category tree reuses the shared loading/empty/error
// states so a broken category source degrades gracefully.

import { h, clear } from "./dom.js";
import { loadingState, emptyState, errorState } from "./states.js";
import { icons } from "./icons.js";

export function renderModuleNav(container, modules, activeId, opts = {}) {
  clear(container);
  const ul = h("ul", { class: "kb-nav-list" });
  for (const m of modules) {
    if (m.hidden) continue; // hidden modules (article/editor/admin) have no nav entry
    const isActive = m.id === activeId;
    ul.append(
      h(
        "a",
        {
          class: "kb-nav-item" + (isActive ? " active" : ""),
          href: "#/" + m.id,
          "aria-current": isActive ? "page" : null,
          dataset: { id: m.id },
          onClick: () => {
            if (opts.onSelect) opts.onSelect();
          },
        },
        h("span", { class: "kb-nav-icon", html: m.icon }),
        h("span", { class: "kb-nav-label-text" }, m.label),
        m.badge ? h("span", { class: "kb-nav-badge" }, m.badge) : null,
      ),
    );
  }
  container.append(ul);
}

export async function renderCategoryNav(container, opts) {
  const { getTree, onSelect, onError } = opts;
  clear(container);
  container.append(loadingState({ label: "Loading categories…" }));
  try {
    const tree = await getTree();
    clear(container);
    if (!Array.isArray(tree) || tree.length === 0) {
      container.append(
        emptyState({
          title: "No categories yet",
          description: "Categories help organize articles. They’ll appear here once the knowledge base has content.",
          icon: icons.folder,
        }),
      );
      return;
    }
    container.append(buildCategoryTree(tree, onSelect));
  } catch (e) {
    clear(container);
    container.append(
      errorState({
        title: "Couldn’t load categories",
        description: String((e && e.message) || e),
        onRetry: () => renderCategoryNav(container, opts),
      }),
    );
    if (onError) onError(e);
  }
}

export function buildCategoryTree(nodes, onSelect, depth = 0) {
  const ul = h("ul", { class: "kb-cat-tree", dataset: { depth } });
  for (const n of nodes) {
    const li = h("li", { class: "kb-cat-node", dataset: { id: n.id } });
    const btn = h(
      "button",
      {
        class: "kb-cat-item",
        type: "button",
        dataset: { id: n.id },
        title: "Browse " + n.label,
        onClick: () => {
          if (onSelect) onSelect(n);
        },
      },
      h("span", { class: "kb-cat-icon", html: icons.folder }),
      h("span", { class: "kb-cat-label" }, n.label),
      n.children && n.children.length ? h("span", { class: "kb-cat-count" }, String(n.children.length)) : null,
    );
    li.append(btn);
    if (n.children && n.children.length) li.append(buildCategoryTree(n.children, onSelect, depth + 1));
    ul.append(li);
  }
  return ul;
}

export function openDrawer() {
  const s = document.getElementById("kbSidebar");
  const b = document.getElementById("kbBackdrop");
  const m = document.getElementById("menuBtn");
  if (s) s.classList.add("open");
  if (b) b.hidden = false;
  if (m) m.setAttribute("aria-expanded", "true");
}

export function closeDrawer() {
  const s = document.getElementById("kbSidebar");
  const b = document.getElementById("kbBackdrop");
  const m = document.getElementById("menuBtn");
  if (s) s.classList.remove("open");
  if (b) b.hidden = true;
  if (m) m.setAttribute("aria-expanded", "false");
}
