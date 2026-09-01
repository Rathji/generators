// Borrowed Quest client engine - ported from Mozilla's BrowserQuest client/js/*.js to vanilla ES6
// Original uses RequireJS/AMD + jQuery + Class.js; this is a consolidated rewrite.
import { Types, MobSpeeds } from '../types.js';
import { Pathfinder } from './pathfinder.js';

// ===== Asset URLs (uploaded to perchance file host) =====
const TILESET_URL = "https://user.uploads.dev/file/db367fe22cc97825cbc27ed3c8b0fb70.png";
const MAP_URL = "https://user.uploads.dev/file/97bc07366bbb0bdac02cc58cd08326a1.json";
const SERVER_MAP_URL = "https://user.uploads.dev/file/ab50edbff2186f4d9131e08bc5cf1888.json";
const ATLAS_URL = "https://user.uploads.dev/file/93a4fecbd7bc7bc9c16d628a58d7943c.png";

// ===== Sprite class - manages atlas-based sprites =====
class Sprite {
  constructor(name, data) {
    this.name = name;
    this.id = data.id || name;
    this.width = data.width;
    this.height = data.height;
    this.offsetX = data.offset_x !== undefined ? data.offset_x : -16;
    this.offsetY = data.offset_y !== undefined ? data.offset_y : -16;
    this.atlasX = data.atlas_x;
    this.atlasY = data.atlas_y;
    this.animationData = data.animations;
    this.isLoaded = false;
  }

  setImage(img) {
    this.image = img;
    this.isLoaded = true;
  }

  createAnimations() {
    const animations = {};
    for (const name in this.animationData) {
      const a = this.animationData[name];
      animations[name] = new Animation(name, a.length, a.row, this.width, this.height);
    }
    return animations;
  }
}

// ===== Animation class =====
class Animation {
  constructor(name, length, row, width, height) {
    this.name = name;
    this.length = length;
    this.row = row;
    this.width = width;
    this.height = height;
    this.reset();
  }

  tick() {
    let i = this.currentFrame.index;
    i = (i < this.length - 1) ? i + 1 : 0;
    if (this.count > 0) {
      if (i === 0) {
        this.count -= 1;
        if (this.count === 0) {
          this.currentFrame.index = 0;
          if (this.endcount_callback) this.endcount_callback();
          return;
        }
      }
    }
    this.currentFrame.x = this.width * i;
    this.currentFrame.y = this.height * this.row;
    this.currentFrame.index = i;
  }

  setSpeed(speed) { this.speed = speed; }
  setCount(count, onEndCount) { this.count = count; this.endcount_callback = onEndCount; }

  isTimeToAnimate(time) { return (time - this.lastTime) > this.speed; }

  update(time) {
    if (this.lastTime === 0 && this.name.substr(0, 3) === "atk") this.lastTime = time;
    if (this.isTimeToAnimate(time)) {
      this.lastTime = time;
      this.tick();
      return true;
    }
    return false;
  }

  reset() {
    this.lastTime = 0;
    this.speed = 100;
    this.currentFrame = { index: 0, x: 0, y: this.row * this.height };
  }
}

// ===== Timer class =====
class Timer {
  constructor(duration, startTime) {
    this.lastTime = startTime || 0;
    this.duration = duration;
  }
  isOver(time) {
    if ((time - this.lastTime) > this.duration) { this.lastTime = time; return true; }
    return false;
  }
}

// ===== Transition class (for smooth movement) =====
class Transition {
  constructor() { this.inProgress = false; }
  start(currentTime, updateFunction, stopFunction, startValue, endValue, duration) {
    this.startTime = currentTime;
    this.updateFunction = updateFunction;
    this.stopFunction = stopFunction;
    this.startValue = startValue;
    this.endValue = endValue;
    this.duration = duration;
    this.inProgress = true;
    this.count = 0;
  }
  step(currentTime) {
    if (!this.inProgress) return;
    if (this.count > 0) { this.count -= 1; return; }
    let elapsed = currentTime - this.startTime;
    if (elapsed > this.duration) elapsed = this.duration;
    const diff = this.endValue - this.startValue;
    let i = this.startValue + ((diff / this.duration) * elapsed);
    i = Math.round(i);
    if (elapsed === this.duration || i === this.endValue) {
      this.stop();
      if (this.stopFunction) this.stopFunction();
    } else if (this.updateFunction) {
      this.updateFunction(i);
    }
  }
  stop() { this.inProgress = false; }
}

