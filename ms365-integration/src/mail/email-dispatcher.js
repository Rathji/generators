// src/mail/email-dispatcher.js
// Email Dispatcher.
// Sends emails with CC/BCC, HTML or plain-text body, importance and
// attachments; also supports creating drafts and sending an existing draft.
//
// Requires scope: Mail.Send (send), Mail.ReadWrite (drafts).

import { graphPost } from "../graph/graph-client.js";
import { anyOf } from "../odata.js";

// Send an email. Options:
//   { to, cc, bcc, subject, body, html, importance, attachments, saveToSentItems, from }
//     to/cc/bcc : string address or { name, address } or array of either.
//     attachments: array of { name, mimeType, content(Blob|Uint8Array|string)|contentBytes(base64), isInline }
// Returns { ok: true }.
export async function sendEmail(opts = {}) {
  const message = buildMessage(opts);
  const payload = { message, saveToSentItems: opts.saveToSentItems !== false };
  if (opts.from) payload.message.from = { emailAddress: toAddress(opts.from) };
  await graphPost("/me/sendMail", { body: payload, fetchImpl: opts.fetchImpl });
  return { ok: true };
}

// Create a draft in the Drafts folder (not sent). Returns the created message.
export async function createDraft(opts = {}) {
  const data = await graphPost("/me/messages", { body: buildMessage(opts), fetchImpl: opts.fetchImpl });
  return data;
}

// Send an existing draft by ID. Returns { ok: true }.
export async function sendDraft(draftId, opts = {}) {
  await graphPost("/me/messages/" + encodeURIComponent(draftId) + "/send", { fetchImpl: opts.fetchImpl });
  return { ok: true };
}

export function buildMessage({ to, cc, bcc, subject, body, html, importance, from, attachments, replyTo }) {
  const m = {};
  if (subject !== undefined && subject !== null) m.subject = subject;
  if (html) m.body = { contentType: "html", content: html };
  else if (body !== undefined && body !== null) m.body = { contentType: "text", content: body };
  const toArr = anyOf(to);
  if (toArr.length) m.toRecipients = toArr.map((x) => ({ emailAddress: toAddress(x) }));
  const ccArr = anyOf(cc);
  if (ccArr.length) m.ccRecipients = ccArr.map((x) => ({ emailAddress: toAddress(x) }));
  const bccArr = anyOf(bcc);
  if (bccArr.length) m.bccRecipients = bccArr.map((x) => ({ emailAddress: toAddress(x) }));
  if (from) m.from = { emailAddress: toAddress(from) };
  const rt = anyOf(replyTo);
  if (rt.length) m.replyTo = rt.map((x) => ({ emailAddress: toAddress(x) }));
  if (importance) m.importance = importance; // low | normal | high
  if (attachments && attachments.length) {
    m.attachments = attachments.map(buildAttachment);
  }
  return m;
}

// Accepts a string ("a@b.com"), { address, name }, or { emailAddress }.
export function toAddress(v) {
  if (typeof v === "string") return { address: v, name: "" };
  if (v && typeof v === "object") {
    if (v.emailAddress) return { address: v.emailAddress.address || "", name: v.emailAddress.name || "" };
    return { address: v.address || "", name: v.name || "" };
  }
  return { address: String(v), name: "" };
}

function buildAttachment(a) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.name || "attachment",
    contentType: a.mimeType || "application/octet-stream",
    contentBytes: a.contentBytes || encodeBase64(a.content),
    isInline: !!a.isInline,
  };
}

// Convert Blob / Uint8Array / ArrayBuffer / string into base64 for
// "contentBytes" (chunked so large attachments don't blow the call stack).
export async function encodeContentToBase64(content) {
  return encodeBase64(content);
}

export function encodeBase64(content) {
  if (typeof content === "string") {
    // Plain text → base64 of the UTF-8 bytes.
    const bytes = new TextEncoder().encode(content);
    return bytesToBase64(bytes);
  }
  if (content instanceof Uint8Array) return bytesToBase64(content);
  if (content instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(content));
  if (typeof Blob !== "undefined" && content instanceof Blob) {
    throw new Error("ms365.email: Blob attachments must be converted first — call encodeContentToBase64(await blob.arrayBuffer()) or pass an ArrayBuffer/Uint8Array.");
  }
  throw new Error("ms365.email: unsupported attachment content type.");
}

function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
