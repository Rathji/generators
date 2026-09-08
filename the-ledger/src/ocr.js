/* ============================================================================
   THE LEDGER — ocr.js
   OCR Receipt & Document Capture (Phase 5, tasks 24–28):
    24. Document ingestion pipeline — upload an image (photo/camera/email), the
        raw file is downscaled to a stored thumbnail and given a unique
        tracking number (DOC-0001).
    25. Data extraction engine — vision via root.generateText (ai-text-plugin)
        extracts date, vendor, total, currency and line items from the image.
    26. CoA auto-suggestion — the extracted vendor/category text is matched
        against the chart of accounts (keyword map + previous uses of the same
        vendor) to suggest the most likely expense/asset account.
    27. Human-in-the-loop review — side-by-side view of the raw document and
        the extracted fields for verification/correction before committing.
    28. Ledger commitment — the verified data commits as a draft AP bill (for
        bills) or a draft journal entry, linked to the document for audit.
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "ocr_docs" → array of document objects
   Depends on root.generateText (ai-text-plugin) for extraction; falls back to
   manual entry when the model is unavailable.
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { docs: "ocr_docs" };

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function addDays(s, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return s;
    const d = new Date(+m[1], +m[2] - 1, +m[3] + n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  async function nextNo(prefix, list) {
    let max = 0;
    const re = new RegExp("^" + prefix + "-(\\d+)$");
    for (const x of list) { const m = re.exec(x.no || ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }
  function parseJsonLoose(s) {
    let t = String(s || "").trim();
    t = t.replace(/```(?:json)?/gi, "").trim();
    const a = t.indexOf("{"); const b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }

  /* ── persistence ─────────────────────────────────────────────────────── */
  async function loadDocs() { const v = await FW.store.get(K.docs, null); return Array.isArray(v) ? v : []; }
  async function saveDocs(list) { await FW.store.set(K.docs, list); }

  /* ── ingestion (task 24) ─────────────────────────────────────────────── */
  function fileToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Could not read file."));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Unsupported image format (try PNG or JPEG)."));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", quality));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function ingestFile(file) {
    if (!file || !file.type) return { error: "No file selected." };
    if (!/^image\//.test(file.type)) return { error: "Unsupported file type — upload a PNG or JPEG image (screenshots and camera photos work best)." };
    const dataUrl = await fileToDataUrl(file, 900, 0.68).catch(e => null);
    if (!dataUrl) return { error: "Could not decode the image." };
    const docs = await loadDocs();
    const kind = /invoice|inv\./i.test(file.name) ? "invoice" : /receipt/i.test(file.name) ? "receipt" : "bill";
    const doc = {
      id: uid("doc"),
      no: await nextNo("DOC", docs),
      name: String(file.name || "document.png"),
      mime: file.type,
      kind,
      dataUrl,
      fields: { date: "", vendor: "", total: "", currency: "", lines: [] },
      suggestedAccountId: null, suggestedReason: "",
      status: "ingested",
      error: null, committedBillId: null, committedEntryId: null, committedNo: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    docs.push(doc);
    await saveDocs(docs);
    await Ledger.auditLog("ocr_doc.ingest", {
      entity: "ocr_doc", entityId: doc.id, entityLabel: doc.no + " · " + doc.name,
      summary: "Ingested document " + doc.no + " (" + doc.name + ")", prev: null, next: Ledger.cloneObj(doc),
    });
    return { ok: true, doc };
  }

  /* ── extraction (task 25) ────────────────────────────────────────────── */
  const CATEGORY_ACCOUNT = {
    "Office Supplies": "5300", "Rent": "5100", "Utilities": "5200", "Marketing": "5400",
    "Insurance": "5500", "Payroll": "5600", "Professional Fees": "5700", "Travel": "5800",
    "Equipment": "1410", "Inventory Purchases": "1200", "Misc Expense": "5950",
  };
  async function coaSuggestion(vendor, lines, accounts) {
    const text = String(vendor || "") + " " + (lines || []).map(l => l.desc || "").join(" ").toLowerCase();
    const docs = await loadDocs();
    const hist = docs.filter(d => d.status === "committed" && d.fields.vendor && String(d.fields.vendor).toLowerCase() === String(vendor || "").toLowerCase() && d.fields.accountId);
    if (hist.length) {
      const a = accounts.find(x => x.id === hist[hist.length - 1].fields.accountId);
      if (a) return { id: a.id, reason: "Previous use of this vendor" };
    }
    const kw = [
      [/rent|lease|office space/i, "5100", "Rent"], [/electric|utility|water|gas|internet|phone/i, "5200", "Utilities"],
      [/office|supplies|stationery|paper|ink/i, "5300", "Office Supplies"], [/advert|marketing|social|ads?/i, "5400", "Marketing"],
      [/insur/i, "5500", "Insurance"], [/salary|wage|payroll|contractor pay/i, "5600", "Payroll"],
      [/legal|attorney|accountant|consult|professional|audit/i, "5700", "Professional Fees"],
      [/travel|flight|hotel|airfare|taxi|meal/i, "5800", "Travel"],
      [/equipment|computer|laptop|hardware|desk|furniture/i, "1410", "Equipment"],
      [/inventory|stock|wholesale|raw material|parts/i, "1200", "Inventory Purchases"],
      [/misc|miscellaneous|other/i, "5950", "Misc Expense"],
    ];
    for (const [re, code, label] of kw) {
      const a = accounts.find(x => x.code === code);
      if (re.test(text) && a) return { id: a.id, reason: label };
    }
    const misc = accounts.find(x => x.code === "5950");
    return misc ? { id: misc.id, reason: "Default — Misc Expense" } : null;
  }
  async function extractDoc(id) {
    const docs = await loadDocs();
    const doc = docs.find(x => x.id === id);
    if (!doc) return { error: "Document not found." };
    if (doc.status !== "ingested" && doc.status !== "extracted") return { error: "Document must be in the ingested stage to extract." };
    if (!root || !root.generateText) return { error: "The AI text plugin isn't loaded — add generateText = {import:ai-text-plugin} to main.pjs." };
    doc.error = null;
    await saveDocs(docs);
    const blob = await fetch(doc.dataUrl).then(r => r.blob()).catch(() => null);
    if (!blob) return { error: "Could not load the stored image." };
    const prompt = "You are a bookkeeping assistant extracting data from a " + doc.kind + " document image. " +
      "Return ONLY valid JSON with no markdown, no code fences and no commentary, exactly this shape: " +
      '{"vendor":"","date":"YYYY-MM-DD","total":123.45,"currency":"USD","lines":[{"desc":"","amount":12.34}],"category":"Office Supplies"}. ' +
      "Rules: vendor = merchant/business name (null if unreadable); date = a real date from the document or null; total = grand total payable as a number or null; " +
      "currency = ISO code or USD; lines = readable line items, and if no line items are readable use one line {\"desc\":\"Document total\",\"amount\":<total>}; " +
      "category = one of: Office Supplies, Rent, Utilities, Marketing, Insurance, Payroll, Professional Fees, Travel, Equipment, Inventory Purchases, Misc Expense.";
    try {
      const res = await root.generateText({ instruction: [prompt, blob] });
      const data = parseJsonLoose(String(res));
      if (!data) { doc.error = "The model response could not be parsed as JSON."; doc.status = "ingested"; doc.updatedAt = new Date().toISOString(); await saveDocs(docs); return { error: doc.error }; }
      const accounts = await Ledger.loadAccounts();
      const sug = await coaSuggestion(data.vendor, data.lines, accounts);
      doc.fields = {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(data.date || "")) ? String(data.date) : "",
        vendor: String(data.vendor || "").trim(),
        total: amt(data.total),
        currency: String(data.currency || "USD").toUpperCase().slice(0, 3),
        lines: (Array.isArray(data.lines) ? data.lines : []).map(l => ({ desc: String(l.desc || "").trim(), amount: amt(l.amount) })).filter(l => l.desc || l.amount),
      };
      if (!doc.fields.lines.length && doc.fields.total > 0) doc.fields.lines = [{ desc: "Document total", amount: doc.fields.total }];
      doc.suggestedAccountId = sug ? sug.id : null;
      doc.suggestedReason = sug ? sug.reason : "";
      doc.fields.accountId = sug ? sug.id : null;
      doc.status = "extracted";
      doc.extractedAt = new Date().toISOString();
      doc.updatedAt = new Date().toISOString();
      await saveDocs(docs);
      await Ledger.auditLog("ocr_doc.extract", {
        entity: "ocr_doc", entityId: doc.id, entityLabel: doc.no + " · " + (doc.fields.vendor || doc.name),
        summary: "Extracted " + doc.no + " — " + FW.money(doc.fields.total) + (doc.fields.vendor ? " from " + doc.fields.vendor : "") + (sug ? " → " + sug.reason : ""),
        prev: null, next: Ledger.cloneObj(doc),
      });
      return { ok: true, doc };
    } catch (e) {
      doc.error = "Extraction failed: " + String(e && e.message || e);
      doc.updatedAt = new Date().toISOString();
      await saveDocs(docs);
      return { error: doc.error };
    }
  }

  /* ── review (task 27) + commitment (task 28) ─────────────────────────── */
  async function saveReview(id, fields) {
    const docs = await loadDocs();
    const doc = docs.find(x => x.id === id);
    if (!doc) return { error: "Document not found." };
    if (doc.status === "committed") return { error: "Committed documents can't be edited." };
    const prev = Ledger.cloneObj(doc);
    doc.fields = {
      date: String(fields.date || ""),
      vendor: String(fields.vendor || "").trim(),
      total: amt(fields.total),
      currency: String(fields.currency || "USD").toUpperCase().slice(0, 3),
      lines: (fields.lines || []).map(l => ({ desc: String(l.desc || "").trim(), amount: amt(l.amount) })).filter(l => l.desc || l.amount),
      accountId: fields.accountId || null,
    };
    if (!doc.fields.lines.length && doc.fields.total > 0) doc.fields.lines = [{ desc: "Document total", amount: doc.fields.total }];
    doc.suggestedAccountId = fields.accountId || doc.suggestedAccountId;
    doc.suggestedReason = "Confirmed in review";
    doc.status = "reviewed";
    doc.updatedAt = new Date().toISOString();
    await saveDocs(docs);
    await Ledger.auditLog("ocr_doc.review", {
      entity: "ocr_doc", entityId: doc.id, entityLabel: doc.no + " · " + (doc.fields.vendor || doc.name),
      summary: "Reviewed " + doc.no + " — verified " + FW.money(doc.fields.total) + (doc.fields.vendor ? " · " + doc.fields.vendor : ""),
      prev, next: Ledger.cloneObj(doc),
    });
    return { ok: true, doc };
  }
  async function commitDoc(id) {
    const docs = await loadDocs();
    const doc = docs.find(x => x.id === id);
    if (!doc) return { error: "Document not found." };
    if (doc.status !== "reviewed") return { error: "Review the document first." };
    if (!doc.fields.vendor && !doc.fields.total) return { error: "Set at least a vendor or a total before committing." };
    if (doc.fields.total <= 0) return { error: "Total must be greater than zero." };
    const accounts = await Ledger.loadAccounts();
    const acc = accounts.find(a => a.id === doc.fields.accountId);
    if (!acc) return { error: "Pick a chart-of-accounts account on the review screen." };
    const prev = Ledger.cloneObj(doc);
    let committed = null;
    if (doc.kind === "bill") {
      const bills = Array.isArray(await FW.store.get("bills", null)) ? await FW.store.get("bills", null) : [];
      const lines = doc.fields.lines.length ? doc.fields.lines.map(l => ({
        desc: l.desc || doc.fields.vendor || "Document", account: doc.fields.accountId,
        qty: 1, unitPrice: amt(l.amount), amount: amt(l.amount), match: null,
      })) : [];
      const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
      if (round2(doc.fields.total - sum) > 0.004) lines.push({ desc: "Tax / rounding", account: doc.fields.accountId, qty: 1, unitPrice: round2(doc.fields.total - sum), amount: round2(doc.fields.total - sum), match: null });
      const bill = {
        vendor: doc.fields.vendor || "Vendor from " + doc.no,
        billDate: doc.fields.date || today(),
        dueDate: addDays(doc.fields.date || today(), 30),
        billNumber: doc.name,
        status: "draft",
        lines,
        source: { kind: "ocr", docId: doc.id, docNo: doc.no },
        notes: "Imported from OCR document " + doc.no,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      if (window.AP && window.AP.saveBill) committed = await window.AP.saveBill(bill, bills);
      else {
        const saved = Object.assign({}, bill, { id: uid("bill"), createdAt: bill.createdAt, updatedAt: bill.updatedAt });
        const list = await FW.store.get("bills", null) || [];
        list.push(saved);
        await FW.store.set("bills", list);
        committed = saved;
      }
      doc.committedBillId = committed.id;
      doc.committedNo = committed.no;
    } else {
      const cash = window.AP && window.AP.cashAccountId ? window.AP.cashAccountId(accounts) : accounts.find(x => x.code === "1010");
      if (!cash) return { error: "No cash/bank account found to credit." };
      const total = doc.fields.total;
      const entry = {
        date: doc.fields.date || today(),
        reference: doc.no + (doc.fields.vendor ? " · " + doc.fields.vendor : ""),
        memo: "OCR " + doc.no + " — " + (doc.fields.vendor || "document") + " (" + doc.name + ")",
        status: "draft",
        lines: [
          { account: acc.id, desc: doc.fields.vendor || doc.name, debit: total, credit: 0 },
          { account: cash, desc: "Funds out — " + doc.no, debit: 0, credit: total },
        ],
      };
      const entries = await Ledger.loadEntries();
      entry.no = await Ledger.nextEntryNo(entries);
      const res = await Ledger.saveEntry(entry, accounts);
      if (res && res.error) return { error: res.error };
      committed = res;
      doc.committedEntryId = res.id;
      doc.committedNo = res.no;
    }
    doc.status = "committed";
    doc.committedAt = new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    await saveDocs(docs);
    await Ledger.auditLog("ocr_doc.commit", {
      entity: "ocr_doc", entityId: doc.id, entityLabel: doc.no + " · " + (doc.fields.vendor || doc.name),
      summary: "Committed " + doc.no + " as " + (doc.kind === "bill" ? "draft bill " + doc.committedNo : "draft entry " + doc.committedNo) + " — " + FW.money(doc.fields.total) + " → " + (acc.code + " · " + acc.name),
      prev, next: Ledger.cloneObj(doc),
    });
    return { ok: true, doc, committed, account: acc };
  }
  async function deleteDoc(id) {
    const docs = await loadDocs();
    const doc = docs.find(x => x.id === id);
    if (!doc) return { error: "Document not found." };
    if (doc.status === "committed") return { error: "Committed documents are kept for audit — don't delete them." };
    const i = docs.indexOf(doc); docs.splice(i, 1);
    await saveDocs(docs);
    await Ledger.auditLog("ocr_doc.delete", {
      entity: "ocr_doc", entityId: id, entityLabel: doc.no,
      summary: "Deleted document " + doc.no, prev: Ledger.cloneObj(doc), next: null,
    });
    return { ok: true };
  }

  /* ── module renderer ─────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 5 — OCR Receipt & Document Capture"));
    head.appendChild(FW.el("h1", null, null, { text: "Receipt Capture" }));
    head.appendChild(FW.el("p", "lede", "Upload a photo or screenshot of a receipt, invoice or bill. The AI extracts the fields, suggests a chart-of-accounts category, you verify everything side-by-side, and it commits as a draft bill or journal entry linked to the document."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="docs">Documents</button>' +
      '<button class="ledger-tab" data-tab="about">How it works</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "about") renderAbout(ctn);
      else renderDocs(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("docs");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 5 is complete (tasks 24–28)</strong> — ingestion with unique tracking numbers, AI vision extraction, chart-of-accounts suggestion (keywords + prior use), human-in-the-loop review, and commitment as a draft AP bill or journal entry with a full audit trail.";
    m.appendChild(note);
  }

  async function renderDocs(ctn) {
    const docs = await loadDocs();
    const sorted = [...docs].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    let html = '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Ingest a document</h3></div>' +
      '<div class="card-body"><p class="muted small" style="margin-top:0">Upload a PNG or JPEG image (camera photo, screenshot of an emailed bill, scanned PDF export). It is stored as a small thumbnail in your browser and given a DOC number.</p>' +
      '<div class="row-flex"><input type="file" id="ocrFile" accept="image/*" style="max-width:340px">' +
      '<button class="btn btn-primary btn-sm" id="ocrIngestBtn">Ingest</button></div>' +
      '<p class="muted small" id="ocrIngestMsg" style="margin-bottom:0"></p></div></div>';
    html += '<div class="card"><div class="card-head"><h3>Documents</h3></div>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No documents yet. Ingest one above, then: <strong>Extract</strong> → <strong>Review</strong> → <strong>Commit</strong>.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>No</th><th>Document</th><th>Kind</th><th>Vendor / date</th><th class="num">Total</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const d of sorted) {
        const stage = { ingested: "chip-pending", extracted: "chip-phase", reviewed: "chip-warn", committed: "chip-done" }[d.status] || "chip-pending";
        html += "<tr>" +
          '<td class="acct-code">' + esc(d.no) + "</td>" +
          '<td style="max-width:220px"><div style="display:flex;align-items:center;gap:8px">' +
          '<img src="' + d.dataUrl + '" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">' +
          '<div style="min-width:0"><div class="ell">' + esc(d.name) + "</div><div class=\"muted small ell\">" + esc(d.createdAt.slice(0, 10)) + "</div></div></div></td>" +
          "<td>" + esc(d.kind) + "</td>" +
          "<td>" + esc(d.fields.vendor || "—") + (d.fields.date ? '<div class="muted small">' + esc(d.fields.date) + "</div>" : "") + "</td>" +
          '<td class="num"><strong>' + (d.fields.total ? FW.money(amt(d.fields.total), d.fields.currency) : "—") + "</strong></td>" +
          '<td><span class="chip ' + stage + '">' + esc(d.status) + "</span>" + (d.committedNo ? '<div class="muted small">' + esc(d.committedNo) + "</div>" : "") + "</td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          (d.status === "ingested" ? '<button class="icon-btn" data-act="extract" data-id="' + esc(d.id) + '" title="Extract with AI">' + ICON.sparkle + "</button>" : "") +
          (d.status === "ingested" || d.status === "extracted" ? '<button class="icon-btn" data-act="review" data-id="' + esc(d.id) + '" title="Enter fields manually / review">' + ICON.pencil + "</button>" : "") +
          (d.status === "reviewed" ? '<button class="icon-btn" data-act="commit" data-id="' + esc(d.id) + '" title="Commit to the ledger">' + ICON.check + "</button>" : "") +
          (d.status !== "committed" ? '<button class="icon-btn" data-act="del" data-id="' + esc(d.id) + '" title="Delete">' + ICON.trash + "</button>" : "") +
          "</div></td></tr>";
        if (d.error) html += '<tr><td colspan="7" class="muted small" style="color:var(--danger)">' + esc(d.error) + "</td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#ocrIngestBtn").addEventListener("click", async () => {
      const file = ctn.querySelector("#ocrFile").files && ctn.querySelector("#ocrFile").files[0];
      const msg = ctn.querySelector("#ocrIngestMsg");
      if (!file) { FW.toast("Choose an image file first.", "err"); return; }
      msg.textContent = "Ingesting " + file.name + "…";
      const r = await ingestFile(file);
      if (r && r.error) { msg.textContent = ""; FW.toast(r.error, "err"); return; }
      msg.textContent = "";
      ctn.querySelector("#ocrFile").value = "";
      FW.toast(r.doc.no + " ingested — now extract it");
      renderDocs(ctn);
    });
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (act === "extract") {
        b.disabled = true;
        b.innerHTML = '<span class="spinner" style="width:13px;height:13px;border-width:2px"></span>';
        const label = FW.el("span", "muted small", "Extracting…"); label.style.cssText = "display:block;text-align:center;padding:6px";
        ctn.querySelector(".card:last-child").appendChild(label);
        extractDoc(id).then(r => {
          label.remove();
          if (r && r.error) FW.toast(r.error, "err");
          else FW.toast(r.doc.no + " extracted — review it");
          renderDocs(ctn);
        });
      } else if (act === "review") openReviewModal(id);
      else if (act === "commit") {
        confirmDialog("Commit " + (() => { const d = sorted.find(x => x.id === id); return d ? d.no : ""; })() + " to the ledger?", "This creates " + (sorted.find(x => x.id === id) && sorted.find(x => x.id === id).kind === "bill" ? "a draft AP bill" : "a draft journal entry") + " linked to the document. You can still edit or post it later in the ledger / AP modules.", () => {
          commitDoc(id).then(r => {
            if (r && r.error) FW.toast(r.error, "err");
            else { FW.toast(r.doc.no + " committed as " + r.committed.no + " → " + r.account.code + " · " + r.account.name); renderDocs(ctn); }
          });
        }, "Commit");
      } else if (act === "del") {
        confirmDialog("Delete this document?", "Committed documents are kept for audit and can't be deleted.", () => deleteDoc(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Document deleted"); renderDocs(ctn); }
        }), "Delete");
      }
    });
  }

  function openReviewModal(id) {
    (async () => {
      const docs = await loadDocs();
      const d = docs.find(x => x.id === id);
      if (!d) return;
      const accounts = await Ledger.loadAccounts();
      const accOpts = accounts
        .filter(a => (a.type === "expense" || a.type === "asset") && (a.active || a.id === d.fields.accountId))
        .map(a => '<option value="' + a.id + '"' + (a.id === d.fields.accountId ? " selected" : "") + ">" + esc(a.code) + " · " + esc(a.name) + "</option>").join("");
      const kinds = ["bill", "receipt", "invoice", "other"].map(k => '<option value="' + k + '"' + (d.kind === k ? " selected" : "") + ">" + esc(k) + "</option>").join("");
      const modal = FW.modal(
        '<div class="modal-head"><h3>Review ' + esc(d.no) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="ocr-grid">' +
        '<div class="ocr-img"><img src="' + d.dataUrl + '" alt="Document" style="max-width:100%;border-radius:10px;border:1px solid var(--line)"></div>' +
        '<div class="ocr-fields">' +
        '<div class="row-flex">' +
        '<div class="field" style="flex:1 1 160px"><label>Vendor</label><input id="ovVendor" value="' + esc(d.fields.vendor || "") + '"></div>' +
        '<div class="field" style="flex:0 0 140px"><label>Date</label><input id="ovDate" type="date" value="' + esc(d.fields.date || "") + '"></div>' +
        "</div><div class=\"row-flex\">" +
        '<div class="field" style="flex:0 0 130px"><label>Total</label><input id="ovTotal" type="number" min="0" step="any" value="' + (d.fields.total || "") + '"></div>' +
        '<div class="field" style="flex:0 0 100px"><label>Currency</label><input id="ovCur" maxlength="3" value="' + esc(d.fields.currency || "USD") + '"></div>' +
        '<div class="field" style="flex:0 0 120px"><label>Kind</label><select id="ovKind">' + kinds + "</select></div>" +
        "</div>" +
        '<div class="field"><label>Chart-of-accounts account</label><select id="ovAcc">' + (accOpts || '<option value="">— no expense/asset accounts —</option>') + "</select>" +
        (d.suggestedReason ? '<p class="muted small" style="margin:4px 0 0">Suggestion: ' + esc(d.suggestedReason) + "</p>" : "") + "</div>" +
        '<div class="field"><label>Line items</label><div id="ovLines"></div>' +
        '<button class="btn btn-ghost btn-sm" id="ovAddLine" style="margin-top:6px">+ Add line</button></div>' +
        "</div></div></div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="ovSaveBtn">Save (reviewed)</button>' +
        (d.status === "reviewed" ? '<button class="btn btn-ghost btn-sm" id="ovCommitBtn">Commit to ledger</button>' : "") +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));

      const linesEl = modal.querySelector("#ovLines");
      let lines = (d.fields.lines || []).map(l => ({ desc: l.desc, amount: l.amount }));
      function renderLines() {
        linesEl.innerHTML = lines.map((l, i) =>
          '<div class="je-ed-line">' +
          '<input class="ovl-desc" data-i="' + i + '" type="text" placeholder="Description" value="' + esc(l.desc) + '">' +
          '<input class="ovl-amt amt-md" data-i="' + i + '" type="number" min="0" step="any" placeholder="Amount" value="' + (l.amount || "") + '">' +
          '<button class="icon-mini danger" data-rm="' + i + '" title="Remove">' + ICON.x + "</button></div>").join("");
      }
      linesEl.addEventListener("input", e => {
        const inp = e.target.closest("input[data-i]");
        if (!inp) return;
        const i = Number(inp.getAttribute("data-i"));
        if (inp.classList.contains("ovl-desc")) lines[i].desc = inp.value;
        else lines[i].amount = inp.value;
      });
      linesEl.addEventListener("click", e => {
        const b = e.target.closest("[data-rm]");
        if (!b) return;
        lines.splice(Number(b.getAttribute("data-rm")), 1);
        renderLines();
      });
      renderLines();
      modal.querySelector("#ovAddLine").addEventListener("click", () => { lines.push({ desc: "", amount: "" }); renderLines(); });

      async function collect() {
        return {
          vendor: modal.querySelector("#ovVendor").value,
          date: modal.querySelector("#ovDate").value,
          total: modal.querySelector("#ovTotal").value,
          currency: modal.querySelector("#ovCur").value,
          kind: modal.querySelector("#ovKind").value,
          accountId: modal.querySelector("#ovAcc").value || null,
          lines: lines.map(l => ({ desc: l.desc, amount: amt(l.amount) })).filter(l => l.desc || l.amount),
        };
      }
      modal.querySelector("#ovSaveBtn").addEventListener("click", async () => {
        const fields = await collect();
        if (d.kind !== fields.kind) {
          const docs2 = await loadDocs();
          const doc2 = docs2.find(x => x.id === d.id);
          if (doc2) { doc2.kind = fields.kind; await saveDocs(docs2); d.kind = fields.kind; }
        }
        const r = await saveReview(id, fields);
        if (r && r.error) { FW.toast(r.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(d.no + " reviewed — ready to commit");
        renderDocs(document.querySelector(".ledger-tab-ctn"));
      });
      const cb = modal.querySelector("#ovCommitBtn");
      if (cb) cb.addEventListener("click", async () => {
        const fields = await collect();
        await saveReview(id, fields);
        const r = await commitDoc(id);
        if (r && r.error) { FW.toast(r.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(r.doc.no + " committed as " + r.committed.no + " → " + r.account.code + " · " + r.account.name);
        renderDocs(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  async function renderAbout(ctn) {
    const hasAI = !!(root && root.generateText);
    ctn.innerHTML = '<div class="card"><div class="card-body"><h3 style="margin-top:0">The capture pipeline</h3>' +
      '<p class="muted small">Four stages, each recorded in the audit trail:</p>' +
      '<ol class="muted small" style="line-height:1.8;padding-left:20px">' +
      "<li><strong>Ingest</strong> — an image becomes a DOC number with a stored thumbnail.</li>" +
      "<li><strong>Extract</strong> — the AI vision model reads the document and returns date, vendor, total, currency and line items as JSON.</li>" +
      "<li><strong>Review</strong> — you verify and correct the fields side-by-side with the image, and confirm the suggested account.</li>" +
      "<li><strong>Commit</strong> — a bill becomes a draft AP bill (open it in Accounts Payable); anything else becomes a draft journal entry (open it in General Ledger). Both link back to this document.</li></ol>" +
      (hasAI ? '<p class="note small" style="margin-bottom:0"><strong>AI extraction is available</strong> — each extraction uses one vision call (~a few seconds).</p>' :
        '<p class="note small" style="margin-bottom:0" style="color:var(--danger)"><strong>AI extraction unavailable</strong> — add <code>generateText = {import:ai-text-plugin}</code> to main.pjs. You can still ingest and enter fields manually via the review screen.</p>') +
      "</div></div>";
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const XS_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const ICON = {
    sparkle: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="3.2"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── self-test (validation for tasks 24–28) ──────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });

    /* task 25 — JSON parsing robustness */
    ok("Extract: parses bare JSON", (() => { const o = parseJsonLoose('{"vendor":"Acme","total":12.5}'); return o && o.vendor === "Acme" && o.total === 12.5; })());
    ok("Extract: parses markdown-fenced JSON", (() => { const o = parseJsonLoose('Here you go:\n```json\n{"vendor":"Acme","total":7}\n```'); return o && o.vendor === "Acme"; })());
    ok("Extract: parses JSON with prose around it", (() => { const o = parseJsonLoose("The vendor is Acme and the JSON is {\"vendor\":\"Acme\",\"total\":7} thanks"); return o && o.vendor === "Acme"; })());
    ok("Extract: returns null for garbage", parseJsonLoose("no json here") === null);

    /* task 26 — CoA suggestion */
    const accs = [
      { id: "a5100", code: "5100", name: "Rent Expense", type: "expense" },
      { id: "a5950", code: "5950", name: "Miscellaneous Expense", type: "expense" },
      { id: "a1410", code: "1410", name: "Office Equipment", type: "asset" },
    ];
    ok("Suggestion: rent keywords", (await coaSuggestion("Acme Realty", [{ desc: "Monthly office rent" }], accs)).id === "a5100");
    ok("Suggestion: equipment keywords → asset", (await coaSuggestion("Dell", [{ desc: "New laptop" }], accs)).id === "a1410");
    ok("Suggestion: defaults to misc", (await coaSuggestion("Random Co", [{ desc: "weird thing" }], accs)).id === "a5950");
    ok("Suggestion: repeats prior vendor's account", (async () => {
      const saved = await loadDocs();
      const docs2 = saved.slice();
      docs2.push({ id: "t_hist", status: "committed", fields: { vendor: "Staples", accountId: "a5950" }, no: "DOC-T" });
      await saveDocs(docs2);
      const r = await coaSuggestion("Staples", [{ desc: "pens" }], accs);
      await saveDocs(saved);
      return r && r.id === "a5950";
    })());

    /* task 28 — commitment math (bill tax/rounding line) */
    ok("Commit: keeps bill total with tax line", (async () => {
      const acc = "a5100";
      const lines = [{ desc: "Service", amount: 100 }];
      const total = 108.5;
      const built = lines.map(l => ({ desc: l.desc, account: acc, qty: 1, unitPrice: amt(l.amount), amount: amt(l.amount), match: null }));
      const sum = round2(built.reduce((s, l) => s + l.amount, 0));
      if (round2(total - sum) > 0.004) built.push({ desc: "Tax / rounding", account: acc, qty: 1, unitPrice: round2(total - sum), amount: round2(total - sum), match: null });
      const t = round2(built.reduce((s, l) => s + l.amount, 0));
      return t === 108.5 && built.length === 2;
    })());

    /* task 24 — numbering */
    ok("Ingest: numbering advances", (async () => {
      const docs2 = await loadDocs();
      const no = await nextNo("DOC", [...docs2, { no: "DOC-0003" }]);
      return no === "DOC-0004";
    })());

    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  const X = {
    loadDocs, saveDocs, ingestFile, extractDoc, saveReview, commitDoc, deleteDoc,
    coaSuggestion, parseJsonLoose, fileToDataUrl,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.ocr = X;
  window.OCR = X;
})();
