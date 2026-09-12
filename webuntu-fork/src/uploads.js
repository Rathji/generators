// ============================================================================
// UPLOADS — Phase 10, Task 82
// window.Uploads — the OS-wide upload helper built on upload-plugin
// (root.uploadPlugin). Used by the File Manager right-click "Upload & get
// link", the Terminal `upload` command, and the Easy Uploads app. A successful
// upload puts the share URL into the clipboard history (Super+V) and the real
// clipboard, so "upload, then Ctrl+V anywhere" just works.
// window.AppContent["easy-uploads"] — the Easy Uploads app (Start menu →
// Internet): paste text or drop files, get a share link, keep a session list.
// ============================================================================
(function () {
  "use strict";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function toast(title, body, icon, app) {
    if (window.Notify && window.Notify.toast) window.Notify.toast(title, body, { icon: icon || "📤", app: app || "Easy Uploads" });
  }
  function play(name) {
    if (window.Sounds && window.Sounds.play) { try { window.Sounds.play(name); } catch (e) {} }
  }
  function fmtSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace(/\.0$/, "") + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, "") + " KB";
    return bytes + " B";
  }

  // ---- share URL plumbing -------------------------------------------------
  function shareUrl(url, name) {
    if (window.ClipboardHistory && window.ClipboardHistory.add) {
      try { window.ClipboardHistory.add(url); } catch (e) {}
    }
    try { navigator.clipboard.writeText(url).catch(() => {}); } catch (e) {}
    toast("Link copied", (name ? name + " — " : "") + "the share URL is on your clipboard (Super+V to browse history).", "🔗");
    return url;
  }

  // ---- core upload ---------------------------------------------------------
  const sessionHistory = [];
  function record(item) {
    sessionHistory.unshift(item);
    if (sessionHistory.length > 30) sessionHistory.pop();
    document.dispatchEvent(new CustomEvent("webuntu-uploads", { detail: item }));
  }
  function bytesForText(text) { return new TextEncoder().encode(text).length; }

  // data: URLs → Blob (uploadPlugin accepts Blobs; strings would count the
  // base64 text against the quota and the link would serve text, not the file).
  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error("Couldn't decode the data URL");
    return await res.blob();
  }

  // Upload a string, Blob/File, or data URL. Returns { ok, url, size, error }.
  // On success the URL is shared (clipboard + history) and recorded.
  async function upload(payload, opts) {
    opts = opts || {};
    const p = window.root && window.root.uploadPlugin;
    if (typeof p !== "function") return { ok: false, error: "upload-plugin unavailable" };
    let blob = null, text = null, size = 0;
    try {
      if (typeof payload === "string") {
        if (payload.startsWith("data:")) {
          blob = await dataUrlToBlob(payload);
          size = blob.size;
        } else {
          text = payload;
          size = bytesForText(payload);
        }
      } else if (payload instanceof Blob) {
        blob = payload;
        size = blob.size;
      } else {
        return { ok: false, error: "unsupported payload" };
      }
      const res = blob ? await p(blob) : await p(text);
      if (res && res.error) return { ok: false, error: res.error, size };
      const url = (res && res.url) || "";
      if (!url) return { ok: false, error: "upload returned no URL", size };
      record({ url, name: opts.name || "", size, at: Date.now() });
      shareUrl(url, opts.name);
      return { ok: true, url, size };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), size };
    }
  }

  // Upload a virtual-FS node (text content or a data-URL image).
  async function uploadNode(node) {
    if (!node) return { ok: false, error: "no file selected" };
    const content = (node.meta && node.meta.content != null) ? String(node.meta.content) : "";
    const isData = content.startsWith("data:");
    return upload(isData ? content : content, { name: node.name });
  }

  function quotaLabel() {
    let bytes = 0;
    for (const h of sessionHistory) bytes += h.size;
    return { uploadedBytes: bytes, count: sessionHistory.length };
  }

  // ==========================================================================
  // EASY UPLOADS APP
  // ==========================================================================
  function build() {
    const view = el("div", "up");
    const bar = el("div", "up-bar");
    bar.appendChild(el("div", "up-title", "📤 Easy Uploads"));
    bar.appendChild(el("div", "up-sub", "Host a file or text on Perchance's storage and get a share link."));
    view.appendChild(bar);

    // mode switch
    const modeRow = el("div", "up-modes");
    const btnText = el("button", "up-mode on", "✏️ Text");
    const btnFile = el("button", "up-mode", "📎 File");
    btnText.type = btnFile.type = "button";
    modeRow.append(btnText, btnFile);
    view.appendChild(modeRow);

    // ---- text mode ----
    const textPane = el("div", "up-pane");
    const textInput = el("textarea", "up-text");
    textInput.placeholder = "Paste any text, code or note here… (up to ~5 MB)";
    const textHint = el("div", "up-hint", "");
    const countEl = el("span", "up-count", "");
    textHint.appendChild(el("span", null, "The link is permanent — anyone with it can read the text."));
    textHint.appendChild(countEl);
    textPane.append(textInput, textHint);

    // ---- file mode ----
    const filePane = el("div", "up-pane");
    filePane.hidden = true;
    const drop = el("div", "up-drop");
    const dropIco = el("div", "up-drop-ico", "📁");
    const dropTxt = el("div", "up-drop-txt", "Drop a file here, or click to browse");
    const dropSub = el("div", "up-drop-sub", "Anything up to ~5 MB per file");
    drop.append(dropIco, dropTxt, dropSub);
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.hidden = true;
    const picked = el("div", "up-picked");
    filePane.append(drop, fileInput, picked);
    view.append(textPane, filePane);
    let chosenFiles = [];

    drop.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      chosenFiles = chosenFiles.concat([...fileInput.files]);
      renderPicked();
      fileInput.value = "";
    });
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      drop.classList.remove("over");
      if (ev.dataTransfer && ev.dataTransfer.files) {
        chosenFiles = chosenFiles.concat([...ev.dataTransfer.files]);
        renderPicked();
      }
    });

    function renderPicked() {
      picked.textContent = "";
      for (const f of chosenFiles) {
        const chip = el("div", "up-chip");
        const nm = el("span", "up-chip-name", f.name + "  ·  " + fmtSize(f.size));
        nm.title = f.name;
        const rm = el("button", "up-chip-x", "✕");
        rm.type = "button";
        rm.addEventListener("click", () => { chosenFiles = chosenFiles.filter((x) => x !== f); renderPicked(); });
        chip.append(nm, rm);
        picked.appendChild(chip);
      }
      dropSub.textContent = chosenFiles.length ? chosenFiles.length + " file(s) ready" : "Anything up to ~5 MB per file";
    }

    function setMode(m) {
      const on = m === "file";
      btnText.classList.toggle("on", !on);
      btnFile.classList.toggle("on", on);
      textPane.hidden = on;
      filePane.hidden = !on;
    }
    btnText.addEventListener("click", () => setMode("text"));
    btnFile.addEventListener("click", () => setMode("file"));

    // ---- action row ----
    const actRow = el("div", "up-act");
    const goBtn = el("button", "set-btn up-go", "🚀 Upload");
    goBtn.type = "button";
    actRow.appendChild(goBtn);
    view.appendChild(actRow);

    // ---- result ----
    const result = el("div", "up-result");
    result.hidden = true;
    const resultUrl = document.createElement("input");
    resultUrl.type = "text";
    resultUrl.className = "up-url";
    resultUrl.readOnly = true;
    const copyBtn = el("button", "up-act-sm", "📋 Copy");
    copyBtn.type = "button";
    const openBtn = el("button", "up-act-sm", "↗ Open");
    openBtn.type = "button";
    result.append(resultUrl, copyBtn, openBtn);
    view.appendChild(result);

    copyBtn.addEventListener("click", () => {
      try { navigator.clipboard.writeText(resultUrl.value).catch(() => {}); } catch (e) {}
      toast("Copied", "The link is on your clipboard.", "📋");
    });
    openBtn.addEventListener("click", () => {
      if (window.Browser && window.Browser.navigate) window.Browser.navigate(resultUrl.value);
      else window.open(resultUrl.value, "_blank", "noopener");
    });

    // ---- recent uploads ----
    const recent = el("div", "up-recent");
    view.appendChild(recent);
    function renderRecent() {
      recent.textContent = "";
      if (!sessionHistory.length) return;
      recent.appendChild(el("div", "up-recent-lbl", "🕘 This session"));
      for (const h of sessionHistory) {
        const row = el("div", "up-recent-row");
        const nm = el("span", "up-recent-name", (h.name || h.url.split("/").pop()).slice(0, 40) + "  ·  " + fmtSize(h.size));
        nm.title = h.url;
        const cp = el("button", "up-act-sm", "📋");
        cp.type = "button"; cp.title = "Copy link";
        const op = el("button", "up-act-sm", "↗");
        op.type = "button"; op.title = "Open link";
        cp.addEventListener("click", () => {
          try { navigator.clipboard.writeText(h.url).catch(() => {}); } catch (e) {}
          if (window.ClipboardHistory) window.ClipboardHistory.add(h.url);
          toast("Copied", "Link on your clipboard.", "📋");
        });
        op.addEventListener("click", () => {
          if (window.Browser && window.Browser.navigate) window.Browser.navigate(h.url);
          else window.open(h.url, "_blank", "noopener");
        });
        row.append(nm, cp, op);
        recent.appendChild(row);
      }
    }

    function setBusy(b) {
      goBtn.disabled = b;
      goBtn.textContent = b ? "⏳ Uploading…" : "🚀 Upload";
    }

    async function doUpload() {
      const textMode = !textPane.hidden;
      const items = [];
      if (textMode) {
        const t = textInput.value.trim();
        if (!t) { toast("Nothing to upload", "Type or paste some text first.", "⚠️"); return; }
        items.push({ name: "text-" + new Date().toISOString().slice(0, 10) + ".txt", payload: t });
      } else {
        if (!chosenFiles.length) { toast("Nothing to upload", "Drop a file or click to browse first.", "⚠️"); return; }
        for (const f of chosenFiles) items.push({ name: f.name, payload: f });
      }
      setBusy(true);
      let done = 0;
      for (const it of items) {
        const r = await upload(it.payload, { name: it.name });
        done++;
        if (r.ok && !result.hidden) {
          // show the latest link in the result card
        }
        if (r.ok) {
          result.hidden = false;
          resultUrl.value = r.url;
          if (items.length === 1) goBtn.textContent = "🚀 Upload another";
        } else {
          toast("Upload failed", errorLabel(r.error), "⚠️");
        }
      }
      renderRecent();
      setBusy(false);
      if (!items.length || done === 0) return;
      if (textMode) { textInput.value = ""; }
      else { chosenFiles = []; renderPicked(); }
      play("ui");
    }
    goBtn.addEventListener("click", doUpload);

    textInput.addEventListener("input", () => {
      const n = bytesForText(textInput.value);
      countEl.textContent = fmtSize(n);
    });

    // live-update recent list when a File Manager / Terminal upload happens
    document.addEventListener("webuntu-uploads", renderRecent);

    renderRecent();
    setMode(false);
    return { root: view, onClose() { document.removeEventListener("webuntu-uploads", renderRecent); } };
  }

  function errorLabel(err) {
    if (err === "over_daily_allowance") return "Daily upload allowance reached — try again tomorrow.";
    if (err === "file_too_big") return "That file is too big (limit ~5 MB).";
    if (err === "invalid_filetype") return "That file type isn't allowed.";
    return (err || "unknown error").replace(/^Error:\s*/i, "");
  }

  window.Uploads = {
    upload,
    uploadNode,
    shareUrl,
    get history() { return sessionHistory.slice(); },
    get quota() { return quotaLabel(); },
    fmtSize,
  };

  window.AppContent = window.AppContent || {};
  window.AppContent["easy-uploads"] = function () {
    const built = build();
    return { content: built.root, w: 640, h: 560, minW: 520, minH: 420, onCloseRequest: built.onClose };
  };
})();
