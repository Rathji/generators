# comments-plugin (`commentsPlugin`) — comments / chat / guestbook

```
commentsPlugin = {import:comments-plugin}
```

Render it by evaluating the call in the HTML — `[root.commentsPlugin(options)]` in a template, or `ctn.innerHTML = root.commentsPlugin(options)` in JS. Options come as an object or a pjs list.

## Core options
```pjs
commentOptions
  channel = general-chat        // separate comment streams; lowercase letters, numbers, hyphens only
  channelLabel = 💬 General     // display-only name (any chars) shown to notification subscribers
  width = 100%                  // or px number -- or you can specify width in containerStyle
  height = 350                  // or you can specify height in containerStyle
  commentPlaceholderText = Add a friendly comment.
  submitButtonText = submit comment
  newestCommentsAtTop = true
  hideComments = true           // just the input box (feedback-widget mode)
  hideDates = true
  hideCommentsBeforeDate = 28 August 2019   // no "th"
```
- Each distinct `channel` is a fully separate stream; multiple boxes per page are fine.
- Comments boxes persist across randomize/update by default. To get a fresh box per update (e.g. one channel per goto-plugin room), add `replacedDuringUpdate = true`.

## Styling
`forceColorScheme = dark|light` (default follows system), `containerStyle`, `messageBubbleStyle`, `messageFeedStyle`, `inputAreaStyle`, `submitButtonStyle`, `settingsButtonStyle`, `fullscreenButtonStyle`, `submitButtonSuccessText`, `hideSettingsButton`, `hideFullscreenButton` — all inline-CSS strings. Prefer `light-dark(x,y)` colors so both modes work. Custom fonts: `loadFonts = Pacifico,Syne Mono` (Google Fonts names), then `font-family:` in the style options.

## Custom emojis
```pjs
commentOptions
  customEmojiSize = 2                  // global multiplier
  loneCustomEmojiSizeMultiplier = 3    // when a message is ONLY one emoji
  customEmojis
    @import = {import:huge-emoji-list} // optional 80k-emoji base list (only ONE @import allowed; can also be an uploaded .txt URL)
    cat_jam = https://user.uploads.dev/file/a43d....webp
    kekw (tags:lol,lmao) (size:2) = https://user.uploads.dev/file/ac26....png
    surprise = ( ˶°ㅁ°) !!             // plain text/kaomoji values work too
```
Typed as `:cat_jam:`. Images MUST be hosted on perchance.org/upload (user.uploads.dev); codes are letters/numbers/underscores; prefer animated webp over gif (~10x smaller); keep ≤128px.

It's often a good idea to add `@import = {import:huge-emoji-list}` as the first line under `customEmojis` (unless the user explicitly says not to) since it adds all the common emojis that most users want. You can then add more custom emojis under that, of course, as shown above.

## Slash commands
```pjs
commentOptions
  slashCommands
    allcaps
      output = [this.input.upperCase]   // "/allcaps hello" → "HELLO"
    emoji
      output = {import:emoji}
```

## Moderation
```pjs
commentOptions
  adminPasswordHash = <sha256 of "perchance-comments-plugin|" + password>
  adminFlair = 💎OWNER💎         // default 👑 MOD
  deleteButtonIcon = ❌
  bannedUsers                    // full user IDs (click a user's ID token to copy); IP-based, so shared IPs ban everyone on them
    91d6bc29a13cbc687e74
  bannedWords = your,list,of,words,or phrases   // slurs are banned by default; profanity isn't
  rateLimits = 1 per minute, 3 per 10 minutes   // hitting ANY rule blocks the comment
```
- The admin logs in by clicking the embed and pressing Ctrl+L (Cmd+L on Mac), then entering the password. Admins get highlighted comments, per-comment delete buttons, and a red-flag ban button on users' messages. The password itself must NEVER appear in generator code — only the hash.
- `bannedWords` entries can be regex: one rule per line, wrapped in slashes (`/your.*pattern/i`).
- `bannedUsers` can reference a shared list (`bannedUsers = [edgelords]`) to reuse across boxes.

## Hooks + programmatic control
Capture the instance: `[com = root.commentsPlugin(options)]`.
```pjs
commentOptions
  onLoad(comments) =>            // initial comment list (second arg: extras)
    latestEl.textContent = comments.at(-1).message;
  onComment(comment) =>          // each new incoming comment
    latestEl.textContent = comment.message;
  onInputTextChange(text) =>     // input box edits
  beforeSubmit(text) =>          // return null → cancel; return a string → replace what's submitted; return nothing → proceed
```
Comment fields: `.message` (UNSAFE html — escape before injecting!), `.time`, `.replyingTo`, `.byCurrentUser`, `.user.{id, visualId, nickname, isAdmin}`.

Instance methods: `com.submit(text[, {auth}])`, `com.inputText` (get/set), `com.setNicknameForNextComment(name)`, `com.setAvatarUrlForNextComment(url)` (both apply to the next comment only), `com.banUser(id)` / `com.unbanUser(id)` (admin).

With onComment + submit you can build fully custom feeds or even multiplayer games over the comment stream.

## Permissioned / scoped channels (rules are PART of the channel name)
- `chat+u:alice|bob` — only those perchance usernames can post.
- `chat+ids:channel` — user IDs unique to this channel instead of shared page-wide.
- `chat+auth:<sha256-of-public-key>` — only the holder of the matching secret-plugin private key can post; pass `{auth: {publicKey, decryptChallenge: c => root.secretPlugin.decrypt(c, keys.private)}}` to `com.submit`. (See the secret-plugin skill.)
- Combine with a comma: `chat+ids:channel,u:alice|bob`. ORDER MATTERS — any reordering or renaming is a completely different channel.

## Real-world example
The `secret` generator (perchance.org/secret) builds an anonymous encrypted inbox on top of this plugin: a hidden comments channel is the message transport (messages encrypted with secret-plugin before submit via `beforeSubmit`-style flow), `+auth:` channels gate the owner's blog posts, and upload-plugin handles attachments. Fetch its source with the `fetch_generator` tool to study a full custom-feed implementation.

## Gotchas
- Anyone on the internet can post — expect trolls; use moderation options on anything public.
- Channel names: lowercase alphanumeric + hyphens only (rules suffixes aside).
