// src/modules/tracker-view.js — the Domain and SSL certificate editors
// (roadmap tasks 24–25).
//
// The Trackers station lists a client's domains and certificates; the "Open"
// action on each row reaches this module. Two editors share it:
//
//   • openDomainEditor      — a domain's registration facts, its name servers and
//                             its live DNS records, plus a best-effort lookup that
//                             fills them from DNS-over-HTTPS and RDAP.
//   • openCertificateEditor — a certificate's public details, its subject
//                             alternative names and validity window, plus a
//                             best-effort lookup from the Certificate
//                             Transparency logs (crt.sh).
//
// Both lookups are shown for CONFIRMATION before anything is written, so a live
// lookup can never silently overwrite facts a technician recorded by hand.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, fmtDate } from "./shared.js";
import { buildStandardizedFields } from "./std-fields.js";
import { linksSection } from "./record-links.js";
import {
  DNS_RECORD_TYPES,
  dnsRecordType,
  dnsRecords,
  makeDnsRecord,
  domainExpiryStatus,
  domainStatus,
  lookupDomain,
} from "../framework/domain.js";
import {
  certificateExpiryStatus,
  subjectAltNames,
  normalizeHostname,
  lookupCertificate,
} from "../framework/certificate.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

const DOMAIN_LINKS = [
  { kind: "domain-credential", label: "Managing credential", types: ["passwords"] },
  { kind: "domain-asset", label: "Dependent asset", types: ["flexibleAssets", "configurations"] },
  { kind: "contact-owner", label: "Responsible contact", types: ["contacts"], side: "to" },
];
const CERT_LINKS = [
  { kind: "certificate-credential", label: "Private-key credential", types: ["passwords"] },
  { kind: "certificate-service", label: "Protected service", types: ["configurations", "flexibleAssets", "domains"] },
  { kind: "contact-owner", label: "Responsible contact", types: ["contacts"], side: "to" },
];

