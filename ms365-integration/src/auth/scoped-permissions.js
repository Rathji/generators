// src/auth/scoped-permissions.js
// Scoped Permission Requestor.
// A dynamic scope-request system: when a specific feature is triggered (e.g.
// mail, calendar, files, tasks), check whether the current token carries the
// scopes it needs; if not, run an incremental-consent re-auth that asks only
// for the missing permissions, then merge them into the active configuration.
//
// Requires oauth2 to be configured first (oauth2.configure(...)).

import { getConfig, configure, launchAuthFlow } from "./oauth2.js";

// Feature → Graph delegated scopes. Keep in sync with the Azure app consent.
export const FEATURE_SCOPES = {
  mail: ["Mail.ReadWrite"],               // mailbox query + drafts
  mailSend: ["Mail.Send"],                // sending
  calendar: ["Calendars.ReadWrite"],
  files: ["Files.ReadWrite.All"],
  tasks: ["Tasks.ReadWrite"],
  tenant: ["Organization.Read.All"],      // deep tenant validation
};

// Human-readable descriptions for prompts / UI.
export const FEATURE_LABELS = {
  mail: "Read & manage email",
  mailSend: "Send email on your behalf",
  calendar: "Read & create calendar events",
  files: "Access your files in OneDrive/SharePoint",
  tasks: "Read & update your To Do tasks",
  tenant: "Read organization information",
};

// Expand a feature name (or array of feature names / raw scopes) into a flat
// list of required scopes.
export function scopesForFeature(feature) {
  if (Array.isArray(feature)) {
    const out = [];
    for (const f of feature) {
      if (typeof f === "string" && FEATURE_SCOPES[f]) out.push(...FEATURE_SCOPES[f]);
      else if (typeof f === "string") out.push(f); // raw scope passthrough
    }
    return [...new Set(out)];
  }
  if (typeof feature === "string" && FEATURE_SCOPES[feature]) return [...FEATURE_SCOPES[feature]];
  if (typeof feature === "string") return [feature];
  return [];
}

// Which scopes the current config is missing for the given feature.
export function missingScopes(feature) {
  const cfg = getConfig();
  if (!cfg) return scopesForFeature(feature);
  const current = cfg.scopes || [];
  return scopesForFeature(feature).filter((s) => !current.includes(s));
}

// Is every scope for the feature already granted (from config)?
export function hasScopes(feature) {
  return missingScopes(feature).length === 0;
}

// Ensure the given feature's scopes are granted. If they are, resolves
// immediately. If not, launches incremental-consent auth for ONLY the missing
// scopes (the user stays signed in; existing grants are preserved), then merges
// the newly granted scopes into the active oauth2 config.
//
// Returns:
//   { granted: true, added: [...], missing: [] }              — all present
//   { granted: false, added: [], missing: [...], aborted: true } — user closed auth
//   (throws) on auth failure.
export async function ensureScopes(feature, opts = {}) {
  const required = scopesForFeature(feature);
  const cfg = getConfig();
  if (!cfg) throw new Error("ms365.scopedPermissions: not configured — call oauth2.configure({ clientId, ... }) first.");
  if (!required.length) return { granted: true, added: [], missing: [] };

  const current = cfg.scopes || [];
  const missing = required.filter((s) => !current.includes(s));
  if (!missing.length) return { granted: true, added: [], missing: [] };

  const res = await launchAuthFlow({
    extraScopes: missing,
    prompt: "consent",
    ...(opts.auth || {}),
  });
  if (res === null) {
    return { granted: false, added: [], missing, aborted: true };
  }
  if (!res.tokens) {
    return { granted: false, added: [], missing, aborted: true };
  }

  // Merge newly granted scopes into the active config so subsequent calls and
  // re-sign-ins carry them.
  const merged = [...new Set([...current, ...required])];
  configure({ ...cfg, scopes: merged });
  return { granted: true, added: missing, missing: [], scopes: merged };
}
