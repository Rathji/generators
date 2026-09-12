/* ============================================================
   RMM-U — remote access & field actions
   (Phase 9 · Tasks 37–39)

   Three capabilities, one honest transport:

     • Task 37 — REMOTE SHELL. A browser-based console that runs
       commands on an endpoint. It is deliberately NOT a fake
       interactive PTY: every command is dispatched as a real agent
       job (J.enqueue → the collector/heartbeat delivers it → the
       agent runs it → J.result returns stdout/stderr/exit code),
       exactly like the script library and patch/software deploy
       paths. A **shell session** groups a transcript of commands
       with who ran what, when and on which device. Before a command
       runs it is inspected against a **deny-list** (block / confirm)
       and, when required, an explicit confirmation step is enforced.
       A command that returns no output says so, and a command that
       outlives its timeout is marked `timed-out` with a clear reason.

     • Task 38 — REMOTE-TOOL SESSIONS. Rather than pretend to be a
       remote-control product, the console integrates with the tools
       an MSP already uses. A **tool definition** is a name, a kind
       (remote-control / tunnel / screen-share / ssh / web) and a
       launch URL template with per-device placeholders
       ({hostname} {deviceId} {ip} {user} {domain} {os}). Launching
       pre-targets the tool at a device and records a **session**
       against it; a **handoff link** can be generated for a
       colleague and redeemed later. Both the launch and the session
       live on the device's record.

     • Task 39 — FILE TRANSFER. Push and pull files through the agent.
       Transfers carry a size limit, are split into chunks for large
       files, and are anchored by a SHA-256 **integrity check** the
       agent reports back; a mismatch fails the transfer rather than
       claiming success. Uploads pass a **quarantine/permission
       check** before they are released to the device, and every
       transition is written to the audit log.

   Everything lives on the provider aggregate in `provider.remoteState`:

     remoteState = { tools, sessions, shells, transfers }

   The mechanism is real, not simulated: commands and file operations
   are agent jobs and their output is the agent's reported output.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const J = ERP.jobs || null;
  const COL = ERP.collector || null;
  const REM = (ERP.remote = {});

  const ui = ERP.ui;
  const esc = ui.esc;

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const msOf = (v) => { const t = Date.parse(v); return isFinite(t) ? t : null; };
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const MIN = 60000;

  const enabled = () => cfg("rmm.remoteEnabled", true) !== false;
  const allowStaff = () => cfg("rmm.remoteAllowStaff", false) === true;
  const requireConfirm = () => cfg("rmm.remoteConfirmCommands", true) !== false;
  const commandTimeout = () => Math.max(10, num(cfg("rmm.remoteCommandTimeoutSeconds", 120), 120));
  const commandHistory = () => Math.max(10, num(cfg("rmm.remoteCommandHistory", 500), 500));
  const sessionHistory = () => Math.max(10, num(cfg("rmm.remoteSessionHistory", 500), 500));
  const transferHistory = () => Math.max(10, num(cfg("rmm.remoteTransferHistory", 500), 500));
  const maxFileBytes = () => Math.max(1024, num(cfg("rmm.remoteMaxFileBytes", 1048576), 1048576));
  const chunkChars = () => Math.max(256, num(cfg("rmm.remoteChunkChars", 65536), 65536));
  const quarantineUploads = () => cfg("rmm.remoteQuarantineUploads", true) !== false;
  const commandMaxChars = () => Math.max(256, num(cfg("rmm.remoteCommandMaxChars", 20000), 20000));

  const stateOf = (p) => asObj(asObj(p).remoteState);
  const providerOf = async (providerId) => { const g = await T.get(providerId); return g.error ? null : g.provider; };
  const actor = () => { try { return ERP.role || "owner"; } catch (e) { return "owner"; } };
  const currentUser = () => {
    try { if (ERP.team && typeof ERP.team.whoami === "function") { const w = ERP.team.whoami(); if (w && (w.name || w.id)) return w.name || w.id; } } catch (e) {}
    return actor();
  };

  async function audit(action, targetId, summary, targetType) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: targetType || "remote", targetId, summary }); } catch (e) {}
  }
  async function auditDevice(action, deviceId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "device", targetId: String(deviceId), summary }); } catch (e) {}
  }

  /* Write provider.remoteState under the store's compare-and-set guard,
     retrying so concurrent module seeds cannot silently drop the change. */
  async function writeState(providerId, mutate, attempts) {
    const tries = Math.max(1, num(attempts, 4));
    let last = null;
    for (let i = 0; i < tries; i++) {
      const r = await T.update(providerId, (p) => { p.remoteState = asObj(p.remoteState); mutate(p.remoteState, p); });
      if (!r.error) return r;
      last = r;
      await new Promise((res) => setTimeout(res, 40));
    }
    return last;
  }
  REM.writeState = writeState;

  /* ─────────────────────── hashing / base64 ─────────────────────── */

  function sha256(text) {
    const s = String(text == null ? "" : text);
    if (COL && typeof COL.localCore === "function") {
      try { return COL.localCore().sha256Hex(s); } catch (e) {}
    }
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { h1 = (h1 ^ s.charCodeAt(i)) * 16777619 >>> 0; h2 = (h2 + s.charCodeAt(i) * (i + 1)) >>> 0; }
    return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
  }
  function b64encode(text) {
    const s = String(text == null ? "" : text);
    if (COL && typeof COL.localCore === "function") { try { return COL.localCore().b64encode(s); } catch (e) {} }
    try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ""; }
  }
  function b64decode(b64) {
    const s = String(b64 == null ? "" : b64).replace(/\s+/g, "");
    if (COL && typeof COL.localCore === "function") { try { return COL.localCore().b64decode(s); } catch (e) {} }
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { return ""; }
  }
  function utf8Bytes(text) {
    const s = String(text == null ? "" : text);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function bytesHuman(n) {
    n = num(n, 0);
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(1) + " GB";
  }
  REM.sha256 = sha256;
  REM.b64encode = b64encode;
  REM.b64decode = b64decode;
  REM.bytesHuman = bytesHuman;

  /* ─────────────────────── permission gate ─────────────────────── */

  /* Remote access is an operator action, not a read. The collector's role
     model (Task 48) is the authority: shells need `remote.shell`, file
     transfers need `remote.file`, and a remote tool session — interactive
     remote access — is treated as a shell. If the access module is not
     loaded, fall back to the owner/manager selector. */
  const REMOTE_CAP = { shell: "remote.shell", tool: "remote.shell", transfer: "remote.file" };
  function canRemote(action, device) {
    if (!enabled()) return { ok: false, reason: "remote_disabled", message: "Remote access is disabled in configuration." };
    const role = actor();
    const legacyOk = role === "owner" || role === "manager" || allowStaff();
    const access = ERP.access;
    const cap = REMOTE_CAP[action] || "remote.shell";
    if (access && typeof access.can === "function") {
      const target = typeof device === "string" ? device : (device && (device.id || device.deviceId));
      if (access.can(cap, target)) return { ok: true, role: access.myRole(), capability: cap };
      if (legacyOk) return { ok: true, role: role, capability: cap, legacy: true };
      return { ok: false, reason: "forbidden_role", capability: cap, message: "Your " + access.myRole() + " role does not allow remote " + (action || "actions") + (target ? " on this device" : "") + "." };
    }
    if (!legacyOk) {
      return { ok: false, reason: "forbidden_role", message: "The " + role + " role may not perform remote " + (action || "actions") + "." };
    }
    return { ok: true, role };
  }
  REM.canRemote = canRemote;
  REM.canShell = (device) => canRemote("shell", device);
  REM.canTransfer = (device) => canRemote("transfer", device);
  REM.canTool = (device) => canRemote("tool", device);

  /* ─────────────────────── command deny-list (Task 37) ─────────────────────── */

  /* Each entry is { id, label, level, re }. `level:"block"` is refused
     outright (catastrophic, almost never legitimate); `level:"confirm"`
     runs only after an explicit confirmation. Operators can add extra
     confirm-level patterns through `rmm.remoteDenyExtra`. */
  const DENY = [
    { id: "rm-root", label: "Recursive delete of the filesystem root", level: "block", re: /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f|[a-z]*r[a-z]*f[a-z]*\s+\/(\s|$)|\brm\s+-[a-z]*f[a-z]*r\b[^\n]*\s\/(\s|$)/i },
    { id: "fork-bomb", label: "Shell fork bomb", level: "block", re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
    { id: "mkfs", label: "Filesystem format (mkfs)", level: "block", re: /\bmkfs(\.\w+)?\b/i },
    { id: "wipefs", label: "Filesystem wipe (wipefs)", level: "block", re: /\bwipefs\b/i },
    { id: "dd-device", label: "Raw write to a block device (dd of=/dev/…)", level: "block", re: /\bdd\b[^\n]*\bof\s*=\s*\/dev\//i },
    { id: "format-drive", label: "Windows drive format", level: "block", re: /\bformat\s+[a-z]:/i },
    { id: "diskpart-clean", label: "Disk wipe (diskpart clean / Clear-Disk)", level: "block", re: /\bdiskpart\b|\bclear-disk\b|\bclean\s+all\b/i },
    { id: "drop-db", label: "Drop a database", level: "block", re: /\bdrop\s+(database|schema)\b/i },

    { id: "rm-force", label: "Recursive/forced delete", level: "confirm", re: /\brm\s+-[a-z]*[rf][a-z]*\b/i },
    { id: "del-force", label: "Forced recursive delete (del /s /q)", level: "confirm", re: /\bdel\s+\/[a-z]*[sqf]/i },
    { id: "remove-item", label: "Recursive force remove (Remove-Item -Recurse -Force)", level: "confirm", re: /remove-item[^\n]*-recurse[^\n]*-force/i },
    { id: "rd-force", label: "Directory removal (rmdir / rd /s)", level: "confirm", re: /\b(rmdir|rd)\s+\/[sq]/i },
    { id: "shutdown", label: "Shutdown / restart / poweroff", level: "confirm", re: /\b(shutdown|reboot|poweroff|halt|restart-computer|stop-computer)\b/i },
    { id: "user-change", label: "Local account change", level: "confirm", re: /\b(useradd|userdel|usermod|adduser|net\s+user|net\s+localgroup)\b/i },
    { id: "password-change", label: "Password / credential change", level: "confirm", re: /\b(passwd|chpasswd|set-localuser|set-adaccountpassword)\b/i },
    { id: "service-stop", label: "Disabling or killing a service", level: "confirm", re: /\b(sc\s+(config|stop|delete)|stop-service|set-service|systemctl\s+(stop|disable|mask)|service\s+\w+\s+stop)\b/i },
    { id: "kill-process", label: "Force-killing processes", level: "confirm", re: /\b(taskkill|pkill|killall|kill\s+-9)\b/i },
    { id: "firewall-off", label: "Disabling the firewall", level: "confirm", re: /\b(netsh\s+advfirewall[^\n]*\boff|set-netfirewallprofile[^\n]*-enabled\s+\$?false|iptables\s+-f|ufw\s+disable)\b/i },
    { id: "reg-delete", label: "Registry deletion", level: "confirm", re: /\breg\s+delete\b/i },
    { id: "registry-write", label: "Registry import/overwrite", level: "confirm", re: /\breg\s+(import|restore)\b/i },
    { id: "bcdedit", label: "Boot configuration change", level: "confirm", re: /\bbcdedit\b/i },
    { id: "chmod-root", label: "Permission change on a system path", level: "confirm", re: /\bch(mod|own)\b[^\n]*\s\/(bin|etc|usr|boot|sys|)(\s|$)/i },
    { id: "curl-pipe", label: "Piping a download straight into a shell", level: "confirm", re: /\b(curl|wget)\b[^\n|]*\|\s*(ba|z|)sh\b/i },
  ];
  REM.DENY = DENY.slice();

  function extraDeny() {
    const raw = cfg("rmm.remoteDenyExtra", "");
    return String(raw == null ? "" : raw).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  REM.extraDenyPatterns = extraDeny;

  /* Inspect a command against the deny-list + operator patterns. */
  function inspectCommand(command) {
    const text = String(command == null ? "" : command);
    const matches = [];
    const banned = [];
    if (!text.trim()) return { level: "block", matches: [], banned: [], reason: "empty_command" };
    for (const d of DENY) {
      try { if (d.re.test(text)) matches.push({ id: d.id, label: d.label, level: d.level }); } catch (e) {}
    }
    for (const pat of extraDeny()) {
      try { if (new RegExp(pat, "i").test(text)) matches.push({ id: "custom:" + pat, label: "Operator pattern /" + pat + "/", level: "confirm" }); }
      catch (e) { if (low(text).indexOf(low(pat)) !== -1) matches.push({ id: "custom:" + pat, label: "Operator pattern \"" + pat + "\"", level: "confirm" }); }
    }
    matches.forEach((m) => { if (m.level === "block") banned.push(m); });
    const level = banned.length ? "block" : matches.length ? "confirm" : "allow";
    return { level, matches, banned, reason: banned.length ? "command_blocked" : matches.length ? "confirmation_required" : "" };
  }
  REM.inspectCommand = inspectCommand;

  /* ─────────────────────── device / tool helpers ─────────────────────── */

  function familyFor(device) {
    if (J && typeof J.familyOf === "function") { try { return J.familyOf(device); } catch (e) {} }
    const n = low(asObj(device.os).name || device.osName || "");
    if (n.indexOf("windows") !== -1) return "Windows";
    if (n.indexOf("mac") !== -1) return "macOS";
    return "Linux";
  }
  function languageFor(device) {
    if (String(familyFor(device)) === "Windows") return "powershell";
    return "bash";
  }
  function deviceIp(device) {
    for (const i of asArr(asObj(device).interfaces)) {
      const ip = asArr(i.ip4).find((x) => x && x !== "127.0.0.1" && x.indexOf("169.254.") !== 0);
      if (ip) return ip;
    }
    return "";
  }
  function resolveDevice(provider, deviceId) {
    const id = String(deviceId == null ? "" : deviceId);
    return asArr(asObj(provider).devices).map(D.normalizeDevice).find((d) => String(d.id) === id) || null;
  }
  REM.familyFor = familyFor;
  REM.languageFor = languageFor;
  REM.resolveDevice = resolveDevice;
  REM.deviceIp = deviceIp;

  const TOOL_KINDS = [
    { id: "remote-control", label: "Remote control" },
    { id: "tunnel", label: "Tunnel / VPN" },
    { id: "screen-share", label: "Screen share" },
    { id: "ssh", label: "SSH / terminal" },
    { id: "web", label: "Web console" },
    { id: "custom", label: "Custom" },
  ];
  REM.TOOL_KINDS = TOOL_KINDS.slice();
  const kindLabel = (k) => ((TOOL_KINDS.find((x) => x.id === k) || {}).label || k || "Custom");
  REM.kindLabel = kindLabel;

  /* Ready-made integrations an MSP can drop in and then adjust. */
  const PRESETS = [
    { id: "preset-rustdesk", name: "RustDesk", kind: "remote-control", urlTemplate: "rustdesk://{deviceId}", notes: "Opens the RustDesk client pre-pointed at the device id." },
    { id: "preset-teamviewer", name: "TeamViewer", kind: "remote-control", urlTemplate: "teamviewer8://remotecontrol?connectcc={deviceId}", notes: "Launch TeamViewer QuickSupport against the device." },
    { id: "preset-rdp", name: "Remote Desktop (RDP)", kind: "remote-control", urlTemplate: "rdp://full%20address=s:{hostname}", notes: "Windows RDP handoff. Requires a route or tunnel to the endpoint." },
    { id: "preset-ssh", name: "SSH console", kind: "ssh", urlTemplate: "ssh://{user}@{ip}", notes: "Terminal handoff. Fill {user} or leave it blank to type it yourself." },
    { id: "preset-web", name: "Web remote console", kind: "web", urlTemplate: "https://{hostname}", notes: "Any browser-reachable management console on the device." },
  ];
  REM.PRESETS = PRESETS.slice();

  function normalizeTool(raw) {
    const t = asObj(raw);
    const id = S(t.id, 80) || rid("rtool");
    return {
      id,
      name: S(t.name, 120) || "Remote tool",
      kind: TOOL_KINDS.some((k) => k.id === t.kind) ? t.kind : "custom",
      urlTemplate: S(t.urlTemplate, 800),
      notes: S(t.notes, 400),
      enabled: t.enabled !== false,
      requireConfirm: t.requireConfirm === true,
      createdAt: t.createdAt || now(),
      updatedAt: now(),
    };
  }
  REM.normalizeTool = normalizeTool;

  function renderTemplate(template, device, extra) {
    const d = asObj(device);
    const values = Object.assign({
      hostname: S(d.hostname || d.displayName || "", 200),
      deviceId: S(d.id, 80),
      ip: deviceIp(d),
      user: "",
      domain: S(d.domain || "", 120),
      os: S(asObj(d.os).name || "", 120),
      site: "",
      name: S(d.displayName || d.hostname || "", 200),
    }, asObj(extra));
    const missing = [];
    const out = String(template == null ? "" : template).replace(/\{(\w+)\}/g, (m, key) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        const v = String(values[key] == null ? "" : values[key]);
        if (!v) missing.push(key);
        return v;
      }
      missing.push(key);
      return "";
    });
    return { text: out, missing };
  }
  REM.renderTemplate = renderTemplate;

  function toolUrl(tool, device, extra) {
    const r = renderTemplate(asObj(tool).urlTemplate, device, extra);
    return { url: r.text, missing: r.missing };
  }
  REM.toolUrl = toolUrl;

  /* ─────────────────────── remote tools + sessions (Task 38) ─────────────────────── */

  const loadTools = (provider) => asArr(stateOf(provider).tools).map(normalizeTool);

  REM.listTools = async function (providerId) {
    const p = await providerOf(providerId);
    if (!p) return [];
    return loadTools(p).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  };
  REM.getTool = async function (providerId, toolId) {
    return (await REM.listTools(providerId)).find((t) => String(t.id) === String(toolId)) || null;
  };

  REM.addTool = async function (providerId, data, opts) {
    const gate = canRemote("tool"); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const tool = normalizeTool(Object.assign({}, data, { id: asObj(opts).keepId ? asObj(data).id : null }));
    if (!tool.urlTemplate.trim()) return { error: "empty_url", message: "A launch URL template is required." };
    const w = await writeState(providerId, (s) => { s.tools = asArr(s.tools).concat([clone(tool)]); });
    if (w && w.error) return { error: w.error, message: w.message };
    await audit("remote_tool_add", tool.id, "Added remote tool \"" + tool.name + "\" (" + kindLabel(tool.kind) + ").");
    return { ok: true, tool: clone(tool) };
  };

  REM.updateTool = async function (providerId, toolId, data) {
    const gate = canRemote("tool"); if (!gate.ok) return gate;
    let updated = null;
    const w = await writeState(providerId, (s) => {
      s.tools = asArr(s.tools).map((t) => {
        if (String(t.id) !== String(toolId)) return t;
        updated = normalizeTool(Object.assign({}, t, asObj(data), { id: t.id, createdAt: t.createdAt }));
        return clone(updated);
      });
    });
    if (w && w.error) return { error: w.error, message: w.message };
    if (!updated) return { error: "not_found" };
    await audit("remote_tool_update", toolId, "Updated remote tool \"" + updated.name + "\".");
    return { ok: true, tool: clone(updated) };
  };

  REM.removeTool = async function (providerId, toolId) {
    const gate = canRemote("tool"); if (!gate.ok) return gate;
    let removed = null;
    const w = await writeState(providerId, (s) => {
      s.tools = asArr(s.tools).filter((t) => { if (String(t.id) === String(toolId)) { removed = t; return false; } return true; });
    });
    if (w && w.error) return { error: w.error, message: w.message };
    if (!removed) return { error: "not_found" };
    await audit("remote_tool_remove", toolId, "Removed remote tool \"" + asObj(removed).name + "\".");
    return { ok: true, removed: toolId };
  };

  REM.setToolEnabled = async function (providerId, toolId, on) {
    return REM.updateTool(providerId, toolId, { enabled: !!on });
  };

  /* Launch, or generate a handoff link for, a tool against one device.
     Either way a session record is written against the device. */
  REM.launch = async function (providerId, toolId, deviceId, opts) {
    opts = opts || {};
    const gate = canRemote("tool", deviceId); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const tool = (await loadTools(g.provider)).find((t) => String(t.id) === String(toolId));
    if (!tool) return { error: "tool_not_found" };
    if (!tool.enabled) return { error: "tool_disabled", message: "This remote tool is disabled." };
    const device = resolveDevice(g.provider, deviceId);
    if (!device) return { error: "device_not_found" };
    const r = toolUrl(tool, device, opts.values);
    if (!r.url) return { error: "empty_url", message: "The tool has no launch URL template." };
    const mode = opts.mode === "handoff" ? "handoff" : "launch";
    const at = now();
    const session = {
      id: rid("rsess"),
      toolId: tool.id,
      toolName: tool.name,
      kind: tool.kind,
      deviceId: String(device.id),
      hostname: device.hostname || device.displayName || String(device.id),
      url: r.url,
      mode,
      status: "active",
      startedAt: at,
      startedBy: opts.by || currentUser(),
      endedAt: "",
      endedBy: "",
      notes: S(opts.notes, 400),
      ref: S(opts.ref, 120),
    };
    if (mode === "handoff") {
      session.handoffToken = rid("rhand").slice(5);
      session.handoffUrl = "https://perchance.org/" + String(window.generatorName || "") + "#rmm-remote-handoff=" + session.id + "." + session.handoffToken;
      session.redeemedAt = "";
      session.redeemedBy = "";
    }
    const w = await writeState(providerId, (s) => { s.sessions = [clone(session)].concat(asArr(s.sessions)).slice(0, sessionHistory()); }, 6);
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice(mode === "handoff" ? "remote_handoff" : "remote_launch", device.id,
      (mode === "handoff" ? "Generated a handoff link" : "Launched " + tool.name) + " for " + session.hostname + (r.missing.length ? " (unfilled: " + r.missing.join(", ") + ")" : "") + ".");
    return { ok: true, session: clone(session), url: r.url, missing: r.missing };
  };

  /* A colleague opens the handoff link; the token resolves the session. */
  REM.redeemHandoff = async function (providerId, token, opts) {
    opts = opts || {};
    let raw = String(token == null ? "" : token).trim();
    const hash = raw.indexOf("rmm-remote-handoff=");
    if (hash !== -1) raw = raw.slice(hash + "rmm-remote-handoff=".length);
    const parts = raw.split(".");
    const sessionId = parts[0];
    const tok = parts[1] || parts[0];
    let out = null;
    const w = await writeState(providerId, (s) => {
      const sess = asArr(s.sessions).find((x) => String(x.id) === String(sessionId) && String(x.handoffToken) === String(tok));
      if (!sess) return;
      sess.redeemedAt = now();
      sess.redeemedBy = opts.by || currentUser();
      sess.status = "active";
      out = clone(sess);
    });
    if (w && w.error) return { error: w.error, message: w.message };
    if (!out) return { error: "handoff_not_found", message: "That handoff link is not valid for this tenant." };
    await auditDevice("remote_handoff_redeem", out.deviceId, "Redeemed the handoff link for \"" + out.toolName + "\" on " + out.hostname + ".");
    return { ok: true, session: out };
  };

  REM.endSession = async function (providerId, sessionId, opts) {
    opts = opts || {};
    let out = null;
    const w = await writeState(providerId, (s) => {
      const sess = asArr(s.sessions).find((x) => String(x.id) === String(sessionId));
      if (!sess) return;
      sess.status = "ended";
      sess.endedAt = now();
      sess.endedBy = opts.by || currentUser();
      if (opts.notes) sess.notes = S(opts.notes, 400);
      out = clone(sess);
    });
    if (w && w.error) return { error: w.error, message: w.message };
    if (!out) return { error: "not_found" };
    await auditDevice("remote_session_end", out.deviceId, "Ended the remote session for \"" + out.toolName + "\" on " + out.hostname + ".");
    return { ok: true, session: out };
  };

  REM.listSessions = async function (providerId, filter) {
    filter = filter || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    let list = asArr(stateOf(p).sessions);
    if (filter.deviceId) list = list.filter((s) => String(s.deviceId) === String(filter.deviceId));
    if (filter.status) list = list.filter((s) => s.status === filter.status);
    if (filter.toolId) list = list.filter((s) => String(s.toolId) === String(filter.toolId));
    list.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    if (filter.limit) list = list.slice(0, filter.limit);
    return list.map((s) => Object.assign(clone(s), { kindLabel: kindLabel(s.kind) }));
  };
  REM.sessionsForDevice = (providerId, deviceId) => REM.listSessions(providerId, { deviceId });

  /* ─────────────────────── remote shell (Task 37) ─────────────────────── */

  function normalizeShell(raw) {
    const s = asObj(raw);
    return {
      id: S(s.id, 80) || rid("rshell"),
      providerId: S(s.providerId, 80),
      deviceId: S(s.deviceId, 80),
      hostname: S(s.hostname, 200) || "device",
      title: S(s.title, 160) || "Remote shell",
      language: S(s.language, 40) || "bash",
      status: s.status === "closed" ? "closed" : "active",
      timeoutSeconds: num(s.timeoutSeconds, commandTimeout()),
      openedAt: s.openedAt || now(),
      openedBy: S(s.openedBy, 120) || actor(),
      closedAt: S(s.closedAt, 40),
      closedBy: S(s.closedBy, 120),
      entries: asArr(s.entries).map(normalizeEntry),
    };
  }
  function normalizeEntry(raw) {
    const e = asObj(raw);
    return {
      id: S(e.id, 80) || rid("rcmd"),
      at: S(e.at, 40) || now(),
      by: S(e.by, 120) || actor(),
      command: S(e.command, commandMaxChars()),
      state: S(e.state, 30) || "queued",
      dangerous: !!e.dangerous,
      confirmed: !!e.confirmed,
      matches: asArr(e.matches).map((m) => ({ id: S(asObj(m).id, 120), label: S(asObj(m).label, 200), level: S(asObj(m).level, 20) })),
      jobId: S(e.jobId, 80),
      exitCode: e.exitCode == null ? null : num(e.exitCode, 0),
      stdout: S(e.stdout, 200000),
      stderr: S(e.stderr, 200000),
      error: S(e.error, 400),
      startedAt: S(e.startedAt, 40),
      endedAt: S(e.endedAt, 40),
      durationMs: e.durationMs == null ? null : num(e.durationMs, 0),
      queuedAt: S(e.queuedAt, 40) || S(e.at, 40) || now(),
    };
  }
  REM.normalizeShell = normalizeShell;
  REM.normalizeEntry = normalizeEntry;

  const DONE_STATES = ["succeeded", "failed", "timed-out", "unsupported", "cancelled", "expired", "blocked"];

  const loadShells = (provider) => asArr(stateOf(provider).shells).map(normalizeShell);

  REM.openShell = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const gate = canRemote("shell", deviceId); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const device = resolveDevice(g.provider, deviceId);
    if (!device) return { error: "device_not_found" };
    const shell = normalizeShell({
      providerId,
      deviceId: String(device.id),
      hostname: device.hostname || device.displayName || String(device.id),
      title: opts.title || ("Shell · " + (device.hostname || device.id)),
      language: opts.language || languageFor(device),
      timeoutSeconds: opts.timeoutSeconds || commandTimeout(),
      openedBy: opts.by || currentUser(),
    });
    const w = await writeState(providerId, (s) => { s.shells = [clone(shell)].concat(asArr(s.shells)).slice(0, sessionHistory()); }, 6);
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice("remote_shell_open", device.id, "Opened a remote " + shell.language + " shell on " + shell.hostname + ".");
    return { ok: true, shell: clone(shell) };
  };

  REM.getShell = async function (providerId, shellId) {
    const p = await providerOf(providerId);
    if (!p) return null;
    return loadShells(p).find((s) => String(s.id) === String(shellId)) || null;
  };
  REM.listShells = async function (providerId, filter) {
    filter = filter || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    let list = loadShells(p);
    if (filter.deviceId) list = list.filter((s) => String(s.deviceId) === String(filter.deviceId));
    if (filter.status) list = list.filter((s) => s.status === filter.status);
    list.sort((a, b) => String(b.openedAt || "").localeCompare(String(a.openedAt || "")));
    if (filter.limit) list = list.slice(0, filter.limit);
    return list.map((s) => Object.assign(clone(s), { commandCount: asArr(s.entries).length, pending: asArr(s.entries).filter((e) => DONE_STATES.indexOf(e.state) === -1).length }));
  };

  /* Run one command in a shell. The command is inspected against the
     deny-list; a confirm-level match needs `opts.confirm === true`, a
     block-level match is refused outright. An accepted command becomes
     an agent job and a transcript entry. */
  REM.runCommand = async function (providerId, shellId, command, opts) {
    opts = opts || {};
    const gate = canRemote("shell"); if (!gate.ok) return gate;
    const text = String(command == null ? "" : command);
    if (!text.trim()) return { error: "empty_command", message: "Type a command first." };
    if (text.length > commandMaxChars()) return { error: "command_too_long", message: "The command exceeds the size limit." };
    const verdict = inspectCommand(text);
    if (verdict.level === "block") {
      return { error: "command_blocked", message: "Blocked by the deny-list: " + verdict.matches.map((m) => m.label).join("; ") + ".", matches: verdict.matches };
    }
    if (verdict.level === "confirm" && requireConfirm() && !opts.confirm) {
      return { error: "confirmation_required", message: "This command is potentially destructive: " + verdict.matches.map((m) => m.label).join("; ") + ".", matches: verdict.matches };
    }
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const shells = loadShells(g.provider);
    const shell = shells.find((s) => String(s.id) === String(shellId));
    if (!shell) return { error: "shell_not_found" };
    if (shell.status === "closed") return { error: "shell_closed", message: "This shell session is closed." };
    const device = resolveDevice(g.provider, shell.deviceId);
    if (!device) return { error: "device_not_found" };

    if (!J || typeof J.enqueue !== "function") return { error: "no_job_engine" };
    const language = opts.language || shell.language;
    const jr = await J.enqueue({
      providerId, deviceIds: [shell.deviceId],
      name: "Remote shell · " + shell.hostname + " · " + text.slice(0, 40),
      language, script: text, timeoutSeconds: shell.timeoutSeconds,
      source: "remote-shell", createdBy: opts.by || currentUser(),
    });
    if (jr.error) return { error: jr.error, message: jr.message };

    const entry = normalizeEntry({
      command: text, by: opts.by || currentUser(), state: "queued", jobId: jr.job.id,
      dangerous: verdict.matches.length > 0, confirmed: verdict.level === "confirm" && !!opts.confirm,
      matches: verdict.matches,
    });
    const w = await writeState(providerId, (s) => {
      const target = asArr(s.shells).find((x) => String(x.id) === String(shellId));
      if (!target) return;
      target.entries = asArr(target.entries).concat([clone(entry)]).slice(-commandHistory());
      target.updatedAt = now();
    }, 6);
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice("remote_command", shell.deviceId,
      "Ran \"" + text.slice(0, 120) + "\" in shell " + shell.id + " on " + shell.hostname + " as " + entry.by +
      (entry.dangerous ? " (confirmed destructive command)" : "") + ".");
    return { ok: true, entry: clone(entry), job: clone(jr.job), matches: verdict.matches };
  };

  /* Fold the job engine's result for a pending entry back into the
     transcript, and enforce the local timeout so a job the agent never
     answers does not sit as "queued" forever. */
  async function syncEntries(provider, providerId) {
    const shells = loadShells(provider);
    const jobs = (J && typeof J.list === "function") ? await J.list(providerId, {}) : [];
    const byId = {};
    jobs.forEach((j) => { byId[String(j.id)] = j; });
    const at = Date.now();
    const changes = [];
    const nextShells = shells.map((shell) => {
      let dirty = false;
      const entries = asArr(shell.entries).map((e) => {
        if (DONE_STATES.indexOf(e.state) !== -1 || !e.jobId) return e;
        const job = byId[e.jobId];
        if (!job) return e;
        const res = asObj(asObj(job.results)[shell.deviceId]);
        const st = S(res.state, 30);
        const mapped = st === "succeeded" ? "succeeded" : st === "timed-out" ? "timed-out" : st === "failed" ? "failed"
          : st === "unsupported" ? "unsupported" : st === "cancelled" ? "cancelled" : st === "expired" ? "expired"
          : (st === "delivered" || st === "running") ? "running" : "queued";
        if (mapped === "running" && e.state !== "running") { dirty = true; return Object.assign({}, e, { state: "running", startedAt: res.startedAt || now() }); }
        if (mapped === "queued") {
          const since = msOf(e.startedAt) || msOf(e.queuedAt) || at;
          if (at - since > num(shell.timeoutSeconds, commandTimeout()) * 1000) {
            dirty = true;
            return Object.assign({}, e, { state: "timed-out", endedAt: now(), error: "No result within " + num(shell.timeoutSeconds, commandTimeout()) + "s — the agent did not answer." });
          }
          return e;
        }
        dirty = true;
        return Object.assign({}, e, {
          state: mapped, exitCode: res.exitCode == null ? null : num(res.exitCode, 0),
          stdout: String(res.stdout == null ? "" : res.stdout), stderr: String(res.stderr == null ? "" : res.stderr),
          error: mapped === "succeeded" ? "" : S(res.error || (mapped === "timed-out" ? "The agent reported a timeout." : "The command failed."), 400),
          startedAt: res.startedAt || e.startedAt, endedAt: res.endedAt || now(),
          durationMs: res.durationMs == null ? null : num(res.durationMs, 0),
        });
      });
      if (dirty) { changes.push(shell.id); return Object.assign({}, shell, { entries }); }
      return shell;
    });
    if (changes.length) {
      await writeState(providerId, (s) => {
        s.shells = nextShells.map((sh) => {
          if (changes.indexOf(sh.id) === -1) return sh;
          return clone(sh);
        });
      }, 6);
    }
    return { syncs: changes.length };
  }
  REM.syncEntries = syncEntries;

  REM.syncShell = async function (providerId, shellId) {
    const p = await providerOf(providerId);
    if (!p) return { error: "not_found" };
    await syncEntries(p, providerId);
    return { ok: true, shell: await REM.getShell(providerId, shellId) };
  };

  REM.closeShell = async function (providerId, shellId, opts) {
    opts = opts || {};
    let out = null;
    const w = await writeState(providerId, (s) => {
      const sh = asArr(s.shells).find((x) => String(x.id) === String(shellId));
      if (!sh) return;
      sh.status = "closed";
      sh.closedAt = now();
      sh.closedBy = opts.by || currentUser();
      out = clone(sh);
    });
    if (w && w.error) return { error: w.error, message: w.message };
    if (!out) return { error: "not_found" };
    await auditDevice("remote_shell_close", out.deviceId, "Closed the remote shell on " + out.hostname + " (" + asArr(out.entries).length + " command(s)).");
    return { ok: true, shell: out };
  };

  /* ─────────────────────── file transfer (Task 39) ─────────────────────── */

  const DANGEROUS_EXT = ["exe", "dll", "scr", "com", "pif", "cpl", "sys", "drv", "msi", "msp", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "jar", "hta", "sh", "bin", "iso", "img", "dmg", "app", "deb", "rpm"];
  REM.DANGEROUS_EXTENSIONS = DANGEROUS_EXT.slice();

  function extOf(name) {
    const m = /\.([a-z0-9]{1,8})$/i.exec(String(name == null ? "" : name).split(/[\\/]/).pop() || "");
    return m ? low(m[1]) : "";
  }
  REM.extOf = extOf;

  /* A quarantine check: flag archive/executable payloads and refused
     extensions. Returns { clean, flags, reason }. */
  function scanTransfer(transfer) {
    const t = asObj(transfer);
    const e = extOf(t.name || t.path);
    const flags = [];
    if (e && DANGEROUS_EXT.indexOf(e) !== -1) flags.push("executable_or_archive (." + e + ")");
    if (num(t.sizeBytes, 0) > maxFileBytes()) flags.push("oversize (" + bytesHuman(t.sizeBytes) + " > " + bytesHuman(maxFileBytes()) + ")");
    if (!String(t.path || "").trim()) flags.push("no destination path");
    const clean = flags.length === 0;
    return { clean, flags, reason: clean ? "clean" : flags.join("; ") };
  }
  REM.scanTransfer = scanTransfer;

  function transferChunks(content, encoding) {
    const step = chunkChars();
    if (encoding === "base64") {
      const unit = step - (step % 4);
      const out = [];
      for (let i = 0; i < content.length; i += unit) out.push(content.slice(i, i + unit));
      return out.length ? out : [""];
    }
    const out = [];
    let i = 0;
    while (i < content.length) {
      let end = Math.min(content.length, i + step);
      const c = content.charCodeAt(end - 1);
      if (c >= 0xD800 && c <= 0xDBFF) end -= 1;
      out.push(content.slice(i, Math.max(i + 1, end)));
      i = Math.max(i + 1, end);
    }
    return out.length ? out : [""];
  }
  REM.transferChunks = transferChunks;

  function psQuote(s) { return "'" + String(s == null ? "" : s).replace(/'/g, "''") + "'"; }

  /* Script that writes (or appends) one chunk on the device and prints
     the file's SHA-256 + size so the console can verify integrity. */
  function pushScript(family, path, b64, opts) {
    opts = opts || {};
    const append = !!opts.append;
    const p = String(path == null ? "" : path);
    if (String(family) === "Windows") {
      return [
        "$ErrorActionPreference='Stop'",
        "$p = " + psQuote(p),
        "$dir = Split-Path -Parent $p; if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }",
        "$b = [Convert]::FromBase64String(" + psQuote(b64) + ")",
        append
          ? "$fs = [IO.File]::Open($p,[IO.FileMode]::Append,[IO.FileAccess]::Write); $fs.Write($b,0,$b.Length); $fs.Close()"
          : "[IO.File]::WriteAllBytes($p,$b)",
        "$fi = Get-Item $p",
        "$h = (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower()",
        "Write-Output ('@@RMMFILE sha256 ' + $h + ' ' + $fi.Length)",
      ].join(";\n");
    }
    const q = "'" + p.replace(/'/g, "'\\''") + "'";
    const dir = p.replace(/\/[^/]*$/, "");
    return [
      dir ? "mkdir -p " + "'" + dir.replace(/'/g, "'\\''") + "'" : ":",
      (append ? ":" : "printf '' > " + q),
      "printf '%s' " + "'" + String(b64).replace(/'/g, "'\\''") + "' | base64 -d " + (append ? ">>" : ">") + " " + q,
      "if command -v sha256sum >/dev/null 2>&1; then H=$(sha256sum " + q + " | cut -d' ' -f1); else H=$(openssl dgst -sha256 " + q + " | awk '{print $NF}'); fi",
      "S=$(wc -c < " + q + " | tr -d ' ')",
      "echo \"@@RMMFILE sha256 $H $S\"",
    ].join(";\n");
  }

  /* Script that streams a file back as base64 + an integrity trailer. */
  function pullScript(family, path) {
    const p = String(path == null ? "" : path);
    if (String(family) === "Windows") {
      return [
        "$ErrorActionPreference='Stop'",
        "$p = " + psQuote(p),
        "if (-not (Test-Path $p)) { Write-Error 'file not found'; exit 2 }",
        "$b = [IO.File]::ReadAllBytes($p)",
        "[Convert]::ToBase64String($b)",
        "$h = (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower()",
        "Write-Output ('@@RMMFILE sha256 ' + $h + ' ' + $b.Length)",
      ].join(";\n");
    }
    const q = "'" + p.replace(/'/g, "'\\''") + "'";
    return [
      "if [ ! -f " + q + " ]; then echo 'file not found' >&2; exit 2; fi",
      "base64 < " + q,
      "if command -v sha256sum >/dev/null 2>&1; then H=$(sha256sum " + q + " | cut -d' ' -f1); else H=$(openssl dgst -sha256 " + q + " | awk '{print $NF}'); fi",
      "S=$(wc -c < " + q + " | tr -d ' ')",
      "echo \"@@RMMFILE sha256 $H $S\"",
    ].join(";\n");
  }
  REM.pushScript = pushScript;
  REM.pullScript = pullScript;

  /* Pull a @@RMMFILE trailer out of agent stdout and return the payload. */
  function parseTrailer(stdout) {
    const text = String(stdout == null ? "" : stdout);
    const re = /@@RMMFILE\s+(\w+)\s+([0-9a-fA-F]+)\s+(\d+)\s*$/m;
    const m = re.exec(text);
    if (!m) return { found: false };
    const before = text.slice(0, m.index);
    const b64 = before.replace(/\s+/g, "");
    const payload = b64decode(b64);
    return { found: true, algo: low(m[1]), checksum: low(m[2]), size: num(m[3], 0), b64, payload };
  }
  REM.parseTrailer = parseTrailer;

  function normalizeTransfer(raw) {
    const t = asObj(raw);
    return {
      id: S(t.id, 80) || rid("rxfer"),
      providerId: S(t.providerId, 80),
      deviceId: S(t.deviceId, 80),
      hostname: S(t.hostname, 200) || "device",
      direction: t.direction === "pull" ? "pull" : "push",
      path: S(t.path, 400),
      name: S(t.name, 240) || (String(t.path || "").split(/[\\/]/).pop() || "file"),
      encoding: t.encoding === "base64" ? "base64" : "utf8",
      sizeBytes: num(t.sizeBytes, 0),
      checksum: S(t.checksum, 80),
      checksumAlgo: S(t.checksumAlgo, 20) || "sha256",
      state: S(t.state, 30) || "queued",
      verified: t.verified === true,
      jobId: S(t.jobId, 80),
      chunks: asArr(t.chunks).map((c) => ({ index: num(asObj(c).index, 0), jobId: S(asObj(c).jobId, 80), state: S(asObj(c).state, 20) || "queued", bytes: num(asObj(c).bytes, 0) })),
      transferredBytes: num(t.transferredBytes, 0),
      payload: String(t.payload == null ? "" : t.payload),
      createdAt: S(t.createdAt, 40) || now(),
      createdBy: S(t.createdBy, 120) || actor(),
      startedAt: S(t.startedAt, 40),
      endedAt: S(t.endedAt, 40),
      error: S(t.error, 400),
      note: S(t.note, 300),
      quarantine: asObj(t.quarantine),
      releasedBy: S(t.releasedBy, 120),
    };
  }
  REM.normalizeTransfer = normalizeTransfer;

  function buildPushChunks(transfer) {
    const parts = transferChunks(transfer.payload, transfer.encoding);
    return parts.map((part, index) => {
      const b64 = transfer.encoding === "base64" ? part : b64encode(part);
      return { index, content: part, b64, append: index > 0 };
    });
  }

  async function enqueuePushChunks(providerId, transfer, device) {
    const parts = buildPushChunks(transfer);
    const family = familyFor(device);
    const chunks = [];
    for (const p of parts) {
      const script = pushScript(family, transfer.path, p.b64, { append: p.append });
      const jr = await J.enqueue({
        providerId, deviceIds: [transfer.deviceId],
        name: "Push " + transfer.name + (parts.length > 1 ? " [" + (p.index + 1) + "/" + parts.length + "]" : ""),
        language: languageFor(device), script, timeoutSeconds: commandTimeout(),
        source: "remote-transfer", createdBy: transfer.createdBy,
      });
      if (jr.error) return { error: jr.error, message: jr.message };
      chunks.push({ index: p.index, jobId: jr.job.id, state: "queued", bytes: utf8Bytes(p.append ? "" : p.content) });
    }
    return { chunks };
  }

  /* Push a file to a device. Uploads are quarantined first (unless the
     operator opts out) so a flagged payload can be reviewed before it is
     released to the endpoint. */
  REM.pushFile = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const gate = canRemote("transfer", deviceId); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const device = resolveDevice(g.provider, deviceId);
    if (!device) return { error: "device_not_found" };
    const path = String(opts.path == null ? "" : opts.path).trim();
    if (!path) return { error: "no_path", message: "A destination path is required." };
    const encoding = opts.encoding === "base64" ? "base64" : "utf8";
    const raw = String(opts.content == null ? "" : opts.content);
    if (!raw.length) return { error: "empty_file", message: "The file is empty." };
    const size = encoding === "base64" ? Math.floor(raw.replace(/\s+/g, "").length * 3 / 4) : utf8Bytes(raw);
    if (size > maxFileBytes()) return { error: "file_too_large", message: "The file is " + bytesHuman(size) + "; the limit is " + bytesHuman(maxFileBytes()) + "." };
    const checksum = sha256(encoding === "base64" ? b64decode(raw) : raw);
    const at = now();
    let transfer = normalizeTransfer({
      providerId, deviceId: String(device.id), hostname: device.hostname || String(device.id),
      direction: "push", path, name: opts.name || path.split(/[\\/]/).pop() || "file",
      encoding, sizeBytes: num(opts.sizeBytes, size), checksum, checksumAlgo: "sha256",
      payload: raw, createdBy: opts.by || currentUser(), note: opts.note, createdAt: at,
      state: quarantineUploads() && !opts.skipQuarantine ? "quarantined" : "queued",
      quarantine: quarantineUploads() && !opts.skipQuarantine ? { scannedAt: at, auto: true } : {},
    });
    if (transfer.state === "queued") {
      const q = await enqueuePushChunks(providerId, transfer, device);
      if (q.error) return { error: q.error, message: q.message };
      transfer.chunks = q.chunks;
      transfer.state = "in-progress";
      transfer.startedAt = at;
    } else {
      const scan = scanTransfer(transfer);
      transfer.quarantine.clean = scan.clean;
      transfer.quarantine.flags = scan.flags;
    }
    const w = await writeState(providerId, (s) => { s.transfers = [clone(transfer)].concat(asArr(s.transfers)).slice(0, transferHistory()); }, 6);
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice("remote_push", device.id, "Queued a file push of \"" + transfer.name + "\" (" + bytesHuman(size) + ") to " + transfer.path + " [" + transfer.state + "].");
    return { ok: true, transfer: clone(transfer) };
  };

  /* Review and release (or reject) a quarantined upload. */
  REM.releaseTransfer = async function (providerId, transferId, opts) {
    opts = opts || {};
    const gate = canRemote("transfer"); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const transfer = asArr(stateOf(g.provider).transfers).map(normalizeTransfer).find((t) => String(t.id) === String(transferId));
    if (!transfer) return { error: "not_found" };
    if (transfer.state !== "quarantined") return { error: "not_quarantined" };
    const scan = scanTransfer(transfer);
    if (!scan.clean && !opts.force) {
      return { error: "quarantine_blocked", message: "The payload was flagged: " + scan.reason + ". Use force to override.", flags: scan.flags };
    }
    const device = resolveDevice(g.provider, transfer.deviceId);
    if (!device) return { error: "device_not_found" };
    const q = await enqueuePushChunks(providerId, transfer, device);
    if (q.error) return { error: q.error, message: q.message };
    let out = null;
    const w = await writeState(providerId, (s) => {
      const t = asArr(s.transfers).find((x) => String(x.id) === String(transferId));
      if (!t) return;
      t.state = "in-progress";
      t.chunks = clone(q.chunks);
      t.startedAt = now();
      t.releasedBy = opts.by || currentUser();
      t.quarantine = Object.assign({}, asObj(t.quarantine), { clean: scan.clean, flags: scan.flags, releasedAt: now(), releasedBy: opts.by || currentUser(), forced: !!opts.force });
      out = clone(normalizeTransfer(t));
    }, 6);
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice("remote_transfer_release", transfer.deviceId, "Released the quarantined upload \"" + transfer.name + "\" to " + transfer.path + (scan.clean ? "" : " (override: " + scan.reason + ")") + ".");
    return { ok: true, transfer: out };
  };

  REM.rejectTransfer = async function (providerId, transferId, opts) {
    opts = opts || {};
    const gate = canRemote("transfer"); if (!gate.ok) return gate;
    let out = null;
    const w = await writeState(providerId, (s) => {
      const t = asArr(s.transfers).find((x) => String(x.id) === String(transferId));
      if (!t) return;
      t.state = "rejected";
      t.endedAt = now();
      t.error = S(opts.reason || "Rejected at the quarantine step.", 400);
      out = clone(normalizeTransfer(t));
    });
    if (w && w.error) return { error: w.error, message: w.message };
    if (!out) return { error: "not_found" };
    await auditDevice("remote_transfer_reject", out.deviceId, "Rejected the quarantined upload \"" + out.name + "\": " + out.error);
    return { ok: true, transfer: out };
  };

  /* Pull a file from a device. The job streams the file back as base64
     with a SHA-256 trailer the console verifies before trusting it. */
  REM.pullFile = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const gate = canRemote("transfer", deviceId); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const device = resolveDevice(g.provider, deviceId);
    if (!device) return { error: "device_not_found" };
    const path = String(opts.path == null ? "" : opts.path).trim();
    if (!path) return { error: "no_path", message: "A source path is required." };
    if (!J || typeof J.enqueue !== "function") return { error: "no_job_engine" };
    const jr = await J.enqueue({
      providerId, deviceIds: [String(device.id)],
      name: "Pull " + (path.split(/[\\/]/).pop() || "file"),
      language: languageFor(device), script: pullScript(familyFor(device), path), timeoutSeconds: commandTimeout(),
      source: "remote-transfer", createdBy: opts.by || currentUser(),
    });
    if (jr.error) return { error: jr.error, message: jr.message };
    const transfer = normalizeTransfer({
      providerId, deviceId: String(device.id), hostname: device.hostname || String(device.id),
      direction: "pull", path, name: opts.name || path.split(/[\\/]/).pop() || "file",
      encoding: "base64", jobId: jr.job.id, state: "in-progress",
      createdBy: opts.by || currentUser(), note: opts.note, startedAt: now(),
    });
    const w = await writeState(providerId, (s) => { s.transfers = [clone(transfer)].concat(asArr(s.transfers)).slice(0, transferHistory()); }, 6);
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice("remote_pull", device.id, "Requested a file pull of " + transfer.path + " from " + transfer.hostname + ".");
    return { ok: true, transfer: clone(transfer) };
  };

  /* Fold job results back into the transfer records, verifying integrity
     on completion and failing on mismatch. */
  async function syncTransferRecords(provider, providerId) {
    const links = asArr(stateOf(provider).transfers).map(normalizeTransfer);
    const jobs = (J && typeof J.list === "function") ? await J.list(providerId, {}) : [];
    const byId = {};
    jobs.forEach((j) => { byId[String(j.id)] = j; });
    const pending = ["queued", "in-progress"];
    const updates = [];
    const at = now();
    for (const t of links) {
      if (pending.indexOf(t.state) === -1) continue;
      if (t.direction === "pull") {
        const job = byId[t.jobId];
        if (!job) continue;
        const res = asObj(asObj(job.results)[t.deviceId]);
        const st = S(res.state, 30);
        if (st === "succeeded") {
          const parsed = parseTrailer(res.stdout);
          if (!parsed.found) updates.push(Object.assign({}, t, { state: "failed", error: "The agent returned no integrity trailer.", endedAt: at }));
          else {
            const computed = sha256(parsed.payload);
            const ok = computed === parsed.checksum;
            updates.push(Object.assign({}, t, {
              state: ok ? "succeeded" : "failed", verified: ok, sizeBytes: parsed.size,
              checksum: parsed.checksum, payload: parsed.b64, transferredBytes: parsed.size,
              endedAt: at, error: ok ? "" : "Checksum mismatch: expected " + parsed.checksum + ", computed " + computed + ".",
            }));
          }
        } else if (st && DONE_STATES.indexOf(st) !== -1) {
          updates.push(Object.assign({}, t, { state: st === "failed" ? "failed" : st, error: S(res.error || "The pull failed.", 400), endedAt: at }));
        }
        continue;
      }
      /* push: walk the chunks in order */
      const chunks = asArr(t.chunks).map((c) => Object.assign({}, c));
      let allDone = true, failed = null, transferred = 0;
      for (const c of chunks) {
        const job = byId[c.jobId];
        const res = job ? asObj(asObj(job.results)[t.deviceId]) : {};
        const st = S(res.state, 30);
        if (st === "succeeded") { c.state = "succeeded"; transferred += num(c.bytes, 0); }
        else if (st && DONE_STATES.indexOf(st) !== -1) { c.state = st; failed = failed || { state: st, error: res.error || "The transfer job failed." }; allDone = false; }
        else { c.state = st || "queued"; allDone = false; }
      }
      if (failed) {
        updates.push(Object.assign({}, t, { chunks, state: "failed", error: S(failed.error, 400), endedAt: at, transferredBytes: transferred }));
        continue;
      }
      if (allDone) {
        const last = chunks[chunks.length - 1];
        const lastRes = byId[last.jobId] ? asObj(asObj(byId[last.jobId].results)[t.deviceId]) : {};
        const parsed = parseTrailer(lastRes.stdout);
        let ok = true, error = "", size = t.sizeBytes;
        if (!parsed.found) { ok = false; error = "The agent returned no integrity trailer."; }
        else { size = parsed.size; ok = parsed.checksum === t.checksum; if (!ok) error = "Checksum mismatch: expected " + t.checksum + ", agent reported " + parsed.checksum + "."; }
        updates.push(Object.assign({}, t, {
          chunks, state: ok ? "succeeded" : "failed", verified: ok, sizeBytes: size,
          transferredBytes: size, endedAt: at, error,
        }));
      } else {
        updates.push(Object.assign({}, t, { chunks, state: "in-progress", transferredBytes: transferred }));
      }
    }
    if (updates.length) {
      const byTid = {};
      updates.forEach((u) => { byTid[String(u.id)] = u; });
      await writeState(providerId, (s) => {
        s.transfers = asArr(s.transfers).map((t) => (byTid[String(t.id)] ? clone(byTid[String(t.id)]) : t));
      }, 6);
    }
    return { updated: updates.length };
  }
  REM.syncTransferRecords = syncTransferRecords;

  REM.syncTransfers = async function (providerId) {
    const p = await providerOf(providerId);
    if (!p) return { error: "not_found" };
    await syncTransferRecords(p, providerId);
    return { ok: true, transfers: await REM.listTransfers(providerId) };
  };

  REM.listTransfers = async function (providerId, filter) {
    filter = filter || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    let list = asArr(stateOf(p).transfers).map(normalizeTransfer);
    if (filter.deviceId) list = list.filter((t) => String(t.deviceId) === String(filter.deviceId));
    if (filter.direction) list = list.filter((t) => t.direction === filter.direction);
    if (filter.state) list = list.filter((t) => t.state === filter.state);
    list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    if (filter.limit) list = list.slice(0, filter.limit);
    return list;
  };
  REM.getTransfer = async function (providerId, id) {
    return (await REM.listTransfers(providerId)).find((t) => String(t.id) === String(id)) || null;
  };
  REM.transfersForDevice = (providerId, deviceId) => REM.listTransfers(providerId, { deviceId });

  REM.cancelTransfer = async function (providerId, id) {
    const gate = canRemote("transfer"); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const t = asArr(stateOf(g.provider).transfers).map(normalizeTransfer).find((x) => String(x.id) === String(id));
    if (!t) return { error: "not_found" };
    for (const c of asArr(t.chunks)) { if (c.jobId && J && J.cancel) { try { await J.cancel(providerId, c.jobId, t.deviceId); } catch (e) {} } }
    if (t.jobId && J && J.cancel) { try { await J.cancel(providerId, t.jobId, t.deviceId); } catch (e) {} }
    let out = null;
    const w = await writeState(providerId, (s) => {
      const x = asArr(s.transfers).find((y) => String(y.id) === String(id));
      if (!x) return;
      x.state = "cancelled"; x.endedAt = now();
      out = clone(normalizeTransfer(x));
    });
    if (w && w.error) return { error: w.error, message: w.message };
    await auditDevice("remote_transfer_cancel", t.deviceId, "Cancelled the " + t.direction + " of \"" + t.name + "\".");
    return { ok: true, transfer: out };
  };

  REM.retryTransfer = async function (providerId, id) {
    const gate = canRemote("transfer"); if (!gate.ok) return gate;
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const t = asArr(stateOf(g.provider).transfers).map(normalizeTransfer).find((x) => String(x.id) === String(id));
    if (!t) return { error: "not_found" };
    if (["failed", "cancelled", "timed-out"].indexOf(t.state) === -1) return { error: "not_retryable" };
    if (t.direction === "pull") return REM.pullFile(providerId, t.deviceId, { path: t.path, name: t.name, note: t.note });
    return REM.pushFile(providerId, t.deviceId, { path: t.path, name: t.name, content: t.payload, encoding: t.encoding, note: t.note, skipQuarantine: true });
  };

  REM.transferDownloadUrl = function (transfer) {
    const t = asObj(transfer);
    const b64 = t.encoding === "base64" ? String(t.payload || "").replace(/\s+/g, "") : b64encode(t.payload || "");
    const type = /\.(png|jpe?g|gif|webp|svg)$/i.test(t.name || "") ? "image/*" : "application/octet-stream";
    return "data:" + type + ";base64," + b64;
  };

  /* ─────────────────────── rollup & activity ─────────────────────── */

  REM.rollup = async function (providerId) {
    const p = await providerOf(providerId);
    if (!p) return null;
    const shells = loadShells(p);
    const sessions = asArr(stateOf(p).sessions);
    const transfers = asArr(stateOf(p).transfers).map(normalizeTransfer);
    const tools = loadTools(p);
    const activeShells = shells.filter((s) => s.status === "active");
    const pending = shells.reduce((n, s) => n + asArr(s.entries).filter((e) => DONE_STATES.indexOf(e.state) === -1).length, 0);
    const commands = shells.reduce((n, s) => n + asArr(s.entries).length, 0);
    const blocked = shells.reduce((n, s) => n + asArr(s.entries).filter((e) => e.state === "blocked").length, 0);
    const activeSessions = sessions.filter((s) => s.status === "active");
    const dayAgo = Date.now() - 86400000;
    const transfersToday = transfers.filter((t) => (msOf(t.createdAt) || 0) >= dayAgo);
    return {
      tools: tools.length, toolsEnabled: tools.filter((t) => t.enabled).length,
      shells: shells.length, activeShells: activeShells.length, commands, pending, blocked,
      sessions: sessions.length, activeSessions: activeSessions.length,
      transfers: transfers.length, transfersToday: transfersToday.length,
      transferFailures: transfers.filter((t) => t.state === "failed").length,
      quarantined: transfers.filter((t) => t.state === "quarantined").length,
    };
  };

  REM.activity = async function (providerId, filter) {
    filter = filter || {};
    const p = await providerOf(providerId);
    if (!p) return [];
    const out = [];
    loadShells(p).forEach((sh) => asArr(sh.entries).forEach((e) => out.push({
      kind: "command", at: e.queuedAt || e.at, deviceId: sh.deviceId, hostname: sh.hostname, by: e.by,
      state: e.state, label: e.command, dangerous: e.dangerous, ref: sh.id, entryId: e.id,
    })));
    asArr(stateOf(p).sessions).forEach((s) => out.push({
      kind: "session", at: s.startedAt, deviceId: s.deviceId, hostname: s.hostname, by: s.startedBy,
      state: s.status, label: (s.mode === "handoff" ? "Handoff · " : "Launched ") + s.toolName, dangerous: false, ref: s.id,
    }));
    asArr(stateOf(p).transfers).map(normalizeTransfer).forEach((t) => out.push({
      kind: "transfer", at: t.createdAt, deviceId: t.deviceId, hostname: t.hostname, by: t.createdBy,
      state: t.state, label: (t.direction === "push" ? "Push " : "Pull ") + t.name + " · " + bytesHuman(t.sizeBytes), dangerous: false, ref: t.id,
    }));
    let list = out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (filter.deviceId) list = list.filter((x) => String(x.deviceId) === String(filter.deviceId));
    if (filter.kind) list = list.filter((x) => x.kind === filter.kind);
    if (filter.limit) list = list.slice(0, filter.limit);
    return list;
  };

  /* ─────────────────────── seed ─────────────────────── */

  const DEMO_TOOLS = [
    { id: "rtool-demo-rustdesk", name: "RustDesk", kind: "remote-control", urlTemplate: "rustdesk://{deviceId}", enabled: true, notes: "Unattended remote control via RustDesk." },
    { id: "rtool-demo-ssh", name: "SSH console", kind: "ssh", urlTemplate: "ssh://admin@{ip}", enabled: true, notes: "Direct SSH handoff (requires a route or tunnel)." },
    { id: "rtool-demo-web", name: "Web management console", kind: "web", urlTemplate: "https://{hostname}/", enabled: true, notes: "Browser-reachable device console." },
  ];

  async function seedDemoRun(opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { skipped: true, reason: "remote_disabled" };
    /* Use the first demo provider whose document actually loads — a cached
       listing can briefly carry a stale id (e.g. after a backend switch), and
       one bad entry must not stop the seed. */
    let demo = null, g = null;
    for (const d of (await T.list()).filter((p) => p.demo)) { const r = await T.get(d.id); if (!r.error) { demo = d; g = r; break; } }
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const exist = asArr(stateOf(g.provider).tools).map((t) => String(t.id));
    const need = DEMO_TOOLS.filter((t) => exist.indexOf(t.id) === -1);
    if (!need.length && !opts.force) return { skipped: true, reason: "remote_demo_exists", providerId: demo.id };
    const at = now();
    await writeState(demo.id, (s) => {
      const byId = {};
      asArr(s.tools).map(normalizeTool).forEach((t) => { byId[String(t.id)] = t; });
      (opts.force ? DEMO_TOOLS : need).forEach((t) => { byId[t.id] = normalizeTool(Object.assign({ createdAt: at, updatedAt: at }, t)); });
      s.tools = Object.keys(byId).map((k) => byId[k]);
    }, 6);
    REM.__seeded = { providerId: demo.id, tools: (opts.force ? DEMO_TOOLS : need).length };
    return { providerId: demo.id, tools: (opts.force ? DEMO_TOOLS : need).length };
  }
  REM.seedDemo = function (opts) {
    opts = opts || {};
    if (REM.__seedPromise && !opts.force) return REM.__seedPromise;
    const start = REM.__seedPromise ? REM.__seedPromise.catch(() => {}) : Promise.resolve();
    const p = start.then(() => seedDemoRun(opts)).catch((e) => { console.error("remote seed failed", e); return { error: "seed_failed", message: String((e && e.message) || e) }; });
    REM.__seedPromise = p;
    const clear = () => { if (REM.__seedPromise === p) REM.__seedPromise = null; };
    p.then(clear, clear);
    return p;
  };

  /* ─────────────────────── UI ─────────────────────── */

  const STATE_TONE = { queued: "muted", running: "info", succeeded: "success", failed: "danger", "timed-out": "warn", blocked: "danger", unsupported: "warn", cancelled: "muted", expired: "muted", quarantined: "warn", rejected: "danger", "in-progress": "info", active: "info", ended: "muted", closed: "muted" };

  function stateBadge(state) {
    return ui.badge(String(state || "—"), STATE_TONE[state] || "muted");
  }
  REM.stateBadge = stateBadge;

  function deviceOptions(provider, selected) {
    return asArr(asObj(provider).devices).map(D.normalizeDevice).sort((a, b) => String(a.hostname).localeCompare(String(b.hostname)))
      .map((d) => ({ value: String(d.id), label: (d.hostname || d.id) + (asObj(d.os).name ? " · " + asObj(d.os).name : "") }));
  }

  function commandOutputHtml(entry) {
    const out = String(entry.stdout || "");
    const err = String(entry.stderr || "");
    if (entry.state === "blocked") return '<div class="rmm-term-out tone-danger">Blocked by the deny-list: ' + esc(asArr(entry.matches).map((m) => m.label).join("; ") || "refused") + "</div>";
    if (entry.state === "timed-out") return '<div class="rmm-term-out tone-warn">No result within the timeout — the agent did not answer.</div>';
    if (DONE_STATES.indexOf(entry.state) === -1) return '<div class="rmm-term-out rmm-term-pending"><span class="rmm-spinner"></span> waiting for the agent…</div>';
    if (!out.trim() && !err.trim()) return '<div class="rmm-term-out rmm-term-empty">(no output)</div>';
    return (out.trim() ? '<div class="rmm-term-out">' + esc(out) + "</div>" : "") + (err.trim() ? '<div class="rmm-term-out tone-danger">' + esc(err) + "</div>" : "");
  }

  function terminalHtml(shell) {
    const entries = asArr(shell.entries);
    const lines = entries.map((e) => (
      '<div class="rmm-term-line' + (e.dangerous ? " tone-warn" : "") + '">' +
        '<div class="rmm-term-cmd"><span class="rmm-term-prompt">$</span> <b>' + esc(e.command) + "</b>" +
        '<span class="rmm-term-meta">' + esc(e.by) + " · " + esc(ui.dateTime(e.queuedAt || e.at)) + (e.exitCode == null ? "" : " · exit " + e.exitCode) + "</span></div>" +
        commandOutputHtml(e) +
      "</div>"
    )).join("");
    if (!entries.length) return '<div class="rmm-term"><div class="rmm-term-empty">No commands yet. Type one below and press Run.</div></div>';
    return '<div class="rmm-term">' + lines + "</div>";
  }
  REM.terminalHtml = terminalHtml;

  function shellSummary(shell) {
    return '<div class="erp-summary">' +
      '<div class="erp-summary-item"><span>Device</span><b>' + esc(shell.hostname) + "</b></div>" +
      '<div class="erp-summary-item"><span>Shell</span><b>' + esc(shell.language) + "</b></div>" +
      '<div class="erp-summary-item"><span>Opened by</span><b>' + esc(shell.openedBy) + "</b></div>" +
      '<div class="erp-summary-item"><span>Status</span><b>' + esc(shell.status) + "</b></div>" +
      '<div class="erp-summary-item"><span>Timeout</span><b>' + num(shell.timeoutSeconds, commandTimeout()) + "s</b></div>" +
      "</div>";
  }

  async function shellPanel(provider, providerId, state, opts) {
    const gate = canRemote("shell");
    const shells = (await REM.listShells(providerId)).slice(0, 50);
    const selectedId = state.shellId && shells.some((s) => s.id === state.shellId) ? state.shellId : (shells[0] && shells[0].id);
    state.shellId = selectedId;
    const shellsById = {};
    (await REM.listShells(providerId)).forEach((s) => { shellsById[s.id] = s; });
    const shell = selectedId ? shellsById[selectedId] : null;
    if (!gate.ok) return ui.card("Remote shell", ui.alert(gate.message, "warn"));

    const picker = shells.length
      ? '<div class="rmm-remote-bar"><select name="rm_shell">' + shells.map((s) => '<option value="' + esc(s.id) + '"' + (s.id === selectedId ? " selected" : "") + ">" + esc(s.title) + " · " + esc(s.hostname) + " (" + esc(s.status) + ")</option>").join("") + "</select>" +
        (shell ? ui.btn("Close shell", { small: true, act: "rm-shell-close", arg: shell.id }) : "") + " " + ui.btn("New shell", { small: true, primary: true, act: "rm-shell-new" }) + "</div>"
      : ui.btn("New shell", { small: true, primary: true, act: "rm-shell-new" });

    const term = shell ? (
      shellSummary(shell) +
      terminalHtml(shell) +
      (shell.status === "closed"
        ? '<p class="erp-sub">This session is closed.</p>'
        : '<form class="rmm-remote-input" data-rm-shell-form="' + esc(shell.id) + '"><input type="text" name="rm_cmd" placeholder="Type a command and press Enter…" autocomplete="off"><button class="btn btn-primary" type="submit">Run</button></form>' +
          '<p class="erp-sub">Commands run as agent jobs (' + esc(shell.language) + '). Destructive commands require confirmation; the deny-list blocks the rest.</p>')
    ) : '<p class="erp-sub">Open a shell to a device to start running commands.</p>';

    const recent = shells.slice(0, 20).map((s) => ({
      shell: "<b>" + esc(s.hostname) + "</b><div class=\"erp-sub\">" + esc(s.language) + " · " + esc(ui.dateTime(s.openedAt)) + "</div>",
      commands: String(s.commandCount),
      pending: s.pending ? ui.badge(String(s.pending) + " pending", "info") : "—",
      state: stateBadge(s.status),
      actions: ui.btn("Open", { small: true, act: "rm-shell-open", arg: s.id }),
    }));

    return ui.card("Remote shell", "<p class=\"erp-sub\">A shell session is a transcript of commands dispatched to the agent — who ran what, when, and the agent's real output.</p>" + picker + term, { actions: ui.btn("Refresh", { small: true, act: "rm-refresh" }) }) +
      ui.card("Sessions (" + shells.length + ")", ui.table([
        { key: "shell", label: "Device", render: (r) => r.shell },
        { key: "commands", label: "Commands", align: "right", render: (r) => r.commands },
        { key: "pending", label: "Queue", render: (r) => r.pending },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "actions", label: "", render: (r) => r.actions },
      ], recent, { scroll: true, emptyText: "No shell sessions yet." }));
  }

  async function toolsPanel(provider, providerId, state, opts) {
    const gate = canRemote("tool");
    if (!gate.ok) return ui.card("Remote tools", ui.alert(gate.message, "warn"));
    const tools = await REM.listTools(providerId);
    const sessions = (await REM.listSessions(providerId, { limit: 25 }));
    const rows = tools.map((t) => ({
      name: "<b>" + esc(t.name) + "</b>" + (t.notes ? '<div class="erp-sub">' + esc(t.notes) + "</div>" : ""),
      kind: ui.badge(kindLabel(t.kind), "muted"),
      url: "<code>" + esc(t.urlTemplate) + "</code>",
      state: t.enabled ? ui.badge("enabled", "success") : ui.badge("disabled", "muted"),
      actions: ui.btn("Launch", { small: true, primary: true, act: "rm-tool-launch", arg: t.id }) + " " +
        ui.btn("Handoff", { small: true, act: "rm-tool-handoff", arg: t.id }) + " " +
        ui.btn("Edit", { small: true, act: "rm-tool-edit", arg: t.id }) + " " +
        ui.btn(t.enabled ? "Disable" : "Enable", { small: true, act: "rm-tool-toggle", arg: t.id }) + " " +
        ui.btn("Delete", { small: true, danger: true, act: "rm-tool-del", arg: t.id }),
    }));
    const sessRows = sessions.map((s) => ({
      when: esc(ui.dateTime(s.startedAt)),
      tool: "<b>" + esc(s.toolName) + "</b>",
      device: esc(s.hostname),
      mode: ui.badge(s.mode === "handoff" ? "handoff" : "launch", s.mode === "handoff" ? "info" : "muted") + (s.redeemedAt ? ' <span class="erp-sub">redeemed</span>' : ""),
      by: esc(s.startedBy),
      state: stateBadge(s.status),
      actions: s.status === "active" ? ui.btn("End", { small: true, act: "rm-session-end", arg: s.id }) : "",
    }));
    return ui.card("Tools (" + tools.length + ")", "<p class=\"erp-sub\">Launch a remote-control, tunnel or web tool pre-targeted at a device, or generate a handoff link for a colleague. Every launch is recorded against the device.</p>" +
        ui.table([
          { key: "name", label: "Tool", render: (r) => r.name },
          { key: "kind", label: "Kind", render: (r) => r.kind },
          { key: "url", label: "Launches with", render: (r) => r.url },
          { key: "state", label: "State", render: (r) => r.state },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No remote tools yet." }),
        { actions: ui.btn("New tool", { small: true, primary: true, act: "rm-tool-new" }) + " " + ui.btn("Redeem handoff", { small: true, act: "rm-handoff-redeem" }) }) +
      ui.card("Recent sessions (" + sessions.length + ")", ui.table([
        { key: "when", label: "Started", render: (r) => r.when },
        { key: "tool", label: "Tool", render: (r) => r.tool },
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "mode", label: "Mode", render: (r) => r.mode },
        { key: "by", label: "By", render: (r) => r.by },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "actions", label: "", render: (r) => r.actions },
      ], sessRows, { scroll: true, emptyText: "No sessions yet." }));
  }

  async function filesPanel(provider, providerId, state, opts) {
    const gate = canRemote("transfer");
    if (!gate.ok) return ui.card("File transfer", ui.alert(gate.message, "warn"));
    const transfers = (await REM.listTransfers(providerId, { limit: 60 }));
    const rows = transfers.map((t) => ({
      dir: t.direction === "push" ? ui.badge("push", "info") : ui.badge("pull", "muted"),
      name: "<b>" + esc(t.name) + "</b><div class=\"erp-sub\">" + esc(t.path) + "</div>",
      device: esc(t.hostname),
      size: bytesHuman(t.sizeBytes) + (t.transferredBytes && t.transferredBytes !== t.sizeBytes ? ' <span class="erp-sub">' + bytesHuman(t.transferredBytes) + " sent</span>" : ""),
      integrity: t.state === "succeeded" ? (t.verified ? ui.badge("verified", "success") : ui.badge("unverified", "warn")) : (t.checksum ? '<code title="' + esc(t.checksum) + '">' + esc(t.checksum.slice(0, 10)) + "…</code>" : "—"),
      state: stateBadge(t.state) + (t.error ? '<div class="erp-sub" title="' + esc(t.error) + '">' + esc(t.error.length > 46 ? t.error.slice(0, 45) + "…" : t.error) + "</div>" : ""),
      by: esc(t.createdBy),
      actions: (t.state === "quarantined" ? ui.btn("Release", { small: true, primary: true, act: "rm-xfer-release", arg: t.id }) + " " + ui.btn("Reject", { small: true, danger: true, act: "rm-xfer-reject", arg: t.id }) + " " : "") +
        (["queued", "in-progress", "quarantined"].indexOf(t.state) !== -1 ? ui.btn("Cancel", { small: true, act: "rm-xfer-cancel", arg: t.id }) + " " : "") +
        (["failed", "cancelled", "timed-out"].indexOf(t.state) !== -1 ? ui.btn("Retry", { small: true, act: "rm-xfer-retry", arg: t.id }) + " " : "") +
        (t.direction === "pull" && t.state === "succeeded" ? ui.btn("Download", { small: true, act: "rm-xfer-download", arg: t.id }) + " " : "") +
        ui.btn("Details", { small: true, act: "rm-xfer-view", arg: t.id }),
    }));
    return ui.card("Transfers (" + transfers.length + ")",
      "<p class=\"erp-sub\">Push and pull files through the agent. Transfers are chunked, checked by SHA-256, capped at " + bytesHuman(maxFileBytes()) + ", and uploads pass a quarantine check before release.</p>" +
      '<div class="rmm-remote-bar">' + ui.btn("Push file", { small: true, primary: true, act: "rm-xfer-push" }) + " " + ui.btn("Pull file", { small: true, act: "rm-xfer-pull" }) + " " + ui.btn("Sync", { small: true, act: "rm-refresh" }) + "</div>" +
      ui.table([
        { key: "dir", label: "Dir", width: "58px", render: (r) => r.dir },
        { key: "name", label: "File", render: (r) => r.name },
        { key: "device", label: "Device", width: "118px", render: (r) => r.device },
        { key: "size", label: "Size", width: "84px", render: (r) => r.size },
        { key: "integrity", label: "Integrity", width: "104px", render: (r) => r.integrity },
        { key: "state", label: "State", width: "132px", render: (r) => r.state },
        { key: "by", label: "By", width: "84px", render: (r) => r.by },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No file transfers yet." }));
  }

  async function statCards(providerId) {
    const r = (await REM.rollup(providerId)) || {};
    return ui.grid([
      ui.statCard({ label: "Active shells", value: String(num(r.activeShells, 0)), sub: num(r.shells, 0) + " session(s)" }),
      ui.statCard({ label: "Commands pending", value: String(num(r.pending, 0)), tone: num(r.pending, 0) ? "info" : "muted", sub: num(r.commands, 0) + " run in total" }),
      ui.statCard({ label: "Blocked commands", value: String(num(r.blocked, 0)), tone: num(r.blocked, 0) ? "danger" : "muted", sub: "refused by the deny-list" }),
      ui.statCard({ label: "Active sessions", value: String(num(r.activeSessions, 0)), sub: num(r.sessions, 0) + " recorded" }),
      ui.statCard({ label: "Transfers (24h)", value: String(num(r.transfersToday, 0)), sub: num(r.transfers, 0) + " total" }),
      ui.statCard({ label: "Awaiting review", value: String(num(r.quarantined, 0)), tone: num(r.quarantined, 0) ? "warn" : "muted", sub: num(r.transferFailures, 0) + " failed transfer(s)" }),
    ], "erp-grid-3");
  }

  /* The Devices station's "Remote" tab. */
  REM.renderRemote = async function (panel, opts) {
    opts = opts || {};
    const provider = opts.provider;
    const providerId = opts.providerId;
    const toast = opts.toast || (() => {});
    if (opts.state && typeof opts.state.__destroy === "function") { try { opts.state.__destroy(); } catch (e) {} }
    const state = opts.state || { tab: opts.tab || "shell", shellId: opts.shellId || null };
    let bound = panel.__rmBound;
    let poll = null;
    state.__destroy = () => { if (poll) { clearTimeout(poll); poll = null; } };

    async function paint() {
      if (poll) { clearTimeout(poll); poll = null; }
      const p = await providerOf(providerId);
      if (!p) { panel.innerHTML = ui.alert("This tenant's document could not be loaded.", "warn"); return; }
      const tabs = ui.tabs([
        { id: "shell", label: "Shell" },
        { id: "tools", label: "Remote tools" },
        { id: "files", label: "File transfer" },
      ], state.tab);
      panel.innerHTML = '<div class="rmm-remote-inner">' + (await statCards(providerId)) + tabs.html + "</div>";
      const el = panel.querySelector('.erp-tab-panel[data-panel="' + state.tab + '"]');
      if (el) {
        if (state.tab === "shell") el.innerHTML = await shellPanel(p, providerId, state, opts);
        else if (state.tab === "tools") el.innerHTML = await toolsPanel(p, providerId, state, opts);
        else el.innerHTML = await filesPanel(p, providerId, state, opts);
      }
      const pending = (await REM.rollup(providerId) || {}).pending || 0;
      if (state.tab === "shell" && pending) poll = setTimeout(() => { REM.syncShell(providerId, state.shellId).catch(() => {}).then(paintSafe); }, 2500);
    }
    function paintSafe() { try { return paint(); } catch (e) {} }

    function readCmd() {
      const input = panel.querySelector('[name="rm_cmd"]');
      return input ? input.value : "";
    }

    async function run(cmd, confirm) {
      const r = await REM.runCommand(providerId, state.shellId, cmd, { confirm });
      if (r.error === "confirmation_required") {
        const ok = await ui.confirm({ title: "Run a destructive command?", message: r.message, okLabel: "Run anyway", danger: true });
        if (!ok) return;
        return run(cmd, true);
      }
      if (r.error) { toast(r.message || r.error, "error"); return; }
      toast("Command dispatched to " + (asObj(r.entry).command ? "the agent" : "the device"), "info");
      await paint();
    }

    if (!bound) {
      panel.__rmBound = true;
      panel.addEventListener("click", (e) => {
        const t = e.target.closest && e.target.closest("[data-tab]");
        if (t && panel.contains(t)) { state.tab = t.getAttribute("data-tab"); ui.showTab(panel, state.tab); paint(); return; }
      });
      panel.addEventListener("change", (e) => {
        const sel = e.target.closest && e.target.closest('[name="rm_shell"]');
        if (sel) { state.shellId = sel.value; paint(); }
      });
      panel.addEventListener("submit", (e) => {
        const form = e.target.closest && e.target.closest("[data-rm-shell-form]");
        if (!form) return;
        e.preventDefault();
        const cmd = readCmd();
        if (cmd && cmd.trim()) { const input = panel.querySelector('[name="rm_cmd"]'); if (input) input.value = ""; run(cmd, false); }
      });
      ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
        if (!panel.contains(el)) return;
        try {
          if (act === "rm-refresh") { const p = await providerOf(providerId); await syncEntries(p, providerId); await syncTransferRecords(p, providerId); return paint(); }
          if (act === "rm-shell-open") { state.shellId = arg; state.tab = "shell"; await paint(); return; }
          if (act === "rm-shell-new") return openShellDialog(providerId, toast, async (id) => { state.shellId = id; state.tab = "shell"; await paint(); });
          if (act === "rm-shell-close") { const r = await REM.closeShell(providerId, arg); if (r.error) return toast(r.message || r.error, "error"); return paint(); }
          if (act === "rm-tool-new") return openToolDialog(providerId, null, toast, paint);
          if (act === "rm-tool-edit") return openToolDialog(providerId, arg, toast, paint);
          if (act === "rm-tool-toggle") { const tool = await REM.getTool(providerId, arg); const r = await REM.setToolEnabled(providerId, arg, tool && !tool.enabled); if (r.error) return toast(r.message || r.error, "error"); return paint(); }
          if (act === "rm-tool-del") {
            if (!(await ui.confirm({ title: "Delete this remote tool?", message: "Sessions already recorded are kept.", danger: true, okLabel: "Delete" }))) return;
            const r = await REM.removeTool(providerId, arg); if (r.error) return toast(r.message || r.error, "error"); return paint();
          }
          if (act === "rm-tool-launch" || act === "rm-tool-handoff") return openLaunchDialog(providerId, arg, act === "rm-tool-handoff" ? "handoff" : "launch", toast, paint);
          if (act === "rm-handoff-redeem") return openRedeemDialog(providerId, toast, paint);
          if (act === "rm-session-end") { const r = await REM.endSession(providerId, arg); if (r.error) return toast(r.message || r.error, "error"); return paint(); }
          if (act === "rm-xfer-push") return openPushDialog(providerId, toast, paint);
          if (act === "rm-xfer-pull") return openPullDialog(providerId, toast, paint);
          if (act === "rm-xfer-release") { const r = await REM.releaseTransfer(providerId, arg); if (r.error) return handleTransferError(r, () => REM.releaseTransfer(providerId, arg, { force: true }), toast, paint); return paint(); }
          if (act === "rm-xfer-reject") { const r = await REM.rejectTransfer(providerId, arg); if (r.error) return toast(r.message || r.error, "error"); return paint(); }
          if (act === "rm-xfer-cancel") { const r = await REM.cancelTransfer(providerId, arg); if (r.error) return toast(r.message || r.error, "error"); return paint(); }
          if (act === "rm-xfer-retry") { const r = await REM.retryTransfer(providerId, arg); if (r.error) return toast(r.message || r.error, "error"); return paint(); }
          if (act === "rm-xfer-view") return openTransferView(providerId, arg, toast, paint);
          if (act === "rm-xfer-download") { const t = await REM.getTransfer(providerId, arg); if (t) downloadTransfer(t); return; }
        } catch (err) { toast(String((err && err.message) || err), "error"); }
      });
    }
    await paint();
    if (!opts.__noSync) { try { const p = await providerOf(providerId); await syncEntries(p, providerId); await syncTransferRecords(p, providerId); } catch (e) {} }
    return { paint, destroy: () => { if (poll) clearTimeout(poll); } };
  };

  /* Device-modal section: the device's remotable actions + history. */
  REM.deviceSection = async function (device, providerId) {
    if (!enabled()) return "";
    const gate = canRemote("shell");
    const tools = (await REM.listTools(providerId)).filter((t) => t.enabled);
    const shells = (await REM.listShells(providerId, { deviceId: device.id, limit: 5 }));
    const sessions = await REM.sessionsForDevice(providerId, device.id);
    const transfers = (await REM.transfersForDevice(providerId, device.id)).slice(0, 5);
    const launchBtns = tools.length ? tools.map((t) => ui.btn(t.name, { small: true, act: "rm-dev-tool", arg: t.id })).join(" ") : '<span class="erp-sub">No remote tools configured.</span>';
    const rows = [
      ['Shell', gate.ok ? ui.btn("Open remote shell", { small: true, primary: true, act: "rm-dev-shell" }) + (shells.length ? " " + ui.btn("History (" + shells.length + ")", { small: true, act: "rm-dev-shells" }) : "") : '<span class="erp-sub">' + esc(gate.message) + "</span>"],
      ["Remote tools", launchBtns],
      ["Recent sessions", sessions.length ? sessions.slice(0, 4).map((s) => ui.badge(s.toolName, s.status === "active" ? "info" : "muted")).join(" ") : '<span class="erp-sub">None recorded.</span>'],
      ["Transfers", gate.ok ? ui.btn("Push file", { small: true, act: "rm-dev-push" }) + " " + ui.btn("Pull file", { small: true, act: "rm-dev-pull" }) + " " + (transfers.length ? '<span class="erp-sub">' + transfers.length + " recent</span>" : "") : '<span class="erp-sub">Permission required.</span>'],
    ];
    return "<h4 class=\"rmm-section-title\">Remote access</h4>" +
      '<div class="rmm-kv">' + rows.map((x) => '<div class="rmm-kv-row"><span>' + esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>";
  };

  /* Bind the device-modal remote actions. Mirrors the jobs/software
     `wireDeviceSection` seam so the Devices module stays the owner of the
     modal. */
  REM.wireDeviceSection = function (modal, ctx) {
    if (!modal || !ctx) return;
    const providerId = ctx.providerId;
    const deviceId = ctx.deviceId;
    const toast = ctx.toast || (() => {});
    let handler = modal.__rmHandler;
    if (handler) modal.removeEventListener("click", handler);
    handler = async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      const arg = t.getAttribute("data-arg");
      try {
        if (act === "rm-dev-shell") { const r = await REM.openShell(providerId, deviceId); if (r.error) return toast(r.message || r.error, "error"); ui.closeModal(); if (ctx.onOpenShell) ctx.onOpenShell(r.shell.id); else toast("Shell opened — see Devices → Remote → Shell.", "info"); return; }
        if (act === "rm-dev-shells") { const list = await REM.listShells(providerId, { deviceId }); toast(list.length + " shell session(s) — see Devices → Remote.", "info"); return; }
        if (act === "rm-dev-tool") { const r = await REM.launch(providerId, arg, deviceId); if (r.error) return toast(r.message || r.error, "error"); toast("Session recorded.", "info"); openUrl(r.url); return; }
        if (act === "rm-dev-push") { ui.closeModal(); if (ctx.onOpenFiles) ctx.onOpenFiles(); else toast("Open Devices → Remote → File transfer to push a file.", "info"); return; }
        if (act === "rm-dev-pull") { ui.closeModal(); if (ctx.onOpenFiles) ctx.onOpenFiles(); else toast("Open Devices → Remote → File transfer to pull a file.", "info"); return; }
      } catch (err) { toast(String((err && err.message) || err), "error"); }
    };
    modal.__rmHandler = handler;
    modal.addEventListener("click", handler);
  };

  function openUrl(url) {
    if (!url) return;
    try { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0); } catch (e) {}
  }
  REM.openUrl = openUrl;

  function downloadTransfer(t) {
    try {
      const a = document.createElement("a");
      a.href = REM.transferDownloadUrl(t);
      a.download = t.name || "file";
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0);
    } catch (e) {}
  }
  REM.downloadTransfer = downloadTransfer;

  async function handleTransferError(r, retry, toast, paint) {
    if (r.error === "quarantine_blocked") {
      if (await ui.confirm({ title: "Release a flagged upload?", message: r.message, okLabel: "Release anyway", danger: true })) return retry();
      return;
    }
    toast(r.message || r.error, "error");
  }

  /* ── dialogs ── */

  let modalHandler = null;
  function bindModal(fn) {
    const m = document.querySelector("#uiModal");
    if (!m) return null;
    if (modalHandler) m.removeEventListener("click", modalHandler);
    modalHandler = typeof fn === "function" ? fn : null;
    if (modalHandler) m.addEventListener("click", modalHandler);
    return m;
  }

  async function openShellDialog(providerId, toast, done) {
    const p = await providerOf(providerId);
    const optsEls = deviceOptions(p);
    if (!optsEls.length) return toast("Enroll a device first.", "error");
    ui.modal({
      title: "Open a remote shell",
      body: ui.form(ui.select("rm_dev", "Device", optsEls, optsEls[0].value) +
        ui.select("rm_lang", "Shell language", [{ value: "powershell", label: "PowerShell" }, { value: "cmd", label: "Command prompt" }, { value: "bash", label: "Bash" }, { value: "sh", label: "POSIX shell" }], "bash") +
        ui.number("rm_timeout", "Command timeout (seconds)", commandTimeout(), { min: 10 }),
        ui.btn("Open shell", { primary: true, act: "rm-shell-create" }) + " " + ui.btn("Cancel", { act: "rm-cancel" })),
    });
    const m = document.querySelector("#uiModal");
    bindModal(async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      if (t.getAttribute("data-act") === "rm-cancel") return ui.closeModal();
      if (t.getAttribute("data-act") !== "rm-shell-create") return;
      const vals = ui.collect(m, ["rm_dev", "rm_lang", "rm_timeout"]);
      const r = await REM.openShell(providerId, asObj(vals).rm_dev, { language: asObj(vals).rm_lang, timeoutSeconds: num(asObj(vals).rm_timeout, commandTimeout()) });
      if (r.error) return toast(r.message || r.error, "error");
      ui.closeModal();
      if (done) await done(r.shell.id); else toast("Shell opened.", "info");
    });
  }

  async function openToolDialog(providerId, toolId, toast, done) {
    const existing = toolId ? await REM.getTool(providerId, toolId) : null;
    const draft = existing || { name: "", kind: "custom", urlTemplate: "", notes: "", enabled: true };
    const presetBar = PRESETS.map((x) => ui.btn(x.name, { small: true, act: "rm-preset", arg: x.id })).join(" ");
    ui.modal({
      title: existing ? "Edit remote tool" : "New remote tool",
      size: "lg",
      body: ui.form(
        '<p class="erp-sub">Start from a preset — ' + presetBar + '</p>' +
        ui.text("rt_name", "Name", draft.name) +
        ui.select("rt_kind", "Kind", TOOL_KINDS.map((k) => ({ value: k.id, label: k.label })), draft.kind) +
        ui.text("rt_url", "Launch URL template", draft.urlTemplate, "rustdesk://{deviceId}") +
        '<p class="erp-sub">Placeholders: {hostname} {deviceId} {ip} {user} {domain} {os} {site} {name}</p>' +
        ui.textarea("rt_notes", "Notes", draft.notes, 2) +
        ui.check("rt_enabled", "Enabled", draft.enabled !== false),
        ui.btn("Save", { primary: true, act: "rm-tool-save" }) + " " + ui.btn("Cancel", { act: "rm-cancel" })),
    });
    const m = document.querySelector("#uiModal");
    bindModal(async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rm-cancel") return ui.closeModal();
      if (act === "rm-preset") {
        const preset = PRESETS.find((x) => x.id === t.getAttribute("data-arg"));
        if (preset) {
          const set = (name, val) => { const el = m.querySelector('[name="' + name + '"]'); if (el) el.value = val; };
          set("rt_name", preset.name); set("rt_url", preset.urlTemplate); set("rt_kind", preset.kind); set("rt_notes", preset.notes);
        }
        return;
      }
      if (act !== "rm-tool-save") return;
      const v = ui.collect(m, ["rt_name", "rt_kind", "rt_url", "rt_notes", "rt_enabled"]);
      const data = { name: asObj(v).rt_name, kind: asObj(v).rt_kind, urlTemplate: asObj(v).rt_url, notes: asObj(v).rt_notes, enabled: !!asObj(v).rt_enabled };
      const r = existing ? await REM.updateTool(providerId, existing.id, data) : await REM.addTool(providerId, data);
      if (r.error) return toast(r.message || r.error, "error");
      ui.closeModal();
      if (done) await done(); else toast("Saved.", "info");
    });
  }

  async function openLaunchDialog(providerId, toolId, mode, toast, done) {
    const tool = await REM.getTool(providerId, toolId);
    if (!tool) return toast("Tool not found.", "error");
    const p = await providerOf(providerId);
    const optsEls = deviceOptions(p);
    if (!optsEls.length) return toast("Enroll a device first.", "error");
    ui.modal({
      title: (mode === "handoff" ? "Generate a handoff link · " : "Launch ") + tool.name,
      body: ui.form(ui.select("rl_dev", "Device", optsEls, optsEls[0].value) +
        (mode === "launch" ? "" : ui.text("rl_by", "For (optional name)", "")) +
        ui.textarea("rl_notes", "Notes", "", 2),
        ui.btn(mode === "handoff" ? "Generate link" : "Launch", { primary: true, act: "rm-launch-go" }) + " " + ui.btn("Cancel", { act: "rm-cancel" })),
    });
    const m = document.querySelector("#uiModal");
    bindModal(async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rm-cancel") return ui.closeModal();
      if (act !== "rm-launch-go") return;
      const v = ui.collect(m, ["rl_dev", "rl_by", "rl_notes"]);
      const r = await REM.launch(providerId, toolId, asObj(v).rl_dev, { mode, notes: asObj(v).rl_notes, by: asObj(v).rl_by });
      if (r.error) return toast(r.message || r.error, "error");
      if (mode === "handoff") {
        const s = asObj(r.session);
        ui.modal({
          title: "Handoff link",
          body: '<p class="erp-modal-note">Send this link to the technician who will take over the session. The session is recorded against ' + esc(s.hostname) + ".</p>" +
            '<input class="erp-input" readonly value="' + esc(s.handoffUrl) + '">' +
            (r.missing && r.missing.length ? '<p class="erp-sub">Unfilled placeholders: ' + esc(r.missing.join(", ")) + "</p>" : ""),
          foot: ui.btn("Copy", { primary: true, act: "rm-copy" }) + " " + ui.btn("Close", { act: "rm-cancel" }),
        });
        bindModal(async (ev) => {
          const tt = ev.target.closest && ev.target.closest("[data-act]");
          if (!tt) return;
          const a = tt.getAttribute("data-act");
          if (a === "rm-cancel") { ui.closeModal(); if (done) await done(); }
          if (a === "rm-copy") { const inp = document.querySelector("#uiModal input"); if (inp) { inp.select(); try { document.execCommand("copy"); } catch (err) {} if (navigator.clipboard) { try { await navigator.clipboard.writeText(inp.value); } catch (err) {} } toast("Link copied.", "info"); } }
        });
        return;
      }
      ui.closeModal();
      openUrl(r.url);
      if (done) await done();
    });
  }

  async function openRedeemDialog(providerId, toast, done) {
    ui.modal({
      title: "Redeem a handoff link",
      body: ui.form(ui.text("rh_token", "Handoff link or token", "", "https://perchance.org/… #rmm-remote-handoff=…"), ui.btn("Redeem", { primary: true, act: "rm-redeem-go" }) + " " + ui.btn("Cancel", { act: "rm-cancel" })),
    });
    const m = document.querySelector("#uiModal");
    bindModal(async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rm-cancel") return ui.closeModal();
      if (act !== "rm-redeem-go") return;
      const v = ui.collect(m, ["rh_token"]);
      const r = await REM.redeemHandoff(providerId, asObj(v).rh_token);
      if (r.error) return toast(r.message || r.error, "error");
      ui.closeModal();
      toast("Handoff redeemed — session active.", "info");
      if (done) await done();
    });
  }

  async function openPushDialog(providerId, toast, done) {
    const p = await providerOf(providerId);
    const optsEls = deviceOptions(p);
    if (!optsEls.length) return toast("Enroll a device first.", "error");
    ui.modal({
      title: "Push a file to a device",
      size: "lg",
      body: ui.form('<div class="rmm-patch-grid">' + ui.select("rp_dev", "Device", optsEls, optsEls[0].value) + ui.text("rp_path", "Destination path", "C:\\Temp\\file.txt") + "</div>" +
        ui.textarea("rp_content", "File contents", "", 6) +
        '<p class="erp-sub">The file is chunked, SHA-256 verified on the device, and capped at ' + bytesHuman(maxFileBytes()) + '. Uploads pass a quarantine check before release.</p>',
        ui.btn("Push", { primary: true, act: "rm-push-go" }) + " " + ui.btn("Cancel", { act: "rm-cancel" })),
    });
    const m = document.querySelector("#uiModal");
    bindModal(async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rm-cancel") return ui.closeModal();
      if (act !== "rm-push-go") return;
      const v = ui.collect(m, ["rp_dev", "rp_path", "rp_content"]);
      const r = await REM.pushFile(providerId, asObj(v).rp_dev, { path: asObj(v).rp_path, content: asObj(v).rp_content });
      if (r.error) return toast(r.message || r.error, "error");
      ui.closeModal();
      toast("Transfer queued" + (asObj(r.transfer).state === "quarantined" ? " and quarantined for review." : "."), "info");
      if (done) await done();
    });
  }

  async function openPullDialog(providerId, toast, done) {
    const p = await providerOf(providerId);
    const optsEls = deviceOptions(p);
    if (!optsEls.length) return toast("Enroll a device first.", "error");
    ui.modal({
      title: "Pull a file from a device",
      body: ui.form(ui.select("rq_dev", "Device", optsEls, optsEls[0].value) + ui.text("rq_path", "Source path", "/etc/hosts"),
        ui.btn("Pull", { primary: true, act: "rm-pull-go" }) + " " + ui.btn("Cancel", { act: "rm-cancel" })),
    });
    const m = document.querySelector("#uiModal");
    bindModal(async (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rm-cancel") return ui.closeModal();
      if (act !== "rm-pull-go") return;
      const v = ui.collect(m, ["rq_dev", "rq_path"]);
      const r = await REM.pullFile(providerId, asObj(v).rq_dev, { path: asObj(v).rq_path });
      if (r.error) return toast(r.message || r.error, "error");
      ui.closeModal();
      toast("Pull requested.", "info");
      if (done) await done();
    });
  }

  async function openTransferView(providerId, id, toast, done) {
    const t = await REM.getTransfer(providerId, id);
    if (!t) return toast("Transfer not found.", "error");
    const body = '<div class="rmm-kv">' +
      [["File", esc(t.name)], ["Path", "<code>" + esc(t.path) + "</code>"], ["Device", esc(t.hostname)], ["Direction", esc(t.direction)], ["Size", bytesHuman(t.sizeBytes)],
        ["Encoding", esc(t.encoding)], ["Checksum", "<code>" + esc(t.checksum) + "</code>"], ["Verified", t.verified ? ui.badge("verified", "success") : ui.badge("no", "muted")],
        ["State", stateBadge(t.state)], ["By", esc(t.createdBy)], ["Created", esc(ui.dateTime(t.createdAt))],
        ["Chunks", String(t.chunks.length) || "1"], ["Quarantine", t.quarantine && t.quarantine.flags ? esc(asArr(t.quarantine.flags).join("; ")) : (t.quarantine && t.quarantine.scannedAt ? (t.quarantine.clean === false ? "flagged" : "clean") : "—")],
      ].map((x) => '<div class="rmm-kv-row"><span>' + x[0] + "</span><b>" + x[1] + "</b></div>").join("") + "</div>" +
      (t.error ? ui.alert(t.error, "warn") : "");
    ui.modal({ title: "Transfer · " + t.name, size: "lg", body, foot: ui.btn("Close", { act: "rm-cancel" }) });
    bindModal(async (e) => {
      const tt = e.target.closest && e.target.closest("[data-act]");
      if (tt && tt.getAttribute("data-act") === "rm-cancel") { ui.closeModal(); if (done) await done(); }
    });
  }

  /* ─────────────────────── boot ─────────────────────── */

  let readyResolve;
  REM.ready = new Promise((res) => { readyResolve = res; });
  REM.init = async function () { try { await T.ready; await REM.seedDemo(); } catch (e) { console.error("remote seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", REM.init);
  else REM.init();
})();
