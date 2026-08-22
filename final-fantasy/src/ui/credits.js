// Task #165: Credit roll UI — paints the CreditRoll engine into a full-screen
// overlay. Scrolls the team listing bottom-to-top; Enter/Esc/Space or a click
// skips to the end; fires onDone when the roll completes.

import { CreditRoll } from "../engine/credits.js";

export function mountCreditsOverlay(sections, opts = {}) {
  const cps = opts.cps ?? 48;
  const roll = new CreditRoll(sections, { cps });
  const overlay = document.createElement("div");
  overlay.className = "creditsOverlay";
  const view = document.createElement("div");
  view.className = "creditsView";
  const hint = document.createElement("div");
  hint.className = "creditsHint";
  hint.textContent = "Enter / Esc to skip";
  overlay.appendChild(view);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  const style = document.createElement("style");
  style.textContent = `
    .creditsOverlay { position: fixed; inset: 0; z-index: 60; background: #000; overflow: hidden; display: flex; align-items: flex-end; justify-content: center; }
    .creditsView { position: relative; width: min(560px, 90vw); }
    .creditsRow { font-family: monospace; text-align: center; color: #cfe0ff; text-shadow: 0 0 10px rgba(120,180,255,.35); position: absolute; left: 0; right: 0; }
    .creditsRow.title { font-size: 30px; font-weight: 900; color: #f5e6b8; letter-spacing: .14em; }
    .creditsRow.subtitle { font-size: 13px; color: #8fa8e8; font-style: italic; }
    .creditsRow.section { font-size: 14px; color: #ffd24a; letter-spacing: .22em; text-transform: uppercase; }
    .creditsRow.name { font-size: 15px; }
    .creditsRow.blank { font-size: 10px; }
    .creditsHint { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); font-family: monospace; font-size: 11px; color: #5a6a92; letter-spacing: .08em; }
  `;
  document.head.appendChild(style);

  let raf = 0;
  const startedAt = performance.now();
  let done = false;
  let closed = false;

  const paint = () => {
    const t = performance.now() - startedAt;
    const viewportH = overlay.clientHeight || 300;
    const fr = roll.frame(t, viewportH);
    view.innerHTML = "";
    for (const r of fr.rows) {
      const el = document.createElement("div");
      el.className = "creditsRow " + r.kind;
      el.style.top = Math.round(r.top) + "px";
      el.textContent = r.text;
      view.appendChild(el);
    }
    if (fr.done && !done) {
      done = true;
      if (opts.onDone) opts.onDone();
    }
    if (!closed && !done) raf = requestAnimationFrame(paint);
    else if (!closed && done) {
      // Hold the final frame briefly, then finish.
      setTimeout(() => { if (!closed) close(); }, 900);
    }
  };
  raf = requestAnimationFrame(paint);

  const onKey = (e) => {
    if (closed) return;
    if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("pointerdown", () => close());

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    overlay.remove();
    style.remove();
    document.removeEventListener("keydown", onKey);
    if (opts.onClose) opts.onClose();
  }

  return { el: overlay, roll, close };
}
