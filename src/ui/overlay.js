// 2D overlay for gesture feedback (knife stroke preview and slash trails).
export class Overlay {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.stroke = null;
    this.slashes = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
  }

  setStroke(s) {
    this.stroke = s ? { ...s } : null;
  }

  slash(s) {
    this.slashes.push({ ...s, t: 0 });
  }

  get busy() {
    return !!this.stroke || this.slashes.length > 0;
  }

  draw(dt) {
    const c = this.ctx;
    const d = this.dpr;
    if (!this.busy && !this._dirty) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._dirty = this.busy;
    c.setTransform(d, 0, 0, d, 0, 0);
    if (this.stroke) {
      const s = this.stroke;
      c.save();
      c.lineCap = 'round';
      c.setLineDash([3, 7]);
      c.shadowColor = 'rgba(0,0,0,0.45)';
      c.shadowBlur = 4;
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(s.ax, s.ay);
      c.lineTo(s.bx, s.by);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,0.95)';
      c.beginPath();
      c.arc(s.ax, s.ay, 3.5, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.t += dt;
      const T = 0.42;
      const u = s.t / T;
      if (u >= 1) {
        this.slashes.splice(i, 1);
        continue;
      }
      // blade sweep: a bright streak that travels along the stroke and fades
      const head = Math.min(1, u * 3.2);
      const tail = Math.max(0, u * 2.2 - 0.6);
      const x0 = s.ax + (s.bx - s.ax) * tail, y0 = s.ay + (s.by - s.ay) * tail;
      const x1 = s.ax + (s.bx - s.ax) * head, y1 = s.ay + (s.by - s.ay) * head;
      const nx = -(s.by - s.ay), ny = s.bx - s.ax;
      const nl = Math.hypot(nx, ny) || 1;
      const w = 4.5 * (1 - u);
      c.save();
      c.globalCompositeOperation = 'lighter';
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.8, `rgba(255,255,255,${0.85 * (1 - u)})`);
      g.addColorStop(1, `rgba(255,255,255,${1 - u})`);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1 + (nx / nl) * w * 0.3, y1 + (ny / nl) * w * 0.3);
      c.lineTo(x1, y1);
      c.lineTo(x1 - (nx / nl) * w, y1 - (ny / nl) * w);
      c.closePath();
      c.fill();
      c.shadowColor = 'rgba(255,255,255,0.9)';
      c.shadowBlur = 12;
      c.strokeStyle = `rgba(255,255,255,${0.9 * (1 - u)})`;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      c.restore();
    }
  }
}
