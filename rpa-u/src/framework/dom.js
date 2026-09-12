export function $(selector, scope = document) {
  return scope.querySelector(selector);
}

export function $$(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function el(tag, props = {}, ...children) {
  const parts = String(tag).split(".");
  const node = document.createElement(parts[0] || "div");
  for (let i = 1; i < parts.length; i++) node.classList.add(parts[i]);

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class" || key === "className") {
      String(value).split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (key === "dataset") {
      for (const [d, dv] of Object.entries(value)) if (dv != null) node.dataset[d] = String(dv);
    } else if (key === "style" && typeof value === "object") {
      for (const [s, sv] of Object.entries(value)) node.style.setProperty(s, sv);
    } else if (key === "on" && typeof value === "object") {
      for (const [ev, fn] of Object.entries(value)) if (fn) node.addEventListener(ev, fn);
    } else if (key === "attrs" && typeof value === "object") {
      for (const [a, av] of Object.entries(value)) if (av != null) node.setAttribute(a, String(av));
    } else if (key === "ref" && typeof value === "function") {
      value(node);
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  appendChildren(node, children);
  return node;
}

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
