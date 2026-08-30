// Webuntu OS — Minesweeper (POST-52, Task 55)
// A fully playable classic minesweeper, replacing the Task-48 "planned" stub.
//   - Beginner 9x9/10 · Intermediate 16x16/40 · Expert 30x16/99
//   - first-click-safe mine placement (clicked cell + neighbours stay empty)
//   - left-click reveal + flood-fill, right-click flag/question (long-press on
//     touch), chording (click a revealed number with its flag count to open
//     the remaining neighbours), smiley reset, mines counter + timer, per-
//     difficulty best times in localStorage, and keyboard play (arrows + Enter
//     to reveal, F to flag).
// The board cell size adapts to the window width (ResizeObserver) so every
// difficulty fits; the interval is torn down on window close.

(function () {
  "use strict";

  const DIFFS = {
    beginner: { name: "Beginner", rows: 9, cols: 9, mines: 10 },
    intermediate: { name: "Intermediate", rows: 16, cols: 16, mines: 40 },
    expert: { name: "Expert", rows: 16, cols: 30, mines: 99 },
  };
  const BEST_KEY = "webuntu.ms.best";
  const FACE = { ready: "🙂", press: "😮", win: "😎", lose: "😵" };
  const NUM_COLOR = ["", "#4f8cff", "#2fc98a", "#ff5c6c", "#7c6cff", "#e0556e", "#22d3ee", "#f59e0b", "#9aa5b1"];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- persistence ----------
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveBest(best) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) {}
  }

  // ---------- game ----------
  function Game(rows, cols, mines) {
    this.rows = rows;
    this.cols = cols;
    this.mines = mines;
    this.grid = [];
    this.flags = 0;
    this.revealed = 0;
    this.toReveal = rows * cols - mines;
    this.started = false;
    this.over = false;
    this.seconds = 0;
    this.timer = null;
    this.onChange = null;
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) row.push({ mine: false, adj: 0, shown: false, mark: 0 });
      this.grid.push(row);
    }
  }

  Game.prototype.reset = function () {
    const g = this;
    for (let i = 0; i < g.rows; i++)
      for (let j = 0; j < g.cols; j++) {
        const c = g.grid[i][j];
        c.mine = false; c.adj = 0; c.shown = false; c.mark = 0;
      }
    g.flags = 0; g.revealed = 0; g.started = false; g.over = false; g.seconds = 0;
    g.stopTimer();
    g.onChange && g.onChange();
  };

  Game.prototype.placeMines = function (safeI, safeJ) {
    const g = this;
    const safe = new Set();
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const ni = safeI + di, nj = safeJ + dj;
        if (ni >= 0 && ni < g.rows && nj >= 0 && nj < g.cols) safe.add(ni * g.cols + nj);
      }
    const cells = [];
    for (let i = 0; i < g.rows; i++)
      for (let j = 0; j < g.cols; j++)
        if (!safe.has(i * g.cols + j)) cells.push([i, j]);
    for (let k = 0; k < g.mines; k++) {
      const idx = Math.floor(Math.random() * cells.length);
      const [mi, mj] = cells.splice(idx, 1)[0];
      g.grid[mi][mj].mine = true;
    }
    for (let i = 0; i < g.rows; i++)
      for (let j = 0; j < g.cols; j++) {
        if (g.grid[i][j].mine) continue;
        let n = 0;
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && ni < g.rows && nj >= 0 && nj < g.cols && g.grid[ni][nj].mine) n++;
          }
        g.grid[i][j].adj = n;
      }
  };

  Game.prototype.start = function (i, j) {
    this.placeMines(i, j);
    this.started = true;
    const g = this;
    this.seconds = 0;
    this.timer = setInterval(() => {
      if (g.over) return;
      g.seconds = Math.min(999, g.seconds + 1);
      g.onChange && g.onChange();
    }, 1000);
  };

  Game.prototype.stopTimer = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  };

  Game.prototype.neighbours = function (i, j) {
    const out = [];
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const ni = i + di, nj = j + dj;
        if (ni >= 0 && ni < this.rows && nj >= 0 && nj < this.cols && (di || dj)) out.push([ni, nj]);
      }
    return out;
  };

  Game.prototype.reveal = function (i, j) {
    const g = this;
    if (g.over || g.grid[i][j].shown) return;
    if (g.grid[i][j].mark) return;                       // flagged cells are protected
    if (!g.started) g.start(i, j);                       // first click — mines placed now
    const cell = g.grid[i][j];
    if (cell.mine) { g.lose(i, j); return; }
    // flood-fill reveal of connected zero region
    const stack = [[i, j]];
    while (stack.length) {
      const [ci, cj] = stack.pop();
      const c = g.grid[ci][cj];
      if (c.shown || c.mark || c.mine) continue;
      c.shown = true;
      g.revealed++;
      if (c.adj === 0) for (const [ni, nj] of g.neighbours(ci, cj)) stack.push([ni, nj]);
    }
    if (g.revealed >= g.toReveal) g.win();
    g.onChange && g.onChange();
  };

  // Clicking a revealed number whose surrounding flags equal it opens the rest.
  Game.prototype.chord = function (i, j) {
    const g = this;
    const cell = g.grid[i][j];
    if (g.over || !cell.shown || cell.mine || cell.adj === 0) return;
    let flagCount = 0;
    for (const [ni, nj] of g.neighbours(i, j)) if (g.grid[ni][nj].mark === 1) flagCount++;
    if (flagCount !== cell.adj) return;
    for (const [ni, nj] of g.neighbours(i, j)) g.reveal(ni, nj);
  };

  Game.prototype.flag = function (i, j) {
    const g = this;
    const cell = g.grid[i][j];
    if (g.over || cell.shown) return;
    cell.mark = (cell.mark + 1) % 3;                     // none -> flag -> question
    g.flags = g.grid.reduce((acc, row) => acc + row.reduce((n, c) => n + (c.mark === 1 ? 1 : 0), 0), 0);
    g.onChange && g.onChange();
  };

  Game.prototype.win = function () {
    const g = this;
    g.over = true;
    g.stopTimer();
    for (let i = 0; i < g.rows; i++)
      for (let j = 0; j < g.cols; j++) {
        const c = g.grid[i][j];
        if (c.mine) c.mark = 1;                          // auto-flag remaining mines
        else c.mark = 0;                                 // clear wrong flags / questions
      }
    g.flags = g.mines;
    if (g.diffKey && g.seconds > 0) {                    // record per-difficulty best
      const best = loadBest();
      if (!best[g.diffKey] || g.seconds < best[g.diffKey]) {
        best[g.diffKey] = g.seconds;
        saveBest(best);
      }
    }
    g.onChange && g.onChange();
    if (window.Notify && g.seconds > 0) {                // task 58: win notification
      const dn = (g.diffKey && DIFFS[g.diffKey]) ? DIFFS[g.diffKey].name : "";
      window.Notify.push({
        app: "Minesweeper", icon: "💣", title: "Field cleared!",
        body: (dn ? dn + " · " : "") + g.seconds + "s",
        onClick() { if (window.Apps) window.Apps.launch("minesweeper"); },
      });
    }
  };

  Game.prototype.lose = function (boomI, boomJ) {
    const g = this;
    g.over = true;
    g.stopTimer();
    for (let i = 0; i < g.rows; i++)
      for (let j = 0; j < g.cols; j++) {
        const c = g.grid[i][j];
        if (c.mine) {
          c.shown = true;                                // reveal every mine
          c.wrongFlag = c.mark === 1 ? true : false;     // (flagged mines keep their flag below)
        } else if (c.mark === 1) {
          c.shown = true; c.wrongFlag = true;            // wrong flag — shown as a red-marked mine
        } else if (c.mark === 2) {
          c.shown = true;                                // question marks resolve to their number
        }
      }
    g.boom = [boomI, boomJ];
    g.onChange && g.onChange();
  };

  // ---------- view ----------
  function buildDom() {
    const rootEl = el("div", "ms");

    const top = el("div", "ms-top");
    const diffBtns = {};
    for (const key of ["beginner", "intermediate", "expert"]) {
      const b = el("button", "ms-diff", DIFFS[key].name);
      b.type = "button";
      b.dataset.diff = key;
      b.title = DIFFS[key].rows + "×" + DIFFS[key].cols + " · " + DIFFS[key].mines + " mines";
      top.appendChild(b);
      diffBtns[key] = b;
    }
    rootEl.appendChild(top);

    const hud = el("div", "ms-hud");
    const minesEl = el("span", "ms-digit", "010");
    const faceBtn = el("button", "ms-face", FACE.ready);
    faceBtn.type = "button";
    faceBtn.title = "New game";
    const timerEl = el("span", "ms-digit", "000");
    hud.append(minesEl, faceBtn, timerEl);
    rootEl.appendChild(hud);

    const boardWrap = el("div", "ms-board-wrap");
    const board = el("div", "ms-board");
    boardWrap.appendChild(board);
    rootEl.appendChild(boardWrap);

    const bestEl = el("div", "ms-best", "Best time: <b>—</b>");

    // ---------- game state ----------
    let game = new Game(DIFFS.beginner.rows, DIFFS.beginner.cols, DIFFS.beginner.mines);
    let curDiff = "beginner";
    let cellPx = 34;
    let pressCell = null;      // [i, j] under the pointer
    let longPress = false;     // touch long-press flagged this press

    function fmt(n) {
      const v = clamp(n, -99, 999);
      return (v < 0 ? "-" : "") + String(Math.abs(v)).padStart(3, "0");
    }

    function refreshBest() {
      const best = loadBest()[curDiff];
      bestEl.innerHTML = "Best time: <b>" + (best ? best + "s" : "—") + "</b>";
    }

    function drawCell(i, j) {
      const cell = game.grid[i][j];
      const btn = board.children[i * game.cols + j];
      btn.className = "ms-cell" + (cell.shown ? " on" : "");
      btn.textContent = "";
      btn.style.color = "";
      if (cell.shown) {
        if (cell.mine) {
          if (game.over && game.boom && game.boom[0] === i && game.boom[1] === j) {
            btn.textContent = "💣";
            btn.classList.add("dead");                   // the mine you clicked
          } else if (cell.mark === 1) {
            btn.textContent = "🚩";                      // correctly flagged mine keeps its flag
          } else {
            btn.textContent = "💣";
          }
        } else if (cell.wrongFlag) {
          btn.textContent = "🚩";                        // flagged a safe cell — red-marked
          btn.classList.add("wrong");
        } else if (cell.adj > 0) {
          btn.textContent = String(cell.adj);
          btn.style.color = NUM_COLOR[cell.adj];
          btn.classList.add("n" + cell.adj);
        }
      } else if (cell.mark === 1) {
        btn.textContent = "🚩";
        btn.style.fontSize = Math.max(13, Math.round(cellPx * 0.6)) + "px";
      } else if (cell.mark === 2) {
        btn.textContent = "❓";
        btn.style.fontSize = Math.max(13, Math.round(cellPx * 0.6)) + "px";
      }
      btn.style.fontSize = Math.max(11, Math.round(cellPx * 0.52)) + "px";
    }

    function paint() {
      minesEl.textContent = fmt(game.mines - game.flags);
      timerEl.textContent = fmt(game.seconds);
      faceBtn.textContent = game.over ? (game.revealed >= game.toReveal ? FACE.win : FACE.lose) : (pressCell ? FACE.press : FACE.ready);
      for (let i = 0; i < game.rows; i++)
        for (let j = 0; j < game.cols; j++) drawCell(i, j);
    }

    // ---------- board construction ----------
    function buildBoard() {
      board.textContent = "";
      board.style.gridTemplateColumns = "repeat(" + game.cols + ", var(--ms-cell))";
      board.style.gridAutoRows = "var(--ms-cell)";
      board.style.setProperty("--ms-cell", cellPx + "px");
      for (let i = 0; i < game.rows; i++)
        for (let j = 0; j < game.cols; j++) {
          const b = el("button", "ms-cell");
          b.type = "button";
          b.dataset.i = i;
          b.dataset.j = j;
          b.tabIndex = 0;
          board.appendChild(b);
        }
      fitCells();
      paint();
    }

    function fitCells() {
      const availW = boardWrap.clientWidth - 4;
      const availH = boardWrap.clientHeight - 4;
      const want = Math.min(
        Math.floor(availW / game.cols),
        Math.floor(availH / game.rows)
      );
      cellPx = clamp(want, 15, 44);
      board.style.setProperty("--ms-cell", cellPx + "px");
    }

    function setDiff(key) {
      curDiff = key;
      const d = DIFFS[key];
      for (const k in diffBtns) diffBtns[k].classList.toggle("active", k === key);
      game = new Game(d.rows, d.cols, d.mines);
      game.diffKey = key;
      game.onChange = function () { paint(); refreshBest(); };
      buildBoard();
      refreshBest();
    }

    // ---------- interactions ----------
    function cellAt(target) {
      if (!target || !target.closest) return null;
      const b = target.closest(".ms-cell");
      if (!b) return null;
      const i = +b.dataset.i, j = +b.dataset.j;
      if (i < 0 || i >= game.rows || j < 0 || j >= game.cols) return null;
      return [i, j, b];
    }

    function handleReveal(i, j) {
      const cell = game.grid[i][j];
      if (cell.shown) { game.chord(i, j); return; }      // chord on a number
      game.reveal(i, j);
    }
    function handleFlag(i, j) { game.flag(i, j); }

    // smiley resets the game (also used as a new-game button)
    function newGame() { setDiff(curDiff); }
    faceBtn.addEventListener("click", newGame);
    for (const b of top.querySelectorAll(".ms-diff")) {
      b.addEventListener("click", () => setDiff(b.dataset.diff));
    }

    // pointer (mouse + touch): press -> 😮, long-press flags on touch, release acts
    let downTimer = null;
    board.addEventListener("pointerdown", (e) => {
      const hit = cellAt(e.target);
      if (!hit) return;
      const [i, j] = hit;
      pressCell = [i, j];
      paint();
      longPress = false;
      clearTimeout(downTimer);
      if (e.pointerType === "touch") {
        downTimer = setTimeout(() => {
          if (!pressCell) return;
          longPress = true;
          handleFlag(i, j);
        }, 450);
      }
    });
    const clearPress = () => {
      clearTimeout(downTimer);
      if (pressCell) { pressCell = null; paint(); }
    };
    board.addEventListener("pointerup", (e) => {
      const hit = cellAt(e.target);
      clearTimeout(downTimer);
      if (!hit) { clearPress(); return; }
      const [i, j] = hit;
      const wasPress = pressCell;
      pressCell = null;
      paint();
      if (e.pointerType === "touch" && longPress) { longPress = false; return; }
      if (!wasPress) return;                              // only act if press started here
      handleReveal(i, j);
    });
    board.addEventListener("pointercancel", clearPress);
    board.addEventListener("pointerleave", clearPress);
    board.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const hit = cellAt(e.target);
      if (hit) handleFlag(hit[0], hit[1]);
    });

    // keyboard: arrows move focus, Enter/Space reveal, F flags
    board.addEventListener("keydown", (e) => {
      const hit = cellAt(document.activeElement);
      if (!hit) return;
      const [i, j] = hit;
      if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); (board.children[(i - 1) * game.cols + j]).focus(); }
      else if (e.key === "ArrowDown" && i < game.rows - 1) { e.preventDefault(); board.children[(i + 1) * game.cols + j].focus(); }
      else if (e.key === "ArrowLeft" && j > 0) { e.preventDefault(); board.children[i * game.cols + (j - 1)].focus(); }
      else if (e.key === "ArrowRight" && j < game.cols - 1) { e.preventDefault(); board.children[i * game.cols + (j + 1)].focus(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleReveal(i, j); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); handleFlag(i, j); }
    });

    // keep the board sized to the window: ResizeObserver + a settling poll +
    // window resize (RO alone can miss the initial layout, esp. while the
    // preview renderer is wedged)
    const ro = new ResizeObserver(() => { if (board.children.length) { fitCells(); paint(); } });
    ro.observe(boardWrap);
    const settleTimers = [0, 100, 300, 700].map((ms) =>
      setTimeout(() => { if (board.children.length) { fitCells(); paint(); } }, ms)
    );
    window.addEventListener("resize", onWinResize);
    function onWinResize() { if (board.children.length) { fitCells(); paint(); } }

    setDiff("beginner");
    rootEl.appendChild(bestEl);

    return { root: rootEl, timer: null, onCloseRequest: () => {
      clearTimeout(downTimer);
      ro.disconnect();
      settleTimers.forEach(clearTimeout);
      window.removeEventListener("resize", onWinResize);
    } };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["minesweeper"] = function () {
    const built = buildDom();
    return {
      content: built.root,
      w: 460, h: 600, minW: 320, minH: 440,
      onCloseRequest: built.onCloseRequest,
    };
  };
})();
