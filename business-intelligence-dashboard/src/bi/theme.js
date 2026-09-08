/* ============================================================
   BI theme — light/dark via html[data-theme]; persisted locally.
   Charts adopt the same mode through the adapter in later phases.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const KEY = "bi-theme";

  BI.theme.get = () => {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  BI.theme.set = (mode) => {
    localStorage.setItem(KEY, mode);
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    const btn = BI.$("#biThemeBtn");
    const btnTop = BI.$("#biThemeBtnTop");
    for (const b of [btn, btnTop]) {
      if (b) {
        b.innerHTML = BI.icon(mode === "dark" ? "sun" : "moon", 18);
        b.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
        b.setAttribute("aria-label", b.title);
      }
    }
  };

  BI.theme.toggle = () => BI.theme.set(BI.theme.get() === "dark" ? "light" : "dark");
})();
