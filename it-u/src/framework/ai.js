// src/framework/ai.js — the "Ask AI" button and its question panel.
//
// Every station (list and detail) and every Settings section carries an
// "Ask AI" button next to the "?" help button. It opens a small chat panel
// scoped to THAT screen: the assistant is given a bounded digest of the live
// context (see framework/ai-context.js) plus the conversation so far, and the
// user's question is appended last — a shape that keeps the bulk of the prompt
// cacheable across questions on the same screen.
//
// The model call goes through the ai-text-plugin (root.generateText). This
// module never throws into the UI: if the plugin is unavailable or a generation
// fails, the panel shows a plain, actionable error bubble.

import { h } from "./dom.js";
import { icons } from "./icons.js";
import { openModal } from "../modules/shared.js";
import { buildScreenContext, hasContext } from "./ai-context.js";

const SYSTEM_PROMPT = [
  "You are IT-U's built-in assistant, embedded in a Technology Solutions Provider's (TSP) client-documentation system. IT-U keeps ONE versioned \"documentation set\" per client, holding typed, relationship-linked records — organizations, locations, contacts, configurations & devices, flexible assets, credentials, documents, domains, certificates, sites, diagrams, checklists and deployment runbooks — plus lifecycle/expiry trackers and PSA/RMM integrations.",
  "",
  "How to answer:",
  "- Answer ONLY from the CONTEXT section below. It is a compact digest of the live repository for the current screen, so it may omit some detail.",
  "- Use the real names, values, dates and counts from the context. Never invent credentials, IP addresses, hostnames, dates, names or record IDs.",
  "- Never reveal or guess a password, secret, key or token. If asked, name the credential and say where it is stored, and tell the user to reveal it in IT-U instead.",
  "- If the answer is not in the context, say so clearly, and tell the user which IT-U station or screen would hold it.",
  "- You cannot edit data. If the user asks for a change, give the exact steps to make it in IT-U.",
  "- Be concise and practical — short paragraphs or bullets. Use TSP/MSP terminology (client, configuration, credential, runbook, lifecycle).",
].join("\n");

// Assemble the full instruction for one generation: the system preamble and the
// static screen context form a stable, cacheable prefix; the conversation is
// append-only; the task sits at the very end. When the transcript would exceed
// the model budget the OLDEST messages are dropped (a deliberate, occasional
// prefix change) rather than truncating the context.
export function buildPrompt(context, turns = [], meta = null) {
  const head =
    SYSTEM_PROMPT +
    "\n\n=== CONTEXT · " +
    context.title +
    (context.subtitle ? " · " + context.subtitle : "") +
    " ===\n" +
    (context.digest || "(no context available)") +
    "\n=== END CONTEXT ===";
  const task =
    "\n\nTASK: Write the ASSISTANT's reply to the USER's most recent message, using only the CONTEXT above. If the context does not contain the answer, say so plainly and point the user to the right place in IT-U. Be concise and practical.";
  const budget = ((meta && meta.idealMaxContextTokens) || 6000) * 0.9;
  const count = (meta && meta.countTokens) || ((s) => Math.ceil(String(s).length / 4));
  let kept = Array.isArray(turns) ? turns.slice() : [];
  let omitted = false;
  const render = () => {
    const log = kept.map((t) => (t.role === "user" ? "USER: " : "ASSISTANT: ") + t.text).join("\n\n");
    const convo =
      "\n\n=== CONVERSATION ===\n" +
      (omitted ? "[Earlier messages omitted to stay within budget.]\n\n" : "") +
      log +
      "\n=== END CONVERSATION ===";
    return head + convo + task;
  };
  while (kept.length > 2 && count(render()) > budget) {
    kept = kept.slice(2);
    omitted = true;
  }
  return render();
}

// The "Ask AI" button. Kept a labelled pill so it reads as an action (unlike the
// compact "?" help button beside it).
export function askButton(key, { label = "Ask AI", ctx = null, sub = null } = {}) {
  return h(
    "button",
    {
      class: "kb-btn kb-ask-btn",
      type: "button",
      title: "Ask AI about this page",
      "aria-label": "Ask AI about this page",
      dataset: { ask: key },
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAsk(key, { ctx, sub });
      },
    },
    h("span", { class: "kb-ask-btn-icon", html: icons.sparkle }),
    label,
  );
}

