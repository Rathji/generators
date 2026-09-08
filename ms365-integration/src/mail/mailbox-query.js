// src/mail/mailbox-query.js
// Mailbox Query Engine.
// Fetches a list of emails from the user's primary inbox (or another folder)
// filtered by sender, recipient, subject, keyword, read-state and date range,
// mapped to a standardized internal message object.
//
// Requires scope: Mail.Read (or Mail.ReadWrite for drafts/read tracking).

import { getAllPages, graphGet } from "../graph/graph-client.js";
import { escapeODataStr, toODataDate, anyOf } from "../odata.js";

const MESSAGE_SELECT = [
  "id", "subject", "from", "toRecipients", "ccRecipients", "bccRecipients",
  "body", "bodyPreview", "receivedDateTime", "sentDateTime", "importance",
  "isRead", "hasAttachments", "categories", "conversationId", "webLink", "isDraft",
].join(",");

const INBOX = "/me/mailFolders/inbox";

// folder: "inbox" (default), a mail-folder ID, or a well-known folder name.
export function resolveMailboxPath(folder) {
  if (!folder || folder === "inbox") return INBOX;
  return "/me/mailFolders/" + encodeURIComponent(folder);
}

// Search the user's mailbox with optional filters. All filters are ANDed.
//   { from, to, subject, keyword, isRead, receivedAfter, receivedBefore,
//     folder, top, skip, select }
// Returns { value: [Message...], count, totalCount }.
export async function searchEmails(filters = {}, opts = {}) {
  const q = buildMessageQuery(filters);
  const path = resolveMailboxPath(filters.folder) + "/messages";
  const data = await getAllPages(path, {
    query: q,
    maxPages: opts.maxPages || 10,
    maxRetries: opts.maxRetries,
    fetchImpl: opts.fetchImpl,
  });
  return { value: data.value.map(normalizeMessage), count: data.count, totalCount: data.totalCount };
}

// Convenience: messages in the primary inbox, newest first.
export async function listInbox(filters = {}, opts = {}) {
  return searchEmails({ ...filters, folder: "inbox" }, opts);
}

// Fetch a single message by ID (optionally expanding to the full body).
export async function getMessage(messageId, opts = {}) {
  const data = await graphGet("/me/messages/" + encodeURIComponent(messageId), {
    query: { $select: MESSAGE_SELECT },
    fetchImpl: opts.fetchImpl,
  });
  return normalizeMessage(data);
}

function buildMessageQuery(f) {
  const q = { $orderby: "receivedDateTime desc", $select: f.select || MESSAGE_SELECT };
  if (f.top) q.$top = f.top;
  if (f.skip) q.$skip = f.skip;
  const filters = [];
  const froms = anyOf(f.from);
  if (froms.length) filters.push("(" + froms.map((x) => `from/emailAddress/address eq '${escapeODataStr(x)}'`).join(" or ") + ")");
  const tos = anyOf(f.to);
  if (tos.length) filters.push("(" + tos.map((x) => `toRecipients/any(t:t/emailAddress/address eq '${escapeODataStr(x)}')`).join(" or ") + ")");
  if (f.subject) filters.push(`contains(subject, '${escapeODataStr(f.subject)}')`);
  if (f.keyword) filters.push(`(contains(subject, '${escapeODataStr(f.keyword)}') or contains(bodyPreview, '${escapeODataStr(f.keyword)}'))`);
  if (f.isRead !== undefined && f.isRead !== null) filters.push("isRead eq " + (f.isRead ? "true" : "false"));
  if (f.receivedAfter) {
    const d = toODataDate(f.receivedAfter);
    if (d) filters.push(`receivedDateTime ge ${d}`);
  }
  if (f.receivedBefore) {
    const d = toODataDate(f.receivedBefore);
    if (d) filters.push(`receivedDateTime lt ${d}`);
  }
  if (filters.length) q.$filter = filters.join(" and ");
  return q;
}

function emailAddress(holder) {
  if (!holder) return null;
  const a = holder.emailAddress || {};
  return { name: a.name || "", address: a.address || "" };
}

// Map a raw Graph message into the standardized internal shape.
export function normalizeMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    subject: m.subject || "",
    from: emailAddress(m.from),
    to: (m.toRecipients || []).map(emailAddress),
    cc: (m.ccRecipients || []).map(emailAddress),
    bcc: (m.bccRecipients || []).map(emailAddress),
    bodyPreview: m.bodyPreview || "",
    body: m.body ? { type: m.body.contentType || "text", content: m.body.content || "" } : null,
    receivedAt: m.receivedDateTime || null,
    sentAt: m.sentDateTime || null,
    importance: m.importance || "normal",
    isRead: !!m.isRead,
    isDraft: !!m.isDraft,
    hasAttachments: !!m.hasAttachments,
    categories: m.categories || [],
    conversationId: m.conversationId || null,
    webLink: m.webLink || null,
  };
}
