// src/modules/exports.js — the Exports station (bundle publication to the
// shared bus & knowledge base, roadmap task 49; packets & printables, task 50).
//
// The station's first surface is PUBLICATION: take one client's documentation,
// choose whether it is a documentation bundle (the whole set) or a deployment
// bundle (the runbooks, checklists and related records for a service or site),
// choose where it goes, preview the exact envelope the pipeline will read, and
// publish it. Redaction is default-deny — credential records are withheld
// unless the operator explicitly asks for a redacted summary, and secrets /
// private keys are never published. Every publish is recorded in the export log.
//
// The packet & printable surfaces arrive in task 50.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, relTime, fmtBytes, confirmDialog, downloadText } from "./shared.js";
import {
  BUNDLE_TYPES,
  PUBLICATION_TARGETS,
  DEFAULT_REDACTION,
  bundleSummaryLine,
  withheldSummary,
  publicationFilename,
  serializePublication,
  validatePublication,
} from "../framework/publication.js";
import {
  PACKET_KINDS,
  packetSummaryLine,
  packetFilename,
  packetToMarkdown,
  packetToHtml,
  packetToStandaloneHtml,
} from "../framework/packet.js";

const DESC =
  "Publish documentation and deployment bundles for the company's AI assistants and knowledge base — in the shared envelope format, with a default-deny posture that keeps credentials and private keys out, and a log of what was published when.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

export default {
  id: "exports",
  label: "Exports",
  desc: DESC,
  icon: icons.download,
  render(ctx) {
    renderExports(ctx);
  },
};

