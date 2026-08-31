# "Ask AI" chat button — drop-in instructions for templates

Add an AI chat button to any template so visitors can ask questions about it
("What can I build with this?", "How do I start?", "Is there an app that does X?").
The AI answers **only** from a `KNOWLEDGE` block you fill in — so it always stays
accurate and on-topic.

Three pieces, all copy-paste:

---

## 1) main.pjs — import the AI plugin

Add this line near the top (keep it as a bare top-level assignment):

```pjs
generateText = {import:ai-text-plugin}
```

> ⚠️ This imports the free ai-text-plugin. It shows a small ad for visitors who
> are **not** logged into Perchance, and generation needs an internet connection.

---

## 2) index.html — markup

Add this anywhere (it's `position: fixed`, so placement in the HTML doesn't
matter — put it right before `</body>`/`</main>`):

```html
<button class="ask-ai-btn" id="askAiBtn" aria-label="Ask the AI" title="Ask the AI">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.4L22 18.3l-2.1.9L19 21.6l-.9-2.4-2.1-.9z"/></svg>
  <span>Ask AI</span>
</button>

<div class="ask-ai-shell" id="askAiShell" hidden>
  <div class="ask-ai-panel" role="dialog" aria-modal="true" aria-label="AI assistant">
    <header class="ask-ai-head">
      <div class="ask-ai-title">
        <span class="ask-ai-avatar" aria-hidden="true">✨</span>
        <div><strong>Ask the AI</strong><span class="ask-ai-sub">Questions about this template</span></div>
      </div>
      <button class="ask-ai-close" id="askAiCloseBtn" aria-label="Close" title="Close">✕</button>
    </header>
    <div class="ask-ai-msgs" id="askAiMsgs"></div>
    <div class="ask-ai-suggest" id="askAiSuggest"></div>
    <div class="ask-ai-input-row">
      <textarea id="askAiInput" rows="1" placeholder="Ask anything…" aria-label="Ask the AI"></textarea>
      <button class="ask-ai-send" id="askAiSendBtn" aria-label="Send" title="Send"></button>
    </div>
  </div>
</div>
```

---

## 3) index.html — styles

Add to your `<style>`. Set `--ask-accent` (and `--ask-accent-2`) to match your
theme; everything else adapts.

```css
.ask-ai-btn {
  --ask-accent: #8b5cf6; --ask-accent-2: #6366f1;
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483001;
  display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
  padding: 11px 17px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16);
  background: linear-gradient(135deg, var(--ask-accent), var(--ask-accent-2));
  color: #fff; font: 600 14px/1 system-ui, sans-serif;
  box-shadow: 0 10px 28px -8px rgba(0,0,0,.5);
  transition: transform .16s, box-shadow .16s, filter .16s;
}
.ask-ai-btn:hover { transform: translateY(-2px); filter: brightness(1.1); }

.ask-ai-shell {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483001;
  width: min(400px, calc(100vw - 32px)); height: min(600px, calc(100vh - 40px));
}
.ask-ai-panel {
  display: flex; flex-direction: column; height: 100%; border-radius: 20px; overflow: hidden;
  background: rgba(15,18,25,.94); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 30px 80px -18px rgba(0,0,0,.7);
  color: #eef0f6;
}
.ask-ai-shell:not([hidden]) .ask-ai-panel { animation: askAiIn .3s cubic-bezier(.2,.8,.3,1); }
@keyframes askAiIn { from { opacity: 0; transform: translateY(18px) scale(.97); } to { opacity: 1; transform: none; } }

.ask-ai-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 15px; border-bottom: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); }
.ask-ai-title { display: flex; align-items: center; gap: 11px; min-width: 0; }
.ask-ai-avatar { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 18px; flex-shrink: 0; background: linear-gradient(135deg, rgba(139,92,246,.32), rgba(56,189,248,.26)); border: 1px solid rgba(139,92,246,.45); }
.ask-ai-title strong { font-size: 15.5px; display: block; line-height: 1.2; }
.ask-ai-sub { font-size: 11.5px; opacity: .65; }
.ask-ai-close { width: 32px; height: 32px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: transparent; color: inherit; cursor: pointer; font-size: 18px; line-height: 1; display: grid; place-items: center; }
.ask-ai-close:hover { background: rgba(255,255,255,.08); }

.ask-ai-msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.ask-ai-msg { max-width: 88%; padding: 11px 14px; border-radius: 16px; font-size: 14px; line-height: 1.55; word-wrap: break-word; white-space: pre-wrap; }
.ask-ai-msg.user { align-self: flex-end; background: linear-gradient(135deg, var(--ask-accent, #8b5cf6), var(--ask-accent-2, #6366f1)); color: #fff; border-bottom-right-radius: 6px; }
.ask-ai-msg.ai { align-self: flex-start; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-bottom-left-radius: 6px; }
.ask-ai-msg.ai a { color: #a78bfa; font-weight: 600; text-decoration: underline; }
.ask-ai-typing { display: inline-flex; gap: 5px; align-items: center; padding: 3px 2px; }
.ask-ai-typing i { width: 7px; height: 7px; border-radius: 50%; background: #a78bfa; animation: askAiBlink 1.1s infinite; }
.ask-ai-typing i:nth-child(2) { animation-delay: .18s; }
.ask-ai-typing i:nth-child(3) { animation-delay: .36s; }
@keyframes askAiBlink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

.ask-ai-suggest { display: flex; gap: 8px; padding: 0 15px 10px; flex-wrap: wrap; }
.ask-ai-suggest-chip { font: 500 12.5px/1.3 system-ui, sans-serif; color: inherit; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 7px 12px; cursor: pointer; opacity: .85; }
.ask-ai-suggest-chip:hover { opacity: 1; background: rgba(255,255,255,.1); }

.ask-ai-input-row { display: flex; gap: 10px; align-items: flex-end; padding: 11px 15px 14px; border-top: 1px solid rgba(255,255,255,.1); }
.ask-ai-input-row textarea { flex: 1; resize: none; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); color: inherit; border-radius: 14px; padding: 11px 14px; font: inherit; font-size: 14px; line-height: 1.45; max-height: 120px; outline: none; }
.ask-ai-input-row textarea:focus { border-color: #8b5cf6; }
.ask-ai-input-row textarea::placeholder { opacity: .5; }
.ask-ai-send { width: 42px; height: 42px; border-radius: 13px; border: none; background: linear-gradient(135deg, var(--ask-accent, #8b5cf6), var(--ask-accent-2, #6366f1)); color: #fff; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; }
.ask-ai-send:disabled { opacity: .45; cursor: not-allowed; }

@media (max-width: 560px) {
  .ask-ai-shell { right: 10px; bottom: 10px; width: calc(100vw - 20px); height: calc(100vh - 20px); }
}
```