// Inject an "Ask AI" button into the first .kb-view-title-row inside
// `container`, immediately left of the help "?" so the right edge stays tidy.
export function attachAsk(container, key, opts = {}) {
  if (!container || !hasContext(key)) return false;
  const row = container.querySelector(".kb-view-title-row");
  if (!row) return false;
  if (row.querySelector(".kb-ask-btn")) return true;
  const btn = askButton(key, opts);
  const help = row.querySelector(".kb-help-btn");
  if (help) row.insertBefore(btn, help);
  else row.append(btn);
  return true;
}

// Inject an "Ask AI" into the section head of every card that has context.
export function attachSectionAsk(container = document, { prefix = "settings", attr = "card", ctx = null } = {}) {
  if (!container) return 0;
  let n = 0;
  for (const card of container.querySelectorAll("[data-" + attr + "]")) {
    const value = card.dataset[attr];
    if (!value) continue;
    const key = prefix ? prefix + ":" + value : value;
    if (!hasContext(key)) continue;
    const head = card.querySelector(".kb-section-head");
    if (!head || head.querySelector(".kb-ask-btn")) continue;
    const btn = askButton(key, { ctx });
    btn.classList.add("kb-ask-btn--sm");
    const title = head.querySelector(".kb-section-name");
    if (title && title.nextSibling) title.after(btn);
    else head.append(btn);
    n += 1;
  }
  return n;
}

let openPanel = null;

