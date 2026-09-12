// src/framework/cutover.js — cutover checklists & the VoIP cutover generator
// (roadmap Phase 9, task 38).
//
// Task 37 generates the RUNBOOK — the written build a technician follows. Task
// 38 generates the CUTOVER CHECKLIST that drives and proves the switch: the
// pre-deployment preparation, the cutover itself, and the post-cutover
// verification, including the number-port, test-call, voicemail, recording,
// failover, emergency-call, monitoring and rollback checks the roadmap calls
// for, plus a recorded client ACCEPTANCE / sign-off.
//
// A cutover checklist is an ordinary checklist record (./checklist.js shape)
// whose steps carry a `phase` id and, where they prove a required verification,
// a `check` id. The record carries a `phases` list and a `signOff` object. This
// module is the single source of truth for the phase vocabulary, the shipped
// VoIP cutover template, the generator, the per-phase progress roll-up, the
// coverage audit and the acceptance record; ./standardized.js folds
// cutoverIssues() into the linter and ./docsets.js exposes addChecklist() /
// signOffChecklist().
//
// Step shape (checklist.js, extended):
//   { id, text, phase, check, hint, done, assignee, dueDate, notes,
//     doneAt, doneBy, createdAt }
// Sign-off shape:
//   { decision, acceptedBy, acceptedAt, preparedBy, notes, decidedAt }

import { newId } from "./ids.js";
import { checklistItems, checklistProgress } from "./checklist.js";
import { voicePlatformLabel, portingStatusLabel, isPortComplete, isEmergencyConfigured } from "./voice.js";
import { StoreError, CODES } from "./store/errors.js";

const str = (v) => String(v == null ? "" : v).trim();

// ---- phases ----------------------------------------------------------------
// The three acts of any cutover. `description` explains what belongs in each.
export const CUTOVER_PHASES = [
  { id: "pre", label: "Pre-deployment", short: "Pre", description: "Everything staged and confirmed before the switch window opens." },
  { id: "cutover", label: "Cutover", short: "Live", description: "The switch itself — ports, call routing and emergency calling verified live." },
  { id: "post", label: "Post-cutover", short: "Post", description: "Continuity checks, failover and monitoring, then the client's acceptance." },
];

export const CUTOVER_PHASE_IDS = CUTOVER_PHASES.map((p) => p.id);
export const cutoverPhase = (id) => CUTOVER_PHASES.find((p) => p.id === id) || null;
export const cutoverPhaseLabel = (id) => (cutoverPhase(id) || {}).label || "Unphased";
export const cutoverPhaseOptions = () => CUTOVER_PHASES.map((p) => ({ id: p.id, label: p.label }));

// ---- required verifications ------------------------------------------------
// The checks task 38 names explicitly. A generated checklist is "covered" when
// a step carrying each of these `check` ids is present, so coverage survives
// reordering and survives a user renaming a step.
export const CUTOVER_CHECKS = [
  { id: "number-port", label: "Number port verification", phase: "cutover" },
  { id: "inbound-calls", label: "Inbound test calls", phase: "cutover" },
  { id: "outbound-calls", label: "Outbound test calls", phase: "cutover" },
  { id: "emergency-calls", label: "Emergency-call test", phase: "cutover" },
  { id: "voicemail", label: "Voicemail", phase: "post" },
  { id: "call-recording", label: "Call recording", phase: "post" },
  { id: "failover", label: "Failover test", phase: "post" },
  { id: "monitoring", label: "Monitoring & alerts", phase: "post" },
  { id: "rollback", label: "Rollback steps", phase: "pre" },
];

export const CUTOVER_CHECK_IDS = CUTOVER_CHECKS.map((c) => c.id);
export const cutoverCheck = (id) => CUTOVER_CHECKS.find((c) => c.id === id) || null;
export const cutoverCheckLabel = (id) => (cutoverCheck(id) || {}).label || "";

