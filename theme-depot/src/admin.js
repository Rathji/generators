// Theme Depot — admin panel
// Opens via the Admin button in the top bar, the #admin URL hash, or Ctrl/Cmd+Shift+A.
// Runs the tool scripts declared in src/tools/SCRIPTS.json (the same pipeline as the
// documented browser-console workflow — fetch script, import as a data: URL module,
// call its exported main()) and shows the JSON they produce so the admin can copy it
// into the corresponding src/ file. Runs are read-only; import/export is stubbed for now.

const $ = (id) => document.getElementById(id);

const MAX_LOG_LINE = 400; // skip giant console lines (the JSON dump) in the live log

let running = false;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtArg(a) {
  if (typeof a === "string") return a;
  if (a === undefined) return "undefined";
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function initAdmin() {
  const overlay = $("adminOverlay");
  const closeBtn = $("adminClose");
  const adminBtn = $("adminBtn");
  const copyBtn = $("adminCopyJson");
  const jsonTa = $("adminJson");

  const open = () => {
    overlay.hidden = false;
  };
  const close = () => {
    overlay.hidden = true;
  };

  adminBtn.addEventListener("click", () => (overlay.hidden ? open() : close()));
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      overlay.hidden ? open() : close();
    }
  });

  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(jsonTa.value);
    copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
    setTimeout(() => (copyBtn.textContent = "Copy JSON"), 1400);
  });

  if (location.hash === "#admin") open();
  window.addEventListener("hashchange", () => {
    if (location.hash === "#admin") open();
  });

  try {
    await buildScripts();
  } catch (e) {
    $("adminScripts").innerHTML = `<p class="muted">Couldn't load the script manifest: ${esc((e && e.message) || e)}</p>`;
  }
}

async function buildScripts() {
  const res = await fetch("src/tools/SCRIPTS.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const scripts = ((await res.json()).scripts || []);
  const ctn = $("adminScripts");
  ctn.textContent = "";
  for (const s of scripts) {
    if (!s.path) continue;
    ctn.appendChild(scriptCard(s));
  }
}

function scriptCard(s) {
  const card = document.createElement("div");
  card.className = "adminCard";
  card.innerHTML = `
    <div class="adminCardHead">
      <div class="adminCardTitle">${esc(s.label)} <span class="adminCardPath">${esc(s.path)}</span></div>
      <div class="adminCardActions">
        <label class="limitLabel">limit
          <input class="limitInput" type="number" min="0" step="1" value="${s.defaultLimit ?? 0}" title="Theme limit (0 = all themes; a small number = quick test run)">
        </label>
        <button class="runBtn chipBtn">Run</button>
      </div>
    </div>
    ${s.description ? `<p class="adminCardDesc muted">${esc(s.description)}</p>` : ""}
  `;
  card.querySelector(".runBtn").addEventListener("click", () => runScript(card, s));
  return card;
}

function setButtonsDisabled(v) {
  document.querySelectorAll("#adminScripts .runBtn").forEach((b) => (b.disabled = v));
  $("adminClose").disabled = v;
}

async function runScript(card, s) {
  if (running) return;
  running = true;
  setButtonsDisabled(true);

  const logPre = $("adminLog");
  const jsonTa = $("adminJson");
  const head = $("adminJsonHead");
  const status = $("adminRunStatus");
  const title = $("adminRunTitle");

  $("adminRunLog").hidden = false;
  title.textContent = `${s.label} — ${s.path}`;
  status.textContent = "running…";
  logPre.textContent = "";
  jsonTa.hidden = true;
  jsonTa.value = "";
  head.hidden = true;

  const realLog = console.log.bind(console);
  const realWarn = console.warn.bind(console);
  const realError = console.error.bind(console);
  const push = (args) => {
    const line = args.map(fmtArg).join(" ");
    if (line.length <= MAX_LOG_LINE) logPre.textContent += line + "\n";
    logPre.scrollTop = logPre.scrollHeight;
  };
  console.log = (...a) => {
    push(a);
    realLog(...a);
  };
  console.warn = (...a) => {
    push(a);
    realWarn(...a);
  };
  console.error = (...a) => {
    push(a);
    realError(...a);
  };

  try {
    const raw = card.querySelector(".limitInput").value;
    const limit = Math.max(0, parseInt(raw, 10) || 0);
    const code = await (await fetch(s.path)).text();
    const b64 = btoa(unescape(encodeURIComponent(code)));
    const mod = await import("data:text/javascript;base64," + b64);
    if (typeof mod.main !== "function") throw new Error("script has no main() export");
    const result = await mod.main({ limit });
    if (result && typeof result.json === "string") {
      jsonTa.value = result.json;
      jsonTa.hidden = false;
      head.hidden = false;
    }
    status.textContent = "done";
    const wrote = result && result.wrote ? `  → ${result.wrote}` : "";
    title.textContent = `${s.label} — ${s.path}${wrote}`;
  } catch (e) {
    push(["ERROR: " + ((e && e.message) || e)]);
    realError(e);
    status.textContent = "failed";
  } finally {
    console.log = realLog;
    console.warn = realWarn;
    console.error = realError;
    running = false;
    setButtonsDisabled(false);
  }
}
