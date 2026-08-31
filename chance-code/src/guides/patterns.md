# Patterns cookbook — copy-paste recipes for Perchance userscripts

All recipes assume the standard scaffold: an IIFE with 'use strict', run inside
the generator iframe (`@match https://*.perchance.org/*`). Adjust selectors to
the target generator.

## 1. Wait for content (generators render asynchronously)
```js
function waitFor(sel, ms = 8000) {
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
// await waitFor('#output');
```

## 2. Re-roll the generator
```js
// Preferred: click the generator's own button.
const btn = await waitFor('button');
if (btn) btn.click();

// Or call the engine directly (it is a global in the iframe):
if (typeof window.update === 'function') window.update();
// update(elId) re-runs just one element's blocks.
```

## 3. Read the current output
```js
const out = document.querySelector('#output');
if (out) console.log(out.textContent); // use textContent, never innerText
```
`innerText` on an element that CONTAINS a perchance square block doubles the
text (known engine issue).

## 4. React when a generator re-renders
```js
function onOutputChange(el, cb) {
  const mo = new MutationObserver(() => cb(el));
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  return mo;
}
onOutputChange(out, () => console.log('new output:', out.textContent));
```

## 5. Call a public API (cross-origin, needs @connect)
```js
// @grant GM_xmlhttpRequest   +   @connect perchance.org
function perchanceApi(path, query) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://perchance.org/api/' + path + (query ? '?' + new URLSearchParams(query) : ''),
      onload: (r) => {
        try { resolve(r.status < 400 ? JSON.parse(r.responseText) : { error: r.status }); }
        catch (e) { resolve({ error: 'bad json' }); }
      },
      onerror: reject,
    });
  });
}
// const stats = await perchanceApi('getGeneratorStats', { name: 'animal' });
// const src  = await perchanceApi('getGeneratorsAndDependencies', { generatorNames: 'animal' });
```
Useful endpoints: `getGeneratorStats?name=x`, `downloadGenerator?generatorName=x`
(`&listsOnly=true`), `getGeneratorHtml?generatorName=x`,
`getGeneratorsAndDependencies?generatorNames=a,b`, `getGeneratorScreenshot?generatorName=x`,
`getGeneratorList?max=123&tags=x`.

## 6. Persist data between page loads
```js
// @grant GM_getValue  @grant GM_setValue
const KEY = 'myData';
let data = (GM_getValue(KEY) || '[]');
// ... GM_setValue(KEY, JSON.stringify(data));
```

## 7. Inject styled UI
```js
// @grant GM_addStyle
GM_addStyle(`
  #pc-panel { position: fixed; bottom: 16px; right: 16px; z-index: 99999;
    background: #222; color: #fff; padding: 10px 14px; border-radius: 10px;
    font: 13px sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
  #pc-panel button { margin-left: 8px; }
`);
const panel = document.createElement('div');
panel.id = 'pc-panel';
panel.innerHTML = '<span>Perchance helper</span><button id="pc-reroll">Reroll</button>';
document.body.appendChild(panel);
panel.querySelector('#pc-reroll').onclick = () => window.update && window.update();
```

## 8. Drive the generator's own data (root)
```js
// root is a global in the iframe — the whole perchance tree.
if (typeof root !== 'undefined') {
  // read a random fully-evaluated item from a list named 'animal':
  const a = root.animal.selectOne.evaluateItem;
  // get all items as strings:
  const all = root.animal.selectAll.map((n) => n.evaluateItem);
}
```
Note: bare list names (`animal.selectOne`) only work inside classic inline
`<script>` tags — in a userscript always go through `root`.

## 9. Seeded, deterministic re-rolls
```js
// The engine uses Math.random() for everything. Wrap it for seeds:
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Math.random = mulberry32(12345);  // then update() is deterministic
```
