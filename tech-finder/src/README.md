# Tech Finder — project notes

## What this is
A Perchance prototype of the "AI Power Tech-Finder" roadmap (v1.0, in the chat history) — Phases 1–2 golden path: typed model or photo → cited spec sheet → rules-matched compatible adapters/parts → buy links.

Live product rules the prototype enforces (from the roadmap "non-negotiables"):
1. Every factual claim carries a source URL. Values not confirmed at build time render with the amber "unverified" dot — never as fact.
2. No hallucinated part numbers. The seed catalog currently contains **zero** part numbers that weren't fetch-verified; adapters say "see OEM listing" instead.
3. Ambiguity is surfaced (pick-list cards), never silently guessed.
4. Copy-friendly output: Markdown / CSV reports + print stylesheet.

## Files
- `main.pjs` — `$meta` + imports only (`ai-text-plugin` for photo/text AI, `super-fetch-plugin` for the live link checker).
- `src/data.js` — the curated catalog (`TFDB`): 10 products, 13 adapters (9 OEM + 4 verified 3rd-party), connector KB. This is the file to grow. Per-row flags: `vf:true` = value confirmed against the cited source page at build time (fetched 2026-09-06); `vf` absent = curated-from-OEM, shown as unverified. Product `sources[]` carry `ok:true` when the URL returned HTTP 200 at build time.
- `src/app.js` — engine + UI. Key functions: `identifyProduct` (deterministic token/number matching), `fitRules`/`rankedAdapters` (the deterministic fit engine — LLM never decides fit), `renderProduct`, `runVision` (photo label/tip reading via multimodal `generateText`), `verifySourcesLive` (T1-08-lite: HTTP-rechecks displayed sources via superFetch), report builders (Markdown/CSV).
- T1-05 (out-of-catalog live fallback, in `src/app.js`): `renderNotFound` + `liveSearch` (superFetch → Bing SERP, parsed by `parseBingResults`, ranked by `rankLiveResults` — needs ≥1 product-token match; graceful "unavailable" fallback to `manufacturerSearchRows` manual links) → per-result **Fetch & extract** (`fetchPageReadable` raced fetch+text, `htmlToText`) → `extractPageSpecs` (generateText JSON extraction, literal-values-only prompt, never infers part numbers) → live-extracted sheet card: amber-dot rows, per-row "looks right — confirm" flips green into `state.confirmedLive` (session Map), prefill button feeds the deterministic fit form (`selectConnOpt`/`kbFromAdapterHint`/`findPageWatt` = minimum in-range wattage). Fit decisions always come from the rules engine on user/page-provided facts — never from the LLM.
- `index.html` — shell + full stylesheet (no external assets).

## Architecture decisions taken (roadmap open questions)
- **Q4 hosting:** prototype on Perchance, as recommended. No backend; the catalog IS the database; no real vendor price scraping (Phase 4).
- **Q5 market:** Canada-first link set (Amazon.ca, Memory Express, Shopbot.ca) — links only, no price claims.
- **Shopbot:** `shopbot.ca/search?q=` 404'd for bot fetches at build time — deep-links kept, "verify at vendor" labeling.
- **T4 vendor layer (T2-04 task 19):** "Find live listings" buttons run a live vendor search via superFetch. Amazon.ca is the ONLY vendor reliably fetchable server-side — Memory Express search pages time out at the server, Shopbot.ca is JS-only (404 for bots), both unusable for live search. So live results = Amazon.ca search (parsed product-payload JSON for real titles/ASINs, deduped, ≤8) with a Bing-SERP fallback filtered to a vendor-host allowlist. Links only — prices are deliberately never shown.
- **Citation verification at build:** Dell store/support, Apple tech-specs (111883, 111893), Lenovo pcsupport, Memory Express all fetch 200. HP support search URLs serve JS shells — cited but `ok:null`.

