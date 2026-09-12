// src/modules/idp-view.js — the Identity provider (SSO) Settings card (roadmap
// task 58).
//
// The working surface for single sign-on. It shows the security model in plain
// terms, the exact REDIRECT URI that has to be registered with the provider, the
// configured providers, and — for an administrator — an editor that adds a
// provider from a preset (Entra ID, Okta, Auth0, Google, generic OIDC), fetches
// its endpoints and PUBLIC signing keys with Discover, and maps directory groups
// to IT-U scoped roles.
//
// Two things this card is deliberately loud about:
//   • There is NO client secret. IT-U is public source with no trusted backend,
//     so the browser is an OIDC public client (Authorization Code + PKCE). A
//     provider that insists on a secret (e.g. a plain Google "Web application"
//     client) cannot complete the code exchange from the browser.
//   • The SERVER verifies every ID token — signature, issuer, audience, expiry
//     and nonce — and the directory is the source of truth for an SSO user's
//     scoped roles. The client can never assert its own identity.
//
// A "Preview mapping" tool inside the editor shows, offline and side-effect
// free, exactly which roles a set of claims would earn — the same pure logic the
// server applies.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, copyText } from "./shared.js";
import { ROLES, GLOBAL_SCOPE, parseScope, scopeLabel } from "../framework/roles.js";
import {
  PROVIDER_PRESETS,
  providerFromPreset,
  providerSummary,
  rolesFromRules,
  extractIdentity,
  ruleSummary,
  isProviderId,
  providerSlug,
  validateProvider,
  discoveryUrlFor,
  jwksKeyCount,
} from "../framework/idp.js";

const roleLabel = (id) => (ROLES.find((r) => r.id === id) || {}).label || id;

function cardHead(icon, title, badge) {
  return h(
    "div",
    { class: "kb-section-head" },
    h("span", { class: "kb-section-icon", html: icon }),
    h("h2", { class: "kb-section-name" }, title),
    badge ? h("span", { class: "kb-count-pill" }, badge) : null,
  );
}

function field(label, control) {
  return h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, label), control);
}

function selectEl(options, value) {
  const sel = h("select", { class: "kb-input kb-select" });
  for (const [v, l] of options) sel.append(h("option", { value: v }, l));
  if (value) sel.value = value;
  return sel;
}

function inputEl(value, placeholder, type = "text") {
  return h("input", { class: "kb-input", type, value: value == null ? "" : String(value), placeholder: placeholder || "" });
}

export function renderIdpCard(ctx, data, reload) {
  const card = h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "idp" } },
    cardHead(icons.key, "Identity provider (SSO)", null),
  );
  const body = h("div", { class: "kb-idp-body" });
  card.append(body);
  paint(ctx, body, reload);
  return card;
}

