// Clips: a record button (top left, by the Cubby). Tap it and what's drawn
// is recorded, its sounds too, until it's tapped again (two minutes at most)
// - then a card to watch it back and share it (the system's share sheet:
// Photos, TikTok, Messages) or save it. Each frame drawn is copied into a
// picture of the clip's own (30 a second at most, its long side 1280 at
// most) with a small mark drawn in by the GPU - the logotype and where to
// play - so a clip that gets passed on brings people back.

import * as THREE from 'three';

const MAX_S = 120;
const FPS = 30;
const LONG = 1280; // (the clip's longer side, px, at most)
// (what the browser can make: Safari mp4, Chrome mp4 or webm)
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
// (its ring fills as the time runs out - on a phone, all there's room for)
const RING = 2 * Math.PI * 8.5;
const REC_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle class="dot" cx="12" cy="12" r="4.6"/></svg>`;

export class Clips {
  constructor(ui, app) {
    this.app = app;
    this.ui = ui;
    this.rec = null;
    this.src = null; // the clip's own picture and its stream: see _source
    this.dest = null; // the sounds, as heard (made once)
    this._sound = false; // (the sounds going into it now)
    this.t0 = 0;
    this.url = '';
    this.file = null;
    this._tick = 0;
    this._wait = 0;
    this._mt = null;
    // (can't record here: no button)
    const cv = document.createElement('canvas');
    this.able = !!(cv.captureStream && window.MediaRecorder && window.MediaStream && TYPES.some((t) => MediaRecorder.isTypeSupported?.(t)));
    if (!this.able) return;
    ui.root.insertAdjacentHTML(
      'beforeend',
      `<button class="rec-btn" aria-label="Record a clip" title="Record a clip">${REC_ICON}<span class="rec-time"></span></button>
      <div class="modal clip-modal" hidden role="dialog" aria-modal="true" aria-labelledby="clip-title">
        <div class="modal-card clip-card">
          <h2 id="clip-title">Your clip</h2>
          <video class="clip-video" playsinline autoplay loop muted controls></video>
          <div class="modal-actions">
            <button class="soft clip-del">Delete</button>
            <a class="soft clip-save" download>Save</a>
            <button class="primary clip-share">Share</button>
          </div>
        </div>
      </div>`,
    );
    const root = ui.root;
    this.btn = root.querySelector('.rec-btn');
    this.timeEl = root.querySelector('.rec-time');
    this.ringEl = root.querySelector('.rec-btn .ring');
    this.modal = root.querySelector('.clip-modal');
    this.video = root.querySelector('.clip-video');
    this.saveEl = root.querySelector('.clip-save');
    this.shareEl = root.querySelector('.clip-share');
    this.btn.addEventListener('click', () => (this.rec ? this.stop() : this.start()));
    root.querySelector('.clip-del').addEventListener('click', () => this._close());
    this.shareEl.addEventListener('click', () => this._share());
    this.modal.addEventListener('click', (e) => e.target === this.modal && this._close());
    window.addEventListener('keydown', (e) => e.key === 'Escape' && !this.modal.hidden && this._close());
  }

  get recording() {
    return !!this.rec;
  }

  // The clip's own picture, each frame copied into it, and its stream -
  // made once and kept, never stopped (a second recording on a canvas whose
  // first stream had been stopped never started on Safari). Frames only when
  // asked for where the browser can (nothing copied while not recording).
  _source() {
    if (this.src) return this.src;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2;
    const g = cv.getContext('2d', { alpha: false });
    let track = cv.captureStream(0).getVideoTracks()[0];
    const manual = typeof track?.requestFrame === 'function';
    if (!manual) track = cv.captureStream(FPS).getVideoTracks()[0];
    return (this.src = { cv, g, track, manual, last: 0 });
  }

  // after each frame's drawn (App.render, the mark on it): while recording,
  // a copy of it into the clip - 30 a second at most
  frame() {
    const S = this.src;
    if (!this.rec || !S) return;
    const now = performance.now();
    if (now - S.last < 1000 / FPS - 4) return;
    S.last = now;
    S.g.drawImage(this.app.renderer.domElement, 0, 0, S.cv.width, S.cv.height);
    if (S.manual) S.track.requestFrame();
  }

  start() {
    const app = this.app;
    if (this.rec || !this.able) return;
    try {
      // (the tap that starts it lets the sound start too)
      app.audio?.init?.();
      const S = this._source(), gl = app.renderer.domElement;
      // (its size: the screen's picture, its long side 1280 at most - even,
      // for the video encoder)
      const k = Math.min(1, LONG / Math.max(gl.width, gl.height, 1));
      const w = Math.max(2, Math.round((gl.width * k) / 2) * 2), h = Math.max(2, Math.round((gl.height * k) / 2) * 2);
      if (S.cv.width !== w || S.cv.height !== h) (S.cv.width = w), (S.cv.height = h);
      const tracks = [S.track], A = app.audio;
      // (its sounds as you hear them - none, muted)
      if (A?.ctx && A.out) {
        try {
          this.dest ||= A.ctx.createMediaStreamDestination();
          A.out.connect(this.dest);
          this._sound = true;
          tracks.push(...this.dest.stream.getAudioTracks());
        } catch (e) {
          this._unhook();
        }
      }
      const stream = new MediaStream(tracks);
      let type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '', rec;
      try {
        rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5e6, audioBitsPerSecond: 128e3 });
      } catch (e) {
        rec = new MediaRecorder(stream);
        type = rec.mimeType || '';
      }
      // (each recording its own pieces: one that's still finishing can't
      // spill into the next)
      const chunks = [];
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
      rec.onstop = () => this._done(chunks, type);
      rec.onerror = () => this.stop();
      rec.start();
      this.rec = rec;
    } catch (e) {
      console.warn('clip: could not start', e);
      this._unhook();
      this.rec = null;
      this.ui.hint?.("Couldn't start a recording here");
      return;
    }
    this.t0 = performance.now();
    this.src.last = 0;
    app.markTex = this._markTexture();
    app.recording = true;
    this.btn.classList.add('on');
    this.btn.setAttribute('aria-label', 'Stop recording');
    this._tick = setInterval(() => this._time(), 250);
    this._time();
  }

  stop() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    clearInterval(this._tick);
    this.app.recording = false;
    this.btn.classList.remove('on');
    this.btn.setAttribute('aria-label', 'Record a clip');
    this.timeEl.textContent = '';
    this.ringEl.style.strokeDashoffset = '';
    // (it says it's done - or, if it never does, it didn't come out)
    clearTimeout(this._wait);
    this._wait = setTimeout(() => this._done([], ''), 6000);
    try {
      if (rec.state !== 'inactive') rec.stop();
      else this._done([], '');
    } catch (e) {
      this._done([], '');
    }
  }

  _time() {
    const s = (performance.now() - this.t0) / 1000;
    if (s >= MAX_S) return this.stop();
    this.timeEl.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.ringEl.style.strokeDashoffset = `${(RING * (1 - s / MAX_S)).toFixed(2)}`;
  }

  // (the sounds out of the clip again)
  _unhook() {
    const A = this.app.audio;
    if (this._sound && this.dest && A?.out) {
      try {
        A.out.disconnect(this.dest);
      } catch (e) {
        /* (gone already) */
      }
    }
    this._sound = false;
  }

  _done(chunks, type) {
    clearTimeout(this._wait);
    this._unhook();
    if (!chunks.length) {
      // (a recording's finishing - the one that never said - or one's going)
      if (!this.rec && this.modal.hidden) this.ui.hint?.("That clip didn't come out - try again");
      return;
    }
    const base = (type || chunks[0].type || 'video/webm').split(';')[0], ext = base.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: base });
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `cube-simulator-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
    this.file = new File([blob], name, { type: base });
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.video.src = this.url;
    this.saveEl.href = this.url;
    this.saveEl.download = name;
    // (the share sheet, where there is one that takes a file)
    this.shareEl.hidden = !(navigator.canShare && navigator.canShare({ files: [this.file] }));
    this.modal.hidden = false;
    this.video.play?.().catch(() => {});
  }

  async _share() {
    try {
      await navigator.share({ files: [this.file], title: 'Cube Simulator' });
    } catch (e) {
      /* (cancelled) */
    }
  }

  _close() {
    this.modal.hidden = true;
    this.video.pause?.();
    this.video.removeAttribute('src');
    this.video.load?.();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    this.file = null;
  }

  // The mark: the logotype (its own letters - see index.html) and where to
  // play, white with a soft shadow, to read over any of it
  _markTexture() {
    if (this._mt) return this._mt;
    const W = 900, H = 330, cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.shadowColor = 'rgba(0, 0, 0, 0.45)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 3;
    g.fillStyle = '#fff';
    // CUBE: the letters' paths (a 146 x 40 box)
    const s = (W * 0.62) / 146;
    g.save();
    g.translate((W - 146 * s) / 2, 20);
    g.scale(s, s);
    for (const id of ['bl-c', 'bl-u', 'bl-b', 'bl-e']) {
      const el = document.getElementById(id);
      if (!el) continue;
      g.fill(new Path2D(el.getAttribute('d')), el.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    g.restore();
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // SIMULATOR, spaced out to the word's width
    g.font = `800 ${Math.round(s * 13)}px ${font}`;
    const word = 'SIMULATOR', span = 146 * s, x0 = (W - span) / 2;
    const ws = [...word].map((c) => g.measureText(c).width), gap = (span - ws.reduce((a, b) => a + b, 0)) / (word.length - 1);
    let x = x0;
    g.textAlign = 'left';
    for (let i = 0; i < word.length; i++) {
      g.fillText(word[i], x, 20 + 58 * s);
      x += ws[i] + gap;
    }
    // ...and where
    g.textAlign = 'center';
    g.font = `600 ${Math.round(s * 7.2)}px ${font}`;
    g.globalAlpha = 0.9;
    g.fillText(location.host + location.pathname.replace(/\/$/, ''), W / 2, H - 22);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return (this._mt = tex);
  }
}
