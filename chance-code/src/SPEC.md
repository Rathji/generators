# tinker-chance — Specification

An AI-powered Perchance generator for people who build tools (Tampermonkey
userscripts, browser extensions, bots, scrapers) that interact with Perchance
generators.

## Core features

### 1. Userscript builder (Tampermonkey)
- User provides: target generator (URL or name), a description of what the
  script should do, and options (run timing, whether to add a settings panel,
  whether to fetch the target generator's real source to ground the selectors).
- Output: a complete, installable `.user.js` file:
  - Correct `// ==UserScript==` metadata block (`@name`, `@namespace`,
    `@version`, `@match https://*.perchance.org/*`, `@grant`, `@connect`,
    `@run-at`, `@noframes` as appropriate).
  - Safe IIFE, strict mode, error isolation.
  - Correctly handles the iframe/subdomain architecture.
  - Uses Tampermonkey APIs (`GM_setValue`, `GM_getValue`, `GM_xmlhttpRequest`,
    `GM_addStyle`) where they solve real problems (persistence, cross-origin
    public API calls).
  - Render-wait + MutationObserver patterns for async generator content.
- Copy-to-clipboard and "Download .user.js" buttons (Blob + a[download]).
- Optional: fetch the target generator's actual source via the public
  `getGeneratorsAndDependencies` API and include it in the prompt so the AI
  writes selectors/`root` paths that actually match.

### 2. Q&A / troubleshooting assistant
- Chat-style UI. User describes a problem they're having building tools to
  interact with Perchance.
- Answers are grounded in the built-in knowledge base (src/kb.js), streamed via
  onChunk, and include working code where relevant.
- Suggestions surface the known pitfalls (iframe origins, execution order,
  innerText doubling, cross-origin APIs, etc.).

### 3. Tutorial tab (learning + reference library)
- Five-step quickstart (install Tampermonkey → get a script → install →
  understand the anatomy → test), with an inline annotated userscript anatomy.
- **Reference library** — persistent files stored under `src/` for recall and
  reference, each openable in-page (View modal), downloadable, and directly
  linkable:
  - `src/kb.js` — the platform reference / knowledge base.
  - `src/userscript-template.js` — the base Tampermonkey scaffold.
  - `src/guides/quickstart.md`, `src/guides/patterns.md`, `src/guides/faq.md`.
- **Direct links** card — official tutorial, examples, plugin directory, the
  public API endpoints (demo link + endpoint list), the Perchance community,
  and this generator's own source via the downloadGenerator API.

## Non-goals
- Not a general-purpose code generator.
- Not a way to break Perchance or other sites — helpers build UI that works
  WITH generators (userscripts the user runs on their own browser).

## Knowledge base (src/kb.js)
A single compact reference document embedded in the generator. Contents:
1. Page architecture & iframe/subdomain rules (the critical part).
2. Engine execution model & globals.
3. Selection/odds/list-tree API essentials.
4. Public HTTP APIs + CORS reality from the subdomain.
5. Engine gotchas (the 12 known pitfalls).
6. Plugin directory (short descriptions).
7. Tampermonkey technique patterns (waiting, observers, GM APIs, framing).

## Prompt design (prefix-cache friendly)
- Static prefix: system prompt + full KB text. Identical for every call.
- Dynamic tail: the user's request + task instruction.
- Result: fast, accurate, cache-friendly.

## UI
- Two tabs: "Script Builder" and "Ask / Troubleshoot".
- Loading indicator while generating; streaming output.
- Responsive (phone + desktop tested).
- Dark-mode-friendly.
