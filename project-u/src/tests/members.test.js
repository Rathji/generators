// ============================================================================
//  Validation tests — Member Registry (Phase 1, task 2)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import { MEMBERS, listMembers, getMember, memberUrl, memberCategories, searchMembers, validateMembers } from "../framework/members.js";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-f]{6}$/i;

export function membersSuite() {
  return createSuite("members · registry")
    .test("ships the known Project U members", () => {
      for (const id of ["it-u", "crm-u", "quote-u", "psa-u", "template-u"]) {
        assert(getMember(id), `registry is missing "${id}"`);
      }
    })
    .test("ids and slugs are unique and kebab-case", () => {
      const ids = MEMBERS.map((m) => m.id);
      const slugs = MEMBERS.map((m) => m.slug);
      assertEqual(new Set(ids).size, ids.length, "ids must be unique");
      assertEqual(new Set(slugs).size, slugs.length, "slugs must be unique");
      for (const id of ids) assert(KEBAB.test(id), `id "${id}" is not kebab-case`);
      for (const slug of slugs) assert(KEBAB.test(slug), `slug "${slug}" is not kebab-case`);
    })
    .test("every member has the fields the launcher needs", () => {
      for (const member of MEMBERS) {
        assert(member.name, `${member.id}: name`);
        assert(member.description, `${member.id}: description`);
        assert(member.icon, `${member.id}: icon`);
        assert(member.category, `${member.id}: category`);
        assert(Array.isArray(member.tags) && member.tags.length, `${member.id}: tags`);
        assert(["tool", "framework"].includes(member.kind), `${member.id}: kind`);
      }
    })
    .test("accent colours are 6-digit hex", () => {
      for (const member of MEMBERS) assert(HEX.test(member.accent), `${member.id}: accent "${member.accent}"`);
    })
    .test("memberUrl always points at the top-level page (never a subdomain)", () => {
      assertEqual(memberUrl(getMember("quote-u")), "https://perchance.org/quote-u");
      assert(!memberUrl(getMember("quote-u")).includes(".perchance.org"), "must not use the iframe subdomain");
      assertEqual(memberUrl("it-u"), "https://perchance.org/it-u");
    })
    .test("listMembers filters by kind and includes/excludes the framework", () => {
      const tools = listMembers({ includeFramework: false });
      assert(tools.length >= 4, "expected several launchable tools");
      assert(tools.every((m) => m.kind === "tool"), "includeFramework:false must drop framework entries");
      assertEqual(listMembers({ kind: "framework" }).length, 1);
    })
    .test("getMember resolves by id and slug, case-insensitively", () => {
      assertEqual(getMember("quote-u").name, "Quote-U");
      assertEqual(getMember("QUOTE-U").id, "quote-u");
      assertEqual(getMember("nope"), null);
      assertEqual(getMember(""), null);
    })
    .test("searchMembers matches name, category, description and tags", () => {
      assert(searchMembers("quote").some((m) => m.id === "quote-u"), "should match by name");
      assert(searchMembers("DELIVERY").some((m) => m.id === "psa-u"), "should match by category, case-insensitively");
      assert(searchMembers("timesheets").some((m) => m.id === "psa-u"), "should match by tag");
      assertEqual(searchMembers("zzzzz").length, 0);
      assertEqual(searchMembers("").length, MEMBERS.length, "empty query returns everything");
    })
    .test("memberCategories returns unique categories in registry order", () => {
      const categories = memberCategories();
      assertEqual(new Set(categories).size, categories.length, "categories must be unique");
      assertEqual(categories[0], "Documentation");
    })
    .test("validateMembers accepts the shipped registry", () => {
      const report = validateMembers();
      assert(report.valid, `registry invalid: ${report.errors.join("; ")}`);
    })
    .test("validateMembers rejects a broken entry", () => {
      const report = validateMembers([...MEMBERS, { id: "Bad Id", slug: "quote-u", name: "", description: "", icon: "", accent: "blue", kind: "widget" }]);
      assert(!report.valid, "a malformed entry must fail validation");
      assert(report.errors.some((e) => e.includes("duplicate slug")), "duplicate slug should be reported");
    });
}