async function paint(ctx, body, reload) {
  clear(body);
  const sso = ctx.sso;

  body.append(
    h(
      "p",
      { class: "kb-muted" },
      "Let people sign in with the directory your organisation already runs (Microsoft Entra ID, Okta, Auth0, any OIDC provider). Groups in the directory become IT-U roles, scoped per client and per service — so offboarding someone in the directory removes their documentation access here.",
    ),
  );

  if (!sso || (ctx.kb && ctx.kb.ssoEnabled === false)) {
    body.append(h("p", { class: "kb-muted kb-idp-note" }, "Single sign-on is turned off in this build (kb.ssoEnabled = false)."));
    return;
  }
  if (!ctx.hub || !ctx.hub.connected) {
    body.append(
      h(
        "p",
        { class: "kb-muted kb-idp-note" },
        "The realtime hub is offline. Identity-provider sign-in needs the hub: the server is what verifies the ID token and applies directory-group roles, and nothing here can stand in for it.",
      ),
    );
    return;
  }

  let cfg;
  try {
    cfg = await sso.loadConfig(true);
  } catch (e) {
    body.append(h("p", { class: "kb-form-error" }, "Couldn’t load the identity-provider configuration: " + String((e && e.message) || e)));
    return;
  }
  if (cfg.offline) {
    body.append(h("p", { class: "kb-muted kb-idp-note" }, "The hub went offline while loading."));
    return;
  }

  const working = (cfg.providers || []).map((p) => ({ ...p, rules: (p.rules || []).map((r) => ({ ...r })) }));
  const status = h("p", { class: "kb-idp-status", hidden: true });

  // ---- security model ------------------------------------------------------
  body.append(
    h(
      "details",
      { class: "kb-idp-model" },
      h("summary", null, "How sign-in works, and what it does not do"),
      h(
        "ul",
        { class: "kb-idp-model-list" },
        h("li", null, "This is standard OIDC Authorization Code flow with PKCE. IT-U is a PUBLIC client: there is no client secret to leak, because the generator’s source is public and it has no trusted backend."),
        h("li", null, "The provider returns an ID token. The IT-U SERVER verifies its signature against the provider’s public keys (JWKS) and checks issuer, audience, expiry and the per-attempt nonce before it creates or opens any account."),
        h("li", null, "The browser never decides who you are, and never asserts your roles. Directory groups are mapped to scoped roles server-side."),
        h("li", null, "The configuration stored on the server holds only public material: endpoints, the client (application) id, claim mapping and PUBLIC signing keys. A provider that requires a client secret cannot be used from the browser."),
      ),
    ),
  );

  // ---- redirect URI --------------------------------------------------------
  const redirect = sso.redirectUri();
  const redirectInput = h("input", { class: "kb-input kb-idp-redirect", type: "text", value: redirect, readOnly: true, id: "kbIdpRedirect" });
  body.append(
    h(
      "div",
      { class: "kb-idp-redirect-row" },
      h("div", { class: "kb-idp-redirect-text" },
        h("div", { class: "kb-subhead" }, "Redirect URI to register"),
        h("p", { class: "kb-muted" }, "Add this exact URI as an allowed redirect (single-page application) in each provider. It must match character for character."),
      ),
      h("div", { class: "kb-idp-redirect-ctl" }, redirectInput,
        h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbIdpRedirectCopy" }, "Copy")),
    ),
  );
  const copyBtn = body.querySelector("#kbIdpRedirectCopy");
  copyBtn.addEventListener("click", () => copyText(redirect, ctx.toast));

  // ---- providers -----------------------------------------------------------
  const list = h("div", { class: "kb-idp-providers" });
  body.append(h("div", { class: "kb-subhead" }, "Providers"), list);

  const canEdit = !!cfg.canEdit;
  if (!canEdit) {
    body.append(h("p", { class: "kb-muted kb-idp-note" }, "Only an administrator can add or change providers. You can still sign in with any provider listed here from the account menu."));
  }

  async function save(next, okMsg) {
    status.hidden = true;
    try {
      const saved = await ctx.hub.ssoSetConfig(next);
      sso.invalidate();
      ctx.toast(okMsg || "Identity-provider configuration saved", "success");
      reload && reload();
      return saved;
    } catch (e) {
      status.textContent = String((e && e.message) || e);
      status.className = "kb-form-error";
      status.hidden = false;
      ctx.toast(String((e && e.message) || e), "error", 6000);
      throw e;
    }
  }

  function renderProviders() {
    clear(list);
    if (!working.length) {
      list.append(h("p", { class: "kb-muted" }, "No identity providers configured yet. Add one, or try the simulator below to see the flow end to end."));
      return;
    }
    for (const p of working) list.append(providerRow(p));
  }

  function providerRow(p) {
    const missing = validateProvider(p).errors;
    const keys = jwksKeyCount(p);
    const badge = p.kind === "simulator" ? "demo" : keys ? keys + " key" + (keys === 1 ? "" : "s") : "no keys";
    const row = h(
      "div",
      { class: "kb-idp-provider", dataset: { id: p.id } },
      h("span", { class: "kb-idp-provider-icon", html: icons.key }),
      h(
        "div",
        { class: "kb-idp-provider-main" },
        h("div", { class: "kb-idp-provider-name" }, p.name || p.id,
          h("span", { class: "kb-badge kb-idp-badge" + (missing.length ? " kb-idp-badge--warn" : "") }, badge)),
        h("div", { class: "kb-idp-provider-meta kb-muted" }, providerSummary(p)),
        h("div", { class: "kb-idp-provider-rules kb-muted" },
          (p.rules || []).length
            ? (p.rules.length + " group rule" + (p.rules.length === 1 ? "" : "s") + ": " + p.rules.map((r) => ruleSummary(r)).join(" · "))
            : "No group rules — people who sign in here get read-only (viewer) access."),
      ),
      h("div", { class: "kb-idp-provider-actions" },
        canEdit
          ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Edit")
          : null,
        canEdit
          ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button" }, "Remove")
          : null,
      ),
    );
    if (canEdit) {
      const [editBtn, removeBtn] = row.querySelectorAll(".kb-idp-provider-actions button");
      editBtn.addEventListener("click", () => {
        openProviderEditor({
          provider: p,
          existingIds: working.map((x) => x.id),
          redirectUri: redirect,
          onSave: (next) => {
            const i = working.indexOf(p);
            if (i >= 0) working[i] = next;
            save(working.slice(), `Saved “${next.name}”`);
          },
        });
      });
      removeBtn.addEventListener("click", () => {
        const i = working.indexOf(p);
        if (i >= 0) working.splice(i, 1);
        save(working.slice(), `Removed “${p.name || p.id}”`);
      });
    }
    return row;
  }

  if (canEdit) {
    const addWrap = h("div", { class: "kb-idp-add" });
    const presetSel = selectEl(PROVIDER_PRESETS.map((p) => [p.id, p.name]), "entra");
    const addBtn = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", id: "kbIdpAddBtn" }, "Add provider");
    addBtn.addEventListener("click", () => {
      const preset = presetSel.value;
      const seed = providerFromPreset(preset, { id: providerSlug(preset, working.map((x) => x.id)) });
      openProviderEditor({
        provider: seed,
        isNew: true,
        presetId: preset,
        existingIds: working.map((x) => x.id),
        redirectUri: redirect,
        onSave: (next) => {
          working.push(next);
          save(working.slice(), `Added “${next.name}”`);
        },
      });
    });
    addWrap.append(h("span", { class: "kb-muted" }, "Add:"), presetSel, addBtn);
    body.append(addWrap);
  }

  status.className = "kb-idp-status";
  body.append(status);
  renderProviders();

  // ---- simulator -----------------------------------------------------------
  const sim = cfg.simulator;
  if (sim && !(ctx.kb && ctx.kb.showSimulator === false)) {
    const personas = (sso.personas && sso.personas()) || [];
    const sel = selectEl(personas.map((p) => [p.id, p.label]), personas[0] && personas[0].id);
    const simBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbIdpSimBtn" }, "Sign in with the simulator");
    const simOut = h("p", { class: "kb-idp-status", hidden: true });
    simBtn.addEventListener("click", async () => {
      simBtn.disabled = true;
      simOut.hidden = true;
      try {
        const res = await sso.simulate(sel.value);
        simOut.className = res.adjusted ? "kb-idp-status kb-idp-status--warn" : "kb-idp-status";
        simOut.textContent = res.adjusted
          ? `Signed in as ${res.username} — the directory name “${res.naturalUsername}” is already a local account, so SSO keeps its own separate account. ${roleLabel(res.isAdmin ? "administrator" : (res.roles[0] && res.roles[0].role) || "viewer")}, ${res.groups} group(s) in the token.`
          : `Signed in as ${res.username} — ${roleLabel(res.isAdmin ? "administrator" : (res.roles[0] && res.roles[0].role) || "viewer")}, ${res.groups} group(s) in the token.`;
        simOut.hidden = false;
        ctx.toast(`Simulator sign-in: ${res.username}`, res.adjusted ? "warning" : "success");
      } catch (e) {
        simOut.className = "kb-form-error";
        simOut.textContent = String((e && e.message) || e);
        simOut.hidden = false;
      } finally {
        simBtn.disabled = false;
      }
    });
    body.append(
      h(
        "div",
        { class: "kb-idp-sim" },
        h("div", { class: "kb-subhead" }, "Built-in simulator (demo)"),
        h(
          "p",
          { class: "kb-muted" },
          "A fully offline provider that exercises the real flow end to end — it mints an ID token the SERVER verifies exactly like a real one. It is signed with a key that ships in public source, so it is a demonstration only: it has no group rules, so a simulated sign-in is always a viewer. Use it to prove the plumbing works before wiring a real directory.",
        ),
        h("div", { class: "kb-idp-sim-row" }, sel, simBtn),
        simOut,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// the provider editor (modal)
// ---------------------------------------------------------------------------
function openProviderEditor({ provider, isNew, presetId, existingIds, redirectUri, onSave }) {
  const p = {
    kind: "oidc",
    scopes: "openid profile email",
    usernameClaim: "preferred_username",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "groups",
    defaultRole: "viewer",
    rules: [],
    ...provider,
  };
  if (!Array.isArray(p.rules)) p.rules = [];

  const preset = PROVIDER_PRESETS.find((x) => x.id === (presetId || p.id)) || null;
  const presetSel = selectEl(PROVIDER_PRESETS.map((x) => [x.id, x.name]), (preset && preset.id) || "generic");
  const nameIn = inputEl(p.name, "Microsoft Entra ID");
  const idIn = inputEl(p.id, "entra");
  const issuerIn = inputEl(p.issuer, (preset && preset.issuerPlaceholder) || "https://idp.example.com/realms/main");
  const clientIn = inputEl(p.clientId, "application (client) id");
  const scopesIn = inputEl(p.scopes, "openid profile email");
  const userClaimIn = inputEl(p.usernameClaim, "preferred_username");
  const nameClaimIn = inputEl(p.nameClaim, "name");
  const emailClaimIn = inputEl(p.emailClaim, "email");
  const groupsClaimIn = inputEl(p.groupsClaim, "groups");
  const defaultRoleSel = selectEl(ROLES.map((r) => [r.id, r.label]), p.defaultRole || "viewer");

  const notes = h("p", { class: "kb-muted kb-idp-preset-notes" }, (preset && preset.notes) || "");
  const endpointEl = h("div", { class: "kb-idp-endpoints" });
  const discStatus = h("p", { class: "kb-idp-status", hidden: true });

  const rules = rulesEditor(p.rules);

  function endpointsView() {
    clear(endpointEl);
    const rows = [
      ["Authorization endpoint", p.authorizationEndpoint],
      ["Token endpoint", p.tokenEndpoint],
      ["Signing keys (JWKS)", p.jwksUri],
      ["End session endpoint", p.endSessionEndpoint],
    ];
    for (const [label, value] of rows) {
      endpointEl.append(
        h("div", { class: "kb-idp-endpoint" },
          h("span", { class: "kb-idp-endpoint-label" }, label),
          h("code", { class: "kb-idp-endpoint-value" + (value ? "" : " kb-muted") }, value || "— not discovered yet —")),
      );
    }
    const count = jwksKeyCount(p);
    endpointEl.append(
      h("div", { class: "kb-idp-endpoint" },
        h("span", { class: "kb-idp-endpoint-label" }, "Signing keys held"),
        h("code", { class: "kb-idp-endpoint-value" + (count ? "" : " kb-muted") }, count ? count + " public RSA key" + (count === 1 ? "" : "s") : "—")),
    );
  }

  // ---- preview mapping (pure, side-effect free) ---------------------------
  const previewTa = h("textarea", { class: "kb-input kb-idp-preview-input", rows: 5 });
  const previewOut = h("div", { class: "kb-idp-preview-out" });
  function seedPreview() {
    const sample = {
      iss: p.issuer || "https://idp.example.com",
      aud: p.clientId || "your-client-id",
      sub: "8f2a…",
      preferred_username: "jordan@contoso.example",
      name: "Jordan Blake",
      email: "jordan@contoso.example",
      groups: ["itu-technicians", "eng-team"],
    };
    previewTa.value = JSON.stringify(sample, null, 2);
  }
  function runPreview() {
    clear(previewOut);
    let claims;
    try {
      claims = JSON.parse(previewTa.value);
    } catch (e) {
      previewOut.append(h("p", { class: "kb-form-error" }, "That is not valid JSON."));
      return;
    }
    const spec = { ...p, rules: rules.read() };
    const id = extractIdentity(spec, claims);
    const grants = rolesFromRules(spec, id.groups);
    previewOut.append(
      h("div", { class: "kb-idp-preview-row" }, h("span", { class: "kb-idp-endpoint-label" }, "Username"), h("code", null, id.username || "—")),
      h("div", { class: "kb-idp-preview-row" }, h("span", { class: "kb-idp-endpoint-label" }, "Name"), h("code", null, id.name || "—")),
      h("div", { class: "kb-idp-preview-row" }, h("span", { class: "kb-idp-endpoint-label" }, "Groups"), h("code", null, (id.groups || []).join(", ") || "—")),
      h("div", { class: "kb-idp-preview-row" }, h("span", { class: "kb-idp-endpoint-label" }, "Roles granted"),
        h("span", { class: "kb-idp-preview-roles" },
          grants.length
            ? grants.map((g) => h("span", { class: "kb-idp-grant" }, roleLabel(g.role) + " at " + scopeLabel(g.scope)))
            : h("span", { class: "kb-muted" }, "read-only (viewer) everywhere"))),
    );
  }
  seedPreview();

  const preview = h(
    "details",
    { class: "kb-idp-preview" },
    h("summary", null, "Preview the claim mapping"),
    h("p", { class: "kb-muted" }, "Paste a set of claims (as they would appear in an ID token) to see, offline, which IT-U roles the rules above would grant. This is the same pure logic the server applies."),
    previewTa,
    h("div", { class: "kb-idp-preview-actions" }, h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbIdpPreviewBtn" }, "Preview mapping")),
    previewOut,
  );

  const m = openModal({
    title: isNew ? "Add an identity provider" : "Edit identity provider",
    description: "Register the redirect URI with the provider, then use Discover to fetch its endpoints and public signing keys.",
    wide: true,
    children: [
      field("Provider type", presetSel),
      notes,
      h("div", { class: "kb-field-row" }, field("Display name", nameIn), field("Id (slug)", idIn)),
      h("div", { class: "kb-field-row" }, field("Issuer URL", issuerIn), field("Client (application) id", clientIn)),
      field("Scopes", scopesIn),
      h("div", { class: "kb-field-row" }, field("Username claim", userClaimIn), field("Display-name claim", nameClaimIn)),
      h("div", { class: "kb-field-row" }, field("E-mail claim", emailClaimIn), field("Groups claim", groupsClaimIn)),
      field("Default role for anyone who signs in", defaultRoleSel),
      h("div", { class: "kb-subhead" }, "Endpoints & keys"),
      h("p", { class: "kb-muted" }, "Fetched from the issuer’s discovery document (.well-known/openid-configuration) and its published public keys. The keys are stored so the SERVER can verify ID tokens offline."),
      h("div", { class: "kb-idp-disc-row" },
        h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbIdpDiscoverBtn" }, "Discover endpoints & keys"),
        h("span", { class: "kb-muted", id: "kbIdpDiscoverHint" }, discoveryUrlFor(issuerIn.value) || "enter an issuer first")),
      endpointEl,
      discStatus,
      h("div", { class: "kb-subhead" }, "Directory group → role rules"),
      h("p", { class: "kb-muted" }, "A rule fires when any of the token’s groups matches. Leave the match blank (or *) to apply the rule to everyone. The scope is the whole repository (*), one client (client:<id>) or one service (service:<clientId>/<serviceId>)."),
      rules.el,
      h("div", { class: "kb-idp-rule-add" }, h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbIdpAddRule" }, "Add rule")),
      preview,
    ],
  });

  endpointsView();

  function collect() {
    return {
      ...p,
      id: idIn.value.trim().toLowerCase(),
      name: nameIn.value.trim(),
      issuer: issuerIn.value.trim().replace(/\/+$/, ""),
      clientId: clientIn.value.trim(),
      scopes: scopesIn.value.trim() || "openid profile email",
      usernameClaim: userClaimIn.value.trim(),
      nameClaim: nameClaimIn.value.trim(),
      emailClaim: emailClaimIn.value.trim(),
      groupsClaim: groupsClaimIn.value.trim(),
      defaultRole: defaultRoleSel.value,
      rules: rules.read(),
    };
  }

  presetSel.addEventListener("change", () => {
    const pres = PROVIDER_PRESETS.find((x) => x.id === presetSel.value);
    if (!pres) return;
    notes.textContent = pres.notes || "";
    issuerIn.placeholder = pres.issuerPlaceholder || "";
    userClaimIn.value = pres.usernameClaim || "";
    nameClaimIn.value = pres.nameClaim || "";
    emailClaimIn.value = pres.emailClaim || "";
    groupsClaimIn.value = pres.groupsClaim || "";
    scopesIn.value = pres.scopes || "openid profile email";
    if (!isNew && pres.id !== p.id) idIn.value = providerSlug(pres.id, existingIds);
  });
  issuerIn.addEventListener("input", () => {
    const hint = m.overlay.querySelector("#kbIdpDiscoverHint");
    if (hint) hint.textContent = discoveryUrlFor(issuerIn.value) || "enter an issuer first";
  });
  idIn.addEventListener("input", () => {
    idIn.value = idIn.value.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  });

  m.overlay.querySelector("#kbIdpAddRule").addEventListener("click", () => rules.add());
  m.overlay.querySelector("#kbIdpPreviewBtn").addEventListener("click", runPreview);

  const discBtn = m.overlay.querySelector("#kbIdpDiscoverBtn");
  discBtn.addEventListener("click", async () => {
    const sso = window.__kb && window.__kb.sso;
    discStatus.hidden = true;
    const current = collect();
    if (!/^https?:\/\//i.test(current.issuer)) {
      discStatus.className = "kb-form-error";
      discStatus.textContent = "Enter the issuer URL first (an http(s) address).";
      discStatus.hidden = false;
      return;
    }
    discBtn.disabled = true;
    discStatus.className = "kb-idp-status";
    discStatus.textContent = "Discovering…";
    discStatus.hidden = false;
    try {
      const fused = await sso.discover(current);
      p.authorizationEndpoint = fused.provider.authorizationEndpoint || "";
      p.tokenEndpoint = fused.provider.tokenEndpoint || "";
      p.jwksUri = fused.provider.jwksUri || "";
      p.endSessionEndpoint = fused.provider.endSessionEndpoint || "";
      p.jwks = fused.provider.jwks || null;
      issuerIn.value = fused.provider.issuer || issuerIn.value;
      endpointsView();
      if (fused.errors.length) {
        discStatus.className = "kb-idp-status kb-idp-status--warn";
        discStatus.textContent = fused.errors.join(" ");
      } else {
        discStatus.className = "kb-idp-status";
        discStatus.textContent = "Discovered — " + jwksKeyCount(p) + " public signing key(s) fetched.";
      }
    } catch (e) {
      discStatus.className = "kb-form-error";
      discStatus.textContent = "Couldn’t discover: " + String((e && e.message) || e);
    } finally {
      discBtn.disabled = false;
    }
  });

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbIdpSaveProvider" }, isNew ? "Add provider" : "Save provider"),
  );
  m.actions.querySelector("#kbIdpSaveProvider").addEventListener("click", async () => {
    m.clearError();
    const next = collect();
    if (!isProviderId(next.id)) return m.showError("The id must be a lowercase slug (letters, digits, . _ -), starting with a letter or digit.");
    if (existingIds.some((x) => x === next.id && x !== p.id)) return m.showError("Another provider already uses that id.");
    if (!next.name) return m.showError("Give the provider a name people will recognise.");
    if (!/^https?:\/\//i.test(next.issuer)) return m.showError("The issuer must be an http(s) URL.");
    if (!next.clientId) return m.showError("A client (application) id is required.");
    if (!next.authorizationEndpoint || !next.tokenEndpoint) return m.showError("Run Discover to fill in the endpoints.");
    if (!next.jwks || !jwksKeyCount(next)) return m.showError("No public signing keys — the server cannot verify ID tokens without them. Run Discover.");
    try {
      await onSave(next);
      m.close();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
  return m;
}

// A small repeatable rule-row editor: match / role / scope.
function rulesEditor(initialRules) {
  const list = h("div", { class: "kb-idp-rules" });
  function addRow(rule = { match: "", role: "technician", scope: GLOBAL_SCOPE }) {
    const matchIn = inputEl(rule.match, "group name, it-* (glob), or blank for everyone");
    const roleSel = selectEl(ROLES.map((r) => [r.id, r.label]), rule.role || "technician");
    const scopeIn = inputEl(rule.scope || GLOBAL_SCOPE, "*  ·  client:acme  ·  service:acme/helpdesk");
    const summary = h("span", { class: "kb-idp-rule-summary kb-muted" });
    const del = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", title: "Remove this rule", "aria-label": "Remove rule" }, "×");
    const el = h(
      "div",
      { class: "kb-idp-rule" },
      h("div", { class: "kb-idp-rule-fields" },
        field("Group match", matchIn),
        field("Role", roleSel),
        field("Scope", scopeIn),
        del),
      summary,
    );
    const sync = () => {
      const spec = { match: matchIn.value.trim(), role: roleSel.value, scope: scopeIn.value.trim() || GLOBAL_SCOPE };
      const parsed = parseScope(spec.scope);
      summary.textContent = parsed ? ruleSummary(spec) : "“" + spec.scope + "” is not a valid scope — it will be treated as the whole repository.";
    };
    matchIn.addEventListener("input", sync);
    roleSel.addEventListener("change", sync);
    scopeIn.addEventListener("input", sync);
    sync();
    del.addEventListener("click", () => el.remove());
    list.append(el);
    return el;
  }
  for (const r of initialRules || []) addRow(r);
  return {
    el: list,
    add: () => addRow(),
    read: () =>
      [...list.children].map((el) => {
        const [matchIn, roleSel, scopeIn] = [...el.querySelectorAll("input, select")];
        return { match: matchIn.value.trim(), role: roleSel.value, scope: scopeIn.value.trim() || GLOBAL_SCOPE };
      }),
    count: () => list.children.length,
  };
}
