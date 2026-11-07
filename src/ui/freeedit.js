// The freeform gradient editor: the cube unfolded - its six faces in a
// cross, each showing its colours - with the gradient's points on it. Tap a
// face for a point more there; drag one about (over the folds from face to
// face); drag one right off to take it away; tap one to pick it, and again
// for its colour. Under it: the picked point's colour and strength (how far
// its colour reaches), and Remove.

import { NET, netOf, netImages, freeNodes, freePower, FREE_K_MIN, FREE_K_MAX } from '../freeform.js';
import { MIN_LAYERS, MAX_LAYERS } from '../styles.js';

const GAP = 3; // (px between the faces)
const IMG = 44; // (each face's picture worked out this many px a side, then drawn smooth)
const OFF = 40; // (px off the net a point must be dragged to come away)
const kOf = (s) => FREE_K_MIN * Math.pow(FREE_K_MAX / FREE_K_MIN, s);
const sOf = (k) => Math.log(k / FREE_K_MIN) / Math.log(FREE_K_MAX / FREE_K_MIN);
const strengthWord = (k) => (k < 0.45 ? 'Faint' : k < 0.8 ? 'Light' : k < 1.3 ? 'Even' : k < 2.4 ? 'Strong' : 'Bold');

export class FreeEditor {
  constructor(app, sec) {
    this.app = app;
    this.el = sec.querySelector('.free');
    this.net = this.el.querySelector('.free-net');
    this.canvas = this.net.querySelector('canvas');
    this.nodesEl = this.net.querySelector('.free-nodes');
    this.colBtn = this.el.querySelector('.free-col');
    this.colIn = this.colBtn.querySelector('input');
    this.kIn = this.el.querySelector('.free-k input');
    this.kWord = this.el.querySelector('.free-k .word');
    this.delBtn = this.el.querySelector('.free-del');
    this.nameEl = this.el.querySelector('.free-name');
    this.tileNote = this.el.querySelector('.free-note');
    this.sel = 0;
    this.drag = null;
    this._tap = -1;
    this._faces = null; // (the faces' pictures, a canvas each)
    this._key = '';
    this.colIn.addEventListener('input', () => app.setLayerColor(this.sel, this.colIn.value));
    this.kIn.addEventListener('input', () => app.setLayerNodeStrength(this.sel, kOf(+this.kIn.value)));
    this.delBtn.addEventListener('click', () => {
      app.audio.ui();
      if (app.removeLayerNode(this.sel)) this.sel = Math.max(0, this.sel - 1);
    });
    this.net.addEventListener('pointerdown', (e) => this._down(e));
    this.net.addEventListener('pointermove', (e) => this._move(e));
    this.net.addEventListener('pointerup', (e) => this._up(e));
    this.net.addEventListener('pointercancel', () => this._cancel());
    this.net.addEventListener('click', (e) => {
      // (the colour picker opens on the click a tap makes - it needs one)
      const i = this._tap;
      this._tap = -1;
      if (i < 0) return;
      e.preventDefault();
      this._pick();
    });
  }

  // the net's size: four faces across the space there is
  _layout() {
    const W = Math.max(160, this.net.clientWidth || 300);
    const F = Math.floor((W - 3 * GAP) / 4);
    return { F, W: 4 * F + 3 * GAP, H: 3 * F + 2 * GAP };
  }

  // the face and the point on it under a pointer (off the faces: the nearest
  // edge of the nearest face) - and how far off the net it is
  _at(e) {
    const r = this.net.getBoundingClientRect(), { F, W, H } = this._layout();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null;
    NET.forEach((face, fi) => {
      const x0 = face.col * (F + GAP), y0 = face.row * (F + GAP);
      const cx = Math.min(x0 + F, Math.max(x0, px)), cy = Math.min(y0 + F, Math.max(y0, py));
      const d = Math.hypot(px - cx, py - cy);
      if (!best || d < best.d) best = { d, fi, u: (cx - x0) / F, v: 1 - (cy - y0) / F };
    });
    const out = Math.max(0, -px, px - W, -py, py - H);
    return { ...best, out, onFace: best.d === 0 };
  }

