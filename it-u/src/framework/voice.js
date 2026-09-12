// src/framework/voice.js — the Voice/PBX vocabulary and audit (roadmap task 36).
//
// Task 36 asks IT-U to model the voice platform as a structured Voice/PBX asset:
// the phone system and PBX platform, the voice services delivered, the related
// applications and voice vendors, and the configurations behind them — related
// forward to the internet/WAN circuits, the firewalls/security, the credentials,
// the licensing, the contacts and the number inventory.
//
// The template (./assetLibrary.js) carries the fields; the relationship catalog
// (./relationships.js) carries the typed links; and this module is the SHARED
// VOCABULARY both draw on. It also holds the Voice/PBX completeness audit the
// Linter folds in (./standardized.js).
//
// The number inventory is modelled as asset FIELDS (DID ranges, porting status
// and the porting date) rather than a separate record type: no number record
// exists yet, and the numbers a voice platform owns are genuinely part of its
// own definition. Task 39 carries number/port dates into the lifecycle trackers.

import { relationsOf } from "./relationships.js";

// ---- platform & deployment -------------------------------------------------
export const VOICE_PLATFORMS = [
  { id: "teams-phone", label: "Microsoft Teams Phone", description: "Telephony through Microsoft Teams with a calling plan or direct routing." },
  { id: "ringcentral", label: "RingCentral", description: "Hosted RingCentral MVP / RingEX." },
  { id: "8x8", label: "8x8", description: "Hosted 8x8 voice." },
  { id: "zoom-phone", label: "Zoom Phone", description: "Telephony inside Zoom." },
  { id: "webex-calling", label: "Cisco Webex Calling", description: "Cisco's hosted calling service." },
  { id: "goto-connect", label: "GoTo Connect", description: "Hosted GoTo (formerly Jive) voice." },
  { id: "vonage", label: "Vonage Business", description: "Hosted Vonage voice." },
  { id: "3cx", label: "3CX", description: "3CX PBX (hosted, on-premises or in the cloud)." },
  { id: "freepbx", label: "FreePBX / Asterisk", description: "Asterisk or FreePBX." },
  { id: "teams-direct-routing", label: "Teams Direct Routing", description: "Teams Phone over a third-party SIP trunk." },
  { id: "on-prem-pbx", label: "On-premises PBX", description: "A traditional on-site PBX (Mitel, Avaya, Panasonic, …)." },
  { id: "other", label: "Other", description: "Any other voice platform." },
];

export const VOICE_PLATFORM_IDS = VOICE_PLATFORMS.map((p) => p.id);
export const voicePlatform = (id) => VOICE_PLATFORMS.find((p) => p.id === id) || null;
export const voicePlatformLabel = (id) => (voicePlatform(id) || {}).label || "";
export const voicePlatformOptions = () => VOICE_PLATFORMS.map((p) => ({ id: p.id, label: p.label }));

export const VOICE_DEPLOYMENT_MODELS = [
  { id: "cloud", label: "Cloud / hosted" },
  { id: "on-premises", label: "On-premises" },
  { id: "hybrid", label: "Hybrid" },
  { id: "provider-managed", label: "Provider-managed" },
  { id: "carrier-hosted", label: "Carrier-hosted" },
];

export const VOICE_DEPLOYMENT_IDS = VOICE_DEPLOYMENT_MODELS.map((d) => d.id);
export const voiceDeployment = (id) => VOICE_DEPLOYMENT_MODELS.find((d) => d.id === id) || null;
export const voiceDeploymentLabel = (id) => (voiceDeployment(id) || {}).label || "";
export const voiceDeploymentOptions = () => VOICE_DEPLOYMENT_MODELS.map((d) => ({ id: d.id, label: d.label }));

// ---- trunking & media ------------------------------------------------------
export const VOICE_TRUNK_TYPES = [
  { id: "sip-trunk", label: "SIP trunk", description: "A registered or IP-authenticated SIP trunk." },
  { id: "sip-registration", label: "SIP registration", description: "The PBX registers outbound to the carrier." },
  { id: "hosted", label: "Hosted / cloud trunk", description: "The carrier terminates inside a hosted platform." },
  { id: "byoc", label: "Bring your own carrier (BYOC)", description: "A third-party carrier on a hosted platform." },
  { id: "pri", label: "PRI / ISDN", description: "A digital ISDN/PRI circuit." },
  { id: "analogue", label: "Analogue lines", description: "Plain analogue lines (POTS)." },
  { id: "none", label: "None / fully hosted", description: "No trunk the provider manages." },
];

