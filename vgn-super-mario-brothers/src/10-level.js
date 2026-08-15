
// 10-level.js -- the `Level` namespace: Super Mario Bros. World 1-1.
//
// PROVENANCE (this is transcribed data, not a reconstruction from memory):
//   Primary source: the Super Mario Bros. NES disassembly, area object data
//   `L_GroundArea6` and sprite data `E_GroundArea6` (both literally commented
//   ";level 1-1"), decoded with the parser semantics in the same file
//   (DecodeAreaData jump tables, VerticalPipe/GetPipeHeight, Hole_Empty,
//   StaircaseObject + StaircaseRowData/StaircaseHeightData, FlagpoleObject,
//   CastleObject, QuestionBlockRow_High).
//     https://github.com/nwoeanhinnogaehr/smb-assembler/blob/master/smbdis.asm
//   Cross-checked tile-for-tile against FullScreenMario's independently
//   hand-transcribed 1-1 map data (8 units == 1 tile there):
//     Source/settings/maps.js, area "1-1"
//   Every landmark agrees: first ? block col 16, mushroom col 21, pipes at
//   28/38/46/57 with heights 2/3/4/4, hidden 1-up col 64, pits 69-70 /
//   86-88 / 153-154, multi-coin brick col 94, star brick col 101, koopa
//   col 107, pyramids 134-143 / 148-158, pipes 163 & 179, final staircase
//   181-189 (heights 1..8,8), flagpole col 198, castle 202-206.
//
// COORDINATE MAPPING. SMB stores a 13-row playfield (level rows 0..12); the
// NES screen is 15 tiles tall with the 2-row status bar on top. So
//     grid row = smb row + 2
// which puts the "2 block floor" (smb rows 11-12) at grid rows 13-14, exactly
// where 00-core.js expects the ground. Every row below is derived that way.
//
// DELIBERATE DEVIATIONS, all surfaced rather than absorbed:
//   * 1-1 really has SIX pipes (2,3,4,4,2,2 tall), not four. The two extra
//     ones are the short pipes at cols 163 and 179 near the end. Both the
//     disassembly and FullScreenMario have them.
//   * 1-1 really has THREE bottomless holes, not two: 69-70, 86-88 and the
//     2-wide gap at 153-154 between the halves of the second block pyramid.
//   * INVIS_1UP is SOLID. Level.solidAt(col,row) is a pure predicate with no
//     direction argument (see Physics.stepY in 00-core.js), so "solid only
//     from below" is not expressible -- and a non-solid block can never
//     generate a hitTiles entry, i.e. could never be struck at all. It is
//     solid AND invisible, which is also what the original does (you can
//     stand on SMB's hidden blocks). 20-tiles.js must not draw it.
//   * Power-up ? blocks are recorded as 'mushroom'. The original resolves
//     one code (QuestionBlock/power-up) to mushroom-or-fire-flower at strike
//     time depending on Mario's power state; there is no per-block flower in
//     the data. Bucket 5 may upgrade 'mushroom' -> 'flower' when Mario is big.
//   * "2 Goombas separated horizontally by 8 pixels" (sprite code $37) is a
//     sub-tile offset. On a tile grid the closest honest rendering is a pair
//     at col and col+1, which is what SPAWNS contains.
//   * The hidden 1-up in the original is gated on Hidden1UpFlag; here it is
//     always present.
//   * WIDTH_COLS = 212 is NOT derivable from the object data (SMB areas have
//     no width field -- terrain is generated per column until the level-end
//     trigger fires). The data pins the castle at cols 202-206; 212 is the
//     commonly cited width for 1-1 and leaves 5 columns of ground past the
//     castle, so it is used here.
(function () {

  var TILE = {
    EMPTY: 0,
    GROUND: 1,
    BRICK: 2,
    QUESTION: 3,
    USED: 4,
    SOLID: 5,
    PIPE_TL: 6,
    PIPE_TR: 7,
    PIPE_BL: 8,
    PIPE_BR: 9,
    STAIR: 10,
    FLAGPOLE: 11,
    FLAGTOP: 12,
    COIN_BRICK: 13,
    INVIS_1UP: 14
  };

  // char -> TILE. The level below is one string per row, one char per tile,
  // so it is readable in source and reviewable in a diff.
  var LEGEND = {
    '.': TILE.EMPTY,
    '#': TILE.GROUND,      // floor, grid rows 13-14
    'B': TILE.BRICK,
    '?': TILE.QUESTION,
    'U': TILE.USED,
    'S': TILE.SOLID,       // flagpole base block
    '[': TILE.PIPE_TL, ']': TILE.PIPE_TR,
    '{': TILE.PIPE_BL, '}': TILE.PIPE_BR,
    'X': TILE.STAIR,       // staircases + the pyramids' columns of solid blocks
    '|': TILE.FLAGPOLE, 'T': TILE.FLAGTOP,
    'C': TILE.COIN_BRICK,  // the ~10-coin brick
    'H': TILE.INVIS_1UP    // hidden 1-up: solid, must not be drawn
  };

  var WIDTH_COLS = 212;
  var ROWS = 15;         // must equal Game.LEVEL_ROWS; checked in init()

  // Column ruler for the map below (marks every 10 columns, + every 5):
  // 0         10        20        30        40        50        60        70        80        90        100       110       120       130       140       150       160       170       180       190       200       210
  // |----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|----+----|-
  var MAP = [
    '....................................................................................................................................................................................................................', // row  0  sky
    '....................................................................................................................................................................................................................', // row  1  sky
    '......................................................................................................................................................................................................T.............', // row  2  flagpole ball (col 198)
    '......................................................................................................................................................................................................|.............', // row  3  flagpole shaft
    '......................................................................................................................................................................................................|.............', // row  4  flagpole shaft
    '......................?.........................................................BBBBBBBB...BBB?..............?...........BBB....B??B........................................................XX........|.............', // row  5  high blocks; 8-brick row 80-87; final-staircase top 188-189
    '...........................................................................................................................................................................................XXX........|.............', // row  6
    '..........................................................................................................................................................................................XXXX........|.............', // row  7
    '................................................................H........................................................................................................................XXXXX........|.............', // row  8  hidden 1-up (col 64, invisible)
    '................?...B?B?B.....................[].........[]..................B?B..............C.....BB....?..?..?.....B..........BB......X..X..........XX..X............BB?B............XXXXXX........|.............', // row  9  low block row; pipe tops; multi-coin brick 94; star brick 101
    '......................................[]......{}.........{}.............................................................................XX..XX........XXX..XX..........................XXXXXXX........|.............', // row 10
    '............................[]........{}......{}.........{}............................................................................XXX..XXX......XXXX..XXX.....[]..............[].XXXXXXXX........|.............', // row 11
    '............................{}........{}......{}.........{}...........................................................................XXXX..XXXX....XXXXX..XXXX....{}..............{}XXXXXXXXX........S.............', // row 12  flagpole base block at col 198
    '#####################################################################..###############...################################################################..#########################################################', // row 13  floor  (gaps = the three bottomless pits)
    '#####################################################################..###############...################################################################..#########################################################' // row 14  floor
  ];

  // ---- item contents, one entry per strikeable block that holds something.
  // Read straight off the object codes in the disassembly, not assigned by
  // eye: $00 QuestionBlock/power-up, $01 QuestionBlock/coin, $03
  // Hidden1UpBlock, $06 BrickWithItem/star, $07 BrickWithCoins.
  var CONTENTS_MASTER = {
    '16,9': 'coin',   // first ? block (isolated, low)
    '21,9': 'mushroom',   // MUSHROOM - first power-up in the game
    '22,5': 'coin',   // the lone high ? block above the first row
    '23,9': 'coin',
    '64,8': '1up',   // HIDDEN 1-UP block (invisible, still solid)
    '78,9': 'mushroom',   // second power-up ? block
    '94,5': 'coin',
    '94,9': 'coin10',   // MULTI-COIN BRICK (~10 coins)
    '101,9': 'star',   // STAR brick
    '106,9': 'coin',
    '109,5': 'mushroom',   // third power-up ? block
    '109,9': 'coin',
    '112,9': 'coin',
    '129,5': 'coin',   // QuestionBlockRow_High, 2 wide
    '130,5': 'coin',   // QuestionBlockRow_High, 2 wide
    '170,9': 'coin'
  };

  // ---- enemies + the two end-of-level anchors bucket 3 draws from.
  // Enemy columns/rows come from E_GroundArea6; sprite $06 = Goomba,
  // $00 = green Koopa Troopa, $37 = 2 Goombas. Rows are the tile each
  // enemy settles on (the raw data spawns them a little higher and lets
  // them fall).
  var SPAWNS_MASTER = [
    { kind: 'goomba', col: 22, row: 12 },
    { kind: 'goomba', col: 40, row: 12 },
    { kind: 'goomba', col: 54, row: 12 },
    { kind: 'goomba', col: 55, row: 12 },
    { kind: 'goomba', col: 80, row: 4 },
    { kind: 'goomba', col: 82, row: 4 },
    { kind: 'goomba', col: 100, row: 12 },
    { kind: 'goomba', col: 101, row: 12 },
    { kind: 'koopa', col: 107, row: 12 },
    { kind: 'goomba', col: 117, row: 12 },
    { kind: 'goomba', col: 118, row: 12 },
    { kind: 'goomba', col: 127, row: 12 },
    { kind: 'goomba', col: 128, row: 12 },
    { kind: 'goomba', col: 131, row: 12 },
    { kind: 'goomba', col: 132, row: 12 },
    { kind: 'goomba', col: 177, row: 12 },
    { kind: 'goomba', col: 178, row: 12 },
    { kind: 'flagpole', col: 198, row: 2 },
    { kind: 'castle', col: 202, row: 8 }
  ];

  // ---- solidity. The single source of truth for collision.
  var SOLID_TYPES = [];
  (function () {
    var i;
    for (i = 0; i <= 14; i++) SOLID_TYPES[i] = false;
    SOLID_TYPES[TILE.GROUND] = true;
    SOLID_TYPES[TILE.BRICK] = true;
    SOLID_TYPES[TILE.QUESTION] = true;
    SOLID_TYPES[TILE.USED] = true;
    SOLID_TYPES[TILE.SOLID] = true;
    SOLID_TYPES[TILE.PIPE_TL] = true;
    SOLID_TYPES[TILE.PIPE_TR] = true;
    SOLID_TYPES[TILE.PIPE_BL] = true;
    SOLID_TYPES[TILE.PIPE_BR] = true;
    SOLID_TYPES[TILE.STAIR] = true;
    SOLID_TYPES[TILE.COIN_BRICK] = true;
    SOLID_TYPES[TILE.INVIS_1UP] = true;   // solid but invisible -- see header
    // EMPTY / FLAGPOLE / FLAGTOP are not solid.
  })();

  // ---- runtime grid: one Uint8Array per row, materialised once.
  var grid = [];

  function buildGrid() {
    var row, col, line, ch, t;
    for (row = 0; row < ROWS; row++) {
      if (!grid[row]) grid[row] = new Uint8Array(WIDTH_COLS);
      line = MAP[row];
      for (col = 0; col < WIDTH_COLS; col++) {
        ch = line.charAt(col);
        t = LEGEND[ch];
        grid[row][col] = (t === undefined) ? TILE.EMPTY : t;
      }
    }
  }

  var Level = {
    TILE: TILE,
    WIDTH_COLS: WIDTH_COLS,
    ROWS: ROWS,
    SPAWNS: [],
    CONTENTS: {}
  };
  window.Level = Level;

  // Restore SPAWNS / CONTENTS in place -- bucket 5 may hold a reference to
  // either object, so they are mutated, never replaced.
  function resetTables() {
    var k, i;
    for (k in Level.CONTENTS) {
      if (Object.prototype.hasOwnProperty.call(Level.CONTENTS, k)) delete Level.CONTENTS[k];
    }
    for (k in CONTENTS_MASTER) {
      if (Object.prototype.hasOwnProperty.call(CONTENTS_MASTER, k)) Level.CONTENTS[k] = CONTENTS_MASTER[k];
    }
    Level.SPAWNS.length = 0;
    for (i = 0; i < SPAWNS_MASTER.length; i++) {
      Level.SPAWNS.push({
        kind: SPAWNS_MASTER[i].kind,
        col: SPAWNS_MASTER[i].col,
        row: SPAWNS_MASTER[i].row
      });
    }
  }

  // Built eagerly so tileAt/solidAt are correct even if init() is never
  // called (script load order must not be able to break collision).
  buildGrid();
  resetTables();

  // Idempotent: also the "restart the level" hook -- rebuilding from MAP
  // restores broken bricks, used ? blocks and consumed contents.
  Level.init = function () {
    buildGrid();
    resetTables();
    if (window.Game && window.Game.LEVEL_ROWS && window.Game.LEVEL_ROWS !== ROWS) {
      // Loud, but non-fatal: every row index in MAP assumes 15.
      if (window.console) console.warn('Level: Game.LEVEL_ROWS=' + window.Game.LEVEL_ROWS + ' but MAP has ' + ROWS + ' rows');
    }
  };

  Level.tileAt = function (col, row) {
    if (col < 0 || col >= WIDTH_COLS) return TILE.EMPTY;
    if (row < 0 || row >= ROWS) return TILE.EMPTY;   // below row 14 -> EMPTY (pits are bottomless)
    return grid[row][col];
  };

  Level.setTile = function (col, row, t) {
    if (col < 0 || col >= WIDTH_COLS || row < 0 || row >= ROWS) return;
    grid[row][col] = t;
  };

  Level.solidAt = function (col, row) {
    if (col < 0 || col >= WIDTH_COLS || row < 0 || row >= ROWS) return false;
    return SOLID_TYPES[grid[row][col]] === true;
  };

  // Whole level at 1px/tile -- the accuracy check.
  Level.debugMinimap = function (ctx) {
    if (!ctx) return;
    var row, col, t;
    for (row = 0; row < ROWS; row++) {
      for (col = 0; col < WIDTH_COLS; col++) {
        t = grid[row][col];
        if (t === TILE.EMPTY) continue;
        if (t === TILE.INVIS_1UP) ctx.fillStyle = "#ff00ff";
        else if (t === TILE.FLAGPOLE || t === TILE.FLAGTOP) ctx.fillStyle = "#00a800";
        else if (t === TILE.QUESTION || t === TILE.COIN_BRICK) ctx.fillStyle = "#ffd800";
        else if (t === TILE.BRICK) ctx.fillStyle = "#c84c0c";
        else if (SOLID_TYPES[t]) ctx.fillStyle = "#ffffff";
        else ctx.fillStyle = "#888888";
        ctx.fillRect(col, row, 1, 1);
      }
    }
  };

})();
