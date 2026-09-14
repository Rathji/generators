// src/mail/mailbox-query.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const resolveMailboxPath = (...a) => ms365Api().mail.query.resolveMailboxPath(...a);
export const searchEmails = (...a) => ms365Api().mail.query.searchEmails(...a);
export const listInbox = (...a) => ms365Api().mail.query.listInbox(...a);
export const getMessage = (...a) => ms365Api().mail.query.getMessage(...a);
export const normalizeMessage = (...a) => ms365Api().mail.query.normalizeMessage(...a);
