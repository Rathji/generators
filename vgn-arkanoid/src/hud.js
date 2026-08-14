// ============================================================================
//  src/hud.js — the score / lives / timer HUD strip
//  ----------------------------------------------------------------------------
//  The shell's HUD is four values, all driven by the GAME MODULE via ctx.hud:
//      ctx.hud.setScore(n)      ctx.hud.addScore(n)
//      ctx.hud.setLives(n)      ctx.hud.setTimer(seconds)
//      ctx.hud.setExtra(text)   free-form second line (tips, objectives, ...)
//  The engine reads hud.score when a run ends (for high-score bookkeeping).
//  All values are zero-padded and CRT-styled by index.html's CSS.
//  ============================================================================

export function pad6(n) {
  return String(Math.max(0, Math.floor(n))).padStart(6, '0');
}

export class HUD {
  constructor({ hudEl, scoreEl, livesEl, timerEl, extraEl }) {
    this.el = hudEl;
    this.scoreEl = scoreEl;
    this.livesEl = livesEl;
    this.timerEl = timerEl;
    this.extraEl = extraEl;
    this.score = 0;
  }

  show() {
    this.el.classList.remove('off');
  }

  hide() {
    this.el.classList.add('off');
  }

  setScore(n) {
    this.score = n;
    this.scoreEl.textContent = 'SCORE ' + pad6(n);
  }

  addScore(n) {
    this.setScore(this.score + n);
  }

  setLives(n) {
    this.livesEl.textContent = '1UP ×' + n;
  }

  setTimer(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    this.timerEl.textContent = m + ':' + String(s % 60).padStart(2, '0');
    // the last ten seconds flash red
    this.timerEl.classList.toggle('danger', seconds > 0 && seconds <= 10);
  }

  // Set the timer slot to arbitrary text (e.g. "LEVEL 2", "TO 7") — for
  // games that use that slot for something other than a countdown.
  setTimerRaw(text) {
    this.timerEl.textContent = text;
    this.timerEl.classList.remove('danger');
  }

  setExtra(text) {
    this.extraEl.textContent = text;
  }
}