---

## 4) index.html — the JavaScript

Add a new `<script>` block. **Edit `KNOWLEDGE` and `SUGGESTIONS` first.**

```html
<script>
  // ✏️ 1. Describe your template/generator here. The AI answers ONLY from this text.
  const KNOWLEDGE = `
This is a Perchance template called MY TEMPLATE.
What it does: <describe your generator — features, controls, gameplay, output>.
How to use it: <step-by-step basics>.
What you can build with it: <who is this for, what can they make>.
`;

  // ✏️ 2. Suggested questions shown as clickable chips on first open.
  const SUGGESTIONS = [
    "What can I build with this?",
    "How do I get started?",
    "What are the main features?",
    "Is there an app that does this?",
  ];

  // ── no need to edit below here ──────────────────────────────
  const aiBtn = document.getElementById("askAiBtn");
  const aiShell = document.getElementById("askAiShell");
  const aiMsgs = document.getElementById("askAiMsgs");
  const aiInput = document.getElementById("askAiInput");
  const aiSendBtn = document.getElementById("askAiSendBtn");
  const aiCloseBtn = document.getElementById("askAiCloseBtn");
  const aiSuggest = document.getElementById("askAiSuggest");

  const SEND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
  const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  const PERSONA = `You are a friendly, concise AI assistant for this template. Answer questions using ONLY the knowledge below. If the knowledge doesn't contain the answer, say so honestly and suggest the closest thing it does cover. Keep replies short (usually 2-6 sentences). Never invent features that aren't in the knowledge.`;

  let chatLog = [];
  let summary = "";
  let busy = false;
  let gen = null;
  let meta = null;
  try { meta = root.generateText({ getMetaObject: true }); } catch (e) {}
  const KEEP = 8;
  let compacting = false;

  function buildPrompt(task) {
    const log = [summary ? `[Summary of the earlier conversation:\n${summary}]` : "", ...chatLog].filter(Boolean).join("\n\n");
    return `${PERSONA}

<KNOWLEDGE>
${KNOWLEDGE}
</KNOWLEDGE>

<CHAT>
${log}
</CHAT>

