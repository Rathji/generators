// Data Downloader / Host — markdown export for hosting batches.
// Adds a "Batch name" field to both cards; whenever upload results appear,
// offers to download a .md file (named after the batch) or host it to
// user.uploads.dev, showing which link belongs to which file.
(function () {
  "use strict";

  if (!window.ZDL) return;

  var EXT = {};

  function linesOfValue(v) {
    return String(v || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  EXT.fileName = function (batchName) {
    var base = ZDL.sanitize(batchName || "");
    return (base || "hosted-files") + ".md";
  };

  EXT.build = function (batchName, lines) {
    var title = (batchName || "").trim() || "Hosted files";
    var today = new Date().toLocaleDateString("en-CA");
    var out = "# " + title + "\n\n";
    out += "Hosted " + lines.length + " file" + (lines.length === 1 ? "" : "s") + " via your chosen host on " + today + ".\n\n";
    out += "## Links\n\n";
    lines.forEach(function (l) {
      var i = l.indexOf(" | ");
      if (i > 0) out += "- **" + l.slice(0, i).trim() + "** — <" + l.slice(i + 3).trim() + ">\n";
      else out += "- <" + l + ">\n";
    });
    out += "\n## Paste-able list (name | url)\n\n" + lines.join("\n") + "\n";
    return out;
  };

  EXT.download = function (fileName, content, mime) {
    var blob = new Blob([content], { type: mime || "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = fileName; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };

  EXT.jsonName = function (batchName) {
    var base = ZDL.sanitize(batchName || "");
    return (base || "hosted-files") + ".json";
  };

  EXT.buildJson = function (lines) {
    var items = ZDL.parseList(lines.join("\n"));
    return JSON.stringify(items.map(function (x) { return { name: x.name, url: x.url }; }), null, 1);
  };

  EXT.host = function (fileName, md) {
    var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    return ZDL.uploadBlob(blob, fileName, { reencode: false });
  };

  function insertAfter(el, ref) {
    if (ref && ref.parentNode) ref.parentNode.insertBefore(el, ref.nextSibling);
    else document.body.appendChild(el);
  }

  function logLines(host, msg) {
    var pre = host.querySelector(".zdl-log") || host.querySelector(".up-log");
    if (!pre) return;
    var div = document.createElement("div");
    div.textContent = msg;
    pre.appendChild(div);
    while (pre.childNodes.length > 80) pre.removeChild(pre.firstChild);
    pre.scrollTop = pre.scrollHeight;
  }

  function wireCard(host, opts) {
    var resBox = host.querySelector(opts.resSel);
    if (!resBox) return;

    var row = document.createElement("div");
    row.className = "md-row";
    var lbl = document.createElement("label");
    lbl.className = "md-lbl";
    lbl.textContent = "Batch name (optional): ";
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "md-name";
    nameInput.placeholder = "e.g. Hulk Hogan fan images";
    nameInput.autocomplete = "off";
    lbl.appendChild(nameInput);
    row.appendChild(lbl);
    insertAfter(row, host.querySelector(opts.afterRow));

    var ex = document.createElement("div");
    ex.className = "md-export";
    var fileEl = document.createElement("span");
    fileEl.className = "md-file";
    var dlBtn = document.createElement("button");
    dlBtn.type = "button"; dlBtn.className = "md-dl"; dlBtn.textContent = "Download .md";
    var jsonBtn = document.createElement("button");
    jsonBtn.type = "button"; jsonBtn.className = "md-dl"; jsonBtn.textContent = "Download .json";
    var hostBtn = document.createElement("button");
    hostBtn.type = "button"; hostBtn.className = "md-host"; hostBtn.textContent = "Host .md (get link)";
    var linkEl = document.createElement("span");
    linkEl.className = "md-link";
    ex.appendChild(fileEl);
    ex.appendChild(dlBtn);
    ex.appendChild(jsonBtn);
    ex.appendChild(hostBtn);
    ex.appendChild(linkEl);
    insertAfter(ex, host.querySelector(opts.afterRes));

    var lines = [];
    function refresh() {
      lines = linesOfValue(resBox.value);
      fileEl.textContent = EXT.fileName(nameInput.value);
      var show = lines.length > 0;
      ex.classList.toggle("on", show);
      if (!show) linkEl.textContent = "";
    }

    nameInput.addEventListener("input", refresh);

    dlBtn.addEventListener("click", function () {
      if (!lines.length) return;
      var fileName = EXT.fileName(nameInput.value);
      EXT.download(fileName, EXT.build(nameInput.value, lines));
      logLines(host, "📄 Downloaded " + fileName);
    });

    jsonBtn.addEventListener("click", function () {
      if (!lines.length) return;
      var fileName = EXT.jsonName(nameInput.value);
      EXT.download(fileName, EXT.buildJson(lines), "application/json;charset=utf-8");
      logLines(host, "📄 Downloaded " + fileName);
    });

    hostBtn.addEventListener("click", async function () {
      if (!lines.length) return;
      var fileName = EXT.fileName(nameInput.value);
      hostBtn.disabled = true;
      var res = await EXT.host(fileName, EXT.build(nameInput.value, lines));
      hostBtn.disabled = false;
      if (res.url) {
        linkEl.innerHTML = "Hosted: <a href='" + res.url + "' target='_blank' rel='noopener'>" + res.url + "</a>";
        logLines(host, "📄 Hosted markdown → " + res.url);
      } else if (res.error === "over_daily_allowance") {
        logLines(host, "✗ daily upload allowance reached — could not host the markdown. Resume later from this same browser.");
      } else {
        logLines(host, "✗ hosting markdown failed: " + res.error);
      }
    });

    var last = null;
    setInterval(function () {
      if (resBox.value !== last) { last = resBox.value; refresh(); }
    }, 400);

    if (opts.hideForDl) {
      var actSel = host.querySelector(".zdl-act");
      function syncDl() {
        row.style.display = actSel && actSel.value === "dl" ? "none" : "";
      }
      if (actSel) actSel.addEventListener("change", syncDl);
      syncDl();
    }
  }

  var main = document.querySelector("#zdl .zdl");
  if (main) wireCard(main, { resSel: ".zdl-res", afterRow: "div", afterRes: ".zdl-reswrap", hideForDl: true });

  var up = document.querySelector("#zdl-upload .up-card");
  if (up) wireCard(up, { resSel: ".up-res", afterRow: ".up-row", afterRes: ".up-reswrap", hideForDl: false });

  window.ZDL_MD = EXT;
})();