export const VOICE_TRUNK_TYPE_IDS = VOICE_TRUNK_TYPES.map((t) => t.id);
export const voiceTrunkType = (id) => VOICE_TRUNK_TYPES.find((t) => t.id === id) || null;
export const voiceTrunkTypeLabel = (id) => (voiceTrunkType(id) || {}).label || "";
export const voiceTrunkTypeOptions = () => VOICE_TRUNK_TYPES.map((t) => ({ id: t.id, label: t.label }));

export const VOICE_SIP_TRANSPORTS = [
  { id: "udp", label: "SIP over UDP" },
  { id: "tcp", label: "SIP over TCP" },
  { id: "tls", label: "SIP over TLS (SIPS)" },
  { id: "srtp", label: "SRTP (encrypted media)" },
  { id: "webrtc", label: "WebRTC" },
  { id: "ip-auth", label: "IP-authenticated (no registration)" },
];

export const VOICE_SIP_TRANSPORT_IDS = VOICE_SIP_TRANSPORTS.map((t) => t.id);
export const voiceSipTransport = (id) => VOICE_SIP_TRANSPORTS.find((t) => t.id === id) || null;
export const voiceSipTransportLabel = (id) => (voiceSipTransport(id) || {}).label || "";
export const voiceSipTransportOptions = () => VOICE_SIP_TRANSPORTS.map((t) => ({ id: t.id, label: t.label }));

export const VOICE_CODECS = [
  { id: "g711u", label: "G.711 µ-law" },
  { id: "g711a", label: "G.711 A-law" },
  { id: "g722", label: "G.722" },
  { id: "g729", label: "G.729" },
  { id: "opus", label: "Opus" },
  { id: "g726", label: "G.726" },
  { id: "ilbc", label: "iLBC" },
];

export const VOICE_CODEC_IDS = VOICE_CODECS.map((c) => c.id);
export const voiceCodec = (id) => VOICE_CODECS.find((c) => c.id === id) || null;
export const voiceCodecLabel = (id) => (voiceCodec(id) || {}).label || "";
export const voiceCodecOptions = () => VOICE_CODECS.map((c) => ({ id: c.id, label: c.label }));

// ---- services delivered ----------------------------------------------------
export const VOICE_SERVICES = [
  { id: "extensions", label: "Extension dialling" },
  { id: "did", label: "DID / inbound numbers" },
  { id: "outbound", label: "Outbound calling" },
  { id: "auto-attendant", label: "Auto attendant / IVR" },
  { id: "ring-group", label: "Ring / hunt groups" },
  { id: "call-queue", label: "Call queues (ACD)" },
  { id: "voicemail", label: "Voicemail" },
  { id: "conferencing", label: "Audio conferencing" },
  { id: "call-recording", label: "Call recording" },
  { id: "reporting", label: "Call reporting & analytics" },
  { id: "softphone", label: "Softphone / mobile app" },
  { id: "paging", label: "Overhead paging" },
  { id: "fax", label: "Fax / ATA" },
  { id: "sms", label: "SMS / MMS" },
  { id: "crm-integration", label: "CRM integration" },
  { id: "e911", label: "Emergency / E911" },
  { id: "international", label: "International calling" },
  { id: "call-park", label: "Call park / pickup" },
  { id: "presence", label: "Presence / IM" },
];

export const VOICE_SERVICE_IDS = VOICE_SERVICES.map((s) => s.id);
export const voiceService = (id) => VOICE_SERVICES.find((s) => s.id === id) || null;
export const voiceServiceLabel = (id) => (voiceService(id) || {}).label || "";
export const voiceServiceOptions = () => VOICE_SERVICES.map((s) => ({ id: s.id, label: s.label }));
export const voiceServiceLabels = (ids) => asArray(ids).map((id) => voiceServiceLabel(id) || id);

// ---- number inventory & porting --------------------------------------------
export const VOICE_NUMBER_TYPES = [
  { id: "did", label: "DID (direct inward dial)" },
  { id: "main", label: "Main number" },
  { id: "toll-free", label: "Toll-free" },
  { id: "fax", label: "Fax number" },
  { id: "extension", label: "Extension" },
  { id: "short-code", label: "Short code" },
  { id: "other", label: "Other" },
];

export const VOICE_NUMBER_TYPE_IDS = VOICE_NUMBER_TYPES.map((t) => t.id);
export const voiceNumberType = (id) => VOICE_NUMBER_TYPES.find((t) => t.id === id) || null;
export const voiceNumberTypeLabel = (id) => (voiceNumberType(id) || {}).label || "";
export const voiceNumberTypeOptions = () => VOICE_NUMBER_TYPES.map((t) => ({ id: t.id, label: t.label }));

export const PORTING_STATUSES = [
  { id: "not-required", label: "Not required" },
  { id: "not-started", label: "Not started" },
  { id: "submitted", label: "Port submitted" },
  { id: "in-progress", label: "Port in progress" },
  { id: "ported", label: "Ported" },
  { id: "failed", label: "Port failed / delayed" },
];

