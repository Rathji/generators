// ============================================================================
// quote-u — portal event capture (roadmap task 26)
// ----------------------------------------------------------------------------
// The portal records WHAT the client saw and changed, so the audit trail is
// complete end to end: opening a link emits a `viewed` event, and each change
// to the option selection emits an `option_changed` event. Both carry the token
// ID, the resolved client IP and the user agent — and NEVER the token secret
// (the audit log refuses any secret-shaped field on its own, a second belt).
//
// The events land in the existing append-only `quote_events` log through
// QU_AUDIT, so they inherit its hash-chain tamper evidence and its
// portal-needs-a-token rule. This service adds only the portal-specific policy:
//
//   • dedup — a token records ONE `viewed` event no matter how many times the
//     page is opened, and an `option_changed` event only when the selection
//     actually differs from the last one recorded for that token, so a
//     chatty UI cannot bury the log in noise;
//   • bounded metadata — a long user agent is truncated, the IP is trimmed, so
//     a hostile client cannot write an unbounded blob into the log.
//
// The client half is pure; the service half is a thin, best-effort wrapper that
// never throws into the request path (an audit failure must not break a read).
// ============================================================================
window.QU_PORTALEVENTS = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const VIEWED = "viewed";
  const OPTION_CHANGED = "option_changed";
  const MAX_IP_LEN = 64;
  const MAX_UA_LEN = 300;
  const MAX_SELECTION = 2000;

  const PORTAL_EVENTS = Object.freeze([VIEWED, OPTION_CHANGED]);

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function clampText(v, max) {
    if (v === undefined || v === null) return null;
    let s;
    if (typeof v === "string") s = v;
    else s = String(v);
    s = s.trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  // Bounded request metadata — never the secret.
  function cleanMeta(ctx) {
    ctx = ctx || {};
    return {
      ip: clampText(ctx.ip, MAX_IP_LEN),
      user_agent: clampText(ctx.user_agent !== undefined ? ctx.user_agent : ctx.userAgent, MAX_UA_LEN)
    };
  }

  // A selection as an order-independent set of string line ids. Anything that
  // is not an array is an empty selection; over-long input is capped so a
  // hostile payload cannot blow up the record.
  function selectionOf(selection) {
    if (!Array.isArray(selection)) return [];
    const seen = Object.create(null);
    const out = [];
    for (let i = 0; i < selection.length && out.length < MAX_SELECTION; i++) {
      const v = selection[i];
      if (v === undefined || v === null) continue;
      const s = String(v);
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    out.sort();
    return out;
  }

  function sameSelection(a, b) {
    const x = selectionOf(a);
    const y = selectionOf(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  // The audit input for one portal event. `kind` is viewed | option_changed.
  function eventFor(kind, input, ctx) {
    input = input || {};
    const meta = cleanMeta(ctx || input);
    const base = {
      quote_id: input.quote_id === undefined ? null : input.quote_id,
      version_id: input.version_id === undefined ? null : input.version_id,
      event: kind,
      actor_type: "portal",
      actor: input.actor === undefined ? "client" : String(input.actor),
      token_id: input.token_id === undefined ? null : input.token_id,
      ip: meta.ip,
      user_agent: meta.user_agent
    };
    if (kind === VIEWED) {
      base.detail = { token_id: base.token_id, first_view: true };
    } else {
      const selection = selectionOf(input.selection);
      base.detail = {
        token_id: base.token_id,
        selection,
        count: selection.length
      };
    }
    return base;
  }

  function createService(opts) {
    opts = opts || {};
    const audit = opts.audit || null;

    function noAudit() {
      return { ok: true, skipped: true, detail: "no audit service attached" };
    }

    async function records(versionId, event) {
      if (!audit || typeof audit.forVersion !== "function") return [];
      const r = await audit.forVersion(versionId, event ? { event } : undefined);
      return r && r.ok ? r.records : [];
    }

    // Has this exact token already produced a `viewed` event?
    async function alreadyViewed(versionId, tokenId) {
      const recs = await records(versionId, VIEWED);
      return recs.some(r => r && String(r.token_id) === String(tokenId));
    }

    // The last option_changed selection recorded for this token, or null.
    async function lastSelection(versionId, tokenId) {
      const recs = await records(versionId, OPTION_CHANGED);
      for (let i = recs.length - 1; i >= 0; i--) {
        const r = recs[i];
        if (r && String(r.token_id) === String(tokenId)) {
          return (r.detail && Array.isArray(r.detail.selection)) ? r.detail.selection : [];
        }
      }
      return null;
    }

    // Record the first open of a link by a token. Returns { ok, duplicate }.
    async function viewed(input, ctx) {
      if (!audit || typeof audit.append !== "function") return noAudit();
      input = input || {};
      try {
        if (input.version_id && await alreadyViewed(input.version_id, input.token_id)) {
          return { ok: true, duplicate: true };
        }
        const res = await audit.append(eventFor(VIEWED, input, ctx || input));
        return { ok: res.ok !== false, duplicate: false, record: res.record || null, code: res.code };
      } catch (e) {
        return { ok: false, code: "event_failed", detail: (e && e.message) || String(e) };
      }
    }

    // Record a change to the option selection. Skips an unchanged selection.
    async function optionChanged(input, ctx) {
      if (!audit || typeof audit.append !== "function") return noAudit();
      input = input || {};
      try {
        const previous = input.version_id ? await lastSelection(input.version_id, input.token_id) : null;
        if (previous !== null && sameSelection(previous, input.selection)) {
          return { ok: true, duplicate: true };
        }
        const res = await audit.append(eventFor(OPTION_CHANGED, input, ctx || input));
        return { ok: res.ok !== false, duplicate: false, record: res.record || null, code: res.code };
      } catch (e) {
        return { ok: false, code: "event_failed", detail: (e && e.message) || String(e) };
      }
    }

    // The portal events for a version (viewed + option_changed), in order.
    async function history(versionId, filter) {
      if (!audit || typeof audit.forVersion !== "function") return { ok: true, events: [], total: 0 };
      const r = await audit.forVersion(versionId, filter);
      if (!r.ok) return r;
      const events = r.records.filter(rec => rec && PORTAL_EVENTS.indexOf(rec.event) !== -1);
      return { ok: true, events, total: events.length, revision: r.revision };
    }

    // A compact per-token summary: first view, last view, option-change count.
    async function summary(versionId) {
      const h = await history(versionId);
      if (!h.ok) return h;
      const byToken = {};
      for (const r of h.events) {
        const id = String(r.token_id);
        const e = byToken[id] || (byToken[id] = { token_id: r.token_id, viewed_at: null, last_viewed_at: null, view_count: 0, option_changes: 0, last_selection: null });
        if (r.event === VIEWED) {
          e.view_count++;
          if (!e.viewed_at) e.viewed_at = r.at;
          e.last_viewed_at = r.at;
        } else if (r.event === OPTION_CHANGED) {
          e.option_changes++;
          if (r.detail && Array.isArray(r.detail.selection)) e.last_selection = r.detail.selection;
        }
      }
      return { ok: true, version_id: versionId, tokens: byToken, events: h.events.length };
    }

    return { VERSION, history, summary, viewed, optionChanged, alreadyViewed, lastSelection };
  }

  return {
    VERSION,
    VIEWED,
    OPTION_CHANGED,
    PORTAL_EVENTS,
    MAX_IP_LEN,
    MAX_UA_LEN,
    MAX_SELECTION,
    clampText,
    cleanMeta,
    selectionOf,
    sameSelection,
    eventFor,
    createService
  };
})();
