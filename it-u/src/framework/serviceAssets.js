// src/framework/serviceAssets.js — the security, remote-access, virtualization,
// file-sharing and printing vocabulary and audits (roadmap task 34).
//
// Task 34 asks IT-U to model five more service assets:
//   • security platforms — antivirus/endpoint, spam filtering, firewalls, VPN
//     security — with their services, vendors and contacts, related to the
//     configurations, remote access, wireless and WAN they protect;
//   • remote access — VPN, webmail and remote-support systems — linked to the
//     configurations, security, credentials, applications and documents behind
//     them;
//   • virtualization — VMware, Hyper-V and others — related to their hosts, the
//     virtual servers and applications on them and their documentation;
//   • file sharing & storage — file servers, shared folders, NAS, SAN, DAS and
//     cloud file services — related to configurations, applications, contacts,
//     documents and security; and
//   • printing — printers, scanners and plotters, the print services and
//     workflows — related to the physical device configurations.
//
// The templates (./assetLibrary.js) carry the fields; the relationship catalog
// (./relationships.js) carries the typed links; and this module is the SHARED
// VOCABULARY both draw on. It also holds the per-service completeness audits the
// Linter folds in (./standardized.js).

import { relationsOf } from "./relationships.js";

// ---- security platforms ----------------------------------------------------
export const SECURITY_PLATFORM_TYPES = [
  { id: "edr", label: "Endpoint (EDR/AV)", description: "Endpoint detection and response, including traditional antivirus." },
  { id: "antivirus", label: "Antivirus / anti-malware", description: "Signature- or behaviour-based malware protection." },
  { id: "email-security", label: "Email security", description: "Spam filtering, anti-phishing and mail hygiene." },
  { id: "web-filter", label: "Web filtering", description: "Web content filtering or secure web gateway." },
  { id: "firewall", label: "Firewall / UTM", description: "A network firewall, UTM or security gateway." },
  { id: "vpn-security", label: "VPN / remote-access security", description: "The security layer protecting remote access." },
  { id: "siem", label: "SIEM / log management", description: "Security information and event management." },
  { id: "vulnerability", label: "Vulnerability scanner", description: "Vulnerability scanning and management." },
  { id: "mfa", label: "MFA / identity", description: "Multi-factor authentication and identity protection." },
  { id: "patch-management", label: "Patch management", description: "Patch and update management." },
  { id: "other", label: "Other", description: "Any other security platform." },
];

export const SECURITY_PLATFORM_TYPE_IDS = SECURITY_PLATFORM_TYPES.map((t) => t.id);
export const securityPlatformType = (id) => SECURITY_PLATFORM_TYPES.find((t) => t.id === id) || null;
export const securityPlatformTypeLabel = (id) => (securityPlatformType(id) || {}).label || "";
export const securityPlatformTypeOptions = () => SECURITY_PLATFORM_TYPES.map((t) => ({ id: t.id, label: t.label }));

export const SECURITY_DEPLOYMENT_MODELS = [
  { id: "cloud", label: "Cloud / SaaS" },
  { id: "on-premises", label: "On-premises" },
  { id: "managed", label: "Provider-managed" },
  { id: "hybrid", label: "Hybrid" },
];

export const SECURITY_DEPLOYMENT_IDS = SECURITY_DEPLOYMENT_MODELS.map((d) => d.id);
export const securityDeployment = (id) => SECURITY_DEPLOYMENT_MODELS.find((d) => d.id === id) || null;
export const securityDeploymentOptions = () => SECURITY_DEPLOYMENT_MODELS.map((d) => ({ id: d.id, label: d.label }));

// ---- remote access ---------------------------------------------------------
export const REMOTE_ACCESS_METHODS = [
  { id: "vpn", label: "VPN" },
  { id: "ssl-vpn", label: "SSL / client VPN" },
  { id: "ipsec-vpn", label: "IPsec / site-to-site VPN" },
  { id: "rd-gateway", label: "Remote Desktop Gateway" },
  { id: "remote-desktop", label: "Direct remote desktop" },
  { id: "zero-trust", label: "Zero-trust access" },
  { id: "webmail", label: "Webmail" },
  { id: "remote-support", label: "Remote-support / RMM agent" },
  { id: "other", label: "Other" },
];

