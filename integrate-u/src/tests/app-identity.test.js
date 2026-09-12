import { suite, test, assert, assertEquals, assertMatch } from "./harness.js";
import { getConfig, readMeta, isKebabCase, normalizeConfig, DEFAULT_CONFIG } from "../framework/config.js";

suite("App identity", () => {
  test("generator name is kebab-case", () => {
    assert(isKebabCase(window.generatorName), `generatorName "${window.generatorName}" is not kebab-case`);
  });

  test("appId is kebab-case", () => {
    assert(isKebabCase(getConfig().appId), `appId "${getConfig().appId}" is not kebab-case`);
  });

  test("appId tracks the generator name", () => {
    assertEquals(getConfig().appId, window.generatorName);
  });

  test("display identity is present", () => {
    const c = getConfig();
    assert(c.appTitle.trim().length >= 3, "appTitle is too short");
    assert(c.appShortTitle.trim().length >= 1, "appShortTitle is empty");
    assert(c.logoMark.trim().length >= 1, "logoMark is empty");
    assert(c.tagline.trim().length >= 8, "tagline is too short");
  });

  test("version is semver", () => {
    assertMatch(getConfig().version, /^\d+\.\d+\.\d+$/);
  });

  test("storage namespace is scoped to the app", () => {
    const c = getConfig();
    assertMatch(c.storageNamespace, /^[a-z0-9-]+$/);
    assert(c.storageNamespace.startsWith("pu-"), "namespace should be prefixed with pu-");
    assert(c.storageNamespace.includes(c.appId), "namespace should include the appId");
  });

  test("branding colours are valid hex", () => {
    const b = getConfig().branding;
    assertMatch(b.primary, /^#[0-9a-f]{6}$/i);
    assertMatch(b.accent, /^#[0-9a-f]{6}$/i);
    assert(b.fontSans.trim().length >= 2, "fontSans is empty");
  });

  test("$meta.title is set", () => {
    const meta = readMeta();
    assert(meta.title.length >= 3, `$meta.title missing (got "${meta.title}")`);
    assert(meta.title.includes(getConfig().appTitle), "$meta.title should name the app");
  });

  test("$meta.description is descriptive", () => {
    const meta = readMeta();
    assert(meta.description.length >= 80, `$meta.description too short (got ${meta.description.length} chars)`);
  });

  test("config falls back to safe defaults for bad input", () => {
    const c = normalizeConfig({ appId: "Not Kebab Case", version: "" });
    assertEquals(c.appId, DEFAULT_CONFIG.appId);
    assertEquals(c.version, DEFAULT_CONFIG.version);
    assertEquals(c.branding.primary, DEFAULT_CONFIG.branding.primary);
  });
});