TASK: ${task}`;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderLinks(el, text) {
    let out = escapeHTML(text);
    const links = [];
    out = out.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => {
      const k = "%%L" + links.length + "%%";
      links.push(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
      return k;
    });
    out = out.replace(/https?:\/\/[^\s<]+/g, m => {
      const c = m.replace(/[),.;]+$/, "");
      return `<a href="${c}" target="_blank" rel="noopener">${c}</a>`;
    });
    links.forEach((h, i) => { out = out.split("%%L" + i + "%%").join(h); });
    el.innerHTML = out;
  }

  function scrollBottom() { aiMsgs.scrollTop = aiMsgs.scrollHeight; }

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "ask-ai-msg " + role;
    div.textContent = text;
    aiMsgs.appendChild(div);
    scrollBottom();
    return div;
  }

  function showTyping() {
    const div = document.createElement("div");
    div.className = "ask-ai-msg ai";
    div.innerHTML = '<span class="ask-ai-typing"><i></i><i></i><i></i></span>';
    aiMsgs.appendChild(div);
    scrollBottom();
    return div;
  }

  function setInputState() {
    aiSendBtn.disabled = busy;
    aiInput.disabled = busy;
    aiSendBtn.innerHTML = busy ? STOP_ICON : SEND_ICON;
    aiSendBtn.setAttribute("aria-label", busy ? "Stop generating" : "Send");
    aiSendBtn.title = busy ? "Stop generating" : "Send";
  }

  function autoGrow() {
    aiInput.style.height = "auto";
    aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + "px";
  }

  async function maybeCompact() {
    if (compacting || !meta || chatLog.length <= KEEP) return;
    if (meta.countTokens(buildPrompt("")) < meta.idealMaxContextTokens * 0.9) return;
    compacting = true;
    try {
      const n = chatLog.length - KEEP;
      const boundary = chatLog[n - 1].slice(-30);
      const res = await root.generateText(buildPrompt(`Summarize the first ${n} messages, stopping after the message ending with "${boundary}". Fold in the [Summary...] block if there is one. Terse bullets; preserve names, facts, and unresolved threads. Output ONLY the summary text.`));
      summary = res.text.trim();
      chatLog.splice(0, n);
    } catch (e) {} finally { compacting = false; }
  }

  async function send(text) {
    const msg = (text != null ? String(text) : aiInput.value).trim();
    if (busy || !msg) return;
    if (!root.generateText) {
      addMsg("ai", "Sorry, the AI isn't available right now. Please refresh and try again.");
      return;
    }
    aiInput.value = "";
    autoGrow();
    chatLog.push("User: " + msg);
    addMsg("user", msg);
    aiSuggest.innerHTML = "";
    const typing = showTyping();
    busy = true;
    setInputState();
    let streamed = false;
    try {
      gen = root.generateText({
        instruction: buildPrompt("Reply to the user's latest message as the AI assistant. Output ONLY the reply text."),
        onChunk: d => {
          if (!d.fullTextSoFar) return;
          if (!streamed) { typing.textContent = ""; streamed = true; }
          typing.textContent = d.fullTextSoFar;
          scrollBottom();
        },
      });
      const res = await gen;
      renderLinks(typing, (res && res.text ? res.text : "").trim());
      chatLog.push("AI: " + typing.textContent);
      maybeCompact();
    } catch (e) {
      typing.textContent = "Hmm, that request didn't go through. Mind trying again?";
    } finally {
      busy = false;
      gen = null;
      setInputState();
      scrollBottom();
    }
  }

  function welcome() {
    addMsg("ai", "Hi! I'm the AI guide for this template. Ask me how to use it, what you can build with it, or for recommendations.");
    for (const c of SUGGESTIONS) {
      const b = document.createElement("button");
      b.className = "ask-ai-suggest-chip";
      b.textContent = c;
      b.addEventListener("click", () => send(c));
      aiSuggest.appendChild(b);
    }
  }

  aiBtn.addEventListener("click", () => {
    aiShell.hidden = !aiShell.hidden;
    if (!aiShell.hidden) {
      if (!aiMsgs.children.length) welcome();
      aiInput.focus();
    }
  });
  aiCloseBtn.addEventListener("click", () => { aiShell.hidden = true; });
  aiSendBtn.addEventListener("click", () => { if (busy && gen) gen.stop(); else send(); });
  aiInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (busy && gen) gen.stop(); else send(); }
  });
  aiInput.addEventListener("input", autoGrow);
  setInputState();
</script>
```

---

## Customization checklist

- **`KNOWLEDGE`** — the most important part. Write it as plain text describing
  the generator. Be specific: features, controls, what it outputs, who it's for.
  The AI never answers outside this text, so it stays accurate.
- **`SUGGESTIONS`** — the chips shown before the first message.
- **Accent color** — change `--ask-accent` / `--ask-accent-2` in the CSS to match
  your template's palette (also used for the user bubbles and send button).
- **Button placement** — it floats bottom-right. To put it in a nav bar instead,
  change `.ask-ai-btn` from `position: fixed` to a static inline-flex button
  inside your nav, and bump `z-index` below your nav's if needed.
- **Nav version note** — if you place it in a nav, remove `position: fixed`,
  `right/bottom`, and the border-radius pill becomes your choice.

## Gotchas

- Requires internet; generation takes a few seconds — the typing dots show while it streams.
- One generation per user at a time (extra clicks queue); the busy state + stop button handles this.
- Ad shown to non-logged-in visitors (ai-text-plugin behavior).
- All class names are prefixed `ask-ai-` to avoid colliding with existing template styles.
