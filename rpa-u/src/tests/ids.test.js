import { suite, test, assert, assertEquals, assertMatch } from "./harness.js";
import { slugify, normalizeDomain, normalizeEmail, makeId, isCanonicalId, tokenSimilarity } from "../core/ids.js";

suite("Identifier primitives", () => {
  test("slugify normalises names", () => {
    assertEquals(slugify("Alder & Finch Bookkeeping"), "alder-and-finch-bookkeeping");
    assertEquals(slugify("Tomás Álvarez"), "tomas-alvarez");
    assertEquals(slugify("  --Hello, World!-- "), "hello-world");
  });

  test("normalizeDomain strips scheme, www and path", () => {
    assertEquals(normalizeDomain("HTTPS://WWW.NorthwindDental.com/path?x=1"), "northwinddental.com");
    assertEquals(normalizeDomain("northwinddental.com."), "northwinddental.com");
    assertEquals(normalizeDomain(""), "");
  });

  test("normalizeEmail lowercases and trims", () => {
    assertEquals(normalizeEmail("  Dana@NorthwindDental.COM "), "dana@northwinddental.com");
  });

  test("makeId is deterministic and prefixed", () => {
    assertEquals(makeId("co", "domain:northwinddental.com"), makeId("co", "domain:northwinddental.com"));
    assert(makeId("co", "a") !== makeId("co", "b"), "different keys should hash differently");
    assertMatch(makeId("co", "domain:x"), /^co_[0-9a-z]{7}$/);
  });

  test("isCanonicalId validates prefixes", () => {
    assert(isCanonicalId("co_1abc234"));
    assert(isCanonicalId("ct_1abc234", "ct"));
    assert(!isCanonicalId("xx_1abc234"));
    assert(!isCanonicalId("co_"));
  });

  test("tokenSimilarity compares names", () => {
    assert(tokenSimilarity("Ironwood Mfg.", "Ironwood Manufacturing") >= 0.5);
    assertEquals(tokenSimilarity("Northwind Dental", "Blue Harbor"), 0);
  });
});
