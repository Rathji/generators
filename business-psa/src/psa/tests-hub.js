import hub, { PERMS, can } from "./hub.js";
import store from "./store.js";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await wait(40);
  }
  return null;
}

const EXPECTED_ACTIONS = [
  "timesheet.submit", "expense.submit", "edit.timesheets", "edit.expenses",
  "edit.clients", "edit.projects", "edit.resources", "edit.catalog",
  "edit.sows", "edit.workplans", "edit.templates", "edit.allocations",
  "edit.scopechanges", "edit.opportunities", "edit.billing", "edit.reports",
  "edit.ratecards",
  "timesheet.approve", "timesheet.reject", "timesheet.return",
  "sow.approve", "invoice.create", "invoice.mark_sent",
  "invoice.record_payment", "invoice.void", "creditnote.issue",
  "audit.view", "pipeline.publish", "backup.download", "backup.publish",
  "ratecard.edit", "project.close", "backup.restore", "archive.manage",
  "setrole",
];

function openSocket() {
  return new Promise((res, rej) => {
    const sock = window.root.createServerSocket();
    sock.binaryType = "arraybuffer";
    sock.onopen = () => res(sock);
    sock.onerror = () => rej(new Error("socket open failed"));
    setTimeout(() => rej(new Error("socket open timeout")), 6000);
  });
}

export async function runHubTests() {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail: ok ? "" : detail });

  check("PERMS covers every gated action used by the app", EXPECTED_ACTIONS.every((a) => PERMS[a]), "missing: " + JSON.stringify(EXPECTED_ACTIONS.filter((a) => !PERMS[a])));
  check("consultant can submit but not approve", can("timesheet.submit", "consultant") && can("expense.submit", "consultant") && !can("timesheet.approve", "consultant") && !can("invoice.create", "consultant"));
  check("manager can approve, bill and publish, but not close projects", can("timesheet.approve", "manager") && can("sow.approve", "manager") && can("invoice.create", "manager") && can("invoice.void", "manager") && can("creditnote.issue", "manager") && can("pipeline.publish", "manager") && can("backup.download", "manager") && !can("project.close", "manager") && !can("ratecard.edit", "manager") && !can("edit.ratecards", "manager"));
  check("admin can do everything", EXPECTED_ACTIONS.every((a) => can(a, "admin")));
  check("no role cannot do gated actions", EXPECTED_ACTIONS.every((a) => !can(a, null) && !can(a, "")));
  check("unlisted actions are permissive", can("anything.unlisted", "consultant") && can("anything.unlisted", null));

  const st0 = hub.getState();
  check("state exposes status/me/roster/online/feed/audit/mode", ["status", "me", "roster", "online", "recentEvents", "audit", "mode"].every((k) => k in st0));

  const wasConnected = st0.status === "connected";
  const origName = (st0.me && st0.me.name) || null;
  if (wasConnected) hub.disconnect();
  await wait(120);

  const offlineAuth = await hub.authorize("ratecard.edit", "offline test");
  check("offline authorize is permissive local single-user mode", offlineAuth.ok === true && offlineAuth.local === true, JSON.stringify(offlineAuth));

  // ---- server-side role enforcement via a dedicated socket (fresh consultant) ----
  let sock = null;
  try {
    sock = await openSocket();
  } catch (e) {
    check("hub socket connects", false, String(e));
  }

  if (sock) {
    const name = "hubtest-" + Math.random().toString(36).slice(2, 8);
    const jr = JSON.parse(await sock.rpc.join(JSON.stringify({ name, role: "consultant", proof: "" })));
    check("join a fresh consultant works", jr.ok === true && jr.role === "consultant", JSON.stringify(jr));

    const pres = JSON.parse(await sock.rpc.presence(""));
    check("presence lists the fresh user as online", pres.ok === true && Array.isArray(pres.online) && pres.online.includes(name), JSON.stringify(pres));

    const deny = JSON.parse(await sock.rpc.act(JSON.stringify({ action: "ratecard.edit", detail: "deny test" })));
    check("fresh consultant denied admin-only actions by the server", deny.ok === false && /cannot ratecard\.edit/.test(deny.reason), JSON.stringify(deny));
    const denyEdit = JSON.parse(await sock.rpc.act(JSON.stringify({ action: "edit.ratecards", detail: "deny test" })));
    check("fresh consultant denied editing rate cards", denyEdit.ok === false && /cannot edit\.ratecards/.test(denyEdit.reason), JSON.stringify(denyEdit));
    const allow = JSON.parse(await sock.rpc.act(JSON.stringify({ action: "timesheet.submit", detail: "allow test" })));
    check("fresh consultant allowed submit actions", allow.ok === true, JSON.stringify(allow));
    const denyRole = JSON.parse(await sock.rpc.act(JSON.stringify({ action: "setrole", detail: "deny test" })));
    check("consultant cannot set roles", denyRole.ok === false, JSON.stringify(denyRole));

    const badClaim = JSON.parse(await sock.rpc.claimAdmin("definitely-wrong-password"));
    check("claim admin with wrong password is rejected", badClaim.ok === false, JSON.stringify(badClaim));
    const badSet = JSON.parse(await sock.rpc.setRole(JSON.stringify({ name, role: "admin" })));
    check("consultant cannot promote themselves via setRole", badSet.ok === false, JSON.stringify(badSet));

    const unknown = JSON.parse(await sock.rpc.act(JSON.stringify({ action: "nonsense.action", detail: "" })));
    check("unknown actions are rejected by the server (not silently allowed)", unknown.ok === false, JSON.stringify(unknown));

    try { sock.close(); } catch (e) {}
    sock = null;
  }

  const before = store.getAllRecords("audit").length;
  const audited = await hub.recordAudit("timesheet.submit", "hub test audit entry", "hubtest");
  const after = store.getAllRecords("audit").length;
  check("recordAudit writes a local audit entry", audited === true && after > before, "local audit before/after: " + before + "/" + after);

  hub.publishChange("projects", "test-id-123", "put");
  check("publishChange never throws (offline it no-ops)", true);

  if (wasConnected && origName) {
    hub.connect(origName);
  }

  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