## Verified reference facts (fetch-confirmed 2026-09-06, cited in data.js)
- MacBook Air (M1, 2020): 30W USB-C adapter, 49.9 Wh battery, 2× Thunderbolt/USB4 — support.apple.com/en-us/111883
- MacBook Pro 13" (M1, 2020): 61W USB-C adapter, 58.2 Wh — support.apple.com/en-us/111893
- Latitude 5420 (Dell store page): DDR4-3200, 2× SODIMM; M.2 2280/2230 NVMe; ports incl. 2× TB4 w/ PD; batteries 42/63 Wh; dims — dell.com/en-us/shop/laptops/latitude-14-5420-laptop/spd/latitude-5420-laptop
- Memory Express real item: Dr.Battery ACUSBC65 65W USB-C (MX00115238)

## Gotchas for the next session
- Research scratch files (`scratch/research/*`) are ephemeral — rebuild facts with `fetch_url` if needed.
- Rebuilding citation checks: hit each `sources[].url` and grep for the claimed values (Dell store pages embed full spec tech-notes server-side; Apple support pages include "In the Box" sections).
- `root.generateText` multimodal requires `instruction` as an ARRAY with one image File/Blob — see app.js `runVision`.
- Adding a product: give it `power` with the exact connector family id from `CONN_KB` — fit rules are driven by those ids (`usbc`, `dell74`, `hpSmart`, `lenovoSlim`).
- When the AI doesn't know a value, the correct behavior is to mark `vf:false`, not to omit or invent.

## Roadmap status within this prototype
The full atomic deployment plan now lives at the top of `main.pjs` (comment block — FEATURE DEPLOYMENT PLAN, 47 tasks / 8 phases, `[x]/[~]/[ ]` status per task; strict-hold workflow). Keep that block in sync as work progresses; this section is the quick summary.
Done (lite): T1-01/02 identify+normalize · T1-03 seed catalog · T1-06 disambiguation · T2-01 adapter ontology · T2-02 connector KB · T2-03 fit rules engine · T2-05/06 photo read + confirm step · T1-08 citation re-check · T5-02 export formats · T1-05 live web-retrieval fallback (live source search → fetch & literal-extract → user-confirm-to-green → facts feed the deterministic fit form; extract UI behind amber "unverified" until confirmed) · 7/8/10 full spec coverage (Processor/RAM/storage, display+physical, ports+OS for all 10 — Apple rows fetch-verified green, Intel/HP/Lenovo curated amber) · **T2-04 adapter catalog** (13 adapters now: every catalog device has its OEM adapter — added HP 65W USB-C for the Envy x360 13-bf0xxx + EliteBook 845 G8; plus 4 fetch-verified 3rd-party adapters covering all four connector families: Dr.Battery 65W USB-C, Billwisdom 19.5V 7.4mm (Dell), Easy Style HP Smart blue-tip, 3rd-party Lenovo Slim 20V) · **T4 task 19 vendor search** ("Find live listings" on every adapter/part card + family list + fit results: superFetch → Amazon.ca search → parsed real ASIN product links, Bing vendor-host fallback, cached per session, links only — no prices) · **T4 task 20 availability aggregation** (price-free: every live listing gets a health check via superFetch, per-row availability dot + "N/M responding" summary — the *price* half stays deliberately out of scope per the no-price-claims rule) · **task 21 link validation** ("Re-check every source & vendor link": verifyAllLinks HTTP-re-checks all sources + all Memory Express/Amazon.ca/Shopbot buy links; status dots persist per session on source rows AND buy buttons) · **task 22 vendor mapping** (live listings ranked by availability, responding first, per-listing status label — "by price" clause out of scope) · **task 23 currency normalization** (price-free: `cadUrl()` rewrites Dell OEM `/en-us/shop|laptop` → `/en-ca`; every buy button labelled with its store currency "· CAD"; price conversion itself out of scope) · **task 24 dead-link handling** (link checks now distinguish `dead` (HTTP 404/410/451) from `warn` (bot-block) from `unreach`; dead links strikethrough-flagged on sources + buy buttons; dead-link summary banner after re-check; Amazon live listings quote out-of-stock wording from the vendor's own page via `amazonAvailability`).
Next up: Phase 5 task 29 (Part Comparison View) is next in plan order after Phase 4 completes. Cleanup candidate needing user OK: `src/template.css` + `src/template.js` (dead leftovers from the old business-template phase, shipping publicly).