// ===== Entity base class =====
class Entity {
  constructor(id, kind) {
    this.id = id;
    this.kind = kind;
    this.sprite = null;
    this.flipSpriteX = false;
    this.flipSpriteY = false;
    this.animations = null;
    this.currentAnimation = null;
    this.visible = true;
    this.isFading = false;
    this.isOnPlateau = false;
    this.setGridPosition(0, 0);
  }

  setPosition(x, y) { this.x = x; this.y = y; }
  setGridPosition(x, y) { this.gridX = x; this.gridY = y; this.setPosition(x * 16, y * 16); }

  setSprite(sprite) {
    if (!sprite) return;
    if (this.sprite && this.sprite.name === sprite.name) return;
    this.sprite = sprite;
    this.normalSprite = sprite;
    this.animations = sprite.createAnimations();
    this.isLoaded = true;
    if (this.ready_func) this.ready_func();
  }

  getSpriteName() { return Types.getKindAsString(this.kind); }
  getSprite() { return this.sprite; }

  getAnimationByName(name) { return this.animations ? this.animations[name] : null; }

  setAnimation(name, speed, count, onEndCount) {
    if (!this.isLoaded) return;
    if (this.currentAnimation && this.currentAnimation.name === name) return;
    const a = this.getAnimationByName(name);
    if (a) {
      this.currentAnimation = a;
      if (name.substr(0, 3) === "atk") this.currentAnimation.reset();
      this.currentAnimation.setSpeed(speed);
      this.currentAnimation.setCount(count || 0, onEndCount || (() => this.idle()));
    }
  }

  hasShadow() { return false; }
  ready(f) { this.ready_func = f; }
  clean() { this.stopBlinking(); }

  getDistanceToEntity(entity) {
    const dx = Math.abs(entity.gridX - this.gridX);
    const dy = Math.abs(entity.gridY - this.gridY);
    return (dx > dy) ? dx : dy;
  }
  isAdjacent(entity) { return entity ? this.getDistanceToEntity(entity) <= 1 : false; }
  isAdjacentNonDiagonal(entity) {
    return this.isAdjacent(entity) && !(this.gridX !== entity.gridX && this.gridY !== entity.gridY);
  }
  isDiagonallyAdjacent(entity) { return this.isAdjacent(entity) && !this.isAdjacentNonDiagonal(entity); }

  fadeIn(currentTime) { this.isFading = true; this.startFadingTime = currentTime; }
  blink(speed) { this.blinking = setInterval(() => this.visible = !this.visible, speed); }
  stopBlinking() { if (this.blinking) clearInterval(this.blinking); this.visible = true; }
  setDirty() { this.isDirty = true; if (this.dirty_callback) this.dirty_callback(this); }
  onDirty(cb) { this.dirty_callback = cb; }
  isMoving() { return this.path !== null; }
  isVisible() { return this.visible; }
  setVisible(v) { this.visible = v; }
}

// ===== Character class =====
class Character extends Entity {
  constructor(id, kind) {
    super(id, kind);
    this.nextGridX = -1;
    this.nextGridY = -1;
    this.orientation = Types.Orientations.DOWN;
    this.atkSpeed = 50;
    this.moveSpeed = 120;
    this.walkSpeed = 100;
    this.idleSpeed = 450;
    this.setAttackRate(800);
    this.movement = new Transition();
    this.path = null;
    this.newDestination = null;
    this.target = null;
    this.unconfirmedTarget = null;
    this.attackers = {};
    this.hitPoints = 0;
    this.maxHitPoints = 0;
    this.isDead = false;
    this.attackingMode = false;
    this.followingMode = false;
  }

  setMaxHitPoints(hp) { this.maxHitPoints = hp; this.hitPoints = hp; }
  hasWeapon() { return false; }
  hasShadow() { return true; }

  animate(animation, speed, count, onEndCount) {
    if (this.currentAnimation && this.currentAnimation.name === "death") return;
    this.flipSpriteX = false;
    this.flipSpriteY = false;
    const oriented = ['atk', 'walk', 'idle'];
    if (oriented.includes(animation)) {
      animation += "_" + (this.orientation === Types.Orientations.LEFT ? "right" : Types.getOrientationAsString(this.orientation));
      this.flipSpriteX = (this.orientation === Types.Orientations.LEFT);
    }
    this.setAnimation(animation, speed, count, onEndCount);
  }

