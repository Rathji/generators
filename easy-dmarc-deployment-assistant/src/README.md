# EasyDMARC Deployment Assistant — src/ notes

Generator: `easy-dmarc-deployment-assistant` (Perchance). An interactive 8-phase wizard for deploying
EasyDMARC email authentication (DMARC/SPF/DKIM/MTA-STS/TLS-RPT/BIMI), with DNS-provider and sending-
platform pickers, an offline Reference Library, and an AI chat grounded in official EasyDMARC material.

## What ships in src/

- `src/ref/*.html` — 464 cleaned offline copies of official EasyDMARC guides.
  Sources: support.easydmarc.com Knowledge Base (most files) and easydmarc.com/blog (120+ articles
  whose KB entries were removed from the site — the KB slugs now redirect/404, so the matching blog
  post is the canonical source). ~2 MB total. All article bodies kept; scripts/styles/classes stripped
  at fetch time. Images kept as remote URLs (they load live from HubSpot); layout reserves their
  aspect ratio via `?width=&height=` URL params.
- `src/data/kb-catalog.json` — catalog of every guide: `{categories:[{id,label,articles:[{id,title,url,src,kind,kbUrl?}]}]}`.
  `id` = file stem in src/ref, `src` = relative path into src/ref, `kind` = "kb" | "blog",
  `kbUrl` present on blog-kind entries whose KB stub still exists. 19 categories.
- `src/data/academy.json` — EasyDMARC Academy course tree: 2 Uteach-hosted courses (9 + 6 sections,
  57 lessons) with episode URLs (academy.easydmarc.com is a JS app; this is the course outline).

## How the corpus was built (rebuild recipe)

1. KB article slugs came from EasyDMARC's public KB sitemap/listing (support.easydmarc.com).
   Records of the original fetch list lived in `scratch/easydmarc/fetchlist.json` (EPHEMERAL — a
   future rebuild should re-crawl the KB listing + sitemap).
2. Each KB page was fetched through the workspace `fetch_url` proxy and saved to scratch, then the
   article HTML was extracted and cleaned into `src/ref/<slug>.html` (body content only).
3. ~120 KB slugs returned 404/redirect (articles removed from the KB). For those, the matching blog
   post was located (Google/custom search) and fetched from `https://easydmarc.com/blog/` — the blog
   WP REST API (`https://easydmarc.com/blog/wp-json/wp/v2/posts/{id}`) worked for some; others were
   fetched as rendered HTML. Saved as `src/ref/<kb-slug>.html` with `kind:"blog"` and the blog URL in
   `url`. The KB URL, when it still exists, is kept in `kbUrl`.
4. `kb-catalog.json` was assembled by a script over the fetched metadata
   (`scratch/easydmarc/blogmeta.json` etc.) with hand-curated category assignments and title/URL
   cleanups. Title/label overrides applied (all "…in 2025" style suffixes dropped, etc.).
5. ESP coverage: every article in the "source configuration" category (SPF/DKIM per sending platform)
   appears either in the curated `providers`/`sources` lists or the `more` list in `index.html`.
   The 118 extra ESP ids+names came from `scratch/easydmarc/esp-extra.json` (built from the catalog);
   3 noise entries were dropped (Microsoft "now fully respects…", Microsoft 365 "no DKIM keys…",
   Proofpoint "inbound emails…" — not platform setup guides). One renamed: episerver → Optimizely.

## App architecture (index.html)

- `window.GD` (script `#guideData`) = all static data: `{KB, providers, sources, more, phases}`.
  `providers` = 18 DNS hosts (each has a `url` — the canonical KB **or blog** guide when the KB one
  is gone, e.g. cloudflare/azure point at blog posts). `sources` = 23 curated sending platforms +
  an "other" option. `more` = the remaining ~115 ESP entries shown under "More platforms" in the
  selector. `phases` = the 8 wizard phases.
- One `<script type="module">` IIFE holds all app logic: state persisted to `root.kv.deployNav`
  (kv-plugin), wizard rendering, the chat (`ask()` builds a prompt with ASSIST_HEAD + CURRENT
  SITUATION (env/phase blocks) + optional `<OFFICIAL REFERENCE MATERIAL>` + CONVERSATION LOG),
  and the Reference Library overlay.
- Chat grounding: `groundRefs(question)` token-scores the question against catalog titles/ids
  (threshold ≥2.3, top ≤2 matches), fetches the matching `src/ref/...` bodies (cached), and includes
  a ≤2400-char text excerpt in the prompt. The article "Ask AI about this guide" button passes the
  article explicitly as a `cite`. `maybeCompact()` summarizes old chat turns into `state.aiSummary`
  when the token budget gets tight.
- Reference Library UI: `#libOpenBtn` pill → `#libWrap` overlay. Guides tab = search + category
  chips + list + reader. Academy tab = course tree from `academy.json`. Articles are read from
  `src/ref/` via `fetch()` at runtime (works offline after first load only if the browser cached
  them; the files themselves are static assets of the generator, so they are "offline copies" in the
  sense that they don't depend on EasyDMARC's servers).
- Chat/library overlays animate via CSS transforms. A JS fallback (`animDead` flag in openChat/
  closeChat) force-applies the end state if CSS transitions never progress (some embedded previews
  stall requestAnimationFrame; without this the panel would stay stuck off-screen).

## Known platform notes

- `root.generateText` (ai-text-plugin) is writable — tests can stub it via `window.root.generateText`.
  Access plugin functions through `root.` (module code does), never bare.
- The preview iframe can wedge (rAF stops firing; screenshots return stale frames). Reload the
  browser tab to recover. Not an app bug.
- Generator is saved under the name above; fetch("src/...") works in the live preview and in the
  saved page.

## Data caveats

- Record examples inside the guides (SPF/DKIM/DMARC values, CNAME targets) are illustrative from
  EasyDMARC's docs. The app's UI and chat repeatedly tell users to copy the exact values EasyDMARC
  generates for their account — keep that guidance in any new copy.
