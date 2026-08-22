// Task #2: Tile-Based Map Renderer — draws ground/overhead tile layers
// with a palette, honoring a camera viewport (in tiles).

export class MapRenderer {
  constructor(opts = {}) {
    this.tileSize = opts.tileSize ?? 16;
    this.palette = opts.palette ?? {};
  }

  setPalette(palette) {
    this.palette = palette;
  }

  colorFor(tileId) {
    return this.palette[tileId] ?? "#000";
  }

  cameraFor(map, camera) {
    if (camera) return camera;
    return { x: 0, y: 0, w: map.width, h: map.height };
  }

  paintTile(ctx, tileId, px, py, size = this.tileSize) {
    ctx.fillStyle = this.colorFor(tileId);
    ctx.fillRect(Math.round(px), Math.round(py), size, size);
  }

  drawLayer(ctx, map, layer, camera = null, skipZero = false) {
    const cam = this.cameraFor(map, camera);
    const size = this.tileSize;
    const x0 = Math.max(0, Math.floor(cam.x));
    const x1 = Math.min(map.width, Math.ceil(cam.x + cam.w));
    const y0 = Math.max(0, Math.floor(cam.y));
    const y1 = Math.min(map.height, Math.ceil(cam.y + cam.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tileId = layer[y * map.width + x];
        if (skipZero && tileId === 0) continue;
        const px = (x - cam.x) * size;
        const py = (y - cam.y) * size;
        this.paintTile(ctx, tileId, px, py, size);
      }
    }
  }

  render(ctx, map, camera = null) {
    this.drawLayer(ctx, map, map.ground, camera, false);
  }

  renderOverhead(ctx, map, camera = null) {
    this.drawLayer(ctx, map, map.overhead, camera, true);
  }

  renderAll(ctx, map, camera = null, drawEntities = null) {
    this.render(ctx, map, camera);
    if (drawEntities) drawEntities(ctx);
    this.renderOverhead(ctx, map, camera);
  }
}