export const REMOTE_ACCESS_METHOD_IDS = REMOTE_ACCESS_METHODS.map((m) => m.id);
export const remoteAccessMethod = (id) => REMOTE_ACCESS_METHODS.find((m) => m.id === id) || null;
export const remoteAccessMethodLabel = (id) => (remoteAccessMethod(id) || {}).label || "";
export const remoteAccessMethodOptions = () => REMOTE_ACCESS_METHODS.map((m) => ({ id: m.id, label: m.label }));

// ---- virtualization --------------------------------------------------------
export const VIRTUALIZATION_PLATFORMS = [
  { id: "vmware", label: "VMware vSphere" },
  { id: "hyperv", label: "Microsoft Hyper-V" },
  { id: "proxmox", label: "Proxmox VE" },
  { id: "xen", label: "Xen / XCP-ng" },
  { id: "kvm", label: "KVM" },
  { id: "nutanix", label: "Nutanix AHV" },
  { id: "azure-local", label: "Azure Local / Stack" },
  { id: "other", label: "Other" },
];

export const VIRTUALIZATION_PLATFORM_IDS = VIRTUALIZATION_PLATFORMS.map((p) => p.id);
export const virtualizationPlatform = (id) => VIRTUALIZATION_PLATFORMS.find((p) => p.id === id) || null;
export const virtualizationPlatformLabel = (id) => (virtualizationPlatform(id) || {}).label || "";
export const virtualizationPlatformOptions = () => VIRTUALIZATION_PLATFORMS.map((p) => ({ id: p.id, label: p.label }));

// ---- file sharing & storage ------------------------------------------------
export const FILE_STORAGE_TYPES = [
  { id: "on-prem", label: "On-premises file server" },
  { id: "cloud", label: "Cloud file service" },
  { id: "hybrid", label: "Hybrid" },
  { id: "nas", label: "NAS" },
  { id: "san", label: "SAN" },
  { id: "das", label: "DAS" },
  { id: "other", label: "Other" },
];

export const FILE_STORAGE_TYPE_IDS = FILE_STORAGE_TYPES.map((t) => t.id);
export const fileStorageType = (id) => FILE_STORAGE_TYPES.find((t) => t.id === id) || null;
export const fileStorageTypeLabel = (id) => (fileStorageType(id) || {}).label || "";
export const fileStorageTypeOptions = () => FILE_STORAGE_TYPES.map((t) => ({ id: t.id, label: t.label }));

export const FILE_SHARING_PROTOCOLS = [
  { id: "smb", label: "SMB / CIFS" },
  { id: "nfs", label: "NFS" },
  { id: "iscsi", label: "iSCSI" },
  { id: "ftp", label: "FTP / FTPS" },
  { id: "sftp", label: "SFTP" },
  { id: "cloud-sync", label: "Cloud sync (SharePoint / OneDrive / Drive)" },
  { id: "other", label: "Other" },
];

export const FILE_SHARING_PROTOCOL_IDS = FILE_SHARING_PROTOCOLS.map((p) => p.id);
export const fileSharingProtocol = (id) => FILE_SHARING_PROTOCOLS.find((p) => p.id === id) || null;
export const fileSharingProtocolOptions = () => FILE_SHARING_PROTOCOLS.map((p) => ({ id: p.id, label: p.label }));

// ---- printing --------------------------------------------------------------
export const PRINTING_DEVICE_TYPES = [
  { id: "mfp", label: "Multifunction (MFP)" },
  { id: "laser", label: "Laser" },
  { id: "inkjet", label: "Inkjet" },
  { id: "label", label: "Label printer" },
  { id: "wide-format", label: "Wide format" },
  { id: "plotter", label: "Plotter" },
  { id: "scanner", label: "Scanner" },
  { id: "thermal", label: "Thermal / receipt" },
  { id: "dot-matrix", label: "Dot matrix" },
  { id: "other", label: "Other" },
];

