// ============================================================
// ZDL — generalized data / file downloader + uploader (window.ZDL)
// ------------------------------------------------------------
// Dependency-free, single file, vanilla JS. Works three ways:
//
//  A) EMBED in a perchance generator (index.html):
//       <div id="zdl"></div>
//       <script src="src/downloader.js"></script>
//       <script>ZDL.mount("zdl");</script>
//     HOSTING needs at least one usable host provider — see src/providers.js
//     (user.uploads.dev via upload-plugin is the default; others via ⚙ settings).
//
//  B) CALL from your own code:
//       ZDL.downloadOne({ url, name });                 // download to disk
//       await ZDL.run(items, opts);                     // batch download
//       await ZDL.hostItems(items, opts);               // batch upload → links
//       ZDL.hostAvailable();                            // upload-plugin present?
//
//  C) CONSOLE: paste this file into any page, then use the API above.
//
// SOURCES (pluggable — see ZDL.sources)
//   - paste:  hand-pasted URL list ("name | url" or just url per line)
//   - json:   load {name,url}[] from a JSON file in your generator
//             (e.g. src/zreo-catalogue.json) — recommended for ZREO
//   - zreo:   live-extract the ZREO Archive catalogue (331 mp3s) from
//             zreoarchive.org (only where that site is fetchable)
//   Add your own:  ZDL.sources.foo = async () => [{ name, url }];
//
// ACTIONS (UI) — download to disk, host to your chosen provider (get links),
//   both, or host files straight from a folder on your computer.
//   Hosts are pluggable (src/providers.js): user.uploads.dev by default via the
//   perchance upload-plugin (~5MB/file, ~30MB/day per IP), plus gofile.io
//   (browser-native, no setup), tmpfiles.org (proxied via superFetch), and keyed
//   hosts configured in the ⚙ settings (Supabase, Firebase, Cloudinary, an
//   S3-compatible endpoint for AWS/R2/GCS/B2/Spaces…, Azure Blob via SAS URL, or
//   your own endpoint). For uploads.dev,
//   files over the size cap can be auto-re-encoded for mp3s. Hosting fails over
//   automatically: if one host rejects a file (quota, block, bad key) the next
//   usable host is tried, and every link is tagged with which host produced it
//   (see the JSON export). Runs that hit every host's limits stop gracefully and
//   can be resumed later from the same browser (progress is kept in localStorage).
//
// OPTIONS (run / hostItems / mount)
//   namespace  : localStorage key for resume progress (defaults "zdl")
//   throttleMs : delay between files (default 500)
//   reencode   : auto re-encode oversized mp3s during hosting (default true)
//   onProgress : fn({index, total, item, ok})
//   onLog      : fn(message)
//   onDone     : fn(result)
// ============================================================
(function (global) {
  "use strict";

  var VERSION = "2.0.0";

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function sanitize(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim(); }
  function safeParse(t) { try { return JSON.parse(t || "null"); } catch (e) { return null; } }

  function fileNameFromUrl(url) {
    return decodeURIComponent(String(url).split("?")[0].split("/").pop() || "download.bin");
  }

  // ---------------- core: download ONE file to disk ----------------
  function clickAnchor(url, name) {
    var a = document.createElement("a");
    a.href = url;
    a.download = name || "";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadOne(item) {
    var url = item.url, name = item.name ? sanitize(item.name) : fileNameFromUrl(url);
    try {
      var r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      var blob = await r.blob();
      if (!blob.size) throw new Error("empty response");
      var url2 = URL.createObjectURL(blob);
      clickAnchor(url2, name);
      setTimeout(function () { URL.revokeObjectURL(url2); }, 2000);
      return { size: blob.size, fallback: false, blob: blob };
    } catch (e) {
      clickAnchor(url, name);
      return { size: 0, fallback: true };
    }
  }

  // ---------------- core: hosting (needs a usable host provider) ----------------
  function hostAvailable() {
    if (global.ZDL_PROVIDERS) return global.ZDL_PROVIDERS.anyUsable();
    return !!(global.root && global.root.uploadPlugin);
  }

  async function reencodeMp3Blob(blob) {
    var decMod = await import("https://esm.sh/mpg123-decoder@1.0.0");
    var lame = await import("https://esm.sh/@breezystack/lamejs@1.2.7");
    var dec = new decMod.MPEGDecoder();
    await dec.ready;
    var res = dec.decode(new Uint8Array(await blob.arrayBuffer()));
    var cd = res.channelData, n = cd[0].length, sr = res.sampleRate;
    var kbps = Math.max(96, Math.min(128, Math.round(4.2 * 8 * 1024 * 1024 / (n / sr) / 1000)));
    var enc = new lame.Mp3Encoder(cd.length, sr, kbps);
    var chunk = 1152 * 8, parts = [];
    function to16(f) { return Math.max(-32768, Math.min(32767, Math.round(f * 32767))); }
    for (var i = 0; i < n; i += chunk) {
      var len = Math.min(chunk, n - i);
      var l = new Int16Array(len), r = new Int16Array(len);
      for (var j = 0; j < len; j++) { l[j] = to16(cd[0][i + j]); r[j] = to16(cd.length > 1 ? cd[1][i + j] : cd[0][i + j]); }
      var mp3 = enc.encodeBuffer(l, r);
      if (mp3.length) parts.push(new Uint8Array(mp3));
    }
    var fl = enc.flush();
    if (fl.length) parts.push(new Uint8Array(fl));
    var total = new Uint8Array(parts.reduce(function (a, p) { return a + p.length; }, 0));
    var o = 0;
    for (var p = 0; p < parts.length; p++) { total.set(parts[p], o); o += parts[p].length; }
    return new Blob([total], { type: "audio/mpeg" });
  }

  // user.uploads.dev upload (with mp3 re-encode fallback for oversized files).
  async function uploadViaUploads(blob, name, opts) {
    var plugin = global.root && global.root.uploadPlugin;
    if (!plugin) return { error: "user.uploads.dev unavailable (no uploadPlugin)" };
    var res = await plugin(blob);
    if (res.url) return { url: res.url, size: res.size };
    var tooBig = blob.size > 5 * 1048576 && (res.error === "file_too_big" || res.error === "network_failure");
    if (tooBig && blob.type === "audio/mpeg" && opts.reencode !== false) {
      try {
        var small = await reencodeMp3Blob(blob);
        res = await plugin(small);
        if (res.url) return { url: res.url, size: res.size, note: "re-encoded" };
      } catch (e) {
        return { error: "re-encode failed: " + String(e).slice(0, 60) };
      }
    }
    return { error: res.error };
  }

  // Upload a blob, failing over across the chain of usable providers until one
  // accepts it. Success returns { url, size, note?, provider }; a run is only
  // lost if every host rejects the file.
  async function uploadBlob(blob, name, opts) {
    var zp = global.ZDL_PROVIDERS;
    var chain = zp ? zp.failoverChain() : ["uploads"];
    var lastErr = null;
    for (var i = 0; i < chain.length; i++) {
      var pid = chain[i];
      var label = pid === "uploads" ? "user.uploads.dev" : zp.label(pid);
      var r = pid === "uploads" ? await uploadViaUploads(blob, name, opts) : await zp.upload(pid, blob, name);
      if (r.url) return { url: r.url, size: r.size, note: r.note, provider: label };
      lastErr = r.error || "failed";
      if (opts.onLog && i < chain.length - 1) {
        opts.onLog("↷ " + label + " — " + lastErr.slice(0, 70) + " · trying next host…");
      }
    }
    if (lastErr === "over_daily_allowance" && chain.length > 1) {
      return { error: "all hosts failed (last: user.uploads.dev daily allowance reached)" };
    }
    return { error: lastErr };
  }

  // item: { url?, name?, blob? }  (blob wins if both)
  async function hostOne(item, opts) {
    var blob = item.blob;
    if (!blob && item.url) {
      var r = await fetch(item.url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      blob = await r.blob();
    }
    if (!blob) throw new Error("no data");
    var up = await uploadBlob(blob, item.name, opts);
    return { name: item.name || item.url || "file", url: up.url, size: up.size, note: up.note, provider: up.provider, error: up.error };
  }

  // download + host the same bytes
  async function downloadAndHostOne(item) {
    var url = item.url, name = item.name ? sanitize(item.name) : fileNameFromUrl(url);
    var r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    var blob = await r.blob();
    var url2 = URL.createObjectURL(blob);
    clickAnchor(url2, name);
    setTimeout(function () { URL.revokeObjectURL(url2); }, 2000);
    return blob;
  }

  // ---------------- batch engines ----------------
  function run(items, opts) {
    opts = Object.assign({ namespace: "zdl", throttleMs: 500, onProgress: null, onLog: null, onDone: null }, opts);
    var store = safeParse(localStorage.getItem(opts.namespace)) || {};
    var done = new Set(store.done || []);
    return (async function () {
      var ok = 0, seen = 0, failed = [];
      for (var i = 0; i < items.length; i++) {
        if (opts.stop) break;
        var item = items[i];
        if (done.has(item.url)) continue;
        seen++;
        if (opts.onProgress) opts.onProgress({ index: seen, total: items.length, item: item, ok: ok });
        try {
          var res = await downloadOne(item);
          done.add(item.url);
          store.done = Array.from(done);
          try { localStorage.setItem(opts.namespace, JSON.stringify(store)); } catch (e) {}
          ok++;
          if (opts.onLog) opts.onLog((res.fallback ? "↻ " : "✓ ") + (item.name || item.url) + (res.size ? "  (" + (res.size / 1048576).toFixed(1) + "MB)" : ""));
        } catch (e) {
          failed.push(item);
          if (opts.onLog) opts.onLog("✗ " + (item.name || item.url) + " — " + String(e).slice(0, 80));
        }
        if (opts.onProgress) opts.onProgress({ index: seen, total: items.length, item: item, ok: ok });
        await sleep(opts.throttleMs);
      }
      var result = { ok: ok, failed: failed, total: items.length };
      if (opts.onDone) opts.onDone(result);
      return result;
    })();
  }

  // items: [{name?, url?, blob?}] — uploads each and collects links.
  // Resumable: per-item results are stored in localStorage[namespace].
  function hostItems(items, opts) {
    opts = Object.assign({ namespace: "zdl-host", throttleMs: 600, onProgress: null, onLog: null, onDone: null, reencode: true }, opts);
    var store = safeParse(localStorage.getItem(opts.namespace)) || {};
    var results = store.results || {};
    return (async function () {
      var ok = 0, failed = 0;
      for (var i = 0; i < items.length; i++) {
        if (opts.stop) break;
        var item = items[i];
        var key = item.key || item.url || item.name || ("file" + i);
        if (results[key] && results[key].url) continue;
        if (opts.onProgress) opts.onProgress({ index: i + 1, total: items.length, item: item, ok: ok });
        try {
          var r = await hostOne(item, opts);
          if (r.url) {
            results[key] = { name: r.name, url: r.url, size: r.size, note: r.note, provider: r.provider };
            ok++;
            if (opts.onLog) opts.onLog("↑ " + r.name + "  ->  " + r.url + (r.note ? "  (" + r.note + ")" : "") + (r.provider ? "  ·  via " + r.provider : ""));
          } else if (r.error === "over_daily_allowance") {
            if (opts.onLog) opts.onLog("✗ daily upload allowance reached — stopping. Resume later from this same browser.");
            opts.stop = true;
          } else {
            failed++;
            if (opts.onLog) opts.onLog("✗ " + r.name + " — " + r.error);
          }
        } catch (e) {
          failed++;
          if (opts.onLog) opts.onLog("✗ " + (item.name || item.url) + " — " + String(e).slice(0, 80));
        }
        store.results = results;
        try { localStorage.setItem(opts.namespace, JSON.stringify(store)); } catch (e) {}
        if (opts.onProgress) opts.onProgress({ index: i + 1, total: items.length, item: item, ok: ok });
        await sleep(opts.throttleMs);
      }
      var result = { ok: ok, failed: failed, total: items.length, results: results };
      if (opts.onDone) opts.onDone(result);
      return result;
    })();
  }

  // "download + host" batch: fetch once, save to disk AND upload.
  function downloadAndHost(items, opts) {
    opts = Object.assign({ namespace: "zdl-dlhost", throttleMs: 600, onProgress: null, onLog: null, onDone: null, reencode: true }, opts);
    var store = safeParse(localStorage.getItem(opts.namespace)) || {};
    var results = store.results || {};
    return (async function () {
      var ok = 0, failed = 0;
      for (var i = 0; i < items.length; i++) {
        if (opts.stop) break;
        var item = items[i];
        var key = item.url;
        if (results[key] && results[key].url) continue;
        if (opts.onProgress) opts.onProgress({ index: i + 1, total: items.length, item: item, ok: ok });
        try {
          var blob = await downloadAndHostOne(item);
          var r = await uploadBlob(blob, item.name, opts);
          if (r.url) {
            results[key] = { name: item.name || item.url, url: r.url, size: r.size, note: r.note, provider: r.provider };
            ok++;
            if (opts.onLog) opts.onLog("↓+↑ " + (item.name || item.url) + "  ->  " + r.url + (r.note ? "  (" + r.note + ")" : "") + (r.provider ? "  ·  via " + r.provider : ""));
          } else if (r.error === "over_daily_allowance") {
            if (opts.onLog) opts.onLog("✗ daily upload allowance reached — stopping. Resume later from this same browser.");
            opts.stop = true;
          } else {
            failed++;
            if (opts.onLog) opts.onLog("✗ " + (item.name || item.url) + " — upload: " + r.error);
          }
        } catch (e) {
          failed++;
          if (opts.onLog) opts.onLog("✗ " + (item.name || item.url) + " — " + String(e).slice(0, 80));
        }
        store.results = results;
        try { localStorage.setItem(opts.namespace, JSON.stringify(store)); } catch (e) {}
        if (opts.onProgress) opts.onProgress({ index: i + 1, total: items.length, item: item, ok: ok });
        await sleep(opts.throttleMs);
      }
      var result = { ok: ok, failed: failed, total: items.length, results: results };
      if (opts.onDone) opts.onDone(result);
      return result;
    })();
  }

  // format helpers for the link results
  function linesOf(results) {
    var keys = Object.keys(results);
    return keys.map(function (k) { return (results[k].name || k) + " | " + results[k].url; }).join("\n");
  }
  function jsonOf(results) {
    var keys = Object.keys(results);
    return JSON.stringify(keys.map(function (k) {
      var r = results[k];
      var o = { name: r.name || k, url: r.url, size: r.size };
      if (r.note) o.note = r.note;
      if (r.provider) o.provider = r.provider;
      return o;
    }), null, 1);
  }

  // ---------------- paste parser ----------------
  // Lines: "url"  |  "name | url"  |  "name = url"  |  "name: url"
  function parseList(text) {
    return String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (l) {
        var m = l.match(/^(.*?)\s*(?:\||=>|=|:)\s*(https?:\/\/\S+)$/i);
        return m ? { name: m[1].trim(), url: m[2] } : { name: "", url: l };
      })
      .filter(function (x) { return /^https?:\/\//i.test(x.url); });
  }

  function stringify(items) {
    return items.map(function (it) { return (it.name ? it.name + " | " : "") + it.url; }).join("\n");
  }

  // ---------------- sources ----------------
  var sources = {};

  // Local JSON: array of {name,url} / {name|url} / "name":"url" maps, or a
  // wrapper {items/tracks/files/urls/catalogue/songs:[...]} or the zreo
  // shape {albums:[{name,playlist:[{title,mp3}]}]}.
  sources.json = async function (fileUrl) {
    var r = await fetch(fileUrl);
    if (!r.ok) throw new Error("HTTP " + r.status + " loading " + fileUrl);
    var data = await r.json();
    var items = [];
    function push(u, n) { if (/^https?:\/\//i.test(u)) items.push({ name: n || "", url: u }); }
    if (Array.isArray(data)) {
      data.forEach(function (x) {
        if (typeof x === "string") push(x);
        else if (x && x.url) push(x.url, x.name || x.title || x.filename);
        else if (x && typeof x === "object") Object.keys(x).forEach(function (k) { push(x[k], k); });
      });
    } else if (data && typeof data === "object") {
      var list = data.items || data.tracks || data.files || data.urls || data.catalogue || data.songs;
      if (Array.isArray(list)) list.forEach(function (x) {
        if (typeof x === "string") push(x);
        else if (x && x.url) push(x.url, x.name || x.title);
        else if (x && typeof x === "object") Object.keys(x).forEach(function (k) { push(x[k], k); });
      });
      if (Array.isArray(data.albums)) {
        data.albums.forEach(function (a) {
          (a.playlist || []).forEach(function (t, n) {
            push(t.mp3 || t.url, a.name + " - " + String(n + 1).padStart(2, "0") + " - " + (t.title || t.name || ""));
          });
        });
      }
    }
    return items;
  };

  // ZREO Archive (zreoarchive.org) — live extraction (works where that
  // site is fetchable, e.g. its own page / console).
  sources.zreo = async function (baseOrigin) {
    baseOrigin = baseOrigin || location.origin;
    var home = await (await fetch(baseOrigin)).text();
    var m = home.match(/src="(\/assets\/app-[^"]+\.js)"/);
    if (!m) throw new Error("No ZREO app bundle found at " + baseOrigin);
    var bundle = await (await fetch(baseOrigin + m[1])).text();

    var albumsMeta = [];
    var re = /slug:`([^`]+)`,name:`([^`]+)`/g, am;
    while ((am = re.exec(bundle))) if (am[1] !== "all") albumsMeta.push({ slug: am[1], name: am[2], pos: am.index });

    var rawTracks = [];
    var objRe = /\{([^{}]*)\}/g, om;
    while ((om = objRe.exec(bundle))) {
      var mp3 = om[1].match(/mp3:`([^`]+)`/);
      if (!mp3) continue;
      var title = om[1].match(/title:`([^`]+)`/);
      rawTracks.push({ title: title ? title[1] : "Track", mp3: mp3[1], pos: om.index });
    }

    var items = [];
    albumsMeta.forEach(function (a, idx) {
      var end = idx + 1 < albumsMeta.length ? albumsMeta[idx + 1].pos : bundle.length;
      var inAlbum = rawTracks.filter(function (t) { return t.pos > a.pos && t.pos < end; });
      inAlbum.forEach(function (t, n) {
        items.push({ name: a.name + " - " + String(n + 1).padStart(2, "0") + " - " + t.title + ".mp3", url: t.mp3 });
      });
    });
    if (!items.length) throw new Error("Extraction found no tracks (site may have changed).");
    return items;
  };
  sources.zreo.label = "ZREO Archive (zreoarchive.org, 331 mp3s)";
  sources.json.label = "Local JSON file in this generator";

  // ---------------- UI ----------------
  var ACTIONS = {
    dl: "Download to my computer",
    dlhost: "Download + host to uploads.dev",
    host: "Host to uploads.dev (get links)",
    hostfiles: "Host files from my computer"
  };

  function mount(el, opts) {
    var host = typeof el === "string" ? document.getElementById(el) : el;
    if (!host) throw new Error("ZDL.mount: element not found: " + el);
    opts = Object.assign({
      namespace: "zdl", hostNamespace: "zdl-host", dlhostNamespace: "zdl-dlhost",
      throttleMs: 500, jsonPath: "src/zreo-catalogue.json", reencode: true
    }, opts);

    var canHost = hostAvailable();

    host.innerHTML =
      "<div class='zdl' style='font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;text-align:left;color:#ddd;background:#141a16;border:1px solid #2a352c;border-radius:10px;padding:16px 18px;'>" +
        "<h2 style='margin:0 0 2px;font-size:16px;color:#d4a832;'>Data Downloader / Host</h2>" +
        "<p style='margin:0 0 12px;font-size:12px;color:#9aa;'>" +
          (canHost
            ? "Download files, or host them on your chosen provider and get back the links. Hosting fails over automatically to your other configured hosts, and every link is tagged with which host produced it. Resume-safe (progress kept in this browser). If asked to allow multiple downloads → click <b>Allow</b>."
            : "Download files to your computer (hosting disabled — no host provider is usable: open the <b>⚙ settings</b> top-right to configure one, or add <code>uploadPlugin = {import:upload-plugin}</code> to main.pjs for user.uploads.dev).") +
        "</p>" +
        "<div style='display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;'>" +
          "<label style='font-size:12px;color:#9aa;'>Action: " +
            "<select class='zdl-act' style='background:#1d2620;color:#eee;border:1px solid #3a463d;border-radius:5px;padding:4px 8px;'>" +
              Object.keys(ACTIONS).map(function (k) {
                return "<option value='" + k + "'" + ((!canHost && k !== "dl") ? " disabled" : "") + ">" + ACTIONS[k] + "</option>";
              }).join("") +
            "</select>" +
          "</label>" +
          "<label style='font-size:12px;color:#9aa;'>Source: " +
            "<select class='zdl-src' style='background:#1d2620;color:#eee;border:1px solid #3a463d;border-radius:5px;padding:4px 8px;'>" +
              "<option value='paste'>Paste URL list</option>" +
              "<option value='json'>Local JSON file</option>" +
              "<option value='zreo'>ZREO Archive (live)</option>" +
            "</select>" +
          "</label>" +
          "<label class='zdl-provider-wrap' style='font-size:12px;color:#9aa;'>Host via: " +
            "<select class='zdl-provider' style='background:#1d2620;color:#eee;border:1px solid #3a463d;border-radius:5px;padding:4px 8px;'></select>" +
          "</label>" +
          "<label class='zdl-re' style='font-size:12px;color:#9aa;display:none;'>" +
            "<input type='checkbox' class='zdl-re-cb'" + (opts.reencode ? " checked" : "") + "> Re-encode oversized mp3s" +
          "</label>" +
        "</div>" +
        "<input type='file' class='zdl-files' webkitdirectory multiple style='display:none;margin-bottom:10px;'>" +
        "<textarea class='zdl-box' rows='8' spellcheck='false' placeholder='" +
          "One URL per line — optionally prefixed with a filename:\n" +
          "My Song.mp3 | https://example.com/files/song.mp3\n" +
          "or just:  https://example.com/files/song.mp3" +
        "' style='display:block;width:100%;box-sizing:border-box;margin:0 0 10px;background:#0d120e;color:#dfe;border:1px solid #2a352c;border-radius:6px;font-family:monospace;font-size:12px;padding:8px;'></textarea>" +
        "<div style='display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;'>" +
          "<button class='zdl-load' style='background:#2a352c;color:#ddd;border:1px solid #3a463d;border-radius:6px;padding:8px 14px;cursor:pointer;'>Load source</button>" +
          "<button class='zdl-start' style='background:#d4a832;color:#111;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer;'>Start</button>" +
          "<button class='zdl-stop' style='background:#2a352c;color:#ddd;border:1px solid #3a463d;border-radius:6px;padding:8px 14px;cursor:pointer;' disabled>Stop</button>" +
          "<span class='zdl-count' style='font-size:12px;color:#9aa;'></span>" +
        "</div>" +
        "<div class='zdl-progress' style='display:none;margin-bottom:8px;'>" +
          "<progress class='zdl-bar' max='100' value='0' style='width:100%;accent-color:#d4a832;'></progress>" +
          "<div class='zdl-status' style='font-size:12px;color:#9aa;margin-top:2px;'></div>" +
        "</div>" +
        "<div class='zdl-reswrap' style='display:none;margin-bottom:8px;'>" +
          "<div style='font-size:12px;color:#9aa;margin-bottom:4px;'>Uploaded links — copy and paste them back into the chat (name | url per line):</div>" +
          "<textarea class='zdl-res' rows='8' readonly spellcheck='false' style='display:block;width:100%;box-sizing:border-box;background:#0d120e;color:#dfe;border:1px solid #2a352c;border-radius:6px;font-family:monospace;font-size:11px;padding:8px;'></textarea>" +
          "<div style='display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;'>" +
            "<button class='zdl-copy' data-what='lines' style='background:#d4a832;color:#111;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;'>Copy links</button>" +
            "<button class='zdl-copy' data-what='json' style='background:#2a352c;color:#ddd;border:1px solid #3a463d;border-radius:6px;padding:6px 12px;cursor:pointer;'>Copy JSON</button>" +
            "<button class='zdl-reset' style='background:#2a352c;color:#ddd;border:1px solid #3a463d;border-radius:6px;padding:6px 12px;cursor:pointer;'>Reset progress</button>" +
          "</div>" +
        "</div>" +
        "<pre class='zdl-log' style='max-height:180px;overflow:auto;margin:0;background:#0d120e;border:1px solid #2a352c;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;color:#9aa;white-space:pre-wrap;'>" +
          "<i>Nothing yet. Pick an action + source, then Start.</i>" +
        "</pre>" +
      "</div>";

    var actSel = host.querySelector(".zdl-act");
    var srcSel = host.querySelector(".zdl-src");
    var box = host.querySelector(".zdl-box");
    var fileInput = host.querySelector(".zdl-files");
    var reCb = host.querySelector(".zdl-re-cb");
    var reWrap = host.querySelector(".zdl-re");
    var loadBtn = host.querySelector(".zdl-load");
    var startBtn = host.querySelector(".zdl-start");
    var stopBtn = host.querySelector(".zdl-stop");
    var countEl = host.querySelector(".zdl-count");
    var logEl = host.querySelector(".zdl-log");
    var prog = host.querySelector(".zdl-progress");
    var bar = host.querySelector(".zdl-bar");
    var statusEl = host.querySelector(".zdl-status");
    var resWrap = host.querySelector(".zdl-reswrap");
    var resBox = host.querySelector(".zdl-res");
    var providerWrap = host.querySelector(".zdl-provider-wrap");
    var providerSel = host.querySelector(".zdl-provider");
    if (global.ZDL_PROVIDERS) global.ZDL_PROVIDERS.mountSelect(providerSel);

    var jobItems = [];
    var localFiles = [];
    var jobOpts = null;

    function log(msg) {
      var line = document.createElement("div");
      line.textContent = msg;
      logEl.appendChild(line);
      while (logEl.childNodes.length > 80) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function setStatus(txt) { statusEl.textContent = txt; }
    function showCount(n) { countEl.textContent = n ? n + " files ready" : ""; }
    function sourceLabel(name) { return (sources[name] && sources[name].label) || name; }
    function renderResults(results) {
      resBox.value = linesOf(results);
      resWrap.style.display = "block";
    }
    function copyText(txt) {
      try { navigator.clipboard.writeText(txt); } catch (e) {
        resBox.select();
        try { document.execCommand("copy"); } catch (e2) {}
      }
      log("Copied to clipboard.");
    }

    function showActionUI() {
      var act = actSel.value;
      var isFiles = act === "hostfiles";
      box.style.display = isFiles ? "none" : "block";
      srcSel.style.display = isFiles ? "none" : "";
      loadBtn.style.display = isFiles ? "none" : "";
      reWrap.style.display = (act === "host" || act === "dlhost") ? "" : "none";
      fileInput.style.display = isFiles ? "block" : "none";
      if (providerWrap) providerWrap.style.display = (act === "dl") ? "none" : "";
    }

    function updateActionOptions() {
      var can = hostAvailable();
      Object.keys(ACTIONS).forEach(function (k) {
        var opt = actSel.querySelector('option[value="' + k + '"]');
        if (opt) opt.disabled = (k !== "dl") && !can;
      });
    }
    if (global.ZDL_PROVIDERS) global.ZDL_PROVIDERS.onChange(updateActionOptions);

    srcSel.addEventListener("change", function () {
      box.placeholder = srcSel.value === "paste"
        ? 'One URL per line — optionally prefixed with a filename:\nMy Song.mp3 | https://example.com/files/song.mp3'
        : "Source loads when you press \"Load source\".";
      if (srcSel.value !== "paste") box.value = "";
    });

    actSel.addEventListener("change", function () { showActionUI(); });
    showActionUI();

    fileInput.addEventListener("change", function () {
      localFiles = Array.prototype.slice.call(this.files || []);
      showCount(localFiles.length);
      log("Picked " + localFiles.length + " file" + (localFiles.length === 1 ? "" : "s") + " to host.");
      if (resWrap.style.display === "block") {
        // show already-uploaded subset
        var ns = opts.hostNamespace;
        var store = safeParse(localStorage.getItem(ns)) || {};
        var doneHere = (store.results || {});
        renderResults(doneHere);
      }
    });

    loadBtn.addEventListener("click", async function () {
      loadBtn.disabled = true;
      try {
        var items;
        if (srcSel.value === "json") items = await sources.json(opts.jsonPath);
        else if (srcSel.value === "zreo") items = await sources.zreo();
        else items = parseList(box.value);
        jobItems = items;
        if (srcSel.value === "paste") box.value = stringify(items);
        else box.value = stringify(items).slice(0, 5000) + (items.length ? "\n… (" + items.length + " files)" : "");
        showCount(items.length);
        log("Loaded " + items.length + " file" + (items.length === 1 ? "" : "s") + " from " + sourceLabel(srcSel.value) + ".");
      } catch (e) {
        log("Load failed: " + String(e).slice(0, 160));
      } finally {
        loadBtn.disabled = false;
      }
    });

    startBtn.addEventListener("click", async function () {
      var act = actSel.value;
      var reencode = reCb.checked;

      if (act !== "dl") {
        var zp = global.ZDL_PROVIDERS;
        if (zp) {
          var curP = zp.current();
          if (!zp.usable(curP)) {
            log("No usable host provider — open the ⚙ settings (top-right) to configure one.");
            return;
          }
          log("Hosting via " + zp.label(curP));
        }
      }

      if (act === "hostfiles") {
        if (!localFiles.length) { log("Choose a folder first."); return; }
        jobItems = localFiles.map(function (f) {
          return { key: f.webkitRelativePath || f.name, name: f.name, blob: f };
        });
      } else {
        if (srcSel.value !== "paste" && !jobItems.length) {
          try {
            jobItems = srcSel.value === "json" ? await sources.json(opts.jsonPath) : await sources.zreo();
            box.value = stringify(jobItems).slice(0, 5000) + (jobItems.length ? "\n… (" + jobItems.length + " files)" : "");
            showCount(jobItems.length);
          } catch (e) { log("Load failed: " + String(e).slice(0, 160)); return; }
        }
        if (srcSel.value === "paste" || !jobItems.length) {
          jobItems = parseList(box.value);
          if (!jobItems.length) { log("Nothing to do — add some URLs first."); return; }
        }
      }

      var total = jobItems.length;
      var namespace = act === "dlhost" ? opts.dlhostNamespace : (act === "host" || act === "hostfiles" ? opts.hostNamespace : opts.namespace);

      prog.style.display = "block";
      stopBtn.disabled = false;
      startBtn.disabled = true;
      log("Starting (" + ACTIONS[act] + ")… " + total + " file" + (total === 1 ? "" : "s"));

      var common = {
        namespace: namespace,
        throttleMs: opts.throttleMs,
        reencode: reencode,
        onProgress: function (p) {
          bar.value = Math.round(p.index / p.total * 100);
          setStatus(p.index + " / " + p.total + (p.ok ? "  ·  " + p.ok + " done" : ""));
        },
        onLog: log,
        onDone: function (r) {
          startBtn.disabled = false;
          stopBtn.disabled = true;
          if (r.results) renderResults(r.results);
          setStatus("Finished: " + r.ok + " ok, " + r.failed + " failed" + (r.total ? ", " + r.total + " total" : "") + ".");
          log("DONE — " + r.ok + " ok, " + r.failed + " failed.");
        }
      };

      if (act === "host" || act === "hostfiles") jobOpts = common, hostItems(jobItems, jobOpts);
      else if (act === "dlhost") jobOpts = common, downloadAndHost(jobItems, jobOpts);
      else jobOpts = common, run(jobItems, jobOpts);
    });

    stopBtn.addEventListener("click", function () {
      if (jobOpts) jobOpts.stop = true;
      log("Stopping after current file…");
    });

    host.querySelector(".zdl-copy[data-what='lines']").addEventListener("click", function () { copyText(resBox.value); });
    host.querySelector(".zdl-copy[data-what='json']").addEventListener("click", function () {
      var ns = actSel.value === "dlhost" ? opts.dlhostNamespace : opts.hostNamespace;
      var store = safeParse(localStorage.getItem(ns)) || {};
      copyText(jsonOf(store.results || {}));
    });
    host.querySelector(".zdl-reset").addEventListener("click", function () {
      var ns = actSel.value === "dlhost" ? opts.dlhostNamespace : opts.hostNamespace;
      localStorage.removeItem(ns);
      resBox.value = "";
      resWrap.style.display = "none";
      log("Upload progress cleared.");
    });
  }

  var ZDL = {
    version: VERSION,
    downloadOne: downloadOne,
    run: run,
    hostAvailable: hostAvailable,
    hostOne: hostOne,
    hostItems: hostItems,
    downloadAndHost: downloadAndHost,
    uploadBlob: uploadBlob,
    parseList: parseList,
    stringify: stringify,
    linesOf: linesOf,
    jsonOf: jsonOf,
    sources: sources,
    mount: mount,
    sanitize: sanitize
  };

  global.ZDL = ZDL;
  if (typeof module !== "undefined" && module.exports) module.exports = ZDL;
  return ZDL;
})(typeof window !== "undefined" ? window : globalThis);
