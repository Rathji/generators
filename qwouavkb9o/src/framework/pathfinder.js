// A* pathfinding - ported from BrowserQuest's astar.js (Andrea Giammarchi, MIT)
// 4-directional movement (Manhattan distance)

export function findPath(grid, start, end) {
  const cols = grid[0].length;
  const rows = grid.length;
  const limit = cols * rows;
  const f1 = Math.abs;
  const f2 = Math.max;
  const list = {};
  const result = [];
  let open = [{x: start[0], y: start[1], f: 0, g: 0, v: start[0] + start[1] * cols}];
  let length = 1;
  end = {x: end[0], y: end[1], v: end[0] + end[1] * cols};

  do {
    let max = limit, min = 0;
    for (let i = 0; i < length; ++i) {
      if ((open[i].f) < max) { max = open[i].f; min = i; }
    }
    let current = open.splice(min, 1)[0];
    if (current.v != end.v) {
      --length;
      const N = current.y - 1, S = current.y + 1, E = current.x + 1, W = current.x - 1;
      const $N = N > -1 && !grid[N][current.x];
      const $S = S < rows && !grid[S][current.x];
      const $E = E < cols && !grid[current.y][E];
      const $W = W > -1 && !grid[current.y][W];
      const next = [];
      let ni = 0;
      if ($N) next[ni++] = {x: current.x, y: N};
      if ($E) next[ni++] = {x: E, y: current.y};
      if ($S) next[ni++] = {x: current.x, y: S};
      if ($W) next[ni++] = {x: W, y: current.y};

      for (let i = 0, j = next.length; i < j; ++i) {
        const adj = next[i];
        adj.p = current;
        adj.f = adj.g = 0;
        adj.v = adj.x + adj.y * cols;
        if (!(adj.v in list)) {
          adj.f = (adj.g = current.g + (f1(adj.x - current.x) + f1(adj.y - current.y))) + (f1(adj.x - end.x) + f1(adj.y - end.y));
          open[length++] = adj;
          list[adj.v] = 1;
        }
      }
    } else {
      length = 0;
      let i = 0;
      do { result[i++] = [current.x, current.y]; } while (current = current.p);
      result.reverse();
    }
  } while (length);
  return result;
}

// Pathfinder with incomplete-path fallback
export class Pathfinder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.blankGrid = [];
    this.ignored = [];
    this._initBlankGrid();
  }

  _initBlankGrid() {
    for (let i = 0; i < this.height; i++) {
      this.blankGrid[i] = [];
      for (let j = 0; j < this.width; j++) this.blankGrid[i][j] = 0;
    }
  }

  findPath(grid, entity, x, y, findIncomplete) {
    const start = [entity.gridX, entity.gridY];
    const end = [x, y];
    this.grid = grid;
    this._applyIgnoreList(true);
    let path = findPath(this.grid, start, end);
    if (path.length === 0 && findIncomplete === true) {
      path = this._findIncompletePath(start, end);
    }
    return path;
  }

  _findIncompletePath(start, end) {
    let incomplete = [];
    const perfect = findPath(this.blankGrid, start, end);
    for (let i = perfect.length - 1; i > 0; i--) {
      const x = perfect[i][0], y = perfect[i][1];
      if (this.grid[y][x] === 0) {
        incomplete = findPath(this.grid, start, [x, y]);
        break;
      }
    }
    return incomplete;
  }

  ignoreEntity(entity) { if (entity) this.ignored.push(entity); }

  _applyIgnoreList(ignore) {
    for (const entity of this.ignored) {
      const x = entity.isMoving() ? entity.nextGridX : entity.gridX;
      const y = entity.isMoving() ? entity.nextGridY : entity.gridY;
      if (x >= 0 && y >= 0 && this.grid[y]) this.grid[y][x] = ignore ? 0 : 1;
    }
  }

  clearIgnoreList() { this._applyIgnoreList(false); this.ignored = []; }
}
