// src/framework/domain.js — the Domain Tracker (roadmap Phase 6, task 24).
//
// An internet-facing DOMAIN is a standardized record: the registrable name, its
// registrar and registrant, its name servers, its registration status and — the
// fact the tracker exists for — when it EXPIRES. Domains link to the email
// systems, applications, passwords, vendors and configurations that depend on
// them, so "what breaks if this lapses?" is one link.
//
//   • expiry classification reuses the same overdue / due-soon / upcoming / ok
//     vocabulary as the rest of the lifecycle engine (./renewals.js);
//   • `dnsRecords` holds the domain's live DNS entries (A/AAAA/CNAME/MX/TXT/NS/
//     SOA/SRV/CAA) so the resolution is documented next to the registration;
//   • `lookupDomain` retrieves, best-effort, the DNS entries over DNS-over-HTTPS
//     and the registration details over RDAP — both public, CORS-friendly JSON
//     APIs — filling the record rather than making a technician retype them.
//
// The lookup is deliberately isolated behind a `fetchImpl` so it is unit-tested
// with a stub and never depends on the network being reachable.

import { StoreError, CODES } from "./store/errors.js";
import { parseDate } from "./renewals.js";

// The DNS record types worth capturing for a client's domains.
export const DNS_RECORD_TYPES = [
  { id: "A", label: "A", code: 1, description: "IPv4 address" },
  { id: "AAAA", label: "AAAA", code: 28, description: "IPv6 address" },
  { id: "CNAME", label: "CNAME", code: 5, description: "Canonical name (alias)" },
  { id: "MX", label: "MX", code: 15, description: "Mail exchanger", priority: true },
  { id: "TXT", label: "TXT", code: 16, description: "Text (SPF, DKIM, verification)" },
  { id: "NS", label: "NS", code: 2, description: "Name server" },
  { id: "SOA", label: "SOA", code: 6, description: "Start of authority" },
  { id: "SRV", label: "SRV", code: 33, description: "Service locator", priority: true },
  { id: "CAA", label: "CAA", code: 257, description: "Certificate authority authorisation" },
];

export const DNS_DEFAULT_QUERIES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"];
export const dnsRecordType = (id) => DNS_RECORD_TYPES.find((t) => t.id === id) || null;
export const dnsTypeByCode = (code) => DNS_RECORD_TYPES.find((t) => t.code === Number(code)) || null;

// Registration statuses a registrar reports (kept short and human).
export const DOMAIN_STATUSES = [
  { id: "active", label: "Active" },
  { id: "client-hold", label: "Client hold" },
  { id: "pending", label: "Pending" },
  { id: "redemption", label: "Redemption period" },
  { id: "expired", label: "Expired" },
  { id: "unknown", label: "Unknown" },
];
export const domainStatus = (id) => DOMAIN_STATUSES.find((s) => s.id === id) || null;

