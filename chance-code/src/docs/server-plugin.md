# Perchance server plugin

## Set up

In `main.pjs`:

```pjs
createServerSocket = {import:server-plugin}
```

Put server code in the first matching element in `index.html`:

```html
<script type="text/x-server-plugin">
self.onopen = ({conn}) => conn.subscribe("world");
self.onmessage = ({conn, data}) => pubsub.publish("world", data);
self.onclose = ({conn, code, reason, wasClean}) => {};
</script>
```

## Treat all server-script source as public

Everything inside `<script type="text/x-server-plugin">` is delivered as generator source and is visible to every client. The runtime executes the saved version authoritatively—clients cannot replace production logic—but visibility means the script is never a secret store. Never embed plaintext passwords, API tokens, private keys, upload deletion URLs, or any other credential in server code. Never move those secrets into `main.pjs`, ordinary client scripts, HTML, URL parameters, or browser storage either; those are also client-visible.

For password-based admin mode, if the game/application has user registration already, then could assign special powers to the 'admin' username (or any other username) and tell the user to register with that username before the release the game/app to the public.

Remember also that your code MUST be robust against malicious clients. Here's an example of *insecure* server code:
```js
self.rpc = {
  banUser({conn}, data) { // admin path
    let info = JSON.parse(data);
    if(info.from === "admin") { // BAD!!! A tampered client can send *any* data to the server. Instead, use something like `info.from === "admin" && sha256(info.password) === getUser("admin").passwordHash` or any other actually-secure check.
      addBannedUser(info.username);
    } else {
      return '{"ok":false,"err":"unauthorized"}'
    }
  }
}
```

Another pattern for password-based admin mode is to generate a high-entropy password *at build time* (e.g. using the `execute_js` tool), hash it, and embed only the hash in the generator source. The plaintext password is given to the user in your final response after implementing the feature. The server script hashes the password at runtime and compares it to the embedded hash. This avoids storing any plaintext secrets in the generator source. Concretely:

1. Generate at least 32 cryptographically random bytes (or word-based seed phrase) while building and encode them as a long base64url or hex password. Compute its SHA-256 hash outside the generator, give the plaintext password to the user in the final response, and put only the hash in generator source.
2. Add a synchronous pure-JS SHA-256 implementation to the server script. The server runtime has no `crypto`, `TextEncoder`, imports, network access, or async handlers, so browser hashing APIs cannot be used there. Ensure the implementation correctly handles the password's chosen encoding.
3. Ask for the password at runtime with an unfilled prompt/input and send it over the WebSocket or RPC; never hard-code it into the admin UI, log it, echo it, or place it in a URL. Hash it on the server and compare the result to the embedded hash.
4. Track authenticated connections in an ephemeral `Set` keyed by `conn.id`, remove them on close, and require reauthentication after reconnect or server-global rebuild. Check authorization inside every privileged handler; hiding admin controls in the UI is not authorization.
5. Rate-limit failed attempts per connection and coarse `conn.net` groups. The public hash permits offline guessing, so plain SHA-256 is suitable only with the generated high-entropy secret—not a weak or human-chosen password.

The server-side shape should be explicit:

```js
const ADMIN_PASSWORD_SHA256 = "<sha256-of-the-generated-high-entropy-password>";
const adminConnectionIds = new Set();

// Include a complete synchronous pure-JS sha256Hex(password) implementation above.
self.rpc = {
  authenticateAdmin({conn}, password) {
    if (!allowAuthAttempt(conn)) return "denied"; // bounded per-conn/conn.net limiter
    if (sha256Hex(password) !== ADMIN_PASSWORD_SHA256) return "denied";
    adminConnectionIds.add(conn.id);
    return "ok";
  },
  performAdminAction({conn}, data) {
    if (!adminConnectionIds.has(conn.id)) throw new Error("unauthorized");
    // Validate data and perform the privileged operation.
    return "ok";
  },
};
self.onclose = ({conn}) => adminConnectionIds.delete(conn.id);
```

Connect from browser code:

```js
const socket = root.createServerSocket();
socket.binaryType = "arraybuffer";
socket.addEventListener("open", () => socket.send("hello"));
socket.addEventListener("message", event => console.log(event.data));
socket.addEventListener("close", event => reconnect(event));
```

Inside `type="module"`, use `root.createServerSocket()` because pjs imports are not module lexical globals.

## Browser API

In saved/public output, `root.createServerSocket()` returns a WebSocket-compatible socket object (a facade over a native `WebSocket`, same surface as the emulator socket). Normal WebSocket behavior applies: same-socket messages are FIFO; `send()` has no acknowledgement; there is no automatic reconnect, retry, replay, or pre-open queue.

### perchance.org-only restriction

