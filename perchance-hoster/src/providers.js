// Data Downloader / Host — pluggable upload providers (window.ZDL_PROVIDERS).
// Each provider knows how to host a Blob and return a shareable URL. Config
// (API keys, endpoints) is stored in THIS browser's localStorage only — keys
// never leave the browser. Providers fall into 4 kinds:
//   builtin : user.uploads.dev via the perchance upload-plugin
//   anon    : browser-native upload, no key needed (CORS is open)
//   proxied : CORS-blocked host, routed through the perchance superFetch proxy
//   config  : paid/own-infra host; user fills in fields in the ⚙ settings
(function (global) {
  "use strict";

  var NS = "zdl-providers";
  var CUR = "zdl-provider";

  function safeParse(t) { try { return JSON.parse(t || "null"); } catch (e) { return null; } }
  function sanitize(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim(); }
  function load() { return safeParse(localStorage.getItem(NS)) || {}; }
  function persist() { try { localStorage.setItem(NS, JSON.stringify(settings)); } catch (e) {} }

  // ---------------- SigV4 (S3-compatible uploads) ----------------
  function hexOf(u8) {
    return Array.prototype.map.call(u8, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  async function sha256Hex(bytes) {
    var d = await crypto.subtle.digest("SHA-256", bytes);
    return hexOf(new Uint8Array(d));
  }
  async function hmacBytes(keyBytes, msg) {
    var key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  }
  async function signingKey(secret, dateStamp, region, service) {
    return await hmacBytes(
      await hmacBytes(await hmacBytes(await hmacBytes(strToBytes("AWS4" + secret), dateStamp), region), service),
      "aws4_request"
    );
  }
  function strToBytes(s) { return new TextEncoder().encode(s); }
  function awsEncodePath(p) {
    return String(p).split("/").map(function (seg) {
      return encodeURIComponent(seg).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
    }).join("/");
  }
  // opts: { method, path, query, headers{}, payloadHash, accessKeyId, secret, region, service, amzDate }
  async function sigv4Auth(opts) {
    var keys = Object.keys(opts.headers).sort();
    var canonicalHeaders = keys.map(function (k) { return k.toLowerCase() + ":" + String(opts.headers[k]).trim() + "\n"; }).join("");
    var signedHeaders = keys.map(function (k) { return k.toLowerCase(); }).join(";");
    var canonicalRequest = [opts.method, opts.path || "/", opts.query || "", canonicalHeaders, signedHeaders, opts.payloadHash].join("\n");
    var dateStamp = opts.amzDate.slice(0, 8);
    var scope = dateStamp + "/" + opts.region + "/" + opts.service + "/aws4_request";
    var stringToSign = "AWS4-HMAC-SHA256\n" + opts.amzDate + "\n" + scope + "\n" + await sha256Hex(strToBytes(canonicalRequest));
    var sk = await signingKey(opts.secret, dateStamp, opts.region, opts.service);
    var sig = await hmacBytes(sk, stringToSign);
    return {
      authorization: "AWS4-HMAC-SHA256 Credential=" + opts.accessKeyId + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + hexOf(sig),
      canonicalRequest: canonicalRequest,
      stringToSign: stringToSign
    };
  }

  var settings = load();

  // ---------------- registry ----------------
  var REG = [
    { id: "uploads", label: "user.uploads.dev", kind: "builtin",
      note: "Permanent links. ~5MB/file, ~30MB/day per IP. The built-in Perchance host — no setup." },
    { id: "gofile", label: "gofile.io", kind: "anon",
      note: "No signup, large files OK. Free links expire after ~10 days without downloads." },
    { id: "tmpfiles", label: "tmpfiles.org", kind: "proxied",
      note: "No signup. Kept 60 minutes (free) — short-lived links only. Routes through Perchance's proxy (the only proxied host currently reachable from it)." },
    { id: "supabase", label: "Supabase Storage", kind: "config",
      note: "Permanent links. Free tier 1GB storage / 5GB bandwidth. Create a bucket and set it Public for shareable links.",
      fields: [
        { key: "url", label: "Project URL", placeholder: "https://xxxxxxxx.supabase.co", secret: false },
        { key: "anonKey", label: "Anon key", placeholder: "sb_publishable_xxxx", secret: true },
        { key: "bucket", label: "Bucket name", placeholder: "files", secret: false }
      ] },
    { id: "firebase", label: "Firebase Storage", kind: "config",
      note: "Permanent links. Free Spark tier 5GB / 1GB daily downloads. Storage rules must allow public read.",
      fields: [
        { key: "apiKey", label: "Web API key", placeholder: "AIzaSy…", secret: true },
        { key: "projectId", label: "Project ID", placeholder: "my-project-123", secret: false },
        { key: "storageBucket", label: "Storage bucket", placeholder: "my-project.appspot.com", secret: false }
      ] },
    { id: "cloudinary", label: "Cloudinary", kind: "config",
      note: "Permanent links, media-friendly. Create an unsigned upload preset in the dashboard.",
      fields: [
        { key: "cloud", label: "Cloud name", placeholder: "mycloud", secret: false },
        { key: "preset", label: "Unsigned preset", placeholder: "my-preset", secret: false }
      ] },
    { id: "s3", label: "S3-compatible (AWS / R2 / GCS / B2 / Spaces…)", kind: "config",
      note: "One provider covers AWS S3, Cloudflare R2, Google Cloud Storage (interoperable HMAC keys), Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO and more — uploads are signed in-browser (SigV4) with keys you enter here. The endpoint/bucket must allow CORS (PUT). AWS path-style: https://s3.<region>.amazonaws.com — or put the bucket in the host (https://<bucket>.s3.<region>.amazonaws.com) and leave Bucket empty.",
      fields: [
        { key: "endpoint", label: "Endpoint URL", placeholder: "https://s3.us-east-1.amazonaws.com", secret: false },
        { key: "bucket", label: "Bucket name (optional if host already has it)", placeholder: "my-bucket", secret: false },
        { key: "accessKeyId", label: "Access Key ID", placeholder: "AKIA…", secret: true },
        { key: "secret", label: "Secret Access Key", placeholder: "…", secret: true },
        { key: "region", label: "Region (default us-east-1)", placeholder: "us-east-1", secret: false }
      ] },
    { id: "azure", label: "Azure Blob (SAS URL)", kind: "config",
      note: "Generate a container-level SAS URL in the Azure portal with create+write permissions (sp must include c and w). The storage account must allow CORS (PUT). Returned links carry the same SAS, so share them before it expires.",
      fields: [
        { key: "sasUrl", label: "Container SAS URL", placeholder: "https://acct.blob.core.windows.net/container?sv=…&sp=cw…", secret: true }
      ] },
    { id: "custom", label: "Custom endpoint", kind: "config",
      note: "Your own backend (Cloudflare Worker, B2, S3…). We POST the file as multipart field 'file' and expect JSON with a URL (url, link, or data.url). Keep your secret keys server-side.",
      fields: [
        { key: "url", label: "POST endpoint URL", placeholder: "https://your-worker.example/upload", secret: false }
      ] }
  ];

  function byId(id) { for (var i = 0; i < REG.length; i++) if (REG[i].id === id) return REG[i]; return null; }
  function label(id) { var p = byId(id); return p ? p.label : id; }

  function configured(id) {
    var p = byId(id);
    if (!p || p.kind !== "config" || !settings[id]) return false;
    return p.fields.every(function (f) { return String(settings[id][f.key] || "").trim(); });
  }
  function usable(id) {
    var p = byId(id); if (!p) return false;
    if (p.kind === "builtin") return !!(global.root && global.root.uploadPlugin);
    if (p.kind === "anon") return true;
    if (p.kind === "proxied") return !!(global.root && global.root.superFetch);
    return configured(id);
  }
  function anyUsable() { return REG.some(function (p) { return usable(p.id); }); }

  function current() {
    var id = localStorage.getItem(CUR) || "uploads";
    if (usable(id)) return id;
    for (var i = 0; i < REG.length; i++) if (usable(REG[i].id)) return REG[i].id;
    return "uploads";
  }
  function setCurrent(id) { if (!byId(id)) return; try { localStorage.setItem(CUR, id); } catch (e) {} fireChange(); }

  // Failover chain for hosting: the selected provider first, then every other
  // usable provider in registry order — used so a batch survives one host
  // rejecting a file (quota, block, misconfigured key) by retrying the rest.
  function failoverChain() {
    var primary = current();
    var chain = [primary];
    REG.forEach(function (p) {
      if (p.id !== primary && usable(p.id)) chain.push(p.id);
    });
    return chain;
  }

  // ---------------- uploaders ----------------
  function fdErr(p, msg) { return { error: p + ": " + String(msg).slice(0, 90) }; }

  var UPLOADERS = {
    gofile: async function (blob, name) {
      var fd = new FormData();
      fd.append("file", blob, name);
      var r = await fetch("https://upload.gofile.io/uploadfile", { method: "POST", body: fd });
      var j = await r.json();
      if (!j || j.status !== "ok" || !j.data) return fdErr("gofile", (j && (j.errorMessage || j.status)) || r.status);
      return { url: j.data.downloadPage, size: blob.size };
    },
    tmpfiles: async function (blob, name) {
      var fd = new FormData();
      fd.append("file", blob, name);
      var r = await global.root.superFetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: fd });
      var j = await r.json();
      if (!j || j.status !== "success" || !j.data || !j.data.url) return fdErr("tmpfiles", JSON.stringify(j).slice(0, 90));
      return { url: j.data.url, size: blob.size, note: "1h retention" };
    },
    supabase: async function (blob, name) {
      var cfg = settings.supabase || {};
      if (!cfg.url || !cfg.anonKey || !cfg.bucket) return fdErr("supabase", "not configured — fill in ⚙ settings");
      var base = cfg.url.replace(/\/$/, "");
      var path = Date.now() + "-" + sanitize(name || "file");
      var r = await fetch(base + "/storage/v1/object/" + cfg.bucket + "/" + encodeURIComponent(path), {
        method: "POST",
        headers: { "apikey": cfg.anonKey, "Authorization": "Bearer " + cfg.anonKey, "Content-Type": blob.type || "application/octet-stream" },
        body: blob
      });
      var j = await r.json().catch(function () { return null; });
      if (!r.ok || !j || !j.Key) return fdErr("supabase", (j && (j.message || j.error)) || r.status);
      return { url: base + "/storage/v1/object/public/" + cfg.bucket + "/" + encodeURIComponent(path), size: blob.size, note: "bucket must be Public" };
    },
    firebase: async function (blob, name) {
      var cfg = settings.firebase || {};
      if (!cfg.apiKey || !cfg.storageBucket) return fdErr("firebase", "not configured — fill in ⚙ settings");
      var a = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + encodeURIComponent(cfg.apiKey), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true })
      });
      var aj = await a.json().catch(function () { return null; });
      if (!aj || !aj.idToken) return fdErr("firebase auth", (aj && aj.error && aj.error.message) || a.status);
      var path = Date.now() + "-" + sanitize(name || "file");
      var r = await fetch("https://firebasestorage.googleapis.com/v0/b/" + cfg.storageBucket + "/o?name=" + encodeURIComponent(path), {
        method: "POST",
        headers: { "Authorization": "Firebase " + aj.idToken, "Content-Type": "application/octet-stream", "X-Firebase-Storage-Version": "2" },
        body: blob
      });
      var j = await r.json().catch(function () { return null; });
      if (!r.ok || !j || !j.name) return fdErr("firebase upload", (j && j.error && j.error.message) || r.status);
      return { url: "https://firebasestorage.googleapis.com/v0/b/" + cfg.storageBucket + "/o/" + encodeURIComponent(j.name) + "?alt=media", size: blob.size, note: "rules must allow read" };
    },
    cloudinary: async function (blob, name) {
      var cfg = settings.cloudinary || {};
      if (!cfg.cloud || !cfg.preset) return fdErr("cloudinary", "not configured — fill in ⚙ settings");
      var fd = new FormData();
      fd.append("file", blob, name);
      fd.append("upload_preset", cfg.preset);
      var r = await fetch("https://api.cloudinary.com/v1_1/" + cfg.cloud + "/auto/upload", { method: "POST", body: fd });
      var j = await r.json().catch(function () { return null; });
      if (!r.ok || !j || !j.secure_url) return fdErr("cloudinary", (j && j.error && j.error.message) || r.status);
      return { url: j.secure_url, size: blob.size };
    },
    s3: async function (blob, name) {
      var cfg = settings.s3 || {};
      if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secret) return fdErr("s3", "not configured — fill in ⚙ settings");
      var ep = cfg.endpoint.replace(/\/+$/, "");
      var key = sanitize(name || "file");
      var path = cfg.bucket ? "/" + awsEncodePath(cfg.bucket) + "/" + awsEncodePath(key) : "/" + awsEncodePath(key);
      var u = new URL(ep + path);
      var amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      var payloadHash = await sha256Hex(await blob.arrayBuffer());
      var sig = await sigv4Auth({
        method: "PUT", path: path, query: "", payloadHash: payloadHash,
        headers: { host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate },
        accessKeyId: cfg.accessKeyId, secret: cfg.secret, region: cfg.region || "us-east-1",
        service: "s3", amzDate: amzDate
      });
      var r = await fetch(u.href, {
        method: "PUT",
        headers: { "Authorization": sig.authorization, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, "Content-Type": blob.type || "application/octet-stream" },
        body: blob
      });
      if (!r.ok) {
        var t = await r.text().catch(function () { return ""; });
        var code = (t.match(/<Code>([^<]+)<\/Code>/) || [])[1];
        var msg = (t.match(/<Message>([^<]+)<\/Message>/) || [])[1];
        return fdErr("s3", (code || r.status) + (msg ? " " + msg : ""));
      }
      return { url: u.href, size: blob.size, note: "endpoint must allow CORS" };
    },
    azure: async function (blob, name) {
      var cfg = settings.azure || {};
      if (!cfg.sasUrl) return fdErr("azure", "not configured — fill in ⚙ settings");
      var sas = cfg.sasUrl.trim();
      var qIdx = sas.indexOf("?");
      var base = (qIdx > -1 ? sas.slice(0, qIdx) : sas).replace(/\/+$/, "");
      var q = qIdx > -1 ? sas.slice(qIdx + 1) : "";
      var url = base + "/" + encodeURIComponent(sanitize(name || "file")) + (q ? "?" + q : "");
      var r = await fetch(url, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": blob.type || "application/octet-stream" },
        body: blob
      });
      if (!r.ok) {
        var t = await r.text().catch(function () { return ""; });
        var code = (t.match(/<Code>([^<]+)<\/Code>/) || [])[1];
        return fdErr("azure", (code || r.status) + " (check SAS perms + CORS)");
      }
      return { url: url, size: blob.size, note: "link expires with the SAS" };
    },
    custom: async function (blob, name) {
      var cfg = settings.custom || {};
      if (!cfg.url) return fdErr("custom", "not configured — fill in ⚙ settings");
      var fd = new FormData();
      fd.append("file", blob, name);
      fd.append("name", name || "");
      var r = await fetch(cfg.url, { method: "POST", body: fd });
      var j = await r.json().catch(function () { return null; });
      if (!j) return fdErr("custom", "non-JSON response (HTTP " + r.status + ")");
      var u = j.url || (j.data && j.data.url) || j.link || (j.data && j.data.link) || j.secure_url || j.location;
      if (!u) return fdErr("custom", "no URL in response: " + JSON.stringify(j).slice(0, 90));
      return { url: u, size: blob.size };
    }
  };

  async function upload(id, blob, name) {
    var fn = UPLOADERS[id];
    if (!fn) return { error: "unknown provider: " + id };
    try { return (await fn(blob, name)) || { error: "no result" }; }
    catch (e) { return fdErr(label(id), (e && e.message) || e); }
  }

  // ---------------- provider <select> helpers ----------------
  function populateSelect(sel) {
    if (!sel) return;
    var cur = current();
    sel.innerHTML = "";
    REG.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      var suffix = "";
      if (p.kind === "config" && !configured(p.id)) suffix = "  (needs setup)";
      o.textContent = p.label + (p.kind === "proxied" ? "  (proxied)" : "") + suffix;
      if (!usable(p.id)) o.disabled = true;
      sel.appendChild(o);
    });
    sel.value = cur;
  }
  function mountSelect(sel) {
    if (!sel || sel.dataset.mounted) return;
    sel.dataset.mounted = "1";
    populateSelect(sel);
    sel.addEventListener("change", function () { setCurrent(sel.value); });
  }
  function refresh() {
    var sels = document.querySelectorAll(".zdl-provider, .up-provider");
    sels.forEach(populateSelect);
    fireChange();
  }

  // ---------------- settings modal ----------------
  function buildSettingsModal(modal) {
    if (!modal) return;
    var body = modal.querySelector(".providers-body");
    if (!body || body.dataset.built) return;
    body.dataset.built = "1";

    var intro = document.createElement("p");
    intro.className = "prov-intro";
    intro.innerHTML = "Pick where hosted files go. Some hosts need setup — fill in the fields and hit <b>Save</b>. Keys stay in <i>your</i> browser (localStorage) and never leave it.";
    body.appendChild(intro);

    var inputs = {};
    REG.forEach(function (p) {
      if (p.kind !== "config") return;
      var sec = document.createElement("section");
      sec.className = "prov-sec";
      var h = document.createElement("h4");
      h.textContent = p.label;
      sec.appendChild(h);
      if (p.note) {
        var n = document.createElement("p");
        n.className = "prov-note";
        n.textContent = p.note;
        sec.appendChild(n);
      }
      p.fields.forEach(function (f) {
        var l = document.createElement("label");
        l.className = "prov-field";
        l.textContent = f.label;
        var inp = document.createElement("input");
        inp.type = f.secret ? "password" : "text";
        inp.className = "prov-input";
        inp.placeholder = f.placeholder;
        inp.autocomplete = "off";
        inp.spellcheck = false;
        l.appendChild(inp);
        sec.appendChild(l);
        inputs[p.id + "." + f.key] = inp;
      });
      body.appendChild(sec);
    });

    var sec2 = document.createElement("section");
    sec2.className = "prov-sec";
    var h2 = document.createElement("h4");
    h2.textContent = "No setup needed";
    sec2.appendChild(h2);
    REG.forEach(function (p) {
      if (p.kind === "config") return;
      var d = document.createElement("div");
      d.className = "prov-item";
      var dl = document.createElement("span");
      dl.className = "prov-item-name";
      dl.textContent = p.label + (p.kind === "proxied" ? "  (proxied)" : "");
      var dn = document.createElement("span");
      dn.className = "prov-item-note";
      dn.textContent = p.note || "";
      d.appendChild(dl);
      d.appendChild(dn);
      sec2.appendChild(d);
    });
    body.appendChild(sec2);

    var row = document.createElement("div");
    row.className = "prov-actions";
    var save = document.createElement("button");
    save.type = "button";
    save.className = "prov-save";
    save.textContent = "Save settings";
    row.appendChild(save);
    var status = document.createElement("span");
    status.className = "prov-status";
    row.appendChild(status);
    body.appendChild(row);

    var s = load();
    Object.keys(inputs).forEach(function (k) {
      var parts = k.split(".");
      var v = s[parts[0]] && s[parts[0]][parts[1]];
      if (v) inputs[k].value = v;
    });

    save.addEventListener("click", function () {
      var out = {};
      Object.keys(inputs).forEach(function (k) {
        var parts = k.split(".");
        out[parts[0]] = out[parts[0]] || {};
        out[parts[0]][parts[1]] = inputs[k].value.trim();
      });
      settings = out;
      persist();
      status.textContent = "Saved ✓";
      setTimeout(function () { status.textContent = ""; }, 2500);
      refresh();
    });
  }

  function init() {
    var gear = document.getElementById("providersBtn");
    var modal = document.getElementById("providersModal");
    if (gear && modal) {
      gear.addEventListener("click", function () {
        buildSettingsModal(modal);
        modal.classList.add("open");
        gear.setAttribute("aria-expanded", "true");
      });
      modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
      modal.querySelectorAll(".modal-x").forEach(function (x) { x.addEventListener("click", closeModal); });
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  }
  function closeModal() {
    var modal = document.getElementById("providersModal");
    if (modal) modal.classList.remove("open");
    var gear = document.getElementById("providersBtn");
    if (gear) gear.setAttribute("aria-expanded", "false");
  }

  var cbs = [];
  function onChange(fn) { cbs.push(fn); return function () { cbs = cbs.filter(function (f) { return f !== fn; }); }; }
  function fireChange() { cbs.forEach(function (f) { try { f(); } catch (e) {} }); }

  var API = {
    list: function () { return REG.slice(); },
    byId: byId,
    label: label,
    usable: usable,
    anyUsable: anyUsable,
    configured: configured,
    current: current,
    setCurrent: setCurrent,
    failoverChain: failoverChain,
    upload: upload,
    mountSelect: mountSelect,
    refresh: refresh,
    onChange: onChange,
    buildSettingsModal: buildSettingsModal
  };

  global.ZDL_PROVIDERS = API;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