  turnTo(orientation) { this.orientation = orientation; this.idle(); }
  setOrientation(o) { if (o) this.orientation = o; }
  idle(orientation) { this.setOrientation(orientation); this.animate("idle", this.idleSpeed); }
  hit(orientation) { this.setOrientation(orientation); this.animate("atk", this.atkSpeed, 1); }
  walk(orientation) { this.setOrientation(orientation); this.animate("walk", this.walkSpeed); }

  moveTo_(x, y) {
    this.destination = { gridX: x, gridY: y };
    this.adjacentTiles = {};
    if (this.isMoving()) this.continueTo(x, y);
    else { const path = this.requestPathfindingTo(x, y); this.followPath(path); }
  }

  requestPathfindingTo(x, y) {
    if (this.request_path_callback) return this.request_path_callback(x, y);
    return [];
  }

  followPath(path) {
    if (path.length > 1) {
      this.path = path;
      this.step = 0;
      if (this.followingMode) path.pop();
      if (this.start_pathing_callback) this.start_pathing_callback(path);
      this.nextStep();
    }
  }

  continueTo(x, y) { this.newDestination = { x: x, y: y }; }

  nextStep() {
    let stop = false, x, y, path;
    if (this.isMoving()) {
      if (this.before_step_callback) this.before_step_callback();
      this.updatePositionOnGrid();
      this.checkAggro();
      if (this.interrupted) { stop = true; this.interrupted = false; }
      else {
        if (this.hasNextStep()) {
          this.nextGridX = this.path[this.step + 1][0];
          this.nextGridY = this.path[this.step + 1][1];
        }
        if (this.step_callback) this.step_callback();
        if (this.hasChangedItsPath()) {
          x = this.newDestination.x; y = this.newDestination.y;
          path = this.requestPathfindingTo(x, y);
          this.newDestination = null;
          if (path.length < 2) stop = true;
          else this.followPath(path);
        } else if (this.hasNextStep()) {
          this.step += 1;
          this.updateMovement();
        } else stop = true;
      }
      if (stop) {
        this.path = null;
        this.idle();
        if (this.stop_pathing_callback) this.stop_pathing_callback(this.gridX, this.gridY);
      }
    }
  }

  updateMovement() {
    const p = this.path, i = this.step;
    if (p[i][0] < p[i - 1][0]) this.walk(Types.Orientations.LEFT);
    if (p[i][0] > p[i - 1][0]) this.walk(Types.Orientations.RIGHT);
    if (p[i][1] < p[i - 1][1]) this.walk(Types.Orientations.UP);
    if (p[i][1] > p[i - 1][1]) this.walk(Types.Orientations.DOWN);
  }

  updatePositionOnGrid() { this.setGridPosition(this.path[this.step][0], this.path[this.step][1]); }
  hasNextStep() { return (this.path.length - 1 > this.step); }
  hasChangedItsPath() { return this.newDestination !== null; }

  onBeforeStep(cb) { this.before_step_callback = cb; }
  onStep(cb) { this.step_callback = cb; }
  onStartPathing(cb) { this.start_pathing_callback = cb; }
  onStopPathing(cb) { this.stop_pathing_callback = cb; }
  onAggro(cb) { this.aggro_callback = cb; }
  onCheckAggro(cb) { this.checkaggro_callback = cb; }
  onDeath(cb) { this.death_callback = cb; }
  onHasMoved(cb) { this.hasmoved_callback = cb; }
  onRequestPath(cb) { this.request_path_callback = cb; }

  checkAggro() { if (this.checkaggro_callback) this.checkaggro_callback(); }
  aggro(c) { if (this.aggro_callback) this.aggro_callback(c); }

  lookAtTarget() { if (this.target) this.turnTo(this.getOrientationTo(this.target)); }
  go(x, y) {
    if (this.isAttacking()) this.disengage();
    else if (this.followingMode) { this.followingMode = false; this.target = null; }
    this.moveTo_(x, y);
  }
  follow(entity) { if (entity) { this.followingMode = true; this.moveTo_(entity.gridX, entity.gridY); } }
  stop() { if (this.isMoving()) this.interrupted = true; }
  engage(c) { this.attackingMode = true; this.setTarget(c); this.follow(c); }
  disengage() { this.attackingMode = false; this.followingMode = false; this.removeTarget(); }
  isAttacking() { return this.attackingMode; }

