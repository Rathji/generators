// src/mail/calendar-sync.js
// Calendar Event Sync.
// Retrieves upcoming events (optionally filtered by date range) and creates
// new calendar entries with specific start/end timestamps and attendee lists.
//
// Requires scope: Calendars.Read (list) / Calendars.ReadWrite (create).

import { getAllPages, graphGet, graphPost } from "../graph/graph-client.js";
import { toODataDate, toGraphDateTime, anyOf } from "../odata.js";

const EVENT_SELECT = [
  "id", "subject", "start", "end", "location", "attendees", "organizer",
  "isAllDay", "isOnlineMeeting", "onlineMeeting", "bodyPreview", "categories", "webLink",
].join(",");

function eventsPath(calendarId) {
  return calendarId ? "/me/calendars/" + encodeURIComponent(calendarId) + "/events" : "/me/calendar/events";
}

// List upcoming events. Options:
//   { start, end, max, calendarId, includeAllDay, orderBy, select }
// start/end are Date | epoch-ms | ISO string (end is exclusive).
export async function listUpcomingEvents(filters = {}, opts = {}) {
  const q = { $select: opts.select || EVENT_SELECT, $top: filters.max || opts.top || 20 };
  const order = filters.orderBy || (filters.start ? "start/dateTime asc" : "start/dateTime desc");
  q.$orderby = order;
  const parts = [];
  const after = toODataDate(filters.start);
  const before = toODataDate(filters.end);
  if (after) parts.push(`start/dateTime ge ${after}`);
  if (before) parts.push(`end/dateTime le ${before}`);
  if (filters.includeAllDay === false) parts.push("type ne 'allDay'");
  if (filters.subject) parts.push(`contains(subject, '${String(filters.subject).replace(/'/g, "''")}')`);
  if (parts.length) q.$filter = parts.join(" and ");
  const data = await getAllPages(eventsPath(filters.calendarId), {
    query: q,
    maxPages: opts.maxPages || 10,
    fetchImpl: opts.fetchImpl,
  });
  return { value: data.value.map(normalizeEvent), count: data.count, totalCount: data.totalCount };
}

// Get a single event by ID.
export async function getEvent(eventId, opts = {}) {
  const data = await graphGet("/me/events/" + encodeURIComponent(eventId), {
    query: { $select: EVENT_SELECT },
    fetchImpl: opts.fetchImpl,
  });
  return normalizeEvent(data);
}

// Create a calendar event. Options:
//   { subject, start, end, attendees, location, body, isAllDay, onlineMeeting,
//     calendarId, timeZone, importance, categories, reminders }
// start/end: Date | epoch-ms | ISO string | { dateTime, timeZone }.
export async function createEvent(opts = {}) {
  if (!opts.subject) throw new Error("ms365.calendar: `subject` is required.");
  if (opts.start == null || opts.end == null) throw new Error("ms365.calendar: `start` and `end` are required.");
  const body = buildEventBody(opts);
  const data = await graphPost(eventsPath(opts.calendarId), { body, fetchImpl: opts.fetchImpl });
  return normalizeEvent(data);
}

export function buildEventBody({ subject, start, end, attendees, location, body, isAllDay, onlineMeeting, timeZone, importance, categories }) {
  const ev = {
    subject,
    start: toGraphDateTime(start, timeZone),
    end: toGraphDateTime(end, timeZone),
  };
  if (isAllDay) {
    ev.isAllDay = true;
    // For all-day events Graph expects date-only values.
    ev.start.dateTime = ev.start.dateTime.slice(0, 10);
    ev.end.dateTime = ev.end.dateTime.slice(0, 10);
  }
  if (body !== undefined && body !== null) ev.body = { contentType: "text", content: body };
  const ats = anyOf(attendees);
  if (ats.length) {
    ev.attendees = ats.map((a) => ({
      emailAddress: a.emailAddress || (typeof a === "string" ? { address: a, name: "" } : { address: a.address || "", name: a.name || "" }),
      type: a.type || "required",
    }));
  }
  if (location) {
    ev.location = typeof location === "string" ? { displayName: location } : { displayName: location.displayName || "", address: location.address || undefined };
  }
  if (onlineMeeting) ev.isOnlineMeeting = true;
  if (importance) ev.importance = importance;
  if (categories && categories.length) ev.categories = categories;
  return ev;
}

// Map a raw Graph event to the standardized internal shape.
export function normalizeEvent(e) {
  if (!e) return null;
  return {
    id: e.id,
    subject: e.subject || "(no subject)",
    start: dateTimeTimeZone(e.start),
    end: dateTimeTimeZone(e.end),
    isAllDay: !!e.isAllDay,
    isOnlineMeeting: !!e.isOnlineMeeting,
    onlineMeetingUrl: (e.onlineMeeting && e.onlineMeeting.joinUrl) || null,
    location: { name: (e.location && e.location.displayName) || "", address: (e.location && e.location.address && e.location.address.street) || "" },
    attendees: (e.attendees || []).map((a) => ({
      email: (a.emailAddress && a.emailAddress.address) || "",
      name: (a.emailAddress && a.emailAddress.name) || "",
      type: a.type || "required",
      responseStatus: (a.status && a.status.response) || "none",
    })),
    organizer: e.organizer && e.organizer.emailAddress ? { email: e.organizer.emailAddress.address, name: e.organizer.emailAddress.name } : null,
    bodyPreview: e.bodyPreview || "",
    categories: e.categories || [],
    webLink: e.webLink || null,
  };
}

function dateTimeTimeZone(d) {
  if (!d) return null;
  return { dateTime: d.dateTime || null, timeZone: d.timeZone || "UTC" };
}
