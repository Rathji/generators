// Validation tests for Task #79: Combat Text Scrolling System (typewriter).

import { TextScroller } from "../engine/text-scroller.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // Manual mode: deterministic stepping, no timers.
  const chars = [];
  const lines = [];
  const scroller = new TextScroller({ manual: true, cps: 10, onChar: (ch) => chars.push(ch), onLine: (l) => lines.push(l) });

  check("not typing when idle", !scroller.isTyping);
  scroller.push("abc");
  check("typing after push", scroller.isTyping === true);
  check("first char revealed immediately", chars.length === 1 && chars[0] === "a");

  // 100ms at 10cps = 1 char.
  scroller.step(100);
  check("step reveals per char rate", chars.join("") === "ab");
  scroller.step(500);
  check("full line revealed", chars.join("") === "abc" && lines.length === 1);

  // Queued lines continue.
  scroller.push("xyz");
  scroller.step(1000);
  check("queued line revealed", chars.join("") === "abcxyz");

  // skip() finishes the current line instantly.
  const s2 = new TextScroller({ manual: true, cps: 10 });
  s2.push("hello");
  s2.skip();
  check("skip completes current line", s2.currentLine === null && !s2.isTyping);

  // flush() drains everything including queued lines.
  const s3 = new TextScroller({ manual: true, cps: 10 });
  s3.push("one");
  s3.push("two");
  s3.flush();
  check("flush reveals all queued text", s3.done === true && !s3.isTyping);

  // remaining() reports untyped characters.
  const s4 = new TextScroller({ manual: true, cps: 10 });
  s4.push("abcdef");
  s4.step(200); // 2 chars
  check("remaining counts untyped chars", s4.remaining === 3);

  // Auto mode uses timers and drives onDone (tested with short timers).
  const auto = new TextScroller({ cps: 1000, chunkMs: 5 });
  auto.push("done");
  return new Promise((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (!auto.isTyping) {
        clearInterval(timer);
        const elapsed = Date.now() - t0;
        check("auto mode completes line", auto.done === true);
        check("auto mode completes quickly", elapsed < 2000);
        resolve(out);
      }
    }, 10);
  });
}