  getOrientationTo(c) {
    if (this.gridX < c.gridX) return Types.Orientations.RIGHT;
    if (this.gridX > c.gridX) return Types.Orientations.LEFT;
    if (this.gridY > c.gridY) return Types.Orientations.UP;
    return Types.Orientations.DOWN;
  }

  isAttackedBy(c) { return c.id in this.attackers; }
  addAttacker(c) { if (!this.isAttackedBy(c)) this.attackers[c.id] = c; }
  removeAttacker(c) { if (this.isAttackedBy(c)) delete this.attackers[c.id]; }
  forEachAttacker(cb) { for (const id in this.attackers) cb(this.attackers[id]); }

  setTarget(c) {
    if (this.target !== c) {
      if (this.hasTarget()) this.removeTarget();
      this.unconfirmedTarget = null;
      this.target = c;
    }
  }
  removeTarget() {
    if (this.target) {
      if (this.target instanceof Character) this.target.removeAttacker(this);
      this.target = null;
    }
  }
  hasTarget() { return this.target !== null; }
  waitToAttack(c) { this.unconfirmedTarget = c; }
  isWaitingToAttack(c) { return this.unconfirmedTarget === c; }
  canAttack(time) { return this.canReachTarget() && this.attackCooldown.isOver(time); }
  canReachTarget() { return this.hasTarget() && this.isAdjacentNonDiagonal(this.target); }

  die() {
    this.removeTarget();
    this.isDead = true;
    if (this.death_callback) this.death_callback();
  }

  hasMoved() {
    this.setDirty();
    if (this.hasmoved_callback) this.hasmoved_callback(this);
  }

  hurt() {
    this.stopHurting();
    if (this.sprite && this.sprite.hurtSprite) {
      this.sprite = this.sprite.hurtSprite;
    }
    this.hurting = setTimeout(() => this.stopHurting(), 75);
  }
  stopHurting() {
    if (this.normalSprite) this.sprite = this.normalSprite;
    if (this.hurting) clearTimeout(this.hurting);
  }
  setAttackRate(rate) { this.attackCooldown = new Timer(rate); }
}

// ===== Player class =====
class Player extends Character {
  constructor(id, name, kind) {
    super(id, kind || Types.Entities.WARRIOR);
    this.name = name;
    this.nameOffsetY = -10;
    this.spriteName = "clotharmor";
    this.weaponName = "sword1";
    this.isLootMoving = false;
  }

  loot(item) {
    if (!item) return;
    let rank, currentRank, msg;
    let currentArmorName = this.currentArmorSprite ? this.currentArmorSprite.name : this.spriteName;
    if (item.type === "armor") {
      rank = Types.getArmorRank(item.kind);
      currentRank = Types.getArmorRank(Types.getKindFromString(currentArmorName));
      msg = "You are wearing a better armor";
    } else if (item.type === "weapon") {
      rank = Types.getWeaponRank(item.kind);
      currentRank = Types.getWeaponRank(Types.getKindFromString(this.weaponName));
      msg = "You are wielding a better weapon";
    }
    if (rank !== undefined && currentRank !== undefined) {
      if (rank === currentRank) throw new Error("You already have this " + item.type);
      if (rank <= currentRank) throw new Error(msg);
    }
    if (Types.isArmor(item.kind) && this.invincible) this.stopInvincibility();
    if (item.onLoot) item.onLoot(this);
  }

  isMovingToLoot() { return this.isLootMoving; }
  getSpriteName() { return this.spriteName; }
  setSpriteName(name) { this.spriteName = name; }
  getWeaponName() { return this.weaponName; }
  setWeaponName(name) { this.weaponName = name; }
  hasWeapon() { return this.weaponName !== null; }
  getArmorSprite() { return this.invincible ? this.currentArmorSprite : this.sprite; }
  getArmorName() { return this.getArmorSprite() ? this.getArmorSprite().id : this.spriteName; }

  switchWeapon(newWeaponName) {
    let count = 14, value = false;
    if (newWeaponName !== this.getWeaponName()) {
      this.switchingWeapon = true;
      const blanking = setInterval(() => {
        value = !value;
        if (value) this.setWeaponName(newWeaponName);
        else this.setWeaponName(null);
        count -= 1;
        if (count === 1) {
          clearInterval(blanking);
          this.switchingWeapon = false;
          if (this.switch_callback) this.switch_callback();
        }
      }, 90);
    }
  }