// ---------------------------------------------------------------------------
// shared: the lookup confirmation modal
// ---------------------------------------------------------------------------
function showLookupResult(ctx, { title, result, changes, apply }) {
  const rows = (changes || []).map((c) => h("li", { class: "kb-rel-item" }, h("span", { class: "kb-rel-item-name" }, c)));
  const errs = (result && result.errors) || [];
  const m = openModal({
    title,
    description: rows.length
      ? "IT-U found the following. Nothing is written until you apply it."
      : "The lookup returned nothing to apply.",
    children: [
      rows.length ? h("ul", { class: "kb-rel-list" }, rows) : null,
      errs.length
        ? h(
            "ul",
            { class: "kb-rel-list kb-rel-list--errors" },
            errs.map((e) => h("li", { class: "kb-rel-item" }, h("span", { class: "kb-rel-item-name kb-error-text" }, e))),
          )
        : null,
    ].filter(Boolean),
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Close"),
    rows.length
      ? h(
          "button",
          {
            class: "kb-btn kb-btn-primary",
            type: "button",
            onClick: async () => {
              try {
                await apply();
                m.close();
              } catch (e) {
                m.showError(String((e && e.message) || e));
              }
            },
          },
          "Apply",
        )
      : null,
  );
}

// ---------------------------------------------------------------------------
// domain editor
// ---------------------------------------------------------------------------
export async function openDomainEditor(ctx, { setId, record, reload } = {}) {
  if (!setId || !record) return;
  let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  const readonly = !!(set && set.archived);
  const body = h("div", { class: "kb-doc-editor" });
  const m = openModal({
    title: "Domain — " + (record.name || "Untitled"),
    description:
      "The registration facts (registrar, status, expiry) and the domain's live DNS records. The lookup fills them from public DNS-over-HTTPS and RDAP.",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-editor");

  let current = record;
  let draftDns = dnsRecords(record);
  let form = null;
  const liveRecord = () => ((set && set.records.domains) || []).find((r) => r.id === record.id) || current;

  async function rerender() {
    set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    current = ((set && set.records.domains) || []).find((r) => r.id === record.id) || current;
    draftDns = dnsRecords(current);
    clear(body);
    body.append(...editorBlocks());
  }

  function headerBlock() {
    const rec = liveRecord();
    const st = domainExpiryStatus(rec);
    const status = domainStatus(rec.registrationStatus);
    return h(
      "div",
      { class: "kb-doc-editor-head" },
      h("span", { class: "kb-doc-editor-icon", html: icons.globe }),
      h(
        "div",
        { class: "kb-doc-editor-head-text" },
        h("div", { class: "kb-doc-editor-title" }, rec.name),
        h(
          "div",
          { class: "kb-doc-editor-badges" },
          status ? h("span", { class: "kb-badge kb-badge-custom" }, status.label) : null,
          expiryBadge(st),
          rec.autoRenew ? h("span", { class: "kb-badge kb-badge-required" }, "Auto-renew") : h("span", { class: "kb-badge kb-badge-incomplete" }, "Manual renew"),
        ),
      ),
    );
  }

  function fieldsBlock() {
    const rec = liveRecord();
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. example.com" });
    nameInput.value = rec.name || "";
    nameInput.disabled = readonly;
    const std = buildStandardizedFields(set, "domains", rec);
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Domain name"), nameInput),
        readonly
          ? null
          : h(
              "div",
              { class: "kb-field kb-field-nowrap" },
              h("span", { class: "kb-field-label" }, " "),
              h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbDomainLookupBtn", onClick: () => runDomainLookup(rec) }, h("span", { class: "kb-icon", html: icons.search }), "Look up DNS & registration"),
            ),
      ),
      std.node,
    );
    section.inputs = { nameInput };
    section.std = std;
    return section;
  }

  function dnsBlock() {
    const section = h(
      "section",
      { class: "kb-card kb-profile-section kb-dns-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.hash }),
        h("h2", { class: "kb-section-name" }, "DNS records"),
        h("span", { class: "kb-count-pill" }, String(draftDns.length)),
      ),
    );
    const listEl = h("div", { class: "kb-dns-list" });
    const renderList = () => {
      clear(listEl);
      if (!draftDns.length) {
        listEl.append(h("p", { class: "kb-muted" }, "No DNS records recorded. Use the lookup, or add them by hand."));
        return;
      }
      for (const r of draftDns) {
        const def = dnsRecordType(r.type);
        listEl.append(
          h(
            "div",
            { class: "kb-dns-row", dataset: { id: r.id } },
            h("span", { class: "kb-dns-type", title: def ? def.description : "" }, r.type),
            h("span", { class: "kb-dns-name" }, r.name || "@"),
            h("span", { class: "kb-dns-value" }, (r.priority != null ? r.priority + " " : "") + (r.value || "—")),
            h("span", { class: "kb-dns-ttl kb-muted" }, r.ttl ? "TTL " + r.ttl : ""),
            readonly
              ? null
              : h(
                  "button",
                  { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => { draftDns = draftDns.filter((x) => x.id !== r.id); renderList(); }, title: "Remove" },
                  h("span", { class: "kb-icon", html: icons.trash }),
                ),
          ),
        );
      }
    };
    renderList();
    section.append(listEl);
    if (!readonly) section.append(dnsAddRow(renderList));
    return section;
  }

  function dnsAddRow(onChange) {
    const typeSel = h("select", { class: "kb-input" });
    for (const t of DNS_RECORD_TYPES) typeSel.append(h("option", { value: t.id }, t.label + " — " + t.description));
    typeSel.value = "A";
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "name (e.g. www or @)" });
    const valueInput = h("input", { class: "kb-input", type: "text", placeholder: "value" });
    const ttlInput = h("input", { class: "kb-input", type: "number", min: "0", placeholder: "TTL" });
    const priorityInput = h("input", { class: "kb-input", type: "number", min: "0", placeholder: "priority" });
    const add = () => {
      if (!valueInput.value.trim()) return;
      const def = dnsRecordType(typeSel.value);
      draftDns = [
        ...draftDns,
        makeDnsRecord({
          type: typeSel.value,
          name: nameInput.value.trim(),
          value: valueInput.value.trim(),
          ttl: ttlInput.value === "" ? null : Number(ttlInput.value),
          priority: def && def.priority && priorityInput.value !== "" ? Number(priorityInput.value) : null,
        }),
      ];
      nameInput.value = "";
      valueInput.value = "";
      ttlInput.value = "";
      priorityInput.value = "";
      onChange();
    };
    return h(
      "div",
      { class: "kb-dns-add" },
      typeSel,
      nameInput,
      valueInput,
      ttlInput,
      priorityInput,
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: add }, "Add"),
    );
  }

  async function runDomainLookup(rec) {
    const btn = m.overlay.querySelector("#kbDomainLookupBtn");
    const prev = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Looking up…";
    }
    let result;
    try {
      result = await lookupDomain(rec.name || rec.id);
    } catch (e) {
      result = { ok: false, dns: [], registration: {}, errors: [String((e && e.message) || e)] };
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev;
      }
    }
    const reg = result.registration || {};
    const seen = new Set(draftDns.map((r) => r.type + "|" + r.name.toLowerCase() + "|" + r.value));
    const addedDns = (result.dns || []).filter((r) => !seen.has(r.type + "|" + r.name.toLowerCase() + "|" + r.value));
    const changes = [];
    if (reg.registrar) changes.push("Registrar: " + reg.registrar + (rec.registrar && rec.registrar !== reg.registrar ? " (was " + rec.registrar + ")" : ""));
    if (reg.expiresAt) changes.push("Expiry: " + reg.expiresAt + (rec.expiresAt && rec.expiresAt !== reg.expiresAt ? " (was " + rec.expiresAt + ")" : ""));
    if (reg.nameservers && reg.nameservers.length) changes.push("Name servers: " + reg.nameservers.join(", "));
    if (reg.status) changes.push("Registration status: " + reg.status);
    if (addedDns.length) changes.push(addedDns.length + " DNS record" + (addedDns.length === 1 ? "" : "s") + " found");
    showLookupResult(ctx, {
      title: "Lookup — " + (result.name || rec.name),
      result,
      changes,
      apply: async () => {
        const patch = { dnsRecords: [...draftDns, ...addedDns] };
        if (reg.registrar) patch.registrar = reg.registrar;
        if (reg.expiresAt) patch.expiresAt = reg.expiresAt;
        if (reg.nameservers && reg.nameservers.length) patch.nameservers = reg.nameservers.join("\n");
        if (reg.dnssec != null) patch.dnssec = !!reg.dnssec;
        await ctx.docs.updateRecord(setId, { type: "domains", id: rec.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
        ctx.toast("Applied lookup results", "success");
        await rerender();
        reload && reload();
      },
    });
  }

  function linksBlock() {
    return linksSection(ctx, { setId, set, record: liveRecord(), kinds: DOMAIN_LINKS, readonly, onChange: async () => { await rerender(); reload && reload(); } });
  }

  function editorBlocks() {
    const f = fieldsBlock();
    form = { nameInput: f.inputs.nameInput, std: f.std };
    return [headerBlock(), f, dnsBlock(), linksBlock()];
  }

  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
  } else {
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbDomainSaveBtn" }, "Save domain"),
    );
    m.actions.querySelector("#kbDomainSaveBtn").addEventListener("click", async () => {
      m.clearError();
      const name = form.nameInput.value.trim();
      if (!name) {
        m.showError("Give the domain a name.");
        return;
      }
      const patch = { name, ...form.std.collect(), dnsRecords: draftDns };
      try {
        await ctx.docs.updateRecord(setId, { type: "domains", id: record.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
        m.close();
        ctx.toast("Saved “" + name + "”", "success");
        reload && reload();
      } catch (e) {
        m.showError(String((e && e.message) || e));
      }
    });
  }

  await rerender();
  return m;
}