function renderExports(ctx) {
  const state = { sets: [], clientId: "", bundleType: "documentation", target: "both", scope: "", policy: { ...DEFAULT_REDACTION }, preview: null };
  const pstate = { clientId: "", type: "documentation", scope: "", policy: { credentialSummaries: false }, packet: null };

  const body = h("div", { class: "kb-exports" });
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Exports", desc: DESC, body }));

  const clientSel = h("select", { class: "kb-input", id: "kbPubClient", "aria-label": "Client" });
  clientSel.addEventListener("change", () => {
    state.clientId = clientSel.value;
    state.preview = null;
    renderScope();
    renderPreview();
  });

  const typeSel = h("select", { class: "kb-input", id: "kbPubType", "aria-label": "Bundle type" });
  for (const bt of BUNDLE_TYPES) typeSel.append(h("option", { value: bt.id }, bt.label));
  typeSel.value = state.bundleType;
  typeSel.addEventListener("change", () => {
    state.bundleType = typeSel.value;
    state.preview = null;
    renderScope();
    renderPreview();
  });

  const targetSel = h("select", { class: "kb-input", id: "kbPubTarget", "aria-label": "Publication target" });
  for (const t of PUBLICATION_TARGETS) targetSel.append(h("option", { value: t.id }, t.label));
  targetSel.value = state.target;
  targetSel.addEventListener("change", () => {
    state.target = targetSel.value;
  });

  const scopeSel = h("select", { class: "kb-input", id: "kbPubScope", "aria-label": "Deployment scope" });
  scopeSel.addEventListener("change", () => {
    state.scope = scopeSel.value;
    state.preview = null;
    renderPreview();
  });
  const scopeField = h("label", { class: "kb-field", id: "kbPubScopeField", hidden: true }, h("span", { class: "kb-field-label" }, "Deployment scope"), scopeSel);

  const credSummaries = h("input", { class: "kb-check", type: "checkbox", id: "kbPubCredSummaries" });
  const credUsers = h("input", { class: "kb-check", type: "checkbox", id: "kbPubCredUsers" });
  const embedded = h("input", { class: "kb-check", type: "checkbox", id: "kbPubEmbedded" });
  const redactionInputs = [
    [credSummaries, "credentialSummaries"],
    [credUsers, "credentialUsernames"],
    [embedded, "embeddedCredentials"],
  ];
  for (const [input, key] of redactionInputs) {
    input.addEventListener("change", () => {
      state.policy[key] = input.checked;
      state.preview = null;
      renderPreview();
    });
  }

  const previewEl = h("div", { class: "kb-pub-preview", id: "kbPubPreview" });
  const publishBtn = h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbPubPublish", disabled: true }, "Publish bundle");
  publishBtn.addEventListener("click", () => publish());
  const downloadBtn = h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbPubDownload", disabled: true }, "Download bundle");
  downloadBtn.addEventListener("click", () => {
    if (!state.preview) return;
    downloadText(publicationFilename(state.preview), serializePublication(state.preview), "application/json;charset=utf-8");
  });
  const previewBtn = h("button", { class: "kb-btn", type: "button", id: "kbPubPreviewBtn" }, "Preview bundle");
  previewBtn.addEventListener("click", () => buildPreview());

  const publishCard = h(
    "section",
    { class: "kb-card kb-pub-card" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.upload }),
      h("h2", { class: "kb-section-name" }, "Bundle publication"),
    ),
    h("p", { class: "kb-pub-desc" }, "Build the shared-envelope bundle the company's assistants and knowledge base consume, review exactly what it contains, then publish it."),
    h(
      "div",
      { class: "kb-field-row" },
      h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Client"), clientSel),
      h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Bundle type"), typeSel),
      h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Publish to"), targetSel),
      scopeField,
    ),
    h(
      "fieldset",
      { class: "kb-pub-redaction" },
      h("legend", { class: "kb-field-label" }, "Redaction"),
      h(
        "label",
        { class: "kb-pub-toggle" },
        credSummaries,
        h("span", null, "Include a redacted credential summary"),
        h("span", { class: "kb-field-help" }, "Names, categories and scope only — secret and one-time-password values are never written."),
      ),
      h("label", { class: "kb-pub-toggle" }, credUsers, h("span", null, "Include usernames in credential summaries")),
      h("label", { class: "kb-pub-toggle" }, embedded, h("span", null, "Include embedded credentials in the summary")),
      h("p", { class: "kb-pub-note" }, h("span", { class: "kb-pub-lock", html: icons.lock }), "Secrets, one-time-password secrets and private-key material are always excluded, whatever the toggles above say."),
    ),
    h("div", { class: "kb-actions-row" }, previewBtn, downloadBtn, publishBtn),
    previewEl,
  );

  const pClientSel = h("select", { class: "kb-input", id: "kbPacketClient", "aria-label": "Packet client" });
  pClientSel.addEventListener("change", () => {
    pstate.clientId = pClientSel.value;
    pstate.packet = null;
    renderPacketScope();
    renderPacketPreview();
  });

  const pTypeSel = h("select", { class: "kb-input", id: "kbPacketType", "aria-label": "Packet type" });
  for (const k of PACKET_KINDS) pTypeSel.append(h("option", { value: k.id }, k.label));
  pTypeSel.value = pstate.type;
  pTypeSel.addEventListener("change", () => {
    pstate.type = pTypeSel.value;
    pstate.packet = null;
    renderPacketScope();
    renderPacketPreview();
  });

  const pScopeSel = h("select", { class: "kb-input", id: "kbPacketScope", "aria-label": "Deployment scope" });
  pScopeSel.addEventListener("change", () => {
    pstate.scope = pScopeSel.value;
    pstate.packet = null;
    renderPacketPreview();
  });
  const pScopeField = h("label", { class: "kb-field", id: "kbPacketScopeField", hidden: true }, h("span", { class: "kb-field-label" }, "Deployment scope"), pScopeSel);

  const pCreds = h("input", { class: "kb-check", type: "checkbox", id: "kbPacketCreds" });
  pCreds.addEventListener("change", () => {
    pstate.policy.credentialSummaries = pCreds.checked;
    pstate.packet = null;
    renderPacketPreview();
  });

  const pPreviewEl = h("div", { class: "kb-packet-preview", id: "kbPacketPreview" });
  const pOpenBtn = h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbPacketOpen", disabled: true }, "Open printable view");
  pOpenBtn.addEventListener("click", () => pstate.packet && openPrintView(pstate.packet));
  const pHtmlBtn = h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbPacketDownloadHtml", disabled: true }, "Download HTML");
  pHtmlBtn.addEventListener("click", () => pstate.packet && downloadText(packetFilename(pstate.packet, "html"), packetToStandaloneHtml(pstate.packet), "text/html;charset=utf-8"));
  const pMdBtn = h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbPacketDownloadMd", disabled: true }, "Download Markdown");
  pMdBtn.addEventListener("click", () => pstate.packet && downloadText(packetFilename(pstate.packet, "md"), packetToMarkdown(pstate.packet), "text/markdown;charset=utf-8"));
  const pHostBtn = h("button", { class: "kb-btn", type: "button", id: "kbPacketHost", disabled: true }, "Host packet");
  pHostBtn.addEventListener("click", () => hostPacket());
  const pPreviewBtn = h("button", { class: "kb-btn", type: "button", id: "kbPacketPreviewBtn" }, "Preview packet");
  pPreviewBtn.addEventListener("click", () => buildPacketPreview());

  const packetCard = h(
    "section",
    { class: "kb-card kb-pub-card" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.print }),
      h("h2", { class: "kb-section-name" }, "Packets & printables"),
    ),
    h("p", { class: "kb-pub-desc" }, "Assemble a client's documentation into one continuous, printable document — a documentation packet for the whole set, or a deployment packet for a service or site. Print it, download it, or host it as a shareable link."),
    h(
      "div",
      { class: "kb-field-row" },
      h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Client"), pClientSel),
      h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Packet type"), pTypeSel),
      pScopeField,
    ),
    h(
      "fieldset",
      { class: "kb-pub-redaction" },
      h("legend", { class: "kb-field-label" }, "Redaction"),
      h("label", { class: "kb-pub-toggle" }, pCreds, h("span", null, "Include a redacted credential summary"), h("span", { class: "kb-field-help" }, "Names and categories only — secret values are never printed.")),
      h("p", { class: "kb-pub-note" }, h("span", { class: "kb-pub-lock", html: icons.lock }), "Secrets, one-time-password secrets and private-key material are always excluded from a packet, whatever the toggle above says."),
    ),
    h("div", { class: "kb-actions-row" }, pPreviewBtn, pOpenBtn, pHtmlBtn, pMdBtn, pHostBtn),
    pPreviewEl,
  );

  const pLogEl = h("div", { class: "kb-pub-log", id: "kbPacketLog" });

  const logEl = h("div", { class: "kb-pub-log", id: "kbPubLog" });

  body.append(
    publishCard,
    packetCard,
    h("section", { class: "kb-card" }, h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.link }), h("h2", { class: "kb-section-name" }, "Hosted packets"), h("span", { class: "kb-count-pill", id: "kbPacketLogCount" }, "0")), h("p", { class: "kb-pub-desc" }, "Every packet hosted from this browser — a printable page at a shareable link."), pLogEl),
    h("section", { class: "kb-card" }, h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.clock }), h("h2", { class: "kb-section-name" }, "Export log"), h("span", { class: "kb-count-pill", id: "kbPubLogCount" }, "0")), h("p", { class: "kb-pub-desc" }, "A record of every bundle published from this browser — what, when, where and what was withheld."), logEl),
  );

  load();

  async function load() {
    clear(previewEl);
    logEl.append(loadingState({ label: "Loading…" }));
    try {
      const summaries = await ctx.docs.summaries({ includeArchived: false });
      state.sets = summaries;
      clientSel.replaceChildren(h("option", { value: "" }, summaries.length ? "Choose a client…" : "No clients yet"));
      for (const s of summaries) clientSel.append(h("option", { value: s.id }, s.name || s.id));
      if (summaries.length && !state.clientId) state.clientId = summaries[0].id;
      clientSel.value = state.clientId;

      pClientSel.replaceChildren(h("option", { value: "" }, summaries.length ? "Choose a client…" : "No clients yet"));
      for (const s of summaries) pClientSel.append(h("option", { value: s.id }, s.name || s.id));
      if (summaries.length && !pstate.clientId) pstate.clientId = summaries[0].id;
      pClientSel.value = pstate.clientId;

      renderScope();
      renderPreview();
      renderPacketScope();
      renderPacketPreview();
      await Promise.all([renderLog(), renderPacketLog()]);
    } catch (e) {
      clear(logEl);
      logEl.append(errorState({ title: "Couldn’t load exports", description: String((e && e.message) || e), onRetry: () => load() }));
    }
  }

  async function setRecords() {
    if (!state.clientId) return null;
    const set = await ctx.docs.get(state.clientId).catch(() => null);
    return set;
  }

  async function renderScope() {
    scopeField.hidden = state.bundleType !== "deployment";
    if (state.bundleType !== "deployment") return;
    const set = await setRecords();
    const prev = state.scope;
    scopeSel.replaceChildren();
    if (!set) {
      scopeSel.append(h("option", { value: "" }, "Choose a client first"));
      return;
    }
    const targets = [];
    const seen = new Set();
    for (const rb of set.records.runbooks || []) {
      for (const [ref, kind] of [[rb.service, "Service"], [rb.site, "Site"]]) {
        if (!ref || !ref.id) continue;
        const key = ref.type + "::" + ref.id;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ key, label: kind + ": " + (ref.name || ref.id) });
      }
    }
    if (!targets.length) {
      scopeSel.append(h("option", { value: "" }, "No runbooks to scope a deployment"));
      state.scope = "";
      return;
    }
    for (const t of targets) scopeSel.append(h("option", { value: t.key }, t.label));
    state.scope = prev && targets.some((t) => t.key === prev) ? prev : targets[0].key;
    scopeSel.value = state.scope;
  }

  function currentScopeRefs() {
    if (state.bundleType !== "deployment" || !state.scope) return {};
    const [type, id] = state.scope.split("::");
    const ref = { type, id };
    return type === "locations" ? { siteRef: ref } : { serviceRef: ref };
  }

  async function buildBundle() {
    if (!state.clientId) throw new Error("Choose a client first.");
    if (state.bundleType === "deployment" && !state.scope) throw new Error("Choose a deployment scope (a service or site with runbooks).");
    const common = { clientId: state.clientId, target: state.target, policy: state.policy, createdBy: whoami(ctx) };
    if (state.bundleType === "deployment") return ctx.publication.buildDeployment({ ...common, ...currentScopeRefs() });
    return ctx.publication.buildDocumentation(common);
  }

  function renderPreview() {
    clear(previewEl);
    publishBtn.disabled = true;
    downloadBtn.disabled = true;
    if (!state.preview) return;
    const env = state.preview;
    const summary = bundleSummaryLine(env);
    const report = validatePublication(env);
    const parts = [
      h("p", { class: "kb-pub-preview-summary", id: "kbPubSummary" }, summary),
      h("p", { class: "kb-pub-withheld" }, h("span", { class: "kb-pub-withheld-label" }, "Withheld: "), withheldSummary(env.redaction.withheld)),
      report.warnings.length ? h("p", { class: "kb-pub-warning" }, report.warnings.join(" ")) : null,
      h(
        "details",
        { class: "kb-pub-json" },
        h("summary", null, "Shared envelope (JSON)"),
        h("pre", { class: "kb-pub-pre" }, serializePublication(env).slice(0, 20000) + (serializePublication(env).length > 20000 ? "\n… (truncated for preview — the published file is complete)" : "")),
      ),
    ];
    previewEl.append(...parts.filter(Boolean));
    publishBtn.disabled = false;
    downloadBtn.disabled = false;
  }

  async function buildPreview() {
    clear(previewEl);
    previewEl.append(loadingState({ label: "Building the bundle…" }));
    try {
      const { envelope, omitted, warnings } = await buildBundle();
      state.preview = envelope;
      renderPreview();
      if (warnings && warnings.length) ctx.toast("Bundle built with warnings", "warning", 4200);
      else ctx.toast("Bundle ready to publish — " + omitted, "info", 5200);
    } catch (e) {
      state.preview = null;
      clear(previewEl);
      previewEl.append(errorState({ title: "Couldn’t build the bundle", description: String((e && e.message) || e) }));
    }
  }

  async function publish() {
    if (!state.preview) return;
    publishBtn.disabled = true;
    publishBtn.textContent = "Publishing…";
    try {
      const entry = await ctx.publication.publish(state.preview, { createdBy: whoami(ctx), target: state.target });
      ctx.toast("Published — " + fmtBytes(entry.bytes) + (entry.redaction.withheldTotal ? " · " + entry.redaction.withheldTotal + " withheld" : ""), "success", 5600);
      state.preview = null;
      renderPreview();
      await renderLog();
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 6000);
    } finally {
      publishBtn.disabled = !state.preview;
      publishBtn.textContent = "Publish bundle";
    }
  }

  async function renderLog() {
    clear(logEl);
    let entries = [];
    try {
      entries = await ctx.publication.listLog();
    } catch {
      entries = [];
    }
    const countEl = document.getElementById("kbPubLogCount");
    if (countEl) countEl.textContent = String(entries.length);
    if (!entries.length) {
      logEl.append(emptyState({ icon: icons.clock, title: "Nothing published yet", description: "Published bundles appear here with their target, size and redaction summary." }));
      return;
    }
    const list = h("div", { class: "kb-published-list" });
    for (const entry of entries) {
      const meta = h(
        "div",
        { class: "kb-published-main" },
        h("span", { class: "kb-published-name" }, (entry.title || "Bundle") + " · " + relTime(entry.at) + " · " + fmtBytes(entry.bytes)),
        h("a", { class: "kb-published-url", href: entry.url, target: "_blank", rel: "noopener" }, entry.url),
        h("span", { class: "kb-pub-log-meta" }, "→ " + entry.target + " · " + (entry.clientName || entry.clientId || "—") + " · " + (entry.counts ? entry.counts.records + " records" : "") + " · " + entry.redaction.withheldTotal + " withheld · by " + (entry.createdBy || "—")),
      );
      const remove = h("button", { class: "kb-icon-btn kb-pub-log-remove", type: "button", title: "Remove from log" }, "✕");
      remove.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "Remove log entry?", message: "This only clears the local log record; the published file stays where it is.", confirmLabel: "Remove", danger: true });
        if (!ok) return;
        await ctx.publication.removeLogEntry(entry.id);
        await renderLog();
      });
      list.append(h("div", { class: "kb-published-item kb-pub-log-item" }, meta, remove));
    }
    logEl.append(list);
  }

  // ---- packets & printables (task 50) --------------------------------------

  async function packetSetRecords() {
    if (!pstate.clientId) return null;
    return ctx.docs.get(pstate.clientId).catch(() => null);
  }

  async function renderPacketScope() {
    pScopeField.hidden = pstate.type !== "deployment";
    if (pstate.type !== "deployment") return;
    const set = await packetSetRecords();
    const prev = pstate.scope;
    pScopeSel.replaceChildren();
    if (!set) {
      pScopeSel.append(h("option", { value: "" }, "Choose a client first"));
      return;
    }
    const targets = [];
    const seen = new Set();
    for (const rb of set.records.runbooks || []) {
      for (const [ref, kind] of [[rb.service, "Service"], [rb.site, "Site"]]) {
        if (!ref || !ref.id) continue;
        const key = ref.type + "::" + ref.id;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ key, label: kind + ": " + (ref.name || ref.id) });
      }
    }
    if (!targets.length) {
      pScopeSel.append(h("option", { value: "" }, "No runbooks to scope a deployment"));
      pstate.scope = "";
      return;
    }
    for (const t of targets) pScopeSel.append(h("option", { value: t.key }, t.label));
    pstate.scope = prev && targets.some((t) => t.key === prev) ? prev : targets[0].key;
    pScopeSel.value = pstate.scope;
  }

  function packetScopeRefs() {
    if (pstate.type !== "deployment" || !pstate.scope) return {};
    const [type, id] = pstate.scope.split("::");
    const ref = { type, id };
    return type === "locations" ? { siteRef: ref } : { serviceRef: ref };
  }

  async function buildPacket() {
    if (!pstate.clientId) throw new Error("Choose a client first.");
    if (pstate.type === "deployment" && !pstate.scope) throw new Error("Choose a deployment scope (a service or site with runbooks).");
    const common = { clientId: pstate.clientId, policy: pstate.policy, createdBy: whoami(ctx) };
    if (pstate.type === "deployment") return ctx.packets.buildDeployment({ ...common, ...packetScopeRefs() });
    return ctx.packets.buildDocumentation(common);
  }

  function setPacketButtons(on) {
    for (const b of [pOpenBtn, pHtmlBtn, pMdBtn, pHostBtn]) b.disabled = !on;
  }

  function renderPacketPreview() {
    clear(pPreviewEl);
    setPacketButtons(false);
    if (!pstate.packet) return;
    const { html } = packetToHtml(pstate.packet);
    pPreviewEl.append(
      h("p", { class: "kb-pub-preview-summary", id: "kbPacketSummary" }, packetSummaryLine(pstate.packet)),
      h("p", { class: "kb-pub-withheld" }, h("span", { class: "kb-pub-withheld-label" }, "Withheld: "), withheldSummary(pstate.packet.redaction.withheld)),
      h("div", { class: "kb-packet-sheet kb-prose", html }),
    );
    setPacketButtons(true);
  }

  async function buildPacketPreview() {
    clear(pPreviewEl);
    pPreviewEl.append(loadingState({ label: "Assembling the packet…" }));
    try {
      const { packet, omitted } = await buildPacket();
      pstate.packet = packet;
      renderPacketPreview();
      ctx.toast("Packet ready — " + omitted, "info", 5200);
    } catch (e) {
      pstate.packet = null;
      clear(pPreviewEl);
      pPreviewEl.append(errorState({ title: "Couldn’t build the packet", description: String((e && e.message) || e) }));
    }
  }

  async function hostPacket() {
    if (!pstate.packet) return;
    pHostBtn.disabled = true;
    pHostBtn.textContent = "Hosting…";
    try {
      const entry = await ctx.packets.host(pstate.packet, { createdBy: whoami(ctx) });
      ctx.toast("Hosted — " + fmtBytes(entry.bytes), "success", 5200);
      await renderPacketLog();
    } catch (e) {
      ctx.toast(String((e && e.message) || e), "error", 6000);
    } finally {
      pHostBtn.disabled = !pstate.packet;
      pHostBtn.textContent = "Host packet";
    }
  }

  async function renderPacketLog() {
    clear(pLogEl);
    let entries = [];
    try {
      entries = await ctx.packets.listLog();
    } catch {
      entries = [];
    }
    const countEl = document.getElementById("kbPacketLogCount");
    if (countEl) countEl.textContent = String(entries.length);
    if (!entries.length) {
      pLogEl.append(emptyState({ icon: icons.print, title: "Nothing hosted yet", description: "Hosted packets appear here with a printable, shareable link." }));
      return;
    }
    const list = h("div", { class: "kb-published-list" });
    for (const entry of entries) {
      const meta = h(
        "div",
        { class: "kb-published-main" },
        h("span", { class: "kb-published-name" }, (entry.title || "Packet") + " · " + relTime(entry.at) + " · " + fmtBytes(entry.bytes)),
        h("a", { class: "kb-published-url", href: entry.url, target: "_blank", rel: "noopener" }, entry.url),
        h("span", { class: "kb-pub-log-meta" }, "→ " + entry.kind + " · " + (entry.clientName || entry.clientId || "—") + " · " + (entry.counts ? entry.counts.records + " records" : "") + " · " + entry.redaction.withheldTotal + " withheld · by " + (entry.createdBy || "—")),
      );
      const remove = h("button", { class: "kb-icon-btn kb-pub-log-remove", type: "button", title: "Remove from log" }, "✕");
      remove.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "Remove hosted packet?", message: "This only clears the local log record; the hosted page stays where it is.", confirmLabel: "Remove", danger: true });
        if (!ok) return;
        await ctx.packets.removeLogEntry(entry.id);
        await renderPacketLog();
      });
      list.append(h("div", { class: "kb-published-item kb-pub-log-item" }, meta, remove));
    }
    pLogEl.append(list);
  }
}

// The full-screen, printable view of a packet. It is deliberately outside the
// station so a print (`window.print()`) prints only the packet: the app chrome
// is hidden by the `@media print` rules while this overlay is present.
function openPrintView(packet) {
  const { html } = packetToHtml(packet);
  const overlay = h("div", { class: "kb-print-overlay", role: "dialog", "aria-modal": "true" });
  const close = () => {
    document.removeEventListener("keydown", esc);
    overlay.remove();
  };
  const esc = (e) => {
    if (e.key === "Escape") close();
  };
  const printBtn = h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbPrintGo" }, "Print");
  printBtn.addEventListener("click", () => window.print());
  const closeBtn = h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbPrintClose" }, "Close");
  closeBtn.addEventListener("click", close);
  const toolbar = h("div", { class: "kb-print-toolbar" }, h("span", { class: "kb-print-title" }, packet.title), h("span", { class: "kb-print-spacer" }), printBtn, closeBtn);
  overlay.append(toolbar, h("div", { class: "kb-print-sheet kb-prose", html }));
  document.addEventListener("keydown", esc);
  document.body.append(overlay);
}
