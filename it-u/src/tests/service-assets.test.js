// src/tests/service-assets.test.js — validation tests for Phase 8 task 34
// (security, remote access, virtualization, file sharing and printing assets).
// Run in the live page:
//   await import("./src/tests/service-assets.test.js").then((m) => m.run())
//
// Covers: the five vocabularies (security platform types, security deployment
// models, remote-access methods, virtualization platforms, file-storage types
// and protocols, printing device types and print service models); the five
// shipped templates and their record-reference fields; the typed relationships
// each holds; the labelled relationship GROUPS the profile shows; the
// link-parameter/candidate computation behind those groups; and the five
// per-service completeness audits folded into the Linter.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { validateAssetType } from "../framework/flexible.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";
import {
  SECURITY_PLATFORM_TYPES,
  SECURITY_DEPLOYMENT_MODELS,
  REMOTE_ACCESS_METHODS,
  VIRTUALIZATION_PLATFORMS,
  FILE_STORAGE_TYPES,
  FILE_SHARING_PROTOCOLS,
  PRINTING_DEVICE_TYPES,
  PRINT_SERVICE_MODELS,
  securityPlatformType,
  securityPlatformTypeLabel,
  securityPlatformTypeOptions,
  securityDeployment,
  securityDeploymentOptions,
  remoteAccessMethod,
  remoteAccessMethodLabel,
  remoteAccessMethodOptions,
  virtualizationPlatform,
  virtualizationPlatformLabel,
  virtualizationPlatformOptions,
  fileStorageType,
  fileStorageTypeLabel,
  fileStorageTypeOptions,
  fileSharingProtocol,
  fileSharingProtocolOptions,
  printingDeviceType,
  printingDeviceTypeLabel,
  printingDeviceTypeOptions,
  printServiceModel,
  printServiceModelOptions,
  securityCoverage,
  remoteAccessCoverage,
  virtualizationCoverage,
  fileSharingCoverage,
  printingCoverage,
  securityPlatformIssues,
  remoteAccessIssues,
  virtualizationIssues,
  fileSharingIssues,
  printingIssues,
  serviceAssetIssues,
  SECURITY_TYPE_ID,
  REMOTE_ACCESS_TYPE_ID,
  VIRTUALIZATION_TYPE_ID,
  FILE_SHARING_TYPE_ID,
  PRINTING_TYPE_ID,
} from "../framework/serviceAssets.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const fx = (id) => builtinAssetType(id);
  const security = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "CrowdStrike Falcon",
    assetTypeId: SECURITY_TYPE_ID,
    assetFields: { product: "CrowdStrike Falcon", platformType: "edr", deploymentModel: "cloud", seats: 120, coverage: "All endpoints", vendor: "CrowdStrike", expiryDate: "2027-06-30" },
    ...CL,
  })).record;
  const remoteAccess = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "FortiClient SSL-VPN",
    assetTypeId: REMOTE_ACCESS_TYPE_ID,
    assetFields: { product: "FortiClient", method: "ssl-vpn", endpoint: "vpn.acme.example", protocol: "SSL/TLS", port: "443", mfa: true, concurrentUsers: 50 },
    ...CL,
  })).record;
  const virt = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "PROD cluster",
    assetTypeId: VIRTUALIZATION_TYPE_ID,
    assetFields: { platform: "vmware", version: "8.0", clusterName: "CL-PROD", hostCount: 3, haEnabled: true },
    ...CL,
  })).record;
  const fileShare = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "FS01 data share",
    assetTypeId: FILE_SHARING_TYPE_ID,
    assetFields: { product: "Windows File Server", storageType: "on-prem", protocol: "smb", capacity: "8 TB", sharePath: "\\\\FS01\\data", shares: "Data, Finance" },
    ...CL,
  })).record;
  const printing = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Floor-2 MFP",
    assetTypeId: PRINTING_TYPE_ID,
    assetFields: { printerType: "mfp", model: "Ricoh IM C3000", serviceModel: "print-server", address: "\\\\PS01\\PRN-FLOOR2" },
    ...CL,
  })).record;

  const edgeFw = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW01", configType: "firewall", ...CL })).record;
  const vpnGw = (await docs.addRecord(set.id, { type: "configurations", name: "VPN-GW01", configType: "firewall", ...CL })).record;
  const esxHost = (await docs.addRecord(set.id, { type: "configurations", name: "ESX-01", configType: "server-virtual", ...CL })).record;
  const fileServer = (await docs.addRecord(set.id, { type: "configurations", name: "FS01", configType: "server-virtual", ...CL })).record;
  const printerDevice = (await docs.addRecord(set.id, { type: "configurations", name: "PRN-FLOOR2", configType: "printer", ...CL })).record;

  const password = (await docs.addRecord(set.id, { type: "passwords", name: "Security console admin", scope: "general", category: "service-account", ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "CrowdStrike", assetTypeId: fx("atype-vendor").id, assetFields: { vendorType: "security" }, ...CL })).record;
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Falcon Console", assetTypeId: fx("atype-applications").id, assetFields: { applicationType: "security" }, ...CL })).record;
  const licence = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Falcon subscription", assetTypeId: fx("atype-licences").id, assetFields: { product: "Falcon", licenceType: "subscription" }, ...CL })).record;
  const backup = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Veeam nightly", assetTypeId: fx("atype-backup-service").id, assetFields: { product: "Veeam", architecture: "image" }, ...CL })).record;
  const document = (await docs.addRecord(set.id, { type: "documents", name: "Security runbook", docType: "reference", ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Dana Reed", contactRole: "application-owner", ...CL })).record;
  const wireless = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme Wi-Fi", assetTypeId: fx("atype-wireless").id, assetFields: { ssids: "ACME-Corp", securityMode: "wpa2-enterprise" }, ...CL })).record;
  const wan = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme fibre", assetTypeId: fx("atype-wan-service").id, assetFields: { carrier: "BT", serviceKind: "primary" }, ...CL })).record;
  const email = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme mail", assetTypeId: fx("atype-email-system").id, assetFields: { platform: "microsoft-365", deployment: "cloud" }, ...CL })).record;

  return { set, security, remoteAccess, virt, fileShare, printing, edgeFw, vpnGw, esxHost, fileServer, printerDevice, password, vendor, app, licence, backup, document, contact, wireless, wan, email };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.security, s.edgeFw, "security-configuration");
  await link(s.security, s.password, "security-password");
  await link(s.security, s.vendor, "security-vendor");
  await link(s.security, s.app, "security-application");
  await link(s.security, s.document, "security-document");

  await link(s.remoteAccess, s.vpnGw, "remote-access-configuration");
  await link(s.remoteAccess, s.security, "remote-access-security");
  await link(s.remoteAccess, s.app, "remote-access-application");
  await link(s.remoteAccess, s.password, "remote-access-password");
  await link(s.remoteAccess, s.document, "remote-access-document");

  await link(s.virt, s.esxHost, "virtualization-host");
  await link(s.virt, s.app, "virtualization-application");
  await link(s.virt, s.password, "virtualization-password");
  await link(s.virt, s.vendor, "virtualization-vendor");
  await link(s.virt, s.document, "virtualization-document");

  await link(s.fileShare, s.fileServer, "file-sharing-configuration");
  await link(s.fileShare, s.app, "file-sharing-application");
  await link(s.fileShare, s.security, "file-sharing-security");
  await link(s.fileShare, s.password, "file-sharing-password");
  await link(s.fileShare, s.document, "file-sharing-document");
  await link(s.backup, s.fileShare, "backup-storage");

  await link(s.printing, s.printerDevice, "printing-configuration");
  await link(s.printing, s.vendor, "printing-vendor");
  await link(s.printing, s.document, "printing-document");

  await link(s.wireless, s.security, "wireless-security");
  await link(s.wan, s.security, "wan-security");
  await link(s.email, s.security, "email-security");
  await link(s.licence, s.security, "licence-application");
  await link(s.licence, s.virt, "licence-application");

  await link(s.contact, s.security, "contact-security-platform");
  await link(s.contact, s.remoteAccess, "contact-remote-access");
  await link(s.contact, s.virt, "contact-virtualization");
  await link(s.contact, s.fileShare, "contact-file-sharing");
  await link(s.contact, s.printing, "contact-printing");
}

const codes = (issues) => issues.map((i) => i.code);

export async function run() {
  return runTests([
    {
      name: "the five service templates model security, remote access, virtualization, file sharing and printing as structured records",
      fn: () => {
        const security = builtinAssetType("atype-security-platform");
        const remoteAccess = builtinAssetType("atype-remote-access");
        const virt = builtinAssetType("atype-virtualization");
        const fileShare = builtinAssetType("atype-file-sharing");
        const printing = builtinAssetType("atype-printing");
        for (const t of [security, remoteAccess, virt, fileShare, printing]) {
          assert(validateAssetType(t).ok, t.name + " validates: " + JSON.stringify(validateAssetType(t).errors));
        }
        assertEq(security.category, "security", "security platforms live in the security category");
        assertEq(remoteAccess.category, "security", "remote access lives in the security category");
        assertEq(virt.category, "infrastructure", "virtualization lives in the infrastructure category");
        assertEq(fileShare.category, "infrastructure", "file sharing lives in the infrastructure category");
        assertEq(printing.category, "infrastructure", "printing lives in the infrastructure category");

        assert(security.fields.find((f) => f.key === "product" && f.required), "a security platform names its product");
        const secType = security.fields.find((f) => f.key === "platformType" && f.required);
        assert(secType && secType.options.length === SECURITY_PLATFORM_TYPES.length, "security platform type comes from the catalog");
        const secDeploy = security.fields.find((f) => f.key === "deploymentModel");
        assert(secDeploy && secDeploy.options.length === SECURITY_DEPLOYMENT_MODELS.length, "security deployment comes from the catalog");
        assert(security.fields.find((f) => f.key === "services" && f.type === "textarea"), "managed services are captured");
        assert(security.fields.find((f) => f.key === "coverage" && f.type === "textarea"), "protected scope is captured");
        assert(security.fields.find((f) => f.key === "adminCredential" && f.type === "record" && f.of === "passwords"), "security points at its administrator credential");
        assert(security.fields.find((f) => f.key === "vendorRecord" && f.of === "flexibleAssets"), "security points at its vendor record");
        assert(security.fields.find((f) => f.key === "licenceRecord" && f.of === "flexibleAssets"), "security points at its licence record");
        assert(security.fields.find((f) => f.key === "expiryDate" && f.type === "date" && f.expiry === true), "security keeps its renewal/expiry date");

        const raMethod = remoteAccess.fields.find((f) => f.key === "method" && f.required);
        assert(raMethod && raMethod.options.length === REMOTE_ACCESS_METHODS.length, "remote-access method comes from the catalog");
        assert(remoteAccess.fields.find((f) => f.key === "endpoint"), "remote access records its endpoint");
        assert(remoteAccess.fields.find((f) => f.key === "mfa" && f.type === "checkbox"), "remote access records MFA enforcement");
        assert(remoteAccess.fields.find((f) => f.key === "vpnGatewayRecord" && f.of === "configurations"), "remote access points at its gateway configuration");
        assert(remoteAccess.fields.find((f) => f.key === "adminCredential" && f.of === "passwords"), "remote access points at its credential");
        assert(remoteAccess.fields.find((f) => f.key === "applicationRecord" && f.of === "flexibleAssets"), "remote access points at its application");

        const virtPlatform = virt.fields.find((f) => f.key === "platform" && f.required);
        assert(virtPlatform && virtPlatform.options.length === VIRTUALIZATION_PLATFORMS.length, "virtualization platform comes from the catalog");
        assert(virt.fields.find((f) => f.key === "datastores" && f.type === "textarea"), "virtualization captures its datastores");
        assert(virt.fields.find((f) => f.key === "haEnabled" && f.type === "checkbox"), "virtualization records HA");
        assert(virt.fields.find((f) => f.key === "drNotes" && f.type === "textarea"), "virtualization captures DR notes");
        assert(virt.fields.find((f) => f.key === "adminCredential" && f.of === "passwords"), "virtualization points at its credential");
        assert(virt.fields.find((f) => f.key === "licenceRecord" && f.of === "flexibleAssets"), "virtualization points at its licence");

        const fsType = fileShare.fields.find((f) => f.key === "storageType" && f.required);
        assert(fsType && fsType.options.length === FILE_STORAGE_TYPES.length, "file-storage type comes from the catalog");
        const fsProto = fileShare.fields.find((f) => f.key === "protocol");
        assert(fsProto && fsProto.options.length === FILE_SHARING_PROTOCOLS.length, "file-sharing protocol comes from the catalog");
        assert(fileShare.fields.find((f) => f.key === "shares" && f.type === "textarea"), "file sharing lists its shared folders");
        assert(fileShare.fields.find((f) => f.key === "backupRecord" && f.of === "flexibleAssets"), "file sharing points at its backup service");
        assert(fileShare.fields.find((f) => f.key === "securityRecord" && f.of === "flexibleAssets"), "file sharing points at its security platform");

        const prType = printing.fields.find((f) => f.key === "printerType" && f.required);
        assert(prType && prType.options.length === PRINTING_DEVICE_TYPES.length, "printing device type comes from the catalog");
        const prService = printing.fields.find((f) => f.key === "serviceModel");
        assert(prService && prService.options.length === PRINT_SERVICE_MODELS.length, "print service model comes from the catalog");
        assert(printing.fields.find((f) => f.key === "deviceRecord" && f.of === "configurations"), "printing points at its device configuration");
        assert(printing.fields.find((f) => f.key === "printServerRecord" && f.of === "configurations"), "printing points at its print server");
        assert(printing.fields.find((f) => f.key === "supplierRecord" && f.of === "flexibleAssets"), "printing points at its supplier");

        for (const t of [security, remoteAccess, virt, fileShare, printing]) {
          for (const r of ["configurations", "contacts", "flexibleAssets", "documents"]) {
            assert(t.references.includes(r), t.name + " may reference " + r);
          }
        }
        for (const t of [security, remoteAccess, virt, fileShare]) {
          assert(t.references.includes("passwords"), t.name + " may reference credentials");
        }
      },
    },
    {
      name: "the service vocabularies expose security, remote-access, virtualization, storage and printing catalogs",
      fn: () => {
        assertEq(securityPlatformType("edr").label, "Endpoint (EDR/AV)", "security platform type lookup");
        assertEq(securityPlatformTypeLabel("email-security"), "Email security", "security platform type label");
        assertEq(securityPlatformType("bogus"), null, "an unknown security type is null");
        assertEq(securityDeployment("cloud").label, "Cloud / SaaS", "security deployment lookup");
        assertEq(remoteAccessMethod("ssl-vpn").label, "SSL / client VPN", "remote-access method lookup");
        assertEq(remoteAccessMethodLabel("webmail"), "Webmail", "remote-access method label");
        assertEq(virtualizationPlatform("vmware").label, "VMware vSphere", "virtualization platform lookup");
        assertEq(virtualizationPlatformLabel("hyperv"), "Microsoft Hyper-V", "virtualization platform label");
        assertEq(fileStorageType("nas").label, "NAS", "file-storage type lookup");
        assertEq(fileStorageTypeLabel("san"), "SAN", "file-storage type label");
        assertEq(fileSharingProtocol("smb").label, "SMB / CIFS", "file-sharing protocol lookup");
        assertEq(printingDeviceType("plotter").label, "Plotter", "printing device type lookup");
        assertEq(printingDeviceTypeLabel("scanner"), "Scanner", "printing device type label");
        assertEq(printServiceModel("mps").label, "Managed print service (MPS)", "print service model lookup");
        assertEq(securityPlatformTypeOptions().length, SECURITY_PLATFORM_TYPES.length, "security type options mirror the catalog");
        assertEq(securityDeploymentOptions().length, SECURITY_DEPLOYMENT_MODELS.length, "security deployment options mirror the catalog");
        assertEq(remoteAccessMethodOptions().length, REMOTE_ACCESS_METHODS.length, "remote-access options mirror the catalog");
        assertEq(virtualizationPlatformOptions().length, VIRTUALIZATION_PLATFORMS.length, "virtualization options mirror the catalog");
        assertEq(fileStorageTypeOptions().length, FILE_STORAGE_TYPES.length, "file-storage options mirror the catalog");
        assertEq(fileSharingProtocolOptions().length, FILE_SHARING_PROTOCOLS.length, "file protocol options mirror the catalog");
        assertEq(printingDeviceTypeOptions().length, PRINTING_DEVICE_TYPES.length, "printing device options mirror the catalog");
        assertEq(printServiceModelOptions().length, PRINT_SERVICE_MODELS.length, "print service options mirror the catalog");
        assert([securityPlatformTypeOptions(), securityDeploymentOptions(), remoteAccessMethodOptions(), virtualizationPlatformOptions(), fileStorageTypeOptions(), fileSharingProtocolOptions(), printingDeviceTypeOptions(), printServiceModelOptions()].every((opts) => opts.every((o) => o.id && o.label)), "every option is well formed");
      },
    },
    {
      name: "the five service records relate to their configurations, applications, credentials, security, backup, vendors, documents and people",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-service-assets" });
        const s = await seed(world);
        await linkAll(world, s);

        const secRels = await world.docs.relations(s.set.id, ref(s.security));
        assertEq(secRels.length, 12, "twelve relationships touch the security platform");
        assertEq(secRels.map((r) => r.relationship.kind).sort().join(","), ["contact-security-platform", "email-security", "file-sharing-security", "licence-application", "remote-access-security", "security-application", "security-configuration", "security-document", "security-password", "security-vendor", "wan-security", "wireless-security"].join(","), "the security platform's link kinds");

        const raRels = await world.docs.relations(s.set.id, ref(s.remoteAccess));
        assertEq(raRels.length, 6, "six relationships touch remote access");
        assertEq(raRels.map((r) => r.relationship.kind).sort().join(","), ["contact-remote-access", "remote-access-application", "remote-access-configuration", "remote-access-document", "remote-access-password", "remote-access-security"].join(","), "remote access's link kinds");

        const virtRels = await world.docs.relations(s.set.id, ref(s.virt));
        assertEq(virtRels.length, 7, "seven relationships touch virtualization");
        assertEq(virtRels.map((r) => r.relationship.kind).sort().join(","), ["contact-virtualization", "licence-application", "virtualization-application", "virtualization-document", "virtualization-host", "virtualization-password", "virtualization-vendor"].join(","), "virtualization's link kinds");

        const fsRels = await world.docs.relations(s.set.id, ref(s.fileShare));
        assertEq(fsRels.length, 7, "seven relationships touch file sharing");
        assertEq(fsRels.map((r) => r.relationship.kind).sort().join(","), ["backup-storage", "contact-file-sharing", "file-sharing-application", "file-sharing-configuration", "file-sharing-document", "file-sharing-password", "file-sharing-security"].join(","), "file sharing's link kinds");

        const prRels = await world.docs.relations(s.set.id, ref(s.printing));
        assertEq(prRels.length, 4, "four relationships touch printing");
        assertEq(prRels.map((r) => r.relationship.kind).sort().join(","), ["contact-printing", "printing-configuration", "printing-document", "printing-vendor"].join(","), "printing's link kinds");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "the relationship catalog refuses service links that break it, duplicates and self-links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-service-assets" });
        const s = await seed(world);
        let threw = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.security), to: ref(s.document), kind: "security-configuration" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a security→document link is refused");

        await world.docs.linkRecords(s.set.id, { from: ref(s.printing), to: ref(s.printerDevice), kind: "printing-configuration" });
        let dup = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.printing), to: ref(s.printerDevice), kind: "printing-configuration" });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "INVALID_DATA", "a duplicate service link is refused");

        let self = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.security), to: ref(s.security), kind: "security-application" });
        } catch (e) {
          self = e;
        }
        assert(self && self.code === "INVALID_DATA", "a self-link is refused");
      },
    },
    {
      name: "the profile groups each service record's links into labelled buckets",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-service-assets" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const sec = groupLinks(s.security, set, builtinAssetType("atype-security-platform"));
        assertEq(sec.total, 12, "the security platform's links are accounted for");
        assertEq(sec.leftovers.length, 0, "no security links fall outside the named groups");
        const secById = Object.fromEntries(sec.groups.map((g) => [g.id, g]));
        for (const id of ["configurations", "remoteAccess", "wireless", "wan", "email", "fileSharing", "applications", "credentials", "vendor", "licensing", "documents", "contacts"]) assert(secById[id], "the security " + id + " group exists");
        assertEq(secById.remoteAccess.direction, "in", "the remote-access group attaches from the remote-access side");
        assertEq(secById.configurations.links[0].other.name, "EDGE-FW01", "the far-side protected configuration is resolved");

        const ra = groupLinks(s.remoteAccess, set, builtinAssetType("atype-remote-access"));
        assertEq(ra.total, 6, "remote access's links are accounted for");
        assertEq(ra.leftovers.length, 0, "no remote-access links fall outside the named groups");
        const raById = Object.fromEntries(ra.groups.map((g) => [g.id, g]));
        for (const id of ["configurations", "security", "applications", "credentials", "documents", "contacts"]) assert(raById[id], "the remote-access " + id + " group exists");
        assertEq(raById.configurations.links[0].other.name, "VPN-GW01", "the remote-access gateway is resolved");

        const virt = groupLinks(s.virt, set, builtinAssetType("atype-virtualization"));
        assertEq(virt.total, 7, "virtualization's links are accounted for");
        assertEq(virt.leftovers.length, 0, "no virtualization links fall outside the named groups");
        const virtById = Object.fromEntries(virt.groups.map((g) => [g.id, g]));
        for (const id of ["hosts", "applications", "credentials", "vendor", "licensing", "documents", "contacts"]) assert(virtById[id], "the virtualization " + id + " group exists");
        assertEq(virtById.hosts.links[0].other.name, "ESX-01", "the virtualization host is resolved");

        const fs = groupLinks(s.fileShare, set, builtinAssetType("atype-file-sharing"));
        assertEq(fs.total, 7, "file sharing's links are accounted for");
        assertEq(fs.leftovers.length, 0, "no file-sharing links fall outside the named groups");
        const fsById = Object.fromEntries(fs.groups.map((g) => [g.id, g]));
        for (const id of ["configurations", "applications", "security", "backup", "credentials", "documents", "contacts"]) assert(fsById[id], "the file-sharing " + id + " group exists");
        assertEq(fsById.backup.direction, "in", "the backup group attaches from the backup side");
        assertEq(fsById.backup.links[0].other.name, "Veeam nightly", "the protecting backup service is resolved");

        const pr = groupLinks(s.printing, set, builtinAssetType("atype-printing"));
        assertEq(pr.total, 4, "printing's links are accounted for");
        assertEq(pr.leftovers.length, 0, "no printing links fall outside the named groups");
        const prById = Object.fromEntries(pr.groups.map((g) => [g.id, g]));
        for (const id of ["configurations", "vendor", "documents", "contacts"]) assert(prById[id], "the printing " + id + " group exists");
        assertEq(prById.configurations.links.find((l) => l.other.name === "PRN-FLOOR2").other.type, "configurations", "the printing device configuration is resolved");
      },
    },
    {
      name: "group link parameters and candidate lists drive the service profiles' link pickers",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-service-assets" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });

        const secById = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-security-platform")).map((g) => [g.id, g]));
        const outParams = linkParamsFor(s.security, secById.configurations, s.edgeFw);
        assertEq(outParams.from.id, s.security.id, "an out group links from the security platform");
        assertEq(outParams.to.id, s.edgeFw.id, "…to the candidate");
        assertEq(outParams.kind, "security-configuration", "…with the group's primary kind");
        const inParams = linkParamsFor(s.security, secById.remoteAccess, s.remoteAccess);
        assertEq(inParams.from.id, s.remoteAccess.id, "an in group links from the candidate remote access");
        assertEq(inParams.to.id, s.security.id, "…to the security platform");
        assertEq(inParams.kind, "remote-access-security", "…with the shared protection kind");

        assert(relationCandidates(s.security, set, secById.vendor).some((r) => r.id === s.vendor.id), "an unlinked vendor is offered");
        assert(!relationCandidates(s.security, set, secById.applications).some((r) => r.id === s.vendor.id), "the template filter keeps a vendor out of the applications group");
        assert(!relationCandidates(s.security, set, secById.configurations).some((r) => r.id === s.security.id), "a group never offers the security platform itself");
        assert(relationCandidates(s.security, set, secById.configurations).every((r) => r.type === "configurations"), "the protected-configurations group only offers configurations");

        const fsById = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-file-sharing")).map((g) => [g.id, g]));
        const backupParams = linkParamsFor(s.fileShare, fsById.backup, s.backup);
        assertEq(backupParams.from.id, s.backup.id, "the backup group links from the backup service");
        assertEq(backupParams.to.id, s.fileShare.id, "…to the file-sharing record");
        assertEq(backupParams.kind, "backup-storage", "…with the shared backup-storage kind");

        const prById = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-printing")).map((g) => [g.id, g]));
        await world.docs.linkRecords(s.set.id, { from: ref(s.printing), to: ref(s.printerDevice), kind: "printing-configuration" });
        const after = await world.docs.get(s.set.id, { force: true });
        assert(!relationCandidates(s.printing, after, prById.configurations).some((r) => r.id === s.printerDevice.id), "a linked device drops out of the candidates");
      },
    },
    {
      name: "the service audits flag incomplete records and fold into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-service-assets" });
        const set = await world.docs.create({ name: "Bare" });
        const bareSec = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned security", assetTypeId: SECURITY_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareRa = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned remote access", assetTypeId: REMOTE_ACCESS_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareVirt = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned virtualization", assetTypeId: VIRTUALIZATION_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareFs = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned file sharing", assetTypeId: FILE_SHARING_TYPE_ID, assetFields: {}, ...CL })).record;
        const barePrint = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned printing", assetTypeId: PRINTING_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareSet = await world.docs.get(set.id, { force: true });

        assert(!securityCoverage(bareSec, bareSet).configurations && !remoteAccessCoverage(bareRa, bareSet).security && !virtualizationCoverage(bareVirt, bareSet).hosts && !fileSharingCoverage(bareFs, bareSet).backup && !printingCoverage(barePrint, bareSet).configurations, "bare records cover nothing");

        const sec = securityPlatformIssues(bareSet);
        assertEq(sec.length, 6, "six gaps flagged for a bare security platform");
        for (const code of ["security-no-product", "security-no-type", "security-no-scope", "security-no-configurations", "security-no-credential", "security-no-vendor"]) assert(codes(sec).includes(code), "security flags " + code);
        const ra = remoteAccessIssues(bareSet);
        assertEq(ra.length, 5, "five gaps flagged for bare remote access");
        for (const code of ["remote-no-method", "remote-no-endpoint", "remote-no-mfa", "remote-no-security", "remote-no-credential"]) assert(codes(ra).includes(code), "remote access flags " + code);
        const virt = virtualizationIssues(bareSet);
        assertEq(virt.length, 4, "four gaps flagged for bare virtualization");
        for (const code of ["virt-no-platform", "virt-no-hosts", "virt-no-credential", "virt-no-document"]) assert(codes(virt).includes(code), "virtualization flags " + code);
        const fs = fileSharingIssues(bareSet);
        assertEq(fs.length, 4, "four gaps flagged for bare file sharing");
        for (const code of ["file-no-storage-type", "file-no-server", "file-no-shares", "file-no-backup"]) assert(codes(fs).includes(code), "file sharing flags " + code);
        const pr = printingIssues(bareSet);
        assertEq(pr.length, 3, "three gaps flagged for bare printing");
        for (const code of ["print-no-type", "print-no-device", "print-no-service-model"]) assert(codes(pr).includes(code), "printing flags " + code);
        assert([...sec, ...ra, ...virt, ...fs, ...pr].every((i) => i.level === "warning"), "gaps are warnings, not errors");

        const folded = standardizedIssues(bareSet);
        assert(codes(folded).includes("security-no-product") && codes(folded).includes("remote-no-method") && codes(folded).includes("virt-no-platform") && codes(folded).includes("file-no-storage-type") && codes(folded).includes("print-no-type"), "the linter folds the service audits in");
        assertEq(serviceAssetIssues(bareSet).length, 22, "the combined service audit reports every gap");
        assert((await world.docs.integrity(set.id)).ok, "completeness gaps never fail the graph audit");

        const s = await seed(world);
        await linkAll(world, s);
        const fullSet = await world.docs.get(s.set.id, { force: true });
        assertEq(securityPlatformIssues(fullSet).length, 0, "a fully documented security platform raises no issues: " + JSON.stringify(securityPlatformIssues(fullSet)));
        assertEq(remoteAccessIssues(fullSet).length, 0, "fully documented remote access raises no issues: " + JSON.stringify(remoteAccessIssues(fullSet)));
        assertEq(virtualizationIssues(fullSet).length, 0, "fully documented virtualization raises no issues: " + JSON.stringify(virtualizationIssues(fullSet)));
        assertEq(fileSharingIssues(fullSet).length, 0, "fully documented file sharing raises no issues: " + JSON.stringify(fileSharingIssues(fullSet)));
        assertEq(printingIssues(fullSet).length, 0, "fully documented printing raises no issues: " + JSON.stringify(printingIssues(fullSet)));
      },
    },
  ]);
}
