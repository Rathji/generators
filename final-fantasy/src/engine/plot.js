import { StoryDirector } from "./events.js";

// Task #59: Plot-Critical Dialogue Sequence — the main questline runs as an
// ordered chain of chapters; each chapter only fires once its triggers are
// met, and the next chapter unlocks in chronological order after the previous
// one completes. Execution reuses the StoryDirector's step sequencer.

export class PlotSequenceSystem {
  constructor(plot = [], opts = {}) {
    this.chapters = plot;
    this.state = opts.state ?? null;
    this.handlers = opts.handlers ?? {};
    // Plot sequences run on their own sequencer so they never collide with
    // the milestone director's queue.
    this.director =
      opts.director ??
      new StoryDirector(
        { state: this.state, inventory: this.state?.inventory ?? null },
        {
          dialogue: (id) => this.handlers.dialogue?.(id, this.state),
          giveItem: (itemId, count) => this.handlers.giveItem?.(itemId, count, this.state),
          transition: (step) => this.handlers.transition?.(step, this.state),
          event: (name, payload, ctx) => this.handlers.event?.(name, payload, ctx, this.state),
        }
      );
    this.chapterIndex = 0;
    this.current = null; // active (started, unfinished) chapter
  }

  chapterById(id) {
    return this.chapters.find((c) => c.id === id) ?? null;
  }

  chapterByIndex(i) {
    return this.chapters[i] ?? null;
  }

  isDone(id) {
    const c = this.chapterById(id);
    if (!c) return false;
    return !!this.state && (c.doneFlag ? this.state.getFlag(c.doneFlag) : this.state.getFlag("plot_" + id + "_done"));
  }

  isStarted(id) {
    return !!this.state && this.state.getFlag("plot_" + id + "_started");
  }

  // Next chapter that hasn't been completed yet (chronological).
  nextChapter() {
    let i = this.chapterIndex;
    while (i < this.chapters.length) {
      if (!this.isDone(this.chapters[i].id)) return this.chapters[i];
      i++;
    }
    return null;
  }

  _triggersMet(chapter, opts = {}) {
    const st = this.state;
    for (const t of chapter.triggers ?? []) {
      if (t.type === "flag") {
        if (!st || !st.getFlag(t.flag)) return false;
      } else if (t.type === "notFlag") {
        if (st && st.getFlag(t.flag)) return false;
      } else if (t.type === "enterMap") {
        // Only satisfiable positionally, via check(mapId, x, y).
        if (opts.spatial !== true) return false;
      } else if (t.condition && typeof t.condition === "function") {
        if (!t.condition(this.state, this)) return false;
      }
    }
    return true;
  }

  // Called on movement/interaction to detect enterMap-triggered chapters.
  check(mapId, x, y) {
    const chapter = this.nextChapter();
    if (!chapter || this.isStarted(chapter.id)) return null;
    const trigger = (chapter.triggers ?? []).find(
      (t) => t.type === "enterMap" && t.mapId === mapId && t.x === x && t.y === y
    );
    if (!trigger) return null;
    if (!this._triggersMet(chapter, { spatial: true })) return null;
    return this.advance({ spatial: true });
  }

  // Start the current chapter if its triggers are met; returns the result.
  advance(opts = {}) {
    const chapter = this.nextChapter();
    if (!chapter) return null;
    if (this.isDone(chapter.id)) return null;
    if (this.isStarted(chapter.id)) {
      // already running — resume any blocking dialogue step
      if (this.director?.isRunning && this.director.isRunning()) {
        if (this.director.isWaiting && this.director.isWaiting()) this.director.resume();
      }
      return this._result(chapter);
    }
    if (!this._triggersMet(chapter, opts)) return { chapter: chapter.id, triggered: false };
    if (this.state) this.state.setFlag("plot_" + chapter.id + "_started", true);
    this.current = chapter;
    this._runSequence(chapter);
    return this._result(chapter);
  }

  _runSequence(chapter) {
    if (!chapter.sequence) return;
    if (this.director) {
      this.director.queue(chapter.sequence);
      const r = this.director.advance();
      if (r.done) this._complete(chapter);
    } else {
      // Minimal built-in runner for simple setFlag/dialogue sequences.
      for (const step of chapter.sequence) {
        this._runStep(chapter, step);
        if (step.blocking) break;
      }
    }
  }

  _runStep(chapter, step) {
    switch (step.type) {
      case "setFlag":
        if (this.state) this.state.setFlag(step.flag, step.value ?? true);
        break;
      case "giveItem":
        if (this.state?.inventory) this.state.inventory.add(step.itemId, step.count ?? 1);
        else if (this.handlers.giveItem) this.handlers.giveItem(step.itemId, step.count ?? 1);
        break;
      case "dialogue":
        if (this.handlers.dialogue) this.handlers.dialogue(step.dialogueId, this.state);
        break;
      case "transition":
        if (this.handlers.transition) this.handlers.transition(step, this.state);
        break;
      default:
        break;
    }
  }

  // Call after a blocking dialogue closes to keep the chapter moving.
  resume() {
    const chapter = this.current;
    if (!chapter || !this.director) return this._result(chapter);
    if (this.director.isRunning && this.director.isRunning()) this.director.resume();
    if (!(this.director.isRunning && this.director.isRunning())) this._complete(chapter);
    return this._result(chapter);
  }

  _complete(chapter) {
    if (this.state) {
      this.state.setFlag(chapter.doneFlag ?? "plot_" + chapter.id + "_done", true);
    }
    this.current = null;
    this.chapterIndex = Math.max(this.chapterIndex, this.chapters.indexOf(chapter) + 1);
  }

  _result(chapter) {
    const running = this.director?.isRunning?.() ?? false;
    const waiting = this.director?.isWaiting?.() ?? false;
    return {
      chapter: chapter.id,
      name: chapter.name,
      triggered: true,
      started: this.isStarted(chapter.id),
      done: this.isDone(chapter.id),
      running,
      waiting,
    };
  }

  isRunning() {
    return !!(this.current && this.director?.isRunning?.());
  }

  progress() {
    return {
      total: this.chapters.length,
      done: this.chapters.filter((c) => this.isDone(c.id)).length,
      current: this.nextChapter()?.id ?? null,
      currentName: this.nextChapter()?.name ?? null,
    };
  }

  reset() {
    this.chapterIndex = 0;
    this.current = null;
    return this;
  }
}
