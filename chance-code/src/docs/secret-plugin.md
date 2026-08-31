# secret-plugin (`secretPlugin`) — public-key encryption

```
secretPlugin = {import:secret-plugin}
```

Simple, SYNCHRONOUS public-key encryption: encrypt with the public key, decrypt with the matching private key. Anyone may see the public key; the private key must stay secret (and is unrecoverable if lost).

```js
let keys = root.secretPlugin.generateKeyPair();          // {public, private} — plain text strings
let enc = root.secretPlugin.encrypt("Hello!", keys.public);
let dec = root.secretPlugin.decrypt(enc, keys.private);  // "Hello!"
```

## Formats & properties
- Keys/ciphertexts are plain text with no spaces or special characters (double-click selects the whole thing). Public keys look like `PUBLIC_1_..._PUBLIC_END`, private keys `PRIVATE_1_..._PRIVATE_END`, ciphertexts `ENCRYPTED_1_..._ENCRYPTED_END` (the number is a scheme version; upgrades stay backward-compatible).
- Encrypting the same text twice gives DIFFERENT ciphertexts (random padding by design) — don't compare ciphertexts for equality.
- Input is auto-compressed before encryption; small inputs still produce a fairly long minimum-size ciphertext.
- Scheme is ML-KEM (FIPS 203) — post-quantum.
- To encrypt files/images, convert to a data URL first.
- Works fine for personal storage too: encrypt with your own public key, never share anything.

## comments-plugin integration (`+auth:` channels)
Restrict who can post to a comments channel to whoever holds a private key: name the channel `my-channel+auth:<sha256 of the public key>` and pass an `auth` object when submitting:

```js
let channel = `my-channel+auth:${await sha256(keys.public)}`; // sha256 = your own subtle-crypto helper
let com = root.commentsPlugin({ channel });
await com.submit("Message text", {
  auth: {
    publicKey: keys.public,
    decryptChallenge: (challenge) => root.secretPlugin.decrypt(challenge, keys.private),
  },
});
```

## Real-world example
The `secret` generator (perchance.org/secret) is an anonymous encrypted-inbox app: visitors encrypt messages with the inbox owner's public key and post them to a comments-plugin channel; only the owner (holding the private key) can decrypt them. It combines this plugin with comments-plugin (transport, `+auth:` owner-blog channels) and upload-plugin (attachments with NSFW checks). Fetch its source with the `fetch_generator` tool to study it.
