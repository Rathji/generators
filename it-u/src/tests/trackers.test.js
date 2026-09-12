// src/tests/trackers.test.js — validation tests for roadmap tasks 24–25
// (the Domain Tracker and the SSL Certificate Tracker). Run in the live page:
//   await import("./src/tests/trackers.test.js").then((m) => m.run())
//
// Covers: the DNS record-type catalog and the domain record's helpers
// (normalizing a name, the DNS list, the summary); domain expiry classification
// against its alert window; validation (a domain needs a real name); the unified
// audit; and the best-effort LIVE LOOKUPS (DNS-over-HTTPS + RDAP for a domain,
// crt.sh for a certificate) — each driven by a stubbed fetch so the tests never
// touch the network. It then does the same for certificates: hostname handling
// (with wildcards and SAN coverage), expiry classification, validation (port
// range) and the audit (a dangling private-key / protected-service reference).
// Finally it runs both record types through the docs service (create, link,
// classify) to prove they are first-class in the graph.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld, assertThrowsCode } from "./testFixtures.js";
import {
  DNS_RECORD_TYPES,
  DNS_DEFAULT_QUERIES,
  dnsRecordType,
  dnsTypeByCode,
  DOMAIN_STATUSES,
  domainStatus,
  DOMAIN_FIELDS,
  normalizeDomainName,
  isValidDomainName,
  normalizeDnsRecords,
  makeDnsRecord,
  dnsRecords,
  dnsRecordsOfType,
  dnsSummary,
  domainExpiryStatus,
  validateDomain,
  requireDomain,
  domainDetailLine,
  domainIssues,
  lookupDomain,
} from "../framework/domain.js";
import {
  CERTIFICATE_FIELDS,
  normalizeHostname,
  isValidHostname,
  isWildcard,
  normalizeHostnameList,
  subjectAltNames,
  coversHostname,
  certificateExpiryStatus,
  validateCertificate,
  requireCertificate,
  certificateDetailLine,
  certificateIssues,
  lookupCertificate,
} from "../framework/certificate.js";
import { validateRecordFields, recordDetailLine, standardizedIssues, RECORD_FIELD_SCHEMAS } from "../framework/standardized.js";

const C = { informationModel: "core-asset", provenance: "authored" };
const NOW = new Date(2026, 5, 15).getTime(); // local midnight, 15 June 2026

function ok(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}
function bad(status) {
  return { ok: false, status, json: async () => ({}) };
}