export const PRINTING_DEVICE_TYPE_IDS = PRINTING_DEVICE_TYPES.map((t) => t.id);
export const printingDeviceType = (id) => PRINTING_DEVICE_TYPES.find((t) => t.id === id) || null;
export const printingDeviceTypeLabel = (id) => (printingDeviceType(id) || {}).label || "";
export const printingDeviceTypeOptions = () => PRINTING_DEVICE_TYPES.map((t) => ({ id: t.id, label: t.label }));

export const PRINT_SERVICE_MODELS = [
  { id: "local", label: "Local / direct" },
  { id: "network-shared", label: "Network shared" },
  { id: "print-server", label: "Print server" },
  { id: "managed-print", label: "Managed print" },
  { id: "mps", label: "Managed print service (MPS)" },
  { id: "cloud-print", label: "Cloud print" },
  { id: "other", label: "Other" },
];

export const PRINT_SERVICE_MODEL_IDS = PRINT_SERVICE_MODELS.map((m) => m.id);
export const printServiceModel = (id) => PRINT_SERVICE_MODELS.find((m) => m.id === id) || null;
export const printServiceModelOptions = () => PRINT_SERVICE_MODELS.map((m) => ({ id: m.id, label: m.label }));

// ---- structured-service audits ---------------------------------------------
export const SECURITY_TYPE_ID = "atype-security-platform";
export const REMOTE_ACCESS_TYPE_ID = "atype-remote-access";
export const VIRTUALIZATION_TYPE_ID = "atype-virtualization";
export const FILE_SHARING_TYPE_ID = "atype-file-sharing";
export const PRINTING_TYPE_ID = "atype-printing";

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const refOf = (r) => ({ type: r.type, id: r.id });
const linkedKinds = (record, set) => new Set(relationsOf(set, refOf(record)).map((r) => r.relationship.kind));
const asArray = (v) => (Array.isArray(v) ? v : isBlank(v) ? [] : String(v).split(",").map((s) => s.trim()).filter(Boolean));

// Which of a security platform's relation groups are linked.
export function securityCoverage(record, set) {
  const k = linkedKinds(record, set);
  return {
    configurations: k.has("security-configuration"),
    remoteAccess: k.has("remote-access-security"),
    wireless: k.has("wireless-security"),
    wan: k.has("wan-security"),
    email: k.has("email-security"),
    fileSharing: k.has("file-sharing-security"),
    applications: k.has("security-application"),
    credentials: k.has("security-password"),
    vendor: k.has("security-vendor"),
    licensing: k.has("licence-application"),
    documents: k.has("security-document"),
    contacts: k.has("contact-security-platform"),
  };
}

export function securityPlatformIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || SECURITY_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = securityCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.product)) rec("warning", "security-no-product", `Security platform “${r.name}” records no product.`);
    if (isBlank(v.platformType)) rec("warning", "security-no-type", `Security platform “${r.name}” records no platform type.`);
    if (isBlank(v.seats) && isBlank(v.coverage) && !cov.configurations) rec("warning", "security-no-scope", `Security platform “${r.name}” records no seats or protected scope.`);
    if (!cov.configurations) rec("warning", "security-no-configurations", `Security platform “${r.name}” is not linked to any protected configuration.`);
    if (!cov.credentials && isBlank(v.adminCredential)) rec("warning", "security-no-credential", `Security platform “${r.name}” has no administrator credential recorded.`);
    if (!cov.vendor && isBlank(v.vendorRecord) && isBlank(v.vendor)) rec("warning", "security-no-vendor", `Security platform “${r.name}” records no vendor.`);
  }
  return issues;
}

export function remoteAccessCoverage(record, set) {
  const k = linkedKinds(record, set);
  return {
    configurations: k.has("remote-access-configuration"),
    security: k.has("remote-access-security"),
    applications: k.has("remote-access-application"),
    credentials: k.has("remote-access-password"),
    documents: k.has("remote-access-document"),
    contacts: k.has("contact-remote-access"),
  };
}