// ---- the shipped VoIP cutover template -------------------------------------
// One entry per step. `check` tags the step that PROVES a required
// verification; `hint` is shown under the step in the editor so a technician
// knows what "verified" means.
export const VOIP_CUTOVER_TEMPLATE = [
  // pre-deployment
  { phase: "pre", check: "rollback", text: "Agree and document the rollback plan — restore criteria, who decides, and how to revert to the previous carrier/PBX", hint: "Name the decision-maker and the exact command/route back to the old service." },
  { phase: "pre", text: "Capture the current configuration and call flow as the pre-cutover baseline to roll back to", hint: "Export dial plan, numbers, trunk config and a working-config snapshot." },
  { phase: "pre", text: "Confirm the number-port window with the losing carrier and notify the client of the switch and any brief outage risk", hint: "Record the agreed window and any restrictions (e.g. must port mid-week, business hours)." },
  { phase: "pre", text: "Confirm every SIP trunk is provisioned, registered and passing test calls into the new platform", hint: "Test each trunk individually before the live numbers point at it." },
  { phase: "pre", text: "Confirm emergency calling (E911) is registered and the dispatchable location is validated for every site", hint: "Provider-side address validation; without it emergency calls route to the wrong PSAP." },
  { phase: "pre", text: "Confirm the firewall/SBC path, SIP ALG settings and QoS markings are in place and documented", hint: "The runbook's firewall/NAT section is the reference; keep it in step." },
  { phase: "pre", text: "Stage and pre-configure handsets/softphones and confirm they register to the new platform", hint: "Batch-provision where possible; confirm firmware and emergency location per handset." },
  { phase: "pre", text: "Verify per-site network readiness (VLAN, PoE, bandwidth, latency/jitter) and record the results", hint: "Bandwidth per concurrent call plus headroom; jitter and loss within the platform's limits." },
  { phase: "pre", text: "Book the cutover window and assign an owner to every phase of the checklist", hint: "At least one person on-site or on-call for the window; one escalation contact." },

  // cutover
  { phase: "cutover", check: "number-port", text: "Verify each ported number is now served by the new platform (port status complete) and remove it from the losing carrier", hint: "Check the port status per number; do not cancel the old service until every number is confirmed." },
  { phase: "cutover", check: "inbound-calls", text: "Place inbound test calls to a ported DID, a new DID and the main number; confirm correct routing and IVR", hint: "Test from an external mobile, not just internally, and confirm caller-to-destination mapping." },
  { phase: "cutover", check: "outbound-calls", text: "Place outbound test calls to mobile, landline and long-distance; confirm caller ID presents correctly", hint: "Confirm the presented number is one the client owns and is not marked spam." },
  { phase: "cutover", check: "emergency-calls", text: "Place a test emergency call (per the provider's test procedure) and confirm PSAP routing and the dispatchable location", hint: "Use the provider's test number where offered; never leave a test call unverified." },
  { phase: "cutover", text: "Confirm the dial plan, extensions and ring groups behave as designed (transfer, hold, park, hunt groups)", hint: "Walk the call flows the client actually uses, not just the happy path." },
  { phase: "cutover", text: "Cut over the main number and retire the old call path once live calls are confirmed", hint: "Keep the old path warm until the first live calls succeed." },

  // post-cutover
  { phase: "post", check: "voicemail", text: "Confirm voicemail answers for every mailbox and delivers voicemail-to-email / message-waiting as expected", hint: "Send a real message and confirm it reaches the right inbox and notification." },
  { phase: "post", check: "call-recording", text: "Confirm call recording starts, labels, stores and is retrievable for the required users and queues", hint: "Check retention and access permissions, not just that a file appears." },
  { phase: "post", check: "failover", text: "Run a failover test (trunk / PBX / power) and confirm calls survive as designed, then restore", hint: "Test one failure mode at a time and record the observed behaviour." },
  { phase: "post", check: "monitoring", text: "Confirm monitoring and alerts fire for trunk-down, registration loss and call-quality thresholds", hint: "Trigger one alert on purpose and confirm it reaches the on-call path." },
  { phase: "post", text: "Confirm call-quality (MOS/latency/jitter/loss) and CDR/reporting export to the client's systems", hint: "Review a representative sample of live calls, not just test calls." },
  { phase: "post", text: "Hand over to the client — train users, publish the quick-reference guide and the support path", hint: "Leave the client with how to raise an issue and who to call." },
  { phase: "post", text: "Record the client's acceptance / sign-off and archive the pre-cutover baseline", hint: "Capture who accepted, with any caveats, and close the deployment." },
];

// Build one step from a template entry (or a bare text), preserving the
// phase/check/hint fields that make a cutover checklist auditable.
function makeCutoverStep(def, now, assignee = "") {
  const text = str(def && def.text);
  return {
    id: newId("step"),
    text,
    phase: cutoverPhase(def && def.phase) ? def.phase : (def && def.phase) || "",
    check: cutoverCheck(def && def.check) ? def.check : "",
    hint: str(def && def.hint),
    done: false,
    assignee: str(def && def.assignee != null ? def.assignee : assignee),
    dueDate: "",
    notes: "",
    doneAt: null,
    doneBy: "",
    createdAt: now,
  };
}

export const isCutoverChecklist = (record) =>
  !!(record &&
    ((Array.isArray(record.phases) && record.phases.length) ||
      checklistItems(record).some((i) => i && (i.check || i.phase))));

