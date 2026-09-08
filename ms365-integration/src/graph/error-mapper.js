// src/graph/error-mapper.js
// Error Mapping Engine.
// Maps Microsoft Graph API error codes (and HTTP statuses) to human-readable,
// internal application errors so callers can fail gracefully instead of
// surfacing raw Graph JSON to end users.
//
// API:
//   mapGraphError(err)   → { code, status, friendly, category, hint, retryable }
//   toFriendlyError(err) → the same Error (or a new one) with .friendly,
//                          .category, .hint and .mapped attached.

// Known Microsoft Graph error codes → friendly messages. Keep keys exact as
// Graph reports them (both camelCase from the v1.0 endpoint and the PascalCase
// / raw OData codes are included where they differ).
const CODE_MAP = {
  // ── auth / permission ──────────────────────────────────────────────
  AccessDenied: { friendly: "You don't have permission to perform this action.", category: "permission", hint: "Ask your Microsoft 365 admin to grant the needed permission — some scopes require admin consent." },
  accessDenied: { friendly: "You don't have permission to perform this action.", category: "permission", hint: "Ask your Microsoft 365 admin to grant the needed permission — some scopes require admin consent." },
  Forbidden: { friendly: "Access is forbidden for this resource.", category: "permission", hint: "The account or the app is missing permission for this resource." },
  Authorization_RequestDenied: { friendly: "Your organization's admin has not granted consent for this operation.", category: "consent", hint: "Ask the tenant admin to review the app's requested permissions in the Entra admin center." },
  Authorization_IdentityNotFound: { friendly: "The user or identity could not be found.", category: "identity", hint: "Check that the user exists in this tenant and has a valid account." },
  Authorization_PermissionDenied: { friendly: "The user lacks the permission required for this operation.", category: "permission", hint: "Request the missing scope via ms365.scopedPermissions.ensureScopes(...)." },
  unauthenticated: { friendly: "Authentication failed — the access token is missing, invalid or expired.", category: "auth", hint: "Sign in again, or ensure the token is refreshed via oauth2.getValidToken()." },
  authenticationError: { friendly: "Microsoft could not authenticate this request.", category: "auth", hint: "Sign in again. If it persists, the app registration may be misconfigured." },
  invalidAuthenticationToken: { friendly: "The access token is invalid or has expired.", category: "auth", hint: "The token is auto-refreshed by the token lifecycle manager; sign in again if this recurs." },
  invalidClient: { friendly: "The app registration is invalid.", category: "config", hint: "Check the Client (Application) ID and that the app registration exists." },
  invalidGrant: { friendly: "The refresh token is invalid or has been revoked.", category: "auth", hint: "Sign in again to obtain a fresh token." },
  invalidRequest: { friendly: "The request was malformed or contained invalid values.", category: "request", hint: "Review the request body and parameters." },
  consentNeeded: { friendly: "Your consent is required before this operation can run.", category: "consent", hint: "Use ms365.scopedPermissions.ensureScopes(...) to request the missing permission." },
  interactionRequired: { friendly: "This operation needs you to sign in interactively.", category: "consent", hint: "Launch the auth flow again (prompt=consent) to grant the new permission." },
  loginRequired: { friendly: "You need to sign in to continue.", category: "auth", hint: "Sign in with Microsoft." },
  consent_required: { friendly: "Admin or user consent is required for this operation.", category: "consent", hint: "Request the scope via ms365.scopedPermissions.ensureScopes(...) or ask the admin." },

  // ── resource / item ────────────────────────────────────────────────
  NotFound: { friendly: "The requested resource was not found.", category: "not_found", hint: "Check the resource ID, path or search query." },
  itemNotFound: { friendly: "The item was not found.", category: "not_found", hint: "It may have been moved, renamed or deleted." },
  ErrorItemNotFound: { friendly: "The item was not found.", category: "not_found", hint: "It may have been moved, renamed or deleted." },
  Request_ResourceNotFound: { friendly: "The requested resource was not found.", category: "not_found", hint: "Check the ID or path used in the request." },
  ResourceNotFound: { friendly: "The requested resource was not found.", category: "not_found", hint: "Check the ID or path used in the request." },
  ErrorFolderNotFound: { friendly: "The mail folder was not found.", category: "not_found", hint: "Check the folder ID or name." },
  SyncFolderNotFound: { friendly: "The sync folder was not found.", category: "not_found", hint: "The folder may not exist in this mailbox." },
  ErrorInvalidUser: { friendly: "The user is invalid or does not exist.", category: "identity", hint: "Check the user principal name or ID." },

  // ── mail ───────────────────────────────────────────────────────────
  MailboxNotEnabledForRESTAPI: { friendly: "This mailbox isn't enabled for the REST API.", category: "mailbox", hint: "A Microsoft 365 Exchange Online mailbox is required (personal accounts can't be used here)." },
  MailboxInconsistentState: { friendly: "The mailbox is in an inconsistent state — try again.", category: "mailbox", retryable: true },
  MessageTooBig: { friendly: "The message is too large to send.", category: "mailbox", hint: "Reduce the message size or attachment sizes." },
  RecipientNotFound: { friendly: "One or more recipients could not be found.", category: "mailbox", hint: "Check the recipient email addresses." },
  NoResolvableSmtpAddress: { friendly: "One or more recipients have no valid email address.", category: "mailbox", hint: "Check recipient addresses, especially distribution groups." },
  MessageRecipientHasNoSMTPAddress: { friendly: "A recipient has no SMTP address.", category: "mailbox", hint: "Check the recipient list." },
  SendAsDenied: { friendly: "You are not allowed to send as this identity.", category: "permission", hint: "Ask the tenant admin for send-as permission." },
  CannotDeleteSubmittedMessage: { friendly: "This message was already submitted and can't be deleted.", category: "mailbox", hint: "A submitted draft can no longer be deleted." },
  AttachmentSizeLimitExceeded: { friendly: "The attachment is larger than the allowed limit.", category: "mailbox", hint: "Graph allows files up to 150 MB per message; use a smaller attachment." },
  FolderCountExceeded: { friendly: "The folder hierarchy is too deep.", category: "mailbox" },

  // ── files / OneDrive ───────────────────────────────────────────────
  FileNotAvailableForUpload: { friendly: "The file is not available for upload right now.", category: "files", retryable: true },
  FileNameTooLong: { friendly: "The file name is too long.", category: "files", hint: "Use a shorter file name (max 255 characters)." },
  FileNameContainsInvalidCharacters: { friendly: "The file name contains characters that aren't allowed.", category: "files", hint: "Remove characters such as * : \\ / ? and control characters." },
  NameAlreadyExists: { friendly: "An item with this name already exists.", category: "files", hint: "Use a different name or set conflictBehavior to 'replace'." },
  nameAlreadyExists: { friendly: "An item with this name already exists.", category: "files", hint: "Use a different name or set conflictBehavior to 'replace'." },
  MalwareDetected: { friendly: "Malware was detected in the file and it was blocked.", category: "files" },
  QuotaLimitReached: { friendly: "The storage quota for this account has been reached.", category: "files", hint: "Free up space or use a different drive." },
  OneDriveNotEnabled: { friendly: "OneDrive is not enabled for this account.", category: "files", hint: "The user needs an active OneDrive for Business licence." },
  NotSupportedResourceType: { friendly: "This resource type isn't supported.", category: "files" },
  SharingLinkCreationFailed: { friendly: "The sharing link could not be created.", category: "files" },
  InvalidRange: { friendly: "The requested byte range is invalid.", category: "files" },
  ErrorAccessDenied: { friendly: "Access to the file or folder was denied.", category: "permission", hint: "Check that you have at least read permission on the item." },

  // ── throttle / service ─────────────────────────────────────────────
  ActivityLimitReached: { friendly: "Microsoft is throttling requests from this app.", category: "throttle", retryable: true, hint: "Slow down or retry after the delay suggested by the Retry-After header." },
  TooManyRequests: { friendly: "Too many requests — Microsoft is throttling this app.", category: "throttle", retryable: true, hint: "Retry after the suggested delay; the wrapper already backs off automatically." },
  ThrottledRequests: { friendly: "Microsoft is throttling requests from this app.", category: "throttle", retryable: true },
  ServiceNotAvailable: { friendly: "Microsoft 365 is temporarily unavailable.", category: "service", retryable: true, hint: "Retry shortly — the wrapper backs off automatically." },
  GeneralException: { friendly: "Microsoft 365 returned a generic error.", category: "service", retryable: true },
  ResourceModified: { friendly: "The resource was modified by someone else — reload and retry.", category: "conflict", hint: "Re-fetch the item to get its current state." },
  ResyncRequired: { friendly: "Your local copy is out of sync — reload it.", category: "conflict" },
  NotAllowed: { friendly: "This operation is not allowed for the current context.", category: "permission", hint: "The account or item state doesn't permit this operation." },
  NotSupported: { friendly: "This operation is not supported.", category: "request" },

  // ── not found (internal ms365 code, mirrors the category) ──────────
  not_found: { friendly: "The requested resource was not found.", category: "not_found", hint: "Check the ID, path or search query used in the request." },

  // ── internal (ms365 modules) ───────────────────────────────────────
  not_authenticated: { friendly: "You aren't signed in — an access token is required for this call.", category: "auth", hint: "Call oauth2.launchAuthFlow() or sign in via the widget first." },
  network_error: { friendly: "The request failed at the network level — is the app online?", category: "network", retryable: true },
  no_refresh_token: { friendly: "The access token expired and there is no refresh token — sign in again.", category: "auth", hint: "Make sure the offline_access scope is granted." },
};

