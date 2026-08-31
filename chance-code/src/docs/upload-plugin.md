# upload-plugin (`uploadPlugin`) — programmatic file hosting

```
uploadPlugin = {import:upload-plugin}
```

```js
let { url, size, error, deletionUrl } = await root.uploadPlugin(stringOrBlob);
```

Uploads text or a Blob to Perchance's file storage (like perchance.org/upload, via code) and returns a permanent URL. No login required; quota is per-user (IP). It never throws — check `error`, which is `null` on success or `"over_daily_allowance" | "file_too_big" | "invalid_filetype"`. `size` is in bytes. Anonymous limits are roughly ~5MB/file, ~30MB/day — unless you use `expires`.

## Editable text files

Editable files keep one stable public URL while their text is replaced. Names are chosen entirely by your code: the plugin does not make them random. Anyone who knows or guesses a name can read its file, so use a long random name when discoverability matters.

Names must be 1–200 characters containing only lowercase letters, numbers, and `-`.

```js
let created = await root.uploadPlugin.editable.set("profile-4mtq8jpn2v6xkycqzr5lhw", JSON.stringify(profile));
if(created.error) throw new Error(created.error);
localStorage.profileEditKey = created.editKey; // returned only when the name is first created

let updated = await root.uploadPlugin.editable.set(
  "profile-4mtq8jpn2v6xkycqzr5lhw",
  JSON.stringify(nextProfile),
  {editKey: localStorage.profileEditKey},
);
```

`set` accepts strings only, with a 5 MiB maximum. It requires a saved generator (and works while editing a saved generator); an unsaved generator returns `editable_requires_saved_generator`. It resolves rather than throws for service errors; check `error`. A new name returns a generated 256-bit `editKey`. Existing names require that key. Store it securely because it cannot be recovered. Writes to one name are limited to one committed change per ten seconds; queued writes are coalesced and displaced calls resolve with `superseded === true` and `error === null`. Rewriting identical text is a free no-op. Successful calls also resolve with an `editCount` — 1 when the name is created, +1 per committed change. The raw URL can serve ~10s-stale content after a write, so append `?v=${editCount}` to it when you need to read your own write immediately.

Read from the current generator's namespace:

```js
let text = await root.uploadPlugin.editable.get("profile-4mtq8jpn2v6xkycqzr5lhw");
```

`get` resolves to the text, resolves to `null` for HTTP 404, and throws for network errors or other non-success HTTP responses. The corresponding raw URL is `https://editable.uploads.dev/file/<generatorName>/<name>` and is publicly fetchable from any generator.

Editable writes share the normal anonymous upload quota.

## Temporary files — much higher limits
If the file is only needed temporarily, pass an `expires` epoch-ms timestamp. The sooner it expires, the bigger the boost to max file size AND daily quota: ≤24h → **400x**, up to 1 year → 20x.

```js
let { url } = await root.uploadPlugin(data, {expires: Date.now() + 1000*60*60*24});
```
Deletion after `expires` is not immediate — the file is guaranteed to last AT LEAST that long.

Tip: compressing data before upload (e.g. CompressionStream / a pako import) fits ~10x more within a limit; decompress on download.

## Manual deletion
Files can be deleted within 3 days of upload by fetching the returned `deletionUrl`:
```js
let { success } = await fetch(deletionUrl).then(r => r.json());
```

## NSFW / moderation check
Before displaying a user-uploaded file publicly, you can check its auto-assigned tags:
```js
let info = await fetch(`https://upload.perchance.org/api/fileInfo?url=${encodeURIComponent(url)}`).then(r => r.json());
if (info && info.tags.includes("nsfw")) { /* hide/flag it */ }
```
Also accepts `?id=` with the file ID (`url.split("/").at(-1)`). This covers files on the general upload host (user.uploads.dev); for text-to-image-plugin-hosted images (aigc.uploads.dev) there's an equivalent imageTags API — see the text-to-image-plugin skill.

## Real-world example
The `secret` generator (perchance.org/secret) is an anonymous encrypted-inbox app combining this plugin (image/file attachments with NSFW checks and confirm-gating) with secret-plugin (encryption) and comments-plugin (message transport). Fetch its source with the `fetch_generator` tool to study it.
