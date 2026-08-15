
// 20-tiles.js -- Bucket 3: the `Tiles` namespace.
//
// Renders the SMB1 overworld look on top of Level's exact 1-1 geometry:
// backdrop parallax (hills/bushes/clouds), the visible-column tilemap,
// the castle + flag foreground layer, and the bump/coin-pop/question-pulse
// animations. See CONTRACT.md for the frozen interface.
//
// House style, matching 00-core.js/10-level.js: `var` everywhere (no bare
// top-level const/let), wrapped in a single IIFE, no cross-file reference
// at file-evaluation time -- Level/Game/Palette are only ever touched
// inside function bodies that run after all scripts have loaded.
//
// Art approach: each 16x16 tile is built once (lazily, on first draw call)
// as a fully-resolved pixel-color grid, painted into a small offscreen
// canvas, then blitted with drawImage every frame after that. This keeps
// per-frame cost to ~18 columns x 15 rows drawImage calls instead of
// thousands of fillRects.
(function () {

  var Tiles = {};
  window.Tiles = Tiles;

  // ---- state populated lazily by ensureInit() ----
  var ready = false;
  var caches = {};      // TILE value -> offscreen canvas
  var art = {};         // TILE value -> resolved pixel-color grid (array of 16 arrays of 16 hex/null)
  var questionCaches = null; // [canvas0, canvas1, canvas2] pulse frames
  var questionArt = null;    // matching resolved grids, for verification

  var bigHills = [], smallHills = [], bushes = [], clouds = [];

  // Backdrop sprites are pre-rendered into offscreen canvases exactly like
  // the 16x16 tiles, then blitted at integer positions. Nothing in the
  // backdrop is re-rasterised per frame.
  var sprHillBig = null, sprHillSmall = null, sprBush = null;
  var sprCloudSmall = null, sprCloudWide = null;

  // The HUD (MARIO / score / coin / WORLD 1-1 / TIME) is white text drawn by
  // core between py 8 and py 25 of the 256x240 backing canvas. SMB never puts
  // a cloud in that band -- white-on-white makes the HUD unreadable. Every
  // cloud's TOP edge is clamped to at least this py, and since clouds only
  // ever move in x (item.y is fixed, parallax is horizontal), that clamp is a
  // whole-level guarantee rather than a per-screen one.
  var HUD_SAFE_PY = 48;   // 3 tile rows

  // ---- animation state ----
  var bumps = [];        // { col, row, t, dur, key }
  var coins = [];        // { col, row, t, dur, startPx, startPy }
  var questionTimer = 0;
  var questionFrame = 0;
  var QUESTION_FRAME_TIME = 0.2; // seconds per pulse frame

  // Bucket 6 reads this; bucket 3 (us) sets a sane default and never
  // touches it again after init. 0 = flag resting at the base of the pole
  // (world py = FLAG_BOTTOM_PY), 1 = fully raised, just under the flagtop
  // ball (world py = FLAG_TOP_PY). Geometry: pole col 198, FLAGTOP tile at
  // row 2, FLAGPOLE shaft rows 3-11, SOLID base at row 12.
  Tiles.flagHeight = 1;

  var FLAG_TOP_PY = 3 * 16;   // just under the ball
  var FLAG_BOTTOM_PY = 11 * 16; // just above the base block

  // ---------------------------------------------------------------------
  // Local color shades -- Palette is deliberately minimal; anything it
  // doesn't carry lives here.
  // ---------------------------------------------------------------------
  var Local = {
    groundLight: '#d47c3c',
    brickMortar: '#6a2408',
    stoneFill: '#8c8c9c',
    stoneDark: '#5c5c6c',
    stoneLight: '#a8a8b8',
    usedFill: '#9a5c24',
    usedDark: '#6a3410',
    usedLight: '#b47838',
    stairFill: '#8a4c1c',
    stairDark: '#5a2c0c',
    stairLight: '#a86830',
    pipeRim: '#004a00',    // dark outline around the lip and down the shaft edges
    pipeShade: '#046604',  // mid shade, one step down from Palette.pipe
    questionBorder: '#7c4808',
    questionGlyph: '#7c4808',
    questionFaceA: '#fcbc3c',
    questionFaceB: '#fce49c',
    questionFaceC: '#fcd45c',
    flagWhite: '#f8f8f8',
    flagOutline: '#303030',
    poleGrey: '#d8d8d8',
    ballGold: '#fcd800',
    hillFillBig: '#00a800',
    hillFillSmall: '#00a800',  // SMB uses one green for both hill sizes
    hillShade: '#006800',
    bushFill: '#00a800',
    bushShade: '#006800',
    cloudFill: '#fcfcfc',
    cloudShade: '#bcdcfc',
    castleFill: '#a83c1c',
    castleDark: '#6c1c0c',
    castleDoor: '#1c0800',
    castleMortar: '#6c1c0c'
  };

  // ---------------------------------------------------------------------
  // Tile art builders. Each returns { rows: [16 arrays of 16 color-strings
  // or null-for-transparent], canvas }. Built once inside ensureInit().
  // ---------------------------------------------------------------------

  function newOffscreen() {
    var c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    return c;
  }

  // Paint a resolved 16x16 color grid (array of 16 arrays of 16 entries,
  // each a hex string or null for "leave transparent") into a fresh
  // offscreen canvas. Returns the canvas.
  function paint(grid) {
    var c = newOffscreen();
    var ctx = c.getContext('2d');
    var r, col, color;
    for (r = 0; r < 16; r++) {
      for (col = 0; col < 16; col++) {
        color = grid[r][col];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(col, r, 1, 1);
      }
    }
    return c;
  }

  // Simple beveled block: light edge top/left, dark edge bottom/right,
  // solid fill, optional corner "dot" texture and optional horizontal
  // seam lines (for STAIR's stacked-block look).
  function bevelGrid(fill, dark, light, withDots, withSeams) {
    var grid = [], r, col, line, v;
    for (r = 0; r < 16; r++) {
      line = [];
      for (col = 0; col < 16; col++) {
        if (r === 0 || col === 0) v = light;
        else if (r === 15 || col === 15) v = dark;
        else if (withSeams && (r === 4 || r === 8 || r === 12)) v = dark;
        else if (withDots && ((r === 4 || r === 5) && (col === 4 || col === 5))) v = dark;
        else if (withDots && ((r === 10 || r === 11) && (col === 10 || col === 11))) v = dark;
        else v = fill;
        line.push(v);
      }
      grid.push(line);
    }
    return grid;
  }

  function brickGrid(fill, mortar) {
    var grid = [], r, col, line, band, offset, isMortar;
    for (r = 0; r < 16; r++) {
      line = [];
      band = r < 8 ? 0 : 1;
      offset = band === 0 ? 0 : 4;
      for (col = 0; col < 16; col++) {
        isMortar = (r === 0 || r === 8 || r === 15) ||
          ((((col - offset) % 8) + 8) % 8 === 0);
        line.push(isMortar ? mortar : fill);
      }
      grid.push(line);
    }
    return grid;
  }

  var QMARK_CELLS = [
    [3, 6], [3, 7], [3, 8], [3, 9],
    [4, 5], [4, 10],
    [5, 9], [5, 10],
    [6, 8], [6, 9],
    [7, 7], [7, 8],
    [8, 7],
    [11, 7], [11, 8], [12, 7], [12, 8]
  ];

  function inCellList(list, r, c) {
    for (var i = 0; i < list.length; i++) {
      if (list[i][0] === r && list[i][1] === c) return true;
    }
    return false;
  }

  function questionGrid(face) {
    var grid = [], r, col, line, v;
    for (r = 0; r < 16; r++) {
      line = [];
      for (col = 0; col < 16; col++) {
        if (r === 0 || r === 15 || col === 0 || col === 15) v = Local.questionBorder;
        else if (inCellList(QMARK_CELLS, r, col)) v = Local.questionGlyph;
        else v = face;
        line.push(v);
      }
      grid.push(line);
    }
    return grid;
  }

  // Pipe tiles. An SMB pipe is 2 tiles wide, built from two pieces:
  //
  //   * the LIP (PIPE_TL + PIPE_TR) is the full 32px wide, carries a dark
  //     rim across its top, down both outer edges and along its underside,
  //     and a light highlight band just inside the top rim;
  //   * the SHAFT (PIPE_BL + PIPE_BR) is only 24px wide -- PIPE_OVERHANG px
  //     at each outer edge are transparent, so the lip above visibly
  //     overhangs it and sky shows through the notch. The shaft repeats
  //     vertically for any pipe height, and carries the same dark rim down
  //     its own (inset) outer edges.
  //
  // `half` is which side of the 32px pipe this 16px tile is ('left'|'right');
  // the light source is on the left, so only the left half gets the vertical
  // highlight. 2px earlier the overhang was invisible at this scale -- 4px
  // reads clearly once the canvas is upscaled.
  var PIPE_OVERHANG = 4;   // px the lip hangs past the shaft, per side
  var PIPE_RIM = 2;        // px thickness of the dark outline
  var PIPE_HILITE = 2;     // px thickness of the light highlight

  function pipeGrid(fill, rim, highlight, half, isLip) {
    var grid = [], r, col, line, v;
    for (r = 0; r < 16; r++) {
      line = [];
      for (col = 0; col < 16; col++) {
        v = fill;
        if (isLip) {
          if (r < PIPE_RIM) v = rim;                                   // top rim
          else if (r === 15) v = rim;                                  // dark underside of the lip
          else if (half === 'left' && col < PIPE_RIM) v = rim;         // outer left edge
          else if (half === 'right' && col >= 16 - PIPE_RIM) v = rim;  // outer right edge
          else if (r < PIPE_RIM + 3) v = highlight;                    // highlight band across the lip
          else if (half === 'left' && col < PIPE_RIM + PIPE_HILITE) v = highlight;
        } else if (half === 'left') {
          if (col < PIPE_OVERHANG) v = null;                           // sky: the overhang notch
          else if (col < PIPE_OVERHANG + PIPE_RIM) v = rim;            // shaft's left outline
          else if (col < PIPE_OVERHANG + PIPE_RIM + PIPE_HILITE) v = highlight;
        } else {
          if (col >= 16 - PIPE_OVERHANG) v = null;                     // sky: the overhang notch
          else if (col >= 16 - PIPE_OVERHANG - PIPE_RIM) v = rim;      // shaft's right outline
        }
        line.push(v);
      }
      grid.push(line);
    }
    return grid;
  }

  function flagpoleGrid() {
    var grid = [], r, col, line, v;
    for (r = 0; r < 16; r++) {
      line = [];
      for (col = 0; col < 16; col++) {
        v = (col === 7 || col === 8) ? Local.poleGrey : null;
        line.push(v);
      }
      grid.push(line);
    }
    return grid;
  }

  function flagtopGrid() {
    // A small ball finial with a short pole nub at the bottom so it seats
    // cleanly onto the FLAGPOLE tile below it.
    var ballCells = [
      [4, 6], [4, 7], [4, 8], [4, 9],
      [5, 5], [5, 6], [5, 7], [5, 8], [5, 9], [5, 10],
      [6, 5], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10],
      [7, 5], [7, 6], [7, 7], [7, 8], [7, 9], [7, 10],
      [8, 6], [8, 7], [8, 8], [8, 9]
    ];
    var grid = [], r, col, line, v;
    for (r = 0; r < 16; r++) {
      line = [];
      for (col = 0; col < 16; col++) {
        if (inCellList(ballCells, r, col)) v = Local.ballGold;
        else if ((col === 7 || col === 8) && r >= 9) v = Local.poleGrey;
        else v = null;
        line.push(v);
      }
      grid.push(line);
    }
    return grid;
  }

  // ---------------------------------------------------------------------
  // ensureInit() -- lazy, idempotent, safe to call every frame. Builds all
  // caches on first successful call once Level/Palette exist. Referencing
  // window.Level/window.Palette only happens in here, at runtime.
  // ---------------------------------------------------------------------
  function ensureInit() {
    if (ready) return;
    var Level = window.Level;
    if (!Level || !Level.TILE) return; // not loaded yet -- try again next call
    var Palette = window.Palette || {};
    var T = Level.TILE;

    var groundGrid = bevelGrid(Palette.ground || '#b45a1c', Palette.groundDark || '#7a3b10', Local.groundLight, true, false);
    var brickG = brickGrid(Palette.brick || '#c84c0c', Local.brickMortar);
    var usedGrid = bevelGrid(Local.usedFill, Local.usedDark, Local.usedLight, false, false);
    var solidGrid = bevelGrid(Local.stoneFill, Local.stoneDark, Local.stoneLight, false, false);
    var stairGrid = bevelGrid(Local.stairFill, Local.stairDark, Local.stairLight, false, true);
    var pipeLight = Palette.pipeLight || '#5cdc5c';
    var pipeFill = Palette.pipe || '#00a800';

    art[T.GROUND] = groundGrid;
    art[T.BRICK] = brickG;
    art[T.COIN_BRICK] = brickG; // must render identically to BRICK -- shared reference, not a copy
    art[T.USED] = usedGrid;
    art[T.SOLID] = solidGrid;
    art[T.STAIR] = stairGrid;
    art[T.PIPE_TL] = pipeGrid(pipeFill, Local.pipeRim, pipeLight, 'left', true);
    art[T.PIPE_TR] = pipeGrid(pipeFill, Local.pipeRim, pipeLight, 'right', true);
    art[T.PIPE_BL] = pipeGrid(pipeFill, Local.pipeRim, pipeLight, 'left', false);
    art[T.PIPE_BR] = pipeGrid(pipeFill, Local.pipeRim, pipeLight, 'right', false);
    art[T.FLAGPOLE] = flagpoleGrid();
    art[T.FLAGTOP] = flagtopGrid();
    // INVIS_1UP intentionally has no art entry -- must never be drawn.

    caches[T.GROUND] = paint(art[T.GROUND]);
    caches[T.BRICK] = paint(art[T.BRICK]);
    caches[T.COIN_BRICK] = caches[T.BRICK]; // same canvas object -- proves identity, not just similarity
    caches[T.USED] = paint(art[T.USED]);
    caches[T.SOLID] = paint(art[T.SOLID]);
    caches[T.STAIR] = paint(art[T.STAIR]);
    caches[T.PIPE_TL] = paint(art[T.PIPE_TL]);
    caches[T.PIPE_TR] = paint(art[T.PIPE_TR]);
    caches[T.PIPE_BL] = paint(art[T.PIPE_BL]);
    caches[T.PIPE_BR] = paint(art[T.PIPE_BR]);
    caches[T.FLAGPOLE] = paint(art[T.FLAGPOLE]);
    caches[T.FLAGTOP] = paint(art[T.FLAGTOP]);

    // QUESTION gets 3 pulse frames (face brightness cycle).
    var qA = questionGrid(Local.questionFaceA);
    var qB = questionGrid(Local.questionFaceB);
    var qC = questionGrid(Local.questionFaceC);
    questionArt = [qA, qB, qC];
    questionCaches = [paint(qA), paint(qB), paint(qC)];
    art[T.QUESTION] = qA; // representative frame, for callers that just want "the" art

    buildSceneryArt();
    buildScenery(Level.WIDTH_COLS);

    ready = true;
  }

  // ---------------------------------------------------------------------
  // Backdrop sprite rasterisers. Each builds a w x h pixel mask
  // analytically and paints it 1px at a time into an offscreen canvas --
  // once, at init. Deliberately NOT canvas arcs/paths: those antialias,
  // and a half-covered edge pixel on the 256x240 backing store becomes a
  // 4x4 block of fringe colour after the integer upscale.
  // ---------------------------------------------------------------------
  function maskSprite(w, h, fn) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var g = c.getContext('2d');
    var x, y, v;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        v = fn(x, y);
        if (!v) continue;
        g.fillStyle = v;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  function inCircle(x, y, cx, cy, r) {
    var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= r * r;
  }

  // The three-lump silhouette. SMB1 draws clouds and bushes from the very
  // same tiles and only swaps the palette, so this is one generator with
  // two colour pairs -- structurally shared, not two lookalike functions.
  // Shape: a tall middle lump flanked by two lower ones, on a flat base
  // band that runs the full width. Expressed as a top-edge profile per
  // column so the lumps can never leave a gap between each other.
  function lumpSprite(w, h, fill, shade) {
    // Three near-touching circles across the width, so the valleys between
    // the lumps are actually visible: radius w/6 makes the outer two just
    // meet the middle one. The lumps must be true circles -- scaling a
    // narrow lump to the full sprite height (an earlier attempt) turns the
    // middle puff into a spike instead of a puff.
    var rOut = w / 6;
    var rMid = rOut * 1.15;          // middle puff slightly the biggest
    var lift = h * 0.11;             // ...and sitting slightly higher
    var lumps = [
      { cx: rOut, cy: rOut + lift, r: rOut },
      { cx: w * 0.5, cy: rMid, r: rMid },
      { cx: w - rOut, cy: rOut + lift, r: rOut }
    ];
    var baseTop = h * 0.62;          // flat body band, full width
    var dimples = [
      { x: w * 0.30, y: h * 0.72, r: h * 0.14 },
      { x: w * 0.55, y: h * 0.60, r: h * 0.16 }
    ];

    function topAt(x) {
      var best = baseTop, i, l, dx, s, y;
      for (i = 0; i < lumps.length; i++) {
        l = lumps[i];
        dx = x + 0.5 - l.cx;
        s = l.r * l.r - dx * dx;
        if (s <= 0) continue;
        y = l.cy - Math.sqrt(s);
        if (y < best) best = y;
      }
      return best;
    }

    var profile = [], px;
    for (px = 0; px < w; px++) profile.push(Math.round(topAt(px)));

    return maskSprite(w, h, function (x, y) {
      if (y < profile[x]) return null;
      for (var i = 0; i < dimples.length; i++) {
        if (inCircle(x, y, dimples[i].x, dimples[i].y, dimples[i].r)) return shade;
      }
      return fill;
    });
  }

  // SMB's hills are a rounded apex flaring out to a wide base, and the
  // diagonal is stair-stepped rather than smooth because the NES drew them
  // from 8x8 tiles. Quantising the profile into 2px-tall bands reproduces
  // that step. Two dark dimples sit low on the slope.
  function hillSprite(w, h, fill, shade) {
    var half = w / 2;
    var bands = [], y, t, hw;
    for (y = 0; y < h; y++) {
      t = (Math.floor(y / 2) * 2 + 2) / h;          // 2px-tall steps
      // sqrt() gives the convex dome SMB actually has; a near-linear
      // exponent renders as a plain pointy triangle. The 0.18 floor keeps
      // the apex a rounded ~2-tile cap instead of a spike.
      hw = Math.round(half * (0.18 + 0.82 * Math.sqrt(t)));
      bands.push(hw);
    }
    var dimples = [
      { x: w * 0.37, y: h * 0.76, r: h * 0.07 },
      { x: w * 0.52, y: h * 0.63, r: h * 0.07 }
    ];
    return maskSprite(w, h, function (x, py) {
      if (Math.abs(x + 0.5 - half) > bands[py]) return null;
      for (var i = 0; i < dimples.length; i++) {
        if (inCircle(x, py, dimples[i].x, dimples[i].y, dimples[i].r)) return shade;
      }
      return fill;
    });
  }

  function buildSceneryArt() {
    // Sizes in tiles: bush 3x1, small hill 3x2, big hill 5x3, clouds 3x1.5
    // and 4.5x1.75. Previously these were 4-5 tiles tall and dominated the
    // frame; 1-1 is famously mostly open sky.
    sprBush = lumpSprite(48, 16, Local.bushFill, Local.bushShade);
    sprCloudSmall = lumpSprite(48, 24, Local.cloudFill, Local.cloudShade);
    sprCloudWide = lumpSprite(72, 28, Local.cloudFill, Local.cloudShade);
    sprHillSmall = hillSprite(48, 32, Local.hillFillSmall, Local.hillShade);
    sprHillBig = hillSprite(80, 48, Local.hillFillBig, Local.hillShade);
  }

  // ---------------------------------------------------------------------
  // Backdrop placement -- deterministic, hand-picked anchor columns rather
  // than a modular loop, so scenery can dodge the three bottomless pits
  // (cols 69-70, 86-88, 153-154) and leave the last ~30 columns clear for
  // the staircase, flagpole and castle to read cleanly. Deliberately
  // sparse: roughly one bush per 20 columns and a hill per 50.
  //
  // These are literal constants, NOT derived from Level's parsed grid:
  // ensureInit() is lazy and can fire from drawBackdrop() before
  // Level.init() has parsed its rows, and a tileAt() probe at that moment
  // would cache an empty backdrop permanently.
  //
  // Hills and bushes are planted (scroll 1:1 with the ground, since SMB has
  // no ground-relative parallax and a slower factor would visibly slide
  // them against the ground line); clouds drift at half-speed for a touch
  // of depth. This is a deliberate deviation from "everything is a fraction
  // of camera.x" -- surfaced in the bucket report, not absorbed.
  // ---------------------------------------------------------------------
  var BIG_HILL_COLS = [0, 48, 96, 148];
  var SMALL_HILL_COLS = [16, 60, 112, 172];
  var BUSH_COLS = [11, 23, 41, 75, 90, 104, 122, 140, 158, 176];
  // All >= HUD_SAFE_PY (defect 1). Also kept in the py 48-88 band: the HUD
  // ends at py 25 and the level's sky block rows start at row 5 (py 80), so
  // this is the only strip of sky that is clear at both ends.
  var CLOUD_TOPS = [48, 60, 52, 64, 56];

  function buildScenery(widthCols) {
    var worldW = widthCols * 16;
    var i, x;

    bigHills.length = 0;
    smallHills.length = 0;
    bushes.length = 0;
    clouds.length = 0;

    for (i = 0; i < BIG_HILL_COLS.length; i++) {
      bigHills.push({ x: BIG_HILL_COLS[i] * 16 });
    }
    for (i = 0; i < SMALL_HILL_COLS.length; i++) {
      smallHills.push({ x: SMALL_HILL_COLS[i] * 16 });
    }
    for (i = 0; i < BUSH_COLS.length; i++) {
      bushes.push({ x: BUSH_COLS[i] * 16 });
    }

    // Clouds parallax at 0.5, so a cloud is only ever on screen while
    // (x - camX/2) is in view -- i.e. the useful world range is half the
    // level plus one screen. Placing them past that just wastes entries.
    var cloudSpan = worldW * 0.5 + 336;
    for (i = 0, x = 96; x < cloudSpan; i++, x += 152) {
      clouds.push({
        x: x,
        y: Math.max(HUD_SAFE_PY, CLOUD_TOPS[i % CLOUD_TOPS.length]),
        wide: (i % 3) === 2
      });
    }
  }

  // ---------------------------------------------------------------------
  // Public: drawBackdrop
  // ---------------------------------------------------------------------
  Tiles.drawBackdrop = function () {
    ensureInit();
    var Game = window.Game;
    var Palette = window.Palette || {};
    if (!Game || !Game.ctx) return;
    var ctx = Game.ctx;
    var camX = Game.camera.x;

    ctx.fillStyle = Palette.sky || '#5c94fc';
    ctx.fillRect(0, 0, Game.NES_W, Game.NES_H);

    if (!ready) return;

    var groundPy = Game.onGroundY != null ? Game.onGroundY : 13 * 16;
    var i, item, sx, spr;

    // Clouds sit in the sky band; everything else stands on the ground line.
    // All positions are Math.round()ed so scrolling never shimmers.
    for (i = 0; i < clouds.length; i++) {
      item = clouds[i];
      spr = item.wide ? sprCloudWide : sprCloudSmall;
      sx = Math.round(item.x - camX * 0.5);
      if (sx + spr.width < 0 || sx > Game.NES_W) continue;
      ctx.drawImage(spr, sx, item.y);
    }
    // Hills behind bushes: distant scenery first.
    for (i = 0; i < bigHills.length; i++) {
      sx = Math.round(bigHills[i].x - camX);
      if (sx + sprHillBig.width < 0 || sx > Game.NES_W) continue;
      ctx.drawImage(sprHillBig, sx, groundPy - sprHillBig.height);
    }
    for (i = 0; i < smallHills.length; i++) {
      sx = Math.round(smallHills[i].x - camX);
      if (sx + sprHillSmall.width < 0 || sx > Game.NES_W) continue;
      ctx.drawImage(sprHillSmall, sx, groundPy - sprHillSmall.height);
    }
    for (i = 0; i < bushes.length; i++) {
      sx = Math.round(bushes[i].x - camX);
      if (sx + sprBush.width < 0 || sx > Game.NES_W) continue;
      ctx.drawImage(sprBush, sx, groundPy - sprBush.height);
    }
  };

  // ---------------------------------------------------------------------
  // Public: drawLevel -- visible columns only, never all WIDTH_COLS.
  // ---------------------------------------------------------------------
  Tiles.drawLevel = function () {
    ensureInit();
    var Game = window.Game;
    var Level = window.Level;
    if (!Game || !Game.ctx || !Level || !ready) return;
    var ctx = Game.ctx;
    var camX = Game.camera.x;
    var T = Level.TILE;

    var startCol = Game.px2col(camX);
    var endCol = startCol + 17;
    var rows = Game.LEVEL_ROWS;

    // Build a quick col,row -> offset lookup for currently-bumping blocks.
    var bumpLookup = null;
    if (bumps.length > 0) {
      bumpLookup = {};
      for (var i = 0; i < bumps.length; i++) {
        var b = bumps[i];
        bumpLookup[b.col + ',' + b.row] = bumpOffset(b);
      }
    }

    for (var row = 0; row < rows; row++) {
      for (var col = startCol; col <= endCol; col++) {
        var t = Level.tileAt(col, row);
        if (t === T.EMPTY || t === T.INVIS_1UP) continue; // hidden 1-up must never be drawn

        var canvas = (t === T.QUESTION) ? questionCaches[questionFrame] : caches[t];
        if (!canvas) continue;

        var px = Math.round(Game.col2px(col) - camX);
        var py = Game.col2px(row);
        if (bumpLookup) {
          var off = bumpLookup[col + ',' + row];
          if (off) py += off;
        }
        py = Math.round(py);
        ctx.drawImage(canvas, px, py);
      }
    }
  };

  // ---------------------------------------------------------------------
  // Public: drawForeground -- castle, flag, coin pops (must sit in front
  // of Mario/actors per the core draw order).
  // ---------------------------------------------------------------------
  function findSpawn(kind) {
    var Level = window.Level;
    if (!Level || !Level.SPAWNS) return null;
    for (var i = 0; i < Level.SPAWNS.length; i++) {
      if (Level.SPAWNS[i].kind === kind) return Level.SPAWNS[i];
    }
    return null;
  }

  function drawCastle(ctx, camX) {
    var spawn = findSpawn('castle');
    if (!spawn) return;
    var baseX = Game_col2px(spawn.col) - camX;
    var baseY = Game_col2px(spawn.row);
    var w = 5 * 16, h = 5 * 16; // cols 202-206 / rows 8-12
    var x = Math.round(baseX), y = Math.round(baseY);

    // Body brick texture.
    ctx.fillStyle = Local.castleFill;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = Local.castleMortar;
    var mr, mc;
    for (mr = 0; mr < h; mr += 8) {
      ctx.fillRect(x, y + mr, w, 1);
    }
    for (mc = 0; mc < w; mc += 16) {
      ctx.fillRect(x + mc, y, 1, h);
    }

    // Two towers (left/right) rising above the body.
    var towerW = 16, towerH = 16;
    ctx.fillStyle = Local.castleFill;
    ctx.fillRect(x, y - towerH, towerW, towerH);
    ctx.fillRect(x + w - towerW, y - towerH, towerW, towerH);

    // Battlements, 8px teeth. Each tooth must rest ON the surface beneath it:
    // the wall between the towers is 16px lower than the tower tops, so a
    // single row of teeth left sky visible under the middle ones.
    ctx.fillStyle = Local.castleFill;
    var tx;
    // Middle span sits on the body top.
    for (tx = towerW; tx < w - towerW; tx += 16) {
      ctx.fillRect(x + tx, y - 8, 8, 8);
    }
    // One tooth on each tower top, mirrored to the outer edges.
    ctx.fillRect(x, y - towerH - 8, 8, 8);
    ctx.fillRect(x + w - 8, y - towerH - 8, 8, 8);

    // Dark arched doorway, centered.
    var doorW = 16, doorH = 24;
    var doorX = x + Math.round((w - doorW) / 2);
    var doorY = y + h - doorH;
    ctx.fillStyle = Local.castleDoor;
    ctx.fillRect(doorX + 2, doorY, doorW - 4, doorH);
    ctx.fillRect(doorX, doorY + 6, doorW, doorH - 6);

    // Window slits on the towers.
    ctx.fillStyle = Local.castleDark;
    ctx.fillRect(x + 6, y - towerH + 6, 4, 6);
    ctx.fillRect(x + w - towerW + 6, y - towerH + 6, 4, 6);
  }

  function drawFlag(ctx, camX) {
    var spawn = findSpawn('flagpole');
    if (!spawn) return;
    var poleWorldX = Game_col2px(spawn.col);
    var px = Math.round(poleWorldX - camX);
    var h = Tiles.flagHeight;
    if (typeof h !== 'number') h = 1;
    if (h < 0) h = 0;
    if (h > 1) h = 1;
    var py = Math.round(FLAG_BOTTOM_PY - (FLAG_BOTTOM_PY - FLAG_TOP_PY) * h);

    ctx.fillStyle = Local.flagOutline;
    ctx.beginPath();
    ctx.moveTo(px + 8, py);
    ctx.lineTo(px + 22, py + 5);
    ctx.lineTo(px + 8, py + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = Local.flagWhite;
    ctx.beginPath();
    ctx.moveTo(px + 8, py + 1);
    ctx.lineTo(px + 20, py + 5);
    ctx.lineTo(px + 8, py + 9);
    ctx.closePath();
    ctx.fill();
  }

  function coinSquash(age) {
    var frames = [1, 0.6, 0.25, 0.6];
    var idx = Math.floor(age * 12) % frames.length;
    return frames[idx];
  }

  function drawCoinPop(ctx, camX, c) {
    var p = c.t / c.dur;
    if (p > 1) p = 1;
    var riseTiles = 2 * 16;
    var worldY = c.startPy - riseTiles * 4 * p * (1 - p);
    var worldX = c.startPx;
    var scaleW = coinSquash(c.t);
    var size = 12;
    var cx = Math.round(worldX - camX + 8);
    var cy = Math.round(worldY + 8);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleW, 1);
    ctx.fillStyle = window.Palette && window.Palette.questionDark ? window.Palette.questionDark : Local.questionFaceC;
    ctx.beginPath();
    ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = window.Palette && window.Palette.question ? window.Palette.question : Local.questionFaceA;
    ctx.beginPath();
    ctx.ellipse(0, 0, size / 2 - 2, size / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Local px-conversion helpers, resolved at call time against Game so
  // this file never caches Game as a file-scope reference.
  function Game_col2px(c) {
    var Game = window.Game;
    return Game && typeof Game.col2px === 'function' ? Game.col2px(c) : c * 16;
  }

  Tiles.drawForeground = function () {
    ensureInit();
    var Game = window.Game;
    if (!Game || !Game.ctx) return;
    var ctx = Game.ctx;
    var camX = Game.camera.x;

    drawCastle(ctx, camX);
    drawFlag(ctx, camX);

    for (var i = 0; i < coins.length; i++) {
      drawCoinPop(ctx, camX, coins[i]);
    }
  };

  // ---------------------------------------------------------------------
  // Public: bumpBlock / popCoin / update
  // ---------------------------------------------------------------------
  var BUMP_DURATION = 0.2;
  var BUMP_HEIGHT = 5; // px

  function bumpOffset(b) {
    var p = b.t / b.dur;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    return -BUMP_HEIGHT * Math.sin(Math.PI * p);
  }

  Tiles.bumpBlock = function (col, row) {
    ensureInit();
    // Replace any existing bump on the same tile rather than stacking one.
    for (var i = 0; i < bumps.length; i++) {
      if (bumps[i].col === col && bumps[i].row === row) {
        bumps[i].t = 0;
        return;
      }
    }
    bumps.push({ col: col, row: row, t: 0, dur: BUMP_DURATION });
  };

  var COIN_DURATION = 0.5;

  Tiles.popCoin = function (col, row) {
    ensureInit();
    var Game = window.Game;
    var worldX = Game_col2px(col);
    var worldY = Game && typeof Game.col2px === 'function' ? Game.col2px(row) : row * 16;
    coins.push({ col: col, row: row, t: 0, dur: COIN_DURATION, startPx: worldX, startPy: worldY });
  };

  Tiles.update = function (dt) {
    ensureInit();
    var i;

    for (i = bumps.length - 1; i >= 0; i--) {
      bumps[i].t += dt;
      if (bumps[i].t >= bumps[i].dur) bumps.splice(i, 1);
    }

    for (i = coins.length - 1; i >= 0; i--) {
      coins[i].t += dt;
      if (coins[i].t >= coins[i].dur) coins.splice(i, 1);
    }

    questionTimer += dt;
    if (questionTimer >= QUESTION_FRAME_TIME) {
      questionTimer -= QUESTION_FRAME_TIME;
      questionFrame = (questionFrame + 1) % 3;
    }
  };

  Tiles.init = function () {
    ensureInit();
  };

  // ---- verification hooks (read-only introspection; not part of the
  // frozen contract, but harmless to expose and useful for bucket 7's
  // assembly sanity checks and this bucket's own test harness) ----
  Tiles._art = art;
  Tiles._caches = caches;
  Tiles._questionArt = function () { return questionArt; };
  Tiles._bumps = bumps;
  Tiles._coins = coins;
  Tiles._scenery = function () {
    return {
      hudSafePy: HUD_SAFE_PY,
      clouds: clouds,
      bigHills: bigHills,
      smallHills: smallHills,
      bushes: bushes,
      sizes: {
        cloudSmall: sprCloudSmall ? [sprCloudSmall.width, sprCloudSmall.height] : null,
        cloudWide: sprCloudWide ? [sprCloudWide.width, sprCloudWide.height] : null,
        bush: sprBush ? [sprBush.width, sprBush.height] : null,
        hillSmall: sprHillSmall ? [sprHillSmall.width, sprHillSmall.height] : null,
        hillBig: sprHillBig ? [sprHillBig.width, sprHillBig.height] : null
      }
    };
  };

})();