  switchArmor(newArmorSprite) {
    let count = 14, value = false;
    if (newArmorSprite && newArmorSprite.id !== this.getSpriteName()) {
      this.isSwitchingArmor = true;
      this.setSprite(newArmorSprite);
      this.setSpriteName(newArmorSprite.id);
      const blanking = setInterval(() => {
        this.setVisible(value = !value);
        count -= 1;
        if (count === 1) {
          clearInterval(blanking);
          this.isSwitchingArmor = false;
          if (this.switch_callback) this.switch_callback();
        }
      }, 90);
    }
  }

  onArmorLoot(cb) { this.armorloot_callback = cb; }
  onSwitchItem(cb) { this.switch_callback = cb; }
  onInvincible(cb) { this.invincible_callback = cb; }

  startInvincibility() {
    if (!this.invincible) {
      this.currentArmorSprite = this.getSprite();
      this.invincible = true;
      if (this.invincible_callback) this.invincible_callback();
    } else if (this.invincibleTimeout) clearTimeout(this.invincibleTimeout);
    this.invincibleTimeout = setTimeout(() => { this.stopInvincibility(); this.idle(); }, 15000);
  }

  stopInvincibility() {
    this.invincible = false;
    if (this.currentArmorSprite) {
      this.setSprite(this.currentArmorSprite);
      this.setSpriteName(this.currentArmorSprite.id);
      this.currentArmorSprite = null;
    }
    if (this.invincibleTimeout) clearTimeout(this.invincibleTimeout);
  }
}

// ===== Mob class =====
class Mob extends Character {
  constructor(id, kind) {
    super(id, kind);
    this.aggroRange = 1;
    this.isAggressive = true;
    const speeds = MobSpeeds[kind];
    if (speeds) {
      this.moveSpeed = speeds.move;
      this.atkSpeed = speeds.atk;
      this.idleSpeed = speeds.idle;
      if (speeds.walk) this.walkSpeed = speeds.walk;
      if (speeds.shadowOffsetY !== undefined) this.shadowOffsetY = speeds.shadowOffsetY;
      if (speeds.aggressive !== undefined) this.isAggressive = speeds.aggressive;
      if (speeds.attackRate) this.setAttackRate(speeds.attackRate);
      if (speeds.aggroRange) this.aggroRange = speeds.aggroRange;
    }
  }

  idle(orientation) {
    if (!this.hasTarget() && (this.kind === Types.Entities.DEATHKNIGHT || this.kind === Types.Entities.BOSS)) {
      super.idle(Types.Orientations.DOWN);
    } else {
      super.idle(orientation);
    }
  }
}

// ===== NPC class =====
class Npc extends Character {
  constructor(id, kind) {
    super(id, kind);
    this.idleSpeed = 450;
    this.orientation = Types.Orientations.DOWN;
  }
  hasShadow() { return true; }
}

// ===== Item class =====
class Item extends Entity {
  constructor(id, kind, type) {
    super(id, kind);
    this.itemKind = Types.getKindAsString(kind);
    this.type = type;
    this.wasDropped = false;
  }
  hasShadow() { return true; }
  onLoot(player) {
    if (this.type === "weapon") player.switchWeapon(this.itemKind);
    else if (this.type === "armor") player.armorloot_callback(this.itemKind);
  }
  getSpriteName() { return "item-" + this.itemKind; }
  getLootMessage() { return this.lootMessage; }
}

// ===== FirePotion item =====
class FirePotion extends Item {
  constructor(id) { super(id, Types.Entities.FIREPOTION, "object"); this.lootMessage = "You feel the power of Firefox!"; }
  onLoot(player) { player.startInvincibility(); }
}

// ===== Chest class =====
class Chest extends Entity {
  constructor(id) { super(id, Types.Entities.CHEST); }
  getSpriteName() { return "chest"; }
  isMoving() { return false; }
  open() { if (this.open_callback) this.open_callback(); }
  onOpen(cb) { this.open_callback = cb; }
  hasShadow() { return true; }
}

