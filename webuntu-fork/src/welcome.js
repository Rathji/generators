// Webuntu OS — First-boot Welcome screen (post-52 Task 54)
// A one-time onboarding overlay shown right after the first unlock: intro,
// a live wallpaper picker (reuses Wallpapers.thumbnailsRow), and a few quick
// tips. "Get Started" dismisses it and sets the webuntu.welcomed flag so it
// never reappears; ticking "Show on next login" instead leaves the flag unset
// so the next unlock shows it again. session.js calls Welcome.check() from
// its unlock() path (both normal boot and ?skipBoot=1).

(function () {
  "use strict";

  const KEY = "webuntu.welcomed";

  function wasDismissed() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function markDismissed() {
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
  }

  let overlay = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- content ----------
  function buildTips() {
    const wrap = el("div", "wel-tips");
    const tips = [
      ["⌨️", "The Super key opens the Start menu; Alt+Tab cycles open windows."],
      ["🖱️", "Right-click the desktop for wallpaper, Terminal and display options."],
      ["🧩", "Software Center installs curated Perchance generators as apps."],
      ["🗑️", "Deleted files go to the Trash — restore them from the desktop icon."],
    ];
    for (const [icon, text] of tips) {
      const t = el("div", "wel-tip");
      t.appendChild(el("span", "wel-tip-ico", icon));
      t.appendChild(el("span", "wel-tip-text", text));
      wrap.appendChild(t);
    }
    return wrap;
  }

  function build() {
    overlay = el("div", "wel-overlay");
    overlay.id = "welcomeOverlay";   // matches the CSS #welcomeOverlay selector
    const card = el("div", "wel-card");

    const logo = el("div", "boot-logo", "W");   // same tile as the boot splash
    logo.style.margin = "0 auto 14px";
    card.appendChild(logo);

    card.appendChild(el("h1", "wel-title", "Welcome to Webuntu 12"));
    card.appendChild(el("p", "wel-codename", "“Perch Mint” · The Perch Desktop"));

    card.appendChild(el("p", "wel-intro",
      "Your fictional Debian-based OS is ready. Pick a look, then dig in — everything here is built on Perchance."));

    const wpSection = el("section", "wel-section");
    wpSection.appendChild(el("h2", "wel-h", "Choose a wallpaper"));
    const thumbs = (window.Wallpapers && window.Wallpapers.thumbnailsRow) ? window.Wallpapers.thumbnailsRow(null) : null;
    if (thumbs) wpSection.appendChild(thumbs);
    card.appendChild(wpSection);

    const tipsSection = el("section", "wel-section");
    tipsSection.appendChild(el("h2", "wel-h", "Quick tips"));
    tipsSection.appendChild(buildTips());
    card.appendChild(tipsSection);

    const foot = el("div", "wel-foot");
    const again = el("label", "wel-again");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    const chkText = el("span", null, "Show this screen on the next login");
    again.append(chk, chkText);
    const goBtn = el("button", "wel-go", "Get Started");
    goBtn.type = "button";
    goBtn.addEventListener("click", () => {
      if (!chk.checked) markDismissed();
      dismiss();
    });
    foot.append(again, goBtn);
    card.appendChild(foot);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const onKey = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); goBtn.click(); } };
    document.addEventListener("keydown", onKey);
    overlay._cleanup = () => document.removeEventListener("keydown", onKey);

    setTimeout(() => overlay.classList.add("on"), 40);
  }

  function dismiss() {
    if (!overlay) return;
    overlay.classList.remove("on");
    if (overlay._cleanup) overlay._cleanup();
    const o = overlay;
    setTimeout(() => o.remove(), 360);
    overlay = null;
    if (window.Sounds) window.Sounds.play("ok");
  }

  function show() {
    if (wasDismissed() || overlay) return;
    build();
  }

  // Called by session.js after every unlock. The flag keeps it one-shot per
  // install; leaving the "Show on next login" box ticked simply skips writing
  // the flag, so the next unlock shows it again.
  function check() {
    if (wasDismissed() || overlay) return;
    // Wait a beat so the desktop fade-in lands before the overlay fades in.
    setTimeout(show, 700);
  }

  window.Welcome = { show, check, dismiss };
})();
