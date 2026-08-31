# Quickstart — your first Perchance userscript

A userscript is a small JavaScript file that your browser runs automatically on
matching pages. Tampermonkey is the manager that installs and runs them.

## Step 1 — Install Tampermonkey
- Chrome / Edge: install "Tampermonkey" from the Chrome Web Store.
- Firefox: install "Tampermonkey" from the Firefox Add-ons site.
- Safari: "Tampermonkey" from the App Store.

## Step 2 — Get a script
Either:
1. Use the **Script Builder** tab on this page to generate one for your goal, or
2. Copy a pattern from `patterns.md` in the reference library, or
3. Start from the template in `userscript-template.js`.

## Step 3 — Install it
- Tampermonkey dashboard → "Create a new script" → replace everything with the
  script you generated → Ctrl+S to save.
- Or save the `.user.js` file and open it in your browser (Tampermonkey shows an
  install page). Drag-and-drop onto the dashboard works too.

## Step 4 — Understand the anatomy

```
// ==UserScript==          <- metadata block (must be exactly this)
// @name         My Script
// @match        https://*.perchance.org/*   <- which pages to run on
// @run-at       document-idle               <- when to run (after load)
// @grant        GM_addStyle                 <- APIs you may use
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      perchance.org               <- allows cross-origin API calls
// @noframes                                 <- only the top frame of a page
// ==/UserScript==

(function () {             <- IIFE: keeps your variables out of the page
  'use strict';

  function waitFor(sel, ms = 8000) {   // generator content appears async
    return new Promise((res) => {
      const t = Date.now();
      const poll = () => {
        const el = document.querySelector(sel);
        if (el) return res(el);
        if (Date.now() - t > ms) return res(null);
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  async function main() {            // your actual logic
    const out = await waitFor('#output');
    if (out) console.log('output is:', out.textContent);
  }

  main();
})();
```

Key facts about the metadata:
- `@match https://*.perchance.org/*` runs the script INSIDE the generator iframe
  (the subdomain origin). This is where `root` and `update()` live.
- Do NOT use `@match https://perchance.org/*` alone — that's the wrapper page,
  cross-origin from the generator, and you cannot reach the generator DOM from it.
- `@grant GM_xmlhttpRequest` + `@connect perchance.org` lets you call
  `perchance.org/api/...` (those APIs are cross-origin from the iframe; plain
  `fetch()` fails CORS there).
- `@noframes` keeps the script from also running inside any nested iframes.

## Step 5 — Test it
Open any Perchance generator page (or its editor preview). Tampermonkey's icon
shows a counter of running scripts. Check the DevTools console (F12) for your
log lines. Re-edit the script in the Tampermonkey dashboard — saving re-runs it.

## What to learn next
- `patterns.md` — copy-paste recipes (wait, re-roll, read output, react to
  re-renders, call APIs, persist data, inject UI, seed randomness).
- `faq.md` — the most common problems and their fixes.
- `kb.js` — the full platform reference (architecture, execution model, APIs,
  the 12 engine gotchas, plugin directory).
- External: the official Perchance tutorial (perchance.org/tutorial), examples
  (perchance.org/examples), and plugin directory (perchance.org/plugins).
