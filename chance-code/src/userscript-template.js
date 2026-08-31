// tinker-chance base Tampermonkey template.
// The AI fills in the __PLACEHOLDER__ sections. Keep the scaffold robust.
window.TAMPER_TEMPLATE = `
// ==UserScript==
// @name         __SCRIPT_NAME__
// @namespace    __SCRIPT_NAMESPACE__
// @version      0.1
// @description  __SCRIPT_DESCRIPTION__
// @author       You
// @match        https://*.perchance.org/*
// @run-at       __RUN_AT__
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      perchance.org
// @connect      *.perchance.org
__EXTRA_MATCHES____EXTRA_GRANTS____EXTRA_CONNECTS__
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ===== CONFIG =====
  const CFG = __CONFIG_JSON__;

  // ===== STYLES (injected UI) =====
  GM_addStyle(\`
__STYLES__
\`);

  // ===== STORAGE HELPERS =====
  function save(key, val) { GM_setValue(key, JSON.stringify(val)); }
  function load(key, def) {
    try { const v = GM_getValue(key); return v === undefined ? def : JSON.parse(v); }
    catch (e) { return def; }
  }

  // ===== CROSS-ORIGIN API =====
  // Perchance's public APIs live on perchance.org, which is cross-origin to the
  // generator iframe — plain fetch() fails CORS here. GM_xmlhttpRequest bypasses it.
  function perchanceApi(path, query) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://perchance.org/api/' + path + (query ? '?' + new URLSearchParams(query) : ''),
        onload: (r) => {
          try { resolve(r.status >= 200 && r.status < 300 ? JSON.parse(r.responseText) : { error: r.status }); }
          catch (e) { resolve({ error: 'bad json', raw: r.responseText }); }
        },
        onerror: (e) => reject(e),
      });
    });
  }

  // ===== WAIT / OBSERVE =====
  // Generators build their DOM asynchronously. Poll for a sentinel before acting.
  function waitFor(selectorOrFn, timeoutMs = 15000, intervalMs = 100) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const target = typeof selectorOrFn === 'function'
          ? selectorOrFn()
          : document.querySelector(selectorOrFn);
        if (target) return resolve(target);
        if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  // React to the generator re-rendering (update() swaps the output's textContent).
  function onOutputChange(el, cb) {
    const mo = new MutationObserver(() => cb(el));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return mo;
  }

  __HELPERS__

  // ===== MAIN =====
  async function main() {
    __MAIN__
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { main().catch(console.error); });
  } else {
    main().catch(console.error);
  }
})();
`;
