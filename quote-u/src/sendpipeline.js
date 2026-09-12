// ============================================================================
// quote-u — send pipeline & expiry/staleness policy (roadmap tasks 18–19)
// ----------------------------------------------------------------------------
// Sending a quote is an ORDERED, FAILURE-AWARE operation. The order is the
// whole design: every read-only check runs first, then the irreversible /
// externally-visible steps run in an order that can never leave a half-sent
// quote, and a failure compensates what it can:
//
//   1. preflight (read-only)      — quote, version, contact, rep mailbox,
//                                   sendable state, and the staleness policy
//   2. freeze                     — the ONLY transition into the frozen state;
//                                   also mints price provenance (task 17)
//   3. mint a portal token        — hash-only at rest; the secret exists only
//                                   long enough to build the link
//   4. deliver by email           — sent AS THE REP'S OWN MAILBOX, through the
//                                   connector gateway (mail / activity bus)
//   5. mark the quote sent        — status=sent + sent_version_id + token id +
//                                   expiry, ONLY after the link was delivered
//
// Invariants this guarantees:
//   • a sent quote always has a valid (non-revoked, unexpired) portal link,
//     because status is flipped last and only after delivery succeeds;
//   • a failure before step 5 leaves the quote unsent (never half-sent): the
//     freshly-minted token is revoked and the frozen version is left as a
//     harmless frozen draft, so a retry resumes from step 3;
//   • stale pricing is never sent silently: preflight reports every cost
//     snapshot older than the policy's `stale_cost_days` and step 1 refuses
//     unless the caller explicitly acknowledges it.
// ============================================================================
window.QU_SEND = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFAULT_POLICY = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: "" };
  const SENDABLE_STATES = ["draft", "internal_review"];
  const UNSENDABLE_STATUSES = { sent: true, approved: true, declined: true, expired: true };

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function ms(at) {
    if (at === undefined || at === null) return Date.now();
    if (typeof at === "number") return at;
    const t = Date.parse(at);
    return isNaN(t) ? Date.now() : t;
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    const expiry = Number(p.expiry_days);
    const stale = Number(p.stale_cost_days);
    return {
      expiry_days: Number.isFinite(expiry) && expiry >= 0 ? expiry : DEFAULT_POLICY.expiry_days,
      stale_cost_days: Number.isFinite(stale) && stale >= 0 ? stale : DEFAULT_POLICY.stale_cost_days,
      default_from_mailbox: p.default_from_mailbox === undefined ? "" : String(p.default_from_mailbox)
    };
  }

  function expiryFrom(at, expiryDays) {
    const days = Number(expiryDays);
    if (!Number.isFinite(days) || days < 0) return null;
    return new Date(ms(at) + days * 86400000).toISOString();
  }

  // Which cost snapshots behind this version's lines are older than the policy
  // window? Pure given { lines, snapshots } — the service loads them.
  function staleLines(input) {
    input = input || {};
    const lines = input.lines || [];
    const snapshots = input.snapshots || {};
    const maxAgeDays = input.stale_cost_days === undefined ? DEFAULT_POLICY.stale_cost_days : Number(input.stale_cost_days);
    const at = ms(input.now);
    const out = [];
    lines.forEach(line => {
      if (!line || !line.price_snapshot_ref) return;
      const snap = snapshots[String(line.price_snapshot_ref)];
      if (!snap || !snap.captured_at) return;
      const captured = Date.parse(snap.captured_at);
      if (isNaN(captured)) return;
      const ageDays = (at - captured) / 86400000;
      if (ageDays > maxAgeDays) {
        out.push({
          line_id: line.id,
          snapshot_id: snap.id,
          description: line.description || "",
          captured_at: snap.captured_at,
          age_days: Math.round(ageDays * 10) / 10,
          source: snap.source || null
        });
      }
    });
    return out;
  }

  // The email delivered to the client. Plain text; the link is the only way in.
  function composeEmail(input) {
    input = input || {};
    const quote = input.quote || {};
    const version = input.version || {};
    const company = quote.company_name || "there";
    const number = quote.quote_number ? quote.quote_number + " — " : "";
    const title = quote.title || "your quote";
    const subject = "Your quote " + (quote.quote_number || title);
    const lines = [];
    lines.push("Hi " + (input.contact_name || company) + ",");
    lines.push("");
    lines.push("Please find your quote " + number + "\"" + title + "\" ready for review.");
    lines.push("");
    lines.push("View it online: " + input.link);
    if (input.expires_at) lines.push("This link is valid until " + String(input.expires_at).slice(0, 10) + ".");
    lines.push("");
    lines.push("You can review the line items, choose any options that apply, and approve or decline online.");
    lines.push("");
    lines.push("Thanks,");
    lines.push(input.from_name || input.from || "");
    return {
      to: input.to || "",
      from: input.from || "",
      subject,
      body: lines.join("\n"),
      link: input.link || null,
      version_id: version.id || null
    };
  }

  function createService(opts) {
    opts = opts || {};
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const portalTokens = opts.portalTokens || null;
    const priceSnapshots = opts.priceSnapshots || null;
    const gateway = opts.gateway || null;
    const audit = opts.audit || null;
    const clock = opts.clock || null;
    const policyInput = opts.policy || null;
    const generatorName = opts.generatorName || null;
    const features = opts.features || null;
    const advisory = opts.advisory || null;

    // The operational-flag gate (roadmap task 38). When `require_internal_review`
    // is on, a version that never passed through `internal_review` cannot be
    // sent. `features` may be the QU_FEATURES service (with .config()) or a raw
    // feature config object.
    function sendGate(version) {
      const F = window.QU_FEATURES;
      if (!F || typeof F.sendGate !== "function") return { ok: true };
      const cfg = features && typeof features.config === "function" ? features.config() : features;
      return F.sendGate(cfg, { version: version });
    }

    function policy() { return normalizePolicy(policyInput); }

    // The version's immutability switch. Uses the version module's own pure
    // predicate when present so the two cannot drift.
    function isFrozenVersion(version) {
      if (window.QU_VERSIONS && typeof window.QU_VERSIONS.isFrozen === "function") return window.QU_VERSIONS.isFrozen(version);
      return !!(version && typeof version.frozen_at === "string" && version.frozen_at.length > 0);
    }

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      return audit.append(input);
    }

    function scopeOf(ctx) {
      if (ctx && ctx.scope !== undefined) return ctx.scope;
      return (typeof window !== "undefined" && window.root && window.root.quoteAccessScope) || "*";
    }

    // The rep's own mailbox — resolved through the gateway's rep directory,
    // falling back to the policy's default sender.
    async function resolveRep(actor, ctx) {
      let rep = null;
      if (gateway && typeof gateway.call === "function") {
        const res = gateway.call("mail", "resolveRep", { actor: actor || "" }, { scope: scopeOf(ctx) });
        if (res.ok) rep = res.result;
      }
      const p = policy();
      const mailbox = (rep && rep.mailbox) || p.default_from_mailbox || "";
      return { rep, mailbox: mailbox ? String(mailbox) : "", source: rep ? "directory" : (p.default_from_mailbox ? "policy" : "none") };
    }

    // Every cost snapshot behind a version, keyed by snapshot id, plus the
    // staleness verdict. Loads nothing when no price-snapshot service is wired.
    async function staleness(versionId, o) {
      o = o || {};
      const p = policy();
      const maxAge = o.stale_cost_days === undefined ? p.stale_cost_days : Number(o.stale_cost_days);
      const l = await versions.listLines(versionId);
      if (!l.ok) return l;
      const snapshots = {};
      if (priceSnapshots && typeof priceSnapshots.get === "function") {
        const ids = Array.from(new Set(l.lines.filter(x => x && x.price_snapshot_ref).map(x => String(x.price_snapshot_ref))));
        for (const id of ids) {
          const g = await priceSnapshots.get(id);
          if (g.ok && g.snapshot) snapshots[id] = g.snapshot;
        }
      }
      const stale = staleLines({ lines: l.lines, snapshots, stale_cost_days: maxAge, now: o.now });
      return { ok: true, stale, count: stale.length, stale_cost_days: maxAge, lines: l.lines, snapshots };
    }

    // Read-only. Blockers stop the send; warnings inform it.
    async function preflight(quoteId, versionId, ctx) {
      ctx = ctx || {};
      const p = policy();
      const blockers = [];
      const warnings = [];
      if (!quotes || !versions || !portalTokens) {
        return { ok: false, code: "not_configured", detail: "The send pipeline needs the quotes, versions and portal-token services.", blockers: [{ code: "not_configured" }], warnings };
      }
      const qres = await quotes.getQuote(quoteId, ctx);
      if (!qres.ok) return qres;
      if (!qres.quote) return { ok: false, code: "quote_not_found", detail: `No quote ${quoteId} in scope.`, blockers: [{ code: "quote_not_found" }], warnings };
      const quote = qres.quote;

      const vres = await versions.getVersion(versionId);
      if (!vres.ok) return vres;
      if (!vres.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.`, blockers: [{ code: "version_not_found" }], warnings };
      const version = vres.version;
      if (version.quote_id !== quoteId) return { ok: false, code: "version_mismatch", detail: "That version belongs to a different quote.", blockers: [{ code: "version_mismatch" }], warnings };

      if (UNSENDABLE_STATUSES[quote.status]) {
        const supersedes = ctx.allowSupersede === true && quote.sent_version_id && String(quote.sent_version_id) !== String(version.id);
        if (supersedes) {
          warnings.push({ code: "supersedes_prior", detail: `This quote is currently "${quote.status}" as version ${quote.sent_version_id}. Sending this version supersedes it — a fresh link is issued and the prior link revoked.` });
        } else {
          blockers.push({ code: "already_sent", detail: `This quote is already "${quote.status}". Revise it to send a new version, or resend the link.` });
        }
      }
      if (!isFrozenVersion(version) && SENDABLE_STATES.indexOf(version.state) === -1) {
        blockers.push({ code: "not_sendable", detail: `A version in state "${version.state}" cannot be sent.` });
      }
      if (!quote.contact_email) blockers.push({ code: "no_contact_email", detail: "The contact has no email address to send the link to." });

      const sg = sendGate(version);
      if (!sg.ok) blockers.push({ code: sg.code, detail: sg.detail });

      const rep = await resolveRep(ctx.actor, ctx);
      if (!rep.mailbox) blockers.push({ code: "no_rep_mailbox", detail: "Could not resolve the sending rep's mailbox — set a sender or add the rep to the mailbox directory." });
      if (rep.source === "policy" && rep.mailbox) warnings.push({ code: "rep_not_found", detail: `No rep matched "${ctx.actor || "(none)"}" in the mailbox directory; using the policy sender ${rep.mailbox}.` });

      const stale = await staleness(versionId, { now: ctx.at });
      if (!stale.ok) return stale;
      if (stale.count) {
        warnings.push({ code: "stale_costs", detail: `${stale.count} cost snapshot(s) are older than ${p.stale_cost_days} days; sending requires acknowledging stale pricing.` });
      }

      // Task 55: non-blocking advisory completeness checks. They never add a
      // blocker — a rep may deliberately send an incomplete quote — but they are
      // reported so the builder can surface them before the send.
      let advisories = [];
      let advisoryCounts = null;
      if (advisory && typeof advisory.run === "function") {
        try {
          const gr = await versions.listGroups(versionId);
          const a = advisory.run({
            line_items: stale.lines,
            option_groups: gr && gr.ok ? gr.groups : [],
            snapshots: stale.snapshots,
            stale_cost_days: p.stale_cost_days,
            now: ctx.at
          });
          advisories = a.advisories || [];
          advisoryCounts = a.counts || null;
          if (a.advisory_count) {
            warnings.push({ code: "advisories", detail: (advisory.summarize ? advisory.summarize(a) : `${a.advisory_count} advisory item(s).`) });
          }
        } catch (e) { /* advisories are best-effort and never block */ }
      }

      return {
        ok: blockers.length === 0,
        code: blockers.length ? blockers[0].code : null,
        detail: blockers.length ? blockers[0].detail : "",
        blockers,
        warnings,
        advisories,
        advisory_counts: advisoryCounts,
        stale: stale.stale,
        stale_cost_days: p.stale_cost_days,
        expiry_days: p.expiry_days,
        rep,
        quote,
        version,
        policy: p
      };
    }

    // The ordered send. See the module header for the ordering guarantees.
    async function send(quoteId, versionId, ctx) {
      ctx = ctx || {};
      const p = policy();
      const steps = [];
      const pre = await preflight(quoteId, versionId, ctx);
      if (!pre.ok) return pre;
      if (pre.stale.length && ctx.acknowledgeStale !== true) {
        return {
          ok: false,
          code: "stale_costs",
          detail: `${pre.stale.length} cost snapshot(s) are older than ${p.stale_cost_days} days. Acknowledge stale pricing to send, or re-capture the costs.`,
          stale: pre.stale,
          advisories: pre.advisories || [],
          warnings: pre.warnings,
          steps
        };
      }
      const quote = pre.quote;
      let version = pre.version;

      // 1. freeze (mints price provenance first — task 17).
      let frozen = version;
      if (!isFrozenVersion(version)) {
        const fr = await versions.freeze(version.id, { actor: ctx.actor, at: ctx.at, mintSource: ctx.mintSource });
        if (!fr.ok) return { ok: false, step: "freeze", code: fr.code, detail: fr.detail, steps, pre };
        frozen = fr.version;
        steps.push({ step: "freeze", ok: true, seal: fr.seal, authority: fr.authority, minted: fr.mint ? fr.mint.count : 0 });
      } else {
        steps.push({ step: "freeze", ok: true, skipped: "already_frozen" });
      }

      // 2. mint the portal token. Any token left by a partial prior attempt is
      //    revoked first (we cannot reconstruct an old link from its hash).
      const active = await portalTokens.activeForVersion(frozen.id, ctx.at);
      if (!active.ok) return { ok: false, step: "token", code: active.code, detail: active.detail, steps, pre };
      if (active.token) {
        const rv = await portalTokens.revoke(active.token.id, { actor: ctx.actor });
        steps.push({ step: "token_revoked", ok: rv.ok, token_id: active.token.id, reason: "reissue" });
      }
      const expires_at = expiryFrom(frozen.frozen_at || ctx.at, p.expiry_days);
      const m = await portalTokens.mint({
        quote_id: quoteId,
        version_id: frozen.id,
        created_by: ctx.actor || "",
        expires_at,
        single_use: false,
        label: ctx.label || (quote.quote_number || quote.title || "")
      });
      if (!m.ok) return { ok: false, step: "token", code: m.code, detail: m.detail, steps, pre };
      const token = m.token;
      const secret = m.secret;
      steps.push({ step: "token", ok: true, token_id: token.id, expires_at });
      const link = portalTokens.linkFor(secret, generatorName);

      async function compensate(reason) {
        try { await portalTokens.revoke(token.id, { actor: ctx.actor || "system" }); } catch (e) {}
        await auditAppend({
          quote_id: quoteId, version_id: frozen.id, event: "link_revoked",
          actor_type: "system", actor: ctx.actor || "system",
          detail: { reason: "send_failed", at_step: reason, token_id: token.id }
        });
      }

      // 3. deliver the link by email, as the rep's own mailbox.
      const rep = pre.rep;
      const from = rep.mailbox;
      const email = composeEmail({
        quote,
        version: frozen,
        contact_name: quote.contact_name,
        link,
        from,
        from_name: (rep.rep && rep.rep.name) || ctx.actor || "",
        expires_at
      });
      const dres = gateway && typeof gateway.call === "function"
        ? gateway.call("mail", "send", {
            to: quote.contact_email,
            from,
            actor: ctx.actor || "",
            subject: email.subject,
            body: email.body,
            link,
            quote_id: quoteId,
            version_id: frozen.id,
            company_id: quote.company_id,
            transport: ctx.transport || "log"
          }, { scope: scopeOf(ctx), confirm: { by: ctx.actor || from, note: "send quote link " + quoteId } })
        : { ok: false, code: "no_gateway", detail: "No connector gateway is configured." };
      if (!dres.ok) {
        await compensate("deliver");
        return { ok: false, step: "deliver", code: dres.code || "delivery_failed", detail: dres.detail || "The email could not be delivered.", steps, pre, token_id: token.id };
      }
      const message = dres.result || {};
      steps.push({ step: "deliver", ok: true, message_id: message.id || null, to: quote.contact_email, from });
      await auditAppend({
        quote_id: quoteId, version_id: frozen.id, event: "email_sent",
        actor_type: "internal", actor: ctx.actor || "system",
        detail: { action: "quote_email_sent", to: quote.contact_email, from, message_id: message.id || null, token_id: token.id }
      });

      // 4. mark the quote sent — ONLY now that the link is delivered and valid.
      // Any PRIOR sent version's link is superseded by this one and revoked
      // after the flip (a revision re-issues the link; the old one dies).
      const priorVersionId = quote.sent_version_id && String(quote.sent_version_id) !== String(frozen.id) ? String(quote.sent_version_id) : null;
      const upd = await quotes.updateQuote(quoteId, {
        status: "sent",
        sent_at: message.sent_at || nowIso(clock),
        sent_version_id: frozen.id,
        portal_token_id: token.id,
        expires_at,
        delivered_to: quote.contact_email,
        delivered_from: from,
        stale_cost_days: p.stale_cost_days,
        stale_costs: pre.stale.map(s => s.snapshot_id),
        stale_acknowledged: pre.stale.length > 0
      });
      if (!upd.ok) {
        return {
          ok: false,
          step: "mark_sent",
          code: upd.code,
          detail: (upd.detail || "The quote could not be marked sent.") + " The link was delivered — retry to finish marking it sent.",
          recoverable: true,
          steps,
          pre,
          token_id: token.id,
          link
        };
      }
      steps.push({ step: "mark_sent", ok: true });

      // 5. supersede the prior sent version's link, if this send replaced one.
      const revokedPrior = [];
      if (priorVersionId) {
        const prior = await portalTokens.listForVersion(priorVersionId);
        if (prior.ok) {
          for (const t of prior.tokens) {
            if (t.revoked_at) continue;
            const rv = await portalTokens.revoke(t.id, { actor: ctx.actor || "system" });
            if (rv.ok) revokedPrior.push(t.id);
          }
        }
        if (revokedPrior.length) {
          steps.push({ step: "revoke_prior", ok: true, prior_version_id: priorVersionId, token_ids: revokedPrior });
          await auditAppend({
            quote_id: quoteId, version_id: frozen.id, event: "link_revoked",
            actor_type: "system", actor: ctx.actor || "system",
            detail: { reason: "superseded_by_revision", prior_version_id: priorVersionId, token_ids: revokedPrior }
          });
        }
      }

      await auditAppend({
        quote_id: quoteId, version_id: frozen.id, event: "sent",
        actor_type: "internal", actor: ctx.actor || "system",
        detail: { token_id: token.id, expires_at, delivered_to: quote.contact_email, delivered_from: from, stale_costs: pre.stale.length }
      });
      return { ok: true, quote: upd.quote, version: frozen, token_id: token.id, link, message_id: message.id || null, expires_at, stale: pre.stale, advisories: pre.advisories || [], advisory_counts: pre.advisory_counts || null, superseded_version_id: priorVersionId, revoked_prior: revokedPrior, steps };
    }

    // Re-issue the link for a quote already sent: revoke the old token and mint
    // a fresh one (the old secret cannot be recovered from its hash), then email
    // the new link. Never changes the frozen version.
    async function resend(quoteId, ctx) {
      ctx = ctx || {};
      const p = policy();
      const qres = await quotes.getQuote(quoteId, ctx);
      if (!qres.ok) return qres;
      if (!qres.quote) return { ok: false, code: "quote_not_found", detail: `No quote ${quoteId} in scope.` };
      const quote = qres.quote;
      const versionId = ctx.versionId || quote.sent_version_id;
      if (!versionId) return { ok: false, code: "not_sent", detail: "This quote has no sent version to resend." };
      const vres = await versions.getVersion(versionId);
      if (!vres.ok) return vres;
      if (!vres.version) return { ok: false, code: "version_not_found", detail: `No quote version ${versionId}.` };
      if (!isFrozenVersion(vres.version)) return { ok: false, code: "not_frozen", detail: "The sent version is not frozen — refuse to resend an editable version." };
      if (!quote.contact_email) return { ok: false, code: "no_contact_email", detail: "The contact has no email address." };

      const stale = await staleness(versionId, { now: ctx.at });
      if (!stale.ok) return stale;
      if (stale.count && ctx.acknowledgeStale !== true) {
        return { ok: false, code: "stale_costs", detail: `${stale.count} cost snapshot(s) are older than ${p.stale_cost_days} days. Acknowledge stale pricing to resend.`, stale: stale.stale };
      }

      const rep = await resolveRep(ctx.actor, ctx);
      if (!rep.mailbox) return { ok: false, code: "no_rep_mailbox", detail: "Could not resolve the sending rep's mailbox." };

      const steps = [];
      const prior = await portalTokens.listForVersion(versionId);
      if (prior.ok) {
        for (const t of prior.tokens) {
          if (!t.revoked_at) {
            await portalTokens.revoke(t.id, { actor: ctx.actor });
            steps.push({ step: "token_revoked", ok: true, token_id: t.id });
          }
        }
      }
      const expires_at = expiryFrom(nowIso(clock), p.expiry_days);
      const m = await portalTokens.mint({ quote_id: quoteId, version_id: versionId, created_by: ctx.actor || "", expires_at, label: quote.quote_number || quote.title || "" });
      if (!m.ok) return { ok: false, step: "token", code: m.code, detail: m.detail, steps };
      steps.push({ step: "token", ok: true, token_id: m.token.id, expires_at });
      const link = portalTokens.linkFor(m.secret, generatorName);

      const email = composeEmail({
        quote, version: vres.version, contact_name: quote.contact_name, link, from: rep.mailbox,
        from_name: (rep.rep && rep.rep.name) || ctx.actor || "", expires_at
      });
      const dres = gateway && typeof gateway.call === "function"
        ? gateway.call("mail", "send", {
            to: quote.contact_email, from: rep.mailbox, actor: ctx.actor || "", subject: email.subject, body: email.body, link,
            quote_id: quoteId, version_id: versionId, company_id: quote.company_id, transport: ctx.transport || "log"
          }, { scope: scopeOf(ctx), confirm: { by: ctx.actor || rep.mailbox, note: "resend quote link " + quoteId } })
        : { ok: false, code: "no_gateway", detail: "No connector gateway is configured." };
      if (!dres.ok) {
        await portalTokens.revoke(m.token.id, { actor: ctx.actor || "system" });
        return { ok: false, step: "deliver", code: dres.code || "delivery_failed", detail: dres.detail || "The email could not be delivered.", steps };
      }
      const message = dres.result || {};
      steps.push({ step: "deliver", ok: true, message_id: message.id || null });
      const upd = await quotes.updateQuote(quoteId, {
        sent_at: message.sent_at || nowIso(clock),
        portal_token_id: m.token.id,
        expires_at,
        delivered_to: quote.contact_email,
        delivered_from: rep.mailbox
      });
      if (!upd.ok) return { ok: false, step: "mark_sent", code: upd.code, detail: upd.detail, recoverable: true, steps, token_id: m.token.id, link };
      steps.push({ step: "resend", ok: true });
      await auditAppend({
        quote_id: quoteId, version_id: versionId, event: "link_revoked",
        actor_type: "internal", actor: ctx.actor || "system",
        detail: { reason: "link_reissued", token_id: m.token.id }
      });
      return { ok: true, quote: upd.quote, version: vres.version, token_id: m.token.id, link, message_id: message.id || null, expires_at, steps };
    }

    // Revise-after-send (roadmap task 21): create the new version AND re-issue
    // the link in one ordered operation — revise the sent (frozen) version into
    // a fresh draft, send it (which supersedes the prior link and revokes it),
    // and leave the prior version + its events untouched and read-only for
    // audit. On a send failure the revision draft remains for the rep to retry;
    // the prior link is only revoked once the new one is delivered.
    async function reissue(quoteId, versionId, ctx) {
      ctx = ctx || {};
      const steps = [];
      const qres = await quotes.getQuote(quoteId, ctx);
      if (!qres.ok) return qres;
      if (!qres.quote) return { ok: false, code: "quote_not_found", detail: `No quote ${quoteId} in scope.`, steps };
      const quote = qres.quote;
      const sourceId = versionId || quote.sent_version_id;
      if (!sourceId) return { ok: false, code: "not_sent", detail: "This quote has no sent version to revise.", steps };
      const vres = await versions.getVersion(sourceId);
      if (!vres.ok) return vres;
      if (!vres.version) return { ok: false, code: "version_not_found", detail: `No quote version ${sourceId}.`, steps };
      if (!isFrozenVersion(vres.version)) return { ok: false, code: "not_frozen", detail: "Only a frozen/sent version is revised into a new one.", steps };

      const rev = await versions.revise(sourceId, { actor: ctx.actor, at: ctx.at });
      if (!rev.ok) return { ok: false, step: "revise", code: rev.code, detail: rev.detail, steps };
      steps.push({ step: "revise", ok: true, revised_from: sourceId, version_id: rev.version.id, version_number: rev.version.version_number });

      const sent = await send(quoteId, rev.version.id, Object.assign({}, ctx, { allowSupersede: true }));
      if (!sent.ok) {
        return Object.assign({}, sent, { revised_from: sourceId, revision: rev.version, steps: steps.concat(sent.steps || []) });
      }
      return {
        ok: true,
        revised_from: sourceId,
        revision: rev.version,
        version: sent.version,
        link: sent.link,
        token_id: sent.token_id,
        expires_at: sent.expires_at,
        superseded_version_id: sent.superseded_version_id || null,
        revoked_prior: sent.revoked_prior || [],
        steps: steps.concat(sent.steps || [])
      };
    }

    // Revoke a quote's active portal link(s) without touching the frozen version.
    async function revokeLinks(quoteId, ctx) {
      ctx = ctx || {};
      const l = await portalTokens.listForQuote(quoteId);
      if (!l.ok) return l;
      const revoked = [];
      for (const t of l.tokens) {
        if (t.revoked_at) continue;
        const r = await portalTokens.revoke(t.id, { actor: ctx.actor });
        if (r.ok) revoked.push(t.id);
      }
      if (revoked.length) {
        await auditAppend({
          quote_id: quoteId, event: "link_revoked", actor_type: "internal", actor: ctx.actor || "system",
          detail: { reason: ctx.reason || "revoked_by_rep", token_ids: revoked }
        });
      }
      return { ok: true, revoked, count: revoked.length };
    }

    // Has this quote's link expired? Pure read against the quote + its token.
    async function linkState(quote, at) {
      if (!quote || !quote.portal_token_id) return { ok: true, state: "none" };
      const g = await portalTokens.getById(quote.portal_token_id);
      if (!g.ok) return g;
      if (!g.token) return { ok: true, state: "missing" };
      return { ok: true, state: portalTokens.statusOf(g.token, at), token: g.token };
    }

    function ready() { return Promise.resolve({ ok: true }); }

    return {
      ready,
      policy,
      staleness,
      preflight,
      send,
      resend,
      reissue,
      revokeLinks,
      linkState,
      resolveRep
    };
  }

  return {
    VERSION,
    DEFAULT_POLICY,
    SENDABLE_STATES,
    normalizePolicy,
    expiryFrom,
    staleLines,
    composeEmail,
    createService
  };
})();