Production server-plugin sockets only work when the whole page frame chain is on perchance.org (the plugin proves this with a hidden token iframe locked by `frame-ancestors`; users embedding a generator's iframe on an external website get their sockets closed with `4403` and a visible notice). Treat `4403` as permanent: do NOT reconnect-loop on it. This is a platform-level economic restriction, not a bug you can work around; never attempt to bypass it. Everything else (the generator on perchance.org, direct subdomain views, the editor, this agent's preview) is unaffected.

- `socket.opened`: resolves when open and rejects if the initial connection fails.
- `socket.closed`: resolves with the `CloseEvent`.
- `socket.rpc.<method>(data)`: request/reply extension described below.

Wait for `open` or `await socket.opened` before sending. Calling RPC while not open throws `InvalidStateError`. Browser `socket.close(code, reason)` accepts `1000` or `3000`-`4999`; use a `4xxx` code for application failures.

Always handle unexpected closure in long-lived applications. Create a new socket with capped exponential backoff and jitter, ensure only one attempt/socket is current, then rejoin and obtain an authoritative snapshot or resume state. Treat `1012` as a server/code restart and `1006` as a network loss. Back off on `1013`, respecting any retry delay in its reason. Never blindly replay sends or RPCs after reconnect because the previous connection may have processed them.

### RPC

Use RPC only for one request that needs one reply:

```js
await socket.opened;
const reply = await socket.rpc.getSpawn("player-7");
```

Each RPC accepts exactly one string, `ArrayBuffer`, typed array, or `DataView`. It resolves to one string or `ArrayBuffer`; encode objects yourself. There is no built-in timeout or retry, and a pending call rejects when the socket closes.

Define methods server-side:

```js
self.rpc = {
  getSpawn({conn}, data) {
    return `spawn:${conn.id}:${data}`;
  }
};
```

A method receives frozen `{conn}` plus the caller's data and returns a string/buffer. A thrown error rejects only that RPC. Method names must be 1-128 UTF-8 bytes; names beginning with `@`, plus `then` and `toJSON`, are reserved.

## Server API

Handlers are synchronous:

```js
self.onopen = ({type, conn}) => {};
self.onmessage = ({type, conn, data}) => {}; // data: string or ArrayBuffer
self.onclose = ({type, conn, code, reason, wasClean}) => {};
```

Do not use `async`, return Promises, or expect background work. Timers, imports, network/filesystem access, workers, WebAssembly, `SharedArrayBuffer`, `Atomics`, `eval`, and `Function` are unavailable.

Available globals include normal ECMAScript primitives, `JSON`, `Math`, `Date`, `Map`, `Set`, `Proxy`, `Reflect`, `ArrayBuffer`, `DataView`, typed arrays, and the platform globals `self`, `state`, `pubsub`, and `console`. Browser/Node/Deno APIs—including DOM globals, `fetch`, `WebSocket`, `URL`, `crypto`, `Intl`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, and `btoa`—are unavailable.

Each frozen `conn` has:

- `id`: ID for this physical connection.
- `net`: four generator-specific, privacy-preserving network groups, ordered broadest to most specific. See below.
- `isProxy`: `true` if the connection came from a known VPN, proxy, or datacenter/hosting IP range. See below.
- `readyState`, `bufferedAmount`.
- `send(data)`, `close(code?, reason?)`.
- `subscribe(topic)`, `unsubscribe(topic)`, `isSubscribed(topic)`.

### Connection network groups: `conn.net`

`conn.net` is always a four-element array. Each element is an opaque, JavaScript-safe integer derived from a keyed hash of the generator name and a prefix of the client's IP address; the raw IP is not exposed. Values can be compared within one generator, but are deliberately different between generators.

| Index | IPv4 group | IPv6 group | Approximate scope |
| --- | --- | --- | --- |
| `conn.net[0]` | `/8` | `/16` | Extremely broad |
| `conn.net[1]` | `/16` | `/32` | Broad provider/network allocation |
| `conn.net[2]` | `/24` | `/48` | Narrower provider/customer allocation |
| `conn.net[3]` | `/32` | `/64` | Often roughly a residential allocation |

These are fuzzy abuse signals, never identities or authorization credentials. NAT and carrier-grade NAT can group unrelated people; VPNs, proxies, mobile networks, dynamic addressing, and IPv6 changes can move one person between groups. Even a mobile user may receive a different `net[1]` after toggling flight mode. Design every use so both false positives and bypasses are acceptable.

For anonymous voting or reactions used only for rough statistical sorting, combine several bounded per-item checks. For example, ignore a vote on a particular item if that item already received a vote within 72 hours from the same `conn.net[3]`, within 6 hours from the same `conn.net[2]`, or within 30 minutes from the same `conn.net[1]`. Some valid votes will be ignored and determined attackers can still evade this; that tradeoff is appropriate only where approximate, abuse-resistant ranking is more important than exact counting. Consider hiding or delaying vote totals to reduce manipulation, optionally showing only the voter an optimistic live increment.

