// Task #79: Combat Text Scrolling System — a typewriter effect for combat
// log lines. Non-blocking: lines are queued and revealed a few characters at
// a time on a fixed timer; the player can skip/flush. Engine is timing-
// agnostic (manual `step(dt)` for tests, timer-based in the UI).

export class TextScroller {
  constructor(opts = {}) {
    this.cps = opts.cps ?? 45; // characters per second
    this.chunkMs = opts.chunkMs ?? 60; // ms per reveal tick
    this.onChar = opts.onChar ?? null; // (char, lineIndex, charIndex) => void
    this.onLine = opts.onLine ?? null; // (line, index) => void
    this.onDone = opts.onDone ?? null;
    this.queue = [];
    this._current = null; // { index, text, pos }
    this._acc = 0;
    this._timer = null;
    this._manual = !!opts.manual;
    this.done = false;
  }

  get isTyping() {
    return !this.done && (this._current !== null || this.queue.length > 0);
  }

  get remaining() {
    return this.queue.length + (this._current ? this._current.text.length - this._current.pos : 0);
  }

  get currentLine() {
    return this._current ? this._current.text : null;
  }

  push(text) {
    this.queue.push(String(text));
    this.done = false;
    if (!this._current) this._startNext();
    return this;
  }

  pushAll(lines) {
    for (const l of lines) this.push(l);
    return this;
  }

  _startNext() {
    if (!this.queue.length) {
      this.done = true;
      if (this.onDone) this.onDone();
      return;
    }
    const text = this.queue.shift();
    this._current = { index: this.queue.length, text, pos: 0 };
    if (this.onLine) this.onLine(text, this._current.index);
    this._emit(1);
    if (!this._manual) this._startTimer();
  }

  _emit(delta) {
    const cur = this._current;
    if (!cur) return;
    for (let i = 0; i < delta && cur.pos < cur.text.length; i++) {
      if (this.onChar) this.onChar(cur.text[cur.pos], cur.index, cur.pos);
      cur.pos++;
    }
  }

  _startTimer() {
    if (this._timer) return;
    const tick = () => {
      if (!this._current) {
        clearInterval(this._timer);
        this._timer = null;
        return;
      }
      const perTick = Math.max(1, Math.round((this.cps * this.chunkMs) / 1000));
      this._emit(perTick);
      if (this._current && this._current.pos >= this._current.text.length) {
        const finished = this._current;
        this._current = null;
        if (this.onLineDone) this.onLineDone(finished.text);
        this._startNext();
      }
    };
    this._timer = setInterval(tick, this.chunkMs);
  }

  // Manual timing mode: advance the typewriter by `dtMs`.
  step(dtMs) {
    if (!this._manual || !this._current) return;
    this._acc += dtMs;
    const perMs = this.cps / 1000;
    const chars = Math.floor(this._acc * perMs);
    this._acc -= chars / perMs;
    this._emit(chars);
    if (this._current && this._current.pos >= this._current.text.length) {
      const finished = this._current;
      this._current = null;
      if (this.onLineDone) this.onLineDone(finished.text);
      this._startNext();
    }
  }

  // Instantly reveal the rest of the current line (and continue queue).
  skip() {
    const cur = this._current;
    if (!cur) return;
    this._emit(cur.text.length - cur.pos);
    if (this.onLineDone) this.onLineDone(cur.text);
    this._current = null;
    this._startNext();
  }

  // Reveal everything remaining immediately.
  flush() {
    while (this._current) this.skip();
    this.done = true;
    if (this.onDone) this.onDone();
    return this;
  }

  cancel() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.queue = [];
    this._current = null;
    this.done = true;
    return this;
  }
}