// ===== Entity Factory =====
function createEntity(kind, id, name) {
  if (!kind) return null;
  if (kind === Types.Entities.WARRIOR) return new Player(id, name);
  if (kind === Types.Entities.CHEST) return new Chest(id);
  if (Types.isMob(kind)) return new Mob(id, kind);
  if (Types.isNpc(kind)) return new Npc(id, kind);
  if (kind === Types.Entities.FIREPOTION) return new FirePotion(id);
  if (Types.isItem(kind)) {
    const type = Types.isWeapon(kind) ? "weapon" : Types.isArmor(kind) ? "armor" : "object";
    const item = new Item(id, kind, type);
    // Set loot messages
    const lootMessages = {
      [Types.Entities.SWORD2]: "You pick up a steel sword",
      [Types.Entities.AXE]: "You pick up an axe",
      [Types.Entities.REDSWORD]: "You pick up a blazing sword",
      [Types.Entities.BLUESWORD]: "You pick up a magic sword",
      [Types.Entities.GOLDENSWORD]: "You pick up the ultimate sword",
      [Types.Entities.MORNINGSTAR]: "You pick up a morning star",
      [Types.Entities.LEATHERARMOR]: "You equip a leather armor",
      [Types.Entities.MAILARMOR]: "You equip a mail armor",
      [Types.Entities.PLATEARMOR]: "You equip a plate armor",
      [Types.Entities.REDARMOR]: "You equip a ruby armor",
      [Types.Entities.GOLDENARMOR]: "You equip a golden armor",
      [Types.Entities.FLASK]: "You drink a health potion",
      [Types.Entities.CAKE]: "You eat a cake",
      [Types.Entities.BURGER]: "You can haz rat burger",
    };
    if (lootMessages[kind]) item.lootMessage = lootMessages[kind];
    return item;
  }
  return null;
}

// ===== Camera =====
class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.gridX = 0; this.gridY = 0;
    this.gridW = 30; this.gridH = 14;
    this.tilesize = 16;
  }
  setPosition(x, y) { this.x = x; this.y = y; this.gridX = Math.floor(x / 16); this.gridY = Math.floor(y / 16); }
  setGridPosition(x, y) { this.gridX = x; this.gridY = y; this.x = x * 16; this.y = y * 16; }
  lookAt(entity) {
    const x = Math.round(entity.x - (Math.floor(this.gridW / 2) * this.tilesize));
    const y = Math.round(entity.y - (Math.floor(this.gridH / 2) * this.tilesize));
    this.setPosition(x, y);
  }
  forEachVisiblePosition(cb, extra) {
    extra = extra || 0;
    for (let y = this.gridY - extra, maxY = this.gridY + this.gridH + (extra * 2); y < maxY; y++)
      for (let x = this.gridX - extra, maxX = this.gridX + this.gridW + (extra * 2); x < maxX; x++)
        cb(x, y);
  }
  isVisible(entity) { return this.isVisiblePosition(entity.gridX, entity.gridY); }
  isVisiblePosition(x, y) {
    return y >= this.gridY && y < this.gridY + this.gridH && x >= this.gridX && x < this.gridX + this.gridW;
  }
  focusEntity(entity) {
    const w = this.gridW - 2, h = this.gridH - 2;
    const x = Math.floor((entity.gridX - 1) / w) * w;
    const y = Math.floor((entity.gridY - 1) / h) * h;
    this.setGridPosition(x, y);
  }
}

// ===== Bubble Manager (chat bubbles) =====
class BubbleManager {
  constructor(container) { this.container = container; this.bubbles = {}; }
  create(id, message, time) {
    if (!this.bubbles[id]) this.bubbles[id] = [];
    if (this.bubbles[id].length >= 3) {
      this.bubbles[id][0].el.remove();
      this.bubbles[id].shift();
    }
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = message;
    this.container.appendChild(el);
    this.bubbles[id].push({ el, timeout: time || 5000, time: Date.now() });
  }
  update(time) {
    for (const id in this.bubbles) {
      const arr = this.bubbles[id];
      for (let i = arr.length - 1; i >= 0; i--) {
        if (Date.now() - arr[i].time > arr[i].timeout) {
          arr[i].el.remove();
          arr.splice(i, 1);
        }
      }
      if (arr.length === 0) delete this.bubbles[id];
    }
  }
  clean() { for (const id in this.bubbles) { this.bubbles[id].forEach(b => b.el.remove()); delete this.bubbles[id]; } }
  destroyBubble(id) { if (this.bubbles[id]) { this.bubbles[id].forEach(b => b.el.remove()); delete this.bubbles[id]; } }
}

export {
  Sprite, Animation, Timer, Transition, Entity, Character, Player, Mob, Npc, Item, Chest,
  createEntity, Camera, BubbleManager,
  TILESET_URL, MAP_URL, SERVER_MAP_URL, ATLAS_URL
};
