// src/mail/email-dispatcher.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const sendEmail = (...a) => ms365Api().mail.send.sendEmail(...a);
export const createDraft = (...a) => ms365Api().mail.send.createDraft(...a);
export const sendDraft = (...a) => ms365Api().mail.send.sendDraft(...a);
export const buildMessage = (...a) => ms365Api().mail.send.buildMessage(...a);
export const toAddress = (...a) => ms365Api().mail.send.toAddress(...a);
export const encodeBase64 = (...a) => ms365Api().mail.send.encodeBase64(...a);
export const encodeContentToBase64 = (...a) => ms365Api().mail.send.encodeContentToBase64(...a);
