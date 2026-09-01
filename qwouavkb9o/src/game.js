// Borrowed Quest Game - the main game loop, renderer, networking, and input handling.
// Ported from client/js/game.js, renderer.js, gameclient.js and related files.
import { Types, MobSpeeds, Properties } from './types.js';
import {
  Sprite, Animation, Timer, Transition, Entity, Character, Player, Mob, Npc, Item, Chest,
  createEntity, Camera, BubbleManager,
  TILESET_URL, MAP_URL, SERVER_MAP_URL, ATLAS_URL
} from './framework/engine.js';
import { Pathfinder } from './framework/pathfinder.js';
import { InfoManager } from './framework/infomanager.js';
import { AudioManager } from './framework/audio.js';
import { speakText, ensureVoiceReady, VOICE_LIST, setVoiceEnabled, setVoiceVolume } from './framework/voice.js';

const TILESIZE = 16;
const SCALE = 2;
const MOB_CHASE_RANGE = 14;

function getX(id, w) {
  if (id === 0) return 0;
  return (id % w === 0) ? w - 1 : (id % w) - 1;
}

export class Game {
  constructor() {
    this.ready = false;
    this.started = false;
    this.hasNeverStarted = true;
    this.entities = {};
    this.deathpositions = {};
    this.entityGrid = null;
    this.pathingGrid = null;
    this.renderingGrid = null;
    this.itemGrid = null;
    this.mouse = { x: 0, y: 0 };
    this.zoningQueue = [];
    this.chatLog = [];
    this.previousClickPosition = {};
    this.selectedX = 0;
    this.selectedY = 0;
    this.selectedCellVisible = false;
    this.targetCellVisible = true;
    this.hasChatted = false;
    this.hoveringTarget = false;
    this.hoveringMob = false;
    this.hoveringItem = false;
    this.hoveringCollidingTile = false;
    this.player = new Player("player", "");
    this.sprites = {};
    this.animatedTiles = [];
    this.currentTime = 0;
    this.socket = null;
    this.playerId = null;
    this.playerCount = 0;
    this.cursor = "hand";
    this.isDirty = true;
    this.achievements = {};
    this.ratCount = 0;
    this.skeletonCount = 0;
    this.totalKills = 0;
    this.totalRevives = parseInt(localStorage.getItem('bq_revives') || '0') || 0;
    this.totalDamageTaken = 0;
    this.unlockedAchievements = new Set();
    this.zoningOrientation = null;
    this.currentZoning = null;
    this.storage = {};
    this.attackedMobs = new Set();
  }

  async init(canvas, background, foreground, bubbleContainer) {
    this.canvas = canvas;
    this.background = background;
    this.foreground = foreground;
    this.ctx = canvas.getContext('2d');
    this.bgCtx = background.getContext('2d');
    this.fgCtx = foreground.getContext('2d');
    this.bubbleManager = new BubbleManager(bubbleContainer);
    this.infoManager = new InfoManager(this);
    this.audioManager = new AudioManager();
    this.camera = new Camera();
    this.myVoice = 0;
    try { const v = parseInt(localStorage.getItem('bq_voice')); if (!isNaN(v) && v >= 0 && v <= 128) this.myVoice = v; } catch(e){}

    this.ctx.imageSmoothingEnabled = false;
    this.bgCtx.imageSmoothingEnabled = false;
    this.fgCtx.imageSmoothingEnabled = false;

    // Parallel load: map, sprites+atlas, tileset all at once
    await Promise.all([
      this.loadMap(),
      this.loadSprites(),
      this.loadTileset(),
    ]);

    this.pathfinder = new Pathfinder(this.map.width, this.map.height);
    this.initEntityGrid();
    this.initItemGrid();
    this.initPathingGrid();
    this.initRenderingGrid();
    this.initShadows();
    this.initCursors();
    this.initAnimations();
    this.initAchievements();

    this.player.setSprite(this.sprites[this.player.getSpriteName()]);
    this.player.idle();
    this.setCursor("hand");

    this.ready = true;
  }

  async loadMap() {
    const resp = await fetch(MAP_URL);
    const mapData = await resp.json();
    this.map = {
      width: mapData.width, height: mapData.height, tilesize: TILESIZE,
      data: mapData.data, blocking: mapData.blocking || [], plateau: mapData.plateau || [],
      collisions: mapData.collisions, high: mapData.high || [], animated: mapData.animated || {},
      musicAreas: mapData.musicAreas || [],
      doors: this._getDoors(mapData),
      checkpoints: this._getCheckpoints(mapData),
      isOutOfBounds: function(x, y) { return x < 0 || y < 0 || x >= this.width || y >= this.height; },
      isColliding: function(x, y) { return this.grid && this.grid[y] && this.grid[y][x] === 1; },
      isDoor: function(x, y) { return (y * this.width + x + 1) in this.doors; },
      getDoorDestination: function(x, y) { return this.doors[(y * this.width + x + 1)]; },
      isAnimatedTile: function(id) { return (id + 1) in this.animated; },
      getTileAnimationLength: function(id) { return this.animated[id + 1].l; },
      getTileAnimationDelay: function(id) { return this.animated[id + 1].d || 100; },
      isPlateau: function(x, y) {
        if (this.isOutOfBounds(x, y) || !this.plateauGrid) return false;
        return this.plateauGrid[y][x] === 1;
      }
    };
    this._generateCollisionGrid();
    this._generatePlateauGrid();
  }

  _getDoors(mapData) {
    const doors = {};
    for (const door of mapData.doors) {
      let o;
      switch (door.to) {
        case 'u': o = Types.Orientations.UP; break;
        case 'd': o = Types.Orientations.DOWN; break;
        case 'l': o = Types.Orientations.LEFT; break;
        case 'r': o = Types.Orientations.RIGHT; break;
        default: o = Types.Orientations.DOWN;
      }
      const idx = (door.y * this.map?.width || mapData.width) + door.x + 1;
      doors[(door.y * mapData.width) + door.x + 1] = {
        x: door.tx, y: door.ty, orientation: o,
        cameraX: door.tcx, cameraY: door.tcy, portal: door.p === 1
      };
    }
    return doors;
  }

  _getCheckpoints(mapData) {
    return mapData.checkpoints.map(cp => ({ id: cp.id, x: cp.x, y: cp.y, w: cp.w, h: cp.h, s: cp.s }));
  }

  _generateCollisionGrid() {
    this.map.grid = [];
    for (let i = 0; i < this.map.height; i++) {
      this.map.grid[i] = [];
      for (let j = 0; j < this.map.width; j++) this.map.grid[i][j] = 0;
    }
    for (const idx of this.map.collisions) {
      const pos = this.tileIndexToGridPosition(idx);
      if (this.map.grid[pos.y]) this.map.grid[pos.y][pos.x] = 1;
    }
    for (const idx of this.map.blocking) {
      const pos = this.tileIndexToGridPosition(idx);
      if (this.map.grid[pos.y]) this.map.grid[pos.y][pos.x] = 1;
    }
  }

  _generatePlateauGrid() {
    this.map.plateauGrid = [];
    let tileIndex = 0;
    for (let i = 0; i < this.map.height; i++) {
      this.map.plateauGrid[i] = [];
      for (let j = 0; j < this.map.width; j++) {
        this.map.plateauGrid[i][j] = this.map.plateau.includes(tileIndex) ? 1 : 0;
        tileIndex++;
      }
    }
  }

  tileIndexToGridPosition(tileNum) {
    const getX = function(num, w) { if (num == 0) return 0; return (num % w == 0) ? w - 1 : (num % w) - 1; };
    return { x: getX(tileNum + 1, this.map.width), y: Math.floor(tileNum / this.map.width) };
  }

  gridPositionToTileIndex(x, y) { return (y * this.map.width) + x + 1; }

  async loadSprites() {
    const resp = await fetch('src/sprites.json');
    const spriteDefs = await resp.json();

    // Load atlas image (via fetch+blob to avoid CORS taint issues)
    const atlasResp = await fetch(ATLAS_URL);
    const atlasBlob = await atlasResp.blob();
    const atlasUrl = URL.createObjectURL(atlasBlob);
    const atlasImg = new Image();
    await new Promise((resolve, reject) => {
      atlasImg.onload = resolve;
      atlasImg.onerror = reject;
      atlasImg.src = atlasUrl;
    });

    // Create Sprite objects from atlas
    for (const name in spriteDefs) {
      const def = spriteDefs[name];
      const sprite = new Sprite(name, { ...def, id: name });
      sprite.setImage(atlasImg);
      this.sprites[name] = sprite;
    }

    // Create hurt sprites for mobs (they get hurt frequently)
    for (const name in this.sprites) {
      if (Types.isMob(Types.getKindFromString(name))) {
        this._createHurtSprite(this.sprites[name]);
      }
    }
  }

  _getHurtSprite(sprite) {
    if (sprite.hurtSprite) return sprite.hurtSprite;
    this._createHurtSprite(sprite);
    return sprite.hurtSprite;
  }