// HTTP-status fallbacks (used when the code is unknown / absent).
const STATUS_MAP = {
  400: { friendly: "The request was malformed (HTTP 400).", category: "request" },
  401: { friendly: "Authentication failed — the access token is missing, invalid or expired (HTTP 401).", category: "auth", hint: "Sign in again; the wrapper auto-refreshes on 401." },
  403: { friendly: "Access is forbidden — you don't have permission for this resource (HTTP 403).", category: "permission" },
  404: { friendly: "The requested resource was not found (HTTP 404).", category: "not_found" },
  405: { friendly: "This method is not allowed on the resource (HTTP 405).", category: "request" },
  409: { friendly: "The resource was modified elsewhere — reload and retry (HTTP 409).", category: "conflict" },
  412: { friendly: "A precondition on the request failed (HTTP 412).", category: "conflict" },
  413: { friendly: "The request payload is too large (HTTP 413).", category: "request" },
  415: { friendly: "The media type isn't supported (HTTP 415).", category: "request" },
  422: { friendly: "The server understood the request but couldn't process it (HTTP 422).", category: "request" },
  429: { friendly: "Microsoft is throttling requests — retry after the suggested delay (HTTP 429).", category: "throttle", retryable: true },
  500: { friendly: "An internal error occurred on Microsoft's servers (HTTP 500).", category: "service", retryable: true },
  501: { friendly: "This operation is not implemented (HTTP 501).", category: "request" },
  503: { friendly: "Microsoft 365 is temporarily unavailable — retry shortly (HTTP 503).", category: "service", retryable: true },
  504: { friendly: "Microsoft's servers timed out — retry shortly (HTTP 504).", category: "service", retryable: true },
};