  _down(e) {
    if (e.button > 0 || this.drag) return;
    const h = e.target.closest('.fnode');
    const at = this._at(e);
    let i;
    if (h) i = +h.dataset.i;
    else {
      if (!at.onFace) return;
      // (on a face: a point more, right there)
      const [x, y, z] = NET[at.fi].p(at.u, at.v);
      i = this.app.addLayerNode(x, y, z);
      if (i < 0) {
        this.app.ui?.hint(`That's as many colours as there can be: ${MAX_LAYERS}`, 1600);
        return;
      }
      this.app.audio.ui();
    }
    e.preventDefault();
    this.net.setPointerCapture?.(e.pointerId);
    this.drag = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, moved: false, added: !h, off: false, was: this.sel, next: null };
    this.sel = i;
    this.render(this.app.style.layers);
  }

  _move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    const at = this._at(e);
    d.off = at.out > OFF && this.app.style.layers.colors.length > MIN_LAYERS;
    // (one move a frame, however fast the pointer reports)
    d.next = NET[at.fi].p(at.u, at.v);
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0;
        if (this.drag !== d || !d.next) return;
        this.app.moveLayerNode(d.i, ...d.next);
        d.next = null;
      });
    }
    this._mark();
  }

  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.next && !d.off) this.app.moveLayerNode(d.i, ...d.next);
    if (d.off) {
      this.app.removeLayerNode(d.i);
      this.app.audio.ui();
      this.sel = Math.max(0, Math.min(this.sel, this.app.style.layers.colors.length - 1));
    } else if (!d.moved && !d.added && d.was === d.i) this._tap = d.i; // (picked already: its colour)
    this.render(this.app.style.layers);
  }

  _cancel() {
    if (this.drag?.raf) cancelAnimationFrame(this.drag.raf);
    this.drag = null;
    this._mark();
  }

  _pick() {
    try {
      if (this.colIn.showPicker) this.colIn.showPicker();
      else this.colIn.click();
    } catch (err) {
      this.colIn.click();
    }
  }

  // (the point being dragged, and whether it's coming away; the picked one)
  _mark() {
    const d = this.drag;
    [...this.nodesEl.children].forEach((h, k) => {
      h.classList.toggle('sel', k === this.sel);
      h.classList.toggle('held', !!d && d.i === k);
      h.classList.toggle('off', !!d && d.i === k && d.off);
    });
  }

  render(L) {
    const f = { layers: L.colors, nodes: L.nodes, blur: L.blur }, nodes = freeNodes(f), n = L.colors.length;
    this.sel = Math.max(0, Math.min(this.sel, n - 1));
    const { F, W, H } = this._layout(), dpr = Math.min(2, window.devicePixelRatio || 1);
    // the faces' pictures (worked out again only when the gradient's changed)
    // (each face its own little canvas: one reused for all six drew some
    // faces with another's picture on Safari - its copies are put off)
    const key = JSON.stringify([L.colors, nodes, L.blur]);
    if (key !== this._key) {
      this._key = key;
      const imgs = netImages(f, IMG);
      this._faces = this._faces || NET.map(() => {
        const t = document.createElement('canvas');
        t.width = t.height = IMG;
        return t;
      });
      imgs.forEach((img, fi) => this._faces[fi].getContext('2d').putImageData(new ImageData(img, IMG, IMG), 0, 0));
    }
    const c = this.canvas;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    this.nodesEl.style.width = `${W}px`;
    this.nodesEl.style.height = `${H}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    NET.forEach((face, fi) => {
      const x0 = face.col * (F + GAP), y0 = face.row * (F + GAP);
      g.save();
      g.beginPath();
      if (g.roundRect) g.roundRect(x0, y0, F, F, 6);
      else g.rect(x0, y0, F, F);
      g.clip();
      g.drawImage(this._faces[fi], x0, y0, F, F);
      // (its name, small, in a corner)
      g.font = `600 ${Math.max(9, Math.round(F * 0.13))}px system-ui, sans-serif`;
      g.fillStyle = 'rgba(255, 255, 255, 0.85)';
      g.shadowColor = 'rgba(0, 0, 0, 0.45)';
      g.shadowBlur = 3;
      g.fillText(face.name, x0 + 6, y0 + 4 + Math.max(9, Math.round(F * 0.13)));
      g.restore();
    });
    // (the picked point's reach: a ring that grows with its strength)
    const q = nodes[this.sel];
    if (q) {
      const at = netOf(q.x, q.y, q.z), face = NET[at.f];
      const cx = face.col * (F + GAP) + at.u * F, cy = face.row * (F + GAP) + (1 - at.v) * F;
      const r = F * 0.2 * Math.pow(q.k, 1 / (2 * freePower(L.blur)));
      g.save();
      g.setLineDash([3, 3]);
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      g.shadowColor = 'rgba(0, 0, 0, 0.4)';
      g.shadowBlur = 2;
      g.beginPath();
      g.arc(cx, cy, Math.max(14, r), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    // the points
    if (this.nodesEl.children.length !== n) {
      this.nodesEl.textContent = '';
      for (let k = 0; k < n; k++) {
        const h = document.createElement('span');
        h.className = 'fnode';
        h.innerHTML = '<i></i>';
        h.setAttribute('role', 'button');
        this.nodesEl.appendChild(h);
      }
    }
    nodes.forEach((p, k) => {
      const at = netOf(p.x, p.y, p.z), face = NET[at.f], h = this.nodesEl.children[k];
      h.dataset.i = k;
      h.style.left = `${face.col * (F + GAP) + at.u * F}px`;
      h.style.top = `${face.row * (F + GAP) + (1 - at.v) * F}px`;
      h.querySelector('i').style.background = L.colors[k];
      h.setAttribute('aria-label', `Colour ${k + 1} of ${n}, on the ${face.name.toLowerCase()}`);
    });
    // the picked one's colour and strength
    const col = L.colors[this.sel];
    this.colBtn.querySelector('i').style.background = col;
    if (this.colIn.value.toLowerCase() !== col.toLowerCase()) this.colIn.value = col;
    const k = q ? q.k : 1;
    if (document.activeElement !== this.kIn) this.kIn.value = sOf(k);
    this.kIn.style.setProperty('--p', `${sOf(k) * 100}%`);
    this.kWord.innerHTML = `${strengthWord(k)}<i class="num">${k.toFixed(k < 1 ? 2 : 1)}×</i>`;
    this.delBtn.disabled = n <= MIN_LAYERS;
    if (q) this.nameEl.textContent = `Colour ${this.sel + 1} of ${n} · ${NET[netOf(q.x, q.y, q.z).f].name.toLowerCase()}`;
    // (subdivided: what's here is each little cube)
    const t = L.tiles || 1;
    this.tileNote.hidden = t < 2;
    this.tileNote.textContent = `Subdivided: each of its ${t}×${t}×${t} little cubes looks like this`;
    this._mark();
  }
}