  _createHurtSprite(sprite) {
    const w = sprite.width * 2;
    const h = sprite.height * 2;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(sprite.image, sprite.atlasX, sprite.atlasY, w, h, 0, 0, w, h);
    try {
      const data = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i + 3] > 0) {
          data.data[i] = 255;
          data.data[i + 1] = data.data[i + 2] = 75;
        }
      }
      ctx.putImageData(data, 0, 0);
      sprite.hurtSprite = {
        image: canvas, isLoaded: true,
        offsetX: sprite.offsetX, offsetY: sprite.offsetY,
        width: w, height: h,
        atlasX: 0, atlasY: 0
      };
    } catch (e) { console.warn("Could not create hurt sprite for " + sprite.name); }
  }

  async loadTileset() {
    const resp = await fetch(TILESET_URL);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    this.tileset = new Image();
    await new Promise((resolve, reject) => {
      this.tileset.onload = resolve;
      this.tileset.onerror = reject;
      this.tileset.src = blobUrl;
    });
    this.tilesetW = Math.floor(this.tileset.width / TILESIZE);
  }

  initEntityGrid() {
    this.entityGrid = [];
    for (let i = 0; i < this.map.height; i++) {
      this.entityGrid[i] = [];
      for (let j = 0; j < this.map.width; j++) this.entityGrid[i][j] = {};
    }
  }

  initItemGrid() {
    this.itemGrid = [];
    for (let i = 0; i < this.map.height; i++) {
      this.itemGrid[i] = [];
      for (let j = 0; j < this.map.width; j++) this.itemGrid[i][j] = {};
    }
  }

  initPathingGrid() {
    this.pathingGrid = [];
    for (let i = 0; i < this.map.height; i++) {
      this.pathingGrid[i] = [];
      for (let j = 0; j < this.map.width; j++) this.pathingGrid[i][j] = this.map.grid[i][j];
    }
  }

  initRenderingGrid() {
    this.renderingGrid = [];
    for (let i = 0; i < this.map.height; i++) {
      this.renderingGrid[i] = [];
      for (let j = 0; j < this.map.width; j++) this.renderingGrid[i][j] = {};
    }
  }

  initShadows() {
    this.shadows = { small: this.sprites["shadow16"] };
  }

  initCursors() {
    this.cursors = {
      hand: this.sprites["hand"], sword: this.sprites["sword"],
      loot: this.sprites["loot"], target: this.sprites["target"], talk: this.sprites["talk"]
    };
  }

  initAnimations() {
    this.targetAnimation = new Animation("idle_down", 4, 0, 16, 16);
    this.targetAnimation.setSpeed(50);
    this.sparksAnimation = new Animation("idle_down", 6, 0, 16, 16);
    this.sparksAnimation.setSpeed(120);
  }

  initAnimatedTiles() {
    this.animatedTiles = [];
    const self = this;
    this.forEachVisibleTile(function(id, index) {
      if (self.map.isAnimatedTile(id)) {
        self.animatedTiles.push({
          startId: id,
          id: id,
          length: self.map.getTileAnimationLength(id),
          speed: self.map.getTileAnimationDelay(id),
          index: index,
          lastTime: 0
        });
      }
    }, 1);
  }

  forEachAnimatedTile(cb) {
    for (const tile of this.animatedTiles) cb(tile);
  }

  updateAnimatedTiles() {
    const time = this.currentTime;
    this.forEachAnimatedTile(function(tile) {
      if ((time - tile.lastTime) > tile.speed) {
        tile.lastTime = time;
        if ((tile.id - tile.startId) < tile.length - 1) tile.id += 1;
        else tile.id = tile.startId;
      }
    });
  }

  initAchievements() {
    this.achievements = {
      A_TRUE_WARRIOR: { id: 1, name: "A True Warrior", desc: "Find a new weapon" },
      INTO_THE_WILD: { id: 2, name: "Into the Wild", desc: "Venture outside the village" },
      ANGRY_RATS: { id: 3, name: "Angry Rats", desc: "Kill 10 rats" },
      SMALL_TALK: { id: 4, name: "Small Talk", desc: "Talk to a non-player character" },
      FAT_LOOT: { id: 5, name: "Fat Loot", desc: "Get a new armor set" },
      UNDERGROUND: { id: 6, name: "Underground", desc: "Explore at least one cave" },
      AT_WORLDS_END: { id: 7, name: "At World's End", desc: "Reach the south shore" },
      COWARD: { id: 8, name: "Coward", desc: "Successfully escape an enemy" },
      TOMB_RAIDER: { id: 9, name: "Tomb Raider", desc: "Find the graveyard" },
      SKULL_COLLECTOR: { id: 10, name: "Skull Collector", desc: "Kill 10 skeletons" },
      NINJA_LOOT: { id: 11, name: "Ninja Loot", desc: "Get hold of an item you didn't fight for" },
      NO_MANS_LAND: { id: 12, name: "No Man's Land", desc: "Travel through the desert" },
      HUNTER: { id: 13, name: "Hunter", desc: "Kill 50 enemies" },
      STILL_ALIVE: { id: 14, name: "Still Alive", desc: "Revive your character five times" },
      MEATSHIELD: { id: 15, name: "Meatshield", desc: "Take 5,000 points of damage" },
      HOT_SPOT: { id: 16, name: "Hot Spot", desc: "Enter the volcanic mountains" },
      HERO: { id: 17, name: "Hero", desc: "Defeat the final boss" },
      FOXY: { id: 18, name: "Foxy", desc: "Find the Firefox costume", hidden: true },
      FOR_SCIENCE: { id: 19, name: "For Science", desc: "Enter into a portal", hidden: true },
      RICKROLLD: { id: 20, name: "Rickroll'd", desc: "Take some singing lessons", hidden: true }
    };
  }

  tryUnlockingAchievement(name) {
    if (this.unlockedAchievements.has(name)) return;
    const ach = this.achievements[name];
    if (!ach) return;
    let completed = true;
    if (name === "ANGRY_RATS") completed = this.ratCount >= 10;
    else if (name === "SKULL_COLLECTOR") completed = this.skeletonCount >= 10;
    else if (name === "HUNTER") completed = this.totalKills >= 50;
    else if (name === "STILL_ALIVE") completed = this.totalRevives >= 5;
    else if (name === "MEATSHIELD") completed = this.totalDamageTaken >= 5000;
    if (completed) {
      this.unlockedAchievements.add(name);
      this.showNotification("Achievement unlocked: " + ach.name);
      if (this.audioManager) this.audioManager.playSound("achievement");
    }
  }

  showNotification(msg) {
    const el = document.getElementById('notification');
    if (el) {
      el.textContent = msg;
      el.style.opacity = '1';
      clearTimeout(this._notifTimeout);
      this._notifTimeout = setTimeout(() => { el.style.opacity = '0'; }, 3000);
    }
  }

  setCursor(name) {
    if (name in this.cursors) this.currentCursor = this.cursors[name];
  }

  updateCursorLogic() {
    if (this.hoveringCollidingTile && this.started) this.targetColor = "rgba(255, 50, 50, 0.5)";
    else this.targetColor = "rgba(255, 255, 255, 0.5)";

    if (this.hoveringMob && this.started) { this.setCursor("sword"); this.hoveringTarget = false; this.targetCellVisible = false; }
    else if (this.hoveringNpc && this.started) { this.setCursor("talk"); this.hoveringTarget = false; this.targetCellVisible = false; }
    else if ((this.hoveringItem || this.hoveringChest) && this.started) { this.setCursor("loot"); this.hoveringTarget = false; this.targetCellVisible = true; }
    else { this.setCursor("hand"); this.hoveringTarget = false; this.targetCellVisible = true; }
  }

  // ===== Entity management =====
  addEntity(entity) {
    if (this.entities[entity.id] === undefined) {
      this.entities[entity.id] = entity;
      this.registerEntityPosition(entity);
      entity.fadeIn(this.currentTime);
    }
  }

  removeEntity(entity) {
    if (entity.id in this.entities) {
      this.unregisterEntityPosition(entity);
      delete this.entities[entity.id];
    }
  }

  addItem(item, x, y) {
    item.setSprite(this.sprites[item.getSpriteName()]);
    item.setGridPosition(x, y);
    item.setAnimation("idle", 150);
    this.addEntity(item);
  }

  registerEntityPosition(entity) {
    const x = entity.gridX, y = entity.gridY;
    if (entity instanceof Character || entity instanceof Chest) {
      this.entityGrid[y][x][entity.id] = entity;
      if (!(entity instanceof Player)) this.pathingGrid[y][x] = 1;
    }
    if (entity instanceof Item) this.itemGrid[y][x][entity.id] = entity;
    this.addToRenderingGrid(entity, x, y);
  }

  unregisterEntityPosition(entity) {
    this.removeFromEntityGrid(entity, entity.gridX, entity.gridY);
    this.removeFromPathingGrid(entity.gridX, entity.gridY);
    this.removeFromRenderingGrid(entity, entity.gridX, entity.gridY);
    if (entity.nextGridX >= 0 && entity.nextGridY >= 0) {
      this.removeFromEntityGrid(entity, entity.nextGridX, entity.nextGridY);
      this.removeFromPathingGrid(entity.nextGridX, entity.nextGridY);
    }
  }

  registerEntityDualPosition(entity) {
    this.entityGrid[entity.gridY][entity.gridX][entity.id] = entity;
    this.addToRenderingGrid(entity, entity.gridX, entity.gridY);
    if (entity.nextGridX >= 0 && entity.nextGridY >= 0) {
      this.entityGrid[entity.nextGridY][entity.nextGridX][entity.id] = entity;
      if (!(entity instanceof Player)) this.pathingGrid[entity.nextGridY][entity.nextGridX] = 1;
    }
  }

  addToRenderingGrid(entity, x, y) { if (!this.map.isOutOfBounds(x, y)) this.renderingGrid[y][x][entity.id] = entity; }
  removeFromRenderingGrid(entity, x, y) { if (this.renderingGrid[y] && this.renderingGrid[y][x] && entity.id in this.renderingGrid[y][x]) delete this.renderingGrid[y][x][entity.id]; }
  removeFromEntityGrid(entity, x, y) { if (this.entityGrid[y] && this.entityGrid[y][x] && this.entityGrid[y][x][entity.id]) delete this.entityGrid[y][x][entity.id]; }
  removeFromPathingGrid(x, y) { if (this.pathingGrid[y] && this.pathingGrid[y][x]) { if (!this.entityGrid[y] || !Object.keys(this.entityGrid[y][x]).some(id => { const e = this.entityGrid[y][x][id]; return e instanceof Character && !(e instanceof Player); })) this.pathingGrid[y][x] = 0; } }
  removeFromItemGrid(item, x, y) { if (this.itemGrid[y] && this.itemGrid[y][x] && this.itemGrid[y][x][item.id]) delete this.itemGrid[y][x][item.id]; }

  getEntityById(id) { return this.entities[id]; }
  entityIdExists(id) { return id in this.entities; }

  getEntityAt(x, y) {
    if (this.entityGrid[y] && this.entityGrid[y][x]) {
      for (const id in this.entityGrid[y][x]) return this.entityGrid[y][x][id];
    }
    return null;
  }

  getItemAt(x, y) {
    if (this.itemGrid[y] && this.itemGrid[y][x]) {
      for (const id in this.itemGrid[y][x]) return this.itemGrid[y][x][id];
    }
    return null;
  }

  isItemAt(x, y) { return this.getItemAt(x, y) !== null; }
  isMobAt(x, y) { const e = this.getEntityAt(x, y); return e instanceof Mob; }
  isNpcAt(x, y) { const e = this.getEntityAt(x, y); return e instanceof Npc; }
  isChestAt(x, y) { const e = this.getEntityAt(x, y); return e instanceof Chest; }

  forEachEntity(cb) { for (const id in this.entities) cb(this.entities[id]); }
  forEachMob(cb) { for (const id in this.entities) { const e = this.entities[id]; if (e instanceof Mob) cb(e); } }

  forEachVisibleTile(cb, extra) {
    extra = extra || 0;
    for (let y = this.camera.gridY - extra, maxY = this.camera.gridY + this.camera.gridH + (extra * 2); y < maxY; y++) {
      for (let x = this.camera.gridX - extra, maxX = this.camera.gridX + this.camera.gridW + (extra * 2); x < maxX; x++) {
        if (y >= 0 && y < this.map.height && x >= 0 && x < this.map.width) {
          const index = y * this.map.width + x;
          const val = this.map.data[index];
          if (Array.isArray(val)) {
            for (const id of val) cb(id - 1, index);
          } else {
            cb(val - 1, index);
          }
        }
      }
    }
  }

  // ===== Pathfinding =====
  findPath(entity, x, y, ignored) {
    this.pathfinder.clearIgnoreList();
    for (const e of ignored) this.pathfinder.ignoreEntity(e);
    const grid = this.pathingGrid.map(row => row.slice());
    return this.pathfinder.findPath(grid, entity, x, y, true);
  }

  makeCharacterGoTo(entity, x, y) {
    if (!entity.isDying) entity.go(x, y);
  }

  createAttackLink(attacker, target) {
    if (attacker) {
      if (attacker instanceof Mob) {
        // Server drives mob movement; just track the target for visuals
        attacker.setTarget(target);
        target.addAttacker(attacker);
      } else {
        attacker.engage(target);
        target.addAttacker(attacker);
      }
    }
  }

  // ===== Networking =====
  async connect(name) {
    this.player.name = name;
    return new Promise((resolve) => {
      this.socket = root.createServerSocket();
      this.socket.binaryType = "arraybuffer";

      this.socket.addEventListener("open", async () => {
        // Initialize server with map data if needed
        try {
          const ready = await this.socket.rpc.isReady("");
          const mapResp = await fetch(SERVER_MAP_URL);
          const mapData = await mapResp.json();
          if (ready === "not_ready") {
            // initWorld creates static entities itself now (full map sent)
            await this.socket.rpc.initMap(JSON.stringify(mapData));
          }
          // Reconcile the world against the current map config. Static entities
          // and chests are not part of the persisted world, so after a server
          // restart they'd otherwise be missing forever; this heals them live.
          await this.socket.rpc.syncWorld(JSON.stringify(mapData));
        } catch(e) { console.warn("Server init:", e); }

        // Read + display any durable server crash log
        try { await this.refreshCrashInfo(); } catch(e) {}

        // Send HELLO
        this.socket.send(JSON.stringify([
          Types.Messages.HELLO,
          name,
          Types.getKindFromString(this.player.getSpriteName()),
          Types.getKindFromString(this.player.getWeaponName())
        ]));
      });

      this.socket.addEventListener("message", (event) => {
        this.receiveMessage(event.data);
      });

      this.socket.addEventListener("close", (event) => {
        if (this.disconnected_callback) this.disconnected_callback(event);
      });

      this.socket.addEventListener("error", (event) => {
        console.error("Socket error:", event);
      });

      resolve();
    });
  }

  async refreshCrashInfo() {
    try {
      const logText = await this.socket.rpc.crashLog("");
      window.lastServerCrashLog = logText || "";
      const warnEl = document.getElementById("crash-warning");
      if (!warnEl) return;
      if (!logText) { warnEl.hidden = true; return; }
      const lines = logText.split("\n---\n");
      let parsed = null;
      try { parsed = JSON.parse(lines[0]); } catch(e) {}
      const short = parsed ? `[${parsed.h}] ${parsed.e}` : String(lines[0] || logText).slice(0, 200);
      warnEl.hidden = false;
      warnEl.textContent = "⚠ Last server crash: " + short + "  (click to expand)";
      warnEl.onclick = () => {
        if (warnEl.dataset.expanded) {
          warnEl.dataset.expanded = "";
          warnEl.textContent = "⚠ Last server crash: " + short + "  (click to expand)";
        } else {
          warnEl.dataset.expanded = "1";
          warnEl.textContent = "Server crash log:\n" + logText + "\n(click to collapse)";
        }
      };
    } catch(e) {}
  }

  sendMessage(msg) {
    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  receiveMessage(data) {
    let messages;
    try { messages = JSON.parse(data); } catch(e) { return; }
    if (!Array.isArray(messages)) return;
    if (messages.length > 0 && Array.isArray(messages[0])) {
      for (const msg of messages) this.receiveAction(msg);
    } else {
      this.receiveAction(messages);
    }
  }

  receiveAction(data) {
    const action = data[0];
    switch (action) {
      case Types.Messages.WELCOME: this.receiveWelcome(data); break;
      case Types.Messages.MOVE: this.receiveMove(data); break;
      case Types.Messages.LOOTMOVE: this.receiveLootMove(data); break;
      case Types.Messages.ATTACK: this.receiveAttack(data); break;
      case Types.Messages.SPAWN: this.receiveSpawn(data); break;
      case Types.Messages.DESPAWN: this.receiveDespawn(data); break;
      case Types.Messages.HEALTH: this.receiveHealth(data); break;
      case Types.Messages.CHAT: this.receiveChat(data); break;
      case Types.Messages.EQUIP: this.receiveEquip(data); break;
      case Types.Messages.DROP: this.receiveDrop(data); break;
      case Types.Messages.TELEPORT: this.receiveTeleport(data); break;
      case Types.Messages.DAMAGE: this.receiveDamage(data); break;
      case Types.Messages.POPULATION: this.receivePopulation(data); break;
      case Types.Messages.LIST: this.receiveList(data); break;
      case Types.Messages.DESTROY: this.receiveDestroy(data); break;
      case Types.Messages.KILL: this.receiveKill(data); break;
      case Types.Messages.HP: this.receiveHitPoints(data); break;
      case Types.Messages.BLINK: this.receiveBlink(data); break;
    }
  }

  receiveWelcome(data) {
    const id = data[1], name = data[2], x = data[3], y = data[4], hp = data[5];
    this.player.id = id;
    this.playerId = id;
    this.player.name = name;
    this.player.setGridPosition(x, y);
    this.player.setMaxHitPoints(hp);
    this.updateBars();
    this.camera.focusEntity(this.player);
    this.addEntity(this.player);
    this.initAnimatedTiles();
    this.started = true;
    this.setupPlayerCallbacks();
    if (this.started_callback) this.started_callback();
    this.showNotification("Welcome to Borrowed Quest!");
    try { this.tryUnlockingAchievement("STILL_ALIVE"); } catch(e){}
  }

  setupPlayerCallbacks() {
    const self = this;
    this.player.onStartPathing(function(path) {
      const i = path.length - 1;
      const x = path[i][0], y = path[i][1];
      if (self.player.isMovingToLoot()) self.player.isLootMoving = false;
      else if (!self.player.isAttacking()) self.socket.send(JSON.stringify([Types.Messages.MOVE, x, y]));
      self.selectedX = x; self.selectedY = y; self.selectedCellVisible = true;
    });

    this.player.onCheckAggro(function() {
      self.forEachMob(function(mob) {
        if (mob.isAggressive && !mob.isAttacking() && self.isNear(self.player, mob, mob.aggroRange)) {
          self.player.aggro(mob);
        }
      });
    });

    this.player.onAggro(function(mob) {
      if (!mob.isWaitingToAttack(self.player) && !self.player.isAttackedBy(mob)) {
        self.socket.send(JSON.stringify([Types.Messages.AGGRO, mob.id]));
        mob.waitToAttack(self.player);
        // Engage locally too: if the mob already targets us server-side (e.g. after
        // a previous chase/leash), no fresh ATTACK broadcast arrives to start the fight.
        if (mob instanceof Mob) mob.engage(self.player);
      }
    });

    this.player.onBeforeStep(function() { self.unregisterEntityPosition(self.player); });

    this.player.onStep(function() {
      if (self.player.hasNextStep()) self.registerEntityDualPosition(self.player);

      if (self.isZoningTile(self.player.gridX, self.player.gridY)) {
        self.enqueueZoningFrom(self.player.gridX, self.player.gridY);
      }

      self.player.forEachAttacker(function(attacker) {
        if (attacker instanceof Mob) return; // server drives mob movement
        if (attacker.isAdjacent(attacker.target)) attacker.lookAtTarget();
        else attacker.follow(self.player);
      });
      self.updatePlayerCheckpoint();
      self.updatePlateauMode();
      if (self.audioManager && self.map.musicAreas) self.audioManager.updateMusic(self.map.musicAreas, self.player.gridX, self.player.gridY);

      if (self.player.gridX <= 85 && self.player.gridY <= 179 && self.player.gridY > 178) self.tryUnlockingAchievement("INTO_THE_WILD");
      if (self.player.gridX <= 85 && self.player.gridY <= 266 && self.player.gridY > 265) self.tryUnlockingAchievement("INTO_THE_WILD");
      if (self.player.gridX <= 85 && self.player.gridY <= 293 && self.player.gridY > 292) self.tryUnlockingAchievement("AT_WORLDS_END");
      if (self.player.gridX <= 85 && self.player.gridY <= 100 && self.player.gridY > 99) self.tryUnlockingAchievement("NO_MANS_LAND");
      if (self.player.gridX <= 85 && self.player.gridY <= 51 && self.player.gridY > 50) self.tryUnlockingAchievement("HOT_SPOT");
      if (self.player.gridX <= 27 && self.player.gridY <= 123 && self.player.gridY > 112) self.tryUnlockingAchievement("TOMB_RAIDER");
    });

    this.player.onStopPathing(function(x, y) {
      if (self.player.hasTarget()) self.player.lookAtTarget();
      self.selectedCellVisible = false;

      if (self.isItemAt(x, y)) {
        const item = self.getItemAt(x, y);
        try {
          self.player.loot(item);
          self.socket.send(JSON.stringify([Types.Messages.LOOT, item.id]));
          self.removeItem(item);
          self.showNotification(item.getLootMessage());
          if (Types.isHealingItem(item.kind)) { if (self.audioManager) self.audioManager.playSound("heal"); }
          else if (item.kind === Types.Entities.FIREPOTION) { if (self.audioManager) self.audioManager.playSound("firefox"); }
          else { if (self.audioManager) self.audioManager.playSound("loot"); }
          if (item.type === "armor") self.tryUnlockingAchievement("FAT_LOOT");
          if (item.type === "weapon") self.tryUnlockingAchievement("A_TRUE_WARRIOR");
          if (item.kind === Types.Entities.CAKE) self.tryUnlockingAchievement("FOR_SCIENCE");
          if (item.kind === Types.Entities.FIREPOTION) self.tryUnlockingAchievement("FOXY");
          if (item.wasDropped && item.playersInvolved && !item.playersInvolved.includes(self.playerId)) self.tryUnlockingAchievement("NINJA_LOOT");
        } catch(e) {
          self.showNotification(e.message);
          if (self.audioManager) self.audioManager.playSound("noloot");
        }
      }

      if (!self.player.hasTarget() && self.map.isDoor(x, y)) {
        const dest = self.map.getDoorDestination(x, y);
        self.player.setGridPosition(dest.x, dest.y);
        self.player.nextGridX = dest.x;
        self.player.nextGridY = dest.y;
        self.player.turnTo(dest.orientation);
        self.socket.send(JSON.stringify([Types.Messages.TELEPORT, dest.x, dest.y]));
        self.camera.focusEntity(self.player);
        self.initAnimatedTiles();
        self.updatePlateauMode();
        self.checkUndergroundAchievement();
        self.player.forEachAttacker(function(a) { a.disengage(); a.idle(); });
        if (self.player.attackers && Object.keys(self.player.attackers).length > 0) {
          setTimeout(() => self.tryUnlockingAchievement("COWARD"), 500);
        }
        if (dest.portal) { self.tryUnlockingAchievement("FOR_SCIENCE"); if (self.audioManager) self.audioManager.playSound("teleport"); }
      }

      if (self.player.target instanceof Npc) {
        self.makeNpcTalk(self.player.target);
        self.tryUnlockingAchievement("SMALL_TALK");
      } else if (self.player.target instanceof Chest) {
        self.socket.send(JSON.stringify([Types.Messages.OPEN, self.player.target.id]));
        if (self.audioManager) self.audioManager.playSound("chest");
      }

      self.unregisterEntityPosition(self.player);
      self.registerEntityPosition(self.player);
    });

    this.player.onRequestPath(function(x, y) {
      const ignored = [self.player];
      if (self.player.hasTarget()) ignored.push(self.player.target);
      return self.findPath(self.player, x, y, ignored);
    });

    this.player.onDeath(function() {
      self.player.stopBlinking();
      self.player.setSprite(self.sprites["death"]);
      self.player.animate("death", 120, 1, function() {
        self.removeEntity(self.player);
        self.player = null;
        setTimeout(() => { if (self.playerdeath_callback) self.playerdeath_callback(); }, 1000);
      });
      self.player.forEachAttacker(function(a) { a.disengage(); a.idle(); });
      try { const r = parseInt(localStorage.getItem('bq_revives') || '0'); localStorage.setItem('bq_revives', String(r + 1)); self.totalRevives = r + 1; } catch(e){}
      if (self.audioManager) self.audioManager.playSound("death");
    });

    this.player.onHasMoved(function(player) {});
    this.player.onArmorLoot(function(armorName) { self.player.switchArmor(self.sprites[armorName]); });
    this.player.onSwitchItem(function() {});
    this.player.onInvincible(function() { self.player.switchArmor(self.sprites["firefox"]); });
  }

  receiveMove(data) {
    const id = data[1], x = data[2], y = data[3];
    if (id !== this.playerId) {
      const entity = this.getEntityById(id);
      if (entity) { if (!(entity instanceof Mob)) { entity.disengage(); entity.idle(); } this.makeCharacterGoTo(entity, x, y); }
    }
  }

  receiveLootMove(data) {
    const id = data[1], itemId = data[2];
    if (id !== this.playerId) {
      const entity = this.getEntityById(id);
      if (entity) { entity.disengage(); entity.idle(); this.makeCharacterGoTo(entity, this.entities[itemId].gridX, this.entities[itemId].gridY); }
    }
  }

  receiveAttack(data) {
    const attacker = data[1], target = data[2];
    const attackerEntity = this.getEntityById(attacker);
    const targetEntity = this.getEntityById(target);
    if (attackerEntity && targetEntity) {
      if (attackerEntity instanceof Mob) {
        this.createAttackLink(attackerEntity, targetEntity);
        // Play attack animation; face the target
        attackerEntity.lookAtTarget();
        attackerEntity.hit();
        // Chase and keep attacking client-side; the server applies damage via HURT.
        if (!attackerEntity.isAttacking()) attackerEntity.engage(targetEntity);
        if (this.audioManager) this.audioManager.playSound(Math.random() < 0.5 ? "hit1" : "hit2");
      } else {
        attackerEntity.engage(targetEntity);
      }
    }
  }

  receiveSpawn(data) {
    const id = data[1], kind = data[2], x = data[3], y = data[4];
    if (Types.isItem(kind)) {
      const item = createEntity(kind, id);
      this.addItem(item, x, y);
    } else if (Types.isChest(kind)) {
      const chest = createEntity(kind, id);
      chest.setSprite(this.sprites[chest.getSpriteName()]);
      chest.setGridPosition(x, y);
      chest.setAnimation("idle_down", 150);
      this.addEntity(chest);
      chest.onOpen(function() {
        chest.stopBlinking();
        chest.setSprite(this.sprites["death"]);
        chest.setAnimation("death", 120, 1, () => {
          this.removeEntity(chest);
          this.removeFromRenderingGrid(chest, chest.gridX, chest.gridY);
        });
      }.bind(this));
    } else {
      let name, orientation, target, weapon, armor;
      if (Types.isPlayer(kind)) {
        name = data[5]; orientation = data[6]; armor = data[7]; weapon = data[8];
        if (data.length > 9) target = data[9];
      } else if (Types.isMob(kind) || Types.isNpc(kind)) {
        orientation = data[5];
        if (data.length > 6) target = data[6];
      }
      if (this.entityIdExists(id)) return;
      const character = createEntity(kind, id, name);
      if (character instanceof Player) {
        character.weaponName = Types.getKindAsString(weapon);
        character.spriteName = Types.getKindAsString(armor);
      }
      if (!character) return;
      character.setSprite(this.sprites[character.getSpriteName()]);
      character.setGridPosition(x, y);
      if (character instanceof Character) {
        character.setOrientation(orientation || Types.Orientations.DOWN);
        character.idle();
      }
      if (character instanceof Mob) {
        character.maxHitPoints = Properties.getHitPoints(character.kind);
        character.hitPoints = character.maxHitPoints;
      }
      this.addEntity(character);
      this.setupEntityCallbacks(character);
      if (target) {
        const targetEntity = this.getEntityById(target);
        if (targetEntity && character instanceof Mob) this.createAttackLink(character, targetEntity);
      }
    }
  }

  setupEntityCallbacks(entity) {
    const self = this;
    if (!(entity instanceof Character)) return;
    entity.onBeforeStep(function() { self.unregisterEntityPosition(entity); });
    entity.onStep(function() {
      if (!entity.isDying) {
        self.registerEntityDualPosition(entity);
        entity.forEachAttacker(function(a) {
          if (a instanceof Mob) return; // server drives mob movement
          if (a.isAdjacent(a.target)) a.lookAtTarget(); else a.follow(entity);
        });
      }
    });
    entity.onStopPathing(function(x, y) {
      if (!entity.isDying) {
        if (entity.hasTarget() && entity.isAdjacent(entity.target)) entity.lookAtTarget();
        entity.forEachAttacker(function(a) {
          if (a instanceof Mob) return; // server drives mob movement
          if (!a.isAdjacentNonDiagonal(entity) && a.id !== self.playerId) a.follow(entity);
        });
        self.unregisterEntityPosition(entity);
        self.registerEntityPosition(entity);
      }
    });
    entity.onRequestPath(function(x, y) {
      const ignored = [entity];
      const ignoreTarget = function(target) {
        ignored.push(target);
        target.forEachAttacker(function(a) { ignored.push(a); });
      };
      if (entity.hasTarget()) ignoreTarget(entity.target);
      else if (entity.previousTarget) ignoreTarget(entity.previousTarget);
      return self.findPath(entity, x, y, ignored);
    });
    entity.onDeath(function() {
      if (entity instanceof Mob) self.deathpositions[entity.id] = { x: entity.gridX, y: entity.gridY };
      entity.isDying = true;
      entity.setSprite(self.sprites[entity instanceof Mob && entity.kind === Types.Entities.RAT ? "rat" : "death"]);
      entity.animate("death", 120, 1, function() {
        self.removeEntity(entity);
        self.removeFromRenderingGrid(entity, entity.gridX, entity.gridY);
      });
      entity.forEachAttacker(function(a) { a.disengage(); });
      if (self.player.target && self.player.target.id === entity.id) self.player.disengage();
      self.removeFromEntityGrid(entity, entity.gridX, entity.gridY);
      self.removeFromPathingGrid(entity.gridX, entity.gridY);
    });
    entity.onHasMoved(function(entity) {});
  }

  receiveDespawn(data) {
    const id = data[1];
    const entity = this.getEntityById(id);
    if (entity) {
      if (entity instanceof Item) this.removeItem(entity);
      else if (entity instanceof Character) { entity.die(); entity.clean(); }
      else if (entity instanceof Chest) entity.open();
      this.attackedMobs.delete(id);
    }
  }

  receiveHealth(data) {
    const points = data[1];
    const oldHp = this.player.hitPoints;
    this.player.hitPoints = points;
    this.updateBars();
    if (points < oldHp) {
      this.infoManager.addDamageInfo(oldHp - points, this.player.x, this.player.y - 4, 'received');
    } else if (points > oldHp) {
      this.infoManager.addDamageInfo(points - oldHp, this.player.x, this.player.y - 4, 'healed');
      if (this.audioManager) this.audioManager.playSound("heal");
    }
  }

  receiveChat(data) {
    const id = data[1], text = data[2];
    const entity = this.getEntityById(id);
    if (entity) {
      this.bubbleManager.create(id, text);
      this.assignBubbleTo(entity);
      if (id !== this.playerId) {
        const voiceId = parseInt(String(id).split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % 129;
        speakText(text, voiceId, 1, 0);
      }
    }
    if (this.chatLog) {
      const name = entity ? (entity.name || 'Unknown') : 'Unknown';
      const entry = { name, text, time: Date.now() };
      this.chatLog.push(entry);
      if (this.chatLog.length > 50) this.chatLog.shift();
      if (this.onChatLog) this.onChatLog(this.chatLog);
    }
  }

  receiveEquip(data) {
    const id = data[1], itemKind = data[2];
    const entity = this.getEntityById(id);
    if (entity && entity instanceof Player) {
      const itemName = Types.getKindAsString(itemKind);
      if (Types.isArmor(itemKind)) {
        entity.spriteName = itemName;
        entity.setSprite(this.sprites[itemName]);
        if (itemName === "firefox") {
          if (entity.onInvincible) entity.startInvincibility();
        }
      } else if (Types.isWeapon(itemKind)) {
        entity.weaponName = itemName;
      }
    }
  }

  receiveDrop(data) {
    const mobId = data[1], id = data[2], kind = data[3];
    const item = createEntity(kind, id);
    item.wasDropped = true;
    item.playersInvolved = data[4];
    const mob = this.deathpositions[mobId];
    if (mob) this.addItem(item, mob.x, mob.y);
  }

  receiveTeleport(data) {
    const id = data[1], x = data[2], y = data[3];
    const entity = this.getEntityById(id);
    if (entity) {
      if (id !== this.playerId) {
        entity.disengage();
        entity.idle();
        entity.setGridPosition(x, y);
        entity.nextGridX = -1;
        entity.nextGridY = -1;
      }
    }
  }

  receiveDamage(data) {
    const id = data[1], dmg = data[2];
    const entity = this.getEntityById(id);
    if (entity) {
      if (entity instanceof Mob) {
        entity.hurt();
        if (!entity.maxHitPoints) entity.maxHitPoints = Properties.getHitPoints(entity.kind);
        entity.hitPoints = Math.max(0, entity.hitPoints - dmg);
        this.attackedMobs.add(entity.id);
      }
      const type = entity.id === this.playerId ? 'received' : 'inflicted';
      this.infoManager.addDamageInfo(dmg, entity.x, entity.y - 4, type);
    }
  }

  receivePopulation(data) {
    this.playerCount = data[2];
    this.updateBars();
  }

  receiveList(data) {
    data.shift();
    const entityIds = Object.values(this.entities).map(e => e.id);
    const knownIds = entityIds.filter(id => data.includes(id));
    const newIds = data.filter(id => !knownIds.includes(id));
    const obsolete = Object.values(this.entities).filter(e => !knownIds.includes(e.id) && e.id !== this.playerId);
    for (const entity of obsolete) this.removeEntity(entity);
    if (newIds.length > 0) this.socket.send(JSON.stringify([Types.Messages.WHO].concat(newIds)));
  }

  receiveDestroy(data) {
    const id = data[1];
    const entity = this.getEntityById(id);
    if (entity) {
      if (entity instanceof Item) this.removeItem(entity);
      else this.removeEntity(entity);
    }
  }

  receiveKill(data) {
    const mobKind = data[1];
    this.totalKills++;
    if (this.audioManager) this.audioManager.playSound(Math.random() < 0.5 ? "kill1" : "kill2");
    if (mobKind === Types.Entities.RAT) this.ratCount++;
    if (mobKind === Types.Entities.SKELETON || mobKind === Types.Entities.SKELETON2) this.skeletonCount++;
    if (mobKind === Types.Entities.BOSS) this.tryUnlockingAchievement("HERO");
    this.tryUnlockingAchievement("ANGRY_RATS");
    this.tryUnlockingAchievement("SKULL_COLLECTOR");
    this.tryUnlockingAchievement("HUNTER");
  }

  receiveHitPoints(data) {
    const maxHp = data[1];
    this.player.maxHitPoints = maxHp;
    this.updateBars();
  }

  receiveBlink(data) {
    const id = data[1];
    const item = this.getEntityById(id);
    if (item) item.blink(150);
  }

  removeItem(item) {
    if (item) {
      this.removeFromItemGrid(item, item.gridX, item.gridY);
      this.removeFromRenderingGrid(item, item.gridX, item.gridY);
      delete this.entities[item.id];
    }
  }

  assignBubbleTo(entity) {
    // Bubbles follow entities - handled in updateBubbles
  }

  updateBubbles() {
    const s = SCALE;
    for (const id in this.bubbleManager.bubbles) {
      const entity = this.getEntityById(id);
      const arr = this.bubbleManager.bubbles[id];
      if (!entity || !arr) continue;
      const sx = (entity.x - this.camera.x) * s;
      const sy = (entity.y - this.camera.y) * s;
      if (!this.camera.isVisible(entity)) {
        arr.forEach(b => b.el.style.display = 'none');
        continue;
      }
      arr.forEach((bubble, i) => {
        const elapsed = Date.now() - bubble.time;
        const remaining = bubble.timeout - elapsed;
        if (remaining < 500) bubble.el.style.opacity = (remaining / 500).toFixed(2);
        else bubble.el.style.opacity = '1';
        bubble.el.style.display = '';
        bubble.el.style.left = (sx - bubble.el.offsetWidth / 2 + 16) + 'px';
        const stackOffset = (arr.length - 1 - i) * (bubble.el.offsetHeight || 20);
        bubble.el.style.top = (sy - 24 - stackOffset) + 'px';
      });
    }
  }

  updateChatHint() {
    if (!this.started || !this.player) return;
    const hint = document.getElementById('chat-hint');
    if (!hint) return;
    if (this.hasChatted) { hint.style.display = 'none'; return; }
    let nearOther = false;
    for (const id in this.entities) {
      if (id == this.playerId) continue;
      const e = this.entities[id];
      if (e instanceof Player && this.isNear(this.player, e, 20)) { nearOther = true; break; }
    }
    const chatInput = document.getElementById('chat-input');
    const chatVisible = chatInput && chatInput.style.display !== 'none';
    hint.style.display = (nearOther && !chatVisible) ? 'block' : 'none';
  }

  makeNpcTalk(npc) {
    const npcTalk = {
      guard: ["Hello there", "We don't need to see your identification", "You are not the player we're looking for", "Move along, move along..."],
      king: ["Hi, I'm the King", "I run this place", "Like a boss", "I talk to people", "Like a boss", "I wear a crown", "Like a boss", "I do nothing all day", "Like a boss", "Now leave me alone", "Like a boss"],
      villagegirl: ["Hi there, adventurer!", "How do you like this game?", "It's all happening in a single web page! Isn't it crazy?", "It's all made possible thanks to WebSockets.", "I don't know much about it, after all I'm just a program.", "Why don't you read this blog post and learn all about it?"],
      villager: ["Howdy stranger. Do you like poetry?", "Roses are red, violets are blue...", "I like hunting rats, and so do you...", "The rats are dead, now what to do?", "To be honest, I have no clue.", "Maybe the forest, could interest you...", "or instead, cook a rat stew."],
      agent: ["Do not try to bend the sword", "That's impossible", "Instead, only try to realize the truth...", "There is no sword."],
      rick: ["We're no strangers to love", "You know the rules and so do I", "A full commitment's what I'm thinking of", "You wouldn't get this from any other guy", "I just wanna tell you how I'm feeling", "Gotta make you understand", "Never gonna give you up", "Never gonna let you down", "Never gonna run around and desert you", "Never gonna make you cry", "Never gonna say goodbye", "Never gonna tell a lie and hurt you"],
      scientist: ["Greetings.", "I am the inventor of these two potions.", "The red one will replenish your health points...", "The orange one will turn you into a firefox and make you invincible...", "But it only lasts for a short while.", "So make good use of it!", "Now if you'll excuse me, I need to get back to my experiments..."],
      nyan: ["nyan nyan nyan nyan nyan", "nyan nyan nyan nyan nyan nyan nyan", "nyan nyan nyan nyan nyan nyan", "nyan nyan nyan nyan nyan nyan nyan nyan"],
      beachnpc: ["Don't mind me, I'm just here on vacation.", "I have to say...", "These giant crabs are somewhat annoying.", "Could you please get rid of them for me?"],
      forestnpc: ["lorem ipsum dolor sit amet", "consectetur adipisicing elit, sed do eiusmod tempor"],
      desertnpc: ["One does not simply walk into these mountains...", "An ancient undead lord is said to dwell here.", "Nobody knows exactly what he looks like...", "...for none has lived to tell the tale.", "It's not too late to turn around and go home, kid."],
      lavanpc: ["lorem ipsum dolor sit amet", "consectetur adipisicing elit, sed do eiusmod tempor"],
      priest: ["Oh, hello, young man.", "Wisdom is everything, so I'll share a few guidelines with you.", "You are free to go wherever you like in this world", "but beware of the many foes that await you.", "You can find many weapons and armors by killing enemies.", "The tougher the enemy, the higher the potential rewards.", "You can also unlock achievements by exploring and hunting.", "Click on the small cup icon to see a list of all the achievements.", "Please stay a while and enjoy the many surprises of Borrowed Quest", "Farewell, young friend."],
      sorcerer: ["Ah... I had foreseen you would come to see me.", "Well? How do you like my new staff?", "Pretty cool, eh?", "Where did I get it, you ask?", "I understand. It's easy to get envious.", "I actually crafted it myself, using my mad wizard skills.", "But let me tell you one thing...", "There are lots of items in this game.", "Some more powerful than others.", "In order to find them, exploration is key.", "Good luck."],
      octocat: ["Welcome to Borrowed Quest!", "Want to see the source code?", "Check out the repository on GitHub"],
      coder: ["Hi! Do you know that you can also play Borrowed Quest on your tablet or mobile?", "That's the beauty of HTML5!", "Give it a try..."],
    };
    const name = Types.getKindAsString(npc.kind);
    const messages = npcTalk[name] || ["Hello there!"];
    if (!npc.talkIndex) npc.talkIndex = 0;
    let msg;
    if (npc.talkIndex >= messages.length) { npc.talkIndex = 0; }
    msg = messages[npc.talkIndex] || messages[0];
    npc.talkIndex++;
    this.bubbleManager.create(npc.id, msg, 4000);
    if (this.audioManager) this.audioManager.playSound("npc");
    if (npc.kind === Types.Entities.RICK) this.tryUnlockingAchievement("RICKROLLD");
  }

  updateBars() {
    const hpEl = document.getElementById('hp-text');
    const hpBar = document.getElementById('hp-bar');
    if (hpEl && this.player) {
      hpEl.textContent = `${this.player.hitPoints} / ${this.player.maxHitPoints}`;
      const pct = (this.player.hitPoints / this.player.maxHitPoints) * 100;
      if (hpBar) hpBar.style.width = pct + '%';
    }
    const popEl = document.getElementById('population');
    if (popEl) popEl.textContent = `${this.playerCount} players online`;
  }

  updatePlayerCheckpoint() {
    const cp = this.map.checkpoints.find(c =>
      this.player.gridX >= c.x && this.player.gridX < c.x + c.w &&
      this.player.gridY >= c.y && this.player.gridY < c.y + c.h);
    if (cp) {
      const last = this.player.lastCheckpoint;
      if (!last || last.id !== cp.id) {
        this.player.lastCheckpoint = cp;
        this.socket.send(JSON.stringify([Types.Messages.CHECK, cp.id]));
      }
    }
  }

  updatePlateauMode() {
    if (this.map.isPlateau(this.player.gridX, this.player.gridY)) this.player.isOnPlateau = true;
    else this.player.isOnPlateau = false;
  }

  checkUndergroundAchievement() {
    if (this.map.musicAreas) {
      for (const area of this.map.musicAreas) {
        if (area.id === 'cave' &&
            this.player.gridX >= area.x && this.player.gridX < area.x + area.w &&
            this.player.gridY >= area.y && this.player.gridY < area.y + area.h) {
          this.tryUnlockingAchievement("UNDERGROUND");
          break;
        }
      }
    }
  }

  // ===== Zoning =====
  isZoningTile(x, y) {
    const c = this.camera;
    x = x - c.gridX;
    y = y - c.gridY;
    if (x === 0 || y === 0 || x === c.gridW - 1 || y === c.gridH - 1) return true;
    return false;
  }

  getZoningOrientation(x, y) {
    const c = this.camera;
    x = x - c.gridX;
    y = y - c.gridY;
    if (x === 0) return Types.Orientations.LEFT;
    if (y === 0) return Types.Orientations.UP;
    if (x === c.gridW - 1) return Types.Orientations.RIGHT;
    if (y === c.gridH - 1) return Types.Orientations.DOWN;
    return null;
  }

  enqueueZoningFrom(x, y) {
    this.zoningQueue.push({ x, y });
    if (this.zoningQueue.length === 1) this.startZoningFrom(x, y);
  }

  startZoningFrom(x, y) {
    this.zoningOrientation = this.getZoningOrientation(x, y);
    this.bubbleManager.clean();
    this.socket.send(JSON.stringify([Types.Messages.ZONE]));
    this.endZoning();
  }

  endZoning() {
    this.currentZoning = null;
    this.resetZone();
    this.zoningQueue.shift();
    if (this.zoningQueue.length > 0) {
      const pos = this.zoningQueue[0];
      this.startZoningFrom(pos.x, pos.y);
    }
  }

  isZoning() { return this.currentZoning !== null; }

  resetZone() {
    this.bubbleManager.clean();
    this.initAnimatedTiles();
  }

  checkUndergroundAchievement() {
    if (this.map.musicAreas) {
      for (const area of this.map.musicAreas) {
        if (area.id === 'cave' &&
            this.player.gridX >= area.x && this.player.gridX < area.x + area.w &&
            this.player.gridY >= area.y && this.player.gridY < area.y + area.h) {
          this.tryUnlockingAchievement("UNDERGROUND");
          break;
        }
      }
    }
  }

  // ===== Zoning =====
  // Zone boundaries match the server's 28x12 zone grid. When the player crosses
  // a zone boundary, we send ZONE so the server sends a new entity LIST.
  isZoningTile(x, y) {
    const zw = 28, zh = 12;
    // Check if the player is on the edge of a zone cell
    const lx = (x - 1) % zw;
    const ly = (y - 1) % zh;
    return lx === 0 || ly === 0 || lx === zw - 1 || ly === zh - 1;
  }

  getZoningOrientation(x, y) {
    const zw = 28, zh = 12;
    const lx = (x - 1) % zw;
    const ly = (y - 1) % zh;
    if (lx === 0) return Types.Orientations.LEFT;
    if (ly === 0) return Types.Orientations.UP;
    if (lx === zw - 1) return Types.Orientations.RIGHT;
    if (ly === zh - 1) return Types.Orientations.DOWN;
    return null;
  }

  enqueueZoningFrom(x, y) {
    this.zoningQueue.push({ x, y });
    if (this.zoningQueue.length === 1) this.startZoningFrom(x, y);
  }

  startZoningFrom(x, y) {
    this.zoningOrientation = this.getZoningOrientation(x, y);
    this.bubbleManager.clean();
    this.socket.send(JSON.stringify([Types.Messages.ZONE]));
    this.initAnimatedTiles();
    this.endZoning();
  }

  endZoning() {
    this.currentZoning = null;
    this.resetZone();
    this.zoningQueue.shift();
    if (this.zoningQueue.length > 0) {
      const pos = this.zoningQueue[0];
      this.startZoningFrom(pos.x, pos.y);
    }
  }

  isZoning() { return this.currentZoning !== null; }

  resetZone() {
    this.bubbleManager.clean();
    this.initAnimatedTiles();
  }

  // ===== Input handling =====
  click(x, y) {
    if (!this.started || !this.player || this.player.isDead) return;
    if (this.isZoning()) return;
    const gridX = Math.floor((x / SCALE + this.camera.x) / 16);
    const gridY = Math.floor((y / SCALE + this.camera.y) / 16);
    if (gridX < 0 || gridY < 0 || gridX >= this.map.width || gridY >= this.map.height) return;
    if (this.hoveringCollidingTile || this.hoveringPlateauTile) return;

    const entity = this.getEntityAt(gridX, gridY);
    if (entity) {
      if (entity instanceof Mob && !entity.isDying) {
        this.player.engage(entity);
        this.socket.send(JSON.stringify([Types.Messages.ATTACK, entity.id]));
      } else if (entity instanceof Npc) {
        if (!this.player.isAdjacentNonDiagonal(entity)) {
          this.player.setTarget(entity);
          this.player.follow(entity);
        } else {
          this.makeNpcTalk(entity);
          this.tryUnlockingAchievement("SMALL_TALK");
        }
      } else if (entity instanceof Chest) {
        this.player.setTarget(entity);
        this.player.follow(entity);
      } else if (entity instanceof Item) {
        this.player.isLootMoving = true;
        this.player.go(gridX, gridY);
        this.socket.send(JSON.stringify([Types.Messages.LOOTMOVE, gridX, gridY, entity.id]));
      } else {
        this.player.go(gridX, gridY);
      }
    } else {
      this.player.go(gridX, gridY);
    }
  }

  onMouseMove(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    const gridX = Math.floor((x / SCALE + this.camera.x) / 16);
    const gridY = Math.floor((y / SCALE + this.camera.y) / 16);
    this.hoveringMob = false;
    this.hoveringNpc = false;
    this.hoveringItem = false;
    this.hoveringChest = false;
    this.hoveringCollidingTile = false;
    this.hoveringPlateauTile = false;
    const entity = this.getEntityAt(gridX, gridY);
    if (entity) {
      if (entity instanceof Mob) this.hoveringMob = true;
      else if (entity instanceof Npc) this.hoveringNpc = true;
      else if (entity instanceof Chest) this.hoveringChest = true;
      else if (entity instanceof Item) this.hoveringItem = true;
    }
    if (!entity && this.map.isColliding(gridX, gridY)) this.hoveringCollidingTile = true;
    if (this.player) this.hoveringPlateauTile = this.player.isOnPlateau ? !this.map.isPlateau(gridX, gridY) : this.map.isPlateau(gridX, gridY);
    this.updateCursorLogic();
  }

  sendChat(text) {
    this.socket.send(JSON.stringify([Types.Messages.CHAT, text]));
    this.hasChatted = true;
    if (this.player) {
      this.bubbleManager.create(this.player.id, text);
      this.assignBubbleTo(this.player);
    }
    if (this.chatLog) {
      const entry = { name: this.player.name || 'You', text, time: Date.now() };
      this.chatLog.push(entry);
      if (this.chatLog.length > 50) this.chatLog.shift();
      if (this.onChatLog) this.onChatLog(this.chatLog);
    }
    speakText(text, this.myVoice, 1, 0);
  }

  onStarted(cb) { this.started_callback = cb; }
  onDisconnected(cb) { this.disconnected_callback = cb; }
  onPlayerDeath(cb) { this.playerdeath_callback = cb; }

  isNear(a, b, dist) {
    return Math.abs(a.gridX - b.gridX) <= dist && Math.abs(a.gridY - b.gridY) <= dist;
  }

  // ===== Rendering =====
  render() {
    this.currentTime = Date.now();
    this.updateCharacters();
    this.updateAnimations();
    this.updateTransitions();
    this.updateAnimatedTiles();
    this.infoManager.update(this.currentTime);
    this.bubbleManager.update(this.currentTime);
    this.updateBubbles();
    this.updateChatHint();

    if (!this.started) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.bgCtx.clearRect(0, 0, this.background.width, this.background.height);
      this.fgCtx.clearRect(0, 0, this.foreground.width, this.foreground.height);
      return;
    }

    // Camera follows player smoothly
    if (this.player && this.started) {
      this.camera.lookAt(this.player);
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.bgCtx.clearRect(0, 0, this.background.width, this.background.height);
    this.fgCtx.clearRect(0, 0, this.foreground.width, this.foreground.height);
    this.drawBackground();
    this.drawAnimatedTiles();
    this.drawEntities();
    this.drawHighTiles();
    this.drawNames();
    this.drawMobHealthBars();
    this.drawSelectedCell();
    this.drawTargetCell();
    this.infoManager.draw(this.ctx, this.camera, SCALE);
    this.drawCursor();
  }

  updateCharacters() {
    const self = this;
    this.forEachEntity(function(entity) {
      if (entity.isLoaded) {
        if (entity instanceof Character) {
          self.updateCharacterMovement(entity);
          self.updateCharacterAttack(entity);
        }
        if (entity.isFading) {
          const dt = self.currentTime - entity.startFadingTime;
          entity.fadingAlpha = dt > 1000 ? 1 : dt / 1000;
          if (dt > 1000) entity.isFading = false;
        }
      }
    });
  }

  updateCharacterMovement(c) {
    if (!c.isMoving() || c.movement.inProgress) return;
    const tick = Math.round(16 / Math.round(c.moveSpeed / (1000 / 60)));
    if (c.orientation === Types.Orientations.LEFT) {
      c.movement.start(this.currentTime, x => { c.x = x; c.hasMoved(); }, () => { c.x = c.movement.endValue; c.hasMoved(); c.nextStep(); }, c.x - tick, c.x - 16, c.moveSpeed);
    } else if (c.orientation === Types.Orientations.RIGHT) {
      c.movement.start(this.currentTime, x => { c.x = x; c.hasMoved(); }, () => { c.x = c.movement.endValue; c.hasMoved(); c.nextStep(); }, c.x + tick, c.x + 16, c.moveSpeed);
    } else if (c.orientation === Types.Orientations.UP) {
      c.movement.start(this.currentTime, y => { c.y = y; c.hasMoved(); }, () => { c.y = c.movement.endValue; c.hasMoved(); c.nextStep(); }, c.y - tick, c.y - 16, c.moveSpeed);
    } else if (c.orientation === Types.Orientations.DOWN) {
      c.movement.start(this.currentTime, y => { c.y = y; c.hasMoved(); }, () => { c.y = c.movement.endValue; c.hasMoved(); c.nextStep(); }, c.y + tick, c.y + 16, c.moveSpeed);
    }
  }

  updateCharacterAttack(c) {
    if (!c.isAttacking() || !c.hasTarget() || c.isDead) return;
    if (c instanceof Mob) {
      // Client-driven mob AI: chase the target, attack on cooldown, and report hits
      // to the server (HURT) so it can apply authoritative damage to the player.
      if (!this.isNear(c, c.target, MOB_CHASE_RANGE)) {
        c.disengage();
        c.idle();
        return;
      }
      if (c.canAttack(this.currentTime)) {
        if (c.hasTarget() && c.getOrientationTo(c.target) !== c.orientation) c.lookAtTarget();
        c.hit();
        if (c.target.id === this.playerId) {
          if (this.player && this.player.invincible) {
            if (this.audioManager) this.audioManager.playSound("hurt");
          } else {
            this.socket.send(JSON.stringify([Types.Messages.HURT, c.id]));
            if (this.audioManager) this.audioManager.playSound(Math.random() < 0.5 ? "hit1" : "hit2");
          }
        }
      } else if (c.isDiagonallyAdjacent(c.target) && !c.isMoving()) {
        c.follow(c.target);
      } else if (!c.isAdjacentNonDiagonal(c.target) && !c.isMoving()) {
        c.follow(c.target);
      }
      return;
    }
    if (!c.canAttack(this.currentTime)) {
      if (c.hasTarget() && c.isDiagonallyAdjacent(c.target) && !c.isMoving()) {
        c.follow(c.target);
      }
      return;
    }
    if (c.hasTarget() && c.getOrientationTo(c.target) !== c.orientation) c.lookAtTarget();
    c.hit();
    if (c.id === this.playerId) {
      this.socket.send(JSON.stringify([Types.Messages.HIT, c.target.id]));
      if (this.audioManager) this.audioManager.playSound(Math.random() < 0.5 ? "hit1" : "hit2");
    }
    if (c.hasTarget() && c.target.id === this.playerId && this.player && !this.player.invincible) {
      if (this.audioManager) this.audioManager.playSound("hurt");
    }
  }

  updateAnimations() {
    const t = this.currentTime;
    this.forEachEntity(function(entity) {
      if (entity.currentAnimation && entity.currentAnimation.update(t)) entity.setDirty();
    });
    if (this.sparksAnimation) this.sparksAnimation.update(t);
    if (this.targetAnimation) this.targetAnimation.update(t);
  }

  updateTransitions() {
    const self = this;
    this.forEachEntity(function(entity) {
      if (entity.movement && entity.movement.inProgress) entity.movement.step(self.currentTime);
    });
  }

  drawBackground() {
    const self = this;
    this.forEachVisibleTile(function(id, index) {
      self.drawTile(self.bgCtx, id, index);
    });
  }

  drawAnimatedTiles() {
    const self = this;
    this.forEachAnimatedTile(function(tile) {
      self.drawTile(self.ctx, tile.id, tile.index);
    });
  }

  drawTile(ctx, tileid, cellid) {
    if (tileid === undefined || tileid === -1) return;
    if (Array.isArray(tileid)) tileid = tileid[0];
    const s = SCALE;
    const ts = TILESIZE;
    const setW = this.tilesetW / s;
    const gridW = this.map.width;
    const srcX = getX(tileid + 1, setW) * ts;
    const srcY = Math.floor(tileid / setW) * ts;
    const dstX = (getX(cellid + 1, gridW) * ts - this.camera.x) * s;
    const dstY = (Math.floor(cellid / gridW) * ts - this.camera.y) * s;
    ctx.drawImage(this.tileset, srcX * s, srcY * s, ts * s, ts * s, dstX, dstY, ts * s, ts * s);
  }

  drawHighTiles() {
    const self = this;
    this.forEachVisibleTile(function(id, index) {
      if (self.map.high.includes(id + 1)) {
        self.drawTile(self.fgCtx, id, index);
      }
    });
  }

  drawEntities() {
    const self = this;
    const camX = this.camera.x, camY = this.camera.y, s = SCALE;
    const ts = TILESIZE;
    const os = 2; // source scale (non-upscaled: sprites in atlas are at 2x)
    const ds = 1; // display scale (non-upscaled: no extra dest scaling)
    const ctx = this.ctx;
    this.forEachEntity(function(entity) {
      if (!entity.isVisible()) return;
      if (!self.camera.isVisible(entity)) return;
      const sprite = entity.sprite;
      const anim = entity.currentAnimation;
      if (!anim || !sprite || !sprite.isLoaded) return;
      const frame = anim.currentFrame;
      const x = sprite.atlasX + frame.x * os;
      const y = sprite.atlasY + frame.y * os;
      const w = sprite.width * os;
      const h = sprite.height * os;
      const dx = (entity.x - camX) * s;
      const dy = (entity.y - camY) * s;
      const dw = w * ds;
      const dh = h * ds;
      const ox = sprite.offsetX * s;
      const oy = sprite.offsetY * s;

      ctx.save();
      if (entity.isFading) ctx.globalAlpha = entity.fadingAlpha;

      if (entity.flipSpriteX) {
        ctx.translate(dx + ts * s, dy);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(dx, dy);
      }

      const shadow = self.shadows && self.shadows.small ? self.shadows.small : null;
      if (entity.hasShadow() && shadow) {
        const soY = (entity.shadowOffsetY || 0) * ds;
        ctx.drawImage(shadow.image, shadow.atlasX, shadow.atlasY, shadow.width * os, shadow.height * os, 0, soY, shadow.width * os * ds, shadow.height * os * ds);
      }

      ctx.drawImage(sprite.image, x, y, w, h, ox, oy, dw, dh);

      // Draw sparks overlay for items (except cake)
      if (entity instanceof Item && entity.kind !== Types.Entities.CAKE) {
        const sparks = self.sprites["sparks"];
        const sparksAnim = self.sparksAnimation;
        if (sparks && sparks.isLoaded && sparksAnim) {
          const sf = sparksAnim.currentFrame;
          const sx = sparks.atlasX + sf.x * os;
          const sy = sparks.atlasY + sf.y * os;
          const sw = sparks.width * os;
          const sh = sparks.height * os;
          ctx.drawImage(sparks.image, sx, sy, sw, sh, sparks.offsetX * s, sparks.offsetY * s, sw * ds, sh * ds);
        }
      }

      if (entity instanceof Character && !entity.isDead && entity.hasWeapon && entity.hasWeapon()) {
        const weaponName = entity.getWeaponName ? entity.getWeaponName() : null;
        if (weaponName && self.sprites[weaponName]) {
          const weapon = self.sprites[weaponName];
          const weaponAnimData = weapon.animationData[anim.name];
          if (weaponAnimData) {
            const wi = frame.index < weaponAnimData.length ? frame.index : frame.index % weaponAnimData.length;
            const wx = weapon.atlasX + weapon.width * wi * os;
            const wy = weapon.atlasY + weapon.height * weaponAnimData.row * os;
            ctx.drawImage(weapon.image, wx, wy, weapon.width * os, weapon.height * os, weapon.offsetX * s, weapon.offsetY * s, weapon.width * os * ds, weapon.height * os * ds);
          }
        }
      }

      ctx.restore();
    });
  }

  drawNames() {
    const self = this;
    const camX = this.camera.x, camY = this.camera.y, s = SCALE;
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.forEachEntity(function(entity) {
      if (!entity.isVisible()) return;
      if (!self.camera.isVisible(entity)) return;
      if (!(entity instanceof Player) || !entity.name) return;
      const dx = Math.round((entity.x - camX) * s);
      const dy = Math.round((entity.y - camY) * s);
      const nameY = dy + Math.round((entity.nameOffsetY || -10) * s);
      ctx.font = "10px 'Press Start 2P', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = entity.id === self.playerId ? '#00ff00' : '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'miter';
      const nameX = Math.round(dx + (16 * s) / 2);
      ctx.strokeText(entity.name, nameX, nameY);
      ctx.fillText(entity.name, nameX, nameY);
    });
    ctx.restore();
  }

  drawMobHealthBars() {
    const self = this;
    const camX = this.camera.x, camY = this.camera.y, s = SCALE;
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.forEachEntity(function(entity) {
      if (!entity.isVisible()) return;
      if (!self.camera.isVisible(entity)) return;
      if (!(entity instanceof Mob)) return;
      if (!entity.maxHitPoints || entity.maxHitPoints <= 0) return;
      if (entity.isDead) return;
      const hpRatio = entity.hitPoints / entity.maxHitPoints;
      if (hpRatio >= 1 && !entity.isAttacking() && !self.playerHasAttacked(entity)) return;
      const dx = Math.round((entity.x - camX) * s);
      const dy = Math.round((entity.y - camY) * s);
      const barW = 20 * s;
      const barH = 3 * s;
      const barX = Math.round(dx + (16 * s) / 2 - barW / 2);
      const barY = dy - 12 * s;
      ctx.fillStyle = '#000000';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = '#330000';
      ctx.fillRect(barX, barY, barW, barH);
      if (hpRatio > 0.5) ctx.fillStyle = '#00ff00';
      else if (hpRatio > 0.25) ctx.fillStyle = '#ffff00';
      else ctx.fillStyle = '#ff0000';
      ctx.fillRect(barX, barY, Math.ceil(barW * hpRatio), barH);
    });
    ctx.restore();
  }

  playerHasAttacked(mob) {
    return this.attackedMobs.has(mob.id);
  }

  drawSelectedCell() {
    if (!this.selectedCellVisible || !this.started) return;
    const s = SCALE;
    const ts = TILESIZE;
    const x = (this.selectedX * ts - this.camera.x) * s;
    const y = (this.selectedY * ts - this.camera.y) * s;
    const sprite = this.cursors && this.cursors["target"];
    const anim = this.targetAnimation;
    if (sprite && sprite.isLoaded && anim) {
      const frame = anim.currentFrame;
      const os = 2;
      const sx = sprite.atlasX + frame.x * os;
      const sy = sprite.atlasY + frame.y * os;
      const w = sprite.width * os;
      const h = sprite.height * os;
      this.ctx.drawImage(sprite.image, sx, sy, w, h, x, y, w, h);
    } else {
      this.ctx.strokeStyle = "rgb(51, 255, 0)";
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([4, 4]);
      this.ctx.strokeRect(x, y, ts * s, ts * s);
      this.ctx.setLineDash([]);
    }
  }

  drawTargetCell() {
    if (!this.targetCellVisible || !this.started) return;
    const s = SCALE;
    const ts = TILESIZE;
    const mx = Math.floor((this.mouse.x / SCALE + this.camera.x) / 16);
    const my = Math.floor((this.mouse.y / SCALE + this.camera.y) / 16);
    if (mx < 0 || my < 0 || mx >= this.map.width || my >= this.map.height) return;
    const x = (mx * ts - this.camera.x) * s;
    const y = (my * ts - this.camera.y) * s;
    this.ctx.strokeStyle = this.targetColor || "rgba(255,255,255,0.5)";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, ts * s, ts * s);
  }

  drawCursor() {
    if (!this.currentCursor || !this.started) return;
    const s = SCALE;
    const os = 2;
    const sprite = this.currentCursor;
    if (!sprite || !sprite.isLoaded || sprite.atlasX === undefined || !sprite.image) return;
    const mx = this.mouse.x;
    const my = this.mouse.y;
    this.ctx.drawImage(sprite.image, sprite.atlasX, sprite.atlasY, sprite.width * os, sprite.height * os, mx, my, sprite.width * os, sprite.height * os);
  }

  resize() {
    const container = document.getElementById('game-container');
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.background.width = w;
    this.background.height = h;
    this.foreground.width = w;
    this.foreground.height = h;
    this.camera.gridW = Math.ceil(w / (16 * SCALE)) + 1;
    this.camera.gridH = Math.ceil(h / (16 * SCALE)) + 1;
    if (this.player && this.started) this.camera.lookAt(this.player);
    else if (this.player) this.camera.focusEntity(this.player);
    if (this.started) this.initAnimatedTiles();
    this.ctx.imageSmoothingEnabled = false;
    this.bgCtx.imageSmoothingEnabled = false;
    this.fgCtx.imageSmoothingEnabled = false;
  }
}
