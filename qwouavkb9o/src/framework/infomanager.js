// Damage/info floating numbers — ported from BrowserQuest infomanager.js

const damageInfoColors = {
  received: { fill: 'rgb(255, 50, 50)', stroke: 'rgb(255, 180, 180)' },
  inflicted: { fill: 'white', stroke: '#373737' },
  healed: { fill: 'rgb(80, 255, 80)', stroke: 'rgb(50, 120, 50)' },
};

class DamageInfo {
  constructor(id, value, x, y, duration, type) {
    this.id = id;
    this.value = value;
    this.duration = duration;
    this.x = x;
    this.y = y;
    this.opacity = 1.0;
    this.lastTime = 0;
    this.speed = 100;
    this.fillColor = damageInfoColors[type].fill;
    this.strokeColor = damageInfoColors[type].stroke;
  }
  isTimeToAnimate(time) { return (time - this.lastTime) > this.speed; }
  update(time) {
    if (this.isTimeToAnimate(time)) {
      this.lastTime = time;
      this.tick();
    }
  }
  tick() {
    this.y -= 1;
    this.opacity -= 0.07;
    if (this.opacity < 0) this.destroy();
  }
  onDestroy(cb) { this.destroy_callback = cb; }
  destroy() { if (this.destroy_callback) this.destroy_callback(this.id); }
}

export class InfoManager {
  constructor(game) {
    this.game = game;
    this.infos = {};
    this.destroyQueue = [];
  }
  addDamageInfo(value, x, y, type) {
    const time = this.game.currentTime;
    const id = time + '' + Math.abs(value) + '' + x + '' + y;
    const info = new DamageInfo(id, value, x, y, DamageInfo.DURATION, type);
    info.onDestroy((id) => { this.destroyQueue.push(id); });
    this.infos[id] = info;
  }
  forEachInfo(cb) { for (const id in this.infos) cb(this.infos[id]); }
  update(time) {
    this.forEachInfo(info => info.update(time));
    for (const id of this.destroyQueue) delete this.infos[id];
    this.destroyQueue = [];
  }
  draw(ctx, camera, scale) {
    this.forEachInfo(info => {
      if (info.opacity <= 0) return;
      const sx = (info.x + 8 - camera.x) * scale;
      const sy = (info.y - camera.y) * scale;
      ctx.save();
      ctx.globalAlpha = info.opacity;
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.strokeStyle = info.strokeColor;
      ctx.lineWidth = 3;
      ctx.fillStyle = info.fillColor;
      ctx.strokeText(info.value, sx, sy);
      ctx.fillText(info.value, sx, sy);
      ctx.restore();
    });
  }
}
DamageInfo.DURATION = 1000;
