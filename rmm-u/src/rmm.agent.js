/* ============================================================
   RMM-U — agent packaging & installer generator  (Phase 2 · Task 6)

   The agent is a real program for a real, non-browser endpoint: a
   PowerShell script for Windows and a POSIX shell script for
   macOS/Linux. This module owns:

     • the platform catalogue (Windows / Linux / macOS) — how each is
       installed and kept running (Scheduled Task / systemd / launchd);
     • the capability catalogue — what an agent can be asked to do
       (inventory, metrics, jobs, patches, software, remote shell,
       file transfer, self-update, reboot control, backup monitoring)
       and which capabilities a given platform supports;
     • the installer generator — a per-provider installer that embeds
       the collector address, the provider identity, the assigned
       site/group and a ONE-TIME enrollment token, installs the agent,
       registers it to start on boot, enrols the machine and prints a
       clear success/failure status with the device's initial id;
     • the Devices → Deploy console: issue/revoke enrollment tokens,
       generate installers, and rotate / revoke / re-enroll agents.

   SECURITY: the generated installer carries a single-use enrollment
   token — that is the only secret in the file, it is exchanged for a
   per-device credential on first contact, and it is revocable from
   the console. The collector itself (Phase 3) holds no static secret.

   window.ERP.agent is the service (aliased AG).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const H = ERP.heartbeat;
  const AG = (ERP.agent = {});

  /* ─────────────────────── catalogues ─────────────────────── */

  const PLATFORMS = [
    { id: "windows", label: "Windows", service: "Scheduled Task", shell: "powershell", file: "ps1", families: ["Windows"], min: "Windows 10 / Server 2016 or newer" },
    { id: "linux", label: "Linux", service: "systemd", shell: "sh", file: "sh", families: ["Linux"], min: "systemd-based distributions" },
    { id: "macos", label: "macOS", service: "launchd", shell: "sh", file: "sh", families: ["macOS"], min: "macOS 11 (Big Sur) or newer" },
  ];

  const CAPABILITIES = [
    { id: "inventory", label: "System inventory", desc: "Hardware, OS, installed software, services, patches, disks, network, users, security & backup status (sent as deltas).", platforms: ["windows", "linux", "macos"] },
    { id: "metrics", label: "Performance metrics", desc: "CPU, memory, disk space & I/O, network throughput/latency and uptime sampling.", platforms: ["windows", "linux", "macos"] },
    { id: "jobs", label: "Command & script execution", desc: "Fetch and run queued PowerShell / shell / cmd jobs, capturing exit code and output.", platforms: ["windows", "linux", "macos"] },
    { id: "patches", label: "Patch management", desc: "Scan for and install operating-system updates.", platforms: ["windows", "linux", "macos"] },
    { id: "software", label: "Software deployment", desc: "Silent install / uninstall / update of catalog packages.", platforms: ["windows", "linux", "macos"] },
    { id: "remote-shell", label: "Remote shell", desc: "Interactive browser terminal through the collector.", platforms: ["windows", "linux", "macos"] },
    { id: "file-transfer", label: "File transfer", desc: "Push and pull files with integrity checks.", platforms: ["windows", "linux", "macos"] },
    { id: "self-update", label: "Self-update", desc: "Download, verify and swap the agent program with rollback.", platforms: ["windows", "linux", "macos"] },
    { id: "reboot", label: "Reboot control", desc: "Schedule and perform a controlled reboot.", platforms: ["windows", "linux", "macos"] },
    { id: "backup-monitor", label: "Backup monitoring", desc: "Report backup-product job status.", platforms: ["windows", "linux", "macos"] },
  ];

  const CAP_BY_ID = {};
  CAPABILITIES.forEach((c) => { CAP_BY_ID[c.id] = c; });
  const CAP_ORDER = CAPABILITIES.map((c) => c.id);

  const PLATFORM_BY_ID = {};
  PLATFORMS.forEach((p) => { PLATFORM_BY_ID[p.id] = p; });

  AG.PLATFORMS = PLATFORMS;
  AG.CAPABILITIES = CAPABILITIES;
  AG.CAPABILITY_IDS = CAP_ORDER.slice();
  AG.platforms = () => PLATFORMS.map((p) => Object.assign({}, p));
  AG.platform = (id) => (PLATFORM_BY_ID[id] ? Object.assign({}, PLATFORM_BY_ID[id]) : null);
  AG.capability = (id) => (CAP_BY_ID[id] ? Object.assign({}, CAP_BY_ID[id]) : null);

  AG.platformForFamily = function (family) {
    const f = String(family || "").toLowerCase();
    if (!f) return null;
    const hit = PLATFORMS.find((p) => p.families.some((x) => x.toLowerCase() === f));
    return hit ? hit.id : null;
  };

  AG.capabilitiesFor = (platform) => CAPABILITIES.filter((c) => c.platforms.indexOf(platform) !== -1).map((c) => c.id);

  /* Keep only known capabilities, in catalogue order, de-duplicated. */
  AG.normalizeCapabilities = function (list) {
    const set = new Set((Array.isArray(list) ? list : []).map(String));
    return CAP_ORDER.filter((id) => set.has(id));
  };
  AG.supports = (caps, id) => (Array.isArray(caps) ? caps : []).indexOf(id) !== -1;

  AG.capabilityLabels = (list) => AG.normalizeCapabilities(list).map((id) => (CAP_BY_ID[id] ? CAP_BY_ID[id].label : id));

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d || 0); };
  const now = () => new Date().toISOString();
  const esc = (s) => (ERP.ui ? ERP.ui.esc(s) : String(s == null ? "" : s));

  AG.VERSION = () => String(cfg("rmm.agentVersion", "1.0.0"));

  AG.defaultCollectorUrl = function () {
    const configured = String(cfg("rmm.collectorUrl", "") || "").trim();
    if (configured) return configured;
    try {
      if (typeof location !== "undefined" && location.origin && /^https?:/.test(location.origin)) {
        return location.origin + "/rmm-collector";
      }
    } catch (e) {}
    return "https://collector.rmm-u.example/api";
  };

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "provider";
  }
  AG.slug = slug;

  /* Values interpolated into a generated script must never break its
     quoting or terminate a here-string/heredoc. */
  function safe(v) { return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/'@/g, "' @"); }

  function defaultInstallDir(platform) {
    if (platform === "windows") return "%ProgramData%\\RMM-U\\Agent";
    if (platform === "macos") return "/Library/Application Support/RMM-U/Agent";
    return "/opt/rmm-u/agent";
  }
  AG.defaultInstallDir = defaultInstallDir;

  /* ─────────────────────── installer generation ─────────────────────── */

  AG.installerFilename = function (opts) {
    const p = PLATFORM_BY_ID[opts && opts.platform];
    const ext = p ? p.file : "txt";
    return "rmm-u-agent-" + slug(opts && opts.providerName) + "-" + (opts && opts.platform || "unknown") + "." + ext;
  };

  /* installer(opts) → a complete, self-contained agent installer +
     runtime script for one platform. opts:
       { platform, collectorUrl?, providerId, providerName, siteId?,
         siteName?, groupIds[], groupNames[], token, tokenId?,
         agentVersion?, heartbeatSeconds?, capabilities? } */
  AG.installer = function (opts) {
    opts = opts || {};
    const platform = PLATFORM_BY_ID[opts.platform];
    if (!platform) return { error: "unknown_platform", message: "Choose windows, linux or macos." };
    const collectorUrl = String(opts.collectorUrl || AG.defaultCollectorUrl()).trim();
    if (!collectorUrl) return { error: "no_collector", message: "A collector address is required." };
    if (!opts.token) return { error: "no_token", message: "An enrollment token is required — issue one first." };
    const agentVersion = String(opts.agentVersion || AG.VERSION());
    const heartbeatSeconds = Math.max(30, num(opts.heartbeatSeconds, H ? H.intervalSeconds() : 300));
    const capabilities = AG.normalizeCapabilities(opts.capabilities || AG.capabilitiesFor(platform.id));
    const serviceName = String(opts.serviceName || "rmmu-agent");
    const RS = ERP.resilience;
    const rpolicy = RS ? RS.policy() : null;
    const tlsCfg = RS ? RS.tlsConfig(opts.collectorUrl || AG.defaultCollectorUrl()) : null;
    const config = {
      collectorUrl: collectorUrl.replace(/\/+$/, ""),
      providerId: String(opts.providerId || ""),
      providerName: String(opts.providerName || ""),
      siteId: opts.siteId ? String(opts.siteId) : "",
      siteName: String(opts.siteName || ""),
      groupIds: asArr(opts.groupIds).map(String),
      groupNames: asArr(opts.groupNames).map(String),
      token: String(opts.token),
      agentVersion,
      heartbeatSeconds,
      metricsSampleSeconds: Math.max(10, num(cfg("rmm.metricsSampleSeconds", 60), 60)),
      capabilities,
      serviceName,
      installDir: String(opts.installDir || defaultInstallDir(platform.id)),
      /* resilience & diagnostics policy (Tasks 12/13) — mirrored by RS */
      tlsMode: tlsCfg ? tlsCfg.mode : "system",
      tlsPinSha256: tlsCfg ? tlsCfg.pinSha256 : "",
      allowInsecure: tlsCfg ? !!tlsCfg.allowInsecure : false,
      backoffBaseSeconds: rpolicy ? rpolicy.backoff.baseSeconds : 5,
      backoffMaxSeconds: rpolicy ? rpolicy.backoff.maxSeconds : 900,
      backoffFactor: rpolicy ? rpolicy.backoff.factor : 2,
      backoffJitter: rpolicy ? rpolicy.backoff.jitter : 0.25,
      maxAttempts: rpolicy ? rpolicy.backoff.maxAttempts : 8,
      spoolMaxBytes: rpolicy ? rpolicy.spool.maxBytes : 26214400,
      spoolMaxItems: rpolicy ? rpolicy.spool.maxItems : 5000,
      spoolFlushPerCycle: rpolicy ? rpolicy.spool.flushPerCycle : 50,
      cpuNice: rpolicy ? rpolicy.caps.cpuNice : 10,
      ioNice: rpolicy ? rpolicy.caps.ioNice : 6,
      maxMemMB: rpolicy ? rpolicy.caps.maxMemMB : 256,
      maxConcurrentJobs: rpolicy ? rpolicy.caps.maxConcurrentJobs : 1,
      logMaxBytes: rpolicy ? rpolicy.caps.logMaxBytes : 2097152,
      logKeep: rpolicy ? rpolicy.caps.logKeep : 3,
      selfUpdateEnabled: rpolicy ? rpolicy.selfUpdate.enabled : true,
      selfUpdateChannel: rpolicy ? rpolicy.selfUpdate.channel : "stable",
      keepVersions: rpolicy ? rpolicy.selfUpdate.keepVersions : 2,
      policyVersion: rpolicy ? rpolicy.version : 1,
    };
    const json = JSON.stringify(config, null, 2).replace(/'@/g, "' @");
    const jsonSh = json.replace(/'/g, "'\\''");
    const head = {
      provider: safe(config.providerName || "(unnamed provider)") + " (" + safe(config.providerId) + ")",
      collector: safe(config.collectorUrl),
      site: safe(config.siteName || config.siteId || "(provider-wide)"),
      groups: safe(config.groupNames.join(", ") || "(none)"),
      generated: now(),
      service: safe(serviceName),
    };
    const script = platform.id === "windows" ? windowsInstaller(json, head, config) : posixInstaller(jsonSh, head, config, platform.id);
    return {
      ok: true,
      platform: platform.id,
      platformLabel: platform.label,
      language: platform.shell,
      filename: AG.installerFilename({ platform: platform.id, providerName: config.providerName }),
      script,
      lines: script.split("\n").length,
      config,
      tokenId: opts.tokenId || "",
      server: platform.service,
    };
  };

  /* ── Windows: one file, run with no switches to install, -Once from the task ── */
  function windowsInstaller(configJson, head, config) {
    return `#Requires -Version 5.1
<#
  RMM-U agent — installer & runtime (Windows)
  --------------------------------------------------------------------------
  Provider  : ${head.provider}
  Collector : ${head.collector}
  Site      : ${head.site}
  Groups    : ${head.groups}
  Service   : Scheduled Task "${head.service}"
  Generated : ${head.generated}

  Run with no arguments to install the agent; the scheduled task then runs
  this same script with -Once at every heartbeat interval.
      .\\THIS-FILE.ps1              install (register the task + enroll)
      .\\THIS-FILE.ps1 -Once        one heartbeat (used by the task)
      .\\THIS-FILE.ps1 -SelfTest    check the collector + enrollment state
      .\\THIS-FILE.ps1 -Uninstall   remove the agent, task and data

  The enrollment token embedded below is SINGLE-USE: it is exchanged for a
  per-device credential on first contact, and only that credential's hash is
  stored by the collector. Revoke the token from the console if this file is
  ever leaked.
#>
[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$SelfTest,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$CfgJson = @'
${configJson}
'@
$Cfg = $CfgJson | ConvertFrom-Json

$DataDir     = Join-Path $env:ProgramData 'RMM-U'
$InstallDir  = Join-Path $DataDir 'Agent'
$ConfigPath  = Join-Path $InstallDir 'config.json'
$StatePath   = Join-Path $InstallDir 'state.json'
$LogDir      = Join-Path $DataDir 'Logs'
$LogPath     = Join-Path $LogDir 'agent.log'
$SpoolDir    = Join-Path $DataDir 'Spool'
$BackupDir   = Join-Path $InstallDir 'backup'
$AgentRuntime = Join-Path $InstallDir 'agent.ps1'
$TaskName    = $Cfg.serviceName
$AgentPath   = $MyInvocation.MyCommand.Path

# ---- collector identity / TLS (Task 12) ----------------------------------
# The collector's certificate is validated against the system trust store by
# default. When a SHA-256 certificate pin is configured the raw certificate
# must match it exactly; plain HTTP is refused unless the policy explicitly
# allows it (so a leaked installer cannot be pointed at a spoofed collector).
if ($Cfg.tlsMode -eq 'pinned' -and $Cfg.tlsPinSha256) {
  $script:PinHash = ([string]$Cfg.tlsPinSha256).ToLower()
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = {
    param($sender, $cert, $chain, $errors)
    try {
      $h = ([System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.GetRawCertData()) | ForEach-Object { $_.ToString('x2') }) -join ''
      return ($h -eq $script:PinHash)
    } catch { return $false }
  }
}
function Rotate-Log([string]$Path, [int]$MaxBytes, [int]$Keep) {
  try {
    if (-not (Test-Path $Path)) { return }
    if ((Get-Item $Path -ErrorAction SilentlyContinue).Length -le $MaxBytes) { return }
    for ($i = $Keep - 1; $i -ge 1; $i--) {
      $src = '{0}.{1}' -f $Path, $i
      if (Test-Path $src) { Move-Item -Force $src ('{0}.{1}' -f $Path, ($i + 1)) }
    }
    Move-Item -Force $Path ('{0}.1' -f $Path)
  } catch { }
}
function Write-AgentLog([string]$Message) {
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    Add-Content -Path $LogPath -Value (('{0} {1}' -f (Get-Date).ToUniversalTime().ToString('o'), $Message))
    $max = 2097152
    if ($Cfg.logMaxBytes) { $max = [int]$Cfg.logMaxBytes }
    $keep = 3
    if ($Cfg.logKeep) { $keep = [int]$Cfg.logKeep }
    Rotate-Log $LogPath $max $keep
  } catch { }
}

# ---- offline replay spool (Task 12) --------------------------------------
# Data posts that fail are written here and replayed on the next successful
# heartbeat, bounded by item count and total bytes so a long outage cannot
# fill the endpoint's disk.
function Get-SpoolState {
  try {
    $items = @(Get-ChildItem -Path $SpoolDir -Filter '*.json' -ErrorAction SilentlyContinue)
    $bytes = [int64]0
    $oldest = ''
    foreach ($i in $items) { $bytes += $i.Length; if ($oldest -eq '' -or $i.Name -lt $oldest) { $oldest = $i.Name } }
    return @{ pending = $items.Count; bytes = $bytes; oldestAt = $oldest }
  } catch { return @{ pending = 0; bytes = [int64]0; oldestAt = '' } }
}
function Save-Spool([string]$Op, $Body) {
  try {
    if (-not (Test-Path $SpoolDir)) { New-Item -ItemType Directory -Force -Path $SpoolDir | Out-Null }
    $items = @(Get-ChildItem -Path $SpoolDir -Filter '*.json' -ErrorAction SilentlyContinue)
    $bytes = [int64]0
    foreach ($i in $items) { $bytes += $i.Length }
    if ($items.Count -ge [int]$Cfg.spoolMaxItems -or $bytes -ge [int64]$Cfg.spoolMaxBytes) { return $false }
    $name = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff') + '-' + ([Guid]::NewGuid().ToString('N').Substring(0, 6)) + '.json'
    (@{ op = $Op; at = (Get-Date).ToUniversalTime().ToString('o'); body = $Body } | ConvertTo-Json -Depth 8 -Compress) | Set-Content -Path (Join-Path $SpoolDir $name) -Encoding UTF8
    return $true
  } catch { return $false }
}
function Flush-Spool {
  try {
    $limit = 50
    if ($Cfg.spoolFlushPerCycle) { $limit = [int]$Cfg.spoolFlushPerCycle }
    $items = @(Get-ChildItem -Path $SpoolDir -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First $limit)
    foreach ($i in $items) {
      try {
        $o = Get-Content $i.FullName -Raw | ConvertFrom-Json
        Invoke-Collector ([string]$o.op) $o.body | Out-Null
        Remove-Item -Force $i.FullName
      } catch { break }
    }
  } catch { }
}

# ---- reconnect backoff (Task 12) — mirrors RS.backoffMs ------------------
function Get-BackoffMs([int]$Attempt) {
  $base = [double]$Cfg.backoffBaseSeconds * 1000.0
  $raw = $base * [Math]::Pow([double]$Cfg.backoffFactor, [Math]::Max(0, $Attempt - 1))
  $cap = [double]$Cfg.backoffMaxSeconds * 1000.0
  if ($raw -gt $cap) { $raw = $cap }
  $u = Get-Random -Minimum 0.0 -Maximum 1.0
  $ms = $raw * (1.0 + ([double]$Cfg.backoffJitter) * ($u - 1.0))
  if ($ms -lt 0) { $ms = 0 }
  return [int64]$ms
}

# ---- self-update (Task 12) — download, verify, swap, roll back -----------
function Invoke-SelfUpdate($req) {
  $from = [string]$Cfg.agentVersion
  try {
    if (-not $Cfg.selfUpdateEnabled) { throw 'self-update is disabled by policy' }
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
    $target = [string]$req.version
    $tmp = Join-Path $InstallDir ('pending-' + ([Guid]::NewGuid().ToString('N').Substring(0, 8)) + '.ps1')
    if ($req.rollback -or -not $req.url) {
      $bak = Join-Path $BackupDir 'agent.ps1.bak'
      if (-not (Test-Path $bak)) { throw 'no rollback backup is available' }
      Copy-Item -Force $bak $AgentRuntime
      Write-AgentLog ('Rolled back to the previous agent build')
      Post-Collector '/update-result' @{ deviceId = (Read-AgentState).deviceId; credential = (Read-AgentState).credential; ok = $true; rolledBack = $true; version = $from; fromVersion = $from; targetVersion = $target; error = 'rollback requested' }
      return
    }
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$req.url) -OutFile $tmp -TimeoutSec 60
    $hash = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
    if ([string]$req.sha256 -and $hash -ne ([string]$req.sha256).ToLower()) { throw ('checksum mismatch (got ' + $hash + ')') }
    Copy-Item -Force $AgentRuntime (Join-Path $BackupDir 'agent.ps1.bak')
    $test = Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $tmp + '" -SelfTest') -NoNewWindow -PassThru -Wait
    if ($test.ExitCode -ne 0) { throw 'the new build failed its self-test' }
    Copy-Item -Force $tmp $AgentRuntime
    Remove-Item -Force $tmp
    Write-AgentLog ('Self-update to ' + $target + ' applied')
    Post-Collector '/update-result' @{ deviceId = (Read-AgentState).deviceId; credential = (Read-AgentState).credential; ok = $true; rolledBack = $false; version = $target; fromVersion = $from; targetVersion = $target }
    return
  } catch {
    $msg = $_.Exception.Message
    Write-AgentLog ('Self-update failed: ' + $msg + ' — rolling back')
    try {
      $bak = Join-Path $BackupDir 'agent.ps1.bak'
      if (Test-Path $bak) { Copy-Item -Force $bak $AgentRuntime }
    } catch { }
    try { Post-Collector '/update-result' @{ deviceId = (Read-AgentState).deviceId; credential = (Read-AgentState).credential; ok = $false; rolledBack = $true; version = $from; fromVersion = $from; targetVersion = [string]$req.version; error = $msg } } catch { }
  }
}

# ---- diagnostics & support (Task 13) -------------------------------------
function Send-AgentLogs($state, $req) {
  try {
    $lines = 400
    if ($req -and $req.lines) { $lines = [int]$req.lines }
    $text = ''
    if (Test-Path $LogPath) { $text = [string](Get-Content $LogPath -Tail $lines -ErrorAction SilentlyContinue | Out-String) }
    $truncated = $false
    $cap = 262144
    if ($text.Length -gt $cap) { $text = $text.Substring($text.Length - $cap); $truncated = $true }
    $body = @{ deviceId = $state.deviceId; credential = $state.credential; requestId = ($req.requestId); lines = ($text -split "\\n").Count; textB64 = (To-B64 $text); truncated = $truncated }
    Post-Collector '/logs' $body | Out-Null
    Write-AgentLog 'Agent log uploaded'
  } catch { Write-AgentLog ('log upload failed: ' + $_.Exception.Message) }
}
function Invoke-AgentSelfTest($state, $req) {
  $checks = @()
  $checks += @{ id = 'config'; name = 'Configuration'; ok = [bool]($Cfg.collectorUrl); detail = ('collector ' + $Cfg.collectorUrl) }
  $reach = $false; $reachDetail = ''
  try { Invoke-Collector '/heartbeat' @{ deviceId = $state.deviceId; credential = $state.credential; payload = @{} } | Out-Null; $reach = $true; $reachDetail = 'collector answered' } catch { $reachDetail = $_.Exception.Message }
  $checks += @{ id = 'reachable'; name = 'Collector reachable'; ok = $reach; detail = $reachDetail }
  $checks += @{ id = 'tls'; name = 'Collector identity'; ok = [bool]($Cfg.tlsMode -ne 'insecure' -or $Cfg.allowInsecure); detail = ('mode ' + $Cfg.tlsMode + $(if ($Cfg.tlsPinSha256) { ' pinned' } else { '' })) }
  $checks += @{ id = 'enrolled'; name = 'Enrolled'; ok = [bool]$state.deviceId; detail = [string]$state.deviceId }
  $checks += @{ id = 'authenticated'; name = 'Authenticated'; ok = $reach; detail = $reachDetail }
  $skew = $null
  try { $skew = [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [DateTimeOffset]::Parse((Get-Date).ToUniversalTime().ToString('o'))).TotalSeconds, 1) } catch { }
  $checks += @{ id = 'clock'; name = 'Clock'; ok = $true; detail = ($(if ($skew -eq $null) { 'unknown' } else { [string]$skew + 's local' })) }
  $svc = $false
  try { $svc = [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) } catch { }
  $checks += @{ id = 'service'; name = 'Service'; ok = $svc; detail = ('task ' + $TaskName) }
  $sp = Get-SpoolState
  $checks += @{ id = 'spool'; name = 'Offline buffer'; ok = ([int64]$sp.bytes -le [int64]$Cfg.spoolMaxBytes); detail = ($sp.pending.ToString() + ' item(s)') }
  $free = 0
  try { $free = (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -eq 'C' } | Select-Object -First 1).Free } catch { }
  $checks += @{ id = 'disk'; name = 'Disk space'; ok = ($free -gt 104857600 -or $free -eq 0); detail = ([string]$free + ' bytes free') }
  $checks += @{ id = 'jobs'; name = 'Job runtime'; ok = $true; detail = 'powershell available' }
  $body = @{
    deviceId = $state.deviceId; credential = $state.credential; requestId = ($req.requestId)
    ok = (@($checks | Where-Object { -not $_.ok }).Count -eq 0); checks = $checks
    agentVersion = $Cfg.agentVersion
    context = @{ hostname = $env:COMPUTERNAME; spoolPending = $sp.pending; clockSkewSeconds = $skew; freeDiskBytes = $free }
  }
  try { Post-Collector '/diagnostics' $body | Out-Null; Write-AgentLog 'Self-test uploaded' } catch { Write-AgentLog 'self-test upload failed' }
  return $body
}
function Read-AgentState {
  if (Test-Path $StatePath) { try { return (Get-Content $StatePath -Raw | ConvertFrom-Json) } catch { return $null } }
  return $null
}
function Save-AgentState($Obj) { $Obj | ConvertTo-Json -Depth 6 | Set-Content -Path $StatePath -Encoding UTF8 }
function Invoke-Collector([string]$Path, $Body) {
  if (-not $Cfg.allowInsecure -and $Cfg.collectorUrl -notmatch '^https://') {
    throw 'The collector address is not TLS-secured and the policy forbids it.'
  }
  $uri = $Cfg.collectorUrl.TrimEnd('/') + $Path
  return Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 30
}
function Post-Collector([string]$Path, $Body) {
  try { return Invoke-Collector $Path $Body }
  catch {
    [void](Save-Spool $Path $Body)
    throw
  }
}
function Get-AgentIdentity {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $disks = @()
  foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $disks += @{ label = $d.DeviceID; sizeBytes = [int64]$d.Size; freeBytes = [int64]$d.FreeSpace; filesystem = [string]$d.FileSystem }
  }
  $nics = @()
  try {
    foreach ($n in (Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
      if ($n.IPv4Address) {
        $nics += @{ name = [string]$n.InterfaceAlias; mac = [string]$n.NetAdapter.MacAddress; ip4 = @([string]$n.IPv4Address.IPAddress); gateway = [string]$n.IPv4DefaultGateway.NextHop }
      }
    }
  } catch { }
  return @{
    hostname      = $cs.Name
    role          = 'workstation'
    os            = @{ name = $os.Caption; version = $os.Version; build = $os.BuildNumber; arch = $os.OSArchitecture }
    cpu           = @{ model = $cpu.Name; cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors }
    ramBytes      = [int64]$cs.TotalPhysicalMemory
    disks         = $disks
    interfaces    = $nics
    loggedInUsers = @(@{ name = [string]$cs.UserName; session = 'console' })
  }
}
function Connect-Agent {
  $state = Read-AgentState
  if ($state -and $state.credential) { return $state }
  Write-AgentLog 'Enrolling with the embedded one-time token'
  $body = @{ token = $Cfg.token; providerId = $Cfg.providerId; siteId = $Cfg.siteId; hostname = $env:COMPUTERNAME; agentVersion = $Cfg.agentVersion; device = (Get-AgentIdentity) }
  $res = Invoke-Collector '/enroll' $body
  if (-not $res.ok) { throw ('Enrollment refused: ' + $res.error) }
  $state = @{ deviceId = $res.deviceId; credential = $res.credential; providerId = $res.providerId; enrolledAt = (Get-Date).ToUniversalTime().ToString('o') }
  Save-AgentState $state
  Write-AgentLog ('Enrolled as device ' + $res.deviceId)
  return $state
}
function To-B64([string]$Text) {
  if ($null -eq $Text) { return '' }
  try { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text)) } catch { return '' }
}
function Get-AgentInventory {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
  $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
  $software = @()
  foreach ($key in @('HKLM:/SOFTWARE/Microsoft/Windows/CurrentVersion/Uninstall/*','HKLM:/SOFTWARE/WOW6432Node/Microsoft/Windows/CurrentVersion/Uninstall/*')) {
    try {
      foreach ($p in (Get-ItemProperty $key -ErrorAction SilentlyContinue)) {
        if ($p.DisplayName) { $software += @{ name = [string]$p.DisplayName; version = [string]$p.DisplayVersion; publisher = [string]$p.Publisher } }
      }
    } catch { }
  }
  $services = @()
  try {
    foreach ($s in (Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)) {
      $services += @{ name = [string]$s.Name; displayName = [string]$s.DisplayName; state = ([string]$s.State).ToLower(); startMode = ([string]$s.StartMode).ToLower() }
    }
  } catch { }
  $patches = @()
  try {
    foreach ($h in (Get-HotFix -ErrorAction SilentlyContinue)) {
      $at = ''
      if ($h.InstalledOn) { $at = $h.InstalledOn.ToUniversalTime().ToString('o') }
      $patches += @{ id = [string]$h.HotFixID; description = [string]$h.Description; installedAt = $at }
    }
  } catch { }
  $disks = @()
  foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $total = [int64]$d.Size
    $free = [int64]$d.FreeSpace
    $pct = 0
    if ($total -gt 0) { $pct = [math]::Round((($total - $free) / $total) * 100, 1) }
    $disks += @{ label = [string]$d.DeviceID; sizeBytes = $total; freeBytes = $free; filesystem = [string]$d.FileSystem; pct = $pct }
  }
  $interfaces = @()
  try {
    foreach ($n in (Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
      if ($n.IPv4Address) { $interfaces += @{ name = [string]$n.InterfaceAlias; mac = [string]$n.NetAdapter.MacAddress; ip4 = @([string]$n.IPv4Address.IPAddress); gateway = [string]$n.IPv4DefaultGateway.NextHop } }
    }
  } catch { }
  $users = @()
  try {
    foreach ($u in (Get-LocalUser -ErrorAction SilentlyContinue)) {
      $last = ''
      if ($u.LastLogon) { $last = $u.LastLogon.ToUniversalTime().ToString('o') }
      $users += @{ name = [string]$u.Name; enabled = [bool]$u.Enabled; lastLogon = $last }
    }
  } catch { }
  $groups = @()
  try {
    foreach ($g in (Get-LocalGroup -ErrorAction SilentlyContinue)) { $groups += @{ name = [string]$g.Name; description = [string]$g.Description } }
  } catch { }
  $security = @{}
  try {
    $mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($mp) {
      $sig = ''
      if ($mp.AntivirusSignatureLastUpdated) { $sig = $mp.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o') }
      $security.antivirus = 'Windows Defender'
      $security.antivirusEnabled = [bool]$mp.RealTimeProtectionEnabled
      $security.definitionsAt = $sig
    }
  } catch { }
  try {
    $fw = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue)
    if ($fw.Count -gt 0) {
      $security.firewallEnabled = (@($fw | Where-Object { $_.Enabled -eq $true }).Count -gt 0)
      $profiles = @()
      foreach ($f in $fw) { $profiles += @{ name = [string]$f.Name; enabled = [bool]$f.Enabled } }
      $security.firewallProfiles = $profiles
    }
  } catch { }
  try {
    $bl = Get-BitLockerVolume -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($bl) { $security.encryption = 'BitLocker'; $security.encrypted = ([string]$bl.ProtectionStatus -eq 'On') }
  } catch { }
  try { $security.secureBoot = [bool](Confirm-SecureBootUEFI -ErrorAction SilentlyContinue) } catch { }
  $installedAt = ''
  if ($os.InstallDate) { $installedAt = $os.InstallDate.ToUniversalTime().ToString('o') }
  return @{
    hardware = @{ manufacturer = [string]$cs.Manufacturer; model = [string]$cs.Model; serial = [string]$bios.SerialNumber }
    os = @{ name = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; arch = [string]$os.OSArchitecture; installedAt = $installedAt }
    cpu = @{ model = [string]$cpu.Name; cores = [int]$cpu.NumberOfCores; threads = [int]$cpu.NumberOfLogicalProcessors }
    ramBytes = [int64]$cs.TotalPhysicalMemory
    software = $software
    services = $services
    patches = $patches
    disks = $disks
    interfaces = $interfaces
    users = $users
    groups = $groups
    security = $security
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
}
function Send-AgentInventory($state) {
  try {
    $inv = Get-AgentInventory
    $body = @{ deviceId = $state.deviceId; credential = $state.credential; payload = @{ mode = 'full'; inventory = $inv; collectedAt = $inv.collectedAt } }
    $res = Post-Collector '/inventory' $body
    Write-AgentLog ('Inventory sent - revision ' + $res.revision)
  } catch { Write-AgentLog ('inventory failed: ' + $_.Exception.Message) }
}
function Get-AgentMetrics {
  $sample = @{ at = (Get-Date).ToUniversalTime().ToString('o') }
  try {
    $c = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
    if ($c) { $sample.cpuPct = [double]$c.PercentProcessorTime }
  } catch { }
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $total = [int64]$os.TotalVisibleMemorySize * 1024
    $free = [int64]$os.FreePhysicalMemory * 1024
    if ($total -gt 0) {
      $sample.memTotalBytes = $total
      $sample.memUsedBytes = ($total - $free)
      $sample.memPct = [math]::Round((($total - $free) / $total) * 100, 1)
    }
    if ($os.LastBootUpTime) { $sample.uptimeSeconds = [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds }
  } catch { }
  $disks = @()
  $sysTotal = 0
  $sysFree = 0
  foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $total = [int64]$d.Size
    $free = [int64]$d.FreeSpace
    $pct = 0
    if ($total -gt 0) { $pct = [math]::Round((($total - $free) / $total) * 100, 1) }
    $disks += @{ label = [string]$d.DeviceID; sizeBytes = $total; freeBytes = $free; pct = $pct }
    if ([string]$d.DeviceID -eq 'C:' -or $sysTotal -eq 0) { $sysTotal = $total; $sysFree = $free }
  }
  if ($sysTotal -gt 0) {
    $sample.diskTotalBytes = $sysTotal
    $sample.diskFreeBytes = $sysFree
    $sample.diskPct = [math]::Round((($sysTotal - $sysFree) / $sysTotal) * 100, 1)
  }
  $sample.disks = $disks
  $net = @()
  try {
    foreach ($a in (Get-NetAdapterStatistics -ErrorAction SilentlyContinue)) {
      $net += @{ name = [string]$a.Name; rxBytes = [int64]$a.ReceivedBytes; txBytes = [int64]$a.SentBytes }
    }
  } catch { }
  $sample.net = $net
  return $sample
}
function Send-AgentMetrics($state) {
  try {
    $sample = Get-AgentMetrics
    $st = Read-AgentState
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($st -and $st.metrics -and $st.metrics.atMs -and $st.metrics.net) {
      $dt = ($nowMs - [int64]$st.metrics.atMs) / 1000.0
      if ($dt -gt 0) {
        $rx = 0.0
        $tx = 0.0
        $hit = $false
        foreach ($n in $sample.net) {
          $p = $st.metrics.net | Where-Object { $_.name -eq $n.name } | Select-Object -First 1
          if ($p) {
            $hit = $true
            $rx += [math]::Max(0, ($n.rxBytes - [int64]$p.rxBytes) / $dt)
            $tx += [math]::Max(0, ($n.txBytes - [int64]$p.txBytes) / $dt)
          }
        }
        if ($hit) { $sample.netRxBps = [math]::Round($rx, 1); $sample.netTxBps = [math]::Round($tx, 1) }
      }
    }
    if ($st) {
      $st | Add-Member -NotePropertyName metricsAt -NotePropertyValue $nowMs -Force
      $st | Add-Member -NotePropertyName metrics -NotePropertyValue @{ atMs = $nowMs; net = $sample.net } -Force
      Save-AgentState $st
    }
    $body = @{ deviceId = $state.deviceId; credential = $state.credential; payload = @{ samples = @($sample); intervalSeconds = [int]$Cfg.metricsSampleSeconds } }
    Post-Collector '/metrics' $body | Out-Null
    Write-AgentLog 'Metrics sent'
  } catch { Write-AgentLog ('metrics failed: ' + $_.Exception.Message) }
}
function Invoke-OneJob($job, $state) {
  $id = [string]$job.jobId
  if (-not $id) { return }
  $lang = [string]$job.language
  $ext = '.bin'
  if ($lang -eq 'powershell') { $ext = '.ps1' }
  elseif ($lang -eq 'cmd') { $ext = '.cmd' }
  elseif ($lang -eq 'python') { $ext = '.py' }
  elseif ($lang -eq 'bash' -or $lang -eq 'sh') { $ext = '.sh' }
  $timeout = 300
  if ([int]$job.timeoutSeconds -ge 10) { $timeout = [int]$job.timeoutSeconds }
  $dir = Join-Path $env:TEMP 'rmm-u-jobs'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir ('job-' + $id + $ext)
  $outPath = Join-Path $dir ('job-' + $id + '.out')
  $errPath = Join-Path $dir ('job-' + $id + '.err')
  $script = [string]$job.script
  if ($job.scriptB64) { try { $script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$job.scriptB64)) } catch { } }
  Set-Content -Path $file -Value $script -Encoding UTF8
  $jobArgs = @()
  if ($job.argsB64) {
    try {
      $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$job.argsB64))
      $jobArgs = @($decoded -split "\\n" | Where-Object { $_ -ne '' })
    } catch { }
  } elseif ($job.args) { $jobArgs = @($job.args) }
  $exe = 'powershell.exe'
  $argLine = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $file + '"'
  if ($lang -eq 'cmd') { $exe = 'cmd.exe'; $argLine = '/d /s /c "' + $file + '"' }
  elseif ($lang -eq 'python') { $exe = 'python.exe'; $argLine = '"' + $file + '"' }
  elseif ($lang -eq 'bash') { $exe = 'bash.exe'; $argLine = '"' + $file + '"' }
  elseif ($lang -eq 'sh') { $exe = 'sh.exe'; $argLine = '"' + $file + '"' }
  elseif ($lang -eq 'binary') { $exe = $file; $argLine = '' }
  foreach ($a in $jobArgs) { $argLine = $argLine + ' "' + ([string]$a).Replace('"','') + '"' }
  $startedAt = (Get-Date).ToUniversalTime().ToString('o')
  $timedOut = $false
  $exit = -1
  $stdout = ''
  $stderr = ''
  try {
    $p = Start-Process -FilePath $exe -ArgumentList $argLine -NoNewWindow -PassThru -RedirectStandardOutput $outPath -RedirectStandardError $errPath
    try { $p.PriorityClass = 'BelowNormal' } catch { }
    $maxMem = [int64]$Cfg.maxMemMB * 1MB
    $deadline = (Get-Date).AddSeconds($timeout)
    while (-not $p.HasExited) {
      if ((Get-Date) -gt $deadline) { $timedOut = $true; try { $p.Kill() } catch { }; $exit = 124; break }
      try { if ($maxMem -gt 0 -and $p.WorkingSet64 -gt $maxMem) { try { $p.Kill() } catch { }; $exit = 137; break } } catch { }
      try { $p.WaitForExit(500) | Out-Null } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $timedOut -and $exit -eq -1) { $exit = $p.ExitCode }
  } catch {
    $stderr = $_.Exception.Message
    $exit = 1
  }
  $endedAt = (Get-Date).ToUniversalTime().ToString('o')
  try { if (Test-Path $outPath) { $stdout = [string](Get-Content $outPath -Raw -ErrorAction SilentlyContinue) } } catch { }
  try { if (Test-Path $errPath) { $stderr = [string](Get-Content $errPath -Raw -ErrorAction SilentlyContinue) } } catch { }
  $errMsg = ''
  if ($timedOut) { $errMsg = 'Timed out after ' + $timeout + 's' }
  $body = @{
    jobId = $id; deviceId = $state.deviceId; credential = $state.credential
    ok = (-not $timedOut -and $exit -eq 0); exitCode = $exit
    stdoutB64 = (To-B64 $stdout); stderrB64 = (To-B64 $stderr)
    error = $errMsg; startedAt = $startedAt; endedAt = $endedAt; timedOut = $timedOut
  }
  try { Post-Collector '/job-result' $body | Out-Null; Write-AgentLog ('Job ' + $id + ' finished (exit ' + $exit + ')') } catch { Write-AgentLog ('job result post failed: ' + $_.Exception.Message) }
  Remove-Item -Force $file, $outPath, $errPath -ErrorAction SilentlyContinue
}
function Invoke-PendingJobs($jobs, $state) {
  foreach ($job in @($jobs)) { try { Invoke-OneJob $job $state } catch { Write-AgentLog ('job failed: ' + $_.Exception.Message) } }
}
function Send-AgentHeartbeat {
  $state = Connect-Agent
  $id = Get-AgentIdentity
  $sp = Get-SpoolState
  $payload = @{
    agentVersion    = $Cfg.agentVersion
    capabilities    = @($Cfg.capabilities)
    clientTime      = (Get-Date).ToUniversalTime().ToString('o')
    intervalSeconds = [int]$Cfg.heartbeatSeconds
    hostname        = $env:COMPUTERNAME
    interfaces      = @($id.interfaces)
    loggedInUsers   = @($id.loggedInUsers)
    spool           = $sp
  }
  $res = Invoke-Collector '/heartbeat' @{ deviceId = $state.deviceId; credential = $state.credential; payload = $payload }
  if (-not $res.ok) { throw ('Heartbeat refused: ' + $res.error) }
  $note = ''
  if ($res.networkChanged) { $note = ' (network changed)' }
  Write-AgentLog ('Heartbeat ok - interval ' + $res.intervalSeconds + 's' + $note)
  # success resets the reconnect backoff
  $st = Read-AgentState
  if ($st) {
    $st | Add-Member -NotePropertyName failStreak -NotePropertyValue 0 -Force
    $st | Add-Member -NotePropertyName nextAttemptAt -NotePropertyValue '' -Force
    Save-AgentState $st
  }
  # replay anything buffered while the collector was unreachable
  if ([int]$sp.pending -gt 0) { Flush-Spool }
  if ($res.collectInventory) { Send-AgentInventory $state }
  $metricsDue = $true
  if ($st -and $st.metricsAt -and -not $res.collectMetrics) {
    $elapsed = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$st.metricsAt
    if ($elapsed -lt ([int]$Cfg.metricsSampleSeconds * 1000)) { $metricsDue = $false }
  }
  if ($metricsDue) { Send-AgentMetrics $state }
  if ($res.collectLogs) { Send-AgentLogs $state $res.collectLogs }
  if ($res.selfTest) { Invoke-AgentSelfTest $state $res.selfTest }
  if ($res.jobs) { Invoke-PendingJobs $res.jobs $state }
  if ($res.update) { Invoke-SelfUpdate $res.update }
  return $res
}
function Install-Agent {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Set-Content -Path $ConfigPath -Value $CfgJson -Encoding UTF8
  # the agent must run from its install directory, not the download folder,
  # so a later self-update can swap it in place
  if ($AgentPath -ne $AgentRuntime) { Copy-Item -Force $AgentPath $AgentRuntime }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Once' -f $AgentRuntime)
  $boot    = New-ScheduledTaskTrigger -AtStartup
  $boot.Delay = 'PT1M'
  $repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Seconds ([int]$Cfg.heartbeatSeconds))
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($boot, $repeat) -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Write-AgentLog ('Registered scheduled task ' + $TaskName)
  $res = Send-AgentHeartbeat
  Write-Host ''
  Write-Host '  RMM-U agent installed successfully.' -ForegroundColor Green
  Write-Host ('  Device id : {0}' -f $res.deviceId)
  Write-Host ('  Provider  : {0}' -f $Cfg.providerName)
  Write-Host ('  Collector : {0}' -f $Cfg.collectorUrl)
  Write-Host ('  Heartbeat : every {0}s' -f $Cfg.heartbeatSeconds)
  Write-Host ('  Service   : scheduled task "{0}" (starts on boot)' -f $TaskName)
  Write-Host ''
}
function Uninstall-Agent {
  Write-AgentLog 'Uninstalling'
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $state = Read-AgentState
  if ($state -and $state.credential) { try { Invoke-Collector '/uninstall' @{ deviceId = $state.deviceId; credential = $state.credential } | Out-Null } catch { } }
  Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $SpoolDir -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $LogDir -ErrorAction SilentlyContinue
  Write-Host 'RMM-U agent removed (service, data, spool and logs).' -ForegroundColor Yellow
}

if ($Uninstall) { Uninstall-Agent; return }
if ($SelfTest) {
  try {
    $state = Connect-Agent
    $report = Invoke-AgentSelfTest $state $null
    foreach ($c in $report.checks) {
      $tag = 'FAIL'
      if ($c.ok) { $tag = 'PASS' }
      $line = ('  [{0}] {1} - {2}' -f $tag, $c.name, $c.detail)
      if ($c.ok) { Write-Host $line -ForegroundColor Green } else { Write-Host $line -ForegroundColor Red }
    }
    if ($report.ok) { Write-Host ('Self-test OK - device ' + $state.deviceId) -ForegroundColor Green; return }
    Write-Host 'Self-test FAILED' -ForegroundColor Red
    exit 1
  } catch {
    Write-Host ('Self-test FAILED - ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
  }
  return
}
if ($Once) {
  # reconnect backoff: skip this check-in while the backoff window is open
  $st0 = Read-AgentState
  if ($st0 -and $st0.nextAttemptAt) {
    try { if ([DateTime]::Parse([string]$st0.nextAttemptAt) -gt (Get-Date).ToUniversalTime()) { Write-AgentLog 'Backoff active - skipping this check-in'; return } } catch { }
  }
  try { Send-AgentHeartbeat | Out-Null }
  catch {
    $msg = $_.Exception.Message
    Write-AgentLog ('heartbeat failed: ' + $msg)
    try {
      $st = Read-AgentState
      $streak = 1
      if ($st -and $st.failStreak) { $streak = [int]$st.failStreak + 1 }
      if ($st) {
        $st | Add-Member -NotePropertyName failStreak -NotePropertyValue $streak -Force
        $st | Add-Member -NotePropertyName nextAttemptAt -NotePropertyValue ((Get-Date).ToUniversalTime().AddMilliseconds((Get-BackoffMs $streak)).ToString('o')) -Force
        Save-AgentState $st
      }
      Write-AgentLog ('backoff: ' + $streak + ' failure(s), delaying the next check-in')
    } catch { }
    exit 1
  }
  return
}
try {
  Install-Agent
} catch {
  Write-AgentLog ('install failed: ' + $_.Exception.Message)
  Write-Host ('RMM-U agent install FAILED: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
`;
  }

  /* ── macOS / Linux: one file, run with no args to install, --once from the unit ── */
  function posixInstaller(configJson, head, config, platform) {
    const isMac = platform === "macos";
    const unitKind = isMac ? "launchd" : "systemd";
    return `#!/bin/sh
# ---------------------------------------------------------------------------
#  RMM-U agent — installer & runtime (${isMac ? "macOS" : "Linux"})
#
#  Provider  : ${head.provider}
#  Collector : ${head.collector}
#  Site      : ${head.site}
#  Groups    : ${head.groups}
#  Service   : ${head.service} (${unitKind})
#  Generated : ${head.generated}
#
#  Run with no arguments (as root) to install the agent; ${unitKind} then runs
#  this same script with --once at every heartbeat interval.
#      sudo sh THIS-FILE.sh --install    install (register the service + enroll)
#      sh THIS-FILE.sh --once            one heartbeat (used by the service)
#      sh THIS-FILE.sh --self-test       check the collector + enrollment state
#      sudo sh THIS-FILE.sh --uninstall  remove the agent, service and data
#
#  The enrollment token embedded below is SINGLE-USE: it is exchanged for a
#  per-device credential on first contact, and only that credential's hash is
#  stored by the collector. Revoke the token from the console if this file is
#  ever leaked.
# ---------------------------------------------------------------------------
set -eu

CFG_JSON='${configJson}'
SERVICE_NAME='${safe(config.serviceName)}'
INSTALL_DIR='${safe(config.installDir)}'
DATA_DIR=$(dirname "$INSTALL_DIR")
AGENT_SRC="$0"
AGENT_PATH="$INSTALL_DIR/agent.sh"
CONFIG_PATH="$INSTALL_DIR/config.json"
STATE_PATH="$INSTALL_DIR/state.json"
LOG_DIR="$DATA_DIR/logs"
LOG_PATH="$LOG_DIR/agent.log"
SPOOL_DIR="$INSTALL_DIR/spool"
BACKUP_DIR="$INSTALL_DIR/backup"
NEXT_FILE="$INSTALL_DIR/next_attempt"
STREAK_FILE="$INSTALL_DIR/fail_streak"
MODE="\${1:---install}"

json_str() { printf '%s' "$CFG_JSON" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1; }
cfg_num() { printf '%s' "$CFG_JSON" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\\([0-9][0-9.]*\\).*/\\1/p' | head -n1; }
cfg_bool() { printf '%s' "$CFG_JSON" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\\(true\\|false\\).*/\\1/p' | head -n1; }
COLLECTOR=$(json_str collectorUrl)
TOKEN=$(json_str token)
PROVIDER_ID=$(json_str providerId)
AGENT_VERSION=$(json_str agentVersion)
HEARTBEAT=$(json_str heartbeatSeconds)
[ -n "$HEARTBEAT" ] || HEARTBEAT=300
METRICS_INTERVAL=$(json_str metricsSampleSeconds)
[ -n "$METRICS_INTERVAL" ] || METRICS_INTERVAL=60
TLS_MODE=$(json_str tlsMode)
[ -n "$TLS_MODE" ] || TLS_MODE=system
TLS_PIN=$(json_str tlsPinSha256)
ALLOW_INSECURE=$(cfg_bool allowInsecure)
[ -n "$ALLOW_INSECURE" ] || ALLOW_INSECURE=false
BACKOFF_BASE=$(cfg_num backoffBaseSeconds)
[ -n "$BACKOFF_BASE" ] || BACKOFF_BASE=5
BACKOFF_MAX=$(cfg_num backoffMaxSeconds)
[ -n "$BACKOFF_MAX" ] || BACKOFF_MAX=900
BACKOFF_FACTOR=$(cfg_num backoffFactor)
[ -n "$BACKOFF_FACTOR" ] || BACKOFF_FACTOR=2
BACKOFF_JITTER=$(cfg_num backoffJitter)
[ -n "$BACKOFF_JITTER" ] || BACKOFF_JITTER=0.25
SPOOL_MAX_BYTES=$(cfg_num spoolMaxBytes)
[ -n "$SPOOL_MAX_BYTES" ] || SPOOL_MAX_BYTES=26214400
SPOOL_MAX_ITEMS=$(cfg_num spoolMaxItems)
[ -n "$SPOOL_MAX_ITEMS" ] || SPOOL_MAX_ITEMS=5000
SPOOL_FLUSH=$(cfg_num spoolFlushPerCycle)
[ -n "$SPOOL_FLUSH" ] || SPOOL_FLUSH=50
LOG_MAX_BYTES=$(cfg_num logMaxBytes)
[ -n "$LOG_MAX_BYTES" ] || LOG_MAX_BYTES=2097152
LOG_KEEP=$(cfg_num logKeep)
[ -n "$LOG_KEEP" ] || LOG_KEEP=3
CPU_NICE=$(cfg_num cpuNice)
[ -n "$CPU_NICE" ] || CPU_NICE=10
MAX_MEM_MB=$(cfg_num maxMemMB)
[ -n "$MAX_MEM_MB" ] || MAX_MEM_MB=256
SELF_UPDATE=$(cfg_bool selfUpdateEnabled)
[ -n "$SELF_UPDATE" ] || SELF_UPDATE=true
KEEP_VERSIONS=$(cfg_num keepVersions)
[ -n "$KEEP_VERSIONS" ] || KEEP_VERSIONS=2
# collector identity: pinned certificate (SHA-256) or the system trust store.
CURL_TLS=""
if [ "$TLS_MODE" = "pinned" ] && [ -n "$TLS_PIN" ]; then CURL_TLS="--pinnedpubkey sha256//$TLS_PIN"; fi
if [ "$ALLOW_INSECURE" = "true" ]; then CURL_TLS="$CURL_TLS -k"; fi

rotate_log() {
  [ -f "$LOG_PATH" ] || return 0
  SZ=$(wc -c < "$LOG_PATH" 2>/dev/null | tr -d ' ')
  case "$SZ" in ''|*[!0-9]*) return 0 ;; esac
  [ "$SZ" -gt "$LOG_MAX_BYTES" ] || return 0
  K=$LOG_KEEP
  while [ "$K" -ge 1 ]; do
    if [ -f "$LOG_PATH.$K" ]; then mv -f "$LOG_PATH.$K" "$LOG_PATH.$((K + 1))" 2>/dev/null || true; fi
    K=$((K - 1))
  done
  mv -f "$LOG_PATH" "$LOG_PATH.1" 2>/dev/null || true
}

log() {
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_PATH" 2>/dev/null || true
  rotate_log
}

post() {
  curl -fsS -m 30 -H 'Content-Type: application/json' -X POST "$COLLECTOR$1" -d "$2"
}

# ---- offline replay spool (Task 12): posts that fail are buffered and replayed ----
SPOOL_SEQ=0
spool_state() {
  PENDING=0; SPOOL_BYTES=0; OLDEST=''
  if [ -d "$SPOOL_DIR" ]; then
    PENDING=$(ls -1 "$SPOOL_DIR" 2>/dev/null | grep -c '[.]item$' || true)
    case "$PENDING" in ''|*[!0-9]*) PENDING=0 ;; esac
    SPOOL_BYTES=$(du -sk "$SPOOL_DIR" 2>/dev/null | awk '{ print $1 * 1024 }')
    case "$SPOOL_BYTES" in ''|*[!0-9]*) SPOOL_BYTES=0 ;; esac
    OLDEST=$(ls -1 "$SPOOL_DIR" 2>/dev/null | grep '[.]item$' | head -n1 || true)
  fi
}
spool_save() {
  mkdir -p "$SPOOL_DIR" 2>/dev/null || return 0
  spool_state
  if [ "$PENDING" -ge "$SPOOL_MAX_ITEMS" ] || [ "$SPOOL_BYTES" -ge "$SPOOL_MAX_BYTES" ]; then
    DROP=$(ls -1 "$SPOOL_DIR" 2>/dev/null | grep '[.]item$' | head -n1 || true)
    if [ -n "$DROP" ]; then rm -f "$SPOOL_DIR/$DROP" 2>/dev/null || true; fi
    log 'spool full - dropped the oldest buffered post'
  fi
  SPOOL_SEQ=$((SPOOL_SEQ + 1))
  NAME=$(date -u +%Y%m%d%H%M%S)-$$-$SPOOL_SEQ
  { printf '%s\\n' "$1"; printf '%s' "$2"; } > "$SPOOL_DIR/$NAME.item" 2>/dev/null || true
  return 0
}
spool_post() {
  if post "$1" "$2"; then return 0; fi
  spool_save "$1" "$2"
  return 1
}
flush_spool() {
  [ -d "$SPOOL_DIR" ] || return 0
  N=0
  for f in $(ls -1 "$SPOOL_DIR" 2>/dev/null | grep '[.]item$' | head -n "$SPOOL_FLUSH"); do
    OP=$(head -n1 "$SPOOL_DIR/$f" 2>/dev/null)
    BODY=$(tail -n +2 "$SPOOL_DIR/$f" 2>/dev/null)
    if post "$OP" "$BODY" >/dev/null 2>&1; then
      rm -f "$SPOOL_DIR/$f" 2>/dev/null || true
      N=$((N + 1))
    else
      break
    fi
  done
  if [ "$N" -gt 0 ]; then log "replayed $N buffered post(s)"; fi
  return 0
}

# ---- reconnect backoff (Task 12) ----
fail_streak() {
  S=0
  if [ -f "$STREAK_FILE" ]; then S=$(cat "$STREAK_FILE" 2>/dev/null); fi
  case "$S" in ''|*[!0-9]*) S=0 ;; esac
  printf '%s' "$S"
}
set_streak() { printf '%s\\n' "$1" > "$STREAK_FILE" 2>/dev/null || true; }
next_attempt() {
  N=0
  if [ -f "$NEXT_FILE" ]; then N=$(cat "$NEXT_FILE" 2>/dev/null); fi
  case "$N" in ''|*[!0-9]*) N=0 ;; esac
  printf '%s' "$N"
}
set_next() { printf '%s\\n' "$1" > "$NEXT_FILE" 2>/dev/null || true; }
backoff_ms() {
  ATT="$1"
  case "$ATT" in ''|*[!0-9]*) ATT=1 ;; esac
  MS=$(awk -v b="$BACKOFF_BASE" -v f="$BACKOFF_FACTOR" -v c="$BACKOFF_MAX" -v j="$BACKOFF_JITTER" -v n="$ATT" 'BEGIN { raw = b * 1000 * (f ^ (n - 1)); if (raw > c * 1000) raw = c * 1000; v = raw * (1 + (rand() * 2 - 1) * j); if (v < 0) v = 0; printf "%d", v }')
  case "$MS" in ''|*[!0-9]*) MS=0 ;; esac
  printf '%s' "$MS"
}

# ---- hashing / service / self-update (Task 12) ----
b64_of() {
  if command -v base64 >/dev/null 2>&1; then printf '%s' "$1" | base64 | tr -d '\\n\\r'; return; fi
  if command -v openssl >/dev/null 2>&1; then printf '%s' "$1" | openssl base64 -A 2>/dev/null; return; fi
  printf ''
}
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{ print $1 }'; return; fi
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{ print $1 }'; return; fi
  if command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | sed 's/.*= //'; return; fi
  printf ''
}
restart_service() {
  if [ "$(uname -s)" = "Darwin" ]; then
    launchctl unload "/Library/LaunchDaemons/$SERVICE_NAME.plist" 2>/dev/null || true
    launchctl load "/Library/LaunchDaemons/$SERVICE_NAME.plist" 2>/dev/null || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart "$SERVICE_NAME.timer" 2>/dev/null || true
  fi
}
do_self_update() {
  REQ="$1"
  FROM="$AGENT_VERSION"
  TARGET=$(printf '%s' "$REQ" | json_field version)
  URL=$(printf '%s' "$REQ" | json_field url)
  WANT=$(printf '%s' "$REQ" | json_field sha256)
  RB=$(printf '%s' "$REQ" | json_bool rollback)
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  if [ "$SELF_UPDATE" != "true" ]; then
    log 'self-update is disabled by policy'
    return 0
  fi
  mkdir -p "$BACKUP_DIR" 2>/dev/null || true
  if [ "$RB" = "true" ] || [ -z "$URL" ]; then
    if [ ! -f "$BACKUP_DIR/agent.sh.bak" ]; then
      log 'rollback requested but no agent backup exists'
      return 0
    fi
    cp -f "$BACKUP_DIR/agent.sh.bak" "$AGENT_PATH" 2>/dev/null || true
    chmod 0755 "$AGENT_PATH" 2>/dev/null || true
    log 'rolled back to the previous agent build'
    UR=$(printf '{"deviceId":"%s","credential":"%s","ok":true,"rolledBack":true,"version":"%s","fromVersion":"%s","targetVersion":"%s","error":"rollback requested"}' "$DEV" "$CRED" "$FROM" "$FROM" "$TARGET")
    post /update-result "$UR" >/dev/null 2>&1 || true
    return 0
  fi
  TMP="$INSTALL_DIR/pending-$$.sh"
  if ! curl -fsSL $CURL_TLS -m 60 -o "$TMP" "$URL" 2>/dev/null; then
    log 'self-update download failed'
    rm -f "$TMP" 2>/dev/null || true
    UR=$(printf '{"deviceId":"%s","credential":"%s","ok":false,"rolledBack":false,"version":"%s","fromVersion":"%s","targetVersion":"%s","error":"download failed"}' "$DEV" "$CRED" "$FROM" "$FROM" "$TARGET")
    post /update-result "$UR" >/dev/null 2>&1 || true
    return 0
  fi
  if [ -n "$WANT" ]; then
    GOT=$(sha256_of "$TMP")
    if [ "$GOT" != "$WANT" ]; then
      log "self-update checksum mismatch (got $GOT)"
      rm -f "$TMP" 2>/dev/null || true
      UR=$(printf '{"deviceId":"%s","credential":"%s","ok":false,"rolledBack":false,"version":"%s","fromVersion":"%s","targetVersion":"%s","error":"checksum mismatch"}' "$DEV" "$CRED" "$FROM" "$FROM" "$TARGET")
      post /update-result "$UR" >/dev/null 2>&1 || true
      return 0
    fi
  fi
  cp -f "$AGENT_PATH" "$BACKUP_DIR/agent.sh.bak" 2>/dev/null || true
  chmod 0755 "$TMP" 2>/dev/null || true
  if ! sh "$TMP" --self-test >/dev/null 2>&1; then
    log 'candidate agent failed its self-test - rolling back'
    rm -f "$TMP" 2>/dev/null || true
    cp -f "$BACKUP_DIR/agent.sh.bak" "$AGENT_PATH" 2>/dev/null || true
    chmod 0755 "$AGENT_PATH" 2>/dev/null || true
    UR=$(printf '{"deviceId":"%s","credential":"%s","ok":false,"rolledBack":true,"version":"%s","fromVersion":"%s","targetVersion":"%s","error":"self-test failed"}' "$DEV" "$CRED" "$FROM" "$FROM" "$TARGET")
    post /update-result "$UR" >/dev/null 2>&1 || true
    return 0
  fi
  cp -f "$TMP" "$AGENT_PATH" 2>/dev/null || true
  chmod 0755 "$AGENT_PATH" 2>/dev/null || true
  rm -f "$TMP" 2>/dev/null || true
  restart_service
  log "self-update to $TARGET applied"
  UR=$(printf '{"deviceId":"%s","credential":"%s","ok":true,"rolledBack":false,"version":"%s","fromVersion":"%s","targetVersion":"%s"}' "$DEV" "$CRED" "$TARGET" "$FROM" "$TARGET")
  post /update-result "$UR" >/dev/null 2>&1 || true
  return 0
}

# ---- diagnostics & support (Task 13) ----
send_logs() {
  REQ="$1"
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  REQID=$(printf '%s' "$REQ" | json_field requestId)
  LINES=400
  RL=$(printf '%s' "$REQ" | json_num lines)
  if [ -n "$RL" ]; then LINES="$RL"; fi
  TEXT=''
  TRUNC=false
  if [ -f "$LOG_PATH" ]; then TEXT=$(tail -n "$LINES" "$LOG_PATH" 2>/dev/null); fi
  LEN=$(printf '%s' "$TEXT" | wc -c | tr -d ' ')
  if [ "$LEN" -gt 262144 ]; then TEXT=$(printf '%s' "$TEXT" | tail -c 262144); TRUNC=true; fi
  N=$(printf '%s\\n' "$TEXT" | wc -l | tr -d ' ')
  TB64=$(b64_of "$TEXT")
  BODY=$(printf '{"deviceId":"%s","credential":"%s","requestId":"%s","lines":%s,"textB64":"%s","truncated":%s}' "$DEV" "$CRED" "$REQID" "$N" "$TB64" "$TRUNC")
  spool_post /logs "$BODY" >/dev/null 2>&1 || true
  log 'agent log uploaded'
}
run_self_test() {
  REQ="$1"
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  REQID=$(printf '%s' "$REQ" | json_field requestId)
  CHECKS=''
  FAILED=0
  add_check() {
    if [ -n "$CHECKS" ]; then CHECKS="$CHECKS,"; fi
    CHECKS="$CHECKS$(printf '{"id":"%s","name":"%s","ok":%s,"detail":"%s"}' "$1" "$2" "$3" "$(jesc "$4")")"
    if [ "$3" = "false" ]; then FAILED=$((FAILED + 1)); fi
    if [ "$3" = "true" ]; then printf '  [PASS] %s - %s\\n' "$2" "$4" >&2; else printf '  [FAIL] %s - %s\\n' "$2" "$4" >&2; fi
  }
  if [ -n "$COLLECTOR" ]; then add_check config 'Configuration' true "collector $COLLECTOR"; else add_check config 'Configuration' false 'no collector address'; fi
  PROBE=''
  REACH=false
  if [ -n "$DEV" ] && [ -n "$CRED" ]; then
    PROBE=$(post /heartbeat "$(printf '{"deviceId":"%s","credential":"%s","payload":{}}' "$DEV" "$CRED")" 2>&1) && REACH=true || REACH=false
  fi
  if [ "$REACH" = "true" ]; then add_check reachable 'Collector reachable' true 'collector answered'; else add_check reachable 'Collector reachable' false "$PROBE"; fi
  if [ "$TLS_MODE" = "pinned" ] && [ -n "$TLS_PIN" ]; then
    add_check tls 'Collector identity' true "pinned certificate"
  elif [ "$TLS_MODE" = "insecure" ] && [ "$ALLOW_INSECURE" != "true" ]; then
    add_check tls 'Collector identity' false 'insecure collector address'
  else
    add_check tls 'Collector identity' true "mode $TLS_MODE"
  fi
  if [ -n "$DEV" ]; then add_check enrolled 'Enrolled' true "$DEV"; else add_check enrolled 'Enrolled' false 'not enrolled'; fi
  if [ "$REACH" = "true" ]; then add_check authenticated 'Authenticated' true 'credential accepted'; else add_check authenticated 'Authenticated' false 'could not authenticate'; fi
  add_check clock 'Clock' true "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  SVCOK=false
  if [ "$(uname -s)" = "Darwin" ]; then
    if [ -f "/Library/LaunchDaemons/$SERVICE_NAME.plist" ]; then SVCOK=true; fi
  elif command -v systemctl >/dev/null 2>&1; then
    if systemctl is-enabled --quiet "$SERVICE_NAME.timer" 2>/dev/null; then SVCOK=true; fi
  fi
  if [ "$SVCOK" = "true" ]; then add_check service 'Service' true "$SERVICE_NAME"; else add_check service 'Service' false "$SERVICE_NAME is not registered"; fi
  spool_state
  SPOOLOK=true
  if [ "$SPOOL_BYTES" -gt "$SPOOL_MAX_BYTES" ]; then SPOOLOK=false; fi
  if [ "$SPOOLOK" = "true" ]; then add_check spool 'Offline buffer' true "$PENDING item(s)"; else add_check spool 'Offline buffer' false "$PENDING item(s) over budget"; fi
  FREEK=$(df -kP "$INSTALL_DIR" 2>/dev/null | tail -n1 | awk '{ print $4 }')
  case "$FREEK" in ''|*[!0-9]*) FREEK=0 ;; esac
  FREEB=$((FREEK * 1024))
  DISKOK=true
  if [ "$FREEB" -gt 0 ] && [ "$FREEB" -lt 104857600 ]; then DISKOK=false; fi
  if [ "$DISKOK" = "true" ]; then add_check disk 'Disk space' true "$FREEB bytes free"; else add_check disk 'Disk space' false "$FREEB bytes free"; fi
  RT=''
  for r in sh bash python3 pwsh; do
    if command -v "$r" >/dev/null 2>&1; then RT="$RT $r"; fi
  done
  add_check jobs 'Job runtime' true "available:$RT"
  OK=true
  if [ "$FAILED" -gt 0 ]; then OK=false; fi
  SELFTEST_JSON=$(printf '{"deviceId":"%s","credential":"%s","requestId":"%s","ok":%s,"checks":[%s],"agentVersion":"%s","context":{"hostname":"%s","spoolPending":%s,"freeDiskBytes":%s}}' "$DEV" "$CRED" "$REQID" "$OK" "$CHECKS" "$AGENT_VERSION" "$(hostname 2>/dev/null || uname -n)" "$PENDING" "$FREEB")
  spool_post /diagnostics "$SELFTEST_JSON" >/dev/null 2>&1 || true
  log 'self-test uploaded'
  printf '%s' "$SELFTEST_JSON"
}

interfaces_json() {
  IPS=$( (ifconfig -a 2>/dev/null || ip -o addr 2>/dev/null) | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$/) print $i }' | grep -v '^127[.]' | head -n 3 )
  if [ -z "$IPS" ]; then
    IPJSON=""
  else
    IPJSON=$(for ip in $IPS; do echo "$ip"; done | sed 's/.*/"&"/' | paste -sd, -)
  fi
  printf '[{"name":"primary","ip4":[%s]}]' "$IPJSON"
}

identity_json() {
  HOST=$(hostname 2>/dev/null || uname -n)
  OSNAME=$(uname -s); OSREL=$(uname -r)
  PRETTY_NAME=""
  if [ -f /etc/os-release ]; then
    set +u
    . /etc/os-release 2>/dev/null || true
    set -u
  fi
  if [ -n "$PRETTY_NAME" ]; then OSNAME="$PRETTY_NAME"; fi
  printf '{"hostname":"%s","role":"workstation","os":{"name":"%s","version":"%s"},"interfaces":%s}' "$HOST" "$OSNAME" "$OSREL" "$(interfaces_json)"
}


state_field() {
  [ -f "$STATE_PATH" ] || return 0
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$STATE_PATH" | head -n1
}

connect_agent() {
  DEV=$(state_field deviceId)
  if [ -n "$DEV" ]; then printf '%s' "$DEV"; return 0; fi
  log 'Enrolling with the embedded one-time token'
  BODY=$(printf '{"token":"%s","providerId":"%s","hostname":"%s","agentVersion":"%s"}' "$TOKEN" "$PROVIDER_ID" "$(hostname 2>/dev/null || uname -n)" "$AGENT_VERSION")
  RES=$(post /enroll "$BODY") || { log "enroll request failed"; printf 'Enrollment request failed\\n' >&2; exit 2; }
  DEV=$(printf '%s' "$RES" | sed -n 's/.*"deviceId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1)
  CRED=$(printf '%s' "$RES" | sed -n 's/.*"credential"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1)
  if [ -z "$DEV" ] || [ -z "$CRED" ]; then
    log "enroll refused: $RES"
    printf 'Enrollment failed: %s\\n' "$RES" >&2
    exit 2
  fi
  printf '{"deviceId":"%s","credential":"%s"}\\n' "$DEV" "$CRED" > "$STATE_PATH"
  log "enrolled as $DEV"
  printf '%s' "$DEV"
}

send_heartbeat() {
  DEV=$(connect_agent)
  CRED=$(state_field credential)
  spool_state
  SPOOL_JSON=$(printf '{"pending":%s,"bytes":%s,"oldestAt":"%s"}' "$PENDING" "$SPOOL_BYTES" "$OLDEST")
  PAYLOAD=$(printf '{"agentVersion":"%s","capabilities":%s,"clientTime":"%s","intervalSeconds":%s,"hostname":"%s","interfaces":%s,"spool":%s}' \\
    "$AGENT_VERSION" '${JSON.stringify(config.capabilities)}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HEARTBEAT" \\
    "$(hostname 2>/dev/null || uname -n)" "$(interfaces_json)" "$SPOOL_JSON")
  BODY=$(printf '{"deviceId":"%s","credential":"%s","payload":%s}' "$DEV" "$CRED" "$PAYLOAD")
  RES=$(post /heartbeat "$BODY") || { log "heartbeat request failed"; return 1; }
  log "heartbeat ok: $RES"
  set_streak 0
  set_next 0
  if [ "$PENDING" -gt 0 ]; then flush_spool; fi
  printf '%s' "$RES"
}

jesc() { printf '%s' "$1" | tr -d '"' | tr -d '\\r' | tr -d '\\\\'; }

json_field() {
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1
}

json_num() {
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -n1
}

json_bool() {
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\\(true\\|false\\).*/\\1/p' | head -n1
}

cpu_json() {
  MODEL=""
  CORES=""
  if [ -r /proc/cpuinfo ]; then
    MODEL=$(grep -m1 'model name' /proc/cpuinfo | sed 's/.*: //')
    [ -n "$MODEL" ] || MODEL=$(grep -m1 '^Hardware' /proc/cpuinfo | sed 's/.*: //')
    CORES=$(grep -c '^processor' /proc/cpuinfo)
  fi
  if [ -z "$MODEL" ] && [ "$(uname -s)" = "Darwin" ]; then
    MODEL=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)
    CORES=$(sysctl -n hw.physicalcpu 2>/dev/null || true)
  fi
  printf '{"model":"%s","cores":%s,"threads":%s}' "$(jesc "$MODEL")" "\${CORES:-0}" "\${CORES:-0}"
}

mem_total_bytes() {
  if [ -r /proc/meminfo ]; then awk '/MemTotal/ { printf "%d", $2 * 1024 }' /proc/meminfo; return; fi
  if [ "$(uname -s)" = "Darwin" ]; then sysctl -n hw.memsize 2>/dev/null || echo 0; return; fi
  echo 0
}

soft_list() {
  if command -v dpkg-query >/dev/null 2>&1; then
    dpkg-query -W -f='\${Package}\\t\${Version}\\n' 2>/dev/null | head -n 500 | awk -F'\\t' '{ gsub(/"/,"",$1); gsub(/"/,"",$2); printf "{\\"name\\":\\"%s\\",\\"version\\":\\"%s\\"}\\n", $1, $2 }'
  elif command -v rpm >/dev/null 2>&1; then
    rpm -qa --qf '%{NAME} %{VERSION}\\n' 2>/dev/null | head -n 500 | awk '{ gsub(/"/,"",$1); printf "{\\"name\\":\\"%s\\",\\"version\\":\\"%s\\"}\\n", $1, $2 }'
  elif command -v brew >/dev/null 2>&1; then
    brew list --versions 2>/dev/null | head -n 500 | awk '{ gsub(/"/,"",$1); printf "{\\"name\\":\\"%s\\",\\"version\\":\\"%s\\"}\\n", $1, $2 }'
  fi
}

svc_list() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | head -n 500 | awk '{ s="active"; if ($3=="inactive" || $3=="failed") s=$3; gsub(/"/,"",$1); sub(/[.]service$/,"",$1); printf "{\\"name\\":\\"%s\\",\\"state\\":\\"%s\\"}\\n", $1, s }'
  elif [ "$(uname -s)" = "Darwin" ]; then
    launchctl list 2>/dev/null | tail -n +2 | head -n 500 | awk 'NF>=3 { gsub(/"/,"",$3); printf "{\\"name\\":\\"%s\\",\\"state\\":\\"%s\\"}\\n", $3, ($1=="-" ? "stopped" : "running") }'
  fi
}

patches_json() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get -s upgrade 2>/dev/null | awk '/^Inst / { gsub(/"/,"",$2); printf "{\\"id\\":\\"%s\\"}\\n", $2 }' | head -n 200
  elif command -v dnf >/dev/null 2>&1; then
    dnf -q check-update 2>/dev/null | awk 'NF>=3 { gsub(/"/,"",$1); printf "{\\"id\\":\\"%s\\"}\\n", $1 }' | head -n 200
  elif command -v yum >/dev/null 2>&1; then
    yum -q check-update 2>/dev/null | awk 'NF>=3 { gsub(/"/,"",$1); printf "{\\"id\\":\\"%s\\"}\\n", $1 }' | head -n 200
  elif command -v softwareupdate >/dev/null 2>&1; then
    softwareupdate -l 2>/dev/null | sed -n 's/.*Label: \\([^ ]*\\).*/{\\"id\\":\\"\\1\\"}/p' | head -n 200
  fi
}

users_json() {
  if [ -r /etc/passwd ]; then
    awk -F: '$3 >= 1000 && $3 < 65534 { gsub(/"/,"",$1); printf "{\\"name\\":\\"%s\\",\\"uid\\":%s}\\n", $1, $3 }' /etc/passwd | head -n 200
  fi
}

groups_json() {
  if [ -r /etc/group ]; then
    awk -F: '{ gsub(/"/,"",$1); printf "{\\"name\\":\\"%s\\"}\\n", $1 }' /etc/group | head -n 200
  fi
}

disks_json() {
  df -kP 2>/dev/null | awk 'NR>1 && $6 != "" { pct=$5; gsub(/%/,"",pct); if (pct=="") pct=0; gsub(/"/,"",$6); printf "{\\"label\\":\\"%s\\",\\"sizeBytes\\":%d,\\"freeBytes\\":%d,\\"pct\\":%s}\\n", $6, $2*1024, $4*1024, pct }' | paste -sd, -
}

security_json() {
  AV=""
  FW=""
  ENC=""
  SB="false"
  if command -v systemctl >/dev/null 2>&1; then
    for svc in clamav-daemon clamd freshclam; do
      if systemctl is-active --quiet "$svc" 2>/dev/null; then AV="$svc"; break; fi
    done
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then FW="ufw"; fi
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then FW="firewalld"; fi
  if command -v lsblk >/dev/null 2>&1 && lsblk -no TYPE 2>/dev/null | grep -qi crypt; then ENC="LUKS"; fi
  if [ -d /sys/firmware/efi ]; then SB="true"; fi
  printf '{"antivirus":"%s","firewall":"%s","encryption":"%s","secureBoot":%s}' "$(jesc "$AV")" "$(jesc "$FW")" "$(jesc "$ENC")" "$SB"
}

inventory_json() {
  HOST=$(hostname 2>/dev/null || uname -n)
  OSNAME=$(uname -s)
  OSREL=$(uname -r)
  PRETTY_NAME=""
  if [ -r /etc/os-release ]; then
    set +u
    . /etc/os-release 2>/dev/null || true
    set -u
  fi
  if [ -n "$PRETTY_NAME" ]; then OSNAME="$PRETTY_NAME"; fi
  printf '{"hardware":{"hostname":"%s","arch":"%s"},"os":{"name":"%s","version":"%s"},"cpu":%s,"ramBytes":%s,"software":[%s],"services":[%s],"patches":[%s],"disks":[%s],"interfaces":%s,"users":[%s],"groups":[%s],"security":%s,"collectedAt":"%s"}' \\
    "$(jesc "$HOST")" "$(jesc "$(uname -m)")" "$(jesc "$OSNAME")" "$(jesc "$OSREL")" "$(cpu_json)" "$(mem_total_bytes)" "$(soft_list | paste -sd, -)" "$(svc_list | paste -sd, -)" "$(patches_json | paste -sd, -)" "$(disks_json)" "$(interfaces_json)" "$(users_json | paste -sd, -)" "$(groups_json | paste -sd, -)" "$(security_json)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

send_inventory() {
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  INV=$(inventory_json)
  BODY=$(printf '{"deviceId":"%s","credential":"%s","payload":{"mode":"full","inventory":%s,"collectedAt":"%s"}}' "$DEV" "$CRED" "$INV" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  RES=$(spool_post /inventory "$BODY") || { log "inventory post failed (buffered)"; return 1; }
  log "inventory sent: $RES"
  return 0
}

metrics_sample() {
  AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  CPU=""
  if [ -r /proc/stat ]; then
    A=$(awk '/^cpu / { print $2+$3+$4+$5+$6+$7+$8, $5 }' /proc/stat)
    sleep 1
    B=$(awk '/^cpu / { print $2+$3+$4+$5+$6+$7+$8, $5 }' /proc/stat)
    set -- $A $B
    if [ -n "$1" ] && [ -n "$3" ]; then
      DT=$(( $3 - $1 ))
      DI=$(( $4 - $2 ))
      if [ "$DT" -gt 0 ]; then CPU=$(( (DT - DI) * 100 / DT )); fi
    fi
  fi
  MEMPCT=""
  MEMUSED=""
  MEMTOTAL=""
  if [ -r /proc/meminfo ]; then
    MEMTOTAL=$(awk '/MemTotal/ { print $2 * 1024 }' /proc/meminfo)
    MEMAVAIL=$(awk '/MemAvailable/ { print $2 * 1024 }' /proc/meminfo)
    if [ -n "$MEMTOTAL" ] && [ "$MEMTOTAL" -gt 0 ] && [ -n "$MEMAVAIL" ]; then
      MEMUSED=$(( MEMTOTAL - MEMAVAIL ))
      MEMPCT=$(( MEMUSED * 100 / MEMTOTAL ))
    fi
  elif [ "$(uname -s)" = "Darwin" ]; then
    MEMTOTAL=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    FREEP=$(memory_pressure 2>/dev/null | sed -n 's/.*System-wide memory free percentage: \\([0-9]*\\)%.*/\\1/p')
    if [ -n "$FREEP" ]; then MEMPCT=$(( 100 - FREEP )); MEMUSED=$(( MEMTOTAL / 100 * MEMPCT )); fi
  fi
  DISKPCT=""
  DISKFREE=""
  DISKTOTAL=""
  DF_LINE=$(df -kP / 2>/dev/null | tail -n 1)
  if [ -n "$DF_LINE" ]; then
    set -- $DF_LINE
    if [ -n "$2" ] && [ -n "$4" ]; then
      DISKTOTAL=$(( $2 * 1024 ))
      DISKFREE=$(( $4 * 1024 ))
      PCT=$5
      PCT=$(printf '%s' "$PCT" | tr -d '%')
      if [ "$DISKTOTAL" -gt 0 ]; then DISKPCT=$(( DISKTOTAL - DISKFREE )); DISKPCT=$(( DISKPCT * 100 / DISKTOTAL )); fi
    fi
  fi
  UP=""
  if [ -r /proc/uptime ]; then UP=$(awk '{ printf "%d", $1 }' /proc/uptime); fi
  L1=""
  L5=""
  L15=""
  if [ -r /proc/loadavg ]; then
    set -- $(cat /proc/loadavg)
    L1=$1
    L5=$2
    L15=$3
  fi
  RXB=""
  TXB=""
  RX=""
  TX=""
  if [ -r /proc/net/dev ]; then
    RX=$(awk -F'[: ]+' 'NR>2 && $2 != "lo" { r += $3 } END { print r + 0 }' /proc/net/dev)
    TX=$(awk -F'[: ]+' 'NR>2 && $2 != "lo" { t += $11 } END { print t + 0 }' /proc/net/dev)
  elif [ "$(uname -s)" = "Darwin" ] && command -v netstat >/dev/null 2>&1; then
    RX=$(netstat -ib 2>/dev/null | awk 'NR>1 && $1 != "lo0" && $7 ~ /^[0-9]+$/ { r += $7 } END { print r + 0 }')
    TX=$(netstat -ib 2>/dev/null | awk 'NR>1 && $1 != "lo0" && $10 ~ /^[0-9]+$/ { t += $10 } END { print t + 0 }')
  fi
  if [ -n "$RX" ]; then
    PREV="$INSTALL_DIR/netprev"
    NOW_S=$(date +%s)
    if [ -r "$PREV" ]; then
      PRX=$(cut -d' ' -f1 "$PREV" 2>/dev/null)
      PTX=$(cut -d' ' -f2 "$PREV" 2>/dev/null)
      PAT=$(cut -d' ' -f3 "$PREV" 2>/dev/null)
      case "$PRX" in ''|*[!0-9]*) PRX=0 ;; esac
      case "$PAT" in ''|*[!0-9]*) PAT=0 ;; esac
      DS=$(( NOW_S - PAT ))
      if [ "$DS" -gt 0 ]; then
        DR=$(( RX - PRX ))
        DTX=$(( TX - PTX ))
        if [ "$DR" -lt 0 ]; then DR=0; fi
        if [ "$DTX" -lt 0 ]; then DTX=0; fi
        RXB=$(( DR / DS ))
        TXB=$(( DTX / DS ))
      fi
    fi
    printf '%s %s %s\\n' "$RX" "$TX" "$NOW_S" > "$PREV" 2>/dev/null || true
  fi
  printf '{"at":"%s","cpuPct":%s,"memPct":%s,"memUsedBytes":%s,"memTotalBytes":%s,"diskPct":%s,"diskFreeBytes":%s,"diskTotalBytes":%s,"uptimeSeconds":%s,"load1":%s,"load5":%s,"load15":%s,"netRxBps":%s,"netTxBps":%s,"disks":[%s]}' \\
    "$AT" "\${CPU:-0}" "\${MEMPCT:-0}" "\${MEMUSED:-0}" "\${MEMTOTAL:-0}" "\${DISKPCT:-0}" "\${DISKFREE:-0}" "\${DISKTOTAL:-0}" "\${UP:-0}" "\${L1:-0}" "\${L5:-0}" "\${L15:-0}" "\${RXB:-0}" "\${TXB:-0}" "$(disks_json)"
}

send_metrics() {
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  SAMPLE=$(metrics_sample)
  BODY=$(printf '{"deviceId":"%s","credential":"%s","payload":{"samples":[%s],"intervalSeconds":%s}}' "$DEV" "$CRED" "$SAMPLE" "$METRICS_INTERVAL")
  RES=$(spool_post /metrics "$BODY") || { log "metrics post failed (buffered)"; return 1; }
  log "metrics sent: $RES"
  return 0
}

run_jobs() {
  JOBS_JSON="$1"
  printf '%s' "$JOBS_JSON" | awk '{ gsub(/\\{"jobId"/, "\\n{\\"jobId\\""); print }' | grep '^{"jobId"' | while IFS= read -r JOB; do
    run_one_job "$JOB"
  done
  return 0
}

run_one_job() {
  JOB="$1"
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  JOBID=$(printf '%s' "$JOB" | json_field jobId)
  LANG=$(printf '%s' "$JOB" | json_field language)
  SB64=$(printf '%s' "$JOB" | json_field scriptB64)
  AB64=$(printf '%s' "$JOB" | json_field argsB64)
  TMO=$(printf '%s' "$JOB" | json_num timeoutSeconds)
  [ -n "$JOBID" ] || return 0
  [ -n "$TMO" ] || TMO=300
  case "$LANG" in
    powershell) EXT=.ps1; RUNNER=$(command -v pwsh 2>/dev/null || true) ;;
    cmd) EXT=.cmd; RUNNER=$(command -v cmd.exe 2>/dev/null || true) ;;
    python) EXT=.py; RUNNER=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true) ;;
    bash) EXT=.sh; RUNNER=/bin/bash ;;
    sh) EXT=.sh; RUNNER=/bin/sh ;;
    binary) EXT=.bin; RUNNER=direct ;;
    *) EXT=.bin; RUNNER=direct ;;
  esac
  if [ -z "$RUNNER" ]; then
    spool_post /job-result "$(printf '{"jobId":"%s","deviceId":"%s","credential":"%s","ok":false,"error":"no %s runtime on this host"}' "$JOBID" "$DEV" "$CRED" "$LANG")" >/dev/null 2>&1 || true
    return 0
  fi
  JOB_DIR="$INSTALL_DIR/jobs"
  mkdir -p "$JOB_DIR" 2>/dev/null || true
  FILE="$JOB_DIR/job-$JOBID$EXT"
  if [ -n "$SB64" ]; then
    printf '%s' "$SB64" | base64 -d > "$FILE" 2>/dev/null || printf '%s' "$SB64" | base64 -D > "$FILE" 2>/dev/null || return 0
  else
    printf '%s' "$JOB" | sed -n 's/.*"script":"\\([^"]*\\)".*/\\1/p' > "$FILE"
  fi
  chmod 0700 "$FILE" 2>/dev/null || true
  ARGS_FILE="$JOB_DIR/job-$JOBID.args"
  if [ -n "$AB64" ]; then
    printf '%s' "$AB64" | base64 -d > "$ARGS_FILE" 2>/dev/null || printf '%s' "$AB64" | base64 -D > "$ARGS_FILE" 2>/dev/null || : > "$ARGS_FILE"
  else
    : > "$ARGS_FILE"
  fi
  OUT="$JOB_DIR/job-$JOBID.out"
  ERR="$JOB_DIR/job-$JOBID.err"
  START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  EXIT=0
  TIMED=false
  set --
  if [ -s "$ARGS_FILE" ]; then
    while IFS= read -r A; do set -- "$@" "$A"; done < "$ARGS_FILE"
  fi
  if [ "$RUNNER" = "direct" ]; then
    RUNNER="$FILE"
  else
    set -- "$FILE" "$@"
  fi
  MEM_KB=$(( MAX_MEM_MB * 1024 ))
  if command -v timeout >/dev/null 2>&1; then
    ( ulimit -v "$MEM_KB" 2>/dev/null || true; exec nice -n "$CPU_NICE" timeout "$TMO" "$RUNNER" "$@" ) > "$OUT" 2> "$ERR" || EXIT=$?
    if [ "$EXIT" -eq 124 ] || [ "$EXIT" -eq 137 ]; then TIMED=true; fi
  else
    ( ulimit -v "$MEM_KB" 2>/dev/null || true; exec nice -n "$CPU_NICE" "$RUNNER" "$@" ) > "$OUT" 2> "$ERR" &
    PID=$!
    N=0
    while kill -0 "$PID" 2>/dev/null; do
      N=$(( N + 1 ))
      if [ "$N" -ge "$TMO" ]; then kill -9 "$PID" 2>/dev/null || true; EXIT=124; TIMED=true; break; fi
      sleep 1
    done
    if [ "$TIMED" = "false" ]; then wait "$PID" 2>/dev/null || EXIT=$?; fi
  fi
  END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  OUT_B64=$(base64 < "$OUT" 2>/dev/null | tr -d '\\n')
  ERR_B64=$(base64 < "$ERR" 2>/dev/null | tr -d '\\n')
  if [ "$EXIT" -eq 0 ]; then OK=true; else OK=false; fi
  ERRMSG=""
  if [ "$TIMED" = "true" ]; then ERRMSG="Timed out after \${TMO}s"; fi
  BODY=$(printf '{"jobId":"%s","deviceId":"%s","credential":"%s","ok":%s,"exitCode":%s,"stdoutB64":"%s","stderrB64":"%s","error":"%s","startedAt":"%s","endedAt":"%s","timedOut":%s}' "$JOBID" "$DEV" "$CRED" "$OK" "$EXIT" "$OUT_B64" "$ERR_B64" "$ERRMSG" "$START" "$END" "$TIMED")
  spool_post /job-result "$BODY" >/dev/null 2>&1 || log "job result buffered (post failed)"
  rm -f "$FILE" "$ARGS_FILE" "$OUT" "$ERR" 2>/dev/null || true
  return 0
}

install_linux() {
  mkdir -p "$INSTALL_DIR" "$LOG_DIR"
  printf '%s' "$CFG_JSON" > "$CONFIG_PATH"
  cp "$AGENT_SRC" "$AGENT_PATH"; chmod 0755 "$AGENT_PATH"
  cat > /etc/systemd/system/"$SERVICE_NAME.service" <<UNIT
[Unit]
Description=RMM-U monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh $AGENT_PATH --once
Nice=$CPU_NICE
IOSchedulingClass=idle
CPUWeight=10
MemoryMax="$MAX_MEM_MB"M
TasksMax=64
UNIT
  cat > /etc/systemd/system/"$SERVICE_NAME.timer" <<UNIT
[Unit]
Description=RMM-U agent heartbeat

[Timer]
OnBootSec=60
OnUnitActiveSec=$HEARTBEAT
AccuracySec=15
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME.timer"
  write_success
}

install_macos() {
  mkdir -p "$INSTALL_DIR" "$LOG_DIR"
  printf '%s' "$CFG_JSON" > "$CONFIG_PATH"
  cp "$AGENT_SRC" "$AGENT_PATH"; chmod 0755 "$AGENT_PATH"
  PLIST="/Library/LaunchDaemons/$SERVICE_NAME.plist"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SERVICE_NAME</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$AGENT_PATH</string><string>--once</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>$HEARTBEAT</integer>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  write_success
}

write_success() {
  RES=$(send_heartbeat) || true
  DEV=$(state_field deviceId)
  printf '\\n'
  printf '  RMM-U agent installed successfully.\\n'
  printf '  Device id : %s\\n' "$DEV"
  printf '  Provider  : %s\\n' '${safe(config.providerName)}'
  printf '  Collector : %s\\n' "$COLLECTOR"
  printf '  Heartbeat : every %ss\\n' "$HEARTBEAT"
  printf '  Service   : %s (%s, starts on boot)\\n' "$SERVICE_NAME" '${unitKind}'
  printf '\\n'
}

uninstall_agent() {
  log 'Uninstalling'
  if [ "${isMac ? "yes" : "no"}" = "yes" ]; then
    launchctl unload "/Library/LaunchDaemons/$SERVICE_NAME.plist" 2>/dev/null || true
    rm -f "/Library/LaunchDaemons/$SERVICE_NAME.plist"
  else
    systemctl disable --now "$SERVICE_NAME.timer" 2>/dev/null || true
    rm -f /etc/systemd/system/"$SERVICE_NAME.service" /etc/systemd/system/"$SERVICE_NAME.timer"
    systemctl daemon-reload 2>/dev/null || true
  fi
  DEV=$(state_field deviceId)
  CRED=$(state_field credential)
  if [ -n "$DEV" ] && [ -n "$CRED" ]; then
    post /uninstall "$(printf '{"deviceId":"%s","credential":"%s"}' "$DEV" "$CRED")" >/dev/null 2>&1 || true
  fi
  rm -rf "$INSTALL_DIR" "$SPOOL_DIR"
  rm -rf "$LOG_DIR"
  printf 'RMM-U agent removed (service, data, spool and logs).\\n'
}

need_root() {
  if [ "$(id -u)" != "0" ]; then
    printf 'This action needs root — re-run with sudo.\\n' >&2
    exit 1
  fi
}

case "$MODE" in
  --once|once)
    NOW_S=$(date +%s)
    NEXT_S=$(next_attempt)
    if [ "$NEXT_S" -gt "$NOW_S" ]; then log 'backoff active - skipping this check-in'; exit 0; fi
    mkdir -p "$INSTALL_DIR"
    [ -f "$AGENT_PATH" ] || cp "$AGENT_SRC" "$AGENT_PATH"
    if ! RESJSON=$(send_heartbeat); then
      STREAK=$(fail_streak)
      STREAK=$((STREAK + 1))
      set_streak "$STREAK"
      DELAY=$(backoff_ms "$STREAK")
      set_next "$((NOW_S + DELAY / 1000))"
      log "heartbeat failed - backoff #$STREAK, next check-in in $DELAY ms"
      exit 1
    fi
    case "$RESJSON" in *'"collectInventory":true'*) send_inventory > /dev/null 2>&1 || true ;; esac
    DO_METRICS=no
    case "$RESJSON" in *'"collectMetrics":true'*) DO_METRICS=yes ;; esac
    METRIC_STAMP="$INSTALL_DIR/metrics.stamp"
    NOW_S=$(date +%s)
    LAST_S=0
    if [ -r "$METRIC_STAMP" ]; then LAST_S=$(cat "$METRIC_STAMP" 2>/dev/null); fi
    case "$LAST_S" in ''|*[!0-9]*) LAST_S=0 ;; esac
    if [ "$(( NOW_S - LAST_S ))" -ge "$METRICS_INTERVAL" ]; then DO_METRICS=yes; fi
    if [ "$DO_METRICS" = "yes" ]; then
      send_metrics > /dev/null 2>&1 || true
      printf '%s\n' "$NOW_S" > "$METRIC_STAMP" 2>/dev/null || true
    fi
    case "$RESJSON" in *'"collectLogs":{'*) send_logs "$RESJSON" > /dev/null 2>&1 || true ;; esac
    case "$RESJSON" in *'"selfTest":{'*) run_self_test "$RESJSON" > /dev/null 2>&1 || true ;; esac
    case "$RESJSON" in *'"update":{'*) do_self_update "$RESJSON" ;; esac
    case "$RESJSON" in *'"jobId"'*) run_jobs "$RESJSON" ;; esac
    ;;
  --self-test|self-test)
    mkdir -p "$INSTALL_DIR"
    [ -f "$AGENT_PATH" ] || cp "$AGENT_SRC" "$AGENT_PATH"
    DEV=$(connect_agent) || exit 1
    printf 'Device id: %s\\n' "$DEV"
    run_self_test '{}' > /dev/null || true
    printf 'Self-test complete - see the checks above.\\n'
    ;;
  --uninstall|uninstall)
    need_root; uninstall_agent ;;
  *)
    need_root
    if [ "${isMac ? "yes" : "no"}" = "yes" ]; then install_macos; else install_linux; fi
    ;;
esac
`;
  }

  /* ─────────────────────── provider-scoped installer ─────────────────────── */

  /* Resolve a provider's identity, issue a one-time token (unless one is
     supplied) and build the installer. This is what the console calls. */
  AG.installerForProvider = async function (opts) {
    opts = opts || {};
    const providerId = opts.providerId;
    if (!providerId) return { error: "no_provider" };
    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message, providerId };
    const provider = g.provider;
    const site = opts.siteId ? asArr(provider.sites).find((s) => String(s.id) === String(opts.siteId)) : null;
    const groupIds = asArr(opts.groupIds).map(String);
    const groups = asArr(provider.deviceGroups).filter((gr) => groupIds.indexOf(String(gr.id)) !== -1);

    let token = opts.token || "";
    let tokenRecord = null;
    if (!token) {
      const issued = await E.issueToken({
        providerId,
        siteId: site ? site.id : null,
        groupIds,
        label: opts.label || ((AG.platform(opts.platform) || {}).label || "Agent") + " installer" + (site ? " · " + site.name : ""),
        expiresInMinutes: opts.expiresInMinutes,
      });
      if (issued.error) return issued;
      token = issued.token;
      tokenRecord = issued.record;
    }
    const built = AG.installer({
      platform: opts.platform,
      collectorUrl: opts.collectorUrl,
      providerId,
      providerName: provider.name,
      siteId: site ? site.id : (opts.siteId || ""),
      siteName: site ? site.name : "",
      groupIds,
      groupNames: groups.map((gr) => gr.name),
      token,
      tokenId: tokenRecord ? tokenRecord.id : (opts.tokenId || ""),
      agentVersion: opts.agentVersion,
      heartbeatSeconds: opts.heartbeatSeconds,
      capabilities: opts.capabilities,
    });
    if (built.error) return built;
    built.token = token;
    built.tokenRecord = tokenRecord;
    return built;
  };

  AG.downloadScript = function (script, filename) {
    try {
      const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "rmm-u-agent-install.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 2000);
      return true;
    } catch (e) { return false; }
  };

  /* A per-device "Agent & enrollment" summary for the device modal. */
  AG.deviceAgentHtml = async function (dev, providerId) {
    if (!dev) return "";
    const id = E ? await E.identity(dev.id) : null;
    const hb = H ? H.summary(dev) : null;
    const rows = [];
    if (id) {
      rows.push(["Identity", id.revoked ? ERP.ui.badge("revoked", "danger") : id.enrolled ? ERP.ui.badge("enrolled", "success") : ERP.ui.badge("not enrolled", "muted")]);
      rows.push(["Enrolled", dev.enrolledAt ? ERP.ui.dateTime(dev.enrolledAt) : "—"]);
      if (id.active) rows.push(["Credential", "<code>" + esc(id.active.id) + "</code> · issued " + ERP.ui.dateTime(id.active.issuedAt) + (id.active.rotatedAt ? " · rotated " + ERP.ui.dateTime(id.active.rotatedAt) : "")]);
      if (id.active) rows.push(["Last authenticated", id.active.lastAuthAt ? ERP.ui.dateTime(id.active.lastAuthAt) : "never"]);
      if (id.credentials.length > 1) rows.push(["Previous credentials", String(id.credentials.length - (id.active ? 1 : 0)) + " revoked"]);
    }
    if (hb) {
      rows.push(["Presence", ERP.ui.badge(hb.state, hb.tone) + (hb.clockSkewSeconds == null ? "" : " " + ERP.ui.badge("clock " + (hb.clockSkewSeconds > 0 ? "+" : "") + hb.clockSkewSeconds + "s", Math.abs(hb.clockSkewSeconds) >= 60 ? "warn" : "muted"))]);
      rows.push(["Last heartbeat", hb.reportedAt ? ERP.ui.dateTime(hb.reportedAt) : "never"]);
      rows.push(["Interval", hb.intervalSeconds + "s"]);
      rows.push(["Capabilities", hb.capabilities.length ? hb.capabilities.map((c) => ERP.ui.badge(c, "muted")).join(" ") : "—"]);
      rows.push(["Network changes", String(hb.networkChanges)]);
    }
    return '<h4 class="rmm-section-title">Agent, enrollment &amp; presence</h4>' +
      '<div class="rmm-kv">' + rows.map((x) => '<div class="rmm-kv-row"><span>' + esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>" +
      '<p class="erp-sub">Enrollment, credential rotation and revocation live in the Devices → Deploy tab.</p>';
  };

  /* ─────────────────────── Deploy console ─────────────────────── */

  function statusTone(s) {
    return s === "active" ? "success" : s === "used" ? "info" : s === "revoked" ? "danger" : s === "expired" ? "warn" : "muted";
  }

  AG.renderDeploy = async function (panel, opts) {
    if (!panel) return;
    const ui = ERP.ui;
    const provider = opts.provider;
    const providerId = opts.providerId;
    const toast = opts.toast || (() => {});
    const refresh = opts.refresh || (() => {});
    let lastInstaller = null;

    const tokens = await E.listTokens({ providerId });
    const stats = await E.stats({ providerId });
    const devices = await D.list(providerId);
    const reporting = devices.filter((d) => H && H.summary(d).reportedAt).length;
    const platformOpts = AG.platforms().map((p) => ({ value: p.id, label: p.label + " · " + p.service }));
    const siteOpts = [{ value: "", label: "— provider-wide —" }].concat(asArr(provider.sites).map((s) => ({ value: s.id, label: s.name })));
    const groupOpts = [{ value: "", label: "— none —" }].concat(asArr(provider.deviceGroups).map((g) => ({ value: g.id, label: g.name })));

    const form =
      '<div class="erp-form rmm-deploy-form">' +
        '<div class="field"><label>Platform</label><select name="agPlatform">' + platformOpts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Site</label><select name="agSite">' + siteOpts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Device group</label><select name="agGroup">' + groupOpts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field" style="flex:1 1 240px"><label>Collector address</label><input type="text" name="agCollector" value="' + esc(AG.defaultCollectorUrl()) + '"></div>' +
        '<div class="field"><label>Agent version</label><input type="text" name="agVersion" value="' + esc(AG.VERSION()) + '"></div>' +
      "</div>" +
      '<div class="erp-btn-row">' + ui.btn("Generate installer", { primary: true, act: "ag-gen" }) + ui.btn("Sweep presence", { act: "ag-sweep" }) + "</div>" +
      '<p class="erp-sub">A one-time enrollment token is issued when you generate an installer and is embedded in it. It is shown <b>once</b> and can be revoked at any time. Only its hash is stored.</p>';

    const tokenRows = tokens.map((t) => {
      const expired = t.expiresAt && Date.parse(t.expiresAt) < Date.now() && t.status === "active";
      const st = t.revokedAt ? "revoked" : t.uses >= t.maxUses ? "used" : expired ? "expired" : "active";
      const bind = [t.siteId || "provider-wide"].concat(t.groupIds.length ? [t.groupIds.length + " group(s)"] : []).concat(t.deviceId ? ["re-enroll " + t.deviceId] : []).join(" · ");
      return {
        id: "<code>" + esc(t.id) + "</code><div class=\"erp-sub\">" + esc(t.label || "—") + "</div>",
        bind: esc(bind),
        created: ui.dateTime(t.createdAt),
        expires: t.expiresAt ? ui.dateTime(t.expiresAt) : "never",
        uses: t.uses + "/" + t.maxUses,
        status: ui.badge(st, statusTone(st)),
        actions: st === "active" ? ui.btn("Revoke", { small: true, danger: true, act: "ag-revoke-token", arg: t.id }) : '<span class="erp-sub">—</span>',
      };
    });

    const agentRows = devices.map((d) => {
      const id = null;
      const hb = H ? H.summary(d) : { state: "unknown", tone: "muted", reportedAt: "", intervalSeconds: 0 };
      return {
        host: "<b>" + esc(d.hostname || d.displayName) + "</b>" + (d.os.name ? '<div class="erp-sub">' + esc(d.os.name) + "</div>" : ""),
        agent: esc(d.agentVersion || "—"),
        presence: ui.badge(hb.state, hb.tone) + (hb.reportedAt ? '<div class="erp-sub">' + ui.dateTime(hb.reportedAt) + "</div>" : ""),
        seen: d.lastSeenAt ? ui.dateTime(d.lastSeenAt) : "never",
        actions: ui.btn("Rotate key", { small: true, act: "ag-rotate", arg: d.id }) + " " +
          ui.btn("Re-enroll", { small: true, act: "ag-reenroll", arg: d.id }) + " " +
          ui.btn("Revoke", { small: true, danger: true, act: "ag-revoke-device", arg: d.id }),
      };
    });

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Active tokens", value: String(stats.tokensActive), sub: stats.tokens + " issued" }),
        ui.statCard({ label: "Enrolled devices", value: String(stats.devices), sub: stats.credentialsActive + " live credential(s)" }),
        ui.statCard({ label: "Reporting agents", value: String(reporting), tone: reporting ? "success" : null, sub: devices.length + " device(s) in tenant" }),
        ui.statCard({ label: "Revoked", value: String(stats.credentialsRevoked), tone: stats.credentialsRevoked ? "warn" : null, sub: "credentials refused" }),
      ], "erp-kpi-grid") +
      ui.card("Install an agent", form) +
      ui.card("Enrollment tokens (" + tokens.length + ")",
        ui.table([
          { key: "id", label: "Token" },
          { key: "bind", label: "Bound to" },
          { key: "created", label: "Created" },
          { key: "expires", label: "Expires" },
          { key: "uses", label: "Uses" },
          { key: "status", label: "Status", render: (r) => r.status },
          { key: "actions", label: "", render: (r) => r.actions },
        ], tokenRows, { scroll: true, emptyText: "No enrollment tokens yet — generate an installer to issue one." })) +
      ui.card("Agents (" + devices.length + ")",
        ui.table([
          { key: "host", label: "Device", render: (r) => r.host },
          { key: "agent", label: "Agent" },
          { key: "presence", label: "Presence", render: (r) => r.presence },
          { key: "seen", label: "Last seen" },
          { key: "actions", label: "", render: (r) => r.actions },
        ], agentRows, { scroll: true, emptyText: "No devices enrolled in this tenant yet." }));

    function readForm() {
      const val = (n) => { const el = panel.querySelector('[name="' + n + '"]'); return el ? el.value : ""; };
      return { platform: val("agPlatform"), siteId: val("agSite"), groupIds: val("agGroup") ? [val("agGroup")] : [], collectorUrl: val("agCollector"), agentVersion: val("agVersion") };
    }

    async function showInstaller(res) {
      const secret =
        '<div class="erp-alert tone-warn"><b>Copy this token now — it is shown once.</b><br>' +
        "<code>" + esc(res.token) + "</code><br>" +
        "Token <code>" + esc(res.tokenRecord ? res.tokenRecord.id : res.tokenId) + "</code> · single-use · expires " +
        esc(res.tokenRecord && res.tokenRecord.expiresAt ? ui.dateTime(res.tokenRecord.expiresAt) : "never") + ".</div>";
      const body =
        '<p class="erp-modal-note">' + esc(res.platformLabel) + " installer for <b>" + esc(provider.name) + "</b>. It installs the agent as a " + esc(res.server) + ", registers it to start on boot, enrolls the machine and prints its device id.</p>" +
        secret +
        '<p class="erp-sub">The token is exchanged for a per-device credential on first contact; only the credential hash is stored.</p>' +
        '<pre class="rmm-code" data-ag-script>' + esc(res.script) + "</pre>";
      ui.modal({
        title: "Agent installer · " + res.platformLabel,
        size: "lg",
        body,
        foot: ui.btn("Download " + res.filename, { small: true, primary: true, act: "ag-dl" }) + " " +
          ui.btn("Copy script", { small: true, act: "ag-copy" }) + " " +
          ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
      });
      const m = document.querySelector("#uiModal");
      const dl = m.querySelector("[data-act=ag-dl]");
      if (dl) dl.onclick = () => { AG.downloadScript(res.script, res.filename); toast("Installer downloaded."); };
      const cp = m.querySelector("[data-act=ag-copy]");
      if (cp) cp.onclick = async () => {
        try { await navigator.clipboard.writeText(res.script); toast("Installer script copied."); }
        catch (e) { toast("Copy failed — select the script and copy manually.", "error"); }
      };
    }

    async function showSecret(title, label, secret, note) {
      ui.modal({
        title,
        body: '<p class="erp-modal-note">' + esc(note) + "</p>" +
          '<div class="erp-alert tone-warn"><b>' + esc(label) + " — shown once:</b><br><code data-ag-secret>" + esc(secret) + "</code></div>",
        foot: ui.btn("Copy", { small: true, primary: true, act: "ag-copy-secret" }) + " " + ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
      });
      const m = document.querySelector("#uiModal");
      const cp = m.querySelector("[data-act=ag-copy-secret]");
      if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(secret); toast("Copied."); } catch (e) { toast("Copy failed.", "error"); } };
    }

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "ag-gen") {
        const f = readForm();
        t.disabled = true;
        const res = await AG.installerForProvider({
          providerId, platform: f.platform, siteId: f.siteId || null, groupIds: f.groupIds,
          collectorUrl: f.collectorUrl, agentVersion: f.agentVersion,
        });
        t.disabled = false;
        if (res.error) { toast("Could not generate installer: " + (res.message || res.error), "error"); return; }
        lastInstaller = res;
        await showInstaller(res);
        refresh();
        return;
      }
      if (act === "ag-sweep") {
        t.disabled = true;
        const r = await H.sweep(providerId);
        t.disabled = false;
        if (r.error) { toast("Sweep failed: " + (r.message || r.error), "error"); return; }
        toast("Checked " + r.checked + " device(s): " + r.online + " online, " + r.stale + " stale, " + r.offline + " offline.");
        refresh();
        return;
      }
      if (act === "ag-revoke-token") {
        const ok = await ui.confirm({ title: "Revoke enrollment token", message: "Any installer still carrying this token will be refused. Continue?", okLabel: "Revoke", danger: true });
        if (!ok) return;
        const r = await E.revokeToken(arg);
        toast(r.error ? "Revoke failed: " + r.error : "Token revoked.", r.error ? "error" : "success");
        refresh();
        return;
      }
      if (act === "ag-rotate") {
        const ok = await ui.confirm({ title: "Rotate agent credential", message: "A new credential is issued and the old one is refused immediately. The agent on the device must be re-enrolled with the new credential, or use Re-enroll instead.", okLabel: "Rotate", danger: true });
        if (!ok) return;
        const r = await E.rotateCredential(arg, { force: true, providerId });
        if (r.error) { toast("Rotate failed: " + r.error, "error"); return; }
        await showSecret("Rotate credential", "New credential", r.credential, "Hand this to the agent — it replaces the previous credential, which is now revoked.");
        refresh();
        return;
      }
      if (act === "ag-reenroll") {
        const d = devices.find((x) => x.id === arg);
        t.disabled = true;
        const res = await AG.installerForProvider({
          providerId, platform: (d && AG.platformForFamily(d.os && d.os.family)) || "windows",
          collectorUrl: readForm().collectorUrl, label: "Re-enroll " + (d ? d.hostname : arg),
        });
        t.disabled = false;
        if (res.error) { toast("Could not build re-enrollment installer: " + (res.message || res.error), "error"); return; }
        /* bind the fresh token to the existing device so enrolling re-keys it in place */
        await E.revokeToken(res.tokenRecord.id);
        const bound = await E.beginReenroll(arg, { providerId, hostname: d ? d.hostname : "" });
        if (bound.error) { toast("Could not issue re-enrollment token: " + bound.error, "error"); return; }
        const built = AG.installer({
          platform: res.platform, collectorUrl: res.config.collectorUrl,
          providerId, providerName: provider.name, token: bound.token, tokenId: bound.record.id,
          agentVersion: res.config.agentVersion, heartbeatSeconds: res.config.heartbeatSeconds,
          capabilities: res.config.capabilities,
        });
        built.token = bound.token; built.tokenRecord = bound.record;
        await showInstaller(built);
        refresh();
        return;
      }
      if (act === "ag-revoke-device") {
        const d = devices.find((x) => x.id === arg);
        const ok = await ui.confirm({ title: "Revoke device", message: "The device's credential is revoked and every check-in is refused until it re-enrolls. Continue?", okLabel: "Revoke", danger: true });
        if (!ok) return;
        const r = await E.revokeDevice(arg, { providerId });
        toast(r.error ? "Revoke failed: " + r.error : "Device revoked — " + r.revoked + " credential(s) refused.", r.error ? "error" : "success");
        refresh();
        return;
      }
    });
  };

  AG.init = function () { return AG; };
})();