export function openAsk(key, { ctx = null, sub = null } = {}) {
  if (openPanel && openPanel.overlay && openPanel.overlay.isConnected) openPanel.close();
  const state = { key, ctx, sub, turns: [], busy: false, stopFn: null, context: null };

  const contextChip = h("div", { class: "kb-ask-context" }, h("span", { class: "spinner spinner-sm kb-ask-spin" }), h("span", null, "Preparing context…"));
  const log = h("div", { class: "kb-ask-log", id: "kbAskLog" });
  const suggest = h("div", { class: "kb-ask-suggest", id: "kbAskSuggest" });
  const input = h("textarea", {
    class: "kb-input kb-ask-input",
    id: "kbAskInput",
    rows: 3,
    placeholder: "Ask a question about this page…  (Enter to send, Shift+Enter for a new line)",
  });
  const sendBtn = h("button", { class: "kb-btn kb-btn-primary kb-ask-send", type: "button", id: "kbAskSend" }, "Ask");
  const root = h(
    "div",
    { class: "kb-ask" },
    contextChip,
    log,
    suggest,
    h("div", { class: "kb-ask-compose" }, input, sendBtn),
  );

  const modal = openModal({
    title: "Ask AI",
    description: "Ask questions about what is on this page — the assistant answers from the data and the data model shown here.",
    wide: true,
    children: [root],
  });
  const titleEl = modal.overlay.querySelector(".kb-modal-title");
  const descEl = modal.overlay.querySelector(".kb-modal-text");

  const ready = buildScreenContext(key, { ctx, sub }).then((c) => {
    state.context = c;
    if (titleEl) titleEl.textContent = "Ask AI — " + c.title;
    if (descEl) descEl.textContent = c.subtitle ? c.subtitle : "Ask questions about what is on this page.";
    contextChip.replaceChildren(h("span", { class: "kb-ask-ctx-icon", html: icons.sparkle }), h("span", null, "Using: " + c.title + (c.subtitle ? " · " + c.subtitle : "")));
    renderSuggestions(c.suggestions || []);
    return c;
  });

  function renderSuggestions(list) {
    suggest.replaceChildren();
    if (!list || !list.length) {
      suggest.hidden = true;
      return;
    }
    suggest.hidden = false;
    for (const q of list) {
      suggest.append(
        h(
          "button",
          {
            class: "kb-ask-chip",
            type: "button",
            onClick: () => send(q),
          },
          q,
        ),
      );
    }
  }

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
  }

  function addUserTurn(text) {
    log.append(h("div", { class: "kb-ask-turn kb-ask-turn--user" }, h("div", { class: "kb-ask-bubble" }, text)));
    scrollLog();
  }

  function addAssistantTurn() {
    const dots = h("span", { class: "kb-ask-dots", "aria-label": "Generating…" }, h("span"), h("span"), h("span"));
    const body = h("div", { class: "kb-ask-bubble kb-ask-bubble--ai" }, dots);
    const turn = h("div", { class: "kb-ask-turn kb-ask-turn--ai" }, h("span", { class: "kb-ask-avatar", html: icons.sparkle }), body);
    log.append(turn);
    scrollLog();
    let text = "";
    return {
      text: () => text,
      chunk(c) {
        text += c;
        body.textContent = text;
        scrollLog();
      },
      finish(t) {
        if (t != null) text = t;
        body.textContent = text;
        scrollLog();
      },
      fail(msg) {
        const existing = text ? text + "\n\n" : "";
        body.textContent = existing + msg;
        body.classList.add("kb-ask-bubble--error");
        scrollLog();
      },
    };
  }

  function setBusy(b) {
    state.busy = b;
    input.disabled = b;
    sendBtn.classList.toggle("kb-ask-send--stop", b);
    sendBtn.textContent = b ? "Stop" : "Ask";
    for (const chip of suggest.querySelectorAll(".kb-ask-chip")) chip.disabled = b;
  }

  async function runAssistant() {
    setBusy(true);
    const bubble = addAssistantTurn();
    const gen = typeof window !== "undefined" && window.root && window.root.generateText;
    if (typeof gen !== "function") {
      bubble.fail("The AI assistant isn’t available yet. It needs the ai-text-plugin — save the generator, then reload and try again.");
      setBusy(false);
      return;
    }
    let meta = null;
    try {
      meta = gen({ getMetaObject: true });
    } catch {}
    const context = state.context || (await ready.catch(() => null));
    if (!context) {
      bubble.fail("Couldn’t prepare this page’s context, so there’s nothing to ask about yet.");
      setBusy(false);
      return;
    }
    const instruction = buildPrompt(context, state.turns, meta);
    try {
      const p = gen({
        instruction,
        onChunk: (d) => bubble.chunk(d.textChunk || ""),
      });
      state.stopFn = () => p && typeof p.stop === "function" && p.stop();
      const res = await p;
      const answer = String((res && (res.generatedText || res.text)) || bubble.text() || "").trim();
      bubble.finish(answer);
      if (answer) state.turns.push({ role: "assistant", text: answer });
    } catch (e) {
      const msg = String((e && e.message) || e);
      const aborted = /abort|stop|cancel/i.test(msg);
      bubble.fail(aborted ? "\n\n_(stopped)_" : "Something went wrong talking to the assistant: " + msg);
    } finally {
      state.stopFn = null;
      setBusy(false);
      input.focus();
    }
  }

  async function send(question) {
    const text = String(question == null ? input.value : question).trim();
    if (!text || state.busy) return;
    addUserTurn(text);
    state.turns.push({ role: "user", text });
    input.value = "";
    if (!suggest.hidden) suggest.hidden = true;
    await runAssistant();
  }

  sendBtn.addEventListener("click", () => {
    if (state.busy) {
      if (state.stopFn) state.stopFn();
      return;
    }
    send(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });

  modal.actions.append(
    h(
      "button",
      {
        class: "kb-btn kb-btn-ghost",
        type: "button",
        onClick: () => {
          state.turns = [];
          log.replaceChildren();
          renderSuggestions(state.context ? state.context.suggestions : []);
          input.focus();
        },
      },
      "Clear",
    ),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => modal.close() }, "Close"),
  );

  openPanel = { overlay: modal.overlay, close: modal.close };
  setTimeout(() => input.focus(), 60);
  return { ...modal, send, state, ready };
}