// ---- generate a VoIP cutover checklist -------------------------------------
// Reads the Voice/PBX asset's fields for the facts (platform, porting,
// emergency) so the checklist can warn about gaps, and returns a checklist
// record input ready for docs.addChecklist(). `service`/`site` records carry
// the auto-links.
export function generateVoipCutoverChecklist({ voice, set, site, assignee, preparedBy, title, now = Date.now() } = {}) {
  if (!voice || voice.type !== "flexibleAssets") {
    throw new StoreError(CODES.INVALID_DATA, "A VoIP cutover checklist needs a Voice/PBX asset to generate from.");
  }
  const fields = voice.assetFields && typeof voice.assetFields === "object" && !Array.isArray(voice.assetFields) ? voice.assetFields : {};
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });

  const platform = voicePlatformLabel(fields.platformType);
  const siteName = site && site.name;
  const items = VOIP_CUTOVER_TEMPLATE.map((def) => makeCutoverStep(def, now, assignee));

  if (!isEmergencyConfigured(fields.emergencyService) && fields.e911 !== true) {
    warn("missing-emergency", "No emergency-calling configuration is recorded — the emergency-call test cannot be verified until it is.");
  }
  if (fields.portingStatus && !isPortComplete(fields.portingStatus)) {
    warn("porting-incomplete", `Number porting is “${portingStatusLabel(fields.portingStatus)}” — do not cancel the old service until every number is confirmed ported.`);
  }
  if (!siteName) warn("no-site", "No site was chosen — the per-site readiness and emergency-location steps name no location.");

  const nameBase = (voice.name || "VoIP") + " — cutover checklist";
  const name = str(title) || nameBase;
  const description =
    `Pre-deployment, cutover and post-cutover checklist for the ${platform || "voice"} deployment` +
    (siteName ? ` at ${siteName}` : "") +
    ". Tick each step as it completes; record the client's acceptance when done.";

  const coverage = voipCutoverCoverage({ items });
  return {
    name,
    description,
    defaultAssignee: str(assignee),
    phases: CUTOVER_PHASES.map((p) => ({ id: p.id, label: p.label })),
    items,
    signOff: makeCutoverSignOff({ preparedBy }, now),
    service: { type: "flexibleAssets", id: voice.id },
    site: site ? { type: "locations", id: site.id } : null,
    generatedAt: now,
    warnings,
    coverage,
  };
}

// ---- coverage --------------------------------------------------------------
// Which required verifications a cutover checklist actually contains.
export function voipCutoverCoverage(record) {
  const items = checklistItems(record);
  const present = new Set(items.map((i) => i && i.check).filter(Boolean));
  const byCheck = {};
  for (const c of CUTOVER_CHECKS) byCheck[c.id] = present.has(c.id);
  const missing = CUTOVER_CHECKS.filter((c) => !byCheck[c.id]).map((c) => c.id);
  const count = CUTOVER_CHECKS.length - missing.length;
  return {
    total: CUTOVER_CHECKS.length,
    present: count,
    missing,
    complete: missing.length === 0,
    percent: Math.round((count / CUTOVER_CHECKS.length) * 100),
    byCheck,
  };
}

// Progress rolled up per phase (plus an `other` bucket for unphased steps).
export function cutoverPhaseProgress(record) {
  const items = checklistItems(record);
  const out = {};
  const claimed = new Set();
  for (const p of CUTOVER_PHASES) {
    const sub = items.filter((i) => i && i.phase === p.id);
    sub.forEach((i) => claimed.add(i.id));
    out[p.id] = { id: p.id, label: p.label, ...checklistProgress(sub) };
  }
  const extras = items.filter((i) => i && !claimed.has(i.id));
  if (extras.length) out.other = { id: "other", label: "Other", ...checklistProgress(extras) };
  return out;
}

// ---- acceptance / sign-off -------------------------------------------------
export const CUTOVER_DECISIONS = [
  { id: "pending", label: "Pending", tone: "muted" },
  { id: "accepted", label: "Accepted", tone: "ok" },
  { id: "accepted-with-issues", label: "Accepted with issues", tone: "warn" },
  { id: "rejected", label: "Rejected", tone: "danger" },
];

export const cutoverDecision = (id) => CUTOVER_DECISIONS.find((d) => d.id === id) || null;
export const cutoverDecisionLabel = (id) => (cutoverDecision(id) || {}).label || "";
export const cutoverDecisionOptions = () => CUTOVER_DECISIONS.map((d) => ({ id: d.id, label: d.label }));