For chat and social games, it can be appropriate to let a user block both another user/account and the blocked connection's `net[3]`, matched server-side, so creating another account or connection on the same approximate residential allocation does not immediately bypass the block. A block-strength control can widen matching from account/connection only to `net[3]`, then `net[2]`, and in unusually abuse-prone cases `net[1]`; broader levels are stronger but increasingly likely to block unrelated users. Do not use `net[0]` for ordinary per-user blocks. Network blocking is a moderation heuristic, not proof that two connections belong to the same person, and even `net[1]` can be bypassed.

### Proxy/VPN detection: `conn.isProxy`

`conn.isProxy` is a boolean computed once at connection time from public VPN/datacenter/hosting IP-range lists; it never changes for the lifetime of the connection. Like `conn.net` it is a fuzzy abuse signal, not an identity or authorization input: residential proxies and unlisted VPNs pass as `false`, and some school/corporate/mobile egress points are hosted in datacenter ranges and label `true`. In the unsaved editor emulator it is always `false`.

Appropriate uses: weighting `isProxy` connections more strictly in vote/reaction dedup (e.g. reject or down-weight votes where `conn.isProxy` is true, since `conn.net` grouping is easily rotated behind a VPN), adding friction or stricter rate limits for name registration and first-time chat, and strengthening block evasion checks. Blocking proxy users outright is a legitimate generator-author choice for abuse-prone experiences, but do not default to it — send a clear close reason (e.g. `conn.close(4403, "VPNs are not allowed here")`) so affected users understand why. Never treat `isProxy === false` as trust: it is one bit of evidence, best combined with `conn.net` checks and per-connection rate limits.

There is no connections array. Retain a `conn` in an ephemeral map for directed sends; use pub/sub for fan-out:

```js
conn.subscribe("room:7");
pubsub.publish("room:7", data); // includes the sender if subscribed
const count = pubsub.numSubscribers("room:7");
```

Topics beginning with `@` are reserved. Sends and publishes accept strings and buffer/view types.

## State and lifecycle

`state` is a zero-initialized, fixed-size `Uint8Array` (currently 50 MiB) persisted per generator with no expiry. It is the only durable server memory. Use a compact, versioned binary layout with bounds checks. Derive capacity from `state.length` instead of hardcoding 50 MiB — the size may increase in future versions. Since `state` never grows at runtime, cap every record type and decide up front what happens at the cap: evict oldest/least-recently-active first (store a last-seen timestamp so you can), or refuse creation with a clear user-facing error for records too valuable to evict (e.g. registered accounts with substantial activity). Check capacity before writing so a full state never half-writes a record.

All ordinary globals are temporary caches. The runtime may rebuild them after idle hibernation, code changes, timeouts, resource pressure, or crashes. Reconstruct them from `state` and current connections. A saved server-code update closes browser sockets with `1012`; client reconnect logic must rejoin them.

For large client-consumed files, use `upload-plugin` and store only a compact reference in `state`.

## Unsaved editor behavior

When `window.generatorIsUnsaved` is true, `root.createServerSocket()` uses a compatible local emulator instead of production. It is limited to that output document: no cross-tab multiplayer, and its temporary 50 MiB state disappears on iframe/document reload. It survives in-document unsaved server-code updates; those updates close old local sockets with `1012` and rebuild server globals.

A `page_refresh` (or a `page_eval` with `reload:true`) after an edit batch hard-reloads output and therefore starts fresh emulator state. Later evaluations keep it until the next reload — remember your edits only reach the page when YOU refresh. Use this mode for functional debugging, but test saved production for performance, GC, memory ceilings, transport backpressure, and real multiplayer behavior.

## Limits and failures

- Handler: 50 ms CPU per event/RPC; top-level initialization: 200 ms.
- Sustained CPU: about 250 ms per wall second per generator; 1,000 ms burst.
- V8 heap: 64 MiB; guest buffer/external allocations: 128 MiB aggregate.
- Message: 1 MiB maximum.
- Inbound rate per connection: 200 messages/s sustained, burst 400.
- Outbound queue: 1 MiB and 4,096 frames per connection; 128 MiB per generator.
- Connections: 10,000 per generator; 256 per most-specific `conn.net` group.
- Pub/sub: 4,096 topics per generator, 64 subscriptions per connection, 128-byte topic names.

Oversized inbound messages close with `1009`. Rate, connection, or backpressure limits close with `1013` and a descriptive reason. Oversized server sends/publishes and invalid topic operations throw synchronously.

