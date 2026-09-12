// ============================================================================
// quote-u — mail send-as-rep permission (roadmap task 48)
// ----------------------------------------------------------------------------
// Quote-link delivery is mail sent AS THE REP'S OWN MAILBOX. There is no shared
// mailbox and no additional mailbox license: the app is granted ONE
// application permission, scoped to the sales-users group, and may only send
// as the mailbox of a user who is a member of that group — and only that
// user's OWN mailbox.
//
// The permission model (pure, testable):
//
//   permission    "Mail.Send"   an APPLICATION permission (one grant for the
//                                app, not a delegated per-user consent);
//   scope_group   "sales"        the group the permission is scoped to. A
//                                sender who is not a member is refused.
//   send_as       "own_mailbox"  the from address must equal the sending user's
//                                own directory mailbox.
//   allow_shared  false          a shared mailbox (sales@, info@, quotes@) can
//                                never be the sender.
//
// The gate is enforced in the mail connector (the gateway boundary) so EVERY
// path that delivers mail is subject to it, not only the send pipeline. This
// is the "no shared mailbox / no extra license" rule made executable: the
// permission can only ever speak as the one mailbox that already belongs to
// the person doing the sending. A delivery ran through the app's own client
// (the `mailto:` transport) still lands in the audit log, so "the user's own
// client" is not a blind spot.
// ============================================================================
window.QU_MAIL = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const PERMISSION = "Mail.Send";
  const SCOPE_GROUP = "sales";
  const SEND_AS = "own_mailbox";
  const DOC = "mail_permission";

  // The default directory maps an internal actor id to the mailbox that belongs
  // to that person and the group they are a member of. It mirrors the mail
  // connector's rep directory; the connector seed carries the same `group`.
  const DEFAULT_DIRECTORY = Object.freeze([
    Object.freeze({ actor: "rep1", name: "Alex Rivera", mailbox: "alex.rivera@example.com", group: "sales" }),
    Object.freeze({ actor: "rep2", name: "Jordan Blake", mailbox: "jordan.blake@example.com", group: "sales" }),
    Object.freeze({ actor: "ops1", name: "Priya Raman", mailbox: "priya.raman@example.com", group: "operations" })
  ]);

  // Shared mailboxes are explicitly known and always refused, so a permission
  // grant can never be widened to a mailbox nobody personally owns.
  const DEFAULT_SHARED_MAILBOXES = Object.freeze([
    "sales@example.com", "info@example.com", "quotes@example.com", "noreply@example.com"
  ]);

  const CODES = Object.freeze([
    "unknown_sender", "not_in_scope", "shared_mailbox_forbidden", "not_own_mailbox", "sender_required"
  ]);

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normMailbox(v) {
    return String(v === undefined || v === null ? "" : v).trim().toLowerCase();
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function splitList(v) {
    if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
    if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
    return [];
  }

  // Normalize the policy from main.pjs `quoteMailPolicy`. Scalars only, so the
  // pjs square block stays trivial; the directory/shared list may be supplied
  // by the caller (otherwise the code defaults are used).
  function normalizePolicy(input, opts) {
    opts = opts || {};
    const p = isPlainObject(input) ? input : {};
    const shared = splitList(p.shared_mailboxes).concat(splitList(opts.shared_mailboxes));
    const directory = Array.isArray(opts.directory) ? opts.directory.slice() : DEFAULT_DIRECTORY.map(r => Object.assign({}, r));
    return {
      permission: p.permission ? String(p.permission) : PERMISSION,
      scope_group: p.scope_group ? String(p.scope_group) : SCOPE_GROUP,
      send_as: p.send_as ? String(p.send_as) : SEND_AS,
      allow_shared: p.allow_shared === true,
      shared_mailboxes: (shared.length ? shared : DEFAULT_SHARED_MAILBOXES.slice()).map(normMailbox),
      directory
    };
  }

  function isSharedMailbox(mailbox, policy) {
    const m = normMailbox(mailbox);
    if (!m) return false;
    if (policy && policy.allow_shared === true) return false;
    const shared = (policy && policy.shared_mailboxes) || [];
    return shared.map(normMailbox).indexOf(m) !== -1;
  }

  function normalizeDirectory(directory) {
    return (Array.isArray(directory) ? directory : []).map((r, i) => ({
      actor: String((r && (r.actor || r.id)) || ("rep" + (i + 1))),
      name: String((r && r.name) || ""),
      mailbox: normMailbox(r && r.mailbox),
      group: String((r && r.group) || "sales")
    })).filter(r => r.mailbox);
  }

  function createService(opts) {
    opts = opts || {};
    const clock = opts.clock || null;
    const store = opts.store || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy, { directory: opts.directory, shared_mailboxes: opts.shared_mailboxes });
    const directory = normalizeDirectory(policy.directory);
    let grant = null;

    function find(actor) {
      const want = normMailbox(actor);
      if (!want) return null;
      return directory.find(r => normMailbox(r.actor) === want || normMailbox(r.name) === want || r.mailbox === want) || null;
    }
    function findMailbox(mailbox) {
      const want = normMailbox(mailbox);
      if (!want) return null;
      return directory.find(r => r.mailbox === want) || null;
    }

    // The application permission grant. One grant, scoped to the sales group.
    function describeGrant() {
      return {
        permission: policy.permission,
        scope_group: policy.scope_group,
        send_as: policy.send_as,
        shared_allowed: policy.allow_shared === true,
        mode: "application",
        granted_at: grant && grant.granted_at ? grant.granted_at : null,
        members: directory.filter(r => r.group === policy.scope_group).map(r => ({ actor: r.actor, name: r.name, mailbox: r.mailbox }))
      };
    }

    // Persist the grant record once (durable, read back on reload).
    async function ensureGrant() {
      if (!store || typeof store.saveDoc !== "function") { grant = grant || { permission: policy.permission, scope_group: policy.scope_group, granted_at: nowIso(clock) }; return { ok: true, grant: describeGrant() }; }
      try {
        const loaded = await store.loadDoc(DOC);
        const content = loaded && loaded.ok ? loaded.content : null;
        if (content && content.grant) {
          grant = content.grant;
          return { ok: true, grant: describeGrant(), loaded: true };
        }
        grant = { permission: policy.permission, scope_group: policy.scope_group, send_as: policy.send_as, shared_allowed: policy.allow_shared === true, granted_at: nowIso(clock) };
        const base = (loaded && loaded.ok && typeof loaded.revision === "number") ? loaded.revision : 0;
        const saved = await store.saveChecked(DOC, { records: [], grant }, { expectedBase: base });
        if (!saved || !saved.ok) return { ok: false, code: saved && saved.code ? saved.code : "grant_save_failed", detail: saved && saved.detail ? saved.detail : "the grant document could not be saved" };
        return { ok: true, grant: describeGrant() };
      } catch (e) {
        return { ok: false, code: "grant_save_failed", detail: (e && e.message) || String(e) };
      }
    }

    function isInScope(actor) {
      const rep = find(actor);
      return !!rep && rep.group === policy.scope_group;
    }

    // The one gate. `{ actor, from, to }` -> a grant or a refusal. Every mail
    // path calls this before a message may leave.
    function authorize(input) {
      input = input || {};
      const from = normMailbox(input.from);
      if (!from) return refusal("sender_required", "An outbound email must be sent from the rep's own mailbox.");
      const rep = find(input.actor) || findMailbox(from);
      if (!rep) {
        return refusal("unknown_sender", "The sender is not in the mail directory, so no mailbox belongs to them.");
      }
      if (rep.group !== policy.scope_group) {
        return refusal("not_in_scope", `The "${policy.permission}" permission is scoped to the "${policy.scope_group}" group; ${rep.actor} is in "${rep.group}".`);
      }
      if (isSharedMailbox(from, policy)) {
        return refusal("shared_mailbox_forbidden", `Mail must be sent as the rep's own mailbox, not the shared mailbox ${from}.`);
      }
      if (from !== rep.mailbox) {
        return refusal("not_own_mailbox", `Mail must be sent as ${rep.mailbox} (the sender's own mailbox), not ${from}.`);
      }
      return {
        ok: true,
        permission: policy.permission,
        scope_group: policy.scope_group,
        mode: "send_as_rep",
        actor: rep.actor,
        name: rep.name,
        mailbox: rep.mailbox,
        to: normMailbox(input.to)
      };
    }

    function refusal(code, detail) {
      return { ok: false, code: code, detail: detail, permission: policy.permission, scope_group: policy.scope_group };
    }

    // The effective grant for one actor (used by the UI + the mail guard).
    function grantFor(actor) {
      const rep = find(actor);
      if (!rep) return refusal("unknown_sender", `No mailbox is mapped to "${actor}".`);
      return authorize({ actor: rep.actor, from: rep.mailbox });
    }

    function directoryList() { return directory.map(r => Object.assign({}, r)); }

    function verify() {
      const violations = [];
      if (!policy.permission) violations.push({ code: "no_permission", detail: "A permission name is required." });
      if (!policy.scope_group) violations.push({ code: "no_scope_group", detail: "The permission must be scoped to a group." });
      if (policy.send_as !== "own_mailbox") violations.push({ code: "bad_send_as", detail: "The only supported send-as mode is the sender's own mailbox." });
      if (policy.allow_shared) violations.push({ code: "shared_allowed", detail: "A shared mailbox must never be selectable as the sender." });
      const members = directory.filter(r => r.group === policy.scope_group);
      if (!members.length) violations.push({ code: "no_members", detail: "No directory member belongs to the permission's scope group." });
      return { ok: violations.length === 0, violations, grant: describeGrant() };
    }

    async function ready() {
      const g = await ensureGrant();
      const v = verify();
      return { ok: g.ok && v.ok, grant: g.grant, violations: v.violations, code: g.ok ? null : g.code };
    }

    return {
      ready,
      policy: () => JSON.parse(JSON.stringify(Object.assign({}, policy, { directory: undefined }))),
      grant: describeGrant,
      grantFor,
      authorize,
      isInScope,
      isSharedMailbox: m => isSharedMailbox(m, policy),
      mailboxOf: actor => { const r = find(actor); return r ? r.mailbox : null; },
      directory: directoryList,
      verify
    };
  }

  return {
    VERSION,
    PERMISSION,
    SCOPE_GROUP,
    SEND_AS,
    DOC,
    DEFAULT_DIRECTORY,
    DEFAULT_SHARED_MAILBOXES,
    CODES,
    normalizePolicy,
    normalizeDirectory,
    isSharedMailbox,
    createService
  };
})();
