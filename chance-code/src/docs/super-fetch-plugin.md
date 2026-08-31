# super-fetch-plugin (`superFetch`) — CORS-free fetch for generator code

```
superFetch = {import:super-fetch-plugin}
```

An exact duplicate of the browser's built-in `fetch` EXCEPT it bypasses CORS: the request is proxied through a Perchance server which fetches the content and returns it with permissive headers. Same signature, same `Response` object:

```js
let html = await root.superFetch(`https://en.wikipedia.org/wiki/${nameInput.value}`).then(r => r.text());
let data = await root.superFetch("https://api.example.com/things").then(r => r.json());
```

Use it for RUNTIME fetches inside the generator (user-driven lookups, crawlers, page summarizers — often paired with ai-text-plugin and something like readability.js). For fetching resources during YOUR OWN work, use the `fetch_url` tool instead — it saves byte-exact to the workspace.
