# SillyTavern Interop — roadmap status

Original spec: `atomic-roadmap-sillytavern-interop.markdown`. Built as one "base" pass (the strict hold / one-task-at-a-time workflow was overridden by the user).

## Phase 1: Plugin scaffold & binary core utilities
- [x] Plugin container & import contract — `stInterop = {import:...}` → namespace object, `root.stInterop.parseCharacter(file)`, `.toV2(card)`, …
- [x] File/Blob input plumbing — File, Blob, ArrayBuffer, Uint8Array, string; text/binary detection + mismatch rejection
- [x] Unicode-safe base64 codec — TextEncoder/TextDecoder + chunked `String.fromCharCode`, no mojibake at any size
- [x] PNG chunk reader — signature + length/type/data/CRC parsing, tEXt + iTXt extraction, CRC verification
- [x] CRC32 — table-based IEEE, used on read (verify) and write (compute)
- [x] PNG chunk writer/editor — strip chara/ccv3 (case-insensitive), insert before IEND, recompute lengths + CRCs

## Phase 2: Character card parsing — v1/v2/v3
- [x] Format auto-detection — flat (v1), `spec === "chara_card_v2"`, `spec === "chara_card_v3"`; descriptive reject
- [x] Card source extraction — .json direct; .png via ccv3-first-then-chara, base64 → JSON
- [x] Canonical card model — always-present string fields, arrays, extensions verbatim, character_book
- [x] v1 → canonical — flat mapping, `""` defaults, legacy keys (avatar, chat, talkativeness, fav, create_date, creatorcomment, tags-as-comma-string) into `legacy`
- [x] v2 → canonical — data.* fields, creator_notes string-or-object, talkativeness 0.5 / fav false backfill from extensions
- [x] v3 → canonical — same + creator object + assets preserved; spec_version informational
- [x] canonical → v2 — `{spec, spec_version:"2.0", data}`; extensions preserved; talkativeness/fav mirrored into extensions; character_book embedded
- [x] canonical → v3 — `{spec:"chara_card_v3", spec_version:"3.0", data}` with creator object + assets
- [x] PNG card export — optional source portrait or generated fallback; chara + ccv3 chunks; plus .json export

## Phase 3: Lorebooks & world info
- [x] Lorebook JSON parser — top-level name/description/scan_depth/token_budget/recursive_scanning/extensions; requires `entries` array (E_NO_ENTRIES)
- [x] Entry canonicalization — keys/content/enabled/insertion_order/case_sensitive/selective/secondary_keys/constant/position/name/comment/id/priority/extensions + unknown keys preserved
- [x] Legacy world-info shape normalization — ST convertWorldInfoToCharacterBook mapping (position→extensions.position, order→insertion_order, disable→enabled:!disable, …)
- [x] Lorebook serializer — `{name, description, scan_depth, token_budget, recursive_scanning, extensions, entries}` with full round-trip
- [x] Character-book interop — extract `data.character_book` / attach as `character_book` without data loss

## Phase 4: .jsonl chat files
- [x] Line-delimited JSON reader — one object per line; skips blanks; malformed line reports exact line number
- [x] Canonical message model — role derived from is_user/is_system; unknown fields preserved verbatim
- [x] Chat metadata handling — chat_metadata / user_name / character_name first-line object kept separate + re-emitted
- [x] Chat serializer — one compact JSON per line, preserving swipes/swipe_info/extra/unknown fields
- [x] Chat → prompt-ready structure — `{speaker, text}` pairs + flagged system-message list

## Phase 5: Perchance integration, demo & QA
- [x] pjs list export helpers — toPjs / toPjsLorebook / toPjsChat (+ fromPjs inverse via createPerchanceTree)
- [x] Demo/test generator UI — file inputs/drop zones for card/lorebook/chat; spec + canonical display; export v1/v2/v3 JSON, PNG (chara+ccv3), lorebook .json, .jsonl
- [x] Round-trip & preservation test suite — fixtures (v1/v2/v3, PNG with both chunks, legacy lorebook, multi-swipe .jsonl) + parse→serialize→parse stability + unknown-field preservation (run against the live plugin)
- [x] Error reporting & documentation — actionable errors for every failure mode; README documents API, formats, spec notes, import conventions