export function makeCutoverSignOff(input = {}, now = Date.now()) {
  const decision = cutoverDecision(input.decision) ? input.decision : "pending";
  const resolved = decision !== "pending";
  return {
    decision,
    acceptedBy: str(input.acceptedBy),
    acceptedAt: resolved ? input.acceptedAt || now : null,
    preparedBy: str(input.preparedBy),
    notes: str(input.notes),
    decidedAt: resolved ? input.decidedAt || now : null,
  };
}

export function validateCutoverSignOff(signOff) {
  const errors = [];
  if (!signOff || typeof signOff !== "object") return { ok: false, errors: ["A sign-off record is required."] };
  if (!cutoverDecision(signOff.decision)) errors.push(`Unknown acceptance decision “${signOff.decision}”.`);
  if (signOff.decision && signOff.decision !== "pending" && !str(signOff.acceptedBy)) {
    errors.push("Recording an acceptance needs the name of who accepted it.");
  }
  return { ok: errors.length === 0, errors };
}

export function cutoverSignOff(record) {
  return (record && record.signOff) || null;
}

// The human line shown in lists/chips.
export function cutoverAcceptanceLine(record) {
  const s = cutoverSignOff(record);
  if (!s || !s.decision || s.decision === "pending") return "Awaiting acceptance";
  const d = cutoverDecisionLabel(s.decision);
  return s.acceptedBy ? `${d} by ${s.acceptedBy}` : d;
}

// The tone a decision chip should use.
export function cutoverAcceptanceTone(record) {
  const s = cutoverSignOff(record);
  const d = s && cutoverDecision(s.decision);
  return (d && d.tone) || "muted";
}

// ---- integrity audit (folded into the linter) ------------------------------
// Only cutover checklists are audited here — an ordinary checklist is handled
// by checklistIssues(). Flags a missing required verification, a malformed
// sign-off, a fully-ticked checklist that was never accepted, and a rejected
// cutover that was left unresolved.
export function cutoverIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.checklists || []) {
    if (!isCutoverChecklist(r)) continue;
    const cov = voipCutoverCoverage(r);
    for (const id of cov.missing) {
      issues.push({
        level: "warning",
        code: "cutover-missing-" + id,
        recordId: r.id,
        message: `Cutover checklist “${r.name}” is missing the “${cutoverCheckLabel(id)}” verification.`,
      });
    }
    if (r.signOff) {
      const v = validateCutoverSignOff(r.signOff);
      for (const message of v.errors) {
        issues.push({ level: "error", code: "cutover-bad-signoff", recordId: r.id, message: `Cutover checklist “${r.name}”: ${message}` });
      }
    }
    const p = checklistProgress(r);
    const decision = r.signOff && r.signOff.decision;
    if (p.complete && (!decision || decision === "pending")) {
      issues.push({ level: "warning", code: "cutover-unsigned", recordId: r.id, message: `Cutover checklist “${r.name}” is fully ticked but no client acceptance has been recorded.` });
    }
    if (decision === "rejected") {
      issues.push({ level: "warning", code: "cutover-rejected", recordId: r.id, message: `Cutover checklist “${r.name}” was rejected — resolve the issues and re-run the cutover.` });
    }
  }
  return issues;
}

// A cutover-specific text rendering that groups the steps by phase — used for
// the "copy as text" sharing path. `set`/`site` are optional context.
export function formatCutoverText(record, { set, site } = {}) {
  const lines = ["# " + (str(record && record.name) || "Cutover checklist")];
  if (set && set.name) lines.push("Client: " + set.name);
  if (site && site.name) lines.push("Site: " + site.name);
  if (record && str(record.description)) lines.push("", str(record.description));
  const p = checklistProgress(record);
  lines.push("", `Progress: ${p.done}/${p.total} complete${p.complete ? " ✓" : ""}`);
  lines.push("Acceptance: " + cutoverAcceptanceLine(record));
  const byPhase = cutoverPhaseProgress(record);
  for (const phase of CUTOVER_PHASES) {
    const sub = checklistItems(record).filter((i) => i && i.phase === phase.id);
    if (!sub.length) continue;
    const pp = byPhase[phase.id];
    lines.push("", `## ${phase.label} (${pp.done}/${pp.total})`);
    for (const item of sub) {
      const box = item.done ? "[x]" : "[ ]";
      let line = `- ${box} ${item.text}`;
      if (item.assignee) line += ` (@${item.assignee})`;
      lines.push(line);
      if (item.notes) lines.push("    - " + item.notes);
    }
  }
  const extras = checklistItems(record).filter((i) => i && !cutoverPhase(i.phase));
  if (extras.length) {
    lines.push("", "## Other");
    for (const item of extras) lines.push(`- ${item.done ? "[x]" : "[ ]"} ${item.text}`);
  }
  return lines.join("\n");
}