export async function run() {
  return runTests([
    // ---- task 24: the Domain Tracker ---------------------------------------
    {
      name: "the DNS record-type catalog and the domain status catalog ship the expected types",
      fn: () => {
        const ids = DNS_RECORD_TYPES.map((t) => t.id);
        for (const id of ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA"]) {
          assert(ids.includes(id), "ships DNS type " + id);
        }
        assertEq(dnsRecordType("MX").priority, true, "MX carries a priority");
        assertEq(dnsRecordType("A").code, 1, "A is code 1");
        assertEq(dnsTypeByCode(28).id, "AAAA", "code 28 is AAAA");
        assertEq(dnsRecordType("nope"), null, "unknown DNS type is null");
        assert(DNS_DEFAULT_QUERIES.includes("A") && DNS_DEFAULT_QUERIES.includes("MX"), "default queries cover A and MX");
        const statuses = DOMAIN_STATUSES.map((s) => s.id);
        for (const s of ["active", "client-hold", "pending", "redemption", "expired", "unknown"]) assert(statuses.includes(s), "ships status " + s);
        assertEq(domainStatus("active").label, "Active", "status label");
        assertEq(domainStatus("nope"), null, "unknown status is null");
        const keys = DOMAIN_FIELDS.map((f) => f.key);
        assert(keys.includes("expiresAt"), "schema declares expiry");
        assert(keys.includes("renewalAlertDays"), "schema declares the alert lead time");
      },
    },
    {
      name: "a domain name is normalized and validated (scheme, path, port, email, wildcard)",
      fn: () => {
        assertEq(normalizeDomainName("HTTPS://WWW.Example.COM:8443/path?q=1"), "www.example.com", "strips scheme, port and path");
        assertEq(normalizeDomainName("  Example.com.  "), "example.com", "trims and drops the trailing dot");
        assertEq(normalizeDomainName("bob@example.com"), "example.com", "takes the domain out of an email");
        assertEq(normalizeDomainName("*.example.com"), "example.com", "drops a wildcard prefix");
        assert(isValidDomainName("example.com"), "a plain domain is valid");
        assert(isValidDomainName("sub.example.co.uk"), "a subdomain is valid");
        assert(!isValidDomainName("localhost"), "a bare label is invalid");
        assert(!isValidDomainName("exa mple.com"), "a space is invalid");
        assert(!isValidDomainName(""), "empty is invalid");
      },
    },
    {
      name: "DNS records normalize, group by type and summarise",
      fn: () => {
        const list = normalizeDnsRecords([
          { type: "a", name: "example.com", value: "93.184.216.34", ttl: 300 },
          { type: "MX", name: "example.com", value: "mail.example.com", priority: 10 },
          { type: "mx", name: "example.com", value: "backup.example.com", priority: 20 },
          null,
          "junk",
        ]);
        assertEq(list.length, 3, "non-object entries dropped");
        assertEq(list[0].type, "A", "lower-case type normalised to A");
        assertEq(list[0].ttl, 300, "ttl kept");
        assert(list[0].id.startsWith("dns_"), "record got an id");
        assertEq(dnsRecordsOfType({ dnsRecords: list }, "MX").length, 2, "two MX records");
        assertEq(dnsSummary({ dnsRecords: list }), "A ×1 · MX ×2", "summary groups by type");
        assertEq(dnsSummary({}), "no DNS records", "empty summary");
        const made = makeDnsRecord({ type: "TXT", name: "example.com", value: "v=spf1" });
        assertEq(made.type, "TXT", "makeDnsRecord builds a record");
        assertEq(normalizeDnsRecords(null).length, 0, "non-list yields nothing");
      },
    },
    {
      name: "domain expiry classifies overdue / due-soon / upcoming / ok / none against the alert window",
      fn: () => {
        assertEq(domainExpiryStatus({}, { now: NOW }).state, "none", "no date");
        assertEq(domainExpiryStatus({ expiresAt: "2026-06-10" }, { now: NOW }).state, "overdue", "past");
        assertEq(domainExpiryStatus({ expiresAt: "2026-06-10" }, { now: NOW }).label, "Expired 5 days ago", "overdue label");
        assertEq(domainExpiryStatus({ expiresAt: "2026-06-15" }, { now: NOW }).state, "due-soon", "today is due soon");
        assertEq(domainExpiryStatus({ expiresAt: "2026-06-25" }, { now: NOW }).state, "due-soon", "within 14 days");
        assertEq(domainExpiryStatus({ expiresAt: "2026-07-01" }, { now: NOW }).state, "upcoming", "16 days is upcoming");
        assertEq(domainExpiryStatus({ expiresAt: "2026-12-01" }, { now: NOW }).state, "ok", "months away is ok");
        assertEq(domainExpiryStatus({ expiresAt: "2026-06-15" }, { now: NOW }).iso, "2026-06-15", "iso date reported");
        // The per-record lead time widens or narrows the window.
        assertEq(domainExpiryStatus({ expiresAt: "2026-09-01" }, { now: NOW }).state, "ok", "78 days is ok by default");
        assertEq(domainExpiryStatus({ expiresAt: "2026-09-01", renewalAlertDays: 120 }, { now: NOW }).state, "upcoming", "78 days is upcoming with a 120-day lead");
        assertEq(domainExpiryStatus({ expiresAt: "2026-06-20", renewalAlertDays: 5 }, { now: NOW }).state, "due-soon", "5 days is due soon with a 5-day lead");
      },
    },
    {
      name: "a domain needs a valid name and a sane expiry / alert window; requireDomain throws",
      fn: () => {
        assert(!validateDomain({ name: "localhost" }).ok, "invalid name refused");
        assert(validateDomain({ name: "example.com" }).ok, "valid name passes");
        assert(!validateDomain({ name: "example.com", expiresAt: "not-a-date" }).ok, "bad date refused");
        assert(validateDomain({ name: "example.com", expiresAt: "2027-01-01" }).ok, "good date passes");
        assert(!validateDomain({ name: "example.com", renewalAlertDays: -1 }).ok, "negative lead refused");
        assert(validateDomain({ name: "example.com", renewalAlertDays: 0 }).ok, "zero lead allowed");
        let threw = null;
        try {
          requireDomain({ id: "dom_1", name: "bad name" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireDomain throws INVALID_DATA");
      },
    },
    {
      name: "domainDetailLine and the domain audit summarise and flag domains",
      fn: () => {
        const line = domainDetailLine({ name: "example.com", registrar: "Cloudflare", expiresAt: "2026-06-10", dnsRecords: [makeDnsRecord({ type: "A", value: "1.2.3.4" })] });
        assert(line.includes("Cloudflare"), "names the registrar");
        assert(line.includes("2026-06-10"), "names the expiry");
        assert(line.includes("(expired)"), "marks an expired registration");
        assert(line.includes("1 DNS record"), "counts DNS records");
        const issues = domainIssues({
          records: {
            domains: [
              { id: "d1", type: "domains", name: "localhost" },
              { id: "d2", type: "domains", name: "old.example.com", expiresAt: "2001-01-01" },
              { id: "d3", type: "domains", name: "soon.example.com", expiresAt: isoFromNow(5) },
              { id: "d4", type: "domains", name: "nodate.example.com" },
              { id: "d5", type: "domains", name: "fine.example.com", expiresAt: isoFromNow(400) },
            ],
          },
        });
        assert(issues.some((i) => i.code === "invalid-domain-name" && i.recordId === "d1" && i.level === "error"), "invalid name flagged");
        assert(issues.some((i) => i.code === "domain-expired" && i.recordId === "d2" && i.level === "error"), "expired flagged");
        assert(issues.some((i) => i.code === "domain-expiring" && i.recordId === "d3" && i.level === "warning"), "expiring flagged");
        assert(issues.some((i) => i.code === "domain-no-expiry" && i.recordId === "d4" && i.level === "warning"), "no expiry flagged");
        assert(!issues.some((i) => i.recordId === "d5"), "a fine domain is not flagged");
      },
    },
    {
      name: "lookupDomain folds DoH DNS answers and RDAP registration details into one result",
      fn: async () => {
        const dnsByType = {
          A: { Answer: [{ name: "example.com", type: 1, TTL: 300, data: "93.184.216.34" }] },
          AAAA: { Answer: [{ name: "example.com", type: 28, TTL: 300, data: "2606:2800::1" }] },
          CNAME: { Answer: [] },
          MX: { Answer: [{ name: "example.com", type: 15, TTL: 300, data: "10 mail.example.com." }] },
          TXT: { Answer: [{ name: "example.com", type: 16, TTL: 300, data: '"v=spf1 -all"' }] },
          NS: { Answer: [{ name: "example.com", type: 2, TTL: 300, data: "ns1.example.com." }] },
        };
        const rdap = {
          events: [
            { eventAction: "registration", eventDate: "2019-05-01T00:00:00Z" },
            { eventAction: "expiration", eventDate: "2027-05-01T00:00:00Z" },
            { eventAction: "last changed", eventDate: "2024-02-02T00:00:00Z" },
          ],
          nameservers: [{ ldhName: "NS1.EXAMPLE.COM" }, { ldhName: "ns2.example.com" }],
          entities: [
            { roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Acme Registrar"]]], publicIds: [{ type: "IANA Registrar ID", identifier: "1234" }] },
            { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Acme Inc"]]] },
          ],
          status: ["active"],
          secureDNS: { delegationSigned: true },
        };
        const fetchImpl = async (url) => {
          const u = new URL(url);
          if (u.hostname === "cloudflare-dns.com") return ok(dnsByType[u.searchParams.get("type")] || { Answer: [] });
          if (u.hostname === "rdap.org") return ok(rdap);
          throw new Error("unexpected host " + u.hostname);
        };
        const result = await lookupDomain("Example.com", { fetchImpl });
        assert(result.ok, "lookup succeeded");
        assertEq(result.name, "example.com", "name normalised");
        assertEq(result.apex, "example.com", "apex computed");
        assertEq(result.dns.length, 5, "five DNS entries (empty CNAME omitted)");
        const mx = result.dns.find((r) => r.type === "MX");
        assertEq(mx.priority, 10, "MX priority parsed out of the answer");
        assertEq(mx.value, "mail.example.com.", "MX target kept");
        assertEq(result.dns.find((r) => r.type === "TXT").value, "v=spf1 -all", "TXT quotes stripped");
        assertEq(result.dns.find((r) => r.type === "A").value, "93.184.216.34", "A value");
        assertEq(result.registration.expiresAt, "2027-05-01", "RDAP expiry");
        assertEq(result.registration.registeredAt, "2019-05-01", "RDAP registration");
        assertEq(result.registration.lastChangedAt, "2024-02-02", "RDAP last changed");
        assertEq(result.registration.registrar, "Acme Registrar", "registrar name from vcard");
        assertEq(result.registration.registrarId, "1234", "registrar IANA id");
        assertEq(result.registration.registrant, "Acme Inc", "registrant name from vcard");
        assertEq(result.registration.nameservers.join(","), "ns1.example.com,ns2.example.com", "nameservers lower-cased");
        assertEq(result.registration.status, "active", "status");
        assertEq(result.registration.dnssec, true, "DNSSEC flag");
        assertEq(result.errors.length, 0, "no errors");
      },
    },
    {
      name: "lookupDomain reports partial failures instead of throwing",
      fn: async () => {
        const empty = await lookupDomain("", { fetchImpl: async () => ok({}) });
        assert(!empty.ok, "empty name fails");
        assert(empty.errors.some((e) => e.toLowerCase().includes("enter a domain")), "asks for a name");

        const partial = await lookupDomain("example.com", {
          fetchImpl: async (url) => {
            const u = new URL(url);
            if (u.hostname === "cloudflare-dns.com") {
              if (u.searchParams.get("type") === "A") return bad(500);
              return ok({ Answer: [{ name: "example.com", type: 2, TTL: 60, data: "ns1.example.com." }] });
            }
            return ok({ events: [{ eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" }] });
          },
        });
        assert(partial.ok, "a partial result is still ok");
        assert(partial.errors.some((e) => e.includes("DNS A")), "the failed DNS query is reported");
        assert(partial.registration.expiresAt === "2030-01-01", "the RDAP half still landed");

        const dead = await lookupDomain("example.com", {
          fetchImpl: async () => {
            throw new Error("network down");
          },
        });
        assert(!dead.ok, "a total failure is not ok");
        assert(dead.errors.length >= 2, "errors from both DNS and RDAP are collected");
      },
    },

    // ---- task 25: the SSL Certificate Tracker ------------------------------
    {
      name: "a hostname is normalised and validated, and wildcards are recognised",
      fn: () => {
        assertEq(normalizeHostname("HTTPS://WWW.Example.COM:443/path"), "www.example.com", "strips scheme, port and path");
        assertEq(normalizeHostname("*.example.com"), "*.example.com", "keeps a leading wildcard");
        assert(isValidHostname("www.example.com"), "plain host valid");
        assert(isValidHostname("*.example.com"), "wildcard host valid");
        assert(!isValidHostname("example"), "bare label invalid");
        assert(!isValidHostname("bad_host.example.com"), "underscore invalid");
        assert(isWildcard("*.example.com"), "wildcard detected");
        assert(!isWildcard("www.example.com"), "non-wildcard detected");
        const keys = CERTIFICATE_FIELDS.map((f) => f.key);
        for (const k of ["port", "subjectAltNames", "issuer", "validTo", "fingerprintSha256", "privateKeyRef", "protectedServiceRef", "wildcard"]) {
          assert(keys.includes(k), "certificate schema declares " + k);
        }
      },
    },
    {
      name: "subject alternative names normalise, de-duplicate, and a wildcard covers one level",
      fn: () => {
        assertEq(normalizeHostnameList("A.example.com, b.example.com\nA.example.com").join(","), "a.example.com,b.example.com", "list split and de-duplicated");
        assertEq(normalizeHostnameList(["www.example.com", "www.example.com"]).length, 1, "array de-duplicated");
        assertEq(subjectAltNames({ subjectAltNames: "www.example.com" }).join(","), "www.example.com", "SAN helper");
        const cert = { name: "www.example.com", subjectAltNames: ["example.com", "*.example.com"] };
        assert(coversHostname(cert, "www.example.com"), "exact name covered");
        assert(coversHostname(cert, "example.com"), "a SAN covered");
        assert(coversHostname(cert, "mail.example.com"), "wildcard covers one level");
        assert(!coversHostname(cert, "a.b.example.com"), "wildcard does not cover two levels");
        assert(!coversHostname(cert, "other.org"), "unrelated host not covered");
        assert(!coversHostname(cert, ""), "empty target not covered");
      },
    },
    {
      name: "certificate expiry classifies against its alert window",
      fn: () => {
        assertEq(certificateExpiryStatus({}, { now: NOW }).state, "none", "no date");
        assertEq(certificateExpiryStatus({ validTo: "2026-06-01" }, { now: NOW }).state, "overdue", "past");
        assertEq(certificateExpiryStatus({ validTo: "2026-06-15" }, { now: NOW }).state, "due-soon", "today");
        assertEq(certificateExpiryStatus({ validTo: "2026-06-25" }, { now: NOW }).state, "due-soon", "within 14 days");
        assertEq(certificateExpiryStatus({ validTo: "2026-07-01" }, { now: NOW }).state, "upcoming", "16 days, within the 30-day lead");
        assertEq(certificateExpiryStatus({ validTo: "2026-09-01" }, { now: NOW }).state, "ok", "months away");
        assertEq(certificateExpiryStatus({ validTo: "2026-06-15" }, { now: NOW }).iso, "2026-06-15", "iso date");
        assertEq(certificateExpiryStatus({ validTo: "2026-07-01", renewalAlertDays: 0 }, { now: NOW }).state, "ok", "a zero-day lead narrows the window");
      },
    },
    {
      name: "a certificate needs a valid hostname and a port in range; requireCertificate throws",
      fn: () => {
        assert(!validateCertificate({}).ok, "missing hostname refused");
        assert(validateCertificate({ name: "www.example.com" }).ok, "hostname alone passes");
        assert(!validateCertificate({ name: "www.example.com", port: "0" }).ok, "port 0 refused");
        assert(!validateCertificate({ name: "www.example.com", port: "70000" }).ok, "port above range refused");
        assert(validateCertificate({ name: "www.example.com", port: "8443" }).ok, "port 8443 passes");
        assert(!validateCertificate({ name: "www.example.com", validTo: "not-a-date" }).ok, "bad expiry refused");
        let threw = null;
        try {
          requireCertificate({ id: "cert_1", name: "bad host" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireCertificate throws INVALID_DATA");
      },
    },
    {
      name: "certificateDetailLine and the certificate audit summarise and flag certificates",
      fn: () => {
        const line = certificateDetailLine({ name: "www.example.com", port: 443, issuer: "Let's Encrypt", validTo: "2026-04-01" });
        assert(line.includes("www.example.com:443"), "host and port");
        assert(line.includes("Let's Encrypt"), "issuer");
        assert(line.includes("2026-04-01"), "expiry");
        const issues = certificateIssues({
          records: {
            passwords: [],
            configurations: [],
            certificates: [
              { id: "c1", type: "certificates", name: "bad host" },
              { id: "c2", type: "certificates", name: "old.example.com", validTo: "2001-01-01" },
              { id: "c3", type: "certificates", name: "soon.example.com", validTo: isoFromNow(5) },
              { id: "c4", type: "certificates", name: "nodate.example.com" },
              { id: "c5", type: "certificates", name: "key.example.com", validTo: isoFromNow(400), privateKeyRef: { type: "passwords", id: "pwd_missing" } },
              { id: "c6", type: "certificates", name: "svc.example.com", validTo: isoFromNow(400), protectedServiceRef: { type: "configurations", id: "cfg_missing" } },
              { id: "c7", type: "certificates", name: "fine.example.com", validTo: isoFromNow(400) },
            ],
          },
        });
        assert(issues.some((i) => i.code === "invalid-cert-hostname" && i.recordId === "c1" && i.level === "error"), "invalid hostname flagged");
        assert(issues.some((i) => i.code === "certificate-expired" && i.recordId === "c2" && i.level === "error"), "expired flagged");
        assert(issues.some((i) => i.code === "certificate-expiring" && i.recordId === "c3" && i.level === "warning"), "expiring flagged");
        assert(issues.some((i) => i.code === "certificate-no-expiry" && i.recordId === "c4" && i.level === "warning"), "no expiry flagged");
        assert(issues.some((i) => i.code === "certificate-missing-key" && i.recordId === "c5" && i.level === "error"), "dangling private key flagged");
        assert(issues.some((i) => i.code === "certificate-missing-service" && i.recordId === "c6" && i.level === "error"), "dangling protected service flagged");
        assert(!issues.some((i) => i.recordId === "c7"), "a fine certificate is not flagged");
      },
    },
    {
      name: "lookupCertificate picks the newest matching entry from the transparency logs",
      fn: async () => {
        const entries = [
          { common_name: "www.example.com", name_value: "www.example.com\nexample.com", issuer_name: "C=US, O=Let's Encrypt, CN=R3", serial_number: "0A1B", not_before: "2026-01-01T00:00:00Z", not_after: "2026-04-01T00:00:00Z" },
          { common_name: "www.example.com", name_value: "www.example.com", issuer_name: "Old CA", not_before: "2025-01-01T00:00:00Z", not_after: "2025-04-01T00:00:00Z" },
          { common_name: "other.example.com", name_value: "other.example.com", issuer_name: "Other CA", not_before: "2026-01-01T00:00:00Z", not_after: "2026-06-01T00:00:00Z" },
        ];
        const fetchImpl = async (url) => {
          assert(String(url).includes("crt.sh"), "queries crt.sh");
          assert(String(url).includes("output=json"), "asks for JSON");
          return ok(entries);
        };
        const result = await lookupCertificate("WWW.Example.com", { fetchImpl });
        assert(result.ok, "lookup succeeded");
        assertEq(result.hostname, "www.example.com", "hostname normalised");
        assertEq(result.certificate.subject, "www.example.com", "newest exact match chosen");
        assertEq(result.certificate.validTo, "2026-04-01", "newest expiry used");
        assertEq(result.certificate.validFrom, "2026-01-01", "valid-from used");
        assert(result.certificate.issuer.includes("Let's Encrypt"), "issuer carried");
        assertEq(result.certificate.subjectAltNames.join(","), "www.example.com,example.com", "SANs split from name_value");
        assertEq(result.errors.length, 0, "no errors");
      },
    },
    {
      name: "lookupCertificate reports empty input, HTTP failures and no-match without throwing",
      fn: async () => {
        const empty = await lookupCertificate("", { fetchImpl: async () => ok([]) });
        assert(!empty.ok, "empty hostname fails");
        assert(empty.errors.some((e) => e.toLowerCase().includes("enter a hostname")), "asks for a hostname");

        const httpErr = await lookupCertificate("www.example.com", { fetchImpl: async () => bad(500) });
        assert(!httpErr.ok, "HTTP failure fails");
        assert(httpErr.errors.some((e) => e.includes("HTTP 500")), "reports the HTTP status");

        const noMatch = await lookupCertificate("www.example.com", { fetchImpl: async () => ok([]) });
        assert(!noMatch.ok, "no entries fails");
        assert(noMatch.errors.some((e) => e.toLowerCase().includes("no certificate")), "reports the miss");

        const dead = await lookupCertificate("www.example.com", {
          fetchImpl: async () => {
            throw new Error("down");
          },
        });
        assert(!dead.ok, "a thrown error is caught");
        assert(dead.errors.some((e) => e.includes("down")), "the error is reported");
      },
    },
    {
      name: "domains and certificates are validated by the standardized registry and summarised",
      fn: () => {
        assert(RECORD_FIELD_SCHEMAS.domains, "domains has a schema");
        assert(RECORD_FIELD_SCHEMAS.certificates, "certificates has a schema");
        assert(!validateRecordFields("domains", { name: "localhost" }).ok, "domain validation wired in");
        assert(validateRecordFields("domains", { name: "example.com" }).ok, "valid domain passes");
        assert(!validateRecordFields("certificates", { name: "bad" }).ok, "certificate validation wired in");
        assert(validateRecordFields("certificates", { name: "www.example.com" }).ok, "valid certificate passes");
        assertEq(recordDetailLine({ type: "domains", name: "example.com" }).includes("no expiry date"), true, "domain detail line wired");
        assert(recordDetailLine({ type: "certificates", name: "www.example.com" }).startsWith("www.example.com"), "certificate detail line wired");
        const issues = standardizedIssues({ records: { domains: [{ id: "d1", type: "domains", name: "localhost" }], certificates: [] } });
        assert(issues.some((i) => i.code === "invalid-domain-name"), "unified audit includes domains");
      },
    },
    {
      name: "a domain and a certificate are created and linked through the docs service",
      fn: async () => {
        const { docs } = await makeWorld("kb-tracker-flow");
        const set = await docs.create({ name: "Acme" });
        const dom = (await docs.addRecord(set.id, { type: "domains", name: "example.com", expiresAt: "2027-05-01", registrar: "Cloudflare", dnsRecords: [makeDnsRecord({ type: "A", value: "93.184.216.34" })], ...C })).record;
        assert(dom.id.startsWith("dom_"), "domain id prefix");
        const cert = (await docs.addRecord(set.id, { type: "certificates", name: "www.example.com", port: 443, validTo: "2026-09-01", issuer: "Let's Encrypt", ...C })).record;
        assert(cert.id.startsWith("cert_"), "certificate id prefix");
        await docs.linkRecords(set.id, { from: { type: "certificates", id: cert.id }, to: { type: "domains", id: dom.id }, kind: "certificate-service" });
        const live = await docs.get(set.id);
        assertEq(live.records.domains.length, 1, "domain persisted");
        assertEq(live.records.domains[0].dnsRecords.length, 1, "DNS records persisted on the domain");
        assertEq(live.records.certificates.length, 1, "certificate persisted");
        assert(live.records.relationships.some((r) => r.kind === "certificate-service" && r.from.id === cert.id && r.to.id === dom.id), "certificate → domain link recorded");
        // A certificate may not point at a domain with the domain-only kind.
        await assertThrowsCode(() => docs.linkRecords(set.id, { from: { type: "domains", id: dom.id }, to: { type: "certificates", id: cert.id }, kind: "certificate-service" }), "INVALID_DATA", "wrong direction refused");
      },
    },
  ]);
}

function isoIn(days) {
  const d = new Date(NOW + days * 86400000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Dates for the audits, which classify against the real current date.
function isoFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