// ---------------------------------------------------------------------------
// certificate editor
// ---------------------------------------------------------------------------
export async function openCertificateEditor(ctx, { setId, record, reload } = {}) {
  if (!setId || !record) return;
  let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  const readonly = !!(set && set.archived);
  const body = h("div", { class: "kb-doc-editor" });
  const m = openModal({
    title: "Certificate — " + (record.name || "Untitled"),
    description:
      "The certificate's public details and validity window. The lookup reads them from the Certificate Transparency logs so nothing has to be retyped.",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-editor");

  let current = record;
  let form = null;
  const liveRecord = () => ((set && set.records.certificates) || []).find((r) => r.id === record.id) || current;

  async function rerender() {
    set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    current = ((set && set.records.certificates) || []).find((r) => r.id === record.id) || current;
    clear(body);
    body.append(...editorBlocks());
  }

  function headerBlock() {
    const rec = liveRecord();
    const st = certificateExpiryStatus(rec);
    const host = normalizeHostname(rec.name) + (rec.port ? ":" + rec.port : "");
    return h(
      "div",
      { class: "kb-doc-editor-head" },
      h("span", { class: "kb-doc-editor-icon", html: icons.lock }),
      h(
        "div",
        { class: "kb-doc-editor-head-text" },
        h("div", { class: "kb-doc-editor-title" }, host),
        h(
          "div",
          { class: "kb-doc-editor-badges" },
          rec.issuer ? h("span", { class: "kb-badge kb-badge-custom" }, rec.issuer) : null,
          rec.wildcard ? h("span", { class: "kb-badge kb-badge-model" }, "Wildcard") : null,
          expiryBadge(st),
        ),
      ),
    );
  }

  function fieldsBlock() {
    const rec = liveRecord();
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. www.example.com" });
    nameInput.value = rec.name || "";
    nameInput.disabled = readonly;
    const std = buildStandardizedFields(set, "certificates", rec);
    const sans = subjectAltNames(rec);
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Hostname"), nameInput),
        readonly
          ? null
          : h(
              "div",
              { class: "kb-field kb-field-nowrap" },
              h("span", { class: "kb-field-label" }, " "),
              h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbCertLookupBtn", onClick: () => runCertLookup(rec) }, h("span", { class: "kb-icon", html: icons.search }), "Look up certificate"),
            ),
      ),
      std.node,
      sans.length
        ? h(
            "div",
            { class: "kb-field" },
            h("span", { class: "kb-field-label" }, "Alternative names (" + sans.length + ")"),
            h("div", { class: "kb-chips" }, sans.map((s) => h("span", { class: "kb-chip" }, s))),
          )
        : null,
    );
    section.inputs = { nameInput };
    section.std = std;
    return section;
  }

  async function runCertLookup(rec) {
    const btn = m.overlay.querySelector("#kbCertLookupBtn");
    const prev = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Looking up…";
    }
    let result;
    try {
      result = await lookupCertificate(rec.name || rec.id);
    } catch (e) {
      result = { ok: false, certificate: {}, errors: [String((e && e.message) || e)] };
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev;
      }
    }
    const c = result.certificate || {};
    const changes = [];
    if (c.subject) changes.push("Subject: " + c.subject);
    if (c.issuer) changes.push("Issuer: " + c.issuer);
    if (c.validFrom || c.validTo) changes.push("Validity: " + (c.validFrom || "?") + " → " + (c.validTo || "?"));
    if (c.serialNumber) changes.push("Serial: " + c.serialNumber);
    if (c.subjectAltNames && c.subjectAltNames.length) changes.push(c.subjectAltNames.length + " subject alternative names");
    showLookupResult(ctx, {
      title: "Lookup — " + (result.hostname || rec.name),
      result,
      changes,
      apply: async () => {
        const patch = {};
        if (c.issuer) patch.issuer = c.issuer;
        if (c.subject) patch.subject = c.subject;
        if (c.serialNumber) patch.serialNumber = c.serialNumber;
        if (c.validFrom) patch.validFrom = c.validFrom;
        if (c.validTo) patch.validTo = c.validTo;
        if (c.subjectAltNames && c.subjectAltNames.length) patch.subjectAltNames = c.subjectAltNames.join("\n");
        await ctx.docs.updateRecord(setId, { type: "certificates", id: rec.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
        ctx.toast("Applied lookup results", "success");
        await rerender();
        reload && reload();
      },
    });
  }

  function linksBlock() {
    return linksSection(ctx, { setId, set, record: liveRecord(), kinds: CERT_LINKS, readonly, onChange: async () => { await rerender(); reload && reload(); } });
  }

  function editorBlocks() {
    const f = fieldsBlock();
    form = { nameInput: f.inputs.nameInput, std: f.std };
    return [headerBlock(), f, linksBlock()];
  }

  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
  } else {
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbCertSaveBtn" }, "Save certificate"),
    );
    m.actions.querySelector("#kbCertSaveBtn").addEventListener("click", async () => {
      m.clearError();
      const name = form.nameInput.value.trim();
      if (!name) {
        m.showError("Give the certificate a hostname.");
        return;
      }
      const patch = { name, ...form.std.collect() };
      try {
        await ctx.docs.updateRecord(setId, { type: "certificates", id: record.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
        m.close();
        ctx.toast("Saved “" + name + "”", "success");
        reload && reload();
      } catch (e) {
        m.showError(String((e && e.message) || e));
      }
    });
  }

  await rerender();
  return m;
}

// The shared expiry chip used by both editors and the Trackers station.
export function expiryBadge(st) {
  const tone = st.state === "overdue" ? "danger" : st.state === "due-soon" ? "warn" : st.state === "upcoming" ? "info" : "muted";
  const title = st.iso ? (st.state === "overdue" ? "Expired " + st.iso : "Expires " + st.iso) : "";
  return h("span", { class: "kb-expiry kb-expiry--" + tone, title }, st.label);
}