// Core mapping — returns a plain, serializable verdict object.
export function mapGraphError(err) {
  const code = err && err.code ? String(err.code) : null;
  const status = err && err.status != null ? Number(err.status) : null;
  const entry = (code && CODE_MAP[code]) || (status != null && STATUS_MAP[status]) || null;
  const friendly = entry
    ? entry.friendly
    : defaultFriendly(err, code, status);
  return {
    code: code || (status != null ? "http_" + status : "unknown"),
    status,
    friendly,
    category: (entry && entry.category) || "unknown",
    hint: (entry && entry.hint) || "",
    retryable: !!(entry && entry.retryable) || status === 429 || status === 503 || status === 504,
  };
}

// Fallback friendly message when no rule matches: reuse the raw Graph message
// (cleaned up) so nothing is lost, but still flag it as unmapped.
function defaultFriendly(err, code, status) {
  const raw = err && (err.message || (err.body && err.body.error && err.body.error.message) || (err.body && err.body.error && err.body.error.code) || "");
  const cleaned = String(raw).replace(/^ms365\.graph:\s*/, "").trim();
  const suffix = status != null ? " (HTTP " + status + ")" : "";
  if (cleaned) return cleaned + suffix;
  return "Microsoft Graph request failed" + (code ? " — " + code : "") + suffix + ".";
}

// Attach the friendly mapping to an Error (mutates and returns the same
// instance so existing fields like .code/.status/.body are preserved).
export function toFriendlyError(err) {
  let e = err;
  if (!(e instanceof Error)) {
    e = new Error(String((err && err.message) || err));
    if (err && typeof err === "object") {
      if (err.code !== undefined) e.code = err.code;
      if (err.status !== undefined) e.status = err.status;
      if (err.body !== undefined) e.body = err.body;
    }
  }
  const mapped = mapGraphError(e);
  if (!("friendly" in e)) e.friendly = mapped.friendly;
  if (!("category" in e)) e.category = mapped.category;
  if (!("hint" in e)) e.hint = mapped.hint;
  e.mapped = mapped;
  return e;
}

// Convenience: format a mapped error for display (friendly + hint).
export function formatFriendlyError(err) {
  const mapped = err && err.mapped ? err.mapped : mapGraphError(err);
  let out = mapped.friendly;
  if (mapped.hint) out += "\n" + mapped.hint;
  return out;
}