export function remoteAccessIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || REMOTE_ACCESS_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = remoteAccessCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.method)) rec("warning", "remote-no-method", `Remote access “${r.name}” records no access method.`);
    if (isBlank(v.endpoint)) rec("warning", "remote-no-endpoint", `Remote access “${r.name}” records no endpoint or URL.`);
    if (v.mfa !== true) rec("warning", "remote-no-mfa", `Remote access “${r.name}” does not record MFA as enforced.`);
    if (!cov.security && isBlank(v.securityRecord)) rec("warning", "remote-no-security", `Remote access “${r.name}” is not linked to a security platform.`);
    if (!cov.credentials && isBlank(v.adminCredential)) rec("warning", "remote-no-credential", `Remote access “${r.name}” has no credential recorded.`);
  }
  return issues;
}

export function virtualizationCoverage(record, set) {
  const k = linkedKinds(record, set);
  return {
    hosts: k.has("virtualization-host"),
    applications: k.has("virtualization-application"),
    credentials: k.has("virtualization-password"),
    vendor: k.has("virtualization-vendor"),
    licensing: k.has("licence-application"),
    documents: k.has("virtualization-document"),
    contacts: k.has("contact-virtualization"),
  };
}

export function virtualizationIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || VIRTUALIZATION_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = virtualizationCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.platform)) rec("warning", "virt-no-platform", `Virtualization “${r.name}” records no platform.`);
    if (!cov.hosts && isBlank(v.hostCount)) rec("warning", "virt-no-hosts", `Virtualization “${r.name}” is not linked to any host.`);
    if (!cov.credentials && isBlank(v.adminCredential)) rec("warning", "virt-no-credential", `Virtualization “${r.name}” has no administrator credential recorded.`);
    if (!cov.documents) rec("warning", "virt-no-document", `Virtualization “${r.name}” has no supporting documentation linked.`);
  }
  return issues;
}

export function fileSharingCoverage(record, set) {
  const k = linkedKinds(record, set);
  return {
    configurations: k.has("file-sharing-configuration"),
    applications: k.has("file-sharing-application"),
    security: k.has("file-sharing-security"),
    backup: k.has("backup-storage"),
    credentials: k.has("file-sharing-password"),
    documents: k.has("file-sharing-document"),
    contacts: k.has("contact-file-sharing"),
  };
}

export function fileSharingIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || FILE_SHARING_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = fileSharingCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.storageType)) rec("warning", "file-no-storage-type", `File sharing “${r.name}” records no storage type.`);
    if (!cov.configurations) rec("warning", "file-no-server", `File sharing “${r.name}” is not linked to a file server or host configuration.`);
    if (isBlank(v.sharePath) && isBlank(v.shares)) rec("warning", "file-no-shares", `File sharing “${r.name}” records no shared folders or path.`);
    if (!cov.backup) rec("warning", "file-no-backup", `File sharing “${r.name}” is not linked to a backup service.`);
  }
  return issues;
}

export function printingCoverage(record, set) {
  const k = linkedKinds(record, set);
  return {
    configurations: k.has("printing-configuration"),
    vendor: k.has("printing-vendor"),
    documents: k.has("printing-document"),
    contacts: k.has("contact-printing"),
  };
}

export function printingIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || PRINTING_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = printingCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.printerType)) rec("warning", "print-no-type", `Printing record “${r.name}” records no printer type.`);
    if (!cov.configurations && isBlank(v.deviceRecord)) rec("warning", "print-no-device", `Printing record “${r.name}” is not linked to a device configuration.`);
    if (isBlank(v.serviceModel)) rec("warning", "print-no-service-model", `Printing record “${r.name}” records no print service model.`);
  }
  return issues;
}

// Fold all five task-34 audits together (used by ./standardized.js).
export function serviceAssetIssues(set, opts = {}) {
  return [
    ...securityPlatformIssues(set, opts),
    ...remoteAccessIssues(set, opts),
    ...virtualizationIssues(set, opts),
    ...fileSharingIssues(set, opts),
    ...printingIssues(set, opts),
  ];
}
