# ai-text-plugin (`generateText`) — LLM text generation

```
generateText = {import:ai-text-plugin}
```

## Programmatic usage (the main way you'll use it)

Call it with a plain string (interpreted as the `instruction`), or an options object:

```js
let result = await root.generateText("Explain quantum field theory to a toddler.");
let result2 = await root.generateText({
  instruction: `You are Bob, a gruff blacksmith. Continue the conversation.\n${chatLog}`,
  startWith: "Bob:",
  stopSequences: ["\nUser:"],
  onChunk: (data) => { replyEl.textContent += data.textChunk; },
});
```

Core options:
- `instruction` — what to write.
- `startWith` — force the start of the response (always delivered as the first chunk).
- `stopSequences` — array of strings; generation stops when one is produced. The stop sequence IS included at the end of the generated response.
- `onStart(data)` — fires first; inputs at `data.inputs.instruction`, `data.inputs.startWith`, etc.
- `onChunk(data)` — per chunk: `data.textChunk`, `data.fullTextSoFar`, `data.isFromStartWith`.
- `onFinish(data)` — `data.text` (INCLUDES startWith), `data.generatedText` (excludes it), `data.liveResponseText` (current text including any user edits made via the edit button).

The `await` resolves to a String-like object: its string value equals `.text` (includes `startWith`); `.generatedText` excludes it. The un-awaited Promise has two extras: assigned to an element's `innerHTML` it streams in automatically (`outputEl.innerHTML = root.generateText("...")`), and it has a `.stop()` method to abort generation.

When outputting medium-to-large amounts of text that is visible to the user, you should generally use `onChunk` to stream the response as it is generated, so the user can begin reading the response before it is fully complete. This provides a better user experience, which is important.

## Fast successive generations: prefix caching + token budgeting

The backing service caches the KV-prefix of recent prompts, so a generation whose prompt shares a long UNCHANGED PREFIX with a previous one starts massively faster. Design multi-turn features (chats, iterative stories) around this:

- Keep an **append-only transcript**: fixed instruction/persona text first, then the log, with new turns appended at the END. Never rewrite, reorder, or timestamp-prefix earlier text per call — any change near the top invalidates the whole cached prefix.
- When the log grows too long, **summarize intermittently, not every turn**: compacting rewrites the prefix (one deliberate cache miss), so do it rarely — e.g. when over budget, summarize the older half into a paragraph and keep the recent tail verbatim, then go back to appending.
- If you have multiple tasks which rely on a log of messages/paragraphs/etc. then put the task at the *end* of the log. For example, your prompt might look like this:
```js
let prompt = `Below is a series of messages. Follow the'TASK' at the end of the messages.
<MESSAGES>
${messages.join("\n\n")}
</MESSAGES>
TASK: ${task}`;
```
where `task` could, for example, be any of:
- "Write a response as 'Bob'."
- "Write a prompt for a text-to-image model that illustrates the current situation in the chat."
- "Summarize the first 10 messages."
The point is, with the task always at the end, if you change it, the prefix cache of all the messages (i.e. the bulk of the prompt) is still valid. Similarly, if you have aspects of the prompt which commonly change (e.g. status/location/hp/mana/etc. in a text adventure) then it might make sense to put that highly-dynamic state *after* the main feed/history/logs so you don't break the cache every time you update it.

Budget with the plugin's meta object (a synchronous call — no await). Here's a complete chat loop that puts all of the above together — one shared template, token budgeting, and background summarization that the user never waits on:

```js
let { countTokens, idealMaxContextTokens } = root.generateText({getMetaObject:true});

let summary = "";   // rolling summary of the history that has been compacted away
let messages = [];  // verbatim transcript tail, append-only: "User: ..." / "Bob: ..." strings
const KEEP = 8;     // newest messages that always survive compaction verbatim

// ONE template for every task (replying, illustrating, summarizing...): identical text up through </MESSAGES> means all of these calls share the same cached prefix.
function buildPrompt(task) {
  let log = [summary && `[Summary of the earlier conversation:\n${summary}]`, ...messages].filter(Boolean);
  return `Below is a series of messages. Follow the TASK at the end of the messages.
