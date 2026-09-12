import { $, el } from "./dom.js";
import { initTheme } from "./theme.js";

export const ICONS = {
  home: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>',
  beaker: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6.5L5.5 17A2 2 0 0 0 7.2 20h9.6a2 2 0 0 0 1.7-3L14 9.5V3"/><path d="M7 14h10"/></svg>',
  doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>',
  id: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 10h3"/><path d="M15 14h3"/><path d="M6 15.5c.7-1.2 1.8-1.8 3-1.8s2.3.6 3 1.8"/></svg>',
  layers: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
  shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  events: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7Z"/></svg>',
  link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  reconcile: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M4 7h16"/><path d="m7 7-4 6a4 4 0 0 0 8 0Z"/><path d="m17 7-4 6a4 4 0 0 0 8 0Z"/></svg>',
  sync: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>',
  conflicts: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>',
  drift: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/><path d="M2 12c.6.5 1.2 1 2.5 1C7 13 7 11 9.5 11c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/><path d="M2 18c.6.5 1.2 1 2.5 1C7 19 7 17 9.5 17c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1"/></svg>',
  bundle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.5 4.2"/><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  audit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M15 8h-5"/><path d="M15 12h-5"/></svg>',
  monitor: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-7 4 14 2.5-7H21"/></svg>',
  rpa: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M9 17h6"/></svg>',
};

export function mountShell({ config, routes }) {
  document.title = `${config.appTitle} — ${config.tagline}`;

  const logoMark = $("#puLogoMark");
  if (logoMark) logoMark.textContent = config.logoMark || config.appShortTitle || "RU";
  const appTitle = $("#puAppTitle");
  if (appTitle) appTitle.textContent = config.appTitle;
  const tagline = $("#puTagline");
  if (tagline) tagline.textContent = config.tagline;
  const versionBadge = $("#puVersionBadge");
  if (versionBadge) versionBadge.textContent = `v${config.version}`;
  const foot = $("#puSidebarFoot");
  if (foot) foot.textContent = config.branding.footer || config.copyright || config.companyName;

  const nav = $("#puNav");
  let lastGroup = null;
  const links = new Map();
  for (const route of routes) {
    if (!route.nav) continue;
    if (route.group && route.group !== lastGroup) {
      nav.appendChild(el("div.pu-nav-group", { text: route.group }));
      lastGroup = route.group;
    }
    const link = el("a.pu-nav-link", { href: `#/${route.id}`, title: route.title });
    link.innerHTML = ICONS[route.icon] || ICONS.home;
    link.appendChild(el("span", { text: route.title }));
    if (route.permission) {
      link.setAttribute("data-permission", route.permission);
      link.setAttribute("data-permission-mode", "hide");
    }
    nav.appendChild(link);
    links.set(route.id, link);
  }

  initTheme(config, $("#puThemeBtn"));

  const menuBtn = $("#menuBtn");
  const backdrop = $("#puBackdrop");
  const setNavOpen = (open) => {
    document.body.classList.toggle("pu-nav-open", open);
    if (backdrop) backdrop.hidden = !open;
    if (menuBtn) menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  if (menuBtn) menuBtn.addEventListener("click", () => setNavOpen(!document.body.classList.contains("pu-nav-open")));
  if (backdrop) backdrop.addEventListener("click", () => setNavOpen(false));
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a") && window.matchMedia("(max-width: 900px)").matches) setNavOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavOpen(false);
  });

  return {
    setActive(id) {
      for (const [routeId, link] of links) {
        if (routeId === id) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    },
    setBadge(id, count) {
      const link = links.get(id);
      if (!link) return;
      const value = Number(count) || 0;
      let badge = link.querySelector(".pu-nav-badge");
      if (value <= 0) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = el("span.pu-nav-badge");
        link.appendChild(badge);
      }
      badge.textContent = value > 99 ? "99+" : String(value);
    },
    setNavOpen,
  };
}

export function pageHead({ eyebrow, title, subtitle, actions } = {}) {
  const head = el("div.pu-page-head");
  if (eyebrow) head.appendChild(el("div.pu-eyebrow", { text: eyebrow }));
  if (title) head.appendChild(el("h1", { text: title }));
  if (subtitle) head.appendChild(el("p", { text: subtitle }));
  if (actions && actions.length) head.appendChild(el("div", { style: { "margin-top": "0.75rem", display: "flex", gap: "0.5rem", "flex-wrap": "wrap" } }, actions));
  return head;
}
