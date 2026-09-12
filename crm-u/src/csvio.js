window.CRM_CSV = (function () {
  const R = window.CRM_RECORDS;

  function parseCSV(text) {
    text = String(text || "");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [];
    let field = "";
    let inQ = false;
    const n = text.length;
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += ch;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    const clean = rows.filter(r => r.some(c => String(c).trim() !== ""));
    if (!clean.length) return { ok: false, error: "No rows found — the file looks empty." };
    const width = clean[0].length;
    for (let i = 1; i < clean.length; i++) {
      if (clean[i].length !== width) {
        return { ok: false, error: "Row " + (i + 1) + " has " + clean[i].length + " columns but the header has " + width + ". Fix the file so every row has the same column count." };
      }
    }
    const headers = clean[0].map(h => String(h).trim());
    const data = clean.slice(1).map(r => r.map(c => String(c).trim()));
    return { ok: true, headers, data };
  }

  function csvCell(v) {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    return rows.map(r => r.map(csvCell).join(",")).join("\n");
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 400);
  }

  const HEADER_HINTS = {
    companies: {
      name: ["name", "company", "company name", "account", "organisation", "organization", "business", "customer"],
      industry: ["industry", "sector", "vertical", "type"],
      employees: ["employees", "employee count", "headcount", "company size", "size", "staff"],
      website: ["website", "web", "site", "url", "domain", "web address", "website url"],
      taxId: ["tax id", "vat", "vat id", "vat number", "tax number", "tax", "ein", "registration number"],
      street: ["street", "street address", "address", "address line 1", "line 1", "address1"],
      city: ["city", "town", "locality", "municipality"],
      region: ["state", "region", "province", "county", "territory"],
      postalCode: ["postal code", "zip", "zip code", "postcode", "post code"],
      country: ["country", "nation"],
      tags: ["tags", "tag", "labels", "segments"],
      notes: ["notes", "note", "comments", "comment", "description", "about", "remarks"],
      isCustomer: ["customer", "is customer", "account type", "type"]
    },
    contacts: {
      name: ["name", "full name", "contact name", "contact", "person", "fullname"],
      company: ["company", "company name", "account", "organisation", "organization", "business", "employer"],
      role: ["role", "title", "job title", "position", "designation", "job", "function", "department"],
      email: ["email", "email address", "e-mail", "e-mail address", "mail", "emailaddress"],
      phone: ["phone", "telephone", "phone number", "tel", "telephone number", "mobile", "cell", "phone1", "work phone"],
      linkedin: ["linkedin", "linkedin url", "linkedin handle", "linkedin profile"],
      twitter: ["twitter", "x", "twitter handle", "x handle"],
      facebook: ["facebook", "facebook url", "facebook handle"],
      tags: ["tags", "tag", "labels"],
      notes: ["notes", "note", "comments", "comment", "description", "remarks"],
      consent: ["consent", "gdpr", "opt in", "marketing consent", "email consent", "communication consent"]
    }
  };

  const FIELD_LABELS = {
    companies: {
      name: "Name", industry: "Industry", employees: "Employees", website: "Website", taxId: "Tax / VAT id",
      street: "Street address", city: "City", region: "State / region", postalCode: "Postal code", country: "Country",
      tags: "Tags", notes: "Notes", isCustomer: "Customer flag"
    },
    contacts: {
      name: "Name", company: "Company", role: "Role / title", email: "Email", phone: "Phone",
      linkedin: "LinkedIn", twitter: "X / Twitter", facebook: "Facebook", tags: "Tags", notes: "Notes", consent: "Consent flag"
    }
  };

  function fieldOptions(module) {
    const o = [{ v: "", label: "— Skip column" }];
    const order = module === "companies"
      ? ["name", "industry", "employees", "website", "taxId", "street", "city", "region", "postalCode", "country", "tags", "notes", "isCustomer"]
      : ["name", "company", "role", "email", "phone", "linkedin", "twitter", "facebook", "tags", "notes", "consent"];
    order.forEach(k => o.push({ v: k, label: FIELD_LABELS[module][k] }));
    return o;
  }

  function normHeader(h) {
    return String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function guessHeaderMap(module, headers) {
    const hints = HEADER_HINTS[module] || {};
    const out = {};
    const used = {};
    const want = Object.keys(hints);
    headers.forEach((h, i) => {
      const nh = normHeader(h);
      let best = null;
      let bestScore = 0;
      want.forEach(k => {
        if (used[k]) return;
        const list = hints[k];
        let score = 0;
        if (normHeader(k) === nh) score = 100;
        else {
          for (const syn of list) {
            const sn = normHeader(syn);
            if (sn === nh) { score = 90; break; }
            if (sn.indexOf(nh) !== -1 && nh.length >= 3 && nh.length * 2 >= sn.length) score = Math.max(score, 70);
            else if (nh.indexOf(sn) !== -1 && sn.length >= 3) score = Math.max(score, 60);
          }
        }
        if (score > bestScore) { bestScore = score; best = k; }
      });
      if (best && bestScore >= 60) {
        out[best] = i;
        used[best] = 1;
      }
    });
    return out;
  }

  function boolOf(v) {
    const s = String(v || "").trim().toLowerCase();
    if (!s) return null;
    return ["1", "true", "yes", "y", "x", "checked", "customer", "is customer"].indexOf(s) !== -1;
  }

  function employeesOf(v) {
    const s = String(v || "").trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    const range = s.match(/(\d[\d.,]*)\s*[-–—]\s*(\d[\d.,]*)/);
    if (range) {
      const top = Number(range[2].replace(/[,.]/g, ""));
      if (isFinite(top) && top > 0) return top;
    }
    const plus = s.match(/(\d[\d.,]*)\s*\+/);
    if (plus) {
      const n = Number(plus[1].replace(/[,.]/g, ""));
      if (isFinite(n) && n > 0) return n;
    }
    return null;
  }

  function buildRaw(module, fieldMap, headerRow, csvRow, lookup) {
    const raw = {};
    const assign = (field, transform) => {
      const i = fieldMap[field];
      if (i === undefined || headerRow[i] === "") return;
      const v = transform ? transform(csvRow[i]) : csvRow[i];
      if (v !== null && v !== undefined && v !== "") raw[field] = v;
    };
    if (module === "companies") {
      assign("name");
      assign("industry");
      assign("employees", employeesOf);
      assign("website");
      assign("taxId");
      assign("tags");
      assign("notes");
      const addr = {};
      ["street", "city", "region", "postalCode", "country"].forEach(k => {
        const i = fieldMap[k];
        if (i !== undefined && headerRow[i] !== "" && csvRow[i] !== "") addr[k] = csvRow[i];
      });
      if (Object.keys(addr).length) raw.address = addr;
      const cust = boolOf(fieldMap.isCustomer !== undefined ? csvRow[fieldMap.isCustomer] : "");
      if (cust !== null) raw.isCustomer = cust;
      raw.active = true;
    } else {
      assign("name");
      assign("role");
      assign("email");
      assign("phone");
      assign("tags");
      assign("notes");
      const social = {};
      ["linkedin", "twitter", "facebook"].forEach(k => {
        const i = fieldMap[k];
        if (i !== undefined && headerRow[i] !== "" && csvRow[i] !== "") social[k] = String(csvRow[i]).replace(/^https?:\/\/.*\/([^/]+)\/?$/i, "$1");
      });
      if (Object.keys(social).length) raw.social = social;
      const cons = boolOf(fieldMap.consent !== undefined ? csvRow[fieldMap.consent] : "");
      if (cons !== null) raw.consent = cons;
      const ci = fieldMap.company;
      const coName = ci !== undefined && headerRow[ci] !== "" ? String(csvRow[ci]).trim() : "";
      if (coName) {
        const match = lookup && lookup.companyByName ? lookup.companyByName(coName) : null;
        if (match) raw.companyId = match.id;
        else raw.__companyName = coName;
      }
      raw.active = true;
    }
    return raw;
  }

  function existingCheck(module, raw, existingList) {
    existingList = existingList || [];
    if (module === "companies") {
      const name = String(raw.name || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!name) return false;
      return existingList.some(c => c && String(c.name || "").toLowerCase().replace(/\s+/g, " ").trim() === name);
    }
    const name = String(raw.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    const email = String(raw.email || "").toLowerCase().trim();
    return existingList.some(c => {
      if (!c) return false;
      if (name && String(c.name || "").toLowerCase().replace(/\s+/g, " ").trim() === name) return true;
      return !!email && String(c.email || "").toLowerCase().trim() === email;
    });
  }

  function validateRaw(module, raw) {
    const mod = module === "companies" ? window.CRM_COMPANIES : window.CRM_CONTACTS;
    if (!mod) return { ok: false, errors: { _: "Module code not loaded." } };
    if (raw.__companyName && !raw.companyId) {
      const v = mod.validate(Object.assign({}, raw));
      return { ok: false, errors: { company: "Unknown company “" + raw.__companyName + "” — import companies first, or fix the company name." } };
    }
    const v = mod.validate(raw);
    if (!v.ok) return v;
    if (!raw.name && !raw.companyId) {
      if (module === "contacts" && !raw.name) return { ok: false, errors: { name: "Contact name is required." } };
    }
    return v;
  }

  async function loadModuleRecords(store, module) {
    const doc = await store.loadDoc(module);
    return (doc && doc.content && Array.isArray(doc.content.records)) ? doc.content.records : [];
  }

  function companyByNameMap(companies) {
    const m = new Map();
    (companies || []).forEach(c => {
      if (!c || !c.name) return;
      m.set(String(c.name).toLowerCase().replace(/\s+/g, " ").trim(), c);
    });
    return m;
  }

  function ownerNameOf(r, m) {
    const D = window.CRM_DOMAIN;
    const mod = D ? D.docOwnerModule(r.ownerType) : null;
    if (!mod || !r.ownerId) return "";
    const map = m && m[mod];
    const rec = map ? map.get(r.ownerId) : null;
    const typeLabel = D ? D.docOwnerTypeLabel(r.ownerType) : r.ownerType;
    if (!rec) return typeLabel + " " + r.ownerId;
    const name = (mod === "assets" && window.CRM_ASSETS && window.CRM_ASSETS.assetName) ? window.CRM_ASSETS.assetName(rec) : (rec.name || rec.subject || rec.id);
    return typeLabel + " · " + name;
  }

  function moduleColumns(module) {
    const C = module === "companies"
      ? [
          { key: "name", label: "Name", v: r => r.name },
          { key: "industry", label: "Industry", v: r => r.industry || "" },
          { key: "employees", label: "Employees", v: r => (r.employees === undefined || r.employees === null ? "" : r.employees) },
          { key: "website", label: "Website", v: r => r.website || "" },
          { key: "taxId", label: "Tax / VAT id", v: r => r.taxId || "" },
          { key: "street", label: "Street", v: r => (r.address && r.address.street) || "" },
          { key: "city", label: "City", v: r => (r.address && r.address.city) || "" },
          { key: "region", label: "State / region", v: r => (r.address && r.address.region) || "" },
          { key: "postalCode", label: "Postal code", v: r => (r.address && r.address.postalCode) || "" },
          { key: "country", label: "Country", v: r => (r.address && r.address.country) || "" },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "notes", label: "Notes", v: r => r.notes || "" },
          { key: "isCustomer", label: "Customer", v: r => (r.isCustomer ? "yes" : "no") },
          { key: "active", label: "Active", v: r => (r.active === false ? "no" : "yes") },
          { key: "createdAt", label: "Created", v: r => String(r.createdAt || "").slice(0, 10) },
          { key: "updatedAt", label: "Updated", v: r => String(r.updatedAt || "").slice(0, 10) }
        ]
      : module === "contacts"
      ? [
          { key: "name", label: "Name", v: r => r.name },
          { key: "company", label: "Company", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "role", label: "Role / title", v: r => r.role || "" },
          { key: "email", label: "Email", v: r => r.email || "" },
          { key: "phone", label: "Phone", v: r => r.phone || "" },
          { key: "channels", label: "Channels", v: r => (r.channels || []).map(c => c.kind + ": " + c.value).join("; ") },
          { key: "linkedin", label: "LinkedIn", v: r => (r.social && r.social.linkedin) || "" },
          { key: "twitter", label: "X / Twitter", v: r => (r.social && r.social.twitter) || "" },
          { key: "facebook", label: "Facebook", v: r => (r.social && r.social.facebook) || "" },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "consent", label: "Consent", v: r => (r.consent ? "yes" : "no") },
          { key: "active", label: "Active", v: r => (r.active === false ? "no" : "yes") },
          { key: "createdAt", label: "Created", v: r => String(r.createdAt || "").slice(0, 10) },
          { key: "updatedAt", label: "Updated", v: r => String(r.updatedAt || "").slice(0, 10) }
        ]
      : module === "leads"
      ? [
          { key: "name", label: "Lead", v: r => r.name || r.subject || "" },
          { key: "company", label: "Company", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "contact", label: "Contact", v: (r, m) => (r.contactId && m.contacts && m.contacts.get(r.contactId)) ? m.contacts.get(r.contactId).name : "" },
          { key: "source", label: "Source", v: r => r.source || "" },
          { key: "owner", label: "Owner", v: r => r.owner || "" },
          { key: "status", label: "Status", v: r => r.status || "" },
          { key: "notes", label: "Notes", v: r => r.notes || "" },
          { key: "createdAt", label: "Created", v: r => String(r.createdAt || "").slice(0, 10) }
        ]
      : module === "deals"
      ? [
          { key: "name", label: "Deal", v: r => r.name || "" },
          { key: "company", label: "Company", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "contact", label: "Contact", v: (r, m) => (r.contactId && m.contacts && m.contacts.get(r.contactId)) ? m.contacts.get(r.contactId).name : "" },
          { key: "lead", label: "From lead", v: (r, m) => (r.leadId && m.leads && m.leads.get(r.leadId)) ? (m.leads.get(r.leadId).name || m.leads.get(r.leadId).subject) : "" },
          { key: "stage", label: "Stage", v: (r, m) => (m.stageLabel ? m.stageLabel(r.stage) : r.stage) || "" },
          { key: "owner", label: "Owner", v: r => r.owner || "" },
          { key: "expectedValue", label: "Expected value", v: r => (r.expectedValue === undefined || r.expectedValue === null || r.expectedValue === "") ? "" : Number(r.expectedValue) },
          { key: "probability", label: "Probability %", v: r => (r.probability === undefined || r.probability === null || r.probability === "") ? "" : Number(r.probability) },
          { key: "weighted", label: "Weighted value", v: (r, m) => (m && m.weightedOf) ? m.weightedOf(r) : "" },
          { key: "closeDate", label: "Close date", v: r => String(r.closeDate || "").slice(0, 10) },
          { key: "createdAt", label: "Created", v: r => String(r.createdAt || "").slice(0, 10) },
          { key: "wonAt", label: "Won", v: r => String(r.wonAt || "").slice(0, 10) },
          { key: "lostAt", label: "Lost", v: r => String(r.lostAt || "").slice(0, 10) },
          { key: "lossReason", label: "Loss reason", v: r => r.lossReason || "" },
          { key: "notes", label: "Notes", v: r => r.notes || "" }
        ]
      : module === "services"
      ? [
          { key: "name", label: "Service", v: r => r.name || "" },
          { key: "company", label: "Account", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "contact", label: "Contact", v: (r, m) => (r.contactId && m.contacts && m.contacts.get(r.contactId)) ? m.contacts.get(r.contactId).name : "" },
          { key: "category", label: "Category", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.categoryLabel(r.category) : r.category) || "" },
          { key: "status", label: "Status", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.statusLabel(r.status) : r.status) || "" },
          { key: "charge", label: "Recurring charge", v: r => (r.charge === undefined || r.charge === null || r.charge === "") ? "" : Number(r.charge) },
          { key: "billingCycle", label: "Billing cycle", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.cycleLabel(r.billingCycle) : r.billingCycle) || "" },
          { key: "mrr", label: "MRR", v: (r, m) => (m && m.mrrOf) ? m.mrrOf(r) : "" },
          { key: "arr", label: "ARR", v: (r, m) => (m && m.arrOf) ? m.arrOf(r) : "" },
          { key: "setupFee", label: "Setup fee", v: r => (r.setupFee === undefined || r.setupFee === null || r.setupFee === "") ? "" : Number(r.setupFee) },
          { key: "quantity", label: "Qty", v: r => (r.quantity === undefined || r.quantity === null) ? "" : r.quantity },
          { key: "bandwidth", label: "Bandwidth (Mbps)", v: r => (r.bandwidth === undefined || r.bandwidth === null || r.bandwidth === "") ? "" : r.bandwidth },
          { key: "circuitId", label: "Circuit id", v: r => r.circuitId || "" },
          { key: "contractTermMonths", label: "Term (months)", v: r => (r.contractTermMonths === undefined || r.contractTermMonths === null) ? "" : r.contractTermMonths },
          { key: "startDate", label: "Start", v: r => String(r.startDate || "").slice(0, 10) },
          { key: "renewal", label: "Renewal", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.renewalDateOf(r) : "") || "" },
          { key: "autoRenew", label: "Auto-renew", v: r => (r.autoRenew ? "yes" : "no") },
          { key: "owner", label: "Owner", v: r => r.owner || "" },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "notes", label: "Notes", v: r => r.notes || "" }
        ]
      : module === "sites"
      ? [
          { key: "name", label: "Site", v: r => r.name || "" },
          { key: "company", label: "Company", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "siteType", label: "Type", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.siteTypeLabel(r.siteType) : r.siteType) || "" },
          { key: "status", label: "Status", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.siteStatusLabel(r.status) : r.status) || "" },
          { key: "siteCode", label: "Site code", v: r => r.siteCode || "" },
          { key: "timezone", label: "Timezone", v: r => r.timezone || "" },
          { key: "address", label: "Address", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.siteAddressOf(r) : "") || "" },
          { key: "owner", label: "Owner", v: r => r.owner || "" },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "notes", label: "Notes", v: r => r.notes || "" }
        ]
      : module === "assets"
      ? [
          { key: "name", label: "Asset", v: r => (window.CRM_ASSETS ? window.CRM_ASSETS.assetName(r) : (r.name || r.identifier)) || "" },
          { key: "kind", label: "Kind", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.assetKindLabel(r.kind) : r.kind) || "" },
          { key: "identifier", label: "Identifier", v: r => r.identifier || "" },
          { key: "status", label: "Status", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.assetStatusLabel(r.status) : r.status) || "" },
          { key: "company", label: "Account", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "site", label: "Site", v: (r, m) => (r.siteId && m.sites && m.sites.get(r.siteId)) ? m.sites.get(r.siteId).name : "" },
          { key: "service", label: "Service", v: (r, m) => (r.serviceId && m.services && m.services.get(r.serviceId)) ? m.services.get(r.serviceId).name : "" },
          { key: "provider", label: "Provider", v: r => r.provider || "" },
          { key: "serial", label: "Serial", v: r => r.serial || "" },
          { key: "mac", label: "MAC", v: r => r.mac || "" },
          { key: "msisdn", label: "MSISDN", v: r => r.msisdn || "" },
          { key: "warrantyEnd", label: "Warranty end", v: r => String(r.warrantyEnd || "").slice(0, 10) },
          { key: "purchaseCost", label: "Cost", v: r => (r.purchaseCost === undefined || r.purchaseCost === null || r.purchaseCost === "") ? "" : Number(r.purchaseCost) },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "notes", label: "Notes", v: r => r.notes || "" }
        ]
      : module === "tickets"
      ? [
          { key: "subject", label: "Subject", v: r => r.subject || "" },
          { key: "company", label: "Account", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "contact", label: "Contact", v: (r, m) => (r.contactId && m.contacts && m.contacts.get(r.contactId)) ? m.contacts.get(r.contactId).name : "" },
          { key: "service", label: "Service", v: (r, m) => (r.serviceId && m.services && m.services.get(r.serviceId)) ? m.services.get(r.serviceId).name : "" },
          { key: "site", label: "Site", v: (r, m) => (r.siteId && m.sites && m.sites.get(r.siteId)) ? m.sites.get(r.siteId).name : "" },
          { key: "asset", label: "Asset", v: (r, m) => (r.assetId && m.assets && m.assets.get(r.assetId)) ? (window.CRM_ASSETS ? window.CRM_ASSETS.assetName(m.assets.get(r.assetId)) : (m.assets.get(r.assetId).name || m.assets.get(r.assetId).identifier)) : "" },
          { key: "category", label: "Category", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.ticketCategoryLabel(r.category) : r.category) || "" },
          { key: "priority", label: "Priority", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.ticketPriorityLabel(r.priority) : r.priority) || "" },
          { key: "status", label: "Status", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.ticketStatusLabel(r.status) : r.status) || "" },
          { key: "assignee", label: "Assignee", v: r => r.assignee || "" },
          { key: "source", label: "Source", v: r => (window.CRM_DOMAIN && window.CRM_DOMAIN.TICKET_SOURCES.find(s => s.id === r.source) || {}).label || r.source || "" },
          { key: "openedAt", label: "Opened", v: r => String(r.openedAt || r.createdAt || "").slice(0, 10) },
          { key: "firstResponseAt", label: "First response", v: r => String(r.firstResponseAt || "").slice(0, 10) },
          { key: "resolveDue", label: "Resolve by", v: r => { if (!window.CRM_DOMAIN) return ""; const s = window.CRM_DOMAIN.ticketSla(r); return s && s.resolveDueAt ? String(s.resolveDueAt).slice(0, 10) : ""; } },
          { key: "resolvedAt", label: "Resolved", v: r => String(r.resolvedAt || "").slice(0, 10) },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "description", label: "Description", v: r => r.description || "" }
        ]
      : module === "documents"
      ? [
          { key: "title", label: "Title", v: r => r.title || "" },
          { key: "type", label: "Type", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.docTypeLabel(r.type) : r.type) || "" },
          { key: "state", label: "State", v: r => (window.CRM_DOMAIN ? window.CRM_DOMAIN.docStateLabel(r) : r.status) || "" },
          { key: "owner", label: "Belongs to", v: (r, m) => ownerNameOf(r, m) },
          { key: "company", label: "Account", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "reference", label: "Reference", v: r => r.reference || "" },
          { key: "value", label: "Value", v: r => (r.value === undefined || r.value === null || r.value === "") ? "" : Number(r.value) },
          { key: "startDate", label: "Start", v: r => String(r.startDate || "").slice(0, 10) },
          { key: "endDate", label: "End / renewal", v: r => String(r.endDate || "").slice(0, 10) },
          { key: "file", label: "Attachment", v: r => r.fileUrl || "" },
          { key: "tags", label: "Tags", v: r => (r.tags || []).join("; ") },
          { key: "notes", label: "Notes", v: r => r.notes || "" }
        ]
      : [
          { key: "type", label: "Type", v: r => (r.type || "").charAt(0).toUpperCase() + String(r.type || "").slice(1) },
          { key: "subject", label: "Subject", v: r => r.subject || "" },
          { key: "at", label: "When", v: r => String(r.at || "").slice(0, 10) },
          { key: "owner", label: "Owner", v: r => r.owner || "" },
          { key: "company", label: "Company", v: (r, m) => (r.companyId && m.companies && m.companies.get(r.companyId)) ? m.companies.get(r.companyId).name : "" },
          { key: "contact", label: "Contact", v: (r, m) => (r.contactId && m.contacts && m.contacts.get(r.contactId)) ? m.contacts.get(r.contactId).name : "" },
          { key: "deal", label: "Deal", v: (r, m) => (r.dealId && m.deals && m.deals.get(r.dealId)) ? m.deals.get(r.dealId).name : "" },
          { key: "durationMin", label: "Minutes", v: r => (r.durationMin === undefined || r.durationMin === null) ? "" : r.durationMin },
          { key: "outcome", label: "Outcome", v: r => r.outcome || "" },
          { key: "dueDate", label: "Due", v: r => String(r.dueDate || "").slice(0, 10) },
          { key: "status", label: "Status", v: r => r.status || "" },
          { key: "notes", label: "Notes", v: r => r.notes || "" }
        ];
    return C;
  }

  function renderTable(cols, records, maps) {
    const rows = records.map(rec => cols.map(c => c.v(rec, maps)));
    const head = cols.map(c => c.label);
    return { head, rows };
  }

  async function buildMaps(store) {
    const maps = {};
    const mods = ["companies", "contacts", "deals", "leads", "sites", "services", "assets", "documents"];
    for (const m of mods) {
      try {
        const list = await loadModuleRecords(store, m);
        maps[m] = new Map(list.map(x => [x.id, x]));
      } catch (e) {
        maps[m] = new Map();
      }
    }
    if (window.CRM_DEALS) maps.stageLabel = s => window.CRM_DEALS.stageLabel(s);
    if (window.CRM_DEALS) maps.weightedOf = r => window.CRM_DEALS.weightedOf(r);
    if (window.CRM_DOMAIN) {
      maps.mrrOf = r => window.CRM_DOMAIN.monthlyOf(r);
      maps.arrOf = r => window.CRM_DOMAIN.annualOf(r);
    }
    maps._companiesList = await loadModuleRecords(store, "companies").catch(() => []);
    return maps;
  }

  function recordSheetHtml(module, rec, maps) {
    const lines = [];
    const add = (label, v) => {
      const s = String(v === undefined || v === null ? "" : v).trim();
      if (s) lines.push('<div class="ps-row"><span class="ps-k">' + R.esc(label) + '</span><span class="ps-v">' + R.esc(s).replace(/\n/g, "<br>") + "</span></div>");
    };
    if (module === "companies") {
      add("Name", rec.name);
      add("Industry", rec.industry);
      add("Employees", window.CRM_COMPANIES && window.CRM_COMPANIES.sizeLabel ? window.CRM_COMPANIES.sizeLabel(rec.employees) : rec.employees);
      add("Website", rec.website);
      add("Tax / VAT id", rec.taxId);
      const a = rec.address || {};
      add("Address", [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", "));
      add("Tags", (rec.tags || []).join(", "));
      add("Customer", rec.isCustomer ? "Yes" : "No");
      add("Active", rec.active === false ? "No" : "Yes");
      add("Notes", rec.notes);
      const contactN = maps.contacts ? Array.from(maps.contacts.values()).filter(c => c.companyId === rec.id).length : 0;
      const dealN = maps.deals ? Array.from(maps.deals.values()).filter(d => d.companyId === rec.id).length : 0;
      add("Contacts", contactN ? contactN + " contact" + (contactN === 1 ? "" : "s") : "");
      add("Open deals", dealN ? dealN + " deal" + (dealN === 1 ? "" : "s") : "");
    } else if (module === "contacts") {
      add("Name", rec.name);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      add("Company", co ? co.name : "");
      add("Role / title", rec.role);
      add("Email", rec.email);
      add("Phone", rec.phone);
      add("Channels", (rec.channels || []).map(c => c.kind + ": " + c.value).join("; "));
      add("LinkedIn", rec.social && rec.social.linkedin);
      add("X / Twitter", rec.social && rec.social.twitter);
      add("Facebook", rec.social && rec.social.facebook);
      add("Tags", (rec.tags || []).join(", "));
      add("Consent to contact", rec.consent ? "Yes" : "No");
      add("Active", rec.active === false ? "No" : "Yes");
      add("Notes", rec.notes);
    } else if (module === "deals") {
      add("Deal", rec.name);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      const ct = rec.contactId && maps.contacts && maps.contacts.get(rec.contactId);
      add("Company", co ? co.name : "");
      add("Contact", ct ? ct.name : "");
      add("Stage", window.CRM_DEALS ? window.CRM_DEALS.stageLabel(rec.stage) : rec.stage);
      add("Owner", rec.owner);
      add("Expected value", (rec.expectedValue === undefined || rec.expectedValue === null || rec.expectedValue === "") ? "" : "$" + Number(rec.expectedValue).toLocaleString());
      add("Probability", rec.probability === undefined || rec.probability === null || rec.probability === "" ? "" : rec.probability + "%");
      add("Close date", R.fmtDate(rec.closeDate));
      add("Won", R.fmtDate(rec.wonAt));
      add("Lost", R.fmtDate(rec.lostAt));
      add("Loss reason", rec.lossReason);
      add("Notes", rec.notes);
    } else if (module === "leads") {
      add("Lead", rec.name || rec.subject);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      const ct = rec.contactId && maps.contacts && maps.contacts.get(rec.contactId);
      add("Company", co ? co.name : "");
      add("Contact", ct ? ct.name : "");
      add("Source", rec.source);
      add("Owner", rec.owner);
      add("Status", rec.status);
      add("Notes", rec.notes);
    } else if (module === "services") {
      add("Service", rec.name);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      const ct = rec.contactId && maps.contacts && maps.contacts.get(rec.contactId);
      add("Account", co ? co.name : "");
      add("Primary contact", ct ? ct.name : "");
      const D = window.CRM_DOMAIN;
      add("Category", D ? D.categoryLabel(rec.category) : rec.category);
      add("Status", D ? D.statusLabel(rec.status) : rec.status);
      add("Recurring charge", (rec.charge === undefined || rec.charge === null || rec.charge === "") ? "" : "$" + Number(rec.charge).toLocaleString() + " / " + (D ? D.cycleLabel(rec.billingCycle).toLowerCase() : rec.billingCycle));
      if (D && D.isBillable(rec)) {
        add("Monthly recurring (MRR)", "$" + Math.round(D.monthlyOf(rec)).toLocaleString());
        add("Annual value (ARR)", "$" + Math.round(D.annualOf(rec)).toLocaleString());
      }
      add("One-time / setup", (rec.setupFee === undefined || rec.setupFee === null || rec.setupFee === "") ? "" : "$" + Number(rec.setupFee).toLocaleString());
      add("Seats / lines / channels", rec.quantity);
      add("Bandwidth", rec.bandwidth ? rec.bandwidth + " Mbps" : "");
      add("Circuit id", rec.circuitId);
      add("Contract term", rec.contractTermMonths ? rec.contractTermMonths + " months" : "");
      add("Start date", R.fmtDate(rec.startDate));
      const ren = D ? D.renewalDateOf(rec) : "";
      if (ren) add(rec.endDate ? "Contract end / renewal" : "Projected renewal", R.fmtDate(ren) + (rec.autoRenew ? " · auto-renews" : ""));
      add("Service address", D ? D.tenantOf(rec) : "");
      const svcSite = rec.siteId && maps.sites && maps.sites.get(rec.siteId);
      add("Site", svcSite ? svcSite.name : "");
      add("Owner", rec.owner);
      add("Tags", (rec.tags || []).join(", "));
      add("Notes", rec.notes);
    } else if (module === "sites") {
      add("Site", rec.name);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      add("Company", co ? co.name : "");
      add("Type", window.CRM_DOMAIN ? window.CRM_DOMAIN.siteTypeLabel(rec.siteType) : rec.siteType);
      add("Status", window.CRM_DOMAIN ? window.CRM_DOMAIN.siteStatusLabel(rec.status) : rec.status);
      add("Site code", rec.siteCode);
      add("Timezone", rec.timezone);
      add("Address", window.CRM_DOMAIN ? window.CRM_DOMAIN.siteAddressOf(rec) : "");
      const ctNames = (Array.isArray(rec.contactIds) ? rec.contactIds : []).map(cid => { const c = maps.contacts && maps.contacts.get(cid); return c ? c.name : cid; });
      add("Contacts on site", ctNames.join(", "));
      add("Access & hours", rec.accessNotes);
      add("Owner", rec.owner);
      add("Tags", (rec.tags || []).join(", "));
      add("Notes", rec.notes);
    } else if (module === "assets") {
      const D = window.CRM_DOMAIN;
      add("Asset", window.CRM_ASSETS ? window.CRM_ASSETS.assetName(rec) : (rec.name || rec.identifier));
      add("Kind", D ? D.assetKindLabel(rec.kind) : rec.kind);
      add(D ? D.assetKindIdLabel(rec.kind) : "Identifier", rec.identifier);
      add("Status", D ? D.assetStatusLabel(rec.status) : rec.status);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      const site = rec.siteId && maps.sites && maps.sites.get(rec.siteId);
      const svc = rec.serviceId && maps.services && maps.services.get(rec.serviceId);
      add("Account", co ? co.name : "");
      add("Site", site ? site.name : "");
      add("Service", svc ? svc.name : "");
      (D ? D.assetKindFields(rec.kind) : []).forEach(f => {
        const v = rec[f.key];
        if (v === undefined || v === null || v === "") return;
        add(f.label, f.key === "purchaseCost" ? "$" + Number(v).toLocaleString() : f.key === "bandwidth" ? v + " Mbps" : String(v));
      });
      if (rec.warrantyEnd) add("Warranty / support end", R.fmtDate(rec.warrantyEnd));
      add("Owner", rec.owner);
      add("Tags", (rec.tags || []).join(", "));
      add("Notes", rec.notes);
    } else if (module === "tickets") {
      const D = window.CRM_DOMAIN;
      add("Subject", rec.subject);
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      const ct = rec.contactId && maps.contacts && maps.contacts.get(rec.contactId);
      const site = rec.siteId && maps.sites && maps.sites.get(rec.siteId);
      const svc = rec.serviceId && maps.services && maps.services.get(rec.serviceId);
      const asset = rec.assetId && maps.assets && maps.assets.get(rec.assetId);
      add("Account", co ? co.name : "");
      add("Contact", ct ? ct.name : "");
      add("Service", svc ? svc.name : "");
      add("Site", site ? site.name : "");
      add("Asset", asset ? (window.CRM_ASSETS ? window.CRM_ASSETS.assetName(asset) : (asset.name || asset.identifier)) : "");
      add("Category", D ? D.ticketCategoryLabel(rec.category) : rec.category);
      add("Priority", D ? D.ticketPriorityLabel(rec.priority) : rec.priority);
      add("Status", D ? D.ticketStatusLabel(rec.status) : rec.status);
      add("Assignee", rec.assignee);
      add("Source", (D && D.TICKET_SOURCES.find(s => s.id === rec.source) || {}).label || rec.source);
      add("Opened", R.fmtStamp(rec.openedAt));
      if (D) {
        const sla = D.ticketSla(rec);
        add("SLA response target", sla.responseTargetMin + " min");
        add("SLA resolution target", sla.resolveTargetMin + " min");
        add("Resolve by", R.fmtStamp(sla.resolveDueAt));
      }
      add("First response", R.fmtStamp(rec.firstResponseAt));
      add("Resolved", R.fmtStamp(rec.resolvedAt));
      add("Closed", R.fmtStamp(rec.closedAt));
      add("Description", rec.description);
      add("Tags", (rec.tags || []).join(", "));
      const jn = Array.isArray(rec.journal) ? rec.journal : [];
      if (jn.length) add("Journal", jn.map(j => "[" + (R.fmtStamp(j.at) || "") + " · " + (j.by || "") + " · " + j.kind + "] " + (j.text || "")).join("\n"));
    } else if (module === "documents") {
      const D = window.CRM_DOMAIN;
      add("Title", rec.title);
      add("Type", D ? D.docTypeLabel(rec.type) : rec.type);
      add("State", D ? D.docStateLabel(rec) : rec.status);
      add("Belongs to", ownerNameOf(rec, maps));
      const co = rec.companyId && maps.companies && maps.companies.get(rec.companyId);
      add("Account", co ? co.name : "");
      add("Reference", rec.reference);
      add("Contract value", (rec.value === undefined || rec.value === null || rec.value === "") ? "" : "$" + Number(rec.value).toLocaleString());
      add("Start date", R.fmtDate(rec.startDate));
      add("End / renewal date", R.fmtDate(rec.endDate));
      add("Attachment", rec.fileUrl);
      add("Document text", rec.body);
      add("Tags", (rec.tags || []).join(", "));
      add("Notes", rec.notes);
    } else {
      add("Subject", rec.subject);
      add("Type", (rec.type || "").charAt(0).toUpperCase() + String(rec.type || "").slice(1));
      add("When", R.fmtStamp(rec.at || rec.createdAt));
      add("Owner", rec.owner);
      add("Notes", rec.notes);
    }
    add("Record id", rec.id);
    add("Created", R.fmtStamp(rec.createdAt));
    add("Updated", R.fmtStamp(rec.updatedAt));
    return lines.join("");
  }

  function slug(s) {
    return String(s || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
  }

  return {
    parseCSV,
    toCSV,
    download,
    HEADER_HINTS,
    FIELD_LABELS,
    fieldOptions,
    guessHeaderMap,
    buildRaw,
    validateRaw,
    existingCheck,
    companyByNameMap,
    loadModuleRecords,
    moduleColumns,
    buildMaps,
    recordSheetHtml,
    renderTable,
    csvCell,
    slug,
    boolOf,
    employeesOf
  };
})();