An uncaught event-handler exception closes that connection with `1011`. A timeout closes the connection, rebuilds server globals, and may call server-side `onopen` again for surviving browser sockets without another browser `open` event. Durable bytes survive, including mutations made before interruption. Repeated timeouts, memory-limit failures, or attributed runtime crashes quarantine the generator for approximately 1, 4, 16, then 64 minutes; new sockets close with `4429` and a retry delay.

## Engineering guidance

- Treat EXTREME performance as a design constraint. Validate inputs and bound all work and storage. For hot paths, prefer compact memory layouts, typed views, bounded tables/freelists, buffer reuse, minimal allocation/copying/parsing, spatial topics, and reusing an encoded update across recipients. JSON is fine for low-rate control/chat; benchmark representative high-rate simulation and fan-out before accepting it there.

- NEVER USE JSON.parse or JSON.stringify in hot paths. Even if the game/experience is small in scope now, it may end up having tens of thousands of users - design for that reality. Prefer flat binary layouts with typed views for GC-free *extreme* performance, so the single-threaded server can scale to *thousands* of concurrent users. Be ambitious. Use versioning bytes to allow future changes to the binary layout.

- Prefer readable code. E.g. `if(t===MESSAGE_TYPE) {` is better than `if(t===0x03) {` because the latter is opaque and requires a lookup table to understand. Use constants for magic numbers, and comment the layout of binary data structures.

- If you've edited the code, but the user hasn't clicked save to push it to production yet, then you'll only have access to an emulated server, not the live production environment. So if you'd like to test the production server, you'll need to ask the user to click save to push the code to production, and then in the saved, *unedited* state, your `page_eval` calls will be able to interact with the production server.

- ALWAYS rate-limit resource-consuming operations like signup/register, chat messages, and so on using `conn.net`. Otherwise someone can flood your server and consume all the state or overload it. You may want to apply stricter rate limits and/or use a lower `conn.net` index if `conn.isProxy` is true. Remember rate limiting only slows state exhaustion; the caps/eviction guidance above is what prevents it.

- Remember that if you've made edits and the user hasn't saved the code, you're working with an emulated server. Make sure that any changes you make are backwards-compatible with existing state that the production server may have. It may be worth having a version byte in your state so you can upgrade old state to a new schema/format as needed.

- Often the most efficient multiplayer architecture is event-sourced lockstep: clients run a deterministic simulation, and the server merely sequences and reflects inputs.
  - The server stamps each input with the next event index and publishes it; durable state is then just a stream — a periodic full-state snapshot plus every event after it.
  - A client subscribes to the topic first, then requests the index it wants (`-1` meaning "snapshot + all events after", or `34573` meaning "events from 34573 onward"), and applies events strictly in index order — live publishes that arrive during catch-up are held (or re-pulled by index) until the backlog is applied, and duplicates are skipped by index.
  - Each time a new snapshot is stored, drop all events at or before its index so the log stays bounded.
  - Since the server cannot run the simulation, obtain snapshots from a client: periodically `send()` a snapshot request to a connected client that is confirmed caught up (its reported applied-event index is current — not merely the oldest connection, since backgrounded tabs throttle timers and fall behind), have it upload the serialized state in chunks under the 1 MiB message limit, and let joiners pull the snapshot chunk-by-chunk via RPC (pushing a multi-megabyte snapshot overruns the per-connection outbound queue).
  - Note the trust tradeoff: the snapshot donor's state becomes authoritative history, so a cheating or desynced client can poison the world — acceptable for casual/co-op experiences, and mitigable by comparing state hashes from several clients before accepting a snapshot.
  - Determinism is the hard part: use a fixed timestep, a seeded PRNG (never `Math.random`), never let wall-clock time or frame timing feed the simulation, keep entity iteration order canonical, and avoid `Math.sin`/`cos`/`pow` in sim logic (implementation-approximated, not guaranteed identical across browsers).
  - Rapier.js and https://github.com/jrouwe/JoltPhysics.js execute deterministically in wasm provided every client runs the same build with identical fixed timesteps and event order.


**IMPORTANT**: If there is existing server plugin code, consider that the production server may already have state that your new code must handle. If you change the state layout, you may need to write migration code to handle existing state. You should write code to seed and run emulated migration in your local emulated server before deploying to production. For safety, it may be a good idea to use the `page_eval` tool to add a one-time backup-downloading password to localStorage which is automatically used on first connect, so that after the user saves the code, their first connection to the server will trigger a download of the current state to a local, temporary `kv-plugin` entry (with the store/key name documented in the code for future agents) that you can inspect if something goes wrong with the new code, and you may also want to make it trigger their browser to download the previous state as a file for extra safety, which they can later attach to a message that they send you if needed.