export const DOMAIN_FIELDS = [
  { key: "registrar", label: "Registrar", type: "text", placeholder: "e.g. GoDaddy, Cloudflare Registrar" },
  { key: "registrant", label: "Registrant / owner", type: "text", placeholder: "Who the domain is registered to" },
  { key: "provider", label: "DNS provider", type: "text", placeholder: "Where DNS is hosted" },
  { key: "registrationStatus", label: "Registration status", type: "select", options: DOMAIN_STATUSES, default: "unknown" },
  { key: "expiresAt", label: "Expiry date", type: "date", help: "The date the registration lapses — the whole point of the tracker." },
  { key: "autoRenew", label: "Auto-renew", type: "checkbox" },
  { key: "dnssec", label: "DNSSEC", type: "checkbox" },
  { key: "nameservers", label: "Name servers", type: "textarea", placeholder: "One per line" },
  { key: "renewalAlertDays", label: "Alert lead time (days)", type: "number", placeholder: "60" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// ---- domain name handling --------------------------------------------------
// A registrable domain, normalized: lower-cased, no scheme/path/port, no
// trailing dot, no surrounding whitespace.
export function normalizeDomainName(value) {
  let s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
  s = s.split(/[/?#]/)[0]; // strip path/query/fragment
  s = s.split("@").pop(); // strip any local part of an email address
  s = s.replace(/:\d+$/, ""); // strip port
  s = s.replace(/\.+$/, ""); // strip trailing dot(s)
  s = s.replace(/^\*\./, ""); // strip a wildcard prefix
  return s;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isValidDomainName(value) {
  const s = normalizeDomainName(value);
  return DOMAIN_RE.test(s);
}

// ---- DNS records -----------------------------------------------------------
export function normalizeDnsRecords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      id: r.id || makeDnsRecordId(),
      type: dnsRecordType(r.type) ? r.type : String(r.type || "").trim().toUpperCase(),
      name: String(r.name || "").trim(),
      value: String(r.value == null ? "" : r.value).trim(),
      ttl: Number.isFinite(Number(r.ttl)) && Number(r.ttl) > 0 ? Number(r.ttl) : null,
      priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : null,
    }));
}

export function makeDnsRecordId() {
  return "dns_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function makeDnsRecord({ type = "A", name = "", value = "", ttl = null, priority = null } = {}) {
  return normalizeDnsRecords([{ id: makeDnsRecordId(), type, name, value, ttl, priority }])[0];
}

export const dnsRecords = (record) => normalizeDnsRecords(record && record.dnsRecords);

export function dnsRecordsOfType(record, type) {
  const t = String(type || "").toUpperCase();
  return dnsRecords(record).filter((r) => r.type === t);
}

// A one-line summary of the DNS entries: "A ×1 · MX ×2 · TXT ×3", or the count.
export function dnsSummary(record) {
  const list = dnsRecords(record);
  if (!list.length) return "no DNS records";
  const byType = {};
  for (const r of list) byType[r.type] = (byType[r.type] || 0) + 1;
  return Object.keys(byType)
    .map((t) => t + " ×" + byType[t])
    .join(" · ");
}

// ---- expiry (task 24 + the task-26 vocabulary) -----------------------------
// Classify the registration's expiry: overdue / due-soon / upcoming / ok / none.
// `renewalAlertDays` may override the default lead time.
export function domainExpiryStatus(record, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const dueSoonDays = opts.dueSoonDays != null ? opts.dueSoonDays : 14;
  const alert = Number.isFinite(Number(record && record.renewalAlertDays)) && Number(record.renewalAlertDays) >= 0 ? Number(record.renewalAlertDays) : opts.alertDays != null ? opts.alertDays : 60;
  const date = parseDate(record && record.expiresAt);
  if (!date) return { state: "none", date: null, iso: null, daysUntil: null, alert, label: "No expiry date" };
  const start = new Date(now);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const daysUntil = Math.round((date.getTime() - midnight) / 86400000);
  let state;
  if (daysUntil < 0) state = "overdue";
  else if (daysUntil <= Math.min(alert, dueSoonDays)) state = "due-soon";
  else if (daysUntil <= alert) state = "upcoming";
  else state = "ok";
  const label =
    state === "overdue"
      ? `Expired ${-daysUntil} day${-daysUntil === 1 ? "" : "s"} ago`
      : state === "due-soon"
        ? `Expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
        : state === "upcoming"
          ? `Expires in ${daysUntil} days`
          : `Expires in ${daysUntil} days`;
  return { state, date, iso: date.toISOString().slice(0, 10), daysUntil, alert, label };
}

// ---- validation ------------------------------------------------------------
export function validateDomain(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A domain must be an object."] };
  if (!isValidDomainName(record.name)) {
    errors.push("A domain record needs a valid registrable domain name in its Name (e.g. example.com).");
  }
  if (!isBlank(record.expiresAt) && !parseDate(record.expiresAt)) {
    errors.push("The domain's expiry date is not a valid date.");
  }
  if (!isBlank(record.renewalAlertDays) && !(Number(record.renewalAlertDays) >= 0)) {
    errors.push("The alert lead time must be zero or more days.");
  }
  return { ok: errors.length === 0, errors };
}

export function requireDomain(record) {
  const { ok, errors } = validateDomain(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this domain";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// ---- detail line & audit ---------------------------------------------------
export function domainDetailLine(record, set) {
  if (!record) return "";
  const bits = [];
  if (record.registrar) bits.push(record.registrar);
  if (record.expiresAt) {
    const st = domainExpiryStatus(record);
    bits.push("expires " + st.iso + (st.state === "overdue" ? " (expired)" : ""));
  } else {
    bits.push("no expiry date");
  }
  const dns = dnsRecords(record).length;
  bits.push(dns ? dns + " DNS record" + (dns === 1 ? "" : "s") : "no DNS records");
  return bits.join(" · ");
}

export function domainIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.domains || []) {
    if (!isValidDomainName(r.name)) {
      issues.push({ level: "error", code: "invalid-domain-name", recordId: r.id, message: `Domain “${r.name}” is not a valid registrable domain name.` });
    }
    const st = domainExpiryStatus(r);
    if (st.state === "overdue") {
      issues.push({ level: "error", code: "domain-expired", recordId: r.id, message: `Domain “${r.name}” has expired (${st.iso}).` });
    } else if (st.state === "due-soon") {
      issues.push({ level: "warning", code: "domain-expiring", recordId: r.id, message: `Domain “${r.name}” expires in ${st.daysUntil} day(s).` });
    } else if (st.state === "none") {
      issues.push({ level: "warning", code: "domain-no-expiry", recordId: r.id, message: `Domain “${r.name}” has no expiry date recorded — the tracker cannot watch it.` });
    }
  }
  return issues;
}

// ---- best-effort live lookup (task 24) -------------------------------------
// Retrieve DNS entries over DNS-over-HTTPS (Cloudflare) and registration details
// over RDAP, and fold them into the shape a record stores. Every failure is
// collected rather than thrown, so a partial result is still useful and the
// caller can show "retrieved DNS, could not reach RDAP".
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const RDAP_ENDPOINT = "https://rdap.org/domain/";

function vcardName(vcard) {
  // vcardArray: ["vcard", [ ["fn",{},"text","Acme Registrar"], ... ]]
  const arr = vcard && vcard[1];
  if (!Array.isArray(arr)) return "";
  const fn = arr.find((entry) => Array.isArray(entry) && entry[0] === "fn");
  return fn && fn[3] ? String(fn[3]) : "";
}

export async function lookupDomain(value, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const name = normalizeDomainName(value);
  const types = Array.isArray(opts.types) && opts.types.length ? opts.types : DNS_DEFAULT_QUERIES;
  const result = { ok: false, name, dns: [], registration: {}, errors: [] };
  if (!name) {
    result.errors.push("Enter a domain name to look up.");
    return result;
  }
  if (isValidDomainName(name)) {
    result.apex = name.split(".").slice(-2).join(".");
  }
  if (!fetchImpl) {
    result.errors.push("No network available for a lookup.");
    return result;
  }

  // DNS over HTTPS — one query per record type.
  for (const type of types) {
    const t = dnsRecordType(type) || String(type).toUpperCase();
    const id = typeof t === "string" ? t : t.id;
    try {
      const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(id)}`;
      const res = await fetchImpl(url, { headers: { Accept: "application/dns-json" } });
      if (!res || !res.ok) {
        result.errors.push(`DNS ${id}: HTTP ${res ? res.status : "error"}`);
        continue;
      }
      const json = await res.json();
      for (const ans of (json && json.Answer) || []) {
        const def = dnsTypeByCode(ans.type);
        const value = String(ans.data || "").replace(/^"|"$/g, "");
        // MX/SRV answers embed the priority before the target.
        let priority = null;
        let data = value;
        if (def && def.priority) {
          const m = value.match(/^(\d+)\s+(.*)$/);
          if (m) {
            priority = Number(m[1]);
            data = m[2];
          }
        }
        result.dns.push(makeDnsRecord({ type: def ? def.id : String(ans.type), name: ans.name || name, value: data, ttl: ans.TTL, priority }));
      }
    } catch (e) {
      result.errors.push(`DNS ${id}: ${(e && e.message) || e}`);
    }
  }

  // RDAP — registration metadata.
  try {
    const apex = result.apex || name;
    const res = await fetchImpl(RDAP_ENDPOINT + encodeURIComponent(apex));
    if (res && res.ok) {
      const json = await res.json();
      const reg = {};
      for (const ev of json.events || []) {
        if (ev.eventAction === "expiration") reg.expiresAt = String(ev.eventDate || "").slice(0, 10);
        if (ev.eventAction === "registration") reg.registeredAt = String(ev.eventDate || "").slice(0, 10);
        if (ev.eventAction === "last changed") reg.lastChangedAt = String(ev.eventDate || "").slice(0, 10);
      }
      if (Array.isArray(json.nameservers)) reg.nameservers = json.nameservers.map((n) => String(n.ldhName || "").toLowerCase()).filter(Boolean);
      const registrarEntity = (json.entities || []).find((e) => (e.roles || []).includes("registrar"));
      if (registrarEntity) {
        reg.registrar = vcardName(registrarEntity.vcardArray) || registrarEntity.handle || "";
        const iana = (registrarEntity.publicIds || []).find((p) => p.type === "IANA Registrar ID");
        if (iana) reg.registrarId = iana.identifier;
      }
      const registrantEntity = (json.entities || []).find((e) => (e.roles || []).includes("registrant"));
      if (registrantEntity) reg.registrant = vcardName(registrantEntity.vcardArray) || "";
      if (Array.isArray(json.status)) reg.status = json.status[0] || "unknown";
      if (json.secureDNS && typeof json.secureDNS.delegationSigned === "boolean") reg.dnssec = json.secureDNS.delegationSigned;
      result.registration = reg;
    } else {
      result.errors.push(`RDAP: HTTP ${res ? res.status : "error"}`);
    }
  } catch (e) {
    result.errors.push("RDAP: " + ((e && e.message) || e));
  }

  result.ok = !!result.dns.length || Object.keys(result.registration).length > 0;
  return result;
}
