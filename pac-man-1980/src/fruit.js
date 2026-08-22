// src/fruit.js — Phase 2 (task 8): fruit slot, per-level fruit types, timed despawn, drawing.

import { TILE } from "./maze.js";

const FRUITS = [
  { name: "cherry", points: 100 },
  { name: "strawberry", points: 300 },
  { name: "orange", points: 500 },
  { name: "apple", points: 700 },
  { name: "melon", points: 1000 },
  { name: "galaxian", points: 2000 },
  { name: "bell", points: 3000 },
  { name: "key", points: 5000 }
];

export function fruitTypeForLevel(level) {
  if (level <= 1) return 0;
  if (level === 2) return 1;
  return Math.min(FRUITS.length - 1, Math.ceil((level - 2) / 2) + 1);
}

export function fruitPoints(type) {
  return FRUITS[Math.min(FRUITS.length - 1, type)].points;
}

export { drawFruit };

export class FruitSlot {
  constructor(tilePos) {
    this.tile = tilePos;
    this.active = false;
    this.type = 0;
    this.timer = 0;
  }

  spawn(level) {
    this.type = fruitTypeForLevel(level);
    this.active = true;
    this.timer = 9.5;
  }

  despawn() {
    this.active = false;
  }

  update(dt) {
    if (this.active) {
      this.timer -= dt;
      if (this.timer <= 0) this.active = false;
    }
  }

  points() {
    return FRUITS[this.type].points;
  }

  draw(ctx, time) {
    if (!this.active) return;
    const cx = this.tile[0] * TILE + TILE / 2;
    const cy = this.tile[1] * TILE + TILE / 2 + Math.sin(time * 3) * 1.5;
    drawFruit(ctx, this.type, cx, cy);
  }
}

function drawFruit(ctx, type, cx, cy) {
  const s = 0.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  switch (type) {
    case 0: drawCherry(ctx); break;
    case 1: drawStrawberry(ctx); break;
    case 2: drawOrange(ctx); break;
    case 3: drawApple(ctx); break;
    case 4: drawMelon(ctx); break;
    case 5: drawGalaxian(ctx); break;
    case 6: drawBell(ctx); break;
    default: drawKey(ctx); break;
  }
  ctx.restore();
}

function drawCherry(ctx) {
  ctx.strokeStyle = "#5aa020";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(-7, 2);
  ctx.moveTo(0, -18);
  ctx.lineTo(8, 0);
  ctx.stroke();
  ctx.fillStyle = "#ff2a2a";
  for (const [x, y] of [[-8, 6], [8, 4]]) {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-11, 2, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawStrawberry(ctx) {
  ctx.fillStyle = "#ff4d7a";
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.quadraticCurveTo(14, -2, 0, -16);
  ctx.quadraticCurveTo(-14, -2, 0, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#5aa020";
  for (const [x, y] of [[-6, -12], [6, -12], [-2, -16], [2, -16]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 4.5, 2.5, x > 0 ? 0.5 : -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  for (const [x, y] of [[-5, 2], [4, -2], [-2, 6], [6, 7]]) {
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOrange(ctx) {
  ctx.fillStyle = "#ffa53a";
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5aa020";
  ctx.beginPath();
  ctx.ellipse(0, -13, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawApple(ctx) {
  ctx.fillStyle = "#ff4a3a";
  ctx.beginPath();
  ctx.arc(-7, 0, 8, 0, Math.PI * 2);
  ctx.arc(7, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5a3a20";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(2, -18);
  ctx.stroke();
  ctx.fillStyle = "#5aa020";
  ctx.beginPath();
  ctx.ellipse(5, -17, 5, 3, 0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawMelon(ctx) {
  ctx.fillStyle = "#8dcc3a";
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#4a8a2a";
  ctx.lineWidth = 2;
  for (const [x, y, r, rx, ry] of [[-9, 0, 9, 14, 11], [0, 0, 9, 14, 11], [9, 0, 9, 14, 11]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  }
}

function drawGalaxian(ctx) {
  ctx.fillStyle = "#7ddfff";
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(10, 6);
  ctx.lineTo(0, 1);
  ctx.lineTo(-10, 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff2a4a";
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(5, 0);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.fill();
}

function drawBell(ctx) {
  ctx.fillStyle = "#ffe000";
  ctx.beginPath();
  ctx.moveTo(-11, 8);
  ctx.quadraticCurveTo(-12, -8, 0, -14);
  ctx.quadraticCurveTo(12, -8, 11, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c8a000";
  ctx.beginPath();
  ctx.arc(0, 9, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawKey(ctx) {
  ctx.fillStyle = "#ffe000";
  ctx.beginPath();
  ctx.arc(-9, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-2, -2.5, 18, 5);
  ctx.fillRect(12, -2.5, 4, 5);
  ctx.fillRect(12, 2.5, 4, 5);
  ctx.fillRect(8, 2.5, 4, 5);
}
