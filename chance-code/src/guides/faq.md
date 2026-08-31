# FAQ — common problems building tools for Perchance

## "My script matches https://perchance.org/* but I can't read the generator's DOM"
You're on the wrapper page. The generator renders inside an iframe at a
DIFFERENT origin: `https://<generatorPublicId>.perchance.org/<name>`. The
iframe is cross-origin from `perchance.org`, so same-origin rules block you.
Fix: match the subdomain so the script runs inside the generator context:
`@match https://*.perchance.org/*`. Now `document`, `root`, and `update()` are
yours.

## "CORS error when I call perchance.org/api from my userscript"
The generator iframe origin (`xxxx.perchance.org`) is cross-origin to
`perchance.org/api`, and the API does not send CORS headers. Plain `fetch()`
fails. Fix: use `GM_xmlhttpRequest` (granted via `@grant GM_xmlhttpRequest`) and
allow the host with `@connect perchance.org` (and `@connect *.perchance.org` if
needed).

## "The output text is doubled / I read the wrong text"
If you used `.innerText` on an element that contains a perchance square block,
the text doubles (a known engine issue). Use `.textContent` instead, on a child
or the element without blocks.

## "Works in the editor preview but not on the saved page"
Both the editor preview and the saved page render the generator in the same
subdomain iframe, so `@match https://*.perchance.org/*` covers both. If it fails
on the saved page only, suspect timing: the page may load slower — lengthen your
`waitFor` timeout or add a `MutationObserver`. Also check you didn't hardcode the
generator's temp/editor name; use `window.generatorName`.

## "My script runs but nothing happens"
Three usual causes:
1. The generator builds its DOM after your script's `main()` runs — you must
   `waitFor` the elements (see patterns.md #1).
2. The elements you selected don't exist — inspect the page with DevTools and
   match real selectors (use the Script Builder with "fetch target source" to
   get exact selectors/`root` paths).
3. Your code threw before touching the DOM — wrap in try/catch and `console.log`
   to trace.

## "root is not defined"
`root` is a page global, but in some script contexts (module scripts, src/
files, sandboxed userscripts with `@grant`) bare globals resolve differently.
In a userscript, read it as `window.root` / `typeof root !== 'undefined'`. Never
use bare list names (`animal.selectOne`) — always `root.animal.selectOne`.

## "GM_xmlhttpRequest is not defined"
You need `@grant GM_xmlhttpRequest` in the metadata block, and the host(s) it
talks to must be allowed with `@connect`. Tampermonkey blocks the API call
otherwise.

## "Can I run scripts on the site itself (editor, dashboards)?"
Yes, with `@match https://perchance.org/*` (and the API endpoints at
`perchance.org/api/...`). That's a different context from the generator iframe —
the site's own UI and public APIs, not `root`. Keep both matches if you need both.

## "How do I make my script only run on one generator?"
The subdomain is per-generator (`https://<publicId>.perchance.org/<name>`), and
the publicId is stable per generator. Check inside the script:
`if (window.generatorName !== 'my-target') return;`
For a hard match on a specific generator, `@match https://*.perchance.org/<name>`
(run-at does not help; the path includes the name).

## "Does the ?$csp parameter break my script?"
`?$csp` applies a Content-Security-Policy to a generator page restricting
hosts (perchance.org, *.perchance.org, user.uploads.dev, esm.sh, cdnjs...).
A userscript that calls an external host may be blocked on such pages — but only
when the user appends ?$csp themselves. You can't opt out; just note it.

## "How do I save data that the generator can also read?"
Options: `GM_setValue`/`GM_getValue` (your own userscript storage), or write to
the generator's `kv-plugin` IndexedDB (per-user, survives reloads, and the
generator can read it) — or use the upload-plugin for public text files. For a
userscript, GM_* storage is simplest.
