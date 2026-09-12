// ============================================================================
// quote-u — connector gateway (roadmap task 9)
// ----------------------------------------------------------------------------
// Every cross-system read or write goes through ONE gateway. A connector is a
// named adapter exposing an allowlisted set of functions; the gateway is the
// only way to call them. It carries the caller's account scope and records a
// call log, and it never lets a caller reach a record outside that scope.
//
// Pipeline mapping: the real PSA connector (CRM-U companies/contacts/deals)
// arrives with the pipeline bus in Phase 8. For now the gateway ships a MOCK
// PSA adapter seeded from DEFAULT_PSA_SEED, so quote creation and external
// linking can be built and tested end-to-end without a live sibling generator.
// ============================================================================
window.QU_CONNECTORS = (function () {
  function normalizeScope(scope) {
    if (scope === undefined || scope === null) return [];
    if (scope === "*") return ["*"];
    if (Array.isArray(scope)) return scope.map(String);
    if (typeof scope === "string") return [scope];
    return [];
  }

  // The IDOR guard: a caller may only see accounts in its scope, and the
  // all-accounts scope is the explicit sentinel "*".
  function scopeAllows(scope, companyId) {
    const s = normalizeScope(scope);
    if (s.indexOf("*") !== -1) return true;
    if (companyId === undefined || companyId === null) return false;
    return s.indexOf(String(companyId)) !== -1;
  }

  function filterByScope(scope, records, key) {
    key = key || "company_id";
    const s = normalizeScope(scope);
    if (s.indexOf("*") !== -1) return records.slice();
    return records.filter(r => r && s.indexOf(String(r[key])) !== -1);
  }

  function matchQuery(query, str) {
    if (!query) return true;
    return String(str || "").toLowerCase().indexOf(String(query).toLowerCase()) !== -1;
  }

  function fail(code, detail) {
    const e = new Error(detail || code);
    e.code = code;
    return e;
  }

  const DEFAULT_PSA_SEED = {
    companies: [
      { id: "c1", name: "Northwind Systems", industry: "IT services" },
      { id: "c2", name: "Harborline Logistics", industry: "freight" },
      { id: "c3", name: "Cedar & Finch Legal", industry: "legal" }
    ],
    contacts: [
      { id: "ct1", company_id: "c1", name: "Dana Whitfield", email: "dana@northwind.example", title: "IT Director" },
      { id: "ct2", company_id: "c1", name: "Sam Okafor", email: "sam@northwind.example", title: "Operations Manager" },
      { id: "ct3", company_id: "c2", name: "Priya Raman", email: "priya@harborline.example", title: "CFO" },
      { id: "ct4", company_id: "c3", name: "Alan Finch", email: "alan@cedarfinch.example", title: "Partner" }
    ],
    opportunities: [
      { id: "op1", company_id: "c1", name: "Northwind network refresh", stage: "qualified", amount_cents: 1200000 },
      { id: "op2", company_id: "c1", name: "Northwind managed IT renewal", stage: "proposal", amount_cents: 480000 },
      { id: "op3", company_id: "c2", name: "Harborline VoIP rollout", stage: "new", amount_cents: 0 }
    ]
  };

  function createMockPsa(seed) {
    // Clone the seed so every mock PSA owns its database: callers that share a
    // seed object (e.g. two test envs built from DEFAULT_PSA_SEED) must not see
    // each other's writes leak across.
    const db = JSON.parse(JSON.stringify(seed || DEFAULT_PSA_SEED));
    if (!db.opportunities) db.opportunities = [];
    if (!db.opp_writes) db.opp_writes = Object.create(null);
    if (!db.invoices) db.invoices = [];
    if (!db.invoice_writes) db.invoice_writes = Object.create(null);
    let seq = 0;
    function nextId(prefix) {
      seq += 1;
      return prefix + "-" + Date.now().toString(36) + "-" + seq;
    }
    const functions = {
      getCompany(payload, ctx) {
        const c = (db.companies || []).find(x => x.id === payload.id);
        return c && scopeAllows(ctx.scope, c.id) ? Object.assign({}, c) : null;
      },
      listCompanies(payload, ctx) {
        return filterByScope(ctx.scope, db.companies || [], "id").filter(c => matchQuery(payload.query, c.name)).map(c => Object.assign({}, c));
      },
      getContact(payload, ctx) {
        const c = (db.contacts || []).find(x => x.id === payload.id);
        return c && scopeAllows(ctx.scope, c.company_id) ? Object.assign({}, c) : null;
      },
      listContacts(payload, ctx) {
        const companyId = payload.company_id;
        if (!companyId) throw fail("company_required", "listContacts needs a company_id.");
        if (!scopeAllows(ctx.scope, companyId)) return [];
        return (db.contacts || []).filter(c => c.company_id === companyId).filter(c => matchQuery(payload.query, c.name)).map(c => Object.assign({}, c));
      },
      getOpportunity(payload, ctx) {
        const o = (db.opportunities || []).find(x => x.id === payload.id);
        return o && scopeAllows(ctx.scope, o.company_id) ? Object.assign({}, o) : null;
      },
      listOpportunities(payload, ctx) {
        const companyId = payload.company_id;
        if (!companyId) throw fail("company_required", "listOpportunities needs a company_id.");
        if (!scopeAllows(ctx.scope, companyId)) return [];
        return (db.opportunities || []).filter(o => o.company_id === companyId).filter(o => matchQuery(payload.query, o.name)).map(o => Object.assign({}, o));
      },
      createOpportunity(payload, ctx) {
        const companyId = payload.company_id;
        if (!companyId) throw fail("company_required", "createOpportunity needs a company_id.");
        if (!scopeAllows(ctx.scope, companyId)) throw fail("not_found", "No such account.");
        const name = String(payload.name || "").trim();
        if (!name) throw fail("bad_opportunity", "An opportunity needs a name.");
        const opp = {
          id: nextId("op"),
          company_id: companyId,
          name,
          stage: payload.stage || "new",
          amount_cents: Number.isSafeInteger(payload.amount_cents) ? payload.amount_cents : 0,
          created_at: new Date().toISOString()
        };
        db.opportunities.push(opp);
        return Object.assign({}, opp);
      },
      // Update a deal — the write the approval orchestrator performs when a
      // quote is won (roadmap task 31). Idempotent by `idempotency_key`: the
      // first call stores its result under the key and every later call with
      // the same key returns that stored result WITHOUT writing again, so a
      // retried outbox job can never apply the same deal update twice (I5).
      updateOpportunity(payload, ctx) {
        const o = (db.opportunities || []).find(x => x.id === (payload && payload.id));
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        const key = payload && payload.idempotency_key ? String(payload.idempotency_key) : null;
        if (key) {
          if (!db.opp_writes) db.opp_writes = Object.create(null);
          if (db.opp_writes[key]) return Object.assign({}, db.opp_writes[key]);
        }
        if (payload.stage !== undefined && payload.stage !== null) {
          const stage = String(payload.stage).trim();
          if (!stage) throw fail("bad_stage", "An opportunity stage cannot be empty.");
          o.stage = stage;
        }
        if (payload.amount_cents !== undefined && payload.amount_cents !== null) {
          if (!Number.isSafeInteger(payload.amount_cents)) throw fail("bad_amount", "amount_cents must be integer cents.");
          o.amount_cents = payload.amount_cents;
        }
        if (payload.name !== undefined && payload.name !== null) {
          const name = String(payload.name).trim();
          if (!name) throw fail("bad_opportunity", "An opportunity name cannot be empty.");
          o.name = name;
        }
        o.updated_at = new Date().toISOString();
        o.write_count = (o.write_count || 0) + 1;
        const result = Object.assign({}, o);
        if (key) db.opp_writes[key] = result;
        return result;
      },
      // Read the count of real writes a deal has taken — the test hook that
      // proves idempotency (an idempotent retry leaves this unchanged).
      opportunityWriteCount(payload, ctx) {
        const o = (db.opportunities || []).find(x => x.id === (payload && payload.id));
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        return { id: o.id, write_count: o.write_count || 0 };
      },
      // Write a note onto a deal — the products/costs/part-numbers block the
      // approval orchestrator attaches so the PSA's downstream deal sync
      // carries the detail it needs (roadmap task 32). Idempotent by
      // `idempotency_key`: a repeated call returns the stored result without
      // appending the note again.
      writeNote(payload, ctx) {
        const o = findOpp(payload);
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        const key = payload && payload.idempotency_key ? String(payload.idempotency_key) : null;
        if (key) {
          if (!db.note_writes) db.note_writes = Object.create(null);
          if (db.note_writes[key]) return Object.assign({}, db.note_writes[key]);
        }
        const body = String((payload && payload.note) || "").trim();
        if (!body) throw fail("bad_note", "An opportunity note cannot be empty.");
        if (!db.notes) db.notes = Object.create(null);
        const list = db.notes[o.id] || (db.notes[o.id] = []);
        const note = {
          id: o.id + "-note-" + (list.length + 1),
          body: body,
          structured: (payload && payload.structured) || null,
          source: (payload && payload.source) || null,
          written_at: new Date().toISOString()
        };
        list.push(note);
        o.note_count = list.length;
        const result = { id: o.id, note_id: note.id, note_count: o.note_count };
        if (key) db.note_writes[key] = result;
        return result;
      },
      // Read the notes written onto a deal (the test/read hook).
      getOpportunityNotes(payload, ctx) {
        const o = findOpp(payload);
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        const list = (db.notes && db.notes[o.id]) || [];
        return { id: o.id, note_count: list.length, notes: list.map(n => Object.assign({}, n)) };
      },
      // Write the approved selection's revenue/product lines onto a deal so the
      // PSA's accounting sync can populate the deal amount from the products
      // (roadmap task 33). Idempotent by `idempotency_key`.
      writeRevenueLines(payload, ctx) {
        const o = findOpp(payload);
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        const key = payload && payload.idempotency_key ? String(payload.idempotency_key) : null;
        if (key) {
          if (!db.revenue_writes) db.revenue_writes = Object.create(null);
          if (db.revenue_writes[key]) return Object.assign({}, db.revenue_writes[key]);
        }
        const lines = payload && Array.isArray(payload.lines) ? payload.lines : null;
        if (!lines || !lines.length) throw fail("bad_lines", "Revenue lines must be a non-empty array.");
        for (const l of lines) {
          if (!l || typeof l.description !== "string" || !l.description.trim()) throw fail("bad_line", "Every revenue line needs a description.");
          if (!Number.isSafeInteger(l.amount_cents)) throw fail("bad_amount", "Every revenue line needs integer-cent amount_cents.");
        }
        if (!db.revenue) db.revenue = Object.create(null);
        const stored = lines.map((l, i) => ({
          id: o.id + "-rev-" + (i + 1),
          description: String(l.description).trim(),
          sku: l.sku ? String(l.sku) : null,
          mpn: l.mpn ? String(l.mpn) : null,
          kind: l.kind || "one_time",
          quantity: Number.isFinite(l.quantity) ? l.quantity : 1,
          unit_price_cents: Number.isSafeInteger(l.unit_price_cents) ? l.unit_price_cents : null,
          amount_cents: l.amount_cents,
          currency: l.currency || null,
          recurring: l.recurring === true
        }));
        db.revenue[o.id] = stored;
        o.revenue_lines = stored.length;
        o.revenue_total_cents = stored.reduce((sum, l) => sum + l.amount_cents, 0);
        o.revenue_write_count = (o.revenue_write_count || 0) + 1;
        const result = { id: o.id, line_count: stored.length, revenue_total_cents: o.revenue_total_cents, revenue_write_count: o.revenue_write_count };
        if (key) db.revenue_writes[key] = result;
        return result;
      },
      // Read the revenue lines written onto a deal (the test/read hook).
      getRevenueLines(payload, ctx) {
        const o = findOpp(payload);
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        const lines = (db.revenue && db.revenue[o.id]) || [];
        return { id: o.id, line_count: lines.length, revenue_total_cents: o.revenue_total_cents || 0, revenue_write_count: o.revenue_write_count || 0, lines: lines.map(l => Object.assign({}, l)) };
      },
      // Path B (roadmap task 36): hand the approved selection's product/revenue
      // records to the PSA so the PSA's own accounting sync produces the
      // invoice. The write stores the product records on the opportunity, then
      // the simulated accounting sync creates the PSA-side invoice and returns
      // its reference. Idempotent by `idempotency_key`: a retried call returns
      // the SAME invoice without creating a second one (I5).
      requestInvoice(payload, ctx) {
        const o = findOpp(payload);
        if (!o || !scopeAllows(ctx.scope, o.company_id)) throw fail("not_found", "No such opportunity.");
        const key = payload && payload.idempotency_key ? String(payload.idempotency_key) : null;
        if (key && db.invoice_writes[key]) return Object.assign({}, db.invoice_writes[key]);
        const lines = payload && Array.isArray(payload.lines) ? payload.lines : null;
        if (!lines || !lines.length) throw fail("bad_lines", "An invoice request needs at least one product/revenue line.");
        let subtotal = 0;
        const stored = lines.map((l, i) => {
          if (!l || typeof l.description !== "string" || !l.description.trim()) throw fail("bad_line", "Every invoice line needs a description.");
          if (!Number.isSafeInteger(l.amount_cents)) throw fail("bad_amount", "Every invoice line needs integer-cent amount_cents.");
          subtotal += l.amount_cents;
          return {
            id: o.id + "-invline-" + (i + 1),
            description: String(l.description).trim(),
            sku: l.sku ? String(l.sku) : null,
            mpn: l.mpn ? String(l.mpn) : null,
            psa_product_id: l.psa_product_id ? String(l.psa_product_id) : null,
            kind: l.kind || "one_time",
            quantity: Number.isFinite(l.quantity) ? l.quantity : 1,
            unit_price_cents: Number.isSafeInteger(l.unit_price_cents) ? l.unit_price_cents : null,
            amount_cents: l.amount_cents,
            currency: l.currency || null,
            recurring: l.recurring === true
          };
        });
        // The product/revenue records the PSA holds for the deal.
        o.revenue_lines = stored.length;
        o.revenue_total_cents = subtotal;
        o.invoiced = true;
        // The PSA's accounting sync turns those product records into an invoice.
        const rateBp = Number.isInteger(payload.tax_rate_bp) ? payload.tax_rate_bp : 500;
        const tax = Math.round(subtotal * rateBp / 10000);
        const invoice = {
          id: "psa-inv-" + (db.invoices.length + 1) + "-" + Date.now().toString(36),
          invoice_number: "PSA-" + String(db.invoices.length + 1).padStart(5, "0"),
          opportunity_id: o.id,
          company_id: o.company_id,
          quote_id: payload.quote_id || null,
          version_id: payload.version_id || null,
          currency: payload.currency || null,
          lines: stored,
          line_count: stored.length,
          subtotal_cents: subtotal,
          tax_cents: tax,
          tax_rate_bp: rateBp,
          total_cents: subtotal + tax,
          status: "open",
          source: "psa_accounting_sync",
          created_at: new Date().toISOString()
        };
        db.invoices.push(invoice);
        o.invoice_ref = invoice.id;
        const result = {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          opportunity_id: o.id,
          version_id: invoice.version_id,
          currency: invoice.currency,
          subtotal_cents: subtotal,
          tax_cents: tax,
          tax_rate_bp: rateBp,
          total_cents: invoice.total_cents,
          line_count: stored.length,
          status: invoice.status,
          idempotency_key: key
        };
        if (key) db.invoice_writes[key] = result;
        return result;
      },
      // Read hook for a PSA-produced invoice.
      getPsaInvoice(payload, ctx) {
        payload = payload || {};
        const inv = db.invoices.find(x => x.id === payload.id) || (payload.version_id ? db.invoices.find(x => x.version_id === payload.version_id) : null);
        if (!inv || !scopeAllows(ctx.scope, inv.company_id)) return null;
        return Object.assign({}, inv);
      },
      psaInvoiceCount() { return db.invoices.length; }
    };
    function findOpp(payload) {
      const id = payload && (payload.id !== undefined ? payload.id : payload.opportunity_id);
      return (db.opportunities || []).find(x => x.id === id);
    }
    return { name: "psa", functions, seed: db };
  }

  // ---- outbound email / activity bus (roadmap task 18) ----------------------
  // "Send as the rep's own mailbox": the send pipeline composes a message with
  // `from` = the rep's mailbox and `to` = the client contact, then hands it to
  // this connector. The mock adapter records every message in an in-memory
  // outbox (the activity bus) and can also produce a mailto: URL, so the send
  // flow is testable end-to-end until the real pipeline bus arrives (Phase 8).
  const DEFAULT_MAIL_SEED = {
    reps: [
      { id: "rep1", name: "Alex Rivera", mailbox: "alex.rivera@example.com", group: "sales" },
      { id: "rep2", name: "Jordan Blake", mailbox: "jordan.blake@example.com", group: "sales" },
      { id: "ops1", name: "Priya Raman", mailbox: "priya.raman@example.com", group: "operations" }
    ]
  };

  function mailtoUrl(input) {
    input = input || {};
    const to = encodeURIComponent(String(input.to || ""));
    const params = [];
    if (input.subject) params.push("subject=" + encodeURIComponent(String(input.subject)));
    if (input.body) params.push("body=" + encodeURIComponent(String(input.body)));
    if (input.cc) params.push("cc=" + encodeURIComponent(String(input.cc)));
    if (input.bcc) params.push("bcc=" + encodeURIComponent(String(input.bcc)));
    return "mailto:" + to + (params.length ? "?" + params.join("&") : "");
  }

  function createMockMail(seed, opts) {
    opts = opts || {};
    const db = { reps: ((seed && seed.reps) || DEFAULT_MAIL_SEED.reps).slice(), outbox: [] };
    let seq = 0;
    function nextId() { seq += 1; return "msg-" + Date.now().toString(36) + "-" + seq; }
    const functions = {
      listReps() { return db.reps.map(r => Object.assign({}, r)); },
      resolveRep(payload) {
        const want = String((payload && (payload.actor || payload.mailbox || payload.name)) || "").trim().toLowerCase();
        if (!want) return null;
        const found = db.reps.find(r => r.id.toLowerCase() === want || r.name.toLowerCase() === want || r.mailbox.toLowerCase() === want);
        return found ? Object.assign({}, found) : null;
      },
      send(payload, ctx) {
        payload = payload || {};
        if (payload.company_id && !scopeAllows(ctx.scope, payload.company_id)) throw fail("not_found", "No such account.");
        const to = String(payload.to || "").trim();
        if (!to) throw fail("recipient_required", "An outbound email needs a recipient.");
        const from = String(payload.from || "").trim();
        if (!from) throw fail("sender_required", "An outbound email must be sent from the rep's own mailbox.");
        // Task 48: the send-as-rep application permission. Every delivery is
        // subject to it — the sender must be a member of the permission's scope
        // group and must be sending as their OWN mailbox (never a shared one).
        if (typeof opts.authorize === "function") {
          const auth = opts.authorize({ actor: payload.actor, from: from, to: to, company_id: payload.company_id || null });
          if (!auth || auth.ok !== true) {
            throw fail((auth && auth.code) || "mail_permission_denied", (auth && auth.detail) || "Mail must be sent as the rep's own mailbox.");
          }
        }
        const transport = payload.transport || "log";
        const sent_at = new Date().toISOString();
        // `mailto` represents delivery through the user's OWN mail client (no
        // server mailbox, no additional license). It produces a link the rep
        // opens; nothing is queued server-side, but the delivery is still
        // recorded by the caller's audit log.
        if (transport === "mailto") {
          return { id: nextId(), to, from, subject: String(payload.subject || ""), link: payload.link || null,
            quote_id: payload.quote_id || null, version_id: payload.version_id || null, company_id: payload.company_id || null,
            transport: "mailto", client: true, mailto_url: mailtoUrl({ to, subject: payload.subject, body: payload.body }), sent_at };
        }
        const msg = {
          id: nextId(),
          to,
          from,
          subject: String(payload.subject || ""),
          body: String(payload.body || ""),
          link: payload.link || null,
          quote_id: payload.quote_id || null,
          version_id: payload.version_id || null,
          company_id: payload.company_id || null,
          transport: transport,
          sent_at
        };
        db.outbox.push(msg);
        return Object.assign({}, msg);
      },
      get(payload, ctx) {
        const m = db.outbox.find(x => x.id === (payload && payload.id));
        return m && (!m.company_id || scopeAllows(ctx.scope, m.company_id)) ? Object.assign({}, m) : null;
      },
      list(payload, ctx) {
        payload = payload || {};
        return db.outbox.filter(m => {
          if (payload.quote_id && m.quote_id !== payload.quote_id) return false;
          if (payload.company_id && m.company_id !== payload.company_id) return false;
          return !m.company_id || scopeAllows(ctx.scope, m.company_id);
        }).map(m => Object.assign({}, m));
      },
      outboxSize() { return db.outbox.length; }
    };
    return { name: "mail", functions, seed: db };
  }

  // ---- accounting connector (roadmap task 35) -------------------------------
  // The DIRECT invoicing path's destination: the accounting system. quote-u
  // sends the APPROVED selection's pre-tax lines; the accounting system owns the
  // authoritative tax and the invoice number, so the adapter computes the tax
  // (from a caller-supplied rate) and returns the created invoice reference. The
  // mock keeps customers keyed by `external_key` (the company/customer mapping
  // resolves to one) and invoices keyed by `idempotency_key`, so a retried job
  // can never create a second invoice for a version (I5).
  const DEFAULT_ACCOUNTING_SEED = {
    customers: [
      { id: "acct-c1", external_key: "c1", name: "Northwind Systems" },
      { id: "acct-c2", external_key: "c2", name: "Harborline Logistics" }
    ]
  };

  function createMockAccounting(seed) {
    const db = JSON.parse(JSON.stringify(seed || DEFAULT_ACCOUNTING_SEED));
    if (!db.customers) db.customers = [];
    if (!db.invoices) db.invoices = [];
    db.invoice_writes = Object.create(null);
    let seq = 0;
    function nextId(prefix) {
      seq += 1;
      return prefix + "-" + Date.now().toString(36) + "-" + seq;
    }
    const functions = {
      // Create or update the accounting customer for a company. Idempotent by
      // `external_key` (default: the company id), so the same company always
      // resolves to one accounting customer.
      upsertCustomer(payload) {
        payload = payload || {};
        const key = payload.external_key !== undefined && payload.external_key !== null ? String(payload.external_key)
          : (payload.company_id !== undefined && payload.company_id !== null ? String(payload.company_id) : null);
        if (!key) throw fail("customer_key_required", "upsertCustomer needs an external_key or company_id.");
        const name = String(payload.name || "").trim() || ("Customer " + key);
        const existing = db.customers.find(c => String(c.external_key) === key);
        if (existing) {
          if (payload.name !== undefined && String(payload.name).trim()) existing.name = name;
          if (payload.email !== undefined) existing.email = payload.email ? String(payload.email) : (existing.email || null);
          if (payload.contact_name !== undefined) existing.contact_name = payload.contact_name ? String(payload.contact_name) : (existing.contact_name || null);
          existing.updated_at = new Date().toISOString();
          return { customer_id: existing.id, external_key: existing.external_key, name: existing.name, created: false };
        }
        const cust = {
          id: nextId("acct"),
          external_key: key,
          name: name,
          email: payload.email ? String(payload.email) : null,
          contact_name: payload.contact_name ? String(payload.contact_name) : null,
          created_at: new Date().toISOString()
        };
        db.customers.push(cust);
        return { customer_id: cust.id, external_key: cust.external_key, name: cust.name, created: true };
      },
      // Read hook for the customer upsert.
      getCustomer(payload) {
        payload = payload || {};
        const key = payload.customer_id !== undefined ? payload.customer_id : (payload.external_key !== undefined ? payload.external_key : payload.company_id);
        const c = db.customers.find(x => x.id === key || String(x.external_key) === String(key));
        return c ? Object.assign({}, c) : null;
      },
      // Create the invoice from the approved selection. Idempotent by
      // `idempotency_key`: a repeated call returns the stored invoice WITHOUT
      // creating another. The adapter computes the authoritative tax + total.
      createInvoice(payload) {
        payload = payload || {};
        const key = payload.idempotency_key ? String(payload.idempotency_key) : null;
        if (key && db.invoice_writes[key]) return Object.assign({}, db.invoice_writes[key]);
        const cust = db.customers.find(c => c.id === payload.customer_id) || db.customers.find(c => String(c.external_key) === String(payload.external_key));
        if (!cust) throw fail("customer_required", "createInvoice needs a known customer_id.");
        const lines = Array.isArray(payload.lines) ? payload.lines : null;
        if (!lines || !lines.length) throw fail("bad_lines", "An invoice needs at least one line.");
        let subtotal = 0;
        const stored = lines.map((l, i) => {
          if (!l || typeof l.description !== "string" || !l.description.trim()) throw fail("bad_line", "Every invoice line needs a description.");
          if (!Number.isSafeInteger(l.amount_cents)) throw fail("bad_amount", "Every invoice line needs integer-cent amount_cents.");
          subtotal += l.amount_cents;
          return {
            id: "line-" + (i + 1),
            description: String(l.description).trim(),
            quantity: Number.isFinite(l.quantity) ? l.quantity : 1,
            unit_price_cents: Number.isSafeInteger(l.unit_price_cents) ? l.unit_price_cents : null,
            amount_cents: l.amount_cents,
            recurring: l.recurring === true,
            sku: l.sku ? String(l.sku) : null,
            mpn: l.mpn ? String(l.mpn) : null
          };
        });
        const rateBp = Number.isInteger(payload.tax_rate_bp) ? payload.tax_rate_bp : 500;
        const tax = Math.round(subtotal * rateBp / 10000);
        const total = subtotal + tax;
        const invoice = {
          id: nextId("inv"),
          invoice_number: "INV-" + String(db.invoices.length + 1).padStart(5, "0"),
          customer_id: cust.id,
          company_id: payload.company_id || null,
          quote_id: payload.quote_id || null,
          version_id: payload.version_id || null,
          currency: payload.currency || null,
          lines: stored,
          line_count: stored.length,
          subtotal_cents: subtotal,
          tax_cents: tax,
          tax_rate_bp: rateBp,
          total_cents: total,
          status: "open",
          source: payload.source || null,
          created_at: new Date().toISOString()
        };
        db.invoices.push(invoice);
        const result = {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          customer_id: cust.id,
          currency: invoice.currency,
          subtotal_cents: subtotal,
          tax_cents: tax,
          tax_rate_bp: rateBp,
          total_cents: total,
          status: invoice.status,
          line_count: stored.length,
          idempotency_key: key
        };
        if (key) db.invoice_writes[key] = result;
        return result;
      },
      // Read hook for the created invoice.
      getInvoice(payload) {
        payload = payload || {};
        const inv = db.invoices.find(x => x.id === payload.id) || (payload.version_id ? db.invoices.find(x => x.version_id === payload.version_id) : null);
        return inv ? Object.assign({}, inv) : null;
      },
      invoiceCount() { return db.invoices.length; },
      customerCount() { return db.customers.length; }
    };
    return { name: "accounting", functions, seed: db };
  }

  // ---- pipeline bus (roadmap task 50) ---------------------------------------
  // The shared pipeline bus carries quote/approval events to the rest of the
  // pipeline (knowledge base, BI, other tools) as a versioned event stream
  // (`bus-quote-events`), and fans the same envelopes out to outbound webhooks.
  // The mock adapter keeps the stream and the webhook deliveries in memory so
  // the publication path is testable end-to-end without a live bus; publishing
  // is idempotent by envelope id, and a webhook delivery is idempotent by
  // (url, envelope id), so a retried flush can never double-publish or
  // double-deliver.
  function createMockBus(seed) {
    const db = { streams: Object.create(null), deliveries: [] };
    (seed && seed.streams ? Object.keys(seed.streams) : ["bus-quote-events"]).forEach(s => {
      db.streams[s] = ((seed && seed.streams && seed.streams[s]) || []).slice();
    });
    let seq = 0;
    function nextSeq() { seq += 1; return seq; }
    const functions = {
      publish(payload) {
        payload = payload || {};
        const envelope = payload.envelope || payload;
        if (!envelope || !envelope.id) throw fail("bad_envelope", "A published event needs an envelope with an id.");
        const stream = String(payload.stream || envelope.stream || "bus-quote-events");
        if (!db.streams[stream]) db.streams[stream] = [];
        const existing = db.streams[stream].find(e => e.id === envelope.id);
        if (existing) return { id: existing.id, stream, seq: existing.seq, published_at: existing.published_at, duplicate: true };
        const rec = Object.assign({}, envelope, { stream, seq: nextSeq(), published_at: new Date().toISOString() });
        db.streams[stream].push(rec);
        return { id: rec.id, stream, seq: rec.seq, published_at: rec.published_at, duplicate: false };
      },
      list(payload) {
        payload = payload || {};
        const stream = String(payload.stream || "bus-quote-events");
        const rows = (db.streams[stream] || []).slice();
        if (payload.type) return rows.filter(r => r.type === payload.type);
        return rows;
      },
      streamSize(payload) {
        payload = payload || {};
        return ((db.streams[String(payload.stream || "bus-quote-events")] || []).length);
      },
      webhookPost(payload) {
        payload = payload || {};
        const url = String(payload.url || "").trim();
        if (!url) throw fail("url_required", "A webhook delivery needs a url.");
        const envelope = payload.envelope || {};
        if (!envelope.id) throw fail("bad_envelope", "A webhook delivery needs an envelope with an id.");
        const existing = db.deliveries.find(d => d.url === url && d.envelope_id === envelope.id);
        if (existing) return Object.assign({}, existing, { duplicate: true });
        const rec = {
          id: "wh-" + Date.now().toString(36) + "-" + (db.deliveries.length + 1),
          url,
          envelope_id: envelope.id,
          type: envelope.type || null,
          signature: payload.signature || null,
          status: 200,
          delivered_at: new Date().toISOString()
        };
        db.deliveries.push(rec);
        return Object.assign({}, rec, { duplicate: false });
      },
      deliveries() { return db.deliveries.map(d => Object.assign({}, d)); },
      deliveryCount() { return db.deliveries.length; }
    };
    return { name: "bus", functions, seed: db };
  }


  // A connector is a named adapter with an allowlisted function set. The gateway
  // additionally carries, per connector: a declared effect for each function
  // (read | write), a GATEWAY KEY name (never the credential itself — the raw
  // credential lives in the fleet secret store and is resolved at call time by an
  // injected keystore), and the identity roles permitted to use it. Every call
  // is centralized, classified, logged, and can be individually disabled.

  // A gateway key is a NAME/handle, never a secret. Anything secret-shaped in a
  // declaration is a bug: the app must hold only keys and role assignments.
  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;
  const SECRET_VALUE_RE = /^(?:sk|pk|rk|ghp|gho|xox[abp]|AKIA|AIza)[-_]/i;

  const DEFAULT_ROLES = Object.freeze({
    owner: { connectors: ["*"], writes: true },
    manager: { connectors: ["*"], writes: true },
    viewer: { connectors: ["*"], writes: false }
  });

  function isSecretShaped(value) {
    if (value === undefined || value === null) return false;
    const s = String(value);
    if (SECRET_KEY_RE.test(s) || SECRET_VALUE_RE.test(s)) return true;
    // A long, high-entropy blob is not a name — refuse it as a key.
    return s.length >= 40 && /^[A-Za-z0-9_\-+/=]+$/.test(s) && new Set(s).size > 8;
  }

  function normalizeRoles(input) {
    const p = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const out = {};
    Object.keys(DEFAULT_ROLES).forEach(r => { out[r] = Object.assign({}, DEFAULT_ROLES[r]); });
    Object.keys(p).forEach(role => {
      const cfg = p[role] && typeof p[role] === "object" ? p[role] : {};
      const connectors = cfg.connectors === "*" ? ["*"] : (Array.isArray(cfg.connectors) ? cfg.connectors.map(String) : ["*"]);
      out[String(role)] = { connectors, writes: cfg.writes !== false };
    });
    return out;
  }

  // Does `role` allow using `connectorName` at this effect? A connector may
  // declare a restricted role list (`roles: ["owner","manager"]`); otherwise the
  // role's own assignment decides. An unknown role is denied (fail closed).
  function roleAllows(roleAssignments, role, connectorName, effect, declaredRoles) {
    const name = String(role || "");
    if (Array.isArray(declaredRoles) && declaredRoles.length && name !== "owner" && declaredRoles.indexOf(name) === -1) return false;
    const cfg = roleAssignments && roleAssignments[name];
    if (!cfg) return false;
    if (cfg.connectors.indexOf("*") === -1 && cfg.connectors.indexOf(String(connectorName)) === -1) return false;
    if (effect === "write" && cfg.writes === false) return false;
    return true;
  }

  // The effect (read|write) of a connector function, using the quote-u feature
  // classifier when it is loaded so governance has one source of truth.
  function deriveEffect(connectorName, fnName) {
    if (window.QU_FEATURES && typeof window.QU_FEATURES.classify === "function") {
      const cls = window.QU_FEATURES.classify(connectorName, fnName);
      if (cls && cls.kind) return cls.kind;
    }
    return "write"; // fail closed: an unclassified function is treated as a write
  }

  // Merge a connector's own descriptor with the app's declared manifest.
  function declarationOf(declared, connector, name) {
    return Object.assign({}, (connector && connector.descriptor) || {}, (declared && declared[name]) || {});
  }

  // The declared allowlist for a connector: its functions with effects. When a
  // declaration names an explicit `functions` set, ONLY those are callable — a
  // function present on the adapter but not declared is refused.
  function declaredFunctions(declared, connector, name) {
    const d = declarationOf(declared, connector, name);
    const present = Object.keys((connector && connector.functions) || {});
    const explicit = d.functions ? Object.keys(d.functions) : null;
    const map = {};
    const list = explicit ? present.filter(f => explicit.indexOf(f) !== -1) : present;
    list.forEach(f => {
      const decl = (d.functions && d.functions[f]) || {};
      map[f] = { effect: decl.effect || deriveEffect(name, f) };
    });
    return map;
  }

  function manifestOf(connectors, declared, enabled) {
    return Object.keys(connectors).map(name => {
      const c = connectors[name] || {};
      const d = declarationOf(declared, c, name);
      const fns = declaredFunctions(declared, c, name);
      return {
        name,
        label: d.label || name,
        kind: d.kind || (c.readOnly ? "read" : "mixed"),
        gateway_key: d.gateway_key || null,
        roles: Array.isArray(d.roles) ? d.roles.slice() : null,
        enabled: enabled[name] !== false,
        live: c.live === true,
        functions: Object.keys(fns).map(f => ({ name: f, effect: fns[f].effect }))
      };
    });
  }

  function createGateway(opts) {
    opts = opts || {};
    const connectors = opts.connectors || {};
    const callLog = [];
    const maxLog = opts.maxLog === undefined ? 200 : opts.maxLog;
    const declared = opts.manifest || {};
    const enabled = {};
    Object.keys(connectors).forEach(n => { enabled[n] = true; });
    if (opts.enabled && typeof opts.enabled === "object") {
      Object.keys(opts.enabled).forEach(n => { enabled[n] = opts.enabled[n] !== false; });
    }
    let keystore = opts.keystore || null;
    let roles = normalizeRoles(opts.roles);
    let defaultRole = opts.defaultRole || "owner";
    let enforceRoles = opts.enforceRoles !== false;
    let logSink = typeof opts.logSink === "function" ? opts.logSink : null;

    function log(entry) {
      callLog.push(entry);
      if (callLog.length > maxLog) callLog.shift();
      if (logSink) { try { logSink(entry); } catch (e) { /* a broken sink never breaks a call */ } }
    }

    function resolveKey(keyName) {
      if (!keyName) return { ok: true, key: null, credential: null };
      if (!keystore) return { ok: false, code: "credential_unavailable", detail: `The gateway key "${keyName}" cannot be resolved: no keystore is configured.` };
      let resolved;
      try {
        resolved = typeof keystore.resolve === "function" ? keystore.resolve(keyName) : (typeof keystore === "function" ? keystore(keyName) : keystore[keyName]);
      } catch (e) {
        return { ok: false, code: "credential_unavailable", detail: `The gateway key "${keyName}" could not be resolved.` };
      }
      if (resolved === undefined || resolved === null) return { ok: false, code: "credential_unavailable", detail: `The gateway key "${keyName}" is not present in the secret store.` };
      // Only an opaque handle ever reaches the connector; the secret itself is
      // resolved by the transport that the key names.
      const credential = typeof resolved === "object" ? Object.assign({}, resolved, { key: keyName }) : { key: keyName, ref: resolved };
      return { ok: true, key: keyName, credential };
    }

    function makeEntry(connectorName, fnName, info) {
      return {
        at: new Date().toISOString(),
        connector: connectorName,
        fn: fnName,
        scope: info.scope,
        effect: info.effect || null,
        role: info.role || null,
        key: info.key || null,
        live: !!info.live,
        started: Date.now()
      };
    }

    function refuse(entry, code, detail) {
      entry.ok = false;
      entry.code = code;
      entry.ms = Math.max(0, Date.now() - entry.started);
      log(entry);
      return { ok: false, code, detail, policy: code === "connector_disabled" || code === "role_denied" };
    }

    // Shared validation for both the sync and async call paths: resolve the
    // connector + function, check that it is enabled and declared/allowed, apply
    // the identity-role rule, then resolve the gateway key for a live connector.
    function resolve(connectorName, fnName, ctx) {
      const scope = normalizeScope(ctx && ctx.scope);
      const connector = connectors[connectorName];
      const role = (ctx && ctx.role) || defaultRole;
      const base = { scope, role };
      if (!connector) {
        return { ok: false, refusal: refuse(makeEntry(connectorName, fnName, base), "unknown_connector", `No connector named "${connectorName}".`) };
      }
      const fns = declaredFunctions(declared, connector, connectorName);
      const decl = declarationOf(declared, connector, connectorName);
      const effect = fns[fnName] ? fns[fnName].effect : deriveEffect(connectorName, fnName);
      const live = !!((ctx && ctx.live) || connector.live);
      const info = Object.assign({}, base, { effect, live, key: decl.gateway_key || null });

      if (enabled[connectorName] === false) {
        return { ok: false, refusal: refuse(makeEntry(connectorName, fnName, info), "connector_disabled", `The ${connectorName} connector is disabled.`) };
      }
      if (!connector.functions || typeof connector.functions[fnName] !== "function" || !fns[fnName]) {
        return { ok: false, refusal: refuse(makeEntry(connectorName, fnName, info), "function_not_allowed", `"${fnName}" is not an allowlisted function on the ${connectorName} connector.`) };
      }
      if (enforceRoles && !roleAllows(roles, role, connectorName, effect, decl.roles)) {
        return { ok: false, refusal: refuse(makeEntry(connectorName, fnName, info), "role_denied", `The "${role}" role may not call ${connectorName}.${fnName}.`) };
      }
      let credential = null;
      if (decl.gateway_key && live) {
        const k = resolveKey(decl.gateway_key);
        if (!k.ok) return { ok: false, refusal: refuse(makeEntry(connectorName, fnName, info), k.code, k.detail) };
        credential = k.credential;
      } else if (decl.gateway_key) {
        // A mock/asynchronous-but-offline call still carries the key NAME so the
        // log shows which credential WOULD be used — never the value.
        credential = { key: decl.gateway_key, ref: null, mock: true };
      }
      return { ok: true, connector, scope, role, effect, live, key: decl.gateway_key || null, credential };
    }

    function settle(entry, value) {
      entry.ok = true;
      entry.ms = Math.max(0, Date.now() - entry.started);
      log(entry);
      return { ok: true, result: value === undefined ? null : value };
    }

    function reject(entry, e) {
      const code = (e && e.code) || "connector_error";
      entry.ok = false;
      entry.code = code;
      entry.ms = Math.max(0, Date.now() - entry.started);
      log(entry);
      return { ok: false, code, detail: (e && e.message) || String(e) };
    }

    function call(connectorName, fnName, payload, ctx) {
      const r = resolve(connectorName, fnName, ctx);
      if (!r.ok) return r.refusal;
      const entry = makeEntry(connectorName, fnName, r);
      try {
        return settle(entry, r.connector.functions[fnName](payload || {}, { scope: r.scope, role: r.role, credential: r.credential, gateway: callLog.length }));
      } catch (e) {
        return reject(entry, e);
      }
    }

    // Async call path (roadmap task 40): distributors do network I/O, so their
    // adapters expose async functions. Same allowlist/scope/role/key validation
    // and the same call log, but the handler's promise is awaited before the
    // entry is committed as ok/failed.
    async function callAsync(connectorName, fnName, payload, ctx) {
      const r = resolve(connectorName, fnName, ctx);
      if (!r.ok) return r.refusal;
      const entry = makeEntry(connectorName, fnName, r);
      try {
        return settle(entry, await r.connector.functions[fnName](payload || {}, { scope: r.scope, role: r.role, credential: r.credential, gateway: callLog.length }));
      } catch (e) {
        return reject(entry, e);
      }
    }

    // Attach a connector after the gateway was created. The gateway looks the
    // connector up by name at call time, so late registration (e.g. app.js
    // registering the distributor adapters) works against an already-wrapped
    // gateway — the wrapper shares this same `connectors` object.
    function register(name, connector) {
      if (!name) throw new Error("A connector needs a name.");
      if (!connector || !connector.functions || typeof connector.functions !== "object") throw new Error("A connector needs a `functions` map.");
      connectors[String(name)] = connector;
      if (!(String(name) in enabled)) enabled[String(name)] = true;
      return connector;
    }

    function effectOf(name, fn) {
      const connector = connectors[name];
      if (!connector) return null;
      const fns = declaredFunctions(declared, connector, name);
      return fns[fn] ? fns[fn].effect : deriveEffect(name, fn);
    }

    function setEnabled(name, on) {
      if (!connectors[name]) return { ok: false, code: "unknown_connector", detail: `No connector named "${name}".` };
      enabled[name] = on !== false;
      log({ at: new Date().toISOString(), connector: name, fn: null, ok: true, event: "connector_enabled", enabled: enabled[name] });
      return { ok: true, name, enabled: enabled[name] };
    }

    // Prove the governance surface is coherent: every declaration names a real
    // connector/function, no gateway key is secret-shaped, roles are known.
    function verify() {
      const violations = [];
      Object.keys(declared).forEach(name => {
        const connector = connectors[name];
        if (!connector) violations.push({ code: "unknown_connector", detail: `The manifest declares "${name}", which is not registered.` });
        if (declared[name] && declared[name].gateway_key && isSecretShaped(declared[name].gateway_key)) {
          violations.push({ code: "secret_shaped_key", connector: name, detail: `The gateway key for "${name}" looks like a secret value; a key must be a name.` });
        }
        Object.keys((declared[name] && declared[name].functions) || {}).forEach(fn => {
          if (connector && typeof connector.functions[fn] !== "function") violations.push({ code: "unknown_function", connector: name, detail: `The manifest declares ${name}.${fn}, which the connector does not expose.` });
        });
      });
      Object.keys(connectors).forEach(name => {
        const d = declarationOf(declared, connectors[name], name);
        if (d.gateway_key && isSecretShaped(d.gateway_key)) violations.push({ code: "secret_shaped_key", connector: name, detail: `The gateway key for "${name}" looks like a secret value; a key must be a name.` });
      });
      Object.keys(roles).forEach(role => {
        const cfg = roles[role];
        (cfg.connectors || []).forEach(c => {
          if (c !== "*" && !connectors[c]) violations.push({ code: "role_unknown_connector", role, detail: `Role "${role}" is assigned the unknown connector "${c}".` });
        });
      });
      return { ok: violations.length === 0, violations };
    }

    return {
      connectors,
      call,
      callAsync,
      register,
      has: name => !!connectors[name],
      list: () => Object.keys(connectors),
      allowedFunctions: name => Object.keys(declaredFunctions(declared, connectors[name], name)),
      effectOf,
      manifest: () => manifestOf(connectors, declared, enabled),
      isEnabled: name => enabled[name] !== false,
      setEnabled,
      enable: name => setEnabled(name, true),
      disable: name => setEnabled(name, false),
      roles: () => JSON.parse(JSON.stringify(roles)),
      assignRole: (role, cfg) => { roles = normalizeRoles(Object.assign({}, roles, { [role]: cfg })); return JSON.parse(JSON.stringify(roles)); },
      defaultRole: () => defaultRole,
      setKeystore: k => { keystore = k; return keystore; },
      keyName: name => (declarationOf(declared, connectors[name], name).gateway_key || null),
      setLogSink: fn => { logSink = typeof fn === "function" ? fn : null; },
      verify,
      callLog: () => callLog.slice(),
      clearLog: () => { callLog.length = 0; }
    };
  }

  function createDefault(opts) {
    opts = opts || {};
    const psa = opts.psa || createMockPsa(opts.psaSeed);
    const mail = opts.mail || createMockMail(opts.mailSeed, opts.mailOpts);
    const accounting = opts.accounting || createMockAccounting(opts.accountingSeed);
    const bus = opts.bus || createMockBus(opts.busSeed);
    return createGateway({
      connectors: { psa, mail, accounting, bus },
      manifest: opts.manifest,
      roles: opts.roles,
      keystore: opts.keystore,
      defaultRole: opts.defaultRole,
      enabled: opts.enabled
    });
  }

  return {
    createGateway,
    createMockPsa,
    createMockMail,
    createMockAccounting,
    createMockBus,
    createDefault,
    mailtoUrl,
    normalizeScope,
    scopeAllows,
    filterByScope,
    DEFAULT_PSA_SEED,
    DEFAULT_MAIL_SEED,
    DEFAULT_ACCOUNTING_SEED,
    DEFAULT_ROLES,
    normalizeRoles,
    roleAllows,
    deriveEffect,
    declaredFunctions,
    manifestOf,
    isSecretShaped
  };
})();