<MESSAGES>
${log.join("\n\n")}
</MESSAGES>
TASK: ${task}`;
}

async function chat(userMsg) {
  messages.push(`User: ${userMsg}`);
  let reply = await root.generateText({
    instruction: buildPrompt("Write the next response as 'Bob'."),
    startWith: "Bob:",
    stopSequences: ["\nUser:"],
    onChunk: (d) => { replyEl.textContent = d.fullTextSoFar; },
  });
  messages.push(reply.text.trim()); // "Bob: ..." — .text includes the startWith
  maybeCompact(); // deliberately NOT awaited: housekeeping must never delay the user's next turn
}

// Background compaction: once the prompt outgrows the budget, fold the oldest messages into the rolling summary, keeping the newest KEEP verbatim. Note the TASK just POINTS AT the fold boundary — the messages themselves are already in the prompt's cached prefix, so even the summarization call is a fast, cheap cache hit (vs. pasting them into a fresh prompt, which would re-ingest everything uncached).
let compacting = false;
async function maybeCompact() {
  if (compacting || messages.length <= KEEP) return;
  if (countTokens(buildPrompt("")) < idealMaxContextTokens * 0.9) return;
  compacting = true;
  try {
    let n = messages.length - KEEP;
    let boundary = messages[n - 1].slice(-30);
    let result = await root.generateText(buildPrompt(`Summarize the first ${n} messages, stopping after the message that ends with "${boundary}". Fold in the [Summary of the earlier conversation...] block if there is one. Terse bullets; preserve names, facts, decisions, and unresolved threads. Output ONLY the new summary text.`));
    summary = result.text.trim();
    messages = messages.slice(n); // append-only, so messages added while we awaited are unaffected
  } finally {
    compacting = false;
  }
}
```

Why it's shaped this way:
- The `compacting` flag prevents overlapping summarize calls when the user chats quickly; a skipped check just means the next `chat()` triggers it.
- `messages.slice(n)` after the await is safe because `messages` is append-only — the `n` folded messages are still the first `n`, and anything appended mid-summarization survives.
- The first call after a compaction is a one-time cache miss (the prefix changed); every call until the next compaction hits again. That amortization is what "summarize intermittently, not every turn" buys.
- `countTokens(text)` is a fast approximation; `idealMaxContextTokens` (6000 as of writing this document, but may be larger now) is a recommendation, not a hard limit, and will increase over time — always read it from the meta object rather than hardcoding.
- We give the LLM `boundary` text so it knows where to stop summarizing, since LLMs can sometimes be bad at counting.

## Gotchas
- Generation can take up to a MINUTE (much less on prefix-cache hits) — always show a loading indicator in UIs you build.
- Importing this plugin puts an ad on the generator for non-logged-in users.
- Each user only gets a few concurrent server requests; extra calls queue. Don't fire many at once.
- The model follows NSFW prompts; if unprompted NSFW appears, add a line to `instruction` telling it not to.

## Addendum: pjs-template usage (`[root.generateText(promptList)]` in HTML/lists)

The plugin can also be evaluated directly in a perchance template, streaming its output into the page where the call appears. Options come from a pjs list:

```pjs
poemPrompt
  instruction = Write a haiku about a [character] in [place] during [season].
```

...then `[root.generateText(poemPrompt)]` in index.html. Extra options that only matter in this display mode:

- `outputTo = [someEl]` — stream the response into that element instead of in-place.
- `style = ...` — CSS applied to the output text's display.
- `endButtons = none` — hide the edit/continue buttons that normally appear after the response.
- `render(data)` — runs per chunk; whatever you RETURN is what gets displayed (e.g. transform *asterisks* into italics). `data.text` = text so far, `data.isPartial` = still generating.
- `hideStartWith = true` — generate from `startWith` but don't display it.
- Users can hover the icon at the end of the output to see the instruction used.

Multi-line `instruction`/`startWith`: make the option a sub-list and join it — prefer `"\n"` over `<br>` (the model is trained on text; the output display renders `\n` as a real line break):

```pjs
chatPrompt
  startWith
    cat: i am a cat, calling about your pilates classes
    staff: sure! i can help, can-
    cat:
    $output = [this.joinItems("\n")]
```

`instruction` / `startWith` / `stopSequences` may also be FUNCTIONS returning the value — useful to stop pjs from evaluating `[...]`/`{...}` inside the text.

## Image attachments (vision)

`instruction` can be an ARRAY of text parts plus at most ONE image `Blob`/`File`
(png/jpeg/webp — GIF throws). The image is inserted into the prompt exactly
where it appears in the array:

```js
let blob = await (await fetch(imgUrl)).blob(); // or from <input type=file>, canvas.toBlob, generateImage result, etc.
let result = await root.generateText({
  instruction: ["Here is a photo of my fridge contents:", blob, "\nSuggest a dinner recipe using only what you can see."],
  startWith: "Recipe:",
});
```

- ONE image max per call (extra images throw synchronously).
- The client re-encodes the image (768px bound, PNG-first, ≤200KB target) and
  strips metadata; anything still over 250KB after re-encoding throws.
- An image costs a flat **~570 tokens** of context regardless of source size
  (the model works at a fixed image-token budget), so budget with
  `getMetaObject().countTokens(textOnly) + 570`.
- Prefix caching: an image is cached like any other prompt content. If the
  image CHANGES every call, place it as LATE in the instruction as possible so the
  static text prefix stays cached; a CONSTANT image can go anywhere.
- Vision quality is tuned for documents/charts/screenshots/photos; ask
  specific questions for best results ("What does the error dialog say?"
  beats "describe this").
