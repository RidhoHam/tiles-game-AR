/**
 * 2D Canvas Piano & Rhythm Tiles Renderer
 *
 * Handles retina HiDPI scaling, lane dividers, falling note tiles,
 * hit zone indicators, and Synthesia-style piano roll rendering.
 */

export class Tiles2DRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    this.width = 0;
    this.height = 0;
    this.hitZoneRatio = options.hitZoneRatio || 0.85;
  }

  /**
   * Resizes canvas to match container client bounds with HiDPI support
   */
  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Clears entire canvas surface
   */
  clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * Draws rhythm lane dividers and background
   * @param {number} laneCount
   */
  drawLanes(laneCount = 8) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const laneW = this.width / laneCount;

    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1;

    for (let i = 1; i < laneCount; i++) {
      const x = Math.round(i * laneW);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    // Hit Line
    const hitY = Math.round(this.height * this.hitZoneRatio);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(this.width, hitY);
    ctx.stroke();
  }

  /**
   * Draws a single falling tile cuboid/rectangle
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {Object} style
   */
  drawTile(x, y, width, height, style = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const radius = 4;

    ctx.fillStyle = style.color || '#fafafa';
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(2, width), Math.max(4, height), radius);
    ctx.fill();

    if (style.borderColor) {
      ctx.strokeStyle = style.borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
