// src/mail/calendar-sync.test.js
// Validation suite for the Calendar Event Sync.
// Run via ?test=calendar, or: await (await import("src/mail/calendar-sync.test.js")).runAll();

import { makeSuite, assert, assertEq, makeEnv } from "../test-helpers.js";
import * as cs from "./calendar-sync.js";

const { test, runAll } = makeSuite();
export { runAll };

const EV = {
  id: "e1", subject: "Standup", isAllDay: false, isOnlineMeeting: true,
  start: { dateTime: "2026-09-08T09:00:00", timeZone: "UTC" },
  end: { dateTime: "2026-09-08T09:30:00", timeZone: "UTC" },
  location: { displayName: "Room 42" },
  attendees: [{ emailAddress: { address: "carol@contoso.com", name: "Carol" }, type: "required", status: { response: "accepted" } }],
  organizer: { emailAddress: { address: "tester@contoso.com", name: "Test User" } },
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" },
  bodyPreview: "daily", categories: ["standup"], webLink: "https://outlook.live.com/calendar/0/",
};

test("listUpcomingEvents: filters by date range, orders asc, normalizes events", async () => {
  const env = makeEnv({ routes: { "/me/calendar/events": { payload: { value: [EV] } } } });
  const res = await cs.listUpcomingEvents({ start: "2026-09-08T00:00:00Z", end: "2026-09-10T00:00:00Z", includeAllDay: false });
  const url = env.calls.graph[0].url;
  assert(/\/me\/calendar\/events$/.test(url.split("?")[0]), "endpoint");
  assert(/start\/dateTime ge 2026-09-08T00:00:00Z/.test(decodeURIComponent(url)), "start filter");
  assert(/end\/dateTime le 2026-09-10T00:00:00Z/.test(decodeURIComponent(url)), "end filter");
  assert(/type ne 'allDay'/.test(decodeURIComponent(url)), "allDay excluded");
  assert(/start\/dateTime asc/.test(decodeURIComponent(url)), "ascending order");
  const ev = res.value[0];
  assertEq(ev.id, "e1");
  assertEq(ev.subject, "Standup");
  assertEq(ev.location.name, "Room 42");
  assertEq(ev.attendees[0].email, "carol@contoso.com");
  assertEq(ev.attendees[0].responseStatus, "accepted");
  assertEq(ev.onlineMeetingUrl, "https://teams.microsoft.com/l/meetup-join/x");
  assertEq(ev.isOnlineMeeting, true);
});

test("listUpcomingEvents: specific calendar path + subject filter", async () => {
  const env = makeEnv({ routes: { "/me/calendars/cal2/events": { payload: { value: [] } } } });
  await cs.listUpcomingEvents({ calendarId: "cal2", subject: "Plan" });
  const url = env.calls.graph[0].url;
  assert(/\/me\/calendars\/cal2\/events/.test(url.split("?")[0]));
  assert(/contains\(subject, 'Plan'\)/.test(decodeURIComponent(url)));
});

test("createEvent: posts dateTimeTimeZone start/end + attendees", async () => {
  const env = makeEnv({ routes: { "/me/calendar/events": { payload: { ...EV, id: "new1" } } } });
  const ev = await cs.createEvent({
    subject: "Planning",
    start: new Date("2026-09-10T14:00:00Z"),
    end: new Date("2026-09-10T15:00:00Z"),
    attendees: ["dev@contoso.com", { name: "PM", address: "pm@contoso.com", type: "optional" }],
    location: "Room 1",
    body: "Agenda here",
  });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assertEq(body.subject, "Planning");
  assertEq(body.start.dateTime, "2026-09-10T14:00:00Z");
  assertEq(body.end.dateTime, "2026-09-10T15:00:00Z");
  assertEq(body.start.timeZone, "UTC");
  assertEq(body.attendees.length, 2);
  assertEq(body.attendees[0].type, "required");
  assertEq(body.attendees[1].type, "optional");
  assertEq(body.location.displayName, "Room 1");
  assertEq(body.body.content, "Agenda here");
  assertEq(ev.id, "new1");
});

test("createEvent: all-day events become date-only", async () => {
  const env = makeEnv({ routes: { "/me/calendar/events": { payload: { id: "ad1" } } } });
  await cs.createEvent({ subject: "Day off", start: "2026-09-11T00:00:00Z", end: "2026-09-12T00:00:00Z", isAllDay: true });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assertEq(body.isAllDay, true);
  assertEq(body.start.dateTime, "2026-09-11");
  assertEq(body.end.dateTime, "2026-09-12");
});

test("createEvent: onlineMeeting flag + missing required fields throw", async () => {
  const env = makeEnv({ routes: { "/me/calendar/events": { payload: { id: "om1" } } } });
  await cs.createEvent({ subject: "Remote", start: new Date(), end: new Date(Date.now() + 3600e3), onlineMeeting: true });
  assertEq(JSON.parse(env.calls.graph[0].init.body).isOnlineMeeting, true);
  let threw = false;
  try { await cs.createEvent({ start: new Date(), end: new Date() }); } catch (e) { threw = true; }
  assert(threw, "missing subject throws");
  try { await cs.createEvent({ subject: "x" }); } catch (e) { threw = true; }
  assert(threw, "missing start/end throws");
});

test("getEvent: single event by id", async () => {
  const env = makeEnv({ routes: { "/me/events/e1": { payload: EV } } });
  const ev = await cs.getEvent("e1");
  assert(/\/me\/events\/e1/.test(env.calls.graph[0].url.split("?")[0]));
  assertEq(ev.id, "e1");
  assertEq(ev.organizer.email, "tester@contoso.com");
});

test("normalizeEvent: bare event maps to safe defaults", () => {
  const ev = cs.normalizeEvent({ id: "x" });
  assertEq(ev.subject, "(no subject)");
  assertEq(ev.start, null);
  assertEq(ev.attendees.length, 0);
  assertEq(ev.location.name, "");
  assertEq(cs.normalizeEvent(null), null);
});
