// src/graph/error-mapper.test.js
// Validation suite for the Error Mapping Engine.
// Run via ?test=error, or: await (await import("src/graph/error-mapper.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep } from "../test-helpers.js";
import * as em from "./error-mapper.js";
import * as g from "./graph-client.js";

const { test, runAll } = makeSuite();
export { runAll };

test("mapGraphError: known Graph code → friendly message + category", () => {
  const m = em.mapGraphError({ code: "AccessDenied", status: 403 });
  assertEq(m.category, "permission");
  assert(/permission/i.test(m.friendly), "friendly mentions permission");
  assert(m.hint.length > 0, "hint present");
  assertEq(m.code, "AccessDenied");
  assertEq(m.status, 403);
});

test("mapGraphError: camelCase code variant also maps", () => {
  const m = em.mapGraphError({ code: "accessDenied" });
  assertEq(m.category, "permission");
});

test("mapGraphError: status fallback when code unknown", () => {
  const m = em.mapGraphError({ code: "SomeWeirdCode", status: 503 });
  assertEq(m.category, "service");
  assert(m.retryable, "503 retryable");
});

test("mapGraphError: unknown code + no status → graceful default", () => {
  const m = em.mapGraphError({ code: "mystery", message: "something odd" });
  assertEq(m.category, "unknown");
  assert(!m.retryable);
  assert(/something odd/i.test(m.friendly), "default reuses raw message");
});

test("mapGraphError: throttle codes are retryable", () => {
  for (const code of ["TooManyRequests", "ActivityLimitReached", "ThrottledRequests"]) {
    const m = em.mapGraphError({ code });
    assertEq(m.category, "throttle", code + " → throttle");
    assert(m.retryable, code + " retryable");
  }
});

test("mapGraphError: mail-specific codes", () => {
  assertEq(em.mapGraphError({ code: "MailboxNotEnabledForRESTAPI" }).category, "mailbox");
  assertEq(em.mapGraphError({ code: "MessageTooBig" }).category, "mailbox");
  assertEq(em.mapGraphError({ code: "RecipientNotFound" }).category, "mailbox");
});

test("mapGraphError: file-specific codes", () => {
  assertEq(em.mapGraphError({ code: "NameAlreadyExists" }).category, "files");
  assertEq(em.mapGraphError({ code: "QuotaLimitReached" }).category, "files");
  assertEq(em.mapGraphError({ code: "MalwareDetected" }).category, "files");
});

test("toFriendlyError: attaches friendly fields, preserves error fields", () => {
  const err = new Error("ms365.graph: nope");
  err.code = "AccessDenied"; err.status = 403; err.isGraphError = true;
  const out = em.toFriendlyError(err);
  assertEq(out, err, "same instance returned");
  assertEq(out.code, "AccessDenied");
  assertEq(out.status, 403);
  assertEq(out.isGraphError, true);
  assert(/permission/i.test(out.friendly));
  assertEq(out.category, "permission");
  assert(out.hint.length > 0);
  assert(out.mapped, "mapped verdict attached");
});

test("toFriendlyError: non-Error input becomes an Error", () => {
  const out = em.toFriendlyError({ code: "not_found", message: "gone" });
  assert(out instanceof Error);
  assertEq(out.category, "not_found");
});

test("formatFriendlyError: friendly + hint combined", () => {
  const err = new Error("x"); err.code = "AccessDenied";
  const s = em.formatFriendlyError(err);
  assert(/permission/i.test(s), "friendly included");
  assert(/admin/i.test(s), "hint included");
});

test("integration: graphRequest 403 error carries friendly mapping", async () => {
  const { makeEnv } = await import("../test-helpers.js");
  makeEnv({ routes: { "/me": { status: 403, payload: { error: { code: "accessDenied", message: "Nope." } } } } });
  try {
    await g.graphGet("/me");
    assert(false, "should have thrown");
  } catch (e) {
    assertEq(e.status, 403);
    assertEq(e.category, "permission");
    assert(/permission/i.test(e.friendly));
  }
});

test("integration: graphRequest not_authenticated maps to auth category", async () => {
  const o = await import("../auth/oauth2.js");
  o.clearSession();
  try {
    await g.graphGet("/me");
    assert(false, "should have thrown");
  } catch (e) {
    assertEq(e.code, "not_authenticated");
    assertEq(e.category, "auth");
    assert(/signed in/i.test(e.friendly));
  }
});
