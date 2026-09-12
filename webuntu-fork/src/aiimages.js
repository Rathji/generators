// ============================================================================
// AI IMAGES — Phase 10, Task 80
// text-to-image-plugin front-end: prompt → image → save to /home/user/Pictures
// → set as wallpaper. Session history strip; Save / Wallpaper / View / Reroll.
// The plugin is imported as `generateImage` in main.pjs and called via root.
// ============================================================================
(function () {
  const RESOLUTIONS = [
    ["512x512", "Square — 512×512"],
    ["512x768", "Portrait — 512×768"],
    ["768x512", "Landscape — 768×512"],
    ["768x768", "Large — 768×768"],
  ];
  const HISTORY_MAX = 12;

  let closed = false;
  let genToken = 0;
  let current = null;          // { dataUrl, prompt }
  const history = [];          // session-only thumbnails

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(title, body, icon) {
    if (window.Notify) window.Notify.toast(title, body, { icon, app: "AI Images" });
  }
  function play(name) {
    if (window.Sounds && window.Sounds.play) { try { window.Sounds.play(name); } catch (e) {} }
  }

  function saveImage(dataUrl) {
    const folder = "/home/user/Pictures";
    const res = window.FS.resolve(folder);
    if (!window.FS.isFolder(res)) { toast("Pictures", "The Pictures folder doesn't exist yet.", "⚠️"); return; }
    let name = "ai-images-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".png";
    while (window.FS.resolve(window.FSPath.childPath(folder, name))) {
      name = "ai-images-" + Math.random().toString(36).slice(2, 8) + ".png";
    }
    window.FS.create(folder, {
      name, type: "file", icon: "🖼️",
      meta: { content: dataUrl, size: Math.floor(dataUrl.length * 0.75), modified: Date.now() },
    });
    const path = window.FSPath.childPath(folder, name);
    toast("Saved", path, "🖼️");
    if (window.Notify && window.Notify.center) window.Notify.toast("AI Images", "Saved " + name + " to Pictures", { icon: "🖼️", app: "AI Images" });
    return path;
  }

  function build() {
    const view = el("div", "aig");

    // ---- left: controls ----
    const panel = el("div", "aig-panel");
    const lbl1 = el("label", "aig-lbl", "Prompt");
    const prompt = el("textarea", "aig-prompt");
    prompt.rows = 5;
    prompt.placeholder = "Describe the image… e.g. a neon-lit cyberpunk city at night, Rathji purple and cyan palette";
    const lbl2 = el("label", "aig-lbl", "Negative prompt (optional)");
    const neg = el("input", "aig-input");
    neg.type = "text";
    neg.placeholder = "Things to avoid…";
    const resWrap = el("div", "aig-res");
    resWrap.appendChild(el("label", "aig-lbl", "Resolution"));
    const resSel = el("select", "aig-select");
    for (const [v, l] of RESOLUTIONS) {
      const o = el("option", "", l);
      o.value = v;
      resSel.appendChild(o);
    }
    resWrap.appendChild(resSel);
    const genBtn = el("button", "aig-gen", "✨ Generate");
    genBtn.type = "button";
    panel.append(lbl1, prompt, lbl2, neg, resWrap, genBtn);

    const tip = el("div", "aig-tip", "Generations usually take a few seconds. Results live in this session until you save them to Pictures.");
    panel.appendChild(tip);

    // ---- right: stage ----
    const stage = el("div", "aig-stage");
    const empty = el("div", "aig-empty");
    empty.appendChild(el("div", "aig-empty-icon", "🎨"));
    empty.appendChild(el("div", "aig-empty-txt", "Your generated image appears here."));
    const img = document.createElement("img");
    img.className = "aig-img";
    img.alt = "Generated image";
    const loading = el("div", "aig-load");
    loading.appendChild(el("div", "aig-spin"));
    const loadTxt = el("div", "aig-load-txt", "Generating…");
    loading.appendChild(loadTxt);
    stage.append(empty, img, loading);

    // ---- action bar ----
    const acts = el("div", "aig-acts");
    const saveBtn = el("button", "set-btn", "💾 Save to Pictures");
    const wallBtn = el("button", "set-btn", "🖼️ Set as wallpaper");
    const viewBtn = el("button", "set-btn", "🔍 View");
    const rerollBtn = el("button", "set-btn", "🔀 Reroll");
    saveBtn.type = wallBtn.type = viewBtn.type = rerollBtn.type = "button";
    saveBtn.disabled = wallBtn.disabled = viewBtn.disabled = rerollBtn.disabled = true;
    acts.append(saveBtn, wallBtn, viewBtn, rerollBtn);

    // ---- history strip ----
    const hist = el("div", "aig-hist");
    const histLbl = el("div", "aig-hist-lbl", "Session history");
    const histRow = el("div", "aig-hist-row");
    hist.append(histLbl, histRow);

    const body = el("div", "aig-body");
    body.append(panel, stage);
    view.append(body, acts, hist);

    // ---- behaviour ----
    function markThumbs() {
      for (const t of histRow.children) t.classList.toggle("on", t.src === (current && current.dataUrl));
    }
    function setCurrent(item) {
      current = item;
      img.src = item.dataUrl;
      img.alt = item.prompt || "Generated image";
      empty.hidden = true;
      img.hidden = false;
      loading.hidden = true;
      saveBtn.disabled = wallBtn.disabled = viewBtn.disabled = rerollBtn.disabled = false;
      markThumbs();
    }
    function addHistory(item) {
      history.unshift(item);
      if (history.length > HISTORY_MAX) history.pop();
      histRow.innerHTML = "";
      for (const h of history) {
        const t = document.createElement("img");
        t.className = "aig-thumb" + (h === current ? " on" : "");
        t.src = h.dataUrl;
        t.alt = h.prompt || "Generated image";
        t.title = (h.prompt || "Generated image") + " — click to restore";
        t.addEventListener("click", () => setCurrent(h));
        histRow.appendChild(t);
      }
    }

    async function generate() {
      const p = prompt.value.trim();
      if (!p) { toast("Prompt", "Describe the image you want first.", "✏️"); prompt.focus(); return; }
      const resolution = resSel.value;
      const negativePrompt = neg.value.trim() || undefined;
      const token = ++genToken;
      genBtn.disabled = true;
      genBtn.textContent = "⏳ Generating…";
      empty.hidden = true;
      img.hidden = true;
      loading.hidden = false;
      play("ok");
      try {
        const r = await window.root.generateImage(p, { resolution, negativePrompt, seed: Math.floor(Math.random() * 2147483647) });
        if (closed || token !== genToken) return;
        const dataUrl = typeof r === "string" && r.startsWith("data:") ? r : (r && r.dataUrl) || null;
        if (dataUrl) {
          setCurrent({ dataUrl, prompt: p });
          addHistory(current);
          play("blip");
        } else {
          loading.hidden = true;
          empty.hidden = false;
          toast("Error", "Image generation returned nothing — try again.", "⚠️");
        }
      } catch (e) {
        if (closed || token !== genToken) return;
        loading.hidden = true;
        empty.hidden = false;
        toast("Error", "Image generation failed: " + (e && e.message ? e.message : String(e)), "⚠️");
      } finally {
        if (!closed) { genBtn.disabled = false; genBtn.textContent = "✨ Generate"; }
      }
    }

    genBtn.addEventListener("click", generate);
    rerollBtn.addEventListener("click", () => { if (current) { prompt.value = current.prompt; generate(); } });
    prompt.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); } });

    saveBtn.addEventListener("click", () => { if (current) saveImage(current.dataUrl); });
    wallBtn.addEventListener("click", () => {
      if (!current) return;
      if (window.Desktop && window.Desktop.setWallpaper) {
        window.Desktop.setWallpaper(current.dataUrl);
        toast("Wallpaper", "Desktop background updated.", "🖼️");
        play("blip");
      }
    });
    viewBtn.addEventListener("click", () => {
      if (!current) return;
      if (window.ImageViewer && window.ImageViewer.openUrl) {
        window.ImageViewer.openUrl(current.dataUrl, { title: "AI Image — " + (current.prompt || "").slice(0, 40) });
      }
    });

    return { root: view, prompt, onClose() { closed = true; genToken++; } };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["ai-images"] = function () {
    const v = build();
    return {
      content: v.root,
      w: 880, h: 760, minW: 620, minH: 520,
      onCloseRequest() { v.onClose(); },
    };
  };
})();
