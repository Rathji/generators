// src/mail/calendar-sync.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const listUpcomingEvents = (...a) => ms365Api().mail.calendar.listUpcomingEvents(...a);
export const getEvent = (...a) => ms365Api().mail.calendar.getEvent(...a);
export const createEvent = (...a) => ms365Api().mail.calendar.createEvent(...a);
export const buildEventBody = (...a) => ms365Api().mail.calendar.buildEventBody(...a);
export const normalizeEvent = (...a) => ms365Api().mail.calendar.normalizeEvent(...a);
