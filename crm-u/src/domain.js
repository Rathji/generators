window.CRM_DOMAIN = (function () {
  const SERVICE_CATEGORIES = [
    { id: "internet", label: "Internet access", short: "Internet", hint: "Fiber, broadband, fixed wireless, dedicated circuits" },
    { id: "voip", label: "VoIP / Hosted PBX", short: "VoIP", hint: "Hosted seats, extensions, unified communications" },
    { id: "sip-trunk", label: "SIP trunking", short: "SIP trunk", hint: "Channels for an on-premises PBX" },
    { id: "managed-it", label: "Managed IT", short: "Managed IT", hint: "Helpdesk, monitoring, patching, RMM" },
    { id: "cloud", label: "Cloud & backup", short: "Cloud", hint: "M365, off-site backup, hosting, SaaS" },
    { id: "colocation", label: "Colocation & hosting", short: "Colo", hint: "Rack space, power, cross-connects" },
    { id: "mobile", label: "Mobile & SIM", short: "Mobile", hint: "Mobile voice/data lines, IoT SIMs" },
    { id: "hardware", label: "Hardware & rental", short: "Hardware", hint: "Phones, routers, ONTs — sold or rented" },
    { id: "other", label: "Other", short: "Other", hint: "Anything else you provide" }
  ];

  const SERVICE_STATUSES = [
    { id: "prospect", label: "Prospect", badge: "active", billable: false },
    { id: "pending", label: "Pending activation", badge: "active", billable: false },
    { id: "active", label: "Active", badge: "ok", billable: true },
    { id: "suspended", label: "Suspended", badge: "prio-me", billable: false },
    { id: "terminated", label: "Terminated", badge: "inactive", billable: false }
  ];

  const BILLING_CYCLES = [
    { id: "monthly", label: "Monthly", months: 1 },
    { id: "quarterly", label: "Quarterly", months: 3 },
    { id: "semiannual", label: "Every 6 months", months: 6 },
    { id: "annual", label: "Annual", months: 12 }
  ];

  const SITE_TYPES = [
    { id: "hq", label: "Head office", short: "HQ" },
    { id: "branch", label: "Branch / satellite office", short: "Branch" },
    { id: "datacenter", label: "Data centre", short: "Data centre" },
    { id: "colo", label: "Colocation / rack", short: "Colo" },
    { id: "tower", label: "Tower / cabinet / POI", short: "Tower" },
    { id: "premises", label: "Customer premises", short: "Premises" },
    { id: "warehouse", label: "Warehouse / stores", short: "Warehouse" },
    { id: "other", label: "Other", short: "Other" }
  ];

  const SITE_STATUSES = [
    { id: "active", label: "Active", badge: "ok", open: true },
    { id: "planned", label: "Planned", badge: "active", open: true },
    { id: "closed", label: "Closed / decommissioned", badge: "inactive", open: false }
  ];

  const ASSET_FIELDS = {
    provider: { label: "Carrier / provider", type: "text", placeholder: "e.g. Colt, Swisscom, Microsoft" },
    target: { label: "Routes to", type: "text", placeholder: "extension, IVR or mobile it rings", hint: "Where an inbound number delivers." },
    gateway: { label: "Gateway", type: "text", placeholder: "203.0.113.1" },
    bandwidth: { label: "Bandwidth (Mbps)", type: "number" },
    manufacturer: { label: "Manufacturer", type: "text", placeholder: "Cisco, Ubiquiti, Yealink…" },
    model: { label: "Model", type: "text" },
    serial: { label: "Serial number", type: "text" },
    mac: { label: "MAC address", type: "text", placeholder: "aa:bb:cc:dd:ee:ff" },
    msisdn: { label: "Mobile number (MSISDN)", type: "text" },
    seats: { label: "Seats / quantity", type: "number" },
    purchaseDate: { label: "Purchase date", type: "date" },
    warrantyEnd: { label: "Warranty / support end", type: "date" },
    purchaseCost: { label: "Purchase cost ($)", type: "number" }
  };

  const ASSET_KINDS = [
    { id: "did", label: "Phone number (DID / DDI)", short: "DID", idLabel: "Number", idPlaceholder: "+41 44 555 01 00", fields: ["provider", "target"] },
    { id: "circuit", label: "Circuit / line", short: "Circuit", idLabel: "Circuit id", idPlaceholder: "CID-000000", fields: ["provider", "bandwidth", "gateway", "purchaseDate", "warrantyEnd"] },
    { id: "ip-block", label: "IP block / range", short: "IP block", idLabel: "Block (CIDR)", idPlaceholder: "203.0.113.0/28", fields: ["gateway", "provider"] },
    { id: "cpe", label: "CPE / hardware", short: "CPE", idLabel: "Asset tag", idPlaceholder: "AT-0001", fields: ["manufacturer", "model", "serial", "mac", "purchaseDate", "warrantyEnd", "purchaseCost"] },
    { id: "sim", label: "SIM card", short: "SIM", idLabel: "ICCID", idPlaceholder: "8944 0000 0000 0000 000", fields: ["msisdn", "provider", "purchaseDate"] },
    { id: "license", label: "Licence / subscription", short: "Licence", idLabel: "Licence key / ref", idPlaceholder: "", fields: ["seats", "provider", "purchaseDate", "warrantyEnd"] },
    { id: "other", label: "Other", short: "Other", idLabel: "Identifier", idPlaceholder: "", fields: ["manufacturer", "model", "serial", "purchaseDate", "warrantyEnd", "purchaseCost", "provider"] }
  ];

  const ASSET_STATUSES = [
    { id: "available", label: "Available", badge: "ok", assigned: false },
    { id: "assigned", label: "Assigned", badge: "active", assigned: true },
    { id: "reserved", label: "Reserved", badge: "active", assigned: true },
    { id: "in-repair", label: "In repair", badge: "prio-me", assigned: false },
    { id: "retired", label: "Retired", badge: "inactive", assigned: false }
  ];

  const TICKET_CATEGORIES = [
    { id: "incident", label: "Incident" },
    { id: "request", label: "Service request" },
    { id: "change", label: "Change" },
    { id: "problem", label: "Problem" },
    { id: "maintenance", label: "Maintenance" },
    { id: "billing", label: "Billing" },
    { id: "other", label: "Other" }
  ];

  const TICKET_PRIORITIES = [
    { id: "urgent", label: "Urgent · P1", short: "P1", badge: "danger", responseMin: 15, resolveMin: 240 },
    { id: "high", label: "High · P2", short: "P2", badge: "prio-me", responseMin: 60, resolveMin: 480 },
    { id: "medium", label: "Medium · P3", short: "P3", badge: "active", responseMin: 240, resolveMin: 1440 },
    { id: "low", label: "Low · P4", short: "P4", badge: "inactive", responseMin: 480, resolveMin: 2880 }
  ];

  const TICKET_STATUSES = [
    { id: "new", label: "New", badge: "active", open: true },
    { id: "open", label: "Open", badge: "active", open: true },
    { id: "pending", label: "Pending customer", badge: "prio-me", open: true },
    { id: "hold", label: "On hold", badge: "prio-me", open: true },
    { id: "resolved", label: "Resolved", badge: "ok", open: false },
    { id: "closed", label: "Closed", badge: "inactive", open: false }
  ];

  const TICKET_SOURCES = [
    { id: "phone", label: "Phone" },
    { id: "email", label: "Email" },
    { id: "portal", label: "Customer portal" },
    { id: "monitoring", label: "Monitoring alert" },
    { id: "chat", label: "Chat" },
    { id: "walk-in", label: "Walk-in" },
    { id: "other", label: "Other" }
  ];

  const DOC_TYPES = [
    { id: "contract", label: "Service contract", short: "Contract" },
    { id: "sla", label: "SLA / service schedule", short: "SLA" },
    { id: "msa", label: "Master agreement", short: "MSA" },
    { id: "quote", label: "Quote / proposal", short: "Quote" },
    { id: "order", label: "Order / work order", short: "Order" },
    { id: "licence", label: "Licence / certificate", short: "Licence" },
    { id: "invoice", label: "Invoice / billing document", short: "Invoice" },
    { id: "other", label: "Other document", short: "Other" }
  ];

  const DOC_STATUSES = [
    { id: "draft", label: "Draft", badge: "active" },
    { id: "active", label: "In force", badge: "ok" },
    { id: "superseded", label: "Superseded", badge: "inactive" },
    { id: "archived", label: "Archived", badge: "inactive" }
  ];

  const DOC_OWNER_TYPES = [
    { id: "company", label: "Company", module: "companies" },
    { id: "contact", label: "Contact", module: "contacts" },
    { id: "service", label: "Service", module: "services" },
    { id: "site", label: "Site", module: "sites" },
    { id: "asset", label: "Asset", module: "assets" }
  ];

  const CATEGORY_MAP = {};
  SERVICE_CATEGORIES.forEach(c => { CATEGORY_MAP[c.id] = c; });
  const STATUS_MAP = {};
  SERVICE_STATUSES.forEach(s => { STATUS_MAP[s.id] = s; });
  const CYCLE_MAP = {};
  BILLING_CYCLES.forEach(c => { CYCLE_MAP[c.id] = c; });
  const SITE_TYPE_MAP = {};
  SITE_TYPES.forEach(t => { SITE_TYPE_MAP[t.id] = t; });
  const SITE_STATUS_MAP = {};
  SITE_STATUSES.forEach(s => { SITE_STATUS_MAP[s.id] = s; });
  const ASSET_KIND_MAP = {};
  ASSET_KINDS.forEach(k => { ASSET_KIND_MAP[k.id] = k; });
  const ASSET_STATUS_MAP = {};
  ASSET_STATUSES.forEach(s => { ASSET_STATUS_MAP[s.id] = s; });
  const TICKET_CATEGORY_MAP = {};
  TICKET_CATEGORIES.forEach(c => { TICKET_CATEGORY_MAP[c.id] = c; });
  const TICKET_PRIORITY_MAP = {};
  TICKET_PRIORITIES.forEach(p => { TICKET_PRIORITY_MAP[p.id] = p; });
  const TICKET_STATUS_MAP = {};
  TICKET_STATUSES.forEach(s => { TICKET_STATUS_MAP[s.id] = s; });
  const DOC_TYPE_MAP = {};
  DOC_TYPES.forEach(t => { DOC_TYPE_MAP[t.id] = t; });
  const DOC_STATUS_MAP = {};
  DOC_STATUSES.forEach(s => { DOC_STATUS_MAP[s.id] = s; });
  const DOC_OWNER_MAP = {};
  DOC_OWNER_TYPES.forEach(t => { DOC_OWNER_MAP[t.id] = t; });

  function category(id) {
    return CATEGORY_MAP[id] || CATEGORY_MAP.other;
  }
  function categoryLabel(id) {
    return category(id).label;
  }
  function categoryShort(id) {
    return category(id).short;
  }
  function isKnownCategory(id) {
    return !!CATEGORY_MAP[id];
  }

  function status(id) {
    return STATUS_MAP[id] || SERVICE_STATUSES[0];
  }
  function statusLabel(id) {
    return status(id).label;
  }
  function statusBadge(id) {
    return status(id).badge;
  }
  function isBillable(rec) {
    return !!rec && status(rec.status).billable;
  }
  function isOpenStatus(id) {
    return id !== "terminated";
  }

  function cycle(id) {
    return CYCLE_MAP[id] || BILLING_CYCLES[0];
  }
  function cycleLabel(id) {
    return cycle(id).label;
  }
  function cycleMonths(id) {
    return cycle(id).months;
  }

  function moneyOf(v) {
    const n = Number(v);
    return v === undefined || v === null || v === "" || !isFinite(n) || n < 0 ? 0 : n;
  }

  function monthlyOf(rec) {
    if (!rec) return 0;
    return moneyOf(rec.charge) / cycleMonths(rec.billingCycle);
  }

  function annualOf(rec) {
    return monthlyOf(rec) * 12;
  }

  function renewalDateOf(rec) {
    if (!rec) return "";
    if (rec.endDate) return String(rec.endDate).slice(0, 10);
    if (rec.startDate && rec.contractTermMonths) {
      const months = Number(rec.contractTermMonths);
      if (isFinite(months) && months > 0) {
        const d = new Date(String(rec.startDate).slice(0, 10) + "T00:00:00");
        if (!isNaN(d.getTime())) {
          d.setMonth(d.getMonth() + Math.round(months));
          const p = n => String(n).padStart(2, "0");
          return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
        }
      }
    }
    return "";
  }

  function daysUntilRenewal(rec) {
    const iso = renewalDateOf(rec);
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    return (d.getTime() - Date.now()) / 86400000;
  }

  function summarize(records) {
    const out = { count: 0, active: 0, suspended: 0, terminated: 0, mrr: 0, arr: 0, setup: 0, byCategory: {}, renewingSoon: 0 };
    (records || []).forEach(rec => {
      if (!rec) return;
      out.count++;
      const s = status(rec.status).id;
      if (s === "active") out.active++;
      else if (s === "suspended") out.suspended++;
      else if (s === "terminated") out.terminated++;
      if (isBillable(rec)) {
        const m = monthlyOf(rec);
        out.mrr += m;
        const c = category(rec.category).id;
        out.byCategory[c] = (out.byCategory[c] || 0) + m;
      }
      out.setup += moneyOf(rec.setupFee);
      const days = daysUntilRenewal(rec);
      if (isBillable(rec) && days !== null && days >= 0 && days <= 60) out.renewingSoon++;
    });
    out.arr = out.mrr * 12;
    return out;
  }

  function tenantOf(rec) {
    const a = rec && rec.serviceAddress && typeof rec.serviceAddress === "object" ? rec.serviceAddress : null;
    if (!a) return "";
    return [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ");
  }

  function siteType(id) {
    return SITE_TYPE_MAP[id] || SITE_TYPES[0];
  }
  function siteTypeLabel(id) {
    return siteType(id).label;
  }
  function siteTypeShort(id) {
    return siteType(id).short;
  }
  function isKnownSiteType(id) {
    return !!SITE_TYPE_MAP[id];
  }
  function siteStatus(id) {
    return SITE_STATUS_MAP[id] || SITE_STATUSES[0];
  }
  function siteStatusLabel(id) {
    return siteStatus(id).label;
  }
  function siteStatusBadge(id) {
    return siteStatus(id).badge;
  }
  function isSiteOpen(id) {
    return siteStatus(id).open;
  }

  function assetKind(id) {
    return ASSET_KIND_MAP[id] || ASSET_KIND_MAP.other;
  }
  function assetKindLabel(id) {
    return assetKind(id).label;
  }
  function assetKindShort(id) {
    return assetKind(id).short;
  }
  function assetKindIdLabel(id) {
    return assetKind(id).idLabel;
  }
  function assetKindIdPlaceholder(id) {
    return assetKind(id).idPlaceholder || "";
  }
  function assetKindFields(id) {
    return (assetKind(id).fields || []).map(k => Object.assign({ key: k }, ASSET_FIELDS[k] || { label: k, type: "text" }));
  }
  function isKnownAssetKind(id) {
    return !!ASSET_KIND_MAP[id];
  }
  function assetField(key) {
    return ASSET_FIELDS[key] || { label: key, type: "text" };
  }
  function assetStatus(id) {
    return ASSET_STATUS_MAP[id] || ASSET_STATUSES[0];
  }
  function assetStatusLabel(id) {
    return assetStatus(id).label;
  }
  function assetStatusBadge(id) {
    return assetStatus(id).badge;
  }
  function isAssetAssigned(rec) {
    return !!rec && assetStatus(rec.status).assigned;
  }

  function ticketCategory(id) {
    return TICKET_CATEGORY_MAP[id] || TICKET_CATEGORY_MAP.other;
  }
  function ticketCategoryLabel(id) {
    return ticketCategory(id).label;
  }
  function ticketPriority(id) {
    return TICKET_PRIORITY_MAP[id] || TICKET_PRIORITY_MAP.medium;
  }
  function ticketPriorityLabel(id) {
    return ticketPriority(id).label;
  }
  function ticketPriorityShort(id) {
    return ticketPriority(id).short;
  }
  function ticketPriorityBadge(id) {
    return ticketPriority(id).badge;
  }
  function ticketStatus(id) {
    return TICKET_STATUS_MAP[id] || TICKET_STATUSES[0];
  }
  function ticketStatusLabel(id) {
    return ticketStatus(id).label;
  }
  function ticketStatusBadge(id) {
    return ticketStatus(id).badge;
  }
  function isTicketOpen(t) {
    if (!t) return false;
    return ticketStatus(t.status).open;
  }

  function docType(id) {
    return DOC_TYPE_MAP[id] || DOC_TYPES[0];
  }
  function docTypeLabel(id) {
    return docType(id).label;
  }
  function docTypeShort(id) {
    return docType(id).short;
  }
  function isKnownDocType(id) {
    return !!DOC_TYPE_MAP[id];
  }
  function docStatus(id) {
    return DOC_STATUS_MAP[id] || DOC_STATUSES[0];
  }
  function docStatusLabel(id) {
    return docStatus(id).label;
  }
  function docStatusBadge(id) {
    return docStatus(id).badge;
  }
  function isKnownDocStatus(id) {
    return !!DOC_STATUS_MAP[id];
  }
  function docOwnerType(id) {
    return DOC_OWNER_MAP[id] || null;
  }
  function docOwnerTypeLabel(id) {
    const o = docOwnerType(id);
    return o ? o.label : "";
  }
  function docOwnerModule(id) {
    const o = docOwnerType(id);
    return o ? o.module : null;
  }
  function isKnownDocOwnerType(id) {
    return !!DOC_OWNER_MAP[id];
  }

  function docExpiryOf(rec) {
    if (!rec) return "";
    return rec.endDate ? String(rec.endDate).slice(0, 10) : "";
  }
  function daysUntilDocExpiry(rec, nowMs) {
    const iso = docExpiryOf(rec);
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    const now = nowMs === undefined || nowMs === null ? Date.now() : nowMs;
    return (d.getTime() - now) / 86400000;
  }
  function docState(rec) {
    if (!rec) return "draft";
    const st = docStatus(rec.status).id;
    if (st !== "active") return st;
    const days = daysUntilDocExpiry(rec);
    if (days !== null && days < 0) return "expired";
    if (days !== null && days <= 60) return "expiring";
    return "active";
  }
  function docStateLabel(rec) {
    const s = docState(rec);
    if (s === "expiring") return "Expiring soon";
    if (s === "expired") return "Expired";
    return docStatusLabel(s);
  }
  function docStateBadge(rec) {
    const s = docState(rec);
    if (s === "expiring") return "prio-me";
    if (s === "expired") return "danger";
    return docStatusBadge(s);
  }

  function parseMs(v) {
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  function isoFromMs(ms) {
    return new Date(ms).toISOString();
  }
  function intOr(v, d) {
    const n = Number(v);
    return v === "" || v === null || v === undefined || !isFinite(n) ? d : n;
  }
  function daysUntilDate(iso) {
    const ms = parseMs(iso);
    if (ms === null) return null;
    return (ms - Date.now()) / 86400000;
  }

  function ticketSla(t) {
    if (!t) return null;
    const p = ticketPriority(t.priority);
    const respMin = intOr(t.responseTargetMin, p.responseMin);
    const resMin = intOr(t.resolveTargetMin, p.resolveMin);
    const out = { priority: p.id, responseTargetMin: respMin, resolveTargetMin: resMin, responseDueAt: "", resolveDueAt: "" };
    const base = parseMs(t.openedAt || t.createdAt);
    if (base !== null) {
      out.responseDueAt = isoFromMs(base + respMin * 60000);
      out.resolveDueAt = t.dueAt ? String(t.dueAt) : isoFromMs(base + resMin * 60000);
    }
    return out;
  }

  function ticketSlaState(t, nowMs) {
    const now = nowMs === undefined || nowMs === null ? Date.now() : nowMs;
    const open = isTicketOpen(t);
    const sla = ticketSla(t);
    const state = { open, state: open ? "on-track" : "closed", sla, responseOverdue: false, resolveOverdue: false, dueSoon: false, resolveMet: null, resolveMinutesLeft: null };
    if (!sla) return state;
    const respDue = parseMs(sla.responseDueAt);
    const resDue = parseMs(sla.resolveDueAt);
    if (resDue !== null) state.resolveMinutesLeft = Math.round((resDue - now) / 60000);
    if (!open) {
      const rAt = parseMs(t.resolvedAt || t.closedAt);
      state.resolveMet = rAt !== null && resDue !== null ? rAt <= resDue : null;
      state.state = state.resolveMet === false ? "breached" : "closed";
      return state;
    }
    const responded = !!t.firstResponseAt;
    state.resolveOverdue = resDue !== null && now > resDue;
    state.responseOverdue = !responded && respDue !== null && now > respDue;
    state.dueSoon = resDue !== null && !state.resolveOverdue && resDue - now <= 3600000;
    state.state = state.resolveOverdue ? "overdue" : state.responseOverdue ? "response-overdue" : state.dueSoon ? "due-soon" : "on-track";
    return state;
  }

  function summarizeTickets(records, nowMs) {
    const out = { count: 0, open: 0, unassigned: 0, overdue: 0, dueSoon: 0, resolved: 0, closed: 0, byPriority: {}, byStatus: {} };
    (records || []).forEach(t => {
      if (!t) return;
      out.count++;
      const st = ticketStatus(t.status);
      if (st.open) out.open++;
      if (st.id === "resolved") out.resolved++;
      if (st.id === "closed") out.closed++;
      if (st.open && !t.assignee) out.unassigned++;
      const p = ticketPriority(t.priority).id;
      out.byPriority[p] = (out.byPriority[p] || 0) + 1;
      out.byStatus[st.id] = (out.byStatus[st.id] || 0) + 1;
      const s = ticketSlaState(t, nowMs);
      if (s.state === "overdue" || s.state === "response-overdue") out.overdue++;
      else if (s.state === "due-soon") out.dueSoon++;
    });
    return out;
  }

  function addressLine(a) {
    a = a && typeof a === "object" ? a : {};
    return [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ");
  }
  function siteAddressOf(rec) {
    return addressLine(rec && rec.address);
  }

  return {
    SERVICE_CATEGORIES,
    SERVICE_STATUSES,
    BILLING_CYCLES,
    SITE_TYPES,
    SITE_STATUSES,
    ASSET_FIELDS,
    ASSET_KINDS,
    ASSET_STATUSES,
    TICKET_CATEGORIES,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
    TICKET_SOURCES,
    DOC_TYPES,
    DOC_STATUSES,
    DOC_OWNER_TYPES,
    category,
    categoryLabel,
    categoryShort,
    isKnownCategory,
    status,
    statusLabel,
    statusBadge,
    isBillable,
    isOpenStatus,
    cycle,
    cycleLabel,
    cycleMonths,
    monthlyOf,
    annualOf,
    moneyOf,
    renewalDateOf,
    daysUntilRenewal,
    summarize,
    tenantOf,
    siteType,
    siteTypeLabel,
    siteTypeShort,
    isKnownSiteType,
    siteStatus,
    siteStatusLabel,
    siteStatusBadge,
    isSiteOpen,
    assetKind,
    assetKindLabel,
    assetKindShort,
    assetKindIdLabel,
    assetKindIdPlaceholder,
    assetKindFields,
    isKnownAssetKind,
    assetField,
    assetStatus,
    assetStatusLabel,
    assetStatusBadge,
    isAssetAssigned,
    ticketCategory,
    ticketCategoryLabel,
    ticketPriority,
    ticketPriorityLabel,
    ticketPriorityShort,
    ticketPriorityBadge,
    ticketStatus,
    ticketStatusLabel,
    ticketStatusBadge,
    isTicketOpen,
    docType,
    docTypeLabel,
    docTypeShort,
    isKnownDocType,
    docStatus,
    docStatusLabel,
    docStatusBadge,
    isKnownDocStatus,
    docOwnerType,
    docOwnerTypeLabel,
    docOwnerModule,
    isKnownDocOwnerType,
    docExpiryOf,
    daysUntilDocExpiry,
    docState,
    docStateLabel,
    docStateBadge,
    parseMs,
    isoFromMs,
    intOr,
    daysUntilDate,
    ticketSla,
    ticketSlaState,
    summarizeTickets,
    addressLine,
    siteAddressOf
  };
})();
