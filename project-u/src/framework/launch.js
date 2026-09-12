// ============================================================================
//  Project U — member launch logic (Phase 2, tasks 6-9)
//  The single place that turns a Member Registry entry into an action: resolve
//  it, deep-link to its registered top-level URL, record it as the launcher's
//  active member, and copy its shareable link. Views stay declarative — they
//  call `launchMember` / `markActiveMember` and never build URLs themselves.
// ============================================================================

import { getMember, memberUrl } from "./members.js";

// Accepts an id, a slug, or a member object; always returns a registry entry
// (or null) so callers can never launch something that isn't registered.
export function resolveMember(member) {
  if (!member) return null;
  if (typeof member === "string") return getMember(member);
  if (typeof member === "object") return getMember(member.id || member.slug);
  return null;
}

export function isLaunchable(member) {
  const resolved = resolveMember(member);
  return Boolean(resolved && resolved.slug);
}

// The registered, shareable top-level URL for a member (never a subdomain).
export function memberLink(member) {
  const resolved = resolveMember(member);
  return resolved ? memberUrl(resolved) : null;
}

// Record which member the launcher currently has in focus. Kept separate from
// launching so an anchor (which the browser navigates itself) can still update
// the active state without opening a second tab.
export function markActiveMember(member, options = {}) {
  const { state = null } = options;
  const resolved = resolveMember(member);
  if (resolved && state && typeof state.setActiveMember === "function") state.setActiveMember(resolved.id);
  return resolved;
}

export function clearActiveMember(options = {}) {
  const { state = null } = options;
  if (state && typeof state.clearActiveMember === "function") state.clearActiveMember();
}

// Launch a member generator: mark it active, then open its registered URL.
// `open` is injectable so callers (and tests) control how the tab is opened.
export function launchMember(member, options = {}) {
  const {
    state = null,
    open = (url) => (typeof window !== "undefined" ? window.open(url, "_blank", "noopener,noreferrer") : null),
    newTab = true,
  } = options;
  const resolved = resolveMember(member);
  if (!resolved) {
    const label = member && (member.id || member.slug || member);
    return { ok: false, member: null, url: null, error: label ? `unknown member "${label}"` : "no member given" };
  }
  const url = memberUrl(resolved);
  if (state && typeof state.setActiveMember === "function") state.setActiveMember(resolved.id);
  if (!newTab) return { ok: true, member: resolved, url, opened: null };
  let opened = null;
  try {
    opened = open(url, resolved);
  } catch (error) {
    return { ok: false, member: resolved, url, error: error && error.message ? error.message : String(error) };
  }
  return { ok: true, member: resolved, url, opened };
}

// Last-resort copy for contexts without the async Clipboard API (older
// browsers, some embeds). Stays inside the framework so callers don't care.
function legacyCopy(text) {
  if (typeof document === "undefined") return false;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    document.body.removeChild(area);
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}

// Copy a member's shareable link to the clipboard. Returns a plain result so
// the caller owns any user feedback (toast, etc.).
export async function copyMemberLink(member, options = {}) {
  const {
    clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null,
    fallback = true,
  } = options;
  const resolved = resolveMember(member);
  if (!resolved) return { ok: false, member: null, url: null, error: "unknown member" };
  const url = memberUrl(resolved);
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(url);
      return { ok: true, member: resolved, url };
    } catch (_) {
      // fall through to the legacy path
    }
  }
  if (fallback && legacyCopy(url)) return { ok: true, member: resolved, url };
  return { ok: false, member: resolved, url, error: "clipboard unavailable" };
}