export const PORTING_STATUS_IDS = PORTING_STATUSES.map((s) => s.id);
export const portingStatus = (id) => PORTING_STATUSES.find((s) => s.id === id) || null;
export const portingStatusLabel = (id) => (portingStatus(id) || {}).label || "";
export const portingStatusOptions = () => PORTING_STATUSES.map((s) => ({ id: s.id, label: s.label }));
export const isPortComplete = (id) => id === "ported" || id === "not-required";

// ---- emergency calling -----------------------------------------------------
export const EMERGENCY_SERVICES = [
  { id: "e911", label: "E911 (per-site dispatchable location)" },
  { id: "911", label: "911 / basic emergency" },
  { id: "national", label: "National emergency number" },
  { id: "none", label: "None recorded" },
];

export const EMERGENCY_SERVICE_IDS = EMERGENCY_SERVICES.map((s) => s.id);
export const emergencyService = (id) => EMERGENCY_SERVICES.find((s) => s.id === id) || null;
export const emergencyServiceLabel = (id) => (emergencyService(id) || {}).label || "";
export const emergencyServiceOptions = () => EMERGENCY_SERVICES.map((s) => ({ id: s.id, label: s.label }));
export const isEmergencyConfigured = (id) => !!id && id !== "none";

// ---- endpoints -------------------------------------------------------------
export const VOICE_ENDPOINT_TYPES = [
  { id: "desk-phone", label: "Desk phone" },
  { id: "conference-phone", label: "Conference phone" },
  { id: "softphone", label: "Softphone / desktop app" },
  { id: "mobile", label: "Mobile app" },
  { id: "ata", label: "ATA / analogue adapter" },
  { id: "headset", label: "Headset" },
  { id: "other", label: "Other" },
];

export const VOICE_ENDPOINT_TYPE_IDS = VOICE_ENDPOINT_TYPES.map((t) => t.id);
export const voiceEndpointType = (id) => VOICE_ENDPOINT_TYPES.find((t) => t.id === id) || null;
export const voiceEndpointTypeLabel = (id) => (voiceEndpointType(id) || {}).label || "";
export const voiceEndpointTypeOptions = () => VOICE_ENDPOINT_TYPES.map((t) => ({ id: t.id, label: t.label }));

// ---- Voice/PBX completeness audit ------------------------------------------
export const VOICE_PBX_TYPE_ID = "atype-voice-pbx";

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const refOf = (r) => ({ type: r.type, id: r.id });
const linkedKinds = (record, set) => new Set(relationsOf(set, refOf(record)).map((r) => r.relationship.kind));
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (isBlank(v)) return [];
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

// Which of a Voice/PBX asset's relation groups are linked.
export function voiceCoverage(record, set) {
  const k = linkedKinds(record, set);
  return {
    circuits: k.has("voice-circuit"),
    configurations: k.has("voice-configuration") || k.has("voice-sbc"),
    security: k.has("voice-security"),
    applications: k.has("voice-application"),
    vendor: k.has("voice-vendor"),
    credentials: k.has("voice-password"),
    licensing: k.has("licence-application"),
    documents: k.has("voice-document"),
    checklists: k.has("voice-checklist"),
    contacts: k.has("contact-voice"),
  };
}

// The completeness audit the Linter folds in. Gaps are warnings, never errors —
// a partially documented voice platform is a quality flag, not a broken graph.
export function voicePlatformIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || VOICE_PBX_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = voiceCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.platformType)) rec("warning", "voice-no-platform", `Voice platform “${r.name}” records no platform type.`);
    if (isBlank(v.deploymentModel)) rec("warning", "voice-no-deployment", `Voice platform “${r.name}” records no deployment model.`);
    if (!cov.circuits && isBlank(v.circuit)) rec("warning", "voice-no-circuit", `Voice platform “${r.name}” is not linked to an internet/WAN circuit.`);
    if (isBlank(v.numberInventory) && !cov.circuits) rec("warning", "voice-no-numbers", `Voice platform “${r.name}” records no number inventory.`);
    if (!cov.security && isBlank(v.securityPlatform)) rec("warning", "voice-no-security", `Voice platform “${r.name}” is not linked to a firewall or security platform.`);
    if (!cov.credentials && isBlank(v.adminCredential)) rec("warning", "voice-no-credential", `Voice platform “${r.name}” has no administrator credential recorded.`);
    if (!isEmergencyConfigured(v.emergencyService) && v.e911 !== true) rec("warning", "voice-no-emergency", `Voice platform “${r.name}” records no emergency-calling configuration.`);
  }
  return issues;
}
