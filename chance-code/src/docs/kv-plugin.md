# kv-plugin (`kv`) — persistent key/value storage

```
kv = {import:kv-plugin}
```

IndexedDB-backed, so it stores hundreds of megabytes (vs localStorage's ~10MB) and any structured-cloneable value (objects, arrays, TypedArrays — not just strings). Data lives on the user's device, per generator, and survives reloads/closes. Everything is async — `await` it.

Keys live in named "folders" — any property name on `kv` is a folder:

```js
await root.kv.stories.set("fairytale1", "Once upon a time...");
let text = await root.kv.stories.get("fairytale1");
await root.kv.stories.delete("fairytale1");

await root.kv.characters.set("Bob", {name:"Bob", hp:100, inventory:["stick","flask"]});

await root.kv.myFolder.setMany([["abc",123], ["blah",456]]);
let vals = await root.kv.myFolder.getMany(["abc","blah"]);
await root.kv.myFolder.deleteMany(["abc","blah"]);

let entries = await root.kv.myFolder.entries(); // all [key,value] pairs in the folder
let keys = await root.kv.myFolder.keys();
let values = await root.kv.myFolder.values();
```

## Atomic `update`
```js
await root.kv.myFolder.update("abc", v => v + 1);
await root.kv.characters.update("bob", char => { char.hp--; return char; });
```
`update` runs in a single IndexedDB transaction. Use it (NOT get-then-set) whenever the new value depends on the current value and multiple code paths can touch the same key — a `get`/`set` pair has an `await` gap in which another writer can read the same stale value, losing one of the increments.

## Notes
- For trivial string flags, plain `localStorage.abc = "123"` needs no plugin at all.
- `get` on a missing key resolves to `undefined`.
