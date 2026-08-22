// Data Downloader / Host — "Upload from my computer" card.
// Plain multi-file picker that hosts files to user.uploads.dev via ZDL.hostItems.
(function () {
  "use strict";

  var NS = "zdl-host-picked";
  var host = document.getElementById("zdl-upload");
  if (!host || !window.ZDL) return;

  var input = host.querySelector(".up-files");
  var startBtn = host.querySelector(".up-start");
  var stopBtn = host.querySelector(".up-stop");
  var countEl = host.querySelector(".up-count");
  var reCb = host.querySelector(".up-re-cb");
  var provSel = host.querySelector(".up-provider");
  var prog = host.querySelector(".up-prog");
  var bar = host.querySelector(".up-bar");
  var statusEl = host.querySelector(".up-status");
  var resWrap = host.querySelector(".up-reswrap");
  var resBox = host.querySelector(".up-res");
  var logEl = host.querySelector(".up-log");

  var files = [];
  var opts = null;

  if (window.ZDL_PROVIDERS) window.ZDL_PROVIDERS.mountSelect(provSel);

  if (!ZDL.hostAvailable()) {
    startBtn.disabled = true;
    log("Hosting disabled — no host provider is usable. Open the ⚙ settings (top-right) to configure one.");
  }

  function log(msg) {
    var line = document.createElement("div");
    line.textContent = msg;
    logEl.appendChild(line);
    while (logEl.childNodes.length > 80) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(t) { statusEl.textContent = t; }

  function store() {
    var r = null;
    try { r = JSON.parse(localStorage.getItem(NS) || "null"); } catch (e) {}
    return (r && r.results) || {};
  }
  function renderResults() {
    resBox.value = ZDL.linesOf(store());
    resWrap.style.display = "block";
  }

  function copyText(txt) {
    try { navigator.clipboard.writeText(txt); } catch (e) {
      resBox.select();
      try { document.execCommand("copy"); } catch (e2) {}
    }
    log("Copied to clipboard.");
  }

  input.addEventListener("change", function () {
    files = Array.prototype.slice.call(input.files || []);
    countEl.textContent = files.length ? files.length + " files selected" : "";
    if (!files.length) return;
    log("Picked " + files.length + " file" + (files.length === 1 ? "" : "s") + " to host.");
    if (Object.keys(store()).length) renderResults();
  });

  startBtn.addEventListener("click", function () {
    if (!files.length) { log("Pick files first."); return; }
    var zp = window.ZDL_PROVIDERS;
    if (zp && !zp.usable(zp.current())) {
      log("No usable host provider — open the ⚙ settings (top-right) to configure one.");
      return;
    }
    if (zp) log("Hosting via " + zp.label(zp.current()));
    var seen = {};
    var items = files.map(function (f) {
      var base = f.name || "file";
      var key = seen[base] ? base + " (" + (++seen[base]) + ")" : (seen[base] = 1, base);
      return { key: key, name: base, blob: f };
    });
    prog.style.display = "block";
    stopBtn.disabled = false;
    startBtn.disabled = true;
    log("Starting upload of " + items.length + " file" + (items.length === 1 ? "" : "s") + "…");
    opts = {
      namespace: NS,
      throttleMs: 600,
      reencode: reCb.checked,
      onProgress: function (p) {
        bar.value = Math.round(p.index / p.total * 100);
        setStatus(p.index + " / " + p.total + (p.ok ? "  ·  " + p.ok + " done" : ""));
      },
      onLog: log,
      onDone: function (r) {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        renderResults();
        setStatus("Finished: " + r.ok + " ok, " + r.failed + " failed.");
        log("DONE — " + r.ok + " ok, " + r.failed + " failed.");
      }
    };
    ZDL.hostItems(items, opts);
  });

  stopBtn.addEventListener("click", function () {
    if (opts) opts.stop = true;
    log("Stopping after current file…");
  });

  host.querySelector(".up-copy").addEventListener("click", function () { copyText(resBox.value); });
  host.querySelector(".up-json").addEventListener("click", function () {
    copyText(ZDL.jsonOf(store()));
  });
  host.querySelector(".up-reset").addEventListener("click", function () {
    localStorage.removeItem(NS);
    resBox.value = "";
    resWrap.style.display = "none";
    log("Upload progress cleared.");
  });
})();
