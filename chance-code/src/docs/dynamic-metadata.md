# Dynamic metadata

Use `$meta.dynamic(inputs)` only when a generator's title, description, or social image must depend on URL query parameters. Keep static `$meta` values as fallbacks.

```pjs
$meta
  title = Character Library
  description = Browse and chat with characters.
  image = https://example.com/default-card.png

  async dynamic(inputs) =>
    const characterId = inputs.urlParams.character;
    if(!characterId || !/^[a-z0-9-]{1,80}$/i.test(characterId)) return {};

    const response = await fetch(`https://example.com/characters/${encodeURIComponent(characterId)}.json`);
    if(!response.ok) return {};
    const character = await response.json();

    return {
      title: `${character.name} - Character Library`,
      description: character.description,
      image: character.imageUrl,
    };
```

The function may be synchronous or asynchronous. Return a JSON-serializable object containing any of:

- `title`: string, limited server-side to 500 characters.
- `description`: string, limited server-side to 3,000 characters.
- `image`: string URL, limited server-side to 500 characters and subject to URL-safety and content checks.

Omitted or non-string fields retain their static `$meta` fallback. Keep `tags` and `header` static; they are not dynamic outputs.

## Treat the function as isolated code

Write the entire function as self-contained JavaScript. The server extracts its source and runs it in a fresh sandbox, not in the generator's normal scope.

- Read request-specific state only from `inputs.urlParams`. Ordinary query parameters appear as properties; tracking and internal parameters are filtered out.
- Inline every lookup table and helper the function needs. Do not reference top-level lists, functions, imports, or variables—even ones declared immediately above `$meta`.
- Do not use `root`, `window`, `document`, DOM APIs, browser storage, or Perchance helpers such as `.selectOne`, `.evaluateItem`, or `.titleCase`.
- Do not rely on mutations or globals surviving another evaluation; each evaluation receives a fresh compartment.
- Treat query parameters and fetched data as untrusted. Validate values, bound their lengths, and encode them before constructing URLs.

The sandbox provides ordinary JavaScript plus selected web APIs, including `fetch` for HTTP(S), `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`, `Blob`, compression/decompression streams, text encoders, streams, abort APIs, `crypto`, `Date`, and `Math`. Network access is brokered and the whole evaluation currently has roughly four seconds, so keep work small and bounded. There is no Deno, Node, filesystem, WebSocket, worker, or page DOM access. `location` is a virtual bare generator URL; use `inputs.urlParams`, not `location.search`, for the visitor's query parameters.

## Design for caching and failure

Make output deterministic for a given `inputs.urlParams`. The platform caches evaluations by function source and inputs, and the public metadata endpoint is also HTTP-cached, so randomness, current time, and rapidly changing remote data will not update per page view.

Return `{}` or static fallback values when an optional parameter is absent, a fetch is unsuccessful, or fetched data is malformed. Keep the static metadata useful because sandbox errors and rejected dynamic fields fall back to it.

For a production example, use `fetch_generator` to inspect `ai-character-chat` (`https://perchance.org/ai-character-chat`). Its `dynamic` function inlines its named-character mapping, reads only `inputs.urlParams`, optionally fetches and decompresses a character file, and returns character-specific metadata.

## Verify both execution paths

1. Inspect the function for forbidden outer-scope references before testing.
2. Call `root.$meta.dynamic({urlParams:{...}})` with `page_eval` to check its return shape and visible title behavior. This browser preview is not proof of isolation: it runs with generator scope available and can hide a production-only mistake.
3. After saving, use `fetch_url` on `https://perchance.org/api/getDynamicMetaData?__generatorName=GENERATOR_NAME&PARAM=VALUE` and inspect the saved JSON. This exercises the server sandbox and is the authoritative check.
4. Test with no query parameters, valid parameters, invalid/oversized values, missing remote data, and fetch failures. Confirm static fallbacks remain sensible.
